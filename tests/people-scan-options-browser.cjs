const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const f=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE||'/tmp/luminisle-people-scan-fixture.json'));
assert(f.scratch.includes('video-analyzer-tests-'));assert.equal(f.media_ids.length,3);
const output=path.resolve(process.env.PEOPLE_SCAN_OPTIONS_OUTPUT||'build/people-scan-options-validation');fs.mkdirSync(output,{recursive:true});let browser;
const result={checks:[],errors:[],failed:[]};
const root=(page,fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(7000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const settings=page.locator('.settings-dialog');const cancel=async()=>{await settings.getByRole('button',{name:'取消',exact:true}).click();await settings.waitFor({state:'hidden'})};
 await page.goto(f.url);await page.waitForLoadState('networkidle');
 await check('All six packs and independent optional stages are available without the old global controls',async()=>{
  await root(page,r=>r.openRecognitionSettings('people'));await settings.waitFor();
  const select=page.getByLabel('模型组合',{exact:true});await select.click();
  for(const name of ['Buffalo L','Buffalo M','Buffalo S','Buffalo SC','Raccoon L','Raccoon S'])await page.getByRole('option',{name,exact:true}).waitFor();
  await page.getByRole('option',{name:'自定义组合',exact:true}).click();
  await page.getByLabel('人脸检测模型',{exact:true}).fill('/synthetic/det.onnx');await page.getByLabel('人脸特征模型',{exact:true}).fill('/synthetic/rec.onnx');
  assert.equal(await page.getByLabel('每个视频最多采样帧数（1～48）',{exact:true}).count(),0);
  assert.equal(await page.getByRole('switch',{name:'今后导入后，自动在后台整理人物',exact:true}).count(),0);
  const verify=page.getByRole('switch',{name:'启用人脸复核',exact:true});if(await verify.getAttribute('aria-checked')!=='true')await verify.click();await page.getByLabel('人脸复核模型（可选）',{exact:true}).fill('/synthetic/verify.onnx');
  await settings.getByRole('button',{name:'确定',exact:true}).click();await settings.waitFor({state:'hidden'});
  const saved=(await(await page.request.get(f.url+'/api/people/status')).json()).settings;
  assert.equal(saved.profile,'custom');assert.equal(saved.verify_enabled,true);assert.equal(saved.verifier_path,'/synthetic/verify.onnx');
  await root(page,r=>r.openRecognitionSettings('people'));await page.getByLabel('人脸特征模型',{exact:true}).waitFor();
  await page.getByLabel('视频人脸检测帧率',{exact:true}).waitFor();
  await root(page,r=>{r.settingsForm.fps='120';r.settingsForm.localFps='.25'});assert.equal(await root(page,r=>r.recognitionSettings.people.video_fps),1);
  assert.equal(await page.getByLabel('每次出镜取样数',{exact:true}).inputValue(),'4');
  assert.equal(await settings.getByRole('button',{name:'分辨率设置',exact:true}).count(),0);await cancel();
 });
 await check('People scan supports multiple library folders, recursive scope, skip and rescan',async()=>{
  await root(page,r=>r.nav('#/people'));await page.locator('.people-toolbar').getByRole('button',{name:'人脸识别',exact:true}).click();
  const dialog=page.locator('.people-dialog');await dialog.getByLabel('本次范围',{exact:true}).click();await page.getByRole('option',{name:'指定素材库文件夹',exact:true}).click();
  await dialog.getByRole('checkbox',{name:'照片',exact:true}).check();await dialog.getByRole('checkbox',{name:'其他照片',exact:true}).check();
  const response=page.waitForResponse(r=>r.url().endsWith('/api/people/jobs')&&r.request().method()==='POST');
  await dialog.getByRole('button',{name:'开始识别',exact:true}).click();assert.equal((await(await response).json()).queued,3);
  await root(page,r=>r.openPeopleDialog('scan',{media_ids:[1]}));await dialog.getByRole('button',{name:'开始识别',exact:true}).waitFor();
  await dialog.getByLabel('已识别素材',{exact:true}).click();await page.getByRole('option',{name:'重新扫描（保留人工纠正）',exact:true}).click();
  const skipped=page.waitForResponse(r=>r.url().endsWith('/api/people/jobs')&&r.request().method()==='POST');await dialog.getByRole('button',{name:'开始识别',exact:true}).click();assert.equal((await(await skipped).json()).skipped,1);
 });
 await check('Import recognition checkbox is explicit and does not persist into the next import',async()=>{
  await root(page,(r,p)=>{r.openImport();r.selectedPaths=[p]},f.import_paths[0]);
  await page.getByRole('checkbox',{name:'导入后在后台识别人脸',exact:true}).check();
  const sent=page.waitForRequest(r=>r.url().endsWith('/api/library/import-batch'));
  await page.getByRole('button',{name:'确认导入',exact:true}).click();assert.equal((await sent).postDataJSON().organize_people,true);
  await page.getByText('导入完成',{exact:true}).waitFor();
  await root(page,(r,p)=>{r.showImport=false;r.openImport();r.selectedPaths=[p]},f.import_paths[1]);
  assert.equal(await page.getByRole('checkbox',{name:'导入后在后台识别人脸',exact:true}).isChecked(),false);
  const unchecked=page.waitForRequest(r=>r.url().endsWith('/api/library/import-batch'));await page.getByRole('button',{name:'确认导入',exact:true}).click();assert.equal((await unchecked).postDataJSON().organize_people,false);
  await page.getByText('导入完成',{exact:true}).waitFor();
  const status=await(await page.request.get(f.url+'/api/people/status')).json();assert(status.recent.some(j=>j.file_name==='导入识别.jpg'));assert(!status.recent.some(j=>j.file_name==='仅导入.jpg'));
 });
 await check('Custom model and folder scan dialogs fit all themes, modes and desktop sizes',async()=>{
  await root(page,r=>{r.showImport=false;r.openRecognitionSettings('people')});await page.getByLabel('人脸特征模型',{exact:true}).waitFor();
  const settled=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
  for(const width of [1000,1600])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await page.setViewportSize({width,height:width===1000?600:900});await root(page,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});await settled();
   for(const selector of ['.settings-dialog','.recognition-settings']){const g=await page.locator(selector).evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right}));assert.equal(g.overflow,false);assert(g.left>=0&&g.right<=width);}
   if(width===1600&&theme==='jade')await page.screenshot({path:path.join(output,'custom-'+mode+'.png'),animations:'disabled'});
  }
  await cancel();await root(page,r=>r.openPeopleDialog('scan'));await page.getByLabel('本次范围',{exact:true}).click();await page.getByRole('option',{name:'指定素材库文件夹',exact:true}).click();
  const scan=page.locator('.people-scan-dialog');
  for(const width of [1000,1600])for(const mode of ['light','dark']){await page.setViewportSize({width,height:width===1000?600:900});await root(page,(r,m)=>r.setThemeMode(m),mode);await settled();assert.equal(await scan.evaluate(el=>el.scrollWidth>el.clientWidth),false);const start=scan.getByRole('button',{name:'开始识别',exact:true});await start.scrollIntoViewIfNeeded();assert(await start.isVisible());if(width===1600)await page.screenshot({path:path.join(output,'scan-'+mode+'.png'),animations:'disabled'});}
  await scan.getByRole('button',{name:'关闭',exact:true}).click();
 });
 await check('Unassigned uncertain faces can be corrected or dismissed without confirming an absent identity',async()=>{
  await root(page,r=>r.nav('#/people/review'));await page.getByRole('tab',{name:'待确认人脸',exact:true}).click();
  await page.getByRole('button',{name:'指定人物',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'原归属正确',exact:true}).count(),0);
  await page.getByRole('button',{name:'暂时忽略',exact:true}).click();await page.getByText('目前没有待核对项目',{exact:true}).waitFor();
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(e=>{result.failure=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))});
