import json
from pathlib import Path
from unittest.mock import Mock, patch
from support import DatabaseCase
from backend.blueprints import creative, serve
from backend.services import xmp_writer

class IntegrityTests(DatabaseCase):
    def test_nested_plan_validation(self):
        plan={'acts':[{'narratives':[{'shots':[{'segment_id':1},{'segment_id':999}]}]}]}
        creative._validate_plan(plan,{1})
        self.assertEqual(plan['acts'][0]['narratives'][0]['shots'],[{'segment_id':1}])
        with self.assertRaises(ValueError):creative._validate_plan({}, {1})

    def test_xmp_failure_preserves_original(self):
        photo=self.case/'photo.jpg';photo.write_bytes(b'image')
        xp=photo.with_suffix('.xmp');xp.write_bytes(b'original sidecar')
        def run(cmd,**kwargs):
            if '-json' in cmd:return Mock(returncode=0,stdout='[{"Subject":["keep"]}]')
            Path(cmd[-1]).write_bytes(b'partial write')
            return Mock(returncode=1,stdout='')
        with patch.object(xmp_writer.shutil,'which',return_value='exiftool'),patch.object(xmp_writer.subprocess,'run',side_effect=run):
            self.assertFalse(xmp_writer.write_xmp(photo,tags=['new']))
        self.assertEqual(xp.read_bytes(),b'original sidecar')

    def test_timestamp_thumbnail_is_requested_frame(self):
        mid=self.seed()
        def run(cmd,**kwargs):Path(cmd[-1]).write_bytes(b'frame');return Mock(returncode=0)
        with patch.object(serve.shutil,'which',return_value='ffmpeg'),patch.object(serve.subprocess,'run',side_effect=run):
            response=self.client.get(f'/media/thumbnail/{mid}?t=3')
            self.assertEqual(response.status_code,200)
            self.assertEqual(response.data,b'frame')
            response.close()

    def test_head_does_not_spawn_stream_process(self):
        with patch.object(serve.subprocess,'Popen') as popen:
            with self.app.test_request_context(method='HEAD'):
                response=serve._stream_ffmpeg(['test'],'video/mp4')
                response.close()
            popen.assert_not_called()

    def test_legacy_duplicate_fts_does_not_duplicate_materials(self):
        mid=self.seed();self.segments(mid)
        self.db.execute("INSERT INTO media_fts(media_id,file_name,visual) VALUES (?,?,'forest')",(mid,'clip.mov'))
        pid=self.db.execute("INSERT INTO projects(name) VALUES ('project')").lastrowid
        self.db.execute('INSERT INTO project_media VALUES (?,?)',(pid,mid));self.db.commit()
        data=self.client.get(f'/api/workbench/{pid}?q=forest').json['data']
        self.assertEqual(data['media_count'],1)

    def test_transcoded_video_supports_range(self):
        import subprocess
        video=self.case/'source.avi'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=128x72:r=10:d=3','-c:v','mpeg4','-y',str(video)],check=True)
        mid=self.seed(video,duration=3)
        response=self.client.get(f'/media/video/{mid}',headers={'Range':'bytes=0-127'},buffered=True)
        self.assertEqual(response.status_code,206)
        self.assertTrue(response.headers['Content-Range'].startswith('bytes 0-127/'))
        self.assertEqual(len(response.data),128)
        etag=response.headers['ETag']
        response.close()
        resumed=self.client.get(f'/media/video/{mid}',headers={'Range':'bytes=128-255','If-Range':etag},buffered=True)
        self.assertEqual(resumed.status_code,206)
        self.assertEqual(resumed.headers['ETag'],etag)
        resumed.close()

    def test_offline_export_is_explicit(self):
        mid=self.seed();self.segments(mid)
        sid=self.db.execute('SELECT id FROM media_segment').fetchone()[0]
        pid=self.db.execute("INSERT INTO projects(name) VALUES ('offline')").lastrowid
        self.db.execute('INSERT INTO project_media VALUES (?,?)',(pid,mid))
        self.db.execute("INSERT INTO project_tracks(project_id,track_type,segment_id,time_start,time_end) VALUES (?,'video',?,'00:00:00','00:00:05')",(pid,sid));self.db.commit()
        response=self.client.get(f'/api/workbench/{pid}/export-fcpxml')
        self.assertEqual(response.status_code,400)
        self.assertIn('error',response.json)

    def test_changed_ranges_keep_source_snapshot(self):
        from backend.blueprints import analysis
        mid=self.seed();self.segments(mid)
        sid=self.db.execute('SELECT id FROM media_segment').fetchone()[0]
        plan={'acts':[{'act_id':'a','narratives':[{'narrative_id':'n','shots':[{'segment_id':sid}]}]}]}
        pid=self.db.execute('INSERT INTO projects(name,ai_plan) VALUES (?,?)',('p',json.dumps(plan))).lastrowid
        self.db.execute('INSERT INTO project_media VALUES (?,?)',(pid,mid));self.db.commit()
        self.client.post(f'/api/creative/{pid}/apply')
        analysis.save_segments(mid,[{'time_start':'00:00:01','time_end':'00:00:08','visual':'changed'}])
        saved=json.loads(self.db.execute('SELECT ai_plan FROM projects WHERE id=?',(pid,)).fetchone()[0])
        shot=saved['acts'][0]['narratives'][0]['shots'][0]
        self.assertIsNone(shot['segment_id'])
        self.assertEqual(creative._parse_time(shot['source']['time_start']),0)
        self.assertEqual(self.client.post(f'/api/creative/{pid}/apply').status_code,200)
        track=self.db.execute("SELECT * FROM project_tracks WHERE track_type='video'").fetchone()
        self.assertEqual(creative._parse_time(json.loads(track['metadata'])['srcEnd']),5)

    def test_backup_includes_committed_wal_with_active_reader(self):
        import sqlite3
        from flask import Flask
        from backend import db as db_module
        app=Flask('legacy');app.config['DATABASE']=str(self.case/'legacy.db')
        db=sqlite3.connect(app.config['DATABASE']);db.row_factory=sqlite3.Row
        db.executescript(db_module._SCHEMA.replace("('video', 'image', 'audio')","('video', 'image')"))
        db.execute('PRAGMA journal_mode=WAL')
        db.execute("INSERT INTO media(file_path,file_name,media_type) VALUES ('one','one','video')");db.commit()
        db.execute('PRAGMA wal_checkpoint(TRUNCATE)')
        reader=sqlite3.connect(app.config['DATABASE'])
        try:
            reader.execute('BEGIN');reader.execute('SELECT * FROM media').fetchall()
            db.execute("INSERT INTO media(file_path,file_name,media_type) VALUES ('two','two','video')");db.commit()
            db.execute('PRAGMA busy_timeout=50')
            with app.app_context():db_module._migrate(db)
            db.commit()
            with sqlite3.connect(Path(app.config['DATABASE']).with_suffix('.db.bak-music')) as backup:
                self.assertEqual(backup.execute('SELECT COUNT(*) FROM media').fetchone()[0],2)
        finally:reader.close();db.close()

    def test_empty_generated_plan_preserves_previous_and_terminates(self):
        import types
        mid=self.seed();self.segments(mid)
        previous={'acts':[{'act_id':'a','narratives':[]}]}
        pid=self.db.execute('INSERT INTO projects(name,ai_plan) VALUES (?,?)',('p',json.dumps(previous))).lastrowid
        self.db.execute('INSERT INTO project_media VALUES (?,?)',(pid,mid))
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('video_api_key','synthetic-unused')");self.db.commit()
        client=Mock();client.chat.completions.create.return_value=iter([types.SimpleNamespace(choices=[types.SimpleNamespace(delta=types.SimpleNamespace(content='{}'))])])
        class InlineThread:
            def __init__(self,target):self.target=target
            def start(self):self.target()
            def join(self,**kwargs):pass
        with patch('threading.Thread',InlineThread),patch('openai.OpenAI',return_value=client):
            response=self.client.post(f'/api/creative/{pid}/generate',buffered=True)
        self.assertIn(b'event: error',response.data)
        self.assertEqual(json.loads(self.db.execute('SELECT ai_plan FROM projects WHERE id=?',(pid,)).fetchone()[0]),previous)

    def test_concurrent_batch_admits_only_one_worker(self):
        import threading
        from backend.blueprints import analysis
        mid=self.seed(media_type='image')
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('image_engine','local')");self.db.commit()
        barrier=threading.Barrier(2);results=[];errors=[]
        def run():
            try:
                barrier.wait(3)
                with self.app.test_client() as client:results.append(client.post('/api/analysis/batch',json={'ids':[mid]}).json['submitted'])
            except Exception as e:errors.append(e)
        with patch.object(analysis._analysis_pool,'submit') as submit:
            threads=[threading.Thread(target=run) for _ in range(2)]
            for t in threads:t.start()
            for t in threads:t.join(5)
            self.assertFalse(any(t.is_alive() for t in threads))
            self.assertEqual(errors,[]);self.assertEqual(submit.call_count,1)
            self.assertEqual(sum(len(r) for r in results),1)

    def test_invalid_image_worker_keeps_good_analysis(self):
        from backend import analyzer
        from backend.blueprints import analysis
        mid=self.seed(media_type='image');self.segments(mid,'good analysis')
        progress={}
        with patch.object(analysis,'analyze_image',side_effect=lambda *a,**kw:analyzer._parse_image_response('{broken')):
            analysis._process_image(mid,str(self.case/'image.jpg'),'synthetic-unused','model','original',self.app,progress)
        self.assertEqual(progress['step'],'error')
        self.assertEqual(self.db.execute('SELECT visual FROM media_segment WHERE media_id=?',(mid,)).fetchone()[0],'good analysis')
        self.assertEqual(self.db.execute('SELECT analysis_status FROM media WHERE id=?',(mid,)).fetchone()[0],'error')

    def test_delete_rollback_keeps_all_thumbnails(self):
        import sqlite3
        from backend.config import THUMB_DIR
        THUMB_DIR.mkdir(parents=True,exist_ok=True)
        first=THUMB_DIR/'first.jpg';second=THUMB_DIR/'second.jpg';first.write_bytes(b'one');second.write_bytes(b'two')
        a=self.seed(self.case/'a.mov',thumbnail_path=first.name);b=self.seed(self.case/'b.mov',thumbnail_path=second.name)
        self.db.execute(f"CREATE TRIGGER fail_delete BEFORE DELETE ON media WHEN OLD.id={b} BEGIN SELECT RAISE(ABORT,'fixture failure'); END");self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):self.client.post('/api/library/batch',json={'ids':[a,b],'action':'delete'})
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media').fetchone()[0],2)
        self.assertTrue(first.exists() and second.exists())

    def test_xmp_real_merge_preserves_existing_keywords(self):
        import shutil,subprocess
        from PIL import Image
        if not shutil.which('exiftool'):self.skipTest('exiftool unavailable')
        photo=self.case/'photo.jpg';Image.new('RGB',(16,16)).save(photo)
        self.assertTrue(xmp_writer.write_xmp(photo,tags=['old'],description='Original'))
        self.assertTrue(xmp_writer.write_xmp(photo,tags=['new'],description='Additional'))
        data=json.loads(subprocess.run(['exiftool','-json','-XMP-dc:Subject','-XMP-dc:Description',str(photo.with_suffix('.xmp'))],capture_output=True,text=True,check=True).stdout)[0]
        self.assertEqual(set(data['Subject']),{'old','new'})
        self.assertIn('Original',data['Description']);self.assertIn('Additional',data['Description'])

    def test_legacy_fts_migration_creates_one_row_per_media(self):
        import sqlite3
        from flask import Flask
        from backend import db as module
        app=Flask('legacyfts');app.config['DATABASE']=str(self.case/'fts.db')
        db=sqlite3.connect(app.config['DATABASE']);db.row_factory=sqlite3.Row
        try:
            db.executescript(module._SCHEMA.replace('asr','dialogue'))
            db.execute("INSERT INTO media(file_path,file_name,media_type) VALUES ('one','公园小猫.mov','video')")
            db.executemany("INSERT INTO media_segment(media_id,time_start,time_end,visual,seq) VALUES (1,?,?,?,?)", [('0:00','0:05','forest one',0),('0:05','0:10','forest two',1)]);db.commit()
            with app.app_context():module._migrate(db)
            db.commit();self.assertEqual(db.execute('SELECT COUNT(*) FROM media_fts WHERE media_id=1').fetchone()[0],1)
        finally:db.close()

    def test_paired_save_failure_rolls_back_plan_and_tracks(self):
        import sqlite3
        pid=self.db.execute("INSERT INTO projects(name,ai_plan) VALUES ('p','{\"acts\":[]}')").lastrowid
        self.db.execute("INSERT INTO project_tracks(project_id,track_type,content) VALUES (?,'theme','keep')",(pid,));self.db.commit()
        with self.assertRaises(sqlite3.IntegrityError):
            self.client.put(f'/api/workbench/{pid}/tracks',json={'tracks':[{'track_type':'invalid'}],'plan':{'acts':[{'title':'bad'}]}})
        self.assertEqual(self.db.execute('SELECT content FROM project_tracks WHERE project_id=?',(pid,)).fetchone()[0],'keep')
        self.assertEqual(json.loads(self.db.execute('SELECT ai_plan FROM projects WHERE id=?',(pid,)).fetchone()[0]),{'acts':[]})

    def test_partial_export_contains_warnings(self):
        import io,zipfile
        mid=self.seed()
        video=self.case/'readable.mov';video.write_bytes(b'fixture')
        readable=self.seed(video)
        pid=self.db.execute("INSERT INTO projects(name) VALUES ('mixed')").lastrowid
        for m in (mid,readable):
            self.db.execute('INSERT INTO project_media VALUES (?,?)',(pid,m))
            self.db.execute("INSERT INTO project_tracks(project_id,track_type,time_start,time_end,metadata) VALUES (?,'video','0:00','0:05',?)",(pid,json.dumps({'srcMediaId':m,'srcStart':'0:00','srcEnd':'0:05'})))
        self.db.commit()
        with patch('backend.fcpxml_export._probe_dims',return_value=(128,72)):
            response=self.client.get(f'/api/workbench/{pid}/export-fcpxml')
        self.assertEqual(response.status_code,200)
        self.assertEqual(response.headers['X-Export-Warning-Count'],'1')
        with zipfile.ZipFile(io.BytesIO(response.data)) as archive:self.assertIn('warnings.txt',archive.namelist())

    def test_backfill_failure_keeps_previous_cache_files(self):
        from backend.services import importer
        from backend.config import THUMB_DIR
        THUMB_DIR.mkdir(parents=True,exist_ok=True)
        originals=[]
        for index in (1,2):
            source=self.case/f'{index}.mov';source.write_bytes(b'synthetic')
            old=THUMB_DIR/f'old-{index}.jpg';old.write_bytes(b'old');originals.append(old)
            self.seed(source,thumbnail_path=old.name)
        generated=THUMB_DIR/'new.jpg';generated.write_bytes(b'new')
        with patch.object(importer,'_generate_thumbnail',side_effect=[generated.name,RuntimeError('fixture failure')]):
            with self.assertRaises(RuntimeError):self.client.post('/api/library/backfill-thumbnails?force=1')
        self.db.rollback()
        self.assertTrue(all(p.exists() for p in originals))
        self.assertEqual([r[0] for r in self.db.execute('SELECT thumbnail_path FROM media ORDER BY id')],[p.name for p in originals])

    def test_successful_empty_sync_only_removes_its_literal_folder(self):
        folder=self.case/'trip_1';folder.mkdir()
        self.seed(folder/'gone.mov')
        unrelated=self.seed(self.case/'tripX1'/'keep.mov')
        response=self.client.post('/api/library/sync-folder',json={'path':str(folder)},buffered=True)
        self.assertEqual(response.status_code,200)
        self.assertEqual([r[0] for r in self.db.execute('SELECT id FROM media')],[unrelated])
