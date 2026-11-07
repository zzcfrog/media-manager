const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));
assert(fixture.scratch.includes('video-analyzer-tests-')&&fixture.managed_models);
const out=path.resolve(process.env.BACKGROUND_TASKS_OUTPUT||'build/background-tasks-settings-2026-11-06/browser');fs.mkdirSync(out,{recursive:true});
const result={checks:[],errors:[],failed:[],controls:[]};let browser,page;
const root=(fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
(async()=>{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const settle=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
 await page.goto(fixture.url);await page.waitForLoadState('networkidle');
 await root(r=>r.onLanguageChange('zh'));
 await check('Import uses two named switches, explicit states and an independent face scope',async()=>{
  await root(r=>r.openImport());const dialog=page.getByRole('dialog',{name:'导入素材',exact:true});await dialog.waitFor();await page.waitForFunction(()=>!document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.importOptionsLoading);
  assert.equal(await dialog.getByRole('checkbox').count(),0);assert.equal(await dialog.getByRole('switch').count(),2);
  for(const name of ['导入后在后台快速分类','导入后在后台识别人脸']){
   const toggle=dialog.getByRole('switch',{name,exact:true});assert.equal(await toggle.isChecked(),false);assert((await toggle.innerText()).includes('不启用'));
   await toggle.focus();await toggle.press('Space');assert.equal(await toggle.isChecked(),true);assert((await toggle.innerText()).includes('启用'));
  }
  const scope=dialog.getByRole('group',{name:'人脸识别素材类型',exact:true});await scope.getByRole('button',{name:'仅视频',exact:true}).click();
  assert(await dialog.getByRole('switch',{name:'导入后在后台识别人脸',exact:true}).isChecked());assert.equal(await root(r=>r.importPeopleMediaType),'video');
  await settle();await page.screenshot({path:path.join(out,'import-switches-light.png'),animations:'disabled'});
  await root(r=>r.setThemeMode('dark'));await settle();await page.screenshot({path:path.join(out,'import-switches-dark.png'),animations:'disabled'});
  await dialog.getByRole('button',{name:'关闭导入',exact:true}).click();await dialog.waitFor({state:'hidden'});
 });
 await check('Classification notes are aligned right; redundant hints and both budget controls are absent',async()=>{
  await root(r=>r.openRecognitionSettings('classification'));await page.getByRole('combobox',{name:'快速分类模型列表',exact:true}).waitFor();await settle();
  const panel=page.locator('.recognition-settings');
  assert.equal(await panel.locator('.settings-hint').count(),0);assert.equal(await panel.locator('.classification-help').count(),6);
  for(const label of ['每轮后台时间预算（秒）','额外内存预算（MB）'])assert.equal(await page.getByLabel(label,{exact:true}).count(),0);
  const notes=await panel.locator('.settings-group-heading').evaluateAll(rows=>rows.filter(row=>row.querySelector('.settings-group-note')).map(row=>{const note=row.querySelector('.settings-group-note');return Math.abs(note.getBoundingClientRect().right-row.getBoundingClientRect().right)<1&&getComputedStyle(note).textAlign==='right'}));assert(notes.length>=2&&notes.every(Boolean));
  await root(r=>r.setThemeMode('light'));await settle();await page.screenshot({path:path.join(out,'classification-light.png'),animations:'disabled'});
  await root(r=>r.setThemeMode('dark'));await settle();await page.screenshot({path:path.join(out,'classification-dark.png'),animations:'disabled'});
 });
 await check('Inline information buttons explain triggers and idle precisely, with keyboard dismissal and focus return',async()=>{
  for(const [title,expected] of [['本地模型补充标签','这里不检测电脑是否无人操作'],['AI 整理词库关系','新增或修改标签后自动排队'],['建议保留期','不会自动删除素材']]){
   const trigger=page.getByRole('button',{name:title+'说明',exact:true});await trigger.focus();await trigger.press('Enter');
   const explanation=page.getByRole('dialog',{name:title+'说明',exact:true});await explanation.waitFor();assert((await explanation.innerText()).includes(expected));
   await page.keyboard.press('Escape');await explanation.waitFor({state:'hidden'});assert(await trigger.evaluate(el=>el===document.activeElement));
  }
  await page.locator('.settings-dialog').getByRole('button',{name:'取消',exact:true}).click();await page.locator('.settings-dialog').waitFor({state:'hidden'});
 });
 const original=(await(await page.request.get(fixture.url+'/api/background-tasks')).json());assert.equal(original.supported_kinds.length,20);
 let rows=['fast_classification','local_refinement','analysis_tags','relationships'].map(kind=>({id:kind,kind,count:2,counts:{queued:1,paused:1},controllable:true,foreground_wait:kind!=='analysis_tags'}));
 rows.push(...['import','sync','embeddings','thumbnails','metadata_write','file_time','duplicates','export','creative'].map(kind=>({id:kind,kind,count:1,counts:{running:1},...(kind==='creative'?{progress:.4}:{})})));
 rows.push(...['people','classification','local'].map(source=>({id:'download:'+source,kind:'model_download',source,count:1,counts:{running:1},progress:.35})));
 let failSnapshot=false;
 await page.route('**/api/background-tasks',route=>route.fulfill(failSnapshot?{status:503,json:{error:'Synthetic status failure'}}:{json:{...original,data:rows}}));
 await page.route('**/api/background-tasks/control',route=>{
  const data=route.request().postDataJSON();result.controls.push(data);const task=rows.find(row=>row.kind===data.kind);
  if(data.action==='pause')task.counts={paused:task.count};else if(data.action==='resume')task.counts={queued:task.count};else rows=rows.filter(row=>row!==task);
  return route.fulfill({json:{changed:2}});
 });
 await check('The header includes every additional task category and shows unknown progress honestly',async()=>{
  await root(r=>r.pollBackgroundTasks());await page.getByRole('button',{name:'后台任务',exact:true}).click();
  const menu=page.getByRole('dialog',{name:'后台任务',exact:true});await menu.waitFor();
  assert.equal(await menu.locator('.background-task-group').count(),16);
  await menu.getByRole('region',{name:'快速分类',exact:true}).getByText('等待前台任务结束后自动继续',{exact:true}).waitFor();
  const indeterminate=menu.getByRole('region',{name:'导入素材',exact:true}).locator('.q-linear-progress');assert(await indeterminate.evaluate(el=>el.className.includes('q-linear-progress')));
  assert(!(await menu.getByRole('region',{name:'导入素材',exact:true}).innerText()).includes('%'));
  for(const source of ['人脸模型','SigLIP 2','本地大模型'])await menu.getByRole('region',{name:'模型下载 · '+source,exact:true}).waitFor();
  await settle();await page.screenshot({path:path.join(out,'header-tasks-dark.png'),animations:'disabled'});
 });
 await check('Header controls affect only the selected kind, and retain pause/retry/cancel affordances',async()=>{
  const menu=page.getByRole('dialog',{name:'后台任务',exact:true}),fast=menu.getByRole('region',{name:'快速分类',exact:true});
  await fast.getByRole('button',{name:'暂停',exact:true}).click();await fast.getByText('已暂停 2',{exact:true}).waitFor();
  await fast.getByRole('button',{name:'继续／重试',exact:true}).click();await fast.getByText('排队中 2',{exact:true}).waitFor();
  await fast.getByRole('button',{name:'停止',exact:true}).click();await fast.waitFor({state:'hidden'});
  assert.deepEqual(result.controls,[{kind:'fast_classification',action:'pause'},{kind:'fast_classification',action:'resume'},{kind:'fast_classification',action:'cancel'}]);
  await menu.getByRole('region',{name:'本地标签补充',exact:true}).waitFor();
 });
 await check('Status failure preserves the known tasks, exposes retry, and a successful retry clears the error',async()=>{
  failSnapshot=true;await root(r=>r.pollBackgroundTasks());const menu=page.getByRole('dialog',{name:'后台任务',exact:true});await menu.getByRole('alert').waitFor();assert.equal(await menu.locator('.background-task-group').count(),15);
  failSnapshot=false;await menu.getByRole('button',{name:'重试读取后台任务',exact:true}).click();await menu.getByRole('alert').waitFor({state:'hidden'});
 });
 await check('The task menu respects four themes, both appearances, English and compact viewport bounds',async()=>{
  for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await page.setViewportSize({width:1000,height:600});await root((r,x)=>{r.setAppearanceTheme(x.theme);r.setThemeMode(x.mode)},{theme,mode});await settle();
   const menu=page.getByRole('dialog',{name:'后台任务',exact:true});const box=await menu.evaluate(el=>{const b=el.getBoundingClientRect();return {inside:b.x>=0&&b.y>=0&&b.right<=innerWidth&&b.bottom<=innerHeight,overflow:el.scrollWidth>el.clientWidth}});assert(box.inside&&!box.overflow);
  }
  await root(r=>r.onLanguageChange('en'));await page.getByRole('region',{name:'Local tag refinement',exact:true}).waitFor();
  await page.screenshot({path:path.join(out,'header-tasks-english.png'),animations:'disabled'});
 });
 await check('All five existing task types and Electron model migration remain in the shared header',async()=>{
  const people=(await(await page.request.get(fixture.url+'/api/people/status')).json());
  const analysis=['image','video','audio'].map((media_type,i)=>({id:fixture.media_ids[i],media_type,file_name:'Synthetic '+media_type,step:'analyzing'}));
  analysis.push({id:'__preload__',media_type:'system',file_name:'Synthetic preload',step:'asr_loading'});
  await page.route('**/api/analysis/progress',route=>route.fulfill({json:analysis}));
  await page.route('**/api/people/status',route=>route.fulfill({json:{...people,jobs:{queued:2},recent:[]}}));
  await root((r,p)=>{r.peopleStatus={...p,jobs:{queued:2},recent:[]};r.settingsSaving=true;r.modelDirectory.progress={phase:'preparing'};},people);
  await root(r=>r.pollBackgroundTasks());
  const menu=page.getByRole('dialog',{name:'Background',exact:true});
  await menu.getByRole('region',{name:'Face recognition tasks',exact:true}).waitFor();await menu.getByRole('region',{name:'Model directory migration',exact:true}).waitFor();
  for(const name of ['Synthetic image','Synthetic video','Synthetic audio','Synthetic preload'])await menu.getByText(name,{exact:true}).waitFor();
  assert.equal(await root(r=>r.bgTasks.length),4);
  await root(r=>{r.settingsSaving=false;r.modelDirectory.progress=null;r.bgTasks=[];});await page.unroute('**/api/analysis/progress');await page.unroute('**/api/people/status');await root(r=>r.reloadPeopleStatus());
 });
 await check('Finished task cleanup cannot remove a newly started analysis; an empty queue hides the header entry',async()=>{
  await page.keyboard.press('Escape');await root(r=>{r.bgTasks=[{id:1,status:'done',percent:100}];});
  await page.waitForTimeout(100);await root(r=>{r.bgTasks.push({id:2,status:'running',percent:10});});await page.waitForTimeout(1700);assert.equal(await root(r=>r.bgTasks.some(t=>t.id===2)),true);
  rows=[];await root(r=>{r.bgTasks=[];r.peopleStatus={...r.peopleStatus,jobs:{}};});await root(r=>r.pollBackgroundTasks());await page.getByRole('button',{name:'Background',exact:true}).waitFor({state:'hidden'});
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(async error=>{result.failure=error.stack;console.error(error);process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{})}).finally(async()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));await browser?.close()});
