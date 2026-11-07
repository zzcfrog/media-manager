"""People UI fixture: synthetic pixels and identities, isolated temporary database."""
from support import DatabaseCase, _ROOT
import json
import os
from pathlib import Path
import subprocess
from PIL import Image, ImageDraw
from flask import jsonify, request
from werkzeug.serving import make_server
from backend.db import get_db
from backend.config import THUMB_DIR
from backend.blueprints import people as people_api, settings
from backend.services import people

fixture=DatabaseCase();fixture.setUp();app=fixture.app
if 'people' not in app.blueprints:app.register_blueprint(people_api.bp,url_prefix='/api/people')
app.register_blueprint(settings.bp,url_prefix='/api/settings')
app.static_folder=str(Path(__file__).resolve().parents[1]/'frontend')
@app.get('/')
def index():return app.send_static_file('index.html')
@app.get('/api/local-vlm/download')
def download():return jsonify({'state':'idle'})
@app.get('/api/local-vlm/models')
def models():return jsonify({'models':[],'engine':{}})
@app.before_request
def isolate():
    if os.environ.get('PEOPLE_RESCAN_FIXTURE')=='1' and app.config['TESTING']:
        if request.path=='/api/people/jobs' and request.method=='POST' and request.get_json(silent=True)=={'scope':'review','existing':'rescan'}:return
        if request.path=='/api/people/jobs/control' and request.method=='POST':return
    if request.method not in ('GET','HEAD','OPTIONS') and (request.path.startswith('/api/local-vlm') or request.path.startswith('/api/analysis') or request.path.startswith('/api/settings') or request.path.startswith('/api/people/jobs') or request.path=='/api/people/settings'):
        return jsonify({'error':'Synthetic fixture: inference and external work disabled'}),403

db=get_db();people.init_schema(db)
THUMB_DIR.mkdir(parents=True,exist_ok=True);cache=Path(app.config['DATABASE']).parent/'people-cache';cache.mkdir(exist_ok=True)
portrait=Image.new('RGB',(200,200),(203,220,207));draw=ImageDraw.Draw(portrait)
draw.ellipse((60,38,140,134),fill=(218,184,154));draw.pieslice((55,18,145,115),180,360,fill=(52,72,64))
draw.ellipse((33,130,167,260),fill=(101,129,114));draw.line((79,84,85,84),fill=(75,79,68),width=3);draw.line((115,84,121,84),fill=(75,79,68),width=3)
portrait.save(cache/'synthetic-face.jpg')
photo_ids=[];face_ids=[]
for index in range(86):
    image=Image.new('RGB',(640,420),(190+index%12,211,198));d=ImageDraw.Draw(image)
    d.ellipse((440,35,505,100),fill=(245,223,177));d.polygon([(0,290),(170,135),(270,235),(420,100),(640,310),(640,420),(0,420)],fill=(69,111,98))
    image.paste(portrait.resize((100,100)),(260,285));d.text((15,390),f'SYNTHETIC {index:02}',fill='white')
    path=fixture.case/f'People-{index:02}.jpg';image.save(path);image.save(THUMB_DIR/path.name)
    mid=fixture.seed(path,media_type='image',thumbnail_path=path.name,width=640,height=420,file_size=path.stat().st_size,favorite=1 if index%2==0 else 0,imported_at='2026-10-30 12:00:00')
    vector=[1.,0.] if index<82 else [-1.,0.]
    result=people.record_observations(db,mid,'synthetic-v1','synthetic-model',[{'sample_key':'photo','bbox':[.4,.65,.18,.3],'feature':vector,'quality':.99,'score':.99,'crop_path':'synthetic-face.jpg'}])
    photo_ids.append(mid);face_ids.append(result['faces'][0]['id'])
lin=people.list_people(db,sort='count')[0]
people.update_person(db,lin['id'],{'name':'小林'},lin['version'])
other=next(p for p in people.list_people(db) if p['id']!=lin['id'])
people.update_person(db,other['id'],{'name':'阿远'},other['version'])
extra=fixture.case/'Unnamed.jpg';portrait.save(extra);portrait.save(THUMB_DIR/'unnamed.jpg')
umid=fixture.seed(extra,media_type='image',thumbnail_path='unnamed.jpg',width=200,height=200)
new=people.record_observations(db,umid,'synthetic-v1','synthetic-model',[{'sample_key':'photo','bbox':[.2,.1,.6,.8],'feature':[.8,.6],'quality':.99,'score':.99,'crop_path':'synthetic-face.jpg'}],threshold=.95)
unknown=new['created_person_ids'][0]
video=fixture.case/'People-video.mp4'
subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=160x96:r=10:d=3','-c:v','libx264','-pix_fmt','yuv420p','-y',str(video)],check=True)
vmid=fixture.seed(video,media_type='video',thumbnail_path='People-00.jpg',duration=3,width=160,height=96)
people.record_observations(db,vmid,'synthetic-v1','synthetic-model',[{'sample_key':'frame-'+str(t),'frame_time':t,'bbox':[.2,.1,.4,.7],'feature':[1.,0.],'quality':.99,'score':.99,'crop_path':'synthetic-face.jpg'} for t in (.5,1.5)])
for index in range(41):
    candidate=people.create_person(db,'分页核对候选 '+str(index))
    people._review(db,'merge',lin['id'],candidate['id'],payload={'origin':'synthetic pagination fixture'})
db.commit()
unrecognized=fixture.case/'Manual-only.jpg';portrait.save(unrecognized);portrait.save(THUMB_DIR/'manual-only.jpg')
manual_id=fixture.seed(unrecognized,media_type='image',thumbnail_path='manual-only.jpg',width=200,height=200)
review_fixture={}
if os.environ.get('PEOPLE_REVIEW_FIXTURE')=='1':
    # Existing automatic membership stays in place when a rescan suggests someone else.
    for index in (0,1):
        people.record_observations(db,photo_ids[index],'synthetic-v1','synthetic-model',[
            {'sample_key':'photo','bbox':[.4,.65,.18,.3],'feature':[-1.,0.],
             'quality':.99,'score':.99,'crop_path':'synthetic-face.jpg'}])
    low=fixture.case/'Low-quality.jpg';portrait.resize((18,18)).resize((200,200)).save(low)
    Image.open(low).save(THUMB_DIR/'low-quality.jpg')
    low_id=fixture.seed(low,media_type='image',thumbnail_path='low-quality.jpg',width=200,height=200)
    low_result=people.record_observations(db,low_id,'synthetic-v1','synthetic-model',[
        {'sample_key':'photo','bbox':[.1,.1,.8,.8],'feature':None,'quality':.1,'score':.7,'crop_path':'synthetic-face.jpg'}])
    hidden=people.create_person(db,'小林')
    people.update_person(db,hidden['id'],{'hidden':True},hidden['version'])
    db.commit()
    face_reviews=people.list_reviews(db,kind='face')
    review_fixture={'face_reviews':face_reviews,'low_quality_media_id':low_id,
                    'low_quality_face_id':low_result['faces'][0]['id'],'hidden_homonym_id':hidden['id']}
if os.environ.get('PEOPLE_RESCAN_FIXTURE')=='1':
    from backend.services import people_jobs
    review_media={row[0] for row in db.execute("SELECT f.media_id FROM people_reviews r JOIN people_faces f ON f.id=r.face_id WHERE r.state='pending'")}
    for review in db.execute("SELECT left_id,right_id FROM people_reviews WHERE state='pending' AND kind='merge'"):
        for pid in review:
            review_media.update(row[0] for row in db.execute('SELECT media_id FROM ('+people.MEMBERSHIP_SQL+') WHERE person_id=?',(pid,)))
    first=people_jobs.enqueue(db,min(review_media));db.commit()
    with db:db.execute("UPDATE people_jobs SET state='running',lease='synthetic-active-lease',lease_until=9999999999 WHERE id=?",(first,))
    review_fixture['rescan_media_ids']=sorted(review_media)
server=make_server('127.0.0.1',0,app,threaded=True)
info={'url':f'http://127.0.0.1:{server.server_port}','scratch':str(_ROOT),'pid':os.getpid(),'person_id':lin['id'],'other_id':other['id'],'unknown_id':unknown,'image_ids':photo_ids,'face_ids':face_ids,'video_id':vmid,'manual_id':manual_id,'database':app.config['DATABASE'],'people_count':len(people.list_people(db)),'cover_face_count':84,'merge_review_count':42,**review_fixture}
Path(os.environ.get('PEOPLE_BROWSER_FIXTURE','/tmp/luminisle-people-fixture.json')).write_text(json.dumps(info))
print(json.dumps(info),flush=True)
try:server.serve_forever()
finally:fixture.doCleanups()
