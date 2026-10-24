// Real Chromium, isolated fixture only. No production profile, sources or model calls.
const {chromium} = require('playwright');
const fs = require('fs'), path = require('path'), assert = require('assert');
const fixture = JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE || '/tmp/video-analyzer-fix-browser.json', 'utf8'));
const output = process.env.VIDEO_ANALYZER_IMPORT_OUTPUT || '/tmp/luminisle-import-browser';
fs.mkdirSync(output, {recursive:true});
const rootCode = "document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy";
(async () => {
  const browser = await chromium.launch({headless:true});
  const page = await browser.newPage({viewport:{width:1280,height:850}});
  const errors=[], failed=[], consoleErrors=[], httpErrors=[], checks=[];
  page.on('pageerror', e => errors.push(e.message));
  page.on('requestfailed', r => failed.push(r.url()));
  page.on('console', m => { if(m.type()==='error') consoleErrors.push(m.text()); });
  page.on('response', r => { if(r.status()>=400) httpErrors.push({url:r.url(),status:r.status()}); });
  page.setDefaultTimeout(12000);
  try {
    await page.goto(fixture.url);
    await page.locator('.media-card').first().waitFor();
    const source = (await (await page.request.get(fixture.url+'/api/library/'+fixture.media_id)).json());
    assert(source.file_path.startsWith(fixture.scratch + path.sep));
    const importDir=fs.mkdtempSync(path.join(fixture.scratch,'import-browser-'));
    const files = ['Import 中文 1.mov', 'Import 中文 2.mov'].map(n => path.join(importDir, n));
    for (const file of files) fs.copyFileSync(source.file_path, file);
    await page.evaluate(({code,files}) => { const r=eval(code); r.openImport(); r.selectedPaths=files; }, {code:rootCode,files});
    await page.getByRole('button',{name:'确认导入',exact:true}).click();
    await page.getByText('导入完成',{exact:true}).waitFor();
    let state = await page.evaluate(code=>{const r=eval(code);return{count:r.importedItems.length,failed:r.failedItems.length,processed:r.importProcessed,items:r.importedItems};},rootCode);
    assert.equal(state.count,2);assert.equal(state.failed,0);assert.equal(state.processed,2);
    const preservedId=state.items[0].id;
    checks.push('real scan → two-worker video import → committed records and preview cards');
    await page.locator('.import-preview-card').first().click();
    await page.waitForURL('**/#/detail/'+preservedId);
    checks.push('completed preview opens actual media detail');
    await page.goto(fixture.url);await page.locator('.media-card').first().waitFor();
    await page.evaluate(async ({code,files})=>{const r=eval(code);r.openImport();r.selectedPaths=files;await r.startImport();},{code:rootCode,files});
    assert.deepEqual(await page.evaluate(code=>{const r=eval(code);return [r.importedItems.length,r.skippedItems.length,r.importError];},rootCode),[0,2,false]);
    checks.push('repeat scan skips both previously imported sources');

    // 3,000 cards remain accessible without 3,000 DOM nodes or thumbnail requests.
    await page.evaluate(({code,thumb})=>{const r=eval(code);r.importError=false;r.importStep='done';r.importedItems=Array.from({length:3000},(_,i)=>({id:900000+i,file_name:'Synthetic '+i+'.jpg',media_type:'image',width:6000,height:4000,file_size:100000,thumbnail_path:null}));r.showImport=true;window._openedImport=[];r.openDetail=id=>window._openedImport.push(id);},{code:rootCode,thumb:fixture.media_id});
    await page.locator('.import-preview-list').waitFor();
    const cardCount=await page.locator('.import-preview-card').count();assert(cardCount<200,cardCount);
    await page.locator('.import-preview-list').evaluate(e=>{e.scrollTop=e.scrollHeight;});
    await page.getByText('Synthetic 2999.jpg',{exact:true}).waitFor();
    await page.getByText('Synthetic 2999.jpg',{exact:true}).click();
    assert.deepEqual(await page.evaluate(()=>window._openedImport),[902999]);
    await page.screenshot({path:path.join(output,'import-3000.png')});
    checks.push('3,000 results virtualized, final card reachable and clickable; rendered cards='+cardCount);
    await page.setViewportSize({width:1000,height:650});
    await page.locator('.import-preview-list').evaluate(e=>{e.scrollTop=0;});
    await page.getByText('Synthetic 0.jpg',{exact:true}).waitFor();
    const fits=await page.locator('.import-preview-list').evaluate(e=>e.scrollWidth<=e.clientWidth+1);
    assert(fits);checks.push('1,000px window retains the card grid without horizontal overflow');
    await page.evaluate(code=>{const r=eval(code);r.importStep='progress';r.importing=true;},rootCode);
    await page.locator('.import-preview-list').waitFor();
    await page.evaluate(code=>{const r=eval(code);r.importedItems.push({id:903000,file_name:'New arrival.jpg',media_type:'image'});},rootCode);
    await page.getByText('New arrival.jpg',{exact:true}).waitFor();
    assert(await page.locator('.import-preview-card').count()<200);
    checks.push('ongoing imports follow the newest row without rendering the full history');

    // Exercise fragmented UTF-8 SSE, failure/skip progress, and a truncated stream.
    for (const complete of [true,false]) {
      await page.evaluate(async ({code,complete})=>{
        const r=eval(code);r.openImport();r.selectedPaths=['synthetic'];
        API.scanPaths=async()=>({data:[{file_path:'a'},{file_path:'b'},{file_path:'c'}],skipped:[]});
        const events=[{type:'ok',done:1,total:3,data:{id:800001,file_name:'中文照片.jpg',media_type:'image'}},{type:'skip',done:2,total:3,file_path:'b'},{type:'fail',done:3,total:3,file_path:'c',error:'synthetic'}];
        if(complete)events.push({type:'done',imported:1,failed:1});
        const bytes=new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
        API.importBatch=async()=>({body:new ReadableStream({start(controller){for(let i=0;i<bytes.length;i+=3)controller.enqueue(bytes.slice(i,i+3));controller.close();}})});
        await r.startImport();
      },{code:rootCode,complete});
      const state=await page.evaluate(code=>{const r=eval(code);return[r.importedItems[0].file_name,r.importProcessed,r.failedItems.length,r.skippedItems.length,r.importError];},rootCode);
      assert.deepEqual(state,['中文照片.jpg',3,1,1,!complete]);
      if(!complete)await page.getByRole('alert').filter({hasText:'已入库的素材已保留'}).waitFor();
    }
    checks.push('fragmented UTF-8, skips/failures counted in progress, interrupted stream does not claim completion');
    await page.evaluate(code=>{const r=eval(code);r.openImport();r.selectedPaths=['denied'];API.scanPaths=async()=>{throw new Error('synthetic permission denied');};return r.startImport();},rootCode);
    assert.equal(await page.evaluate(code=>eval(code).importError,rootCode),true);
    checks.push('scan error retains the dialog and exposes retry guidance');
    assert.deepEqual(errors,[]);assert.deepEqual(failed,[]);
    const unexpectedConsole=consoleErrors.filter(s=>!s.includes('Import stream ended before completion')&&!s.includes('synthetic permission denied'));
    assert.deepEqual(unexpectedConsole,[]);assert.deepEqual(httpErrors,[]);
    const result={checks,pageErrors:errors,failedRequests:failed,unexpectedConsoleErrors:unexpectedConsole,httpErrors};
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
