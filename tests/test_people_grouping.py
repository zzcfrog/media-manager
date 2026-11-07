"""Grouping controls and calibration use isolated identities and synthetic vectors."""
import math

from support import DatabaseCase
from backend.services import people, people_jobs, people_grouping


class PeopleGroupingTests(DatabaseCase):
    def pair(self, score=.5, model='synthetic'):
        result=[]
        for vector in ([1.,0.],[score,math.sqrt(1-score*score)]):
            mid=self.seed(self.case/(str(self.db.execute('SELECT COUNT(*) FROM media').fetchone()[0])+'.jpg'),media_type='image')
            result.append(people.record_observations(self.db,mid,'revision',model,[{'sample_key':'one','bbox':[0.,0.,.5,.5],'feature':vector,'quality':.95,'score':.99}],threshold=1.1,review_threshold=1.1)['faces'][0])
        return result

    def merge_pair(self, score=.5, model='synthetic'):
        a,b=self.pair(score,model)
        plan=people.preview_merge(self.db,[b['person_id']],a['person_id'])
        return people.apply_merge(self.db,plan['plan_id'])

    def test_default_threshold_is_lower_and_manual_settings_validate_atomically(self):
        cfg=people_jobs.settings(self.db)
        self.assertEqual(cfg['similarity_threshold'],.55);self.assertTrue(cfg['adaptive_threshold'])
        for value in (.45,.55,.85):
            self.assertEqual(people_jobs.configure(self.db,{'similarity_threshold':value})['similarity_threshold'],value)
        baseline=list(self.db.execute('SELECT * FROM settings ORDER BY key'))
        for value in (.44,.86,.555,float('nan'),float('inf'),None,'0.55',True):
            with self.assertRaises(people.Conflict):people_jobs.configure(self.db,{'similarity_threshold':value})
            self.assertEqual(list(self.db.execute('SELECT * FROM settings ORDER BY key')),baseline)
        with self.assertRaises(people.Conflict):people_jobs.configure(self.db,{'adaptive_threshold':'true'})

    def test_lower_default_and_saved_threshold_change_future_assignments(self):
        first=self.pair(.57)
        mid=self.seed(self.case/'third.jpg',media_type='image')
        obs={'sample_key':'one','bbox':[0.,0.,.5,.5],'feature':[1.,0.],'quality':.95,'score':.99}
        # One candidate avoids the independent best-versus-runner-up ambiguity gate.
        self.db.execute('UPDATE people_faces SET active=0 WHERE id=?',(first[0]['id'],))
        self.assertEqual(people.record_observations(self.db,mid,'revision','synthetic',[obs])['faces'][0]['person_id'],first[1]['person_id'])
        people_jobs.configure(self.db,{'similarity_threshold':.65,'adaptive_threshold':False})
        self.db.execute('UPDATE people_faces SET active=0 WHERE media_id=?',(mid,))
        another=self.seed(self.case/'fourth.jpg',media_type='image')
        self.assertNotEqual(people.record_observations(self.db,another,'revision','synthetic',[obs])['faces'][0]['person_id'],first[1]['person_id'])

    def test_five_merges_relax_only_the_current_model_with_a_bounded_offset(self):
        for _ in range(4):self.merge_pair()
        self.assertEqual(people_grouping.calibration(self.db,'synthetic')['effective_threshold'],.55)
        self.merge_pair()
        result=people_grouping.calibration(self.db,'synthetic')
        self.assertEqual(result['positive_feedback'],5);self.assertEqual(result['effective_threshold'],.50)
        other=people_grouping.calibration(self.db,'other-model')
        self.assertEqual(other['positive_feedback'],0);self.assertEqual(other['effective_threshold'],.55)
        people_jobs.configure(self.db,{'adaptive_threshold':False})
        self.assertEqual(people_grouping.calibration(self.db,'synthetic')['effective_threshold'],.55)

    def test_different_people_feedback_can_tighten_and_undo_removes_feedback(self):
        changes=[]
        for _ in range(3):
            a,b=self.pair(.8)
            people._review(self.db,'merge',a['person_id'],b['person_id'])
            review=self.db.execute('SELECT id FROM people_reviews ORDER BY id DESC LIMIT 1').fetchone()[0]
            changes.append(people.review_decision(self.db,review,'different')['change_id'])
        self.assertEqual(people_grouping.calibration(self.db,'synthetic')['effective_threshold'],.60)
        people.undo(self.db,changes[-1])
        result=people_grouping.calibration(self.db,'synthetic')
        self.assertEqual(result['negative_feedback'],2);self.assertEqual(result['effective_threshold'],.55)

    def test_split_is_negative_feedback_and_ignored_or_undone_operations_do_not_teach(self):
        a,b=self.pair(.58)
        people.decide_faces(self.db,[b['id']],'move',a['person_id'])
        change=people.decide_faces(self.db,[b['id']],'new')
        result=people_grouping.calibration(self.db,'synthetic')
        self.assertEqual(result['negative_feedback'],1)
        people.undo(self.db,change['change_id'])
        self.assertEqual(people_grouping.calibration(self.db,'synthetic')['negative_feedback'],0)
        people._review(self.db,'merge',a['person_id'],b['person_id'])
        rid=self.db.execute('SELECT id FROM people_reviews ORDER BY id DESC LIMIT 1').fetchone()[0]
        people.review_decision(self.db,rid,'dismiss')
        self.assertEqual(people_grouping.calibration(self.db,'synthetic')['negative_feedback'],0)

    def test_settings_do_not_replace_or_restart_pending_scan_jobs(self):
        mid=self.seed(media_type='image');people_jobs.enqueue(self.db,mid)
        rows=[tuple(r) for r in self.db.execute('SELECT * FROM people_jobs')]
        key=people_jobs._config_key(self.db,'image')
        people_jobs.configure(self.db,{'similarity_threshold':.50,'adaptive_threshold':False})
        self.assertEqual(people_jobs._config_key(self.db,'image'),key)
        self.assertEqual([tuple(r) for r in self.db.execute('SELECT * FROM people_jobs')],rows)

    def test_low_quality_empty_groups_and_other_human_actions_do_not_calibrate(self):
        for _ in range(5):
            a,b=self.pair()
            self.db.execute('UPDATE people_faces SET quality=.1 WHERE id IN (?,?)',(a['id'],b['id']))
            plan=people.preview_merge(self.db,[b['person_id']],a['person_id']);people.apply_merge(self.db,plan['plan_id'])
        result=people_grouping.calibration(self.db,'synthetic')
        self.assertEqual(result['positive_feedback'],0);self.assertEqual(result['effective_threshold'],.55)
        p=people.create_person(self.db)
        people.update_person(self.db,p['id'],{'name':'synthetic name'},p['version'])
        self.assertEqual(people_grouping.calibration(self.db,'synthetic'),result)

    def test_negative_feedback_takes_priority_over_positive_merges(self):
        for _ in range(5):self.merge_pair()
        for _ in range(3):
            a,b=self.pair(.8);people._review(self.db,'merge',a['person_id'],b['person_id'])
            rid=self.db.execute('SELECT id FROM people_reviews ORDER BY id DESC LIMIT 1').fetchone()[0]
            people.review_decision(self.db,rid,'different')
        result=people_grouping.calibration(self.db,'synthetic')
        self.assertEqual((result['positive_feedback'],result['negative_feedback']),(5,3))
        self.assertEqual(result['effective_threshold'],.60)

    def test_grouping_api_exposes_only_scalar_statistics_and_rejects_bad_thresholds(self):
        from backend.blueprints.people import bp
        self.app.register_blueprint(bp,url_prefix='/api/people')
        status=self.client.get('/api/people/status')
        self.assertEqual(status.status_code,200);self.assertEqual(status.json['grouping']['effective_threshold'],.55)
        self.assertNotIn('feature',status.json['grouping']);self.assertNotIn('samples',status.json['grouping'])
        for value in (.44,.86,.555,True,'0.55'):
            response=self.client.patch('/api/people/settings',json={'similarity_threshold':value})
            self.assertEqual(response.status_code,409);self.assertEqual(people_jobs.settings(self.db)['similarity_threshold'],.55)
        self.assertEqual(self.client.patch('/api/people/settings',json={'similarity_threshold':.50,'adaptive_threshold':False}).status_code,200)
