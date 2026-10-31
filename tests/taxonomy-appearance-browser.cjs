// Real Chromium against the explicitly isolated acceptance fixture; no model calls.
const fs = require('fs'), path = require('path'), assert = require('assert');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || '/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixturePath = process.env.VIDEO_ANALYZER_TEST_FIXTURE || '/tmp/luminisle-taxonomy-acceptance-fixture.json';
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
assert(new URL(fixture.url).hostname === '127.0.0.1' && fixture.scratch.includes('video-analyzer-tests-'));
const output = path.resolve('build/taxonomy-appearance-validation');
fs.mkdirSync(output, {recursive: true});
const rootCode = "document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy";
const report = {fixture: {url: fixture.url, synthetic: true}, viewport: {width: 1000, height: 650},
  checks: [], pageErrors: [], consoleErrors: [], failedRequests: [], httpErrors: [], labelRequests: [], screenshots: []};
let phase = 'normal', page;
const save = () => fs.writeFileSync(path.join(output, 'results.json'), JSON.stringify(report, null, 2) + '\n');

(async () => {
  const browser = await chromium.launch({headless: process.env.HEADLESS !== 'false'});
  const context = await browser.newContext({viewport: report.viewport, locale: 'zh-CN'});
  await context.addInitScript(() => {localStorage.setItem('libraryInspector', 'false');localStorage.removeItem('galleryFilters');});
  page = await context.newPage();page.setDefaultTimeout(12000);
  page.on('pageerror', e => report.pageErrors.push({phase, message: e.message}));
  page.on('console', m => {if (m.type() === 'error') report.consoleErrors.push({phase, message: m.text()});});
  page.on('requestfailed', r => report.failedRequests.push({phase, path: new URL(r.url()).pathname, error: r.failure()?.errorText}));
  page.on('response', r => {if (r.status() >= 400) report.httpErrors.push({phase, path: new URL(r.url()).pathname, status: r.status()});});
  page.on('request', r => {if (/\/api\/taxonomy\/media\/\d+\/labels$/.test(new URL(r.url()).pathname)) report.labelRequests.push({phase, path: new URL(r.url()).pathname});});
  async function shot(name) {const filename = name.replace(/[^a-zA-Z0-9_-]/g, '-') + '.png';await page.screenshot({path: path.join(output, filename)});report.screenshots.push(filename);}
  async function check(name, fn) {
    const started = Date.now();
    try {const evidence = await fn();report.checks.push({name, passed: true, milliseconds: Date.now() - started, evidence});console.log('PASS ' + name);}
    catch (error) {report.checks.push({name, passed: false, milliseconds: Date.now() - started, error: error.message});console.log('FAIL ' + name + ': ' + error.message);await shot('failure-' + report.checks.length).catch(() => {});}
    save();
  }
  async function root(fn, data) {return page.evaluate(({code, source, data}) => {const r = eval(code);return eval('(' + source + ')')(r, data);}, {code: rootCode, source: fn.toString(), data});}
  async function route(hash) {
    await root((r, hash) => r.nav(hash), hash);
    await page.waitForFunction(hash => location.hash === hash, hash);
    if (hash.startsWith('#/classify') || hash === '#/gallery' || hash === '#/favorites') {
      await page.locator('.library-workspace').waitFor();
      await page.waitForFunction(code => {const g = eval(code).$refs.gallery;return g && !g.loading;}, rootCode);
    } else if (hash.startsWith('#/taxonomy')) await page.locator('.taxonomy-page').waitFor();
    await page.waitForLoadState('networkidle');
  }
  async function api(url, data, method = 'POST') {
    const response = await page.request.fetch(fixture.url + url, {method, data});
    assert(response.ok(), method + ' ' + url + ' ' + response.status() + ' ' + await response.text());
    return response.json();
  }
  async function badge(scope = page) {
    const locator = scope.locator('.tag-status:visible,.tag-status-inline:visible').first();
    await locator.waitFor();assert.match(await locator.getAttribute('aria-label'), /(?:已添加 \d+ 个标签|\d+ tags added)/);
    assert.equal(await locator.getAttribute('tabindex'), '0');
    await locator.focus();assert(await locator.evaluate(el => document.activeElement === el));
    return {aria: await locator.getAttribute('aria-label'), keyboardFocusable: true};
  }
  try {
    await page.goto(fixture.url + '/#/gallery');await page.waitForLoadState('networkidle');
    const mids = [fixture.media_id, fixture.avi_id, ...fixture.image_ids].filter(Boolean);
    for (const mid of mids) {
      const response = await page.request.get(fixture.url + '/api/library/' + mid);assert(response.ok());
      assert((await response.json()).file_path.startsWith(fixture.scratch + path.sep), 'Fixture source must remain isolated');
    }
    const unique = 'Appearance-' + Date.now();
    const parent = await api('/api/taxonomy/nodes', {name: unique});
    const child = await api('/api/taxonomy/nodes', {name: unique + '-山水', parent_id: parent.id, definition: 'Synthetic UI appearance verification'});
    const empty = await api('/api/taxonomy/nodes', {name: unique + '-empty'});
    report.syntheticTagIds = [parent.id, child.id, empty.id];
    await api('/api/taxonomy/decisions', {media_ids: mids, tag_id: child.id, decision: 'confirm'});
    await api('/api/library/' + fixture.image_ids[0], {favorite: 1}, 'PATCH');
    await root(r => r.reloadTaxonomy());
    const geometry = {};
    for (const theme of ['jade', 'paper', 'study', 'porcelain']) {
      for (const mode of ['light', 'dark']) {
        for (const view of ['classify', 'taxonomy']) {
          await check(`${theme}/${mode}/${view}: compact unchanged layout at 1000x650`, async () => {
            await route('#/' + view + '/' + child.id);
            await root((r, value) => {r.drawerMini = false;r.setAppearanceTheme(value.theme);r.setThemeMode(value.mode);}, {theme, mode});
            await page.waitForFunction(({theme, mode}) => document.documentElement.dataset.appearanceTheme === theme && document.documentElement.dataset.appearanceMode === mode, {theme, mode});
            if (view === 'classify') await page.locator('.media-card').first().waitFor();
            else await page.getByLabel('标准名称', {exact: true}).waitFor();
            const state = await page.evaluate(view => {
              const rect = selector => {const e = document.querySelector(selector);if (!e) return null;const r = e.getBoundingClientRect();return [r.x, r.y, r.width, r.height].map(Math.round);};
              const panel = view === 'classify' ? '.library-workspace' : '.taxonomy-page';
              return {width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth,
                sidebar: rect('.app-sidebar'), header: rect('.app-header'), main: rect(panel),
                sidebarTrees: [...document.querySelectorAll('.taxonomy-sidebar-tree')].filter(e => e.getBoundingClientRect().height > 0).length,
                mainTrees: document.querySelector(panel).querySelectorAll('.q-tree').length,
                border: getComputedStyle(document.documentElement).getPropertyValue('--border').trim(),
                pageBackground: getComputedStyle(document.body).backgroundColor};
            }, view);
            assert.equal(state.overflow, false, JSON.stringify(state));assert.equal(state.mainTrees, 0, 'No second tree in main panel');
            assert.equal(state.sidebarTrees, view==='classify'?1:0, 'Only classification renders a sidebar tree');
            if (geometry[view]) for (const key of ['sidebar', 'header', 'main']) assert.deepEqual(state[key], geometry[view][key], 'Theme must preserve ' + key + ' geometry');
            else geometry[view] = state;
            if (view === 'classify') await badge();
            await shot(`${theme}-${mode}-${view}`);return state;
          });
        }
      }
    }
    for (const view of ['classify', 'taxonomy']) await check('collapsed sidebar ' + view + ' tree popover', async () => {
      await route('#/' + view + '/' + child.id);await root(r => {r.drawerMini = true;});
      await page.getByLabel(view === 'classify' ? '智能分类' : '标签树维护', {exact: true}).click();
      if(view==='taxonomy'){
        await page.locator('.taxonomy-page').waitFor();assert.equal(await page.locator('.taxonomy-mini-tree:visible').count(),0);
        await shot('collapsed-taxonomy');await root(r=>{r.drawerMini=false;});return {directMaintenance:true};
      }
      const popup = page.locator('.taxonomy-mini-tree');await popup.waitFor();
      const box = await popup.boundingBox();assert(box.x >= 0 && box.x + box.width <= 1001, JSON.stringify(box));
      await popup.getByText(unique + '-山水', {exact: true}).click();
      await page.keyboard.press('Escape');assert.equal(await root(r => r.taxonomySelected), child.id);
      await shot('collapsed-' + view);await root(r => {r.drawerMini = false;});return {selected: child.id, popover: box};
    });
    await route('#/classify/' + child.id);
    for (const viewMode of ['grid', 'masonry', 'justified', 'list']) for (const grouped of [false, true]) await check('badge ' + viewMode + (grouped ? ' grouped' : ' plain'), async () => {
      await root((r, data) => {const g = r.$refs.gallery;g.viewMode = data.viewMode;g.sortBy = 'imported_at';g.groupBy = data.grouped ? 'month' : '';}, {viewMode, grouped});
      const evidence = await badge();
      if (grouped) assert(await page.locator('.q-timeline__entry').count());
      await shot('badge-' + viewMode + '-' + grouped);return evidence;
    });
    await check('zero label count suppresses badge', async () => {
      await root(r => {const g = r.$refs.gallery;g.viewMode = 'grid';g.groupBy = '';g.items[0].tag_count = 0;});
      const count = await page.locator('.media-card').first().locator('.tag-status').count();assert.equal(count, 0);
      await root(r => r.$refs.gallery.load());return {zeroBadge: count};
    });
    await check('favorites badge', async () => {await route('#/favorites');const evidence = await badge();await shot('favorites-badge');return evidence;});
    await check('duplicates badge', async () => {
      const real = await (await page.request.get(fixture.url + '/api/library/duplicates?type=near')).json();
      let mocked = false;
      if (!real.groups?.length) {
        mocked = true;const rows = [];
        for (const mid of [fixture.media_id, fixture.avi_id]) rows.push(await (await page.request.get(fixture.url + '/api/library/' + mid)).json());
        await page.route('**/api/library/duplicates?*', r => r.fulfill({json: {groups: [{items: rows, similarity: 1, excluded: []}]}}));
      }
      try {await route('#/duplicates');await page.locator('.dup-card').first().waitFor();const evidence = await badge(page.locator('.duplicates-workspace'));await shot('duplicates-badge');return {...evidence, mockedResponse: mocked};}
      finally {if (mocked) await page.unroute('**/api/library/duplicates?*');}
    });
    await check('project material badge', async () => {
      await route('#/workbench/' + fixture.project_id);await page.locator('.wb-mat-card').first().waitFor();
      const evidence = await badge(page.locator('.wb-material-list'));await shot('project-badge');return evidence;
    });
    await check('classification empty state', async () => {
      await route('#/classify/' + empty.id);await page.locator('.empty [role=status]').waitFor();
      assert.equal(await root(r => r.$refs.gallery.total), 0);await shot('classification-empty');return {total: 0};
    });
    await check('maintenance empty selection', async () => {await route('#/taxonomy');await page.locator('.taxonomy-empty').waitFor();await shot('taxonomy-empty');return {emptyPrompt: await page.locator('.taxonomy-empty p').innerText()};});
    await check('first-screen loading is visibly communicated', async () => {
      await route('#/classify/' + child.id);let release;const gate = new Promise(resolve => {release = resolve;});
      phase = 'injected-loading';await page.route('**/api/library/?*', async r => {await gate;await r.continue();});
      try {
        await root(r => {r.$refs.gallery.items = [];void r.$refs.gallery.load();});
        await page.waitForFunction(code => eval(code).$refs.gallery.loading, rootCode);
        await shot('classification-loading');
        const visible = await page.locator('.library-workspace [role=progressbar]:visible,.library-workspace .q-spinner:visible,.library-workspace [aria-busy=true]:visible,.library-workspace .q-skeleton:visible').count();
        assert(visible > 0, 'loading=true and 0 items, but no visible progress/status/skeleton/aria-busy');return {loadingIndicator: visible};
      } finally {release();await page.waitForFunction(code => !eval(code).$refs.gallery.loading, rootCode);await page.waitForLoadState('networkidle');await page.unroute('**/api/library/?*');phase = 'normal';}
    });
    await check('library error remains visible and retry recovers', async () => {
      await route('#/classify/' + child.id);phase = 'injected-503';
      await page.route('**/api/library/?*', r => r.fulfill({status: 503, json: {error: 'Synthetic appearance service unavailable'}}));
      try {await root(r => r.$refs.gallery.load());await page.locator('.empty [role=status]').waitFor();await page.locator('.empty button').waitFor();await shot('classification-error');}
      finally {await page.unroute('**/api/library/?*');phase = 'normal';}
      await page.locator('.empty button').click();await page.locator('.tag-status').first().waitFor();return {recovered: true};
    });
    await check('taxonomy server error preserves tree and retry recovers', async () => {
      await route('#/taxonomy/' + child.id);phase = 'injected-503';
      await page.route('**/api/taxonomy/tree', r => r.fulfill({status: 503, json: {error: 'Synthetic tree unavailable'}}));
      try {await root(r => r.reloadTaxonomy());await page.getByRole('alert').filter({hasText: 'Synthetic tree unavailable'}).waitFor();assert((await root(r => r.taxonomyNodes)).length > 0);await shot('taxonomy-error');}
      finally {await page.unroute('**/api/taxonomy/tree');phase = 'normal';}
      await root(r => r.reloadTaxonomy());assert.equal(await root(r => r.taxonomyError), '');return {recovered: true, preservedPreviousTree: true};
    });
    await check('offline gallery and taxonomy expose retry and recover', async () => {
      await route('#/classify/' + child.id);phase = 'injected-offline';await context.setOffline(true);
      try {await root(async r => {await Promise.all([r.$refs.gallery.load(), r.reloadTaxonomy()]);});
        await page.locator('.empty [role=status]').waitFor();assert(await root(r => !!r.taxonomyError));await shot('offline');}
      finally {await context.setOffline(false);phase = 'normal';}
      await root(async r => {await r.reloadTaxonomy();await r.$refs.gallery.load();});await page.locator('.tag-status').first().waitFor();return {recovered: true};
    });
    await check('browsing badges makes no per-image label calls', async () => {assert.deepEqual(report.labelRequests, []);return {requests: report.labelRequests.length};});
    await check('normal paths have no page, console or network errors', async () => {
      assert.deepEqual(report.pageErrors, []);
      assert.deepEqual(report.consoleErrors.filter(v => v.phase === 'normal'), []);
      assert.deepEqual(report.failedRequests.filter(v => v.phase === 'normal'), []);
      assert.deepEqual(report.httpErrors.filter(v => v.phase === 'normal'), []);
      return {pageErrors: 0, unexpectedConsoleErrors: 0, unexpectedNetworkErrors: 0};
    });
  } finally {
    report.passed = report.checks.filter(c => c.passed).length;report.failed = report.checks.filter(c => !c.passed).length;
    save();await browser.close();console.log(JSON.stringify({passed: report.passed, failed: report.failed, output}));
    if (report.failed) process.exitCode = 1;
  }
})().catch(error => {report.fatal = error.message;save();console.error(error);process.exitCode = 1;});
