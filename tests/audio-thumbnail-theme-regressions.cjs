// Uses only the isolated UI fixture, including an actual legacy FFmpeg waveform JPEG.
const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const fixture = JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE || '/tmp/video-analyzer-fix-browser.json'));
assert(fixture.audio_id, 'Start browser_fixture.py with VIDEO_ANALYZER_UI_FIXTURE=1');
const output = path.resolve(__dirname, '../build/audio-thumbnail-theme');
const errors = [], writes = [], failures = [], expected404 = [], appearances = [];
async function colors(page, image, targets) {
  const png = await image.screenshot();
  return page.evaluate(async ({ png, targets }) => {
    const image = new Image(); image.src = 'data:image/png;base64,' + png; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    const pixels = ctx.getImageData(0, 0, image.width, image.height).data;
    return targets.map(hex => {
      const rgb = hex.replace('#', '').match(/../g).map(v => parseInt(v, 16)); let count = 0;
      for (let i = 0; i < pixels.length; i += 4) if (rgb.every((v, j) => Math.abs(pixels[i + j] - v) <= 12)) count++;
      return count;
    });
  }, { png: png.toString('base64'), targets });
}
async function state(page, values) {
  await page.evaluate(values => {
    const gallery = document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.$refs.gallery;
    Object.assign(gallery, values);
  }, values);
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    page.on('pageerror', e => errors.push(e.message));
    page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failures.push(new URL(r.url()).pathname); });
    page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
    page.on('console', m => {
      if (m.type() !== 'error') return;
      if (/\/media\/(cover|thumbnail)\/\d+$/.test(m.location().url) && m.text().includes('404')) expected404.push(new URL(m.location().url).pathname);
      else errors.push(m.text());
    });
    await page.goto(fixture.url);
    const audio = () => page.locator(`.gallery-page [data-id="${fixture.audio_id}"] img[data-stage]`);
    await audio().waitFor();
    await page.waitForFunction(id => document.querySelector(`[data-id="${id}"] img`)?.dataset.stage === 'waveform', fixture.audio_id);
    assert(await audio().evaluate(el => el.classList.contains('audio-waveform-thumb')));
    await audio().evaluate(el => el.style.filter = 'none');
    assert((await colors(page, audio(), ['#6c8cff']))[0] > 10, 'Fixture must reproduce the original blue waveform');
    await audio().evaluate(el => el.style.removeProperty('filter'));
    const before = await audio().boundingBox();
    for (const theme of ['jade', 'paper', 'study', 'porcelain']) for (const mode of ['light', 'dark']) {
      await page.locator('.appearance-trigger').click();
      const menu = page.locator('.appearance-menu'); await menu.waitFor();
      await menu.locator(`[data-theme-choice="${theme}"]`).click();
      await menu.locator(`[data-mode-choice="${mode}"]`).click();
      await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
      await page.waitForTimeout(240);
      const palette = await audio().evaluate(el => ['--accent', '--surface2'].map(k => getComputedStyle(el).getPropertyValue(k).trim()));
      const counts = await colors(page, audio(), palette);
      assert(counts[0] > 10 && counts[1] > 100, `${theme}/${mode}: waveform and background must use the actual theme colors`);
      assert.deepEqual(await audio().boundingBox(), before);
      appearances.push({ theme, mode, waveformPixels: counts[0], backgroundPixels: counts[1] });
    }
    assert.equal(await page.locator(`[data-id="${fixture.image_ids[0]}"] img`).evaluate(el => getComputedStyle(el).filter), 'none');
    await page.locator(`[data-id="${fixture.audio_id}"]`).click();
    const inspector = page.locator('.inspector-preview'); await inspector.waitFor();
    assert(await inspector.evaluate(el => el.classList.contains('audio-waveform-thumb')));
    assert((await colors(page, inspector, ['#a5c7f7']))[0] > 10);
    for (const viewMode of ['grid', 'masonry', 'justified', 'list']) for (const groupBy of ['', 'day']) {
      await state(page, { viewMode, sortBy: 'imported_at', groupBy });
      await audio().waitFor();
      assert(await audio().evaluate(el => getComputedStyle(el).filter.includes('audio-thumbnail-theme')), viewMode + '/' + groupBy);
    }
    await state(page, { viewMode: 'grid', groupBy: '' });
    // A real cover stays unfiltered, including after returning from waveform mode.
    const coverUrl = `**/media/cover/${fixture.audio_id}`;
    const cover = await (await page.request.get(`${fixture.url}/media/thumbnail/${fixture.image_ids[0]}`)).body();
    await page.route(coverUrl, route => route.fulfill({ status: 200, contentType: 'image/jpeg', body: cover }));
    await page.evaluate(() => {
      const gallery = document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.$refs.gallery;
      gallery.filters.media_type = 'audio'; gallery.setAdvDim({ displayOnly: true, param: 'thumbMode' }, 'cover');
    });
    await page.waitForFunction(id => document.querySelector(`[data-id="${id}"] img`)?.dataset.stage === 'cover', fixture.audio_id);
    assert.equal(await audio().evaluate(el => getComputedStyle(el).filter), 'none');
    await page.route(`**/media/thumbnail/${fixture.audio_id}`, route => route.fulfill({ status: 404, body: '' }));
    await page.unroute(coverUrl);
    await page.route(coverUrl, route => route.fulfill({ status: 404, body: '' }));
    await page.reload();
    await page.waitForFunction(id => document.querySelector(`[data-id="${id}"] img`)?.dataset.stage === 'none', fixture.audio_id);
    assert.equal(await audio().evaluate(el => getComputedStyle(el).filter), 'none');
    await page.unroute(`**/media/thumbnail/${fixture.audio_id}`);
    // Add audio only to the mocked project response, never to the fixture database.
    const audioData = await (await page.request.get(`${fixture.url}/api/library/${fixture.audio_id}`)).json();
    await page.route(`**/api/workbench/${fixture.project_id}`, async route => {
      const response = await route.fetch(); const project = await response.json();
      project.data.media.push(audioData); await route.fulfill({ response, json: project });
    });
    await page.goto(`${fixture.url}/#/workbench/${fixture.project_id}`);
    const material = page.locator(`.wb-mat-thumb[src="/media/thumbnail/${fixture.audio_id}"]`); await material.waitFor();
    assert(await material.evaluate(el => getComputedStyle(el).filter.includes('audio-thumbnail-theme')));
    assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(failures, []);
    const result = { appearances, galleryViews: 8, inspectorAndWorkbench: true, coversAndNonAudioUnfiltered: true, missingThumbnailFallback: true, errors, writes, failures, expected404, realDataTouched: false, paidAI: false };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
