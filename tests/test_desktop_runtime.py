from support import DatabaseCase
from flask import Response, jsonify
from unittest.mock import patch
from backend.services.desktop_runtime import install_controls
from backend.services import taxonomy


class DesktopRuntimeTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.enterContext(patch('backend.local_vlm.download_status', return_value={'state': 'idle'}))
        self.enterContext(patch('backend.services.face_model_downloads.busy', return_value=False))
        self.classifier_download = self.enterContext(patch('backend.services.classification_models.busy', return_value=False))
        self.foreground = self.enterContext(patch('backend.services.classification_jobs.busy', return_value=False))
        install_controls(self.app, 'test', 'synthetic-instance')
        self.headers = {'X-Media-Manager-Instance': 'synthetic-instance'}

        @self.app.post('/write-probe')
        def write_probe():
            return {'ok': True}

        @self.app.post('/stream-probe')
        def stream_probe():
            return Response(iter([b'one\n', b'two\n']), mimetype='text/event-stream')

        @self.app.post('/error-probe')
        def error_probe():
            raise RuntimeError('synthetic request failure')

    def busy(self):
        return self.client.get('/api/desktop/activity').json['model_directory_busy']

    def prepare(self):
        return self.client.post('/api/desktop/model-directory/prepare', headers=self.headers)

    def test_health_and_idle_prepare_are_read_only_and_idempotent(self):
        self.assertFalse(self.busy())
        health = self.client.get('/api/desktop/health').json
        self.assertEqual(health['application'], 'media-manager')
        self.assertIn('models_root', health)
        self.assertEqual(self.prepare().json, {'ready': True})
        self.assertEqual(self.prepare().json, {'ready': True})
        self.assertEqual(self.client.post('/write-probe').status_code, 503)
        self.assertEqual(self.client.get('/api/desktop/health').status_code, 200)

    def test_untrusted_prepare_does_not_lock_writes(self):
        self.assertEqual(self.client.post('/api/desktop/model-directory/prepare').status_code, 403)
        self.assertEqual(self.client.post('/write-probe').status_code, 200)

    def test_streaming_import_or_time_edit_blocks_until_closed(self):
        stream = self.client.post('/stream-probe', buffered=False)
        self.assertTrue(self.busy())
        self.assertEqual(self.prepare().status_code, 409)
        stream.close()
        self.assertFalse(self.busy())
        self.assertEqual(self.prepare().status_code, 200)

    def test_failed_request_releases_its_activity_ticket(self):
        with self.assertRaisesRegex(RuntimeError, 'synthetic request failure'):
            self.client.post('/error-probe')
        self.assertFalse(self.busy())

    def test_foreground_import_and_playback_block_preparation(self):
        self.foreground.return_value = True
        self.assertEqual(self.prepare().status_code, 409)
        self.foreground.return_value = False
        self.assertEqual(self.prepare().status_code, 200)

    def test_analysis_and_background_queues_block_preparation(self):
        mid = self.seed(media_type='image', analysis_status='processing')
        self.assertEqual(self.prepare().status_code, 409)
        self.db.execute("UPDATE media SET analysis_status='completed' WHERE id=?", (mid,))
        self.db.commit()
        for table, columns, values in [
            ('people_jobs', 'media_id,input_revision,config_key', (mid, 'r1', 'm1')),
            ('taxonomy_jobs', 'media_id,stage,input_revision', (mid, 'fast', 'r1')),
        ]:
            with self.subTest(table=table):
                self.db.execute('INSERT INTO '+table+'('+columns+') VALUES (?,?,?)', values)
                self.db.commit()
                self.assertEqual(self.prepare().status_code, 409)
                self.db.execute('DELETE FROM '+table)
                self.db.commit()
        node = taxonomy.create_node(self.db, {'name': 'synthetic-node'})
        self.db.execute("INSERT INTO taxonomy_relation_jobs(tag_id,revision) VALUES (?,?)", (node['id'], 'r1'))
        self.db.commit()
        self.assertEqual(self.prepare().status_code, 409)

    def test_downloads_and_disconnected_creative_tasks_are_busy(self):
        with patch('backend.local_vlm.download_status', return_value={'state': 'downloading'}):
            self.assertEqual(self.prepare().status_code, 409)
        with patch('backend.services.face_model_downloads.busy', return_value=True):
            self.assertEqual(self.prepare().status_code, 409)
        self.classifier_download.return_value = True
        self.assertEqual(self.prepare().status_code, 409)
        self.classifier_download.return_value = False
        progress = {'done': False}
        self.app.extensions['creative_progress'] = {1: progress}
        self.assertEqual(self.prepare().status_code, 409)
        progress['done'] = True
        self.assertEqual(self.prepare().status_code, 200)
