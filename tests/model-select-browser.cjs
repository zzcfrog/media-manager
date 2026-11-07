const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));
assert(fixture.managed_models&&fixture.scratch.includes('video-analyzer-tests-'));
const output=path.resolve(process.env.MODEL_SELECT_OUTPUT||'build/model-selectors-2026-11-06/browser');fs.mkdirSync(output,{recursive:true});
const result={checks:[],errors:[],failed:[],writes:[],geometry:[]};let browser,page;
const root=(page,fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
(async()=>{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
 page.on('pageerror',error=>result.errors.push(error.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 page.on('request',r=>{if(r.method()==='POST'||r.method()==='PATCH')result.writes.push({path:new URL(r.url()).pathname,body:r.postDataJSON()})});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const dialog=page.locator('.settings-dialog'),row=stage=>page.locator('.face-model-stage[data-stage="'+stage+'"]');
 const open=async(kind='people')=>{await root(page,(r,k)=>r.openRecognitionSettings(k),kind);await dialog.waitFor();await page.waitForFunction(()=>{const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return r.settingsLoaded&&!Object.values(r.recognitionLoading).some(Boolean)&&!r.faceCatalogLoading&&!r.classificationCatalogLoading})};
 const close=async()=>{await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'})};
 const save=async()=>{await dialog.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'hidden'})};
 const tab=async name=>{await dialog.getByRole('tab',{name,exact:true}).click();await page.waitForFunction(()=>{const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return !r.faceCatalogLoading&&!r.classificationCatalogLoading&&document.querySelectorAll('.settings-dialog .q-tab-panel').length===1})};
 const menu=()=>page.locator('.q-menu:visible').filter({has:page.locator('.model-select-option')}).last();
 const combo=name=>page.getByRole('combobox',{name,exact:true});
 const menuClosed=()=>page.waitForFunction(()=>!document.querySelector('.q-menu .model-select-option'));
 const dismiss=async()=>{await page.keyboard.press('Escape');await menuClosed()};
 const select=async(name,label)=>{await combo(name).click();await menu().getByRole('option',{name:label,exact:true}).click();await menuClosed()};
 const download=async(name,label)=>{await combo(name).click();await menu().getByRole('button',{name:'下载模型 '+label,exact:true}).click();await page.locator('.q-dialog:visible').last().getByRole('button',{name:/^(下载|开始下载)$/}).click()};
 const settle=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
 const read=async endpoint=>(await page.request.get(fixture.url+endpoint)).json();
 const control=async data=>{assert((await page.request.post(fixture.url+'/fixture/models/control',{data})).ok())};
 await page.goto(fixture.url);await page.waitForLoadState('networkidle');
 await check('Only the six pack choices are selectable; stage cards contain no model or file inputs',async()=>{
  await open();await combo('模型组合').click();await menu().waitFor();assert.equal(await menu().getByRole('option').count(),7);
  assert.equal(await menu().getByRole('option',{name:'自定义组合',exact:true}).count(),0);assert((await menu().innerText()).includes('InsightFace'));
  assert.equal(await menu().getByRole('button',{name:'下载模型 Raccoon S',exact:true}).count(),1);await dismiss();
  const cards=page.locator('.face-model-stages');assert.equal(await cards.locator('[role="combobox"],input:not([type="checkbox"]),.face-path-pick').count(),0);
  for(const [name,profile] of [['Buffalo L','buffalo_l'],['Buffalo M','buffalo_m'],['Buffalo S','buffalo_s'],['Buffalo SC','buffalo_sc'],['Raccoon L','raccoon_l'],['Raccoon S','raccoon_s']]){
   await select('模型组合',name);
   const state=await root(page,r=>({profile:r.recognitionSettings.people.profile,verify:r.recognitionSettings.people.verify_enabled,paths:['detector','recognizer','verifier'].map(s=>r.recognitionSettings.people[s+'_path'])}));
   assert.equal(state.profile,profile);assert.equal(state.verify,profile.startsWith('raccoon_'));
   if(profile!=='buffalo_l')assert(state.paths.every(value=>!value));
  }
  await close();
 });
 await check('Downloading the selected pack binds every provided stage, then saves and reloads as one pack',async()=>{
  await open();await select('模型组合','Raccoon S');assert.equal(await root(page,r=>r.recognitionSettings.people.detector_path),'');
  await download('模型组合','Raccoon S');
  await page.waitForFunction(()=>{const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return r.faceDownload.state==='done'&&r.recognitionSettings.people.recognizer_model==='raccoon_s:recognizer'});
  for(const stage of ['detector','recognizer','verifier'])assert.equal(await root(page,(r,s)=>r.recognitionSettings.people[s+'_model'],stage),'raccoon_s:'+stage);
  assert.equal(await root(page,r=>r.recognitionSettings.people.profile),'raccoon_s');assert.equal(await root(page,r=>r.recognitionSettings.people.verify_enabled),true);
  assert.deepEqual(result.writes.find(r=>r.path==='/api/people/models/download').body,{profile:'raccoon_s',subdirectory:'faces/raccoon_s'});
  await save();await open();for(const stage of ['detector','recognizer','verifier'])assert.equal(await root(page,(r,s)=>r.recognitionSettings.people[s+'_model'],stage),'raccoon_s:'+stage);await close();
 });
 await check('Changing packs replaces all stage references and confirmation or cancellation controls persistence',async()=>{
  await open();await select('模型组合','Buffalo L');
  assert.equal(await root(page,r=>r.recognitionSettings.people.detector_model),'buffalo_l:detector');assert.equal(await root(page,r=>r.recognitionSettings.people.recognizer_model),'buffalo_l:recognizer');
  assert.equal(await root(page,r=>r.recognitionSettings.people.verifier_path),'');assert.equal(await row('verifier').getByRole('switch').isDisabled(),true);
  assert.equal(await page.locator('.face-model-stages [role="combobox"],.face-model-stages input:not([type="checkbox"])').count(),0);
  await close();assert.equal((await read('/api/people/status')).settings.profile,'raccoon_s');
 });
 await check('SigLIP2 download failure is visible, retry can cancel, and interrupted files never become installed',async()=>{
  await open('classification');await combo('快速分类模型列表').click();await menu().waitFor();assert.equal(await menu().getByRole('option').count(),18);assert((await menu().innerText()).includes('Google'));assert.equal(await menu().getByRole('option',{name:'外部模型',exact:true}).count(),0);await dismiss();
  assert.equal(await page.getByLabel('SigLIP2 模型目录',{exact:true}).count(),0);assert.equal(await dialog.getByRole('switch',{name:'导入后在后台快速分类',exact:true}).count(),0);
  await control({classification_error:true});await download('快速分类模型列表','SigLIP 2 Base/16 · 224');
  await dialog.getByRole('alert').filter({hasText:'完整性校验失败'}).waitFor();assert.equal((await read('/api/taxonomy/models/catalog')).models[0].installed,false);
  await control({classification_error:false,delay:.5});await download('快速分类模型列表','SigLIP 2 Base/16 · 224');
  await dialog.getByRole('button',{name:'取消下载',exact:true}).click();await dialog.getByText('下载已取消',{exact:true}).waitFor();
  assert.equal((await read('/api/taxonomy/models/catalog')).models[0].installed,false);await close();
 });
 await check('A completed classification download cannot overwrite an edited draft or a reopened settings session',async()=>{
  await open('classification');await control({delay:.2});await download('快速分类模型列表','SigLIP 2 Base/16 · 224');
  await select('快速分类模型列表','SigLIP 2 Base/32 · 256');
  await page.waitForFunction(()=>document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.classificationDownload.state==='done');
  assert.equal(await root(page,r=>r.recognitionSettings.classification.classification_model_id),'siglip2-base-patch32-256-fp32');
  await close();await open('classification');assert.equal(await root(page,r=>r.recognitionSettings.classification.classification_model_id),'');
  await select('快速分类模型列表','SigLIP 2 Base/16 · 224');
  assert.equal(await root(page,r=>r.recognitionSettings.classification.classification_model_id),'siglip2-base-patch16-224-fp32');await save();await open('classification');
  assert.equal(await root(page,r=>r.recognitionSettings.classification.classification_model_id),'siglip2-base-patch16-224-fp32');await close();
 });
 await check('Downloading the same installed model reuses it and applies only to an unchanged draft',async()=>{
  await open('classification');await select('快速分类模型列表','SigLIP 2 Base/32 · 256');
  await root(page,r=>r.startClassificationDownload('siglip2-base-patch16-224-fp32'));
  assert.equal(await root(page,r=>r.recognitionSettings.classification.classification_model_id),'siglip2-base-patch16-224-fp32');await close();
 });
 await check('Omni shares the existing model catalogue and download service; image, video and audio use the same rows',async()=>{
  await open('classification');await download('本地补充与词库模型列表','Qwen3-Omni 30B-A3B (MoE·音频)');
  await page.waitForFunction(()=>{const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return r.localModels.some(m=>m.id==='qwen3-omni-30b-a3b'&&m.installed)});
  await select('本地补充与词库模型列表','Qwen3-Omni 30B-A3B (MoE·音频)');
  assert(result.writes.some(r=>r.path==='/api/local-vlm/download'&&r.body.model_id==='qwen3-omni-30b-a3b'));
  for(const name of ['图片分析','视频分析','音乐分析']){
   await tab(name);await root(page,(r,n)=>{if(n==='图片分析')r.settingsForm.imageEngine='local';else if(n==='视频分析')r.settingsForm.videoEngine='local';else r.settingsForm.musicEngine='local'},name);
   const field=dialog.getByRole('combobox',{name:'本地模型',exact:true});await field.click();await menu().getByRole('option',{name:'Qwen3-Omni 30B-A3B (MoE·音频)',exact:true}).waitFor();assert.equal(await menu().locator('[role="option"] button').count(),0);await dismiss();
  }
  await close();
 });
 await check('Keyboard selection, accessible action names, disabled verification and connected dropdown corners work',async()=>{
  await open();const input=combo('模型组合');await input.focus();await page.keyboard.press('ArrowDown');await menu().waitFor();
  await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');await menuClosed();
  await select('模型组合','Buffalo L');assert.equal(await root(page,r=>r.recognitionSettings.people.profile),'buffalo_l');assert.equal(await root(page,r=>r.recognitionSettings.people.verify_enabled),false);
  const toggle=row('verifier').getByRole('switch');if(await toggle.getAttribute('aria-checked')==='true')await toggle.click();assert(await row('verifier').evaluate(el=>el.classList.contains('face-model-stage--disabled')));
  await input.click();await settle();
  const corners=await input.locator('..').evaluate(el=>{const s=getComputedStyle(el.closest('.q-field').querySelector('.q-field__control'));return [s.borderBottomLeftRadius,s.borderBottomRightRadius]});assert.deepEqual(corners,['0px','0px']);
  const actions=menu().getByRole('button');for(let i=0;i<await actions.count();i++)assert(await actions.nth(i).getAttribute('aria-label'));
  await dismiss();await close();
 });
 await check('Shared lists and stage cards fit all themes and both appearances without horizontal clipping',async()=>{
  for(const width of [1000,1440]){await page.setViewportSize({width,height:800});await open();
   for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
    await root(page,(r,x)=>{r.setAppearanceTheme(x.theme);r.setThemeMode(x.mode)},{theme,mode});await settle();
    assert.equal(await page.locator('html').getAttribute('data-appearance-theme'),theme);assert.equal(await page.locator('html').getAttribute('data-appearance-mode'),mode);
    const geometry=await dialog.evaluate(el=>({width:el.clientWidth,overflow:el.scrollWidth>el.clientWidth,cards:[...el.querySelectorAll('.face-model-stage')].map(c=>c.scrollWidth>c.clientWidth)}));
    assert(!geometry.overflow&&!geometry.cards.some(Boolean));result.geometry.push({width,theme,mode,...geometry});
    if(width===1440&&theme==='jade'){await dialog.screenshot({path:path.join(output,'faces-'+mode+'.png')});await tab('智能分类');await dialog.screenshot({path:path.join(output,'classification-'+mode+'.png')});await tab('人脸识别');}
   }await close();
  }
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);
 assert(!result.writes.some(r=>r.path.includes('/jobs')||r.path.startsWith('/api/analysis')));result.ok=true;
})().catch(async error=>{result.ok=false;result.error=error.stack;console.error(error);await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});process.exitCode=1}).finally(async()=>{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));await browser?.close()});
