"""Synthetic Nikon record only; no private metadata or real source files."""
import hashlib,json,struct,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
# Research fixtures must stay in a dedicated disposable temporary directory.
import tempfile
if not (ROOT.name.startswith('luminisle-shooting-time-research-')
        and any(ROOT.is_relative_to(Path(p).resolve()) for p in (tempfile.gettempdir(), '/tmp'))):
    raise SystemExit('Copy these research probes to a dedicated temporary directory before running.')


def box(kind,payload):return struct.pack('>I4s',len(payload)+8,kind)+payload

def info(path):
    result=subprocess.run(['exiftool','-j','-a','-G1','-s','-CreateDate','-DateTimeOriginal','-TrackCreateDate','-MediaCreateDate',str(path)],capture_output=True,text=True,check=True)
    return {k:v for k,v in json.loads(result.stdout)[0].items() if k!='SourceFile'}

records=b''
for tag in (0x11,0x12):
    value=b'2024:01:02 03:04:05\0'
    records+=struct.pack('>IHH',tag,2,len(value))+value
addition=box(b'udta',box(b'NCDT',box(b'NCTG',records)))
original=(ROOT/'base.mov').read_bytes()
result=bytearray();offset=0
while offset<len(original):
    size,kind=struct.unpack_from('>I4s',original,offset)
    payload=original[offset+8:offset+size]
    if kind==b'moov':payload+=addition
    result+=box(kind,payload);offset+=size
path=ROOT/'synthetic-nikon.mov';path.write_bytes(result)
before=info(path)
assert before['Nikon:DateTimeOriginal']=='2024:01:02 03:04:05'
proc=subprocess.run(['exiftool','-overwrite_original','-DateTimeOriginal+=8:00:00','-CreateDate+=8:00:00',
                     '-TrackCreateDate+=8:00:00','-MediaCreateDate+=8:00:00',str(path)],capture_output=True,text=True,check=True)
after=info(path)
assert after['QuickTime:CreateDate']=='2024:01:02 11:04:05'
assert after['Nikon:DateTimeOriginal']==before['Nikon:DateTimeOriginal']
assert after['Nikon:CreateDate']==before['Nikon:CreateDate']
# Reproduce current application's exact metadata extraction and priority.
args=['exiftool','-json','-a','-Make','-Model','-CameraModelName','-LensModel','-Encoder','-DateTimeOriginal','-CreateDate',str(path)]
read=json.loads(subprocess.run(args,capture_output=True,text=True,check=True).stdout)[0]
selected=read.get('DateTimeOriginal') or read.get('CreateDate')
result={'synthetic_fixture':True,'before':before,'after_current_app_command':after,
        'current_importer_selected_date':selected,'nikon_fields_unchanged':True,
        'selected_date_still_original':selected=='2024:01:02 03:04:05'}
(ROOT/'evidence/nikon-semantic-probe.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
