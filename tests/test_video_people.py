"""Continuous video decode, official motion primitives and bounded identity work.

Only synthetic pixels/videos and isolated libraries; no real model downloads or media.
"""
from support import DatabaseCase
import hashlib
import importlib
from types import SimpleNamespace
from unittest.mock import patch
import numpy as np
from PIL import Image
from backend.services import face_engine,people_jobs,people


class SyntheticFaceEngine(face_engine.FaceEngine):
    def __init__(self):
        self.info={'key':'synthetic-identity-space'};self.verifier=None;self.detector_calls=0;self.embedding_calls=0
        self.recognizer=SimpleNamespace(get_inputs=lambda:[SimpleNamespace(name='input')],run=self._embed)

    def _embed(self,_,inputs):
        self.embedding_calls+=1
        pixels=next(iter(inputs.values()))[0]
        vector=np.zeros(512,dtype=np.float32);vector[int(np.argmax(pixels.mean(axis=(1,2))))]=1
        return [vector[None]]

    def detect(self,image):
        self.detector_calls+=1;pixels=np.asarray(image);faces=[]
        for channel in (0,1):
            mask=(pixels[:,:,channel]>160)&(pixels[:,:,2]<100)
            y,x=np.where(mask)
            if len(x)<100:continue
            box=np.array([x.min(),y.min(),x.max()+1,y.max()+1],dtype=float)
            side=min(box[2:]-box[:2]);points=face_engine._DEST*side/112+box[:2]
            faces.append({'box':box,'points':points,'score':.99})
        return faces


def frame(index,heads=((0,70,50),),background=40,width=320,height=180):
    pixels=np.full((height,width,3),background,dtype=np.uint8)
    for channel,x,y in heads:
        # Stable textured geometry moves across frames; slight color changes prevent
        # the existing byte-identical-crop feature cache hiding redundant inference.
        yy,xx=np.indices((64,64));texture=((xx//3+yy//3)%2)*65
        tile=np.repeat((25+texture)[:,:,None],3,axis=2).astype(np.uint8)
        tile[:,:,channel]=(180+texture+index%8).astype(np.uint8)
        pixels[y:y+64,x:x+64]=tile
    return Image.fromarray(pixels)


class VideoPeopleTests(DatabaseCase):
    def video(self):
        spec=importlib.util.find_spec('backend.services.video_people')
        self.assertIsNotNone(spec,'Continuous video face tracking is not implemented')
        return importlib.import_module('backend.services.video_people')

    def encode(self,path,timestamps=None):
        import subprocess
        times=timestamps or [i*40 for i in range(12)]
        expression='+'.join(str(t)+'*eq(N\\,'+str(i)+')' for i,t in enumerate(times))
        subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=160x96:r=25',
            '-frames:v',str(len(times)),'-vf',"settb=1/1000,setpts='"+expression+"'",'-enc_time_base','1/1000',
            '-fps_mode','vfr','-c:v','ffv1',str(path)],check=True)

    def test_sequential_decode_preserves_every_frame_and_vfr_timestamps_without_jpegs(self):
        video=self.video();path=self.case/'variable.mkv';times=[0,40,80,170,250,410,450]
        self.encode(path,times);before=hashlib.sha256(path.read_bytes()).hexdigest()
        rows=list(video.iter_frames(path,480,lambda:False))
        self.assertEqual(len(rows),len(times));np.testing.assert_allclose([r[0] for r in rows],np.array(times)/1000,atol=.001)
        self.assertTrue(all(image.size==(160,96) for _,image in rows))
        self.assertEqual(list(self.case.glob('**/*.jpg')),[])
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),before)

    def test_rotation_is_applied_like_normal_video_playback(self):
        import subprocess
        video=self.video();source=self.case/'upright.mp4';rotated=self.case/'rotated.mp4'
        subprocess.run(['ffmpeg','-nostdin','-v','error','-f','lavfi','-i','testsrc2=s=160x96:r=2:d=1',
            '-c:v','libx264','-pix_fmt','yuv420p',str(source)],check=True)
        subprocess.run(['ffmpeg','-nostdin','-v','error','-display_rotation','90','-i',str(source),'-c','copy',str(rotated)],check=True)
        first=next(video.iter_frames(rotated,480,lambda:False))[1]
        self.assertEqual(first.size,(96,160))
        reference=subprocess.run(['ffmpeg','-nostdin','-v','error','-i',str(rotated),'-frames:v','1','-f','rawvideo','-pix_fmt','rgb24','pipe:1'],capture_output=True,check=True)
        expected=np.frombuffer(reference.stdout,dtype=np.uint8).reshape(160,96,3)
        self.assertLess(np.abs(np.asarray(first,dtype=float)-expected).mean(),5.)

    def test_video_rate_samples_full_timeline_without_retiming_or_duplicate_frames(self):
        video=self.video();path=self.case/'rate.mkv';self.encode(path,[i*100 for i in range(40)])
        before=hashlib.sha256(path.read_bytes()).hexdigest()
        native=[round(t,6) for t,_ in video.iter_frames(path,480,lambda:False)]
        for fps,expected in [(1,[0.,1.,2.,3.]),(2,[i*.5 for i in range(8)]),
                             (3,[0.,.4,.7,1.,1.4,1.7,2.,2.4,2.7,3.,3.4,3.7])]:
            with self.subTest(fps=fps):
                times=[round(t,6) for t,_ in video.iter_frames(path,480,lambda:False,fps=fps)]
                self.assertEqual(times,expected)
                self.assertTrue(set(times).issubset(native))
        sparse=self.case/'already-sparse.mkv';self.encode(sparse,[0,1000,2000,3000])
        self.assertEqual([t for t,_ in video.iter_frames(sparse,480,lambda:False,fps=3)],[0.,1.,2.,3.])
        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(),before)
        self.assertEqual(list(self.case.glob('**/*.jpg')),[])

    def test_video_rate_rejects_unsupported_choices_before_decoding(self):
        video=self.video()
        for fps in (0,4,True,False,1.5,'2'):
            with self.subTest(fps=fps),self.assertRaises(ValueError):
                list(video.iter_frames(self.case/'unused.mkv',480,lambda:False,fps=fps))

    def test_tracking_defaults_to_four_representative_faces_for_a_stable_track(self):
        video=self.video();model=SyntheticFaceEngine()
        frames=[(i/30,frame(i,heads=((0,35+i//4,50),))) for i in range(150)]
        pipeline=video.VideoFacePipeline(model)
        observations=list(pipeline.run(iter(frames),lambda:False))
        self.assertEqual(len(observations),4)
        self.assertTrue(all(o['feature'] is not None for o in observations))
        self.assertLessEqual(model.embedding_calls,4);self.assertLess(model.detector_calls,90)
        self.assertEqual(pipeline.stats['decoded_frames'],150);self.assertEqual(pipeline.stats['tracks'],1)
        self.assertTrue(all(o['frame_time'] in {t for t,_ in frames} for o in observations))
        self.assertLessEqual(pipeline.stats['peak_candidates'],12)
        self.assertEqual(len(pipeline.tracks),0)

    def test_sparse_frames_do_not_end_a_matching_track_only_because_time_passed(self):
        video=self.video()
        cases=[(str(interval),[i*interval for i in range(12)])
               for interval in (.499999,.5,.500001,1.,2.,10.)]
        cases.append(('variable',[0.,.2,.700001,1.700001,3.7,15.7]))
        for name,times in cases:
            with self.subTest(interval=name):
                model=SyntheticFaceEngine();pipeline=video.VideoFacePipeline(model)
                observations=list(pipeline.run(iter((timestamp,frame(i)) for i,timestamp in enumerate(times)),lambda:False))
                self.assertEqual(pipeline.stats['tracks'],1)
                self.assertEqual(pipeline.stats['decoded_frames'],len(times))
                self.assertGreater(len(observations),0);self.assertLessEqual(len(observations),4)
                self.assertLessEqual(model.embedding_calls,4)
                self.assertTrue(all(o['feature'] is not None and o['frame_time'] in times for o in observations))

    def test_track_representative_budget_is_configurable_above_the_old_candidate_pool(self):
        video=self.video()
        for count in (1,3,8,48):
            with self.subTest(count=count):
                model=SyntheticFaceEngine();pipeline=video.VideoFacePipeline(model,identity_samples=count)
                rows=list(pipeline.run(iter((float(i),frame(i)) for i in range(100)),lambda:False))
                self.assertEqual(pipeline.stats['tracks'],1)
                self.assertEqual(len(rows),count)
                self.assertLessEqual(model.embedding_calls,count)
                self.assertLessEqual(pipeline.stats['peak_candidates'],max(6,count*2)+1)
                self.assertEqual(len(pipeline.tracks),0)
        for invalid in (0,-1,49,True,False,2.0,'3',None):
            with self.subTest(invalid=invalid),self.assertRaises(ValueError):
                video.VideoFacePipeline(SyntheticFaceEngine(),identity_samples=invalid)

    def test_worker_applies_track_budget_to_each_request_without_restarting(self):
        import io,json,pickle
        from backend.services import video_worker
        video=self.video();output=io.BytesIO();model=SyntheticFaceEngine()
        requests=[json.dumps({'id':str(n),'settings':{**people_jobs.settings(self.db),'video_identity_samples':n},
                             'path':'synthetic','resolution':480})+'\n' for n in (1,8)]
        with patch.object(face_engine,'load_engine',return_value=model),\
             patch.object(video,'iter_frames',side_effect=lambda *a,**k:iter((float(i),frame(i)) for i in range(40))),\
             patch.object(video_worker.sys,'stdin',requests),\
             patch.object(video_worker.sys,'stdout',SimpleNamespace(buffer=output)):
            video_worker.main()
        output.seek(0);events=[]
        while output.tell()<len(output.getvalue()):events.append(pickle.load(output))
        for count in (1,8):
            group=[e for e in events if e['id']==str(count)]
            self.assertEqual(group[-1]['event'],'done',group[-1])
            self.assertEqual(group[-1]['stats']['identity_candidates'],count)
            self.assertEqual(len([e for e in group if e['event']=='observation']),count)

    def test_sparse_frames_still_separate_cuts_missing_faces_and_frame_size_changes(self):
        video=self.video()
        cut_frames=[(float(i),frame(i,heads=((0 if i<3 else 1,70,50),),background=30 if i<3 else 190)) for i in range(6)]
        cases={'cut':cut_frames,'missing':[(0.,frame(0)),(1.,frame(1,heads=())),(2.,frame(2))],
               'size':[(0.,frame(0)),(1.,frame(1,width=400,height=240))]}
        for name,frames in cases.items():
            with self.subTest(boundary=name):
                pipeline=video.VideoFacePipeline(SyntheticFaceEngine())
                observations=list(pipeline.run(iter(frames),lambda:False))
                self.assertEqual(pipeline.stats['tracks'],2)
                self.assertEqual(len({o['track_id'] for o in observations}),2)
                if name=='cut':
                    self.assertGreaterEqual(pipeline.stats['scene_cuts'],1)
                    self.assertEqual({int(np.argmax(o['feature'])) for o in observations},{0,1})

    def test_cut_and_lost_face_end_tracks_and_never_force_an_identity_across_tracks(self):
        video=self.video();model=SyntheticFaceEngine();pipeline=video.VideoFacePipeline(model)
        frames=[(i/30,frame(i,heads=((0 if i<45 else 1,70,50),),background=30 if i<45 else 190)) for i in range(90)]
        observations=list(pipeline.run(iter(frames),lambda:False))
        self.assertGreaterEqual(pipeline.stats['scene_cuts'],1)
        self.assertEqual({int(np.argmax(o['feature'])) for o in observations},{0,1})
        self.assertGreaterEqual(len({o['track_id'] for o in observations}),2)
        mid=self.seed(media_type='video')
        for index,o in enumerate(observations):o.update(sample_key=str(index),crop_path='')
        people.record_observations(self.db,mid,'revision','synthetic',observations)
        self.assertEqual(len(people.media_people(self.db,mid)['people']),2)

    def test_new_motion_recovers_a_brief_face_between_periodic_detector_passes(self):
        video=self.video();model=SyntheticFaceEngine();pipeline=video.VideoFacePipeline(model)
        frames=[(0.,frame(0,heads=())),(1/30,frame(1)),(2/30,frame(2,heads=())),(.1,frame(3,heads=()))]
        observations=list(pipeline.run(iter(frames),lambda:False))
        self.assertTrue(observations);self.assertEqual({o['frame_time'] for o in observations},{1/30})

    def test_ineligible_frames_do_not_evict_a_usable_identity_anchor(self):
        video=self.video();model=SyntheticFaceEngine();pipeline=video.VideoFacePipeline(model)
        picture=frame(0);face=model.detect(picture)[0];track={'id':'one','candidates':[],'fallback':None}
        # Quality rank and eligibility are separate upstream outputs; a visually
        # strong frame may still fail pose/contrast/coverage gates.
        scores=iter([(.4,True,{})]+[(.9,False,{})]*15)
        with patch.object(video,'recognition_candidate_quality',side_effect=lambda *a,**k:next(scores)):
            for index in range(16):pipeline._candidate(track,index,index/30,picture,face)
        rows=list(pipeline._finish(track,lambda:False))
        self.assertEqual(len(rows),1);self.assertIsNotNone(rows[0]['feature']);self.assertEqual(rows[0]['frame_time'],0.)

    def test_simultaneous_faces_and_ambiguous_crossing_do_not_merge_distinct_people(self):
        video=self.video();model=SyntheticFaceEngine();pipeline=video.VideoFacePipeline(model)
        frames=[]
        for i in range(80):
            x=30+min(i,79-i)*2
            frames.append((i/30,frame(i,heads=((0,x,30),(1,220-x//2,85)))))
        observations=list(pipeline.run(iter(frames),lambda:False))
        self.assertEqual({int(np.argmax(o['feature'])) for o in observations},{0,1})
        self.assertLess(model.embedding_calls,80)
        self.assertTrue(all(o['bbox'][0]+o['bbox'][2]<=1.001 for o in observations))

    def test_cancel_failure_and_early_close_release_frames_and_keep_previous_results(self):
        video=self.video();model=SyntheticFaceEngine();closed=[]
        def frames():
            try:
                for i in range(100):yield i/30,frame(i)
            finally:closed.append(True)
        count=[0]
        def cancelled():count[0]+=1;return count[0]>15
        pipeline=video.VideoFacePipeline(model)
        with self.assertRaises(InterruptedError):list(pipeline.run(frames(),cancelled))
        self.assertEqual(closed,[True]);self.assertEqual(len(pipeline.tracks),0)
        path=self.case/'broken.mp4';path.write_bytes(b'broken')
        with self.assertRaises((RuntimeError,ValueError)):list(video.iter_frames(path,480,lambda:False))
        self.assertEqual(list(self.case.glob('**/*.jpg')),[])

    def test_partial_video_failure_removes_new_crops_and_preserves_manual_observations(self):
        self.video();source=self.case/'source.mp4';source.write_bytes(b'synthetic source')
        mid=self.seed(source,media_type='video',file_size=source.stat().st_size,file_mtime=source.stat().st_mtime)
        revision=people_jobs.input_revision(self.db,mid)
        old={'sample_key':'previous','frame_time':0.,'bbox':[.1,.1,.3,.3],'feature':[1.,0.],
             'quality':.9,'score':.9,'crop_path':''}
        face=people.record_observations(self.db,mid,revision,'old-space',[old])['faces'][0]
        people.decide_faces(self.db,[face['id']],'confirm');self.db.commit()
        before=[tuple(row) for row in self.db.execute('SELECT * FROM people_faces')]
        people_jobs.enqueue(self.db,mid);self.db.commit();job=people_jobs.claim(self.db)
        class PartialResult:
            model_key='new-space';stats={}
            def __init__(self,*args):pass
            def run(self):
                yield {**old,'frame_time':1.,'crop':Image.new('RGB',(112,112),'blue')}
                raise RuntimeError('synthetic decoder failure after a completed track')
        with patch('backend.services.video_runtime.VideoResult',PartialResult):
            with self.assertRaises(RuntimeError):people_jobs.process(self.db,job)
        self.assertEqual([tuple(row) for row in self.db.execute('SELECT * FROM people_faces')],before)
        self.assertEqual(list((self.case/'people-cache').glob('*.jpg')),[])

    def test_truncated_video_never_reports_a_successful_complete_decode(self):
        video=self.video();path=self.case/'truncated.mkv';self.encode(path)
        data=path.read_bytes();path.write_bytes(data[:len(data)*3//4])
        with self.assertRaises(RuntimeError):list(video.iter_frames(path,480,lambda:False))

    def test_video_job_uses_tracking_not_the_image_sampling_pipeline(self):
        self.video();path=self.case/'sample.mkv';self.encode(path)
        from face_model_fixtures import model_bytes
        files={}
        for stage in ('detector','recognizer'):
            file=self.case/(stage+'.onnx');file.write_bytes(model_bytes(stage));files[stage+'_path']=str(file)
        people_jobs.configure(self.db,{'profile':'buffalo_l',**files});self.db.commit()
        mid=self.seed(path,media_type='video',duration=.48,fps='25/1',file_size=path.stat().st_size,file_mtime=path.stat().st_mtime)
        people_jobs.enqueue(self.db,mid);self.db.commit();job=people_jobs.claim(self.db)
        with patch.object(face_engine,'load_engine',side_effect=AssertionError('Video models must load in the isolated worker')),patch.object(face_engine,'read_frames',side_effect=AssertionError('Video must not export sampled still frames')):
            self.assertTrue(people_jobs.process(self.db,job))
        self.assertEqual(self.db.execute('SELECT scope FROM people_jobs WHERE id=?',(job['id'],)).fetchone()[0],'tracked_video')

    def test_worker_reuses_models_and_cancellation_resets_only_the_private_worker(self):
        self.video()
        from face_model_fixtures import model_bytes
        from backend.services.video_runtime import VideoRuntime
        files={}
        for stage in ('detector','recognizer'):
            file=self.case/(stage+'.onnx');file.write_bytes(model_bytes(stage));files[stage+'_path']=str(file)
        path=self.case/'worker.mkv';self.encode(path)
        cfg={**people_jobs.settings(self.db),'profile':'custom',**files}
        runtime=VideoRuntime();self.addCleanup(runtime.close)
        request={'settings':cfg,'path':str(path),'resolution':480}
        first=list(runtime.run(request,lambda:False));pid=runtime.process.pid
        second=list(runtime.run(request,lambda:False))
        self.assertEqual(runtime.process.pid,pid);self.assertEqual(first[-1]['stats']['decoded_frames'],1)
        self.assertEqual(first[0]['model_key'],second[0]['model_key'])
        stop=[False];events=runtime.run(request,lambda:stop[0]);self.assertEqual(next(events)['event'],'ready')
        stop[0]=True
        with self.assertRaises(InterruptedError):next(events)
        self.assertIsNone(runtime.process)
        self.assertEqual(list(runtime.run(request,lambda:False))[-1]['event'],'done')
        bad={**request,'settings':{**cfg,'detector_path':str(self.case/'offline.onnx')}}
        with self.assertRaises(FileNotFoundError):list(runtime.run(bad,lambda:False))

    def test_private_worker_applies_each_selected_rate_without_changing_identity_space(self):
        self.video()
        from face_model_fixtures import model_bytes
        from backend.services.video_runtime import VideoRuntime
        files={}
        for stage in ('detector','recognizer'):
            file=self.case/(stage+'.onnx');file.write_bytes(model_bytes(stage));files[stage+'_path']=str(file)
        source=self.case/'rates.mkv';self.encode(source,[i*100 for i in range(40)])
        runtime=VideoRuntime();self.addCleanup(runtime.close);keys=set();pids=set()
        for fps in (1,2,3):
            cfg={**people_jobs.settings(self.db),'profile':'custom',**files,'video_fps':fps}
            events=list(runtime.run({'settings':cfg,'path':str(source),'resolution':480},lambda:False))
            self.assertEqual(events[-1]['stats']['decoded_frames'],4*fps)
            keys.add(events[0]['model_key']);pids.add(runtime.process.pid)
        self.assertEqual(len(keys),1);self.assertEqual(len(pids),1)

    def test_parent_video_adapter_does_not_load_opencv_into_the_existing_audio_runtime(self):
        import subprocess,sys
        result=subprocess.run([sys.executable,'-c',"import faster_whisper,sys;from backend.services import video_runtime;assert 'cv2' not in sys.modules"],capture_output=True,text=True,timeout=30)
        self.assertEqual(result.returncode,0,result.stderr)
        self.assertNotIn('AVFFrameReceiver is implemented in both',result.stderr)

    def test_video_ignores_analysis_fps_window_budget_and_resolution(self):
        self.video();before=people_jobs.video_settings(self.db)
        for key,value in {'fps':'120','local_frames_fps':'.25','local_frames_max':'1'}.items():
            self.db.execute('INSERT OR REPLACE INTO settings VALUES (?,?)',(key,value))
        self.assertEqual(people_jobs.video_settings(self.db),before)
        self.db.execute("INSERT OR REPLACE INTO settings VALUES ('resolution','720')")
        self.assertEqual(people_jobs.video_settings(self.db),before)
