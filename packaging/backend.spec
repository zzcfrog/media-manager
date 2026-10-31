# Build from the repository root: pyinstaller packaging/backend.spec
from pathlib import Path
from PyInstaller.utils.hooks import collect_all, collect_submodules
root = Path(SPECPATH).parent
hidden = collect_submodules('backend') + collect_submodules('hdbscan')
datas = [(str(root / 'frontend'), 'frontend'), (str(root / 'backend/prompts'), 'backend/prompts'),
         (str(root / 'backend/resources'), 'backend/resources')]
binaries = []
for package in ('hdbscan', 'ctranslate2', 'onnxruntime', 'faster_whisper', 'pillow_heif', 'rawpy'):
    data, binary, imports = collect_all(package)
    datas += data;binaries += binary;hidden += imports
analysis = Analysis([str(root/'desktop_backend.py')], pathex=[str(root)], binaries=binaries,
                    datas=datas, hiddenimports=hidden, excludes=['tkinter','pytest','IPython','torch','torchvision',
                        'jieba.analyse','jieba.posseg','jieba.lac_small'],
                    noarchive=False)
# The standard jieba hook collects all resources, including unused optional tasks.
analysis.datas = [item for item in analysis.datas if not item[0].replace('\\', '/').startswith(
    ('jieba/analyse/', 'jieba/posseg/', 'jieba/lac_small/'))]
pyz = PYZ(analysis.pure)
executable = EXE(pyz, analysis.scripts, [], exclude_binaries=True, name='media-manager-backend',
                 debug=False, strip=False, upx=False, console=True, codesign_identity='-', entitlements_file=str(root/'packaging/backend-entitlements.plist'))
COLLECT(executable, analysis.binaries, analysis.datas, strip=False, upx=False, name='backend')
