const fs = require('fs'), vm = require('vm'), assert = require('assert'), path = require('path');
const notifications = [];
const context = vm.createContext({console, TextDecoder, TextEncoder, API:{}, t:(key,args)=>key+JSON.stringify(args||{}),
  Quasar:{Notify:{create:n=>notifications.push(n)}},
  fetch:async()=>{throw Error('unexpected request');}});
for(const file of ['format.js','gallery.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../frontend/js',file),'utf8'), context);
const gallery = vm.runInContext('GalleryPage', context);
function state() {
  const s = {selArr:[1,2],ctxMenu:{show:true},fileOpProgress:{show:false},adjustTime:{},
    t:(key,args)=>key+JSON.stringify(args||{}),load(){}};
  for(const [key,fn] of Object.entries(gallery.methods)) if(typeof fn==='function')s[key]=fn.bind(s);
  s.load=()=>{};
  return s;
}
const tests=[];
function test(name,run){tests.push({name,run});}
function response(events) {
  const bytes = new TextEncoder().encode(events.map(e=>'data: '+JSON.stringify(e)+'\n\n').join(''));
  let offset=0;
  return {ok:true,body:{getReader:()=>({read:async()=>{
    if(offset>=bytes.length)return{done:true};
    const value=bytes.slice(offset,offset+=3);return{done:false,value};
  }})}};
}
test('opening creation dialog resets hours, closes menu and freezes selection',()=>{
  const s=state();s.openAdjustTime('creation');s.selArr.push(3);
  assert.equal(s.ctxMenu.show,false);assert.equal(s.adjustTime.hours,0);
  assert.equal(s.adjustTime.kind,'creation');assert.equal(s.adjustTime.show,true);
  assert.deepEqual(Array.from(s.adjustTime.ids),[1,2]);
});
test('creation shift sends captured IDs and both signed slider limits',async()=>{
  for(const hours of [-24,24]) {
    const s=state();s.openAdjustTime('creation');s.adjustTime.hours=hours;s.selArr=[99];
    s._streamFileOp=async(url,body,label)=>{
      assert.equal(url,'/api/library/shift-creation-time');assert.equal(body.hours,hours);
      assert.deepEqual(Array.from(body.ids),[1,2]);assert.equal(label,'g.adjust_creation_time_progress');
      return {updated:2,skipped:0,errors:0};
    };
    await s.doAdjustTime();assert.equal(s.adjustTime.show,false);
    assert(notifications.at(-1).message.startsWith('g.adjust_creation_time_done'));
  }
});
test('shooting time keeps its existing endpoint and notifications',async()=>{
  const s=state();s.openAdjustTime();s.adjustTime.hours=8;
  s._streamFileOp=async(url)=>{assert.equal(url,'/api/library/shift-shooting-time');return {updated:2,skipped:0,errors:0};};
  await s.doAdjustTime();assert(notifications.at(-1).message.startsWith('g.adjust_time_done'));
});
test('zero shift and busy state cannot submit or open another operation',async()=>{
  const s=state();s.openAdjustTime('creation');s._streamFileOp=()=>{throw Error('must not submit');};
  await s.doAdjustTime();s.adjustTime.hours=8;s.fileOpProgress.show=true;
  await s.doAdjustTime();s.openAdjustTime();assert.equal(s.adjustTime.kind,'creation');
});
test('failed readback uses creation-time failure guidance',async()=>{
  const s=state();s.openAdjustTime('creation');s.adjustTime.hours=-8;
  s._streamFileOp=async()=>({updated:0,skipped:0,errors:2});
  await s.doAdjustTime();assert.equal(notifications.at(-1).type,'negative');
  assert(notifications.at(-1).message.includes('g.creation_time_errors_hint'));
});
test('fragmented SSE reaches its verified completion and closes progress',async()=>{
  const s=state();context.fetch=async()=>response([
    {type:'progress',done:2,total:2,updated:1,errors:1},
    {type:'done',updated:1,skipped:0,errors:1,note:'中文'}]);
  const result=await s._streamFileOp('/fixture',{ids:[1,2]},'progress');
  assert.equal(result.note,'中文');assert.equal(s.fileOpProgress.done,2);
  assert.equal(s.fileOpProgress.show,false);
});
test('truncated SSE reports interruption instead of claiming completion',async()=>{
  const s=state();context.fetch=async()=>response([{type:'progress',done:1,total:2,updated:1,errors:0}]);
  const result=await s._streamFileOp('/fixture',{ids:[1,2]},'progress');
  assert.equal(result,null);assert.equal(s.fileOpProgress.show,false);
  assert(notifications.at(-1).message.includes('g.file_op_interrupted'));
});
test('HTTP failures close progress and report the server error',async()=>{
  const s=state();context.fetch=async()=>({ok:false,status:500,json:async()=>({error:'synthetic missing tool'})});
  assert.equal(await s._streamFileOp('/fixture',{ids:[1]},'progress'),null);
  assert.equal(s.fileOpProgress.show,false);assert(notifications.at(-1).message.includes('synthetic missing tool'));
});
(async()=>{for(const {name,run} of tests){await run();console.log('PASS',name);}console.log(`${tests.length}/${tests.length} passed`);})()
  .catch(e=>{console.error(e);process.exitCode=1;});
