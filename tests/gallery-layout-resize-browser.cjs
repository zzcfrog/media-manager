// Gallery right controls and inspector resizing, using only synthetic media.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE));
assert.equal(new URL(fixture.url).hostname,'127.0.0.1');assert(fixture.scratch.includes('video-analyzer-tests-'));
const out=path.resolve(process.env.GALLERY_LAYOUT_OUTPUT||'build/gallery-layout-resize-2026-11-07');fs.mkdirSync(out,{recursive:true});
const result={checks:[],metrics:[],issues:[],errors:[],failed:[],writes:[]};let browser,page;
(async()=>{
 browser=await chromium.launch({headless:true});page=await browser.newPage({viewport:{width:1600,height:900}});page.setDefaultTimeout(10000);
 await page.addInitScript(()=>{localStorage.setItem('libraryInspector','false');localStorage.setItem('galleryFilters',JSON.stringify({viewMode:'justified',justifiedRowH:220,filters:{media_type:'image'},sortBy:'date_taken',groupBy:''}));});
 await page.addInitScript(()=>{
  const active=new WeakSet(),observe=ResizeObserver.prototype.observe,disconnect=ResizeObserver.prototype.disconnect;
  window.__galleryObservers={active:0,disconnected:0};
  ResizeObserver.prototype.observe=function(node,...args){if(node.classList.contains('gallery-page')&&!active.has(this)){active.add(this);window.__galleryObservers.active++;}return observe.call(this,node,...args);};
  ResizeObserver.prototype.disconnect=function(){if(active.has(this)){active.delete(this);window.__galleryObservers.active--;window.__galleryObservers.disconnected++;}return disconnect.call(this);};
 });
 page.on('pageerror',e=>result.errors.push(e.message));page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 page.on('request',r=>{if(!['GET','HEAD','OPTIONS'].includes(r.method())&&new URL(r.url()).pathname.startsWith('/api/'))result.writes.push(new URL(r.url()).pathname)});
 const root=(fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
 const settle=async()=>{await page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));};
 const note=(ok,description,values)=>{if(!ok)result.issues.push({description,...values});};
 const measure=async label=>{
  await settle();const m=await page.evaluate(()=>{
   const gallery=document.querySelector('.gallery-page'),bar=document.querySelector('.filter-bar');
   const rect=node=>{const b=node.getBoundingClientRect();return{x:b.x,y:b.y,right:b.right,width:b.width,height:b.height}};
   const style=getComputedStyle(gallery),g=rect(gallery),view=rect(document.querySelector('.gallery-view-switcher')),inspector=rect(document.querySelector('.inspector-toggle'));
   const usable=gallery.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight),left=g.x+gallery.clientLeft+parseFloat(style.paddingLeft);
   const rows=[...gallery.querySelectorAll(':scope > .justified-row')].slice(0,-1).slice(0,4).map(row=>({lastRight:rect(row.lastElementChild).right,gap:parseFloat(getComputedStyle(row).columnGap)}));
   return{gallery:g,usable,rows:rows.map(row=>({...row,remaining:left+usable-row.lastRight})),view,inspector,sort:rect(document.querySelector('.gallery-order-controls')),bar:rect(bar),wholePageOverflow:document.documentElement.scrollWidth>innerWidth};
  });result.metrics.push({label,...m});
  note(Math.abs(m.inspector.x-m.view.right-8)<=1,'View controls must sit 8px before the far-right inspector',{label,actual:m.inspector.x-m.view.right});
  note(m.rows.every(row=>Math.abs(row.remaining)<=1),'Completed justified rows must fill the current content width',{label,remaining:m.rows.map(row=>row.remaining)});
  note(m.rows.every(row=>row.gap===8),'Horizontal media spacing stays 8px',{label});note(!m.wholePageOverflow,'No whole-page horizontal overflow',{label});
  note(m.sort.x>=m.bar.x-1&&m.inspector.right<=m.bar.right+1,'Right controls remain within the filter bar',{label});
  return m;
 };
 await page.goto(fixture.url+'/#/gallery');await page.waitForLoadState('networkidle');await page.locator('.justified-card').first().waitFor();
 await measure('initial');
 const inspector=page.getByRole('button',{name:'检查器',exact:true});
 await inspector.click();await measure('inspector-open');await inspector.click();await measure('inspector-closed');
 result.checks.push('Justified rows resize when the inspector opens and closes');
 if(!process.env.GALLERY_LAYOUT_BEFORE){
  for(const width of [1000,1280,1600,1920]){
   await page.setViewportSize({width,height:900});await measure('width-'+width);
   await inspector.click();await measure('width-'+width+'-open');await inspector.click();await measure('width-'+width+'-closed');
  }
  await page.setViewportSize({width:1600,height:900});
  for(const route of ['#/gallery','#/favorites','#/classify']){
   await root((r,route)=>r.nav(route),route);await page.waitForFunction(()=>!document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.$refs.gallery.loading);
   await root(r=>{r.$refs.gallery.viewMode='justified';r.$refs.gallery.stackMode='off';r.$refs.gallery.groupBy='';});
   const before=await measure(route+'-unselected');
   await page.locator('.justified-card').first().click();const after=await measure(route+'-selected');
   note(Math.abs(before.sort.x-after.sort.x)<=1,'Selecting media must not move sort and view controls',{route,before:before.sort.x,after:after.sort.x});
   if(route!=='#/classify'){assert(await page.locator('.batch-analysis-btn').isVisible());assert(await page.getByRole('button',{name:'标签操作',exact:true}).isVisible());}
   for(const width of [1000,1280]){await page.setViewportSize({width,height:900});await measure(route+'-selected-'+width);}
   await page.setViewportSize({width:1600,height:900});await root(r=>{r.$refs.gallery.selArr=[];});
  }
  result.checks.push('Right alignment and selection controls remain stable across library, favorites and categories');
  await root(r=>r.nav('#/gallery'));await page.waitForFunction(()=>!document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy.$refs.gallery.loading);
  for(const mode of ['grid','masonry','justified','list']){
   await root((r,mode)=>{r.$refs.gallery.viewMode=mode;},mode);await settle();
   await inspector.click();await settle();await inspector.click();const m=await measure(mode+'-closed');
   note(m.gallery.width>1000,'Closing inspector restores gallery width in every view',{mode,width:m.gallery.width});
  }
  result.checks.push('All four view modes retain the restored gallery width');
  await root(r=>{r.$refs.gallery.viewMode='justified';r.$refs.gallery.inspectorOpen=false;});
  await page.locator('.sidebar-toggle').click();await measure('sidebar-collapsed');
  await page.locator('.sidebar-toggle').click();await measure('sidebar-expanded');
  result.checks.push('Justified rows also track sidebar width changes');
  await inspector.focus();await inspector.press('Enter');await measure('keyboard-open');
  await page.locator('.media-inspector .inspector-header .q-btn').click();await measure('panel-close');
  assert.equal(await inspector.getAttribute('aria-pressed'),'false');
  await root(r=>r.nav('#/people'));await page.locator('.gallery-page').waitFor({state:'hidden'});
  assert.equal(await page.evaluate(()=>window.__galleryObservers.active),0);assert(await page.evaluate(()=>window.__galleryObservers.disconnected)>0);
  await page.setViewportSize({width:1440,height:900});await root(r=>r.nav('#/gallery'));await page.locator('.justified-card').first().waitFor();await measure('reactivated');
  assert.equal(await page.evaluate(()=>window.__galleryObservers.active),1);
  result.checks.push('Keyboard and panel close both reflow; leaving the gallery releases its size observer');
  for(const appearance of ['light','dark']){await root((r,mode)=>r.setThemeMode(mode),appearance);await settle();await page.screenshot({path:path.join(out,'gallery-'+appearance+'.png')});}
  await page.evaluate(()=>document.querySelector('[data-v-app]').__vue_app__.unmount());assert.equal(await page.evaluate(()=>window.__galleryObservers.active),0);
 }
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);assert.deepEqual(result.writes,[]);assert.deepEqual(result.issues,[]);result.ok=true;
})().catch(async error=>{result.failure=error.stack;process.exitCode=1;await page?.screenshot({path:path.join(out,'failure.png')}).catch(()=>{})}).finally(async()=>{fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(result,null,2));console.log(JSON.stringify({checks:result.checks,issues:result.issues,errors:result.errors,failure:result.failure}));await browser?.close()});
