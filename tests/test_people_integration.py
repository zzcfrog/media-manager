"""People hooks respect import transactions and existing media browsing."""
from support import DatabaseCase
from unittest.mock import patch
from backend.services import people, people_jobs


class PeopleIntegrationTests(DatabaseCase):
    def register_people(self):
        from backend.blueprints.people import bp
        if 'people' not in self.app.blueprints:self.app.register_blueprint(bp,url_prefix='/api/people')

    def test_fresh_library_initializes_people_without_scanning(self):
        names={r[0] for r in self.db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
        self.assertTrue(set(people.TABLES)|{'people_jobs'}<=names)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)

    def test_people_filter_any_all_exclude_combines_tags_and_favorites(self):
        people.init_schema(self.db);people_jobs.init_schema(self.db)
        a=people.create_person(self.db,'A');b=people.create_person(self.db,'B')
        one=self.seed(self.case/'A.jpg',media_type='image',favorite=1)
        two=self.seed(self.case/'B.jpg',media_type='image',favorite=0)
        people.decide_media(self.db,[one,two],a['id'],'include');people.decide_media(self.db,[one],b['id'],'include');self.db.commit()
        def query(**params):
            r=self.client.get('/api/library/',query_string=params)
            self.assertEqual(r.status_code,200,r.json)
            return r.json['data']
        self.assertEqual({m['id'] for m in query(person_ids=f"{a['id']},{b['id']}",person_mode='all')},{one})
        self.assertEqual({m['id'] for m in query(person_ids=str(a['id']),exclude_person_ids=str(b['id']))},{two})
        self.assertEqual({m['id'] for m in query(person_ids=str(a['id']),favorite='true')},{one})
        self.assertEqual(query(person_ids=str(b['id']))[0]['person_count'],2)
        for value in ('oops','0','999999'):
            self.assertEqual(self.client.get('/api/library/',query_string={'person_ids':value}).status_code,409)

    def test_import_intent_and_media_share_commit_and_no_model_calls(self):
        from backend.services import importer
        path=self.case/'new.jpg';path.write_bytes(b'synthetic')
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('people_enabled','true')");self.db.commit()
        prepared={'file_path':str(path),'file_name':path.name,'media_type':'image','file_size':path.stat().st_size,'file_mtime':path.stat().st_mtime}
        with patch('backend.services.people_jobs.enqueue',side_effect=RuntimeError('synthetic intent failure')):
            with self.assertRaises(RuntimeError):importer._save_import(self.db,prepared,None)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media').fetchone()[0],0)
        with patch('backend.services.people_jobs.ensure_worker'),patch('backend.services.face_engine.load_engine',side_effect=AssertionError('in import')):
            result=importer._save_import(self.db,prepared,None)
        self.assertEqual(self.db.execute('SELECT media_id FROM people_jobs').fetchone()[0],result['id'])

    def test_skip_done_analysis_can_queue_people_without_reanalyzing(self):
        mid=self.seed(media_type='image',analysis_status='done')
        with patch('backend.blueprints.analysis._analysis_pool.submit') as submit,patch('backend.services.people_jobs.ensure_worker'):
            r=self.client.post('/api/analysis/batch',json={'ids':[mid],'skip_done':True,'organize_people':True})
        self.assertEqual(r.status_code,200,r.json);submit.assert_not_called()
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],1)

    def test_export_restore_preserves_names_exclusions_and_relative_crops(self):
        import sqlite3
        import shutil
        from backend.storage import export_library,restore_library,database_fingerprint,snapshot_database
        from PIL import Image
        mid=self.seed(self.case/'offline.jpg',media_type='image')
        cache=self.case/'people-cache';cache.mkdir();Image.new('RGB',(112,112),'green').save(cache/'face.jpg')
        face=people.record_observations(self.db,mid,'revision','model',[{'sample_key':'one','bbox':[.1,.1,.4,.4],
              'feature':[1.,0.],'quality':.9,'score':.99,'crop_path':'face.jpg'}])['faces'][0]
        p=people.get_person(self.db,face['person_id'])
        people.update_person(self.db,p['id'],{'name':'小林'},p['version'])
        other=people.create_person(self.db,'另一位');people.decide_faces(self.db,[face['id']],'move',other['id'])
        self.db.commit()
        library=self.case/'portable-source';library.mkdir()
        snapshot_database(self.app.config['DATABASE'],library/'media.db')
        shutil.copytree(cache,library/'people-cache')
        exported=self.case/'export';restored=self.case/'restored'
        export_library(library,exported);restore_library(exported,restored)
        self.assertEqual(database_fingerprint(library/'media.db'),database_fingerprint(restored/'media.db'))
        with sqlite3.connect(restored/'media.db') as db:
            self.assertEqual(db.execute('SELECT name FROM people_persons WHERE id=?',(p['id'],)).fetchone()[0],'小林')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM people_face_exclusions').fetchone()[0],1)
        self.assertTrue((restored/'people-cache'/'face.jpg').is_file())

    def test_review_and_cover_pagination_reaches_all_items_without_vectors(self):
        self.register_people()
        a=people.create_person(self.db,'A');b=people.create_person(self.db,'B')
        for i in range(205):
            self.db.execute("INSERT INTO people_reviews(kind,left_id,right_id,source_key) VALUES ('merge',?,?,?)",(a['id'],b['id'],str(i)))
        mid=self.seed(media_type='image')
        observations=[{'sample_key':str(i),'frame_time':float(i),'bbox':[.1,.1,.3,.4],
                       'feature':[1.,0.],'quality':.9,'score':.9} for i in range(65)]
        faces=people.record_observations(self.db,mid,'revision','model',observations)['faces']
        people.decide_faces(self.db,[f['id'] for f in faces],'move',a['id']);self.db.commit()
        first=self.client.get('/api/people/reviews?kind=merge&page=1&per_page=40')
        last=self.client.get('/api/people/reviews?kind=merge&page=6&per_page=40')
        self.assertEqual(first.status_code,200,first.json)
        self.assertEqual(first.json['pagination']['total'],205)
        self.assertEqual(len(first.json['data']),40);self.assertEqual(len(last.json['data']),5)
        self.assertNotEqual(first.json['data'][0]['id'],last.json['data'][0]['id'])
        one=self.client.get(f"/api/people/persons/{a['id']}/faces?per_page=60&page=1")
        two=self.client.get(f"/api/people/persons/{a['id']}/faces?per_page=60&page=2")
        self.assertEqual(one.status_code,200,one.json);self.assertEqual(two.status_code,200,two.json)
        self.assertEqual(len(one.json['data']),60);self.assertEqual(len(two.json['data']),5)
        self.assertNotIn('feature',one.json['data'][0])
        for query in ('page=0','page=bad','per_page=500'):
            self.assertEqual(self.client.get('/api/people/reviews?'+query).status_code,409)
