from support import DatabaseCase
import hashlib
import io
import json
from pathlib import Path
import shutil
import threading
import time
from unittest.mock import patch
import zipfile

from backend.blueprints import people
from backend.services import classification_models as models, face_model_downloads as faces, model_store, people_jobs
from managed_model_fixtures import classification_assets, SyntheticResponse
from face_model_fixtures import model_bytes


class ManagedModelsTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        self.app.register_blueprint(people.bp,url_prefix='/api/people')
        self.assets=classification_assets()
        item={**models.CATALOG[models.MODEL_ID], 'files':{name:{'remote':name,'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()} for name,payload in self.assets.items()}}
        self.enterContext(patch.dict(models.CATALOG,{models.MODEL_ID:item}))
        self.calls=[]
        def fetch(request,**kwargs):
            name=request.full_url.rsplit('/',1)[-1];self.calls.append(name)
            return SyntheticResponse(self.assets[name])
        self.enterContext(patch.object(models,'urlopen',side_effect=fetch))
        self.key=self.app.config['DATABASE']

    def wait(self,service=models):
        for _ in range(500):
            state=service.status(self.key)
            if state['state'] not in ('downloading','validating'):return state
            time.sleep(.01)
        self.fail('Synthetic download did not finish')

    def test_classifier_download_is_verified_portable_and_does_not_save_configuration(self):
        before=[tuple(row) for row in self.db.execute('SELECT key,value FROM settings ORDER BY key')]
        response=self.client.post('/api/taxonomy/models/download',json={'model_id':models.MODEL_ID})
        self.assertEqual(response.status_code,200,response.json)
        done=self.wait();self.assertEqual(done['state'],'done',done)
        self.assertEqual(len(self.calls),3)
        catalog=self.client.get('/api/taxonomy/models/catalog').json
        self.assertTrue(catalog['models'][0]['installed'])
        folder=Path(done['directory']);self.assertTrue(folder.is_relative_to((self.case/'models').resolve()))
        manifest=json.loads((folder/'classification.json').read_text());self.assertEqual(manifest['outputs'],{'image':'pooler_output','text':'pooler_output'})
        from backend.services.semantic_classifier import _bundle_cache
        self.assertNotIn(str(folder),_bundle_cache)
        self.assertEqual([tuple(row) for row in self.db.execute('SELECT key,value FROM settings ORDER BY key')],before)
        self.assertEqual(self.client.patch('/api/taxonomy/configuration',json={'classification_model_id':models.MODEL_ID}).status_code,200)
        self.assertEqual(models.configured_directory(self.db),str(folder))
        next_root=self.case/'relocated';shutil.copytree(self.case/'models',next_root,copy_function=shutil.copyfile)
        self.app.config['MODELS_ROOT']=str(next_root)
        self.assertTrue(Path(models.configured_directory(self.db)).is_relative_to(next_root.resolve()))
        self.assertTrue(self.client.get('/api/taxonomy/models/catalog').json['models'][0]['installed'])

    def test_duplicate_download_reuses_existing_files_without_network_or_overwrite(self):
        models.start(self.key,models.MODEL_ID);done=self.wait();first=done['directory'];calls=len(self.calls)
        reused=models.start(self.key,models.MODEL_ID)
        self.assertEqual(reused['state'],'done');self.assertEqual(reused['directory'],first);self.assertEqual(len(self.calls),calls)
        self.assertEqual(len(list((self.case/'models'/'classification').glob('*/'+model_store.RECORD))),1)

    def test_corruption_unknown_source_and_unsafe_fields_never_publish(self):
        for payload in ({'model_id':'other'},{'model_id':models.MODEL_ID,'url':'http://untrusted'},[],{'model_id':[]}):
            self.assertEqual(self.client.post('/api/taxonomy/models/download',json=payload).status_code,409)
        with patch.object(models,'urlopen',return_value=SyntheticResponse(b'bad-data')):
            models.start(self.key,models.MODEL_ID);done=self.wait()
        self.assertEqual(done['state'],'error');self.assertFalse(model_store.installed('classification',models.MODEL_ID))
        self.assertEqual(list((self.case/'models'/'classification').iterdir()),[])

    def test_actual_onnx_interface_failure_is_rejected_after_hash_validation(self):
        assets={**self.assets,'image.onnx':model_bytes('recognizer')}
        item={**models.CATALOG[models.MODEL_ID], 'files':{name:{'remote':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in assets.items()}}
        with patch.dict(models.CATALOG,{models.MODEL_ID:item}),patch.object(models,'urlopen',side_effect=lambda r,**kw:SyntheticResponse(assets[r.full_url.rsplit('/',1)[-1]])):
            models.start(self.key,models.MODEL_ID);done=self.wait()
        self.assertEqual(done['state'],'error');self.assertFalse(model_store.installed('classification',models.MODEL_ID))

    def test_cancel_busy_and_insufficient_space_preserve_existing_files(self):
        entered=threading.Event();release=threading.Event()
        def hold(request,**kwargs):
            entered.set();release.wait(2);return SyntheticResponse(self.assets[request.full_url.rsplit('/',1)[-1]])
        with patch.object(models,'urlopen',side_effect=hold):
            result=models.start(self.key,models.MODEL_ID);self.assertTrue(entered.wait(2))
            with self.assertRaisesRegex(ValueError,'正在进行'):models.start(self.key,models.MODEL_ID)
            self.assertEqual(self.client.post('/api/taxonomy/models/download/cancel',json={'id':'old'}).status_code,409)
            models.cancel(self.key,result['id']);release.set();done=self.wait()
        self.assertEqual(done['state'],'cancelled');self.assertFalse(model_store.installed('classification',models.MODEL_ID))
        with patch.object(models.shutil,'disk_usage',return_value=type('Space',(),{'free':0})()):
            with self.assertRaisesRegex(ValueError,'空间不足'):models.start(self.key,models.MODEL_ID)

    def test_face_pack_and_independent_stage_references_follow_the_model_root(self):
        buffer=io.BytesIO()
        with zipfile.ZipFile(buffer,'w',zipfile.ZIP_DEFLATED) as package:
            for name,stage in [('det_10g_wo.onnx','detector'),('w600k_mbf.onnx','recognizer'),('face_verifier_mnv2.onnx','verifier')]:package.writestr('raccoon_s/'+name,model_bytes(stage))
        payload=buffer.getvalue();item={**faces.CATALOG['raccoon_s'],'bytes':len(payload),'sha256':hashlib.sha256(payload).hexdigest()}
        with patch.dict(faces.CATALOG,{'raccoon_s':item}),patch.object(faces,'urlopen',return_value=SyntheticResponse(payload)):
            response=self.client.post('/api/people/models/download',json={'profile':'raccoon_s','stage':'recognizer'})
            self.assertEqual(response.status_code,200,response.json);done=self.wait(faces)
        self.assertEqual(done['state'],'done',done);self.assertTrue(done['managed']);self.assertEqual(done['stage'],'recognizer')
        settings=people_jobs.configure(self.db,{'recognizer_model':'raccoon_s:recognizer'})
        self.db.commit();self.assertEqual(settings['recognizer_path'],done['paths']['recognizer_path'])
        original=settings['recognizer_path'];next_root=self.case/'moved';shutil.copytree(self.case/'models',next_root);self.app.config['MODELS_ROOT']=str(next_root)
        relocated=people_jobs.settings(self.db)['recognizer_path'];self.assertNotEqual(original,relocated);self.assertTrue(Path(relocated).is_file())
        catalog=self.client.get('/api/people/models/catalog').json;self.assertTrue(next(item for item in catalog['packs'] if item['profile']=='raccoon_s')['installed'])
        with self.assertRaises(ValueError):people_jobs.configure(self.db,{'detector_model':'raccoon_s:recognizer'})
        external=self.case/'external.onnx';external.write_bytes(model_bytes('recognizer'))
        selected=people_jobs.configure(self.db,{'recognizer_path':str(external)})
        self.assertEqual(selected['recognizer_model'],'');self.assertEqual(selected['recognizer_path'],str(external.resolve()))

    def test_changed_record_and_missing_files_are_not_reported_installed(self):
        models.start(self.key,models.MODEL_ID);done=self.wait();folder=Path(done['directory'])
        file=folder/'image.onnx';data=file.read_bytes();file.write_bytes(b'x'+data[1:])
        self.assertFalse(model_store.installed('classification',models.MODEL_ID))
        self.assertFalse(self.client.get('/api/taxonomy/models/catalog').json['models'][0]['installed'])
        file.write_bytes(data);self.assertTrue(model_store.installed('classification',models.MODEL_ID))
        (folder/'text.onnx').unlink();self.assertFalse(model_store.installed('classification',models.MODEL_ID))

    def test_malformed_download_records_do_not_break_catalogues(self):
        folder=self.case/'models'/'classification'/'broken';folder.mkdir(parents=True)
        for value in ([],None,{'format_version':1,'kind':'classification','model_id':models.MODEL_ID,'files':['image.onnx']}):
            (folder/model_store.RECORD).write_text(json.dumps(value))
            response=self.client.get('/api/taxonomy/models/catalog')
            self.assertEqual(response.status_code,200);self.assertFalse(response.json['models'][0]['installed'])
