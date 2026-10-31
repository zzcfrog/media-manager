// Current UI-spec contracts; synthetic fixtures only, no model calls or real data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE||'/tmp/luminisle-ui-fix-fixture.json'));
const people=JSON.parse(fs.readFileSync(process.env.PEOPLE_BROWSER_FIXTURE||'/tmp/luminisle-ui-fix-people-fixture.json'));
for(const f of [fixture,people]){assert(f.scratch.includes('video-analyzer-tests-'));assert.equal(new URL(f.url).hostname,'127.0.0.1');}
const output=path.resolve('build/ui-spec-validation');fs.mkdirSync(output,{recursive:true});
const result={checks:[],failures:[],errors:[],palettes:[]};let browser;
const root=(page,fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
const settle=page=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
async function nav(page,route){await root(page,(r,v)=>r.nav(v),route);await page.waitForLoadState('networkidle');await settle(page);}
async function check(name,fn){try{await fn();result.checks.push(name)}catch(error){result.failures.push({name,message:error.message})}}
async function closeSettings(page){await root(page,r=>{r.showSettings=false});await page.locator('.settings-dialog').waitFor({state:'hidden'});}
async function buttonPaint(button){return button.evaluate(el=>{
 const s=getComputedStyle(el),canvas=document.createElement('canvas'),c=canvas.getContext('2d');canvas.width=canvas.height=1;
 const rgba=value=>{c.clearRect(0,0,1,1);c.fillStyle=value;c.fillRect(0,0,1,1);return[...c.getImageData(0,0,1,1).data]};
 const mix=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]/255+b[i]*(1-a[3]/255));
 const lum=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
 let bg=rgba(s.backgroundColor);if(bg[3]===0){const parent=getComputedStyle(el.parentElement),plate=getComputedStyle(el.parentElement,'::before');bg=mix(rgba(plate.backgroundColor),rgba(parent.backgroundColor));}
 const a=lum(rgba(s.color).slice(0,3)),b=lum(bg.slice(0,3));
 return{color:s.color,background:s.backgroundColor,primary:s.getPropertyValue('--q-primary').trim(),accent:s.getPropertyValue('--accent').trim(),ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};
 });}
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1600,height:900}});page.setDefaultTimeout(6000);page.on('pageerror',e=>result.errors.push(e.message));
 await page.goto(fixture.url+'/#/gallery');await page.waitForLoadState('networkidle');
 await root(page,r=>{r.showSettings=true;r.settingsTab='video'});await page.locator('.settings-dialog').waitFor();await settle(page);
 for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
  await root(page,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});await settle(page);
  const primary=await buttonPaint(page.locator('.settings-dialog .q-card__actions .q-btn').last());const segments=await page.locator('.engine-toggle [aria-pressed="true"]').all();const paints=[];for(const b of segments)paints.push(await buttonPaint(b));result.palettes.push({theme,mode,primary,segments:paints});
 }
 await check('U01: all eight appearances use the theme primary with readable button text',async()=>{for(const r of result.palettes){assert.equal(r.primary.primary,r.primary.accent,r.theme+'/'+r.mode);assert(r.primary.ratio>=4.5,JSON.stringify(r));}});
 await check('U02: selected engine segments are readable across all eight appearances',async()=>{for(const r of result.palettes)for(const p of r.segments)assert(p.ratio>=4.5,JSON.stringify({theme:r.theme,mode:r.mode,...p}));});
 await page.setViewportSize({width:1000,height:600});await settle(page);await page.screenshot({path:path.join(output,'settings-dark.png'),animations:'disabled'});await closeSettings(page);
 const tag=await page.request.post(fixture.url+'/api/taxonomy/nodes',{data:{name:'UI规范字段 '+Date.now()}}).then(r=>r.json());
 await root(page,async r=>{await r.reloadTaxonomy()});await nav(page,'#/taxonomy/'+tag.id);await root(page,r=>{r.setAppearanceTheme('jade');r.setThemeMode('dark')});await settle(page);
 await check('U03: dark outlined fields follow the theme border',async()=>{const fields=await page.locator('.taxonomy-editor .q-field--outlined .q-field__control').evaluateAll(els=>els.slice(0,3).map(el=>{const s=getComputedStyle(el),probe=document.createElement('span');probe.style.color=s.getPropertyValue('--border2');el.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return{border:getComputedStyle(el,'::before').borderTopColor,expected}}));assert(fields.length);for(const field of fields)assert.equal(field.border,field.expected)});
 await check('U03: invalid outlined fields retain their error message and error border',async()=>{
  await page.evaluate(()=>{const host=document.createElement('div');host.id='ui-spec-error-probe';host.style.cssText='position:fixed;left:10px;top:60px;width:280px;z-index:10000';document.body.append(host);const vnode=Vue.h(Quasar.QInput,{modelValue:'Synthetic',outlined:true,dense:true,error:true,errorMessage:'Synthetic validation error'});vnode.appContext=document.querySelector('[data-v-app]').__vue_app__._context;Vue.render(vnode,host)});
  try{const field=page.locator('#ui-spec-error-probe');await field.locator('input').focus();await settle(page);assert.equal(await field.locator('.q-field--error').count(),1);assert.equal(await field.locator('.q-field__messages').innerText(),'Synthetic validation error');const colors=await field.locator('.q-field__control').evaluate(el=>{const probe=document.createElement('span');probe.style.color='var(--q-negative)';el.append(probe);const expected=getComputedStyle(probe).color;probe.remove();return{actual:getComputedStyle(el,'::after').borderTopColor,expected}});assert.equal(colors.actual,colors.expected)}finally{await page.evaluate(()=>{const host=document.querySelector('#ui-spec-error-probe');Vue.render(null,host);host.remove()})}
 });
 await nav(page,'#/gallery');await root(page,r=>{r.$refs.gallery.resetFilters();r.$refs.gallery.selArr=[]});await page.waitForLoadState('networkidle');
 await check('U05: filters have names and native keyboard-operable rating/color choices',async()=>{
  const favorite=page.getByRole('button',{name:'喜欢筛选',exact:true});await favorite.waitFor();assert.equal(await favorite.getAttribute('aria-pressed'),'false');
  const stars=page.locator('.filter-stars button'),colors=page.locator('.filter-colors button');assert.equal(await stars.count(),5);assert.equal(await colors.count(),5);
  await stars.nth(2).focus();await page.keyboard.press('Enter');assert.equal(await stars.nth(2).getAttribute('aria-pressed'),'true');assert.equal(Number(await root(page,r=>r.$refs.gallery.filters.rating)),3);
  await page.keyboard.press('Enter');assert.equal(await stars.nth(2).getAttribute('aria-pressed'),'false');await colors.first().focus();await page.keyboard.press('Space');assert.equal(await colors.first().getAttribute('aria-pressed'),'true');await page.keyboard.press('Space');assert.equal(await colors.first().getAttribute('aria-pressed'),'false');
  assert.equal(await page.getByRole('button',{name:'搜索',exact:true}).count(),1);assert.equal(await page.getByRole('button',{name:'分析筛选',exact:true}).count(),1);
 });
 await root(page,r=>{r.$refs.gallery.resetFilters()});await page.waitForLoadState('networkidle');
 await check('U06: context menu owns arrows, Escape and Enter without changing background selection',async()=>{
  await page.locator('.media-card').first().click({button:'right'});const menu=page.locator('.ctx-menu-popup');await menu.waitFor();assert.equal(await menu.getAttribute('role'),'menu');const selected=await root(page,r=>[...r.$refs.gallery.selArr]);
  await page.keyboard.press('ArrowDown');assert.deepEqual(await root(page,r=>r.$refs.gallery.selArr),selected);assert(await menu.locator(':focus').count());await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert(await page.evaluate(()=>document.activeElement.isConnected));
  await root(page,(r,ids)=>{r.$refs.gallery.selArr=ids},fixture.image_ids.slice(0,2));await page.locator('.media-card[data-id="'+fixture.image_ids[0]+'"]').click({button:'right'});await menu.waitFor();assert.equal(await menu.locator(':focus').evaluate(el=>el.classList.contains('disabled')),false);await page.keyboard.press('ArrowUp');assert.equal(await menu.locator(':focus').evaluate(el=>el.classList.contains('disabled')),false);await page.keyboard.press('Escape');await menu.waitFor({state:'hidden'});assert.deepEqual(await root(page,r=>r.$refs.gallery.selArr),fixture.image_ids.slice(0,2));await root(page,r=>{r.$refs.gallery.selArr=[]});
  await page.locator('.media-card').first().click({button:'right'});await menu.waitFor();await page.keyboard.press('Home');await page.keyboard.press('Enter');await page.waitForURL('**/#/detail/'+selected[0]);
 });
 await nav(page,'#/gallery');await root(page,r=>{r.$refs.gallery.ctxMenu.show=false});
 await check('U07/U08: standalone gallery controls are 32px and independent groups are 8px apart',async()=>{const values=await page.evaluate(()=>({heights:[...document.querySelectorAll('.gallery-filter-action,.inspector-toggle')].filter(el=>el.getBoundingClientRect().width).map(el=>el.getBoundingClientRect().height),gaps:['.filter-controls','.filter-display-controls'].map(s=>getComputedStyle(document.querySelector(s)).gap)}));assert(values.heights.length>=3);for(const h of values.heights)assert.equal(h,32);assert.deepEqual(values.gaps,['8px','8px']);});
 await check('U09: export cancel follows Chinese and English without exporting',async()=>{await nav(page,'#/workbench/'+fixture.project_id);for(const [locale,label] of [['zh','取消'],['en','Cancel']]){await root(page,(r,v)=>r.onLanguageChange(v),locale);await page.locator('.wb-export').click();await page.locator('.q-dialog-plugin').waitFor();assert.equal(await page.locator('.q-dialog-plugin').getByRole('button',{name:label,exact:true}).count(),1);await page.keyboard.press('Escape');await page.locator('.q-dialog-plugin').waitFor({state:'hidden'});}});
 const pp=await browser.newPage({viewport:{width:1000,height:600}});pp.on('pageerror',e=>result.errors.push(e.message));await pp.goto(people.url+'/#/people');await pp.waitForLoadState('networkidle');
 await check('U04: people controls use 32px fields, 28px segments, 12px type and the common top baseline',async()=>{for(const width of [1000,1600]){await pp.setViewportSize({width,height:width===1000?600:900});const metrics=await pp.locator('.people-toolbar').evaluate(el=>({top:el.getBoundingClientRect().top,fields:[...el.querySelectorAll('.q-field__control')].map(el=>({height:el.getBoundingClientRect().height,top:el.getBoundingClientRect().top})),buttons:[...el.querySelectorAll(':scope > .q-btn')].map(el=>({height:el.getBoundingClientRect().height,font:getComputedStyle(el).fontSize})),segments:[...el.querySelectorAll('.people-view-switcher .q-btn')].map(el=>el.getBoundingClientRect().height)}));for(const f of metrics.fields){assert.equal(f.height,32);assert.equal(f.top,metrics.top)}for(const b of metrics.buttons){assert.equal(b.height,32);assert.equal(b.font,'12px')}for(const h of metrics.segments)assert.equal(h,28);}});
 await pp.screenshot({path:path.join(output,'people.png'),animations:'disabled'});
 assert.deepEqual(result.errors,[]);if(result.failures.length)process.exitCode=1;
})().catch(e=>{result.fatal=e.stack;process.exitCode=1}).finally(async()=>{fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');if(browser)await browser.close();console.log(JSON.stringify({passed:result.checks.length,failures:result.failures,fatal:result.fatal,errors:result.errors}))});
