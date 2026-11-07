"""Settings integration fixture. All files and settings belong to a temporary DB."""
from support import DatabaseCase,_ROOT
import json,os,time
from pathlib import Path
from flask import jsonify,request
from werkzeug.serving import make_server
from backend.blueprints import settings,people
from backend.db import get_db
from backend.services import taxonomy
from unittest.mock import patch
from PIL import Image

fixture=DatabaseCase();fixture.setUp();app=fixture.app
app.static_folder=str(Path(__file__).resolve().parents[1]/'frontend')
app.register_blueprint(settings.bp,url_prefix='/api/settings')
app.register_blueprint(people.bp,url_prefix='/api/people')
scans=os.environ.get('PEOPLE_SCAN_FIXTURE')=='1'
model_selects=os.environ.get('MODEL_SELECT_FIXTURE')=='1'
if model_selects and os.environ.get('FACE_MODEL_SETUP_FIXTURE')!='1':
    raise ValueError('MODEL_SELECT_FIXTURE requires synthetic FACE_MODEL_SETUP_FIXTURE')
model_control={'classification_error':False,'delay':.15}
media_ids=[];folders=[];import_paths=[];typed_import_paths={}
setup_info={}
raw_media=[]
if os.environ.get('RAW_PREVIEW_FIXTURE')=='1':
    from backend.services import raw_preview
    from backend.config import THUMB_DIR
    THUMB_DIR.mkdir(parents=True,exist_ok=True)
    picture=Image.new('RGB',(2400,1600),'#87aba2')
    from PIL import ImageDraw
    draw=ImageDraw.Draw(picture);draw.ellipse((1500,180,1850,530),fill='#f4e8c8');draw.polygon([(0,1400),(700,700),(1300,1300),(1900,550),(2400,1400)],fill='#234b45')
    for name,cached in [('cached.nef',True),('missing.nef',False)]:
        path=fixture.case/name;path.write_bytes(b'synthetic raw carrier');stamp=path.stat()
        thumb=THUMB_DIR/(name+'.jpg');small=picture.copy();small.thumbnail((320,320));small.save(thumb)
        mid=fixture.seed(path,media_type='image',file_size=stamp.st_size,file_mtime=stamp.st_mtime,width=6000,height=4000,thumbnail_path=thumb.name)
        if cached:raw_preview.save_preview(path,picture)
        path.unlink();raw_media.append(mid)
if os.environ.get('FACE_MODEL_SETUP_FIXTURE')=='1':
    from face_model_fixtures import model_bytes
    from backend.services import face_model_downloads as downloads
    import io,zipfile,hashlib,time
    directory=fixture.case/'model-downloads';directory.mkdir()
    paths={}
    for stage in ('detector','recognizer','verifier'):
        file=fixture.case/('renamed-'+stage+'.onnx');file.write_bytes(model_bytes(stage));paths[stage]=str(file.resolve())
    buffer=io.BytesIO()
    with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as z:
        for name,stage in [('det_10g_wo.onnx','detector'),('w600k_mbf.onnx','recognizer'),('face_verifier_mnv2.onnx','verifier')]:
            z.writestr('raccoon_s/'+name,model_bytes(stage))
    archive=buffer.getvalue()
    class SyntheticResponse(io.BytesIO):
        status=200
        def read(self,n=-1):time.sleep(.15);return super().read(min(n,1024))
    patch.object(downloads,'urlopen',side_effect=lambda *a,**k:SyntheticResponse(archive)).start()
    patch.dict(downloads.CATALOG,{'raccoon_s':{**downloads.CATALOG['raccoon_s'],'bytes':len(archive),
                'sha256':hashlib.sha256(archive).hexdigest()}}).start()
    setup_info={'stage_paths':paths,'download_directory':str(directory)}
if model_selects:
    from managed_model_fixtures import classification_assets, SyntheticResponse
    from face_model_fixtures import model_bytes
    from backend.services import classification_models, model_store
    import hashlib
    assets={model_id:classification_assets(item) for model_id,item in classification_models.CATALOG.items()}
    patch.dict(classification_models.CATALOG,{model_id:{**item,
        'files':{name:{'remote':model_id+'/'+name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in assets[model_id].items()}}
        for model_id,item in classification_models.CATALOG.items()}).start()
    def classification_response(request,**kwargs):
        model_id,name=request.full_url.rsplit('/',2)[-2:];data=assets[model_id][name]
        if model_control['classification_error']:data=b'corrupt'
        return SyntheticResponse(data,delay=model_control['delay'])
    patch.object(classification_models,'urlopen',side_effect=classification_response).start()
    model_id='siglip2-base-patch32-256-fp32'
    directory=Path(app.config['MODELS_ROOT'])/'classification'/'base32-fixture';directory.mkdir(parents=True)
    for name,data in assets[model_id].items():(directory/name).write_bytes(data)
    classification_models._manifest(directory,classification_models.CATALOG[model_id])
    model_store.write_record(directory,'classification',model_id,[*assets[model_id],'classification.json'])
    directory=Path(app.config['MODELS_ROOT'])/'faces'/'buffalo-l-fixture';directory.mkdir(parents=True)
    for name,stage in [('det_10g.onnx','detector'),('w600k_r50.onnx','recognizer')]:
        (directory/name).write_bytes(model_bytes(stage))
    model_store.write_record(directory,'faces','buffalo_l',['det_10g.onnx','w600k_r50.onnx'])
    setup_info['managed_models']=True
    vlm_installed={'qwen3-vl-8b'};vlm_job={'state':'idle'}
    @app.post('/fixture/models/control')
    def control_models():
        data=request.get_json();model_control.update({k:v for k,v in data.items() if k in model_control})
        return jsonify(model_control)
    @app.post('/api/local-vlm/download')
    def synthetic_vlm_download():
        from backend.local_vlm import MODELS
        model_id=(request.get_json() or {}).get('model_id')
        if model_id not in MODELS:return jsonify({'error':'Unknown synthetic model'}),400
        vlm_job.update(state='downloading',model_id=model_id,total_bytes=4096,done_bytes=0,speed_bps=4096,error=None,started=time.monotonic())
        return jsonify(vlm_job)
    @app.post('/api/local-vlm/delete')
    def synthetic_vlm_delete():
        vlm_installed.discard((request.get_json() or {}).get('model_id'))
        return jsonify({'ok':True})
if scans:
    patch('backend.services.classification_jobs.ensure_worker').start()
    folders=[str(fixture.case/'照片'),str(fixture.case/'其他照片')]
    for i,path in enumerate([Path(folders[0])/'one.jpg',Path(folders[0])/'子目录/two.jpg',Path(folders[1])/'three.jpg']):
        path.parent.mkdir(parents=True,exist_ok=True);Image.new('RGB',(96,96),'green').save(path)
        media_ids.append(fixture.seed(path,media_type='image'))
    for name in ('导入识别.jpg','仅导入.jpg'):
        path=fixture.case/name;Image.new('RGB',(96,96),'green').save(path);import_paths.append(str(path))
    import shutil,subprocess
    video=fixture.case/'synthetic.mp4';audio=fixture.case/'synthetic.wav'
    subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=160x96:r=2:d=0.5',
                    '-c:v','libx264','-pix_fmt','yuv420p',str(video)],check=True)
    subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','sine=frequency=440:duration=0.2',str(audio)],check=True)
    for kind in ('image','video','all','off','none'):
        folder=fixture.case/('import-'+kind);folder.mkdir();paths=[]
        for source,ext in ((Path(import_paths[0]),'jpg'),(video,'mp4'),(audio,'wav')):
            file=folder/(kind+'.'+ext);shutil.copyfile(source,file);paths.append(str(file))
        typed_import_paths[kind]=paths
    patch('backend.services.embedding.compute_embedding',return_value=None).start()
    from backend.services import people as identities
    cache=fixture.case/'people-cache';cache.mkdir();Image.new('RGB',(112,112),'gray').save(cache/'unclear.jpg')
    identities.record_observations(get_db(),media_ids[0],'synthetic-v1','synthetic',[{'sample_key':'unclear','bbox':[.1,.1,.5,.5],
         'feature':None,'quality':.1,'score':.8,'crop_path':'unclear.jpg'}])
@app.get('/')
def index():return app.send_static_file('index.html')
@app.get('/api/local-vlm/models')
def models():
    if not model_selects:return jsonify({'models':[],'engine':{}})
    from backend.local_vlm import MODELS
    return jsonify([{'id':key,**{k:v for k,v in item.items() if k in ('label','quant','size_gb','min_ram_gb','audio')},'installed':key in vlm_installed} for key,item in MODELS.items()])
@app.get('/api/local-vlm/download')
def download():
    if not model_selects:return jsonify({'state':'idle'})
    if vlm_job['state']=='downloading':
        vlm_job['done_bytes']=min(4096,int((time.monotonic()-vlm_job['started'])*2048))
        if vlm_job['done_bytes']==4096:vlm_job['state']='done';vlm_installed.add(vlm_job['model_id'])
    return jsonify(vlm_job)
@app.before_request
def isolate():
    if model_selects and request.path in ('/api/local-vlm/download','/api/local-vlm/delete'):return None
    if not model_selects and request.method=='POST' and request.path.startswith('/api/taxonomy/models/'):
        return jsonify({'error':'Synthetic model download fixture is required'}),403
    if os.environ.get('FACE_MODEL_SETUP_FIXTURE')!='1' and request.method=='POST' and request.path.startswith('/api/people/models/download'):
        return jsonify({'error':'Synthetic face download fixture is required'}),403
    if request.method=='POST' and request.path.startswith('/api/library/import'):
        body=request.get_json(silent=True) or {}
        if not scans or any(not Path(p).is_relative_to(fixture.case) for p in body.get('paths',[])):
            return jsonify({'error':'Only synthetic fixture imports are allowed'}),403
    if request.method not in ('GET','HEAD','OPTIONS') and (request.path.startswith(('/api/analysis','/api/local-vlm','/api/taxonomy/jobs','/api/taxonomy/relationships/jobs','/api/background-tasks/control')) or (not scans and request.path.startswith('/api/people/jobs')) or request.path.endswith('/generate')):
        return jsonify({'error':'Synthetic settings fixture: inference and tasks disabled'}),403

tag=taxonomy.create_node(get_db(),{'name':'设置验证标签'})
get_db().commit()
server=make_server('127.0.0.1',0,app,threaded=True)
info={'url':f'http://127.0.0.1:{server.server_port}','tag_id':tag['id'],'scratch':str(_ROOT),'pid':os.getpid(),
      'media_ids':media_ids,'raw_media':raw_media,'folders':folders,'import_paths':import_paths,'typed_import_paths':typed_import_paths,**setup_info}
Path(os.environ.get('RECOGNITION_SETTINGS_FIXTURE','/tmp/luminisle-recognition-settings-fixture.json')).write_text(json.dumps(info))
print(json.dumps(info),flush=True)
try:server.serve_forever()
finally:server.server_close();fixture.doCleanups()
