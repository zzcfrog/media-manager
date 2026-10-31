"""People task intent, cancellation and background isolation with synthetic libraries."""
from support import DatabaseCase
import importlib
from unittest.mock import patch
import unittest

try:
    jobs=importlib.import_module('backend.services.people_jobs')
except ModuleNotFoundError:
    jobs=None


class PeopleJobTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.assertIsNotNone(jobs,'People task queue is not implemented')
        from backend.services import people
        people.init_schema(self.db);jobs.init_schema(self.db);self.db.commit()
        from backend.blueprints.people import bp
        self.app.register_blueprint(bp,url_prefix='/api/people')

    def observation(self):
        return {'sample_key':'image:0','bbox':[.2,.2,.3,.4],'feature':[1.,0.],
                'quality':.9,'score':.9,'frame_time':None}

    def test_jobs_schema_order_and_audio_is_not_enqueued(self):
        self.assertEqual([r[1] for r in self.db.execute('PRAGMA table_info(people_jobs)')][-2:],['created_at','updated_at'])
        mid=self.seed(media_type='audio')
        self.assertIsNone(jobs.enqueue(self.db,mid))

    def test_intent_is_idempotent_and_does_not_load_models(self):
        mid=self.seed(media_type='image')
        with patch('backend.services.face_engine.load_engine',side_effect=AssertionError('inference in enqueue')):
            jid=jobs.enqueue(self.db,mid);self.assertEqual(jobs.enqueue(self.db,mid),jid)
        self.db.commit();self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],1)

    def test_cancelled_late_result_cannot_create_people(self):
        mid=self.seed(media_type='image');jobs.enqueue(self.db,mid);self.db.commit();job=jobs.claim(self.db)
        def infer(db,j):
            jobs.control(db,'cancel');db.commit()
            return {'model_key':'synthetic','observations':[self.observation()],'scope':'image_preview'}
        self.assertFalse(jobs.process(self.db,job,infer))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_faces').fetchone()[0],0)

    def test_input_changed_or_model_setting_changed_discards_late_result(self):
        for column in ('file_size','model'):
            mid=self.seed(self.case/(column+'.jpg'),media_type='image')
            jobs.enqueue(self.db,mid);self.db.commit();job=jobs.claim(self.db)
            def infer(db,j):
                if column=='file_size':db.execute('UPDATE media SET file_size=12345 WHERE id=?',(mid,))
                else:db.execute("INSERT OR REPLACE INTO settings VALUES ('people_profile','raccoon_s')")
                db.commit()
                return {'model_key':'synthetic','observations':[self.observation()],'scope':'image_preview'}
            self.assertFalse(jobs.process(self.db,job,infer))
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_faces WHERE media_id=?',(mid,)).fetchone()[0],0)

    def test_completed_empty_and_low_quality_are_distinct(self):
        for state,obs,scope in [('no_faces',[],'image_preview'),('quality_insufficient',[],'image_preview_lowres'),
                                ('done',[self.observation()],'image_preview')]:
            mid=self.seed(self.case/(state+'.jpg'),media_type='image');jobs.enqueue(self.db,mid);self.db.commit();job=jobs.claim(self.db)
            self.assertTrue(jobs.process(self.db,job,lambda db,j:{'model_key':'s','observations':obs,'scope':scope}))
            self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(job['id'],)).fetchone()[0],state)

    def test_pause_resume_and_expired_leases_survive_restart(self):
        mid=self.seed(media_type='image');jid=jobs.enqueue(self.db,mid);self.db.commit()
        first=jobs.claim(self.db);jobs.control(self.db,'pause');self.db.commit()
        self.assertIsNone(jobs.claim(self.db));jobs.control(self.db,'resume');self.db.commit()
        next_job=jobs.claim(self.db);self.assertNotEqual(first['lease'],next_job['lease'])
        self.db.execute('UPDATE people_jobs SET lease_until=0 WHERE id=?',(jid,));self.db.commit()
        reclaimed=jobs.claim(self.db);self.assertNotEqual(next_job['lease'],reclaimed['lease'])

    def test_whole_scan_results_written_atomically_and_manual_survives(self):
        from backend.services import people
        mid=self.seed(media_type='image');jid=jobs.enqueue(self.db,mid);self.db.commit()
        job=jobs.claim(self.db);payload={'model_key':'s','observations':[self.observation()],'scope':'image_preview'}
        self.assertTrue(jobs.process(self.db,job,lambda db,j:payload))
        face=self.db.execute('SELECT id FROM people_faces').fetchone()[0]
        people.decide_faces(self.db,[face],'new',name='小林');self.db.commit()
        jobs.enqueue(self.db,mid,force=True);self.db.commit();job=jobs.claim(self.db)
        jobs.process(self.db,job,lambda db,j:payload)
        self.assertEqual(self.db.execute('SELECT assignment FROM people_faces WHERE id=?',(face,)).fetchone()[0],'manual')
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])

    def test_deleted_media_late_result_is_discarded(self):
        mid=self.seed(media_type='image');jobs.enqueue(self.db,mid);self.db.commit();job=jobs.claim(self.db)
        def infer(db,j):
            db.execute('DELETE FROM media WHERE id=?',(mid,));db.commit()
            return {'model_key':'s','observations':[self.observation()],'scope':'image_preview'}
        self.assertFalse(jobs.process(self.db,job,infer))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_persons').fetchone()[0],0)

    def test_replaced_original_is_not_matched_to_old_manual_faces(self):
        source=self.case/'replaced.jpg';source.write_bytes(b'original')
        mid=self.seed(source,media_type='image',file_size=source.stat().st_size,file_mtime=source.stat().st_mtime)
        jobs.enqueue(self.db,mid);self.db.commit();job=jobs.claim(self.db)
        source.write_bytes(b'new different source')
        with patch.object(jobs,'infer',side_effect=AssertionError('must not scan replacement under old revision')):
            self.assertFalse(jobs.process(self.db,job))
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(job['id'],)).fetchone()[0],'stale')

    def test_settings_do_not_scan_and_scope_requires_explicit_all(self):
        self.seed(media_type='image')
        response=self.client.patch('/api/people/settings',json={'enabled':True,'model_dir':'','profile':'buffalo_l','max_frames':24})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)
        self.assertEqual(self.client.post('/api/people/jobs',json={'scope':'all'}).status_code,409)
        response=self.client.post('/api/people/jobs',json={'scope':'all','confirm_all':True})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(response.json['queued'],1)
        self.assertEqual(self.client.get('/api/people/status').status_code,200)

    def test_unknown_or_invalid_settings_and_scope_rejected(self):
        for data in ({'enabled':'false'},{'profile':'remote'},{'max_frames':500},{'model_dir':'relative'}):
            self.assertEqual(self.client.patch('/api/people/settings',json=data).status_code,409)
        for data in ({'scope':'selected','media_ids':[]},{'scope':'folder','folder':''},{'scope':'what'}):
            self.assertEqual(self.client.post('/api/people/jobs',json=data).status_code,409)

    def test_worker_runs_explicit_queue_even_when_new_import_automation_is_off(self):
        mid=self.seed(media_type='image');jobs.enqueue(self.db,mid);self.db.commit()
        self.app.config['TESTING']=False
        payload={'model_key':'s','observations':[self.observation()],'scope':'image_preview'}
        with patch.object(jobs,'infer',return_value=payload):
            jobs.ensure_worker(self.app)
            with jobs._workers_lock:thread=jobs._workers.get(self.app.config['DATABASE'])
            if thread:thread.join(3)
        self.app.config['TESTING']=True
        self.assertFalse(thread and thread.is_alive())
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE media_id=?',(mid,)).fetchone()[0],'done')

    def test_background_worker_yields_when_foreground_starts_mid_scan(self):
        mid=self.seed(media_type='image');jobs.enqueue(self.db,mid);self.db.commit();job=jobs.claim(self.db)
        job['_background']=True
        def infer(db,j):
            with patch('backend.services.classification_jobs.busy',return_value=True):
                self.assertTrue(j['_cancelled']())
            return {'model_key':'s','observations':[self.observation()],'scope':'image_preview'}
        with patch('backend.services.classification_jobs.busy',return_value=False):
            self.assertFalse(jobs.process(self.db,job,infer))
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(job['id'],)).fetchone()[0],'queued')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_faces').fetchone()[0],0)

    def test_rescans_reuse_identical_crops_without_leaking_or_deleting_live_cache(self):
        from types import SimpleNamespace
        from PIL import Image
        from backend.services import face_engine
        mid=self.seed(media_type='image')
        model=SimpleNamespace(info={'key':'synthetic'},observe=lambda *args:[{**self.observation(),'crop':Image.new('RGB',(112,112),'green')}])
        with patch.object(face_engine,'load_engine',return_value=model),patch.object(face_engine,'read_frames',return_value=([(None,Image.new('RGB',(600,400),'gray'))],'image_preview')):
            for _ in range(3):
                jobs.enqueue(self.db,mid,force=True);self.db.commit();self.assertTrue(jobs.process(self.db,jobs.claim(self.db)))
            cache=self.case/'people-cache'
            self.assertEqual(len(list(cache.glob('*.jpg'))),1)
            jobs.enqueue(self.db,mid,force=True);self.db.commit();job=jobs.claim(self.db)
            def late(db,j):
                payload=jobs.infer(db,j);jobs.control(db,'cancel');db.commit();return payload
            self.assertFalse(jobs.process(self.db,job,late))
            self.assertEqual(len(list(cache.glob('*.jpg'))),1)
            self.assertTrue((cache/self.db.execute('SELECT crop_path FROM people_faces').fetchone()[0]).is_file())

    def test_fps_corrections_invalidate_observations_and_completed_sampling_jobs(self):
        mid=self.seed(media_type='video',duration=10,fps='1/1')
        jobs.enqueue(self.db,mid);self.db.commit();job=jobs.claim(self.db)
        def late(db,j):
            db.execute("UPDATE media SET fps='30/1' WHERE id=?",(mid,));db.commit()
            return {'model_key':'s','observations':[],'scope':'sampled_video'}
        self.assertFalse(jobs.process(self.db,job,late))
        second=jobs.enqueue(self.db,mid);self.db.commit();new_job=jobs.claim(self.db)
        self.assertTrue(jobs.process(self.db,new_job,lambda db,j:{'model_key':'s','observations':[],'scope':'sampled_video'}))
        self.db.execute("UPDATE media SET fps='60/1' WHERE id=?",(mid,));self.db.commit()
        self.assertNotEqual(jobs.enqueue(self.db,mid),second)


if __name__=='__main__':unittest.main()
