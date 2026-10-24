# 拍摄时间局部写入研究探针

这三个脚本只生成或修改合成测试文件，没有应用接口、生产资料库入口或真实媒体参数。它们不是业务实现；故意省略了正式格式兼容、任务锁、完整故障恢复和数据库状态机。

依赖本机 Python 3.12、ExifTool 和 FFmpeg。请在项目根目录执行以下命令：它会创建专用临时目录，复制脚本，生成两段 1 秒的合成音视频并运行。脚本拒绝在源码目录运行。最高逻辑测试文件约 512 MiB；ExifTool 重写后可能占用相应真实磁盘空间。

```sh
PYTHONDONTWRITEBYTECODE=1 .build-venv/bin/python - <<'PY'
import shutil, subprocess, sys, tempfile
from pathlib import Path

scratch = Path(tempfile.mkdtemp(prefix='luminisle-shooting-time-research-'))
source = Path('docs/research/shooting-time-2026-10-23')
(scratch / 'evidence').mkdir()
for name in ('probe.py', 'nikon_probe.py', 'journal_probe.py'):
    shutil.copyfile(source / name, scratch / name)
for extension in ('mov', 'mp4'):
    subprocess.run([
        'ffmpeg', '-hide_banner', '-loglevel', 'error',
        '-f', 'lavfi', '-i', 'testsrc2=size=320x180:rate=10',
        '-f', 'lavfi', '-i', 'sine=frequency=440:sample_rate=44100',
        '-t', '1', '-c:v', 'libx264', '-preset', 'ultrafast', '-c:a', 'aac',
        '-metadata', 'creation_time=2024-01-02T03:04:05Z', str(scratch / f'base.{extension}')
    ], check=True)
try:
    for name in ('probe.py', 'nikon_probe.py', 'journal_probe.py'):
        subprocess.run([sys.executable, str(scratch / name)], check=True)
    print(f'Evidence and disposable fixtures: {scratch}')
except BaseException:
    print(f'Failure evidence preserved: {scratch}')
    raise
PY
```

查看 `evidence/*.json` 后可删除本次新建的临时目录。不要给脚本添加真实文件参数或将其用于原始素材。`probe.py` 验证标准头部定点写入与合成 I/O 对照；`nikon_probe.py` 验证当前命令遗漏 Nikon 日期的语义；`journal_probe.py` 验证写前记录与部分写入识别。后者的模拟中断不是物理断电/拔盘试验。
