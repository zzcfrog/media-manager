// Visible maintenance tree and editor; isolated synthetic fixture only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE||'/tmp/luminisle-taxonomy-maintenance-fixture.json'));
assert(fixture.scratch.includes('video-analyzer-tests-'));assert.equal(new URL(fixture.url).hostname,'127.0.0.1');
const output=path.resolve('build/taxonomy-maintenance-validation');fs.mkdirSync(output,{recursive:true});
const result={checks:[],errors:[],failed:[],geometry:[]};let browser;
const root=(page,fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
async function check(name,fn){await fn();result.checks.push(name)}
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1600,height:900}});page.setDefaultTimeout(7000);
 page.on('pageerror',error=>result.errors.push(error.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 const api=async(endpoint,data,method='POST')=>{const response=await page.request.fetch(fixture.url+'/api/taxonomy'+endpoint,{method,data});assert(response.ok(),await response.text());return response.json()};
 const stem='维护验证 '+Date.now(),a=await api('/nodes',{name:stem}),b=await api('/nodes',{name:'自然风景',parent_id:a.id}),c=await api('/nodes',{name:'山川与湖泊',parent_id:b.id,definition:'合成场景，用于检查标签维护界面。'}),d=await api('/nodes',{name:'独立标签 '+Date.now()});
 for(let i=0;i<30;i++)await api('/nodes',{name:'其他场景 '+i,parent_id:a.id});
 await page.goto(fixture.url+'/#/taxonomy/'+c.id);await page.waitForLoadState('networkidle');
 await page.screenshot({path:path.join(output,'initial.png'),animations:'disabled'});
 const tree=page.locator('.taxonomy-maintenance-tree'),editor=page.locator('.taxonomy-detail-scroll');
 await check('Visible expandable tree replaces the primary maintenance dropdown',async()=>{
  await tree.waitFor();assert.equal(await page.locator('.taxonomy-maintenance-select').count(),0);assert.equal(await page.locator('.taxonomy-sidebar-tree:visible').count(),0);
  assert(await tree.locator(`[data-maintenance-tag="${c.id}"]`).isVisible());assert.equal(await page.getByLabel('标准名称',{exact:true}).inputValue(),c.name);
 });
 await check('Disclosure is independent from selection and unsaved form inputs',async()=>{
  const name=page.getByLabel('标准名称',{exact:true});await name.fill('尚未保存的名字');
  const disclosure=tree.getByRole('button',{name:'展开或收起 '+stem,exact:true});await disclosure.click();
  assert.equal(await disclosure.getAttribute('aria-expanded'),'false');assert.equal(await root(page,r=>r.taxonomySelected),c.id);assert.equal(await name.inputValue(),'尚未保存的名字');
  await disclosure.focus();await page.keyboard.press('Enter');assert.equal(await disclosure.getAttribute('aria-expanded'),'true');assert.equal(await name.inputValue(),'尚未保存的名字');await name.fill(c.name);
 });
 await check('Tree selection opens the right editor and preserves the tree pane',async()=>{
  await tree.locator(`[data-maintenance-tag="${d.id}"]`).click();await page.waitForURL('**/#/taxonomy/'+d.id);await page.waitForFunction(name=>document.querySelector('.taxonomy-editor input')?.value===name,d.name);await page.getByLabel('标准名称',{exact:true}).fill('已保存标签 '+Date.now());
  const text=await page.getByLabel('标准名称',{exact:true}).inputValue();await page.getByRole('button',{name:'保存',exact:true}).click();
  await page.waitForFunction(({id,text})=>document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.taxonomyNodes.find(n=>n.id===id)?.name===text,{id:d.id,text});
  assert(await tree.locator(`[data-maintenance-tag="${d.id}"]`).isVisible());
 });
 await check('All maintenance functions remain reachable without hiding the tree',async()=>{
  for(const label of ['标签建议','关系整理','后台任务','变更历史','标签内容']){await page.getByRole('tab',{name:label,exact:true}).click();await page.waitForLoadState('networkidle');assert(await tree.isVisible())}
  for(const label of ['标准名称','定义与排除说明','识别描述（可选）','增加同义表达'])assert(await page.getByLabel(label,{exact:true}).count());
  for(const label of ['新增子标签','预览合并','查看图集','在资料库缓存中寻找候选'])assert(await page.getByRole('button',{name:label,exact:true}).count());
 });
 await check('Section tabs support arrow keys, Home and End with a visible selection',async()=>{
  await page.getByRole('tab',{name:'标签内容',exact:true}).focus();await page.keyboard.press('ArrowRight');assert.equal(await page.getByRole('tab',{name:'标签建议',exact:true}).getAttribute('aria-selected'),'true');
  await page.keyboard.press('End');assert.equal(await page.getByRole('tab',{name:'变更历史',exact:true}).getAttribute('aria-selected'),'true');await page.keyboard.press('Home');assert.equal(await page.getByRole('tab',{name:'标签内容',exact:true}).getAttribute('aria-selected'),'true');
 });
 await check('Refresh failures keep edits visible and can be retried',async()=>{
  await page.getByLabel('标准名称',{exact:true}).fill('保留这次编辑');
  await page.route('**/api/taxonomy/tree',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic tree temporarily unavailable'})}));
  await root(page,r=>r.reloadTaxonomy());await page.getByRole('alert').filter({hasText:'Synthetic tree temporarily unavailable'}).waitFor();assert.equal(await page.getByLabel('标准名称',{exact:true}).inputValue(),'保留这次编辑');assert(await tree.isVisible());
  await page.unroute('**/api/taxonomy/tree');await page.getByRole('button',{name:'重试标签树',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.taxonomyError);
 });
 await check('An unselected page shows an expanded tree and an honest empty editor',async()=>{
  await page.goto(fixture.url+'/#/taxonomy');await page.waitForLoadState('networkidle');
  assert.equal(await tree.getByRole('button',{name:'展开或收起 '+stem,exact:true}).getAttribute('aria-expanded'),'true');
  await page.getByText('选择一个标签开始维护',{exact:true}).waitFor();assert.equal(await page.getByLabel('标准名称',{exact:true}).count(),0);
 });
 await check('First load, read failure and a genuinely empty tree have distinct states',async()=>{
  await page.route('**/api/taxonomy/tree',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({data:[]})}));
  await page.goto(fixture.url+'/#/taxonomy');await page.waitForLoadState('networkidle');await page.getByText('还没有标签',{exact:true}).waitFor();
  await page.unroute('**/api/taxonomy/tree');
  let finish;const gate=new Promise(resolve=>finish=resolve);await page.route('**/api/taxonomy/tree',async route=>{await gate;await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic initial load failure'})})});
  await page.reload({waitUntil:'domcontentloaded'});await page.getByRole('status').getByText('正在读取标签树…',{exact:true}).waitFor();finish();await page.getByText('标签树暂时无法读取',{exact:true}).waitFor();
  await page.unroute('**/api/taxonomy/tree');await page.getByRole('button',{name:'重试标签树',exact:true}).click();await tree.waitFor();
 });
 await root(page,(r,id)=>r.nav('#/taxonomy/'+id),c.id);await page.waitForLoadState('networkidle');
 await check('Eight theme appearances preserve compact geometry and themed field borders',async()=>{
  const references={};
  for(const width of [1000,1280,1600])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await page.setViewportSize({width,height:width===1000?600:900});await root(page,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});
   await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
   const metrics=await page.evaluate(()=>{const box=s=>{const r=document.querySelector(s).getBoundingClientRect();return{x:r.x,y:r.y,width:r.width,height:r.height}};const probe=document.createElement('span');probe.style.color='var(--border2)';document.querySelector('.taxonomy-page').append(probe);const expectedBorder=getComputedStyle(probe).color;probe.remove();return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,tree:box('.taxonomy-maintenance-browser'),detail:box('.taxonomy-maintenance-detail'),tabs:box('.taxonomy-page-tabs'),buttons:[...document.querySelectorAll('.taxonomy-page-tabs > .q-btn')].map(e=>e.getBoundingClientRect().height),scrollOwner:getComputedStyle(document.querySelector('.taxonomy-page')).overflowY,fieldBorder:getComputedStyle(document.querySelector('.taxonomy-editor .q-field__control'),'::before').borderTopColor,expectedBorder}});
   assert.equal(metrics.overflow,false);assert.equal(metrics.detail.x-metrics.tree.x-metrics.tree.width,8);assert.equal(metrics.tree.y,56);assert.equal(metrics.tabs.height,32);for(const h of metrics.buttons)assert.equal(h,28);assert.equal(metrics.scrollOwner,'hidden');assert(metrics.detail.width>420);result.geometry.push({theme,mode,...metrics});
   assert.equal(metrics.fieldBorder,metrics.expectedBorder);if(mode==='dark')assert.notEqual(metrics.fieldBorder,'rgb(255, 255, 255)');
   const shape={tree:metrics.tree,detail:metrics.detail,tabs:metrics.tabs};if(references[width])assert.deepEqual(shape,references[width]);else references[width]=shape;
   if(width===1600&&theme==='jade')await page.screenshot({path:path.join(output,'maintenance-'+mode+'.png'),animations:'disabled'});
  }
 });
 await page.screenshot({path:path.join(output,'maintenance-compact-dark.png'),animations:'disabled'});
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);
 result.ok=true;
})().catch(error=>{result.failure=error.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.checks.length,failure:result.failure,errors:result.errors,failed:result.failed}))});
