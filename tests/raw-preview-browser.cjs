// Real image decoding in Chromium, backed only by synthetic offline RAW records.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));
assert.equal(new URL(fixture.url).hostname,'127.0.0.1');assert(fixture.scratch.includes('video-analyzer-tests-'));assert.equal(fixture.raw_media.length,2);
const out=path.resolve(process.env.RAW_PREVIEW_OUTPUT||'build/raw-and-grouping-2026-11-07/raw-browser');fs.mkdirSync(out,{recursive:true});let browser,page;
const result={checks:[],errors:[],writes:[],expectedMissingImages:[],geometry:[]};
(async()=>{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(10000);
 const [cached,missing]=fixture.raw_media,original=await page.request.get(fixture.url+'/media/image/'+cached);assert.equal(original.status(),200);const pixels=await original.body();
 page.on('pageerror',e=>result.errors.push(e.message));page.on('response',r=>{if(r.status()===404&&new URL(r.url()).pathname==='/media/image/'+missing)result.expectedMissingImages.push(404)});
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())&&new URL(r.url()).pathname.startsWith('/api/'))result.writes.push(new URL(r.url()).pathname)});
 const root=(fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const error=()=>page.locator('.image-preview-error'),image=()=>page.locator('.img-view-area > div img').first();
 await check('Offline NEF detail loads the oriented high quality cache and stops its spinner',async()=>{
  await page.goto(fixture.url+'/#/detail/'+cached);await image().waitFor();await page.waitForFunction(()=>document.querySelector('.img-view-area img')?.naturalWidth===2400);
  assert.equal(await error().count(),0);assert.equal(await page.locator('.img-view-area .q-spinner').count(),0);
  assert.equal(await image().evaluate(el=>el.naturalHeight),1600);await page.screenshot({path:path.join(out,'cached-raw.png')});
 });
 await check('Missing RAW displays an actionable message, ends loading, and keyboard retry recovers',async()=>{
  await page.goto(fixture.url+'/#/detail/'+missing);await error().waitFor();assert((await error().innerText()).includes('原片'));
  assert.equal(await page.locator('.img-view-area .q-spinner').count(),0);
  await page.route('**/media/image/'+missing+'*',route=>route.fulfill({contentType:'image/jpeg',body:pixels}));
  const retry=error().getByRole('button',{name:'重新读取',exact:true});await retry.focus();await retry.press('Enter');await error().waitFor({state:'hidden'});
  await page.waitForFunction(()=>document.querySelector('.img-view-area img')?.naturalWidth===2400);assert.equal(await page.locator('.img-view-area .q-spinner').count(),0);
  await page.unroute('**/media/image/'+missing+'*');
 });
 await check('The unavailable state fits light/dark themes and compact windows without business writes',async()=>{
  await page.reload();await error().waitFor();
  for(const width of [1000,1440])for(const mode of ['light','dark']){
   await page.setViewportSize({width,height:width===1000?600:900});await root((r,mode)=>r.setThemeMode(mode),mode);
   const b=await error().boundingBox();assert(b.x>=0&&b.x+b.width<=width+1);result.geometry.push({width,mode,withinWindow:true});
   if(width===1440)await page.screenshot({path:path.join(out,'unavailable-'+mode+'.png')});
  }
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.writes,[]);assert(result.expectedMissingImages.length>=1);result.ok=true;
})().catch(async e=>{result.failure=e.stack;process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})}).finally(async()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify(result));await browser?.close()});
