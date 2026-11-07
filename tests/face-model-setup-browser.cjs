const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const f=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));assert(f.managed_models&&f.scratch.includes('video-analyzer-tests-'));
const output=path.resolve(process.env.FACE_MODEL_SETUP_OUTPUT||'build/face-model-setup-validation');fs.mkdirSync(output,{recursive:true});
const result={checks:[],errors:[],failed:[]};let browser,page;
const root=(fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
(async()=>{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const dialog=page.locator('.settings-dialog'),cards=page.locator('.face-model-stages'),row=stage=>page.locator('.face-model-stage[data-stage="'+stage+'"]');
 const open=async()=>{await root(r=>r.openRecognitionSettings('people'));await page.getByLabel('模型组合',{exact:true}).waitFor();await page.waitForFunction(()=>{const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return !r.faceCatalogLoading&&!r.recognitionLoading.people})};
 const close=async()=>{await dialog.getByRole('button',{name:'取消',exact:true}).click();await dialog.waitFor({state:'hidden'})};
 const preset=async name=>{await page.getByRole('combobox',{name:'模型组合',exact:true}).click();await page.getByRole('option',{name,exact:true}).click();await page.waitForFunction(()=>!document.querySelector('.q-menu .model-select-option'))};
 const settled=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
 const saved=async()=>(await(await page.request.get(f.url+'/api/people/status')).json()).settings;
 await page.goto(f.url);await page.waitForLoadState('networkidle');
 await check('All six presets show read-only model information without per-stage selectors, paths or file actions',async()=>{
  await open();const before=await saved();
  for(const [name,recognizer] of [['Buffalo L','ResNet-50'],['Buffalo M','ResNet-50'],['Buffalo S','MobileFaceNet'],['Buffalo SC','MobileFaceNet'],['Raccoon L','ResNet-50'],['Raccoon S','MobileFaceNet']]){
   await preset(name);assert.equal(await cards.getByRole('group').count(),3);assert.equal(await cards.locator('input:not([type="checkbox"]),[role="combobox"],.face-path-pick').count(),0);
   assert.equal(await cards.getByRole('button',{name:/选择|下载|Choose|Download/}).count(),0);
   assert((await row('detector').locator('.face-stage-model').innerText()).includes('SCRFD'));assert((await row('recognizer').locator('.face-stage-model').innerText()).includes(recognizer));
   assert.equal(await row('verifier').getByRole('switch').getAttribute('aria-checked'),String(name.startsWith('Raccoon')));
   assert.equal(await row('verifier').getByRole('switch').isDisabled(),name.startsWith('Buffalo'));
   assert.equal(await dialog.getByText('请选择下方模型文件',{exact:true}).count(),0);await page.getByText('随上方组合自动配置',{exact:true}).waitFor();
  }
  assert.deepEqual(await saved(),before);await close();
 });
 await check('An installed pack binds every file automatically and persists only on confirmation',async()=>{
  await open();await preset('Buffalo L');
  await root((r,file)=>{r.recognitionSettings.people.verifier_path=file;r.recognitionSettings.people.verifier_model='raccoon_s:verifier'},f.stage_paths.verifier);
  await preset('Buffalo L');assert.equal(await root(r=>r.recognitionSettings.people.verifier_path),'');assert.equal(await root(r=>r.recognitionSettings.people.verifier_model),'');
  for(const stage of ['detector','recognizer']){
   assert.equal(await root((r,s)=>r.recognitionSettings.people[s+'_model'],stage),'buffalo_l:'+stage);
   await row(stage).getByRole('button',{name:'核验模型',exact:true}).click();await row(stage).getByText('接口核验通过',{exact:true}).waitFor();
  }
  await dialog.getByRole('button',{name:'确定',exact:true}).click();await dialog.waitFor({state:'hidden'});await open();
  const before=await saved();assert.equal(before.detector_model,'buffalo_l:detector');assert.equal(before.recognizer_model,'buffalo_l:recognizer');
  await preset('Raccoon L');assert.equal(await root(r=>r.recognitionSettings.people.detector_path),'');assert.equal(await root(r=>r.recognitionSettings.people.recognizer_path),'');
  assert.equal(await row('detector').getByRole('button',{name:'核验模型',exact:true}).isDisabled(),true);await close();assert.deepEqual(await saved(),before);
 });
 await check('Late checks cannot mark a newly selected pack as valid',async()=>{
  await open();await preset('Buffalo L');let release;const gate=new Promise(r=>release=r);
  await page.route('**/api/people/models/probe',async route=>{await gate;await route.fulfill({json:{compatible:true,stage:'detector'}})},{times:1});
  const pending=page.waitForRequest('**/api/people/models/probe');await row('detector').getByRole('button',{name:'核验模型',exact:true}).click();await pending;
  await preset('Raccoon L');release();await page.waitForLoadState('networkidle');assert.equal(await row('detector').getByText('接口核验通过',{exact:true}).count(),0);await close();
 });
 await check('Read-only file checks report errors, deduplicate pending checks and allow retry',async()=>{
  await open();await preset('Buffalo L');let release,count=0;const gate=new Promise(r=>release=r);
  await page.route('**/api/people/models/probe',async route=>{count++;await gate;await route.fulfill({status:503,json:{error:'Synthetic check failure'}})});
  const pending=page.waitForRequest('**/api/people/models/probe');await row('detector').getByRole('button',{name:'核验模型',exact:true}).click();await pending;
  await root(r=>r.probeFaceModel('detector'));assert.equal(count,1);release();await row('detector').getByRole('alert').waitFor();
  await page.unroute('**/api/people/models/probe');await row('detector').getByRole('button',{name:'核验模型',exact:true}).click();await row('detector').getByText('接口核验通过',{exact:true}).waitFor();await close();
 });
 await check('Desktop file pickers are never invoked from stage cards; keyboard focus remains on pack selection',async()=>{
  await page.evaluate(()=>{window._fileCalls=0;window.electronAPI={selectModelFile:async()=>{window._fileCalls++;return[]},setTheme:async()=>{}}});
  await open();await preset('Buffalo L');assert.equal(await cards.locator('input:not([type="checkbox"]),[role="combobox"],.face-path-pick').count(),0);
  await page.waitForFunction(()=>!!document.activeElement?.closest('.face-model-heading'));
  await row('detector').getByRole('button',{name:'核验模型',exact:true}).focus();await page.keyboard.press('Enter');await row('detector').getByText('接口核验通过',{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window._fileCalls),0);await close();
 });
 await check('Read-only cards fit all themes, light/dark, English and compact desktop layouts',async()=>{
  await open();for(const width of [1000,1440])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await page.setViewportSize({width,height:width===1000?600:900});await root((r,x)=>{r.setAppearanceTheme(x.theme);r.setThemeMode(x.mode)},{theme,mode});await settled();
   const geometry=await cards.evaluate(el=>({overflow:el.scrollWidth>el.clientWidth,cards:[...el.children].map(c=>c.scrollWidth>c.clientWidth)}));assert(!geometry.overflow&&!geometry.cards.some(Boolean));
   if(width===1440&&theme==='jade')await dialog.screenshot({path:path.join(output,'cards-'+mode+'.png')});
  }
  await root(r=>r.onLanguageChange('en'));await page.getByText('Configured by the selected pack',{exact:true}).waitFor();assert.equal(await cards.locator('input:not([type="checkbox"]),[role="combobox"]').count(),0);await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(async e=>{result.failure=e.stack;console.error(e);process.exitCode=1;await page?.screenshot({path:path.join(output,'failure.png')}).catch(()=>{})}).finally(async()=>{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));await browser?.close()});
