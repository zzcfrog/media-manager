"""External stage selection, real ONNX interface probes, isolated download publication."""
from support import DatabaseCase
from face_model_fixtures import model_bytes
import hashlib
import importlib
import io
import threading
import time
import zipfile
from unittest.mock import patch
from pathlib import Path
from backend.services import face_engine


class FaceModelSetupTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        from backend.blueprints.people import bp
        self.app.register_blueprint(bp,url_prefix='/api/people')

    def test_presets_allow_independent_files_and_no_shared_directory(self):
        files=[self.case/name for name in ('any-det.onnx','other-rec.onnx','optional-verify.onnx')]
        cfg=dict(detector_path=str(files[0]),recognizer_path=str(files[1]),verifier_path=str(files[2]),verify_enabled=True)
        self.assertEqual(face_engine.model_paths('','buffalo_l',**cfg),[p.resolve() for p in files])
        self.assertEqual(face_engine.model_paths('','raccoon_s',**cfg),[p.resolve() for p in files])

    def test_internal_probe_accepts_renamed_compatible_models_and_rejects_wrong_roles(self):
        for stage in ('detector','recognizer','verifier'):
            file=self.case/('renamed-'+stage+'.onnx');file.write_bytes(model_bytes(stage))
            response=self.client.post('/api/people/models/probe',json={'stage':stage,'path':str(file)})
            self.assertEqual(response.status_code,200,response.json)
            self.assertTrue(response.json['compatible']);self.assertEqual(response.json['stage'],stage)
            self.assertEqual(len(response.json['fingerprint']),64)
            wrong='recognizer' if stage=='detector' else 'detector'
            response=self.client.post('/api/people/models/probe',json={'stage':wrong,'path':str(file)})
            self.assertEqual(response.status_code,409,response.json)
        bad=self.case/'broken.onnx';bad.write_bytes(b'not an ONNX')
        for payload in ({'stage':'detector','path':str(bad)},{'stage':'other','path':str(bad)},
                        {'stage':'detector','path':'relative.onnx'}):
            self.assertEqual(self.client.post('/api/people/models/probe',json=payload).status_code,409)
        self.assertEqual(self.db.execute('SELECT COUNT(*) FROM people_jobs').fetchone()[0],0)

    def downloads(self):
        spec=importlib.util.find_spec('backend.services.face_model_downloads')
        self.assertIsNotNone(spec,'Face model download service is missing')
        return importlib.import_module('backend.services.face_model_downloads')

    def archive(self,extra=None):
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as z:
            for name,stage in [('det_10g_wo.onnx','detector'),('w600k_mbf.onnx','recognizer'),('face_verifier_mnv2.onnx','verifier')]:
                z.writestr('raccoon_s/'+name,model_bytes(stage))
            z.writestr('raccoon_s/MODEL.LICENSE','synthetic test license')
            if extra:z.writestr(*extra)
        return buffer.getvalue()

    def run_download(self,archive,digest=None,cancel=False):
        service=self.downloads();target=self.case/'downloads';target.mkdir(exist_ok=True)
        key=self.app.config['DATABASE']
        catalog={'url':'https://github.com/deepinsight/insightface/releases/download/model-zoo/raccoon_s.zip',
                 'bytes':len(archive),'sha256':digest or hashlib.sha256(archive).hexdigest()}
        class Response(io.BytesIO):
            status=200
        with patch.dict(service.CATALOG,{'raccoon_s':catalog}),patch.object(service,'urlopen',side_effect=lambda *a,**k:Response(archive)):
            state=service.start(key,'raccoon_s',str(target))
            if cancel:service.cancel(key,state['id'])
            for _ in range(500):
                state=service.status(key)
                if state['state'] not in ('downloading','validating'):break
                time.sleep(.01)
        self.assertNotIn(state['state'],('downloading','validating'))
        return service,target,state

    def test_download_publishes_only_after_hash_and_actual_interface_validation(self):
        _,target,state=self.run_download(self.archive())
        self.assertEqual(state['state'],'done',state)
        self.assertTrue(state['paths']['detector_path'].startswith(str(target.resolve())))
        from pathlib import Path
        self.assertTrue(Path(state['paths']['recognizer_path']).is_file())
        self.assertTrue((Path(state['directory'])/'MODEL.LICENSE').exists())
        self.assertFalse(any(p.name.startswith('.luminisle') for p in target.iterdir()))
        self.assertEqual(self.client.get('/api/people/status').json['settings']['model_dir'],'')

    def test_bad_digest_traversal_duplicate_and_wrong_model_never_publish(self):
        cases=[(self.archive(),'0'*64),(self.archive()[:-20],None),(self.archive(('../escape.onnx',b'bad')),None),
               (self.archive(('other/w600k_mbf.onnx',model_bytes('recognizer'))),None),
               (self.archive(('raccoon_s/det_10g_wo.onnx',model_bytes('recognizer'))),None)]
        for archive,digest in cases:
            _,target,state=self.run_download(archive,digest)
            self.assertEqual(state['state'],'error',state);self.assertEqual(list(target.iterdir()),[])
        self.assertFalse((self.case/'escape.onnx').exists())

    def test_download_failure_and_cancellation_preserve_existing_files(self):
        service=self.downloads();target=self.case/'downloads';target.mkdir();existing=target/'existing.onnx';existing.write_bytes(b'keep')
        with patch.object(service,'urlopen',side_effect=OSError('offline')):
            start=service.start(self.app.config['DATABASE'],'raccoon_s',str(target))
            for _ in range(100):
                state=service.status(self.app.config['DATABASE'])
                if state['state']=='error':break
                time.sleep(.01)
        self.assertEqual(state['state'],'error');self.assertEqual(existing.read_bytes(),b'keep')
        gate=threading.Event();entered=threading.Event();archive=self.archive()
        class Response(io.BytesIO):
            status=200
            def read(self,n=-1):entered.set();gate.wait(3);return super().read(n)
        item={'url':'https://github.com/test','bytes':len(archive),'sha256':hashlib.sha256(archive).hexdigest()}
        with patch.dict(service.CATALOG,{'raccoon_s':item}),patch.object(service,'urlopen',return_value=Response(archive)):
            start=service.start(self.app.config['DATABASE'],'raccoon_s',str(target));self.assertTrue(entered.wait(2))
            with self.assertRaises(ValueError):service.start(self.app.config['DATABASE'],'buffalo_l',str(target))
            service.cancel(self.app.config['DATABASE'],start['id']);gate.set()
            for _ in range(100):
                state=service.status(self.app.config['DATABASE'])
                if state['state']=='cancelled':break
                time.sleep(.01)
        self.assertEqual(state['state'],'cancelled');self.assertEqual(list(target.iterdir()),[existing])

    def test_download_api_rejects_uncontrolled_urls_paths_and_stale_cancellation(self):
        for data in ({'profile':'unknown','directory':str(self.case)},{'profile':'raccoon_s','directory':'relative'},
                     {'profile':'raccoon_s','directory':str(self.case),'url':'http://untrusted'}):
            self.assertEqual(self.client.post('/api/people/models/download',json=data).status_code,409)
        response=self.client.get('/api/people/models/catalog');self.assertEqual(response.status_code,200)
        self.assertEqual(self.client.post('/api/people/models/download/cancel',json={'id':'old'}).status_code,409)
        self.assertEqual(len(response.json['packs']),6)
        for pack in response.json['packs']:
            self.assertGreater(pack['bytes'],0);self.assertTrue(pack['url'].startswith('https://github.com/deepinsight/insightface/'))

    def test_download_subdirectory_and_catalogue_match_the_actual_pack(self):
        service=self.downloads();archive=self.archive();key=self.app.config['DATABASE']
        catalog=self.client.get('/api/people/models/catalog').json
        self.assertEqual(catalog['base_directory'],str((self.case/'models').resolve()))
        for pack in catalog['packs']:
            self.assertEqual(len(pack['files']),3 if pack['profile'].startswith('raccoon_') else 2)
        item={**service.CATALOG['raccoon_s'],'bytes':len(archive),'sha256':hashlib.sha256(archive).hexdigest()}
        class Response(io.BytesIO):status=200
        with patch.dict(service.CATALOG,{'raccoon_s':item}),patch.object(service,'urlopen',side_effect=lambda *a,**kw:Response(archive)):
            response=self.client.post('/api/people/models/download',json={'profile':'raccoon_s','subdirectory':'faces/custom-pack'})
            self.assertEqual(response.status_code,200,response.json)
            for _ in range(500):
                state=service.status(key)
                if state['state'] not in ('downloading','validating'):break
                time.sleep(.01)
        self.assertEqual(state['state'],'done',state)
        self.assertEqual(state['directory'],str((self.case/'models/faces/custom-pack').resolve()))
        self.assertEqual(len(state['paths']),3)
        before=Path(state['paths']['detector_path']).read_bytes()
        self.assertEqual(self.client.post('/api/people/models/download',json={'profile':'raccoon_s','subdirectory':'faces/custom-pack'}).status_code,409)
        self.assertEqual(Path(state['paths']['detector_path']).read_bytes(),before)

    def test_subdirectory_never_escapes_or_overwrites_the_model_root(self):
        root=self.case/'models';(root/'faces').mkdir(parents=True)
        occupied=root/'faces/occupied';occupied.mkdir();(occupied/'keep').write_text('keep')
        outside=self.case/'outside';outside.mkdir();(root/'faces/link').symlink_to(outside,target_is_directory=True)
        for suffix in ('/tmp/outside','faces/../outside','faces/nested/pack','vlm/pack','faces//pack','faces/pack/', 'faces/','faces/..','faces/link','faces/occupied','faces/'+'x'*129):
            response=self.client.post('/api/people/models/download',json={'profile':'raccoon_s','subdirectory':suffix})
            self.assertEqual(response.status_code,409,(suffix,response.json))
        self.assertEqual((occupied/'keep').read_text(),'keep');self.assertEqual(list(outside.iterdir()),[])
