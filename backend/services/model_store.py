"""Portable records for explicitly downloaded models, independent of library data."""
import hashlib
import json
from pathlib import Path
import threading
import time

from flask import current_app, has_app_context
from ..config import MODELS_ROOT

_checks = {}
_lock = threading.Lock()
RECORD = 'luminisle-model.json'


def models_root():
    return Path(current_app.config.get('MODELS_ROOT', MODELS_ROOT) if has_app_context() else MODELS_ROOT).resolve()


def digest(file):
    value = hashlib.sha256()
    with Path(file).open('rb') as source:
        for block in iter(lambda: source.read(8 << 20), b''):
            value.update(block)
    return value.hexdigest()


def write_record(directory, kind, model_id, files, **metadata):
    directory = Path(directory)
    record = {'format_version': 1, 'kind': kind, 'model_id': model_id, 'created': time.time(),
              'files': {name: {'bytes': (directory/name).stat().st_size,
                               'mtime_ns': (directory/name).stat().st_mtime_ns,
                               'sha256': digest(directory/name)} for name in files}, **metadata}
    (directory/RECORD).write_text(json.dumps(record, ensure_ascii=False, indent=2)+'\n')
    return record


def installed(kind, model_id, root=None):
    if kind not in ('faces', 'classification'):
        raise ValueError('未知模型目录类型')
    root = Path(root) if root is not None else models_root()/kind
    matches = []
    if not root.is_dir():
        return None
    for file in root.glob('*/'+RECORD):
        try:
            directory = file.parent.resolve()
            if not directory.is_relative_to(root.resolve()):
                continue
            record = json.loads(file.read_text())
            if not isinstance(record, dict) or not isinstance(record.get('files'), dict):
                continue
            if record.get('format_version') != 1 or record.get('kind') != kind or record.get('model_id') != model_id or not record['files']:
                continue
            if not isinstance(record.get('created'), (int, float)):
                continue
            valid = True
            for name, expected in record['files'].items():
                if Path(name).name != name:
                    valid = False;break
                asset = directory/name
                if not asset.is_file() or not asset.resolve().is_relative_to(directory):
                    valid = False;break
                stat = asset.stat()
                if stat.st_size != expected['bytes']:
                    valid = False;break
                if stat.st_mtime_ns != expected['mtime_ns']:
                    signature = (str(asset), stat.st_size, stat.st_mtime_ns, expected['sha256'])
                    with _lock:
                        checked = _checks.get(signature)
                    if checked is None:
                        checked = digest(asset) == expected['sha256']
                        with _lock:
                            _checks[signature] = checked
                    if not checked:
                        valid = False;break
            if valid:
                matches.append({**record, 'directory': str(directory)})
        except (OSError, ValueError, TypeError, KeyError):
            continue
    return max(matches, key=lambda item: item['created']) if matches else None
