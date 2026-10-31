const fs = require('fs');
const assert = require('assert');

// Reused against the fixture browser and the packaged app, with synthetic folder paths only.
async function verifyFolderTree(page, base, output) {
  const passed = [], errors = [], writes = [], failedRequests = [], consoleErrors = [], expectedCoverFallbacks = [];
  const rootPath = '/synthetic/视频', concertPath = rootPath + '/演出';
  const deepPath = concertPath + '/成片/相机原片/精选片段';
  const folders = [{path:rootPath,label:'视频',count:1800,totalCount:1951,children:[
    {path:rootPath+'/旅行',label:'旅行',count:50,totalCount:50},
    {path:concertPath,label:'演出',count:24,totalCount:34,children:[
      {path:concertPath+'/成片',label:'成片',count:10,totalCount:10,children:[
        {path:concertPath+'/成片/相机原片',label:'相机原片',count:10,totalCount:10,children:[
          {path:deepPath,label:'精选片段',count:10,totalCount:10}
        ]}
      ]}
    ]},
    {path:rootPath+'/很长的文件夹名称用于验证截断效果',label:'很长的文件夹名称用于验证截断效果',count:9,totalCount:9}
  ]}];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => {
    if(m.type()!=='error') return;
    if(/\/media\/cover\/\d+$/.test(m.location().url) && m.text().includes('404')) expectedCoverFallbacks.push('Missing synthetic audio cover; thumbnail fallback');
    else consoleErrors.push(m.text());
  });
  page.on('requestfailed', r => failedRequests.push(r.method()+' '+new URL(r.url()).pathname));
  page.on('request', r => { if(r.url().startsWith(base+'/api/') && !['GET','HEAD','OPTIONS'].includes(r.method())) writes.push(r.method()+' '+new URL(r.url()).pathname); });
  await page.route('**/api/library/folders', route => route.fulfill({json:{data:folders}}));
  await page.addInitScript(() => { localStorage.setItem('theme','dark'); localStorage.setItem('accent','#25b7e5'); localStorage.removeItem('selectedFolder'); });
  await page.goto(base+'/#/gallery');
  const tree = page.locator('.app-sidebar .folder-tree:has(.folder-tree-item[data-path])');
  // Attribute selectors avoid matching a parent node's descendant folder.
  const row = p => tree.locator(`.folder-tree-item[data-path="${p}"]`);
  const header = p => row(p).locator('xpath=../../..');
  const arrow = p => row(p).locator('..').locator('.folder-tree-disclosure');
  const state = () => page.evaluate(() => { const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy; return {selected:r.selectedFolder,title:r.workspaceTitle}; });
  const style = (loc, prop) => loc.evaluate((e,p) => getComputedStyle(e).getPropertyValue(p), prop);
  await row(rootPath).waitFor();
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => {
    window._folderTreeKeyLeaks=[];
    window._folderTreeKeyListener=e=>{if(['Enter',' '].includes(e.key)&&e.target.closest('.folder-tree'))window._folderTreeKeyLeaks.push(e.key);};
    document.addEventListener('keydown',window._folderTreeKeyListener);
  });
  assert.equal(await row(rootPath).locator('.folder-tree-count').innerText(),'1951');
  assert.equal(await row(rootPath).locator('svg').getAttribute('data-state'),'closed');
  assert.equal(await arrow(rootPath).getAttribute('aria-label'),'展开 视频');
  await arrow(rootPath).click(); await row(concertPath).waitFor();
  assert.equal((await state()).selected,null);
  assert.equal(await row(rootPath).locator('svg').getAttribute('data-state'),'open');
  assert.equal(await arrow(rootPath).getAttribute('aria-expanded'),'true');
  await row(concertPath).click();
  assert.equal((await state()).selected,concertPath);
  assert.equal((await state()).title,'演出');
  assert.equal(await arrow(concertPath).getAttribute('aria-expanded'),'false');
  await arrow(concertPath).click(); await row(concertPath+'/成片').waitFor();
  assert.equal((await state()).selected,concertPath);
  assert.equal(await row(concertPath).locator('svg').getAttribute('data-state'),'open');
  passed.push('Arrow click expands without selecting; folder click selects without expanding, with distinct open/closed icons');

  const selectedBackground = await style(row(concertPath),'background-color');
  assert.notEqual(selectedBackground,'rgba(0, 0, 0, 0)');
  assert.equal(await style(header(concertPath),'background-color'),'rgba(0, 0, 0, 0)');
  await arrow(concertPath).hover();
  assert.equal(await style(row(concertPath),'background-color'),selectedBackground);
  assert.notEqual(await style(arrow(concertPath),'background-color'),'rgba(0, 0, 0, 0)');
  await page.mouse.move(700,400);
  assert.equal(await style(arrow(concertPath),'background-color'),'rgba(0, 0, 0, 0)');
  await row(rootPath+'/旅行').hover();
  assert.notEqual(await style(row(rootPath+'/旅行'),'background-color'),'rgba(0, 0, 0, 0)');
  assert.equal(await style(header(rootPath+'/旅行'),'background-color'),'rgba(0, 0, 0, 0)');
  passed.push('Hover and selected rounded backgrounds exclude the neutral disclosure target');

  await arrow(concertPath).focus(); await page.keyboard.press('Space');
  assert.equal(await arrow(concertPath).getAttribute('aria-expanded'),'false');
  assert.equal((await state()).selected,concertPath);
  await page.keyboard.press('Enter');
  assert.equal(await arrow(concertPath).getAttribute('aria-expanded'),'true');
  assert.deepEqual(await page.evaluate(()=>window._folderTreeKeyLeaks),[]);
  assert.equal((await state()).selected,concertPath);
  assert.equal(await style(arrow(concertPath),'outline-style'),'solid');
  assert.equal(await style(row(concertPath),'outline-style'),'none');
  await header(concertPath).focus();
  assert.equal(await style(row(concertPath),'outline-style'),'solid');
  assert.equal(await style(arrow(concertPath),'outline-style'),'none');
  await page.keyboard.press('Space');
  assert.equal((await state()).selected,null);
  assert.equal(await arrow(concertPath).getAttribute('aria-expanded'),'true');
  await page.keyboard.press('Enter');
  assert.equal((await state()).selected,concertPath);
  assert.equal(await arrow(concertPath).getAttribute('aria-expanded'),'true');
  assert.deepEqual(await page.evaluate(()=>window._folderTreeKeyLeaks),[]);
  passed.push('Disclosure and folder have independent keyboard focus, Space and Enter actions without triggering gallery shortcuts');

  const accentBefore = await style(row(rootPath).locator('svg'),'stroke');
  await page.evaluate(() => document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.setAppearanceTheme('paper'));
  assert.notEqual(await style(arrow(rootPath),'color'),await style(row(rootPath).locator('svg'),'stroke'));
  assert.equal(await style(arrow(rootPath),'color'),await style(arrow(concertPath),'color'));
  assert.notEqual(await style(row(rootPath).locator('svg'),'stroke'),accentBefore);
  assert.equal(await style(row(rootPath).locator('svg'),'stroke'),await style(row(concertPath).locator('svg'),'stroke'));
  passed.push('Theme changes recolor open and closed folder outlines while chevrons remain neutral');

  await row(concertPath).click({button:'right'});
  await page.getByText('同步文件夹',{exact:true}).waitFor();
  await page.locator('.app-section-title').click();
  await page.getByText('同步文件夹',{exact:true}).waitFor({state:'hidden'});
  await arrow(concertPath).click({button:'right'});
  assert.equal(await page.getByText('同步文件夹',{exact:true}).count(),0);
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy; r.pickerMode=true; });
  const picker = page.locator('.picker-overlay .folder-tree');
  await picker.locator('.folder-tree-disclosure').first().click();
  assert.equal(await picker.locator('.folder-tree-count').first().innerText(),'1800');
  await picker.locator(`.folder-tree-item[data-path="${concertPath}"]`).click();
  assert.equal(await page.evaluate(() => document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.pickerFolder),concertPath);
  assert.equal((await state()).selected,concertPath);
  await picker.locator(`.folder-tree-item[data-path="${concertPath}"]`).click({button:'right'});
  assert.equal(await page.getByText('同步文件夹',{exact:true}).count(),0);
  await page.evaluate(() => { const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy; r.pickerMode=false; });
  passed.push('Folder context menu and picker selection/count fields retain their existing behavior');

  await page.evaluate(() => { i18nState.locale='en'; });
  assert.equal(await arrow(rootPath).getAttribute('aria-label'),'Collapse 视频');
  await page.evaluate(() => { i18nState.locale='zh'; });
  await arrow(concertPath+'/成片').click();
  await arrow(concertPath+'/成片/相机原片').click();
  await row(deepPath).waitFor();
  for(const theme of ['dark','light']) {
    await page.evaluate(mode => {const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;r.themeMode=mode;r.applyTheme();},theme);
    for(const size of [{width:1000,height:600},{width:1280,height:800}]) {
      await page.setViewportSize(size);
      const geometry = await tree.evaluate(e => {
        const all=[...e.querySelectorAll('.folder-tree-item')].filter(x=>x.getBoundingClientRect().width);
        return all.map(x=>{const r=x.getBoundingClientRect(),a=x.previousElementSibling.getBoundingClientRect(),l=x.querySelector('.folder-tree-label');return {x:r.x,right:r.right,arrowRight:a.right,width:l.clientWidth,scroll:l.scrollWidth,radius:getComputedStyle(x).borderRadius};});
      });
      for(const g of geometry) {assert.ok(g.x>=g.arrowRight); assert.ok(g.right<=size.width); assert.equal(g.radius,'12px');}
      assert.ok(geometry.some(g=>g.scroll>g.width));
      const leaf = row(rootPath+'/旅行');
      assert.equal(await leaf.locator('..').locator('button').count(),0);
      const rootBox=await row(rootPath).boundingBox(),childBox=await leaf.boundingBox(),grandBox=await row(concertPath+'/成片').boundingBox();
      assert.equal(Math.round(childBox.x-rootBox.x),16);
      assert.equal(Math.round(grandBox.x-childBox.x),16);
      const deepLabel = await row(deepPath).locator('.folder-tree-label').evaluate(e=>({width:e.clientWidth,content:e.scrollWidth}));
      assert.ok(deepLabel.width>=deepLabel.content,'Five-level folder label remains readable');
    }
  }
  passed.push('Dark/light layouts retain compact 16px indentation, aligned leaf icons/counts and long-name ellipsis at narrow widths; labels localize');
  passed.push('Five-level folder names fit without colliding with right-aligned counts');
  await page.evaluate(() => {const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;r.themeMode='dark';r.applyTheme();});
  await page.setViewportSize({width:1280,height:800});
  await page.mouse.move(700,400);
  await tree.screenshot({path:output+'.png'});
  await page.evaluate(()=>document.removeEventListener('keydown',window._folderTreeKeyListener));
  assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);assert.deepEqual(consoleErrors,[]);assert.deepEqual(failedRequests,[]);
  const result={passed,errors,consoleErrors,failedRequests,expectedCoverFallbacks,writes,realDataAccess:false,paidAI:false};
  fs.writeFileSync(output+'.json',JSON.stringify(result,null,2)+'\n');
  return result;
}
module.exports={verifyFolderTree};
if(require.main===module) {
  const {chromium}=require('playwright');
  const fixture=JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE || '/tmp/video-analyzer-fix-browser.json','utf8'));
  (async()=>{const browser=await chromium.launch({headless:false});try{const page=await browser.newPage({viewport:{width:1280,height:800}});page.setDefaultTimeout(12000);console.log(JSON.stringify(await verifyFolderTree(page,fixture.url,process.env.VIDEO_ANALYZER_FOLDER_OUTPUT || '/tmp/video-analyzer-folder-results'),null,2));}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
}
