const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const f=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));assert(f.managed_models&&f.scratch.includes('video-analyzer-tests-'));
const out=path.resolve(process.env.OPTIONAL_MODELS_OUTPUT||'build/optional-models-import-2026-11-06/browser');fs.mkdirSync(out,{recursive:true});
const result={checks:[],errors:[],failed:[]};let browser,page;
const root=(fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
(async()=>{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(12000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const dialog=page.locator('.settings-dialog');
 const open=async kind=>{await root((r,k)=>r.openRecognitionSettings(k),kind);await dialog.waitFor();await page.waitForFunction(()=>{const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return r.settingsLoaded&&!Object.values(r.recognitionLoading).some(Boolean)&&!r.faceCatalogLoading&&!r.classificationCatalogLoading})};
 const tab=async name=>{await dialog.getByRole('tab',{name,exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.settings-dialog .q-tab-panel').length===1)};
 const close=async()=>{await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'})};
 const save=async()=>{await dialog.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'hidden'})};
 const selectionText=label=>page.getByRole('combobox',{name:label,exact:true}).evaluate(el=>el.closest('.q-field').innerText);
 const select=async(label,option)=>{await page.getByRole('combobox',{name:label,exact:true}).click();await page.getByRole('option',{name:option,exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.q-menu [role="option"]'))};
 const read=async url=>(await page.request.get(f.url+url)).json();
 const none=async label=>{await page.getByRole('combobox',{name:label,exact:true}).click();const option=page.getByRole('option',{name:'不启用',exact:true});await option.waitFor();assert.equal(await option.locator('button').count(),0);const row=option.locator('..');assert.equal(await row.getByRole('button').count(),0);await option.click();await page.waitForFunction(()=>!document.querySelector('.q-menu [role="option"]'))};
 const settle=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
 const importBox=()=>page.getByRole('dialog',{name:'导入素材',exact:true});
 const openImport=async()=>{await root(r=>r.openImport());await importBox().waitFor();await page.waitForFunction(()=>!document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.importOptionsLoading)};
 const closeImport=async()=>{await importBox().getByRole('button',{name:'关闭导入',exact:true}).click();await importBox().waitFor({state:'hidden'})};
 await page.goto(f.url);await page.waitForLoadState('networkidle');
 await check('Image/video engine labels omit vendors and all three tabs put Cloud before Local',async()=>{
  await open('image');for(const name of ['图片分析','视频分析','音乐分析']){await tab(name);assert.deepEqual(await dialog.locator('.engine-toggle').first().getByRole('button').allTextContents(),['云端','本地'])}await close();
 });
 await check('A cloud model can be disabled and persists without affecting the other analysis features',async()=>{
  await open('image');await none('图片云端模型');assert.equal(await root(r=>r.settingsForm.imageAnalysisEnabled),false);assert.equal(await root(r=>r.settingsForm.videoAnalysisEnabled),true);await save();
  assert.equal((await read('/api/settings/')).image_analysis_enabled,'false');await open('image');assert((await selectionText('图片云端模型')).includes('不启用'));await close();
 });
 await check('Shared local weights retain independent image/video opt-outs; cancellation keeps the saved choices',async()=>{
  await open('image');await dialog.locator('.engine-toggle').first().getByRole('button',{name:'本地',exact:true}).click();await none('本地模型');
  await tab('视频分析');await dialog.locator('.engine-toggle').first().getByRole('button',{name:'本地',exact:true}).click();const installed=await root(r=>r.computedLocalModelOptions.find(m=>m.installed).name);await select('本地模型',installed);await save();
  await open('image');assert((await selectionText('本地模型')).includes('不启用'));await select('本地模型',installed);await tab('视频分析');await none('本地模型');assert.equal(await root(r=>r.settingsForm.imageAnalysisEnabled),true);await close();
  await open('video');assert.equal(await root(r=>r.settingsForm.imageAnalysisEnabled),false);assert.equal(await root(r=>r.settingsForm.videoAnalysisEnabled),true);await close();
 });
 await check('Music and speech models offer None without a fallback or a reload of a disabled model',async()=>{
  await open('music');await none('本地模型');await save();await open('music');await root(r=>r.refreshLocalModels());assert.equal(await root(r=>r.settingsForm.musicAnalysisEnabled),false);assert((await selectionText('本地模型')).includes('不启用'));await tab('视频分析');await none('语音转写模型');
  const reloads=[];const listener=r=>{if(r.url().endsWith('/api/analysis/asr-reload'))reloads.push(r.url())};page.on('request',listener);await save();page.off('request',listener);assert.deepEqual(reloads,[]);assert.equal((await read('/api/settings/')).asr_model,'none');
 });
 await check('None disables the face pack, removes active cards and round-trips without deleting the previous pack',async()=>{
  await open('people');const profile=await root(r=>r.recognitionSettings.people.profile);await none('模型组合');assert.equal(await page.locator('.face-model-stages').count(),0);await save();const status=await read('/api/people/status');assert.equal(status.settings.model_enabled,false);assert.equal(status.settings.profile,profile);assert.equal(status.model.ready,false);
  await open('people');assert((await selectionText('模型组合')).includes('不启用'));await select('模型组合','Buffalo L');assert.equal(await page.locator('.face-model-stage').count(),3);await close();assert.equal((await read('/api/people/status')).settings.model_enabled,false);
 });
 await check('Fast and shared refinement/vocabulary models can each be disabled and remain off after reopening',async()=>{
  await open('classification');await none('快速分类模型列表');await none('本地补充与词库模型列表');assert(await page.getByRole('switch',{name:'本地模型补充标签',exact:true}).isDisabled());assert(await page.getByRole('switch',{name:'AI 整理词库关系',exact:true}).isDisabled());await save();
  const config=await read('/api/taxonomy/configuration');assert.equal(config.classification_model_enabled,'false');assert.equal(config.classification_omni_model,'none');await open('classification');for(const label of ['快速分类模型列表','本地补充与词库模型列表'])assert((await selectionText(label)).includes('不启用'));await close();
 });
 await check('Explicitly choosing None during download prevents completion from re-enabling classification',async()=>{
  await open('classification');await page.request.post(f.url+'/fixture/models/control',{data:{delay:.2}});await page.getByRole('combobox',{name:'快速分类模型列表',exact:true}).click();await page.getByRole('button',{name:'下载模型 SigLIP 2 Base/16 · 224',exact:true}).click();await page.locator('.q-dialog:visible').last().getByRole('button',{name:'下载',exact:true}).click();await none('快速分类模型列表');
  await page.waitForFunction(()=>document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.classificationDownload.state==='done');assert.equal(await root(r=>r.recognitionSettings.classification.classification_model_enabled),'false');await close();
 });
 await check('Choosing None during a face pack download also prevents automatic activation',async()=>{
  await open('people');await page.getByRole('combobox',{name:'模型组合',exact:true}).click();await page.getByRole('button',{name:'下载模型 Raccoon S',exact:true}).click();await page.locator('.face-download-dialog').getByRole('button',{name:'下载',exact:true}).click();await none('模型组合');
  await page.waitForFunction(()=>document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.faceDownload.state==='done');assert.equal(await root(r=>r.recognitionSettings.people.model_enabled),false);assert.equal(await page.locator('.face-model-stages').count(),0);await close();
 });
 await check('Import uses real buttons and illustrated, disabled organization cards when their models are off',async()=>{
  await page.evaluate(({file,folder})=>{window._pickers={files:0,folders:0};window.electronAPI={selectFiles:async()=>{window._pickers.files++;return[file]},selectDirectory:async()=>{window._pickers.folders++;return[folder]},setTheme:async()=>{}}},{file:f.import_paths[0],folder:f.folders[0]});
  await openImport();const box=importBox();assert.equal(await box.locator('.import-link').count(),0);assert.equal(await box.locator('.import-feature-art[aria-hidden="true"]').count(),2);
  for(const label of ['导入后在后台快速分类','导入后在后台识别人脸'])assert(await box.getByRole('switch',{name:label,exact:true}).isDisabled());
  await box.getByRole('button',{name:'选择文件',exact:true}).click();await box.getByRole('button',{name:'选择文件夹',exact:true}).click();assert.deepEqual(await page.evaluate(()=>window._pickers),{files:1,folders:1});assert.equal(await root(r=>r.selectedPaths.length),2);
  for(const button of await box.locator('.import-pick-button').all()){const size=await button.boundingBox();assert(size.height>=32);assert(await button.evaluate(el=>getComputedStyle(el).boxShadow!=='none'))}await closeImport();
 });
 await check('Organization switches support keyboard, scope descriptions and enabled state',async()=>{
  assert((await page.request.patch(f.url+'/api/people/settings',{data:{model_enabled:true}})).ok());assert((await page.request.patch(f.url+'/api/taxonomy/configuration',{data:{classification_model_enabled:'true'}})).ok());await openImport();
  const box=importBox();for(const label of ['导入后在后台快速分类','导入后在后台识别人脸']){const c=box.getByRole('switch',{name:label,exact:true});assert(!(await c.isChecked()));await c.focus();await page.keyboard.press('Space');assert(await c.isChecked());assert(await c.evaluate(el=>el.closest('.import-feature-card').classList.contains('import-feature-card--selected')));assert.equal(await c.locator('button,a,input[type="text"]').count(),0);const id=await c.getAttribute('aria-describedby');assert(id&&await page.locator('#'+id).count()===1)}const scope=box.getByRole('group',{name:'人脸识别素材类型',exact:true});await scope.waitFor();assert(await scope.evaluate(el=>!!el.closest('.import-feature-card--people')));assert.equal(await box.locator('.import-options-heading .import-options-note').count(),1);await scope.getByRole('button',{name:'仅视频',exact:true}).click();assert(await box.getByRole('switch',{name:'导入后在后台识别人脸',exact:true}).isChecked());assert.equal(await root(r=>r.importPeopleMediaType),'video');await closeImport();
 });
 await check('Import setting failures preserve ordinary import and can retry; stale responses cannot overwrite a reopened dialog',async()=>{
  await page.route('**/api/library/import-options',route=>route.fulfill({status:503,json:{error:'Synthetic options failure'}}),{times:1});await openImport();await importBox().getByRole('alert').waitFor();await importBox().getByRole('button',{name:'重试',exact:true}).click();await page.waitForFunction(()=>!document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.importOptionsLoading);assert.equal(await importBox().getByRole('alert').count(),0);await closeImport();
  let release;const gate=new Promise(r=>release=r);await page.route('**/api/library/import-options',async route=>{await gate;await route.fulfill({json:{classification_enabled:false,people_enabled:false}})},{times:1});const request=page.waitForRequest('**/api/library/import-options');await root(r=>r.openImport());await request;await closeImport();await openImport();release();await page.waitForLoadState('networkidle');assert.equal(await root(r=>r.importModelAvailability.people_enabled),true);await closeImport();
 });
 await check('Saving a disabled model refreshes an already open import dialog',async()=>{
  await openImport();await open('people');await none('模型组合');await save();await page.waitForFunction(()=>!document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.importOptionsLoading);assert(await importBox().getByRole('switch',{name:'导入后在后台识别人脸',exact:true}).isDisabled());await closeImport();await page.request.patch(f.url+'/api/people/settings',{data:{model_enabled:true}});
 });
 await check('Import buttons and cards fit four themes, both appearances and compact windows; English remains clear',async()=>{
  await openImport();await importBox().getByRole('switch',{name:'导入后在后台快速分类',exact:true}).check();await importBox().getByRole('switch',{name:'导入后在后台识别人脸',exact:true}).check();
  for(const width of [1000,1440])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await page.setViewportSize({width,height:width===1000?600:900});await root((r,x)=>{r.setAppearanceTheme(x.theme);r.setThemeMode(x.mode)},{theme,mode});await settle();const geometry=await page.locator('.import-dialog').evaluate(el=>{const b=el.getBoundingClientRect(),note=el.querySelector('.import-options-note'),heading=note.parentElement;return{noteAligned:Math.abs(note.getBoundingClientRect().right-heading.getBoundingClientRect().right)<1&&getComputedStyle(note).textAlign==='right',inside:b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight,overflow:el.scrollWidth>el.clientWidth,cards:[...el.querySelectorAll('.import-feature')].map(c=>c.scrollWidth>c.clientWidth)}});assert(geometry.noteAligned&&geometry.inside&&!geometry.overflow&&!geometry.cards.some(Boolean));if(width===1440&&theme==='jade')await page.screenshot({path:path.join(out,'import-'+mode+'.png'),animations:'disabled'});
  }
  await root(r=>r.onLanguageChange('en'));await page.getByRole('switch',{name:'Classify in the background after import',exact:true}).waitFor();await page.getByRole('button',{name:'Select Files',exact:true}).waitFor();
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(async e=>{result.failure=e.stack;console.error(e);process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})}).finally(async()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));await browser?.close()});
