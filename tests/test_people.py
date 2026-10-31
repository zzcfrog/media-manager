"""People invariants against an isolated library; never touches source media."""
import hashlib
import importlib.util
import json
import unittest

from support import DatabaseCase


class PeopleTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.assertIsNotNone(importlib.util.find_spec('backend.services.people'), '人物数据服务尚未实现')
        from backend.services import people
        from backend.blueprints.people import bp
        self.people = people
        people.init_schema(self.db)
        self.db.commit()
        if 'people' not in self.app.blueprints:
            self.app.register_blueprint(bp, url_prefix='/api/people')

    def person(self, name=''):
        return self.people.create_person(self.db, name)

    def face(self, mid, key='one', vector=(1., 0., 0.), **values):
        observations = [{'sample_key': r['sample_key'], 'bbox':json.loads(r['bbox']),
                         'feature':r['feature'], 'quality':r['quality'], 'score':r['score']}
                        for r in self.db.execute('SELECT * FROM people_faces WHERE media_id=? AND input_revision=? AND active=1 AND sample_key!=?',(mid,'revision',key))]
        result = self.people.record_observations(self.db, mid, 'revision', 'synthetic', observations+[
            {'sample_key': key, 'bbox': [.1, .1, .3, .4], 'feature': list(vector),
             'quality': .95, 'score': .99, **values}])
        return next(f for f in result['faces'] if f['sample_key']==key)

    def test_schema_order_and_foreign_keys(self):
        self.people.init_schema(self.db)
        for name in self.people.TABLES:
            cols = [r[1] for r in self.db.execute('PRAGMA table_info('+name+')')]
            self.assertEqual(cols[-2:], ['created_at', 'updated_at'])
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(), [])

    def test_different_name_identities_and_distinct_media_counts(self):
        a=self.person('小林'); b=self.person('小林')
        self.assertNotEqual(a['id'],b['id'])
        photo=self.seed(self.case/'photo.jpg',media_type='image')
        video=self.seed(self.case/'video.mov',duration=20)
        self.people.decide_media(self.db,[photo,video],a['id'],'include')
        one=self.face(photo);two=self.face(photo,'two',(.99,.01,0),bbox=[.6,.1,.3,.4])
        self.people.decide_faces(self.db,[one['id'],two['id']],'move',a['id'])
        summary=self.people.get_person(self.db,a['id'])
        self.assertEqual((summary['photo_count'],summary['video_count']),(1,1))
        self.assertEqual(len(self.people.media_people(self.db,photo)['people']),1)

    def test_manual_face_decisions_survive_rescan_and_model_change(self):
        mid=self.seed(self.case/'photo.jpg',media_type='image')
        a=self.face(mid);old=a['person_id'];named=self.person('阿远')
        self.people.decide_faces(self.db,[a['id']],'move',named['id'])
        rerun=self.face(mid,vector=(1.,0.,0.))
        self.assertEqual(rerun['person_id'],named['id'])
        result=self.people.record_observations(self.db,mid,'revision','other-model',[
            {'sample_key':'changed-key','bbox':[.105,.1,.3,.4],'feature':[0.,1.,0.],'quality':.95,'score':.99}])
        self.assertEqual(result['faces'][0]['id'],a['id'])
        self.assertEqual(result['faces'][0]['person_id'],named['id'])
        self.assertIsNotNone(self.db.execute('SELECT 1 FROM people_face_exclusions WHERE face_id=? AND person_id=?',(a['id'],old)).fetchone())

    def test_unassigned_not_face_and_media_exclusion_block_automatic_return(self):
        photo=self.seed(self.case/'photo.jpg',media_type='image')
        face=self.face(photo);pid=face['person_id']
        self.people.decide_faces(self.db,[face['id']],'unassigned')
        self.assertIsNone(self.face(photo)['person_id'])
        self.people.decide_faces(self.db,[face['id']],'not_face')
        self.assertEqual(self.face(photo)['assignment'],'not_face')
        self.people.decide_media(self.db,[photo],pid,'exclude')
        self.assertNotIn(pid,[p['id'] for p in self.people.media_people(self.db,photo)['people']])

    def test_merge_preview_dedup_apply_undo_and_stale_conflict(self):
        a=self.person('小林');b=self.person()
        one=self.seed(self.case/'one.jpg',media_type='image');two=self.seed()
        self.people.decide_media(self.db,[one],a['id'],'include')
        self.people.decide_media(self.db,[one,two],b['id'],'include')
        plan=self.people.preview_merge(self.db,[b['id']],a['id'])
        self.assertEqual(plan['media_count'],2)
        result=self.people.apply_merge(self.db,plan['plan_id'])
        self.assertEqual(self.people.get_person(self.db,b['id'])['redirect_id'],a['id'])
        self.assertEqual(self.people.get_person(self.db,a['id'])['media_count'],2)
        self.people.undo(self.db,result['change_id'])
        self.assertIsNone(self.people.get_person(self.db,b['id'])['redirect_id'])
        plan=self.people.preview_merge(self.db,[b['id']],a['id'])
        self.people.update_person(self.db,b['id'],{'name':'新名字'},self.people.get_person(self.db,b['id'])['version'])
        with self.assertRaises(self.people.Conflict): self.people.apply_merge(self.db,plan['plan_id'])

    def test_merge_conflicts_atomic_and_undo_cannot_overwrite_later_edits(self):
        a=self.person('A');b=self.person('B');mid=self.seed()
        self.people.decide_media(self.db,[mid],a['id'],'exclude')
        self.people.decide_media(self.db,[mid],b['id'],'include')
        plan=self.people.preview_merge(self.db,[b['id']],a['id'])
        self.assertTrue(plan['conflicts'])
        with self.assertRaises(self.people.Conflict): self.people.apply_merge(self.db,plan['plan_id'])
        self.assertIsNone(self.people.get_person(self.db,b['id'])['redirect_id'])
        self.people.decide_media(self.db,[mid],a['id'],'include')
        result=self.people.apply_merge(self.db,self.people.preview_merge(self.db,[b['id']],a['id'])['plan_id'])
        person=self.people.get_person(self.db,a['id'])
        self.people.update_person(self.db,a['id'],{'name':'edited later'},person['version'])
        with self.assertRaises(self.people.Conflict): self.people.undo(self.db,result['change_id'])
        self.assertEqual(self.people.get_person(self.db,a['id'])['name'],'edited later')

    def test_face_split_moves_only_selected_face_and_undo(self):
        mid=self.seed(self.case/'two-faces.jpg',media_type='image')
        a=self.face(mid);b=self.face(mid,'two',(.99,.01,0),bbox=[.6,.1,.3,.4])
        original=a['person_id']
        self.people.decide_faces(self.db,[b['id']],'move',original)
        result=self.people.decide_faces(self.db,[a['id']],'new',name='拆出的人')
        names={p['name'] for p in self.people.media_people(self.db,mid)['people']}
        self.assertIn('拆出的人',names)
        self.assertIn(original,{p['id'] for p in self.people.media_people(self.db,mid)['people']})
        self.people.undo(self.db,result['change_id'])
        self.assertEqual(self.db.execute('SELECT person_id FROM people_faces WHERE id=?',(a['id'],)).fetchone()[0],original)

    def test_hiding_cover_version_validation_and_invalid_batch(self):
        a=self.person('someone');b=self.person('someone else');mid=self.seed()
        f=self.face(mid)
        with self.assertRaises(self.people.Conflict):self.people.update_person(self.db,a['id'],{'cover_face_id':f['id']},a['version'])
        changed=self.people.update_person(self.db,a['id'],{'hidden':True},a['version'])
        self.assertEqual(len(self.people.list_people(self.db,view='hidden')),1)
        with self.assertRaises(self.people.Conflict):self.people.update_person(self.db,a['id'],{'name':'old'},a['version'])
        with self.assertRaises(self.people.Conflict):self.people.decide_media(self.db,[mid,9999],b['id'],'include')
        self.assertEqual(self.people.get_person(self.db,b['id'])['media_count'],0)

    def test_invalid_vectors_and_changed_revision_do_not_erase_human_name(self):
        mid=self.seed();f=self.face(mid);pid=f['person_id']
        self.people.update_person(self.db,pid,{'name':'kept'},self.people.get_person(self.db,pid)['version'])
        with self.assertRaises(self.people.Conflict):self.face(mid,'bad',(float('nan'),0,1))
        self.people.record_observations(self.db,mid,'new-revision','synthetic',[])
        self.assertEqual(self.people.get_person(self.db,pid)['name'],'kept')
        self.assertEqual(self.people.get_person(self.db,pid)['media_count'],0)

    def test_api_transactions_secure_crops_and_source_unchanged(self):
        source=self.case/'source.jpg';source.write_bytes(b'untouched source')
        before=hashlib.sha256(source.read_bytes()).hexdigest()
        mid=self.seed(source,media_type='image')
        p=self.client.post('/api/people/persons',json={'name':'小林'})
        self.assertEqual(p.status_code,201,p.json);pid=p.json['id']
        response=self.client.post('/api/people/media/decisions',json={'person_id':pid,'media_ids':[mid,999],'decision':'include'})
        self.assertEqual(response.status_code,409,response.json)
        self.assertEqual(self.people.get_person(self.db,pid)['media_count'],0)
        face=self.face(mid,crop_path=str(source))
        self.db.commit()
        self.assertEqual(self.client.get(f"/api/people/faces/{face['id']}/crop").status_code,404)
        self.assertNotIn('feature',self.client.get('/api/people/media/'+str(mid)).json['faces'][0])
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)

    def test_helpers_never_commit_outer_import_transaction(self):
        self.db.commit()
        mid=self.seed()
        self.db.commit()
        self.people.record_observations(self.db,mid,'revision','synthetic',[
            {'sample_key':'face','bbox':[.1,.1,.3,.4],'feature':[1.,0.], 'quality':.9,'score':.9}])
        self.assertTrue(self.db.in_transaction)
        self.db.rollback()
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_faces').fetchone()[0],0)

    def test_automatic_grouping_does_not_follow_similarity_chains(self):
        # A-B and B-C are close, but A-C are not. New faces must agree with group exemplars.
        import math
        one=self.seed(self.case/'a.jpg',media_type='image')
        two=self.seed(self.case/'b.jpg',media_type='image')
        three=self.seed(self.case/'c.jpg',media_type='image')
        a=self.face(one,vector=(1.,0.,0.))
        b=self.face(two,vector=(math.cos(.8),math.sin(.8),0.))
        c=self.face(three,vector=(math.cos(1.6),math.sin(1.6),0.))
        self.assertEqual(a['person_id'],b['person_id'])
        self.assertNotEqual(a['person_id'],c['person_id'])

    def test_cover_crop_cannot_escape_via_symlink(self):
        source=self.case/'source.jpg';source.write_bytes(b'private')
        cache=self.case/'people-cache';cache.mkdir()
        (cache/'link.jpg').symlink_to(source)
        mid=self.seed();f=self.face(mid,crop_path='link.jpg');self.db.commit()
        self.assertEqual(self.client.get(f"/api/people/faces/{f['id']}/crop").status_code,404)

    def test_api_rejects_non_object_payload_and_model_spaces_never_mix(self):
        self.assertEqual(self.client.post('/api/people/persons',json=['bad']).status_code,409)
        one=self.seed(self.case/'a.jpg',media_type='image');two=self.seed(self.case/'b.jpg',media_type='image')
        a=self.face(one)
        b=self.people.record_observations(self.db,two,'revision','unrelated-model',[
            {'sample_key':'b','bbox':[.1,.1,.3,.4],'feature':[1.,0.,0.], 'quality':.9,'score':.9}])['faces'][0]
        self.assertNotEqual(a['person_id'],b['person_id'])

    def test_merge_face_membership_conflicts_with_other_person_media_exclusion(self):
        for face_is_target in (False,True):
            with self.subTest(face_is_target=face_is_target):
                mid=self.seed(self.case/('target-face.jpg' if face_is_target else 'source-face.jpg'),media_type='image')
                face=self.face(mid,vector=(0.,1.,0.) if face_is_target else (1.,0.,0.))
                self.people.decide_faces(self.db,[face['id']],'confirm')
                member=face['person_id'];excluded=self.person('excluded')['id']
                self.people.decide_media(self.db,[mid],excluded,'exclude')
                target,source=(member,excluded) if face_is_target else (excluded,member)
                plan=self.people.preview_merge(self.db,[source],target)
                self.assertTrue(plan['conflicts'])
                self.assertEqual(plan['media_count'],1)
                before=self.people._snapshot(self.db,self.people._scope([source,target]))
                changes=self.db.execute('SELECT COUNT(*) FROM people_changes').fetchone()[0]
                with self.assertRaises(self.people.Conflict):self.people.apply_merge(self.db,plan['plan_id'])
                self.assertEqual(before,self.people._snapshot(self.db,self.people._scope([source,target])))
                self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_changes').fetchone()[0],changes)

    def test_recent_sort_uses_latest_effective_media_capture_time(self):
        first=self.person('first-created');second=self.person('second-created')
        recent=self.seed(self.case/'recent.jpg',media_type='image',date_taken='2026-10-30 12:00:00',imported_at='2026-10-30 13:00:00')
        older=self.seed(self.case/'older.jpg',media_type='image',date_taken='2020-01-01 12:00:00',imported_at='2026-10-30 14:00:00')
        self.people.decide_media(self.db,[recent],first['id'],'include')
        self.people.decide_media(self.db,[older],second['id'],'include')
        self.assertEqual(self.people.list_people(self.db,sort='recent')[0]['id'],first['id'])
        self.people.decide_media(self.db,[recent],first['id'],'exclude')
        self.assertEqual(self.people.list_people(self.db,sort='recent')[0]['id'],second['id'])

    def test_undo_preserves_face_exclusions_to_people_outside_the_change(self):
        mid=self.seed(self.case/'person.jpg',media_type='image');face=self.face(mid)
        excluded=face['person_id'];b=self.person('B');a=self.person('A')
        self.people.decide_faces(self.db,[face['id']],'move',b['id'])
        def exclusion():
            return self.db.execute('SELECT 1 FROM people_face_exclusions WHERE face_id=? AND person_id=?',(face['id'],excluded)).fetchone()
        self.assertIsNotNone(exclusion())
        renamed=self.people.update_person(self.db,b['id'],{'name':'renamed'},self.people.get_person(self.db,b['id'])['version'])
        self.people.undo(self.db,renamed['change_id'])
        self.assertIsNotNone(exclusion())
        merged=self.people.apply_merge(self.db,self.people.preview_merge(self.db,[b['id']],a['id'])['plan_id'])
        self.people.undo(self.db,merged['change_id'])
        self.assertIsNotNone(exclusion())
        self.assertEqual(self.db.execute('SELECT person_id FROM people_faces WHERE id=?',(face['id'],)).fetchone()[0],b['id'])

    def test_undo_refuses_later_outside_face_constraint_changes(self):
        mid=self.seed();face=self.face(mid);external=self.person('external');pid=face['person_id']
        renamed=self.people.update_person(self.db,pid,{'name':'named'},self.people.get_person(self.db,pid)['version'])
        self.db.execute('INSERT INTO people_face_exclusions(face_id,person_id) VALUES (?,?)',(face['id'],external['id']))
        with self.assertRaises(self.people.Conflict):self.people.undo(self.db,renamed['change_id'])
        self.assertIsNotNone(self.db.execute('SELECT 1 FROM people_face_exclusions WHERE face_id=? AND person_id=?',(face['id'],external['id'])).fetchone())

    def test_more_than_five_exemplars_cannot_drift_away_from_fixed_anchor(self):
        import math
        faces=[]
        for index in range(20):
            mid=self.seed(self.case/f'chain-{index}.jpg',media_type='image')
            faces.append(self.face(mid,vector=(math.cos(index*.18),math.sin(index*.18),0.)))
        first_group=[index for index,face in enumerate(faces) if face['person_id']==faces[0]['person_id']]
        self.assertLess(len(first_group),20)
        self.assertTrue(all(math.cos(index*.18)>=.6 for index in first_group))

    def test_rescan_reused_index_key_cannot_move_manual_identity_to_another_face(self):
        mid=self.seed(self.case/'two.jpg',media_type='image')
        initial=self.people.record_observations(self.db,mid,'revision','synthetic',[
            {'sample_key':'None:0','bbox':[.1,.1,.2,.3],'feature':[1.,0.,0.],'quality':.9,'score':.9},
            {'sample_key':'None:1','bbox':[.65,.1,.2,.3],'feature':[0.,1.,0.],'quality':.9,'score':.9}])['faces']
        left,right=initial
        self.people.decide_faces(self.db,[left['id']],'confirm')
        result=self.people.record_observations(self.db,mid,'revision','synthetic',[
            {'sample_key':'None:0','bbox':[.65,.1,.2,.3],'feature':[0.,1.,0.],'quality':.9,'score':.9}])['faces'][0]
        self.assertEqual(result['id'],right['id'])
        self.assertEqual(result['person_id'],right['person_id'])
        old=self.db.execute('SELECT * FROM people_faces WHERE id=?',(left['id'],)).fetchone()
        self.assertEqual(json.loads(old['bbox']),[.1,.1,.2,.3])
        self.assertEqual(old['person_id'],left['person_id'])
        self.assertEqual(old['active'],1)

    def test_rescan_key_collision_allocates_new_observation_without_reusing_wrong_face(self):
        mid=self.seed(self.case/'new-face.jpg',media_type='image')
        original=self.people.record_observations(self.db,mid,'revision','synthetic',[
            {'sample_key':'0:0','frame_time':0,'bbox':[.1,.1,.2,.3],'feature':[1.,0.,0.],'quality':.9,'score':.9}])['faces'][0]
        self.people.decide_faces(self.db,[original['id']],'confirm')
        observations=[{'sample_key':'0:0','frame_time':0,'bbox':[.65,.1,.2,.3],'feature':[0.,1.,0.],'quality':.9,'score':.9}]
        replacement=self.people.record_observations(self.db,mid,'revision','synthetic',observations)['faces'][0]
        self.assertNotEqual(replacement['id'],original['id'])
        self.assertNotEqual(replacement['sample_key'],original['sample_key'])
        again=self.people.record_observations(self.db,mid,'revision','synthetic',observations)['faces'][0]
        self.assertEqual(again['id'],replacement['id'])
        another_frame=[dict(observations[0],frame_time=10)]
        other=self.people.record_observations(self.db,mid,'revision','synthetic',another_frame)['faces'][0]
        self.assertNotEqual(other['id'],replacement['id'])

    def test_user_cover_stays_pinned_when_detector_misses_or_model_changes(self):
        mid=self.seed(self.case/'cover.jpg',media_type='image');face=self.face(mid);pid=face['person_id']
        self.people.update_person(self.db,pid,{'cover_face_id':face['id']},self.people.get_person(self.db,pid)['version'])
        self.people.record_observations(self.db,mid,'revision','synthetic',[])
        self.assertEqual(self.people.get_person(self.db,pid)['cover_face_id'],face['id'])
        self.assertEqual(self.people.get_person(self.db,pid)['manual_count'],0)
        self.people.record_observations(self.db,mid,'revision','new-model',[
            {'sample_key':'new','bbox':[.65,.1,.2,.3],'feature':[0.,1.,0.],'quality':.9,'score':.9}])
        self.assertEqual(self.people.get_person(self.db,pid)['cover_face_id'],face['id'])
        self.assertEqual(self.db.execute('SELECT assignment FROM people_faces WHERE id=?',(face['id'],)).fetchone()[0],'auto')
        self.people.record_observations(self.db,mid,'changed-source','synthetic',[])
        self.assertEqual(self.people.get_person(self.db,pid)['cover_face_id'],face['id'])

    def test_user_cover_invalidates_when_person_is_corrected_or_source_deleted(self):
        mid=self.seed(self.case/'cover.jpg',media_type='image');face=self.face(mid);pid=face['person_id']
        target=self.person('corrected')
        self.people.update_person(self.db,pid,{'cover_face_id':face['id']},self.people.get_person(self.db,pid)['version'])
        self.people.decide_faces(self.db,[face['id']],'move',target['id'])
        self.assertIsNone(self.people.get_person(self.db,pid)['cover_face_id'])
        self.people.update_person(self.db,target['id'],{'cover_face_id':face['id']},self.people.get_person(self.db,target['id'])['version'])
        self.db.execute('DELETE FROM media WHERE id=?',(mid,))
        self.assertIsNone(self.people.get_person(self.db,target['id'])['cover_face_id'])
        self.assertEqual(self.db.execute('PRAGMA foreign_key_check').fetchall(),[])


if __name__=='__main__':unittest.main()
