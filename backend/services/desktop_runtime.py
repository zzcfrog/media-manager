"""Desktop health and a quiescence gate for changing model paths safely."""
import hmac
import os
import threading

from flask import g, jsonify, request

from ..config import MODELS_ROOT
from ..db import get_db


def install_controls(app, version, instance):
    gate = threading.RLock()
    state = {'switching': False, 'writes': 0}

    def release(ticket):
        with gate:
            if ticket['active']:
                ticket['active'] = False
                state['writes'] -= 1

    @app.before_request
    def guard_writes():
        g.desktop_write = None
        if request.method in ('GET', 'HEAD', 'OPTIONS') or request.path == '/api/desktop/model-directory/prepare':
            return
        with gate:
            if state['switching']:
                return jsonify({'error': '正在切换模型目录，请稍候'}), 503
            state['writes'] += 1
            g.desktop_write = {'active': True}

    @app.after_request
    def finish_write(response):
        ticket = getattr(g, 'desktop_write', None)
        if ticket:
            if response.is_streamed:
                response.call_on_close(lambda: release(ticket))
            else:
                release(ticket)
        return response

    @app.teardown_request
    def failed_write(error):
        if error and getattr(g, 'desktop_write', None):
            release(g.desktop_write)

    def activity():
        from backend import local_vlm
        from .classification_jobs import busy as foreground_busy
        from .face_model_downloads import busy as face_download_busy
        from .classification_models import busy as classification_download_busy

        db = get_db()
        processing = db.execute("SELECT EXISTS(SELECT 1 FROM media WHERE analysis_status='processing')").fetchone()[0]
        downloads = local_vlm.download_status()['state'] == 'downloading' or face_download_busy(app.config['DATABASE']) or classification_download_busy(app.config['DATABASE'])
        pending = db.execute("""SELECT
            EXISTS(SELECT 1 FROM people_jobs WHERE state IN ('queued','running')) OR
            EXISTS(SELECT 1 FROM taxonomy_jobs WHERE state IN ('queued','running')) OR
            EXISTS(SELECT 1 FROM taxonomy_relation_jobs WHERE state IN ('queued','running'))""").fetchone()[0]
        creative = any(not job['done'] for job in tuple(app.extensions.get('creative_progress', {}).values()))
        with gate:
            return {'busy': bool(processing or downloads),
                    'model_directory_busy': bool(processing or downloads or pending or creative or state['writes'] or foreground_busy(app.config['DATABASE'])),
                    'supports_model_directory_apply': True}

    @app.get('/api/desktop/health')
    def health():
        return {'application': 'media-manager', 'version': version, 'pid': os.getpid(),
                'instance': instance, 'models_root': str(MODELS_ROOT)}

    app.add_url_rule('/api/desktop/activity', 'desktop_activity', activity, methods=['GET'])

    @app.post('/api/desktop/model-directory/prepare')
    def prepare_directory_switch():
        if not instance or not hmac.compare_digest(request.headers.get('X-Media-Manager-Instance', ''), instance):
            return jsonify({'error': 'Invalid desktop instance'}), 403
        with gate:
            if state['switching']:
                return {'ready': True}
            if activity()['model_directory_busy']:
                return jsonify({'error': '请先完成或停止导入、分析、识别及下载任务，再切换模型目录'}), 409
            state['switching'] = True
            return {'ready': True}
