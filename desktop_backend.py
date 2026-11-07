"""Frozen desktop backend and data migration CLI (no system Python required)."""
import argparse
import json
import os
from pathlib import Path
import sys


def main():
    parser = argparse.ArgumentParser(description='映屿 · luminisle desktop runtime')
    sub = parser.add_subparsers(dest='command')
    migrate = sub.add_parser('migrate')
    migrate.add_argument('--source-data', required=True, type=Path)
    migrate.add_argument('--source-models', type=Path)
    migrate.add_argument('--destination', required=True, type=Path)
    migrate.add_argument('--cache-repository', action='append', type=Path, default=[])
    export = sub.add_parser('export')
    export.add_argument('--library', required=True, type=Path)
    export.add_argument('--destination', required=True, type=Path)
    export.add_argument('--profile', type=Path)
    restore = sub.add_parser('restore')
    restore.add_argument('--snapshot', required=True, type=Path)
    restore.add_argument('--destination', required=True, type=Path)
    verify = sub.add_parser('verify');verify.add_argument('library', type=Path)
    sub.add_parser('self-test')
    sub.add_parser('people-video-worker')
    args = parser.parse_args()
    if args.command=='people-video-worker':
        from backend.services.video_worker import main as video_worker
        video_worker();return
    from backend.storage import (migrate_library, export_library, restore_library, verify_library,
                                 library_lock, prepare_upgrade, mark_started)
    if args.command == 'migrate':
        result = migrate_library(args.source_data, args.source_models, args.destination, args.cache_repository)
        print(json.dumps({'ok':True,'files':len(result['files']),'database':result['database']}, ensure_ascii=False));return
    if args.command == 'export':
        print(json.dumps(export_library(args.library, args.destination, args.profile)));return
    if args.command == 'restore':
        result = restore_library(args.snapshot, args.destination)
        print(json.dumps({'ok':True,'database':result['database']}));return
    if args.command == 'verify':
        print(json.dumps(verify_library(args.library)));return
    if args.command == 'self-test':
        import flask, openai, httpx, socksio, jieba, PIL, rawpy, pillow_heif
        import onnxruntime, faster_whisper, hdbscan, requests, tokenizers
        from backend.services import embedding
        from backend.services import taxonomy, classification_jobs, semantic_classifier
        # Constructing a SOCKS transport is offline; catches omitted optional dependencies.
        with httpx.Client(proxy='socks5://127.0.0.1:9'):
            pass
        print(json.dumps({'ok':True,'runtime':sys.version.split()[0],'frozen':bool(getattr(sys,'frozen',False))}));return

    from backend.config import DATA_DIR
    version = os.environ.get('MEDIA_MANAGER_VERSION', '1.0.24')
    DATA_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    with library_lock(DATA_DIR):
        prepare_upgrade(DATA_DIR, version)  # Always before schema initialization or stale-task reset.
        from backend import create_app
        app = create_app()
        import signal
        def terminate(*_):
            from backend import local_vlm
            local_vlm._stop_locked()
            raise SystemExit(0)
        signal.signal(signal.SIGTERM, terminate)
        mark_started(DATA_DIR, version)
        from backend.services.desktop_runtime import install_controls
        install_controls(app, version, os.environ.get('MEDIA_MANAGER_INSTANCE', ''))
        app.run(host='127.0.0.1', port=int(os.environ.get('PORT',6622)), debug=False, use_reloader=False)


if __name__ == '__main__':
    import multiprocessing
    multiprocessing.freeze_support()
    try:
        main()
    except Exception as error:
        print(f'映屿 · luminisle: {error}', file=sys.stderr)
        raise
