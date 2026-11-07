"""Classification invariants using synthetic libraries, without model calls."""
from support import DatabaseCase
import unittest

from backend.services import taxonomy as tx


class TaxonomyTests(DatabaseCase):
    def make(self, name, parent_id=None):
        return tx.create_node(self.db, name, parent_id=parent_id)

    def test_new_table_order_and_legacy_identity(self):
        tag = self.db.execute("INSERT INTO tags(name) VALUES ('legacy')").lastrowid
        mid = self.seed()
        self.db.execute('INSERT INTO media_tags VALUES (?,?)', (mid, tag))
        self.db.commit()
        tx.init_schema(self.db)
        tx.init_schema(self.db)
        self.assertEqual(tx.get_node(self.db, tag)['name'], 'legacy')
        self.assertEqual(tx.summaries(self.db, [mid])[mid], 1)
        for name in tx.TABLES:
            columns = [r[1] for r in self.db.execute(f'PRAGMA table_info({name})')]
            self.assertEqual(columns[-2:], ['created_at', 'updated_at'])
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_depth_cycle_and_scoped_names(self):
        a = self.make('主体'); b = self.make('品牌')
        x = self.make('苹果', a['id']); y = self.make('苹果', b['id'])
        self.assertNotEqual(x['id'], y['id'])
        self.assertEqual(len(tx.resolve(self.db, '苹果')), 2)
        c = self.make('三级', x['id']); d = self.make('四级', c['id'])
        with self.assertRaises(tx.Conflict): self.make('五级', d['id'])
        with self.assertRaises(tx.Conflict):
            tx.update_node(self.db, a['id'], {'parent_id': d['id']}, a['version'])
        self.assertIsNone(tx.get_node(self.db, a['id'])['parent_id'])

    def test_alias_ambiguity_and_manual_protection(self):
        a = self.make('自行车'); b = self.make('电动自行车')
        tx.add_expression(self.db, a['id'], '单车')
        self.assertEqual(tx.resolve(self.db, '单车')[0]['id'], a['id'])
        tx.add_expression(self.db, b['id'], '单车')
        self.assertEqual(len(tx.resolve(self.db, '单车')), 2)
        mid = self.seed()
        tx.decide(self.db, [mid], a['id'], 'confirm')
        tx.decide(self.db, [mid], a['id'], 'exclude')
        self.assertFalse(tx.add_automatic(self.db, mid, a['id'], 'test', validated=True))
        self.assertEqual(tx.summaries(self.db, [mid])[mid], 0)
        with self.assertRaises(tx.Conflict): tx.decide(self.db, [mid], a['id'], 'confirm')
        tx.decide(self.db, [mid], a['id'], 'confirm', clear_exclusion=True)
        self.assertEqual(tx.summaries(self.db, [mid])[mid], 1)

    def test_parent_exclusion_prevents_indirect_return(self):
        parent = self.make('山地'); child = self.make('雪山', parent['id'])
        mid = self.seed()
        tx.decide(self.db, [mid], child['id'], 'confirm')
        tx.decide(self.db, [mid], parent['id'], 'exclude', scope='subtree')
        self.assertFalse(tx.add_automatic(self.db, mid, child['id'], 'test', validated=True))
        self.assertEqual(tx.summaries(self.db, [mid])[mid], 0)

    def test_filters_any_all_and_temporary_exclusion(self):
        a = self.make('人物'); b = self.make('自行车')
        one = self.seed(self.case/'one.jpg'); two = self.seed(self.case/'two.jpg')
        tx.decide(self.db, [one, two], a['id'], 'confirm')
        tx.decide(self.db, [one], b['id'], 'confirm')
        def query(**params):
            r = self.client.get('/api/library/', query_string=params)
            self.assertEqual(r.status_code, 200, r.json)
            return {x['id'] for x in r.json['data']}
        self.assertEqual(query(tag_ids=f"{a['id']},{b['id']}", tag_mode='all'), {one})
        self.assertEqual(query(tag_ids=f"{a['id']},{b['id']}"), {one,two})
        self.assertEqual(query(tag_ids=str(a['id']), exclude_tag_ids=str(b['id'])), {two})
        self.assertEqual(tx.summaries(self.db, [one])[one], 2)

    def test_merge_preview_atomic_undo_and_stale_plan(self):
        a = self.make('自行车'); b = self.make('单车')
        one = self.seed(self.case/'one.jpg'); two = self.seed(self.case/'two.jpg')
        tx.decide(self.db, [one], a['id'], 'confirm')
        tx.decide(self.db, [one,two], b['id'], 'confirm')
        plan = tx.preview_merge(self.db, [b['id']], a['id'])
        self.assertEqual(plan['media_count'], 2)
        result = tx.apply_plan(self.db, plan)
        self.assertEqual(tx.resolve(self.db, '单车')[0]['id'], a['id'])
        self.assertEqual(tx.summaries(self.db,[one,two]), {one:1,two:1})
        tx.undo(self.db, result['change_id'])
        self.assertEqual(tx.summaries(self.db,[one,two]), {one:2,two:1})
        plan = tx.preview_merge(self.db, [b['id']], a['id'])
        tx.decide(self.db, [two], a['id'], 'confirm')
        with self.assertRaises(tx.Conflict): tx.apply_plan(self.db, plan)

    def test_split_retains_undecided_and_protected_items(self):
        old = self.make('苹果'); fruit = self.make('水果'); brand = self.make('品牌')
        one = self.seed(self.case/'one.jpg'); two = self.seed(self.case/'two.jpg')
        tx.decide(self.db, [one,two], old['id'], 'confirm')
        plan = tx.preview_split(self.db, old['id'], {str(one):[fruit['id'],brand['id']]})
        tx.apply_plan(self.db, plan)
        self.assertEqual(tx.summaries(self.db,[one,two]), {one:2,two:1})
        self.assertEqual(tx.get_node(self.db,old['id'])['status'], 'paused')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media_tags WHERE tag_id=?',(old['id'],)).fetchone()[0],1)

    def test_invalid_saved_query_never_expands_to_all_media(self):
        a = self.make('海边')
        saved = tx.save_collection(self.db, '海边', {'tag_ids':[a['id']], 'tag_mode':'all'})
        self.assertEqual(tx.collection_query(self.db,saved['id'])['tag_ids'], [a['id']])
        for invalid in ({'favorite':'invalid'},{'media_type':'unknown'},{'tag_ids':['oops']},{'include_children':'oops'}):
            with self.assertRaises(tx.Conflict): tx.save_collection(self.db,'invalid',invalid)
        self.db.execute('DELETE FROM tags WHERE id=?',(a['id'],)); self.db.commit()
        with self.assertRaises(tx.Conflict): tx.collection_query(self.db,saved['id'])

    def test_collection_rename_only_preserves_rules_and_rejects_stale_version(self):
        tag=self.make('山川')
        saved=tx.save_collection(self.db,'旧图集',{'tag_ids':[tag['id']],'tag_mode':'all','include_children':False,'favorite':'true'})
        self.db.commit()
        before=dict(self.db.execute('SELECT * FROM taxonomy_collections WHERE id=?',(saved['id'],)).fetchone())
        response=self.client.patch('/api/taxonomy/collections/'+str(saved['id']),json={'name':'  新图集  ','version':before['version']})
        self.assertEqual(response.status_code,200,response.json)
        after=dict(self.db.execute('SELECT * FROM taxonomy_collections WHERE id=?',(saved['id'],)).fetchone())
        self.assertEqual(after['name'],'新图集');self.assertEqual(after['query'],before['query'])
        self.assertEqual(after['version'],before['version']+1)
        response=self.client.patch('/api/taxonomy/collections/'+str(saved['id']),json={'name':'迟到改名','version':before['version']})
        self.assertEqual(response.status_code,409)
        self.assertEqual(self.db.execute('SELECT name FROM taxonomy_collections WHERE id=?',(saved['id'],)).fetchone()[0],'新图集')

    def test_collection_rename_does_not_need_to_revalidate_legacy_rules(self):
        self.db.execute("INSERT INTO taxonomy_collections(name,query) VALUES ('旧图集',?)",('{"future_condition":true}',));self.db.commit()
        saved=self.db.execute('SELECT * FROM taxonomy_collections ORDER BY id DESC LIMIT 1').fetchone()
        response=self.client.patch('/api/taxonomy/collections/'+str(saved['id']),json={'name':'保留规则','version':saved['version']})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(self.db.execute('SELECT query FROM taxonomy_collections WHERE id=?',(saved['id'],)).fetchone()[0],saved['query'])

    def test_collection_rename_rejects_empty_invalid_or_oversized_names(self):
        saved=tx.save_collection(self.db,'原名称',{});self.db.commit()
        for name in ('   ','长'*121,False,[]):
            response=self.client.patch('/api/taxonomy/collections/'+str(saved['id']),json={'name':name,'version':1})
            self.assertEqual(response.status_code,409)
        self.assertEqual(self.db.execute('SELECT name FROM taxonomy_collections WHERE id=?',(saved['id'],)).fetchone()[0],'原名称')


class TaxonomyApiTests(DatabaseCase):
    def test_api_roundtrip_and_failures_are_atomic(self):
        def create(name,parent=None):
            r=self.client.post('/api/taxonomy/nodes',json={'name':name,'parent_id':parent})
            self.assertEqual(r.status_code,201,r.json)
            return r.json
        a=create('自然'); b=create('山地',a['id']); mid=self.seed()
        response=self.client.post('/api/taxonomy/decisions',json={'media_ids':[mid],'tag_id':b['id'],'decision':'confirm'})
        self.assertEqual(response.status_code,200,response.json)
        tree=self.client.get('/api/taxonomy/tree').json['data']
        self.assertEqual(next(n for n in tree if n['id']==a['id'])['total_count'],1)
        self.assertEqual(self.client.get('/api/library/').json['data'][0]['tag_count'],1)
        self.assertEqual(self.client.patch(f"/api/taxonomy/nodes/{a['id']}",json={'name':'changed','version':0}).status_code,409)
        self.assertEqual(tx.get_node(self.db,a['id'])['name'],'自然')
        response=self.client.post('/api/taxonomy/decisions',json={'media_ids':[mid,999],'tag_id':a['id'],'decision':'confirm'})
        self.assertEqual(response.status_code,409)
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)

    def test_mapping_jobs_are_idempotent_and_cancelled_results_do_not_write(self):
        from backend.services import classification_jobs as jobs
        mid=self.seed(); self.segments(mid)
        self.db.execute("UPDATE media_segment SET main_subjects='[\"自行车\"]' WHERE media_id=?",(mid,))
        n=tx.create_node(self.db,'自行车')
        jid=jobs.enqueue(self.db,mid,'analysis'); self.db.commit()
        self.assertEqual(jid,jobs.enqueue(self.db,mid,'analysis'));self.db.commit()
        job=jobs.claim(self.db)
        self.assertTrue(jobs.process(self.db,job))
        self.assertEqual(tx.summaries(self.db,[mid])[mid],0)
        candidate=self.db.execute('SELECT * FROM taxonomy_candidates').fetchone()
        self.assertEqual(candidate['tag_id'],n['id'])
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json={'ids':[candidate['id']],'accept':True}).status_code,200)
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)
        jid=jobs.enqueue(self.db,mid,'fast');self.db.commit();job=jobs.claim(self.db)
        def late(db,j):
            db.execute("UPDATE taxonomy_jobs SET state='cancelled',lease=NULL WHERE id=?",(j['id'],));db.commit()
            return [{'term':'late','evidence':{}}]
        self.assertFalse(jobs.process(self.db,job,infer=late))
        self.assertIsNone(self.db.execute("SELECT 1 FROM taxonomy_candidates WHERE term='late'").fetchone())

    def test_changed_analysis_does_not_accept_old_candidates(self):
        from backend.services import classification_jobs as jobs
        mid=self.seed();self.segments(mid)
        self.db.execute("UPDATE media_segment SET main_subjects='[\"旧标签\"]' WHERE media_id=?",(mid,))
        node=tx.create_node(self.db,'旧标签');jobs.enqueue(self.db,mid,'analysis');self.db.commit()
        jobs.process(self.db,jobs.claim(self.db))
        candidate=self.db.execute('SELECT id FROM taxonomy_candidates').fetchone()[0]
        self.db.execute("UPDATE media_segment SET main_subjects='[\"新标签\"]' WHERE media_id=?",(mid,));self.db.commit()
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json={'ids':[candidate],'accept':True}).status_code,409)
        self.assertEqual(tx.summaries(self.db,[mid])[mid],0)

    def test_skip_done_can_organize_without_new_analysis(self):
        from unittest.mock import patch
        mid=self.seed();self.segments(mid)
        with patch('backend.services.classification_jobs.ensure_worker'),patch('backend.blueprints.analysis._analysis_pool.submit') as submit:
            response=self.client.post('/api/analysis/batch',json={'ids':[mid],'skip_done':True,'organize_tags':True})
        self.assertEqual(response.status_code,200,response.json)
        submit.assert_not_called()
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM taxonomy_jobs WHERE stage='analysis'").fetchone()[0],1)

class TaxonomyConcurrencyTests(DatabaseCase):
    def test_engine_background_wait_is_cancellable_without_touching_foreground(self):
        from backend import local_vlm as engine
        from unittest.mock import patch
        import threading
        outcome=[]
        cancel=threading.Event()
        with patch.object(engine,'ensure',return_value={'ok':True}):
            engine.acquire_engine('synthetic')
            def background():
                try: engine.acquire_engine('synthetic',background=True,cancelled=cancel.is_set)
                except InterruptedError: outcome.append('cancelled')
            worker=threading.Thread(target=background);worker.start();cancel.set();worker.join(2)
            self.assertFalse(worker.is_alive())
            self.assertEqual(outcome,['cancelled'])
            self.assertEqual(engine._engine_users,1)
            engine.release_engine()

    def test_example_preview_does_not_apply_and_changed_example_rejects_accept(self):
        import numpy as np
        a=tx.create_node(self.db,'产品');one=self.seed(self.case/'one.jpg');two=self.seed(self.case/'two.jpg')
        for mid in (one,two):
            self.db.execute('INSERT INTO taxonomy_features(media_id,model_key,input_revision,dimension,vector) VALUES (?,?,?,?,?)',
                (mid,'synthetic',tx.input_revision(self.db,mid,'image'),2,np.array([1.,0.],dtype=np.float32).tobytes()))
        self.db.commit()
        self.assertEqual(self.client.post(f"/api/taxonomy/examples/{a['id']}",json={'media_id':one,'role':'positive'}).status_code,200)
        response=self.client.post(f"/api/taxonomy/examples/{a['id']}/find",json={'media_ids':[two]})
        self.assertEqual(response.status_code,200,response.json)
        self.assertEqual(tx.summaries(self.db,[two])[two],0)
        cid=response.json['data'][0]['candidate_id']
        self.client.delete(f"/api/taxonomy/examples/{a['id']}/{one}")
        self.assertEqual(self.client.post('/api/taxonomy/candidates/review',json={'ids':[cid],'accept':True}).status_code,409)
        self.assertEqual(tx.summaries(self.db,[two])[two],0)

    def test_failing_multi_source_merge_leaves_every_source_unchanged(self):
        a=tx.create_node(self.db,'A');b=tx.create_node(self.db,'B');target=tx.create_node(self.db,'T')
        one=self.seed(self.case/'one.jpg');two=self.seed(self.case/'two.jpg')
        tx.decide(self.db,[one],a['id'],'confirm');tx.decide(self.db,[two],b['id'],'confirm')
        tx.decide(self.db,[two],target['id'],'exclude');self.db.commit()
        plan=tx.preview_merge(self.db,[a['id'],b['id']],target['id']);self.db.commit()
        with self.assertRaises(tx.Conflict): tx.apply_plan(self.db,plan)
        self.assertEqual(tx.get_node(self.db,a['id'])['status'],'active')
        self.assertEqual(tx.summaries(self.db,[one,two]),{one:1,two:1})
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_changes').fetchone()[0],0)

class ClassificationIntentTests(DatabaseCase):
    def test_import_and_task_intent_share_one_commit(self):
        from backend.services import importer
        from unittest.mock import patch
        path=self.case/'test.jpg';path.write_bytes(b'synthetic')
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('classification_enabled','true')");self.db.commit()
        prepared={'file_path':str(path),'file_name':path.name,'media_type':'image','file_size':path.stat().st_size,'file_mtime':path.stat().st_mtime}
        with patch('backend.services.classification_jobs.enqueue',side_effect=RuntimeError('synthetic intent failure')):
            with self.assertRaises(RuntimeError): importer._save_import(self.db,prepared,None,classify_media=True)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM media').fetchone()[0],0)
        with patch('backend.services.classification_jobs.ensure_worker'):
            row=importer._save_import(self.db,prepared,None,classify_media=True)
        self.assertEqual(self.db.execute('SELECT media_id FROM taxonomy_jobs').fetchone()[0],row['id'])

    def test_analysis_and_task_intent_failure_keeps_previous_analysis(self):
        from backend.blueprints import analysis
        from unittest.mock import patch
        mid=self.seed();self.segments(mid,'preserve')
        self.db.execute('INSERT INTO taxonomy_analysis_requests(media_id,enabled) VALUES (?,1)',(mid,));self.db.commit()
        with patch('backend.services.classification_jobs.enqueue',side_effect=RuntimeError('synthetic intent failure')):
            with self.assertRaises(RuntimeError):
                analysis.save_segments(mid,[{'time_start':'00:00:00','time_end':'00:00:05','visual':'replacement'}])
        self.assertEqual(self.db.execute('SELECT visual FROM media_segment WHERE media_id=?',(mid,)).fetchone()[0],'preserve')
        self.assertEqual(self.db.execute('SELECT analysis_status FROM media WHERE id=?',(mid,)).fetchone()[0],'done')

    def test_library_snapshot_includes_new_records_and_preserves_old_vectors(self):
        from backend.storage import snapshot_database
        import sqlite3
        mid=self.seed(embedding=b'old-resnet-unchanged');tag=tx.create_node(self.db,'山水')
        tx.decide(self.db,[mid],tag['id'],'confirm')
        tx.save_collection(self.db,'山水图集',{'tag_ids':[tag['id']]});self.db.commit()
        destination=self.case/'export.db';snapshot_database(self.app.config['DATABASE'],destination)
        with sqlite3.connect(destination) as db:
            self.assertEqual(db.execute('SELECT embedding FROM media WHERE id=?',(mid,)).fetchone()[0],b'old-resnet-unchanged')
            self.assertEqual(db.execute('SELECT COUNT(*) FROM taxonomy_collections').fetchone()[0],1)
            self.assertEqual(db.execute('PRAGMA foreign_key_check').fetchall(),[])


if __name__ == '__main__': unittest.main()
