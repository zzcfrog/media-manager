// Real DOM checks for compact controls and first-scan onboarding; synthetic data only.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const f=JSON.parse(fs.readFileSync(process.env.PEOPLE_BROWSER_FIXTURE));assert(f.scratch.includes('video-analyzer-tests-'));assert.equal(new URL(f.url).hostname,'127.0.0.1');
const output=path.resolve(process.env.PEOPLE_CONTROLS_OUTPUT||'build/people-controls-2026-11-05');fs.mkdirSync(output,{recursive:true});
const result={checks:[],errors:[],motionErrors:[],failed:[],writes:[],geometry:[]};let browser;
const root=(p,fn,data)=>p.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
const settle=p=>p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
const corners=control=>control.evaluate(el=>{const s=getComputedStyle(el);return[s.borderTopLeftRadius,s.borderTopRightRadius,s.borderBottomRightRadius,s.borderBottomLeftRadius]});
(async()=>{
 browser=await chromium.launch({headless:true});const p=await browser.newPage({viewport:{width:1440,height:900}});p.setDefaultTimeout(8000);
 p.on('pageerror',e=>result.errors.push(e.message));p.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 p.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())&&new URL(r.url()).pathname.startsWith('/api/people'))result.writes.push(new URL(r.url()).pathname)});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 await p.goto(f.url+'/#/people');await p.waitForLoadState('networkidle');await p.locator('.people-card').first().waitFor();
 const search=p.getByRole('textbox',{name:'搜索人物姓名',exact:true}),control=p.locator('.people-search .q-field__control');
 await check('Search curvature is not clipped; focus straightens the underline edge and blur restores it',async()=>{
  assert.deepEqual(await corners(control),['10px','10px','10px','10px']);
  assert(await control.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+1,r.y+10))}));
  await search.focus();await settle(p);assert.deepEqual(await corners(control),['10px','10px','0px','0px']);
  assert(await control.evaluate(el=>getComputedStyle(el,'::after').transform==='matrix(1, 0, 0, 1, 0, 0)'));
  await search.fill('小林');await p.waitForFunction(()=>document.querySelectorAll('.people-card').length===1);assert.deepEqual(await corners(control),['10px','10px','0px','0px']);
  await p.screenshot({path:path.join(output,'search-focus.png'),animations:'disabled'});await p.getByRole('button',{name:'新增人物',exact:true}).focus();assert.deepEqual(await corners(control),['10px','10px','10px','10px']);
  await search.fill('');await p.waitForFunction(n=>document.querySelectorAll('.people-card').length===n,f.people_count);
 });
 await check('Sort labels and arrow center vertically in 32px fields across appearances',async()=>{
  for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await root(p,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});await settle(p);
   const g=await p.locator('.people-sort').evaluate(el=>{const c=el.querySelector('.q-field__control').getBoundingClientRect(),n=el.querySelector('.q-field__native'),t=n.querySelector('span').getBoundingClientRect(),a=el.querySelector('.q-select__dropdown-icon').getBoundingClientRect();return{height:c.height,nativeHeight:getComputedStyle(n).height,textOffset:t.y+t.height/2-c.y-c.height/2,arrowOffset:a.y+a.height/2-c.y-c.height/2}});
   assert.equal(g.height,32);assert.equal(g.nativeHeight,'32px');assert(Math.abs(g.textOffset)<.5);assert(Math.abs(g.arrowOffset)<.5);result.geometry.push({theme,mode,...g});
  }
  await p.getByRole('combobox',{name:'人物排序',exact:true}).click();await p.getByRole('option',{name:'姓名顺序',exact:true}).click();await p.waitForLoadState('networkidle');assert.equal(await p.locator('.people-card').count(),f.people_count);
 });
 await p.route('**/api/people/persons**',route=>route.fulfill({json:{data:[]}}));
 await p.route('**/api/people/status',async route=>{const response=await route.fetch(),s=await response.json();await route.fulfill({response,json:{...s,counts:{all:0,hidden:0},unnamed_count:0,review_count:0}})});
 await p.reload();await p.locator('.people-onboarding').waitFor();
 await check('A first-scan empty library teaches three steps with a working local animation',async()=>{
  assert.equal(await p.locator('.people-onboarding-steps li').count(),3);await p.locator('.people-onboarding-motion svg').waitFor();
  await p.waitForFunction(()=>lottie.getRegisteredAnimations().some(a=>a.animationData?.nm==='Local people album guide'&&a.isLoaded&&!a.isPaused));
  await p.evaluate(()=>{window._peopleMotionErrors=[];lottie.getRegisteredAnimations().find(a=>a.animationData?.nm==='Local people album guide').addEventListener('error',e=>window._peopleMotionErrors.push(e.nativeError?.message||e.type))});
  const frame=await p.locator('.people-onboarding-motion svg').evaluate(el=>el.outerHTML);
  await p.waitForFunction(previous=>document.querySelector('.people-onboarding-motion svg').outerHTML!==previous,frame);
  await p.getByRole('button',{name:'开始人脸识别',exact:true}).waitFor();assert.equal(await p.locator('.people-empty').count(),0);assert.deepEqual(result.writes,[]);
 });
 await check('Nine photos locate faces, expose five landmarks, then form three identity stacks',async()=>{
  const frame=async n=>{await p.evaluate(n=>lottie.getRegisteredAnimations().find(a=>a.animationData?.nm==='Local people album guide').goToAndStop(n,true),n);await settle(p);return p.locator('.people-onboarding-motion').evaluate(el=>{
   const opacity=node=>{let value=1;for(let n=node;n&&n!==el;n=n.parentElement)value*=Number(n.getAttribute('opacity')??1);return value};
   return{cards:[...el.querySelectorAll('.people-moment')].map(n=>{const m=new DOMMatrix(n.getAttribute('transform'));return{identity:n.classList.contains('people-moment-a')?'a':n.classList.contains('people-moment-b')?'b':'c',x:m.e,y:m.f,scale:Math.hypot(m.a,m.b)}}),detect:[...el.querySelectorAll('.people-photo-detect')].map(opacity),features:[...el.querySelectorAll('.people-photo-feature')].map(opacity),step:document.querySelector('.people-onboarding-steps .is-current')?.textContent}
  })};
  const locate=await frame(45);assert.equal(locate.cards.length,9);assert.equal(new Set(locate.cards.map(c=>c.x)).size,3);assert.equal(new Set(locate.cards.map(c=>c.y)).size,3);assert(locate.detect.some(v=>v>.9));assert(locate.features.every(v=>v===0));assert(locate.step.includes('识别位置'));
  await p.screenshot({path:path.join(output,'stage-locate.png'),animations:'disabled'});
  const features=await frame(86);assert(features.detect.every(v=>v===0));assert(features.features.every(v=>v>.9));assert(features.step.includes('提取特征'));await p.screenshot({path:path.join(output,'stage-features.png'),animations:'disabled'});
  const grouped=await frame(220);assert(grouped.features.every(v=>v===0));assert(grouped.step.includes('按人归组'));
  for(const identity of ['a','b','c']){const cards=grouped.cards.filter(c=>c.identity===identity);assert.equal(cards.length,3);assert(Math.max(...cards.map(c=>c.x))-Math.min(...cards.map(c=>c.x))<20);assert(Math.max(...cards.map(c=>c.y))-Math.min(...cards.map(c=>c.y))<20);assert(cards.every(c=>c.scale>1.3))}
  assert(Math.max(...grouped.cards.filter(c=>c.identity==='a').map(c=>c.x))<Math.min(...grouped.cards.filter(c=>c.identity==='b').map(c=>c.x)));
  assert(Math.max(...grouped.cards.filter(c=>c.identity==='b').map(c=>c.x))<Math.min(...grouped.cards.filter(c=>c.identity==='c').map(c=>c.x)));
  for(let n=0;n<300;n+=3)await frame(n);
  result.motionErrors=await p.evaluate(()=>window._peopleMotionErrors);assert.deepEqual(result.motionErrors,[]);
  await frame(220);assert.equal(await p.locator('.people-onboarding small,.people-onboarding p').count(),0);
 });
 await check('The toolbar and two central actions share generous, exact button geometry',async()=>{
  const metrics=await p.locator('.people-action-button').evaluateAll(buttons=>buttons.map(el=>{const s=getComputedStyle(el),icon=el.querySelector('.q-icon'),content=el.querySelector('.q-btn__content');return{height:el.getBoundingClientRect().height,padding:s.padding,font:s.fontSize,gap:getComputedStyle(content).gap,icon:getComputedStyle(icon).fontSize,iconMargin:getComputedStyle(icon).marginRight}}));
  assert.equal(metrics.length,3);for(const m of metrics)assert.deepEqual(m,{height:32,padding:'6px 12px',font:'12px',gap:'6px',icon:'18px',iconMargin:'0px'});
  result.geometry.push({actions:metrics});
 });
 await check('Both recognition entry points open the same scope dialog; settings stays available',async()=>{
  const snapshot=async()=>p.locator('.people-scan-dialog').evaluate(el=>({fields:[...el.querySelectorAll('.q-select')].map(n=>n.querySelector('[role="combobox"]').getAttribute('aria-label')),values:[...el.querySelectorAll('.q-select .q-field__native')].map(n=>n.innerText)}));
  await p.getByRole('button',{name:'开始人脸识别',exact:true}).click();await p.getByLabel('本次范围',{exact:true}).waitFor();const center=await snapshot();await p.locator('.people-dialog').getByRole('button',{name:'关闭',exact:true}).click();await p.locator('.people-dialog').waitFor({state:'hidden'});
  await p.locator('.people-toolbar').getByRole('button',{name:'人脸识别',exact:true}).click();await p.getByLabel('本次范围',{exact:true}).waitFor();assert.deepEqual(await snapshot(),center);await p.locator('.people-dialog').getByRole('button',{name:'关闭',exact:true}).click();await p.locator('.people-dialog').waitFor({state:'hidden'});
  await p.locator('.people-onboarding').getByRole('button',{name:'人脸识别设置',exact:true}).click();await p.getByLabel('人脸检测模型',{exact:true}).waitFor();await p.locator('.settings-dialog').getByRole('button',{name:'取消',exact:true}).click();await p.locator('.settings-dialog').waitFor({state:'hidden'});assert.deepEqual(result.writes,[]);
 });
 await check('Illustration and motion follow eight themes; the primary action fits compact bilingual windows',async()=>{
  for(const width of [1000,1440])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark'])for(const language of ['zh','en']){
   await p.setViewportSize({width,height:width===1000?600:900});await root(p,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode);r.onLanguageChange(v.language)},{theme,mode,language});await settle(p);
   const g=await p.locator('.people-onboarding').evaluate(el=>{const s=el.closest('.people-scroll').getBoundingClientRect(),b=el.querySelector('.people-onboarding-actions .q-btn').getBoundingClientRect(),paper=el.querySelector('.people-onboarding-motion .people-photo-paper'),motion=el.querySelector('.people-photo-feature'),skin=el.querySelector('.people-onboarding-motion .people-photo-skin'),ink=el.querySelector('.people-onboarding-motion .people-photo-ink');const ctx=document.createElement('canvas').getContext('2d');const color=value=>{ctx.clearRect(0,0,1,1);ctx.fillStyle=value;ctx.fillRect(0,0,1,1);return[...ctx.getImageData(0,0,1,1).data]};return{overflow:el.scrollWidth>el.clientWidth,top:b.top,bottom:b.bottom,visibleTop:s.top,visibleBottom:s.bottom,accent:color(getComputedStyle(el).getPropertyValue('--accent')),surface:color(getComputedStyle(el).getPropertyValue('--surface')),paper:color(getComputedStyle(paper).fill),motion:color(getComputedStyle(motion).fill),skin:color(getComputedStyle(skin).fill),ink:color(getComputedStyle(ink).fill)}});
   assert(!g.overflow);assert(g.top>=g.visibleTop&&g.bottom<=g.visibleBottom);assert.deepEqual(g.paper,g.surface);assert.deepEqual(g.motion,g.accent);assert(g.skin[0]+g.skin[1]+g.skin[2]>g.ink[0]+g.ink[1]+g.ink[2]);result.geometry.push({width,theme,mode,language,...g});
   if(width===1440&&theme==='jade'&&language==='zh')await p.screenshot({path:path.join(output,'empty-'+mode+'.png'),animations:'disabled'});
   if(width===1000&&theme==='jade'&&mode==='light'&&language==='en')await p.screenshot({path:path.join(output,'empty-compact-en.png'),animations:'disabled'});
  }
 });
 await check('Reduced motion, search, hidden views and missing Lottie retain a useful static empty state',async()=>{
  await root(p,r=>r.onLanguageChange('zh'));
  await p.evaluate(()=>lottie.getRegisteredAnimations().find(a=>a.animationData?.nm==='Local people album guide').play());
  await p.waitForFunction(()=>lottie.getRegisteredAnimations().some(a=>a.animationData?.nm==='Local people album guide'&&!a.isPaused));
  await p.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'))});
  assert(await p.evaluate(()=>lottie.getRegisteredAnimations().find(a=>a.animationData?.nm==='Local people album guide').isPaused));
  await p.evaluate(()=>{delete document.hidden;document.dispatchEvent(new Event('visibilitychange'))});
  await p.waitForFunction(()=>lottie.getRegisteredAnimations().some(a=>a.animationData?.nm==='Local people album guide'&&!a.isPaused));
  await p.emulateMedia({reducedMotion:'reduce'});await p.waitForFunction(()=>lottie.getRegisteredAnimations().every(a=>a.animationData?.nm!=='Local people album guide'||a.isPaused));assert.equal(await p.locator('.people-onboarding-motion').isVisible(),false);
  await p.getByRole('textbox',{name:'搜索人物姓名',exact:true}).fill('不存在');await p.getByText('没有匹配的人物',{exact:true}).waitFor();assert.equal(await p.locator('.people-onboarding').count(),0);assert.equal(await p.evaluate(()=>lottie.getRegisteredAnimations().filter(a=>a.animationData?.nm==='Local people album guide').length),0);
  await p.getByRole('textbox',{name:'搜索人物姓名',exact:true}).fill('');await p.locator('.people-onboarding').waitFor();assert.equal(await p.locator('.people-onboarding-motion svg').count(),0);assert.equal(await p.locator('.people-onboarding-art>svg').count(),1);assert(await p.locator('.people-onboarding-still').isVisible());await p.screenshot({path:path.join(output,'reduced-motion.png'),animations:'disabled'});
  await p.emulateMedia({reducedMotion:'no-preference'});await p.locator('.people-onboarding-motion svg').waitFor();await p.waitForFunction(()=>lottie.getRegisteredAnimations().some(a=>a.animationData?.nm==='Local people album guide'&&a.isLoaded&&!a.isPaused));await root(p,r=>r.nav('#/people/hidden'));await p.getByText('没有隐藏的人物',{exact:true}).waitFor();assert.equal(await p.locator('.people-onboarding').count(),0);
  await p.evaluate(()=>{window._testLottie=window.lottie;window.lottie=undefined});await root(p,r=>r.nav('#/people'));await p.locator('.people-onboarding').waitFor();assert.equal(await p.locator('.people-onboarding-motion svg').count(),0);await p.getByRole('button',{name:'开始人脸识别',exact:true}).waitFor();await p.evaluate(()=>{window.lottie=window._testLottie;delete window._testLottie});
 });
 await check('A missing motion asset leaves the complete static guide and both actions available',async()=>{
  await root(p,r=>r.nav('#/people/hidden'));await p.getByText('没有隐藏的人物',{exact:true}).waitFor();
  await p.route('**/static/img/people-onboarding-motion.json*',route=>route.fulfill({status:404,body:'Not found'}));
  const response=p.waitForResponse(r=>r.url().includes('/static/img/people-onboarding-motion.json')&&r.status()===404);
  await root(p,r=>r.nav('#/people'));await response;await p.locator('.people-onboarding-still').waitFor({state:'visible'});
  assert.equal(await p.locator('.people-onboarding-art.is-animated').count(),0);assert.equal(await p.locator('.people-onboarding-actions .q-btn').count(),2);assert.equal(await p.locator('.people-onboarding-steps li').count(),3);
  await p.screenshot({path:path.join(output,'missing-motion-asset.png'),animations:'disabled'});
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.motionErrors,[]);assert.deepEqual(result.failed,[]);assert.deepEqual(result.writes,[]);result.ok=true;
})().catch(e=>{result.failure=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.checks.length,failure:result.failure,errors:result.errors,failed:result.failed}))});
