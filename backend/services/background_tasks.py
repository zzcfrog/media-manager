"""Read-only header summaries; persistent job controls retain lease cancellation."""
import threading
from collections import Counter

from flask import current_app, g, jsonify, request

from ..db import get_db

# AI analysis / preload / people retain their existing detailed header adapters.
# Model-directory migration runs in Electron and is reported by the renderer.
TASK_KINDS = (
    'image_analysis', 'video_analysis', 'audio_analysis', 'model_preload', 'people',
    'fast_classification', 'local_refinement', 'analysis_tags', 'relationships',
    'model_download', 'creative', 'import', 'sync', 'embeddings', 'thumbnails',
    'metadata_write', 'file_time', 'duplicates', 'export', 'model_migration',
)
REQUEST_KINDS = {
    'library.import_one': 'import', 'library.import_batch': 'import', 'library.scan_paths': 'import',
    'library.sync_folder': 'sync', 'library.backfill_embeddings': 'embeddings',
    'library.backfill_thumbnails': 'thumbnails', 'library.write_xmp': 'metadata_write',
    'library.batch_write_xmp': 'metadata_write', 'library.set_file_date_from_exif': 'file_time',
    'library.shift_creation_time': 'file_time', 'library.shift_shooting_time': 'file_time',
    'library.find_duplicates': 'duplicates', 'workbench.export_fcpxml': 'export',
}
STAGES = {'fast_classification': 'fast', 'local_refinement': 'omni', 'analysis_tags': 'analysis'}
PENDING = ('queued', 'running', 'paused', 'waiting', 'failed')


def snapshot(db):
    from .classification_jobs import busy
    from . import classification_models, face_model_downloads
    from .. import local_vlm

    key = current_app.config['DATABASE']
    foreground = busy(key)
    rows = []
    for kind, stage in (*STAGES.items(), ('relationships', None)):
        table = 'taxonomy_jobs' if stage else 'taxonomy_relation_jobs'
        counts = dict(db.execute('SELECT state,COUNT(*) FROM '+table+
                      " WHERE state IN ('queued','running','paused','waiting','failed')"+
                      (' AND stage=?' if stage else '')+' GROUP BY state', (stage,) if stage else ()))
        if counts:
            rows.append({'id': kind, 'kind': kind, 'counts': counts, 'count': sum(counts.values()),
                         'foreground_wait': bool(foreground and stage != 'analysis' and counts.get('queued')),
                         'controllable': True})
    for source, status in (('local', local_vlm.download_status()), ('people', face_model_downloads.status(key)),
                           ('classification', classification_models.status(key))):
        if status['state'] in ('downloading', 'validating', 'error'):
            total = status.get('total_bytes', 0)
            rows.append({'id': 'download:'+source, 'kind': 'model_download', 'source': source, 'count': 1,
                         'counts': {'failed' if status['state'] == 'error' else 'running': 1},
                         'phase': status['state'],
                         'progress': min(1, max(0, status.get('done_bytes', 0)/total)) if total else None})
    creative = [job for job in tuple(current_app.extensions.get('creative_progress', {}).values()) if not job['done']]
    if creative:
        rows.append({'id': 'creative', 'kind': 'creative', 'count': len(creative), 'counts': {'running': len(creative)},
                     'progress': sum(job.get('percent', 0) for job in creative)/len(creative)/100})
    requests = current_app.extensions['background_requests']
    with requests['lock']:
        counts = Counter(ticket['kind'] for ticket in requests['active'].values())
    rows.extend({'id': kind, 'kind': kind, 'count': count, 'counts': {'running': count}} for kind, count in counts.items())
    return {'data': rows, 'supported_kinds': TASK_KINDS}


def install(app):
    requests = app.extensions['background_requests'] = {'lock': threading.Lock(), 'active': {}}

    def release(ticket):
        with requests['lock']:
            requests['active'].pop(id(ticket), None)

    @app.before_request
    def start_request():
        g.header_task = None
        kind = REQUEST_KINDS.get(request.endpoint)
        if kind:
            ticket = {'kind': kind}
            with requests['lock']:
                requests['active'][id(ticket)] = ticket
            g.header_task = ticket

    @app.after_request
    def finish_request(response):
        ticket = getattr(g, 'header_task', None)
        if ticket:
            if response.is_streamed:
                response.call_on_close(lambda: release(ticket))
            else:
                release(ticket)
        return response

    @app.teardown_request
    def failed_request(error):
        ticket = getattr(g, 'header_task', None)
        if error and ticket:
            release(ticket)

    @app.get('/api/background-tasks')
    def background_tasks():
        return jsonify(snapshot(get_db()))

    @app.post('/api/background-tasks/control')
    def control_background_tasks():
        data = request.get_json(silent=True) or {}
        if not isinstance(data, dict):
            return jsonify({'error': '任务操作格式无效'}), 400
        kind, action = data.get('kind'), data.get('action')
        if kind not in (*STAGES, 'relationships') or action not in ('pause', 'resume', 'cancel'):
            return jsonify({'error': '任务类型或操作无效'}), 400
        db = get_db()
        stage = STAGES.get(kind)
        table = 'taxonomy_jobs' if stage else 'taxonomy_relation_jobs'
        old = ('queued', 'waiting', 'running') if action == 'pause' else ('paused', 'waiting', 'failed') if action == 'resume' else PENDING
        state = {'pause': 'paused', 'resume': 'queued', 'cancel': 'cancelled'}[action]
        with db:
            result = db.execute('UPDATE '+table+' SET state=?,lease=NULL,error=?'+
                                (',lease_until=NULL'+(',attempts=0' if action == 'resume' else '') if stage else '')+
                                ",updated_at=datetime('now') WHERE state IN ("+','.join('?' for _ in old)+')'+
                                (' AND stage=?' if stage else ''),
                                [state, '用户手动暂停' if action == 'pause' else '', *old, *([stage] if stage else [])])
            from .model_preferences import sync_classification_jobs
            sync_classification_jobs(db)
        if action == 'resume':
            from .classification_jobs import ensure_worker
            ensure_worker(app)
        return jsonify({'changed': result.rowcount})
