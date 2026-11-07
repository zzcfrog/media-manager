"""Foreground-aware automatic continuation, without per-round resource cutoffs."""
from unittest.mock import patch

from support import DatabaseCase
from backend.services import classification_jobs as jobs, taxonomy as tx, taxonomy_relations as relations


class ClassificationSchedulerTests(DatabaseCase):
    def setting(self, key, value):
        self.db.execute('INSERT OR REPLACE INTO settings(key,value) VALUES (?,?)', (key, str(value)))
        self.db.commit()

    def enqueue(self, name='photo.jpg'):
        mid = self.seed(self.case / name, media_type='image')
        jid = jobs.enqueue(self.db, mid)
        self.db.commit()
        return jid

    def row(self, jid):
        return dict(self.db.execute('SELECT * FROM taxonomy_jobs WHERE id=?', (jid,)).fetchone())

    def test_old_time_and_memory_limits_do_not_stop_media_or_relationship_queues(self):
        self.setting('classification_budget_seconds', 1)
        self.setting('classification_resource_limit_mb', 256)
        ids = [self.enqueue(str(i)+'.jpg') for i in range(3)]
        node = tx.create_node(self.db, '山')
        relation = relations.queue(self.db, node['id'], explicit=True)
        self.db.commit()
        clock = [0]

        def infer(db, job):
            self.assertNotIn('_deadline', job)
            clock[0] += 1200
            return []

        def infer_relation(db, node, deadline, cancelled=None):
            self.assertEqual(deadline, float('inf'))
            clock[0] += 1200
            return [], 'synthetic'

        with patch.object(jobs.time, 'monotonic', side_effect=lambda: clock[0]), \
                patch.object(jobs, 'busy', return_value=False), \
                patch('backend.services.semantic_classifier.classify', side_effect=infer), \
                patch.object(relations, '_infer', side_effect=infer_relation), \
                patch.object(jobs, 'ensure_worker') as restart:
            jobs._run(self.app, self.app.config['DATABASE'])
        self.assertEqual([self.row(jid)['state'] for jid in ids], ['done']*3)
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?', (relation,)).fetchone()[0], 'done')
        restart.assert_not_called()

    def test_queued_work_waits_for_foreground_then_completes_without_manual_resume(self):
        jid = self.enqueue()
        foreground = [True]

        def wait(seconds):
            self.assertGreaterEqual(seconds, .1)
            self.assertEqual(self.row(jid)['state'], 'queued')
            foreground[0] = False

        with patch.object(jobs, 'busy', side_effect=lambda key: foreground[0]), \
                patch.object(jobs.threading, 'Event') as event, \
                patch('backend.services.semantic_classifier.classify', return_value=[]) as infer:
            event.return_value.wait.side_effect = wait
            jobs._run(self.app, self.app.config['DATABASE'])
        event.return_value.wait.assert_called_once()
        infer.assert_called_once()
        self.assertEqual(self.row(jid)['state'], 'done')

    def test_repeated_foreground_interruptions_keep_job_retryable_and_discard_partial_results(self):
        jid = self.enqueue()
        foreground = [False]

        def infer(db, job):
            foreground[0] = True
            self.assertTrue(job['_cancelled']())
            return [{'term': '不应写入'}]

        with patch.object(jobs, 'busy', side_effect=lambda key: foreground[0]):
            for _ in range(5):
                foreground[0] = False
                job = jobs.claim(self.db)
                self.assertEqual(job['id'], jid)
                self.assertFalse(jobs.process(self.db, job, infer=infer))
                row = self.row(jid)
                self.assertEqual((row['state'], row['lease'], row['attempts']), ('queued', None, 0))
            foreground[0] = False
            self.assertTrue(jobs.process(self.db, jobs.claim(self.db), infer=lambda db, job: []))
        self.assertEqual(self.row(jid)['state'], 'done')
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_candidates').fetchone()[0], 0)

    def test_foreground_yield_does_not_override_a_manual_pause_or_cancel(self):
        for state in ('paused', 'cancelled'):
            jid = self.enqueue(state+'.jpg')
            foreground = [False]

            def infer(db, job):
                with db:
                    db.execute('UPDATE taxonomy_jobs SET state=?,lease=NULL WHERE id=?', (state, jid))
                foreground[0] = True
                return [{'term': '不应写入'}]

            with patch.object(jobs, 'busy', side_effect=lambda key: foreground[0]):
                self.assertFalse(jobs.process(self.db, jobs.claim(self.db), infer=infer))
            self.assertEqual(self.row(jid)['state'], state)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM taxonomy_candidates').fetchone()[0], 0)

    def test_only_legacy_budget_pauses_resume_and_waiting_or_explicit_pauses_remain(self):
        ids = []
        for reason in ('已达到本轮时间预算', '达到本轮额外内存预算', '任务已暂停'):
            jid = self.enqueue(str(len(ids))+'.jpg')
            self.db.execute("UPDATE taxonomy_jobs SET state='paused',error=? WHERE id=?", (reason, jid))
            ids.append(jid)
        missing = self.enqueue('missing.jpg')
        self.db.execute("UPDATE taxonomy_jobs SET state='waiting' WHERE id=?", (missing,))
        node = tx.create_node(self.db, '山')
        relation = relations.queue(self.db, node['id'], explicit=True)
        self.db.execute("UPDATE taxonomy_relation_jobs SET state='paused',error='已达到本轮时间预算' WHERE id=?", (relation,))
        self.db.commit()
        with patch.object(jobs, 'busy', return_value=False), \
                patch('backend.services.semantic_classifier.classify', return_value=[]), \
                patch.object(relations, '_infer', return_value=([], 'synthetic')):
            jobs._run(self.app, self.app.config['DATABASE'])
        self.assertEqual([self.row(jid)['state'] for jid in ids], ['done', 'done', 'paused'])
        self.assertEqual(self.row(missing)['state'], 'waiting')
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?', (relation,)).fetchone()[0], 'done')

    def test_missing_model_is_visible_waiting_without_an_automatic_retry_loop(self):
        jid = self.enqueue()
        with patch.object(jobs, 'busy', return_value=False), \
                patch('backend.services.semantic_classifier.classify', side_effect=FileNotFoundError('synthetic missing model')), \
                patch.object(jobs, 'ensure_worker') as restart:
            jobs._run(self.app, self.app.config['DATABASE'])
        self.assertEqual(self.row(jid)['state'], 'waiting')
        restart.assert_not_called()
