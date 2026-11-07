"""Rescan every pending review's media without deleting human decisions or using low-res caches."""
from unittest.mock import patch

from support import DatabaseCase
from backend.services import people, people_jobs as jobs


class PeopleReviewRescanTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        from backend.blueprints.people import bp
        self.app.register_blueprint(bp, url_prefix='/api/people')
        self.enterContext(patch.object(jobs, 'ensure_worker'))

    def observation(self, key='face'):
        return {'sample_key': key, 'bbox': [.1, .1, .3, .4], 'feature': None, 'quality': .1, 'score': .8}

    def review_media(self, name='review.jpg'):
        mid = self.seed(self.case / name, media_type='image')
        people.record_observations(self.db, mid, jobs.input_revision(self.db, mid), 'synthetic', [self.observation()])
        self.db.commit()
        return mid

    def start(self):
        return self.client.post('/api/people/jobs', json={'scope': 'review', 'existing': 'rescan'})

    def test_preview_and_queue_cover_both_review_kinds_deduplicate_and_skip_running(self):
        mid = self.review_media()
        people.record_observations(self.db, mid, jobs.input_revision(self.db, mid), 'synthetic',
                                   [self.observation('a'), {**self.observation('b'), 'bbox': [.6, .1, .3, .4]}])
        left = people.create_person(self.db, '左侧'); right = people.create_person(self.db, '右侧')
        other = self.seed(self.case / 'other.mov', media_type='video')
        unrelated = self.seed(self.case / 'unrelated.jpg', media_type='image')
        audio = self.seed(self.case / 'song.wav', media_type='audio')
        for pid, media in [(left['id'], mid), (right['id'], other), (left['id'], audio)]:
            self.db.execute("INSERT INTO people_media_decisions(person_id,media_id,decision) VALUES (?,?,'include')", (pid, media))
        people._review(self.db, 'merge', left['id'], right['id'])
        jid = jobs.enqueue(self.db, mid); self.db.commit(); running = jobs.claim(self.db)
        before = self.db.total_changes
        preview = self.client.get('/api/people/reviews/rescan')
        self.assertEqual(preview.status_code, 200, preview.json)
        self.assertEqual(preview.json, {'total': 2, 'active': 1})
        self.assertEqual(self.db.total_changes, before)
        response = self.start()
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json, {'total': 2, 'queued': 1, 'skipped': 1})
        self.assertEqual(self.db.execute('SELECT lease FROM people_jobs WHERE id=?', (jid,)).fetchone()[0], running['lease'])
        self.assertEqual({r[0] for r in self.db.execute('SELECT media_id FROM people_jobs')}, {mid, other})
        self.assertIsNone(self.db.execute('SELECT 1 FROM people_jobs WHERE media_id=?', (unrelated,)).fetchone())

    def test_all_pending_media_beyond_selection_and_pagination_limits_are_queued_once(self):
        for index in range(1005):
            self.review_media(str(index) + '.jpg')
        with patch('backend.services.face_engine.load_engine', side_effect=AssertionError('must not infer in queue request')):
            self.assertEqual(self.client.get('/api/people/reviews/rescan').json['total'], 1005)
            response = self.start()
        self.assertEqual(response.status_code, 200, response.json)
        self.assertEqual(response.json, {'total': 1005, 'queued': 1005, 'skipped': 0})
        self.assertEqual(self.start().json, {'total': 1005, 'queued': 0, 'skipped': 1005})

    def test_resolved_and_dismissed_are_excluded_but_pending_inactive_faces_are_included(self):
        for state in ('resolved', 'dismissed', 'inactive'):
            mid = self.review_media(state + '.jpg')
            if state == 'inactive':
                self.db.execute('UPDATE people_faces SET active=0 WHERE media_id=?', (mid,))
            else:
                self.db.execute('UPDATE people_reviews SET state=? WHERE face_id IN (SELECT id FROM people_faces WHERE media_id=?)', (state, mid))
        self.db.commit()
        self.assertEqual(self.client.get('/api/people/reviews/rescan').json, {'total': 1, 'active': 0})
        self.assertEqual(self.start().json, {'total': 1, 'queued': 1, 'skipped': 0})

    def test_disabled_model_or_skip_policy_cannot_silently_skip_rescan(self):
        self.review_media()
        response = self.client.post('/api/people/jobs', json={'scope': 'review', 'existing': 'skip'})
        self.assertEqual(response.status_code, 409, response.json)
        with self.db:
            self.db.execute("INSERT OR REPLACE INTO settings VALUES ('people_model_enabled','false')")
        self.assertEqual(self.start().status_code, 409)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0], 0)

    def test_empty_pending_scope_has_no_jobs_to_enqueue(self):
        self.assertEqual(self.client.get('/api/people/reviews/rescan').json, {'total': 0, 'active': 0})
        self.assertEqual(self.start().json, {'total': 0, 'queued': 0, 'skipped': 0})
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0], 0)

    def test_enqueue_preserves_reviews_and_human_identity_rescan_refreshes_quality(self):
        mid = self.review_media()
        face = self.db.execute('SELECT id FROM people_faces WHERE media_id=?', (mid,)).fetchone()[0]
        people.decide_faces(self.db, [face], 'new', name='已命名')
        people.record_observations(self.db, mid, jobs.input_revision(self.db, mid), 'synthetic',
                                   [{**self.observation('other'), 'bbox': [.6, .1, .3, .4]}])
        self.db.commit()
        identity = dict(self.db.execute('SELECT person_id,assignment FROM people_faces WHERE id=?', (face,)).fetchone())
        reviews = [tuple(r) for r in self.db.execute('SELECT * FROM people_reviews ORDER BY id')]
        changes = [tuple(r) for r in self.db.execute('SELECT * FROM people_changes ORDER BY id')]
        self.assertEqual(self.start().json['queued'], 1)
        self.assertEqual(reviews, [tuple(r) for r in self.db.execute('SELECT * FROM people_reviews ORDER BY id')])
        job = jobs.claim(self.db)
        self.assertTrue(jobs.process(self.db, job, lambda db, job: {'model_key': 'synthetic', 'scope': 'image_preview',
            'observations': [{**self.observation(), 'feature': [1., 0.], 'quality': .95}]}))
        self.assertEqual(identity, dict(self.db.execute('SELECT person_id,assignment FROM people_faces WHERE id=?', (face,)).fetchone()))
        self.assertEqual(self.db.execute('SELECT name FROM people_persons WHERE id=?', (identity['person_id'],)).fetchone()[0], '已命名')
        self.assertEqual(changes, [tuple(r) for r in self.db.execute('SELECT * FROM people_changes ORDER BY id')])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM people_reviews WHERE state='pending'").fetchone()[0], 0)

    def test_offline_low_res_rescan_waits_without_replacing_old_faces_or_reviews(self):
        from PIL import Image
        mid = self.review_media('offline.jpg')
        thumbs = self.case / 'thumbs'; thumbs.mkdir(); Image.new('RGB', (320, 240), 'gray').save(thumbs / 'old.jpg')
        self.db.execute("UPDATE media SET thumbnail_path='old.jpg' WHERE id=?", (mid,)); self.db.commit()
        before = [tuple(r) for r in self.db.execute('SELECT * FROM people_faces')]
        self.assertEqual(self.start().json['queued'], 1)
        with patch('backend.services.classification_jobs.busy', return_value=False), \
                patch('backend.services.face_engine.THUMB_DIR', thumbs), \
                patch('backend.services.face_engine.load_engine', side_effect=AssertionError('offline must wait before model load')):
            jobs._run(self.app, self.app.config['DATABASE'])
        row = self.db.execute('SELECT state,error FROM people_jobs').fetchone()
        self.assertEqual(row['state'], 'waiting')
        self.assertIn('高清预览', row['error'])
        self.assertEqual(before, [tuple(r) for r in self.db.execute('SELECT * FROM people_faces')])
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM people_reviews WHERE state='pending'").fetchone()[0], 1)
