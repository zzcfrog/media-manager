"""Explicit opt-in real ONNX smoke test over PRIOR benchmark caches, never originals.

Run from repository root: .build-venv/bin/python tests/people-model-smoke.py
No production factory/DB, no model download, no sensitive filenames in results.
"""
import argparse
import json
from datetime import date
from pathlib import Path
import shutil
import subprocess
import time

from support import DatabaseCase
from backend.services import face_engine, people_jobs, people
from PIL import Image

parser=argparse.ArgumentParser();parser.add_argument('--models-dir',type=Path,default=Path.home()/'models')
args=parser.parse_args();models=args.models_dir.expanduser().resolve()
fixture=DatabaseCase();fixture.setUp()
root=Path('build/face-benchmark-2026-10-29').resolve()
faces=json.loads((root/'results/faces.json').read_text())
chosen=[]
for face in faces:
    if face['photo_id'] not in chosen:chosen.append(face['photo_id'])
    if len(chosen)==6:break
sources=[root/'samples'/p/'preview.jpg' for p in chosen]
before={p:(p.stat().st_size,p.stat().st_mtime_ns) for p in sources}
report={'date':date.today().isoformat(),'scope':'Isolated library; six prior benchmark previews only; no originals/production DB accessed','models':{}}
try:
    for profile in ('buffalo_l','raccoon_s'):
        start=time.perf_counter();model=face_engine.load_engine(models/profile,profile)
        initialized=time.perf_counter()-start;total_faces=0;qualified=0;elapsed=[]
        assert not model.observe(Image.new('RGB',(640,480),'white'))
        for source in sources:
            with Image.open(source) as im:
                start=time.perf_counter();rows=model.observe(im.convert('RGB'));elapsed.append(time.perf_counter()-start)
            total_faces+=len(rows);qualified+=sum(r['feature'] is not None and r['quality']>=.35 for r in rows)
        report['models'][profile]={'initialization_seconds':round(initialized,3),'cached_previews':6,
            'detected_faces':total_faces,'usable_faces':qualified,'warm_total_seconds':round(sum(elapsed),3),
            'blank_no_faces':True,'available_session_providers':model.detector.get_providers()}
        print(profile,report['models'][profile],flush=True)
        assert total_faces>0 and qualified>0
    people_jobs.configure(fixture.db,{'profile':'buffalo_l','model_dir':str(models/'buffalo_l'),'enabled':False,'max_frames':3});fixture.db.commit()
    photo=fixture.case/'sample.jpg';shutil.copyfile(sources[0],photo)
    mid=fixture.seed(photo,media_type='image',file_size=photo.stat().st_size,file_mtime=photo.stat().st_mtime)
    people_jobs.enqueue(fixture.db,mid);fixture.db.commit();job=people_jobs.claim(fixture.db)
    start=time.perf_counter();assert people_jobs.process(fixture.db,job)
    count=fixture.db.execute('SELECT COUNT(*) FROM people_faces WHERE media_id=?',(mid,)).fetchone()[0];assert count>0
    f=fixture.db.execute('SELECT id,person_id FROM people_faces WHERE media_id=? AND person_id IS NOT NULL',(mid,)).fetchone();assert f
    person=people.get_person(fixture.db,f['person_id'])
    people.update_person(fixture.db,person['id'],{'name':'Isolated person'},person['version'])
    people.decide_faces(fixture.db,[f['id']],'confirm');fixture.db.commit()
    people_jobs.enqueue(fixture.db,mid,force=True);fixture.db.commit()
    assert people_jobs.process(fixture.db,people_jobs.claim(fixture.db))
    assert fixture.db.execute('SELECT assignment FROM people_faces WHERE id=?',(f['id'],)).fetchone()[0]=='manual'
    report['pipeline']={'face_count':count,'photo_and_rescan_seconds':round(time.perf_counter()-start,3),
        'manual_decision_rescan_preserved':True,'foreign_key_check':len(fixture.db.execute('PRAGMA foreign_key_check').fetchall())}
    video=fixture.case/'generated-sample.mp4'
    subprocess.run(['ffmpeg','-nostdin','-v','error','-loop','1','-i',str(photo),'-t','3','-r','2',
                    '-vf',"scale='min(1000,iw)':-2",'-c:v','libx264','-pix_fmt','yuv420p','-y',str(video)],check=True)
    vid=fixture.seed(video,media_type='video',duration=3,fps='2/1',file_size=video.stat().st_size,file_mtime=video.stat().st_mtime)
    people_jobs.enqueue(fixture.db,vid);fixture.db.commit()
    assert people_jobs.process(fixture.db,people_jobs.claim(fixture.db))
    points=[r[0] for r in fixture.db.execute('SELECT DISTINCT frame_time FROM people_faces WHERE media_id=? AND active=1 ORDER BY frame_time',(vid,))]
    assert points and len(points)<=people_jobs.settings(fixture.db)['video_identity_samples'] and all(p in (0.,.5,1.,1.5,2.,2.5) for p in points),points
    assert any(p['video_count']==1 for p in people.media_people(fixture.db,vid)['people'])
    video.unlink();people_jobs.enqueue(fixture.db,vid,force=True);fixture.db.commit()
    try:
        people_jobs.process(fixture.db,people_jobs.claim(fixture.db))
    except FileNotFoundError:
        pass
    else:
        raise AssertionError('Continuous tracking must wait for an offline original video')
    report['pipeline'].update(video_observation_points=points,video_media_deduplicated=True,offline_video_waits_for_original=True)
    assert before=={p:(p.stat().st_size,p.stat().st_mtime_ns) for p in sources}
    report['benchmark_cache_unchanged']=True
    output=Path('build/people-model-smoke');output.mkdir(parents=True,exist_ok=True)
    (output/'results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print('isolated actual model pipeline passed',flush=True)
finally:
    fixture.doCleanups()
