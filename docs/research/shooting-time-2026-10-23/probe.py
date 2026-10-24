"""Research only: never import this probe into the application or use real media."""
import datetime as dt
import hashlib
import json
import os
import shutil
import statistics
import struct
import subprocess
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent
# Research fixtures must stay in a dedicated disposable temporary directory.
import tempfile
if not (ROOT.name.startswith('luminisle-shooting-time-research-')
        and any(ROOT.is_relative_to(Path(p).resolve()) for p in (tempfile.gettempdir(), '/tmp'))):
    raise SystemExit('Copy these research probes to a dedicated temporary directory before running.')

TARGETS = {b'mvhd': 'CreateDate', b'tkhd': 'TrackCreateDate', b'mdhd': 'MediaCreateDate'}
CONTAINERS = {b'moov', b'trak', b'mdia'}
EPOCH = dt.datetime(1904, 1, 1, tzinfo=dt.timezone.utc)


def run(args):
    return subprocess.run(args, check=True, capture_output=True, text=True)


def boxes(fd, start, end):
    pos = start
    while pos < end:
        raw = os.pread(fd, 8, pos)
        if len(raw) != 8:
            raise ValueError('truncated box')
        size, kind = struct.unpack('>I4s', raw)
        header = 8
        if size == 1:
            value = os.pread(fd, 8, pos + 8)
            if len(value) != 8:
                raise ValueError('truncated extended size')
            size = struct.unpack('>Q', value)[0]
            header = 16
        elif size == 0:
            size = end - pos
        if size < header or pos + size > end:
            raise ValueError('box out of bounds')
        yield pos, size, kind, header
        pos += size


def plan(fd, hours):
    before = os.fstat(fd)
    patches = []
    roots = list(boxes(fd, 0, before.st_size))
    if sum(b[2] == b'moov' for b in roots) != 1:
        raise ValueError('ambiguous movie')
    if any(b[2] == b'moof' for b in roots):
        raise ValueError('fragmented movie')

    def walk(start, end, depth=0):
        if depth > 8:
            raise ValueError('excessive depth')
        for pos, size, kind, header in boxes(fd, start, end):
            payload = pos + header
            if kind == b'cmov':
                raise ValueError('compressed movie')
            if kind in TARGETS:
                version = os.pread(fd, 1, payload)
                if version not in (b'\x00', b'\x01'):
                    raise ValueError('unsupported version')
                width = 8 if version == b'\x01' else 4
                offset = payload + 4
                if offset + width > pos + size:
                    raise ValueError('truncated timestamp')
                old = os.pread(fd, width, offset)
                value = int.from_bytes(old, 'big')
                if value == 0:
                    raise ValueError('unknown/zero timestamp')
                target = value + hours * 3600
                if not 0 < target < 1 << (width * 8):
                    raise ValueError('timestamp overflow')
                patches.append((offset, old, target.to_bytes(width, 'big'), TARGETS[kind]))
            elif kind in CONTAINERS:
                walk(payload, pos + size, depth + 1)
    walk(0, before.st_size)
    if not patches:
        raise ValueError('no timestamps')
    return patches


def patch_file(path, hours):
    started = time.perf_counter()
    fd = os.open(path, os.O_RDWR)
    try:
        before = os.fstat(fd)
        patches = plan(fd, hours)
        for offset, old, _, _ in patches:
            assert os.pread(fd, len(old), offset) == old
        for offset, _, new, _ in patches:
            assert os.pwrite(fd, new, offset) == len(new)
        os.fsync(fd)
        for offset, _, new, _ in patches:
            assert os.pread(fd, len(new), offset) == new
        after = os.fstat(fd)
        assert (before.st_dev, before.st_ino, before.st_size) == (after.st_dev, after.st_ino, after.st_size)
    finally:
        os.close(fd)
    return {'seconds': time.perf_counter() - started, 'written_bytes': sum(len(p[2]) for p in patches),
            'fields': len(patches), 'patches': [(p[0], len(p[1])) for p in patches]}


def tags(path):
    data = json.loads(run(['exiftool', '-j', '-a', '-G1', '-s', '-CreateDate', '-TrackCreateDate',
                           '-MediaCreateDate', '-DateTimeOriginal', '-CreationDate', str(path)]).stdout)[0]
    return {k: v for k, v in data.items() if k != 'SourceFile'}


def media_hashes(path):
    fd = os.open(path, os.O_RDONLY)
    result = []
    try:
        for pos, size, kind, header in boxes(fd, 0, os.fstat(fd).st_size):
            if kind != b'mdat':
                continue
            digest = hashlib.sha256()
            offset, remaining = pos + header, size - header
            while remaining:
                chunk = os.pread(fd, min(1024 * 1024, remaining), offset)
                assert chunk
                digest.update(chunk)
                offset += len(chunk)
                remaining -= len(chunk)
            result.append(digest.hexdigest())
    finally:
        os.close(fd)
    return result


def decoded_hash(path):
    return run(['ffmpeg', '-v', 'error', '-i', str(path), '-map', '0', '-f', 'hash', '-hash', 'sha256', '-']).stdout.strip()


def bump_v1(blob):
    offset = 0
    out = bytearray()
    while offset < len(blob):
        size, kind = struct.unpack_from('>I4s', blob, offset)
        payload = blob[offset + 8:offset + size]
        if kind in CONTAINERS:
            payload = bump_v1(payload)
        elif kind in TARGETS:
            assert payload[0] == 0
            creation, modification = struct.unpack_from('>II', payload, 4)
            duration_pos = 20 if kind == b'tkhd' else 16
            payload = b'\x01' + payload[1:4] + struct.pack('>QQ', creation, modification) + payload[12:duration_pos] + struct.pack('>Q', struct.unpack_from('>I', payload, duration_pos)[0]) + payload[duration_pos + 4:]
        out += struct.pack('>I4s', len(payload) + 8, kind) + payload
        offset += size
    return bytes(out)


result = {'date': '2026-10-23', 'research_only': True,
          'environment': {'storage': 'local APFS SSD; not external disk', 'exiftool': run(['exiftool', '-ver']).stdout.strip(),
                          'ffmpeg': run(['ffmpeg', '-version']).stdout.splitlines()[0]},
          'functional': [], 'rejections': [], 'benchmark': [], 'semantic_checks': {}}

# Real decodable synthetic audio+video, both movie-header placements and header versions.
fast = ROOT / 'fast.mp4'
run(['ffmpeg', '-v', 'error', '-i', str(ROOT / 'base.mp4'), '-map', '0', '-c', 'copy', '-map_metadata', '0', '-movflags', '+faststart', str(fast)])
v1 = ROOT / 'version1.mov'
v1.write_bytes(bump_v1((ROOT / 'base.mov').read_bytes()))
for name, hours in [('base.mp4', 8), ('base.mov', -24), ('fast.mp4', 24), ('version1.mov', -8)]:
    src = ROOT / name
    path = ROOT / ('patch-' + name)
    shutil.copyfile(src, path)
    old = path.read_bytes()
    original_tags = tags(path)
    original_media = media_hashes(path)
    original_decode = decoded_hash(path)
    stats = patch_file(path, hours)
    new = path.read_bytes()
    allowed = {x for offset, width in stats['patches'] for x in range(offset, offset + width)}
    changed = {i for i, (a, b) in enumerate(zip(old, new)) if a != b}
    assert len(old) == len(new) and changed <= allowed
    assert media_hashes(path) == original_media and decoded_hash(path) == original_decode
    after_tags = tags(path)
    for key, value in original_tags.items():
        expected = (dt.datetime.strptime(value, '%Y:%m:%d %H:%M:%S') + dt.timedelta(hours=hours)).strftime('%Y:%m:%d %H:%M:%S')
        assert after_tags[key] == expected, (key, expected, after_tags[key])
    result['functional'].append({'file': name, 'hours': hours, **stats, 'actual_changed_bytes': len(changed),
                                 'all_other_bytes_unchanged': True, 'mdat_hashes_unchanged': True,
                                 'decoded_audio_video_unchanged': True, 'exiftool_readback': after_tags})

# Size-independent patching: sparse appended mdat (not actual camera footage).
for mib in (64, 512):
    times = {key: [] for key in ('exiftool_current', 'exiftool_in_place', 'fixed_header_patch')}
    details = {}
    for round_no in range(3):
        for method in times:
            path = ROOT / f'bench-{method}-{mib}.mp4'
            shutil.copyfile(ROOT / 'base.mp4', path)
            with path.open('r+b') as file:
                file.seek(0, 2)
                start = file.tell()
                file.write(struct.pack('>I4sQ', 1, b'mdat', mib * 1024 * 1024 + 16))
                file.seek(mib * 1024 * 1024 - 1, 1)
                file.write(b'\0')
                file.flush(); os.fsync(file.fileno())
            before = path.stat()
            before_media = media_hashes(path)
            if method == 'fixed_header_patch':
                stats = patch_file(path, 8)
            else:
                option = '-overwrite_original' if method == 'exiftool_current' else '-overwrite_original_in_place'
                started = time.perf_counter()
                run(['exiftool', option, '-DateTimeOriginal+=8:00:00', '-CreateDate+=8:00:00',
                     '-TrackCreateDate+=8:00:00', '-MediaCreateDate+=8:00:00', str(path)])
                with path.open('rb') as file:
                    os.fsync(file.fileno())
                stats = {'seconds': time.perf_counter() - started}
            times[method].append(stats['seconds'])
            after = path.stat()
            assert media_hashes(path) == before_media
            details[method] = {'same_inode': before.st_ino == after.st_ino,
                               'same_size': before.st_size == after.st_size,
                               'logical_file_bytes': before.st_size,
                               'written_bytes_by_probe': stats.get('written_bytes'),
                               'all_mdat_sha256_equal': True}
            path.unlink()
    result['benchmark'].append({'extra_sparse_mdat_mib': mib, 'seconds': times,
                                'median_seconds': {k: statistics.median(v) for k, v in times.items()},
                                'verification': details})

# Structural rejection and representational boundaries, all before writes.
base = (ROOT / 'base.mp4').read_bytes()
fd = os.open(ROOT / 'base.mp4', os.O_RDONLY)
slots = plan(fd, 1); os.close(fd)
for name in ('zero', 'underflow', 'overflow', 'bad-version', 'fragmented', 'truncated'):
    blob = bytearray(base)
    offset = slots[0][0]
    if name == 'zero': blob[offset:offset+4] = b'\0' * 4
    if name == 'underflow': blob[offset:offset+4] = (1).to_bytes(4, 'big')
    if name == 'overflow': blob[offset:offset+4] = ((1 << 32) - 1).to_bytes(4, 'big')
    if name == 'bad-version': blob[offset-4] = 2
    if name == 'fragmented': blob += struct.pack('>I4s', 8, b'moof')
    if name == 'truncated': blob = blob[:-20]
    path = ROOT / f'reject-{name}.mp4'; path.write_bytes(blob)
    old_hash = hashlib.sha256(blob).hexdigest()
    try:
        patch_file(path, -8 if name == 'underflow' else 8)
    except ValueError as error:
        assert hashlib.sha256(path.read_bytes()).hexdigest() == old_hash
        result['rejections'].append({'case': name, 'reason': str(error), 'unmodified': True})
    else:
        raise AssertionError(name)

# Independent QuickTime, XMP and Apple Keys dates can disagree.
path = ROOT / 'metadata-mixed.mov'; shutil.copyfile(ROOT / 'base.mov', path)
run(['exiftool', '-overwrite_original', '-XMP-exif:DateTimeOriginal=2024:01:02 03:04:05',
     '-XMP-xmp:CreateDate=2024:01:02 03:04:05', '-Keys:CreationDate=2024:01:02 11:04:05+08:00', str(path)])
before = tags(path)
patch_file(path, 8)
after = tags(path)
assert before['Keys:CreationDate'] == after['Keys:CreationDate']
assert before['XMP-exif:DateTimeOriginal'] == after['XMP-exif:DateTimeOriginal']
result['semantic_checks']['headers_only_leave_xmp_and_keys_stale'] = {'before': before, 'after': after}
# Existing app's exact command also leaves Apple Keys:CreationDate unchanged.
path = ROOT / 'current-mixed.mov'; shutil.copyfile(ROOT / 'base.mov', path)
run(['exiftool', '-overwrite_original', '-Keys:CreationDate=2024:01:02 11:04:05+08:00', str(path)])
before = tags(path)
run(['exiftool', '-overwrite_original', '-DateTimeOriginal+=8:00:00', '-CreateDate+=8:00:00',
     '-TrackCreateDate+=8:00:00', '-MediaCreateDate+=8:00:00', str(path)])
after = tags(path)
assert before['Keys:CreationDate'] == after['Keys:CreationDate']
result['semantic_checks']['current_command_leaves_keys_stale'] = {'before': before, 'after': after}
(ROOT / 'evidence/results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'functional': len(result['functional']), 'rejected_before_writes': len(result['rejections']),
                  'benchmark_medians': [{str(r['extra_sparse_mdat_mib']): r['median_seconds']} for r in result['benchmark']],
                  'evidence': str(ROOT / 'evidence/results.json')}, ensure_ascii=False))
