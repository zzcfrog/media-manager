"""Isolated regressions: python -m unittest discover -s tests -v.

Never call the application factory or use the development database/models.
"""
import atexit
import os
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

_ROOT = Path(tempfile.mkdtemp(prefix='video-analyzer-tests-'))
os.environ['MEDIA_MANAGER_HOME'] = str(_ROOT / 'data')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.dont_write_bytecode = True
atexit.register(shutil.rmtree, _ROOT, ignore_errors=True)

from flask import Flask
from backend.db import init_db, get_db, close_db
from backend.blueprints import analysis, library, workbench, creative, serve, tags, taxonomy


class DatabaseCase(unittest.TestCase):
    def setUp(self):
        self.case = Path(tempfile.mkdtemp(dir=_ROOT))
        self.app = Flask(__name__)
        self.app.config.update(TESTING=True, DATABASE=str(self.case / 'test.db'), MODELS_ROOT=str(self.case / 'models'))
        init_db(self.app)
        for module in (analysis, library, workbench, creative, tags, taxonomy):
            self.app.register_blueprint(module.bp, url_prefix='/api/' + module.bp.name)
        self.app.register_blueprint(serve.bp)
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.db = get_db()
        self.addCleanup(self.ctx.pop)

    def seed(self, path=None, **fields):
        data = {'file_path': str(path or self.case / 'clip.mov'), 'file_name': Path(path or 'clip.mov').name,
                'media_type': 'video', **fields}
        mid = self.db.execute(f'INSERT INTO media ({",".join(data)}) VALUES ({",".join("?" for _ in data)})', list(data.values())).lastrowid
        self.db.commit()
        return mid

    def segments(self, mid, visual='forest'):
        analysis.save_segments(mid, [dict(time_start='00:00:00', time_end='00:00:05', visual=visual)])

    def search(self, q):
        response = self.client.get('/api/library/', query_string={'q':q})
        self.assertEqual(response.status_code, 200)
        return [m['id'] for m in response.json['data']]
