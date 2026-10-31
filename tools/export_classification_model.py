"""Export a locally available SigLIP 2 pair; never downloads or overwrites models.

Development-only dependencies: torch, transformers, onnx, onnxruntime. Runtime
classification uses ONNX Runtime, tokenizers and Pillow, not transformers/torch.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import tempfile
import time


def digest(path):
    value = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(8 << 20), b''):
            value.update(block)
    return value.hexdigest()


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))


def validate_source_configuration(config, preprocessing, tokenizer):
    """Version 1 is the fixed Base/16 224, 768-d, 64-token pair only."""
    vision, text = config.vision_config, config.text_config
    def square(value, expected):
        return value == expected or isinstance(value, (list, tuple)) and list(value) == [expected, expected]
    if (config.model_type != 'siglip' or vision.model_type != 'siglip_vision_model' or
            text.model_type != 'siglip_text_model' or text.vocab_size != 256000 or
            not square(vision.image_size, 224) or not square(vision.patch_size, 16) or
            vision.hidden_size != 768 or text.hidden_size != 768 or
            text.projection_size != 768 or text.max_position_embeddings != 64 or
            vision.num_channels != 3 or vision.num_hidden_layers != 12 or
            text.num_hidden_layers != 12 or vision.num_attention_heads != 12 or
            text.num_attention_heads != 12 or vision.intermediate_size != 3072 or
            text.intermediate_size != 3072):
        raise ValueError('此导出格式仅支持 SigLIP 2 Base/16 224、768维和64个文字位置')
    if (preprocessing.get('size') != {'height': 224, 'width': 224} or
            preprocessing.get('resample') != 2 or
            preprocessing.get('image_mean') != [.5, .5, .5] or
            preprocessing.get('image_std') != [.5, .5, .5] or
            abs(preprocessing.get('rescale_factor', 0) - 1/255) > 1e-12 or
            any(preprocessing.get(k) is not True for k in ('do_resize', 'do_rescale', 'do_normalize'))):
        raise ValueError('源图片预处理不匹配固定模型契约')
    if (tokenizer.get('pad_token') != '<pad>' or tokenizer.get('eos_token') != '<eos>' or
            tokenizer.get('add_bos_token') is not False or tokenizer.get('add_eos_token') is not True or
            tokenizer.get('padding_side') != 'right'):
        raise ValueError('源 tokenizer 不匹配固定模型契约')


def export(source, destination, threads=4):
    # All hub access is disabled before importing the development libraries.
    os.environ.update(HF_HUB_OFFLINE='1', TRANSFORMERS_OFFLINE='1', HF_HUB_DISABLE_TELEMETRY='1')
    source, destination = Path(source).resolve(), Path(destination).absolute()
    if destination.exists():
        raise FileExistsError('输出目录已存在，未覆盖')
    if not (source / 'model.safetensors').is_file():
        raise FileNotFoundError('源目录缺少本地 SigLIP 2 权重')
    import numpy as np
    import onnx
    import onnxruntime as ort
    from PIL import Image
    import torch
    from transformers import AutoConfig, AutoModel, AutoProcessor
    from tokenizers import Tokenizer

    config = AutoConfig.from_pretrained(source, local_files_only=True, trust_remote_code=False)
    preprocessing = json.loads((source / 'preprocessor_config.json').read_text())
    tokenizer_cfg = json.loads((source / 'tokenizer_config.json').read_text())
    validate_source_configuration(config, preprocessing, tokenizer_cfg)
    destination.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix='.' + destination.name + '-', dir=destination.parent))
    try:
        torch.set_num_threads(threads)
        started = time.perf_counter()
        processor = AutoProcessor.from_pretrained(source, local_files_only=True,
                trust_remote_code=False, use_fast=False)
        model = AutoModel.from_pretrained(source, local_files_only=True,
                trust_remote_code=False, dtype=torch.float32, attn_implementation='eager').eval()
        validate_source_configuration(model.config, preprocessing, tokenizer_cfg)
        model_load_seconds = time.perf_counter() - started

        class Vision(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.encoder = model.vision_model
            def forward(self, pixel_values):
                pooled = self.encoder(pixel_values=pixel_values, return_dict=True).pooler_output
                return torch.nn.functional.normalize(pooled.float(), dim=-1)

        class Text(torch.nn.Module):
            def __init__(self):
                super().__init__()
                self.encoder = model.text_model
            def forward(self, input_ids):
                pooled = self.encoder(input_ids=input_ids, return_dict=True).pooler_output
                return torch.nn.functional.normalize(pooled.float(), dim=-1)

        # Independent synthetic pixels exercise non-square resize, saturation and grey.
        rng = np.random.default_rng(20261030)
        images = [Image.fromarray(rng.integers(0,256,(181,317,3),dtype=np.uint8)),
                  Image.fromarray(rng.integers(0,256,(317,181,3),dtype=np.uint8)),
                  Image.new('RGB',(73,81),(220,80,30))]
        pixels = processor.image_processor(images=images, return_tensors='np')['pixel_values']
        strings = ['a photo of a mountain.', '雪山与湖泊', '自行车', '树叶特写',
                   '我的蓝色保温杯', '山地', '山峰', '苹果品牌', '苹果水果', '人像与背景中的自行车']
        tokens = processor.tokenizer(strings, padding='max_length', truncation=True,
                max_length=64, return_tensors='np')['input_ids'].astype(np.int64)
        vision, text = Vision().eval(), Text().eval()
        exports = {}
        for name, encoder, data, input_name in [('image',vision,pixels[:1],'pixel_values'),
                                               ('text',text,tokens[:1],'input_ids')]:
            started = time.perf_counter()
            target = staging / (name + '.onnx')
            torch.onnx.export(encoder, torch.from_numpy(data), str(target),
                    input_names=[input_name], output_names=['features'],
                    opset_version=17, dynamo=False, external_data=False,
                    do_constant_folding=True)
            onnx.checker.check_model(str(target))
            exports[name] = {'seconds':time.perf_counter()-started, 'bytes':target.stat().st_size}
            print(json.dumps({'stage':'exported','encoder':name,**exports[name]}), flush=True)
        shutil.copyfile(source / 'tokenizer.json', staging / 'tokenizer.json')
        tokenizer = Tokenizer.from_file(str(staging / 'tokenizer.json'))
        tokenizer.enable_truncation(max_length=64)
        pad_token = tokenizer_cfg['pad_token']
        pad_id = tokenizer.token_to_id(pad_token)
        tokenizer.enable_padding(length=64, pad_id=pad_id, pad_token=pad_token)
        actual_tokens = np.array([e.ids for e in tokenizer.encode_batch(strings)],dtype=np.int64)
        if not np.array_equal(tokens, actual_tokens):
            raise AssertionError('运行时 tokenizer 与官方 tokenizer 不一致')
        resize = (preprocessing['size']['width'],preprocessing['size']['height'])
        actual_pixels = np.stack([((np.asarray(im.convert('RGB').resize(resize,
                resample=Image.Resampling(preprocessing['resample'])),dtype=np.float32) *
                np.float32(preprocessing['rescale_factor']) - np.array(preprocessing['image_mean'],dtype=np.float32)) /
                np.array(preprocessing['image_std'],dtype=np.float32)).transpose(2,0,1) for im in images])
        pixel_error = float(np.max(np.abs(pixels-actual_pixels)))
        if pixel_error > 1e-6:
            raise AssertionError('运行时图片预处理与官方预处理不一致')
        options = ort.SessionOptions()
        options.intra_op_num_threads = threads
        options.inter_op_num_threads = 1
        options.log_severity_level = 3
        timings, agreement = {}, {}
        for name, encoder, data, input_name in [('image',vision,pixels,'pixel_values'),
                                               ('text',text,tokens,'input_ids')]:
            started = time.perf_counter()
            session = ort.InferenceSession(str(staging/(name+'.onnx')),sess_options=options,
                    providers=['CPUExecutionProvider'])
            timings[name] = {'session_load_seconds':time.perf_counter()-started}
            with torch.inference_mode():
                expected = np.concatenate([encoder(torch.from_numpy(row[None])).numpy() for row in data])
            started = time.perf_counter()
            observed = np.concatenate([session.run(['features'],{input_name:row[None]})[0] for row in data])
            timings[name]['first_set_seconds'] = time.perf_counter()-started
            samples = []
            for _ in range(3):
                for row in data:
                    started = time.perf_counter()
                    session.run(['features'],{input_name:row[None]})
                    samples.append((time.perf_counter()-started)*1000)
            cosine = np.sum(expected*observed,axis=1)
            agreement[name] = {'minimum_cosine':float(cosine.min()),
                'maximum_absolute_error':float(np.max(np.abs(expected-observed)))}
            if cosine.min()<.9999 or not np.isfinite(observed).all():
                raise AssertionError('ONNX 与官方模型数值不一致')
            timings[name].update(mean_ms=float(np.mean(samples)),p95_ms=float(np.percentile(samples,95)))
            del session
        files = {name: {'sha256':digest(staging/name),'bytes':(staging/name).stat().st_size}
                 for name in ('image.onnx','text.onnx','tokenizer.json')}
        manifest = {'format_version':1,'family':'siglip2',
            'source':{'repository':'google/siglip2-base-patch16-224',
                      'weight_sha256':digest(source/'model.safetensors'),
                      'model_card':'https://huggingface.co/google/siglip2-base-patch16-224',
                      'license':'apache-2.0'},
            'dimension':768,'max_length':64,'pad_id':pad_id,'pad_token':pad_token,
            'preprocessing':preprocessing,'files':files}
        manifest['fingerprint']=hashlib.sha256(canonical(manifest).encode()).hexdigest()
        (staging/'classification.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
        report={'scope':'数值一致性与合成输入性能；不是人工真值准确率',
                'model_load_seconds':model_load_seconds,'exports':exports,'numerical_agreement':agreement,
                'pixel_maximum_absolute_error':pixel_error,'tokenizer_ids_equal':True,
                'text_examples':strings,'runtime':'CPUExecutionProvider','timings':timings,
                'versions':{'torch':torch.__version__,'onnx':onnx.__version__,'onnxruntime':ort.__version__},
                'fingerprint':manifest['fingerprint']}
        (staging/'validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
        staging.rename(destination)
        print(json.dumps(report,ensure_ascii=False),flush=True)
        return report
    finally:
        if staging.exists():
            shutil.rmtree(staging)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source',required=True,type=Path)
    parser.add_argument('--output',required=True,type=Path)
    parser.add_argument('--threads',type=int,default=4,choices=range(1,17))
    args=parser.parse_args()
    export(args.source,args.output,args.threads)


if __name__=='__main__':
    main()
