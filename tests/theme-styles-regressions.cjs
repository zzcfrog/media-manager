const { chromium } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE || '/tmp/video-analyzer-fix-browser.json'));
const output = path.join(root, 'build/theme-styles');
const themes = ['jade', 'paper', 'study', 'porcelain'];
const errors = [], writes = [], failures = [], consoleErrors = [], expectedConsoleErrors = [], passed = [];
let expectingServerError = false;
const selectors = ['.app-toolbar', '.app-wordmark', '.app-tools', '.app-sidebar', '.library-workspace', '.filter-bar', '.library-body', '.gallery-page', '.media-card', '.media-inspector'];
async function geometry(page, items = selectors) {
  return page.evaluate(items => Object.fromEntries(items.map(s => {
    const el = document.querySelector(s), r = el?.getBoundingClientRect();
    return [s, r ? [r.x, r.y, r.width, r.height].map(v => Math.round(v * 10) / 10) : null];
  })), items);
}
async function openPicker(page) {
  if (await page.locator('.appearance-trigger').getAttribute('aria-expanded') !== 'true') await page.locator('.appearance-trigger').click();
  await page.locator('.appearance-menu').waitFor();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('.appearance-menu')).opacity === '1');
}
async function choose(page, theme, mode) {
  await openPicker(page);
  const menu = page.locator('.appearance-menu');
  await menu.locator(`[data-theme-choice="${theme}"]`).click();
  if (mode) await menu.locator(`[data-mode-choice="${mode}"]`).click();
  await page.waitForFunction(({ theme, mode }) => document.documentElement.dataset.appearanceTheme === theme && (!mode || localStorage.getItem('theme') === mode), { theme, mode });
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'hidden' });
  // Wait for the existing 200 ms material/Quasar transitions to paint before capture.
  await page.waitForTimeout(220);
}
function contrast(a, b) {
  const luminance = hex => {
    const rgb = hex.replace('#', '').match(/../g).map(v => parseInt(v, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
    return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2];
  };
  const x = luminance(a), y = luminance(b);
  return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}
(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' });
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') {
      if (/\/media\/cover\/\d+$/.test(m.location().url) && m.text().includes('404')) { expectedConsoleErrors.push('Missing synthetic audio cover; thumbnail fallback'); return; }
      if (expectingServerError && m.text().includes('500')) expectedConsoleErrors.push(m.text());
      else consoleErrors.push(m.text());
    } });
    page.on('requestfailed', r => { if (!r.failure()?.errorText.includes('ERR_ABORTED')) failures.push(r.url()); });
    page.on('request', r => { if (!['GET', 'HEAD'].includes(r.method())) writes.push(r.method() + ' ' + new URL(r.url()).pathname); });
    await page.goto(fixture.url);
    await page.locator('.media-card').first().waitFor();
    await page.evaluate(() => document.fonts.ready);
    // Preserve the old brightness preference while retiring the old accent-only setting.
    await page.evaluate(() => { localStorage.setItem('theme', 'dark'); localStorage.setItem('accent', '#ff00ff'); localStorage.removeItem('appearanceTheme'); });
    await page.reload(); await page.locator('.media-card').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('data-appearance-theme'), 'jade');
    assert.equal(await page.locator('html').getAttribute('data-appearance-mode'), 'dark');
    passed.push('Existing dark preference retained; legacy accent cannot override the complete theme');
    // Disabling only the new paint sheet gives the previous workspace geometry.
    await page.evaluate(() => document.querySelector('link[href*="themes.css"]').disabled = true);
    const baseline = await geometry(page);
    await page.evaluate(() => document.querySelector('link[href*="themes.css"]').disabled = false);
    const paletteResults = [];
    for (const theme of themes) for (const mode of ['light', 'dark']) {
      await choose(page, theme, mode);
      assert.deepEqual(await geometry(page), baseline, theme + '/' + mode + ' moved existing UI');
      assert.equal(await page.locator('html').getAttribute('data-appearance-theme'), theme);
      assert.equal(await page.locator('html').getAttribute('data-appearance-mode'), mode);
      assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).colorScheme), mode);
      const palette = await page.locator('body').evaluate(el => {
        const css = getComputedStyle(el);
        return Object.fromEntries(['bg', 'text', 'text2', 'text3', 'accent', 'on-accent', 'material-grain', 'material-filter'].map(k => [k, css.getPropertyValue('--' + k).trim()]));
      });
      for (const ink of ['text', 'text2', 'text3']) assert(contrast(palette[ink], palette.bg) >= 4.5, `${theme}/${mode} ${ink} contrast`);
      assert(contrast(palette['on-accent'], palette.accent) >= 4.5, `${theme}/${mode} selected control contrast`);
      paletteResults.push({ theme, mode, palette });
      await page.screenshot({ path: path.join(output, `${theme}-${mode}.png`) });
    }
    assert.equal(new Set(paletteResults.map(r => r.palette.bg)).size, 8);
    passed.push('All eight appearances change materials, maintain text contrast and exactly preserve existing workspace geometry');
    await choose(page, 'paper', 'dark');
    await choose(page, 'study');
    assert.equal(await page.evaluate(() => localStorage.getItem('theme')), 'dark');
    await page.reload(); await page.locator('.media-card').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('data-appearance-theme'), 'study');
    assert.equal(await page.locator('html').getAttribute('data-appearance-mode'), 'dark');
    await choose(page, 'study', 'auto');
    await page.emulateMedia({ colorScheme: 'dark' }); await page.locator('body.body--dark').waitFor();
    await page.emulateMedia({ colorScheme: 'light' }); await page.locator('body.body--light').waitFor();
    assert.equal(await page.locator('html').getAttribute('data-appearance-mode'), 'light');
    assert.equal(await page.locator('html').getAttribute('data-appearance-theme'), 'study');
    passed.push('Style and appearance persist independently; live system appearance keeps selected style');
    await choose(page, 'jade', 'dark');
    const card = page.locator('.media-card').first(); await card.click();
    await openPicker(page);
    const menu = page.locator('.appearance-menu');
    await menu.locator('[data-theme-choice="paper"]').focus(); await page.keyboard.press('Enter');
    assert.equal(await menu.locator('[data-theme-choice="paper"]').getAttribute('aria-pressed'), 'true');
    assert(await card.evaluate(el => el.classList.contains('selected')));
    await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
    assert(await card.evaluate(el => el.classList.contains('selected')), 'Escape in appearance must preserve gallery selection');
    assert(await page.locator('.appearance-trigger').evaluate(el => el.contains(document.activeElement)));
    await openPicker(page); await page.locator('.app-section-title').click(); await menu.waitFor({ state: 'hidden' });
    passed.push('Keyboard selection, Escape/outside dismissal and focus return preserve gallery selection');
    for (const size of [{ width: 1000, height: 600 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(size); await openPicker(page);
      const bounds = await menu.boundingBox();
      assert(bounds.x >= 0 && bounds.y >= 0 && bounds.x + bounds.width <= size.width && bounds.y + bounds.height <= size.height);
      await menu.locator('[data-mode-choice="auto"]').scrollIntoViewIfNeeded();
      await page.keyboard.press('Escape');
    }
    await page.locator('.app-toolbar').getByRole('button', { name: '设置', exact: true }).click();
    const settings = page.locator('.settings-dialog'); await settings.waitFor();
    await settings.locator('[data-theme-choice="porcelain"]').click();
    await settings.locator('[data-mode-choice="light"]').click();
    assert.equal(await page.locator('html').getAttribute('data-appearance-theme'), 'porcelain');
    await page.keyboard.press('Escape'); await settings.waitFor({ state: 'hidden' });
    await openPicker(page); assert.equal(await menu.locator('[data-theme-choice="porcelain"]').getAttribute('aria-pressed'), 'true');
    await page.evaluate(() => { i18nState.locale = 'en'; });
    assert.equal(await menu.locator('h2').innerText(), 'Appearance');
    assert.equal(await menu.locator('[data-theme-choice="porcelain"]').getAttribute('aria-label'), 'Moonlit Porcelain');
    await page.evaluate(() => { i18nState.locale = 'zh'; }); await page.keyboard.press('Escape');
    passed.push('Narrow-window popup fits; settings and toolbar stay synchronized; English labels available');
    await choose(page, 'jade', 'dark'); await openPicker(page);
    await page.screenshot({ path: path.join(output, 'appearance-popover.png') });
    await menu.screenshot({ path: path.join(output, 'appearance-panel.png') }); await page.keyboard.press('Escape');
    for (const route of [`#/detail/${fixture.image_ids[0]}`, `#/workbench/${fixture.project_id}`]) {
      await page.goto(fixture.url + '/' + route);
      const workspace = route.includes('workbench') ? '.wb-container' : '.detail-workspace';
      await page.locator(workspace).waitFor();
      const before = await geometry(page, [workspace, '.app-sidebar', '.app-toolbar']);
      for (const theme of themes) {
        await choose(page, theme, 'light');
        assert.deepEqual(await geometry(page, [workspace, '.app-sidebar', '.app-toolbar']), before);
      }
    }
    passed.push('Image detail and project workbench retain layout across every theme');
    const libraryRequest = url => url.pathname === '/api/library/';
    expectingServerError = true;
    await page.route(libraryRequest, route => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"synthetic failure"}' }));
    await page.goto(fixture.url);
    await page.getByText('素材加载失败，请重试', { exact: true }).waitFor();
    await choose(page, 'paper', 'dark');
    await page.getByText('素材加载失败，请重试', { exact: true }).waitFor();
    await page.unroute(libraryRequest);
    await page.route(libraryRequest, route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"data":[],"pagination":{"total":0}}' }));
    expectingServerError = false;
    await page.getByRole('button', { name: '重试', exact: true }).click();
    await page.getByText('暂无素材，点击左上角"导入"添加', { exact: true }).waitFor();
    await choose(page, 'porcelain', 'light');
    await page.unroute(libraryRequest);
    await page.evaluate(() => { localStorage.setItem('appearanceTheme', 'missing-theme'); localStorage.setItem('theme', 'invalid-mode'); });
    await page.reload(); await page.locator('.media-card').first().waitFor();
    assert.equal(await page.locator('html').getAttribute('data-appearance-theme'), 'jade');
    assert.equal(await page.evaluate(() => localStorage.getItem('theme')), 'auto');
    passed.push('Error/retry and empty library remain usable; invalid stored preferences recover to Jade/system');
    assert.deepEqual(errors, []); assert.deepEqual(writes, []); assert.deepEqual(failures, []); assert.deepEqual(consoleErrors, []);
    const result = { passed, errors, writes, failures, consoleErrors, expectedConsoleErrors, appearances: paletteResults.map(({ theme, mode }) => ({ theme, mode })), realDataTouched: false, paidAI: false };
    fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
    console.log(JSON.stringify(result, null, 2));
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
