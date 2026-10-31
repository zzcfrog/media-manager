"""Relationship policies, recovery and undo use synthetic local libraries only."""
import json
import math
from unittest.mock import patch

from support import DatabaseCase
from backend.services import taxonomy as tx, taxonomy_relations as relations, taxonomy_review as review


class TaxonomyRelationTests(DatabaseCase):
    def node(self,name,parent=None):
        return tx.create_node(self.db,name,parent_id=parent)

    def setting(self,key,value):
        self.db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)',(key,value))

    def suggestion(self,node,target=None,kind='alias',expression='单车'):
        target_id=target['id'] if target else None
        values=(node['id'],target_id,expression,kind,tx._json({'model':'synthetic'}),
                relations._context(self.db,node['id'],target_id),'sample:'+str(self.db.total_changes))
        sid=self.db.execute('INSERT INTO taxonomy_relation_suggestions(tag_id,target_id,expression,kind,evidence,revision,source_key) VALUES (?,?,?,?,?,?,?)',values).lastrowid
        return self.db.execute('SELECT * FROM taxonomy_relation_suggestions WHERE id=?',(sid,)).fetchone()

    def validation(self,kind='alias',node=None):
        return {'annotation_source':'human','model_key':'synthetic','kind':kind,'threshold':.5,
                'tag_id':node['id'] if node else None,
                'cases':[{'sample_id':str(i),'split':'selection' if i<10 else 'heldout',
                          'score':1. if i<20 else 0.,'expected':i<20} for i in range(30)]}

    def auto(self,kind='alias',node=None):
        self.setting('classification_auto_relations_enabled','true')
        return relations.install_validation(self.db,self.validation(kind,node))

    def test_manual_alias_has_undo_record_and_repeat_accept_is_rejected(self):
        node=self.node('自行车');row=self.suggestion(node)
        change=relations.apply_suggestion(self.db,row)
        self.assertEqual(tx.resolve(self.db,'单车')[0]['id'],node['id'])
        with self.assertRaises(tx.Conflict): relations.apply_suggestion(self.db,row)
        tx.undo(self.db,change['change_id'])
        self.assertEqual(tx.resolve(self.db,'单车'),[])
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_suggestions').fetchone()[0],'pending')
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_changes').fetchone()[0],'undone')

    def test_undo_preserves_unrelated_edits_but_refuses_later_edit_on_endpoint(self):
        one=self.node('自行车');other=self.node('风景');row=self.suggestion(one)
        change=relations.apply_suggestion(self.db,row)
        tx.add_expression(self.db,other['id'],'景色')
        tx.undo(self.db,change['change_id'])
        self.assertEqual(tx.resolve(self.db,'景色')[0]['id'],other['id'])
        row=self.db.execute('SELECT * FROM taxonomy_relation_suggestions WHERE id=?',(row['id'],)).fetchone()
        change=relations.apply_suggestion(self.db,row)
        tx.add_expression(self.db,one['id'],'脚踏车')
        with self.assertRaises(tx.Conflict): tx.undo(self.db,change['change_id'])
        self.assertTrue(tx.resolve(self.db,'脚踏车'));self.assertTrue(tx.resolve(self.db,'单车'))

    def test_relation_endpoints_are_symmetric_and_undo_restores_before_value(self):
        one=self.node('山峰');two=self.node('山脉')
        row=self.suggestion(two,one,'near','')
        change=relations.apply_suggestion(self.db,row)
        edge=self.db.execute('SELECT * FROM taxonomy_relations').fetchone()
        self.assertEqual((edge['source_id'],edge['target_id']),(one['id'],two['id']))
        self.assertEqual(edge['origin'],'manual_review')
        self.assertIn('versions',json.loads(edge['evidence']))
        tx.undo(self.db,change['change_id'])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_relations').fetchone()[0],0)

    def test_failed_change_record_rolls_back_alias_and_acceptance(self):
        row=self.suggestion(self.node('自行车'))
        with patch.object(relations,'_record_change',side_effect=RuntimeError('synthetic failure')):
            with self.assertRaises(RuntimeError): relations.apply_suggestion(self.db,row)
        self.assertEqual(tx.resolve(self.db,'单车'),[])
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_suggestions').fetchone()[0],'pending')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_changes').fetchone()[0],0)

    def test_alias_never_captures_an_existing_concept_and_locks_are_enforced(self):
        one=self.node('自行车');two=self.node('单车')
        row=self.suggestion(one)
        with self.assertRaises(tx.Conflict): relations.apply_suggestion(self.db,row)
        row=self.suggestion(one,kind='alias',expression='脚踏车')
        self.db.execute('INSERT INTO taxonomy_relation_locks(tag_id,area) VALUES (?,?)',(one['id'],'alias'))
        with self.assertRaises(tx.Conflict): relations.apply_suggestion(self.db,row)
        self.assertEqual(tx.get_node(self.db,two['id'])['status'],'active')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_changes').fetchone()[0],0)

    def test_automatic_requires_switch_matching_model_validation_and_fresh_scope(self):
        node=self.node('自行车');row=self.suggestion(node)
        with self.assertRaises(tx.Conflict): relations.apply_suggestion(self.db,row,automatic=True)
        self.setting('classification_auto_relations_enabled','true')
        with self.assertRaises(tx.Conflict): relations.apply_suggestion(self.db,row,automatic=True)
        profile=self.auto(node=node)
        result=relations.apply_suggestion(self.db,row,automatic=True)
        stored=json.loads(self.db.execute('SELECT evidence FROM taxonomy_relation_suggestions WHERE id=?',(row['id'],)).fetchone()[0])
        self.assertEqual(stored['validation_profile'],profile['id'])
        tx.undo(self.db,result['change_id'])
        self.db.execute("UPDATE taxonomy_validation_profiles SET model_key='other'")
        with self.assertRaises(tx.Conflict): relations.apply_suggestion(self.db,row,automatic=True)
        self.db.execute("UPDATE taxonomy_validation_profiles SET model_key='synthetic'")
        tx.update_node(self.db,node['id'],{'recognition_text':'车辆'},tx.get_node(self.db,node['id'])['version'])
        fresh=self.suggestion(tx.get_node(self.db,node['id']),expression='脚踏车')
        with self.assertRaises(tx.Conflict): relations.apply_suggestion(self.db,fresh,automatic=True)

    def test_global_relation_profile_does_not_authorize_other_kind_or_association(self):
        one=self.node('山峰');two=self.node('山脉');self.auto('near')
        change=relations.apply_suggestion(self.db,self.suggestion(one,two,'near',''),automatic=True)
        self.assertIsInstance(change['change_id'],int)
        with self.assertRaises(tx.Conflict): relations.apply_suggestion(self.db,self.suggestion(one,two,'related',''),automatic=True)
        with self.assertRaises(tx.Conflict): relations.install_validation(self.db,self.validation('association'))

    def test_validation_rejects_nonfinite_boolean_scores_and_empty_model(self):
        for value in (math.nan,math.inf,-math.inf,True):
            data=self.validation();data['threshold']=value
            with self.subTest(threshold=value),self.assertRaises(tx.Conflict): relations.install_validation(self.db,data)
            data=self.validation();data['cases'][0]['score']=value
            with self.subTest(score=value),self.assertRaises(tx.Conflict): relations.install_validation(self.db,data)
        for model in ('','  ',None):
            data=self.validation();data['model_key']=model
            with self.assertRaises(tx.Conflict): relations.install_validation(self.db,data)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_validation_profiles').fetchone()[0],0)

    def test_validation_refuses_duplicates_false_positives_and_inactive_concept(self):
        data=self.validation();data['cases'][20]['score']=1.
        with self.assertRaises(tx.Conflict): relations.install_validation(self.db,data)
        data=self.validation();data['cases'][20]['sample_id']='19'
        with self.assertRaises(tx.Conflict): relations.install_validation(self.db,data)
        node=self.node('风景');self.db.execute("UPDATE taxonomy_nodes SET status='inactive' WHERE id=?",(node['id'],))
        with self.assertRaises(tx.Conflict): relations.install_validation(self.db,self.validation('association',node))

    def test_auto_association_is_scoped_traceable_and_undoable(self):
        node=self.node('风景');mid=self.seed()
        self.setting('classification_auto_enabled','true')
        relations.install_validation(self.db,self.validation('association',node))
        evidence=tx._json({'model':'synthetic','cosine':.9})
        cid=self.db.execute('INSERT INTO taxonomy_candidates(media_id,tag_id,term,kind,evidence,source_key,input_revision) VALUES (?,?,?,?,?,?,?)',
                            (mid,node['id'],node['name'],'fast',evidence,'candidate',tx.input_revision(self.db,mid,'image'))).lastrowid
        review.track_candidate(self.db,cid,'synthetic')
        self.assertTrue(relations.try_auto_association(self.db,cid))
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)
        change=self.db.execute("SELECT * FROM taxonomy_changes WHERE kind='association_auto'").fetchone()
        tx.undo(self.db,change['id'])
        self.assertEqual(tx.summaries(self.db,[mid])[mid],0)
        self.assertFalse(relations.try_auto_association(self.db,cid))

    def test_process_rechecks_fresh_parent_and_status_after_inference(self):
        for field,value in (('parent_id',None),('status','inactive')):
            parent=self.node('父'+field);node=self.node('子'+field,parent['id'])
            job=relations.queue(self.db,node['id'],explicit=True);self.db.commit()
            def infer(db,n,deadline):
                db.execute('UPDATE taxonomy_nodes SET '+field+'=? WHERE id=?',(value,n['id']))
                db.commit()
                return [{'kind':'alias','expression':'新表达'}],'synthetic'
            with patch.object(relations,'_foreground_busy',return_value=False):
                self.assertTrue(relations.process_next(self.db,infer=infer))
            self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'stale')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_relation_suggestions').fetchone()[0],0)

    def test_process_recovers_expired_lease_but_not_live_lease(self):
        node=self.node('山');job=relations.queue(self.db,node['id'],explicit=True)
        self.db.execute("UPDATE taxonomy_relation_jobs SET state='running',lease='old',updated_at=datetime('now','-601 seconds') WHERE id=?",(job,));self.db.commit()
        infer=lambda db,n,deadline:([{'kind':'alias','expression':'山体'}],'synthetic')
        with patch.object(relations,'_foreground_busy',return_value=False):
            self.assertTrue(relations.process_next(self.db,infer=infer))
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'done')
        self.db.execute("UPDATE taxonomy_relation_jobs SET state='running',lease='live',updated_at=datetime('now') WHERE id=?",(job,));self.db.commit()
        with patch.object(relations,'_foreground_busy',return_value=False):
            self.assertFalse(relations.process_next(self.db,infer=infer))

    def test_target_semantics_or_model_switch_during_inference_invalidates_job(self):
        one=self.node('山');other=self.node('山脉')
        job=relations.queue(self.db,one['id'],explicit=True);self.db.commit()
        def infer(db,n,deadline):
            target=tx.get_node(db,other['id'])
            tx.update_node(db,target['id'],{'definition':'地理区域'},target['version']);db.commit()
            return [{'kind':'near','target_id':target['id']}],'synthetic'
        with patch.object(relations,'_foreground_busy',return_value=False):relations.process_next(self.db,infer=infer)
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'stale')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_relation_suggestions').fetchone()[0],0)
        relations.control(self.db,[job],'resume');self.db.commit()
        def switched(db,n,deadline):
            self.setting('classification_omni_model','new-model');db.commit()
            return [{'kind':'near','target_id':other['id']}],'synthetic'
        with patch.object(relations,'_foreground_busy',return_value=False):relations.process_next(self.db,infer=switched)
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'stale')

    def test_expired_budget_never_claims_and_callback_pause_discards_results(self):
        import time
        one=self.node('山');job=relations.queue(self.db,one['id'],explicit=True);self.db.commit()
        with patch.object(relations,'_foreground_busy',return_value=False):
            self.assertFalse(relations.process_next(self.db,deadline=time.monotonic()-1))
            stopped={'value':False}
            def infer(*args):
                stopped['value']=True
                return [{'kind':'alias','expression':'山体'}],'synthetic'
            relations.process_next(self.db,infer=infer,cancelled=lambda:stopped['value'])
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'paused')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_relation_suggestions').fetchone()[0],0)

    def test_cancelled_inference_result_never_writes_and_cancelled_job_stays_closed(self):
        node=self.node('山');job=relations.queue(self.db,node['id'],explicit=True);self.db.commit()
        def infer(db,n,deadline):
            relations.control(db,[job],'cancel');db.commit()
            return [{'kind':'alias','expression':'山体'}],'synthetic'
        with patch.object(relations,'_foreground_busy',return_value=False): relations.process_next(self.db,infer=infer)
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'cancelled')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_relation_suggestions').fetchone()[0],0)
        relations.queue(self.db,node['id'],explicit=True)
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'cancelled')

    def test_foreground_waits_without_claim_and_yields_during_engine_wait(self):
        from backend import local_vlm
        node=self.node('山');job=relations.queue(self.db,node['id'],explicit=True);self.db.commit()
        with patch.object(relations,'_foreground_busy',return_value=True): self.assertFalse(relations.process_next(self.db))
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'queued')
        activity={'busy':False}
        def acquire(model,background=False,cancelled=None):
            self.assertTrue(background);self.assertFalse(cancelled())
            activity['busy']=True;self.assertTrue(cancelled())
            raise InterruptedError('synthetic foreground')
        with patch.object(relations,'_foreground_busy',side_effect=lambda:activity['busy']),patch.object(local_vlm,'acquire_engine',side_effect=acquire):
            relations.process_next(self.db)
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'queued')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_relation_suggestions').fetchone()[0],0)

    def test_failure_missing_model_and_explicit_retry_states(self):
        node=self.node('山');job=relations.queue(self.db,node['id'],explicit=True);self.db.commit()
        with patch.object(relations,'_foreground_busy',return_value=False):
            relations.process_next(self.db,infer=lambda *args:(_ for _ in ()).throw(FileNotFoundError()))
            self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'waiting')
            relations.control(self.db,[job],'resume');self.db.commit()
            relations.process_next(self.db,infer=lambda *args:(_ for _ in ()).throw(RuntimeError()))
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'failed')
        self.assertEqual(relations.control(self.db,[job],'resume'),1)
        self.assertEqual(relations.control(self.db,[job],'pause'),1)
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'paused')

    def test_automatic_processing_failure_rolls_back_all_suggestions_and_changes(self):
        node=self.node('山');other=self.node('山脉');self.auto('related')
        job=relations.queue(self.db,node['id'],explicit=True);self.db.commit()
        with patch.object(relations,'_foreground_busy',return_value=False),patch.object(relations,'_record_change',side_effect=RuntimeError('synthetic failure')):
            relations.process_next(self.db,infer=lambda *args:([{'kind':'related','target_id':other['id']}],'synthetic'))
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?',(job,)).fetchone()[0],'failed')
        for table in ('taxonomy_relation_suggestions','taxonomy_changes','taxonomy_relations'):
            self.assertEqual(self.db.execute('SELECT COUNT(*) FROM '+table).fetchone()[0],0)
