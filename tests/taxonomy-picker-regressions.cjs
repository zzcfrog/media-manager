const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const context=vm.createContext({console,i18nState:{locale:'zh'},API:{_fetch:async()=>({})},Quasar:{Notify:{create(){}}}});
vm.runInContext(fs.readFileSync('frontend/js/taxonomy.js','utf8'),context);
assert.equal(vm.runInContext('typeof TaxonomyTagPicker',context),'object','Hierarchical tag picker is not implemented');
const picker=vm.runInContext('TaxonomyTagPicker',context);
const nodes=[{id:1,name:'场景',path:'场景',parent_id:null},{id:2,name:'自然',path:'场景 / 自然',parent_id:1},
  {id:3,name:'海边',path:'场景 / 自然 / 海边',parent_id:2,aliases:[{text:'海岸'}]},
  {id:4,name:'主体',path:'主体',parent_id:null},{id:5,name:'海边',path:'主体 / 海边',parent_id:4}];
const options=nodes.map(n=>({value:n.id,label:n.path}));
function state(overrides={}){
  const s={...picker.data(),$root:{taxonomyNodes:nodes,taxonomyOptions:options},modelValue:[],multiple:true,label:'包含标签',emitted:[],...overrides};
  s.$emit=(event,value)=>s.emitted.push({event,value});
  for(const [key,fn] of Object.entries(picker.methods))s[key]=fn.bind(s);
  for(const [key,fn] of Object.entries(picker.computed))Object.defineProperty(s,key,{get:()=>fn.call(s),configurable:true});
  return s;
}
const nested=state({options:[options[2]]});
assert.equal(nested.nodes[0].id,1);assert.equal(nested.nodes[0].children[0].children[0].id,3);
assert.equal(nested.nodes[0].selectable,false,'Unavailable ancestors remain expandable, not selectable');
assert.equal(nested.nodes[0].children[0].children[0].selectable,true);
nested.choose(1);assert.equal(nested.emitted.length,0,'A context-only ancestor cannot be selected');
const search=state({search:'海岸'});assert.equal(search.nodes.length,1);assert.equal(search.nodes[0].children[0].children[0].id,3);
const multiple=state({modelValue:[3]});multiple.choose(5);
assert.deepEqual(Array.from(multiple.emitted.at(-1).value),[3,5],'Same leaf name under different parents retains both identities');
assert.equal(multiple.shortLabel(options[2]),'场景 / 自然 / 海边');assert.equal(multiple.shortLabel(options[4]),'主体 / 海边');
const filtered=state({modelValue:[3,5],search:'海岸'});filtered.tick([]);
assert.deepEqual(Array.from(filtered.emitted.at(-1).value),[5],'Filtering the tree must not remove selections outside the visible result');
const single=state({multiple:false,modelValue:3,options:[{label:'一级标签',value:null},...options]});single.choose('picker-root');
assert.equal(single.emitted.at(-1).value,null,'Root is a valid explicit parent');
const pending=state({options:[...options,{value:-1,label:'待建立：雪山'}]});pending.choose(-1);assert.deepEqual(Array.from(pending.emitted.at(-1).value),[-1]);
const disabled=state({disable:true});disabled.choose(3);disabled.tick([3]);assert.equal(disabled.emitted.length,0);
assert.equal(nodes[0].children,undefined,'Building the picker never mutates the shared taxonomy');
console.log('Hierarchical tag picker: hierarchy, aliases, independent selection, exclusions, root, pending and disabled states passed');
