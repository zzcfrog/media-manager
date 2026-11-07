const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));assert(fixture.managed_models&&fixture.scratch.includes('video-analyzer-tests-'));
const output=path.resolve(process.env.FACE_DOWNLOAD_OUTPUT||'build/face-download-refinement-2026-11-06/browser');fs.mkdirSync(output,{recursive:true});
const result={checks:[],errors:[],failed:[],downloads:[],geometry:[]};let browser,page;
const root=(fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
(async()=>{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/people/models/download')result.downloads.push(r.postDataJSON())});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const dialog=page.locator('.settings-dialog'),download=page.locator('.face-download-dialog');
 const settle=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
 const open=async()=>{await root(r=>r.openRecognitionSettings('people'));await page.getByLabel('模型组合',{exact:true}).waitFor();await page.waitForFunction(()=>{const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return r.settingsLoaded&&!r.faceCatalogLoading});await settle()};
 const packDownload=async name=>{await page.getByLabel('模型组合',{exact:true}).click();await page.getByRole('button',{name:'下载模型 '+name,exact:true}).click();await download.waitFor();await settle()};
 const cancelDownload=async()=>{await download.getByRole('button',{name:'取消',exact:true}).click();await page.getByRole('dialog',{name:'下载人脸模型',exact:true}).waitFor({state:'hidden'});await settle()};
 await page.goto(fixture.url);await page.waitForLoadState('networkidle');await open();
 await check('The only pack download entry lives beside its model option and displays the real three-stage contents',async()=>{
  assert.equal(await dialog.getByRole('button',{name:'下载套装',exact:true}).count(),0);await packDownload('Raccoon S');
  assert.equal(await page.getByRole('dialog',{name:'下载人脸模型',exact:true}).count(),1);assert.equal(await download.getByRole('listitem').count(),3);
  for(const name of ['SCRFD','ArcFace · MobileFaceNet','FaceVerifier','det_10g_wo.onnx','w600k_mbf.onnx','face_verifier_mnv2.onnx'])await download.getByText(name,{exact:true}).waitFor();
  assert.equal(await download.getByLabel('模型根目录',{exact:true}).getAttribute('readonly'),'');assert.equal(await download.getByLabel('套装子目录',{exact:true}).inputValue(),'faces/raccoon_s');
 });
 await check('Root information is keyboard accessible; cancel restores focus and does not write or download',async()=>{
  const info=download.getByRole('button',{name:'模型根目录说明',exact:true});await info.focus();await page.keyboard.press('Enter');await page.getByRole('note').filter({hasText:'设置 → 通用 → 大模型目录'}).waitFor();
  await page.keyboard.press('Escape');await page.locator('.model-root-help').waitFor({state:'hidden'});await cancelDownload();
  assert.equal(result.downloads.length,0);await page.waitForFunction(()=>!!document.activeElement?.closest('.face-model-heading .model-select'));
 });
 await check('Every preset lists only its packaged models; stage cards expose no individual download',async()=>{
  await packDownload('Buffalo M');assert.equal(await download.getByRole('listitem').count(),2);await download.getByText('ArcFace · ResNet-50',{exact:true}).waitFor();await cancelDownload();
  assert.equal(await dialog.locator('.face-model-stage [role="combobox"],.face-model-stage input:not([type="checkbox"]),.face-model-stage .model-select-actions').count(),0);
 });
 await check('Invalid and occupied suffixes cannot overwrite data; a changed suffix is the actual backend destination',async()=>{
  await packDownload('Raccoon S');const suffix=download.getByLabel('套装子目录',{exact:true}),action=download.getByRole('button',{name:'下载',exact:true});
  const base=await download.getByLabel('模型根目录',{exact:true}).inputValue();
  await suffix.fill('../outside');assert(await action.isDisabled());assert.equal(result.downloads.length,0);
  await suffix.fill('faces/buffalo-l-fixture');await action.click();await download.getByRole('alert').filter({hasText:'已存在'}).waitFor();assert(await download.isVisible());
  await suffix.fill('faces/我的人脸套装');await action.click();await download.waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.faceDownload.state==='done');
  assert.equal(await root(r=>r.faceDownload.directory),base+'/faces/我的人脸套装');
  for(const stage of ['detector','recognizer','verifier'])assert.equal(await root((r,s)=>r.recognitionSettings.people[s+'_model'],stage),'raccoon_s:'+stage);
  assert.deepEqual(result.downloads.at(-1),{profile:'raccoon_s',subdirectory:'faces/我的人脸套装'});
 });
 await check('Video controls retain space above the footer line at the actual bottom of scrolling',async()=>{
  for(const width of [1000,1440]){
   await page.setViewportSize({width,height:width===1000?600:900});await settle();await dialog.locator('.q-panel.scroll').evaluate(el=>el.scrollTop=el.scrollHeight);
   const gap=await page.evaluate(()=>{const box=document.querySelector('.settings-dialog'),field=box.querySelector('[aria-label="每次出镜取样数"]').closest('.q-field').getBoundingClientRect(),footer=box.querySelector('.q-card__actions').getBoundingClientRect();return footer.top-field.bottom});
   result.geometry.push({width,footerGap:gap});assert(gap>=19,'Expected 20px below video controls (allowing subpixel rounding), received '+gap);
  }
 });
 await check('General settings show four themes in one row, with light above dark and working selected states',async()=>{
  await page.setViewportSize({width:1440,height:900});await dialog.getByRole('tab',{name:'通用',exact:true}).click();await dialog.locator('.general-settings').waitFor();await settle();
  const cards=dialog.locator('.appearance-theme-card');assert.equal(await cards.count(),4);
  const geometry=await cards.evaluateAll(nodes=>nodes.map(el=>{const b=el.getBoundingClientRect();const [light,dark]=el.querySelectorAll('.theme-preview-half');const l=light.getBoundingClientRect(),d=dark.getBoundingClientRect();return{x:b.x,y:b.y,l:{x:l.x,y:l.y,w:l.width,h:l.height},d:{x:d.x,y:d.y,w:d.width,h:d.height}}}));
  assert(geometry.every(g=>Math.abs(g.y-geometry[0].y)<1&&g.d.y>=g.l.y+g.l.h-1&&Math.abs(g.l.x-g.d.x)<1&&g.l.h>=38));
  for(let i=0;i<4;i++){await cards.nth(i).click();assert.equal(await cards.nth(i).getAttribute('aria-pressed'),'true')}
  await root(r=>r.setAppearanceTheme('jade'));await settle();await dialog.screenshot({path:path.join(output,'general-light.png')});
 });
 await check('The download dialog fits four themes in both appearances and retains names, paths and actions',async()=>{
  await dialog.getByRole('tab',{name:'人脸识别',exact:true}).click();await page.getByLabel('模型组合',{exact:true}).waitFor();await settle();await packDownload('Raccoon L');
  for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await root((r,x)=>{r.setAppearanceTheme(x.theme);r.setThemeMode(x.mode)},{theme,mode});await settle();
   const metrics=await download.evaluate(el=>{const b=el.getBoundingClientRect();return{overflow:el.scrollWidth>el.clientWidth,inside:b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight}});assert(!metrics.overflow&&metrics.inside);result.geometry.push({theme,mode,...metrics});
   if(theme==='jade')await download.screenshot({path:path.join(output,'download-'+mode+'.png')});
  }
  await cancelDownload();await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'});
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(async error=>{result.failure=error.stack;console.error(error);process.exitCode=1;await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{})}).finally(async()=>{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));await browser?.close()});
