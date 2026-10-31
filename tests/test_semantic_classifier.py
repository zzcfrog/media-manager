"""Paired model contract checks without loading real weights or calling an AI API."""
from support import DatabaseCase
import hashlib
import json
import os
from pathlib import Path
import shutil
from types import SimpleNamespace
from unittest.mock import patch

import numpy as np
from PIL import Image
from tokenizers import Tokenizer, models, pre_tokenizers, processors

from backend.services import semantic_classifier as classifier, taxonomy as tx
from backend.config import THUMB_DIR


class FakeSession:
    calls = {'image': 0, 'text': 0}

    def __init__(self, path, **kwargs):
        self.kind = Path(path).stem

    def get_inputs(self):
        return [SimpleNamespace(name='pixel_values' if self.kind == 'image' else 'input_ids')]

    def run(self, outputs, feeds):
        self.calls[self.kind] += 1
        if self.kind == 'image':
            value = np.arange(1, 769, dtype=np.float32)
        else:
            value = np.arange(1, 769, dtype=np.float32) + float(np.asarray(feeds['input_ids']).sum())
        return [value[None] / np.linalg.norm(value)]


class SemanticClassifierTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        classifier._bundle_cache.clear()
        FakeSession.calls = {'image': 0, 'text': 0}
        self.model = self.case / 'pair'
        self.model.mkdir()
        (self.model / 'image.onnx').write_bytes(b'synthetic image graph')
        (self.model / 'text.onnx').write_bytes(b'synthetic text graph')
        tokenizer = Tokenizer(models.WordLevel({'<pad>': 0, '<eos>': 1, '[UNK]': 2, 'mountain': 3}, unk_token='[UNK]'))
        tokenizer.pre_tokenizer = pre_tokenizers.Whitespace()
        tokenizer.post_processor = processors.TemplateProcessing(single='$A <eos>', special_tokens=[('<eos>', 1)])
        tokenizer.save(str(self.model / 'tokenizer.json'))
        self.config = {'format_version': 1, 'family': 'siglip2', 'dimension': 768,
            'max_length': 64, 'pad_id': 0, 'pad_token': '<pad>',
            'preprocessing': {'size': {'height': 224, 'width': 224}, 'resample': 2,
                              'rescale_factor': 1/255, 'image_mean': [.5]*3, 'image_std': [.5]*3},
            'files': {name: {'bytes': (self.model/name).stat().st_size,
                            'sha256': classifier._digest(self.model/name)} for name in classifier._ASSETS}}
        self.config['fingerprint'] = hashlib.sha256(classifier._canonical(self.config).encode()).hexdigest()
        (self.model/'classification.json').write_text(json.dumps(self.config))
        self.db.execute('INSERT INTO settings(key,value) VALUES (?,?)', ('classification_model_dir', str(self.model)))
        THUMB_DIR.mkdir(parents=True, exist_ok=True)
        self.thumb = 'semantic-' + self.case.name + '.png'
        pixels = np.random.default_rng(42).integers(0,256,(131,239,3),dtype=np.uint8)
        Image.fromarray(pixels).save(THUMB_DIR/self.thumb)
        self.addCleanup((THUMB_DIR/self.thumb).unlink, missing_ok=True)
        self.mid = self.seed(media_type='image', thumbnail_path=self.thumb)
        self.node = tx.create_node(self.db, '山地', recognition_text='mountain')
        self.db.commit()
        self.patch = patch('onnxruntime.InferenceSession', FakeSession)
        self.patch.start()
        self.addCleanup(self.patch.stop)
        self.addCleanup(classifier._bundle_cache.clear)

    def classify(self):
        return classifier.classify(self.db, {'media_id':self.mid, 'stage':'fast',
            'input_revision':tx.input_revision(self.db,self.mid,'fast')})

    def persist(self, value):
        model, revision, vector, dimension = value['image_feature']
        self.db.execute('INSERT OR REPLACE INTO taxonomy_features(media_id,model_key,input_revision,vector,dimension) VALUES (?,?,?,?,?)',
                        (self.mid,model,revision,vector,dimension))
        for tag_id, text_revision, vector, dimension in value['text_features']:
            self.db.execute('INSERT OR REPLACE INTO taxonomy_text_features(tag_id,model_key,text_revision,vector,dimension) VALUES (?,?,?,?,?)',
                            (tag_id,model,text_revision,vector,dimension))
        self.db.commit()

    def test_pair_contract_padding_and_no_framework_dependency(self):
        value = self.classify()
        self.assertEqual(len(value['image_feature'][2]),768*4)
        self.assertEqual(value['candidates'][0]['evidence']['tag_id'],self.node['id'])
        bundle = classifier._load_bundle(self.model)
        tokens = bundle['tokenizer'].encode('mountain').ids
        self.assertEqual(tokens[:3],[3,1,0])
        self.assertEqual(len(tokens),64)
        self.assertEqual(FakeSession.calls,{'image':1,'text':1})

    def test_copy_or_mtime_change_keeps_content_model_identity(self):
        first = classifier._load_bundle(self.model)
        for name in classifier._ASSETS:
            path = self.model/name
            os.utime(path, ns=(path.stat().st_atime_ns,path.stat().st_mtime_ns+1000000))
        second = classifier._load_bundle(self.model)
        copied = self.case/'copied';shutil.copytree(self.model,copied)
        third = classifier._load_bundle(copied)
        self.assertEqual(first['key'],second['key'])
        self.assertEqual(second['key'],third['key'])

    def test_changed_graph_is_rejected_before_reusing_old_session(self):
        self.classify()
        (self.model/'image.onnx').write_bytes(b'changed graph')
        with self.assertRaises(FileNotFoundError):self.classify()

    def test_cached_images_and_unchanged_text_are_not_reencoded(self):
        first=self.classify();self.persist(first)
        self.db.execute('UPDATE taxonomy_nodes SET name=?,version=version+1 WHERE id=?',('展示名称',self.node['id']))
        self.db.commit()
        second=self.classify()
        self.assertEqual(FakeSession.calls,{'image':1,'text':1})
        self.assertEqual(second['text_features'],[])
        self.assertEqual(second['candidates'][0]['term'],'展示名称')
        self.db.execute('UPDATE taxonomy_nodes SET recognition_text=?,version=version+1 WHERE id=?',('new description',self.node['id']))
        self.db.commit();third=self.classify()
        self.assertEqual(FakeSession.calls,{'image':1,'text':2})
        self.assertEqual(len(third['text_features']),1)

    def test_preprocessing_is_bilinear_and_low_information_abstains(self):
        with Image.open(THUMB_DIR/self.thumb) as image:
            expected=(np.asarray(image.convert('RGB').resize((224,224),Image.Resampling.BILINEAR),dtype=np.float32)/255-.5)/.5
            actual=classifier._preprocess(image,self.config)
        np.testing.assert_allclose(actual,expected.transpose(2,0,1)[None],atol=2e-7,rtol=0)
        with self.assertRaises(FileNotFoundError):
            classifier._preprocess(Image.new('RGB',(128,128),'black'),self.config)

    def test_omni_cancel_after_engine_wait_never_sends_image(self):
        from backend import local_vlm
        cancelled=[False]
        def acquire(*args,**kwargs):
            cancelled[0]=True
            return {'base_url':'http://127.0.0.1:1/v1'}
        with patch.object(local_vlm,'acquire_engine',side_effect=acquire),patch.object(local_vlm,'release_engine') as release,patch.object(local_vlm._no_proxy_opener,'open') as send:
            with self.assertRaises(InterruptedError):
                classifier.classify_omni(self.db,{'media_id':self.mid,'_cancelled':lambda:cancelled[0]})
            send.assert_not_called();release.assert_called_once()

    def test_omni_black_preview_abstains_before_model_acquisition(self):
        from backend import local_vlm
        Image.new('RGB',(128,128),'black').save(THUMB_DIR/self.thumb)
        with patch.object(local_vlm,'acquire_engine') as acquire:
            with self.assertRaises(FileNotFoundError):classifier.classify_omni(self.db,{'media_id':self.mid})
            acquire.assert_not_called()

    def test_bad_cached_vector_is_recomputed_and_cancel_is_checked(self):
        first=self.classify();self.persist(first)
        self.db.execute('UPDATE taxonomy_features SET vector=? WHERE media_id=?',(np.full(768,np.nan,dtype=np.float32).tobytes(),self.mid))
        self.db.commit();self.classify()
        self.assertEqual(FakeSession.calls['image'],2)
        with self.assertRaises(InterruptedError):
            classifier.classify(self.db,{'stage':'fast','media_id':self.mid,'_cancelled':lambda:True})

    def test_related_alias_reencodes_only_its_text_not_cached_images(self):
        first=self.classify();self.persist(first)
        tx.add_expression(self.db,self.node['id'],'bicycle');self.db.commit()
        value=self.classify()
        self.assertEqual(FakeSession.calls,{'image':1,'text':2})
        self.assertEqual(len(value['text_features']),1)

    def test_export_rejects_existing_output_without_loading_development_dependencies(self):
        from tools.export_classification_model import export
        target=self.case/'existing';target.mkdir()
        (target/'keep.txt').write_text('preserve')
        with self.assertRaises(FileExistsError): export(self.case/'missing-source',target)
        self.assertEqual((target/'keep.txt').read_text(),'preserve')

    def test_cancel_during_bundle_load_prevents_image_inference(self):
        cancelled = [False]
        original = classifier._load_bundle
        def load(root):
            bundle = original(root)
            cancelled[0] = True
            return bundle
        with patch.object(classifier, '_load_bundle', side_effect=load):
            with self.assertRaises(InterruptedError):
                classifier.classify(self.db, {'stage':'fast','media_id':self.mid,
                    '_cancelled':lambda:cancelled[0], 'input_revision':'synthetic'})
        self.assertEqual(FakeSession.calls, {'image':0, 'text':0})

    def test_cancel_during_preprocessing_prevents_image_inference(self):
        cancelled = [False]
        original = classifier._preprocess
        def preprocess(image,config):
            pixels = original(image,config)
            cancelled[0] = True
            return pixels
        with patch.object(classifier, '_preprocess', side_effect=preprocess):
            with self.assertRaises(InterruptedError):
                classifier.classify(self.db, {'stage':'fast','media_id':self.mid,
                    '_cancelled':lambda:cancelled[0], 'input_revision':'synthetic'})
        self.assertEqual(FakeSession.calls, {'image':0, 'text':0})

    def test_export_rejects_other_sizes_dimensions_and_position_lengths(self):
        from copy import deepcopy
        from tools.export_classification_model import validate_source_configuration
        config = SimpleNamespace(model_type='siglip',
            vision_config=SimpleNamespace(model_type='siglip_vision_model', image_size=224,
                patch_size=16,hidden_size=768,num_channels=3,num_hidden_layers=12,
                num_attention_heads=12,intermediate_size=3072),
            text_config=SimpleNamespace(model_type='siglip_text_model',vocab_size=256000,
                hidden_size=768,projection_size=768,max_position_embeddings=64,
                num_hidden_layers=12,num_attention_heads=12,intermediate_size=3072))
        preprocessing={**self.config['preprocessing'],'do_resize':True,'do_rescale':True,'do_normalize':True}
        tokenizer={'pad_token':'<pad>','eos_token':'<eos>','add_bos_token':False,
                   'add_eos_token':True,'padding_side':'right'}
        validate_source_configuration(config,preprocessing,tokenizer)
        for scope,field,value in [('vision_config','image_size',384),('vision_config','patch_size',14),
                ('vision_config','hidden_size',1024),('text_config','hidden_size',1024),
                ('text_config','projection_size',512),('text_config','max_position_embeddings',77)]:
            changed=deepcopy(config);setattr(getattr(changed,scope),field,value)
            with self.subTest(scope=scope,field=field):
                with self.assertRaises(ValueError): validate_source_configuration(changed,preprocessing,tokenizer)
        for altered in ({**preprocessing,'resample':3},{**preprocessing,'size':{'height':384,'width':384}}):
            with self.assertRaises(ValueError):validate_source_configuration(config,altered,tokenizer)

    def test_unsupported_export_never_loads_weights_or_publishes(self):
        from tools.export_classification_model import export
        from unittest.mock import Mock
        import sys
        source=self.case/'unsupported';source.mkdir()
        (source/'model.safetensors').write_bytes(b'not real weights')
        (source/'preprocessor_config.json').write_text('{}')
        (source/'tokenizer_config.json').write_text('{}')
        target=self.case/'not-created'/'pair'
        model_loader=Mock();processor_loader=Mock()
        invalid=SimpleNamespace(model_type='siglip',vision_config=SimpleNamespace(model_type='other'),
                                text_config=SimpleNamespace(model_type='siglip_text_model',vocab_size=256000))
        fake_transformers=SimpleNamespace(AutoConfig=SimpleNamespace(from_pretrained=lambda *a,**kw:invalid),
            AutoModel=SimpleNamespace(from_pretrained=model_loader),AutoProcessor=SimpleNamespace(from_pretrained=processor_loader))
        with patch.dict(sys.modules,{'transformers':fake_transformers,'torch':SimpleNamespace(),'onnx':SimpleNamespace()}):
            with self.assertRaises(ValueError):export(source,target)
        model_loader.assert_not_called();processor_loader.assert_not_called()
        self.assertFalse(target.exists());self.assertFalse(target.parent.exists())
