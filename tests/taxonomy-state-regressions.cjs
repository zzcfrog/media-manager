const fs = require('fs'), vm = require('vm'), assert = require('assert');
const calls = []; let fetcher = async () => ({});
const context = vm.createContext({console, URLSearchParams, i18nState:{locale:'zh'}, API:{_fetch:(...args)=>fetcher(...args)},
  Quasar:{Notify:{create(){}}}});
vm.runInContext(fs.readFileSync('frontend/js/taxonomy.js','utf8'),context);
const component = vm.runInContext('TaxonomyPage',context), tools = vm.runInContext('TaxonomyTools',context);
const sidebar = vm.runInContext('TaxonomySidebar',context), collection = vm.runInContext('TaxonomyCollectionRename',context);
const planCard = vm.runInContext('TaxonomyPlanCard',context), parseCases = vm.runInContext('taxParseCases',context);
function state(spec) {
  const value = {...spec.data?.(), $root:{reloadTaxonomy:async()=>{},taxonomyNodes:[],taxonomyOptions:[],route:'#/taxonomy/1'},
    node:{id:1,version:1}, selectedMedia:[10,11], $emit(){}, $nextTick:fn=>fn()};
  for (const [key,fn] of Object.entries(spec.methods || {})) value[key] = fn.bind(value);
  return value;
}
const tick = () => new Promise(resolve=>setImmediate(resolve));
const tests = [], test = (name,run) => tests.push({name,run});

test('late save cannot replace another tag editor',async()=>{
  let resolve;const s=state(component);s.form={name:'old',version:1};
  fetcher=()=>new Promise(r=>resolve=r);s.save();s.node={id:2,version:1};s.form={name:'new',version:1};
  resolve({name:'saved old',version:2});await tick();assert.equal(s.form.name,'new');
});
test('example writes freeze both selected tag and media before navigation',async()=>{
  const e=state(component);calls.length=0;let first=true;
  fetcher=async(url)=>{calls.push(url);if(first){first=false;e.node={id:2};e.selectedMedia=[99];}return{data:[]};};
  e.example('positive');await tick();assert(calls.slice(0,2).every(url=>url==='/api/taxonomy/examples/1'));assert.equal(calls.length,3);
});
test('periodic progress refresh preserves unsaved configuration',async()=>{
  const c=state(component);c.tab='jobs';c.configLoaded=true;c.config={classification_model_dir:'unsaved'};
  fetcher=async()=>({data:[]});await c.refresh();assert.equal(c.config.classification_model_dir,'unsaved');
});
test('late example read cannot replace the current selection',async()=>{
  let resolve;const s=state(component);fetcher=()=>new Promise(r=>resolve=r);const pending=s.loadExamples();
  s.node={id:2};s.examples=[{media_id:99}];resolve({data:[{media_id:10}]});await pending;assert.equal(s.examples[0].media_id,99);
});
test('badge update preserves loaded pages and selection',async()=>{
  const s=state(tools);let loads=0;s.gallery={allMediaItems:[{id:10,tag_count:0}],load(){loads++;}};
  fetcher=async()=>({counts:{10:1}});await s.run('/decisions',{});assert.equal(loads,0);assert.equal(s.gallery.allMediaItems[0].tag_count,1);
});
test('late group response cannot replace another review state',async()=>{
  const s=state(component);let resolve;fetcher=()=>new Promise(r=>resolve=r);const pending=s.loadGroups();
  s.reviewState='rejected';s.groups=[{term:'keep rejected'}];resolve({data:[{term:'old pending'}],total:1});await pending;
  assert.equal(s.groups[0].term,'keep rejected');
});
test('review selection remains explicit when changing pages',()=>{
  const s=state(component);s.candidates=[{id:2,file_name:'B'}];s.candidatesSelected=[1];s.selectedCandidateRows={1:{id:1,file_name:'A'}};
  s.updateCandidateSelection([1,2]);assert.deepEqual(Array.from(s.candidatesSelected),[1,2]);assert.equal(s.selectedCandidateRows[1].file_name,'A');
  s.candidates=[{id:3,file_name:'C'}];assert.deepEqual(Array.from(s.candidatesSelected),[1,2]);
});
test('group selection reads members but never silently exceeds its explicit batch cap',async()=>{
  const s=state(component);s.activeGroup={group_key:'group'};
  fetcher=async url=>{const page=Number(new URL('http://test'+url).searchParams.get('page'));return{total:1500,data:Array.from({length:200},(_,i)=>({id:(page-1)*200+i+1,needs_revalidation:false}))};};
  s.selectCandidateGroup();await tick();assert.equal(s.candidatesSelected.length,1000);assert.equal(Math.max(...s.candidatesSelected),1000);
  assert(s.reviewNotice.includes('1000'));
});
test('review confirmation freezes candidate IDs and target before user navigation',async()=>{
  const s=state(component);s.candidatesSelected=[1];s.selectedRows=[{id:1,file_name:'A'}];s.staleSelection=false;s.hasUnmappedSelection=false;s.reviewTarget=4;
  fetcher=async()=>({target_context:'verified-context'});s.review(true);await tick();s.candidatesSelected=[99];s.reviewTarget=7;calls.length=0;
  fetcher=async(url,options)=>{calls.push({url,body:options?.body&&JSON.parse(options.body)});return{data:[],total:0};};
  s.confirmReview();await tick();const review=calls.find(call=>call.url==='/api/taxonomy/candidates/review');
  assert.deepEqual(review.body.ids,[1]);assert.equal(review.body.tag_id,4);assert.equal(review.body.target_context,'verified-context');
});
test('a candidate needing revalidation cannot be silently accepted',()=>{
  const s=state(component);s.candidatesSelected=[1];s.staleSelection=true;s.hasUnmappedSelection=false;s.selectedRows=[{id:1}];s.review(true);
  assert.equal(s.showReviewRange,false);
});
test('collection rename sends only a name and frozen version, preserving every saved condition',async()=>{
  const s=state(collection);s.collection={id:9,name:'Old',version:4,query:{tag_ids:[1],future_condition:true}};s.name='  新名称  ';calls.length=0;
  fetcher=async(url,options)=>{calls.push({url,body:JSON.parse(options.body)});return{};};await s.save();
  assert.equal(calls[0].body.name,'新名称');assert.equal(calls[0].body.version,4);assert.equal(calls[0].body.query,undefined);
  s.name='  ';calls.length=0;await s.save();assert.equal(calls.length,0);
});
test('null is a valid explicitly selected root resolution',()=>{
  const result=planCard.computed.completeChoices.call({conflicts:[{key:'parent',choices:[{value:null,label:'Root'}]}],resolutions:{parent:null}});
  assert.equal(result,true);assert.equal(planCard.computed.completeChoices.call({conflicts:[{key:'parent',choices:[{value:null}]}],resolutions:{}}),false);
});
test('a virtual unfiled group never becomes a real taxonomy ID',()=>{
  const s=state(sidebar);s.mode='classify';let route;s.$root={route:'#/classify',taxonomyNodes:[{id:1,legacy:1,parent_id:null},{id:2,legacy:0,parent_id:null}],nav:hash=>{route=hash;},$refs:{gallery:{load(){}}}};
  s.choose('legacy-unfiled');assert.equal(route,'#/classify');assert.deepEqual(Array.from(s.$root.taxonomyQuery.tag_ids),[1]);assert.equal(s.$root._openingTaxonomyCollection,false);
});
test('CSV input remains data and unannotated expected values stay unknown',()=>{
  const cases=parseCases('sample_id,score,expected,split\n"sample, one",0.8,true,heldout\nsecond,0.2,,selection\n','synthetic.csv');
  assert.equal(cases[0].sample_id,'sample, one');assert.equal(cases[0].expected,true);assert.equal(cases[1].expected,null);assert.equal(cases[0].source,'synthetic.csv');
  assert.throws(()=>parseCases('sample_id,score,expected,split\nx,NaN,true,heldout'));
});
test('prepared validation samples never inherit model guesses as human labels',async()=>{
  const s=state(component);s.validationForm={kind:'association',tag_id:1};
  fetcher=async()=>({model_key:'model',cases:[{sample_id:'1',score:.9,expected:true,split:'heldout'}]});
  s.prepareValidationCases();await tick();assert.equal(s.validationCases[0].expected,null);assert.equal(s.humanDeclaration,false);
});
test('duplicate validation sample IDs are rejected before posting',async()=>{
  const s=state(component);s.humanDeclaration=true;s.validationCases=[{sample_id:'same',score:.9,expected:true,split:'selection'},{sample_id:'same',score:.1,expected:false,split:'heldout'}];
  let writes=0;fetcher=async()=>{writes++;return{};};await s.submitValidation();assert.equal(writes,0);assert(s.validationError.includes('重复'));
});
test('relationship lock uses the backend all-area contract',async()=>{
  const s=state(component);calls.length=0;fetcher=async(url,options)=>{calls.push({url,body:options?.body&&JSON.parse(options.body)});return{data:[],locks:[]};};
  s.setRelationshipLock(true);await tick();assert.equal(calls[0].body.area,'all');
  assert.equal(component.computed.relationshipLocked.call({relationshipLocks:[{area:'all',locked:1}]}),true);
  assert.equal(component.computed.relationshipLocked.call({relationshipLocks:[{area:'all',locked:0}]}),false);
});
test('relationship evidence is readable and structural suggestions never apply as simple relations',async()=>{
  const s=state(component);assert.equal(s.relationshipReason({evidence:'{"reason":"Two distinct meanings"}'}),'Two distinct meanings');
  let writes=0;fetcher=async()=>{writes++;return{};};s.reviewRelationship({id:3,kind:'parent'},true);await tick();assert.equal(writes,0);
  s.tab='relationships';s.form={parent_id:null};s.useRelationshipPlan({kind:'parent',target_id:7});assert.equal(s.form.parent_id,7);assert.equal(s.tab,'edit');assert.equal(writes,0);
});
test('new split targets stay local until the complete plan is applied',async()=>{
  const s=state(component);s.newSplitTarget={name:'New scene',parent_id:3,definition:'Meaning'};calls.length=0;
  fetcher=async(url,options)=>{calls.push({url,body:options?.body&&JSON.parse(options.body)});return{id:'plan',media_count:1,media_items:[{id:10}]};};
  s.addSplitTarget();assert.equal(calls.length,0);const id=s.newSplitTargets[0].id;assert(id<0);
  s.selectedMedia=[10];s.splitAssignments={10:[id]};s.preview('split');await tick();assert.equal(calls[0].url,'/api/taxonomy/plans/split');
  assert.equal(calls[0].body.assignments['10'][0].name,'New scene');assert.equal(calls[0].body.assignments['10'][0].parent_id,3);
  s.removeSplitTarget(id);assert.equal(s.splitAssignments['10'].length,0);
});
test('closed validation cannot be repopulated by a late read',async()=>{
  const s=state(component);let resolve;fetcher=()=>new Promise(r=>resolve=r);const pending=s.openValidation();s.showValidation=false;
  resolve({data:[{id:99}]});await pending;assert.equal(s.validations.length,0);
});
test('untagged media carried from the gallery remain available as explicit examples',async()=>{
  const s=state(component);s.$root.taxonomySelectedMedia=[99];s.$root.taxonomySelectedMediaRows={99:{id:99,file_name:'Untagged.jpg'}};
  vm.runInContext('API.getLibrary = async () => ({data:[],pagination:{total:0}})',context);await s.loadMedia(true);
  assert.deepEqual(Array.from(s.selectedMedia),[99]);assert.equal(s.selectedMediaRows[99].file_name,'Untagged.jpg');assert.equal(s.$root.taxonomySelectedMedia.length,0);
});
test('sample preparation errors remain visible inside the validation dialog',async()=>{
  const s=state(component);s.validationForm={kind:'association',tag_id:1};fetcher=async()=>{throw new Error('No cached model features');};
  s.prepareValidationCases();await tick();assert.equal(s.validationError,'No cached model features');assert.equal(s.error,'');
});
test('removing the last review page clamps pagination without inventing a legacy group',async()=>{
  const s=state(component);s.reviewPage=3;calls.length=0;fetcher=async url=>{calls.push(url);return{data:[],total:1};};
  await s.loadGroups();assert.equal(s.reviewPage,1);assert.equal(calls.length,1);assert.equal(s.groups.length,0);
  s.activeGroup={group_key:'g'};s.candidatePage=3;await s.loadCandidates();assert.equal(s.candidatePage,1);assert.equal(s.candidatesSelected.length,0);
});
test('gallery analysis previews without queueing and confirmation freezes the exact media IDs',async()=>{
  const s=state(tools);s.gallery={selArr:[10,11],allMediaItems:[]};calls.length=0;
  fetcher=async(url,options)=>{calls.push({url,body:options?.body&&JSON.parse(options.body)});return{available_count:2,media_count:2};};
  await s.previewAnalysis();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/taxonomy/jobs/preview');
  s.gallery.selArr=[99];await s.confirmAnalysis();const queued=calls.find(call=>call.url==='/api/taxonomy/jobs');assert.deepEqual(queued.body.media_ids,[10,11]);
});
test('tag editor analysis must preview before queueing and cannot adopt another selection',async()=>{
  const s=state(component);s.selectedMedia=[10];calls.length=0;
  fetcher=async(url,options)=>{calls.push({url,body:options?.body&&JSON.parse(options.body)});return{available_count:1,media_count:1};};
  s.classify('analysis');await tick();assert.equal(calls.length,1);assert.equal(calls[0].url,'/api/taxonomy/jobs/preview');
  s.selectedMedia=[99];s.confirmAnalysis();await tick();assert.deepEqual(calls.find(call=>call.url==='/api/taxonomy/jobs').body.media_ids,[10]);
});
test('relationship queue control addresses only eligible explicitly listed jobs',async()=>{
  const s=state(component);s.relationshipJobs=[{id:1,state:'waiting'},{id:2,state:'done'},{id:3,state:'paused'}];calls.length=0;
  fetcher=async(url,options)=>{calls.push({url,body:options?.body&&JSON.parse(options.body)});return{data:[]};};
  s.relationshipControl('pause');await tick();assert.equal(calls[0].url,'/api/taxonomy/relationships/jobs/control');assert.deepEqual(calls[0].body.ids,[1]);
  calls.length=0;s.relationshipControl('resume',3);await tick();assert.deepEqual(calls[0].body.ids,[3]);
});
test('historical-candidate cleanup requires a separate explicit confirmation',async()=>{
  const s=state(component);calls.length=0;fetcher=async(url,options)=>{calls.push({url,body:options?.body&&JSON.parse(options.body)});return{count:2,retention_days:90,applied:false};};
  s.previewCandidateCleanup();await tick();assert.deepEqual(calls[0].body,{});assert.equal(s.showCandidateCleanup,true);assert.equal(calls.length,1);
  s.confirmCandidateCleanup();await tick();assert.equal(calls[1].body.confirm,true);assert.equal(s.showCandidateCleanup,false);
});
test('late analysis preview cannot open over another tab',async()=>{
  const s=state(component);let resolve;fetcher=()=>new Promise(r=>resolve=r);s.previewAnalysis();s.tab='relationships';resolve({available_count:2});await tick();assert.equal(s.showAnalysisPreview,false);
});
test('a changed override selection cannot open a stale target-context preview',async()=>{
  const s=state(component);s.candidatesSelected=[1];s.selectedRows=[{id:1}];s.reviewTarget=4;s.staleSelection=false;s.hasUnmappedSelection=false;
  let resolve;fetcher=()=>new Promise(r=>resolve=r);s.review(true);s.reviewTarget=7;resolve({target_context:'old-target'});await tick();assert.equal(s.showReviewRange,false);
});
test('target overrides cannot be confirmed without a server-verified context',async()=>{
  const s=state(component);s.showReviewRange=true;s.reviewRequest={ids:[1],tag_id:4};let writes=0;fetcher=async()=>{writes++;return{};};s.confirmReview();await tick();assert.equal(writes,0);assert(s.error.includes('重新预览'));
  assert.equal(planCard.computed.retainedCount.call({plan:{payload:{retained_count:1}}}),1);
});
(async()=>{for(const test of tests){await test.run();console.log('PASS '+test.name);}console.log(tests.length+'/'+tests.length+' passed');})().catch(error=>{console.error(error);process.exitCode=1;});
