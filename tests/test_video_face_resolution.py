"""Independent video-face resolution settings and real synthetic-frame decoding."""
from support import DatabaseCase
import hashlib
import importlib
import json
import subprocess
from types import SimpleNamespace
from unittest.mock import patch
from backend.services import people_jobs as jobs


class VideoFaceResolutionTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        from backend.blueprints.people import bp
        self.app.register_blueprint(bp, url_prefix='/api/people')

    def test_default_and_only_two_choices_round_trip_without_inference(self):
        self.assertEqual(jobs.settings(self.db).get('video_resolution'), '1080p')
        for mode, resolution in [('original', None), ('1080p', 1080)]:
            with patch('backend.services.people_jobs.ensure_worker'):
                response = self.client.patch('/api/people/settings', json={'video_resolution': mode})
            self.assertEqual(response.status_code, 200, response.json)
            self.assertEqual(response.json['video_resolution'], mode)
            self.assertEqual(self.client.get('/api/people/status').json['settings']['video_resolution'], mode)
            self.assertEqual(jobs.video_settings(self.db), {'res': resolution, 'fps': 1})
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0], 0)
        before = jobs.settings(self.db)
        for invalid in (None, True, False, 1080, 2160, '720p', '4k', '', [], {}):
            response = self.client.patch('/api/people/settings', json={'video_resolution': invalid, 'video_fps': 3})
            self.assertEqual(response.status_code, 409, response.json)
            self.assertEqual(jobs.settings(self.db), before)

    def test_video_analysis_settings_are_independent_and_photo_job_keys_stay_compatible(self):
        options = jobs._model_options(jobs.settings(self.db))
        legacy = ['', 'buffalo_l', options, {'res': 480}, 'people-v5-sampled-tracks']
        photo_key = hashlib.sha256(json.dumps(legacy, sort_keys=True).encode()).hexdigest()
        self.assertEqual(jobs._config_key(self.db, 'image'), photo_key)
        video_keys = set()
        for mode in ('1080p', 'original'):
            jobs.configure(self.db, {'video_resolution': mode})
            video_keys.add(jobs._config_key(self.db, 'video'))
            self.assertEqual(jobs._config_key(self.db, 'image'), photo_key)
        self.assertEqual(len(video_keys), 2)
        before = jobs._config_key(self.db, 'video')
        for key, value in {'video_engine': 'local', 'local_frames_res': '240', 'resolution': '720', 'fps': '60', 'local_frames_fps': '.25'}.items():
            self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)', (key, value))
        self.assertEqual(jobs.video_settings(self.db), {'res': None, 'fps': 1})
        self.assertEqual(jobs._config_key(self.db, 'video'), before)

    def test_finished_results_stay_finished_and_paused_jobs_resume_in_the_new_mode(self):
        done = self.seed(self.case / 'done.mov', media_type='video')
        pending = self.seed(self.case / 'pending.mov', media_type='video')
        photo = self.seed(self.case / 'photo.jpg', media_type='image')
        done_id, pending_id, photo_id = [jobs.enqueue(self.db, mid) for mid in (done, pending, photo)]
        self.db.execute("UPDATE people_jobs SET state='done' WHERE id=?", (done_id,))
        jobs.control(self.db, 'pause')
        jobs.configure(self.db, {'video_resolution': 'original'})
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?', (pending_id,)).fetchone()[0], 'paused')
        self.assertEqual(jobs.enqueue_scope(self.db, {'scope': 'selected', 'media_ids': [done], 'existing': 'skip'})['skipped'], 1)
        jobs.control(self.db, 'resume'); self.db.commit()
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?', (done_id,)).fetchone()[0], 'done')
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?', (photo_id,)).fetchone()[0], 'queued')
        replacement = self.db.execute("SELECT * FROM people_jobs WHERE media_id=? AND state='queued'", (pending,)).fetchone()
        self.assertNotEqual(replacement['id'], pending_id)
        self.assertEqual(replacement['config_key'], jobs._config_key(self.db, 'video'))

    def test_queued_video_is_rebound_before_inference_and_running_video_is_safely_requeued(self):
        active = self.seed(self.case / 'active.mov', media_type='video')
        queued = self.seed(self.case / 'queued.mov', media_type='video')
        original_id = jobs.enqueue(self.db, active)
        queued_id = jobs.enqueue(self.db, queued)
        self.db.commit(); running = jobs.claim(self.db)
        self.assertEqual(running['id'], original_id)
        jobs.configure(self.db, {'video_resolution': 'original'}); self.db.commit()
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?', (original_id,)).fetchone()[0], 'stale')
        claimed = []
        for _ in range(2):
            job = jobs.claim(self.db)
            self.assertIsNotNone(job)
            self.assertEqual(job['config_key'], jobs._config_key(self.db, 'video'))
            claimed.append(job['media_id'])
        self.assertCountEqual(claimed, [active, queued])
        self.assertEqual(self.db.execute('SELECT state FROM people_jobs WHERE id=?', (queued_id,)).fetchone()[0], 'stale')

    def test_inference_forwards_each_resolution_to_the_isolated_video_worker(self):
        mid = self.seed(media_type='video')
        for mode, resolution in [('1080p', 1080), ('original', None)]:
            jobs.configure(self.db, {'video_resolution': mode})
            pipeline = SimpleNamespace(model_key='synthetic', stats={}, run=lambda: iter(()))
            with patch('backend.services.video_runtime.VideoResult', return_value=pipeline) as adapter:
                payload = jobs.infer(self.db, {'media_id': mid, '_cancelled': lambda: False})
            self.assertEqual(adapter.call_args.args[2], resolution)
            payload['observations'].close()

    def encode(self, path, size):
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-f', 'lavfi', '-i',
                        f'color=c=green:s={size}:r=2:d=1', '-c:v', 'libx264', '-preset', 'ultrafast',
                        '-pix_fmt', 'yuv420p', str(path)], check=True, timeout=20)

    def test_decoder_returns_real_1080p_and_original_frames_with_no_intermediate_files(self):
        video = importlib.import_module('backend.services.video_people')
        path = self.case / 'source.mp4'; self.encode(path, '3840x2160')
        before = hashlib.sha256(path.read_bytes()).hexdigest()
        for resolution, size in [(1080, (1920, 1080)), (None, (3840, 2160))]:
            rows = list(video.iter_frames(path, resolution, lambda: False, fps=1))
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0][1].size, size)
            self.assertEqual(rows[0][0], 0.)
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), before)
        self.assertEqual([p.name for p in self.case.glob('*.mp4')], ['source.mp4'])
        self.assertEqual(list(self.case.glob('**/*.jpg')), [])

    def test_portrait_aspect_ratio_and_small_video_are_not_upscaled(self):
        video = importlib.import_module('backend.services.video_people')
        for name, source_size, expected in [('portrait', '2160x3840', (1080, 1920)), ('small', '320x180', (320, 180))]:
            path = self.case / (name + '.mp4'); self.encode(path, source_size)
            frames = list(video.iter_frames(path, 1080, lambda: False, fps=1))
            self.assertEqual(frames[0][1].size, expected)

    def test_real_worker_accepts_original_null_and_switches_modes_without_restart(self):
        from face_model_fixtures import model_bytes
        from backend.services.video_runtime import VideoRuntime
        path = self.case / 'worker.mp4'; self.encode(path, '1920x1080')
        files = {}
        for stage in ('detector', 'recognizer'):
            file = self.case / (stage + '.onnx'); file.write_bytes(model_bytes(stage))
            files[stage + '_path'] = str(file)
        cfg = {**jobs.settings(self.db), 'profile': 'custom', **files, 'verify_enabled': False}
        runtime = VideoRuntime(); self.addCleanup(runtime.close)
        pids = set(); keys = set()
        for resolution in (1080, None, 1080):
            events = list(runtime.run({'settings': cfg, 'path': str(path), 'resolution': resolution}, lambda: False))
            self.assertEqual(events[-1]['event'], 'done', events[-1])
            self.assertEqual(events[-1]['stats']['decoded_frames'], 1)
            pids.add(runtime.process.pid); keys.add(events[0]['model_key'])
        self.assertEqual(len(pids), 1)
        self.assertEqual(len(keys), 1)
