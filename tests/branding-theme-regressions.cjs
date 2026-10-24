const { chromium, _electron } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const net = require('net');

const root = path.resolve(__dirname, '..');
const fixture = JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE || '/tmp/video-analyzer-fix-browser.json', 'utf8'));
const output = path.join(root, 'build/luminisle-branding');
const name = '映屿 · luminisle';
const passed = [], errors = [];

async function chooseTheme(page, mode) {
  for (let i = 0; i < 3 && await page.evaluate(() => localStorage.getItem('theme')) !== mode; i++) {
    await page.locator('.app-toolbar').getByRole('button', { name: '主题', exact: true }).click();
  }
  assert.equal(await page.evaluate(() => localStorage.getItem('theme')), mode);
}

async function verifyBrand(page) {
  await page.locator('.media-card').first().waitFor();
  assert.equal(await page.title(), name);
  assert.equal(await page.locator('.app-wordmark').innerText(), name);
  assert.equal(await page.locator('.sidebar-footer-name').innerText(), name);
  assert(await page.locator('.app-wordmark img').evaluate(el => el.complete && el.naturalWidth === 256));
  assert.equal((await page.request.get(new URL(await page.locator('link[rel="icon"]').getAttribute('href'), fixture.url).href)).status(), 200);
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: 'light' });
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(fixture.url);
    await verifyBrand(page);
    passed.push('Browser title, wordmark, sidebar, favicon and new icon load');
    await chooseTheme(page, 'dark');
    await page.locator('body.body--dark').waitFor();
    const dark = await page.locator('body').evaluate(el => {
      const s = getComputedStyle(el);
      return { scheme: s.colorScheme, edge: s.getPropertyValue('--glass-edge').trim() };
    });
    assert.equal(dark.scheme, 'dark');
    assert.equal(await page.locator('html').getAttribute('data-appearance-theme'), 'jade');
    await page.screenshot({ path: path.join(output, 'browser-dark.png') });
    await chooseTheme(page, 'light');
    await page.locator('body.body--light').waitFor();
    assert.equal(await page.locator('body').evaluate(el => getComputedStyle(el).colorScheme), 'light');
    await chooseTheme(page, 'auto');
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.locator('body.body--dark').waitFor();
    await page.emulateMedia({ colorScheme: 'light' });
    await page.locator('body.body--light').waitFor();
    passed.push('Browser light/dark and live system-following mode');
    await page.setViewportSize({ width: 1000, height: 600 });
    const layout = await page.evaluate(() => {
      const brand = document.querySelector('.app-wordmark').getBoundingClientRect();
      const tools = document.querySelector('.app-tools').getBoundingClientRect();
      return { overflow: document.documentElement.scrollWidth > innerWidth, overlap: brand.right > tools.left };
    });
    assert.deepEqual(layout, { overflow: false, overlap: false });
    await page.locator('.app-toolbar').getByRole('button', { name: '设置', exact: true }).click();
    await page.locator('.settings-dialog').waitFor();
    await page.screenshot({ path: path.join(output, 'browser-settings-light.png') });
    await page.keyboard.press('Escape');
    await chooseTheme(page, 'dark');
    await page.goto(fixture.url + '/#/detail/' + fixture.image_ids[0]);
    await page.locator('.img-zoom-bar').waitFor();
    const mediaEdge = await page.locator('.img-zoom-bar').evaluate(el => getComputedStyle(el).borderTopColor);
    assert.equal(mediaEdge, 'rgba(255, 255, 255, 0.1)');
    await page.goto(fixture.url + '/#/workbench/' + fixture.project_id);
    await page.locator('.wb-container').waitFor();
    await page.screenshot({ path: path.join(output, 'browser-workbench-dark.png') });
    passed.push('Narrow header layout, settings, image controls and workbench');
  } finally { await browser.close(); }

  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'luminisle-desktop-test-'));
  let electron;
  try {
    const port = await new Promise(resolve => {
      const server = net.createServer().listen(0, '127.0.0.1', () => {
        const port = server.address().port; server.close(() => resolve(port));
      });
    });
    electron = await _electron.launch({
      executablePath: path.join(root, 'electron/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'),
      args: [path.join(root, 'electron')], timeout: 90000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '', MEDIA_MANAGER_PROFILE: path.join(scratch, 'profile'),
        MEDIA_MANAGER_HOME: path.join(scratch, 'library'), MEDIA_MANAGER_MODELS: path.join(scratch, 'models'),
        MEDIA_MANAGER_PYTHON: path.join(root, '.build-venv/bin/python'), MEDIA_MANAGER_SKIP_PRELOAD: '1',
        HF_HOME: path.join(scratch, 'hf'), HF_HUB_CACHE: path.join(scratch, 'hf/hub'), HF_HUB_OFFLINE: '1',
        MEDIA_MANAGER_PORT: String(port) }
    });
    const page = await electron.firstWindow({ timeout: 90000 });
    page.on('pageerror', e => errors.push(e.message));
    assert.match(await page.evaluate(() => navigator.userAgent), /Luminisle\//);
    assert(!/[^\x20-\x7e]/.test(await page.evaluate(() => navigator.userAgent)));
    await page.goto(fixture.url);
    await verifyBrand(page);
    const native = await electron.evaluate(({ app }) => ({ name: app.getName(), profile: app.getPath('userData') }));
    assert.equal(native.name, name);
    assert.equal(native.profile, path.join(scratch, 'profile'));
    // Simulate a light native window before selecting dark in the actual UI.
    await electron.evaluate(({ nativeTheme }) => { nativeTheme.themeSource = 'light'; });
    await chooseTheme(page, 'dark');
    await page.locator('body.body--dark').waitFor();
    async function assertNative(source) {
      for (let i = 0; i < 50; i++) {
        const state = await electron.evaluate(({ nativeTheme }) => ({ source: nativeTheme.themeSource, dark: nativeTheme.shouldUseDarkColors }));
        if (state.source === source) {
          if (source !== 'system') assert.equal(state.dark, source === 'dark');
          return;
        }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      assert.fail('Native window did not follow theme: ' + source);
    }
    await assertNative('dark');
    await page.screenshot({ path: path.join(output, 'electron-dark.png') });
    await page.reload();
    await page.locator('body.body--dark').waitFor();
    await assertNative('dark');
    await chooseTheme(page, 'light'); await assertNative('light');
    await page.screenshot({ path: path.join(output, 'electron-light.png') });
    await chooseTheme(page, 'auto'); await assertNative('system');
    const invalid = await page.evaluate(async () => {
      try { await window.electronAPI.setTheme('invalid'); return false; } catch { return true; }
    });
    assert(invalid);
    await assertNative('system');
    passed.push('Real Electron name and isolated profile; native dark/light/auto, persisted reload and invalid input');
  } finally {
    if (electron) await electron.close();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
  assert.deepEqual(errors, []);
  const result = { passed, errors, realUserDataTouched: false, paidAI: false };
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
