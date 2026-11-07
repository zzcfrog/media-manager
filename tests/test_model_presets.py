from support import DatabaseCase
from unittest.mock import patch

from backend.blueprints import people
from backend.services import importer, people_jobs


class ModelPresetTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.app.register_blueprint(people.bp,url_prefix='/api/people')

    def prepared(self,name,kind):
        path=self.case/name;path.write_bytes(b'synthetic media')
        return {'file_path':str(path),'file_name':name,'media_type':kind,
                'file_size':path.stat().st_size,'file_mtime':path.stat().st_mtime,'_classification_batch':'synthetic-batch'}

    def test_face_presets_have_manufacturer_and_profile_specific_verification_defaults(self):
        packs=self.client.get('/api/people/models/catalog').json['packs']
        self.assertEqual(len(packs),6);self.assertTrue(all(p['manufacturer']=='InsightFace' for p in packs))
        for profile,enabled in [('raccoon_s',True),('buffalo_m',False),('raccoon_l',True),('buffalo_l',False)]:
            result=people_jobs.configure(self.db,{'profile':profile});self.db.commit()
            self.assertEqual(result['verify_enabled'],enabled)
        result=people_jobs.configure(self.db,{'profile':'raccoon_s','verify_enabled':False})
        self.db.commit();self.assertFalse(result['verify_enabled'])
        self.assertEqual(self.client.patch('/api/people/settings',json={'profile':'custom'}).status_code,409)

    def test_legacy_custom_configuration_remains_readable_without_silently_rewriting_data(self):
        self.db.execute("INSERT INTO settings(key,value) VALUES ('people_profile','custom')");self.db.commit()
        self.assertEqual(people_jobs.settings(self.db)['profile'],'custom')
        self.assertEqual(people_jobs.configure(self.db,{'video_fps':2})['profile'],'custom')

    def test_classification_is_per_import_and_ignores_the_old_global_switch(self):
        self.db.execute("INSERT INTO settings(key,value) VALUES ('classification_enabled','true')");self.db.commit()
        with patch('backend.services.classification_jobs.ensure_worker'),patch('backend.services.people_jobs.ensure_worker'):
            importer._save_import(self.db,self.prepared('unchecked.jpg','image'),None,classify_media=False)
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_jobs').fetchone()[0],0)
            for name,kind in [('checked.jpg','image'),('checked.mp4','video'),('checked.wav','audio')]:
                importer._save_import(self.db,self.prepared(name,kind),None,classify_media=True)
        rows=self.db.execute('SELECT media_type,batch_id FROM taxonomy_jobs JOIN media ON media.id=taxonomy_jobs.media_id JOIN taxonomy_job_context ON job_id=taxonomy_jobs.id ORDER BY media_type').fetchall()
        self.assertEqual([r[0] for r in rows],['image']);self.assertTrue(all(r[1]=='synthetic-batch' for r in rows))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)

    def test_import_option_validation_and_intent_failure_are_atomic(self):
        for route,payload in [('/api/library/import-one',{'path':'missing.jpg'}),('/api/library/import-batch',{'paths':['missing.jpg']})]:
            for value in ('true',None,1,[]):
                self.assertEqual(self.client.post(route,json={**payload,'classify_media':value}).status_code,400)
        with patch('backend.services.classification_jobs.enqueue',side_effect=RuntimeError('synthetic intent failure')):
            with self.assertRaises(RuntimeError):importer._save_import(self.db,self.prepared('rollback.jpg','image'),None,classify_media=True)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media').fetchone()[0],0)

    def test_single_file_endpoint_classifies_only_when_checked_and_deduplicates_reimports(self):
        with patch('backend.services.classification_jobs.ensure_worker'),patch('backend.services.people_jobs.ensure_worker'):
            for name,checked in [('plain.jpg',False),('tagged.jpg',True)]:
                prepared=self.prepared(name,'image')
                with patch.object(importer,'_prepare_import',return_value=prepared):
                    response=self.client.post('/api/library/import-one',json={'path':prepared['file_path'],'classify_media':checked})
                    self.assertEqual(response.status_code,200,response.json)
            path=self.case/'tagged.jpg'
            response=self.client.post('/api/library/import-one',json={'path':str(path),'classify_media':True})
            self.assertEqual(response.status_code,200,response.json)
        rows=self.db.execute('SELECT file_name FROM taxonomy_jobs JOIN media ON media.id=media_id').fetchall()
        self.assertEqual([row[0] for row in rows],['tagged.jpg'])
