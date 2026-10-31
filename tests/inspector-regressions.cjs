const fs = require('fs');
const vm = require('vm');
const assert = require('assert');
const path = require('path');

const context = vm.createContext({
  console, Uint32Array, Uint8ClampedArray,
  t: key => key,
  API: { thumbUrl: id => `/media/thumbnail/${id}` },
  fmtSize: value => `${value} B`, fmtDur: value => `${value}s`,
});
vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/js/media-inspector.js'), 'utf8'), context);
const component = vm.runInContext('MediaInspector', context);
function state(media) {
  const value = { ...component.data(), media, $root: {} };
  for (const [name, method] of Object.entries(component.methods)) if (typeof method === 'function') value[name] = method.bind(value);
  for (const [name, get] of Object.entries(component.computed)) Object.defineProperty(value, name, { get: () => get.call(value) });
  return value;
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('histograms count luminance and RGB bins and ignore fully transparent pixels', () => {
  const value = state({ id: 1, media_type: 'image' });
  assert.equal(typeof value.histogramFromPixels, 'function', 'pixel histogram calculation is missing');
  const histogram = value.histogramFromPixels(new Uint8ClampedArray([
    0,0,0,255, 255,255,255,255, 255,0,0,255, 0,255,0,255, 0,0,255,255, 128,128,128,0,
  ]));
  assert.equal(histogram.luminance[0], 1);
  assert.equal(histogram.luminance[255], 1);
  assert.equal(histogram.luminance[54], 1);
  assert.equal(histogram.luminance[182], 1);
  assert.equal(histogram.luminance[18], 1);
  for (const key of ['red', 'green', 'blue', 'luminance']) {
    assert.equal(histogram[key].length, 256);
    assert.equal(Array.from(histogram[key]).reduce((a,b) => a+b, 0), 5);
  }
  assert.equal(histogram.red[255], 2);
});
test('histogram paths remain finite for empty or flat distributions', () => {
  const value = state(null);
  assert.equal(typeof value.histogramPath, 'function', 'histogram plot is missing');
  const bins = new Uint32Array(256);
  for (const max of [0, 1]) assert(!/NaN|Infinity/.test(value.histogramPath(bins, max)));
  bins[255] = 10;
  assert(value.histogramPath(bins, 10).includes('255,3'));
});
test('preview histograms use bounded cached pixels and reject another selection', () => {
  const value = state({ id: 2, media_type: 'image', thumbnail_path: 'two.jpg' });
  assert.equal(typeof value.onPreviewLoaded, 'function', 'preview histogram loading is missing');
  let draws = 0;
  context.document = { createElement() { return { getContext() { return {
    drawImage() { draws++; },
    getImageData() { return { data: new Uint8ClampedArray([12,34,56,255]) }; },
  }; } }; } };
  const old = { dataset: { mediaId: '1' }, naturalWidth: 1000, naturalHeight: 1000 };
  value.onPreviewLoaded({ target: old });
  assert.equal(draws, 0);
  const current = { ...old, dataset: { mediaId: '2' }, naturalWidth: 100, naturalHeight: 20000 };
  const canvas = { getContext() { return {
    drawImage() { draws++; assert(canvas.width <= 320 && canvas.height <= 320); },
    getImageData() { return { data: new Uint8ClampedArray([12,34,56,255]) }; },
  }; } };
  context.document.createElement = () => canvas;
  value.onPreviewLoaded({ target: current });
  assert.equal(draws, 1);
  assert.equal(value.histogram.blue[56], 1);
  assert.equal(value.histogramError, false);
});
test('failed or unreadable previews clear charts instead of plotting the placeholder', () => {
  const value = state({ id: 2, media_type: 'image' });
  assert.equal(typeof value.onPreviewError, 'function', 'preview failure handling is missing');
  value.histogram = { stale: true };
  value.onPreviewError({ target: { dataset: { mediaId: '1' } } });
  assert.equal(value.histogram.stale, true);
  value.onPreviewError({ target: { dataset: { mediaId: '2' } } });
  assert.equal(value.histogram, null);
  assert.equal(value.previewFailed, true);
  value.onPreviewLoaded({ target: { dataset: { mediaId: '2' }, naturalWidth: 20, naturalHeight: 20 } });
  assert.equal(value.histogram, null);
  value.retryPreview();
  assert.equal(value.previewFailed, false);
  context.document = { createElement() { return { getContext() { throw Error('blocked canvas'); } }; } };
  value.onPreviewLoaded({ target: { dataset: { mediaId: '2' }, naturalWidth: 20, naturalHeight: 20 } });
  assert.equal(value.histogramError, true);
  assert.equal(value.histogram, null);
});
test('changing selection resets preview state independently of analysis status', () => {
  const value = state({ id: 1, media_type: 'image' });
  value.histogram = { old: true }; value.histogramError = value.previewFailed = true;
  assert(component.watch.previewKey, 'preview state must reset independently of analysis status');
  component.watch.previewKey.handler.call(value);
  assert.equal(value.histogram, null);
  assert.equal(value.histogramError, false);
  assert.equal(value.previewFailed, false);
  assert.equal(typeof component.watch.analysisKey.handler, 'function');
});
test('compact metadata exposes stored camera, image, audio and library data without scanning originals', () => {
  const media = { id: 1, media_type: 'video', file_name: 'test.MOV', file_path: '/offline/test.MOV',
    width: 3840, height: 2160, file_size: 123, fps: '30000/1001', duration: 12,
    camera_make: 'Nikon', camera_model: 'Z 8', lens_model: '24-70mm',
    video_codec: 'hevc', video_profile: 'Main 10', color_space: 'bt2020nc', pix_fmt: 'yuv420p10le',
    audio_codec: 'aac', audio_sample_rate: 48000, audio_channels: 2,
    picture_control: 'N-Log', date_taken: '2026-10-24 10:00:00', imported_at: '2026-10-24 11:00:00' };
  const value = state(media);
  assert(Array.isArray(value.metadataSections), 'expanded metadata groups are missing');
  const rows = value.metadataSections.flatMap(section => section.rows);
  const values = rows.map(row => row.value).join(' | ');
  for (const expected of ['3840 × 2160', '29.97 fps', 'Z 8', '24-70mm', 'Main 10', 'bt2020nc', 'N-Log', 'aac', '48 kHz', '2026-10-24 11:00:00']) assert(values.includes(expected), expected);
  assert.equal(JSON.stringify(media), JSON.stringify(value.media));
  value.media = { id: 2, media_type: 'image', file_name: 'empty.jpg', fps: '0/0', file_size: 0 };
  assert(!value.metadataSections.flatMap(section => section.rows).some(row => /NaN|undefined/.test(String(row.value))));
});

test('late label response cannot replace another selected medium or its loading state', async () => {
  const pending={};context.API._fetch=url=>new Promise((resolve,reject)=>pending[url]={resolve,reject});
  const value=state({id:1});const first=value.loadLabels();value.media={id:2};const second=value.loadLabels();
  pending['/api/taxonomy/media/1/labels'].resolve({data:[{id:10}]});await first;
  assert.equal(value.labels.length,0);assert.equal(value.labelsLoading,true);
  pending['/api/taxonomy/media/2/labels'].resolve({data:[{id:20,decisions:[]}]});await second;
  assert.equal(value.labels[0].id,20);assert.equal(value.labelsLoading,false);
  delete context.API._fetch;
});
test('manual-only inspector labels depend on explicit confirmation, not model source', () => {
  const value=state({id:1});value.labels=[{id:1,decisions:[{decision:'confirm'}]},{id:2,decisions:[]}];
  value.labelsManualOnly=true;assert.deepEqual(Array.from(value.visibleLabels,n=>n.id),[1]);
});

(async () => {
  let failed = 0;
  for (const {name,run} of tests) {
    try { await run(); console.log('PASS', name); }
    catch (error) { failed++; console.error('FAIL', name, error.message); }
  }
  console.log(`${tests.length - failed}/${tests.length} passed`);
  if (failed) process.exitCode = 1;
})();
