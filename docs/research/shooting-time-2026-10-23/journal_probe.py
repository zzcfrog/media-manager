"""Disposable synthetic-file journal research; no production integration."""
import fcntl,json,os,shutil,statistics,struct,time
from pathlib import Path
ROOT=Path(__file__).resolve().parent
# Research fixtures must stay in a dedicated disposable temporary directory.
import tempfile
if not (ROOT.name.startswith('luminisle-shooting-time-research-')
        and any(ROOT.is_relative_to(Path(p).resolve()) for p in (tempfile.gettempdir(), '/tmp'))):
    raise SystemExit('Copy these research probes to a dedicated temporary directory before running.')

namespace={'__file__':str(ROOT/'probe.py')}
exec(compile((ROOT/'probe.py').read_text().split("result = {'date':")[0],str(ROOT/'probe.py'),'exec'),namespace)
plan=namespace['plan']

def sync(fd):
    os.fsync(fd)
    fcntl.fcntl(fd,fcntl.F_FULLFSYNC)

def prepare(path,journal):
    fd=os.open(path,os.O_RDWR)
    patches=plan(fd,8)
    stat=os.fstat(fd)
    record={'dev':stat.st_dev,'ino':stat.st_ino,'size':stat.st_size,
            'patches':[{'offset':p[0],'old':p[1].hex(),'new':p[2].hex()} for p in patches]}
    jfd=os.open(journal,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    try:
        payload=json.dumps(record).encode()
        assert os.write(jfd,payload)==len(payload)
        sync(jfd)
    finally:os.close(jfd)
    # This probe fsyncs the directory but has not validated power-loss durability.
    dfd=os.open(ROOT,os.O_RDONLY)
    try:os.fsync(dfd)
    finally:os.close(dfd)
    return fd,patches

def classify(fd,patches):
    result=[]
    for offset,old,new,_ in patches:
        value=os.pread(fd,len(old),offset)
        result.append('old' if value==old else 'new' if value==new else 'unknown')
    return result

seconds=[]
for n in range(3):
    path=ROOT/f'durable-{n}.mp4';shutil.copyfile(ROOT/'base.mp4',path)
    with path.open('r+b') as file:
        file.seek(0, 2)
        file.write(struct.pack('>I4sQ',1,b'mdat',512*1024*1024+16))
        file.seek(512*1024*1024-1,1);file.write(b'\0');file.flush();os.fsync(file.fileno())
    journal=ROOT/f'journal-{n}.json'
    started=time.perf_counter();fd,patches=prepare(path,journal)
    try:
        assert classify(fd,patches)==['old']*len(patches)
        for offset,old,new,_ in patches:assert os.pwrite(fd,new,offset)==len(new)
        sync(fd)
        assert classify(fd,patches)==['new']*len(patches)
    finally:os.close(fd)
    seconds.append(time.perf_counter()-started)
    path.unlink();journal.unlink()

path=ROOT/'interrupted.mp4';shutil.copyfile(ROOT/'base.mp4',path)
journal=ROOT/'interrupted-journal.json';fd,patches=prepare(path,journal)
try:
    for offset,old,new,_ in patches[:2]:os.pwrite(fd,new,offset)
    sync(fd)
    state=classify(fd,patches)
    assert state==['new','new','old','old','old']
finally:os.close(fd)
# Reopen and inspect only, as a restart would do. Never apply a second relative shift.
fd=os.open(path,os.O_RDONLY)
try:assert classify(fd,patches)==state
finally:os.close(fd)
result={'research_only':True,'logical_file_extra_mdat_mib':512,
        'journal_and_F_FULLFSYNC_seconds':seconds,'median_seconds':statistics.median(seconds),
        'journal_stored_before_target_writes':True,'written_target_bytes':20,
        'simulated_interruption_after_writes':2,'states_detected_after_reopen':state,
        'recovery_writes_performed':False,'power_loss_or_unplug_tested':False,
        'full_metadata_readback_and_db_commit_included_in_timings':False}
(ROOT/'evidence/journal-probe.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False))
