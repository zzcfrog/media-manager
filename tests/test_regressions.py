"""Persistent regression checks; all data lives in an isolated temporary directory."""
from support import DatabaseCase, _ROOT
import inspect
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
from backend.db import get_db
from backend.blueprints import analysis, library
from backend.services import importer
from backend import analyzer, compressor

class LibraryRegressionTests(DatabaseCase):
    def test_folder_paths_are_literal(self):
        for symbol, sibling in [('_', 'X'), ('%', 'long')]:
            folder = self.case / ('trip' + symbol + '1')
            wanted = self.seed(folder / 'a.mov')
            other = self.seed(self.case / ('trip' + sibling + '1') / 'b.mov')
            response = self.client.delete('/api/library/folder', json={'path':str(folder)})
            self.assertEqual(response.json['count'], 1)
            self.assertIsNotNone(self.db.execute('SELECT id FROM media WHERE id=?', (other,)).fetchone())

    def test_missing_or_unreadable_sync_preserves_records(self):
        folder = self.case / 'offline'
        mid = self.seed(folder / 'a.mov', rating=5)
        self.segments(mid)
        response = self.client.post('/api/library/sync-folder', json={'path':str(folder)}, buffered=True)
        self.assertEqual(response.status_code, 400)
        folder.mkdir()
        with patch.object(importer, '_collect_files', side_effect=PermissionError('unreadable')):
            response = self.client.post('/api/library/sync-folder', json={'path':str(folder)}, buffered=True)
            self.assertEqual(response.status_code, 400)
        self.assertEqual(self.db.execute('SELECT rating FROM media WHERE id=?',(mid,)).fetchone()[0], 5)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media_segment').fetchone()[0], 1)

    def test_reimport_preserves_identity_and_annotations_on_success_and_failure(self):
        path = self.case / 'file.mov'
        path.write_bytes(b'changed')
        mid = self.seed(path, rating=5, notes='keep', file_size=1, file_mtime=0)
        self.segments(mid)
        sid=self.db.execute('SELECT id FROM media_segment').fetchone()[0]
        pid=self.db.execute("INSERT INTO projects(name) VALUES ('preserved')").lastrowid
        self.db.execute('INSERT INTO project_media VALUES (?,?)',(pid,mid))
        self.db.execute("INSERT INTO project_tracks(project_id,track_type,segment_id) VALUES (?,'video',?)",(pid,sid))
        self.db.execute("INSERT INTO tags(name) VALUES ('preserved')")
        tag=self.db.execute('SELECT id FROM tags').fetchone()[0]
        self.db.execute('INSERT INTO media_tags VALUES (?,?)',(mid,tag));self.db.commit()
        with patch.object(importer, '_probe', side_effect=RuntimeError('probe failed')):
            with self.assertRaises(RuntimeError):
                importer._import_one(self.db, path, force_update=True)
        self.db.commit()
        self.assertIsNotNone(self.db.execute('SELECT id FROM media WHERE id=?',(mid,)).fetchone())
        with patch.object(importer, '_probe', return_value={'width':123}), patch.object(importer, '_generate_thumbnail', return_value=None):
            result = importer._import_one(self.db, path, force_update=True)
        self.assertEqual((result['id'], result['rating'], result['notes'], result['width']), (mid, 5, 'keep', 123))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media_segment').fetchone()[0], 1)
        self.assertEqual(self.db.execute('SELECT media_id FROM project_media WHERE project_id=?',(pid,)).fetchone()[0],mid)
        self.assertEqual(self.db.execute('SELECT segment_id FROM project_tracks').fetchone()[0],sid)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media_tags WHERE media_id=?',(mid,)).fetchone()[0],1)

    def test_batch_images_use_local_configuration(self):
        mid = self.seed(media_type='image')
        self.db.executemany('INSERT OR REPLACE INTO settings VALUES (?,?)', [('image_engine','local'),('local_model','qwen3-omni-30b-a3b')])
        self.db.commit()
        with patch.object(analysis._analysis_pool,'submit') as submit:
            self.assertEqual(self.client.post('/api/analysis/batch',json={'ids':[mid]}).status_code,200)
        call = submit.call_args.args
        args = inspect.signature(call[0]).bind(*call[1:]); args.apply_defaults()
        self.assertEqual((args.arguments['engine'],args.arguments['local_model_id']), ('local','qwen3-omni-30b-a3b'))

    def test_processing_single_is_rejected(self):
        mid = self.seed(analysis_status='processing')
        response = self.client.post(f'/api/analysis/{mid}')
        self.assertEqual(response.status_code,409)

    def test_literal_search_and_cleared_analysis_keep_filename(self):
        mid = self.seed()
        self.segments(mid)
        self.assertEqual(self.search('clip.mov'),[mid])
        self.assertEqual(self.client.delete(f'/api/analysis/{mid}').status_code,200)
        self.assertEqual(self.search('clip'),[mid])

    def test_import_segments_filename_and_tag_changes_reindex(self):
        path = self.case / '公园里的小猫.mov'; path.write_bytes(b'x')
        with patch.object(importer, '_probe',return_value={}), patch.object(importer, '_generate_thumbnail',return_value=None):
            mid = importer._import_one(self.db,path)['id']
        self.assertEqual(self.search('小猫'),[mid])
        self.client.post('/api/tags/assign',json={'media_id':mid,'tags':['SpecialTag']})
        self.assertEqual(self.search('SpecialTag'),[mid])
        tag = self.db.execute('SELECT id FROM tags').fetchone()[0]
        self.client.delete(f'/api/tags/{tag}')
        self.assertEqual(self.search('SpecialTag'),[])

    def test_reanalysis_preserves_referenced_source_clip(self):
        mid = self.seed(); self.segments(mid)
        sid = self.db.execute('SELECT id FROM media_segment').fetchone()[0]
        plan = {'acts':[{'act_id':'a','narratives':[{'narrative_id':'n','shots':[{'segment_id':sid}]}]}]}
        pid = self.db.execute('INSERT INTO projects(name,ai_plan) VALUES (?,?)',('p',json.dumps(plan))).lastrowid
        self.db.execute('INSERT INTO project_media VALUES (?,?)',(pid,mid))
        self.db.commit()
        self.assertEqual(self.client.post(f'/api/creative/{pid}/apply').status_code,200)
        self.segments(mid, 'new forest')
        track = self.db.execute("SELECT * FROM project_tracks WHERE track_type='video'").fetchone()
        self.assertEqual(track['segment_id'],sid)
        self.assertEqual(self.client.post(f'/api/creative/{pid}/apply').status_code,200)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM project_tracks WHERE track_type='video'").fetchone()[0],1)

    def test_deleted_media_cannot_be_resurrected_by_worker(self):
        mid = self.seed()
        self.client.delete(f'/api/library/{mid}')
        with self.assertRaises(ValueError): self.segments(mid)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media_segment').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media_fts').fetchone()[0],0)

    def test_invalid_analysis_is_rejected_before_replacing_existing(self):
        mid = self.seed(); self.segments(mid)
        for bad in ([], [{}], [{'raw_response':'broken'}]):
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                analysis.save_segments(mid,bad)
        self.db.commit()
        self.assertEqual(self.db.execute('SELECT visual FROM media_segment').fetchone()[0], 'forest')

    def test_one_embedded_image_cluster_is_empty(self):
        import numpy as np
        self.seed(media_type='image', embedding=np.array([1,0],dtype=np.float32).tobytes())
        self.assertEqual(self.client.get('/api/library/duplicates?type=cluster').json['groups'],[])

    def test_exclusion_cannot_be_bridged(self):
        import numpy as np
        groups = library._union_find_groups(np.ones((3,3)),.9,[1,2,3],{(1,2)})
        self.assertFalse(any(0 in g and 1 in g for g in groups))


class PureTest(unittest.TestCase):
    def test_malformed_analysis_parsers_fail(self):
        for parse in (analyzer._parse_response, analyzer._parse_image_response):
            for value in ('{', '{}', '[]', '{"raw_response":"bad"}'):
                with self.subTest(parse=parse.__name__,value=value), self.assertRaises(ValueError): parse(value)

    def test_contained_overlap_is_not_negative(self):
        segs = [dict(time_start='00:00:00',time_end='00:00:10'),dict(time_start='00:00:05',time_end='00:00:07'),dict(time_start='00:00:08',time_end='00:00:12')]
        analysis._fix_segment_overlaps(segs)
        self.assertTrue(all(analysis._ts_to_seconds(s['time_end']) > analysis._ts_to_seconds(s['time_start']) for s in segs))
        self.assertEqual(len(segs),2)

    def test_compression_uses_unique_names(self):
        with tempfile.TemporaryDirectory(dir=_ROOT) as td:
            path = Path(td) / 'clip.mov'; path.write_bytes(b'x')
            def popen(cmd,**kwargs):
                Path(cmd[-1]).write_bytes(b'video'); return Mock(returncode=0,stderr=[])
            old = os.getcwd(); os.chdir(td)
            try:
                with patch.object(compressor,'check_ffmpeg'), patch.object(compressor,'_get_duration',return_value=1), patch.object(compressor.subprocess,'Popen',side_effect=popen):
                    first=compressor.compress_video(path)[0]; second=compressor.compress_video(path)[0]
                self.assertNotEqual(first,second)
            finally: os.chdir(old)
