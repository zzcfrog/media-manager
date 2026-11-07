from support import DatabaseCase
from unittest.mock import patch

from backend.blueprints import people, settings
from backend.services import people_jobs, classification_jobs, taxonomy, taxonomy_relations, importer


class OptionalModelTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.app.register_blueprint(people.bp,url_prefix='/api/people')
        self.app.register_blueprint(settings.bp,url_prefix='/api/settings')
        self.enterContext(patch('backend.services.classification_jobs.ensure_worker'))

    def set(self,key,value):
        self.db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)',(key,value));self.db.commit()

    def test_disabled_analysis_never_submits_single_or_batch_jobs_and_preserves_media(self):
        ids=[]
        for kind,key in [('image','image'),('video','video'),('audio','music')]:
            ids.append(self.seed(self.case/(kind+'.fixture'),media_type=kind));self.set(key+'_analysis_enabled','false')
        with patch('backend.blueprints.analysis._analysis_pool.submit') as submit:
            for mid in ids:self.assertEqual(self.client.post('/api/analysis/'+str(mid),json={}).status_code,409)
            result=self.client.post('/api/analysis/batch',json={'ids':ids})
            self.assertEqual(result.status_code,200,result.json);self.assertEqual(result.json['submitted'],[]);submit.assert_not_called()
        self.assertEqual([r[0] for r in self.db.execute('SELECT analysis_status FROM media')],['none']*3)

    def test_none_music_model_cannot_fall_back_and_none_asr_does_not_reload(self):
        mid=self.seed(media_type='audio');self.set('music_model','none')
        with patch('backend.blueprints.analysis._analysis_pool.submit') as submit,patch('backend.blueprints.analysis.reload_engine') as reload:
            self.assertEqual(self.client.post('/api/analysis/'+str(mid),json={}).status_code,409)
            self.assertEqual(self.client.post('/api/analysis/asr-reload',json={'asr_model':'none'}).status_code,200)
            submit.assert_not_called();reload.assert_not_called()

    def test_face_opt_out_pauses_work_without_deleting_results_and_reenables_it(self):
        mid=self.seed(media_type='image');jid=people_jobs.enqueue(self.db,mid);self.db.commit()
        job=people_jobs.claim(self.db)
        result=self.client.patch('/api/people/settings',json={'model_enabled':False});self.assertEqual(result.status_code,200,result.json)
        self.assertFalse(result.json['model_enabled']);self.assertIsNone(people_jobs.enqueue(self.db,mid));self.assertIsNone(people_jobs.claim(self.db))
        with patch('backend.services.people_jobs.infer') as infer:
            self.assertFalse(people_jobs.process(self.db,job));infer.assert_not_called()
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(jid,)).fetchone()[0],'paused')
        self.assertEqual(self.client.post('/api/people/jobs',json={'scope':'all','confirm_all':True}).status_code,409)
        result=self.client.patch('/api/people/settings',json={'model_enabled':True});self.assertEqual(result.status_code,200,result.json)
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?',(jid,)).fetchone()[0],'queued')

    def test_fast_classifier_opt_out_blocks_enqueue_claim_and_inference(self):
        mid=self.seed(media_type='image');jid=classification_jobs.enqueue(self.db,mid,'fast');self.db.commit()
        job=classification_jobs.claim(self.db)
        result=self.client.patch('/api/taxonomy/configuration',json={'classification_model_enabled':'false'});self.assertEqual(result.status_code,200,result.json)
        with patch('backend.services.semantic_classifier._load_bundle') as load:
            self.assertFalse(classification_jobs.process(self.db,job));load.assert_not_called()
        self.assertIsNone(classification_jobs.enqueue(self.db,mid,'fast'));self.assertIsNone(classification_jobs.claim(self.db))
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_jobs WHERE id=?',(jid,)).fetchone()[0],'paused')
        self.client.patch('/api/taxonomy/configuration',json={'classification_model_enabled':'true'})
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_jobs WHERE id=?',(jid,)).fetchone()[0],'queued')

    def test_none_shared_omni_stops_both_refinement_and_vocabulary_without_loading_a_model(self):
        mid=self.seed(media_type='image');node=taxonomy.create_node(self.db,'合成标签');jid=taxonomy_relations.queue(self.db,node['id'],explicit=True);self.db.commit()
        result=self.client.patch('/api/taxonomy/configuration',json={'classification_omni_model':'none'});self.assertEqual(result.status_code,200,result.json)
        self.assertIsNone(classification_jobs.enqueue(self.db,mid,'omni'));self.assertIsNone(taxonomy_relations.queue(self.db,node['id'],explicit=True))
        self.assertEqual(self.client.post('/api/taxonomy/relationships/organize',json={'tag_ids':[node['id']]}).status_code,409)
        with patch('backend.local_vlm.acquire_engine') as acquire:
            self.assertFalse(taxonomy_relations.process_next(self.db));acquire.assert_not_called()
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(jid,)).fetchone()[0],'paused')

    def test_import_checked_options_do_not_queue_features_whose_model_is_disabled(self):
        self.client.patch('/api/people/settings',json={'model_enabled':False})
        self.client.patch('/api/taxonomy/configuration',json={'classification_model_enabled':'false'})
        path=self.case/'synthetic.jpg';path.write_bytes(b'synthetic media')
        data={'file_path':str(path),'file_name':path.name,'media_type':'image','file_size':path.stat().st_size,'file_mtime':path.stat().st_mtime}
        with patch('backend.services.people_jobs.ensure_worker'),patch('backend.services.classification_jobs.ensure_worker'):
            importer._save_import(self.db,data,None,organize_people=True,classify_media=True)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media').fetchone()[0],1)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_jobs').fetchone()[0],0)

    def test_new_disabled_flags_validate_before_any_write(self):
        for route,payload in [('/api/people/settings',{'model_enabled':'false'}),('/api/taxonomy/configuration',{'classification_model_enabled':False})]:
            self.assertEqual(self.client.patch(route,json=payload).status_code,409)
        before=[tuple(r) for r in self.db.execute('SELECT key,value FROM settings ORDER BY key')]
        result=self.client.post('/api/settings/',json={'image_analysis_enabled':'invalid','image_model':'changed'})
        self.assertEqual(result.status_code,400);self.assertEqual([tuple(r) for r in self.db.execute('SELECT key,value FROM settings ORDER BY key')],before)

    def test_import_options_expose_only_enabled_states_and_reflect_saved_opt_outs(self):
        result=self.client.get('/api/library/import-options');self.assertEqual(result.status_code,200)
        self.assertEqual(result.json,{'classification_enabled':True,'people_enabled':True})
        self.set('people_model_enabled','false');self.set('classification_model_enabled','false')
        self.assertEqual(self.client.get('/api/library/import-options').json,{'classification_enabled':False,'people_enabled':False})
