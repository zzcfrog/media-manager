"""Explicit, pinned ONNX downloads for the fast local classifier; no torch."""
from copy import deepcopy
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import threading
import time
from urllib.request import Request, urlopen
import uuid

from ..db import get_setting
from . import model_store

MODEL_ID = 'siglip2-base-patch16-224-fp32'
CATALOG = json.loads((Path(__file__).parents[1]/'resources'/'siglip2-models.json').read_text())
_lock = threading.Lock()
_jobs = {}
_ACTIVE = ('downloading', 'validating')


def configured_directory(db):
    model_id = get_setting(db, 'classification_model_id', '')
    if not model_id:
        return get_setting(db, 'classification_model_dir', '')
    if model_id not in CATALOG:
        raise ValueError('未知快速分类模型')
    record = model_store.installed('classification', model_id)
    return record['directory'] if record else str(model_store.models_root()/'classification'/model_id)


def catalog():
    models = []
    for model_id, item in CATALOG.items():
        record = model_store.installed('classification', model_id)
        models.append({'id': model_id, 'label': item['label'], 'quant': item['quant'],'manufacturer':item['manufacturer'],
                       'variant':item['variant'],'dimension':item['dimension'],
                       'bytes': sum(file['bytes'] for file in item['files'].values()), 'installed': bool(record),
                       'directory': record['directory'] if record else '', 'source': item['converter'],
                       'url': 'https://huggingface.co/'+item['repository']})
    return {'models': models, 'managed_models': True, 'directory': str(model_store.models_root()/'classification')}


def status(key):
    with _lock:
        return deepcopy(_jobs.get(key, {}).get('status', {'state': 'idle'}))


def busy(key):
    return status(key)['state'] in _ACTIVE


def cancel(key, job_id):
    with _lock:
        job = _jobs.get(key)
        if not job or job['status']['id'] != job_id:
            raise ValueError('下载任务已变化，请刷新')
        job['cancel'].set()
    return status(key)


def start(key, model_id):
    if model_id not in CATALOG:
        raise ValueError('请选择支持下载的快速分类模型')
    item = deepcopy(CATALOG[model_id])
    root = model_store.models_root()/'classification'
    root.mkdir(parents=True, exist_ok=True)
    with _lock:
        if _jobs.get(key, {}).get('status', {}).get('state') in _ACTIVE:
            raise ValueError('已有分类模型下载正在进行')
        record = model_store.installed('classification', model_id, root)
        total = sum(file['bytes'] for file in item['files'].values())
        if not record and shutil.disk_usage(root).free < total + (64 << 20):
            raise ValueError('下载位置空间不足')
        job = {'cancel': threading.Event(), 'status': {'id': uuid.uuid4().hex, 'state': 'done' if record else 'downloading',
            'model_id': model_id, 'received': total if record else 0, 'total': total, 'speed_bps': 0,
            'directory': record['directory'] if record else str(root), 'error': ''}}
        _jobs[key] = job
    if not record:
        threading.Thread(target=_run, args=(job, root, model_id, item), daemon=True, name='classification-model-download').start()
    return status(key)


def _manifest(directory, item):
    from tokenizers import Tokenizer
    tokenizer = Tokenizer.from_file(str(directory/'tokenizer.json'))
    pad_id = tokenizer.token_to_id('<pad>')
    if pad_id is None or tokenizer.token_to_id('<eos>') is None:
        raise ValueError('模型 tokenizer 缺少填充或结束标记')
    manifest = {'format_version': 1, 'family': 'siglip2','variant':item['variant'], 'dimension': item['dimension'], 'max_length': 64,
        'patch_size':item['patch_size'],'text_processing':{'lowercase':True,'append_eos':True},
        'pad_id': pad_id, 'pad_token': '<pad>', 'outputs': item['outputs'],
        'source': {'repository': item['repository'], 'revision': item['revision'], 'license': 'apache-2.0',
                   'base_model': item['base_model'], 'model_card': 'https://huggingface.co/'+item['repository']},
        'preprocessing': item['preprocessing'],
        'files': {name: {'bytes': value['bytes'], 'sha256': value['sha256']} for name, value in item['files'].items()}}
    if item['variant']=='naflex':manifest['max_num_patches']=item['max_num_patches']
    manifest['fingerprint'] = hashlib.sha256(json.dumps(manifest, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode()).hexdigest()
    (directory/'classification.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n')


def _run(job, root, model_id, item):
    def update(**values):
        with _lock:
            job['status'].update(values)
    def check():
        if job['cancel'].is_set():
            raise InterruptedError('下载已取消')
    try:
        with tempfile.TemporaryDirectory(prefix='.luminisle-classification-', dir=root) as scratch:
            scratch = Path(scratch);received = 0;started = time.monotonic()
            endpoint = os.environ.get('HF_ENDPOINT', 'https://huggingface.co').rstrip('/')
            for name, asset in item['files'].items():
                check();digest = hashlib.sha256();size = 0
                url = endpoint+'/'+item['repository']+'/resolve/'+item['revision']+'/'+asset['remote']
                with urlopen(Request(url, headers={'User-Agent': 'luminisle-models/1'}), timeout=30) as response, (scratch/name).open('xb') as output:
                    if response.status != 200:
                        raise ValueError('模型下载服务器返回异常')
                    while True:
                        check();chunk = response.read(256 << 10)
                        if not chunk:break
                        size += len(chunk);received += len(chunk)
                        if size > asset['bytes']:
                            raise ValueError('模型下载大小超出预期')
                        output.write(chunk);digest.update(chunk)
                        update(received=received, speed_bps=received/max(.001, time.monotonic()-started))
                if size != asset['bytes'] or digest.hexdigest() != asset['sha256']:
                    raise ValueError('模型文件完整性校验失败')
            check();update(state='validating');_manifest(scratch, item)
            from .semantic_classifier import _load_bundle
            bundle = _load_bundle(scratch, cache=False)
            del bundle
            check();model_store.write_record(scratch, 'classification', model_id, [*item['files'], 'classification.json'], revision=item['revision'])
            check();final = root/(model_id+'-'+job['status']['id']);scratch.rename(final)
            update(state='done', directory=str(final))
    except InterruptedError:
        update(state='cancelled')
    except Exception as error:
        update(state='error', error=str(error)[:600])
