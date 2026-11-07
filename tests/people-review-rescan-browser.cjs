// Review rescan uses the real isolated queue API; the fixture keeps inference disabled.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const f=JSON.parse(fs.readFileSync(process.env.PEOPLE_BROWSER_FIXTURE));
assert(f.scratch.includes('video-analyzer-tests-')&&f.rescan_media_ids.length>40);
const out=path.resolve(process.env.PEOPLE_RESCAN_OUTPUT||'build/people-review-rescan-2026-11-07');fs.mkdirSync(out,{recursive:true});
const result={checks:[],errors:[],failed:[],writes:[],geometry:[],accessibility:[]};let browser;
const root=(p,fn,data)=>p.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
const settle=p=>p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
(async()=>{
 browser=await chromium.launch({headless:true});const p=await browser.newPage({viewport:{width:1440,height:900}});p.setDefaultTimeout(10000);
 p.on('pageerror',e=>result.errors.push(e.message));p.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/'))result.writes.push({path:new URL(r.url()).pathname,body:r.postDataJSON()})});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const dialog=()=>p.getByRole('dialog',{name:'全量重新扫描',exact:true});
 const enter=async()=>{await root(p,r=>r.nav('#/people/review'));await p.getByRole('tab',{name:'可能是同一人',exact:true}).click();await p.locator('.people-review-card:not(.people-face-review)').first().waitFor()};
 const open=async()=>{await p.getByRole('button',{name:'全量重新扫描',exact:true}).click();await dialog().waitFor();await dialog().locator('.people-rescan-summary strong').filter({hasText:String(f.rescan_media_ids.length)}).waitFor()};
 const cancel=async()=>{await dialog().getByRole('button',{name:'取消',exact:true}).click();await dialog().waitFor({state:'hidden'})};
 const reviews=async()=>{const rows=await(await p.request.get(f.url+'/api/people/reviews?per_page=200')).json();return rows.data.map(r=>[r.id,r.state,r.face?.person_id,r.face?.version])};
 const before=await reviews();await p.goto(f.url+'/#/people/review');await p.waitForLoadState('networkidle');await root(p,r=>r.onLanguageChange('zh'));
 await check('Both review tabs share a full cross-page deduplicated rescan; cancel makes no writes',async()=>{
  await enter();await p.locator('.people-review-pagination').getByRole('button',{name:'2',exact:true}).click();await p.waitForFunction(()=>document.querySelectorAll('.people-review-card:not(.people-face-review)').length===2);
  await open();assert.equal(await dialog().getByRole('combobox').count(),0);assert.match(await dialog().innerText(),/保留人工命名、合并和纠正/);assert.match(await dialog().innerText(),/1 个素材已在识别队列中/);
  await cancel();assert.equal(await p.locator('.people-review-card:not(.people-face-review)').count(),2);
  await p.getByRole('tab',{name:'待确认人脸',exact:true}).click();await open();await cancel();assert.deepEqual(result.writes,[]);assert.deepEqual(await reviews(),before);
  await root(p,r=>r.nav('#/people'));await p.locator('.people-card').first().waitFor();assert.equal(await p.getByRole('button',{name:'全量重新扫描',exact:true}).count(),0);await enter();
 });
 await check('Loading, count failure, retry and late responses preserve the dialog and never submit',async()=>{
  let release,handled;const gate=new Promise(resolve=>release=resolve),continued=new Promise(resolve=>handled=resolve);
  await p.route('**/api/people/reviews/rescan',async route=>{await gate;await route.continue();handled()});
  await p.getByRole('button',{name:'全量重新扫描',exact:true}).click();await dialog().getByText('正在统计…',{exact:true}).waitFor();assert(await dialog().getByRole('button',{name:'开始重新扫描',exact:true}).isDisabled());
  await p.keyboard.press('Escape');await dialog().waitFor({state:'hidden'});release();await continued;await p.unroute('**/api/people/reviews/rescan');
  let fail=true;await p.route('**/api/people/reviews/rescan',route=>fail?route.fulfill({status:503,json:{error:'合成统计失败'}}):route.continue());
  await p.getByRole('button',{name:'全量重新扫描',exact:true}).click();await dialog().getByRole('alert').waitFor();assert.match(await dialog().getByRole('alert').innerText(),/合成统计失败/);assert(await dialog().getByRole('button',{name:'开始重新扫描',exact:true}).isDisabled());
  fail=false;await dialog().getByRole('button',{name:'重试',exact:true}).click();await dialog().locator('.people-rescan-summary strong').filter({hasText:String(f.rescan_media_ids.length)}).waitFor();await cancel();await p.unroute('**/api/people/reviews/rescan');assert.deepEqual(result.writes,[]);
  await p.route('**/api/people/reviews/rescan',route=>route.fulfill({json:{total:0,active:0}}));await p.getByRole('button',{name:'全量重新扫描',exact:true}).click();await dialog().locator('.people-rescan-summary strong').filter({hasText:'0'}).waitFor();assert(await dialog().getByRole('button',{name:'开始重新扫描',exact:true}).isDisabled());await cancel();await p.unroute('**/api/people/reviews/rescan');
 });
 await check('Themes, compact windows, keyboard focus and accessibility roles remain consistent',async()=>{
  await open();const cdp=await p.context().newCDPSession(p);
  const ax=await cdp.send('Accessibility.getFullAXTree');const named=ax.nodes.filter(n=>!n.ignored&&['dialog','button','status'].includes(n.role?.value));
  assert(named.some(n=>n.role.value==='dialog'&&n.name?.value==='全量重新扫描'));for(const label of ['取消','开始重新扫描','关闭'])assert(named.some(n=>n.role.value==='button'&&n.name?.value===label));result.accessibility=named.map(n=>({role:n.role.value,name:n.name?.value||''}));await cdp.detach();
  const start=dialog().getByRole('button',{name:'开始重新扫描',exact:true});await start.focus();assert(await start.evaluate(el=>el===document.activeElement));
  for(const width of [1000,1440])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await p.setViewportSize({width,height:800});await root(p,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});await settle(p);
   const g=await dialog().locator('.people-dialog').evaluate(el=>{const r=el.getBoundingClientRect();return{inside:r.x>=0&&r.y>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,overflow:el.scrollWidth>el.clientWidth,heights:[...el.querySelectorAll('.q-card__actions .q-btn')].map(b=>b.getBoundingClientRect().height)}});
   assert(g.inside&&!g.overflow);assert(g.heights.every(h=>h===32),JSON.stringify(g));result.geometry.push({width,theme,mode,...g});
   assert(await p.locator('.people-toolbar').evaluate(el=>el.scrollWidth<=el.clientWidth));
   if(width===1440&&theme==='jade')await p.screenshot({path:path.join(out,'rescan-'+mode+'.png'),animations:'disabled'});
  }
  await p.keyboard.press('Escape');await dialog().waitFor({state:'hidden'});await root(p,r=>r.onLanguageChange('en'));
  await p.getByRole('button',{name:'Rescan all pending media',exact:true}).click();const english=p.getByRole('dialog',{name:'Rescan all pending media',exact:true});await english.waitFor();await english.getByRole('button',{name:'Start rescan',exact:true}).waitFor();await english.getByRole('button',{name:'Cancel',exact:true}).click();await root(p,r=>r.onLanguageChange('zh'));
 });
 await check('Submission failure retains scope; successful retry queues every pending-review medium once',async()=>{
  await open();await p.route('**/api/people/jobs',route=>route.fulfill({status:409,json:{error:'合成排队失败'}}));
  await dialog().getByRole('button',{name:'开始重新扫描',exact:true}).click();await dialog().getByRole('alert').waitFor();assert.match(await dialog().getByRole('alert').innerText(),/合成排队失败/);assert.equal(await dialog().locator('.people-rescan-summary strong').innerText(),String(f.rescan_media_ids.length));await p.unroute('**/api/people/jobs');
  let release;const gate=new Promise(resolve=>release=resolve);await p.route('**/api/people/jobs',async route=>{await gate;await route.continue()});
  await dialog().getByRole('button',{name:'开始重新扫描',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.people-dialog .q-card__actions .q-btn:last-child')?.disabled);await p.keyboard.press('Escape');assert(await dialog().isVisible());release();await dialog().waitFor({state:'hidden'});await p.unroute('**/api/people/jobs');
  const status=await(await p.request.get(f.url+'/api/people/status')).json();assert.equal(status.jobs.queued+status.jobs.running,f.rescan_media_ids.length);assert.deepEqual(await reviews(),before);
  assert(result.writes.filter(w=>w.path==='/api/people/jobs').every(w=>JSON.stringify(w.body)===JSON.stringify({scope:'review',existing:'rescan'})));
 });
 await check('Header owns pause, resume and stop; rescanning again never duplicates active work',async()=>{
  await open();assert.match(await dialog().innerText(),new RegExp(f.rescan_media_ids.length+' 个素材已在识别队列中'));await dialog().getByRole('button',{name:'开始重新扫描',exact:true}).click();await dialog().waitFor({state:'hidden'});
  await p.getByRole('button',{name:'后台任务',exact:true}).click();const jobs=p.getByRole('region',{name:'人脸识别任务',exact:true});await jobs.waitFor();assert((await jobs.innerText()).includes('剩余 '+f.rescan_media_ids.length));
  await jobs.getByRole('button',{name:'暂停',exact:true}).click();await jobs.getByRole('button',{name:'继续',exact:true}).click();await jobs.getByRole('button',{name:'停止',exact:true}).click();await jobs.waitFor({state:'hidden'});
  const status=await(await p.request.get(f.url+'/api/people/status')).json();assert.equal(status.jobs.cancelled,f.rescan_media_ids.length);assert.deepEqual(await reviews(),before);
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(e=>{result.failure=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(out,'browser-result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:result.checks.length,errors:result.errors,failed:result.failed,failure:result.failure}))});
