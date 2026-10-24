"""Synthetic browser fixture; never starts the real application or its models."""
from support import DatabaseCase, _ROOT
import os
import json
from pathlib import Path
import subprocess
from flask import jsonify, request
from werkzeug.serving import make_server
from PIL import Image
from backend.blueprints import settings
from backend.config import THUMB_DIR
from backend.db import get_db
from backend.blueprints import analysis
import numpy as np

fixture=DatabaseCase();fixture.setUp();app=fixture.app
app.static_folder=str(Path(__file__).resolve().parents[1]/'frontend')
app.register_blueprint(settings.bp,url_prefix='/api/settings')
@app.route('/')
def index():return app.send_static_file('index.html')
@app.route('/api/local-vlm/download')
def download():return jsonify({'state':'idle'})
@app.route('/api/local-vlm/models')
def models():return jsonify({'models':[],'engine':{}})
@app.before_request
def block_external_work():
    if request.method not in ('GET','HEAD','OPTIONS') and (
        request.path.startswith('/api/local-vlm') or request.path.startswith('/api/analysis') and request.method=='POST'
        or request.path.endswith('/generate') or request.path.startswith('/api/settings')):
        return jsonify({'error':'synthetic test: external work disabled'}),403

THUMB_DIR.mkdir(parents=True,exist_ok=True)
Image.new('RGB',(128,72),'blue').save(THUMB_DIR/'test.jpg')
video=fixture.case/'Synthetic.mp4';avi=fixture.case/'Seekable.avi'
for destination,codec in [(video,'libx264'),(avi,'mpeg4')]:
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=128x72:r=10:d=12','-c:v',codec,'-pix_fmt','yuv420p','-y',str(destination)],check=True)
mid=fixture.seed(video,duration=12,width=128,height=72,thumbnail_path='test.jpg')
avi_id=fixture.seed(avi,duration=12,width=128,height=72,thumbnail_path='test.jpg')
image_ids=[]
for name in 'ABC':
    photo=fixture.case/(name+'.jpg');Image.new('RGB',(128,72),'green').save(photo)
    image_ids.append(fixture.seed(photo,media_type='image',width=128,height=72,thumbnail_path='test.jpg',embedding=np.array([1.,0.],dtype=np.float32).tobytes()))
analysis.save_segments(mid,[{'time_start':'00:00:00','time_end':'00:00:05','visual':'Synthetic scene','asr':'hello','subtitle':'caption'},{'time_start':'00:00:05','time_end':'00:00:10','visual':'Synthetic next scene'}])
db=get_db();sids=[r[0] for r in db.execute('SELECT id FROM media_segment WHERE media_id=? ORDER BY seq',(mid,))]
plan={'acts':[{'act_id':'a1','title':'Synthetic act','narratives':[{'narrative_id':'n1','text':'Synthetic narrative','shots':[{'segment_id':sids[0]}]},{'narrative_id':'n2','text':'Second narrative','shots':[{'segment_id':sids[1]}]}]}]}
pid=db.execute('INSERT INTO projects(name,ai_plan) VALUES (?,?)',('Synthetic project',json.dumps(plan))).lastrowid
db.executemany('INSERT INTO project_media VALUES (?,?)',[(pid,mid),(pid,avi_id)]);db.commit()
fixture.client.post(f'/api/creative/{pid}/apply')
audio_id = None
if os.environ.get('VIDEO_ANALYZER_UI_FIXTURE'):
    from backend.services.importer import _generate_thumbnail
    audio = fixture.case / 'Synthetic music.wav'
    subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','sine=frequency=220:duration=12','-y',str(audio)],check=True)
    audio_thumb = _generate_thumbnail(audio, 'audio')
    assert audio_thumb, 'Synthetic audio waveform thumbnail generation failed'
    audio_id = fixture.seed(audio,media_type='audio',duration=12,file_size=audio.stat().st_size,
                            audio_codec='pcm_s16le',audio_sample_rate=44100,audio_channels=1,thumbnail_path=audio_thumb)
    music = {'mood':[{'label':'Calm','weight':90}], 'genre':[{'label':'Ambient','weight':100}],
             'instrument':[{'label':'Piano','weight':100}], 'theme':[{'label':'Travel','weight':100}],
             'arousal':25,'valence':70,'vocals':'Instrumental','watermark':'None'}
    analysis.save_music_segments(audio_id,[{**music,'time_start':'00:00:00','time_end':'00:00:12'}],'Synthetic model',music)
    poster_root = Path(os.environ.get('VIDEO_ANALYZER_UI_POSTERS', str(_ROOT / 'unused-posters')))
    posters = sorted(poster_root.glob('*.jpg'))
    if posters:
        import shutil
        shutil.copy2(posters[0],THUMB_DIR/'test.jpg')
        subprocess.run(['ffmpeg','-v','error','-loop','1','-i',str(posters[-1]),'-f','lavfi','-i',
                        'sine=frequency=220:duration=12','-t','12','-vf','scale=640:400','-r','10',
                        '-c:v','libx264','-c:a','aac','-pix_fmt','yuv420p','-y',str(video)],check=True)
        db.execute('UPDATE media SET width=640,height=400,file_size=?,audio_codec=?,audio_sample_rate=44100,audio_channels=1 WHERE id=?',
                   (video.stat().st_size,'aac',mid))
        db.commit()
    for index, poster in enumerate(posters):
        import shutil
        thumbnail = 'ui-poster-' + str(index) + '.jpg'
        shutil.copy2(poster,THUMB_DIR/thumbnail)
        photo = fixture.case / ('Landscape-' + str(index) + '.jpg')
        shutil.copy2(poster,photo)
        image_ids.append(fixture.seed(photo,media_type='image',width=640,height=400,file_size=photo.stat().st_size,
                                      thumbnail_path=thumbnail,rating=index%5+1,camera_model='Synthetic camera',
                                      date_taken='2026-10-18 08:00:00'))
    for row in db.execute('SELECT id FROM media').fetchall():
        analysis.refresh_media_fts(db,row['id'])
    db.commit()
server=make_server('127.0.0.1',0,app,threaded=True)
info={'url':f'http://127.0.0.1:{server.server_port}','project_id':pid,'media_id':mid,'avi_id':avi_id,'image_ids':image_ids,'audio_id':audio_id,'segment_ids':sids,'scratch':str(_ROOT), 'pid':os.getpid()}
Path(__import__('os').environ.get('VIDEO_ANALYZER_TEST_FIXTURE', '/tmp/video-analyzer-fix-browser.json')).write_text(json.dumps(info))
print(json.dumps(info),flush=True)
try:server.serve_forever()
finally:server.server_close();fixture.doCleanups()
