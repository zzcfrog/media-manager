"""Feature-checked video track identities, with isolated libraries and synthetic vectors."""
from support import DatabaseCase
from backend.services import people, people_jobs


class VideoIdentityGroupingTests(DatabaseCase):
    def obs(self, key, vector=(1., 0.), track='one', **values):
        return {'sample_key': str(key), 'frame_time': float(key), 'bbox': [.1, .1, .3, .4],
                'feature': list(vector) if vector else None, 'quality': .95, 'score': .99,
                'track_id': track, **values}

    def record(self, mid, observations, **options):
        return people.record_observations(self.db, mid, 'revision', 'synthetic', observations,
                                          threshold=.55, tracked=True, **options)

    def test_continuous_track_with_different_poses_creates_one_identity(self):
        mid = self.seed()
        result = self.record(mid, [self.obs(0), self.obs(1, (.42, .907524)), self.obs(2, (.7, .714143))])
        self.assertEqual(len(result['created_person_ids']), 1)
        self.assertEqual(len({f['person_id'] for f in result['faces']}), 1)

    def test_track_consensus_matches_existing_person_despite_one_difficult_pose(self):
        old = self.seed(self.case/'old.jpg', media_type='image')
        anchor = people.record_observations(self.db, old, 'revision', 'synthetic', [self.obs(0)])['faces'][0]['person_id']
        mid = self.seed()
        result = self.record(mid, [self.obs(1, (.42, .907524)), self.obs(2)])
        self.assertEqual(result['created_person_ids'], [])
        self.assertEqual({f['person_id'] for f in result['faces']}, {anchor})

    def test_conflicting_track_features_wait_for_review_instead_of_creating_people(self):
        mid = self.seed()
        result = self.record(mid, [self.obs(0), self.obs(1, (0., 1.))])
        self.assertEqual(result['created_person_ids'], [])
        self.assertTrue(all(f['person_id'] is None for f in result['faces']))
        reviews = people.list_reviews(self.db, kind='face')
        self.assertEqual(len(reviews), 2)
        self.assertTrue(all(r['payload']['reason']=='track_conflict' for r in reviews))

    def test_different_tracks_and_missing_metadata_never_force_a_shared_identity(self):
        mid = self.seed()
        result = self.record(mid, [self.obs(0), self.obs(1, (0., 1.), track='two')])
        self.assertEqual(len({f['person_id'] for f in result['faces']}), 2)
        other = self.seed(self.case/'other.mov')
        result = self.record(other, [self.obs(0, track=None), self.obs(1, (0., 1.), track=None)])
        self.assertEqual(len({f['person_id'] for f in result['faces']}), 2)

    def test_reused_track_ids_in_different_videos_do_not_share_an_identity(self):
        first = self.record(self.seed(), [self.obs(0)])['faces'][0]
        second = self.record(self.seed(self.case/'second.mov'), [self.obs(0, (0., 1.))])['faces'][0]
        self.assertNotEqual(first['person_id'], second['person_id'])

    def test_existing_quality_review_becomes_track_review_without_disappearing(self):
        mid = self.seed()
        people.record_observations(self.db, mid, 'revision', 'synthetic', [self.obs(0, None), self.obs(1, None)])
        result = self.record(mid, [self.obs(0), self.obs(1, (0., 1.))])
        self.assertEqual(result['created_person_ids'], [])
        reviews = people.list_reviews(self.db, kind='face')
        self.assertEqual(len(reviews), 2)
        self.assertTrue(all(r['payload']['reason']=='track_conflict' for r in reviews))

    def test_rescan_no_longer_finding_a_face_resolves_its_automatic_track_review(self):
        mid = self.seed()
        self.record(mid, [self.obs(0), self.obs(1, (0., 1.))])
        self.record(mid, [])
        self.assertEqual(people.list_reviews(self.db, kind='face'), [])

    def test_dismissed_track_review_is_not_reopened_by_a_rescan(self):
        mid = self.seed()
        self.record(mid, [self.obs(0), self.obs(1, (0., 1.))])
        for review in people.list_reviews(self.db, kind='face'):people.review_decision(self.db, review['id'], 'dismiss')
        self.record(mid, [self.obs(0), self.obs(1, (0., 1.))])
        self.assertEqual(people.list_reviews(self.db, kind='face'), [])
    def test_ambiguous_track_waits_with_a_suggestion_without_creating_another_person(self):
        for index in range(2):
            mid = self.seed(self.case/(str(index)+'.jpg'), media_type='image')
            person = people.create_person(self.db, str(index))
            face = people.record_observations(self.db, mid, 'revision', 'synthetic', [self.obs(0)])['faces'][0]
            people.decide_faces(self.db, [face['id']], 'move', person['id'])
        mid = self.seed()
        count = self.db.execute('SELECT COUNT(*) FROM people_persons').fetchone()[0]
        result = self.record(mid, [self.obs(0), self.obs(1)])
        self.assertEqual(result['created_person_ids'], [])
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_persons').fetchone()[0], count)
        self.assertTrue(all(f['person_id'] is None for f in result['faces']))
        self.assertTrue(all(r['right'] for r in people.list_reviews(self.db, kind='face')))

    def test_manual_identity_in_a_later_sample_guides_new_faces_and_stays_manual(self):
        mid = self.seed()
        face = self.record(mid, [self.obs(2)])['faces'][0]
        target = people.create_person(self.db, '人工姓名')
        people.decide_faces(self.db, [face['id']], 'move', target['id'])
        result = self.record(mid, [self.obs(1, (.42, .907524)), self.obs(2)])
        self.assertEqual({f['person_id'] for f in result['faces']}, {target['id']})
        self.assertEqual(result['faces'][1]['assignment'], 'manual')

    def test_conflicting_manual_assignments_are_not_overwritten_or_merged(self):
        mid = self.seed()
        first = self.record(mid, [self.obs(0), self.obs(1)])['faces']
        targets = [people.create_person(self.db, name) for name in ('甲', '乙')]
        for face, target in zip(first, targets):people.decide_faces(self.db, [face['id']], 'move', target['id'])
        result = self.record(mid, [self.obs(0), self.obs(1), self.obs(2)])
        self.assertEqual([f['person_id'] for f in result['faces'][:2]], [p['id'] for p in targets])
        self.assertIsNone(result['faces'][2]['person_id'])
        self.assertEqual(result['created_person_ids'], [])

    def test_existing_automatic_identities_are_preserved_and_conflicting_track_is_flagged(self):
        mid = self.seed()
        old = people.record_observations(self.db, mid, 'revision', 'synthetic',
                                         [self.obs(0), self.obs(1, (.42, .907524))], threshold=.55)['faces']
        self.assertEqual(len({f['person_id'] for f in old}), 2)
        result = self.record(mid, [self.obs(0), self.obs(1, (.42, .907524)), self.obs(2)])
        self.assertEqual([f['person_id'] for f in result['faces'][:2]], [f['person_id'] for f in old])
        self.assertEqual(result['created_person_ids'], [])
        self.assertIsNone(result['faces'][2]['person_id'])

    def test_rescan_can_still_suggest_correcting_an_existing_automatic_identity(self):
        anchor_media = self.seed(self.case/'anchor.jpg', media_type='image')
        target = people.record_observations(self.db, anchor_media, 'revision', 'synthetic', [self.obs(0)])['faces'][0]['person_id']
        mid = self.seed()
        old = people.record_observations(self.db, mid, 'revision', 'synthetic', [self.obs(0, (.42, .907524))], threshold=.55)['faces'][0]['person_id']
        self.assertNotEqual(old, target)
        result = self.record(mid, [self.obs(0, (.42, .907524)), self.obs(1)])
        self.assertEqual({f['person_id'] for f in result['faces']}, {old})
        self.assertTrue(any(r['left_id']==old and r['right_id']==target for r in people.list_reviews(self.db, kind='face')))

    def test_media_exclusion_blocks_propagation_to_other_samples(self):
        mid = self.seed()
        face = self.record(mid, [self.obs(0)])['faces'][0]
        with self.db:
            self.db.execute("INSERT INTO people_media_decisions(person_id,media_id,decision) VALUES (?,?,'exclude')", (face['person_id'], mid))
        result = self.record(mid, [self.obs(0), self.obs(1)])
        self.assertIsNone(result['faces'][1]['person_id'])
        self.assertEqual(result['created_person_ids'], [])

    def test_not_face_decision_is_retained_and_does_not_poison_track_consensus(self):
        mid = self.seed()
        first = self.record(mid, [self.obs(0, (0., 1.))])['faces'][0]
        people.decide_faces(self.db, [first['id']], 'not_face')
        result = self.record(mid, [self.obs(0, (0., 1.)), self.obs(1), self.obs(2)])
        self.assertEqual(result['faces'][0]['assignment'], 'not_face')
        self.assertIsNone(result['faces'][0]['person_id'])
        self.assertEqual(len({f['person_id'] for f in result['faces'][1:]}), 1)

    def test_video_job_keeps_a_track_together_across_the_thousand_face_batch_boundary(self):
        mid = self.seed();people_jobs.enqueue(self.db, mid);self.db.commit();job = people_jobs.claim(self.db)
        rows = [self.obs(i, None, str(i), quality=.1) for i in range(997)]
        rows += [self.obs(997), self.obs(998), self.obs(999, (.42, .907524)), self.obs(1000, (.42, .907524))]
        payload = {'model_key':'synthetic', 'scope':'tracked_video', 'observations':rows}
        self.assertTrue(people_jobs.process(self.db, job, lambda db,j:payload))
        identities = self.db.execute('SELECT DISTINCT person_id FROM people_faces WHERE media_id=? AND frame_time>=997', (mid,)).fetchall()
        self.assertEqual(len(identities), 1)
        self.assertIsNotNone(identities[0][0])
