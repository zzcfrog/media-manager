const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.PEOPLE_BROWSER_FIXTURE||'/tmp/luminisle-classify-inline-fixture.json','utf8'));
assert.equal(new URL(fixture.url).hostname,'127.0.0.1');assert(fixture.scratch.includes('video-analyzer-tests-'));
const output=path.resolve('build/taxonomy-layout-validation');fs.mkdirSync(output,{recursive:true});
let browser;
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:940}});page.setDefaultTimeout(12000);
 const errors=[],failed=[],checks=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});page.on('requestfailed',r=>failed.push(r.url()));
 const root='document.querySelector("[data-v-app]").__vue_app__._container._vnode.component.proxy';
 const run=(fn,data)=>page.evaluate(({code,fn,data})=>eval('('+fn+')')(eval(code),data),{code:root,fn:String(fn),data});
 async function create(name,parent_id){const r=await page.request.post(fixture.url+'/api/taxonomy/nodes',{data:{name,parent_id}});if(r.status()===409){const tree=await (await page.request.get(fixture.url+'/api/taxonomy/tree')).json();const existing=tree.data.find(n=>n.name===name&&(n.parent_id||null)===(parent_id||null));if(existing)return existing;}assert(r.ok(),await r.text());return r.json();}
 const a=await create('场景'),b=await create('自然',a.id),c=await create('海边',b.id),d=await create('主体'),e=await create('海边',d.id);
 for(let i=0;i<45;i++)await create('空分类 '+i,a.id);
 for(const [mid,tag_id] of [[fixture.image_ids[0],c.id],[fixture.image_ids[1],e.id]]){const response=await page.request.post(fixture.url+'/api/taxonomy/decisions',{data:{media_ids:[mid],tag_id,decision:'confirm'}});assert(response.ok());}
 await page.goto(fixture.url+'/#/classify/'+c.id);await page.waitForLoadState('networkidle');
 assert.equal(await page.locator('.taxonomy-sidebar-tree input:visible').count(),0,'Sidebar is a pure tree without search');
 assert.equal(await page.getByText('隐藏空分类',{exact:true}).count(),0);
 checks.push('Classification sidebar contains the complete tree without search/hide-empty controls');
 const scroll=await page.locator('.taxonomy-tree-scroll:visible').evaluate(el=>({overflow:getComputedStyle(el).overflowY,maxHeight:getComputedStyle(el).maxHeight,inner:el.scrollTop,outerHeight:el.closest('.app-sidebar').querySelector(':scope > .q-list').clientHeight,outerScroll:el.closest('.app-sidebar').querySelector(':scope > .q-list').scrollHeight}));
 assert.equal(scroll.overflow,'visible');assert.equal(scroll.maxHeight,'none');assert(scroll.outerScroll>scroll.outerHeight);checks.push('Expanded navigation uses one outer sidebar scroll container');
 await page.mouse.move(150,500);await page.mouse.wheel(0,350);await page.waitForFunction(()=>document.querySelector('.app-sidebar > .q-list').scrollTop>0);assert.equal(await page.locator('.taxonomy-tree-scroll:visible').evaluate(el=>el.scrollTop),0);await page.locator('.app-sidebar > .q-list').evaluate(el=>el.scrollTop=0);checks.push('Wheel events over tree rows scroll the outer navigation only');
 assert.equal(await page.getByRole('button',{name:'维护标签',exact:true}).count(),0);
 await run((r,id)=>{r.$refs.gallery.selArr=[id];},fixture.image_ids[0]);
 assert.equal(await page.locator('.taxonomy-tools').getByRole('button',{name:'添加标签',exact:true}).count(),0);checks.push('Classification gallery has no tag-maintenance or assignment entry');
 const rules=page.getByRole('group',{name:'标签筛选',exact:true});
 const include=rules.locator('.taxonomy-tag-picker');await include.getByRole('button',{name:'选择标签',exact:true}).click();
 const menu=page.locator('.taxonomy-picker-menu:visible');await menu.waitFor();
 assert(await menu.locator(`[data-tag-choice="${c.id}"]`).isVisible());
 assert(await menu.locator(`[data-tag-choice="${c.id}"]`).evaluate(el=>el.closest('.q-tree__node').querySelectorAll(':scope > .q-tree__node-header').length===1));
 if(!await menu.locator(`[data-tag-choice="${e.id}"]`).isVisible())await menu.getByText('主体',{exact:true}).locator('xpath=ancestor::div[contains(@class,"q-tree__node-header")]').locator('.q-tree__arrow').click();
 await page.screenshot({path:path.join(output,'hierarchical-picker.png')});
 await menu.locator(`[data-tag-choice="${e.id}"]`).click();await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});
 const ids=await run(r=>r.taxonomyQuery.tag_ids);assert.deepEqual([...ids].sort((a,b)=>a-b),[c.id,e.id].sort((a,b)=>a-b));checks.push('Hierarchical multi-selection preserves same-name tags and arrows do not select ancestors');
 await page.waitForFunction(code=>eval(code).$refs.gallery.total===2,root);
 assert.equal(await page.getByRole('button',{name:'排除标签',exact:true}).count(),0);checks.push('Retired exclusion control is absent and tag rules remain in the shared filter bar');
 await page.screenshot({path:path.join(output,'classification-light.png')});
 await run((r,id)=>{r.$refs.gallery.selArr=[id];},fixture.image_ids[0]);
 await page.getByLabel('标签树维护',{exact:true}).click();await page.locator('.taxonomy-page').waitFor();
 assert.equal(await page.locator('.taxonomy-sidebar-tree:visible').count(),0);
 const tree=page.locator('.taxonomy-maintenance-tree');
 await tree.getByRole('button',{name:'展开或收起 自然',exact:true}).click();await tree.locator(`[data-maintenance-tag="${c.id}"]`).click();await page.waitForFunction(id=>document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.taxonomySelected===id,c.id);await page.getByLabel('标准名称',{exact:true}).waitFor();
 assert.equal(await page.getByLabel('标准名称',{exact:true}).inputValue(),'海边');checks.push('Taxonomy maintenance selection and edits live entirely in the main area');
 await page.screenshot({path:path.join(output,'maintenance-light.png')});
 await page.getByText(/所选素材\s+1\s+项/).waitFor();checks.push('Maintenance navigation carries explicit gallery selection into the editor');
 const saved=await page.request.post(fixture.url+'/api/taxonomy/collections',{data:{name:'布局测试图集 '+Date.now(),query:{tag_ids:[c.id],include_children:true}}});assert(saved.ok());const collection=await saved.json();await run(r=>r.reloadTaxonomy());
 const entry=page.locator('.taxonomy-collection-nav').getByLabel(collection.name,{exact:true});await entry.click({button:'right'});await page.getByRole('menuitem',{name:'重命名',exact:true}).click();await page.locator('.taxonomy-collection-rename').waitFor();await page.locator('.taxonomy-collection-rename').getByRole('button',{name:'取消',exact:true}).click();await page.locator('.taxonomy-collection-rename').waitFor({state:'hidden'});await entry.click();await page.waitForFunction(code=>eval(code).currentView==='gallery',root);assert.deepEqual(await run(r=>r.taxonomyQuery.tag_ids),[c.id]);checks.push('Smart collections remain reachable in the sidebar with name-only context maintenance');
 await run((r,id)=>r.nav('#/taxonomy/'+id),c.id);await page.locator('.taxonomy-page').waitFor();
 for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
  await run((r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});
  await page.setViewportSize({width:1000,height:760});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await page.screenshot({path:path.join(output,'maintenance-compact-dark.png')});checks.push('Four themes in both modes preserve layout at 1000 pixels');
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,errors,failed,synthetic:true},null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,errors,failed}));await browser.close();
})().catch(async e=>{console.error(e);if(browser){await browser.contexts()[0]?.pages()[0]?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await browser.close();}process.exitCode=1});
