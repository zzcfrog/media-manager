const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const fixture=JSON.parse(fs.readFileSync(process.env.RECOGNITION_SETTINGS_FIXTURE));
assert(fixture.scratch.includes('video-analyzer-tests-'));assert.equal(new URL(fixture.url).hostname,'127.0.0.1');
const output=path.resolve(process.env.FACE_IMPORT_OUTPUT||'build/face-options-2026-11-02');fs.mkdirSync(output,{recursive:true});
const result={checks:[],errors:[],failed:[]};
const root=(page,fn,data)=>page.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
const settled=page=>page.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
(async()=>{
 const browser=await chromium.launch({headless:true});
 try{
  const page=await browser.newPage({viewport:{width:1440,height:900}});page.setDefaultTimeout(8000);
  page.on('pageerror',e=>result.errors.push(e.message));
  page.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
  await page.goto(fixture.url);await page.waitForLoadState('networkidle');
  for(const kind of ['image','video','all','off','none']){
   await root(page,(r,paths)=>{r.showImport=false;r.openImport();r.selectedPaths=paths},fixture.typed_import_paths[kind]);
   const checkbox=page.getByRole('switch',{name:'导入后在后台识别人脸',exact:true});
   assert.equal(await checkbox.isChecked(),false);
   const classify=page.getByRole('switch',{name:'导入后在后台快速分类',exact:true});assert.equal(await classify.isChecked(),false);
   const classifyMedia=['video','all','off'].includes(kind);if(classifyMedia)await classify.check();
   assert.equal(await page.getByRole('group',{name:'人脸识别素材类型',exact:true}).count(),0);
   const organizePeople=!['off','none'].includes(kind);
   if(organizePeople){
    await checkbox.check();const group=page.getByRole('group',{name:'人脸识别素材类型',exact:true});
    assert.equal(await group.getByRole('button',{name:'两者识别',exact:true}).getAttribute('aria-pressed'),'true');
    await group.getByRole('button',{name:{image:'仅图片',video:'仅视频',all:'两者识别'}[kind],exact:true}).click();
   }
   const sent=page.waitForRequest(r=>r.url().endsWith('/api/library/import-batch'));
   await page.getByRole('button',{name:'确认导入',exact:true}).click();const payload=(await sent).postDataJSON();
   assert.equal(payload.organize_people,organizePeople);assert.equal(payload.people_media_type,organizePeople?kind:'all');assert.equal(payload.classify_media,classifyMedia);
   await page.getByText('导入完成',{exact:true}).waitFor();
   assert.equal(await root(page,r=>r.importedItems.length),3);
   assert.equal(await root(page,r=>r.failedItems.length),0);
   const status=await(await page.request.get(fixture.url+'/api/people/status')).json();
   const names=status.recent.filter(j=>j.file_name.startsWith(kind+'.')).map(j=>j.file_name).sort();
   assert.deepEqual(names,{image:['image.jpg'],video:['video.mp4'],all:['all.jpg','all.mp4'],off:[],none:[]}[kind]);
   const items=await root(page,r=>JSON.parse(JSON.stringify(r.importedItems)));
   const jobs=(await(await page.request.get(fixture.url+'/api/taxonomy/jobs')).json()).data;
   const queued=items.filter(item=>jobs.some(job=>job.media_id===item.id)).map(item=>item.file_name).sort();
   assert.deepEqual(queued,classifyMedia?[kind+'.jpg']:[]);
   result.checks.push(kind+': imports all files; face detection honors image/video scope; classification queues photos only');
  }
  await root(page,r=>{r.showImport=false;r.openImport()});
  await page.getByRole('switch',{name:'导入后在后台识别人脸',exact:true}).check();
  const group=page.getByRole('group',{name:'人脸识别素材类型',exact:true});
  for(const width of [1000,1440])for(const mode of ['light','dark']){
   await page.setViewportSize({width,height:width===1000?600:900});
   await root(page,(r,m)=>{r.setAppearanceTheme('jade');r.setThemeMode(m)},mode);await settled(page);
   const g=await group.evaluate(el=>{const b=el.getBoundingClientRect();return {left:b.left,right:b.right,overflow:el.scrollWidth>el.clientWidth}});
   assert(g.left>=0&&g.right<=width&&!g.overflow);
   if(width===1440)await page.screenshot({path:path.join(output,'import-'+mode+'.png'),animations:'disabled'});
  }
  result.checks.push('Three import choices fit light/dark and compact desktop layouts');
  await root(page,r=>r.onLanguageChange('en'));
  for(const name of ['Images only','Videos only','Both'])await page.getByRole('button',{name,exact:true}).waitFor();
  result.checks.push('Import scope labels support English');
  assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);result.ok=true;
 }finally{await browser.close();fs.writeFileSync(path.join(output,'import-browser-results.json'),JSON.stringify(result,null,2)+'\n')}
})().catch(e=>{console.error(e);process.exitCode=1});
