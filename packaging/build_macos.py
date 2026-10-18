"""Build a local arm64 macOS package without embedding any private user data."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]


def run(*args, **kwargs):
    return subprocess.run([str(a) for a in args], check=True, **kwargs)


def dependencies(path):
    lines = subprocess.check_output(['otool','-L',str(path)], text=True).splitlines()[1:]
    identities = subprocess.check_output(['otool','-D',str(path)], text=True).splitlines()[1:]
    return [line.strip().split(' (',1)[0] for line in lines
            if line.strip().split(' (',1)[0] not in identities]


def resolve_dependency(reference, loader):
    if reference.startswith('/'):
        return Path(reference).resolve()
    if reference.startswith('@loader_path/'):
        return (loader.parent/reference.removeprefix('@loader_path/')).resolve()
    if reference.startswith('@rpath/'):
        suffix = reference.removeprefix('@rpath/')
        commands = subprocess.check_output(['otool','-l',str(loader)],text=True)
        for prefix in re.findall(r'cmd LC_RPATH\s+cmdsize \d+\s+path (.*?) \(offset',commands):
            prefix = prefix.replace('@loader_path', str(loader.parent))
            candidate=Path(prefix)/suffix
            if candidate.exists():return candidate.resolve()
        candidate=loader.parent/suffix
        if candidate.exists():return candidate.resolve()
    raise RuntimeError(f'Cannot resolve native dependency {reference} of {loader.name}')


def bundle_tools():
    directory=ROOT/'build/tools/bin';directory.mkdir(parents=True,exist_ok=True)
    locations={};changes={};names={}
    def copy_binary(source,name=None):
        source=Path(source).resolve()
        if source in locations:return locations[source]
        name=name or source.name
        if name in names and names[name]!=source:raise RuntimeError(f'Native library name collision: {name}')
        names[name]=source;locations[source]=name
        destination=directory/name
        shutil.copy2(source,destination);os.chmod(destination,0o755)
        changes[destination]=[]
        for reference in dependencies(source):
            if reference.startswith(('/usr/lib/','/System/Library/')):continue
            dependency=resolve_dependency(reference,source)
            if dependency==source:continue
            local=copy_binary(dependency,Path(reference).name)
            changes[destination].append((reference,'@loader_path/'+local))
        return name
    for name in ('ffmpeg','ffprobe'):
        source=shutil.which(name)
        if not source:raise RuntimeError(f'Missing build tool: {name}')
        copy_binary(source,name)
    for binary,adjustments in changes.items():
        for old,new in adjustments:run('install_name_tool','-change',old,new,binary,capture_output=True)
        if binary.suffix=='.dylib':run('install_name_tool','-id','@loader_path/'+binary.name,binary,capture_output=True)
        run('codesign','--force','--sign','-',binary,capture_output=True)
    exiftool=Path(shutil.which('exiftool')).resolve()
    perl_root=exiftool.parent.parent/'libexec'
    if not perl_root.exists():raise RuntimeError('Cannot locate the ExifTool Perl distribution')
    destination=ROOT/'build/tools/exiftool'
    if destination.exists():shutil.rmtree(destination)
    # ExifTool itself is pure Perl. Do not bundle Homebrew's unrelated XS modules.
    library=destination/'lib/perl5';library.mkdir(parents=True)
    shutil.copytree(perl_root/'lib/perl5/Image',library/'Image')
    (library/'File').mkdir()
    shutil.copy2(perl_root/'lib/perl5/File/RandomAccess.pm',library/'File/RandomAccess.pm')
    script=exiftool.read_text()
    script=re.sub(r'^unshift @INC, "/opt/homebrew/[^\n]+\n','',script,flags=re.MULTILINE)
    script=script.replace('    use Config;','    unshift @INC, "$exeDir/../exiftool/lib/perl5";')
    if '/opt/homebrew/' in script:raise RuntimeError('Homebrew path left in ExifTool launcher')
    (directory/'exiftool').write_text(script);os.chmod(directory/'exiftool',0o755)
    (ROOT/'build/tools/native-manifest.json').write_text(json.dumps({'bundled_macho_files':sorted(names),'system_dependencies':'macOS /usr/lib and /System/Library only'},indent=2)+'\n')
    # Do not allow an accidentally unbundled Homebrew runtime reference.
    for binary in changes:
        for reference in dependencies(binary):
            if reference.startswith('/') and not reference.startswith(('/usr/lib/','/System/Library/')):
                raise RuntimeError(f'Non-portable dependency left in {binary.name}: {reference}')
    return len(changes)


def relocate_backend():
    """Use direct loader-relative links, avoiding recursive rpath searches on macOS."""
    directory=ROOT/'build/runtime/backend/_internal'
    changed=0
    for binary in sorted(directory.rglob('*')):
        if binary.is_symlink() or not binary.is_file():continue
        if binary.suffix not in ('.so','.dylib') and binary.name!='Python':continue
        adjustments=[]
        for reference in dependencies(binary):
            if not reference.startswith('@rpath/'):continue
            target=(directory/reference.removeprefix('@rpath/')).resolve()
            if not target.is_file():raise RuntimeError(f'Unresolved frozen dependency: {binary.name}: {reference}')
            relative='@loader_path/'+os.path.relpath(target,binary.parent)
            adjustments.append((reference,relative))
        if not adjustments:continue
        for old,new in adjustments:run('install_name_tool','-change',old,new,binary,capture_output=True)
        run('codesign','--force','--sign','-',binary,capture_output=True)
        changed+=1
    print('Relocated native Python libraries:',changed,flush=True)


def main():
    parser=argparse.ArgumentParser();parser.add_argument('--tools-only',action='store_true');parser.add_argument('--skip-python',action='store_true');parser.add_argument('--relocate-only',action='store_true')
    args=parser.parse_args()
    if sys.platform!='darwin' or os.uname().machine!='arm64':raise RuntimeError('This build targets Apple Silicon macOS')
    if args.relocate_only:
        relocate_backend();return
    count=bundle_tools();print('Bundled and signed native tools:',count,flush=True)
    if args.tools_only:return
    if not args.skip_python:
        run(sys.executable,'-m','PyInstaller',ROOT/'packaging/backend.spec','--distpath',ROOT/'build/runtime','--workpath',ROOT/'build/pyinstaller','--noconfirm',cwd=ROOT)
    relocate_backend()
    runtime=ROOT/'build/runtime/backend/media-manager-backend'
    run(runtime,'self-test',env={**os.environ,'MEDIA_MANAGER_SKIP_PRELOAD':'1'})
    env={**os.environ,'CSC_IDENTITY_AUTO_DISCOVERY':'false','ELECTRON_RUN_AS_NODE':''}
    run('npm','run','build:mac',cwd=ROOT/'electron',env=env)


if __name__=='__main__':main()
