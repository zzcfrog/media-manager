"""Small, real ONNX/tokenizer payloads for managed-model download tests."""
import io
import struct
import time

from face_model_fixtures import _int, _bytes, _value


def encoder_bytes(kind, dimension=768, resolution=224, variant='fixed', external=None):
    shape = ([1, 256, 768] if variant=='naflex' else [1, 3, resolution, resolution]) if kind=='image' else [1,64]
    name = 'pixel_values' if kind == 'image' else 'input_ids'
    output = kind+'_embeds' if variant=='naflex' else 'pooler_output'
    tensor = b''.join(_int(1,n) for n in [1,dimension])+_int(2,1)
    initializer=b''
    if external:
        tensor+=_bytes(8,'synthetic_weights')+_bytes(13,_bytes(1,'location')+_bytes(2,external))+_int(14,1)
        initializer=_bytes(5,tensor)
        node=_bytes(1,'synthetic_weights')+_bytes(2,output)+_bytes(4,'Identity')
    else:
        tensor+=_bytes(9,struct.pack('<f',1.)+bytes((dimension-1)*4))
        attribute=_bytes(1,'value')+_bytes(5,tensor)+_int(20,4)
        node=_bytes(2,output)+_bytes(4,'Constant')+_bytes(5,attribute)
    inputs=_bytes(11,_value(name,shape,1 if kind=='image' else 7))
    if kind=='image' and variant=='naflex':
        inputs+=_bytes(11,_value('pixel_attention_mask',[1,256],7))+_bytes(11,_value('spatial_shapes',[1,2],7))
    graph=_bytes(1,node)+_bytes(2,'synthetic-paired-encoder')+initializer+inputs+_bytes(12,_value(output,[1,dimension]))
    return _int(1, 9)+_bytes(2, 'luminisle-tests')+_bytes(7, graph)+_bytes(8, _int(2, 13))


def classification_assets(item=None):
    from tokenizers import Tokenizer, models, pre_tokenizers, processors
    tokenizer = Tokenizer(models.WordLevel({'<pad>':0, '<eos>':1, '[UNK]':2, 'photo':3, 'synthetic':4}, unk_token='[UNK]'))
    tokenizer.pre_tokenizer = pre_tokenizers.Whitespace()
    tokenizer.post_processor = processors.TemplateProcessing(single='$A <eos>', special_tokens=[('<eos>',1)])
    item=item or {};dimension=item.get('dimension',768);variant=item.get('variant','fixed')
    resolution=item.get('preprocessing',{}).get('size',{}).get('height',224)
    assets={'tokenizer.json':tokenizer.to_str().encode()}
    for kind,filename in [('image','vision_model.onnx_data'),('text','text_model.onnx_data')]:
        external=filename if filename in item.get('files',{}) else None
        assets[kind+'.onnx']=encoder_bytes(kind,dimension,resolution,variant,external)
        if external:assets[filename]=struct.pack('<f',1.)+bytes((dimension-1)*4)
    return assets


class SyntheticResponse(io.BytesIO):
    status = 200
    def __init__(self, payload, delay=0):
        super().__init__(payload);self.delay=delay
    def read(self, size=-1):
        if self.delay:time.sleep(self.delay)
        return super().read(min(size,1024) if size>=0 else size)
