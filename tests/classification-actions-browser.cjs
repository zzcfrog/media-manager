// Shared gallery actions stay scoped to classification, media or person contexts.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.PEOPLE_BROWSER_FIXTURE,'utf8'));
assert.equal(new URL(fixture.url).hostname,'127.0.0.1');assert.match(fixture.scratch,/video-analyzer-tests-/);
const output=path.resolve(process.env.CLASSIFICATION_ACTIONS_OUTPUT||'build/classification-actions-validation');
fs.mkdirSync(output,{recursive:true});let browser;
(async()=>{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
 const errors=[],failed=[],writes=[],checks=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
 page.on('requestfailed',r=>failed.push(new URL(r.url()).pathname));
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))writes.push(new URL(r.url()).pathname);});
 const proxy='document.querySelector("[data-v-app]").__vue_app__._container._vnode.component.proxy';
 const root=(fn,data)=>page.evaluate(({proxy,fn,data})=>eval('('+fn+')')(eval(proxy),data),{proxy,fn:String(fn),data});
 const api=async(url,data)=>{const response=await page.request.post(fixture.url+url,{data});assert(response.ok(),await response.text());return response.json();};
 const tag=await api('/api/taxonomy/nodes',{name:'分类操作回归 '+Date.now()});
 await api('/api/taxonomy/decisions',{media_ids:fixture.image_ids.slice(0,2),tag_id:tag.id,decision:'confirm'});
 const collection=await api('/api/taxonomy/collections',{name:'分类操作图集',query:{tag_ids:[tag.id],tag_mode:'any',include_children:true}});
 await page.goto(fixture.url+'/#/classify');await page.waitForLoadState('networkidle');
 const cards=page.locator('.media-card');
 const noTopActions=async()=>{
  assert.equal(await page.locator('.people-gallery-tools').count(),0,'Classification must not display people action rows');
  assert.equal(await page.locator('.filter-actions .batch-analysis-btn').count(),0,'Classification must not display the batch AI button');
  assert(await page.locator('.taxonomy-tag-controls').isVisible());assert(await page.locator('.inspector-toggle').isVisible());
 };
 const navigate=async route=>{
  await root((r,route)=>r.nav(route),route);await page.waitForURL('**/'+route);
  await page.waitForFunction(code=>{const r=eval(code);return r.$refs.gallery&&!r.$refs.gallery.loading&&!r.taxonomyCollectionLoading;},proxy);
  await cards.first().waitFor();await root(r=>r.$refs.gallery.deselectAll());
 };
 await cards.first().waitFor();await noTopActions();
 const before=await page.locator('.filter-bar').boundingBox();
 await cards.first().click();assert.equal(await root(r=>r.$refs.gallery.selArr.length),1);await noTopActions();
 await cards.nth(1).click({modifiers:['ControlOrMeta']});assert.equal(await root(r=>r.$refs.gallery.selArr.length),2);await noTopActions();
 const after=await page.locator('.filter-bar').boundingBox();assert(Math.abs(before.y-after.y)<1,'Selection must not insert a row above filters');
 checks.push('Classification stays compact with no, one or multiple selected images');
 for(const route of ['#/classify/'+tag.id,'#/classify/collection/'+collection.id]){
  await navigate(route);assert.equal(await cards.count(),2);await cards.first().click();await noTopActions();
 }
 checks.push('Tag albums and saved smart collections apply the same action scope');
 await cards.first().click({button:'right'});await page.getByRole('menuitem',{name:'AI 分析',exact:true}).click();
 await page.locator('.batch-analysis-dialog').waitFor();assert.equal(await root(r=>r.$refs.gallery.batchAnalysisInfo.images),1);
 await page.locator('.batch-analysis-dialog').getByRole('button',{name:'取消',exact:true}).click();
 await page.locator('.batch-analysis-dialog').waitFor({state:'hidden'});assert.equal(await root(r=>r.$refs.gallery.selArr.length),1);
 checks.push('Context menu still opens AI analysis for the selected media; cancelling preserves selection');
 for(const route of ['#/gallery','#/favorites']){
  await navigate(route);assert.equal(await page.locator('.filter-actions .batch-analysis-btn:visible').count(),0);
  await cards.first().click();assert.equal(await page.locator('.people-gallery-tools').count(),0,'Media lists must not display person actions');
  assert(await page.locator('.batch-analysis-btn').isVisible());
  await cards.nth(1).click({modifiers:['ControlOrMeta']});assert.equal(await root(r=>r.$refs.gallery.selArr.length),2);
  assert.equal(await page.locator('.people-gallery-tools').count(),0);
  await page.locator('.batch-analysis-btn').click();await page.locator('.batch-analysis-dialog').waitFor();
  assert.equal(await root(r=>{const info=r.$refs.gallery.batchAnalysisInfo;return info.images+info.videos+info.audios;}),2);
  await page.locator('.batch-analysis-dialog').getByRole('button',{name:'取消',exact:true}).click();
  assert.equal(await root(r=>r.$refs.gallery.selArr.length),2);
  await root(r=>r.$refs.gallery.deselectAll());assert.equal(await page.locator('.batch-analysis-btn:visible').count(),0);
 }
 checks.push('Library and favorites hide person actions for single/multiple selection and retain working AI analysis');
 await navigate('#/people/person/'+fixture.person_id);
 const tools=page.locator('.people-gallery-tools');assert(await tools.getByRole('button',{name:'人物管理',exact:true}).isVisible());
 assert.equal(await tools.getByRole('button',{name:'整理所选人物',exact:true}).count(),0);
 await cards.first().click();
 for(const name of ['人物管理','组合筛选','整理所选人物','关联人物','从此人物相册移除','纠正此人物的所选人脸']){
  assert(await tools.getByRole('button',{name,exact:true}).isVisible(),name);
 }
 await tools.getByRole('button',{name:'关联人物',exact:true}).click();
 assert.deepEqual(await root(r=>r.peopleDialog.media_ids),await root(r=>r.$refs.gallery.selArr));
 await page.locator('.people-dialog').getByRole('button',{name:'取消',exact:true}).click();
 await tools.getByRole('button',{name:'整理所选人物',exact:true}).click();
 assert.equal(await root(r=>r.peopleDialog.kind),'scan');
 assert.deepEqual(await root(r=>r.peopleDialog.media_ids),await root(r=>r.$refs.gallery.selArr));
 await page.keyboard.press('Escape');await page.locator('.people-dialog').waitFor({state:'hidden'});
 for(const route of ['#/gallery','#/favorites']){
  await navigate(route);await cards.first().click();assert.equal(await page.locator('.people-gallery-tools').count(),0);assert(await page.locator('.batch-analysis-btn').isVisible());
 }
 checks.push('Person albums retain working association/recognition and management; leaving the album removes those actions');
 await navigate('#/classify/'+tag.id);await cards.first().click();
 const selected=await root(r=>[...r.$refs.gallery.selArr]);
 await root((r,id)=>r.openDetail(id),selected[0]);await page.locator('.detail-workspace').waitFor();
 await root(r=>r.returnFromDetail());await page.waitForURL('**/#/classify/'+tag.id);await cards.first().waitFor();
 assert.deepEqual(await root(r=>r.$refs.gallery.selArr),selected);await noTopActions();
 await root(r=>{r.pickerMode=true;});assert.equal(await page.locator('.people-gallery-tools').count(),0);assert.equal(await page.locator('.filter-actions').count(),0);
 await root(r=>{r.pickerMode=false;});
 checks.push('Switching from a person album, returning from detail and picker mode do not leak actions');
 await page.setViewportSize({width:1000,height:600});
 for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
  await root((r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode);},{theme,mode});await noTopActions();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 }
 await root(r=>r.onLanguageChange('en'));await noTopActions();
 assert(await page.getByRole('group',{name:'Tag matching',exact:true}).isVisible());
 await root(r=>r.onLanguageChange('zh'));await page.screenshot({path:path.join(output,'classification-selected.png'),animations:'disabled'});
 checks.push('All four themes, light/dark and English retain classification controls in a compact window');
 assert.deepEqual(writes,[],'Viewing, selecting and cancelling must not start AI, scans or settings writes');
 assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
 fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({checks,errors,failed,writes,ok:true},null,2)+'\n');
 console.log(JSON.stringify({passed:checks.length,errors,failed,writes}));await browser.close();
})().catch(async e=>{console.error(e);if(browser){await browser.contexts()[0]?.pages()[0]?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});await browser.close();}process.exitCode=1;});
