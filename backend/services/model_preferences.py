"""Explicit opt-outs for model-backed features; absent preferences keep legacy behavior."""
from ..db import get_setting

DISABLED = 'none'
PEOPLE_OFF = '人脸识别未启用'
FAST_OFF = '快速分类未启用'
OMNI_OFF = '本地补充模型未启用'


def analysis_enabled(db, media_type):
    kind = 'music' if media_type == 'audio' else media_type
    if get_setting(db, kind+'_analysis_enabled', 'true') == 'false':
        return False
    engine = get_setting(db, kind+'_engine', 'local' if kind == 'music' else 'cloud')
    key = 'music_model' if kind == 'music' else 'local_model' if engine == 'local' else 'image_model' if kind == 'image' else 'model'
    return get_setting(db, key, '') != DISABLED


def people_enabled(db):
    return get_setting(db, 'people_model_enabled', 'true') != 'false'


def classification_enabled(db, stage):
    if stage == 'fast':
        return get_setting(db, 'classification_model_enabled', 'true') != 'false'
    if stage == 'omni':
        return get_setting(db, 'classification_omni_model', 'qwen3-omni-30b-a3b') != DISABLED
    return True  # Mapping existing analysis does not load a model.


def _sync_queue(db, table, condition, enabled, reason):
    if enabled:
        return db.execute("UPDATE "+table+" SET state='queued',error='',updated_at=datetime('now') "
                          "WHERE state='paused' AND error=? AND "+condition, (reason,)).rowcount
    db.execute("UPDATE "+table+" SET state='paused',lease=NULL,error=?,updated_at=datetime('now') "
               "WHERE state IN ('queued','running','waiting') AND "+condition, (reason,))
    return 0


def sync_people_jobs(db):
    return _sync_queue(db, 'people_jobs', '1=1', people_enabled(db), PEOPLE_OFF)


def sync_classification_jobs(db):
    return (_sync_queue(db, 'taxonomy_jobs', "stage='fast'", classification_enabled(db, 'fast'), FAST_OFF) +
            _sync_queue(db, 'taxonomy_jobs', "stage='omni'", classification_enabled(db, 'omni'), OMNI_OFF) +
            _sync_queue(db, 'taxonomy_relation_jobs', '1=1', classification_enabled(db, 'omni'), OMNI_OFF))
