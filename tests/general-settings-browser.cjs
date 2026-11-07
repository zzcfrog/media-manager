const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
const { chromium } = require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture = JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE || '/tmp/luminisle-recognition-settings-fixture.json'));
assert(fixture.scratch.includes('video-analyzer-tests-'));assert.equal(new URL(fixture.url).hostname, '127.0.0.1');
const output = path.resolve(process.env.GENERAL_SETTINGS_OUTPUT || 'build/general-model-directory-validation');
fs.mkdirSync(output, { recursive: true });
const result = { checks: [], errors: [], failed: [], writes: [], geometry: [] };
const root = (page, fn, data) => page.evaluate(({ fn, data }) => eval('(' + fn + ')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy, data), { fn: String(fn), data });
const settled = page => page.evaluate(() => Promise.all(document.getAnimations().filter(a => Number.isFinite(a.effect.getTiming().iterations)).map(a => a.finished.catch(() => {}))));
let browser, page;
(async () => {
  browser = await chromium.launch({ headless: true });
  const createPage = async desktop => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const p = await context.newPage();p.setDefaultTimeout(8000);
    if (desktop) await p.addInitScript(() => {
      const mock = window.directoryMock = {
        state: { path: '/synthetic/Models', activePath: '/synthetic/Models', locked: false, restartRequired: false, migrationSupported: true, liveApplySupported: true },
        nextPick: [], saves: [], options: [], failRead: false, failSave: false, holdRead: false, holdPick: false, holdSave: false, unsubscribed: 0,
      };
      window.electronAPI = {
        setTheme: async () => {},
        getModelDirectory: async () => {
          if (mock.failRead) throw new Error('Synthetic directory read failure');
          if (mock.holdRead) return new Promise(resolve => { mock.resolveRead = resolve; });
          return structuredClone(mock.state);
        },
        selectDirectory: async () => mock.holdPick ? new Promise(resolve => { mock.resolvePick = resolve; }) : mock.nextPick,
        saveModelDirectory: async (directory, options) => {
          mock.saves.push(directory);mock.options.push(structuredClone(options));
          if (mock.failSave) throw new Error('Synthetic directory save failure');
          if (mock.holdSave) await new Promise(resolve => { mock.resolveSave = resolve; });
          mock.state.path = directory;mock.state.activePath = directory;mock.state.restartRequired = false;
          return structuredClone(mock.state);
        },
        onModelDirectoryProgress: callback => { mock.progress = callback;return () => { mock.progress = null;mock.unsubscribed++; }; },
      };
    });
    p.on('pageerror', e => result.errors.push(e.message));
    p.on('requestfailed', r => { if (!r.failure().errorText.includes('ERR_ABORTED')) result.failed.push(new URL(r.url()).pathname); });
    p.on('request', r => { if (!['GET', 'HEAD', 'OPTIONS'].includes(r.method())) result.writes.push({ method: r.method(), path: new URL(r.url()).pathname }); });
    await p.goto(fixture.url + '/#/gallery');await p.waitForLoadState('networkidle');return p;
  };
  const open = async () => {
    await root(page, r => r.openRecognitionSettings('general'));
    await page.locator('.settings-dialog').waitFor();
    await page.waitForFunction(() => { const r = document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return r.settingsLoaded && !Object.values(r.recognitionLoading).some(Boolean); });
    await settled(page);
  };
  const close = async () => { await page.locator('.settings-dialog').getByRole('button', { name: /^(取消|Cancel)$/ }).click();await page.locator('.settings-dialog').waitFor({ state: 'hidden' }); };
  const confirm = () => page.locator('.settings-dialog').getByRole('button', { name: /^(确定|OK)$/ }).click();
  const choose = () => page.getByRole('button', { name: /^(选择大模型目录|Choose model directory)$/ }).click();
  const field = () => page.getByRole('textbox', { name: /^(大模型目录|Model directory)$/ });
  const migration = () => page.getByRole('checkbox', { name: /^(同时迁移现有模型|Migrate existing models too)$/ });
  const check = async (name, fn) => { await fn();result.checks.push(name); };
  page = await createPage(false);
  await check('Browser-only General keeps four sections and explains the desktop-only directory control without writes', async () => {
    await open();assert.deepEqual(await page.locator('.general-settings .settings-group-heading h3').allTextContents(), ['语言', '主题风格', '外观模式', '大模型目录']);
    assert(await field().isDisabled());assert(await page.getByText('请在桌面应用中设置大模型目录', { exact: true }).isVisible());
    await confirm();await page.locator('.settings-dialog').waitFor({ state: 'hidden' });assert.equal(result.writes.length, 0);
  });
  await page.context().close();page = await createPage(true);
  await check('Choosing a directory is a cross-tab draft; native-picker cancellation and Settings cancellation write nothing', async () => {
    await open();assert.equal(await field().inputValue(), '/synthetic/Models');
    assert.equal(await migration().count(), 1);assert(await migration().isDisabled());
    assert(await page.getByText('先选择新的空目录', { exact: true }).isVisible());
    await choose();assert.equal(await field().inputValue(), '/synthetic/Models');
    await page.evaluate(() => { directoryMock.nextPick = ['/synthetic/Chosen Models']; });await choose();
    assert.equal(await field().inputValue(), '/synthetic/Chosen Models');
    assert.equal(await migration().isChecked(), false);
    await page.getByRole('tab', { name: '图片分析', exact: true }).click();await page.getByRole('tab', { name: '通用', exact: true }).click();
    assert.equal(await field().inputValue(), '/synthetic/Chosen Models');await close();
    assert.equal(await page.evaluate(() => directoryMock.saves.length), 0);assert.equal(result.writes.length, 0);
    await open();assert.equal(await field().inputValue(), '/synthetic/Models');
  });
  await check('Confirm applies the changed desktop path during this run and reopening requires no restart', async () => {
    await choose();await confirm();await page.locator('.settings-dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => directoryMock.saves), ['/synthetic/Chosen Models']);assert.equal(result.writes.length, 0);
    assert.deepEqual(await page.evaluate(() => directoryMock.options), [{ migrate: false }]);
    await open();assert.equal(await field().inputValue(), '/synthetic/Chosen Models');
    assert.equal(await page.evaluate(() => directoryMock.state.activePath), '/synthetic/Chosen Models');
    assert.equal(await page.evaluate(() => directoryMock.state.restartRequired), false);assert(await migration().isDisabled());
  });
  await check('Save failure keeps the dialog and draft; retry preserves already-saved general settings', async () => {
    await page.evaluate(() => { directoryMock.nextPick = ['/synthetic/Retry Models'];directoryMock.failSave = true; });await choose();
    await root(page, r => { r.settingsForm.resolution = r.settingsForm.resolution === '720' ? '480' : '720'; });
    const start = result.writes.length;await confirm();await page.locator('.settings-save-error').filter({ hasText: 'Synthetic directory save failure' }).waitFor();
    assert.equal(await field().inputValue(), '/synthetic/Retry Models');assert.equal(result.writes.slice(start).filter(w => w.path === '/api/settings/').length, 1);
    assert((await page.locator('.settings-save-error').innerText()).includes('已保存'));
    await page.evaluate(() => { directoryMock.failSave = false; });await confirm();await page.locator('.settings-dialog').waitFor({ state: 'hidden' });
    assert.equal(result.writes.slice(start).filter(w => w.path === '/api/settings/').length, 1);
    assert.equal(await page.evaluate(() => directoryMock.state.path), '/synthetic/Retry Models');
  });
  await check('A failed directory read disables only that control and can be recovered by reopening', async () => {
    await page.evaluate(() => { directoryMock.failRead = true; });await open();
    assert(await field().isDisabled());assert(await page.getByRole('alert').filter({ hasText: 'Synthetic directory read failure' }).isVisible());
    const saved = await page.evaluate(() => directoryMock.saves.length);await confirm();await page.locator('.settings-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => directoryMock.saves.length), saved);
    await page.evaluate(() => { directoryMock.failRead = false; });await open();assert.equal(await field().inputValue(), '/synthetic/Retry Models');await close();
  });
  await check('Late read and native-picker results cannot overwrite a newly opened settings session', async () => {
    await page.evaluate(() => { directoryMock.holdRead = true; });await root(page, r => r.openRecognitionSettings('general'));
    await page.waitForFunction(() => !!directoryMock.resolveRead);await close();
    await page.evaluate(() => { directoryMock.holdRead = false; });await open();
    await page.evaluate(() => directoryMock.resolveRead({ ...directoryMock.state, path: '/synthetic/Stale' }));
    assert.equal(await field().inputValue(), '/synthetic/Retry Models');
    await page.evaluate(() => { directoryMock.holdPick = true; });await choose();await page.waitForFunction(() => !!directoryMock.resolvePick);
    assert(await page.locator('.settings-dialog').getByRole('button', { name: '确定', exact: true }).isDisabled());await close();
    await page.evaluate(() => { directoryMock.holdPick = false; });await open();
    await page.evaluate(() => directoryMock.resolvePick(['/synthetic/Stale Choice']));assert.equal(await field().inputValue(), '/synthetic/Retry Models');
  });
  await check('Environment-controlled roots are visibly locked without writes', async () => {
    await close();await page.evaluate(() => { directoryMock.state.locked = true; });await open();
    assert(await field().isDisabled());assert(await page.getByText('目录由环境变量 MEDIA_MANAGER_MODELS 指定。', { exact: true }).isVisible());
    await close();await page.evaluate(() => { directoryMock.state.locked = false; });await open();
  });
  await check('Four titles match exactly; theme and appearance have no divider across four themes and both modes', async () => {
    for (const width of [1000, 1440]) for (const theme of ['jade', 'paper', 'study', 'porcelain']) for (const mode of ['light', 'dark']) {
      await page.setViewportSize({ width, height: width === 1000 ? 600 : 900 });await root(page, (r, v) => { r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode); }, { theme, mode });await settled(page);
      const metrics = await page.locator('.general-settings').evaluate(panel => {
        const headings = [...panel.querySelectorAll('.settings-group-heading h3')].map(node => { const s = getComputedStyle(node);return { fontFamily: s.fontFamily, fontSize: s.fontSize, fontWeight: s.fontWeight, lineHeight: s.lineHeight, color: s.color }; });
        const mode = getComputedStyle(panel.querySelector('.appearance-picker .settings-group:last-child'));
        const bounds = panel.parentElement.getBoundingClientRect();
        return { headings, divider: mode.borderTopWidth, width: panel.clientWidth, contentWidth: panel.scrollWidth,
          directoryBottom: panel.querySelector('.general-model-directory').getBoundingClientRect().bottom, panelBottom: bounds.bottom };
      });
      assert.equal(metrics.headings.length, 4);for (const heading of metrics.headings) assert.deepEqual(heading, metrics.headings[0]);
      assert.equal(metrics.divider, '0px');assert(metrics.contentWidth <= metrics.width + 1);
      if (width === 1440) assert(metrics.directoryBottom <= metrics.panelBottom, 'All four sections should be visible at the normal desktop size');
      result.geometry.push({ width, theme, mode, ...metrics });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    for (const mode of ['light', 'dark']) {
      await root(page, (r, mode) => { r.setAppearanceTheme('jade');r.setThemeMode(mode); }, mode);await settled(page);
      await page.locator('.general-settings').evaluate(panel => { panel.parentElement.scrollTop = 0;panel.scrollTop = 0; });
      await page.locator('.settings-dialog').screenshot({ path: path.join(output, 'general-' + mode + '.png') });
    }
    await root(page, r => { r.settingsForm.language = 'en';r.onLanguageChange('en'); });
    assert.equal(await page.getByRole('button', { name: 'Choose model directory', exact: true }).count(), 1);
    await page.locator('.settings-dialog').screenshot({ path: path.join(output, 'general-english.png') });await close();
  });
  await check('Path-only changes show a loading state until activation and refresh the current model catalog', async () => {
    await open();await page.evaluate(() => { directoryMock.nextPick = ['/synthetic/Live Root'];directoryMock.holdSave = true; });await choose();
    await root(page, r => { r.localModels = [{ id: 'stale-catalog', label: 'stale' }]; });await confirm();await page.waitForFunction(() => !!directoryMock.resolveSave);
    const status = page.locator('.settings-model-migration-progress');assert(await status.isVisible());
    await page.evaluate(() => directoryMock.progress({ phase: 'activating', doneBytes: 0, totalBytes: 0 }));await settled(page);
    assert((await status.innerText()).includes('正在应用新目录'));assert(!(await status.innerText()).includes('%'));
    await page.evaluate(() => { directoryMock.holdSave = false;directoryMock.resolveSave(); });await page.locator('.settings-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => directoryMock.state.activePath), '/synthetic/Live Root');
    assert.deepEqual(await root(page, r => r.localModels), []);
  });
  await check('Migration requires explicit opt-in, persists across tabs, resets on a different choice and is discarded on Cancel', async () => {
    await open();assert.equal(await migration().isChecked(), false);const before = await page.evaluate(() => directoryMock.saves.length);
    await page.evaluate(() => { directoryMock.nextPick = ['/synthetic/Migration Draft']; });await choose();
    await migration().check();assert(await page.getByText('复制并校验到空目录，保留原文件；完成后立即使用新目录。', { exact: true }).isVisible());
    await page.getByRole('tab', { name: '图片分析', exact: true }).click();await page.getByRole('tab', { name: '通用', exact: true }).click();
    assert(await migration().isChecked());
    await page.evaluate(() => { directoryMock.nextPick = ['/synthetic/Migrated Models']; });await choose();assert.equal(await migration().isChecked(), false);
    await migration().check();await close();assert.equal(await page.evaluate(() => directoryMock.saves.length), before);
    await open();assert.equal(await migration().isChecked(), false);await choose();await migration().check();
    await page.locator('.settings-dialog').screenshot({ path: path.join(output, 'migration-option.png') });
  });
  await check('Migration shows copy and verification progress while settings are protected, then unsubscribes after success', async () => {
    await page.evaluate(() => { directoryMock.holdSave = true; });const unsubscribed = await page.evaluate(() => directoryMock.unsubscribed);
    await confirm();await page.waitForFunction(() => !!directoryMock.resolveSave);
    const status = page.locator('.settings-model-migration-progress');assert(await status.isVisible());
    assert(await page.locator('.settings-dialog').getByRole('button', { name: '取消', exact: true }).isDisabled());
    await page.evaluate(() => directoryMock.progress({ phase: 'copying', doneBytes: 5, totalBytes: 10 }));
    await settled(page);
    assert((await status.innerText()).includes('25%'));assert((await status.innerText()).includes('正在复制现有模型'));
    const progressbar = status.getByRole('progressbar');
    assert.equal(Number(await progressbar.getAttribute('aria-valuenow')) / Number(await progressbar.getAttribute('aria-valuemax')), .25);
    await page.locator('.settings-dialog').screenshot({ path: path.join(output, 'migration-copying.png') });
    await page.evaluate(() => directoryMock.progress({ phase: 'verifying', doneBytes: 5, totalBytes: 10 }));
    await settled(page);
    assert((await status.innerText()).includes('75%'));assert((await status.innerText()).includes('正在校验模型副本'));
    assert.deepEqual(await page.evaluate(() => directoryMock.options.at(-1)), { migrate: true });
    assert.notEqual(await page.evaluate(() => directoryMock.state.path), '/synthetic/Migrated Models');
    await page.evaluate(() => { directoryMock.holdSave = false;directoryMock.resolveSave(); });await page.locator('.settings-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => directoryMock.state.path), '/synthetic/Migrated Models');
    assert.equal(await page.evaluate(() => directoryMock.unsubscribed), unsubscribed + 1);
    assert.equal(await page.evaluate(() => directoryMock.progress), null);
  });
  await check('Migration failures retain the path and opt-in draft, release progress, and permit explicit retry', async () => {
    await open();await page.evaluate(() => { directoryMock.nextPick = ['/synthetic/Retry Migration'];directoryMock.failSave = true; });await choose();await migration().check();
    await confirm();await page.locator('.settings-save-error').filter({ hasText: 'Synthetic directory save failure' }).waitFor();
    assert.equal(await field().inputValue(), '/synthetic/Retry Migration');assert(await migration().isChecked());
    assert.equal(await page.locator('.settings-model-migration-progress').count(), 0);assert.equal(await page.evaluate(() => directoryMock.progress), null);
    await page.evaluate(() => { directoryMock.failSave = false; });await confirm();await page.locator('.settings-dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await page.evaluate(() => directoryMock.options.slice(-2)), [{ migrate: true }, { migrate: true }]);
  });
  await check('A previously saved pending folder applies without selecting it again; old bridges disable migration safely', async () => {
    await page.evaluate(() => { directoryMock.state.path = '/synthetic/Pending Models';directoryMock.state.restartRequired = true; });
    await open();assert.equal(await field().inputValue(), '/synthetic/Pending Models');
    const before = await page.evaluate(() => directoryMock.saves.length);await confirm();await page.locator('.settings-dialog').waitFor({ state: 'hidden' });
    assert.equal(await page.evaluate(() => directoryMock.saves.length), before + 1);
    assert.equal(await page.evaluate(() => directoryMock.state.activePath), '/synthetic/Pending Models');
    await page.evaluate(() => { directoryMock.state.migrationSupported = false; });await open();
    await page.evaluate(() => { directoryMock.nextPick = ['/synthetic/Legacy Target']; });await choose();assert(await migration().isDisabled());await close();
  });
  await check('A legacy bridge cannot save a path while falsely claiming immediate activation', async () => {
    await page.evaluate(() => { directoryMock.state.liveApplySupported = false; });await open();
    await page.evaluate(() => { directoryMock.nextPick = ['/synthetic/Unsupported Live Apply']; });await choose();
    const before = await page.evaluate(() => directoryMock.saves.length);await confirm();
    await page.locator('.settings-save-error').filter({ hasText: '请更新并重新打开桌面应用' }).waitFor();
    assert.equal(await page.evaluate(() => directoryMock.saves.length), before);await close();
  });
  await check('Older desktop bridges preserve General settings and explain directory support', async () => {
    await page.evaluate(() => { delete window.electronAPI.getModelDirectory; });await open();
    assert(await field().isDisabled());await close();
  });
  assert.deepEqual(result.errors, []);assert.deepEqual(result.failed, []);
  console.log('PASS ' + result.checks.length + ' General settings browser groups; four themes × light/dark × two widths; no page errors or failed requests');
})().catch(async error => {
  result.failure = error.stack;console.error(error.stack);
  if (page) await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});process.exitCode = 1;
}).finally(async () => {
  fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(result, null, 2));if (browser) await browser.close();
});
