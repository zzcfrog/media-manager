"""Import pipeline regressions with isolated sources, caches and database."""
from support import DatabaseCase
from concurrent.futures import ThreadPoolExecutor
import io
import json
from pathlib import Path
import sqlite3
import threading
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image, ImageOps
from backend.services import importer, embedding


class ImportPipelineTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.thumbs = self.case / 'thumbnails'
        self.thumbs.mkdir()
        self.stack_patch = patch.object(importer, 'THUMB_DIR', self.thumbs)
        self.stack_patch.start()
        self.addCleanup(self.stack_patch.stop)

    def sources(self, count=4):
        paths = [self.case / f'clip-{i}.mov' for i in range(count)]
        for p in paths:
            p.write_bytes(b'synthetic source')
        return paths

    def thumbnail(self, path, *_args, **_kwargs):
        name = path.stem + '.jpg'
        Image.new('RGB', (32, 18), 'green').save(self.thumbs / name)
        return name

    def test_two_workers_prepare_but_commits_stay_on_request_thread(self):
        paths = self.sources(4)
        barrier = threading.Barrier(2)
        workers, writers = set(), []
        original_save = importer._save_import
        def probe(path, *_args, **_kwargs):
            workers.add(threading.get_ident())
            barrier.wait(timeout=5)
            return {'width': 320}
        def save(*args):
            writers.append(threading.get_ident())
            return original_save(*args)
        with patch.object(importer, '_run_exiftool_batch', return_value={}), \
             patch.object(importer, '_probe', side_effect=probe), \
             patch.object(importer, '_generate_thumbnail', side_effect=self.thumbnail), \
             patch.object(importer, '_save_import', side_effect=save):
            for event in importer.import_batch(self.db, [str(p) for p in paths]):
                self.assertEqual(event['type'], 'ok')
                # Success is already visible through a separate DB connection.
                with sqlite3.connect(self.app.config['DATABASE']) as observer:
                    self.assertIsNotNone(observer.execute('SELECT id FROM media WHERE id=?',
                                                         (event['data']['id'],)).fetchone())
        self.assertEqual(len(workers), 2)
        self.assertEqual(set(writers), {threading.get_ident()})
        self.assertEqual([r[0] for r in self.db.execute('SELECT file_name FROM media ORDER BY id')],
                         [p.name for p in paths])

    def test_failure_and_duplicate_do_not_stop_following_files(self):
        paths = self.sources(4)
        self.seed(paths[0], rating=5, notes='preserved')
        def probe(path, *_args, **_kwargs):
            if path == paths[1]:
                raise RuntimeError('synthetic unreadable file')
            return {}
        with patch.object(importer, '_run_exiftool_batch', return_value={}), \
             patch.object(importer, '_probe', side_effect=probe) as probe_mock, \
             patch.object(importer, '_generate_thumbnail', side_effect=self.thumbnail):
            response = self.client.post('/api/library/import-batch', json={'paths':
                                        [str(p) for p in paths + [paths[2]]]}, buffered=True)
        events = [json.loads(s.removeprefix('data: ')) for s in response.text.strip().split('\n\n')]
        self.assertEqual([e['type'] for e in events], ['skip', 'fail', 'ok', 'ok', 'skip', 'done'])
        self.assertEqual(events[-1], {'type': 'done', 'imported': 2, 'failed': 1})
        self.assertEqual(probe_mock.call_count, 3)
        self.assertNotIn('embedding', events[2]['data'])
        row = self.db.execute('SELECT rating,notes FROM media WHERE file_path=?', (str(paths[0]),)).fetchone()
        self.assertEqual(tuple(row), (5, 'preserved'))
        self.assertEqual(len(list(self.thumbs.iterdir())), 2)

    def test_disconnect_discards_uncommitted_previews(self):
        paths = self.sources(20)
        with patch.object(importer, '_run_exiftool_batch', return_value={}), \
             patch.object(importer, '_probe', side_effect=lambda *a, **k: {}), \
             patch.object(importer, '_generate_thumbnail', side_effect=self.thumbnail):
            events = importer.import_batch(self.db, [str(p) for p in paths])
            first = next(events)
            events.close()
        self.assertEqual(first['type'], 'ok')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media').fetchone()[0], 1)
        self.assertEqual([p.name for p in self.thumbs.iterdir()], [first['data']['thumbnail_path']])

    def test_write_failure_rolls_back_and_removes_only_new_cache(self):
        paths = self.sources(3)
        self.db.execute("CREATE TRIGGER reject_import BEFORE INSERT ON media WHEN NEW.file_name='clip-1.mov' "
                        "BEGIN SELECT RAISE(FAIL,'synthetic write failure'); END")
        self.db.commit()
        with patch.object(importer, '_run_exiftool_batch', return_value={}), \
             patch.object(importer, '_probe', side_effect=lambda *a, **k: {}), \
             patch.object(importer, '_generate_thumbnail', side_effect=self.thumbnail):
            events = list(importer.import_batch(self.db, [str(p) for p in paths]))
        self.assertEqual([e['type'] for e in events], ['ok', 'fail', 'ok'])
        self.assertEqual({p.name for p in self.thumbs.iterdir()}, {'clip-0.jpg', 'clip-2.jpg'})
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media_fts').fetchone()[0], 2)

    def test_changed_or_removed_source_cannot_report_success(self):
        for remove in (False, True):
            path = self.sources(1)[0]
            def thumbnail(*args, **kwargs):
                name = self.thumbnail(*args, **kwargs)
                path.unlink() if remove else path.write_bytes(b'changed while preparing')
                return name
            with patch.object(importer, '_probe', side_effect=lambda *a, **k: {}), \
                 patch.object(importer, '_generate_thumbnail', side_effect=thumbnail):
                with self.assertRaises((RuntimeError, FileNotFoundError)):
                    importer._import_one(self.db, path)
            self.assertEqual(list(self.thumbs.iterdir()), [])
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media').fetchone()[0], 0)

    def test_scan_uses_one_walk_and_preserves_encrypted_report(self):
        paths = self.sources(2)
        encrypted = self.case / 'song.ncm'; encrypted.write_bytes(b'encrypted')
        (self.case / '._hidden.jpg').write_bytes(b'ignored')
        with patch.object(importer.os, 'walk', wraps=importer.os.walk) as walk:
            response = self.client.post('/api/library/scan', json={'paths': [str(self.case), str(paths[0])]})
        self.assertEqual(walk.call_count, 1)
        self.assertEqual(len(response.json['data']), 2)
        self.assertEqual(response.json['encrypted'], [{'file_name': encrypted.name, 'file_path': str(encrypted)}])

    def test_batched_exif_preserves_good_results_when_one_file_is_bad(self):
        paths = self.sources(2)
        result = SimpleNamespace(returncode=1, stdout=json.dumps([
            {'SourceFile': str(paths[0]), 'Model': 'Synthetic', 'Orientation': 6},
            {'SourceFile': str(paths[1]), 'Error': 'bad format'}]))
        with patch.object(importer.shutil, 'which', return_value='/synthetic/exiftool'), \
             patch.object(importer.subprocess, 'run', return_value=result) as run:
            metadata = importer._run_exiftool_batch(paths)
        self.assertEqual(run.call_count, 1)
        self.assertEqual(metadata[str(paths[0])]['Model'], 'Synthetic')
        self.assertIn('-Orientation#', run.call_args.args[0])

    def test_raw_preview_is_first_and_handles_all_exif_orientations(self):
        path = self.case / 'synthetic.nef'; path.write_bytes(b'raw placeholder')
        source = Image.new('RGB', (640, 320), 'red')
        source.paste('blue', (0, 0, 320, 160))
        encoded = io.BytesIO(); source.save(encoded, format='JPEG', quality=95)
        with patch.object(importer.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=encoded.getvalue())) as run, \
             patch.object(importer.shutil, 'which', return_value='/synthetic/tool'), \
             patch.object(importer, '_get_exif_orientation', side_effect=AssertionError('duplicate probe')):
            for orientation in range(1, 9):
                name = importer._generate_thumbnail(path, 'image', orientation=orientation)
                expected = source.copy(); expected.getexif()[274] = orientation
                expected = ImageOps.exif_transpose(expected)
                with Image.open(self.thumbs / name) as actual:
                    self.assertEqual(actual.width / actual.height, expected.width / expected.height)
                    self.assertLess(np.abs(np.array(actual.resize((8, 8)), dtype=float) -
                                           np.array(expected.resize((8, 8)), dtype=float)).mean(), 12)
        self.assertEqual(run.call_count, 8)
        self.assertTrue(all(c.args[0][0] == 'exiftool' for c in run.call_args_list))

    def test_missing_raw_preview_falls_back_to_decoder(self):
        path = self.case / 'synthetic.nef'; path.write_bytes(b'raw placeholder')
        def execute(cmd, **kwargs):
            if cmd[0] == 'exiftool':
                return SimpleNamespace(returncode=0, stdout=b'broken preview' * 20)
            Image.new('RGB', (320, 180), 'green').save(cmd[-1])
            return SimpleNamespace(returncode=0)
        with patch.object(importer.subprocess, 'run', side_effect=execute) as run, \
             patch.object(importer.shutil, 'which', return_value='/synthetic/tool'):
            name = importer._generate_thumbnail(path, 'image', orientation=1)
        self.assertTrue((self.thumbs / name).exists())
        self.assertEqual([c.args[0][0] for c in run.call_args_list], ['exiftool'] * 3 + ['ffmpeg'])

    def test_decoder_timeout_leaves_no_partial_thumbnail(self):
        path = self.sources(1)[0]
        def fail(cmd, **_kwargs):
            Path(cmd[-1]).write_bytes(b'partial')
            raise importer.subprocess.TimeoutExpired(cmd, 60)
        with patch.object(importer.subprocess, 'run', side_effect=fail), \
             patch.object(importer.shutil, 'which', return_value='/synthetic/tool'):
            with self.assertRaises(importer.subprocess.TimeoutExpired):
                importer._generate_thumbnail(path, 'video')
        self.assertEqual(list(self.thumbs.iterdir()), [])

    def test_reused_jpeg_pixels_preserve_embedding_input_and_orientation(self):
        path = self.case / 'portrait.jpg'
        exif = Image.Exif(); exif[274] = 6
        Image.new('RGB', (600, 400), 'green').save(path, exif=exif)
        inputs = []
        def infer(_outputs, feed):
            inputs.append(feed['input'].copy())
            return [np.ones(2048, dtype=np.float32)]
        session = SimpleNamespace(run=infer)
        with patch.object(embedding, '_get_session', return_value=session):
            direct = embedding.compute_embedding(path)
            with Image.open(path) as image:
                image.load()
                reused = embedding.compute_embedding(path, image=image)
                name = importer._generate_thumbnail(path, 'image', image=image)
                self.assertEqual(image.size, (600, 400))
                self.assertEqual(image.getexif()[274], 6)
        np.testing.assert_array_equal(inputs[0], inputs[1])
        self.assertEqual(direct, reused)
        with Image.open(self.thumbs / name) as thumbnail:
            self.assertEqual(thumbnail.size, (320, 480))

    def test_model_initialization_is_shared_between_workers(self):
        ready, release = threading.Event(), threading.Event()
        session = object()
        def initialize(*args, **kwargs):
            ready.set()
            self.assertTrue(release.wait(5))
            return session
        with patch.object(embedding, '_ort_session', None), \
             patch.object(embedding.ort, 'InferenceSession', side_effect=initialize) as initialize_mock, \
             ThreadPoolExecutor(max_workers=2) as pool:
            first = pool.submit(embedding._get_session)
            self.assertTrue(ready.wait(5))
            second = pool.submit(embedding._get_session)
            release.set()
            self.assertIs(first.result(), session)
            self.assertIs(second.result(), session)
            self.assertEqual(initialize_mock.call_count, 1)
