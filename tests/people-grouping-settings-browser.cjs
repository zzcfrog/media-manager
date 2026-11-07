// Grouping settings: isolated fixture persistence, validation, keyboard and layout.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));
assert.equal(new URL(fixture.url).hostname,'127.0.0.1');assert(fixture.scratch.includes('video-analyzer-tests-'));
const out=path.resolve(process.env.PEOPLE_GROUPING_OUTPUT||'build/raw-and-grouping-2026-11-07/browser');fs.mkdirSync(out,{recursive:true});
const result={checks:[],errors:[],failed:[],writes:[],geometry:[],accessibility:[]};let browser,page;
const root=(fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
(async()=>{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())&&new URL(r.url()).pathname.startsWith('/api/'))result.writes.push(new URL(r.url()).pathname)});
 const dialog=()=>page.locator('.settings-dialog'),group=()=>page.getByRole('group',{name:'人物归组设置',exact:true});
 const threshold=()=>group().getByRole('spinbutton',{name:'自动归组阈值',exact:true}),adaptive=()=>group().getByRole('switch',{name:'根据人工纠正校准',exact:true});
 const settle=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
 const open=async()=>{await root(r=>r.openRecognitionSettings('people'));await dialog().waitFor();await page.waitForFunction(()=>document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.settingsLoaded);await threshold().waitFor();await settle()};
 const confirm=()=>dialog().getByRole('button',{name:'确定',exact:true}).click();
 const cancel=async()=>{await dialog().getByRole('button',{name:'取消',exact:true}).click();await dialog().waitFor({state:'hidden'})};
 const settings=async()=>(await (await page.request.get(fixture.url+'/api/people/status')).json()).settings;
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 await page.goto(fixture.url+'/#/gallery');await page.waitForLoadState('networkidle');await open();
 await check('Default lower threshold and enabled local calibration are visible; cancelling preserves saved values',async()=>{
  assert.equal(await threshold().inputValue(),'0.55');assert.equal(await adaptive().getAttribute('aria-checked'),'true');
  await threshold().fill('0.50');await adaptive().click();await cancel();
  const saved=await settings();assert.equal(saved.similarity_threshold,.55);assert.equal(saved.adaptive_threshold,true);
  await open();assert.equal(await threshold().inputValue(),'0.55');
 });
 await check('Threshold and calibration switch persist only on confirmation',async()=>{
  await threshold().fill('0.52');await adaptive().click();await confirm();await dialog().waitFor({state:'hidden'});
  const saved=await settings();assert.equal(saved.similarity_threshold,.52);assert.equal(saved.adaptive_threshold,false);
  await open();assert.equal(await threshold().inputValue(),'0.52');assert.equal(await adaptive().getAttribute('aria-checked'),'false');
 });
 await check('Empty or out-of-range thresholds prevent all writes and retain the draft',async()=>{
  for(const value of ['','0.44','0.86','0.555']){await threshold().fill(value);const before=result.writes.length;await confirm();const error=dialog().locator('.settings-save-error');await error.waitFor();assert((await error.innerText()).includes(value==='0.555'?'0.01':'0.45'));assert.equal(result.writes.length,before);assert.equal((await settings()).similarity_threshold,.52)}
  await cancel();await open();
 });
 await check('Server rejection preserves the edited draft and never starts inference',async()=>{
  await page.route('**/api/people/settings',route=>route.fulfill({status:409,json:{error:'Synthetic save rejection'}}));
  await threshold().fill('0.56');await confirm();await dialog().getByRole('alert').filter({hasText:'Synthetic save rejection'}).first().waitFor();assert.equal(await threshold().inputValue(),'0.56');
  await page.unroute('**/api/people/settings');await cancel();await open();assert.equal(await threshold().inputValue(),'0.52');
 });
 await check('Help supports keyboard and focus return; visible controls have accessible names',async()=>{
  const button=group().getByRole('button',{name:'人物归组说明',exact:true});await button.focus();await button.press('Enter');
  const popup=page.getByRole('dialog',{name:'人物归组说明',exact:true});await popup.waitFor();
  for(const phrase of ['0.55','0.40','0.08','100','5 次','3 次','撤销','不会自动合并已有相册'])assert((await popup.innerText()).includes(phrase));
  await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});assert(await button.evaluate(el=>el===document.activeElement));
  const violations=await group().evaluate(el=>[...el.querySelectorAll('input,button,[role="switch"]')].filter(node=>node.getClientRects().length&&!node.closest('[aria-hidden="true"]')).filter(node=>!node.getAttribute('aria-label')&&!node.textContent.trim()&&!node.closest('.q-field')?.getAttribute('aria-label')).map(node=>node.tagName));
  result.accessibility.push({violations});assert.deepEqual(violations,[]);
 });
 await check('Grouping controls fit all four themes, both modes and compact windows with a fixed dialog height',async()=>{
  for(const width of [1000,1440])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await page.setViewportSize({width,height:width===1000?600:900});await root((r,x)=>{r.setAppearanceTheme(x.theme);r.setThemeMode(x.mode)},{theme,mode});await settle();await group().scrollIntoViewIfNeeded();
   const box=await dialog().boundingBox(),b=await group().boundingBox();assert.equal(Math.round(box.height),width===1000?552:740);
   const overflow=await group().evaluate(el=>el.scrollWidth>el.clientWidth);assert.equal(overflow,false);assert(b.x>=box.x&&b.x+b.width<=box.x+box.width+1);
   result.geometry.push({width,theme,mode,overflow});
   if(width===1440&&theme==='jade')await dialog().screenshot({path:path.join(out,'grouping-'+mode+'.png')});
  }
 });
 await threshold().fill('0.55');if(await adaptive().getAttribute('aria-checked')!=='true')await adaptive().click();await confirm();await dialog().waitFor({state:'hidden'});
 assert.equal(result.writes.some(p=>p.includes('/jobs')||p.includes('/analysis')),false);assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(async error=>{result.failure=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})}).finally(async()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser?.close()});
