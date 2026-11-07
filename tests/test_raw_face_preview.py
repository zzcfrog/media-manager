"""High-quality RAW inputs and portraits, with synthetic camera JPEGs only."""
import io
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image

from support import DatabaseCase
from backend.services import face_engine, raw_preview


class RawFacePreviewTests(DatabaseCase):
    def raw(self):
        path=self.case/'camera.nef';path.write_bytes(b'synthetic raw carrier')
        return path

    def jpeg(self, size, color='green'):
        output=io.BytesIO();Image.new('RGB',size,color).save(output,format='JPEG')
        return output.getvalue()

    def extraction(self, images, orientation=1):
        def run(args,**kwargs):
            data=str(orientation).encode() if '-Orientation' in args else images.get(args[2],b'')
            return SimpleNamespace(returncode=0,stdout=data)
        return run

    def test_small_embedded_jpeg_does_not_hide_a_larger_preview(self):
        path=self.raw()
        with patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'),patch.object(raw_preview.subprocess,'run',side_effect=self.extraction({'-JpgFromRaw':self.jpeg((320,213)),'-PreviewImage':self.jpeg((3600,2400))})),patch('rawpy.imread',side_effect=AssertionError('A large camera JPEG needs no RAW demosaic')):
            image=face_engine._read_image(path)
        self.assertEqual(image.size,(2560,1707))
        self.assertEqual(path.read_bytes(),b'synthetic raw carrier')

    def test_corrupt_embedded_jpeg_falls_through_to_next_preview_and_rotates(self):
        path=self.raw()
        with patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'),patch.object(raw_preview.subprocess,'run',side_effect=self.extraction({'-JpgFromRaw':b'bad jpeg'*20,'-PreviewImage':self.jpeg((2400,1600))},6)):
            image=face_engine._read_image(path)
        self.assertEqual(image.size,(1600,2400))

    def test_small_previews_use_raw_decode_and_camera_white_balance(self):
        path=self.raw();decoder=SimpleNamespace(postprocess=lambda **kw:np.full((1800,2400,3),120,dtype=np.uint8))
        from unittest.mock import MagicMock
        opened=MagicMock();opened.__enter__.return_value=decoder
        with patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'),patch.object(raw_preview.subprocess,'run',side_effect=self.extraction({'-JpgFromRaw':self.jpeg((320,213))})),patch('rawpy.imread',return_value=opened) as decode:
            image=face_engine._read_image(path)
        decode.assert_called_once_with(str(path));self.assertEqual(image.size,(2400,1800))

    def test_offline_raw_never_uses_a_320px_grid_thumbnail_for_identity(self):
        thumbs=self.case/'thumbs';thumbs.mkdir();Image.new('RGB',(320,213),'green').save(thumbs/'old.jpg')
        row={'id':1,'media_type':'image','file_path':str(self.case/'offline.nef'),'thumbnail_path':'old.jpg'}
        with patch.object(face_engine,'THUMB_DIR',thumbs),patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'):
            with self.assertRaisesRegex(FileNotFoundError,'RAW|原片'):
                face_engine.read_frames(row,self.case/'people-cache',lambda:False)

    def test_oriented_high_quality_raw_cache_survives_offline_and_is_revision_bound(self):
        path=self.raw();stamp=path.stat()
        row={'id':1,'media_type':'image','file_path':str(path),'file_size':stamp.st_size,'file_mtime':stamp.st_mtime,'thumbnail_path':None}
        with patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'):
            raw_preview.save_preview(path,Image.new('RGB',(2400,1600),'green'),6)
            path.unlink()
            frames,scope=face_engine.read_frames(row,self.case/'people-cache',lambda:False)
            self.assertEqual(scope,'image_preview');self.assertEqual(frames[0][1].size,(1600,2400))
            row['file_mtime']+=1
            with self.assertRaises(FileNotFoundError):face_engine.read_frames(row,self.case/'people-cache',lambda:False)

    def test_portrait_has_its_own_resolution_without_changing_model_pixels(self):
        from unittest.mock import Mock
        model=face_engine.FaceEngine.__new__(face_engine.FaceEngine)
        points=face_engine._DEST*5
        model.detect=lambda image:[{'box':np.array([0.,0.,560.,560.]),'points':points,'score':1.}]
        run=Mock(return_value=[np.ones((1,512),dtype=np.float32)])
        model.recognizer=SimpleNamespace(get_inputs=lambda:[SimpleNamespace(name='data')],run=run)
        pixels=(np.indices((560,560)).sum(axis=0)%3*120).astype(np.uint8)
        image=Image.fromarray(pixels).convert('RGB')
        result=model.observe(image)[0]
        self.assertEqual(result['crop'].size,(112,112));self.assertEqual(result['portrait'].size,(384,384))
        self.assertEqual(run.call_args[0][1]['data'].shape,(1,3,112,112))

    def test_import_keeps_an_oriented_high_resolution_cache_and_a_small_grid_thumbnail(self):
        from backend.services import importer
        path=self.raw();thumb=self.case/'grid.jpg'
        images={'-JpgFromRaw':self.jpeg((320,213)),'-PreviewImage':self.jpeg((2400,1600))}
        with patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'),patch.object(importer.subprocess,'run',side_effect=self.extraction(images)):
            self.assertEqual(importer._extract_exif_thumbnail(path,thumb,thumb.name,orientation=6),thumb.name)
            cached=raw_preview.cached_preview({'file_path':str(path),'file_size':path.stat().st_size,'file_mtime':path.stat().st_mtime})
            with Image.open(cached) as image:self.assertEqual(image.size,(1600,2400))
        with Image.open(thumb) as image:self.assertEqual(image.size,(320,213))
        self.assertEqual(path.read_bytes(),b'synthetic raw carrier')

    def test_detail_can_display_a_matching_high_quality_cache_while_original_is_offline(self):
        path=self.raw();stamp=path.stat()
        mid=self.seed(path,media_type='image',file_size=stamp.st_size,file_mtime=stamp.st_mtime)
        with patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'):
            raw_preview.save_preview(path,Image.new('RGB',(2400,1600),'green'))
            path.unlink()
            response=self.client.get('/media/image/'+str(mid))
            self.assertEqual(response.status_code,200);self.assertEqual(response.headers.get('X-Luminisle-Preview'),'cached')
            with Image.open(io.BytesIO(response.data)) as image:self.assertEqual(image.size,(2400,1600))
            self.db.execute('UPDATE media SET file_mtime=file_mtime+1 WHERE id=?',(mid,));self.db.commit()
            self.assertEqual(self.client.get('/media/image/'+str(mid)).status_code,404)

    def test_failed_raw_decode_returns_waiting_and_no_tiny_or_partial_cache(self):
        path=self.raw()
        with patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'),patch.object(raw_preview.subprocess,'run',side_effect=self.extraction({'-JpgFromRaw':self.jpeg((320,213))})),patch('rawpy.imread',side_effect=RuntimeError('synthetic decode failure')):
            with self.assertRaises(FileNotFoundError):face_engine._read_image(path)
        self.assertEqual(list((self.case/'raw-cache').glob('*')),[])

    def test_source_change_and_cache_write_failure_never_modify_the_original(self):
        path=self.raw();old=path.stat();path.write_bytes(b'changed synthetic raw')
        with patch.object(raw_preview,'PREVIEW_DIR',self.case/'raw-cache'):
            with self.assertRaises(FileNotFoundError):raw_preview.save_preview(path,Image.new('RGB',(2000,1600)),stamp=old)
            self.assertEqual(list((self.case/'raw-cache').glob('*')),[])
        self.assertEqual(path.read_bytes(),b'changed synthetic raw')
