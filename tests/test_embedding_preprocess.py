"""Keep saved image features compatible while removing runtime Torch dependencies."""
from support import _ROOT
import os
from pathlib import Path
import subprocess
import sys
import unittest

import numpy as np
from PIL import Image
from backend.services import embedding

try:
    from torchvision import transforms
except ImportError:
    transforms = None


class EmbeddingPreprocessTests(unittest.TestCase):
    def test_black_and_white_keep_float32_nchw_normalization(self):
        mean = np.array([.485, .456, .406], dtype=np.float32)
        std = np.array([.229, .224, .225], dtype=np.float32)
        for level in (0, 255):
            with self.subTest(level=level):
                actual = embedding._preprocess_image(Image.new('RGB', (129, 257), (level,) * 3))
                self.assertEqual(actual.shape, (1, 3, 224, 224))
                self.assertEqual(actual.dtype, np.float32)
                self.assertTrue(actual.flags.c_contiguous)
                expected = (np.float32(level / 255) - mean) / std
                for channel in range(3):
                    np.testing.assert_array_equal(actual[0, channel], np.full((224, 224), expected[channel], dtype=np.float32))

    @unittest.skipIf(transforms is None, 'Torchvision is an optional compatibility-test dependency')
    def test_pixel_exact_match_to_previous_torchvision_pipeline(self):
        reference = transforms.Compose([
            transforms.Resize(256), transforms.CenterCrop(224), transforms.ToTensor(),
            transforms.Normalize([.485, .456, .406], [.229, .224, .225]),
        ])
        rng = np.random.default_rng(13)
        for width, height in [(1, 3), (3, 1), (17, 17), (224, 224), (256, 513),
                              (513, 256), (319, 213), (641, 479), (1920, 1080)]:
            pixels = rng.integers(0, 256, size=(height, width, 3), dtype=np.uint8)
            image = Image.fromarray(pixels)
            with self.subTest(size=(width, height)):
                expected = reference(image).unsqueeze(0).numpy()
                np.testing.assert_array_equal(embedding._preprocess_image(image), expected)

    def test_runtime_imports_and_preprocessing_work_without_torch(self):
        script = '''
import importlib.abc, sys
class NoTorch(importlib.abc.MetaPathFinder):
    def find_spec(self, fullname, path=None, target=None):
        if fullname.split('.')[0] in {'torch', 'torchvision'}:
            raise ImportError('Torch intentionally unavailable in slim runtime')
sys.meta_path.insert(0, NoTorch())
from backend.services import embedding
from PIL import Image
import faster_whisper
assert embedding._preprocess_image(Image.new('RGB', (320, 180))).shape == (1, 3, 224, 224)
assert 'torch' not in sys.modules and 'torchvision' not in sys.modules
'''
        result = subprocess.run([sys.executable, '-B', '-c', script], cwd=Path(__file__).parents[1],
                                env={**os.environ, 'MEDIA_MANAGER_HOME': str(_ROOT / 'torch-free-runtime')},
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
