// Real browser, synthetic library only. No production data or model calls.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE || '/tmp/luminisle-classify-inline-fixture.json','utf8'));
assert.equal(new URL(fixture.url).hostname,'127.0.0.1');assert(fixture.scratch.includes('video-analyzer-tests-'));
const output=path.resolve('build/smart-collections-validation');fs.mkdirSync(output,{recursive:true});
let browser;
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1600,height:980}});page.setDefaultTimeout(12000);
 const errors=[],failed=[],checks=[];let expectedFailure=false;
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!expectedFailure)errors.push(m.text())});page.on('requestfailed',r=>{if(!expectedFailure)failed.push(r.url())});
 const proxy='document.querySelector("[data-v-app]").__vue_app__._container._vnode.component.proxy';
 const root=(fn,data)=>page.evaluate(({proxy,fn,data})=>eval('('+fn+')')(eval(proxy),data),{proxy,fn:String(fn),data});
 const api=async(endpoint,data,method='POST')=>{const response=await page.request.fetch(fixture.url+endpoint,{method,data});assert(response.ok(),await response.text());return response.json();};
 const collectionName='山川记忆 '+Date.now().toString().slice(-4),renamed=collectionName+'更新';
 const parent=await api('/api/taxonomy/nodes',{name:'自然风景 '+Date.now().toString().slice(-4)}),child=await api('/api/taxonomy/nodes',{name:'山川',parent_id:parent.id});
 await api('/api/taxonomy/decisions',{media_ids:[fixture.image_ids[0]],tag_id:child.id,decision:'confirm'});
 await page.goto(fixture.url+'/#/classify/'+parent.id);await page.waitForLoadState('networkidle');
 assert.equal(await page.locator('.library-workspace > .taxonomy-tools:visible').count(),0);
 assert.equal(await page.locator('.filter-controls').getByRole('group',{name:'标签筛选',exact:true}).count(),1);
 assert.equal(await page.getByRole('button',{name:'排除标签',exact:true}).count(),0);
 assert.equal(await page.locator('.taxonomy-collections-sidebar > .q-item .smart-collection-icon').count(),1);
 assert.equal(await page.locator('.taxonomy-collections-sidebar > .q-item .smart-collection-icon').evaluate(el=>getComputedStyle(el).fill),'none');
 await page.waitForFunction(code=>eval(code).$refs.gallery.total===1,proxy);checks.push('Tag rules share the filter bar; standalone rule row and exclusion chooser removed');
 const rules=page.getByRole('group',{name:'标签筛选',exact:true});assert(await rules.getByRole('button',{name:'选择标签',exact:true}).isVisible());assert(await rules.getByRole('button',{name:'任一',exact:true}).isVisible());assert(await rules.getByRole('button',{name:'全部',exact:true}).isVisible());
 await rules.getByRole('button',{name:'包含子标签',exact:true}).click();await page.waitForFunction(code=>eval(code).$refs.gallery.total===0,proxy);
 await rules.getByRole('button',{name:'包含子标签',exact:true}).click();await page.waitForFunction(code=>eval(code).$refs.gallery.total===1,proxy);
 await page.screenshot({animations:'disabled',path:path.join(output,'tag-filter-rules.png')});assert((await page.locator('.gallery-footer').innerText()).includes('含子标签'));assert((await page.locator('.gallery-footer').innerText()).includes(parent.name));checks.push('Visible descendant controls change results and the footer previews selected tags and rules');
 async function createDialog(){await page.getByRole('button',{name:'保存图集',exact:true}).click();await page.locator('.taxonomy-collection-create').waitFor();}
 await page.getByRole('button',{name:'展开或收起智能图集',exact:true}).click();
 await createDialog();const card=page.locator('.taxonomy-collection-create');
 assert(await card.getByRole('button',{name:'创建图集',exact:true}).isDisabled());assert.equal(await card.locator('.taxonomy-collection-emblem .smart-collection-icon').count(),1);assert.equal(await page.getByRole('dialog',{name:'创建智能图集',exact:true}).count(),1);assert((await card.innerText()).includes('左侧「智能图集」'));
 await card.getByLabel('图集名称',{exact:true}).fill(collectionName);await page.screenshot({animations:'disabled',path:path.join(output,'create-light.png')});
 expectedFailure=true;await page.route('**/api/taxonomy/collections',async route=>{if(route.request().method()==='POST')await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成保存失败，可重试'})});else await route.continue();});
 await card.getByRole('button',{name:'创建图集',exact:true}).click();await card.getByRole('alert').getByText('合成保存失败，可重试').waitFor();assert.equal(await card.getByLabel('图集名称',{exact:true}).inputValue(),collectionName);
 await page.unroute('**/api/taxonomy/collections');expectedFailure=false;
 await card.getByRole('button',{name:'创建图集',exact:true}).click();await card.waitFor({state:'hidden'});await page.waitForURL(/#\/classify\/collection\/\d+$/);
 const id=Number(page.url().split('/').at(-1));await page.waitForFunction(code=>eval(code).$refs.gallery.total===1&&!eval(code).$refs.gallery.loading,proxy);
 const sidebar=page.locator('.taxonomy-collection-nav');await sidebar.getByText(collectionName,{exact:true}).waitFor();assert.equal(await page.locator('.app-section-title').innerText(),collectionName);checks.push('Themed create dialog validates name, retains failed input and reveals the saved collection in the sidebar');
 await page.reload();await page.waitForLoadState('networkidle');await page.waitForFunction(code=>eval(code).$refs.gallery.total===1,proxy);assert.deepEqual(await root(r=>r.taxonomyQuery.tag_ids),[parent.id]);
 await api('/api/taxonomy/decisions',{media_ids:[fixture.image_ids[1]],tag_id:child.id,decision:'confirm'});await root(r=>r.$refs.gallery.load());await page.waitForFunction(code=>eval(code).$refs.gallery.total===2,proxy);checks.push('Saved route survives reload and new matching media appear without recreating the collection');
 await page.getByRole('button',{name:'视频',exact:true}).click();await page.waitForFunction(code=>eval(code).$refs.gallery.total===0,proxy);assert.equal(await root(r=>r.$refs.gallery._buildParams(1).media_type),'video');
 await page.locator('.gallery-type-controls').getByRole('button',{name:'全部',exact:true}).click();await page.waitForFunction(code=>eval(code).$refs.gallery.total===2,proxy);checks.push('Visible filter controls remain authoritative after opening a collection');
 await page.locator('.media-card').first().dblclick();await page.waitForURL(/#\/detail\/\d+/);await root(r=>r.returnFromDetail());await page.waitForURL(new RegExp('#/classify/collection/'+id+'$'));await page.locator('.media-card').first().waitFor();checks.push('Detail back-navigation restores the smart collection');
 for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
  await root((r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});await page.setViewportSize({width:1000,height:800});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  for(const selector of ['.filter-display-controls','.filter-actions']){const rect=await page.locator(selector).boundingBox();assert(rect.x>=0 && rect.x+rect.width<=1001);}
  await createDialog();await card.getByLabel('图集名称',{exact:true}).fill('外观验证');assert(await card.getByLabel('图集名称',{exact:true}).evaluate(el=>document.activeElement===el));
  const colors=await card.evaluate(el=>({focus:getComputedStyle(el.querySelector('.q-field__control')).color,accent:getComputedStyle(el.querySelector('.taxonomy-collection-emblem')).color}));assert.equal(colors.focus,colors.accent,'Input focus follows the theme accent');
  const aria=await page.locator('.q-dialog[role="dialog"]').last().getAttribute('aria-modal');assert.equal(aria,'true');
  if(theme==='jade'&&mode==='dark')await page.screenshot({animations:'disabled',path:path.join(output,'create-compact-dark.png')});
  await page.keyboard.press('Escape');await card.waitFor({state:'hidden'});
 }
 checks.push('Four themes in light/dark: compact layout, modal semantics, focus and Escape verified at 1000px');
 await page.setViewportSize({width:1600,height:980});await root(r=>{r.setAppearanceTheme('jade');r.setThemeMode('light')});await page.screenshot({animations:'disabled',path:path.join(output,'collection-sidebar.png')});
 assert.equal(await page.getByText('管理智能图集',{exact:true}).count(),0);
 assert.equal(await page.getByRole('tab',{name:'智能图集',exact:true}).count(),0);
 const entry=sidebar.getByLabel(collectionName,{exact:true});const beforeRename=await (await page.request.get(fixture.url+'/api/taxonomy/collections/'+id)).json();
 await entry.click({button:'right'});const contextMenu=page.getByRole('menu',{name:'图集操作',exact:true});await contextMenu.waitFor();assert.equal(await contextMenu.getByRole('menuitem').count(),2);await page.screenshot({animations:'disabled',path:path.join(output,'collection-context.png')});
 await contextMenu.getByRole('menuitem',{name:'重命名',exact:true}).click();const rename=page.locator('.taxonomy-collection-rename');await rename.waitFor();await rename.getByLabel('图集名称',{exact:true}).fill(renamed);await rename.getByRole('button',{name:'保存',exact:true}).click();await rename.waitFor({state:'hidden'});await sidebar.getByLabel(renamed,{exact:true}).waitFor();
 assert.deepEqual((await (await page.request.get(fixture.url+'/api/taxonomy/collections/'+id)).json()).query,beforeRename.query);checks.push('Collection right-click offers only rename/delete; renaming preserves the exact saved rules');
 await root(r=>r.drawerMini=true);await page.getByLabel('智能图集',{exact:true}).click();const mini=page.locator('.taxonomy-mini-collections:visible');await mini.getByLabel(renamed,{exact:true}).click({button:'right'});await contextMenu.getByRole('menuitem',{name:'重命名',exact:true}).click();await rename.waitFor();await rename.getByRole('button',{name:'取消',exact:true}).click();await rename.waitFor({state:'hidden'});await root(r=>r.drawerMini=false);checks.push('Collapsed-sidebar collection entries retain their context actions and usable dialogs');
 expectedFailure=true;await page.route('**/api/taxonomy/collections/'+id,route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'合成图集读取失败'})}));await sidebar.getByText(renamed,{exact:true}).click();await page.getByRole('alert').getByText('合成图集读取失败').waitFor();assert.equal(await root(r=>r.$refs.gallery.items.length),0);await page.unroute('**/api/taxonomy/collections/'+id);expectedFailure=false;await page.getByRole('button',{name:'重试图集',exact:true}).click();await page.waitForFunction(code=>eval(code).$refs.gallery.total===2&&!eval(code).$refs.gallery.loading,proxy);checks.push('Failed collection reads show a retryable error without leaking the previous gallery');
 await sidebar.getByLabel(renamed,{exact:true}).focus();await page.keyboard.press('Shift+F10');await contextMenu.waitFor();await contextMenu.getByRole('menuitem',{name:'删除',exact:true}).click();const removal=page.locator('.taxonomy-collection-delete');await removal.waitFor();await removal.getByRole('button',{name:'取消',exact:true}).click();await removal.waitFor({state:'hidden'});assert((await page.request.get(fixture.url+'/api/taxonomy/collections/'+id)).ok());
 await sidebar.getByLabel(renamed,{exact:true}).click({button:'right'});await contextMenu.getByRole('menuitem',{name:'删除',exact:true}).click();await removal.getByRole('button',{name:'删除',exact:true}).click();await removal.waitFor({state:'hidden'});await page.waitForURL(/#\/classify$/);assert.equal(await sidebar.getByLabel(renamed,{exact:true}).count(),0);assert((await page.request.get(fixture.url+'/api/library/'+fixture.image_ids[0])).ok());checks.push('Keyboard context menu works, cancel retains a collection, deletion removes only the collection and safely leaves its route');
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,errors,failed,synthetic:true},null,2)+'\n');console.log(JSON.stringify({passed:checks.length,errors,failed}));await browser.close();
})().catch(async error=>{console.error(error);if(browser){const page=browser.contexts()[0]?.pages()[0];await page?.screenshot({animations:'disabled',path:path.join(output,'failure.png')}).catch(()=>{});console.error((await page?.locator('body').innerText())?.slice(0,2500));await browser.close();}process.exitCode=1;});
