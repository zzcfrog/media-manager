"""All catalog interfaces, using tiny real ONNX graphs instead of model weights."""
from support import DatabaseCase
from copy import deepcopy
import hashlib
import json
import time
from unittest.mock import patch

import numpy as np
from PIL import Image

from backend.config import THUMB_DIR
from backend.services import classification_models as models, semantic_classifier as classifier, taxonomy as tx
from managed_model_fixtures import classification_assets, encoder_bytes, SyntheticResponse


class Siglip2PresetTests(DatabaseCase):
    def setUp(self):
        super().setUp()
        classifier._bundle_cache.clear()
        self.addCleanup(classifier._bundle_cache.clear)
        self.key=self.app.config['DATABASE']

    def fixture(self,model_id):
        item=deepcopy(models.CATALOG[model_id]);assets=classification_assets(item)
        item['files']={name:{'remote':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in assets.items()}
        return item,assets

    def bundle(self,model_id,overrides=None):
        item,assets=self.fixture(model_id);assets.update(overrides or {})
        item['files']={name:{'remote':name,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()} for name,data in assets.items()}
        folder=self.case/model_id;folder.mkdir()
        for name,data in assets.items():(folder/name).write_bytes(data)
        models._manifest(folder,item)
        return folder,classifier._load_bundle(folder,cache=False)

    def test_seventeen_google_variants_have_complete_pinned_paired_assets(self):
        self.assertEqual(len(models.CATALOG),17)
        self.assertEqual([sum('-'+size+'-' in mid for mid in models.CATALOG) for size in ('base','large','so400m','giant-opt')],[6,3,6,2])
        for model_id,item in models.CATALOG.items():
            with self.subTest(model_id=model_id):
                self.assertEqual(item['manufacturer'],'Google')
                self.assertEqual(len(item['revision']),40)
                self.assertTrue(set(classifier._ASSETS).issubset(item['files']))
                for asset in item['files'].values():
                    self.assertGreater(asset['bytes'],0);self.assertEqual(len(asset['sha256']),64)
                if item['variant']=='naflex':
                    self.assertTrue(item['repository'].startswith('upshift/'))
                    self.assertEqual(item['max_num_patches'],256)

    def test_all_seventeen_download_validate_and_run_in_real_onnxruntime(self):
        pixels=np.random.default_rng(7).integers(0,256,(96,173,3),dtype=np.uint8)
        image=Image.fromarray(pixels)
        before=[tuple(row) for row in self.db.execute('SELECT key,value FROM settings ORDER BY key')]
        for model_id in models.CATALOG:
            with self.subTest(model_id=model_id):
                item,assets=self.fixture(model_id)
                with patch.dict(models.CATALOG,{model_id:item}),patch.object(models,'urlopen',side_effect=lambda request,**kw:SyntheticResponse(assets[request.full_url.rsplit('/',1)[-1]])):
                    models.start(self.key,model_id)
                    for _ in range(500):
                        state=models.status(self.key)
                        if state['state'] not in ('downloading','validating'):break
                        time.sleep(.01)
                self.assertEqual(state['state'],'done',state)
                bundle=classifier._load_bundle(state['directory'],cache=False)
                dimension=item['dimension'];config=bundle['config']
                feeds=classifier._image_inputs(image,config)
                vector=bundle['image'].run([config['outputs']['image']],feeds)[0]
                tokens=np.asarray([bundle['tokenizer'].encode('photo').ids],dtype=np.int64)
                text=bundle['text'].run([config['outputs']['text']],{'input_ids':tokens})[0]
                self.assertEqual(vector.shape,(1,dimension));self.assertEqual(text.shape,(1,dimension))
                self.assertEqual(tokens[0,:3].tolist(),[3,1,0]);self.assertEqual(tokens.shape,(1,64))
                self.assertEqual(float(classifier._vector(vector,dimension)@classifier._vector(text,dimension)),1.)
        self.assertEqual([tuple(row) for row in self.db.execute('SELECT key,value FROM settings ORDER BY key')],before)

    def test_naflex_preserves_patch_order_aspect_mask_and_zero_padding(self):
        config=models.CATALOG['siglip2-base-patch16-naflex-fp32']
        y,x=np.indices((256,256));pixels=np.stack([x,y,(x+y)%256],axis=-1).astype(np.uint8)
        feeds=classifier._image_inputs(Image.fromarray(pixels),config)
        self.assertEqual(feeds['spatial_shapes'].tolist(),[[16,16]])
        self.assertEqual(feeds['pixel_attention_mask'].sum(),256)
        first=feeds['pixel_values'][0,0].reshape(16,16,3)
        np.testing.assert_allclose(first,pixels[:16,:16].astype(np.float32)/127.5-1,atol=1e-6)
        np.testing.assert_allclose(feeds['pixel_values'][0,1,:3],pixels[0,16]/127.5-1,atol=1e-6)
        wide=classifier._image_inputs(Image.fromarray(pixels).resize((320,160)),config)
        rows,cols=wide['spatial_shapes'][0]
        self.assertEqual((rows,cols),(11,22));self.assertEqual(wide['pixel_attention_mask'].sum(),242)
        self.assertTrue((wide['pixel_values'][0,242:]==0).all())
        with self.assertRaisesRegex(FileNotFoundError,'信息不足'):
            classifier._image_inputs(Image.new('RGB',(64,64),'white'),config)

    def test_missing_or_corrupt_external_data_and_mismatched_interfaces_are_rejected(self):
        model_id='siglip2-giant-opt-patch16-256-fp32'
        folder,bundle=self.bundle(model_id);del bundle
        file=folder/'vision_model.onnx_data';data=file.read_bytes();file.write_bytes(b'x'+data[1:])
        with self.assertRaisesRegex(FileNotFoundError,'清单不匹配'):classifier._load_bundle(folder,cache=False)
        file.unlink()
        with self.assertRaises(FileNotFoundError):classifier._load_bundle(folder,cache=False)
        with self.assertRaisesRegex(FileNotFoundError,'输入尺寸'):
            self.bundle('siglip2-base-patch16-384-fp32',{'image.onnx':encoder_bytes('image',resolution=224)})
        with self.assertRaisesRegex(FileNotFoundError,'输出维度'):
            self.bundle('siglip2-large-patch16-256-fp32',{'image.onnx':encoder_bytes('image',resolution=256)})
        with self.assertRaisesRegex(FileNotFoundError,'编码接口'):
            self.bundle('siglip2-base-patch16-naflex-fp32',{'image.onnx':encoder_bytes('image')})

    def test_giant_features_flow_through_classification_and_database_with_1536_dimensions(self):
        folder,bundle=self.bundle('siglip2-giant-opt-patch16-256-fp32');del bundle
        self.db.execute('INSERT INTO settings(key,value) VALUES (?,?)',('classification_model_dir',str(folder)))
        thumb=self.case.name+'-siglip2.png';THUMB_DIR.mkdir(parents=True,exist_ok=True)
        Image.fromarray(np.random.default_rng(3).integers(0,256,(64,97,3),dtype=np.uint8)).save(THUMB_DIR/thumb)
        self.addCleanup((THUMB_DIR/thumb).unlink,missing_ok=True)
        mid=self.seed(media_type='image',thumbnail_path=thumb)
        tag=tx.create_node(self.db,'测试标签',recognition_text='PHOTO');self.db.commit()
        result=classifier.classify(self.db,{'media_id':mid,'stage':'fast','input_revision':tx.input_revision(self.db,mid,'fast')})
        self.assertEqual(result['candidates'][0]['evidence']['tag_id'],tag['id'])
        key,revision,vector,dimension=result['image_feature']
        self.assertEqual(dimension,1536);self.assertEqual(len(vector),1536*4)
        self.db.execute('INSERT INTO taxonomy_features(media_id,model_key,input_revision,vector,dimension) VALUES (?,?,?,?,?)',(mid,key,revision,vector,dimension))
        self.assertEqual(self.db.execute('SELECT dimension FROM taxonomy_features WHERE media_id=?',(mid,)).fetchone()[0],1536)
        config=json.loads((folder/'classification.json').read_text())
        self.assertTrue(config['text_processing']['lowercase']);self.assertTrue(config['text_processing']['append_eos'])
