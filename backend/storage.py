"""Verified, non-destructive library migration and upgrade snapshots.

No application factory, model loading, or network calls belong in this module.
"""
import base64
from contextlib import closing, contextmanager
import ctypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import shutil
import sqlite3
import stat
import sys
import uuid

FORMAT_VERSION = 1
_RECEIPT = 'migration-manifest.json'
_MARKER = 'data-layout.json'


def _write_json(path, value):
    temporary = path.with_name(path.name + '.tmp-' + uuid.uuid4().hex)
    try:
        with temporary.open('x', encoding='utf-8') as output:
            os.chmod(temporary, 0o600)
            json.dump(value, output, ensure_ascii=False, indent=2)
            output.write('\n'); output.flush(); os.fsync(output.fileno())
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)


def _digest(path):
    digest = hashlib.sha256()
    with path.open('rb') as source:
        for block in iter(lambda: source.read(8 << 20), b''):
            digest.update(block)
    return digest.hexdigest()


def copy_file(source, destination):
    """An independent APFS clone where available; verify both byte streams."""
    source, destination = Path(source), Path(destination)
    if destination.exists() or destination.is_symlink():
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    before = source.stat()
    expected = _digest(source)
    cloned = False
    if sys.platform == 'darwin':
        libc = ctypes.CDLL(None, use_errno=True)
        cloned = libc.clonefile(os.fsencode(source), os.fsencode(destination), 0) == 0
    if not cloned:
        shutil.copyfile(source, destination)
    shutil.copystat(source, destination)
    after = source.stat()
    if (before.st_size, before.st_mtime_ns) != (after.st_size, after.st_mtime_ns) or _digest(destination) != expected:
        raise ValueError(f'文件在复制期间变化或校验失败: {source.name}')


def _copy_tree(source, destination, excluded=()):
    source, destination = Path(source).resolve(), Path(destination)
    excluded = {Path(p).resolve() for p in excluded}
    if destination.resolve().is_relative_to(source):
        raise ValueError('目标目录不能位于被复制的目录内')

    def walk(current, target, ancestors):
        real = current.resolve()
        if real in excluded:
            return
        if current.is_symlink() and real.is_relative_to(source):
            relative_target = destination / real.relative_to(source)
            target.parent.mkdir(parents=True, exist_ok=True)
            target.symlink_to(os.path.relpath(relative_target, target.parent))
            return
        if current.is_dir():
            if real in ancestors:
                raise ValueError('检测到循环目录链接')
            target.mkdir(parents=True, exist_ok=True)
            for item in sorted(current.iterdir()):
                if item.name in ('SingletonLock', 'SingletonCookie', 'SingletonSocket', '.app.lock'):
                    continue
                if item.name.endswith(('-wal', '-shm', '-journal')) and item.name.startswith('media.db'):
                    continue
                if stat.S_ISSOCK(item.lstat().st_mode):
                    continue
                walk(item, target / item.name, ancestors | {real})
        elif current.is_file():
            copy_file(current, target)
        else:
            raise ValueError(f'源数据文件不可读取: {current.name}')
    walk(source, destination, set())


def _connect_readonly(path):
    return sqlite3.connect(Path(path).resolve().as_uri() + '?mode=ro', uri=True)


def snapshot_database(source, destination):
    source, destination = Path(source), Path(destination)
    if destination.exists():
        raise FileExistsError(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    with closing(_connect_readonly(source)) as db, closing(sqlite3.connect(destination)) as snapshot:
        db.backup(snapshot)
        if snapshot.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('数据库快照完整性检查失败')
    os.chmod(destination, 0o600)


def database_fingerprint(path):
    """Compare table contents without exposing configuration or API keys."""
    tables = {}
    with closing(_connect_readonly(path)) as db:
        if db.execute('PRAGMA quick_check').fetchone()[0] != 'ok':
            raise ValueError('数据库完整性检查失败')
        names = [r[0] for r in db.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
                 if not r[0].startswith(('sqlite_', 'media_fts_'))]
        for name in names:
            quoted = '"' + name.replace('"', '""') + '"'
            columns = [r[1] for r in db.execute(f'PRAGMA table_info({quoted})')]
            order = ','.join('"' + c.replace('"', '""') + '"' for c in columns)
            digest, count = hashlib.sha256(), 0
            for row in db.execute(f'SELECT * FROM {quoted} ORDER BY {order}'):
                values = [{'blob': base64.b64encode(v).decode('ascii')} if isinstance(v, bytes) else v for v in row]
                digest.update(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode());digest.update(b'\n')
                count += 1
            tables[name] = {'rows': count, 'sha256': digest.hexdigest()}
    return {'tables': tables}


def _manifest(root):
    out = {}
    for current, directories, files in os.walk(root, followlinks=False):
        for name in sorted(directories + files):
            path = Path(current) / name
            relative = path.relative_to(root).as_posix()
            if relative in (_RECEIPT, _MARKER, '.app.lock') or relative.startswith('upgrade-backups/'):
                continue
            if path.is_symlink():
                if not path.resolve().is_relative_to(root.resolve()) or not path.exists():
                    raise ValueError(f'迁移副本含外部或失效链接: {relative}')
                out[relative] = {'link': os.readlink(path)}
            elif path.is_file():
                out[relative] = {'bytes': path.stat().st_size, 'sha256': _digest(path)}
    return out


def verify_library(root):
    root = Path(root)
    receipt = json.loads((root / _RECEIPT).read_text())
    if receipt.get('format_version') != FORMAT_VERSION:
        raise ValueError('不支持的迁移格式')
    if _manifest(root) != receipt['files']:
        raise ValueError('资料库文件清单或 SHA-256 校验不一致；未执行恢复')
    if database_fingerprint(root / 'media.db') != receipt['database']:
        raise ValueError('数据库逐表内容与迁移快照不一致')
    return {'ok': True, 'files': len(receipt['files']), 'database': receipt['database']}


@contextmanager
def library_lock(root):
    """CLI backup/restore and the running desktop backend cannot overlap."""
    import fcntl
    root = Path(root);root.mkdir(parents=True, exist_ok=True, mode=0o700)
    with (root / '.app.lock').open('a') as handle:
        try:
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError('资料库正在使用，请先退出 映屿 · luminisle') from None
        try:
            yield
        finally:
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)


def migrate_library(source_data, source_models, destination, cache_repositories=()):
    """Publish only a complete verified copy; never overwrite an existing target."""
    source_data, destination = Path(source_data).resolve(), Path(destination).absolute()
    if destination.exists():
        raise FileExistsError(f'目标已存在，未覆盖: {destination}')
    if not (source_data / 'media.db').is_file():
        raise FileNotFoundError('源资料库没有 media.db')
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = destination.with_name('.' + destination.name + '.staging-' + uuid.uuid4().hex)
    staging.mkdir(mode=0o700)
    try:
        snapshot_database(source_data / 'media.db', staging / 'media.db')
        for item in sorted(source_data.iterdir()):
            if item.name in ('media.db', 'media.db-wal', 'media.db-shm', 'media.db-journal', '.app.lock', _RECEIPT, _MARKER):
                continue
            target = staging / item.name
            if item.is_dir():
                _copy_tree(item, target)
            else:
                copy_file(item, target)
        if source_models is not None:
            if (staging / 'models').exists():
                raise ValueError('数据目录已有 models，请勿同时指定第二个模型目录')
            _copy_tree(Path(source_models), staging / 'models')
        for repo in cache_repositories:
            repo = Path(repo)
            _copy_tree(repo, staging / 'models' / 'huggingface' / 'hub' / repo.name)
        receipt = {'format_version': FORMAT_VERSION, 'created_at': datetime.now(timezone.utc).isoformat(),
                   'database': database_fingerprint(staging / 'media.db'), 'files': _manifest(staging)}
        _write_json(staging / _RECEIPT, receipt)
        verify_library(staging)
        if destination.exists():
            raise FileExistsError(destination)
        staging.rename(destination)
        return receipt
    except Exception as error:
        error.add_note(f'未发布目标资料库；保留失败现场: {staging}')
        raise


def export_library(library, destination, profile=None):
    library, destination = Path(library).resolve(), Path(destination).absolute()
    if destination.exists():
        raise FileExistsError(destination)
    if destination.is_relative_to(library) or (profile and destination.is_relative_to(Path(profile).resolve())):
        raise ValueError('导出位置必须位于当前资料库和界面配置目录之外')
    staging = destination.with_name('.' + destination.name + '.staging-' + uuid.uuid4().hex)
    staging.mkdir(parents=True, mode=0o700)
    with library_lock(library):
        migrate_library(library, None, staging / 'library')
        if profile:
            _copy_tree(Path(profile), staging / 'profile', excluded=(library,))
        _write_json(staging / 'export.json', {'format_version': FORMAT_VERSION, 'files': _manifest(staging)})
    staging.rename(destination)
    return {'ok': True, 'destination': str(destination)}


def restore_library(snapshot, destination):
    snapshot, destination = Path(snapshot), Path(destination)
    if destination.exists():
        raise FileExistsError(destination)
    export = json.loads((snapshot / 'export.json').read_text())
    actual = _manifest(snapshot);actual.pop('export.json', None)
    if export.get('format_version') != FORMAT_VERSION or actual != export.get('files'):
        raise ValueError('导出文件 SHA-256 校验失败；没有恢复任何数据')
    verify_library(snapshot / 'library')
    return migrate_library(snapshot / 'library', None, destination)


def prepare_upgrade(library, version):
    library = Path(library)
    marker_path = library / _MARKER
    previous = json.loads(marker_path.read_text()) if marker_path.exists() else {}
    if previous.get('format_version', FORMAT_VERSION) > FORMAT_VERSION:
        raise ValueError('资料库来自更新版本，请使用相同或更新版本的应用；未修改数据库')
    backup = None
    if (library / 'media.db').exists() and previous.get('app_version') != version:
        folder = library / 'upgrade-backups';folder.mkdir(mode=0o700, exist_ok=True)
        backup = folder / (datetime.now().strftime('%Y%m%d-%H%M%S') + '-' + uuid.uuid4().hex[:8] + '.db')
        snapshot_database(library / 'media.db', backup)
        _write_json(backup.with_suffix('.json'), {'from_version': previous.get('app_version'), 'to_version': version,
                                               'database': database_fingerprint(backup)})
    return {'backup': str(backup) if backup else None}


def mark_started(library, version):
    _write_json(Path(library) / _MARKER, {'format_version': FORMAT_VERSION, 'app_version': version})
