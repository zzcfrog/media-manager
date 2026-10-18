from support import _ROOT
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


class ApplicationErrorTests(unittest.TestCase):
    def test_unexpected_error_returns_json_after_logger_module_import(self):
        import backend
        with tempfile.TemporaryDirectory(dir=_ROOT) as temporary:
            root = Path(temporary)
            with patch.multiple(backend, DATA_DIR=root, THUMB_DIR=root/'thumbnails', DB_PATH=root/'media.db'), \
                 patch.object(backend, 'setup_logging'), patch.dict('os.environ', {'MEDIA_MANAGER_SKIP_PRELOAD':'1'}):
                app = backend.create_app()
                @app.get('/api/test-failure')
                def failure():
                    raise RuntimeError('synthetic failure')
                response = app.test_client().get('/api/test-failure')
                self.assertEqual(response.status_code, 500)
                self.assertEqual(response.json, {'error':'服务器内部错误'})
