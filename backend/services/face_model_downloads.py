"""Explicit official-pack downloads to external storage; never overwrite or save settings."""
from copy import deepcopy
import hashlib
from pathlib import Path, PurePosixPath
import shutil
import tempfile
import threading
import time
from urllib.request import Request, urlopen
import uuid
import zipfile

from .face_engine import PROFILES, probe_model
from . import model_store

# Official model-zoo release asset metadata, checked 2026-11-01. New bytes need a new catalog entry.
_ASSETS={
    'buffalo_l':(288621354,'80ffe37d8a5940d59a7384c201a2a38d4741f2f3c51eef46ebb28218a7b0ca2f'),
    'buffalo_m':(275951529,'d98264bd8f2dc75cbc2ddce2a14e636e02bb857b3051c234b737bf3b614edca9'),
    'buffalo_s':(127607557,'d85a87f503f691807cd8bb97128bdf7a0660326cd9cd02657127fa978bab8b5e'),
    'buffalo_sc':(14969382,'57d31b56b6ffa911c8a73cfc1707c73cab76efe7f13b675a05223bf42de47c72'),
    'raccoon_l':(255140324,'70cd4f2f1de0a89dd0983bdac55a066a6178543f86e9ec87154f6f259bdded7e'),
    'raccoon_s':(36573350,'f67a624ef8a4495899eb4359a8a6953f7b4c62a8399c5bc745c0e0f6582f898d')}
CATALOG={name:{'bytes':size,'sha256':digest,
    'url':f'https://github.com/deepinsight/insightface/releases/download/model-zoo/{name}.zip'}
    for name,(size,digest) in _ASSETS.items()}
_lock=threading.Lock()
_jobs={}
_ACTIVE=('downloading','validating')


def model_ref(profile, stage):
    names = (*PROFILES[profile], *(['face_verifier_mnv2.onnx'] if profile.startswith('raccoon_') else []))
    index = ('detector', 'recognizer', 'verifier').index(stage)
    if index >= len(names):
        raise ValueError('该套装不包含此阶段')
    return names[index]


def stage_path(reference, stage):
    if not isinstance(reference, str) or reference.count(':') != 1:
        raise ValueError('人脸模型标识无效')
    profile, role = reference.split(':')
    if profile not in PROFILES or role != stage:
        raise ValueError('人脸模型阶段不匹配')
    name = model_ref(profile, stage)
    record = model_store.installed('faces', profile)
    return str(Path(record['directory'] if record else model_store.models_root()/'faces'/profile)/name)


def catalog():
    packs = []
    for name, item in CATALOG.items():
        record = model_store.installed('faces', name)
        paths = {stage+'_path': str(Path(record['directory'])/model_ref(name, stage))
                 for stage in ('detector', 'recognizer', 'verifier')
                 if stage != 'verifier' or name.startswith('raccoon_')} if record else {}
        files=[{'stage':stage,'name':model_ref(name,stage)} for stage in ('detector','recognizer','verifier')
               if stage!='verifier' or name.startswith('raccoon_')]
        packs.append({'profile': name, **item, 'manufacturer':'InsightFace','installed': bool(record), 'paths': paths,'files':files})
    return {'packs': packs, 'managed_models': True, 'directory': str(model_store.models_root()/'faces'),
            'base_directory':str(model_store.models_root()),
            'source':'InsightFace · GitHub model-zoo',
            'license_url':'https://github.com/deepinsight/insightface/blob/master/python-package/docs/model_zoo.md#model-licenses'}


def status(key):
    with _lock:return deepcopy(_jobs.get(key,{}).get('status',{'state':'idle'}))


def busy(key):return status(key)['state'] in _ACTIVE


def cancel(key,job_id):
    with _lock:
        job=_jobs.get(key)
        if not job or job['status']['id']!=job_id:raise ValueError('下载任务已变化，请刷新')
        job['cancel'].set()
    return status(key)


def start(key,profile,directory=None,stage=None,subdirectory=None):
    if profile not in CATALOG:raise ValueError('请选择支持下载的模型套装')
    if stage is not None:model_ref(profile, stage)
    managed = directory is None
    destination=None
    if subdirectory is not None:
        if not managed or not isinstance(subdirectory,str):raise ValueError('下载子目录无效')
        parts=PurePosixPath(subdirectory).parts
        if len(parts)!=2 or parts[0]!='faces' or parts[1] in ('.','..') or len(parts[1])>128 or '\\' in subdirectory or '\0' in subdirectory or subdirectory!=str(PurePosixPath(subdirectory)):
            raise ValueError('请使用 faces/套装文件夹 格式的相对子目录')
        destination=model_store.models_root()/subdirectory
        if destination.parent.resolve()!= (model_store.models_root()/'faces').resolve() or not destination.resolve().is_relative_to(model_store.models_root()):
            raise ValueError('下载子目录不能超出模型根目录')
        if destination.exists() or destination.is_symlink():raise ValueError('该套装目录已存在，请选用已下载模型或更换子目录')
    if managed:
        root = model_store.models_root()/'faces'
        root.mkdir(parents=True, exist_ok=True)
        record = model_store.installed('faces', profile, root)
        if record:
            result = {'id': uuid.uuid4().hex, 'state': 'done', 'profile': profile, 'managed': True, 'stage': stage, 'speed_bps': 0,
                      'directory': record['directory'], 'received': CATALOG[profile]['bytes'], 'total': CATALOG[profile]['bytes'],
                      'paths': {stage+'_path': str(Path(record['directory'])/model_ref(profile, stage))
                                for stage in ('detector', 'recognizer', 'verifier') if stage != 'verifier' or profile.startswith('raccoon_')}}
            with _lock:
                if _jobs.get(key,{}).get('status',{}).get('state') in _ACTIVE:raise ValueError('已有模型下载正在进行')
                _jobs[key] = {'cancel': threading.Event(), 'status': result}
            return status(key)
        directory = str(root)
    if not isinstance(directory,str) or not directory or not Path(directory).expanduser().is_absolute():
        raise ValueError('请选择下载位置的绝对路径')
    root=Path(directory).expanduser().resolve()
    if not root.is_dir():raise ValueError('下载位置需为已存在的文件夹')
    item=dict(CATALOG[profile])
    if shutil.disk_usage(root).free<item['bytes']*4+64*1024*1024:raise ValueError('下载位置空间不足，需预留下载及解压空间')
    with _lock:
        if _jobs.get(key,{}).get('status',{}).get('state') in _ACTIVE:raise ValueError('已有模型下载正在进行')
        job={'cancel':threading.Event(),'destination':destination,'status':{'id':uuid.uuid4().hex,'state':'downloading','profile':profile,'managed':managed,'stage':stage,'speed_bps':0,
             'received':0,'total':item['bytes'],'directory':str(root),'error':''}}
        _jobs[key]=job
    threading.Thread(target=_run,args=(key,job,root,profile,item),daemon=True,name='face-model-download').start()
    return status(key)


def _run(key,job,root,profile,item):
    def update(**values):
        with _lock:job['status'].update(values)
    def check():
        if job['cancel'].is_set():raise InterruptedError('下载已取消')
    try:
        with tempfile.TemporaryDirectory(prefix='.luminisle-face-',dir=root) as scratch:
            scratch=Path(scratch);archive=scratch/'pack.zip';digest=hashlib.sha256();received=0;started=time.monotonic()
            request=Request(item['url'],headers={'User-Agent':'luminisle-face-models/1'})
            with urlopen(request,timeout=30) as response,archive.open('wb') as output:
                if response.status!=200:raise ValueError('下载服务器返回异常状态')
                while True:
                    check();chunk=response.read(256*1024)
                    if not chunk:break
                    received+=len(chunk)
                    if received>item['bytes']:raise ValueError('下载文件大小超出预期')
                    output.write(chunk);digest.update(chunk);update(received=received,speed_bps=received/max(.001,time.monotonic()-started))
            check()
            if received!=item['bytes'] or digest.hexdigest()!=item['sha256']:
                raise ValueError('下载包完整性校验失败，请重试；官方文件更新时需更新下载目录清单')
            update(state='validating')
            staged=scratch/'ready';staged.mkdir()
            names=list(PROFILES[profile])
            if profile.startswith('raccoon_'):names.append('face_verifier_mnv2.onnx')
            with zipfile.ZipFile(archive) as package:
                members=package.infolist()
                if len(members)>100 or sum(m.file_size for m in members)>2<<30:raise ValueError('模型包解压大小异常')
                selected={}
                for member in members:
                    path=PurePosixPath(member.filename)
                    if path.is_absolute() or '..' in path.parts or '\\' in member.filename or (member.external_attr>>16)&0o170000==0o120000:
                        raise ValueError('模型包包含不安全路径')
                    if member.is_dir():continue
                    if path.name in (*names,'manifest.json','MODEL.LICENSE'):
                        if path.name in selected:raise ValueError('模型包包含重复文件')
                        selected[path.name]=member
                if any(name not in selected for name in names):raise ValueError('模型包缺少必需模型')
                for name,member in selected.items():
                    check()
                    with package.open(member) as source,(staged/name).open('xb') as output:shutil.copyfileobj(source,output)
            for stage,name in zip(('detector','recognizer','verifier'),names):
                check();probe_model(str(staged/name),stage)
            if job['status']['managed']:
                model_store.write_record(staged, 'faces', profile, names, source_sha256=item['sha256'])
            check()
            # Use a fresh child directory; existing models, backups and source folders stay untouched.
            final=job.get('destination') or root/(profile+'-'+job['status']['id'])
            if final.exists() or final.is_symlink():raise ValueError('下载目标已被占用，未覆盖现有文件')
            staged.rename(final)
            paths={stage+'_path':str(final/name) for stage,name in zip(('detector','recognizer','verifier'),names)}
            update(state='done',directory=str(final),paths=paths)
    except InterruptedError:update(state='cancelled')
    except Exception as exc:update(state='error',error=str(exc)[:600])
