"""Header inventory uses isolated queues and synthetic request lifetimes."""
from unittest.mock import patch
from flask import Response

from support import DatabaseCase
from backend.services import background_tasks, classification_jobs, taxonomy, taxonomy_relations


class BackgroundTaskTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.enterContext(patch('backend.local_vlm.download_status', return_value={'state': 'idle'}))
        self.enterContext(patch('backend.services.classification_jobs.ensure_worker'))

    def snapshot(self):
        response = self.client.get('/api/background-tasks')
        self.assertEqual(response.status_code, 200)
        return response.json

    def enqueue(self, stage):
        mid = self.seed(self.case / (stage+'.jpg'), media_type='image')
        if stage == 'analysis':
            self.segments(mid)
        jid = classification_jobs.enqueue(self.db, mid, stage)
        self.db.commit()
        return jid

    def test_inventory_is_complete_without_including_sensitive_job_payloads(self):
        response = self.snapshot()
        self.assertEqual(len(response['supported_kinds']), 20)
        self.assertEqual(len(set(response['supported_kinds'])), 20)
        self.assertEqual(response['data'], [])
        self.assertTrue(set(background_tasks.REQUEST_KINDS.values()).issubset(response['supported_kinds']))
        self.assertTrue(set(background_tasks.REQUEST_KINDS).issubset(self.app.view_functions))

    def test_all_taxonomy_stages_and_relations_are_counted_beyond_recent_job_limits(self):
        ids = [self.enqueue(stage) for stage in ('fast', 'omni', 'analysis')]
        for i in range(205):
            mid = self.seed(self.case / (str(i)+'.jpg'), media_type='image')
            classification_jobs.enqueue(self.db, mid, 'fast')
        node = taxonomy.create_node(self.db, '山')
        taxonomy_relations.queue(self.db, node['id'], explicit=True)
        self.db.execute("UPDATE taxonomy_jobs SET state='waiting',error='sensitive-private-path' WHERE id=?", (ids[1],))
        self.db.commit()
        with patch('backend.services.classification_jobs.busy', return_value=True):
            response = self.snapshot()
        rows = {row['kind']: row for row in response['data']}
        self.assertEqual(set(rows), {'fast_classification', 'local_refinement', 'analysis_tags', 'relationships'})
        self.assertTrue(rows['fast_classification']['foreground_wait'])
        self.assertEqual(rows['fast_classification']['count'], 206)
        self.assertFalse(rows['analysis_tags']['foreground_wait'])
        self.assertEqual(rows['local_refinement']['counts'], {'waiting': 1})
        self.assertNotIn('sensitive-private-path', str(response))
        self.db.execute("UPDATE taxonomy_jobs SET state='done'")
        self.db.execute("UPDATE taxonomy_relation_jobs SET state='cancelled'")
        self.db.commit()
        self.assertEqual(self.snapshot()['data'], [])

    def test_controls_preserve_other_stages_and_manual_pauses_and_revoke_running_leases(self):
        fast = self.enqueue('fast')
        omni = self.enqueue('omni')
        self.db.execute("UPDATE taxonomy_jobs SET state='running',lease='old' WHERE id=?", (fast,))
        self.db.commit()
        response = self.client.post('/api/background-tasks/control', json={'kind': 'fast_classification', 'action': 'pause'})
        self.assertEqual(response.json['changed'], 1)
        self.assertEqual(tuple(self.db.execute('SELECT state,lease,error FROM taxonomy_jobs WHERE id=?', (fast,)).fetchone()), ('paused', None, '用户手动暂停'))
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_jobs WHERE id=?', (omni,)).fetchone()[0], 'queued')
        self.client.post('/api/background-tasks/control', json={'kind': 'fast_classification', 'action': 'resume'})
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_jobs WHERE id=?', (fast,)).fetchone()[0], 'queued')
        self.client.post('/api/background-tasks/control', json={'kind': 'fast_classification', 'action': 'cancel'})
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_jobs WHERE id=?', (fast,)).fetchone()[0], 'cancelled')

    def test_relationship_controls_respect_model_opt_out_and_do_not_change_media_jobs(self):
        self.enqueue('fast')
        node = taxonomy.create_node(self.db, '山')
        jid = taxonomy_relations.queue(self.db, node['id'], explicit=True)
        self.db.execute("INSERT OR REPLACE INTO settings(key,value) VALUES ('classification_omni_model','none')")
        self.db.commit()
        self.client.post('/api/background-tasks/control', json={'kind': 'relationships', 'action': 'resume'})
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_relation_jobs WHERE id=?', (jid,)).fetchone()[0], 'paused')
        self.assertEqual(self.db.execute('SELECT state FROM taxonomy_jobs').fetchone()[0], 'queued')

    def test_downloads_and_disconnected_creative_jobs_keep_their_actual_progress(self):
        self.app.extensions['creative_progress'] = {'synthetic': {'done': False, 'percent': 30}}
        with patch('backend.services.face_model_downloads.status', return_value={'state': 'downloading', 'done_bytes': 40, 'total_bytes': 100, 'error': 'private'}), \
                patch('backend.services.classification_models.status', return_value={'state': 'validating', 'done_bytes': 100, 'total_bytes': 100}):
            response = self.snapshot()
        rows = {row['id']: row for row in response['data']}
        self.assertEqual(rows['download:people']['progress'], .4)
        self.assertEqual(rows['download:classification']['progress'], 1)
        self.assertEqual(rows['creative']['progress'], .3)
        self.assertNotIn('private', str(response))

    def test_streaming_import_is_visible_until_closed_and_never_persists_input_paths(self):
        with patch.dict(self.app.view_functions, {'library.import_batch': lambda: Response(iter(['synthetic']))}):
            response = self.client.post('/api/library/import-batch', json={'paths': ['private-path']}, buffered=False)
            self.assertEqual(self.snapshot()['data'][0]['kind'], 'import')
            self.assertNotIn('private-path', str(self.snapshot()))
            response.close()
        self.assertEqual(self.snapshot()['data'], [])

    def test_failure_releases_request_ticket_and_invalid_controls_do_not_write(self):
        with patch.dict(self.app.view_functions, {'library.import_batch': lambda: (_ for _ in ()).throw(RuntimeError('synthetic'))}):
            with self.assertRaises(RuntimeError):
                self.client.post('/api/library/import-batch', json={})
        self.assertEqual(self.snapshot()['data'], [])
        for data in ({'kind': 'people', 'action': 'pause'}, {'kind': 'relationships', 'action': 'invalid'}, ['invalid']):
            self.assertEqual(self.client.post('/api/background-tasks/control', json=data).status_code, 400)
