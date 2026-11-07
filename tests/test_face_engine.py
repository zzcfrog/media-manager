"""Local face input/math contracts; synthetic pixels, no production models or files."""
from support import DatabaseCase
import importlib
import io
import unittest
import numpy as np
from PIL import Image

try:
    engine = importlib.import_module('backend.services.face_engine')
except ModuleNotFoundError:
    engine = None


class FaceEngineTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.assertIsNotNone(engine, 'Local face engine is not implemented')

    def test_alignment_identity_rotation_and_degenerate_rejection(self):
        dest=np.array([[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],
                       [41.5493,92.3655],[70.7299,92.2041]])
        for angle,scale,offset in [(0,1,[0,0]),(.3,1.5,[5,-8]),(-.7,.8,[30,4])]:
            rotation=np.array([[np.cos(angle),-np.sin(angle)],[np.sin(angle),np.cos(angle)]])
            points=dest@rotation.T*scale+np.array(offset)
            matrix=engine.alignment_matrix(points)
            np.testing.assert_allclose(np.column_stack([points,np.ones(5)])@matrix.T,dest,atol=.001)
        with self.assertRaises(ValueError):engine.alignment_matrix(np.ones((5,2)))

    def test_nms_is_score_ordered_and_handles_empty(self):
        boxes=np.array([[0,0,100,100],[2,2,98,98],[150,0,200,50]],dtype=float)
        self.assertEqual(engine.nms(boxes,np.array([.8,.9,.7])),[1,2])
        self.assertEqual(engine.nms(np.zeros((0,4)),np.array([])),[])

    def test_vector_normalization_rejects_invalid_features(self):
        np.testing.assert_allclose(engine.normalized([3.,4.]),[.6,.8])
        for v in ([0.,0.],[float('nan'),1.]):
            with self.assertRaises(ValueError):engine.normalized(v)

    def test_video_sampling_is_bounded_unique_and_rejects_bad_duration(self):
        samples=engine.sample_times(3600,24)
        self.assertEqual(len(samples),24)
        self.assertEqual(samples,sorted(set(samples)))
        self.assertTrue(all(0<=n<3600 for n in samples))
        self.assertEqual(engine.sample_times(.05,24),[0.])
        with self.assertRaises(ValueError):engine.sample_times(float('nan'),24)

    def test_external_profile_must_have_exact_pair_without_download(self):
        root=self.case/'model';root.mkdir()
        with self.assertRaises(FileNotFoundError):engine.model_info(root,'buffalo_l')
        for name in ('det_10g.onnx','w600k_r50.onnx'):(root/name).write_bytes(name.encode())
        first=engine.model_info(root,'buffalo_l')
        self.assertEqual(first['profile'],'buffalo_l')
        self.assertEqual(len(first['key']),64)
        (root/'w600k_r50.onnx').write_bytes(b'changed')
        self.assertNotEqual(first['key'],engine.model_info(root,'buffalo_l')['key'])
        with self.assertRaises(ValueError):engine.model_info(root,'unknown')

    def test_coreml_compilation_failure_uses_existing_cpu_provider(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        import onnxruntime as ort
        calls=[]
        def session(path,**kwargs):
            calls.append(kwargs['providers'])
            if len(kwargs['providers'])>1:raise RuntimeError('synthetic unavailable CoreML compiler')
            detector=path=='det.onnx'
            return SimpleNamespace(get_outputs=lambda:[None]*(9 if detector else 1),
                                   get_inputs=lambda:[SimpleNamespace(shape=[1,3,640,640] if detector else [1,3,112,112],type='tensor(float)')])
        with patch.object(ort,'get_available_providers',return_value=['CoreMLExecutionProvider','CPUExecutionProvider']),patch.object(ort,'InferenceSession',side_effect=session):
            engine.FaceEngine({'paths':['det.onnx','rec.onnx'],'key':'synthetic'})
        self.assertEqual(calls[-1],['CPUExecutionProvider'])

    def test_image_prefers_usable_cache_without_original_read(self):
        from unittest.mock import patch
        preview=self.case/'thumbs';preview.mkdir()
        Image.new('RGB',(1200,800),'green').save(preview/'cached.jpg')
        row={'id':1,'media_type':'image','thumbnail_path':'cached.jpg','file_path':str(self.case/'offline.jpg')}
        with patch.object(engine,'THUMB_DIR',preview):
            frames,scope=engine.read_frames(row,self.case/'cache',cancelled=lambda:False)
        self.assertEqual(scope,'image_preview')
        self.assertEqual(len(frames),1)
        self.assertEqual(frames[0][0],None)
        self.assertEqual(frames[0][1].size,(1200,800))

    def test_cache_traversal_does_not_read_unrelated_file(self):
        from unittest.mock import patch
        preview=self.case/'thumbs';preview.mkdir()
        Image.new('RGB',(300,300),'green').save(self.case/'private.jpg')
        row={'id':1,'media_type':'image','thumbnail_path':'../private.jpg','file_path':str(self.case/'offline.jpg')}
        with patch.object(engine,'THUMB_DIR',preview):
            with self.assertRaises(FileNotFoundError):engine.read_frames(row,self.case/'cache',cancelled=lambda:False)

    def test_offline_small_image_cache_waits_instead_of_generating_low_quality_faces(self):
        from unittest.mock import patch
        preview=self.case/'thumbs';preview.mkdir()
        for width in (320,799,800):
            Image.new('RGB',(width,width),'green').save(preview/'cached.jpg')
            row={'id':1,'media_type':'image','thumbnail_path':'cached.jpg','file_path':str(self.case/'offline.jpg')}
            with patch.object(engine,'THUMB_DIR',preview):
                if width<800:
                    with self.assertRaisesRegex(FileNotFoundError,'高清预览'):engine.read_frames(row,self.case/'cache',lambda:False)
                else:
                    self.assertEqual(engine.read_frames(row,self.case/'cache',lambda:False)[1],'image_preview')

    def test_online_image_uses_original_when_cache_is_too_small(self):
        from unittest.mock import patch
        preview=self.case/'thumbs';preview.mkdir();Image.new('RGB',(320,240),'red').save(preview/'cached.jpg')
        original=self.case/'original.jpg';Image.new('RGB',(2400,1600),'green').save(original)
        row={'id':1,'media_type':'image','thumbnail_path':'cached.jpg','file_path':str(original)}
        with patch.object(engine,'THUMB_DIR',preview):frames,scope=engine.read_frames(row,self.case/'cache',lambda:False)
        self.assertEqual(scope,'image_preview');self.assertEqual(frames[0][1].size,(1600,1067))

    def test_corrupt_original_does_not_fall_back_to_blurry_cache(self):
        from unittest.mock import patch
        preview=self.case/'thumbs';preview.mkdir();Image.new('RGB',(320,240),'gray').save(preview/'cached.jpg')
        original=self.case/'bad.jpg';original.write_bytes(b'synthetic invalid image')
        row={'id':1,'media_type':'image','thumbnail_path':'cached.jpg','file_path':str(original)}
        with patch.object(engine,'THUMB_DIR',preview):
            with self.assertRaisesRegex(FileNotFoundError,'图片解码失败'):engine.read_frames(row,self.case/'cache',lambda:False)

    def test_video_cache_is_revision_scoped_and_all_points_are_real(self):
        import subprocess
        video=self.case/'synthetic.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=160x96:r=5:d=2',
                        '-c:v','libx264','-pix_fmt','yuv420p','-y',str(video)],check=True)
        row={'id':1,'media_type':'video','duration':2,'file_path':str(video),'thumbnail_path':None}
        frames,scope=engine.read_frames(row,self.case/'cache',cancelled=lambda:False,max_frames=3,revision='a')
        self.assertEqual(scope,'sampled_video')
        self.assertEqual(len(frames),3)
        self.assertEqual([t for t,_ in frames],engine.sample_times(2,3))
        video.unlink()
        cached,_=engine.read_frames(row,self.case/'cache',cancelled=lambda:False,max_frames=3,revision='a')
        self.assertEqual(len(cached),3)
        with self.assertRaises(FileNotFoundError):engine.read_frames(row,self.case/'cache',cancelled=lambda:False,max_frames=3,revision='b')

    def test_cancelled_read_never_starts_decoder(self):
        row={'id':1,'media_type':'video','duration':2,'file_path':'offline','thumbnail_path':None}
        with self.assertRaises(InterruptedError):engine.read_frames(row,self.case/'cache',cancelled=lambda:True)

    def test_raw_embedded_previews_are_bounded_and_small_ones_wait_for_original(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        from backend.services import raw_preview
        for index,size in enumerate(((3200,2400),(224,168))):
            raw=self.case/(str(index)+'.nef');raw.write_bytes(b'synthetic')
            buffer=io.BytesIO();Image.new('RGB',size,'green').save(buffer,format='JPEG')
            with patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'),patch.object(engine.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=buffer.getvalue())),patch('rawpy.imread',side_effect=RuntimeError('synthetic decoder unavailable')):
                if size[0]<800:
                    with self.assertRaises(FileNotFoundError):engine.read_frames({'id':1,'media_type':'image','file_path':str(raw),'thumbnail_path':None},self.case/'cache',lambda:False)
                    continue
                frames,scope=engine.read_frames({'id':1,'media_type':'image','file_path':str(raw),'thumbnail_path':None},self.case/'cache',lambda:False)
            self.assertLessEqual(max(frames[0][1].size),2560)
            self.assertEqual(scope,'image_preview')

    def test_low_fps_video_samples_snap_to_existing_frame_times(self):
        import subprocess
        video=self.case/'slow.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','testsrc2=s=160x96:r=1:d=2','-c:v','libx264','-pix_fmt','yuv420p','-y',str(video)],check=True)
        frames,scope=engine.read_frames({'id':2,'media_type':'video','duration':2,'fps':'1/1','file_path':str(video),'thumbnail_path':None},self.case/'cache',lambda:False,max_frames=3)
        self.assertEqual([t for t,_ in frames],[0.,1.])

    def test_content_changes_receive_more_of_the_bounded_video_budget(self):
        times=[0.,10.,20.,30.]
        frames=[Image.new('RGB',(32,32),'black') for _ in times]
        frames[-1]=Image.new('RGB',(32,32),'white')
        result=engine.adaptive_times(times,frames,10)
        self.assertEqual(len(result),10)
        self.assertTrue(set(times)<=set(result))
        self.assertEqual(result,sorted(set(result)))
        self.assertGreater(sum(20<t<30 for t in result),sum(0<t<10 for t in result))

    def test_identical_aligned_faces_reuse_features_without_inventing_timepoints(self):
        from types import SimpleNamespace
        from unittest.mock import Mock
        model=engine.FaceEngine.__new__(engine.FaceEngine)
        points=np.array([[38.2946,51.6963],[73.5318,51.5014],[56.0252,71.7366],[41.5493,92.3655],[70.7299,92.2041]])
        model.detect=lambda image:[{'box':np.array([0.,0.,112.,112.]),'points':points,'score':1.}]
        run=Mock(return_value=[np.ones((1,512),dtype=np.float32)])
        model.recognizer=SimpleNamespace(get_inputs=lambda:[SimpleNamespace(name='data')],run=run)
        pixels=(np.indices((112,112)).sum(axis=0)%2*255).astype(np.uint8)
        image=Image.fromarray(pixels).convert('RGB');cache={}
        one=model.observe(image,0.,lambda:False,cache)
        two=model.observe(image,1.,lambda:False,cache)
        self.assertEqual(run.call_count,1)
        self.assertEqual([one[0]['frame_time'],two[0]['frame_time']],[0.,1.])
        np.testing.assert_allclose(one[0]['feature'],two[0]['feature'])

    def test_adaptive_video_plan_and_frames_replay_while_original_is_offline(self):
        import subprocess
        video=self.case/'scenes.mp4'
        subprocess.run(['ffmpeg','-v','error','-f','lavfi','-i','color=c=black:s=160x96:r=2:d=8',
                        '-f','lavfi','-i','color=c=white:s=160x96:r=2:d=8','-filter_complex',
                        '[0:v][1:v]concat=n=2:v=1:a=0','-c:v','libx264','-pix_fmt','yuv420p','-y',str(video)],check=True)
        row={'id':3,'media_type':'video','duration':16,'fps':'2/1','file_path':str(video),'thumbnail_path':None}
        frames,_=engine.read_frames(row,self.case/'cache',lambda:False,max_frames=10,revision='adaptive')
        times=[t for t,_ in frames]
        self.assertLessEqual(len(times),10)
        self.assertEqual(len(times),8)
        self.assertTrue(any(6<t<9 for t in times))
        video.unlink()
        cached,_=engine.read_frames(row,self.case/'cache',lambda:False,max_frames=10,revision='adaptive')
        self.assertEqual([t for t,_ in cached],times)

    def test_fractional_fps_keeps_scouts_and_never_exceeds_decode_budget(self):
        from unittest.mock import patch
        from types import SimpleNamespace
        video=self.case/'fractional.mp4';video.write_bytes(b'synthetic source')
        buffer=io.BytesIO();Image.new('RGB',(160,96),'green').save(buffer,format='JPEG')
        row={'id':4,'media_type':'video','duration':16,'fps':'30000/1001','file_path':str(video),'thumbnail_path':None}
        with patch.object(engine.subprocess,'run',return_value=SimpleNamespace(returncode=0,stdout=buffer.getvalue())) as decode:
            frames,_=engine.read_frames(row,self.case/'cache',lambda:False,max_frames=8,revision='fractional')
        self.assertEqual(len(frames),8)
        self.assertLessEqual(decode.call_count,8)
        self.assertLessEqual(len(list((self.case/'cache'/'frames').glob('*.jpg'))),8)


if __name__=='__main__':unittest.main()
