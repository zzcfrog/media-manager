const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE||'/tmp/luminisle-recognition-settings-fixture.json'));
assert(fixture.scratch.includes('video-analyzer-tests-'));assert.equal(new URL(fixture.url).hostname,'127.0.0.1');
const output=path.resolve(process.env.RECOGNITION_SETTINGS_OUTPUT||'build/recognition-settings-validation');fs.mkdirSync(output,{recursive:true});let browser;
const result={checks:[],errors:[],failed:[],writes:[],probes:[],geometry:[]};
const root=(page,fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(8000);
 page.on('pageerror',error=>result.errors.push(error.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())){const path=new URL(r.url()).pathname;(path==='/api/people/models/probe'?result.probes:result.writes).push({path,method:r.method()})}});
 const check=async(name,fn)=>{await fn();result.checks.push(name)};
 const read=async endpoint=>(await page.request.get(fixture.url+endpoint)).json();
 const open=async(kind='people')=>{await root(page,(r,k)=>r.openRecognitionSettings(k),kind);await page.locator('.settings-dialog').waitFor();await page.waitForFunction(()=>{const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return r.settingsLoaded&&!Object.values(r.recognitionLoading).some(Boolean)});};
 const tab=label=>page.locator('.settings-dialog').getByRole('tab',{name:label,exact:true}).click();
 const confirm=()=>page.locator('.settings-dialog').getByRole('button',{name:'确定',exact:true}).click();
 const close=()=>page.locator('.settings-dialog').getByRole('button',{name:'取消',exact:true}).click();
 const hidden=()=>page.locator('.settings-dialog').waitFor({state:'hidden'});
 await page.goto(fixture.url+'/#/gallery');await page.waitForLoadState('networkidle');
 await check('Two settings tabs load without saving or queueing work',async()=>{
  const before=result.writes.length;await open();assert.equal(await page.locator('.settings-dialog [role="tab"]').count(),7);await page.getByLabel('模型组合',{exact:true}).waitFor();await tab('智能分类');await page.getByRole('combobox',{name:'快速分类模型列表',exact:true}).waitFor();await confirm();await hidden();assert.equal(result.writes.length,before);await open();
 });
 await check('SigLIP 2 exposes presets without a global import switch; refinement and relationships share the local model',async()=>{
  await tab('智能分类');
  await page.getByRole('combobox',{name:'快速分类模型列表',exact:true}).waitFor();
  const fast=page.getByRole('group',{name:'快速分类模型',exact:true}),local=page.getByRole('group',{name:'本地补充与词库模型',exact:true});
  assert.equal(await fast.getByLabel('SigLIP2 模型目录',{exact:true}).count(),0);
  assert.equal(await fast.getByRole('combobox',{name:'快速分类模型列表',exact:true}).count(),1);
  assert.equal(await fast.getByRole('switch',{name:'导入后在后台快速分类',exact:true}).count(),0);
  assert.equal(await local.getByLabel('SigLIP2 模型目录',{exact:true}).count(),0);
  for(const name of ['本地模型补充标签','AI 整理词库关系'])assert.equal(await local.getByRole('switch',{name,exact:true}).count(),1);
  const id=await root(page,r=>r.recognitionSettings.classification.classification_omni_model);assert((await local.locator('.model-select .q-field__native').innerText()).includes(id));
  const before=result.writes.length;await local.getByRole('switch',{name:'本地模型补充标签',exact:true}).click();const draft=await root(page,r=>r.recognitionSettings.classification.classification_omni_enabled);
  await tab('通用');await tab('智能分类');assert.equal(await root(page,r=>r.recognitionSettings.classification.classification_omni_enabled),draft);
  await close();await hidden();assert.equal(result.writes.length,before);await open('classification');assert.notEqual(await root(page,r=>r.recognitionSettings.classification.classification_omni_enabled),draft);
  await tab('人脸识别');
 });
 await check('Three horizontal cards explain model roles with the optional switch inside verification',async()=>{
  const cards=page.locator('.face-model-stage');assert.equal(await cards.count(),3);
  const boxes=await cards.evaluateAll(nodes=>nodes.map(node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,width:b.width}}));
  assert(boxes.every(b=>Math.abs(b.y-boxes[0].y)<1));assert(boxes[0].x<boxes[1].x&&boxes[1].x<boxes[2].x);
  assert.equal(await cards.locator('.face-stage-icon').count(),3);assert.equal(await cards.locator('.face-stage-description').count(),3);
  const optional=page.locator('.face-model-stage[data-stage="verifier"]');
  assert.equal(await optional.getByRole('switch',{name:'启用人脸复核',exact:true}).isDisabled(),true);
  assert.equal(await cards.locator('input:not([type="checkbox"]),[role="combobox"],.face-path-pick').count(),0);
  assert.equal(await page.getByRole('button',{name:'下载套装',exact:true}).count(),0);
  assert.equal(await cards.locator('.model-select').count(),0);
  assert.equal(await page.locator('.recognition-settings').getByRole('button',{name:'分辨率设置',exact:true}).count(),0);
  await close();await hidden();assert.equal((await read('/api/people/status')).settings.verify_enabled,false);await open();
 });
 await check('Large face illustrations, disabled verification and settings hierarchy are clear',async()=>{
  assert.equal(await page.locator('.settings-dialog [role="tab"]').last().innerText(),'剪辑构思');
  const cards=page.locator('.face-model-stage');assert.equal(await cards.locator('svg.face-stage-art').count(),3);
  await page.locator('.face-stage-model').filter({hasText:'ArcFace'}).waitFor();
  const ratio=await cards.first().evaluate(el=>el.querySelector('.face-stage-art').getBoundingClientRect().width/el.querySelector('.face-stage-hero').getBoundingClientRect().width);
  assert(ratio>=.4&&ratio<=.55);
  const optional=page.locator('.face-model-stage[data-stage="verifier"]');assert(await optional.evaluate(el=>el.classList.contains('face-model-stage--disabled')));
  assert.equal(await optional.getByRole('button',{name:'核验模型',exact:true}).isDisabled(),true);
  assert.equal(await page.locator('.face-model-details').count(),0);
  await page.getByRole('button',{name:'模型说明',exact:true}).click();await page.locator('.face-model-details').waitFor();
  await page.getByRole('button',{name:'模型说明',exact:true}).click();assert.equal(await page.locator('.face-model-details').count(),0);
 });
 await check('Video face rates save all three choices and cancellation discards a draft',async()=>{
  const rate=()=>page.getByLabel('视频人脸检测帧率',{exact:true});
  await rate().waitFor();assert.equal((await read('/api/people/status')).settings.video_fps,1);
  for(const fps of [1,2,3]){
   if(!await page.locator('.settings-dialog').isVisible())await open();
   await rate().click();await page.getByRole('option',{name:fps+' 帧/秒',exact:true}).click();
   await confirm();await hidden();assert.equal((await read('/api/people/status')).settings.video_fps,fps);
  }
  await open();await rate().click();await page.getByRole('option',{name:'1 帧/秒',exact:true}).click();
  assert.equal((await read('/api/people/status')).settings.video_fps,3);await close();await hidden();
  await open();assert.equal(await root(page,r=>r.recognitionSettings.people.video_fps),3);
  await root(page,r=>{r.settingsForm.fps='120';r.settingsForm.localFps='.25'});
  assert.equal(await root(page,r=>r.recognitionSettings.people.video_fps),3);
  await close();await hidden();assert.equal(result.writes.some(r=>r.path.startsWith('/api/people/jobs')),false);await open();
 });
 await check('Invalid face rate prevents every settings write before confirmation',async()=>{
  await root(page,r=>{r.recognitionSettings.people.video_fps=4});const before=result.writes.length;
  await confirm();await page.locator('.settings-save-error').waitFor();assert.equal(result.writes.length,before);
  await close();await hidden();assert.equal((await read('/api/people/status')).settings.video_fps,3);await open();
 });
 await check('Track representative count saves its range and cancels or rejects unsaved drafts',async()=>{
  const count=()=>page.getByLabel('每次出镜取样数',{exact:true});
  assert.equal(await count().inputValue(),'4');
  assert.equal(await page.getByLabel('每条轨迹的代表人脸上限',{exact:true}).count(),0);
  const summary='同一张脸连续出镜时，自动从不同时刻挑选清晰图片用于识别。数量越多，处理通常越久。';
  assert.equal(await page.getByText(summary,{exact:true}).count(),0);
  const help=page.getByRole('button',{name:'取样数量说明',exact:true});await help.click();
  const explanation=page.getByRole('dialog',{name:'取样数量说明',exact:true});await explanation.waitFor();
  await explanation.getByText(summary,{exact:true}).waitFor();
  for(const title of ['数量范围','什么是一条轨迹','怎样跟踪','怎样选图'])await explanation.getByText(title,{exact:true}).waitFor();
  assert((await explanation.innerText()).includes('1～48'));
  assert((await explanation.innerText()).includes('不会限制视频中的人数'));
  await explanation.getByRole('button',{name:'关闭取样说明',exact:true}).click();await explanation.waitFor({state:'hidden'});
  await help.focus();await help.press('Enter');await explanation.waitFor();await page.keyboard.press('Escape');await explanation.waitFor({state:'hidden'});
  assert(await page.locator('.settings-dialog').isVisible());
  for(const n of [1,8,48]){
   await count().fill(String(n));await confirm();await hidden();
   assert.equal((await read('/api/people/status')).settings.video_identity_samples,n);await open();
  }
  await count().fill('3');await close();await hidden();await open();assert.equal(await count().inputValue(),'48');
  for(const n of ['0','49','1.5','']){
   await count().fill(n);const before=result.writes.length;await confirm();await page.locator('.settings-save-error').waitFor();
   assert.equal(result.writes.length,before);assert.equal((await read('/api/people/status')).settings.video_identity_samples,48);
  }
  await count().fill('4');await confirm();await hidden();await open();
 });
 await check('An older backend is explained before saving and model choices remain in the draft',async()=>{
  await close();await hidden();
  await page.route('**/api/people/status',async route=>{const response=await route.fetch();const body=await response.json();delete body.settings.video_fps;delete body.settings.video_identity_samples;await route.fulfill({response,json:body})});
  await open();await page.getByLabel('模型组合',{exact:true}).click();await page.getByRole('option',{name:'Raccoon S',exact:true}).click();
  await page.getByLabel('模型组合',{exact:true}).click();await page.getByRole('option',{name:'Buffalo L',exact:true}).click();
  await page.getByLabel('每次出镜取样数',{exact:true}).fill('5');const before=result.writes.length;
  await confirm();await page.locator('.settings-save-error').filter({hasText:'界面与后台版本不一致'}).waitFor();
  assert.equal(result.writes.length,before);assert.equal(await root(page,r=>r.recognitionSettings.people.profile),'buffalo_l');
  assert.equal(await page.getByLabel('每次出镜取样数',{exact:true}).inputValue(),'5');
  await page.unroute('**/api/people/status');await close();await hidden();await open();
 });
 await check('Drafts survive tab changes and both sections save through the main confirmation',async()=>{
  await tab('人脸识别');await page.getByLabel('每次出镜取样数',{exact:true}).fill('28');await tab('智能分类');await page.getByLabel('已拒绝／过期建议保留天数',{exact:true}).fill('120');await tab('通用');await tab('人脸识别');assert.equal(await page.getByLabel('每次出镜取样数',{exact:true}).inputValue(),'28');await confirm();await hidden();
  assert.equal((await read('/api/people/status')).settings.video_identity_samples,28);assert.equal((await read('/api/taxonomy/configuration')).classification_candidate_retention_days,'120');assert.equal(result.writes.some(r=>r.path.startsWith('/api/people/jobs')||r.path==='/api/taxonomy/jobs'),false);
 });
 await check('Cancel discards both new settings drafts',async()=>{
  await open();await page.getByLabel('每次出镜取样数',{exact:true}).fill('29');await tab('智能分类');await page.getByLabel('已拒绝／过期建议保留天数',{exact:true}).fill('125');const before=result.writes.length;await close();await hidden();assert.equal(result.writes.length,before);assert.equal((await read('/api/people/status')).settings.video_identity_samples,28);assert.equal((await read('/api/taxonomy/configuration')).classification_candidate_retention_days,'120');
 });
 await check('A failed section stays open; retry only sends the remaining changes',async()=>{
  await open();await page.getByLabel('每次出镜取样数',{exact:true}).fill('30');await tab('智能分类');await page.getByLabel('已拒绝／过期建议保留天数',{exact:true}).fill('180');
  await page.route('**/api/taxonomy/configuration',route=>route.request().method()==='PATCH'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic classification save failure'})}):route.continue());
  const start=result.writes.length;await confirm();await page.locator('.settings-save-error').filter({hasText:'Synthetic classification save failure'}).waitFor();assert(await page.locator('.settings-dialog').isVisible());assert.equal(await page.getByLabel('已拒绝／过期建议保留天数',{exact:true}).inputValue(),'180');assert.equal((await read('/api/people/status')).settings.video_identity_samples,30);
  await page.unroute('**/api/taxonomy/configuration');await confirm();await hidden();assert.equal(result.writes.slice(start).filter(r=>r.path==='/api/people/settings').length,1);assert.equal((await read('/api/taxonomy/configuration')).classification_candidate_retention_days,'180');
 });
 await check('Invalid numeric input is rejected before any section writes',async()=>{
  await open();await page.getByLabel('每次出镜取样数',{exact:true}).fill('31');await tab('智能分类');await page.getByLabel('已拒绝／过期建议保留天数',{exact:true}).fill('0');const start=result.writes.length;await confirm();await page.locator('.settings-save-error').waitFor();assert.equal(result.writes.length,start);await page.getByLabel('已拒绝／过期建议保留天数',{exact:true}).fill('300');await confirm();await hidden();
 });
 await check('Read failure offers retry and never saves unknown defaults',async()=>{
  await page.route('**/api/people/status',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic face settings read failure'})}));await open();await page.locator('.recognition-settings-error').waitFor();const start=result.writes.length;await confirm();assert.equal(result.writes.length,start);assert(await page.locator('.settings-dialog').isVisible());
  await page.unroute('**/api/people/status');await page.getByRole('button',{name:'重新读取',exact:true}).click();await page.getByLabel('每次出镜取样数',{exact:true}).waitFor();assert.equal(await page.getByLabel('每次出镜取样数',{exact:true}).inputValue(),'31');await close();await hidden();
 });
 await check('Closing during a read rejects the late response after reopening',async()=>{
  let release;const gate=new Promise(resolve=>release=resolve);await page.route('**/api/people/status',async route=>{await gate;await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({settings:{enabled:false,profile:'buffalo_l',model_dir:'/stale',max_frames:1}})})},{times:1});
  await root(page,r=>r.openRecognitionSettings('people'));await page.locator('.recognition-settings-status').waitFor();await page.locator('.settings-dialog .dialog-close').click();await hidden();await open();release();await page.waitForLoadState('networkidle');assert.equal(await page.getByLabel('每次出镜取样数',{exact:true}).inputValue(),'31');await close();await hidden();
 });
 await check('Task pages link to settings and contain no duplicate configuration form',async()=>{
  await root(page,(r,id)=>r.nav('#/taxonomy/'+id),fixture.tag_id);await page.locator('.taxonomy-page').waitFor();await page.getByRole('tab',{name:'后台任务',exact:true}).click();assert.equal(await page.locator('.taxonomy-configuration').count(),0);await page.getByRole('button',{name:'智能分类设置',exact:true}).click();await page.getByRole('combobox',{name:'快速分类模型列表',exact:true}).waitFor();await close();await hidden();
  await root(page,r=>r.nav('#/people'));await page.locator('.people-page,.people-workspace').waitFor();await page.locator('.people-toolbar').getByRole('button',{name:'人脸识别',exact:true}).click();await page.locator('.people-dialog').waitFor();assert.equal(await page.locator('.people-dialog').getByLabel('模型组合',{exact:true}).count(),0);await page.locator('.people-dialog').getByLabel('本次范围',{exact:true}).waitFor();await page.locator('.people-dialog').getByRole('button',{name:'人脸识别设置',exact:true}).click();await page.getByLabel('模型组合',{exact:true}).waitFor();await close();await hidden();
 });
 await check('Original analysis settings still save and failures do not close or submit other drafts',async()=>{
  await open('image');await root(page,r=>{r.settingsForm.imageResolution='1280'});await tab('人脸识别');await page.getByLabel('每次出镜取样数',{exact:true}).fill('32');
  await page.route('**/api/settings/',route=>route.request().method()==='POST'?route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic general settings failure'})}):route.continue());const start=result.writes.length;await confirm();await page.locator('.settings-save-error').filter({hasText:'Synthetic general settings failure'}).waitFor();assert(await page.locator('.settings-dialog').isVisible());assert.equal(result.writes.slice(start).some(r=>r.path==='/api/people/settings'),false);
  await page.unroute('**/api/settings/');await confirm();await hidden();assert.equal((await read('/api/settings/')).image_resolution,'1280');assert.equal((await read('/api/people/status')).settings.video_identity_samples,32);
 });
 await check('Recognition tabs use the same B groups, field heights, labels and dense toggles as analysis',async()=>{
  await open('image');
  const settled=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
  const style=(locator,properties)=>locator.evaluate((el,keys)=>{const s=getComputedStyle(el);return Object.fromEntries(keys.map(key=>[key,s[key]]))},properties);
  await settled();
  const field=await style(page.locator('.settings-dialog .settings-row .q-field__control').first(),['height','backgroundColor','borderRadius']);
  const type=await style(page.locator('.settings-dialog .settings-row .q-field').first(),['fontSize']);
  const label=await style(page.locator('.settings-dialog .settings-row-label').first(),['fontSize','color','marginBottom']);
  const heading=await style(page.locator('.settings-dialog .settings-group-heading h3').first(),['fontSize','fontWeight','color']);
  for(const name of ['人脸识别','智能分类']){
   await tab(name);await settled();const panel=page.locator('.recognition-settings');
   assert.equal(await panel.locator('.q-field--outlined,.q-field__label').count(),0);
   for(const el of await panel.locator('.settings-row .q-field__control').all())assert.deepEqual(await style(el,['height','backgroundColor','borderRadius']),field);
   for(const el of await panel.locator('.settings-row .q-field').all())assert.deepEqual(await style(el,['fontSize']),type);
   for(const el of await panel.locator('.settings-row-label').all())assert.deepEqual(await style(el,['fontSize','color','marginBottom']),label);
   for(const el of await panel.locator('.settings-group-heading h3').all())assert.deepEqual(await style(el,['fontSize','fontWeight','color']),heading);
   assert.equal(await panel.locator('.settings-hint').count(),0);if(name==='智能分类')assert.equal(await panel.locator('.classification-help').count(),6);
   for(const el of await panel.locator('.q-toggle').all())assert(await el.evaluate(node=>node.classList.contains('q-toggle--dense')));
  }
  await tab('人脸识别');await page.getByLabel('模型组合',{exact:true}).click();await page.getByRole('option',{name:'Raccoon S',exact:true}).click();assert.equal(await root(page,r=>r.recognitionSettings.people.profile),'raccoon_s');
  await tab('智能分类');const enabled=page.getByRole('switch',{name:'本地模型补充标签',exact:true});const before=await enabled.getAttribute('aria-checked');await enabled.click();assert.notEqual(await enabled.getAttribute('aria-checked'),before);await close();await hidden();
 });
 await check('Both tabs fit four themes, light/dark and compact desktop windows',async()=>{
  await open();for(const width of [1000,1600])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await page.setViewportSize({width,height:width===1000?600:900});await root(page,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});
   for(const label of ['人脸识别','智能分类']){await tab(label);await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));const geometry=await page.locator('.settings-dialog').evaluate(el=>{const b=el.getBoundingClientRect();return{left:b.left,right:b.right,top:b.top,bottom:b.bottom,width:innerWidth,height:innerHeight,overflow:el.scrollWidth>el.clientWidth}});assert(geometry.left>=0&&geometry.right<=width&&geometry.top>=0&&geometry.bottom<=geometry.height);assert.equal(geometry.overflow,false);result.geometry.push({theme,mode,label,...geometry});if(width===1600&&theme==='jade')await page.screenshot({path:path.join(output,(label==='人脸识别'?'faces':'classification')+'-'+mode+'.png'),animations:'disabled'});}
  }
  await root(page,r=>r.onLanguageChange('en'));await page.getByRole('tab',{name:'Face recognition',exact:true}).click();await page.getByLabel('Model pair',{exact:true}).waitFor();
  await page.getByLabel('Samples per appearance',{exact:true}).waitFor();
  await page.getByLabel('Video face detection frame rate',{exact:true}).click();
  for(const label of ['1 frame/s','2 frames/s','3 frames/s'])await page.getByRole('option',{name:label,exact:true}).waitFor();
  await page.keyboard.press('Escape');await page.getByRole('tab',{name:'Smart categories',exact:true}).click();await page.getByRole('combobox',{name:'Fast classification model list',exact:true}).waitFor();
 });
 await root(page,r=>{r.onLanguageChange('zh');r.settingsTab='people'});await page.getByLabel('视频人脸检测帧率',{exact:true}).scrollIntoViewIfNeeded();
 await page.screenshot({path:path.join(output,'video-face-rate-settings.png'),animations:'disabled'});
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(error=>{result.failure=error.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.checks.length,failure:result.failure,errors:result.errors,failed:result.failed}))});
