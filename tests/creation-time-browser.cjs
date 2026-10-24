// Only synthetic fixture files may be changed by this real-browser test.
const {chromium}=require('playwright');
const fs=require('fs'),path=require('path'),assert=require('assert'),crypto=require('crypto');
const fixture=JSON.parse(fs.readFileSync(process.env.VIDEO_ANALYZER_TEST_FIXTURE||'/tmp/video-analyzer-fix-browser.json','utf8'));
const output=process.env.VIDEO_ANALYZER_CREATION_TIME_OUTPUT||'/tmp/luminisle-creation-time-browser';
fs.mkdirSync(output,{recursive:true});
const rootCode="document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy";
function snapshot(file){const s=fs.statSync(file);return {birth:s.birthtimeMs,mtime:s.mtimeMs,ino:s.ino,size:s.size,
  hash:crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')};}
(async()=>{
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:1280,height:850}});
  const pageErrors=[],failedRequests=[],consoleErrors=[],checks=[];
  page.on('pageerror',e=>pageErrors.push(e.message));
  page.on('requestfailed',r=>failedRequests.push(r.url()));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  page.setDefaultTimeout(12000);
  const card=id=>page.locator('.media-card[data-id="'+id+'"]');
  const dialog=()=>page.getByRole('dialog');
  async function open(ids){
    await card(ids[0]).click();
    for(const id of ids.slice(1))await card(id).click({modifiers:['Meta']});
    await card(ids[0]).click({button:'right'});
    await page.locator('.ctx-menu-popup .q-item').filter({hasText:'调整创建时间'}).click();
    await dialog().getByText('调整创建时间',{exact:true}).waitFor();
    // Quasar animates the dialog; locator.click waits for the track to settle.
    await dialog().getByRole('slider').locator('.q-slider__track-container').click();
  }
  async function shift(ids,hours){
    await open(ids);
    const apply=dialog().getByRole('button',{name:'应用偏移',exact:true});
    assert(await apply.isDisabled());
    const slider=dialog().getByRole('slider');
    const bounds=await slider.boundingBox();
    await page.mouse.move(bounds.x+bounds.width/2,bounds.y+bounds.height/2);
    await page.mouse.down();
    await page.mouse.move(hours>0?bounds.x+bounds.width-1:bounds.x+1,bounds.y+bounds.height/2,{steps:8});
    await page.mouse.up();
    await page.waitForFunction(({code,hours})=>eval(code).$refs.gallery.adjustTime.hours===hours,{code:rootCode,hours});
    assert.equal(await slider.getAttribute('aria-valuenow'),String(hours));
    await dialog().getByText(hours>0?'后移 '+hours+' 小时（创建时间变晚）':'前移 '+(-hours)+' 小时（创建时间变早）',{exact:true}).waitFor();
    const response=page.waitForResponse(r=>r.url().endsWith('/api/library/shift-creation-time'));
    await apply.click();const body=await (await response).text();
    const final=JSON.parse(body.trim().split('\n\n').at(-1).slice(6));
    assert.equal(final.updated,ids.length);assert.equal(final.errors,0);
    await page.waitForFunction(()=>document.querySelectorAll('.q-dialog').length===0);
  }
  try{
    await page.goto(fixture.url);await card(fixture.media_id).waitFor();
    const ids=[fixture.media_id,fixture.image_ids[0]];
    const media=await Promise.all(ids.map(async id=>(await page.request.get(fixture.url+'/api/library/'+id)).json()));
    for(const m of media)assert(m.file_path.startsWith(fixture.scratch+path.sep));
    const before=media.map(m=>snapshot(m.file_path));

    await open([ids[0]]);
    assert(await dialog().getByRole('button',{name:'应用偏移'}).isDisabled());
    await dialog().getByRole('button',{name:'取消',exact:true}).click();
    assert.deepEqual(snapshot(media[0].file_path),before[0]);
    checks.push('right-click entry, zero disabled, cancel leaves the source untouched');

    await shift([ids[0]],24);
    assert(Math.abs(snapshot(media[0].file_path).birth-before[0].birth-86400000)<1000);
    checks.push('single video: slider +24h writes actual filesystem creation time');
    const beforeBatch=media.map(m=>snapshot(m.file_path));
    await shift(ids,-24);
    for(let i=0;i<media.length;i++){
      const after=snapshot(media[i].file_path);
      assert(Math.abs(after.birth-beforeBatch[i].birth+86400000)<1000);
      for(const key of ['mtime','ino','size','hash'])assert.equal(after[key],before[i][key]);
      const current=await (await page.request.get(fixture.url+'/api/library/'+ids[i])).json();
      assert.equal(current.date_taken,media[i].date_taken);assert.equal(current.created_at,media[i].created_at);
    }
    checks.push('multi-select photo + video: -24h; bytes, inode, mtime, shooting and import dates unchanged');

    await page.setViewportSize({width:1000,height:650});
    await page.evaluate(code=>{const r=eval(code);r.setThemeMode('dark');},rootCode);
    await open(ids);
    const box=await dialog().locator('.q-card').boundingBox();assert(box.x>=0&&box.y>=0&&box.x+box.width<=1000&&box.y+box.height<=650);
    await page.screenshot({path:path.join(output,'creation-time-dark.png')});
    await page.evaluate(()=>{i18nState.locale='en';});
    await dialog().getByText('Adjust Creation Time',{exact:true}).waitFor();
    await dialog().getByRole('button',{name:'Cancel',exact:true}).click();
    await page.evaluate(code=>{i18nState.locale='zh';eval(code).setThemeMode('light');},rootCode);
    checks.push('1000×650 dark dialog fits, English labels and cancel remain usable');

    // Emulate permission/readback failure; the synthetic source must not be touched.
    await page.route('**/api/library/shift-creation-time',route=>route.fulfill({contentType:'text/event-stream',
      body:'data: {"type":"done","updated":0,"skipped":0,"errors":1,"hours":1}\n\n'}));
    await open([ids[0]]);await dialog().getByRole('slider').locator('.q-slider__track-container').press('ArrowRight');
    await dialog().getByRole('button',{name:'应用偏移',exact:true}).click();
    await page.getByText(/部分文件未通过创建时间写入校验/).waitFor();
    await page.unroute('**/api/library/shift-creation-time');
    checks.push('failed write verification produces a visible failure notification');

    await page.route('**/api/library/shift-creation-time',route=>route.fulfill({contentType:'text/event-stream',
      body:'data: {"type":"progress","done":1,"total":2,"updated":1,"errors":0}\n\n'}));
    await open([ids[0]]);await dialog().getByRole('slider').locator('.q-slider__track-container').press('ArrowLeft');
    await dialog().getByRole('button',{name:'应用偏移',exact:true}).click();
    await page.getByText(/连接中断，未收到完成结果/).waitFor();
    await page.unroute('**/api/library/shift-creation-time');
    checks.push('interrupted stream closes progress and warns against blindly repeating a shift');

    await card(ids[0]).click({button:'right'});
    await page.locator('.ctx-menu-popup .q-item').filter({hasText:'拍摄时间时区调整'}).click();
    await dialog().getByText('拍摄时间时区调整',{exact:true}).waitFor();
    await dialog().getByRole('button',{name:'取消',exact:true}).click();
    checks.push('existing shooting-time dialog still opens independently');
    assert.deepEqual(pageErrors,[]);assert.deepEqual(failedRequests,[]);assert.deepEqual(consoleErrors,[]);
    const result={checks,pageErrors,failedRequests,consoleErrors};
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2));
    console.log(JSON.stringify(result,null,2));
  }catch(error){
    console.error(await page.evaluate(code=>({dialog:document.querySelector('.q-dialog')?.outerHTML,
      state:eval(code).$refs.gallery?.adjustTime}),rootCode));
    await page.screenshot({path:path.join(output,'failure.png')});
    throw error;
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
