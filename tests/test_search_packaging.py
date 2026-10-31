"""Ordinary Chinese segmentation and saved FTS indexes need no optional jieba tasks."""
from support import _ROOT
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

import jieba


class SearchPackagingTests(unittest.TestCase):
    def test_trimmed_jieba_preserves_segmentation_and_indexed_search(self):
        script = '''
import sys,json
if sys.argv[1]: sys.path.insert(0,sys.argv[1])
sys.path.insert(0,sys.argv[2])
from support import DatabaseCase
from backend.blueprints.library import _segment,_segment_query
fixture=DatabaseCase();fixture.setUp()
try:
    rows=[('湖边的日落.jpg','湖面夕阳与树叶'),('城市街道.mov','2026年旅行与城市夜景'),('公园里的小猫.png','小猫在公园里玩耍')]
    for name,description in rows:
        mid=fixture.seed(fixture.case/name)
        fixture.segments(mid,description)
    phrases=['北京朝阳公园的视频素材','南京市长江大桥','图片相似度与音乐收藏','树叶、风景、证件和实物','Synthetic-landscape-2.png','人工智能与摄影作品']
    hits={q:fixture.search(q) for q in ['小猫','街道','旅行','日落','树叶']}
    assert hits['小猫']==[3] and hits['街道']==[2]
    print(json.dumps({'segments':[_segment(p) for p in phrases],'queries':[_segment_query(p) for p in phrases],'hits':hits},ensure_ascii=False))
finally: fixture.doCleanups()
'''
        def run(path):
            result = subprocess.run([sys.executable, '-B', '-c', script, str(path) if path else '',
                                     str(Path(__file__).parent.resolve())],
                                    cwd=Path(__file__).parents[1], env=dict(os.environ),
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            return json.loads(result.stdout)

        baseline = run(None)
        with tempfile.TemporaryDirectory(dir=_ROOT) as temporary:
            source = Path(jieba.__file__).parent
            shutil.copytree(source, Path(temporary) / 'jieba',
                            ignore=shutil.ignore_patterns('analyse', 'posseg', 'lac_small', '__pycache__'))
            self.assertEqual(run(temporary), baseline)
