// Toast paint and actions, using only a synthetic local application fixture.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE,'utf8'));
assert.equal(new URL(fixture.url).hostname,'127.0.0.1');assert.match(fixture.scratch,/video-analyzer-tests-/);
const out=path.resolve(process.env.TOAST_THEME_OUTPUT||'build/toast-theme-validation');fs.mkdirSync(out,{recursive:true});
let browser;
(async()=>{
 browser=await chromium.launch({headless:true});const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
 const result={checks:[],paints:[],errors:[],failed:[],writes:[]};
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname);});
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method()))result.writes.push(new URL(r.url()).pathname);});
 const root=(fn,value)=>page.evaluate(({fn,value})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,value),{fn:String(fn),value});
 const settle=()=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
 const toast=()=>page.locator('.q-notification');
 const show=async options=>{
  await page.evaluate(options=>{window.__toastDismiss=Quasar.Notify.create({message:'操作已完成',caption:'提示详情说明',timeout:0,group:false,actions:[{label:'撤销',handler:()=>{window.__toastActions=(window.__toastActions||0)+1;}},{icon:'close','aria-label':'关闭提示'}],...options});},options);
  await toast().waitFor();await settle();
 };
 const close=async()=>{await page.evaluate(()=>window.__toastDismiss());await toast().waitFor({state:'hidden'});};
 const paint=()=>toast().evaluate(el=>{
  const context=document.createElement('canvas').getContext('2d');context.canvas.width=context.canvas.height=1;
  const rgba=value=>{context.clearRect(0,0,1,1);context.fillStyle=value;context.fillRect(0,0,1,1);return [...context.getImageData(0,0,1,1).data];};
  const over=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]/255+b[i]*(1-a[3]/255));
  const luminance=rgb=>rgb.map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
  const css=getComputedStyle(el),bg=rgba(css.backgroundColor);const ratio=node=>{
   const style=getComputedStyle(node),ink=rgba(style.color);ink[3]*=Number(style.opacity);
   const a=luminance(over(ink,bg)),b=luminance(bg.slice(0,3));return (Math.max(a,b)+.05)/(Math.min(a,b)+.05);
  };
  const caption=el.querySelector('.q-notification__caption'),button=el.querySelector('.q-btn'),icon=el.querySelector('.q-notification__icon,.q-notification__spinner');
  return {color:css.color,background:css.backgroundColor,message:ratio(el.querySelector('.q-notification__message')),caption:ratio(caption),action:ratio(button),icon:icon?ratio(icon):null,role:el.getAttribute('role')};
 });
 await page.goto(fixture.url+'/#/gallery');await page.waitForLoadState('networkidle');
 const variants=[['ordinary',{}],['explicit white',{color:'dark',textColor:'white'}],['success',{type:'positive'}],['success color',{color:'positive'}],['error',{type:'negative'}],['error color',{color:'negative'}],['warning',{type:'warning'}],['info',{type:'info'}],['ongoing',{type:'ongoing'}]];
 for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
  await root((r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode);},{theme,mode});await settle();
  for(const [variant,options] of variants){
   await show(options);const actual=await paint();result.paints.push({theme,mode,variant,...actual});
   for(const part of ['message','caption','action'])assert(actual[part]>=4.5,JSON.stringify({theme,mode,variant,part,...actual}));
   if(actual.icon!==null)assert(actual.icon>=3);assert.equal(actual.role,'alert');await close();
  }
 }
 result.checks.push('72 theme/mode/notification combinations keep message, caption and action contrast at least 4.5:1');
 await root(r=>{r.setAppearanceTheme('jade');r.setThemeMode('light');});await show({});
 await toast().screenshot({path:path.join(out,'ordinary-light.png'),animations:'disabled'});
 await root(r=>r.setThemeMode('dark'));await settle();const updated=await paint();assert(updated.message>=4.5&&updated.caption>=4.5);
 await toast().screenshot({path:path.join(out,'ordinary-dark.png'),animations:'disabled'});await close();
 result.checks.push('An already-visible ordinary toast follows appearance changes without being recreated');
 await show({});await toast().getByRole('button',{name:'撤销',exact:true}).focus();await page.keyboard.press('Enter');await toast().waitFor({state:'hidden'});assert.equal(await page.evaluate(()=>window.__toastActions),1);
 await show({});await toast().getByRole('button',{name:'关闭提示',exact:true}).click();await toast().waitFor({state:'hidden'});
 await show({timeout:50,actions:[]});await toast().waitFor({state:'hidden',timeout:3000});
 result.checks.push('Undo, close, keyboard activation and automatic dismissal retain their original behavior');
 await page.emulateMedia({colorScheme:'light'});await root(r=>r.setThemeMode('auto'));await settle();await show({});assert((await paint()).message>=4.5);await close();
 await page.emulateMedia({colorScheme:'dark'});await settle();await show({});assert((await paint()).message>=4.5);await close();
 result.checks.push('System-following appearance retains readable toast text in both OS modes');
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);assert.deepEqual(result.writes,[]);result.ok=true;
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.checks.length,paints:result.paints.length,errors:result.errors,writes:result.writes}));await browser.close();
})().catch(async e=>{console.error(e);if(browser){await browser.contexts()[0]?.pages()[0]?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});await browser.close();}process.exitCode=1;});
