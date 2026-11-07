// Shared dropdown geometry and interaction, using only synthetic fixtures.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE));
assert(fixture.scratch.includes('video-analyzer-tests-'));assert.equal(new URL(fixture.url).hostname,'127.0.0.1');
const output=path.resolve(process.env.NATIVE_SELECT_OUTPUT||'build/native-selects-2026-11-04');fs.mkdirSync(output,{recursive:true});
const result={checks:[],errors:[],failed:[],geometry:[]};let browser;
const root=(p,fn,data)=>p.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
const settle=p=>p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
const geometry=field=>field.evaluate(el=>{
 const control=el.querySelector('.q-field__control'),menu=document.getElementById(el.querySelector('[role="combobox"]').getAttribute('aria-controls'));
 const c=control.getBoundingClientRect(),m=menu.getBoundingClientRect(),s=getComputedStyle(control),t=getComputedStyle(menu);
 return{side:el.dataset.selectSide,control:{x:c.x,y:c.y,width:c.width,height:c.height,bottom:c.bottom,corners:[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius],shadow:s.boxShadow},menu:{x:m.x,y:m.y,width:m.width,height:m.height,bottom:m.bottom,corners:[t.borderTopLeftRadius,t.borderTopRightRadius,t.borderBottomRightRadius,t.borderBottomLeftRadius]},viewport:{width:innerWidth,height:innerHeight}};
});
async function joined(page,field,side){
 await page.waitForFunction(el=>{const m=document.getElementById(el.querySelector('[role="combobox"]')?.getAttribute('aria-controls'));if(!m?.classList.contains('native-select-menu'))return false;const a=el.querySelector('.q-field__control').getBoundingClientRect(),b=m.getBoundingClientRect();return Math.abs(a.width-b.width)<1&&Math.abs(a.x-b.x)<1&&Math.min(Math.abs(a.bottom-b.top),Math.abs(a.top-b.bottom))<1},await field.elementHandle()).catch(async error=>{result.geometry.push(await geometry(field));throw error});
 await settle(page);
 await page.waitForFunction(el=>{const m=document.getElementById(el.querySelector('[role="combobox"]').getAttribute('aria-controls'));if(!m)return false;const r=m.getBoundingClientRect();return Number(getComputedStyle(m).opacity)>.99&&m.contains(document.elementFromPoint(r.x+Math.min(20,r.width/2),r.y+Math.min(12,r.height/2)))},await field.elementHandle());
 const g=await geometry(field);if(side)assert.equal(g.side,side);assert(g.menu.y>=0&&g.menu.bottom<=g.viewport.height);
 assert.deepEqual(g.control.corners,g.side==='up'?['0px','0px','10px','10px']:['10px','10px','0px','0px']);
 assert.deepEqual(g.menu.corners,g.side==='up'?['10px','10px','0px','0px']:['0px','0px','10px','10px']);result.geometry.push(g);return g;
}
const harness=`<!doctype html><html data-appearance-theme="jade" data-appearance-mode="light"><meta charset="utf-8"><link rel="stylesheet" href="/static/css/quasar.prod.css"><link rel="stylesheet" href="/static/css/material-icons.css"><link rel="stylesheet" href="/static/css/native.css"><link rel="stylesheet" href="/static/css/themes.css"><style>.controls{position:absolute;left:40px;top:36px;width:300px;display:grid;gap:20px}.spacer{height:1000px}</style><body class="native-ui"><div id="harness"><div class="controls"><q-select class="demo-plain" v-model="value" :options="options" dense filled label="单选"></q-select><q-select class="demo-search" v-model="searched" :options="filtered" dense outlined use-input clearable label="搜索选项" @filter="filter"></q-select><q-select class="demo-multi" v-model="multiple" :options="options" dense borderless multiple use-chips label="多选"></q-select><q-select class="demo-empty" v-model="value" :options="[]" dense filled label="空选项"><template #no-option><q-item><q-item-section>没有匹配项</q-item-section></q-item></template></q-select><q-select class="demo-disabled" v-model="value" :options="options" dense filled disable label="不可用"></q-select><q-select class="demo-invalid" v-model="value" :options="options" dense outlined error error-message="请选择有效选项" label="错误状态"></q-select><q-input class="demo-normal-input" v-model="value" dense filled label="普通输入"></q-input><q-btn class="demo-action" label="操作菜单"><q-menu><q-list><q-item clickable v-close-popup><q-item-section>普通操作</q-item-section></q-item></q-list></q-menu></q-btn><div class="spacer"></div><q-select class="demo-bottom" v-model="value" :options="options" dense filled label="底部选择"></q-select><q-select v-if="temporary" class="demo-temporary" v-model="value" :options="options" filled label="临时选择"></q-select></div></div><script src="/static/js/vue.global.prod.js"></script><script src="/static/js/quasar.umd.prod.js"></script><script src="/static/js/native-selects.js"></script><script>const options=['Alpha','Beta','这是一个需要完整换行显示的较长选项名称'];const app=Vue.createApp({data:()=>({value:'Alpha',searched:null,multiple:[],options,filtered:options,temporary:true}),methods:{filter(value,update){update(()=>this.filtered=options.filter(v=>v.toLowerCase().includes(value.toLowerCase())))}}});app.use(Quasar);app.use(NativeSelects);window.selectFixture=app.mount('#harness');</script></body></html>`;
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(7000);
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 await page.route('**/native-select-fixture',route=>route.fulfill({contentType:'text/html',body:harness}));await page.goto(fixture.url+'/native-select-fixture');await page.waitForLoadState('networkidle');
 const field=id=>page.locator('.demo-'+id);
 await check('Focus has straight lower corners; blur restores the default outline',async()=>{
  await field('plain').getByRole('combobox').focus();await page.waitForFunction(()=>document.querySelector('.demo-plain').closest('.q-select').classList.contains('q-field--focused'));
  assert.deepEqual(await field('plain').locator('.q-field__control').evaluate(el=>{const s=getComputedStyle(el);return[s.borderTopLeftRadius,s.borderBottomLeftRadius]}),['10px','0px']);
  await page.locator('.demo-normal-input input').focus();assert.equal(await field('plain').locator('.q-field__control').evaluate(el=>getComputedStyle(el).borderBottomLeftRadius),'10px');
 });
 await check('Downward listboxes align and keyboard selection and Escape retain focus',async()=>{
  await page.locator('.demo-plain').click();await joined(page,field('plain'),'down');await page.keyboard.press('ArrowDown');await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>selectFixture.value),'Beta');
  await page.locator('.demo-plain').click();await joined(page,field('plain'));await page.keyboard.press('Escape');await settle(page);await page.locator('.native-select-menu').waitFor({state:'hidden'});assert(await field('plain').evaluate(el=>el.contains(document.activeElement)));
 });
 await check('Outlined searchable selects filter options and clear without breaking the seam',async()=>{
  await field('search').getByRole('combobox').fill('bet');await page.getByRole('option',{name:'Beta',exact:true}).waitFor();await joined(page,field('search'));await page.getByRole('option',{name:'Beta',exact:true}).click();assert.equal(await page.evaluate(()=>selectFixture.searched),'Beta');
 });
 await check('Borderless multiple selection, empty options and disabled fields keep their behavior',async()=>{
  await page.locator('.demo-multi').click();await joined(page,field('multi'));await page.getByRole('option',{name:'Alpha',exact:true}).click();await page.getByRole('option',{name:'Beta',exact:true}).click();assert.deepEqual(await page.evaluate(()=>selectFixture.multiple),['Alpha','Beta']);await page.keyboard.press('Escape');await settle(page);
  await page.locator('.demo-empty').click();await page.getByText('没有匹配项',{exact:true}).waitFor();await joined(page,field('empty'));await page.keyboard.press('Escape');await settle(page);assert(await field('disabled').evaluate(el=>el.classList.contains('q-field--disabled')));
 });
 await check('Upward menus mirror the corners; resizing and scrolling retain alignment',async()=>{
  await page.locator('.demo-bottom').evaluate(el=>el.scrollIntoView({block:'end'}));await page.locator('.demo-bottom').click();await joined(page,field('bottom'),'up');
  await page.evaluate(()=>scrollBy(0,20));await joined(page,field('bottom'),'up');
  await page.setViewportSize({width:1000,height:900});await joined(page,field('bottom'),'up');
  await page.setViewportSize({width:1000,height:600});await page.locator('.native-select-menu').waitFor({state:'hidden'});await settle(page);
  await page.evaluate(()=>scrollTo(0,0));await page.setViewportSize({width:1440,height:900});
 });
 await check('Error color, ordinary inputs, action menus and unmounted selects remain intact',async()=>{
  await field('invalid').getByRole('combobox').focus();assert((await field('invalid').locator('.q-field__control').evaluate(el=>getComputedStyle(el).boxShadow)).includes('193, 0, 21'));
  await page.locator('.demo-normal-input input').focus();assert.equal(await page.locator('.demo-normal-input .q-field__control').evaluate(el=>getComputedStyle(el).borderBottomLeftRadius),'10px');
  await page.locator('.demo-action').click();await page.getByText('普通操作',{exact:true}).waitFor();assert.equal(await page.locator('.q-menu').getAttribute('class').then(v=>v.includes('native-select-menu')),false);await page.keyboard.press('Escape');await settle(page);
  await page.locator('.demo-temporary').scrollIntoViewIfNeeded();await page.locator('.demo-temporary').click();await joined(page,field('temporary'));await page.evaluate(()=>selectFixture.temporary=false);await page.locator('.native-select-menu').waitFor({state:'hidden'});await page.evaluate(()=>scrollTo(0,0));
 });
 await page.goto(fixture.url+'/#/gallery');await page.waitForLoadState('networkidle');
 await check('Gallery sorting and grouping use the same seam at compact widths',async()=>{
  for(const label of ['排序','分组']){const control=page.getByRole('combobox',{name:label,exact:true});if(!await control.count())continue;await control.click();await joined(page,control.locator('xpath=ancestor::*[contains(@class,"q-select")][1]'));await page.keyboard.press('Escape');await settle(page);}
 });
 await root(page,r=>r.openRecognitionSettings('people'));await page.getByLabel('模型组合',{exact:true}).waitFor();await settle(page);
 await check('All eight appearances share the connected settings dropdown',async()=>{
  for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await root(page,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});await settle(page);
   await page.getByLabel('模型组合',{exact:true}).click();await joined(page,page.locator('.settings-dialog .q-select').first(),'down');
   if(theme==='jade')await page.screenshot({path:path.join(output,'settings-'+mode+'.png'),animations:'disabled'});await page.keyboard.press('Escape');await settle(page);
  }
 });
 await root(page,r=>{r.showSettings=false;r.nav('#/people')});await page.getByRole('combobox',{name:'人物排序',exact:true}).waitFor();
 await check('The people toolbar also uses the shared borderless dropdown',async()=>{await page.getByRole('combobox',{name:'人物排序',exact:true}).click();await joined(page,page.locator('.people-sort'));await page.keyboard.press('Escape');await settle(page);});
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(e=>{result.failure=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.checks.length,failure:result.failure,errors:result.errors,failed:result.failed}))});
