// Render the grouping reasons in a real browser; only isolated synthetic data is used.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const f=JSON.parse(fs.readFileSync(process.env.PEOPLE_BROWSER_FIXTURE));assert(f.scratch.includes('video-analyzer-tests-'));
const out=path.resolve(process.env.VIDEO_TRACK_REVIEW_OUTPUT||'build/video-track-identity-2026-11-07/browser');fs.mkdirSync(out,{recursive:true});
const result={checks:[],errors:[],failed:[],writes:[],geometry:[]};let browser;
const root=(p,fn,data)=>p.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
const settle=p=>p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
(async()=>{
 browser=await chromium.launch({headless:true});const p=await browser.newPage({viewport:{width:1440,height:900}});p.setDefaultTimeout(10000);
 p.on('pageerror',e=>result.errors.push(e.message));p.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 p.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname.startsWith('/api/'))result.writes.push(new URL(r.url()).pathname)});
 const conflict=f.face_reviews.find(r=>r.face.id===f.low_quality_face_id),uncertain=f.face_reviews.find(r=>r.face.id===f.face_ids[0]);
 // Unit tests generate these payloads through real grouping. Here only the rendering is varied.
 await p.route('**/api/people/reviews?*',async route=>{
  if(new URL(route.request().url()).searchParams.get('kind')!=='face')return route.continue();
  const response=await route.fetch(),data=await response.json();
  for(const row of data.data){
   if(row.id===conflict.id)row.payload.reason='track_conflict';
   if(row.id===uncertain.id){row.payload.reason='track_match_uncertain';row.face.person_id=null;row.left=null;}
  }
  await route.fulfill({response,json:data});
 });
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 await p.goto(f.url+'/#/people/review');await p.waitForLoadState('networkidle');await root(p,r=>r.onLanguageChange('zh'));
 await p.getByRole('tab',{name:'待确认人脸',exact:true}).click();
 const bad=p.locator('[data-review-id="'+conflict.id+'"]'),maybe=p.locator('[data-review-id="'+uncertain.id+'"]');
 await check('Track conflicts and uncertain identity are explicit, with current and suggested identities',async()=>{
  await bad.getByText('出镜待核对',{exact:true}).waitFor();await maybe.getByText('归属待核对',{exact:true}).waitFor();
  assert.match(await bad.locator('.people-review-current').innerText(),/尚未归组/);assert.match(await maybe.locator('.people-review-current').innerText(),/尚未归组/);
  assert.match(await maybe.locator('.people-review-suggested').innerText(),/阿远/);assert.equal(await bad.getByText('画质不足',{exact:true}).count(),0);
 });
 await check('Reasons are accessible descriptions; avatar correction still supports keyboard cancel without writes',async()=>{
  const cdp=await p.context().newCDPSession(p),ax=await cdp.send('Accessibility.getFullAXTree');await cdp.detach();
  for(const reason of ['出镜待核对','归属待核对'])assert(ax.nodes.some(n=>!n.ignored&&n.role?.value==='button'&&n.description?.value===reason));
  const trigger=maybe.locator('.people-review-correct');await trigger.focus();await trigger.press('Enter');
  const editor=p.locator('#people-review-editor-'+uncertain.id+' .people-face-editor');await editor.locator('.people-face-person').first().waitFor();
  await editor.locator('[data-person-id="'+f.other_id+'"]').click();assert(await editor.getByRole('button',{name:'确认纠正',exact:true}).isEnabled());
  await p.keyboard.press('Escape');await editor.waitFor({state:'hidden'});assert.deepEqual(result.writes,[]);
 });
 await check('Reason badges fit all themes and both desktop widths without changing the card grid',async()=>{
  for(const width of [1000,1440])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await p.setViewportSize({width,height:900});await root(p,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});await settle(p);
   const metrics=await p.locator('.people-review-grid.is-face-review').evaluate(el=>({columns:getComputedStyle(el).gridTemplateColumns.split(' ').length,overflow:el.scrollWidth>el.clientWidth,
    badges:[...el.querySelectorAll('.people-review-source small')].map(s=>({visible:s.getBoundingClientRect().width>0,overflow:s.scrollWidth>s.clientWidth}))}));
   assert.equal(metrics.columns,width===1000?1:2);assert(!metrics.overflow&&metrics.badges.every(b=>b.visible&&!b.overflow));result.geometry.push({width,theme,mode,...metrics});
   if(width===1440&&theme==='jade')await p.screenshot({path:path.join(out,mode+'.png'),animations:'disabled'});
  }
 });
 await check('English descriptions distinguish uncertainty from image quality',async()=>{
  await root(p,r=>r.onLanguageChange('en'));await bad.getByText('Face sequence needs review',{exact:true}).waitFor();await maybe.getByText('Identity needs review',{exact:true}).waitFor();
  assert.equal(await bad.getByText('Insufficient quality',{exact:true}).count(),0);assert.deepEqual(result.writes,[]);
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
})().catch(e=>{result.failure=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({checks:result.checks.length,errors:result.errors,failed:result.failed,failure:result.failure}))});
