# InsightFace PrivateFrame primitives

Source: https://github.com/deepinsight/insightface/tree/c6c3af7bd2d0a0bf4b78c78437357f3521aa5d52/python-package/insightface/app/privateframe
Pinned commit: `c6c3af7bd2d0a0bf4b78c78437357f3521aa5d52` (retrieved 2026-11-01).

`tracker.py`, `geometry.py` and `scene_cut.py` are unmodified upstream files.
`recognition_samples.py` contains unmodified selected classes/functions plus their
required imports/constants from upstream `recognition.py`. `defaults.json` retains
the upstream flow and scene-cut defaults from `configs/base.yaml`.

The application adapter is `backend/services/video_people.py`. It reuses these
primitives with the existing ONNX sessions and people library; it does not embed
PrivateFrame's full streaming, redaction, reference-gallery or model-download SDK.
No pretrained weights are distributed here.

Upstream declares Python library code under MIT:
https://github.com/deepinsight/insightface/blob/c6c3af7bd2d0a0bf4b78c78437357f3521aa5d52/python-package/README.md#license
Copyright remains with the InsightFace contributors.

MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
