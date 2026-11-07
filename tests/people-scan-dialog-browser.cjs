// Only the isolated recognition fixture may receive these synthetic queue/control writes.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const f=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));
assert(f.scratch.includes('video-analyzer-tests-'));assert.equal(new URL(f.url).hostname,'127.0.0.1');assert.equal(f.media_ids.length,3);
const output=path.resolve(process.env.PEOPLE_SCAN_DIALOG_OUTPUT||'build/people-scan-dialog-2026-11-05');fs.mkdirSync(output,{recursive:true});
const result={checks:[],errors:[],failed:[],writes:[],geometry:[]};let browser;
const root=(p,fn,data)=>p.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
const settle=p=>p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
(async()=>{
 browser=await chromium.launch({headless:true});const p=await browser.newPage({viewport:{width:1440,height:900}});p.setDefaultTimeout(8000);
 p.on('pageerror',e=>result.errors.push(e.message));p.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 p.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/'))result.writes.push({path:new URL(r.url()).pathname,body:r.postDataJSON()})});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const dialog=p.locator('.people-scan-dialog'),menu=p.locator('.background-task-menu');
 const open=async(payload={})=>{await root(p,(r,data)=>{r.selectedFolder=null;r.openPeopleDialog('scan',data)},payload);await dialog.getByLabel('本次范围',{exact:true}).waitFor();await settle(p)};
 const close=async()=>{await dialog.getByRole('button',{name:'关闭',exact:true}).click();await dialog.waitFor({state:'hidden'})};
 const background=async()=>{if(!await menu.isVisible()){await p.locator('.app-header .bg-task-bar').click();await menu.waitFor();await settle(p)}};
 const dismissMenu=async()=>{if(await menu.isVisible()){await p.keyboard.press('Escape');await menu.waitFor({state:'hidden'})}};
 const start=async()=>{const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/people/jobs'&&r.request().method()==='POST');await dialog.getByRole('button',{name:'开始识别',exact:true}).click();const res=await response;assert.equal(res.status(),200);await dialog.waitFor({state:'hidden'});return res.json()};
 const control=async(label,action)=>{await background();const response=p.waitForResponse(r=>new URL(r.url()).pathname==='/api/people/jobs/control'&&r.request().postDataJSON().action===action);await menu.getByRole('button',{name:label,exact:true}).click();assert.equal((await response).status(),200);await p.waitForFunction(()=>!document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.peopleControlBusy)};
 await p.goto(f.url+'/#/people');await p.waitForLoadState('networkidle');
 await root(p,r=>{r.setAppearanceTheme('jade');r.setThemeMode('light')});await settle(p);
 await check('The start dialog contains two fields and no duplicate consent, task list or task controls',async()=>{
  await open();assert.equal(await dialog.locator('.q-select').count(),2);assert.equal(await dialog.getByRole('checkbox').count(),0);assert.equal(await dialog.locator('p').count(),0);assert.equal(await dialog.locator('.people-job-list').count(),0);
  for(const name of ['暂停','继续','重试','重试等待/失败','取消','取消未完成任务'])assert.equal(await dialog.getByRole('button',{name,exact:true}).count(),0);
  assert(await dialog.getByRole('button',{name:'开始识别',exact:true}).isEnabled());assert.equal(await p.locator('.people-footer .q-btn').count(),0);assert.deepEqual(result.writes,[]);
  await p.screenshot({path:path.join(output,'all-light.png'),animations:'disabled'});await close();
 });
 await check('Parent selection visibly cascades, survives collapse and restores preselected folder context',async()=>{
  await root(p,(r,folder)=>{r.selectedFolder=folder;r.openPeopleDialog('scan')},f.folders[0]);await dialog.getByLabel('本次范围',{exact:true}).waitFor();
  const parent=dialog.getByRole('checkbox',{name:'照片',exact:true}),child=dialog.getByRole('checkbox',{name:'子目录',exact:true});
  assert.equal(await parent.getAttribute('aria-checked'),'true');assert.equal(await child.getAttribute('aria-checked'),'true');
  const header=dialog.locator('.q-tree__node-header').filter({has:p.getByRole('checkbox',{name:'照片',exact:true})});await header.locator('.q-tree__arrow').click();await child.waitFor({state:'hidden'});await header.locator('.q-tree__arrow').click();await child.waitFor();assert.equal(await child.getAttribute('aria-checked'),'true');
  await parent.uncheck();assert.equal(await child.getAttribute('aria-checked'),'false');assert(await dialog.getByRole('button',{name:'开始识别',exact:true}).isDisabled());
  await parent.check();await child.uncheck();assert.equal(await parent.getAttribute('aria-checked'),'mixed');assert.equal(await child.getAttribute('aria-checked'),'false');
  await p.screenshot({path:path.join(output,'folder-partial-light.png'),animations:'disabled'});await close();
 });
 await check('Unchecking a child excludes it on the server while keeping direct parent media',async()=>{
  await open();await dialog.getByLabel('本次范围',{exact:true}).click();await p.getByRole('option',{name:'指定素材库文件夹',exact:true}).click();
  await dialog.getByRole('checkbox',{name:'照片',exact:true}).check();await dialog.getByRole('checkbox',{name:'子目录',exact:true}).uncheck();
  const queued=await start();assert.deepEqual([queued.queued,queued.total],[1,1]);
  assert.deepEqual(result.writes.filter(r=>r.path==='/api/people/jobs').at(-1).body,{scope:'folders',existing:'skip',folders:[],direct_folders:[f.folders[0]]});
  let status=await(await p.request.get(f.url+'/api/people/status')).json();assert.deepEqual(status.recent.filter(j=>j.state==='queued').map(j=>j.media_id),[f.media_ids[0]]);
  await control('停止','cancel');
  await open();await dialog.getByLabel('本次范围',{exact:true}).click();await p.getByRole('option',{name:'指定素材库文件夹',exact:true}).click();await dialog.getByRole('checkbox',{name:'子目录',exact:true}).check();
  assert.equal(await dialog.getByRole('checkbox',{name:'照片',exact:true}).getAttribute('aria-checked'),'mixed');await start();
  status=await(await p.request.get(f.url+'/api/people/status')).json();assert.deepEqual(status.recent.filter(j=>j.state==='queued').map(j=>j.media_id),[f.media_ids[1]]);
  await control('停止','cancel');
 });
 await check('An older backend cannot silently ignore a partially selected folder range',async()=>{
  await p.route('**/api/people/status',async route=>{const response=await route.fetch(),status=await response.json();await route.fulfill({response,json:{...status,supports_direct_folders:false}})});
  await open();await dialog.getByLabel('本次范围',{exact:true}).click();await p.getByRole('option',{name:'指定素材库文件夹',exact:true}).click();await dialog.getByRole('checkbox',{name:'照片',exact:true}).check();await dialog.getByRole('checkbox',{name:'子目录',exact:true}).uncheck();
  const writes=result.writes.length;await dialog.getByRole('button',{name:'开始识别',exact:true}).click();await dialog.getByRole('alert').filter({hasText:'后台版本不一致'}).waitFor();assert.equal(result.writes.length,writes);assert.equal(await dialog.getByRole('checkbox',{name:'照片',exact:true}).getAttribute('aria-checked'),'mixed');
  await p.unroute('**/api/people/status');await root(p,r=>r.reloadPeopleStatus());await start();await control('停止','cancel');
 });
 await check('Only imported library folders are selectable; recursive multi-select queues each item once',async()=>{
  await open();await dialog.getByLabel('本次范围',{exact:true}).click();await p.getByRole('option',{name:'指定素材库文件夹',exact:true}).click();
  assert(await dialog.getByRole('button',{name:'开始识别',exact:true}).isDisabled());assert.equal(await dialog.locator('input[type="file"]').count(),0);
  await dialog.getByRole('checkbox',{name:'照片',exact:true}).check();await dialog.getByRole('checkbox',{name:'子目录',exact:true}).check();await dialog.getByRole('checkbox',{name:'其他照片',exact:true}).check();
  await p.screenshot({path:path.join(output,'folders-light.png'),animations:'disabled'});
  const queued=await start();assert.deepEqual([queued.queued,queued.skipped,queued.total],[3,0,3]);const body=result.writes.filter(r=>r.path==='/api/people/jobs').at(-1).body;
  assert.equal(body.scope,'folders');assert.equal(body.existing,'skip');assert.equal(body.folders.length,2);assert(body.folders.every(folder=>f.folders.some(base=>folder===base||folder.startsWith(base+'/'))));
  assert(await p.locator('.app-header .bg-task-bar').isVisible());assert.equal(await p.locator('.bg-people-progress').count(),1);await root(p,r=>r.nav('#/gallery'));await p.locator('.gallery-page').waitFor();await background();assert.equal(await menu.locator('.people-background-tasks').count(),1);
 });
 await check('Pause and resume work in Header outside People; stopping removes only unfinished people jobs',async()=>{
  await control('暂停','pause');await menu.getByRole('button',{name:'继续',exact:true}).waitFor();assert.equal(await root(p,r=>r.peopleStatus.jobs.paused),3);
  await control('继续','resume');await menu.getByRole('button',{name:'暂停',exact:true}).waitFor();assert.equal(await root(p,r=>r.peopleStatus.jobs.queued),3);
  await p.screenshot({path:path.join(output,'header-running-light.png'),animations:'disabled'});
  await control('停止','cancel');await p.locator('.app-header .bg-task-bar').waitFor({state:'hidden'});assert.equal(await root(p,r=>r.peopleStatus.jobs.cancelled),3);
 });
 await check('A whole-library run needs one start action and includes imported media only',async()=>{
  await open();const queued=await start();assert.deepEqual([queued.queued,queued.total],[3,3]);
  const body=result.writes.filter(r=>r.path==='/api/people/jobs').at(-1).body;assert.deepEqual(body,{scope:'all',existing:'skip',confirm_all:true});
  const status=await(await p.request.get(f.url+'/api/people/status')).json();assert.deepEqual(status.recent.map(j=>j.media_id).sort(),[...f.media_ids].sort());
  assert(!status.recent.some(j=>['导入识别.jpg','仅导入.jpg'].includes(j.file_name)));
  await open();const again=await start();assert.deepEqual([again.queued,again.skipped],[0,3]);
 });
 await check('Selected-media context and rescan policy remain explicit and preserve the payload',async()=>{
  await control('停止','cancel');await open({media_ids:[f.media_ids[0]]});assert((await dialog.locator('.q-select').first().locator('.q-field__native').innerText()).includes('所选素材'));
  await dialog.getByLabel('已识别素材',{exact:true}).click();await p.getByRole('option',{name:'重新扫描（保留人工纠正）',exact:true}).click();const queued=await start();assert.equal(queued.queued,1);
  assert.deepEqual(result.writes.filter(r=>r.path==='/api/people/jobs').at(-1).body,{scope:'selected',existing:'rescan',media_ids:[f.media_ids[0]]});
 });
 await check('Failed enqueue preserves the form; in-flight submission blocks duplicate starts and closing',async()=>{
  await open();let release;const gate=new Promise(resolve=>release=resolve);let calls=0;
  await p.route('**/api/people/jobs',async route=>{calls++;await gate;await route.fulfill({status:409,json:{error:'合成排队失败'}})});
  await dialog.getByRole('button',{name:'开始识别',exact:true}).click();assert(await dialog.getByRole('button',{name:'开始识别',exact:true}).isDisabled());assert(await dialog.getByRole('button',{name:'关闭',exact:true}).isDisabled());
  assert.equal(calls,1);release();await dialog.getByRole('alert').filter({hasText:'合成排队失败'}).waitFor();assert(await dialog.getByRole('button',{name:'开始识别',exact:true}).isEnabled());await p.unroute('**/api/people/jobs');await start();
 });
 await check('Control errors remain in Header and a retry succeeds without reopening the start dialog',async()=>{
  await background();await p.route('**/api/people/jobs/control',route=>route.fulfill({status:409,json:{error:'合成控制失败'}}));
  await menu.getByRole('button',{name:'暂停',exact:true}).click();await menu.getByRole('alert').filter({hasText:'合成控制失败'}).waitFor();assert.equal(await dialog.count(),0);
  assert(await menu.getByRole('button',{name:'暂停',exact:true}).isEnabled());await p.unroute('**/api/people/jobs/control');await control('暂停','pause');await menu.getByRole('button',{name:'继续',exact:true}).waitFor();assert.equal(await menu.getByRole('alert').count(),0);await control('继续','resume');
  const status=await(await p.request.get(f.url+'/api/people/status')).json();let waiting=true;
  await p.route('**/api/people/status',route=>route.fulfill({json:waiting?{...status,jobs:{...status.jobs,queued:0,failed:1,waiting:2}}:status}));
  await root(p,r=>r.reloadPeopleStatus());await menu.getByRole('button',{name:'重试',exact:true}).waitFor();waiting=false;await control('重试','retry');await p.unroute('**/api/people/status');await dismissMenu();
 });
 await check('AI analysis and recognition share one Header menu and people controls do not alter AI tasks',async()=>{
  await root(p,(r,id)=>{clearInterval(r._bgPollTimer);r.bgTasks=[{id,fileName:'Existing analysis',status:'running',percent:37,stageLabel:'Analyzing',startTime:Date.now()}]},f.media_ids[0]);
  await background();assert.equal(await menu.locator('.people-background-tasks').count(),1);assert.equal(await menu.locator('.background-analysis-tasks .bg-task-item').count(),1);
  await control('停止','cancel');await menu.locator('.background-analysis-tasks').waitFor();assert.equal(await menu.locator('.people-background-tasks').count(),0);assert.equal(await root(p,r=>r.bgTasks[0].percent),37);assert(await p.locator('.app-header .bg-task-bar').isVisible());
  await root(p,r=>{r.bgTasks=[]});await p.locator('.app-header .bg-task-bar').waitFor({state:'hidden'});
 });
 await check('Compact bilingual dialogs and Header menus fit all eight appearances',async()=>{
  for(const width of [1000,1440])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark'])for(const language of ['zh','en']){
   await p.setViewportSize({width,height:width===1000?600:900});await root(p,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode);r.onLanguageChange(v.language);r.selectedFolder=null;r.openPeopleDialog('scan')},{theme,mode,language});await dialog.waitFor();await settle(p);
   const g=await dialog.evaluate(el=>{const r=el.getBoundingClientRect(),b=el.querySelector('.q-card__actions .q-btn').getBoundingClientRect();return{overflow:el.scrollWidth>el.clientWidth,x:r.x,right:r.right,y:r.y,bottom:r.bottom,buttonHeight:b.height,buttonBottom:b.bottom}});
   assert(!g.overflow);assert(g.x>=0&&g.right<=width&&g.y>=0&&g.bottom<= (width===1000?600:900));assert.equal(g.buttonHeight,32);assert(g.buttonBottom<=g.bottom);result.geometry.push({width,theme,mode,language,...g});
   if(width===1440&&theme==='jade'&&language==='zh')await p.screenshot({path:path.join(output,'all-'+mode+'.png'),animations:'disabled'});
   await dialog.getByRole('button',{name:language==='zh'?'关闭':'Close',exact:true}).click();await dialog.waitFor({state:'hidden'});
  }
  await root(p,r=>r.onLanguageChange('zh'));await open();await start();
  for(const mode of ['light','dark']){await root(p,(r,m)=>{r.setAppearanceTheme('jade');r.setThemeMode(m)},mode);await background();await settle(p);assert.equal(await menu.evaluate(el=>el.scrollWidth>el.clientWidth),false);await p.screenshot({path:path.join(output,'header-'+mode+'.png'),animations:'disabled'});await dismissMenu()}
  await control('停止','cancel');
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);assert(result.writes.every(r=>['/api/people/jobs','/api/people/jobs/control'].includes(r.path)));result.ok=true;
})().catch(e=>{result.failure=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.checks.length,failure:result.failure,errors:result.errors,failed:result.failed}))});
