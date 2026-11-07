"""People recognition continues until drained or explicitly paused, without a round cutoff."""
from unittest.mock import Mock, patch

from support import DatabaseCase
from backend.services import people_jobs as jobs


class PeopleSchedulerTests(DatabaseCase):
    def enqueue(self, name='photo.jpg', media_type='image'):
        mid = self.seed(self.case / name, media_type=media_type)
        jid = jobs.enqueue(self.db, mid)
        self.db.commit()
        return jid

    def row(self, jid):
        return dict(self.db.execute('SELECT * FROM people_jobs WHERE id=?', (jid,)).fetchone())

    def payload(self):
        return {'model_key': 'synthetic', 'observations': [], 'scope': 'image_preview'}

    def setting(self, key, value):
        with self.db:
            self.db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', (key, value))

    def test_queue_continues_after_multiple_long_media_cross_ten_minutes(self):
        ids = [self.enqueue('long.mov', 'video'), self.enqueue('next.jpg'), self.enqueue('last.jpg')]
        clock = [0]

        def infer(db, job):
            clock[0] += 1200
            self.assertFalse(job['_cancelled']())
            return self.payload()

        with patch.object(jobs.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch('backend.services.classification_jobs.busy', return_value=False), \
                patch.object(jobs, 'infer', side_effect=infer), \
                patch.object(jobs, 'ensure_worker') as restart:
            jobs._run(self.app, self.app.config['DATABASE'])
        self.assertEqual([self.row(jid)['state'] for jid in ids], ['no_faces'] * 3)
        restart.assert_not_called()

    def test_foreground_wait_longer_than_ten_minutes_resumes_automatically(self):
        jid = self.enqueue()
        clock = [0]
        foreground = [True]

        def wait(seconds):
            self.assertGreaterEqual(seconds, .1)
            self.assertEqual(self.row(jid)['state'], 'queued')
            clock[0] += 1200
            foreground[0] = False

        with patch.object(jobs.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch('backend.services.classification_jobs.busy', side_effect=lambda key: foreground[0]), \
                patch.object(jobs.threading, 'Event') as event, \
                patch.object(jobs, 'infer', return_value=self.payload()) as infer:
            event.return_value.wait.side_effect = wait
            jobs._run(self.app, self.app.config['DATABASE'])
        event.return_value.wait.assert_called_once()
        infer.assert_called_once()
        self.assertEqual(self.row(jid)['state'], 'no_faces')

    def test_waiting_for_shared_inference_slot_has_no_round_deadline(self):
        jid = self.enqueue()
        clock = [0]
        lock = Mock()

        def acquire(timeout):
            clock[0] += 1200
            return lock.acquire.call_count > 1

        lock.acquire.side_effect = acquire
        with patch.object(jobs.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch('backend.services.classification_jobs.busy', return_value=False), \
                patch('backend.services.background_work._inference_lock', lock), \
                patch.object(jobs, 'infer', return_value=self.payload()):
            jobs._run(self.app, self.app.config['DATABASE'])
        self.assertEqual(lock.acquire.call_count, 2)
        lock.release.assert_called_once()
        self.assertEqual(self.row(jid)['state'], 'no_faces')

    def test_mid_scan_foreground_interruption_requeues_then_finishes_without_partial_faces(self):
        jid = self.enqueue()
        foreground = [False]
        attempts = []

        def infer(db, job):
            attempts.append(job['id'])
            if len(attempts) == 1:
                foreground[0] = True
                self.assertTrue(job['_cancelled']())
                raise InterruptedError('synthetic foreground interruption')
            return self.payload()

        with patch('backend.services.classification_jobs.busy', side_effect=lambda key: foreground[0]), \
                patch.object(jobs.threading, 'Event') as event, \
                patch.object(jobs, 'infer', side_effect=infer):
            event.return_value.wait.side_effect = lambda seconds: foreground.__setitem__(0, False)
            jobs._run(self.app, self.app.config['DATABASE'])
        self.assertEqual(attempts, [jid, jid])
        self.assertEqual(self.row(jid)['state'], 'no_faces')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_faces').fetchone()[0], 0)

    def test_only_legacy_budget_pauses_recover_other_states_stay_unchanged(self):
        cases = [('paused', '达到本轮时间预算，可继续'), ('paused', '任务已暂停'),
                 ('waiting', '等待原文件'), ('failed', '本地整理失败'), ('cancelled', '')]
        ids = []
        for state, reason in cases:
            jid = self.enqueue(str(len(ids)) + '.jpg')
            with self.db:
                self.db.execute('UPDATE people_jobs SET state=?,error=? WHERE id=?', (state, reason, jid))
            ids.append(jid)
        with patch('backend.services.classification_jobs.busy', return_value=False), \
                patch.object(jobs, 'infer', return_value=self.payload()):
            jobs._run(self.app, self.app.config['DATABASE'])
        self.assertEqual([self.row(jid)['state'] for jid in ids],
                         ['no_faces', 'paused', 'waiting', 'failed', 'cancelled'])

    def test_manual_pause_or_disabled_model_prevents_legacy_recovery(self):
        jid = self.enqueue()
        with self.db:
            self.db.execute("UPDATE people_jobs SET state='paused',error='达到本轮时间预算，可继续' WHERE id=?", (jid,))
        for paused, enabled in [('true', 'true'), ('false', 'false')]:
            self.setting('people_paused', paused)
            self.setting('people_model_enabled', enabled)
            with patch.object(jobs, 'infer', side_effect=AssertionError('must remain paused')):
                jobs._run(self.app, self.app.config['DATABASE'])
            self.assertEqual(self.row(jid)['state'], 'paused')

    def test_manual_pause_cancel_and_model_disable_preserve_state_and_reject_late_results(self):
        for action, expected in [('pause', 'paused'), ('cancel', 'cancelled'), ('disable', 'paused')]:
            self.setting('people_paused', 'false')
            self.setting('people_model_enabled', 'true')
            jid = self.enqueue(action + '.jpg')

            def infer(db, job):
                if action == 'disable':
                    jobs.configure(db, {'model_enabled': False})
                else:
                    jobs.control(db, action)
                db.commit()
                self.assertTrue(job['_cancelled']())
                return {**self.payload(), 'observations': [{'sample_key': 'late', 'feature': [1., 0.]}]}

            with patch('backend.services.classification_jobs.busy', return_value=False), \
                    patch.object(jobs, 'infer', side_effect=infer):
                jobs._run(self.app, self.app.config['DATABASE'])
            self.assertEqual(self.row(jid)['state'], expected)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_faces').fetchone()[0], 0)

    def test_missing_media_and_inference_failure_do_not_stop_next_job_or_retry_forever(self):
        ids = [self.enqueue(str(i) + '.jpg') for i in range(3)]
        with patch('backend.services.classification_jobs.busy', return_value=False), \
                patch.object(jobs, 'infer', side_effect=[FileNotFoundError('synthetic missing'), RuntimeError('synthetic failure'), self.payload()]), \
                patch.object(jobs, 'ensure_worker') as restart:
            jobs._run(self.app, self.app.config['DATABASE'])
        self.assertEqual([self.row(jid)['state'] for jid in ids], ['waiting', 'failed', 'no_faces'])
        restart.assert_not_called()

    def test_interruption_does_not_report_a_nonexistent_time_budget(self):
        jid = self.enqueue()
        with patch('backend.services.classification_jobs.busy', return_value=False), \
                patch.object(jobs, 'infer', side_effect=InterruptedError('synthetic stop')):
            jobs._run(self.app, self.app.config['DATABASE'])
        self.assertEqual(self.row(jid)['state'], 'paused')
        self.assertNotIn('时间预算', self.row(jid)['error'])
