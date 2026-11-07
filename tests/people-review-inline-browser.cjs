// Real API corrections on an isolated synthetic library. No models or production data.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('/Users/zack/.agents/skills/playwright-skill/node_modules/playwright');
const f=JSON.parse(fs.readFileSync(process.env.PEOPLE_BROWSER_FIXTURE));
assert.equal(new URL(f.url).hostname,'127.0.0.1');assert.match(f.scratch,/video-analyzer-tests-/);assert.equal(f.face_reviews.length,3);
const output=path.resolve(process.env.PEOPLE_REVIEW_OUTPUT||'build/people-review-inline-2026-11-07');fs.mkdirSync(output,{recursive:true});
const result={checks:[],errors:[],failed:[],writes:[],geometry:[],accessibility:[]};let browser;
const root=(p,fn,data)=>p.evaluate(({fn,data})=>eval('('+fn+')')(document.querySelector('[data-v-app]').__vue_app__._container._vnode.component.proxy,data),{fn:String(fn),data});
const settle=p=>p.evaluate(()=>Promise.all(document.getAnimations().filter(a=>Number.isFinite(a.effect.getTiming().iterations)).map(a=>a.finished.catch(()=>{}))));
(async()=>{
 browser=await chromium.launch({headless:true});const p=await browser.newPage({viewport:{width:1440,height:900}});p.setDefaultTimeout(10000);
 p.on('pageerror',e=>result.errors.push(e.message));p.on('requestfailed',r=>{if(!r.failure().errorText.includes('ERR_ABORTED'))result.failed.push(new URL(r.url()).pathname)});
 p.on('request',r=>{if(r.method()!=='GET'&&new URL(r.url()).pathname.startsWith('/api/'))result.writes.push({path:new URL(r.url()).pathname,body:r.postDataJSON()})});
 const check=async(name,fn)=>{await fn();result.checks.push(name);console.log(name)};
 const review=f.face_reviews.find(r=>r.face.id===f.face_ids[0]),quality=f.face_reviews.find(r=>r.face.id===f.low_quality_face_id);
 const row=()=>p.locator('[data-review-id="'+review.id+'"]'),editor=()=>p.locator('#people-review-editor-'+review.id+' .people-face-editor');
 const enter=async()=>{await root(p,r=>r.nav('#/people/review'));await p.getByRole('tab',{name:'待确认人脸',exact:true}).click();await row().waitFor();await settle(p)};
 const popupFits=()=>p.waitForFunction(id=>{const el=document.querySelector('#people-review-editor-'+id);if(!el)return false;const r=el.getBoundingClientRect();return r.x>=0&&r.y>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1},review.id);
 const open=async()=>{const trigger=row().locator('.people-review-correct');if(await trigger.getAttribute('aria-expanded')!=='true')await trigger.click();await editor().locator('.people-face-person').first().waitFor();await popupFits()};
 const face=async(id=review.face.id)=>{const data=await(await p.request.get(f.url+'/api/people/media/'+(id===f.low_quality_face_id?f.low_quality_media_id:review.face.media_id))).json();return data.faces.find(x=>x.id===id)};
 const undo=async()=>{await p.getByRole('button',{name:'撤销',exact:true}).last().click();await row().waitFor();await p.waitForLoadState('networkidle')};
 await p.goto(f.url+'/#/people/review');await p.waitForLoadState('networkidle');await enter();
 await check('Two-column cards label observed face, current identity and proposed identity; unassigned quality cases stay explicit',async()=>{
  assert.equal(await p.locator('.people-face-review').count(),3);
  const cards=await p.locator('.people-face-review').evaluateAll(els=>els.map(el=>el.getBoundingClientRect().toJSON()));assert.equal(cards[0].y,cards[1].y);assert(cards[1].x>cards[0].right);assert(cards[2].y>cards[0].bottom);
  assert.equal(await row().locator('.people-review-current>small').innerText(),'当前归属');assert.match(await row().locator('.people-review-current>strong').innerText(),/^小林/);assert.equal(await row().locator('.people-review-suggested>small').innerText(),'建议归属');assert.equal(await row().locator('.people-review-suggested>strong').innerText(),'阿远');
  const low=p.locator('[data-review-id="'+quality.id+'"]');assert.match(await low.innerText(),/画质不足/);assert.match(await low.locator('.people-review-current').innerText(),/尚未归组/);assert.match(await low.locator('.people-review-suggested').innerText(),/暂无建议/);assert.equal(await low.getByRole('button',{name:'原归属正确',exact:true}).count(),0);
  assert.equal(result.writes.length,0);
 });
 await check('Anchored avatar selection, search, cancel and keyboard use never write until confirmation',async()=>{
  await open();assert.equal(await p.locator('.q-dialog').count(),0);assert.equal(await editor().locator('.q-select').count(),0);assert(await editor().getByRole('button',{name:'确认纠正',exact:true}).isDisabled());
  assert.equal(await editor().locator('.people-editor-modes').evaluate(el=>el.classList.contains('sliding-segments')),true);assert.equal(await editor().locator('.people-editor-modes').evaluate(el=>el.getBoundingClientRect().height),32);
  const search=editor().getByRole('textbox',{name:'搜索目标人物',exact:true});await search.fill('不存在');await editor().getByText('没有匹配的人物',{exact:true}).waitFor();await search.fill('阿远');
  const choice=editor().locator('[data-person-id="'+f.other_id+'"]');await choice.focus();await p.keyboard.press('Space');assert.equal(await choice.getAttribute('aria-pressed'),'true');assert.equal(await editor().locator('.people-editor-outcome').innerText(),'改为：阿远');
  assert.equal(result.writes.length,0);await p.keyboard.press('Escape');await editor().waitFor({state:'hidden'});await p.waitForFunction(id=>document.activeElement===document.querySelector('[data-review-id="'+id+'"] .people-review-correct'),review.id);
  await open();assert.equal(await editor().locator('.people-face-person.is-selected').count(),0);assert.match(await editor().locator('[data-person-id="'+f.hidden_homonym_id+'"]').innerText(),/小林.*#.*已隐藏/);
  await editor().getByRole('button',{name:'取消',exact:true}).click();assert.equal(result.writes.length,0);
  await open();await p.locator('.app-section-title').click();await editor().waitFor({state:'hidden'});assert.equal(result.writes.length,0);
 });
 await check('Moving a face keeps the scope/version, resolves that review, updates the footer and supports undo',async()=>{
  const before=await face();await open();await editor().locator('[data-person-id="'+f.other_id+'"]').click();await editor().getByRole('button',{name:'确认纠正',exact:true}).click();await row().waitFor({state:'hidden'});
  const after=await face();assert.equal(after.person_id,f.other_id);assert.equal(after.assignment,'manual');assert.match(await p.locator('.people-footer').innerText(),/^2 项待核对/);
  const post=result.writes.findLast(w=>w.path==='/api/people/faces/decide').body;assert.deepEqual(post.face_ids,[before.id]);assert.equal(post.versions[before.id],before.version);
  await undo();assert.equal((await face()).person_id,f.person_id);assert.match(await p.locator('.people-footer').innerText(),/^3 项待核对/);
 });
 await check('New person, unassigned, not-a-face, original identity and dismiss retain actual API behavior and undo',async()=>{
  for(const [action,label] of [['new','新建人物'],['unassigned','暂不归组'],['not_face','不是人脸'],['confirm','确认当前归属']]){
   await open();await editor().getByRole('button',{name:label,exact:true}).click();if(action==='new')await editor().getByLabel('新人物姓名（可以稍后命名）',{exact:true}).fill('就地新人物');
   await editor().getByRole('button',{name:'确认纠正',exact:true}).click();await row().waitFor({state:'hidden'});const updated=await face();
   if(action==='new'){assert.notEqual(updated.person_id,f.person_id);const person=await(await p.request.get(f.url+'/api/people/persons/'+updated.person_id)).json();assert.equal(person.name,'就地新人物');}
   else if(action==='confirm')assert.equal(updated.person_id,f.person_id);else {assert.equal(updated.person_id,null);assert.equal(updated.assignment,action);}
   await undo();
  }
  await row().getByRole('button',{name:'原归属正确',exact:true}).click();await row().waitFor({state:'hidden'});assert.equal((await face()).assignment,'manual');await undo();
  const low=p.locator('[data-review-id="'+quality.id+'"]');await low.getByRole('button',{name:'暂时忽略',exact:true}).click();await low.waitFor({state:'hidden'});await p.getByRole('button',{name:'撤销',exact:true}).last().click();await low.waitFor();
 });
 await check('Pending and failed corrections preserve the draft and prevent duplicate requests; version conflicts do not silently retry',async()=>{
  await open();await editor().getByRole('textbox',{name:'搜索目标人物',exact:true}).fill('阿远');await editor().locator('[data-person-id="'+f.other_id+'"]').click();
  let release;const gate=new Promise(r=>release=r);let posts=0;
  await p.route('**/api/people/faces/decide',async route=>{posts++;await gate;await route.fulfill({status:409,json:{error:'人脸归属已更新，请刷新'}})});
  await editor().getByRole('button',{name:'确认纠正',exact:true}).click();await p.waitForFunction(()=>document.querySelector('.people-face-editor').getAttribute('aria-busy')==='true');
  assert(await editor().getByRole('button',{name:'取消',exact:true}).isDisabled());assert.equal(await editor().locator('.people-face-person:enabled').count(),0);assert(await p.getByRole('tab',{name:'可能是同一人',exact:true}).isDisabled());
  release();await editor().getByRole('alert').filter({hasText:'人脸归属已更新，请刷新'}).waitFor();assert.equal(posts,1);assert.equal(await editor().getByRole('textbox',{name:'搜索目标人物',exact:true}).inputValue(),'阿远');assert.equal(await editor().locator('[data-person-id="'+f.other_id+'"]').getAttribute('aria-pressed'),'true');
  await p.unroute('**/api/people/faces/decide');assert.equal((await face()).person_id,f.person_id);await editor().getByRole('button',{name:'取消',exact:true}).click();
  await p.route('**/api/people/persons?view=hidden',route=>route.fulfill({status:503,json:{error:'Synthetic catalog read failure'}}));await row().getByRole('button',{name:'纠正',exact:true}).click();await editor().getByRole('alert').filter({hasText:'Synthetic catalog read failure'}).waitFor();assert(await editor().getByRole('button',{name:'确认纠正',exact:true}).isDisabled());
  await p.unroute('**/api/people/persons?view=hidden');await editor().getByRole('button',{name:'重试',exact:true}).click();await editor().locator('.people-face-person').first().waitFor();await editor().getByRole('button',{name:'取消',exact:true}).click();
 });
 await check('Inspector and multi-face correction share avatar selection, preserve scope and close after successful save',async()=>{
  const observations=await(await p.request.get(f.url+'/api/people/media/'+f.image_ids[0])).json();
  await root(p,(r,faces)=>r.openPeopleDialog('faces',{faces}),observations.faces);const dialog=p.locator('.people-correction-dialog');await dialog.locator('.people-face-person').first().waitFor();assert.equal(await dialog.locator('.q-select').count(),0);
  await dialog.locator('[data-person-id="'+f.other_id+'"]').click();await dialog.getByRole('button',{name:'确认纠正',exact:true}).click();await dialog.waitFor({state:'hidden'});await undo();
  const second=await(await p.request.get(f.url+'/api/people/media/'+f.image_ids[1])).json();const fresh=await(await p.request.get(f.url+'/api/people/media/'+f.image_ids[0])).json();
  await root(p,(r,faces)=>r.openPeopleDialog('faces',{faces}),[fresh.faces[0],second.faces[0]]);await dialog.locator('.people-face-person').first().waitFor();assert.equal(await dialog.locator('.people-face-selection img').count(),2);
  await dialog.getByRole('button',{name:'新建人物',exact:true}).click();await dialog.getByLabel('新人物姓名（可以稍后命名）',{exact:true}).fill('批量就地人物');await dialog.getByRole('button',{name:'确认纠正',exact:true}).click();await dialog.waitFor({state:'hidden'});
  const post=result.writes.findLast(w=>w.path==='/api/people/faces/decide').body;assert.deepEqual(post.face_ids,[fresh.faces[0].id,second.faces[0].id]);await undo();
 });
 await check('Original preview returns to the same review category; merge preview and pagination remain available',async()=>{
  await row().getByRole('button',{name:'查看原图中的这张脸',exact:true}).click();await p.waitForURL('**/#/detail/'+review.face.media_id);await p.locator('.detail-workspace').waitFor();await root(p,r=>r.returnFromDetail());await row().waitFor();assert.equal(await p.getByRole('tab',{name:'待确认人脸',exact:true}).getAttribute('aria-selected'),'true');
  await p.getByRole('tab',{name:'可能是同一人',exact:true}).click();await p.locator('.people-compare').first().waitFor();assert.equal(await p.locator('.people-review-card').count(),40);await p.getByRole('button',{name:'合并预览',exact:true}).first().click();await p.locator('.people-merge-preview').waitFor();await p.locator('.people-dialog').getByRole('button',{name:'取消',exact:true}).click();
  await p.locator('.people-review-pagination .q-btn').filter({hasText:/^2$/}).click();await p.waitForFunction(()=>document.querySelectorAll('.people-review-card').length===2);await enter();
 });
 await check('Loading and empty person catalogs remain explicit and never enable an unknown target',async()=>{
  const writes=result.writes.length;let release;const gate=new Promise(r=>release=r);
  await p.route('**/api/people/persons?view=hidden',async route=>{await gate;await route.continue()});await row().locator('.people-review-correct').click();
  await editor().getByRole('status').filter({hasText:'正在读取人物'}).waitFor();assert(await editor().getByRole('button',{name:'确认纠正',exact:true}).isDisabled());assert.equal(await editor().getByText('暂无人物，可新建人物',{exact:true}).count(),0);
  release();await editor().locator('.people-face-person').first().waitFor();await popupFits();await p.unroute('**/api/people/persons?view=hidden');await editor().getByRole('button',{name:'取消',exact:true}).click();
  await p.route('**/api/people/persons**',route=>new URL(route.request().url()).pathname==='/api/people/persons'?route.fulfill({json:{data:[]}}):route.continue());
  await row().locator('.people-review-correct').click();await editor().getByText('暂无人物，可新建人物',{exact:true}).waitFor();assert(await editor().getByRole('button',{name:'确认纠正',exact:true}).isDisabled());
  await editor().getByRole('button',{name:'新建人物',exact:true}).click();assert.equal(await editor().getByRole('button',{name:'确认纠正',exact:true}).isDisabled(),false);await editor().getByRole('button',{name:'取消',exact:true}).click();
  await p.unroute('**/api/people/persons**');assert.equal(result.writes.length,writes);
 });
 await check('All themes, compact desktop and English fit; avatar buttons have accessible names, state and keyboard focus',async()=>{
  await open();for(const width of [1000,1440])for(const theme of ['jade','paper','study','porcelain'])for(const mode of ['light','dark']){
   await p.setViewportSize({width,height:width===1000?650:940});await root(p,(r,v)=>{r.setAppearanceTheme(v.theme);r.setThemeMode(v.mode)},{theme,mode});await settle(p);
   const geometry=await p.evaluate(id=>{const card=document.querySelector('[data-review-id="'+id+'"]'),menu=document.querySelector('#people-review-editor-'+id),edit=menu.querySelector('.people-face-editor'),rect=menu.getBoundingClientRect();return {width:innerWidth,overflow:card.scrollWidth>card.clientWidth,editorOverflow:edit.scrollWidth>edit.clientWidth,gap:getComputedStyle(card.parentElement).gap,columns:getComputedStyle(card.parentElement).gridTemplateColumns.split(' ').length,popupInViewport:rect.x>=0&&rect.y>=0&&rect.right<=innerWidth+1&&rect.bottom<=innerHeight+1}},review.id);assert.equal(geometry.overflow,false);assert.equal(geometry.editorOverflow,false);assert.equal(geometry.gap,'8px');assert.equal(geometry.columns,width===1000?1:2);assert.equal(geometry.popupInViewport,true);result.geometry.push({theme,mode,...geometry});
   if(width===1440&&theme==='jade')await p.screenshot({path:path.join(output,'inline-'+mode+'.png'),animations:'disabled'});
  }
  for(const locale of ['zh','en']){await root(p,(r,l)=>r.onLanguageChange(l),locale);await settle(p);
   const names=await editor().locator('.people-face-person').evaluateAll(els=>els.map(el=>({name:el.getAttribute('aria-label'),pressed:el.getAttribute('aria-pressed'),type:el.type,tag:el.tagName})));
   assert(names.every(x=>x.name&&['true','false'].includes(x.pressed)&&x.type==='button'&&x.tag==='BUTTON'));result.accessibility.push({locale,avatarButtons:names.length,allNamed:true,allStateful:true});
   const choice=editor().locator('[data-person-id="'+f.other_id+'"]').first();await choice.focus();await p.keyboard.press('Enter');assert.equal(await choice.getAttribute('aria-pressed'),'true');assert(await choice.evaluate(el=>el.matches(':focus-visible')));await p.keyboard.press('Escape');await editor().waitFor({state:'hidden'});await open();
  }
  await root(p,r=>r.onLanguageChange('zh'));await editor().getByRole('button',{name:'取消',exact:true}).click();
 });
 assert.deepEqual(result.errors,[]);assert.deepEqual(result.failed,[]);assert(result.writes.every(w=>/^\/api\/people\/(faces\/decide|reviews\/\d+|undo\/\d+|merge\/preview)$/.test(w.path)));result.ok=true;
})().catch(e=>{result.failure=e.stack;process.exitCode=1}).finally(async()=>{if(browser)await browser.close();fs.writeFileSync(path.join(output,'results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({passed:result.checks.length,errors:result.errors,failed:result.failed,failure:result.failure}))});
