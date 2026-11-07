// B settings: actual controls, persistence boundaries, keyboard/ARIA and themed geometry.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));
assert(fixture.managed_models&&fixture.scratch.includes('video-analyzer-tests-'));
const out=path.resolve(process.env.SETTINGS_B_OUTPUT||'build/settings-b-unification-2026-11-06/browser');fs.mkdirSync(out,{recursive:true});
const result={checks:[],errors:[],failed:[],geometry:[],accessibility:[]};let browser,page;
const root=(fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
(async()=>{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
 await page.addInitScript(()=>{window.electronAPI={platform:'darwin',getModelDirectory:async()=>({path:'/synthetic/Models',activePath:'/synthetic/Models',locked:false,migrationSupported:true,liveApplySupported:true}),selectDirectory:async()=>[],saveModelDirectory:async()=>{throw Error('Unexpected native save in visual fixture')},onModelDirectoryProgress:()=>()=>{}};});
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const settle=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
 const dialog=()=>page.locator('.settings-dialog');
 const open=async(kind='general')=>{await root((r,k)=>r.openRecognitionSettings(k),kind);await dialog().waitFor();await page.waitForFunction(()=>{const r=document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy;return r.settingsLoaded&&!Object.values(r.recognitionLoading).some(Boolean)&&!r.faceCatalogLoading&&!r.classificationCatalogLoading});await settle();};
 const tab=async name=>{await dialog().getByRole('tab',{name,exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.settings-dialog .q-tab-panel').length===1);await settle();};
 const close=async()=>{await dialog().getByRole('button',{name:/^(取消|Cancel)$/}).click();await dialog().waitFor({state:'hidden'})};
 await page.goto(fixture.url);await page.waitForLoadState('networkidle');await root(r=>{r.setAppearanceTheme('jade');r.setThemeMode('light');});await open();
 const tabs=[['general','通用'],['image','图片分析'],['video','视频分析'],['music','音乐分析'],['people','人脸识别'],['classification','智能分类'],['creative','剪辑构思']];
 await check('All seven tabs share grouped surfaces, 14/13px hierarchy and aligned 34px fields',async()=>{
  for(const [kind,name] of tabs){await tab(name);const metrics=await dialog().evaluate(el=>({
   groups:[...el.querySelectorAll('.settings-group')].map(group=>({title:group.querySelector('h3').textContent.trim(),font:getComputedStyle(group.querySelector('h3')).fontSize,weight:Number(getComputedStyle(group.querySelector('h3')).fontWeight)})),
   rows:[...el.querySelectorAll('.settings-row')].map(row=>{const label=row.querySelector('.settings-row-label'),control=row.querySelector('.settings-row-control'),field=control.querySelector('.q-field__control');return {font:getComputedStyle(label).fontSize,height:row.getBoundingClientRect().height,rightAligned:Math.abs(control.getBoundingClientRect().right-row.getBoundingClientRect().right)<1,fieldHeight:field?field.getBoundingClientRect().height:null};})}));
   assert(metrics.groups.length);for(const group of metrics.groups)assert(group.font==='14px'&&group.weight>=600);for(const row of metrics.rows)assert(row.font==='13px'&&row.height>=44&&row.rightAligned&&(row.fieldHeight==null||Math.abs(row.fieldHeight-34)<.1));
   await page.screenshot({path:path.join(out,kind+'-light.png'),animations:'disabled'});
  }
 });
 await check('Switching tabs keeps the frame, tab bar and footer stationary',async()=>{
  let baseline;
  for(const [,name] of tabs){await tab(name);const frame=await dialog().evaluate(el=>{const box=el.getBoundingClientRect();return {height:box.height,top:box.top,tabs:el.querySelector('.q-tabs').getBoundingClientRect().top,footer:el.querySelector('.q-card__actions').getBoundingClientRect().top};});
   assert(Math.abs(frame.height-740)<1,'Normal desktop settings height must remain 740px');
   if(baseline)for(const key of ['height','top','tabs','footer'])assert(Math.abs(frame[key]-baseline[key])<1,'Tab switching moved '+key);else baseline=frame;
  }
 });
 await check('General retains four theme pairs, immediate theme/mode preview and native migration affordances',async()=>{
  await tab('通用');assert.deepEqual(await dialog().locator('.settings-group-heading h3').allTextContents(),['语言','主题风格','外观模式','大模型目录']);
  assert.equal(await dialog().locator('.theme-preview-half').count(),8);
  const cards=await dialog().locator('.appearance-theme-card').first().boundingBox();assert(cards);
  await dialog().getByRole('button',{name:'宣纸水墨',exact:true}).click();assert.equal(await root(r=>r.appearanceTheme),'paper');
  await dialog().locator('[data-mode-choice="dark"]').click();assert.equal(await root(r=>r.themeMode),'dark');
  await dialog().locator('[data-mode-choice="light"]').click();await dialog().getByRole('button',{name:'温润墨玉',exact:true}).click();
  assert(await page.getByRole('button',{name:'选择大模型目录',exact:true}).isEnabled());assert(await page.getByRole('checkbox',{name:'同时迁移现有模型',exact:true}).isDisabled());
 });
 await check('Cloud/local switches, password visibility and picture/video input controls keep their draft behavior',async()=>{
  await tab('图片分析');const api=page.getByRole('textbox',{name:'图片 API 密钥',exact:true});await api.fill('synthetic-test-key');
  await page.getByRole('button',{name:'显示图片密钥',exact:true}).focus();await page.keyboard.press('Enter');assert.equal(await api.getAttribute('type'),'text');await page.getByRole('button',{name:'隐藏图片密钥',exact:true}).click();assert.equal(await api.getAttribute('type'),'password');
  await dialog().getByRole('group',{name:'图片分析方式',exact:true}).getByRole('button',{name:'本地',exact:true}).click();await page.getByRole('combobox',{name:'本地模型',exact:true}).waitFor();await page.getByRole('combobox',{name:'压缩尺寸',exact:true}).waitFor();
  await tab('视频分析');await dialog().getByRole('group',{name:'视频分析方式',exact:true}).getByRole('button',{name:'本地',exact:true}).click();
  for(const label of ['抽帧帧率','单窗帧数上限','帧分辨率','语音转写模型'])await page.getByRole('combobox',{name:label,exact:true}).waitFor();
  await dialog().getByRole('group',{name:'视频分析方式',exact:true}).getByRole('button',{name:'云端',exact:true}).click();
  for(const label of ['视频云端模型','压缩分辨率','视频压缩帧率'])await page.getByRole('combobox',{name:label,exact:true}).waitFor();
  const audio=page.getByRole('switch',{name:'由视频模型同时处理音频（无需独立 ASR）',exact:true});await audio.click();assert.equal(await audio.isChecked(),await root(r=>r.settingsForm.useMultimodal));
  await tab('图片分析');assert.equal(await root(r=>r.settingsForm.imageApiKey==='synthetic-test-key'),true);await close();await open('image');assert.equal(await root(r=>r.settingsForm.imageApiKey==='synthetic-test-key'),false);
 });
 await check('Music remains local-only; creative planning shares the video key and all model opt-outs remain available',async()=>{
  await tab('音乐分析');assert(await dialog().getByRole('group',{name:'音乐分析方式',exact:true}).getByRole('button',{name:'云端',exact:true}).isDisabled());
  await page.getByRole('combobox',{name:'本地模型',exact:true}).click();await page.getByRole('option',{name:'不启用',exact:true}).waitFor();await page.keyboard.press('Escape');
  await tab('剪辑构思');await page.getByRole('textbox',{name:'剪辑构思 API 密钥',exact:true}).fill('synthetic-video-key');await tab('视频分析');assert.equal(await root(r=>r.settingsForm.videoApiKey==='synthetic-video-key'),true);await close();await open();
 });
 await check('Face cards retain read-only files, verifier opt-in and accessible sampling help',async()=>{
  await tab('人脸识别');assert.equal(await dialog().locator('.face-model-stage').count(),3);assert.equal(await dialog().locator('.face-model-stages [role="combobox"],.face-model-stages input:not([type="checkbox"])').count(),0);
  await page.getByRole('button',{name:'模型说明',exact:true}).click();await dialog().getByText(/Buffalo 默认关闭复核/).waitFor();await page.getByRole('button',{name:'模型说明',exact:true}).click();
  const help=page.getByRole('button',{name:'取样数量说明',exact:true});await help.focus();await help.press('Enter');const panel=page.getByRole('dialog',{name:'取样数量说明',exact:true});await panel.waitFor();assert((await panel.innerText()).includes('不会限制视频中的人数'));await page.keyboard.press('Escape');await panel.waitFor({state:'hidden'});assert(await help.evaluate(el=>el===document.activeElement));
 });
 await check('Download progress and failures stay visible in every local-model context',async()=>{
  let download={state:'idle'};await page.route('**/api/local-vlm/download',route=>route.fulfill({json:download}));
  for(const [name,kind] of [['图片分析','image'],['视频分析','video'],['音乐分析','music'],['智能分类','classification']]){
   await tab(name);if(kind==='image'||kind==='video')await root((r,k)=>r.settingsForm[k+'Engine']='local',kind);
   download={state:'downloading',done_bytes:35,total_bytes:100,speed_bps:100};await root((r,d)=>{r.vlmDownload=d;},download);await dialog().getByRole('status').filter({hasText:'35%'}).waitFor();
   download={state:'error',error:'Synthetic download failure'};await root((r,d)=>{r.vlmDownload=d;},download);await dialog().getByRole('alert').filter({hasText:'Synthetic download failure'}).waitFor();
   download={state:'idle'};await root((r,d)=>{r.vlmDownload=d;},download);
  }
  await page.unroute('**/api/local-vlm/download');
 });
 await check('Inline help supports keyboard dismissal and every visible setting control has an accessible name',async()=>{
  await tab('智能分类');const help=page.getByRole('button',{name:'本地模型补充标签说明',exact:true});await help.focus();await help.press('Enter');const popup=page.getByRole('dialog',{name:'本地模型补充标签说明',exact:true});await popup.waitFor();await page.keyboard.press('Escape');await popup.waitFor({state:'hidden'});assert(await help.evaluate(el=>el===document.activeElement));
  for(const [kind,name] of tabs){await tab(name);const violations=await dialog().evaluate(el=>{
   const visible=node=>!!(node.getClientRects().length&&getComputedStyle(node).visibility!=='hidden')&&!node.closest('[aria-hidden="true"]');
   const named=node=>{const labelled=node.getAttribute('aria-labelledby');return node.getAttribute('aria-label')||(labelled&&labelled.split(/\s+/).map(id=>document.getElementById(id)?.textContent||'').join('').trim())||[...node.labels||[]].map(label=>label.textContent).join('').trim()||node.innerText?.trim()||node.closest('.q-field')?.getAttribute('aria-label');};
   return [...el.querySelectorAll('button,[role="combobox"],[role="switch"],[role="checkbox"],input:not([type="hidden"]):not([aria-hidden="true"])')].filter(visible).filter(node=>!named(node)).map(node=>({tag:node.tagName,role:node.getAttribute('role'),class:node.className}));
  });result.accessibility.push({tab:kind,violations});assert.deepEqual(violations,[]);}
 });
 await check('All tabs fit four themes, both appearances and two window sizes; compact scrolling retains actions',async()=>{
  for(const width of [1000,1440])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await page.setViewportSize({width,height:width===1000?600:900});await root((r,x)=>{r.setAppearanceTheme(x.theme);r.setThemeMode(x.mode)},{theme,mode});
   for(const [kind,name] of tabs){await tab(name);const bounds=await dialog().evaluate(el=>{const b=el.getBoundingClientRect(),actions=el.querySelector('.q-card__actions').getBoundingClientRect();return {inside:b.left>=0&&b.right<=innerWidth&&b.top>=0&&b.bottom<=innerHeight,overflow:el.scrollWidth>el.clientWidth,actionsVisible:actions.bottom<=innerHeight&&actions.top>=0,height:b.height,expectedHeight:Math.min(740,innerHeight-48)};});assert(bounds.inside&&!bounds.overflow&&bounds.actionsVisible);assert(Math.abs(bounds.height-bounds.expectedHeight)<1,'Settings height depends on content');
    const reachable=await dialog().locator('.q-panel.scroll').evaluate(pane=>{pane.scrollTop=pane.scrollHeight;const row=[...pane.querySelectorAll('.settings-row')].at(-1);return !row||row.getBoundingClientRect().bottom<=pane.getBoundingClientRect().bottom+1;});assert(reachable,'The last setting must be reachable in the content scroller');await dialog().locator('.q-panel.scroll').evaluate(pane=>pane.scrollTop=0);result.geometry.push({kind,width,theme,mode});if(width===1440&&theme==='jade'&&mode==='dark')await page.screenshot({path:path.join(out,kind+'-dark.png'),animations:'disabled'});}
  }
 });
 await check('English labels remain readable without horizontal overflow and the toolbar appearance picker still works',async()=>{
  await root(r=>r.onLanguageChange('en'));const items=dialog().getByRole('tab');assert.equal(await items.count(),7);for(const item of await items.all()){await item.click();await settle();assert.equal(await dialog().evaluate(el=>el.scrollWidth>el.clientWidth),false);}
  await close();await page.locator('.appearance-trigger').click();await page.locator('.appearance-menu').waitFor();assert.equal(await page.locator('.appearance-menu .appearance-theme-card').count(),4);assert.equal(await page.locator('.appearance-menu .settings-group').count(),0);await page.keyboard.press('Escape');await page.locator('.appearance-menu').waitFor({state:'hidden'});
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(async error=>{result.failure=error.stack;console.error(error);process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png'),animations:'disabled'}).catch(()=>{})}).finally(async()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));await browser?.close()});
