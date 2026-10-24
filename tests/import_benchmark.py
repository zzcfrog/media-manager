"""Compare import builds with identical synthetic media, never a real library.

Run with --assets <scratch directory> --output <json file>. Optional --models
uses an existing local resnet50.onnx read-only; otherwise inference is stubbed.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import statistics
import subprocess
import time
from unittest.mock import patch

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--assets', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--models', type=Path)
parser.add_argument('--rounds', type=int, default=3)
parser.add_argument('--baseline-importer', type=Path, help='Saved pre-change importer.py for a serial comparison')
args = parser.parse_args()
if args.models:
    os.environ['MEDIA_MANAGER_MODELS'] = str(args.models)

from support import DatabaseCase
from backend.services import embedding
from PIL import Image
import numpy as np
from loguru import logger

logger.disable('backend')
baseline = None
if args.baseline_importer:
    import importlib.util
    spec = importlib.util.spec_from_file_location('backend.services.benchmark_baseline', args.baseline_importer)
    baseline = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(baseline)
args.assets.mkdir(parents=True, exist_ok=True)
for i in range(12):
    path = args.assets / f'photo-{i:02d}.jpg'
    if not path.exists():
        pixels = np.random.default_rng(i).integers(0, 256, (4000, 6000, 3), dtype=np.uint8)
        exif = Image.Exif()
        exif[271], exif[272], exif[274] = 'Synthetic', 'Import benchmark', (6 if i % 3 == 0 else 1)
        Image.fromarray(pixels).save(path, quality=90, exif=exif)
for i in range(4):
    path = args.assets / f'video-{i:02d}.mp4'
    if not path.exists():
        subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i',
                        'testsrc2=s=1920x1080:r=25:d=2', '-c:v', 'libx264',
                        '-preset', 'ultrafast', '-y', str(path)], check=True)
paths = sorted(args.assets.glob('photo-*.jpg')) + sorted(args.assets.glob('video-*.mp4'))
report = {'kind': 'synthetic SSD; warm model; no RAW or external-disk claim',
          'inference': 'local ResNet50 CPU' if args.models else 'stub', 'files': len(paths),
          'source_sha256': {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in paths},
          'rounds': []}

def run():
    # Keep model initialization out of the steady-state batch comparison.
    if args.models:
        embedding._ort_session = embedding.ort.InferenceSession(
            str(embedding._MODEL_PATH), providers=['CPUExecutionProvider'])
        assert embedding.compute_embedding(paths[0]), 'Local model did not produce a feature vector'
    for _ in range(args.rounds):
        case = DatabaseCase(); case.setUp()
        try:
            if baseline:
                from flask import Response, stream_with_context
                def baseline_route():
                    def events():
                        for index, path in enumerate(paths, 1):
                            row = baseline._import_one(case.db, path)
                            row.pop('embedding', None)
                            yield 'data: ' + json.dumps({'type': 'ok', 'data': row, 'done': index, 'total': len(paths)}) + '\n\n'
                        yield 'data: ' + json.dumps({'type': 'done', 'imported': len(paths), 'failed': 0}) + '\n\n'
                    return Response(stream_with_context(events()), mimetype='text/event-stream')
                case.app.view_functions['library.import_batch'] = baseline_route
            start = time.perf_counter()
            response = case.client.post('/api/library/import-batch', json={'paths': [str(p) for p in paths]})
            events, first = [], None
            for chunk in response.response:
                for message in chunk.decode().strip().split('\n\n'):
                    event = json.loads(message.removeprefix('data: '))
                    events.append(event)
                    if event['type'] == 'ok' and first is None:
                        first = time.perf_counter() - start
            elapsed = time.perf_counter() - start
            response.close()
            assert events[-1] == {'type': 'done', 'imported': len(paths), 'failed': 0}, events[-1]
            rows = [dict(r) for r in case.db.execute('SELECT * FROM media ORDER BY file_name')]
            for row in rows:
                row['embedding'] = hashlib.sha256(row['embedding'] or b'').hexdigest()
                for key in ('id', 'file_path', 'thumbnail_path', 'created_at', 'imported_at', 'updated_at'):
                    row.pop(key, None)
            report['rounds'].append({'seconds': round(elapsed, 3), 'first_item_seconds': round(first, 3),
                                     'records_sha256': hashlib.sha256(json.dumps(rows, sort_keys=True).encode()).hexdigest()})
            print(json.dumps(report['rounds'][-1]), flush=True)
        finally:
            case.doCleanups()

if args.models:
    run()
else:
    with patch.object(embedding, 'compute_embedding', return_value=None):
        run()
report['median_seconds'] = statistics.median(r['seconds'] for r in report['rounds'])
args.output.write_text(json.dumps(report, indent=2) + '\n')
