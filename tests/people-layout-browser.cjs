// Layout and state checks on an isolated synthetic people library.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const f=JSON.parse(fs.readFileSync(process.env.PEOPLE_BROWSER_FIXTURE));assert(f.scratch.includes('video-analyzer-tests-'));assert.equal(new URL(f.url).hostname,'127.0.0.1');
const output=path.resolve(process.env.PEOPLE_LAYOUT_OUTPUT||'build/people-layout-2026-11-05');let browser;
const result={checks:[],errors:[],failed:[],writes:[],geometry:[]};
const root=(p,fn,data)=>p.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
const settle=p=>p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
(async()=>{
 browser=await chromium.launch({headless:true});const p=await browser.newPage({viewport:{width:1440,height:900}});p.setDefaultTimeout(8000);
 p.on('pageerror',e=>result.errors.push(e.message));p.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 p.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/people'))result.writes.push(new URL(r.url()).pathname)});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const nav=async route=>{await root(p,(r,v)=>r.nav(v),route);await p.waitForLoadState('networkidle');await settle(p)};
 await p.goto(f.url+'/#/people');await p.waitForLoadState('networkidle');await p.locator('.people-card').first().waitFor();
 await check('Eight appearances and desktop widths keep a compact aligned toolbar and 8px grid',async()=>{
  for(const width of [1000,1440,1600])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await p.setViewportSize({width,height:width===1000?600:900});await root(p,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});await settle(p);
   const g=await p.locator('.people-workspace').evaluate(el=>{const b=s=>el.querySelector(s).getBoundingClientRect().toJSON(),s=getComputedStyle(el.querySelector('.people-grid'));return{toolbar:b('.people-toolbar'),actions:b('.people-toolbar-actions'),grid:b('.people-grid'),scroll:b('.people-scroll'),footer:b('.people-footer'),rowGap:s.rowGap,columnGap:s.columnGap,overflow:el.scrollWidth>el.clientWidth,fields:[...el.querySelectorAll('.people-toolbar .q-field__control')].map(n=>n.getBoundingClientRect().height),buttons:[...el.querySelectorAll('.people-toolbar-actions>.q-btn')].map(n=>n.getBoundingClientRect().height),segments:[...el.querySelectorAll('.people-view-switcher .q-btn')].map(n=>n.getBoundingClientRect().height)}});
   assert.equal(g.toolbar.y,56);assert.equal(g.toolbar.height,40);assert.equal(g.grid.x,g.toolbar.x);assert.equal(g.grid.y,g.toolbar.bottom);assert.equal(g.actions.right,g.grid.right);assert.equal(g.rowGap,'8px');assert.equal(g.columnGap,'8px');assert.equal(g.overflow,false);assert.deepEqual(g.fields,[32,32]);assert.deepEqual(g.buttons,[32,32]);assert.deepEqual(g.segments,[28,28]);assert.equal(await p.locator('.people-intro').count(),0);result.geometry.push({width,theme,mode,...g});
   if(width===1440&&theme==='jade')await p.screenshot({path:path.join(output,'overview-'+mode+'.png'),animations:'disabled'});
  }
 });
 await check('Shared solid view icons and list mode remain visible in compact English UI',async()=>{
  await p.setViewportSize({width:1000,height:600});await root(p,r=>r.onLanguageChange('en'));await p.getByRole('button',{name:'List view',exact:true}).click();assert(await p.locator('.people-grid').evaluate(el=>el.classList.contains('is-list')));
  assert.equal(await p.locator('.people-view-switcher svg.gallery-view-icon').count(),2);assert.equal(await p.locator('.people-card').count(),f.people_count);assert.equal(await p.locator('.people-grid').evaluate(el=>getComputedStyle(el).gap),'8px');assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await p.screenshot({path:path.join(output,'list-compact-en.png'),animations:'disabled'});await p.getByRole('button',{name:'Grid view',exact:true}).click();await root(p,r=>r.onLanguageChange('zh'));
 });
 await check('All sidebar views use the header and preserve search, sort and empty states',async()=>{
  for(const [route,title] of [['#/people/unnamed','待命名'],['#/people/hidden','已隐藏'],['#/people','全部人物']]){await nav(route);assert.equal(await p.locator('.app-section-title').innerText(),title);}
  const search=p.getByRole('textbox',{name:'搜索人物姓名',exact:true});await search.fill('不存在的人');await p.getByText('没有匹配的人物',{exact:true}).waitFor();assert((await p.locator('.people-footer').innerText()).includes('不存在的人'));await search.fill('');await p.locator('.people-card').first().waitFor();
  await p.getByRole('combobox',{name:'人物排序',exact:true}).click();await p.getByRole('option',{name:'素材数量',exact:true}).click();await p.waitForLoadState('networkidle');assert.equal(await p.locator('.people-card').count(),f.people_count);
 });
 await check('Review tabs, responsive cards and pagination share toolbar and footer',async()=>{
  await nav('#/people/review');assert.equal(await p.locator('.people-toolbar .q-tab').count(),2);assert.equal(await p.locator('.people-scroll .q-tab').count(),0);assert.equal(await p.locator('.people-review-card').count(),40);
  assert.equal(await p.locator('.people-review-grid').evaluate(el=>getComputedStyle(el).gap),'8px');assert.equal(await p.locator('.people-footer .people-review-pagination').count(),1);assert((await p.locator('.people-footer').innerText()).includes(String(f.merge_review_count)));
  await p.locator('.people-review-pagination .q-btn').filter({hasText:/^2$/}).click();await p.waitForFunction(()=>document.querySelectorAll('.people-review-card').length===2);assert((await p.locator('.people-footer').innerText()).includes(String(f.merge_review_count)));
  for(const mode of ['light','dark']){await p.setViewportSize({width:1440,height:900});await root(p,(r,m)=>{r.setAppearanceTheme('jade');r.setThemeMode(m)},mode);await settle(p);await p.screenshot({path:path.join(output,'review-'+mode+'.png'),animations:'disabled'});}
  await p.getByRole('tab',{name:'待确认人脸',exact:true}).click();await p.getByText('目前没有待核对项目',{exact:true}).waitFor();await p.getByRole('tab',{name:'可能是同一人',exact:true}).click();
 });
 await check('Header owns people task controls while Footer keeps its read-only summary',async()=>{
  const calls=[],status=await(await p.request.get(f.url+'/api/people/status')).json();let currentJobs={};
  await p.route('**/api/people/status',route=>route.fulfill({json:{...status,jobs:currentJobs}}));
  await p.route('**/api/people/jobs/control',route=>{calls.push(route.request().postDataJSON().action);return route.fulfill({json:{ok:true}})});
  for(const [jobs,label] of [[{queued:1},'暂停'],[{paused:1},'继续'],[{failed:1},'重试'],[{queued:1},'停止']]){
   currentJobs=jobs;await root(p,r=>r.reloadPeopleStatus());await p.locator('.app-header .bg-task-bar').click();await p.locator('.background-task-menu').waitFor();await p.locator('.background-task-menu').getByRole('button',{name:label,exact:true}).click();await p.waitForFunction(()=>!document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.peopleControlBusy);await p.keyboard.press('Escape');await p.locator('.background-task-menu').waitFor({state:'hidden'});
  }
  assert.deepEqual(calls,['pause','resume','retry','cancel']);assert.equal(await p.locator('.people-task-strip .q-btn').count(),0);
  await p.unroute('**/api/people/status');await p.unroute('**/api/people/jobs/control');await root(p,r=>r.reloadPeopleStatus());
  await p.locator('.people-toolbar').getByRole('button',{name:'人脸识别',exact:true}).click();await p.getByLabel('本次范围',{exact:true}).waitFor();await p.locator('.people-dialog').getByRole('button',{name:'关闭',exact:true}).click();
 });
 await check('Long names truncate safely; loading and failures never masquerade as empty libraries',async()=>{
  await p.route('**/api/people/persons?**',async route=>{const response=await route.fetch(),body=await response.json();if(body.data?.length)body.data[0].display_name='很长的人物姓名'.repeat(20);await route.fulfill({response,json:body})});
  await nav('#/people');const label=p.locator('.people-card-label').first();assert((await label.getAttribute('title')).length>80);assert(await label.evaluate(el=>el.scrollWidth>el.clientWidth));assert.equal(await p.locator('.people-workspace').evaluate(el=>el.scrollWidth>el.clientWidth),false);await p.unroute('**/api/people/persons?**');
  let release;const gate=new Promise(r=>release=r);await p.route('**/api/people/persons?**',async route=>{await gate;await route.continue()});await root(p,r=>r.nav('#/people/hidden'));await p.locator('.people-scroll .q-linear-progress').waitFor();assert.equal(await p.locator('.people-empty').count(),0);release();await p.waitForLoadState('networkidle');await p.unroute('**/api/people/persons?**');
  await p.route('**/api/people/persons?**',route=>route.fulfill({status:503,json:{error:'Synthetic people layout failure'}}));await nav('#/people');await p.locator('.people-error').getByText('Synthetic people layout failure',{exact:false}).waitFor();assert.equal(await p.locator('.people-empty').count(),0);
  await p.unroute('**/api/people/persons?**');await p.locator('.people-error').getByRole('button',{name:'重试',exact:true}).click();await p.locator('.people-card').first().waitFor();
 });
 await check('Person albums keep shared media views and reachable management actions',async()=>{
  await p.locator('.people-card').filter({hasText:'小林'}).click();await p.waitForURL('**/#/people/person/'+f.person_id);await p.locator('.media-card').first().waitFor();assert.equal(await p.locator('.gallery-view-switcher .q-btn').count(),4);assert.equal(await p.locator('.people-gallery-tools').evaluate(el=>getComputedStyle(el).gap),'8px');
  await p.getByRole('button',{name:'人物管理',exact:true}).click();await p.getByLabel('人物姓名',{exact:true}).waitFor();for(const name of ['隐藏人物','与其他人物合并','从图集选择人脸作为封面'])await p.locator('.people-dialog').getByRole('button',{name,exact:true}).waitFor();await p.locator('.people-dialog').getByRole('button',{name:'取消',exact:true}).click();
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);assert(result.writes.every(v=>v==='/api/people/jobs/control'));result.ok=true;
})().catch(e=>{result.failure=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.checks.length,failure:result.failure,errors:result.errors,failed:result.failed}))});
