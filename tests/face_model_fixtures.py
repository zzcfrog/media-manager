"""Tiny constant-output ONNX fixtures, encoded without a build-time onnx dependency."""
import math
import struct


def _varint(value):
    out=bytearray()
    while value>127:out.append((value&127)|128);value>>=7
    return bytes(out)+bytes([value])


def _int(field,value):return _varint(field*8)+_varint(value)
def _bytes(field,value):
    value=value.encode() if isinstance(value,str) else value
    return _varint(field*8+2)+_varint(len(value))+value


def _value(name,shape,dtype=1):
    dimensions=b''.join(_bytes(1,_int(1,n)) for n in shape)
    return _bytes(1,name)+_bytes(2,_bytes(1,_int(1,dtype)+_bytes(2,dimensions)))


def model_bytes(stage):
    if stage=='detector':
        shape=[1,3,640,640]
        outputs=[([n,k],0.) for k in (1,4,10) for n in (12800,3200,800)]
    elif stage=='recognizer':shape=[1,3,112,112];outputs=[([1,512],.1)]
    else:shape=[1,3,32,32];outputs=[([1,1],.8)]
    nodes=[];values=[]
    for i,(dims,value) in enumerate(outputs):
        name='out'+str(i)
        tensor=b''.join(_int(1,n) for n in dims)+_int(2,1)+_bytes(9,struct.pack('<f',value)*math.prod(dims))
        attr=_bytes(1,'value')+_bytes(5,tensor)+_int(20,4)
        nodes.append(_bytes(1,_bytes(2,name)+_bytes(4,'Constant')+_bytes(5,attr)))
        values.append(_bytes(12,_value(name,dims)))
    graph=b''.join(nodes)+_bytes(2,'synthetic-contract')+_bytes(11,_value('input',shape))+b''.join(values)
    return _int(1,9)+_bytes(2,'luminisle-tests')+_bytes(7,graph)+_bytes(8,_int(2,13))
