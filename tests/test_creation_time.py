"""Creation-time shifts use only isolated files and an isolated database."""
from support import DatabaseCase
import hashlib
import json
import os
import shutil
import subprocess
import sys
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from PIL import Image
from backend.blueprints import library


class CreationTimeTests(DatabaseCase):
    def events(self, ids, hours):
        response = self.client.post('/api/library/shift-creation-time',
                                    json={'ids': ids, 'hours': hours}, buffered=True)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.mimetype, 'text/event-stream')
        return [json.loads(part[6:]) for part in response.get_data(as_text=True).strip().split('\n\n')]

    def source(self, name='synthetic.mov'):
        path = self.case / name
        path.write_bytes(b'isolated file content')
        return path, self.seed(path, date_taken='2020-01-02 12:00:00', rating=5,
                               notes='preserve', file_mtime=path.stat().st_mtime)

    def test_invalid_inputs_never_run_a_writer(self):
        with patch('subprocess.run') as run:
            for payload in [[], {}, {'ids': [], 'hours': 1}, {'ids': '1', 'hours': 1},
                            {'ids': [True], 'hours': 1}, {'ids': [0], 'hours': 1},
                            *({'ids': [1], 'hours': value} for value in [25, -25, 1.5, '8', True, None])]:
                with self.subTest(payload=payload):
                    self.assertEqual(self.client.post('/api/library/shift-creation-time', json=payload).status_code, 400)
            run.assert_not_called()

    def test_zero_is_a_streamed_noop_and_deduplicates_ids(self):
        with patch('subprocess.run') as run:
            self.assertEqual(self.events([1, 1, 2], 0)[-1],
                             {'type': 'done', 'updated': 0, 'skipped': 2, 'errors': 0, 'hours': 0})
            run.assert_not_called()

    def test_missing_tool_fails_before_any_write(self):
        with patch('shutil.which', return_value=None), patch('subprocess.run') as run:
            response = self.client.post('/api/library/shift-creation-time', json={'ids': [1], 'hours': 8})
            self.assertEqual(response.status_code, 500)
            run.assert_not_called()

    def test_missing_records_offline_files_and_directories_are_skipped(self):
        missing = self.seed(self.case / 'offline.mov')
        directory = self.seed(self.case)
        with patch('shutil.which', return_value='/synthetic/exiftool'), patch('subprocess.run') as run:
            events = self.events([missing, directory, 999999], 8)
            self.assertEqual(events[-1]['skipped'], 3)
            self.assertEqual(events[-1]['errors'], 0)
            self.assertEqual(events[-2]['done'], 3)
            run.assert_not_called()

    def test_success_exit_without_changed_timestamp_is_not_success(self):
        _, mid = self.source()
        with patch('shutil.which', return_value='/synthetic/exiftool'), \
             patch('subprocess.run', return_value=SimpleNamespace(returncode=0)):
            final = self.events([mid], 8)[-1]
        self.assertEqual((final['updated'], final['errors']), (0, 1))

    def test_unsupported_birthtime_does_not_fall_back_to_ctime(self):
        path, mid = self.source()
        real_stat = os.stat
        def unsupported(p, *args, **kwargs):
            if str(p) == str(path):
                return SimpleNamespace(st_mode=real_stat(path).st_mode, st_ctime=12345)
            return real_stat(p, *args, **kwargs)
        with patch('shutil.which', return_value='/synthetic/exiftool'), \
             patch.object(library.os, 'stat', side_effect=unsupported), patch('subprocess.run') as run:
            final = self.events([mid], 8)[-1]
            run.assert_not_called()
        self.assertEqual(final['errors'], 1)

    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('exiftool') and shutil.which('ffmpeg'),
                         'requires macOS, ExifTool and FFmpeg')
    def test_real_image_and_video_shift_both_directions_preserving_bytes_and_database(self):
        photo = self.case / '照片 with spaces.jpg'
        Image.new('RGB', (32, 24), 'teal').save(photo)
        video = self.case / '视频.mov'
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=s=32x24:d=0.1',
                        '-metadata', 'creation_time=2020-01-02T12:00:00Z', str(video)], check=True)
        paths = [photo, video]
        subprocess.run(['exiftool', '-FileCreateDate=2020:01:02 12:00:00Z', *map(str, paths)],
                       check=True, capture_output=True, env={**os.environ, 'TZ': 'UTC'})
        ids = [self.seed(p, date_taken='2020-01-02 12:00:00', rating=5, file_mtime=p.stat().st_mtime) for p in paths]
        rows = [tuple(r) for r in self.db.execute('SELECT * FROM media ORDER BY id')]
        content = [hashlib.sha256(p.read_bytes()).hexdigest() for p in paths]
        identity = [(p.stat().st_ino, p.stat().st_size, p.stat().st_mtime_ns) for p in paths]
        for hours in [8, -24, 24]:
            before = [p.stat().st_birthtime for p in paths]
            # Absolute UTC writes remain correct regardless of the parent timezone.
            with patch.dict(os.environ, {'TZ': 'America/New_York'}):
                final = self.events(ids + [ids[0]], hours)[-1]
            self.assertEqual((final['updated'], final['errors']), (2, 0))
            for index, p in enumerate(paths):
                self.assertAlmostEqual(p.stat().st_birthtime - before[index], hours * 3600, delta=1)
                self.assertEqual(hashlib.sha256(p.read_bytes()).hexdigest(), content[index])
                self.assertEqual((p.stat().st_ino, p.stat().st_size, p.stat().st_mtime_ns), identity[index])
            self.assertEqual([tuple(r) for r in self.db.execute('SELECT * FROM media ORDER BY id')], rows)

    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('exiftool'), 'requires macOS and ExifTool')
    def test_batch_chunking_preserves_individual_dates(self):
        paths_ids = [self.source(f'file-{i}.mov') for i in range(51)]
        before = [p.stat().st_birthtime for p, _ in paths_ids]
        with patch('subprocess.run', wraps=subprocess.run) as run:
            events = self.events([mid for _, mid in paths_ids], -1)
        self.assertEqual(run.call_count, 2)
        self.assertEqual([e['done'] for e in events if e['type'] == 'progress'], [50, 51])
        self.assertEqual((events[-1]['updated'], events[-1]['errors']), (51, 0))
        for (p, _), old in zip(paths_ids, before):
            self.assertAlmostEqual(p.stat().st_birthtime, int(old) - 3600, delta=1)

    @unittest.skipUnless(sys.platform == 'darwin' and shutil.which('exiftool'), 'requires macOS and ExifTool')
    def test_partial_failure_or_timeout_counts_verified_success_without_retry(self):
        real_run = subprocess.run
        for timeout in [False, True]:
            first, a = self.source(f'first-{timeout}.mov')
            second, b = self.source(f'second-{timeout}.mov')
            before = second.stat().st_birthtime
            def partial(argv, **kwargs):
                real_run(argv[:4], **kwargs)
                if timeout:
                    raise subprocess.TimeoutExpired(argv, 30)
                return SimpleNamespace(returncode=1, stderr=b'synthetic permission denied')
            with patch('subprocess.run', side_effect=partial) as run:
                final = self.events([a, b], 8)[-1]
            self.assertEqual(run.call_count, 1)
            self.assertEqual((final['updated'], final['errors']), (1, 1))
            self.assertEqual(second.stat().st_birthtime, before)


if __name__ == '__main__':
    unittest.main()
