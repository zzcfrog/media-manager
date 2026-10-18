from support import _ROOT
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock, patch
import requests
from backend import local_vlm as vlm

class DownloadTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory(prefix='video-analyzer-download-test-')
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.old_state = dict(vlm._download_state)
        self.addCleanup(lambda: (vlm._download_state.clear(),vlm._download_state.update(self.old_state)))

    def response(self, code, data=b'', headers=None):
        r=Mock(status_code=code, headers=headers or {})
        r.iter_content.return_value=[data]
        if code >= 400: r.raise_for_status.side_effect=requests.HTTPError(str(code))
        return r

    def test_bad_ranges_and_checkpoints_do_not_promote_zero_files(self):
        for checkpoint in (None, {'segs':[]}, {'segs':[4,4]}, {'url':'wrong','total':8,'segs':[4,4]}):
            with self.subTest(checkpoint=checkpoint):
                dest=self.root/'model'; part=self.root/'model.part'
                dest.unlink(missing_ok=True); part.unlink(missing_ok=True)
                meta=self.root/'model.part.json'; meta.unlink(missing_ok=True)
                if checkpoint is not None: meta.write_text(json.dumps(checkpoint))
                session=Mock(); session.get.side_effect=lambda *a,**kw:self.response(416)
                with patch.object(vlm,'_SEG_MIN',1),patch.object(vlm,'_SEG',2),patch.object(vlm.time,'sleep'),patch('requests.Session',return_value=session):
                    with self.assertRaises(RuntimeError): vlm._download_file('repo','file',dest,8)
                self.assertFalse(dest.exists())

    def test_range_response_must_match_requested_interval(self):
        session=Mock(); session.get.side_effect=lambda *a,**kw:self.response(200,b'12345678')
        with patch.object(vlm,'_SEG',2),patch.object(vlm.time,'sleep'),patch('requests.Session',return_value=session):
            with self.assertRaises(RuntimeError): vlm._download_segmented('http://fixture','file',self.root/'x.part',8)

    def test_valid_segmented_download_and_resume(self):
        payload=b'abcdefgh'
        def get(url,**kw):
            lo,hi=map(int,kw['headers']['Range'][6:].split('-'))
            return self.response(206,payload[lo:hi+1],{'Content-Range':f'bytes {lo}-{hi}/8'})
        session=Mock();session.get.side_effect=get
        with patch.object(vlm,'_SEG_MIN',1),patch.object(vlm,'_SEG',2),patch('requests.Session',return_value=session):
            vlm._download_file('repo','file',self.root/'model',8)
        self.assertEqual((self.root/'model').read_bytes(),payload)

    def test_preallocated_bytes_do_not_count_as_progress(self):
        model_id=next(iter(vlm.MODELS)); folder=self.root/model_id;folder.mkdir()
        (folder/'model.part').write_bytes(b'\0'*100)
        vlm._download_state.update(state='downloading',model_id=model_id,total_bytes=100,files_done_bytes=0)
        with patch.object(vlm,'MODELS_DIR',self.root): self.assertEqual(vlm.download_status()['done_bytes'],0)

    def test_incomplete_model_can_retry_and_claim_precedes_thread(self):
        model_id=next(iter(vlm.MODELS)); m=vlm.MODELS[model_id]
        folder=self.root/model_id;folder.mkdir();(folder/m['main_file']).write_bytes(b'done')
        vlm._download_state.update(state='error',model_id=model_id)
        with patch.object(vlm,'MODELS_DIR',self.root),patch.object(vlm.threading,'Thread'):
            vlm.start_download(model_id)
            self.assertEqual(vlm._download_state['state'],'downloading')
            with self.assertRaises(RuntimeError):vlm.start_download(model_id)

    def test_verified_checkpoint_resumes_only_remaining_range(self):
        part=self.root/'model.part';part.write_bytes(b'abcd'+b'\0'*4)
        url=f'{vlm.MIRROR}/repo/resolve/main/file'
        part.with_name(part.name+'.json').write_text(json.dumps({'version':1,'url':url,'total':8,'segs':[4,0]}))
        session=Mock();session.get.return_value=self.response(206,b'efgh',{'Content-Range':'bytes 4-7/8'})
        with patch.object(vlm,'_SEG_MIN',1),patch.object(vlm,'_SEG',2),patch('requests.Session',return_value=session):
            vlm._download_file('repo','file',self.root/'model',8)
        self.assertEqual((self.root/'model').read_bytes(),b'abcdefgh')
        self.assertEqual(session.get.call_count,1)

    def test_retry_keeps_completed_main_and_downloads_projector(self):
        model_id=next(iter(vlm.MODELS));m=vlm.MODELS[model_id];folder=self.root/model_id;folder.mkdir()
        (folder/m['main_file']).write_bytes(b'main')
        metadata=Mock();metadata.__enter__=Mock(return_value=metadata);metadata.__exit__=Mock(return_value=False)
        metadata.read.return_value=json.dumps([{'path':m[name],'size':4} for name in ('main_file','mmproj_file')]).encode()
        session=Mock();session.get.return_value=self.response(200,b'proj')
        with patch.object(vlm,'MODELS_DIR',self.root),patch.object(vlm._no_proxy_opener,'open',return_value=metadata),patch('requests.Session',return_value=session):
            vlm._download_thread(model_id)
        self.assertEqual(vlm._download_state['state'],'done')
        self.assertEqual((folder/m['main_file']).read_bytes(),b'main')
        self.assertEqual((folder/m['mmproj_file']).read_bytes(),b'proj')
        self.assertEqual(session.get.call_count,1)
