"""Isolated R12 performance measurements; never opens a real library or model.

Run: .build-venv/bin/python tests/taxonomy-performance-benchmark.py
Use --section queries/import to repeat one part after an implementation change.
"""
import argparse
from contextlib import ExitStack, contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import platform
import shutil
import sqlite3
import statistics
import subprocess
import sys
import time
from unittest.mock import patch


ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--section', choices=('all', 'queries', 'import'), default='all')
parser.add_argument('--repetitions', type=int, default=25)
parser.add_argument('--example-repetitions', type=int, default=3)
parser.add_argument('--import-rounds', type=int, default=9)
parser.add_argument('--label', default='current')
args = parser.parse_args()
OUT = ROOT / 'build' / 'taxonomy-performance-validation'
OUT.mkdir(parents=True, exist_ok=True)
os.environ['MEDIA_MANAGER_HOME'] = str(OUT / 'runtime')
os.environ['MEDIA_MANAGER_MODELS'] = str(OUT / 'no-models')
sys.path.insert(0, str(ROOT))
sys.dont_write_bytecode = True

import numpy as np
from flask import Flask
from loguru import logger
from PIL import Image
from backend import config
from backend.db import close_db, get_db, init_db
from backend.blueprints import library, taxonomy
from backend.services import classification_jobs, embedding, importer
from backend.services import taxonomy as tx

logger.disable('backend')
config.THUMB_DIR.mkdir(parents=True, exist_ok=True)


def system_value(name):
    result = subprocess.run(['sysctl', '-n', name], capture_output=True, text=True)
    return result.stdout.strip() if result.returncode == 0 else 'unavailable'


def hardware():
    result = {'platform': platform.platform(), 'cpu': system_value('machdep.cpu.brand_string'),
              'memory_bytes': system_value('hw.memsize'), 'logical_cpus': os.cpu_count(),
              'python': platform.python_version(), 'sqlite': sqlite3.sqlite_version}
    if result['cpu'] == 'unavailable':
        profiler = subprocess.run(['/usr/sbin/system_profiler', 'SPHardwareDataType', '-json'],
                                  capture_output=True, text=True)
        if profiler.returncode == 0:
            data = json.loads(profiler.stdout).get('SPHardwareDataType', [{}])[0]
            result['cpu'] = data.get('chip_type', 'unavailable')
            result['memory'] = data.get('physical_memory', 'unavailable')
    return result


def emit(value):
    print(json.dumps(value, ensure_ascii=False), flush=True)


def stats(samples):
    ordered = sorted(samples)
    return {'samples_ms': [round(v, 3) for v in samples], 'n': len(samples),
            'median_ms': round(statistics.median(samples), 3),
            'p95_ms': round(ordered[max(0, math.ceil(len(ordered) * .95) - 1)], 3),
            'min_ms': round(ordered[0], 3), 'max_ms': round(ordered[-1], 3)}


@contextmanager
def database(path, fresh=False):
    if fresh:
        for suffix in ('', '-shm', '-wal'):
            path.with_name(path.name + suffix).unlink(missing_ok=True)
    app = Flask(__name__)
    app.config.update(TESTING=True, DATABASE=str(path))
    app.teardown_appcontext(close_db)
    init_db(app)
    app.register_blueprint(library.bp, url_prefix='/api/library')
    app.register_blueprint(taxonomy.bp, url_prefix='/api/taxonomy')
    with app.app_context():
        yield app, get_db(), app.test_client()


def seed_nodes(db):
    nodes = []
    for tag_id in range(1, 5001):
        parent = None if tag_id <= 20 else (
            1 + (tag_id - 21) // 5 if tag_id <= 120 else
            21 + (tag_id - 121) // 5 if tag_id <= 620 else
            121 + (tag_id - 621) * 500 // 4380)
        name = f'合成分类{tag_id:04d}'
        nodes.append((tag_id, name, tx.normalize(name), parent, f'synthetic concept {tag_id}'))
    db.executemany('INSERT INTO tags(id,name) VALUES (?,?)', [(n[0], n[1]) for n in nodes])
    db.executemany('INSERT INTO taxonomy_nodes(id,name,normalized,parent_id,recognition_text) VALUES (?,?,?,?,?)', nodes)
    db.executemany('INSERT INTO taxonomy_expressions(tag_id,text,normalized) VALUES (?,?,?)',
                   [(n[0], f'alias-{n[0]}', f'alias-{n[0]}') for n in nodes])
    db.commit()


def populate(db):
    seed_nodes(db)
    db.executemany('INSERT INTO media(id,file_path,file_name,media_type,file_size,file_mtime,thumbnail_path,'
                   'favorite,width,height,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
                   ((i, str(OUT / 'offline' / f'batch-{i % 20}' / f'media-{i:06d}.jpg'),
                     f'media-{i:06d}.jpg', 'video' if i % 5 == 0 else 'image', 1048576, 1700000000.,
                     None, int(i % 7 == 0), 1920, 1080, f'2026-10-{1 + i % 28:02d} 12:00:00')
                    for i in range(1, 100001)))
    db.executemany('INSERT OR IGNORE INTO media_tags(media_id,tag_id) VALUES (?,?)',
                   ((i, 621 + ((i * factor + offset) % 4380)) for i in range(1, 100001)
                    for factor, offset in ((1, 0), (17, 13), (37, 29))))
    # Normalized synthetic vectors prove retrieval cost only, never model accuracy.
    rng = np.random.default_rng(20261030)
    vectors = rng.normal(size=(128, 512)).astype(np.float32)
    vectors /= np.linalg.norm(vectors, axis=1, keepdims=True)
    payloads = [v.tobytes() for v in vectors]
    revision = hashlib.sha256(tx._json([None, 1048576, 1700000000.]).encode()).hexdigest()
    db.executemany('INSERT INTO taxonomy_features(media_id,model_key,input_revision,dimension,vector) VALUES (?,?,?,?,?)',
                   ((i, 'synthetic-paired-512-v1', revision, 512, payloads[i % len(payloads)])
                    for i in range(1, 100001)))
    db.executemany('INSERT INTO taxonomy_examples(tag_id,media_id,role,input_revision) VALUES (?,?,?,?)',
                   [(5000, 1, 'positive', revision), (5000, 2, 'negative', revision)])
    db.commit()
    db.execute('ANALYZE')
    db.commit()
    db.execute('PRAGMA wal_checkpoint(TRUNCATE)')


def measure(fn, repeats):
    started = time.perf_counter(); fn(); cold = (time.perf_counter() - started) * 1000
    samples = []
    for _ in range(repeats):
        started = time.perf_counter(); fn(); samples.append((time.perf_counter() - started) * 1000)
    return {**stats(samples), 'first_request_ms': round(cold, 3)}


def query_benchmark():
    path = OUT / 'synthetic-100k-5k.sqlite'
    with database(path, fresh=True) as (_, db, client):
        populate(db)
        result = {'conditions': {'media': 100000, 'nodes': 5000, 'levels': 4,
                  'links': db.execute('SELECT COUNT(*) FROM media_tags').fetchone()[0],
                  'aliases': 5000, 'cached_vectors': 100000, 'dimension': 512,
                  'page_size': 50, 'cache': 'warm after first request; ANALYZE after seed',
                  'database_bytes': path.stat().st_size}, 'measurements': {}}

        def request(url, params=None):
            response = client.get(url, query_string=params or {})
            assert response.status_code == 200, response.get_json()
            data = response.get_json()
            assert data is not None
            return data

        cases = {
            'tree_with_counts': lambda: request('/api/taxonomy/tree'),
            'list_first_page': lambda: request('/api/library/'),
            'parent_list_and_count': lambda: request('/api/library/', {'tag_ids': '1'}),
            'leaf_list_and_count': lambda: request('/api/library/', {'tag_ids': '5000'}),
            'any_three_roots': lambda: request('/api/library/', {'tag_ids': '1,2,3'}),
            'all_two_roots': lambda: request('/api/library/', {'tag_ids': '1,2', 'tag_mode': 'all'}),
            'all_and_exclude_folder_favorite': lambda: request('/api/library/', {'tag_ids': '1,2',
                'tag_mode': 'all', 'exclude_tag_ids': '3', 'favorite': 'true',
                'folder': str(OUT / 'offline' / 'batch-1')}),
        }
        for name, fn in cases.items():
            measured = measure(fn, args.repetitions)
            statements = []
            db.set_trace_callback(statements.append)
            try:
                payload = fn()
            finally:
                db.set_trace_callback(None)
            measured.update(sql_statement_count=len(statements),
                            response_items=len(payload.get('data', [])),
                            passed_500ms=measured['p95_ms'] <= 500)
            if 'pagination' in payload:
                measured['total'] = payload['pagination']['total']
            result['measurements'][name] = measured
            emit({name: measured})
        for name, positive, negative, mode in [('parent_count_only', [1], [], 'any'),
                                              ('all_exclude_count_only', [1, 2], [3], 'all')]:
            def count():
                predicate, params = tx.filter_sql(db, positive, negative, mode)
                return db.execute('SELECT COUNT(*) FROM media WHERE ' + predicate, params).fetchone()[0]
            result['measurements'][name] = measure(count, args.repetitions)
            result['measurements'][name]['passed_500ms'] = result['measurements'][name]['p95_ms'] <= 500
            emit({name: result['measurements'][name]})
        for size in (1000, 100000):
            ids = list(range(1, size + 1))
            fn = lambda: tx.example_candidates(db, 5000, ids)
            measured = measure(fn, args.example_repetitions)
            counter = [0]
            def trace(_sql): counter[0] += 1
            db.set_trace_callback(trace)
            try:
                payload = fn()
            finally:
                db.set_trace_callback(None)
            measured.update(sql_statement_count=counter[0], response_items=len(payload['data']),
                            missing_features=payload['missing_features'])
            result['measurements'][f'example_search_{size}'] = measured
            emit({f'example_search_{size}': measured})
        result['foreign_key_violations'] = len(db.execute('PRAGMA foreign_key_check').fetchall())
        result['query_plans'] = {}
        for name, values in [('parent', [1]), ('leaf', [5000])]:
            predicate, params = tx.filter_sql(db, values)
            result['query_plans'][name] = [list(r) for r in db.execute(
                'EXPLAIN QUERY PLAN SELECT * FROM media WHERE ' + predicate +
                ' ORDER BY imported_at DESC,id DESC LIMIT 50', params)]
        result['hardware'] = report['hardware']
        result['source_sha256'] = report['source_sha256']
        (OUT / f'queries-{args.label}.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
        return result


def import_benchmark():
    assets = OUT / 'synthetic-sources'
    assets.mkdir(exist_ok=True)
    rng = np.random.default_rng(20261030)
    for i in range(48):
        path = assets / f'photo-{i:02d}.jpg'
        if not path.exists():
            Image.fromarray(rng.integers(0, 256, (640, 960, 3), dtype=np.uint8)).save(path, quality=85)
    master = assets / 'video-00.mp4'
    if not master.exists():
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                        'testsrc2=s=640x360:r=25:d=2', '-c:v', 'libx264',
                        '-preset', 'ultrafast', '-y', str(master)], check=True)
    for i in range(1, 8):
        target = assets / f'video-{i:02d}.mp4'
        if not target.exists(): shutil.copyfile(master, target)
    paths = sorted(assets.glob('*.jpg')) + sorted(assets.glob('*.mp4'))
    result = {'conditions': {'files': len(paths), 'images': 48, 'videos': 8,
              'source_bytes': sum(p.stat().st_size for p in paths), 'nodes': 5000,
              'storage': 'local SSD; OS source cache warm',
              'real_work': 'metadata probes, JPG decoding, ffmpeg video previews, FTS, SQLite commits',
              'disabled_work': 'existing ResNet inference stubbed in both arms; classification worker not started',
              'claim': 'classification registration overhead only; no external disk or real model throughput claim'},
              'source_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths}, 'rounds': []}
    for round_id in range(args.import_rounds + 1):
        # First pair is warm-up. Alternating order balances drift and source caching.
        pair = {'round': round_id, 'warmup': round_id == 0}
        enabled_order = (False, True) if round_id % 2 == 0 else (True, False)
        pair['order'] = list(enabled_order)
        for enabled in enabled_order:
            name = f'import-{round_id}-{int(enabled)}'
            path = OUT / f'{name}.sqlite'
            thumbs = OUT / name
            thumbs.mkdir(exist_ok=True)
            with database(path, fresh=True) as (app, db, _), ExitStack() as patches:
                seed_nodes(db)
                patches.enter_context(patch.object(importer, 'THUMB_DIR', thumbs))
                patches.enter_context(patch.object(config, 'THUMB_DIR', thumbs))
                patches.enter_context(patch.object(embedding, 'compute_embedding', return_value=None))
                worker = patches.enter_context(patch.object(classification_jobs, 'ensure_worker'))
                started = time.perf_counter()
                events = list(importer.import_batch(db, [str(p) for p in paths],classify_media=enabled))
                elapsed = (time.perf_counter() - started) * 1000
                assert all(e['type'] == 'ok' for e in events), events
                jobs = db.execute('SELECT COUNT(*) FROM taxonomy_jobs').fetchone()[0]
                assert jobs == (len(paths) if enabled else 0), jobs
                assert worker.call_count == (len(paths) if enabled else 0)
                assert db.execute('SELECT COUNT(*) FROM media').fetchone()[0] == len(paths)
                assert len(list(thumbs.glob('*.jpg'))) == len(paths)
                pair['enabled_ms' if enabled else 'disabled_ms'] = round(elapsed, 3)
            # Only artifacts produced by this benchmark are removed between trials.
            for suffix in ('', '-shm', '-wal'):
                path.with_name(path.name + suffix).unlink(missing_ok=True)
            shutil.rmtree(thumbs)
        pair['paired_overhead_pct'] = round((pair['enabled_ms'] / pair['disabled_ms'] - 1) * 100, 3)
        result['rounds'].append(pair)
        emit({'import_pair': pair})
    trials = result['rounds'][1:]
    result['disabled'] = stats([p['disabled_ms'] for p in trials])
    result['enabled'] = stats([p['enabled_ms'] for p in trials])
    result['median_overhead_pct'] = round((result['enabled']['median_ms'] / result['disabled']['median_ms'] - 1) * 100, 3)
    result['median_paired_overhead_pct'] = round(statistics.median(p['paired_overhead_pct'] for p in trials), 3)
    result['aggregate_overhead_pct'] = round((sum(p['enabled_ms'] for p in trials) /
                                             sum(p['disabled_ms'] for p in trials) - 1) * 100, 3)
    result['passed_5pct'] = result['aggregate_overhead_pct'] <= 5
    result['hardware'] = report['hardware']
    result['source_sha256'] = report['source_sha256']
    (OUT / f'import-{args.label}.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    return result


report = {'label': args.label, 'time_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()),
          'hardware': hardware(),
          'source_sha256': {str(p): hashlib.sha256((ROOT / p).read_bytes()).hexdigest() for p in
                            ('backend/services/taxonomy.py', 'backend/blueprints/taxonomy.py',
                             'backend/services/classification_jobs.py', 'backend/services/importer.py',
                             'backend/blueprints/library.py')}}
if args.section in ('all', 'queries'):
    report['queries'] = query_benchmark()
if args.section in ('all', 'import'):
    report['import'] = import_benchmark()
(OUT / f'report-{args.section}-{args.label}.json').write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
emit({'report': str(OUT / f'report-{args.section}-{args.label}.json')})
