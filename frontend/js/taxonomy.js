// The taxonomy shares the global sidebar and the existing media gallery.
const TaxonomyAPI = (path, method = 'GET', body) => API._fetch('/api/taxonomy' + path,
  { method, ...(body === undefined ? {} : { headers: {'Content-Type': 'application/json'}, body: JSON.stringify(body) }) });
const taxText = (zh, en) => i18nState.locale === 'en' ? en : zh;
const taxClone = value => JSON.parse(JSON.stringify(value));
const taxChanged = (root, result = {}) => {
  if (root.onTaxonomyChanged) root.onTaxonomyChanged(result);
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('taxonomy-changed', { detail: result }));
  }
};
const taxImageError = event => {
  event.target.hidden = true;
  event.target.parentElement?.classList.add('taxonomy-preview-offline');
};
const taxParseCases = (text, source = 'CSV') => {
  const delimiter = (text.split(/\r?\n/, 1)[0] || '').includes('\t') ? '\t' : ',';
  const rows = []; let row = [], field = '', quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index+1] === '"') { field += '"'; index++; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) { row.push(field); field = ''; }
    else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index+1] === '\n') index++;
      row.push(field); if (row.some(value => value.trim())) rows.push(row); row = []; field = '';
    } else field += char;
  }
  if (quoted) throw new Error(taxText('CSV 的引号未闭合','CSV contains an unclosed quote'));
  row.push(field); if (row.some(value => value.trim())) rows.push(row);
  const header = (rows.shift() || []).map(value => value.replace(/^\uFEFF/,'').trim());
  if (!['sample_id','score','expected','split'].every(key => header.includes(key))) throw new Error(taxText('CSV 需要 sample_id、score、expected、split 四列','CSV requires sample_id, score, expected and split columns'));
  if (rows.length > 1000) throw new Error(taxText('每次最多导入 1000 条标注','Import up to 1,000 annotations at a time'));
  return rows.map((values,index) => {
    const value = Object.fromEntries(header.map((key,column) => [key,(values[column] || '').trim()]));
    const raw = value.expected.toLocaleLowerCase();
    const expected = ['true','1','yes','是','有'].includes(raw) ? true : ['false','0','no','否','无'].includes(raw) ? false : raw === '' ? null : undefined;
    if (!value.sample_id || !value.score || !Number.isFinite(Number(value.score)) || expected === undefined || !['selection','heldout'].includes(value.split)) throw new Error(taxText('第 '+(index+2)+' 行格式无效','Invalid format on row '+(index+2)));
    return {case_key:'import-'+index,sample_id:value.sample_id, score:Number(value.score), expected, split:value.split, source};
  });
};
const TaxonomyTagShape = {
  props: {hollow:Boolean},
  template: `<g class="taxonomy-tag-shape" :class="{'is-hollow':hollow}"><path d="M6 4.5h7.2a2 2 0 0 1 1.4.6l5.1 5.1a2 2 0 0 1 0 2.8L13 19.8a2 2 0 0 1-2.8 0l-5.1-5.1a2 2 0 0 1-.6-1.4V6A1.5 1.5 0 0 1 6 4.5Z"></path><circle cx="8.2" cy="8.2" r="1.35"></circle></g>`
};
const TaxonomyTagIcon = {
  props: {mode:{type:String,default:'single'}},
  components: {'taxonomy-tag-shape':TaxonomyTagShape},
  template: `<svg class="taxonomy-tag-icon" :class="{'taxonomy-match-icon':mode!=='single'}" :viewBox="mode==='single'?'0 0 24 24':'0 0 20 20'" aria-hidden="true" focusable="false">
    <taxonomy-tag-shape v-if="mode==='single'"></taxonomy-tag-shape>
    <template v-else><g class="taxonomy-tag-background" transform="translate(-.1 -.7) scale(.88)"><taxonomy-tag-shape :hollow="mode==='any'" transform="translate(3.2 -1.4) scale(.9)"></taxonomy-tag-shape><taxonomy-tag-shape transform="translate(-1.1 1.3) scale(.94)"></taxonomy-tag-shape></g><text class="taxonomy-tag-word" x="10" y="11.1" text-anchor="middle" dominant-baseline="central">{{mode==='any'?'Any':'All'}}</text></template>
  </svg>`
};
const TagStatus = {
  props: ['media', 'inline'],
  methods: { tt: taxText },
  template: `<span v-if="media.tag_count > 0" :class="inline ? 'tag-status-inline' : 'tag-status'" tabindex="0"
    :aria-label="tt('已添加 '+media.tag_count+' 个标签', media.tag_count+' tags added')">
    <taxonomy-tag-icon style="width:11px;height:11px"></taxonomy-tag-icon><q-tooltip>{{ tt('已添加 '+media.tag_count+' 个标签',media.tag_count+' tags added') }}</q-tooltip>
  </span>`
};

// Strict selection keeps a parent and its descendants independent. Context
// ancestors stay visible even when a particular form disallows selecting them.
const TaxonomyTagPicker = {
  props: {modelValue:{},options:Array,multiple:Boolean,label:String,disable:Boolean,clearable:Boolean,compact:Boolean},
  emits: ['update:modelValue'],
  data: () => ({open:false,search:'',expanded:[]}),
  computed: {
    caption() { return this.label || this.$attrs?.['aria-label'] || this.tt('选择标签','Choose tag'); },
    choices() { return this.options || this.$root.taxonomyOptions || []; },
    values() { return this.multiple ? (this.modelValue || []) : this.modelValue == null ? (this.choices.some(o=>o.value===null)?[null]:[]) : [this.modelValue]; },
    selectedKeys() { return this.values.map(value=>this.key(value)); },
    selectedOptions() { return this.values.map(value=>this.choices.find(o=>o.value===value) || {value,label:this.tt('标签 #','Tag #')+value}); },
    nodes() {
      const allowed=new Map(this.choices.map(o=>[o.value,o]));
      const all=new Map((this.$root.taxonomyNodes || []).map(n=>[n.id,{...n,label:n.name,value:n.id,children:[],selectable:allowed.has(n.id),tickable:allowed.has(n.id)}]));
      const roots=[];
      for(const n of all.values()) { if(n.parent_id && all.has(n.parent_id))all.get(n.parent_id).children.push(n);else roots.push(n); }
      for(const option of this.choices)if(!all.has(option.value))roots.push({id:this.key(option.value),value:option.value,label:option.label,path:option.label,children:[],selectable:true,tickable:true});
      const term=(this.search || '').trim().normalize('NFKC').toLocaleLowerCase();
      const keep=n=>{n.children=n.children.filter(keep);return n.children.length || n.selectable && (!term || (n.path+' '+(n.aliases||[]).map(a=>a.text).join(' ')).normalize('NFKC').toLocaleLowerCase().includes(term));};
      return roots.filter(keep);
    }
  },
  watch: {
    disable(value) { if(value)this.open=false; },
    '$root.route'() { this.open=false; },
    open(value) { if(value){this.search='';this.reveal();} },
    search(value) { if(value)this.expanded=this.flatten(this.nodes).filter(n=>n.children.length).map(n=>n.id);else this.reveal(); }
  },
  methods: {
    tt:taxText,
    key(value) { return value===null?'picker-root':value; },
    shortLabel(option) {
      const nodes=this.$root.taxonomyNodes || [],node=nodes.find(n=>n.id===option.value);
      if(!node)return option.label;
      return nodes.some(n=>n.id!==node.id && n.name===node.name) ? (node.path || option.label) : node.name;
    },
    flatten(nodes) { return nodes.flatMap(n=>[n,...this.flatten(n.children)]); },
    reveal() {
      const nodes=this.$root.taxonomyNodes || [],byId=new Map(nodes.map(n=>[n.id,n]));const ids=new Set();
      for(const value of this.values){let node=byId.get(value);const seen=new Set();while(node?.parent_id && !seen.has(node.id)){seen.add(node.id);ids.add(node.parent_id);node=byId.get(node.parent_id);}}
      this.expanded=[...ids];
    },
    choose(id) {
      if(this.disable)return;
      if(id===null && !this.multiple){this.open=false;return;}
      const option=this.choices.find(o=>this.key(o.value)===id);if(!option)return;
      if(this.multiple){const value=this.values.includes(option.value)?this.values.filter(v=>v!==option.value):[...this.values,option.value];this.$emit('update:modelValue',value);}
      else {this.$emit('update:modelValue',option.value);this.open=false;}
    },
    tick(keys) {
      if(this.disable)return;
      const visible=new Set(this.flatten(this.nodes).filter(n=>n.selectable).map(n=>n.id));
      const retained=this.values.filter(v=>!visible.has(this.key(v)));
      const incoming=this.choices.filter(o=>keys.includes(this.key(o.value))).map(o=>o.value);
      this.$emit('update:modelValue',[...new Set([...retained,...incoming])]);
    },
    remove(value) { if(!this.disable)this.$emit('update:modelValue',this.multiple?this.values.filter(v=>v!==value):null); }
  },
  template: `<div class="taxonomy-tag-picker" :class="{'is-disabled':disable,'is-compact':compact}">
    <q-btn flat dense no-caps class="taxonomy-picker-trigger" :disable="disable" :aria-label="caption" aria-haspopup="dialog" :aria-expanded="open">
      <taxonomy-tag-icon style="width:15px;height:15px"></taxonomy-tag-icon><span>{{compact?tt('标签','Tags')+(values.length?' '+values.length:''):caption}}</span><q-icon name="expand_more" size="14px"></q-icon>
      <q-menu v-model="open" class="taxonomy-picker-menu" :class="{'taxonomy-picker-menu-compact':compact}" role="dialog" :aria-label="caption" anchor="bottom left" self="top left" :offset="[0,6]" @keydown.esc.capture.stop="open=false">
        <div class="taxonomy-picker-heading"><span>{{caption}}</span><q-btn v-if="multiple && values.length" flat dense no-caps size="sm" :label="tt('清空选择','Clear selection')" @click="$emit('update:modelValue',[])"></q-btn></div>
        <q-input v-model="search" dense borderless clearable autofocus class="taxonomy-picker-search" :placeholder="tt('搜索名称或同义词','Search names or aliases')" :aria-label="tt('搜索可选标签','Search available tags')"><template #prepend><q-icon name="search" size="16px"></q-icon></template></q-input>
        <div class="taxonomy-picker-tree-scroll"><q-tree :nodes="nodes" node-key="id" dense no-connectors class="taxonomy-picker-tree" :expanded="expanded" @update:expanded="expanded=$event" :selected="multiple?null:(selectedKeys[0] ?? null)" @update:selected="choose" :tick-strategy="multiple?'strict':'none'" :ticked="selectedKeys" @update:ticked="tick">
          <template #default-header="p"><span :data-tag-choice="p.node.id" :class="{'taxonomy-context-node':!p.node.selectable}">{{p.node.label}}<small v-if="p.node.status==='inactive'" class="taxonomy-inactive-label">{{tt('已停用','Inactive')}}</small><q-tooltip>{{p.node.path}}</q-tooltip></span></template>
        </q-tree><p v-if="!nodes.length" class="taxonomy-hint" role="status">{{tt('没有匹配标签','No matching tags')}}</p></div>
        <div v-if="multiple" class="taxonomy-picker-footer"><small role="status">{{tt('已选 '+values.length+' 项',values.length+' selected')}}</small><q-btn flat dense no-caps :label="tt('完成','Done')" v-close-popup></q-btn></div>
      </q-menu>
      <q-tooltip v-if="compact && !open">{{selectedOptions.length?selectedOptions.map(o=>o.label).join(' · '):caption}}</q-tooltip>
    </q-btn>
    <div v-if="!compact && selectedOptions.length" class="taxonomy-picker-values"><q-chip v-for="o in selectedOptions.slice(0,multiple?2:1)" :key="String(o.value)" dense :removable="(multiple || clearable) && !disable" @remove="remove(o.value)">{{shortLabel(o)}}<q-tooltip>{{o.label}}</q-tooltip></q-chip><span v-if="multiple && selectedOptions.length>2" class="taxonomy-picker-more">+{{selectedOptions.length-2}}</span></div>
  </div>`
};

const SmartCollectionIcon = {
  template:`<svg class="smart-collection-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="smart-collection-folder" d="M3 7V5.5a2 2 0 0 1 2-2h4.5l2.5 3h7a2 2 0 0 1 2 2v9a2 2 0 0 1-2-2H5a2 2 0 0 1-2-2Z"></path><path class="smart-collection-star" fill="currentColor" stroke="none" d="M13 8c.6 3.3 1.7 4.4 5 5-3.3.6-4.4 1.7-5 5-.6-3.3-1.7-4.4-5-5 3.3-.6 4.4-1.7 5-5Z"></path></svg>`
};

const taxCollectionSummary = (query, root) => {
  const tags=(query.tag_ids || []).map(id=>root.taxonomyNodes.find(n=>n.id===id)?.path || '#'+id);
  const rows=[tags.length ? taxText('标签：','Tags: ')+tags.join('、') : taxText('不限标签','Any tag')];
  if(tags.length)rows.push(query.tag_mode==='all'?taxText('全部符合','Match all'):taxText('任一符合','Match any'),query.include_children===false?taxText('仅所选标签','Selected tags only'):taxText('包含子标签','Include child tags'));
  if(query.exclude_tag_ids?.length)rows.push(taxText('含旧版排除条件','Includes legacy exclusions'));
  if(query.media_type && query.media_type!=='all')rows.push(taxText({image:'图片',video:'视频',audio:'音乐'}[query.media_type],{image:'Images',video:'Videos',audio:'Audio'}[query.media_type]));
  if(query.favorite)rows.push(query.favorite==='true'?taxText('我的喜欢','Favorites'):taxText('未喜欢','Not favorites'));
  if(query.rating)rows.push(taxText('评分至少 ','Rating at least ')+query.rating+' ★');
  if(query.q)rows.push(taxText('搜索：','Search: ')+query.q);
  if(query.folder)rows.push(taxText('文件夹：','Folder: ')+query.folder);
  return rows;
};
const taxCollectionDraft = (gallery, root) => {
  const params=gallery._buildParams(1),query={};
  const supported=['tag_ids','exclude_tag_ids','tag_mode','include_children','q','folder','media_type','favorite','rating','sort','order'];
  for(const key of supported){
    const value=params[key];if(value===undefined || value===null || value==='')continue;
    if(key==='tag_ids' || key==='exclude_tag_ids')query[key]=Array.isArray(value)?[...value]:String(value).split(',').filter(Boolean).map(Number);
    else if(key==='include_children')query[key]=value!==false && value!=='false';
    else if(key==='rating')query[key]=Number(value);
    else query[key]=value;
  }
  const unsupported=Object.keys(params).filter(key=>!supported.includes(key) && !['page','per_page'].includes(key));
  return {query,summary:taxCollectionSummary(query,root),unsupported};
};

const TaxonomyFilters = {
  props:['gallery'],
  data:()=>({extra:[],mode:'any',include:true}),
  watch:{'$root.taxonomyQuery':{immediate:true,deep:true,handler(q){this.extra=[...(q?.tag_ids || [])];this.mode=q?.tag_mode || 'any';this.include=q?.include_children!==false;}}},
  methods:{tt:taxText,setMode(value){if(this.mode!==value){this.mode=value;this.change();}},change(){const query={...this.$root.taxonomyQuery,tag_ids:[...this.extra],tag_mode:this.mode,include_children:this.include};delete query.exclude_tag_ids;this.$root.taxonomyQuery=query;this.gallery.load();}},
  template:`<div class="taxonomy-inline-filters" role="group" :aria-label="tt('标签筛选','Tag filters')">
    <div class="taxonomy-tag-controls">
    <div class="taxonomy-tag-scope" role="group" :aria-label="tt('标签及子标签范围','Tags and child scope')"><taxonomy-tag-picker v-model="extra" multiple compact :label="tt('选择标签','Choose tags')" @update:model-value="change"></taxonomy-tag-picker><q-btn flat dense class="taxonomy-descendant-toggle" :class="{'is-active':include}" :aria-label="tt('包含子标签','Include child tags')" :aria-pressed="include" @click="include=!include;change()"><svg class="taxonomy-scope-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="taxonomy-scope-connector" d="M9.6 12H12M14.4 5.5H13.7Q12 5.5 12 7.2V16.8Q12 18.5 13.7 18.5H14.4"></path><rect x="2" y="8.5" width="7" height="7" rx="1.6" fill="currentColor"></rect><g class="taxonomy-scope-children" :mask="include?'url(#taxonomy-descendant-checks)':null"><rect x="15" y="2" width="7" height="7" rx="1.6" :fill="include?'currentColor':'none'"></rect><rect x="15" y="15" width="7" height="7" rx="1.6" :fill="include?'currentColor':'none'"></rect></g></svg><q-tooltip>{{include?tt('已包含子标签；点击仅筛选所选标签','Child tags included; click to match selected tags only'):tt('仅筛选所选标签；点击包含子标签','Selected tags only; click to include child tags')}}</q-tooltip></q-btn></div>
    <span class="taxonomy-rule-divider" aria-hidden="true"></span>
    <div class="taxonomy-match-mode" v-sliding-segments="mode" role="group" :aria-label="tt('标签组合','Tag matching')">
      <q-btn v-for="value in ['any','all']" :key="value" flat dense :aria-label="value==='any'?tt('任一','Any'):tt('全部','All')" :aria-pressed="mode===value" @click="setMode(value)">
        <taxonomy-tag-icon :mode="value"></taxonomy-tag-icon>
        <q-tooltip>{{value==='any'?tt('任一：符合任一所选标签','Any: matches at least one selected tag'):tt('全部：同时符合全部所选标签','All: matches every selected tag')}}</q-tooltip>
      </q-btn>
    </div></div>
    <q-btn v-if="$root.taxonomyQuery?.exclude_tag_ids?.length" flat dense no-caps :label="tt('清除旧排除条件','Clear legacy exclusions')" @click="change"></q-btn>
  </div>`
};

const TaxonomyCollectionCreate = {
  props:['draft'],emits:['saved','close'],
  data:()=>({name:'',busy:false,error:''}),
  beforeUnmount(){this.disposed=true;},
  methods:{tt:taxText,async save(){
    if(this.busy || !this.name.trim() || this.draft.unsupported.length)return;
    const route=this.$root.route;this.busy=true;this.error='';
    try{const result=await TaxonomyAPI('/collections','POST',{name:this.name.trim(),query:taxClone(this.draft.query)});await this.$root.reloadTaxonomy();if(!this.disposed && this.$root.route===route)this.$emit('saved',result);}
    catch(error){if(!this.disposed)this.error=error.message;}
    finally{this.busy=false;}
  }},
  template:`<q-card class="taxonomy-collection-create"><form @submit.prevent="save">
    <q-card-section class="taxonomy-collection-create-heading"><div class="taxonomy-collection-emblem"><smart-collection-icon></smart-collection-icon></div><div><h3>{{tt('创建智能图集','Create smart collection')}}</h3><p>{{tt('保存当前筛选规则，打开时自动呈现最新匹配素材。','Save these filters to see the latest matching media whenever you open the collection.')}}</p></div><q-btn flat round dense icon="close" :disable="busy" :aria-label="tt('关闭','Close')" @click="$emit('close')"></q-btn></q-card-section>
    <q-card-section class="taxonomy-collection-create-body"><q-input v-model="name" autofocus outlined dense maxlength="120" :disable="busy" :label="tt('图集名称','Collection name')" :placeholder="tt('例如：喜欢的山川','For example: Favorite landscapes')"></q-input>
      <div class="taxonomy-collection-rule-summary"><span>{{tt('图集规则','Collection rules')}}</span><div><q-chip v-for="(rule,i) in draft.summary" :key="i" dense>{{rule}}</q-chip></div><small>{{tt('排序一并保存；素材文件仍保留在原位置。','Sort order is also saved. Files stay in their original locations.')}}</small></div>
      <p class="taxonomy-collection-location"><smart-collection-icon></smart-collection-icon>{{tt('保存后可从左侧「智能图集」直接打开。','Open it later from Smart collections in the sidebar.')}}</p>
      <p v-if="draft.unsupported.length" role="alert" class="taxonomy-error">{{tt('当前包含暂不支持保存的颜色、分析状态、人物或高级筛选。请先清除这些条件后再创建，避免保存范围与当前结果不一致。','Clear color, analysis, people or advanced filters before saving so the collection matches the current results.')}}</p>
      <p v-if="error" role="alert" class="taxonomy-error">{{error}}</p>
    </q-card-section><q-card-actions align="right"><q-btn flat no-caps :disable="busy" :label="tt('取消','Cancel')" @click="$emit('close')"></q-btn><q-btn unelevated no-caps color="primary" type="submit" :loading="busy" :disable="!name.trim() || !!draft.unsupported.length" :label="tt('创建图集','Create collection')"></q-btn></q-card-actions>
  </form></q-card>`
};

const TaxonomyGalleryActions = {
  props:['gallery'],components:{'taxonomy-collection-create':TaxonomyCollectionCreate},
  data:()=>({showCreate:false,draft:null}),
  watch:{'$root.route'(){this.showCreate=false;}},
  methods:{tt:taxText,create(){this.draft=taxCollectionDraft(this.gallery,this.$root);this.showCreate=true;},saved(collection){this.showCreate=false;this.$root.openTaxonomyCollection(collection);}},
  template:`<div class="taxonomy-gallery-actions"><q-btn flat dense no-caps class="save-smart-collection" :aria-label="tt('保存图集','Save collection')" @click="create"><q-icon name="add" size="16px" aria-hidden="true"></q-icon><span>{{tt('智能图集','Smart collection')}}</span><q-tooltip>{{tt('将当前筛选保存为智能图集','Save current filters as a smart collection')}}</q-tooltip></q-btn>
    <q-dialog v-model="showCreate" :aria-label="tt('创建智能图集','Create smart collection')" :persistent="!!$refs.create?.busy"><taxonomy-collection-create ref="create" :draft="draft" @close="showCreate=false" @saved="saved"></taxonomy-collection-create></q-dialog></div>`
};

const TaxonomyCollectionRename = {
  props:['collection'],emits:['close'],
  data:()=>({name:'',busy:false,error:''}),
  watch:{collection:{immediate:true,handler(value){this.name=value?.name || '';this.error='';}}},
  beforeUnmount(){this.disposed=true;},
  methods:{tt:taxText,async save(){
    if(this.busy || !this.name.trim())return;
    const target=this.collection;this.busy=true;this.error='';
    try{await TaxonomyAPI('/collections/'+target.id,'PATCH',{name:this.name.trim(),version:target.version});await this.$root.reloadTaxonomy();if(!this.disposed && this.collection.id===target.id)this.$emit('close');}
    catch(error){if(!this.disposed)this.error=error.message;}
    finally{this.busy=false;}
  }},
  template:`<q-card class="taxonomy-collection-rename"><form @submit.prevent="save"><q-card-section><h3>{{tt('重命名图集','Rename collection')}}</h3><q-input v-model="name" autofocus outlined dense maxlength="120" :disable="busy" :label="tt('图集名称','Collection name')"></q-input><p v-if="error" role="alert" class="taxonomy-error">{{error}}</p></q-card-section><q-card-actions align="right"><q-btn flat :label="tt('取消','Cancel')" :disable="busy" @click="$emit('close')"></q-btn><q-btn unelevated color="primary" type="submit" :label="tt('保存','Save')" :loading="busy" :disable="!name.trim()"></q-btn></q-card-actions></form></q-card>`
};

const TaxonomyCollectionEntry = {
  props:['collection'],emits:['rename','delete','opened'],
  methods:{tt:taxText},
  template:`<q-item clickable class="sidebar-nav-item taxonomy-collection-entry" :aria-label="collection.name" :active="$root.route==='#/classify/collection/'+collection.id" active-class="sidebar-active-item" @click="$root.openTaxonomyCollection(collection);$emit('opened')" @keydown.shift.f10.prevent.stop="$refs.context.show($event)">
    <q-item-section avatar><q-icon v-if="collection.state==='needs_adjustment'" name="error_outline" size="16px"></q-icon><smart-collection-icon v-else></smart-collection-icon></q-item-section><q-item-section><span class="ellipsis">{{collection.name}}</span><q-tooltip>{{collection.name}}</q-tooltip></q-item-section>
    <q-menu ref="context" context-menu class="taxonomy-collection-context" role="menu" :aria-label="tt('图集操作','Collection actions')"><q-list dense><q-item clickable role="menuitem" v-close-popup @click="$emit('rename',collection)"><q-item-section avatar><q-icon name="drive_file_rename_outline" size="17px"></q-icon></q-item-section><q-item-section>{{tt('重命名','Rename')}}</q-item-section></q-item><q-item clickable role="menuitem" v-close-popup @click="$emit('delete',collection)"><q-item-section avatar><q-icon name="delete_outline" size="17px"></q-icon></q-item-section><q-item-section>{{tt('删除','Delete')}}</q-item-section></q-item></q-list></q-menu>
  </q-item>`
};

const TaxonomyCollectionsSidebar = {
  components:{'taxonomy-collection-entry':TaxonomyCollectionEntry,'taxonomy-collection-rename':TaxonomyCollectionRename},
  data:()=>({expanded:true,miniOpen:false,renaming:null,deleting:null,busy:false,error:''}),
  watch:{'$root.route'(route){this.renaming=null;this.deleting=null;if(route.startsWith('#/classify/collection/')){this.expanded=true;this.miniOpen=false;}}},
  methods:{tt:taxText,rename(collection){this.miniOpen=false;this.renaming=taxClone(collection);},remove(collection){this.miniOpen=false;this.deleting=taxClone(collection);this.error='';},async confirmDelete(){
    if(this.busy || !this.deleting)return;
    const target=this.deleting;this.busy=true;this.error='';
    try{await TaxonomyAPI('/collections/'+target.id,'DELETE');await this.$root.reloadTaxonomy();if(this.deleting?.id===target.id)this.deleting=null;if(this.$root.route==='#/classify/collection/'+target.id)this.$root.nav('#/classify');}
    catch(error){if(this.deleting?.id===target.id)this.error=error.message;}
    finally{this.busy=false;}
  }},
  template:`<div class="taxonomy-collections-sidebar"><q-item clickable class="sidebar-nav-item" :aria-label="tt('智能图集','Smart collections')" @click="!$root.drawerMini && (expanded=!expanded)"><q-item-section avatar><smart-collection-icon></smart-collection-icon></q-item-section><q-item-section>{{tt('智能图集','Smart collections')}}</q-item-section><q-item-section side v-if="!$root.drawerMini"><q-btn flat round dense size="sm" :icon="expanded?'expand_less':'expand_more'" :aria-label="tt('展开或收起智能图集','Expand or collapse smart collections')" :aria-expanded="expanded" @click.stop="expanded=!expanded"></q-btn></q-item-section>
    <q-menu v-if="$root.drawerMini" v-model="miniOpen" anchor="top right" self="top left" class="taxonomy-mini-collections"><q-list dense><taxonomy-collection-entry v-for="c in $root.taxonomyCollections" :key="c.id" :collection="c" @opened="miniOpen=false" @rename="rename" @delete="remove"></taxonomy-collection-entry><q-item v-if="!$root.taxonomyCollections.length"><q-item-section>{{tt('暂无智能图集','No smart collections')}}</q-item-section></q-item></q-list></q-menu>
    </q-item><div v-show="expanded && !$root.drawerMini" class="taxonomy-collection-nav"><taxonomy-collection-entry v-for="c in $root.taxonomyCollections" :key="c.id" :collection="c" @rename="rename" @delete="remove"></taxonomy-collection-entry><p v-if="!$root.taxonomyCollections.length" class="taxonomy-hint">{{tt('筛选素材后，点击「保存图集」','Filter media, then choose Save collection')}}</p></div>
    <q-dialog :model-value="!!renaming" :aria-label="tt('重命名图集','Rename collection')" @update:model-value="!$event && (renaming=null)"><taxonomy-collection-rename v-if="renaming" :collection="renaming" @close="renaming=null"></taxonomy-collection-rename></q-dialog>
    <q-dialog :model-value="!!deleting" :persistent="busy" :aria-label="tt('删除图集','Delete collection')" @update:model-value="!$event && (deleting=null)"><q-card class="taxonomy-collection-delete"><q-card-section><h3>{{tt('删除图集','Delete collection')}}</h3><p>{{tt('删除「'+(deleting?.name || '')+'」？素材和标签会保留。','Delete “'+(deleting?.name || '')+'”? Media and tags are retained.')}}</p><p v-if="error" role="alert" class="taxonomy-error">{{error}}</p></q-card-section><q-card-actions align="right"><q-btn flat :label="tt('取消','Cancel')" :disable="busy" @click="deleting=null"></q-btn><q-btn unelevated color="primary" :label="tt('删除','Delete')" :loading="busy" @click="confirmDelete"></q-btn></q-card-actions></q-card></q-dialog>
  </div>`
};

const TaxonomySidebar = {
  props: ['mode'],
  data: () => ({ expanded: [], miniOpen:false }),
  computed: {
    active() { return this.mode==='taxonomy' ? this.$root.route.startsWith('#/taxonomy') && this.$root.route!=='#/taxonomy/collections' : this.$root.route.startsWith('#/classify') && !this.$root.route.startsWith('#/classify/collection/'); },
    nodes() {
      const all = this.$root.taxonomyNodes || [];
      const byId = new Map(all.map(n => [n.id, {...n, aliases: n.aliases || [], label: n.name, children: []}]));
      const roots = [], legacy = [];
      for (const node of byId.values()) {
        if (node.parent_id && byId.has(node.parent_id)) byId.get(node.parent_id).children.push(node);
        else if (node.legacy) legacy.push(node);
        else roots.push(node);
      }
      if (legacy.length) roots.push({id: 'legacy-unfiled', name: this.tt('未归档','Unfiled'), path: this.tt('旧标签 · 未归档','Legacy tags · Unfiled'), aliases: [], virtual: true, children: legacy});
      return roots;
    },
    selected() { return this.$root.taxonomySelected == null ? null : this.$root.taxonomySelected; }
  },
  watch: {
    selected: {immediate: true, handler() { this.reveal(); }},
    '$root.taxonomyNodes'() { this.reveal(); },
    '$root.drawerMini'(value) { if(!value)this.miniOpen=false; },
    active(value) { if(!value)this.miniOpen=false; },
    expanded() { this.saveState(); }
  },
  mounted() {
    try {
      const value = JSON.parse(localStorage.getItem('taxonomy-tree-state:'+this.mode) || 'null');
      if (Array.isArray(value?.expanded)) this.expanded = value.expanded;
    } catch {}
    this.reveal();
  },
  methods: {
    tt: taxText,
    saveState() {
      if (typeof localStorage === 'undefined') return;
      localStorage.setItem('taxonomy-tree-state:'+this.mode, JSON.stringify({expanded: this.expanded}));
    },
    reveal() {
      const ids = new Set(this.expanded); let node = (this.$root.taxonomyNodes || []).find(x => x.id === this.selected);
      const seen = new Set();
      while (node && !seen.has(node.id)) {
        seen.add(node.id);
        if (!node.parent_id) { if (node.legacy) ids.add('legacy-unfiled'); break; }
        ids.add(node.parent_id); node = this.$root.taxonomyNodes.find(x => x.id === node.parent_id);
      }
      this.expanded = [...ids];
    },
    choose(id) {
      this.miniOpen=false;
      if (id === 'legacy-unfiled') {
        if (this.mode === 'taxonomy') return;
        this.$root.taxonomyQuery = {tag_ids: this.$root.taxonomyNodes.filter(n => n.legacy && !n.parent_id).map(n => n.id), tag_mode: 'any', include_children: true};
        const alreadyOpen = this.$root.route === '#/classify';
        this.$root._openingTaxonomyCollection = true;
        this.$root.nav('#/classify');
        if (alreadyOpen) { this.$root.taxonomySelected = null; this.$root._openingTaxonomyCollection = false; this.$root.$refs?.gallery?.load(); }
        return;
      }
      this.$root.nav((this.mode === 'taxonomy' ? '#/taxonomy/' : '#/classify/')+(id || ''));
    },
    open() {
      if(this.mode==='taxonomy' && this.$root.currentView==='gallery'){
        const gallery=this.$root.$refs.gallery;
        if(gallery){const ids=[...gallery.selArr];this.$root.taxonomySelectedMedia=ids;this.$root.taxonomySelectedMediaRows=Object.fromEntries(gallery.allMediaItems.filter(m=>ids.includes(m.id)).map(m=>[m.id,{id:m.id,file_name:m.file_name}]));}
      }
      this.choose(null);
    },
    onTreeKeypress(event) {
      if (event.key !== ' ' && event.key !== 'Spacebar') return;
      if (event.target.closest('.folder-tree-disclosure')) return;
      const row = event.target.closest('.q-tree__node-header')?.querySelector('[data-tag-id]');
      if (!row) return;
      event.preventDefault(); event.stopPropagation();
      this.choose(row.dataset.tagId === 'legacy-unfiled' ? 'legacy-unfiled' : Number(row.dataset.tagId));
    },

  },
  template: `<div>
    <q-item clickable class="sidebar-nav-item" :active="active" active-class="sidebar-active-item" @click="(mode==='taxonomy' || !$root.drawerMini) && open()"
      :aria-label="tt(mode==='taxonomy'?'标签树维护':'智能分类',mode==='taxonomy'?'Tag taxonomy':'Smart categories')">
      <q-item-section avatar><q-icon :name="mode==='taxonomy'?'account_tree':'auto_awesome_mosaic'" size="18px"></q-icon></q-item-section>
      <q-item-section>{{tt(mode==='taxonomy'?'标签树维护':'智能分类',mode==='taxonomy'?'Tag taxonomy':'Smart categories')}}</q-item-section>
      <q-menu v-if="$root.drawerMini && mode==='classify'" v-model="miniOpen" anchor="top right" self="top left"><div class="taxonomy-mini-tree"><q-tree :nodes="nodes" node-key="id" dense no-connectors :expanded="expanded" @update:expanded="expanded=$event" :selected="selected" @update:selected="choose($event == null ? selected : $event)"><template #default-header="p"><span>{{p.node.name}}</span></template></q-tree></div></q-menu>
    </q-item>
    <div v-if="mode==='classify'" v-show="active && !$root.drawerMini" class="taxonomy-sidebar-tree">
      <div v-if="$root.taxonomyError" role="alert">{{$root.taxonomyError}}<q-btn flat dense icon="refresh" @click="$root.reloadTaxonomy()"></q-btn></div>
      <div class="taxonomy-tree-scroll">
      <q-tree v-if="nodes.length" class="folder-tree" :nodes="nodes" node-key="id" dense no-connectors :expanded="expanded" @update:expanded="expanded=$event"
        :selected="selected" @update:selected="choose" @keydown.stop @keypress.capture="onTreeKeypress">
        <template #default-header="p"><div class="folder-tree-entry">
          <button v-if="p.node.children.length" class="folder-tree-disclosure" type="button" @click.stop="p.expanded=!p.expanded" @keydown.stop @keypress.stop :aria-expanded="p.expanded" :aria-label="tt('展开或收起 '+p.node.name,'Expand or collapse '+p.node.name)">
            <svg viewBox="0 0 20 20" :class="{'is-expanded':p.expanded}"><path d="m7.5 4.5 5.5 5.5-5.5 5.5"/></svg>
          </button><span v-else class="folder-tree-disclosure-spacer"></span>
          <div class="folder-tree-item" :data-tag-id="p.node.id"><q-icon v-if="p.node.virtual" name="inventory_2" size="17px" class="taxonomy-node-icon"></q-icon><taxonomy-tag-icon v-else class="taxonomy-node-icon" style="width:17px;height:17px"></taxonomy-tag-icon><span class="folder-tree-label">{{p.node.name}}</span>
            <span v-if="!p.node.virtual" class="folder-tree-count">{{p.node.total_count || ''}}</span><q-tooltip>{{p.node.path}}</q-tooltip></div>
        </div></template>
      </q-tree>
      <div v-if="!nodes.length" class="taxonomy-hint">{{tt('暂无匹配标签','No matching tags')}}</div></div>
    </div>
  </div>`
};

const TaxonomyPlanCard = {
  props: ['plan','busy','resolutions'],
  emits: ['apply','repreview','resolve','close'],
  computed: {
    conflicts() { return this.plan?.conflicts || []; },
    completeChoices() { return this.conflicts.every(c => Object.prototype.hasOwnProperty.call(this.resolutions || {},c.key) && c.choices.some(choice => choice.value === this.resolutions[c.key])); },
    completeRange() { return !this.plan?.media_count || (this.plan?.media_items || []).length >= this.plan.media_count; },
    retainedCount() { return this.plan?.retained_count ?? this.plan?.payload?.retained_count ?? 0; },
    title() { return this.tt({merge:'确认合并方案',split:'确认拆分方案',decision:'确认标签变更',edit:'确认词库变更'}[this.plan?.kind] || '确认变更方案', {merge:'Confirm merge',split:'Confirm split',decision:'Confirm tag change',edit:'Confirm taxonomy change'}[this.plan?.kind] || 'Confirm change'); }
  },
  methods: {tt: taxText},
  template: `<q-card class="taxonomy-plan"><q-card-section><h3>{{title}}</h3>
    <p>{{tt('影响 '+(plan?.media_count || 0)+' 个去重素材。请核对具体范围后执行。',(plan?.media_count || 0)+' unique media affected. Review the exact scope before applying.')}}</p>
    <p v-if="retainedCount" class="taxonomy-hint">{{tt(retainedCount+' 个未分配素材保留原标签。',retainedCount+' unassigned media retain the original tag.')}}</p>
    <p v-if="plan?.message">{{plan.message}}</p>
    <div v-if="!completeRange" role="alert" class="taxonomy-error">{{tt('受影响范围未完整载入，暂不能执行。','The affected scope has not fully loaded. Applying is disabled.')}}</div>
    <q-virtual-scroll v-if="plan?.media_items?.length" class="taxonomy-plan-members" :items="plan.media_items" :virtual-scroll-item-size="28">
      <template #default="{item}"><div class="taxonomy-plan-member" :key="item.id">{{item.file_name || '#'+item.id}}</div></template>
    </q-virtual-scroll>
    <details v-if="plan?.decision_deltas?.length" class="taxonomy-impact-details"><summary>{{tt('人工决定变化 '+plan.decision_deltas.length+' 项','Manual decision changes: '+plan.decision_deltas.length)}}</summary>
      <div v-for="(delta,index) in plan.decision_deltas" :key="index" class="taxonomy-impact-row">#{{delta.media_id}} · {{delta.name}} · {{tt(delta.scope==='subtree'?'子树范围':'直接标签',delta.scope==='subtree'?'Subtree':'Direct')}}：{{tt({confirm:'确认',exclude:'排除'}[delta.before] || '无记录',{confirm:'Confirmed',exclude:'Excluded'}[delta.before] || 'No decision')}} → {{tt({confirm:'确认',exclude:'排除'}[delta.after] || '移除记录',{confirm:'Confirmed',exclude:'Excluded'}[delta.after] || 'Removed decision')}}</div>
    </details>
    <details v-if="plan?.association_deltas?.length" class="taxonomy-impact-details"><summary>{{tt('素材标注变化 '+plan.association_deltas.length+' 项','Media label changes: '+plan.association_deltas.length)}}</summary><div v-for="(delta,index) in plan.association_deltas" :key="index" class="taxonomy-impact-row">#{{delta.media_id}} · {{delta.name}}：{{tt(delta.before?'已标注':'未标注',delta.before?'Tagged':'Not tagged')}} → {{tt(delta.after?'已标注':'未标注',delta.after?'Tagged':'Not tagged')}}</div></details>
    <details v-if="plan?.exclusion_changes?.length" class="taxonomy-impact-details"><summary>{{tt('排除范围变化 '+plan.exclusion_changes.length+' 项','Exclusion scope changes: '+plan.exclusion_changes.length)}}</summary>
      <div v-for="(change,index) in plan.exclusion_changes" :key="index" class="taxonomy-impact-row"><strong>#{{change.media_id}} · {{change.name}}</strong><p>{{tt('原范围：','Previous scope: ')}}{{change.before.map(node=>node.name).join(' / ')}}</p><p>{{tt('新范围：','New scope: ')}}{{change.after.map(node=>node.name).join(' / ') || tt('解除排除','Exclusion removed')}}</p></div>
    </details>
    <details v-if="plan?.node_changes?.length" class="taxonomy-impact-details"><summary>{{tt('节点位置变化 '+plan.node_changes.length+' 项','Node moves: '+plan.node_changes.length)}}</summary><div v-for="change in plan.node_changes" :key="change.tag_id" class="taxonomy-impact-row">{{change.name}}：{{change.before_parent || tt('一级','Root')}} → {{change.after_parent || tt('一级','Root')}}</div></details>
    <div v-if="Object.keys(plan?.payload?.new_targets || {}).length" class="taxonomy-impact-details"><h3>{{tt('本次方案将新建的标签','Tags created by this plan')}}</h3><div v-for="(target,id) in plan.payload.new_targets" :key="id" class="taxonomy-impact-row"><strong>{{target.name}}</strong><p v-if="target.definition">{{target.definition}}</p></div><p class="taxonomy-hint">{{tt('只有确认执行后才建立这些标签；取消预览不会留下空标签。','These tags are created only when the plan is applied. Cancelling leaves no empty tags.')}}</p></div>
    <div v-for="conflict in conflicts" :key="conflict.key" class="taxonomy-plan-conflict">
      <p>{{conflict.label}}</p><q-select :model-value="resolutions?.[conflict.key]" :options="conflict.choices" emit-value map-options outlined dense :label="tt('选择处理方式','Choose a resolution')" @update:model-value="$emit('resolve',{key:conflict.key,value:$event})"></q-select>
    </div>
    <p class="taxonomy-hint">{{tt('人工确认、排除及后续编辑都会再次校验；过期方案不会覆盖新决定。','Manual confirmations, exclusions and later edits are checked again. A stale plan cannot overwrite newer decisions.')}}</p>
  </q-card-section><q-card-actions align="right">
    <q-btn flat :label="tt('取消','Cancel')" :disable="busy" @click="$emit('close')"></q-btn>
    <q-btn v-if="conflicts.length" color="primary" :label="tt('更新影响预览','Update impact preview')" :disable="busy || !completeChoices" @click="$emit('repreview')"></q-btn>
    <q-btn v-else color="primary" :label="tt('确认执行','Apply')" :disable="busy || !completeRange" @click="$emit('apply')"></q-btn>
  </q-card-actions></q-card>`
};

const TaxonomyAnalysisPreview = {
  props: ['preview','busy'], emits: ['confirm','close'], methods: {tt:taxText},
  template: `<q-card class="taxonomy-plan taxonomy-analysis-preview"><q-card-section><h3>{{tt('整理已有分析前核对','Review existing-analysis organization')}}</h3><p>{{tt('本次范围 '+(preview?.media_count || 0)+' 个素材，可读取已有分析 '+(preview?.available_count || 0)+' 个，跳过 '+(preview?.skipped_count || 0)+' 个。','Scope: '+(preview?.media_count || 0)+' media; '+(preview?.available_count || 0)+' have existing analysis and '+(preview?.skipped_count || 0)+' will be skipped.')}}</p><p class="taxonomy-hint">{{tt('范围内原有 '+(preview?.existing_label_count || 0)+' 条正式标注。此预览不改变标注；确认后排队生成建议，仍需另行审核。','This scope has '+(preview?.existing_label_count || 0)+' formal labels. Preview changes no labels. Confirming queues suggestions for separate review.')}}</p><div class="taxonomy-analysis-terms"><template v-for="section in [{key:'matched_terms',title:tt('已有唯一映射','Uniquely matched')},{key:'ambiguous_terms',title:tt('需要消歧','Ambiguous')},{key:'unmatched_terms',title:tt('尚未映射的新表达','Unmatched expressions')}]" :key="section.key"><h3>{{section.title}} · {{preview?.[section.key]?.length || 0}}</h3><div v-for="(term,index) in preview?.[section.key] || []" :key="index" class="taxonomy-impact-row"><strong>{{term.term}}</strong> · {{term.count}}<small v-if="term.matches?.length"> · {{term.matches.map(node=>node.path || node.name).join(' / ')}}</small></div><p v-if="!preview?.[section.key]?.length" class="taxonomy-hint">{{tt('无','None')}}</p></template></div></q-card-section><q-card-actions align="right"><q-btn flat :label="tt('取消','Cancel')" :disable="busy" @click="$emit('close')"></q-btn><q-btn color="primary" :label="tt('确认生成标签建议','Queue tag suggestions')" :disable="busy || !preview?.available_count" @click="$emit('confirm')"></q-btn></q-card-actions></q-card>`
};

const TaxonomyTools = {
  props: ['gallery'],
  components: {'taxonomy-plan-card': TaxonomyPlanCard,'taxonomy-analysis-preview':TaxonomyAnalysisPreview},
  data: () => ({target: null, busy: false,
    clearExclusion: false, plan: null, showPlan: false, planRequest: null, resolutions: {},
    analysisPreview:null,analysisIds:[],showAnalysisPreview:false}),
  watch: {
    '$root.route'() { this.showPlan = false; this.plan = null; this.planRequest = null; this.showAnalysisPreview = false; }
  },
  beforeUnmount() { this.disposed = true; },
  methods: {
    tt: taxText,
    updateCounts(result) {
      if (result.counts) for (const media of this.gallery.allMediaItems) if (result.counts[media.id] !== undefined) media.tag_count = result.counts[media.id];
      taxChanged(this.$root, result);
    },
    async run(path, body, success) {
      if (this.busy) return; this.busy = true;
      try {
        const result = await TaxonomyAPI(path, 'POST', body); await this.$root.reloadTaxonomy(); this.updateCounts(result);
        if (success) Quasar.Notify.create({message: success});
        return result;
      } catch (error) { Quasar.Notify.create({message: error.message, type: 'negative'}); }
      finally { this.busy = false; }
    },
    assign() {
      if (this.target && this.gallery.selArr.length) this.run('/decisions', {media_ids: [...this.gallery.selArr], tag_id: this.target, decision: 'confirm', clear_exclusion: this.clearExclusion});
    },
    async previewAnalysis() {
      if (this.busy || !this.gallery.selArr.length) return;
      const ids = [...this.gallery.selArr], route = this.$root.route; this.busy = true;
      try { const preview = await TaxonomyAPI('/jobs/preview','POST',{media_ids:ids}); if (!this.disposed && this.$root.route === route) { this.analysisPreview = preview; this.analysisIds = ids; this.showAnalysisPreview = true; } }
      catch (error) { Quasar.Notify.create({message:error.message,type:'negative'}); }
      finally { this.busy = false; }
    },
    async confirmAnalysis() {
      if (!this.analysisPreview?.available_count) return;
      const preview = this.analysisPreview;
      const result = await this.run('/jobs',{media_ids:[...this.analysisIds],stage:'analysis'},this.tt('已排队，标签建议在维护页审核','Queued; review suggestions in tag taxonomy'));
      if (result && this.analysisPreview === preview) this.showAnalysisPreview = false;
    },
    async previewRemoval(scope) {
      if (!this.target || !this.gallery.selArr.length || this.busy) return;
      this.busy = true;
      const route = this.$root.route;
      const body = {media_ids: [...this.gallery.selArr], tag_id: this.target, decision: scope === 'subtree' ? 'exclude' : 'remove', scope};
      try {
        const plan = await TaxonomyAPI('/decisions/preview', 'POST', body);
        if (this.disposed || this.$root.route !== route) return;
        this.plan = plan; this.planRequest = body; this.resolutions = {}; this.showPlan = true;
      } catch (error) { Quasar.Notify.create({message: error.message, type: 'negative'}); }
      finally { this.busy = false; }
    },
    async repreview() {
      if (this.busy || !this.planRequest) return;
      this.busy = true;
      const route = this.$root.route, request = this.planRequest;
      try { const plan = await TaxonomyAPI('/decisions/preview', 'POST', {...request, resolutions: {...this.resolutions}}); if (!this.disposed && this.$root.route === route && this.planRequest === request) this.plan = plan; }
      catch (error) { Quasar.Notify.create({message: error.message, type: 'negative'}); }
      finally { this.busy = false; }
    },
    async applyPlan() {
      if (this.busy || !this.plan || this.plan.conflicts?.length) return;
      const route = this.$root.route; const id = this.plan.id; this.busy = true;
      try {
        const result = await TaxonomyAPI('/apply', 'POST', {id}); this.showPlan = false; await this.$root.reloadTaxonomy();
        this.updateCounts(result);
        if (this.$root.route === route && this.gallery.refreshAfterDetail) await this.gallery.refreshAfterDetail();
      } catch (error) { Quasar.Notify.create({message: error.message, type: 'negative'}); }
      finally { this.busy = false; }
    },
  },
  template: `<div class="taxonomy-tools">
    <template v-if="gallery.selArr.length && !$root.route.startsWith('#/classify')">
      <taxonomy-tag-picker v-model="target" clearable :label="tt('为所选素材添加标签','Add tag to selection')"></taxonomy-tag-picker>
      <q-btn flat dense :disable="!target || busy" @click="assign"><taxonomy-tag-icon style="width:18px;height:18px" class="q-mr-xs"></taxonomy-tag-icon>{{tt('添加标签','Add tag')}}</q-btn>
      <q-btn flat dense icon="label_off" :disable="!target || busy" :label="tt('移除直接标签','Remove direct tag')" @click="previewRemoval('direct')"><q-tooltip>{{tt('仅移除直接关联，子标签仍会汇总到父级。','Only the direct association is removed. Descendant tags still roll up to the parent.')}}</q-tooltip></q-btn>
      <q-btn flat dense :disable="!target || busy" :label="tt('排除此分类及子分类','Exclude category and descendants')" @click="previewRemoval('subtree')"></q-btn>
      <q-checkbox v-model="clearExclusion" dense size="xs" :label="tt('添加时明确解除冲突排除','Clear conflicting exclusions when adding')"></q-checkbox>
      <q-btn flat dense icon="auto_awesome" :disable="busy" :label="tt('整理已有分析','Organize analysis')" @click="previewAnalysis"></q-btn>
      <q-btn flat dense :disable="busy" :label="tt('快速分类所选','Classify selection')" @click="run('/jobs',{media_ids:[...gallery.selArr],stage:'fast'},tt('已排队','Queued'))"></q-btn>
    </template>
    <q-dialog v-model="showPlan"><taxonomy-plan-card :plan="plan" :busy="busy" :resolutions="resolutions" @resolve="resolutions[$event.key]=$event.value" @repreview="repreview" @apply="applyPlan" @close="showPlan=false"></taxonomy-plan-card></q-dialog>
    <q-dialog v-model="showAnalysisPreview"><taxonomy-analysis-preview :preview="analysisPreview" :busy="busy" @confirm="confirmAnalysis" @close="showAnalysisPreview=false"></taxonomy-analysis-preview></q-dialog>
  </div>`
};

const TaxonomyPage = {
  components: {'taxonomy-plan-card': TaxonomyPlanCard,'taxonomy-analysis-preview':TaxonomyAnalysisPreview},
  data: () => ({
    tab: 'edit', form: {}, busy: false, error: '', aliases: '',
    candidates: [], candidatesSelected: [], selectedCandidateRows: {}, reviewState: 'pending', reviewPage: 1, reviewPerPage: 20,
    groups: [], groupTotal: 0, activeGroup: null, candidatePage: 1, candidatePerPage: 48, candidateTotal: 0,
    reviewTarget: null, protectedBaseline: false, reviewRequest: null, showReviewRange: false, reviewNotice: '',
    newConcept: {name: '', parent_id: null, definition: ''}, showNewConcept: false, revalidation: null, showRevalidation: false,
    jobs: [], relationshipJobs: [], changes: [], media: [], selectedMedia: [], selectedMediaRows: {}, mediaPage: 1, mediaPerPage: 60, mediaTotal: 0,
    analysisPreview:null,analysisIds:[],showAnalysisPreview:false,
    cleanupPreview:null,showCandidateCleanup:false,
    target: null, splitTargets: [], splitAssignments: {}, newSplitTargets: [], nextSplitTargetId: -1,
    newSplitTarget: {name:'',parent_id:null,definition:''}, showNewSplitTarget: false,
    plan: null, showPlan: false, planRequest: null, resolutions: {}, lastChange: null,
    config: {}, configLoaded: false, examples: [], found: [], findSelected: [], findPage: 1, findPerPage: 48,
    relationships: [], relationshipLocks: [], relationshipSuggestions: [], relationshipState: 'pending',
    requests: {}, exampleNotice: '', aiPlanReason: '',
    validations: [], showValidation: false, validationForm: {kind:'association',model_key:'',tag_id:null,threshold:0.5},
    validationCases: [], validationCaseCounter: 0, humanDeclaration: false, validationError: '', validationResult: null,
    validationColumns: [{name:'sample',label:'Sample',field:'sample_id'},{name:'score',label:'Score',field:'score'},
      {name:'expected',label:'Human label',field:'expected'},{name:'split',label:'Split',field:'split'},{name:'source',label:'Source',field:'source'},{name:'remove',label:'',field:'sample_id'}]
  }),
  computed: {
    node() { return this.$root.taxonomyNodes.find(n => n.id === this.$root.taxonomySelected) || null; },
    maintenanceOptions() { return this.$root.taxonomyNodes.map(n=>({label:n.path,value:n.id})); },
    options() { return this.$root.taxonomyOptions.filter(n => n.value !== this.node?.id); },
    splitOptions() { return [...this.options,...this.newSplitTargets.map(target=>({label:this.tt('待建立：','To create: ')+target.name,value:target.id}))]; },
    pending() { return this.candidates; },
    reviewPages() { return Math.max(1, Math.ceil(this.groupTotal / this.reviewPerPage)); },
    candidatePages() { return Math.max(1, Math.ceil(this.candidateTotal / this.candidatePerPage)); },
    mediaPages() { return Math.max(1, Math.ceil(this.mediaTotal / this.mediaPerPage)); },
    findPages() { return Math.max(1, Math.ceil(this.found.length / this.findPerPage)); },
    visibleFound() { return this.found.slice((this.findPage-1)*this.findPerPage, this.findPage*this.findPerPage); },
    localizedValidationColumns() {
      const labels = {sample:this.tt('样本','Sample'),score:this.tt('分数','Score'),expected:this.tt('人工判断','Human label'),split:this.tt('分组','Split'),source:this.tt('来源','Source'),remove:''};
      return this.validationColumns.map(column=>({...column,label:labels[column.name]}));
    },
    selectedRows() { return this.candidatesSelected.map(id => this.selectedCandidateRows[id]).filter(Boolean); },
    staleSelection() { return this.selectedRows.some(row => row.needs_revalidation); },
    hasUnmappedSelection() { return this.selectedRows.some(row => !row.tag_id) && !this.reviewTarget; },
    selectedSplitRows() { return this.selectedMedia.map(id => this.selectedMediaRows[id] || {id, file_name: '#'+id}); },
    relationshipLocked() {
      if (Array.isArray(this.relationshipLocks)) return this.relationshipLocks.some(lock => lock.area === 'all' && lock.locked !== false && lock.locked !== 0);
      return !!this.relationshipLocks?.all;
    }
  },
  watch: {
    node: {immediate: true, handler(node, old) {
      if (node && old && node.id === old.id && this.form.version !== node.version && ['name','definition','recognition_text','parent_id'].some(key => this.form[key] !== old[key])) {
        this.error = this.tt('标签已更新，你的编辑已保留；重载将放弃未保存内容。','Tag changed; your edits were retained. Reload discards unsaved edits.'); return;
      }
      if (node && old && node.id === old.id && node.version === old.version) return;
      this.form = node ? {...node} : {}; this.selectedMedia = []; this.selectedMediaRows = {}; this.mediaPage = 1;
      this.found = []; this.findSelected = []; this.findPage = 1; this.showPlan = false; this.showAnalysisPreview = false; this.splitAssignments = {}; this.splitTargets = []; this.newSplitTargets = []; this.showNewSplitTarget = false; this.aiPlanReason = ''; this.error = '';
      this.invalidate('media'); this.invalidate('examples'); this.invalidate('find'); this.invalidate('relationships');
      if (node) { this.loadMedia(true); this.loadExamples(); if (this.tab === 'relationships') this.loadRelationships(); }
    }},
    tab() { this.refresh(); },
    reviewState() { this.reviewPage = 1; this.closeGroup(); this.loadGroups(); },
    reviewPage() { this.loadGroups(); },
    candidatePage() { this.loadCandidates(); },
    mediaPage() { this.loadMedia(); },
    relationshipState() { this.loadRelationships(); },
    showValidation(value) { if (!value) this.invalidate('validation'); }
  },
  mounted() {
    this.refresh();
    this.timer = setInterval(() => {
      if (this.tab === 'jobs') this.refresh();
      if (this.tab === 'review') this.loadGroups(true);
      if (this.tab === 'relationships') this.loadRelationships();
    }, 4000);
  },
  beforeUnmount() { this.disposed = true; clearInterval(this.timer); },
  methods: {
    tt: taxText,
    imageError: taxImageError,
    invalidate(key) { this.requests[key] = (this.requests[key] || 0)+1; return this.requests[key]; },
    current(key, token, tagId) { return !this.disposed && this.requests[key] === token && (tagId === undefined || this.node?.id === tagId); },
    async act(fn) {
      if (this.busy) return; this.busy = true; this.error = '';
      try { await fn(); } catch (error) { this.error = error.message; }
      finally { this.busy = false; }
    },
    async changed(result = {}) { await this.$root.reloadTaxonomy(); taxChanged(this.$root, result); },
    async refresh() {
      const tab = this.tab; const token = this.invalidate('refresh');
      try {
        if (tab === 'edit' && this.node) { this.form = {...this.node}; await this.loadMedia(); await this.loadExamples(); }
        if (tab === 'review') await this.loadGroups();
        if (tab === 'relationships') await this.loadRelationships();
        if (tab === 'jobs') {
          if (!this.configLoaded) {
            const config = await TaxonomyAPI('/configuration');
            if (!this.current('refresh', token) || this.tab !== tab) return;
            this.config = config; this.configLoaded = true;
          }
          const [result,relations] = await Promise.all([TaxonomyAPI('/jobs'),TaxonomyAPI('/relationships/jobs')]);
          if (this.current('refresh', token) && this.tab === tab) { this.jobs = result.data; this.relationshipJobs = relations.data; }
        }
        if (tab === 'history') {
          const result = await TaxonomyAPI('/changes');
          if (this.current('refresh', token) && this.tab === tab) this.changes = result.data;
        }
      } catch (error) { if (this.current('refresh', token) && this.tab === tab) this.error = error.message; }
    },
    async loadMedia(initial = false) {
      const id = this.node?.id; if (!id) return;
      const page = this.mediaPage; const token = this.invalidate('media');
      try {
        const result = await API.getLibrary({tag_ids: String(id), include_children: 'false', page, per_page: this.mediaPerPage});
        if (!this.current('media', token, id) || page !== this.mediaPage) return;
        this.media = result.data; this.mediaTotal = result.pagination?.total ?? result.data.length;
        if (page > Math.max(1,Math.ceil(this.mediaTotal/this.mediaPerPage))) { this.mediaPage = Math.max(1,Math.ceil(this.mediaTotal/this.mediaPerPage)); return; }
        for (const row of result.data) this.selectedMediaRows[row.id] = row;
        if (initial && this.$root.taxonomySelectedMedia?.length) {
          this.selectedMedia = [...this.$root.taxonomySelectedMedia]; Object.assign(this.selectedMediaRows,this.$root.taxonomySelectedMediaRows || {});
          this.$root.taxonomySelectedMedia = []; this.$root.taxonomySelectedMediaRows = {};
        }
      } catch (error) { if (this.current('media', token, id)) this.error = error.message; }
    },
    create(parent = false) {
      const parentId = parent ? this.node?.id : null;
      Quasar.Dialog.create({title: this.tt('新增标签','New tag'), prompt: {model: '', type: 'text'}, cancel: true}).onOk(name => this.act(async () => {
        const node = await TaxonomyAPI('/nodes', 'POST', {name, parent_id: parentId}); await this.changed(); this.$root.nav('#/taxonomy/'+node.id);
      }));
    },
    save() {
      const id = this.node.id, form = {...this.form};
      if (form.parent_id !== this.node.parent_id || form.status !== this.node.status) {
        this.requestPlan('/nodes/'+id+'/impact', form, id); return;
      }
      this.act(async () => {
        const saved = await TaxonomyAPI('/nodes/'+id, 'PATCH', form);
        if (this.node?.id === id) this.form = saved;
        await this.changed();
      });
    },
    setStatus(status) { this.requestPlan('/nodes/'+this.node.id+'/impact', {...this.form, status}, this.node.id); },
    alias() {
      const id = this.node.id, text = this.aliases;
      this.act(async () => { await TaxonomyAPI('/nodes/'+id+'/aliases', 'POST', {text}); if (this.node?.id === id) this.aliases = ''; await this.changed(); });
    },
    removeAlias(id) { this.act(async () => { await TaxonomyAPI('/aliases/'+id, 'DELETE'); await this.changed(); }); },
    requestPlan(path, body, id = this.node?.id) {
      const frozen = taxClone(body);
      this.act(async () => {
        const plan = await TaxonomyAPI(path, 'POST', frozen);
        if (this.node?.id !== id) return;
        this.plan = plan; this.planRequest = {path, body: frozen, nodeId: id}; this.resolutions = {}; this.showPlan = true;
      });
    },
    preview(kind) {
      const body = kind === 'merge' ? {source_ids: [this.node.id], target_id: this.target} : {
        source_id: this.node.id, assignments: Object.fromEntries(this.selectedMedia.map(id => [id, (this.splitAssignments[id] || []).map(target=>this.splitTargetDeclaration(target))]).filter(([, targets]) => targets.length))
      };
      if (kind === 'split' && !Object.keys(body.assignments).length) { this.error = this.tt('请先明确填写素材分配；未分配的素材会保留原标签。','Set explicit assignments first. Unassigned media retain the original tag.'); return; }
      this.requestPlan('/plans/'+kind, body);
    },
    repreview() {
      if (!this.planRequest) return;
      const request = this.planRequest; const resolutions = {...this.resolutions};
      this.act(async () => {
        const plan = await TaxonomyAPI(request.path, 'POST', {...request.body, resolutions});
        if (this.node?.id === request.nodeId) this.plan = plan;
      });
    },
    apply() {
      if (!this.plan || this.plan.conflicts?.length) return;
      const plan = this.plan;
      this.act(async () => {
        const result = await TaxonomyAPI('/apply', 'POST', {id: plan.id});
        this.lastChange = result.change_id; this.showPlan = false; await this.changed(result); await this.loadMedia();
      });
    },
    undo(id) { this.act(async () => { const result = await TaxonomyAPI('/changes/'+id+'/undo', 'POST', {}); await this.changed(result); this.lastChange = null; await this.refresh(); }); },
    setCommonSplitTargets() { for (const id of this.selectedMedia) this.splitAssignments[id] = [...this.splitTargets]; },
    splitTargetDeclaration(id) {
      if (typeof id === 'object') return {...id};
      if (id > 0) return id;
      const target = this.newSplitTargets.find(target=>target.id === id);
      if (!target) throw new Error(this.tt('拆分目标已移除，请重新选择','A proposed split target was removed. Select it again.'));
      const {id:temporaryId,...declaration} = target; return declaration;
    },
    registerSplitTarget(declaration) {
      const target = {name:declaration.name.trim(),parent_id:declaration.parent_id || null,definition:declaration.definition || '',...(declaration.recognition_text ? {recognition_text:declaration.recognition_text} : {})};
      const existing = this.newSplitTargets.find(row=>row.name === target.name && row.parent_id === target.parent_id && row.definition === target.definition && row.recognition_text === target.recognition_text);
      if (existing) return existing.id;
      const id = this.nextSplitTargetId--; this.newSplitTargets.push({...target,id}); return id;
    },
    addSplitTarget() {
      if (!this.newSplitTarget.name.trim()) return;
      this.registerSplitTarget(this.newSplitTarget); this.newSplitTarget = {name:'',parent_id:null,definition:''}; this.showNewSplitTarget = false;
    },
    removeSplitTarget(id) {
      this.newSplitTargets = this.newSplitTargets.filter(target=>target.id !== id); this.splitTargets = this.splitTargets.filter(target=>target !== id);
      for (const [mediaId,targets] of Object.entries(this.splitAssignments)) this.splitAssignments[mediaId] = targets.filter(target=>target !== id);
    },
    suggestPlan(kind) {
      const id = this.node.id; const body = {kind, source_id: id, media_ids: [...this.selectedMedia], target_id: this.target};
      this.act(async () => {
        const result = await TaxonomyAPI('/plans/suggest', 'POST', body);
        if (this.node?.id !== id) return;
        if (result.target_id) this.target = result.target_id;
        if (result.assignments) this.splitAssignments = Object.fromEntries(Object.entries(result.assignments).map(([mid,targets])=>[mid,targets.map(target=>typeof target === 'object' ? this.registerSplitTarget(target) : target)]));
        this.aiPlanReason = result.reason || this.tt('方案建议已准备，请检查分配并预览实际影响。','Suggestions are ready. Check assignments and preview the actual impact.');
      });
    },
    async loadExamples() {
      const id = this.node?.id; if (!id) return; const token = this.invalidate('examples');
      try { const result = await TaxonomyAPI('/examples/'+id); if (this.current('examples', token, id)) this.examples = result.data; }
      catch (error) { if (this.current('examples',token,id)) this.error = error.message; }
    },
    example(role) {
      const tagId = this.node.id, ids = [...this.selectedMedia];
      this.act(async () => {
        for (const id of ids) await TaxonomyAPI('/examples/'+tagId, 'POST', {media_id: id, role});
        await this.loadExamples();
        Quasar.Notify.create({message: this.tt('例图已保存，尚未改变素材标签','Examples saved; material tags unchanged')});
      });
    },
    removeExample(mid) { const id = this.node.id; this.act(async () => { await TaxonomyAPI('/examples/'+id+'/'+mid, 'DELETE'); await this.loadExamples(); this.found = []; this.findSelected = []; }); },
    findExamples() {
      const id = this.node.id; const token = this.invalidate('find');
      this.act(async () => {
        const result = await TaxonomyAPI('/examples/'+id+'/find', 'POST', {all_cached: true});
        if (!this.current('find', token, id)) return;
        this.found = result.data; this.findSelected = []; this.findPage = 1;
        this.exampleNotice = result.missing_features ? this.tt(result.missing_features+' 个素材缺少有效特征，未被当作“不符合”。',result.missing_features+' media lack valid features; they are not treated as negative matches.') : '';
      });
    },
    applyExamples() {
      const ids = [...this.findSelected]; const id = this.node.id;
      this.act(async () => {
        const result = await TaxonomyAPI('/candidates/review', 'POST', {ids, accept: true});
        if (this.node?.id === id) { this.found = this.found.filter(row => !ids.includes(row.candidate_id)); this.findSelected = []; }
        await this.changed(result); await this.loadMedia();
      });
    },
    closeGroup() { this.activeGroup = null; this.candidates = []; this.candidateTotal = 0; this.clearCandidateSelection(); this.invalidate('candidates'); this.invalidate('review-preview'); this.reviewRequest = null; this.showReviewRange = false; },
    clearCandidateSelection() { this.candidatesSelected = []; this.selectedCandidateRows = {}; this.reviewNotice = ''; },
    async loadGroups(poll = false) {
      const state = this.reviewState, page = this.reviewPage, token = this.invalidate('groups');
      try {
        const result = await TaxonomyAPI('/candidates/groups?'+new URLSearchParams({state, page, per_page: this.reviewPerPage}));
        if (!this.current('groups', token) || state !== this.reviewState || page !== this.reviewPage) return;
        this.groups = result.data; this.groupTotal = result.total;
        if (page > Math.max(1,Math.ceil(this.groupTotal/this.reviewPerPage))) { this.reviewPage = Math.max(1,Math.ceil(this.groupTotal/this.reviewPerPage)); return; }
        if (!result.data.length && !result.total && !this.activeGroup) {
          const legacy = await TaxonomyAPI('/candidates?'+new URLSearchParams({state, page: 1, per_page: this.candidatePerPage}));
          if (!this.current('groups', token)) return;
          if (legacy.total || legacy.data.length) this.groups = [{group_key: null, batch_id: 'legacy', term: this.tt('旧建议 · 需要重新校验','Legacy suggestions · Revalidation needed'), count: legacy.total || legacy.data.length, samples: legacy.data.slice(0, 3)}];
        }
        if (poll && this.activeGroup && !this.candidatesSelected.length) await this.loadCandidates();
      } catch (error) { if (this.current('groups', token)) this.error = error.message; }
    },
    openGroup(group) {
      this.invalidate('review-preview'); this.reviewRequest = null; this.showReviewRange = false;
      this.activeGroup = group; this.candidatePage = 1; this.reviewTarget = null; this.protectedBaseline = false; this.clearCandidateSelection(); this.loadCandidates();
    },
    async loadCandidates() {
      if (!this.activeGroup) return;
      const group = this.activeGroup.group_key, state = this.reviewState, page = this.candidatePage, token = this.invalidate('candidates');
      const query = {state, page, per_page: this.candidatePerPage}; if (group) query.group = group;
      try {
        const result = await TaxonomyAPI('/candidates?'+new URLSearchParams(query));
        if (!this.current('candidates', token) || this.activeGroup?.group_key !== group || state !== this.reviewState || page !== this.candidatePage) return;
        this.candidates = result.data; this.candidateTotal = result.total ?? result.data.length;
        if (page > Math.max(1,Math.ceil(this.candidateTotal/this.candidatePerPage))) { this.candidatePage = Math.max(1,Math.ceil(this.candidateTotal/this.candidatePerPage)); return; }
        for (const row of result.data) if (this.candidatesSelected.includes(row.id)) this.selectedCandidateRows[row.id] = row;
      } catch (error) { if (this.current('candidates', token)) this.error = error.message; }
    },
    updateCandidateSelection(ids) {
      this.candidatesSelected = [...ids];
      const next = {};
      for (const id of ids) { const row = this.candidates.find(candidate => candidate.id === id) || this.selectedCandidateRows[id]; if (row) next[id] = row; }
      this.selectedCandidateRows = next;
    },
    selectCandidatePage() {
      const rows = this.candidates.filter(row => this.reviewState !== 'pending' || !row.needs_revalidation);
      const ids = [...new Set([...this.candidatesSelected, ...rows.map(row => row.id)])];
      for (const row of rows) this.selectedCandidateRows[row.id] = row;
      this.candidatesSelected = ids;
    },
    selectCandidateGroup() {
      if (!this.activeGroup) return;
      const group = this.activeGroup.group_key, state = this.reviewState;
      this.act(async () => {
        const rows = []; let page = 1, total = 0;
        do {
          const query = {state, page, per_page: 200}; if (group) query.group = group;
          const result = await TaxonomyAPI('/candidates?'+new URLSearchParams(query));
          if (this.activeGroup?.group_key !== group || this.reviewState !== state) return;
          total = result.total ?? result.data.length; rows.push(...result.data); page++;
          if (!result.data.length) break;
        } while (rows.length < total && rows.length < 1000);
        const unique = [...new Map(rows.map(row => [row.id, row])).values()].slice(0, 1000).filter(row => state !== 'pending' || !row.needs_revalidation);
        this.candidatesSelected = unique.map(row => row.id); this.selectedCandidateRows = Object.fromEntries(unique.map(row => [row.id, row]));
        this.reviewNotice = this.tt('本次明确选择 '+unique.length+' 项；每次最多 1000 项，剩余成员可在处理后继续选择。','Selected exactly '+unique.length+' items. Each action is limited to 1,000; remaining members can be selected afterwards.');
      });
    },
    review(accept) {
      if (!this.candidatesSelected.length || this.staleSelection || (accept && this.hasUnmappedSelection)) return;
      let request = {ids: [...this.candidatesSelected], rows: taxClone(this.selectedRows), accept, tag_id: this.reviewTarget, baseline: this.protectedBaseline};
      const token = this.invalidate('review-preview'), group = this.activeGroup, state = this.reviewState;
      this.reviewRequest = request; request = this.reviewRequest; this.showReviewRange = false;
      if (!request.tag_id) { this.showReviewRange = true; return; }
      this.act(async()=>{
        const preview = await TaxonomyAPI('/candidates/review/preview','POST',{ids:request.ids,tag_id:request.tag_id});
        await this.$root.reloadTaxonomy();
        if (!this.current('review-preview',token) || this.reviewRequest !== request || this.activeGroup !== group || this.reviewState !== state || this.reviewTarget !== request.tag_id || this.candidatesSelected.length !== request.ids.length || request.ids.some(id=>!this.candidatesSelected.includes(id))) return;
        const target = this.$root.taxonomyNodes.find(node=>node.id === request.tag_id);
        request.target_context = preview.target_context; request.target_path = preview.target?.path || target?.path || '#'+request.tag_id;
        request.target_description = preview.target?.description || target?.recognition_text || target?.definition || target?.name || '';
        this.showReviewRange = true;
      });
    },
    confirmReview() {
      const request = this.reviewRequest; if (!request || !this.showReviewRange) return;
      if (request.tag_id && !request.target_context) { this.error = this.tt('目标依据未完成核对，请重新预览','Target context has not been verified. Preview it again.'); return; }
      this.act(async () => {
        const result = await TaxonomyAPI('/candidates/review', 'POST', {ids: request.ids, accept: request.accept, tag_id: request.tag_id, baseline: request.baseline,...(request.target_context ? {target_context:request.target_context} : {})});
        if (this.reviewRequest === request) { this.showReviewRange = false; this.clearCandidateSelection(); }
        await this.changed(result); await this.loadCandidates(); await this.loadGroups();
        if (this.reviewRequest === request && result.closed_scope) this.reviewNotice = this.tt('此含义的提议已关闭，可在“已拒绝”中明确重新打开。','Suggestions for this meaning were closed. Reopen them explicitly from Rejected.');
      });
    },
    reopen() {
      const ids = [...this.candidatesSelected], group = this.activeGroup, state = this.reviewState;
      this.act(async () => { await TaxonomyAPI('/candidates/reopen', 'POST', {ids}); if (this.activeGroup === group && this.reviewState === state) this.clearCandidateSelection(); await this.loadCandidates(); await this.loadGroups(); });
    },
    revalidateCandidate(row) {
      const group = this.activeGroup, state = this.reviewState;
      this.act(async () => {
        const result = await TaxonomyAPI('/candidates/'+row.id+'/revalidate', 'POST', {});
        if (this.disposed || this.activeGroup !== group || this.reviewState !== state) return;
        this.revalidation = result; this.showRevalidation = true;
        this.candidatesSelected = this.candidatesSelected.filter(id => id !== row.id); delete this.selectedCandidateRows[row.id];
        await this.loadCandidates();
      });
    },
    describeContext(context) {
      if (!context) return this.tt('旧建议未记录完整依据','This legacy suggestion has no complete context');
      const concept = context.concept; const lines = [];
      if (concept) lines.push(this.tt('概念：','Concept: ')+(this.$root.taxonomyNodes.find(n => n.id === concept.resolved_id)?.path || '#'+concept.resolved_id));
      if (concept?.description) lines.push(this.tt('含义：','Meaning: ')+concept.description);
      for (const decision of context.decisions || []) lines.push(this.tt('人工决定：','Manual decision: ')+(this.$root.taxonomyNodes.find(n => n.id === decision.tag_id)?.path || '#'+decision.tag_id)+' · '+this.tt(decision.decision === 'confirm' ? '已确认' : '已排除',decision.decision === 'confirm' ? 'Confirmed' : 'Excluded'));
      if (!lines.length) lines.push(this.tt('尚未映射到唯一正式概念','No unique formal concept is assigned'));
      return lines.join('\n');
    },
    createSuggestedConcept() {
      this.newConcept = {name: this.activeGroup?.term || '', parent_id: null, definition: ''}; this.showNewConcept = true;
    },
    saveSuggestedConcept() {
      const data = {...this.newConcept}, group = this.activeGroup;
      this.act(async () => { const node = await TaxonomyAPI('/nodes', 'POST', data); await this.changed(); if (this.disposed || this.activeGroup !== group) return; this.reviewTarget = node.id; this.showNewConcept = false; this.reviewNotice = this.tt('词库已保存；来源素材仍需单独选择和采纳。','The concept is saved. Source media still require a separate selection and acceptance.'); });
    },
    async loadRelationships() {
      const id = this.node?.id; if (!id) return; const state = this.relationshipState, token = this.invalidate('relationships');
      try {
        const [result, suggestions] = await Promise.all([TaxonomyAPI('/relationships?tag_id='+id), TaxonomyAPI('/relationships/suggestions?'+new URLSearchParams({tag_id: id, state}))]);
        if (!this.current('relationships', token, id) || state !== this.relationshipState) return;
        this.relationships = result.data; this.relationshipLocks = result.locks || []; this.relationshipSuggestions = suggestions.data;
      } catch (error) { if (this.current('relationships', token, id)) this.error = error.message; }
    },
    organizeRelationships() { const id = this.node.id; this.act(async () => { await TaxonomyAPI('/relationships/organize', 'POST', {tag_ids: [id]}); await this.loadRelationships(); }); },
    setRelationshipLock(locked) { const id = this.node.id; this.act(async () => { await TaxonomyAPI('/relationships/locks', 'POST', {tag_id: id, area: 'all', locked}); await this.loadRelationships(); }); },
    reviewRelationship(suggestion, accept) {
      if (accept && !['alias','near','related'].includes(suggestion.kind)) return;
      const id = suggestion.id;
      this.act(async () => { const result = await TaxonomyAPI('/relationships/review', 'POST', {ids: [id], accept}); if (result.changes?.length === 1) this.lastChange = result.changes[0].change_id; await this.changed(result); await this.loadRelationships(); });
    },
    relationshipReason(suggestion) {
      try { return suggestion.reason || suggestion.error || (typeof suggestion.evidence === 'string' ? JSON.parse(suggestion.evidence) : suggestion.evidence)?.reason || ''; }
      catch { return suggestion.reason || suggestion.error || ''; }
    },
    useRelationshipPlan(suggestion) {
      if (!suggestion.target_id) { this.error = this.tt('此建议未指向唯一标签，请先在标签内容中明确选择目标。','This suggestion has no unique target. Choose a target in Tag details.'); return; }
      const id = this.node.id;
      if (suggestion.kind === 'parent') this.form.parent_id = suggestion.target_id;
      else this.target = suggestion.target_id;
      this.aiPlanReason = this.tt('已填入关系建议，请检查后预览正式方案；尚未改动标签或素材。','The suggestion is filled in. Review it and preview a formal plan; tags and media are unchanged.');
      this.tab = 'edit';
      this.$nextTick(() => {
        if (this.node?.id === id && suggestion.kind === 'parent') this.form.parent_id = suggestion.target_id;
      });
    },
    async openValidation() {
      this.showValidation = true; this.validationError = ''; this.validationResult = null;
      this.validationForm.tag_id = this.node?.id || this.validationForm.tag_id;
      const token = this.invalidate('validation');
      try { const result = await TaxonomyAPI('/validation'); if (this.current('validation',token) && this.showValidation) this.validations = result.data; }
      catch (error) { if (this.current('validation',token) && this.showValidation) this.validationError = error.message; }
    },
    addValidationCase() { this.validationCases.push({case_key:'manual-'+(++this.validationCaseCounter),sample_id:'',score:null,expected:null,split:'heldout',source:this.tt('手工填写','Manual entry')}); this.humanDeclaration = false; },
    async importValidationCases(event) {
      const file = event.target.files?.[0]; if (!file) return;
      this.validationError = ''; this.humanDeclaration = false;
      const token = this.invalidate('validation');
      try { const cases = taxParseCases(await file.text(), file.name); if (this.current('validation',token)) this.validationCases = cases; }
      catch (error) { if (this.current('validation',token)) this.validationError = error.message; }
      finally { event.target.value = ''; }
    },
    prepareValidationCases() {
      const id = this.validationForm.tag_id, kind = this.validationForm.kind;
      if (kind === 'association' && !id) { this.validationError = this.tt('先选择要验证的标签','Choose a tag to validate first'); return; }
      const token = this.invalidate('validation');
      this.act(async () => {
        try {
          const result = await TaxonomyAPI('/validation/samples?'+new URLSearchParams({tag_id:id || '',kind}));
          if (!this.current('validation',token) || this.validationForm.tag_id !== id || this.validationForm.kind !== kind) return;
          this.validationForm.model_key = result.model_key;
          this.validationCases = result.cases.map((row,index) => ({...row,case_key:'prepared-'+index,expected:null,source:this.tt('本地模型候选，等待人工标注','Local model candidate, awaiting human annotation')}));
          this.humanDeclaration = false; this.validationError = '';
        } catch (error) { if (this.current('validation',token) && this.validationForm.tag_id === id && this.validationForm.kind === kind) this.validationError = error.message; }
      });
    },
    async submitValidation() {
      if (this.busy || !this.humanDeclaration) return;
      this.validationError = ''; this.busy = true; const token = this.invalidate('validation');
      try {
        const cases = this.validationCases.map(row => {
          if (!row.sample_id.trim() || typeof row.score !== 'number' || !Number.isFinite(row.score) || typeof row.expected !== 'boolean') throw new Error(this.tt('每条样本都需要唯一ID、有效分数及人工正反标注','Each sample needs a unique ID, a valid score and a human positive/negative label'));
          return {sample_id:row.sample_id.trim(),score:row.score,expected:row.expected,split:row.split};
        });
        if (new Set(cases.map(row => row.sample_id)).size !== cases.length) throw new Error(this.tt('样本ID不得重复，选择集和留出集也不得交叉','Sample IDs must be unique, including across selection and held-out sets'));
        const form = {...this.validationForm};
        const result = await TaxonomyAPI('/validation','POST',{...form,threshold:Number(form.threshold),annotation_source:'human',cases});
        if (!this.current('validation',token) || !this.showValidation) return;
        this.validationResult = result;
        const profiles = await TaxonomyAPI('/validation');
        if (this.current('validation',token) && this.showValidation) this.validations = profiles.data;
      } catch (error) { if (this.current('validation',token)) this.validationError = error.message; }
      finally { this.busy = false; }
    },
    validationResults(value) {
      try { return typeof value === 'string' ? JSON.parse(value) : value || {}; }
      catch { return {}; }
    },
    relationName(value) {
      return this.tt({association:'素材标签',alias:'同义表达',near:'近义',related:'相关',duplicate:'建议合并',merge:'建议合并',parent:'建议父类'}[value] || '关系建议', {association:'Media label',alias:'Alias',near:'Near synonym',related:'Related',duplicate:'Suggested merge',merge:'Suggested merge',parent:'Suggested parent'}[value] || 'Relationship suggestion');
    },
    nodePath(id) { return this.$root.taxonomyNodes.find(node => node.id === id)?.path || '#'+id; },
    saveConfiguration() { const config = {...this.config}; this.act(async () => { await TaxonomyAPI('/configuration', 'PATCH', config); Quasar.Notify.create({message: this.tt('设置已保存，适用于之后的导入和后台任务','Saved for future imports and background tasks')}); }); },
    previewCandidateCleanup() { const tab = this.tab;this.act(async()=>{const result = await TaxonomyAPI('/candidates/cleanup','POST',{});if (this.disposed || this.tab !== tab) return;this.cleanupPreview = result;this.showCandidateCleanup = true;}); },
    confirmCandidateCleanup() {
      if (!this.cleanupPreview?.count) return;
      this.act(async()=>{const result = await TaxonomyAPI('/candidates/cleanup','POST',{confirm:true});this.showCandidateCleanup = false;Quasar.Notify.create({message:this.tt('已清理 '+result.count+' 条历史建议','Cleaned '+result.count+' historical suggestions')});});
    },
    control(action) {
      const ids = this.jobs.filter(job => action === 'resume' ? ['paused','waiting','failed'].includes(job.state) : !['done','cancelled','stale'].includes(job.state)).map(job => job.id);
      if (!ids.length) return;
      this.act(async () => { await TaxonomyAPI('/jobs/control', 'POST', {ids, action}); await this.refresh(); });
    },
    canControl(job,action) { return ({pause:['queued','waiting','running'],resume:['paused','waiting','failed'],cancel:['queued','waiting','running','paused','failed']}[action] || []).includes(job.state); },
    relationshipControl(action,id) {
      const ids = this.relationshipJobs.filter(job=>(id === undefined || job.id === id) && this.canControl(job,action)).map(job=>job.id);
      if (!ids.length) return;
      this.act(async()=>{await TaxonomyAPI('/relationships/jobs/control','POST',{ids,action});await this.refresh();});
    },
    previewAnalysis() {
      const id = this.node?.id, ids = [...this.selectedMedia], tab = this.tab; if (!ids.length) return;
      this.act(async()=>{const preview = await TaxonomyAPI('/jobs/preview','POST',{media_ids:ids});if (this.node?.id !== id || this.disposed || this.tab !== tab) return;this.analysisPreview = preview;this.analysisIds = ids;this.showAnalysisPreview = true;});
    },
    confirmAnalysis() {
      if (!this.analysisPreview?.available_count) return;
      const ids = [...this.analysisIds], preview = this.analysisPreview;
      this.act(async()=>{await TaxonomyAPI('/jobs','POST',{media_ids:ids,stage:'analysis'});if (this.analysisPreview === preview) this.showAnalysisPreview = false;this.tab = 'jobs';});
    },
    classify(stage) { if (stage === 'analysis') return this.previewAnalysis(); const ids = [...this.selectedMedia]; this.act(async () => { await TaxonomyAPI('/jobs', 'POST', {media_ids: ids, stage}); this.tab = 'jobs'; }); },
    jobState(value) { return this.tt({queued:'排队',running:'运行中',paused:'已暂停',waiting:'等待资源或素材',failed:'失败',done:'已完成',cancelled:'已取消',stale:'依据已变化'}[value] || value, value); }
  },
  template: `<div class="taxonomy-page">
    <div class="taxonomy-page-tabs"><q-tabs v-model="tab" dense align="left" no-caps>
      <q-tab name="edit" :label="tt('标签内容','Tag details')"></q-tab><q-tab name="review" :label="tt('标签建议','Suggestions')"></q-tab>
      <q-tab name="relationships" :label="tt('关系整理','Relationships')"></q-tab><q-tab name="jobs" :label="tt('后台任务','Background tasks')"></q-tab><q-tab name="history" :label="tt('变更历史','History')"></q-tab>
    </q-tabs><q-btn flat dense icon="add" :label="tt('新增标签','New tag')" @click="create()"></q-btn></div>
    <div v-if="$root.taxonomyError" role="alert" class="taxonomy-error">{{$root.taxonomyError}}<q-btn flat dense icon="refresh" :aria-label="tt('重试标签树','Retry tag tree')" @click="$root.reloadTaxonomy()"></q-btn></div>
    <div v-if="error" role="alert" class="taxonomy-error">{{error}}<q-btn flat dense icon="refresh" :aria-label="tt('重载当前内容','Reload current content')" @click="refresh"></q-btn></div>
    <q-linear-progress v-if="busy" indeterminate></q-linear-progress>
    <div v-if="tab==='edit' || tab==='relationships'" class="taxonomy-maintenance-select"><taxonomy-tag-picker :model-value="$root.taxonomySelected" :options="maintenanceOptions" :label="tt('选择维护的标签','Choose a tag to maintain')" @update:model-value="$root.nav('#/taxonomy/'+($event || ''))"></taxonomy-tag-picker></div>
    <div v-if="tab==='edit'" class="taxonomy-editor">
      <template v-if="node">
        <div class="taxonomy-hint">{{node.path}} · {{tt(node.status==='active'?'可用于自动分类':'自动分配已暂停',node.status==='active'?'Available to automatic classification':'Automatic assignment paused')}}</div>
        <div class="taxonomy-form-grid"><q-input v-model="form.name" outlined dense :label="tt('标准名称','Canonical name')"></q-input>
          <taxonomy-tag-picker v-model="form.parent_id" :options="[{label:tt('一级标签','Root'),value:null},...options]" :label="tt('父级','Parent')"></taxonomy-tag-picker></div>
        <q-input v-model="form.definition" outlined dense type="textarea" autogrow :label="tt('定义与排除说明','Definition and exclusions')"></q-input>
        <q-input v-model="form.recognition_text" outlined dense :label="tt('识别描述（可选）','Recognition description (optional)')"></q-input>
        <div class="taxonomy-actions"><q-btn unelevated color="primary" :label="tt('保存','Save')" @click="save" :disable="busy"></q-btn>
          <q-btn flat :label="tt('新增子标签','New child')" @click="create(true)"></q-btn><q-btn flat :label="tt('查看图集','Browse media')" @click="$root.nav('#/classify/'+node.id)"></q-btn>
          <q-btn flat :label="tt(node.status==='active'?'暂停自动分配':'恢复自动分配',node.status==='active'?'Pause automatic assignment':'Resume assignment')" @click="setStatus(node.status==='active'?'paused':'active')"></q-btn>
          <q-btn v-if="node.status!=='inactive'" flat :label="tt('预览停用','Preview deactivation')" @click="setStatus('inactive')"></q-btn></div>
        <h3>{{tt('同义表达','Aliases')}}</h3><div class="taxonomy-actions"><q-chip v-for="alias in node.aliases || []" :key="alias.id" removable @remove="removeAlias(alias.id)">{{alias.text}}</q-chip></div>
        <div class="taxonomy-actions"><q-input v-model="aliases" dense outlined :label="tt('增加同义表达','Add alias')"></q-input><q-btn flat icon="add" :aria-label="tt('保存同义表达','Save alias')" @click="alias" :disable="!aliases.trim() || busy"></q-btn>
          <q-btn flat icon="auto_fix_high" :label="tt('AI 整理关系','Organize relationships')" @click="tab='relationships';organizeRelationships()" :disable="busy"></q-btn></div>
        <h3>{{tt('合并与拆分','Merge and split')}}</h3>
        <div class="taxonomy-actions"><taxonomy-tag-picker v-model="target" :options="options" :label="tt('合并到','Merge into')" style="min-width:220px"></taxonomy-tag-picker>
          <q-btn flat :label="tt('AI 建议合并目标','Suggest merge target')" @click="suggestPlan('merge')" :disable="busy"></q-btn><q-btn flat :label="tt('预览合并','Preview merge')" :disable="!target || busy" @click="preview('merge')"></q-btn></div>
        <p v-if="aiPlanReason" class="taxonomy-hint">{{aiPlanReason}}</p>
        <h3>{{tt('直接标注素材','Directly tagged media')}}</h3>
        <p class="taxonomy-hint">{{tt('所选素材 '+selectedMedia.length+' 项，包含从图库带来的明确选择。翻页不会自动选中新素材；未分配的素材保留原标签。',selectedMedia.length+' media selected, including explicit selections carried from the gallery. Changing pages never selects more media. Unassigned media retain the original tag.')}}</p>
        <div class="taxonomy-actions"><q-btn flat dense :label="tt('选择本页','Select this page')" @click="selectedMedia=[...new Set([...selectedMedia,...media.map(m=>m.id)])]"></q-btn><q-btn flat dense :label="tt('清空选择','Clear selection')" @click="selectedMedia=[]"></q-btn>
          <q-btn flat dense :label="tt('正例','Positive examples')" :disable="!selectedMedia.length || busy" @click="example('positive')"></q-btn><q-btn flat dense :label="tt('易混反例','Confusing negatives')" :disable="!selectedMedia.length || busy" @click="example('negative')"></q-btn>
          <q-btn flat dense :label="tt('整理已有分析','Organize analysis')" :disable="!selectedMedia.length || busy" @click="classify('analysis')"></q-btn><q-btn flat dense :label="tt('本地精细补充','Local detailed suggestions')" :disable="!selectedMedia.length || busy" @click="classify('omni')"></q-btn></div>
        <div class="taxonomy-media-grid"><label v-for="mediaItem in media" :key="mediaItem.id" class="taxonomy-media-item"><q-checkbox v-model="selectedMedia" :val="mediaItem.id" dense :aria-label="tt('选择 '+mediaItem.file_name,'Select '+mediaItem.file_name)"></q-checkbox><span class="taxonomy-preview"><img :src="'/media/thumbnail/'+mediaItem.id+'?cached=1'" alt="" loading="lazy" @error="imageError"><q-icon name="image_not_supported" class="taxonomy-offline-icon"></q-icon></span><span>{{mediaItem.file_name}}</span></label></div>
        <q-pagination v-if="mediaPages>1" v-model="mediaPage" :max="mediaPages" :max-pages="7" boundary-numbers direction-links class="taxonomy-pagination"></q-pagination>
        <p v-if="!media.length" class="taxonomy-hint">{{tt('此标签尚无直接标注素材','No directly tagged media')}}</p>
        <div v-if="selectedMedia.length" class="taxonomy-split-panel">
          <h3>{{tt('明确拆分分配','Set split assignments')}}</h3><p class="taxonomy-hint">{{tt('每个素材可以不分配、分到一个或多个目标。空目标继续保留原标签。','Each media item can have zero, one or multiple targets. An empty target keeps its original tag.')}}</p>
          <div class="taxonomy-actions"><taxonomy-tag-picker v-model="splitTargets" :options="splitOptions" multiple :label="tt('批量填写目标','Targets for explicit bulk assignment')" style="min-width:220px"></taxonomy-tag-picker>
            <q-btn flat :label="tt('新增拆分目标','New split target')" @click="showNewSplitTarget=true" :disable="busy"></q-btn><q-btn flat :label="tt('填写到所选素材','Fill selected assignments')" @click="setCommonSplitTargets"></q-btn><q-btn flat :label="tt('AI 准备拆分建议','Suggest split assignments')" @click="suggestPlan('split')" :disable="busy"></q-btn></div>
          <div v-if="newSplitTargets.length" class="taxonomy-actions"><q-chip v-for="target in newSplitTargets" :key="target.id" removable @remove="removeSplitTarget(target.id)">{{tt('待建立：','To create: ')}}{{target.name}}</q-chip><small>{{tt('尚未建立或分配；请明确选择目标后预览。','Not yet created or assigned. Select the intended targets before previewing.')}}</small></div>
          <q-virtual-scroll :items="selectedSplitRows" :virtual-scroll-item-size="60" class="taxonomy-assignment-list"><template #default="{item}"><div class="taxonomy-assignment" :key="item.id"><span>{{item.file_name}}<q-btn flat round dense size="xs" icon="close" :aria-label="tt('取消选择 '+item.file_name,'Deselect '+item.file_name)" @click="selectedMedia=selectedMedia.filter(id=>id!==item.id)"></q-btn></span><taxonomy-tag-picker v-model="splitAssignments[item.id]" :options="splitOptions" multiple :aria-label="tt(item.file_name+' 的目标','Targets for '+item.file_name)"></taxonomy-tag-picker></div></template></q-virtual-scroll>
          <q-btn flat :label="tt('预览拆分','Preview split')" :disable="busy" @click="preview('split')"></q-btn>
        </div>
        <h3>{{tt('例图辅助分类','Example-assisted classification')}}</h3><p class="taxonomy-hint">{{tt('例图是检索依据，设置正反例不会自动给素材打标签，也不代表已训练模型。','Examples guide candidate search. Setting examples neither assigns tags nor trains a model.')}}</p>
        <div class="taxonomy-actions"><q-chip v-for="exampleItem in examples" :key="exampleItem.media_id" removable @remove="removeExample(exampleItem.media_id)">{{exampleItem.role==='positive'?tt('正例','Positive'):tt('反例','Negative')}} · {{exampleItem.file_name || '#'+exampleItem.media_id}}</q-chip></div>
        <q-btn flat :label="tt('在资料库缓存中寻找候选','Find candidates in library cache')" :disable="busy || !examples.length" @click="findExamples"></q-btn><p v-if="exampleNotice" class="taxonomy-hint">{{exampleNotice}}</p>
        <div v-if="found.length"><p class="taxonomy-hint">{{tt('候选 '+found.length+' 项，已明确选择 '+findSelected.length+' 项。只有确认所选后才赋标签。',found.length+' candidates; '+findSelected.length+' explicitly selected. Tags are applied only after confirmation.')}}</p>
          <div class="taxonomy-media-grid"><label v-for="candidate in visibleFound" :key="candidate.media_id" class="taxonomy-media-item"><q-checkbox v-model="findSelected" :val="candidate.candidate_id" dense></q-checkbox><span class="taxonomy-preview"><img :src="'/media/thumbnail/'+candidate.media_id+'?cached=1'" alt="" loading="lazy" @error="imageError"><q-icon name="image_not_supported" class="taxonomy-offline-icon"></q-icon></span><span>{{candidate.file_name || '#'+candidate.media_id}}</span></label></div>
          <q-pagination v-if="findPages>1" v-model="findPage" :max="findPages" :max-pages="7" direction-links class="taxonomy-pagination"></q-pagination>
          <q-btn flat :disable="!findSelected.length || busy" :label="tt('确认标注所选 '+findSelected.length+' 项','Confirm '+findSelected.length+' selected')" @click="applyExamples"></q-btn>
        </div>
      </template>
      <div v-else class="taxonomy-empty"><q-icon name="account_tree" size="42px"></q-icon><p>{{tt('在上方选择要维护的标签，或新增标签','Choose a tag above, or create a new one')}}</p><q-btn color="primary" unelevated :label="tt('新增标签','New tag')" @click="create()"></q-btn></div>
    </div>
    <div v-if="tab==='review'" class="taxonomy-editor">
      <div class="taxonomy-actions"><q-select v-model="reviewState" :options="[{label:tt('待确认','Pending'),value:'pending'},{label:tt('已拒绝','Rejected'),value:'rejected'},{label:tt('已采纳','Accepted'),value:'accepted'}]" emit-value map-options outlined dense :label="tt('审核状态','Review state')"></q-select><q-btn flat dense icon="refresh" :label="tt('刷新','Refresh')" @click="loadGroups();activeGroup && loadCandidates()"></q-btn></div>
      <p class="taxonomy-hint">{{tt('按标签含义和导入批次分组。代表图只帮助查看，不能证明整组正确；完整成员可逐页查看。','Groups use tag meaning and import batch. Representative images help navigation and do not prove the group is correct. Every member is available in the paged list.')}}</p>
      <template v-if="!activeGroup">
        <div v-for="group in groups" :key="group.group_key || 'legacy'" class="taxonomy-review-group">
          <button class="taxonomy-group-open" type="button" @click="openGroup(group)"><strong>{{group.term}}</strong><span>{{tt(group.count+' 个建议',group.count+' suggestions')}}</span><span class="taxonomy-hint">{{tt('批次 ','Batch ')}}{{group.batch_id}}</span></button>
          <div class="taxonomy-group-samples"><span v-for="sample in group.samples || []" :key="sample.id" class="taxonomy-preview"><img :src="'/media/thumbnail/'+sample.media_id+'?cached=1'" alt="" loading="lazy" @error="imageError"><q-icon name="image_not_supported" class="taxonomy-offline-icon"></q-icon></span></div>
          <q-btn flat dense :label="tt('查看完整成员','View all members')" @click="openGroup(group)"></q-btn>
        </div>
        <q-pagination v-if="reviewPages>1" v-model="reviewPage" :max="reviewPages" :max-pages="7" direction-links class="taxonomy-pagination"></q-pagination>
        <p v-if="!groups.length" class="taxonomy-hint">{{tt(reviewState==='pending'?'暂无待审建议':'此状态暂无建议',reviewState==='pending'?'No pending suggestions':'No suggestions in this state')}}</p>
      </template>
      <template v-else>
        <div class="taxonomy-actions"><q-btn flat dense icon="arrow_back" :label="tt('返回分组','Back to groups')" @click="closeGroup"></q-btn><strong>{{activeGroup.term}}</strong><span>{{tt('本状态共 '+candidateTotal+' 项，已选择 '+candidatesSelected.length+' 项',candidateTotal+' items in this state; '+candidatesSelected.length+' selected')}}</span></div>
        <div class="taxonomy-actions"><q-btn flat dense :label="tt('选择本页可处理项','Select eligible items on this page')" @click="selectCandidatePage" :disable="busy"></q-btn><q-btn flat dense :label="tt('明确选取此组范围','Select this group explicitly')" @click="selectCandidateGroup" :disable="busy"></q-btn><q-btn flat dense :label="tt('清空选择','Clear selection')" @click="clearCandidateSelection"></q-btn></div>
        <p v-if="reviewNotice" class="taxonomy-hint">{{reviewNotice}}</p>
        <template v-if="reviewState==='pending'">
          <div class="taxonomy-actions"><taxonomy-tag-picker v-model="reviewTarget" :options="$root.taxonomyOptions" clearable :label="tt('映射到已有标签','Map to existing tag')" style="min-width:230px"></taxonomy-tag-picker><q-btn flat :label="tt('先建立新概念','Create concept first')" @click="createSuggestedConcept"></q-btn></div>
          <q-checkbox v-model="protectedBaseline" dense :label="tt('将所选历史映射确认为受保护基线','Confirm selected historical mappings as a protected baseline')"></q-checkbox>
          <div class="taxonomy-actions"><q-btn color="primary" unelevated :label="tt('采纳所选','Accept selection')" :disable="!candidatesSelected.length || staleSelection || hasUnmappedSelection || busy" @click="review(true)"></q-btn><q-btn flat :label="tt('拒绝所选','Reject selection')" :disable="!candidatesSelected.length || staleSelection || busy" @click="review(false)"></q-btn></div>
          <p v-if="staleSelection" role="alert" class="taxonomy-error">{{tt('所选含依据已变化的建议，请先重新校验并查看差异。','The selection includes changed context. Revalidate and inspect the differences first.')}}</p>
        </template>
        <q-btn v-if="reviewState==='rejected'" flat :label="tt('重新考虑所选','Reopen selected suggestions')" :disable="!candidatesSelected.length || busy" @click="reopen"></q-btn>
        <div v-for="candidate in candidates" :key="candidate.id" class="taxonomy-candidate">
          <q-checkbox :model-value="candidatesSelected.includes(candidate.id)" @update:model-value="updateCandidateSelection($event?[...candidatesSelected,candidate.id]:candidatesSelected.filter(id=>id!==candidate.id))" :aria-label="candidate.term+' '+candidate.file_name"></q-checkbox>
          <span class="taxonomy-preview"><img :src="'/media/thumbnail/'+candidate.media_id+'?cached=1'" alt="" loading="lazy" @error="imageError"><q-icon name="image_not_supported" class="taxonomy-offline-icon"></q-icon></span>
          <div class="taxonomy-candidate-details"><strong>{{candidate.term}}</strong><div>{{candidate.file_name}}</div><small>{{candidate.tag_id ? nodePath(candidate.tag_id) : tt('新词，先建立概念或选择完整路径','New concept: create it or choose an existing path first')}}</small>
            <p v-if="candidate.needs_revalidation" class="taxonomy-error">{{candidate.validation_error}}</p><q-btn v-if="candidate.needs_revalidation" flat dense :label="tt('重新校验并看差异','Revalidate and view differences')" @click="revalidateCandidate(candidate)" :disable="busy"></q-btn></div>
        </div>
        <q-pagination v-if="candidatePages>1" v-model="candidatePage" :max="candidatePages" :max-pages="7" direction-links class="taxonomy-pagination"></q-pagination>
        <p v-if="!candidates.length" class="taxonomy-hint">{{tt(reviewState==='pending'?'暂无待审建议':'此组在当前状态已无成员',reviewState==='pending'?'No pending suggestions':'No remaining members in this state')}}</p>
      </template>
    </div>
    <div v-if="tab==='relationships'" class="taxonomy-editor">
      <template v-if="node">
        <h3>{{node.path}}</h3><p class="taxonomy-hint">{{tt('同义表达属于同一概念；近义和相关保留独立节点，不会自动合并素材。','Aliases belong to one concept. Near and related concepts remain separate and do not merge media automatically.')}}</p>
        <div class="taxonomy-actions"><q-btn color="primary" :label="tt('AI 整理关系','Organize relationships')" :disable="busy" @click="organizeRelationships"></q-btn><q-btn flat :label="tt('查看关系任务','View relationship jobs')" @click="tab='jobs'"></q-btn><q-toggle :model-value="relationshipLocked" :label="tt('锁定人工关系，阻止 AI 修改','Lock relationships against AI edits')" @update:model-value="setRelationshipLock"></q-toggle></div>
        <div v-for="relationship in relationships" :key="relationship.id" class="taxonomy-job"><strong>{{relationName(relationship.kind)}}</strong><span>{{relationship.text || (relationship.source_id === node.id ? relationship.target_name || nodePath(relationship.target_id) : relationship.source_name || nodePath(relationship.source_id))}}</span><small>{{relationship.origin}}</small></div>
        <q-select v-model="relationshipState" :options="[{label:tt('待处理例外','Pending exceptions'),value:'pending'},{label:tt('已处理','Accepted'),value:'accepted'},{label:tt('已拒绝','Rejected'),value:'rejected'}]" emit-value map-options dense outlined :label="tt('关系建议状态','Relationship suggestion state')"></q-select>
        <div v-for="suggestion in relationshipSuggestions" :key="suggestion.id" class="taxonomy-review-group"><strong>{{relationName(suggestion.kind)}} · {{suggestion.expression || suggestion.term || suggestion.text || suggestion.target_name || (suggestion.target_id ? nodePath(suggestion.target_id) : '')}}</strong><p>{{relationshipReason(suggestion)}}</p>
          <div v-if="relationshipState==='pending'" class="taxonomy-actions"><q-btn v-if="['alias','near','related'].includes(suggestion.kind)" flat :label="tt('采纳关系','Accept relationship')" :disable="busy || relationshipLocked" @click="reviewRelationship(suggestion,true)"></q-btn><q-btn v-else flat :label="tt('转到正式方案','Review a formal plan')" :disable="busy" @click="useRelationshipPlan(suggestion)"></q-btn><q-btn flat :label="tt('拒绝关系','Reject relationship')" :disable="busy" @click="reviewRelationship(suggestion,false)"></q-btn></div></div>
        <p v-if="!relationshipSuggestions.length" class="taxonomy-hint">{{tt('暂无此状态的关系例外','No relationship exceptions in this state')}}</p>
      </template><p v-else class="taxonomy-hint">{{tt('请在上方选择要维护的标签','Choose a tag above')}}</p>
    </div>
    <div v-if="tab==='jobs'" class="taxonomy-editor">
      <div class="taxonomy-configuration"><h3>{{tt('后台分类设置','Background classification')}}</h3>
        <q-toggle v-model="config.classification_enabled" true-value="true" false-value="false" :label="tt('导入后在后台快速分类','Fast background classification after import')"></q-toggle>
        <q-toggle v-model="config.classification_omni_enabled" true-value="true" false-value="false" :label="tt('空闲时由本地模型二次补充','Local model refinement while idle')"></q-toggle>
        <q-toggle v-model="config.classification_relations_enabled" true-value="true" false-value="false" :label="tt('AI 整理词库关系','AI-assisted taxonomy relationships')"></q-toggle>
        <q-input v-model="config.classification_model_dir" outlined dense :label="tt('本地图文模型目录','Local image/text model directory')"></q-input>
        <div class="taxonomy-form-grid"><q-input v-model="config.classification_budget_seconds" outlined dense type="number" min="1" max="3600" :label="tt('每轮后台时间预算（秒）','Background time budget (seconds)')"></q-input><q-input v-model="config.classification_resource_limit_mb" outlined dense type="number" min="256" :label="tt('本轮后端额外内存预算（MB）','Additional backend memory budget for this round (MB)')"></q-input></div><p class="taxonomy-hint">{{tt('内存预算根据本轮Python进程峰值的增量判断，不包含模型子进程的内存，也不是应用的总内存上限。','The budget measures this round’s increase in the Python process peak. It excludes model subprocess memory and does not cap total application memory.')}}</p>
        <q-input v-model="config.classification_candidate_retention_days" outlined dense type="number" min="1" max="3650" :label="tt('已拒绝／过期建议保留天数','Retention days for rejected or stale suggestions')"></q-input><p class="taxonomy-hint">{{tt('默认保留90天，不会自动清理。修改天数后先保存设置，再预览历史建议清理范围。','Default retention is 90 days; cleanup is never automatic. Save a changed period before previewing cleanup.')}}</p><q-btn flat :label="tt('预览清理历史建议','Preview historical suggestion cleanup')" :disable="busy || !configLoaded" @click="previewCandidateCleanup"></q-btn>
        <q-toggle v-model="config.classification_auto_enabled" true-value="true" false-value="false" :label="tt('自动应用独立验证通过的标签规则','Apply independently validated tag rules automatically')"></q-toggle>
        <q-toggle v-model="config.classification_auto_relations_enabled" true-value="true" false-value="false" :label="tt('自动应用独立验证通过的关系规则','Apply independently validated relationship rules automatically')"></q-toggle>
        <p class="taxonomy-hint">{{tt('两种自动策略分别控制。未验证、含歧义或与人工决定冲突的结果继续待审；模型分数不是正确率。','These automatic policies are separate. Unvalidated, ambiguous or conflicting results remain pending. A model score is not accuracy.')}}</p>
        <div class="taxonomy-actions"><q-btn flat :label="tt('保存分类设置','Save classification settings')" :disable="busy || !configLoaded" @click="saveConfiguration"></q-btn><q-btn flat :label="tt('独立质量验证','Independent quality validation')" @click="openValidation"></q-btn></div>
      </div>
      <h3>{{tt('素材标签任务','Media classification jobs')}}</h3><div class="taxonomy-actions"><q-btn v-for="action in ['pause','resume','cancel']" :key="action" flat :label="tt({pause:'暂停当前素材任务',resume:'继续／重试当前素材任务',cancel:'取消当前素材任务'}[action],action+' listed media jobs')" :disable="busy" @click="control(action)"></q-btn></div>
      <p class="taxonomy-hint">{{tt('模型缺失时任务等待，素材仍可浏览。完整 AI 分析与标签整理状态独立。','Missing models leave jobs waiting. Media remain available; analysis and labeling have separate states.')}}</p>
      <div v-for="job in jobs" :key="job.id" class="taxonomy-job"><span>#{{job.media_id}} · {{tt({analysis:'已有分析整理',fast:'快速分类',omni:'本地精补'}[job.stage] || job.stage,job.stage)}}</span><span>{{jobState(job.state)}}</span><small>{{job.error}}</small></div>
      <p v-if="!jobs.length" class="taxonomy-hint">{{tt('暂无后台任务','No background jobs')}}</p>
      <h3>{{tt('关系整理任务','Relationship organization jobs')}}</h3><p class="taxonomy-hint">{{tt('下列控制只对当前列表中符合状态的关系任务生效，不改变已审核的关系或素材标签。','Controls apply only to eligible relationship jobs in this list. Reviewed relationships and media labels are unchanged.')}}</p><div class="taxonomy-actions"><q-btn v-for="action in ['pause','resume','cancel']" :key="action" flat :label="tt({pause:'暂停当前关系任务',resume:'继续／重试当前关系任务',cancel:'取消当前关系任务'}[action],action+' listed relationship jobs')" :disable="busy || !relationshipJobs.some(job=>canControl(job,action))" @click="relationshipControl(action)"></q-btn></div><div v-for="job in relationshipJobs" :key="job.id" class="taxonomy-job taxonomy-relationship-job"><span>{{nodePath(job.tag_id)}}</span><span>{{jobState(job.state)}}</span><small>{{job.error}}</small><q-btn v-for="action in ['pause','resume','cancel']" :key="action" flat dense :label="tt({pause:'暂停关系任务',resume:'继续关系任务',cancel:'取消关系任务'}[action],action+' relationship job')" :disable="busy || !canControl(job,action)" @click="relationshipControl(action,job.id)"></q-btn></div><p v-if="!relationshipJobs.length" class="taxonomy-hint">{{tt('暂无关系整理任务','No relationship organization jobs')}}</p>
    </div>

    <div v-if="tab==='history'" class="taxonomy-editor"><div v-for="change in changes" :key="change.id" class="taxonomy-job"><span>{{change.created_at}} · {{tt({merge:'合并',split:'拆分',decision:'标签决定',edit:'词库变更',relation:'关系整理',relationship:'关系整理'}[change.kind] || '变更',change.kind)}}</span><q-btn flat dense :disable="change.state!=='applied' || busy" :label="tt('撤销','Undo')" @click="undo(change.id)"></q-btn></div><p v-if="!changes.length">{{tt('暂无变更记录','No changes yet')}}</p></div>
    <q-dialog v-model="showAnalysisPreview"><taxonomy-analysis-preview :preview="analysisPreview" :busy="busy" @confirm="confirmAnalysis" @close="showAnalysisPreview=false"></taxonomy-analysis-preview></q-dialog>
    <q-dialog v-model="showCandidateCleanup"><q-card class="taxonomy-plan"><q-card-section><h3>{{tt('清理历史建议前核对','Review historical suggestion cleanup')}}</h3><p>{{tt('按已保存的 '+(cleanupPreview?.retention_days || 0)+' 天保留期，本次预计清理 '+(cleanupPreview?.count || 0)+' 条已拒绝或过期的历史建议。','Using the saved '+(cleanupPreview?.retention_days || 0)+'-day retention period, approximately '+(cleanupPreview?.count || 0)+' rejected or stale suggestions are eligible.')}}</p><p class="taxonomy-hint">{{tt('预览尚未删除内容。待审建议、正式标注、人工决定和识别来源均保留；不会自动定期清理。','Preview has deleted nothing. Pending suggestions, formal labels, manual decisions and recognition sources remain intact. Cleanup is not scheduled automatically.')}}</p></q-card-section><q-card-actions align="right"><q-btn flat :label="tt('取消','Cancel')" :disable="busy" @click="showCandidateCleanup=false"></q-btn><q-btn color="primary" :label="tt('确认清理历史建议','Clean historical suggestions')" :disable="busy || !cleanupPreview?.count" @click="confirmCandidateCleanup"></q-btn></q-card-actions></q-card></q-dialog>
    <q-dialog v-model="showPlan"><taxonomy-plan-card :plan="plan" :busy="busy" :resolutions="resolutions" @resolve="resolutions[$event.key]=$event.value" @repreview="repreview" @apply="apply" @close="showPlan=false"></taxonomy-plan-card></q-dialog>
    <q-dialog v-model="showNewSplitTarget"><q-card class="taxonomy-plan"><q-card-section><h3>{{tt('准备新的拆分目标','Prepare a new split target')}}</h3><p class="taxonomy-hint">{{tt('先填写新标签，随后分配到具体素材。确认整个拆分方案后才建立标签。','Define the new tag, then assign it to specific media. It is created only when the complete split plan is applied.')}}</p><q-input v-model="newSplitTarget.name" outlined dense :label="tt('拆分目标名称','Split target name')"></q-input><taxonomy-tag-picker v-model="newSplitTarget.parent_id" :options="[{label:tt('一级标签','Root'),value:null},...$root.taxonomyOptions]" :label="tt('新目标父级','Parent of new target')"></taxonomy-tag-picker><q-input v-model="newSplitTarget.definition" outlined dense type="textarea" :label="tt('新目标定义','Definition of new target')"></q-input></q-card-section><q-card-actions align="right"><q-btn flat :label="tt('取消','Cancel')" @click="showNewSplitTarget=false"></q-btn><q-btn color="primary" :label="tt('加入待建立目标','Add proposed target')" :disable="!newSplitTarget.name.trim()" @click="addSplitTarget"></q-btn></q-card-actions></q-card></q-dialog>
    <q-dialog v-model="showReviewRange"><q-card class="taxonomy-plan review-range-dialog"><q-card-section><h3>{{tt(reviewRequest?.accept?'确认采纳所选建议':'确认拒绝所选建议',reviewRequest?.accept?'Confirm selected suggestions':'Reject selected suggestions')}}</h3>
      <div v-if="error" class="taxonomy-error" role="alert">{{error}}</div>
      <p>{{tt('本次明确选择 '+(reviewRequest?.ids.length || 0)+' 项，未选择的素材不会因此自动采纳。','Exactly '+(reviewRequest?.ids.length || 0)+' items are selected. Unselected media are not accepted automatically.')}}</p>
      <p v-if="!reviewRequest?.accept" class="taxonomy-hint">{{tt('拒绝新词会关闭这个含义的提议；其它含义不受影响。拒绝已有标签建议只对所选素材记录排除。','Rejecting a new concept closes this proposed meaning; other meanings remain independent. Rejecting an existing tag records exclusions for the selected media.')}}</p>
      <p v-if="reviewRequest?.tag_id">{{tt('映射目标：','Target: ')}}{{reviewRequest.target_path || nodePath(reviewRequest.tag_id)}}</p><p v-if="reviewRequest?.target_description" class="taxonomy-hint">{{tt('已核对的识别描述：','Verified recognition description: ')}}{{reviewRequest.target_description}}</p>
      <q-virtual-scroll :items="reviewRequest?.rows || []" :virtual-scroll-item-size="28" class="taxonomy-plan-members"><template #default="{item}"><div class="taxonomy-plan-member" :key="item.id">{{item.term}} · {{item.file_name || '#'+item.media_id}}</div></template></q-virtual-scroll>
    </q-card-section><q-card-actions align="right"><q-btn flat :label="tt('取消','Cancel')" :disable="busy" @click="showReviewRange=false"></q-btn><q-btn color="primary" :label="tt(reviewRequest?.accept?'确认采纳':'确认拒绝',reviewRequest?.accept?'Accept selected':'Reject selected')" :disable="busy" @click="confirmReview"></q-btn></q-card-actions></q-card></q-dialog>
    <q-dialog v-model="showNewConcept"><q-card class="taxonomy-plan"><q-card-section><h3>{{tt('先保存词库概念','Save the concept first')}}</h3><p class="taxonomy-hint">{{tt('建立概念不会自动接受来源素材。保存后可另行选择准确范围。','Creating a concept does not accept source media. Select the exact media scope afterwards.')}}</p>
      <q-input v-model="newConcept.name" outlined dense :label="tt('新概念名称','New concept name')"></q-input><taxonomy-tag-picker v-model="newConcept.parent_id" :options="[{label:tt('一级标签','Root'),value:null},...$root.taxonomyOptions]" :label="tt('父级','Parent')"></taxonomy-tag-picker><q-input v-model="newConcept.definition" outlined dense type="textarea" :label="tt('含义与排除说明','Meaning and exclusions')"></q-input>
    </q-card-section><q-card-actions align="right"><q-btn flat :label="tt('取消','Cancel')" @click="showNewConcept=false"></q-btn><q-btn color="primary" :label="tt('仅保存概念','Save concept only')" :disable="busy || !newConcept.name.trim()" @click="saveSuggestedConcept"></q-btn></q-card-actions></q-card></q-dialog>
    <q-dialog v-model="showRevalidation"><q-card class="taxonomy-plan"><q-card-section><h3>{{tt('依据变化','Context changes')}}</h3><div class="taxonomy-form-grid"><div><strong>{{tt('原依据','Previous context')}}</strong><pre class="taxonomy-context-text">{{describeContext(revalidation?.previous)}}</pre></div><div><strong>{{tt('当前依据','Current context')}}</strong><pre class="taxonomy-context-text">{{describeContext(revalidation?.current)}}</pre></div></div><p class="taxonomy-hint">{{tt('已重新校验，但尚未采纳素材标签。请查看后重新选择。','Context was revalidated; no media label was accepted. Inspect it and select the suggestion again.')}}</p></q-card-section><q-card-actions align="right"><q-btn color="primary" :label="tt('已查看','Reviewed')" v-close-popup></q-btn></q-card-actions></q-card></q-dialog>
    <q-dialog v-model="showValidation"><q-card class="taxonomy-validation-editor"><q-card-section><h3>{{tt('自动应用的独立验证','Independent validation for automatic application')}}</h3>
      <p class="taxonomy-hint">{{tt('请用独立人工判断标注有或没有该内容。选择集至少10条；留出集至少20条，包含至少10个正例和10个反例。模型分数、两模型一致都不能替代人工真值。','Use independent human labels for presence or absence. The selection set requires at least 10 samples; the held-out set requires at least 20, with 10 positives and 10 negatives. Model scores or agreement are not ground truth.')}}</p>
      <div v-if="validationError" role="alert" class="taxonomy-error">{{validationError}}</div>
      <div class="taxonomy-form-grid"><q-select v-model="validationForm.kind" :options="[{label:tt('素材标签','Media label'),value:'association'},{label:tt('同义表达','Alias'),value:'alias'},{label:tt('近义关系','Near relation'),value:'near'},{label:tt('相关关系','Related relation'),value:'related'}]" emit-value map-options dense outlined :label="tt('验证对象','Validation type')"></q-select>
      <taxonomy-tag-picker v-model="validationForm.tag_id" :options="$root.taxonomyOptions" :label="tt('验证标签','Tag under validation')"></taxonomy-tag-picker><q-input v-model="validationForm.model_key" dense outlined :label="tt('模型标识','Model identifier')"></q-input><q-input v-model.number="validationForm.threshold" type="number" step="0.01" dense outlined :label="tt('在选择集确定的门槛','Threshold chosen using selection samples')"></q-input></div>
      <div class="taxonomy-actions"><q-btn flat :label="tt('从本地候选准备人工标注','Prepare local candidates for human annotation')" @click="prepareValidationCases" :disable="busy"></q-btn><q-btn flat :label="tt('增加样本行','Add a sample')" @click="addValidationCase" :disable="busy"></q-btn>
        <label class="taxonomy-import-label">{{tt('导入CSV/TSV','Import CSV/TSV')}}<input type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" @change="importValidationCases" :disabled="busy"></label></div>
      <p class="taxonomy-hint">{{tt('导入列：sample_id、score、expected、split。expected留空表示尚未标注；split填写selection或heldout。导入后仍需逐条核对来源。','Import columns: sample_id, score, expected, split. Empty expected values remain unannotated. Use selection or heldout for split; inspect each source after import.')}}</p>
      <q-table flat :rows="validationCases" :columns="localizedValidationColumns" row-key="case_key" :rows-per-page-options="[10,20,50]" :pagination="{rowsPerPage:10}" class="taxonomy-validation-table"><template #body="props"><q-tr :props="props">
        <q-td key="sample" :props="props"><span v-if="props.row.media_id" class="taxonomy-preview taxonomy-validation-preview"><img :src="'/media/thumbnail/'+props.row.media_id+'?cached=1'" alt="" loading="lazy" @error="imageError"><q-icon name="image_not_supported" class="taxonomy-offline-icon"></q-icon></span><q-input v-model="props.row.sample_id" dense borderless :disable="busy" :aria-label="tt('样本ID','Sample ID')" @update:model-value="humanDeclaration=false"></q-input><small v-if="props.row.file_name">{{props.row.file_name}}</small></q-td>
        <q-td key="score" :props="props"><q-input v-model.number="props.row.score" type="number" dense borderless :aria-label="tt('模型分数','Model score')"></q-input></q-td>
        <q-td key="expected" :props="props"><q-select v-model="props.row.expected" :options="[{label:tt('未标注','Not annotated'),value:null},{label:tt('确实有','Present'),value:true},{label:tt('确实没有','Absent'),value:false}]" emit-value map-options dense borderless :aria-label="tt('人工判断','Human judgment')" @update:model-value="humanDeclaration=false"></q-select></q-td>
        <q-td key="split" :props="props"><q-select v-model="props.row.split" :options="[{label:tt('选择集','Selection'),value:'selection'},{label:tt('留出集','Held out'),value:'heldout'}]" emit-value map-options dense borderless :aria-label="tt('样本分组','Dataset split')" @update:model-value="humanDeclaration=false"></q-select></q-td>
        <q-td key="source" :props="props"><span>{{props.row.source}}</span></q-td><q-td key="remove" :props="props"><q-btn flat round dense icon="close" :aria-label="tt('移除此样本','Remove this sample')" @click="validationCases.splice(validationCases.indexOf(props.row),1);humanDeclaration=false"></q-btn></q-td>
      </q-tr></template><template #no-data><p>{{tt('尚无独立标注，自动规则仍待验证。','No independent annotations yet. Automatic rules remain unvalidated.')}}</p></template></q-table>
      <q-checkbox v-model="humanDeclaration" :label="tt('我已核对来源，expected来自独立人工判断，而非模型输出','I checked the sources; expected labels are independent human judgments, not model outputs')"></q-checkbox>
      <div v-if="validationResult" class="taxonomy-validation-result"><strong>{{tt('本批验证结果','Results on this annotated set')}}</strong><p>{{tt('留出样本：','Held-out samples: ')}}{{validationResult.heldout_count}} · {{tt('误报：','False positives: ')}}{{validationResult.false_positive}} · {{tt('召回：','Recall: ')}}{{validationResult.recall}}</p><p class="taxonomy-hint">{{tt('这是此批独立样本上的观察，不保证以后所有素材都正确；自动策略仍单独控制。','These are observations on this independent set, not a guarantee for future media. Automatic policies remain separate controls.')}}</p></div>
      <h3>{{tt('已登记的验证','Registered validations')}}</h3><div v-for="profile in validations" :key="profile.id" class="taxonomy-job"><span>{{relationName(profile.kind)}} · {{profile.tag_id ? nodePath(profile.tag_id) : profile.model_key}}</span><span>{{tt('留出样本 ','Held-out samples ')}}{{validationResults(profile.results).heldout_count || 0}}</span><small>{{profile.model_key}}</small></div>
    </q-card-section><q-card-actions align="right"><q-btn flat :label="tt('关闭','Close')" :disable="busy" @click="showValidation=false"></q-btn><q-btn color="primary" :label="tt('提交独立验证','Submit independent validation')" :disable="busy || !humanDeclaration || !validationCases.length" @click="submitValidation"></q-btn></q-card-actions></q-card></q-dialog>
    <div v-if="lastChange" class="taxonomy-hint">{{tt('变更已完成','Change applied')}} <q-btn flat dense :label="tt('撤销','Undo')" @click="undo(lastChange)"></q-btn></div>
  </div>`
};
