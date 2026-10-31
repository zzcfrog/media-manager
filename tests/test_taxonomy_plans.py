"""Reviewed plans use synthetic media only, with no model calls."""
from support import DatabaseCase
import json
from backend.services import taxonomy as tx, taxonomy_plans as plans


class ReviewedPlanTests(DatabaseCase):
    def node(self,name,parent=None):
        return tx.create_node(self.db,name,parent_id=parent)

    def apply(self,plan):
        row=self.db.execute('SELECT * FROM taxonomy_plans WHERE id=?',(plan['id'],)).fetchone()
        payload=json.loads(row['payload'])
        self.assertEqual(tx._json(plans.snapshot(self.db,payload)),row['before_state'])
        plans.execute(self.db,row['kind'],payload)
        return payload

    def test_preview_decision_never_mutates_and_exclusion_executes_exact_scope(self):
        parent=self.node('山');child=self.node('雪山',parent['id']);mid=self.seed()
        tx.decide(self.db,[mid],child['id'],'confirm')
        plan=plans.preview_decision(self.db,{'media_ids':[mid],'tag_id':parent['id'],'decision':'exclude','scope':'subtree'})
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)
        self.assertEqual(plan['media_count'],1)
        self.assertEqual(plan['decision_deltas'][0]['tag_id'],parent['id'])
        self.assertEqual(plan['decision_deltas'][0]['after'],'exclude')
        self.assertEqual(plan['association_deltas'],[{'media_id':mid,'tag_id':child['id'],'name':'雪山','before':True,'after':False}])
        self.apply(plan)
        self.assertEqual(tx.summaries(self.db,[mid])[mid],0)
        self.assertTrue(tx._blocked(self.db,mid,child['id']))

    def test_moving_a_subtree_requires_explicit_exclusion_scope_resolution(self):
        old=self.node('旧父');new=self.node('新父');child=self.node('孩子',old['id']);mid=self.seed()
        tx.decide(self.db,[mid],old['id'],'exclude',scope='subtree')
        plan=plans.preview_edit(self.db,child['id'],{'version':child['version'],'parent_id':new['id']})
        self.assertTrue(plan['conflicts'])
        self.assertEqual(tx.get_node(self.db,child['id'])['parent_id'],old['id'])
        with self.assertRaises(tx.Conflict):plans.execute(self.db,'edit',plan['payload'])
        resolutions={c['key']:'preserve' for c in plan['conflicts']}
        ready=plans.preview_edit(self.db,child['id'],{'version':child['version'],'parent_id':new['id'],'resolutions':resolutions})
        self.assertFalse(ready['conflicts'])
        self.apply(ready)
        self.assertEqual(tx.get_node(self.db,child['id'])['parent_id'],new['id'])
        self.assertTrue(tx._blocked(self.db,mid,child['id']))
        self.assertTrue(tx._blocked(self.db,mid,old['id']))
        self.assertFalse(tx._blocked(self.db,mid,new['id']))

    def test_null_parent_choice_is_valid_and_children_are_not_implicitly_reparented(self):
        a=self.node('A');b=self.node('B');child=self.node('C',a['id'])
        plan=plans.preview_merge(self.db,[a['id']],b['id'],{})
        key=f"child:{child['id']}"
        self.assertIn(key,[c['key'] for c in plan['conflicts']])
        ready=plans.preview_merge(self.db,[a['id']],b['id'],{key:None})
        self.assertFalse(ready['conflicts'])
        self.apply(ready)
        self.assertIsNone(tx.get_node(self.db,child['id'])['parent_id'])
        self.assertEqual(tx.get_node(self.db,a['id'],redirect=True)['id'],b['id'])

    def test_merge_manual_conflict_is_explicit_and_keep_confirmation_clears_exclusion(self):
        a=self.node('A');b=self.node('B');mid=self.seed()
        tx.decide(self.db,[mid],a['id'],'confirm');tx.decide(self.db,[mid],b['id'],'exclude')
        plan=plans.preview_merge(self.db,[a['id']],b['id'],{})
        self.assertTrue(plan['conflicts'])
        key=f"decision:{mid}:{b['id']}:direct"
        ready=plans.preview_merge(self.db,[a['id']],b['id'],{key:'confirm'})
        self.assertFalse(ready['conflicts'])
        self.apply(ready)
        self.assertEqual([r[0] for r in self.db.execute('SELECT tag_id FROM media_tags')],[b['id']])
        self.assertFalse(tx._blocked(self.db,mid,b['id']))
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_decision_events WHERE action=\'reviewed_plan\'').fetchone()[0],2)

    def test_merge_subtree_preserves_original_excluded_branch_without_expanding(self):
        a=self.node('A');oldchild=self.node('old',a['id']);b=self.node('B');newchild=self.node('new',b['id']);mid=self.seed()
        tx.decide(self.db,[mid],a['id'],'exclude',scope='subtree')
        base=plans.preview_merge(self.db,[a['id']],b['id'],{})
        choices={f"child:{oldchild['id']}":b['id'],f"exclusion:{mid}:{a['id']}":'preserve'}
        ready=plans.preview_merge(self.db,[a['id']],b['id'],choices)
        self.assertFalse(ready['conflicts'])
        self.apply(ready)
        self.assertTrue(tx._blocked(self.db,mid,b['id']))
        self.assertTrue(tx._blocked(self.db,mid,oldchild['id']))
        self.assertFalse(tx._blocked(self.db,mid,newchild['id']))

    def test_merge_preserves_all_aliases_and_examples_with_role_choice(self):
        a=self.node('A');b=self.node('B');mid=self.seed()
        tx.add_expression(self.db,a['id'],'alias A');tx.add_expression(self.db,b['id'],'alias B')
        for n,role in [(a,'positive'),(b,'negative')]:
            self.db.execute('INSERT INTO taxonomy_examples(tag_id,media_id,role,input_revision) VALUES (?,?,?,?)',
                            (n['id'],mid,role,tx.input_revision(self.db,mid,'image')))
        first=plans.preview_merge(self.db,[a['id']],b['id'],{})
        self.assertIn(f'example:{mid}',[c['key'] for c in first['conflicts']])
        ready=plans.preview_merge(self.db,[a['id']],b['id'],{f'example:{mid}':'positive'})
        self.apply(ready)
        aliases={r[0] for r in self.db.execute('SELECT text FROM taxonomy_expressions WHERE tag_id=?',(b['id'],))}
        self.assertTrue({'A','alias A','alias B'}<=aliases)
        self.assertEqual(self.db.execute('SELECT role FROM taxonomy_examples WHERE tag_id=? AND media_id=?',(b['id'],mid)).fetchone()[0],'positive')

    def test_split_retain_conflict_keeps_original_and_multitarget_preserves_sources(self):
        source=self.node('苹果');a=self.node('水果');b=self.node('品牌');one=self.seed(self.case/'one');two=self.seed(self.case/'two')
        tx.decide(self.db,[one,two],source['id'],'confirm');tx.decide(self.db,[one],b['id'],'exclude')
        first=plans.preview_split(self.db,source['id'],{str(one):[b['id']],str(two):[a['id'],b['id']]},{})
        ready=plans.preview_split(self.db,source['id'],{str(one):[b['id']],str(two):[a['id'],b['id']]},{f"split:{one}:{b['id']}":'retain'})
        self.assertFalse(ready['conflicts'])
        self.apply(ready)
        self.assertEqual(tx.summaries(self.db,[one,two]),{one:1,two:2})
        self.assertEqual(tx.get_node(self.db,source['id'])['status'],'paused')
        self.assertGreater(self.db.execute('SELECT COUNT(*) FROM taxonomy_sources WHERE media_id=? AND tag_id=?',(two,a['id'])).fetchone()[0],0)

    def test_preview_snapshot_rejects_input_replacement_and_new_child(self):
        a=self.node('A');b=self.node('B');mid=self.seed();tx.decide(self.db,[mid],a['id'],'confirm')
        plan=plans.preview_merge(self.db,[a['id']],b['id'],{})
        before=self.db.execute('SELECT before_state FROM taxonomy_plans WHERE id=?',(plan['id'],)).fetchone()[0]
        self.db.execute('UPDATE media SET file_size=123 WHERE id=?',(mid,))
        self.assertNotEqual(tx._json(plans.snapshot(self.db,plan['payload'])),before)
        self.node('new',a['id'])
        self.assertNotEqual(tx._json(plans.snapshot(self.db,plan['payload'])),before)

    def test_plan_failure_rolls_back_prior_node_changes(self):
        a=self.node('A');b=self.node('B');child=self.node('child',a['id']);mid=self.seed();tx.decide(self.db,[mid],a['id'],'confirm')
        plan=plans.preview_merge(self.db,[a['id']],b['id'],{f"child:{child['id']}":b['id']})
        original=plans._write_state
        try:
            def fail(*args):raise RuntimeError('synthetic failure')
            plans._write_state=fail
            with self.assertRaises(RuntimeError):self.apply(plan)
        finally:plans._write_state=original
        self.assertEqual(tx.get_node(self.db,a['id'])['status'],'active')
        self.assertEqual(tx.get_node(self.db,child['id'])['parent_id'],a['id'])
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)

    def test_ai_suggestion_uses_compatible_cache_without_applying_labels(self):
        import hashlib
        import numpy as np
        source=self.node('源');a=self.node('A');b=self.node('B');mid=self.seed();tx.decide(self.db,[mid],source['id'],'confirm')
        for tag,vec in [(a,[1.,0.]),(b,[0.,1.])]:
            text=tx.recognition_description(self.db,tx.get_node(self.db,tag['id']))
            revision=hashlib.sha256(text.encode()).hexdigest()
            self.db.execute('INSERT INTO taxonomy_text_features(tag_id,model_key,text_revision,dimension,vector) VALUES (?,?,?,?,?)',
                (tag['id'],'synthetic',revision,2,np.array(vec,dtype=np.float32).tobytes()))
        self.db.execute('INSERT INTO taxonomy_features(media_id,model_key,input_revision,dimension,vector) VALUES (?,?,?,?,?)',
                (mid,'synthetic',tx.input_revision(self.db,mid,'image'),2,np.array([1.,0.],dtype=np.float32).tobytes()))
        result=plans.suggest(self.db,{'kind':'split','source_id':source['id'],'target_ids':[a['id'],b['id']]})
        self.assertEqual(result['assignments'],{str(mid):[a['id']]})
        self.assertEqual([r[0] for r in self.db.execute('SELECT tag_id FROM media_tags')],[source['id']])

    def test_unresolved_child_can_choose_root_before_duplicate_name_validation(self):
        source=self.node('来源');target=self.node('目标');child=self.node('同名',source['id']);self.node('同名',target['id'])
        plan=plans.preview_merge(self.db,[source['id']],target['id'],{})
        self.assertIn(f"child:{child['id']}",[c['key'] for c in plan['conflicts']])
        ready=plans.preview_merge(self.db,[source['id']],target['id'],{f"child:{child['id']}":None})
        self.apply(ready)
        self.assertIsNone(tx.get_node(self.db,child['id'])['parent_id'])

    def test_merge_keeps_current_target_example_when_source_reference_is_stale(self):
        source=self.node('来源');target=self.node('目标');mid=self.seed()
        current=tx.input_revision(self.db,mid,'image')
        for node,revision in ((source,'old-revision'),(target,current)):
            self.db.execute('INSERT INTO taxonomy_examples(tag_id,media_id,role,input_revision) VALUES (?,?,?,?)',(node['id'],mid,'positive',revision))
        plan=plans.preview_merge(self.db,[source['id']],target['id'],{})
        self.apply(plan)
        self.assertEqual(self.db.execute('SELECT input_revision FROM taxonomy_examples WHERE tag_id=? AND media_id=?',(target['id'],mid)).fetchone()[0],current)

    def test_split_new_targets_are_only_created_on_apply_and_return_ids(self):
        source=self.node('混合');parent=self.node('主体');mid=self.seed();tx.decide(self.db,[mid],source['id'],'confirm')
        declaration={'name':'新主体','parent_id':parent['id'],'definition':'明确的新类别'}
        plan=plans.preview_split(self.db,source['id'],{str(mid):[declaration]}, {})
        self.assertFalse(plan['conflicts'])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM taxonomy_nodes WHERE name='新主体'").fetchone()[0],0)
        result=plans.execute(self.db,'split',plan['payload'])
        self.assertEqual(len(result['created_node_ids']),1)
        target=result['created_node_ids'][0]
        self.assertEqual(tx.get_node(self.db,target)['parent_id'],parent['id'])
        self.assertEqual([r[0] for r in self.db.execute('SELECT tag_id FROM media_tags WHERE media_id=?',(mid,))],[target])

    def test_split_new_targets_are_rolled_back_if_a_later_assignment_fails(self):
        source=self.node('混合');mid=self.seed();tx.decide(self.db,[mid],source['id'],'confirm')
        plan=plans.preview_split(self.db,source['id'],{str(mid):[{'name':'新目标'}]}, {})
        original=tx.decide
        try:
            def fail(*args,**kwargs):raise RuntimeError('synthetic decision failure')
            tx.decide=fail
            with self.assertRaises(RuntimeError):plans.execute(self.db,'split',plan['payload'])
        finally:tx.decide=original
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM taxonomy_nodes WHERE name='新目标'").fetchone()[0],0)
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)

    def test_confirmation_preview_lists_new_label_and_entire_cleared_exclusion(self):
        parent=self.node('主体');target=self.node('人物',parent['id']);other=self.node('动物',parent['id']);mid=self.seed()
        tx.decide(self.db,[mid],parent['id'],'exclude',scope='subtree')
        plan=plans.preview_decision(self.db,{'media_ids':[mid],'tag_id':target['id'],'decision':'confirm','clear_exclusion':True})
        self.assertEqual(plan['association_deltas'],[{'media_id':mid,'tag_id':target['id'],'name':'人物','before':False,'after':True}])
        self.assertEqual({(d['tag_id'],d['before'],d['after']) for d in plan['decision_deltas']},
                         {(parent['id'],'exclude',None),(target['id'],None,'confirm')})
        self.assertEqual({n['id'] for n in plan['exclusion_changes'][0]['before']},{parent['id'],target['id'],other['id']})
        self.assertTrue(tx._blocked(self.db,mid,target['id']))
        self.apply(plan)
        self.assertFalse(tx._blocked(self.db,mid,other['id']))
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)

    def test_split_preview_includes_all_label_and_manual_decision_changes(self):
        source=self.node('混合');target=self.node('清晰');mid=self.seed();tx.decide(self.db,[mid],source['id'],'confirm')
        plan=plans.preview_split(self.db,source['id'],{str(mid):[target['id']]})
        self.assertEqual({(d['tag_id'],d['before'],d['after']) for d in plan['association_deltas']},
                         {(source['id'],True,False),(target['id'],False,True)})
        self.assertEqual({(d['tag_id'],d['before'],d['after']) for d in plan['decision_deltas']},
                         {(source['id'],'confirm',None),(target['id'],None,'confirm')})
        self.apply(plan)
        self.assertEqual([tuple(r) for r in self.db.execute('SELECT tag_id,decision FROM taxonomy_decisions WHERE media_id=?',(mid,))],
                         [(target['id'],'confirm')])

    def test_new_split_target_integrates_apply_mapping_and_nondestructive_undo(self):
        source=self.node('混合');mid=self.seed();tx.decide(self.db,[mid],source['id'],'confirm')
        plan=plans.preview_split(self.db,source['id'],{str(mid):[{'name':'新目标'}]})
        applied=tx.apply_plan(self.db,plan)
        target=applied['created_node_ids'][0]
        self.assertEqual(self.db.execute('SELECT target_id FROM taxonomy_split_targets WHERE source_id=?',(source['id'],)).fetchone()[0],target)
        tx.undo(self.db,applied['change_id'])
        self.assertEqual(tx.get_node(self.db,target)['status'],'inactive')
        self.assertEqual(tx.get_node(self.db,source['id'])['status'],'active')
        self.assertEqual([r[0] for r in self.db.execute('SELECT tag_id FROM media_tags WHERE media_id=?',(mid,))],[source['id']])

    def test_undo_new_split_target_refuses_later_human_edit(self):
        source=self.node('混合');mid=self.seed();tx.decide(self.db,[mid],source['id'],'confirm')
        applied=tx.apply_plan(self.db,plans.preview_split(self.db,source['id'],{str(mid):[{'name':'新目标'}]}))
        target=tx.get_node(self.db,applied['created_node_ids'][0])
        tx.update_node(self.db,target['id'],{'definition':'后来人工补充'},target['version'])
        with self.assertRaises(tx.Conflict):tx.undo(self.db,applied['change_id'])
        self.assertEqual(tx.get_node(self.db,target['id'])['definition'],'后来人工补充')
        self.assertEqual(tx.summaries(self.db,[mid])[mid],1)

    def test_ai_drafts_do_not_resurface_rejected_or_stale_merge_suggestions(self):
        from backend.services.taxonomy_relations import _context
        source=self.node('原词');target=self.node('目标')
        self.db.execute('INSERT INTO taxonomy_relation_suggestions(tag_id,target_id,kind,evidence,revision,state,source_key) VALUES (?,?,?,?,?,?,?)',
                        (source['id'],target['id'],'duplicate','{}',_context(self.db,source['id'],target['id']),'rejected','rejected-case'))
        with self.assertRaises(tx.Conflict):plans.suggest(self.db,{'kind':'merge','source_id':source['id']})
        self.db.execute("UPDATE taxonomy_relation_suggestions SET state='pending',revision='stale'")
        with self.assertRaises(tx.Conflict):plans.suggest(self.db,{'kind':'merge','source_id':source['id']})
        self.db.execute('UPDATE taxonomy_relation_suggestions SET revision=?',(_context(self.db,source['id'],target['id']),))
        self.assertEqual(plans.suggest(self.db,{'kind':'merge','source_id':source['id']})['target_id'],target['id'])
