from unittest.mock import patch
from PIL import Image
from support import DatabaseCase
from backend.blueprints import serve


class InspectorPreviewTests(DatabaseCase):
    def test_cache_only_missing_preview_never_decodes_original_or_changes_record(self):
        original = self.case / 'original.jpg'
        Image.new('RGB', (10, 10), 'red').save(original)
        mid = self.seed(original, media_type='image', thumbnail_path='missing.jpg')
        before = tuple(self.db.execute('SELECT * FROM media WHERE id=?', (mid,)).fetchone())
        with patch.object(serve, 'THUMB_DIR', self.case), \
                patch('backend.services.importer._generate_thumbnail', return_value=None) as generate:
            response = self.client.get(f'/media/thumbnail/{mid}?cached=1')
        self.assertEqual(response.status_code, 404)
        generate.assert_not_called()
        self.assertEqual(tuple(self.db.execute('SELECT * FROM media WHERE id=?', (mid,)).fetchone()), before)

    def test_cache_only_serves_existing_preview_even_with_source_offline(self):
        preview = self.case / 'preview.jpg'
        Image.new('RGB', (10, 10), 'green').save(preview)
        mid = self.seed(self.case / 'offline.jpg', media_type='image', thumbnail_path=preview.name)
        with patch.object(serve, 'THUMB_DIR', self.case):
            response = self.client.get(f'/media/thumbnail/{mid}?cached=1&v=version')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, preview.read_bytes())
        response.close()

    def test_cache_only_does_not_extract_a_requested_video_frame(self):
        preview = self.case / 'preview.jpg'
        Image.new('RGB', (10, 10), 'green').save(preview)
        mid = self.seed(thumbnail_path=preview.name)
        with patch.object(serve, 'THUMB_DIR', self.case), patch.object(serve.subprocess, 'run') as run:
            response = self.client.get(f'/media/thumbnail/{mid}?cached=1&t=8')
        self.assertEqual(response.status_code, 200)
        run.assert_not_called()
        response.close()
