// Person identities stay separate from content labels and share the media gallery.
const PeopleAPI=(path,method='GET',body)=>API._fetch('/api/people'+path,{method,
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
const peopleText=(zh,en)=>taxText(zh,en);
const peopleTime=value=>{const n=Math.max(0,Number(value)||0);return [Math.floor(n/3600),Math.floor(n/60)%60,Math.floor(n)%60].map(v=>String(v).padStart(2,'0')).join(':');};
const peopleImageError=event=>{const image=event.target;image.hidden=true;image.addEventListener('load',()=>{image.hidden=false;},{once:true});};
const peopleJobState=value=>({queued:peopleText('排队中','Queued'),running:peopleText('整理中','Running'),done:peopleText('已完成','Done'),waiting:peopleText('等待模型或原文件','Waiting for model or source'),failed:peopleText('失败，可重试','Failed; retry available'),paused:peopleText('已暂停','Paused'),cancelled:peopleText('已取消','Cancelled'),quality_insufficient:peopleText('画面质量不足','Insufficient quality'),no_faces:peopleText('未检测到人脸','No face detected'),stale:peopleText('输入已变化','Input changed')}[value]||value);

const PeopleRootMixin={
  data:()=>({peopleExpanded:true,peopleRevision:0,peopleCatalog:[],peopleStatus:null,peopleError:'',
    peopleSelected:null,peopleQuery:{},peopleDialog:null,pendingPeopleSeek:null}),
  computed:{
    peopleView(){const value=this.route.split('/')[2];return ['unnamed','review','hidden'].includes(value)?value:'all';},
    peopleOptions(){const rows=this.peopleCatalog.filter(p=>!p.redirect_id),counts=new Map();for(const p of rows)counts.set(p.display_name,(counts.get(p.display_name)||0)+1);return rows.map(p=>({label:p.display_name+(counts.get(p.display_name)>1?' · '+peopleText('人物 ','Person ')+String(p.id).padStart(2,'0'):'')+(p.hidden?peopleText('（已隐藏）',' (hidden)'):''),value:p.id}));},
    peopleCurrent(){return this.peopleCatalog.find(p=>p.id===this.peopleSelected);}
  },
  mounted(){
    this._peopleDisposed=false;
    this.reloadPeopleStatus();
    this._peopleTimer=setInterval(()=>{if(this.route.startsWith('#/people')||this.peopleStatus?.settings?.enabled||this.peopleStatus?.jobs?.queued||this.peopleStatus?.jobs?.running)this.reloadPeopleStatus();},5000);
  },
  beforeUnmount(){this._peopleDisposed=true;clearInterval(this._peopleTimer);this._peopleRead=(this._peopleRead||0)+1;},
  methods:{
    async reloadPeopleCatalog(){
      const token=this._peopleCatalogRead=(this._peopleCatalogRead||0)+1;
      try{const [all,hidden]=await Promise.all([PeopleAPI('/persons'),PeopleAPI('/persons?view=hidden')]);
        if(!this._peopleDisposed&&token===this._peopleCatalogRead){this.peopleCatalog=[...all.data,...hidden.data];this.peopleError='';}}
      catch(e){if(!this._peopleDisposed&&token===this._peopleCatalogRead)this.peopleError=e.message;}
    },
    async ensurePeoplePerson(id){
      const token=this._peoplePersonRead=(this._peoplePersonRead||0)+1;
      try{const person=await PeopleAPI('/persons/'+id);if(this._peopleDisposed||token!==this._peoplePersonRead||this.route!=='#/people/person/'+id)return;
        if(person.redirect_id){this.openPeoplePerson(person.redirect_id);return;}
        if(!this.peopleCatalog.some(p=>p.id===id))this.peopleCatalog=[...this.peopleCatalog,person];}
      catch(e){if(!this._peopleDisposed&&token===this._peoplePersonRead&&this.route==='#/people/person/'+id)this.peopleError=e.message;}
    },
    async reloadPeopleStatus(){
      if(this._peopleDisposed)return;
      if(this._peopleStatusBusy){this._peopleStatusAgain=true;return;}
      this._peopleStatusBusy=true;
      try{const status=await PeopleAPI('/status');if(this._peopleDisposed)return;
        const changed=this.peopleStatus&&this.peopleStatus.revision!==status.revision;
        this.peopleStatus=status;this.peopleError='';
        if(changed){this.peopleRevision++;await this.reloadPeopleCatalog();if(this.route.startsWith('#/people/person/')&&this.$refs.gallery&&!this.$refs.gallery.loading)await this.$refs.gallery.refreshAfterDetail();}}
      catch(e){if(!this._peopleDisposed)this.peopleError=e.message;}
      finally{this._peopleStatusBusy=false;if(this._peopleStatusAgain&&!this._peopleDisposed){this._peopleStatusAgain=false;await this.reloadPeopleStatus();}}
    },
    async peopleChanged(result={}){
      this.peopleRevision++;this.detailLibraryDirty=true;
      await Promise.all([this.reloadPeopleCatalog(),this.reloadPeopleStatus()]);
      if(this.currentView==='gallery'&&this.$refs.gallery)await this.$refs.gallery.refreshAfterDetail();
      if(result.change_id)Quasar.Notify.create({message:peopleText('人物整理已保存','People changes saved'),timeout:7000,
        actions:[{label:peopleText('撤销','Undo'),handler:async()=>{try{await PeopleAPI('/undo/'+result.change_id,'POST',{});await this.peopleChanged();}
          catch(e){Quasar.Notify.create({type:'negative',message:e.message});}}}]});
    },
    openPeoplePerson(id){this.nav('#/people/person/'+id);},
    openPeopleDialog(kind,payload={}){this.peopleDialog={kind,...payload,token:this._peopleDialogKey=(this._peopleDialogKey||0)+1};this.reloadPeopleCatalog();if(kind==='settings')this.reloadPeopleStatus();},
    peopleOpenAt(mediaId,seconds){
      this.pendingPeopleSeek={mediaId:Number(mediaId),seconds:Number(seconds)};
      if(this.currentView==='detail'&&this.detailId===Number(mediaId))this.$refs.detail?.seekPeopleTime(seconds);
      else this.openDetail(Number(mediaId));
    },
  }
};

const PeopleSidebar={
  computed:{root(){return this.$root;}},methods:{pt:peopleText},
  template:`<div class="people-sidebar"><q-item clickable class="sidebar-nav-item" :active="root.route.startsWith('#/people')&&root.drawerMini" active-class="sidebar-active-item" :aria-label="pt('人物','People')" @click="root.nav('#/people')">
    <q-item-section avatar><q-icon name="people_outline" size="18px"></q-icon></q-item-section><q-item-section>{{pt('人物','People')}}</q-item-section>
    <q-item-section v-if="!root.drawerMini" side><q-btn flat round dense size="xs" :icon="root.peopleExpanded?'expand_less':'expand_more'" :aria-label="pt('展开或收起人物子项','Expand or collapse people views')" :aria-expanded="root.peopleExpanded" @click.stop="root.peopleExpanded=!root.peopleExpanded"></q-btn></q-item-section></q-item>
    <div v-show="root.peopleExpanded&&!root.drawerMini" class="people-subnav">
      <q-item v-for="item in [{value:'all',icon:'people_alt',zh:'全部人物',en:'All people'},{value:'unnamed',icon:'person_outline',zh:'待命名',en:'Unnamed'},{value:'review',icon:'person_search',zh:'待核对',en:'To review'},{value:'hidden',icon:'person_off',zh:'已隐藏',en:'Hidden'}]" :key="item.value" clickable :active="root.route.startsWith('#/people')&&root.peopleView===item.value" active-class="sidebar-active-item" @click="root.nav(item.value==='all'?'#/people':'#/people/'+item.value)">
      <q-item-section avatar><q-icon :name="item.icon" size="16px"></q-icon></q-item-section><q-item-section>{{pt(item.zh,item.en)}}</q-item-section><q-item-section side v-if="item.value==='review'&&root.peopleStatus?.review_count">{{root.peopleStatus.review_count}}</q-item-section><q-item-section side v-if="item.value==='unnamed'&&root.peopleStatus?.unnamed_count">{{root.peopleStatus.unnamed_count}}</q-item-section></q-item>
    </div></div>`
};

const PeoplePage={
  data:()=>({query:'',sort:'recent',layout:'grid',people:[],reviews:[],loading:false,error:'',reviewKind:'merge',reviewPage:1,reviewPagination:{page:1,pages:1,total:0}}),
  computed:{root(){return this.$root;},view(){return this.root.peopleView;},status(){return this.root.peopleStatus;},jobs(){return this.status?.jobs||{};},
    taskSummary(){if(this.jobs.running)return peopleText('正在本地整理人物','Organizing people locally');if(this.jobs.queued)return peopleText('任务已排队，前台操作优先','Queued; foreground work has priority');if(this.jobs.waiting)return peopleText('部分任务正在等待模型或原文件','Some tasks are waiting for a model or source');if(this.jobs.failed)return peopleText('部分任务失败，可以重试','Some tasks failed; retry is available');if(this.jobs.paused)return peopleText('人物整理已暂停','People organization is paused');return peopleText('本地处理 · 可暂停与续跑','Local processing · pause and resume');}},
  watch:{view(){this.query='';if(this.reviewPage!==1)this.reviewPage=1;else this.load();},query(){clearTimeout(this._searchTimer);this._searchTimer=setTimeout(()=>this.load(),180);},sort(){this.load();},reviewKind(){if(this.reviewPage!==1)this.reviewPage=1;else this.load();},reviewPage(){this.load();},'root.peopleRevision'(){this.load();}},
  created(){this.load();this.root.reloadPeopleStatus();this.root.reloadPeopleCatalog();},
  beforeUnmount(){this.disposed=true;this._read=(this._read||0)+1;clearTimeout(this._searchTimer);},
  methods:{pt:peopleText,imageError:peopleImageError,
    async load(){const token=this._read=(this._read||0)+1;this.loading=true;this.error='';
      try{const result=await PeopleAPI(this.view==='review'?'/reviews?'+new URLSearchParams({kind:this.reviewKind,page:this.reviewPage,per_page:40}):'/persons?'+new URLSearchParams({view:this.view,q:this.query,sort:this.sort}));
        if(this.disposed||token!==this._read)return;if(this.view==='review'){this.reviews=result.data;this.reviewPagination=result.pagination||{page:1,pages:1,total:result.data.length};if(this.reviewPagination.pages>0&&this.reviewPage>this.reviewPagination.pages)this.reviewPage=this.reviewPagination.pages;}else this.people=result.data;}
      catch(e){if(!this.disposed&&token===this._read)this.error=e.message;}finally{if(!this.disposed&&token===this._read)this.loading=false;}},
    async control(action){try{await PeopleAPI('/jobs/control','POST',{action});await this.root.reloadPeopleStatus();}catch(e){this.error=e.message;}},
    async decide(review,decision){try{const r=await PeopleAPI('/reviews/'+review.id,'POST',{decision});await this.root.peopleChanged(r);await this.load();}catch(e){this.error=e.message;}},
    async preview(review){this.root.openPeopleDialog('merge',{source_ids:[review.right.id],target_id:review.left.id});},
  },
  template:`<div class="people-workspace">
    <div class="people-toolbar"><q-input v-model="query" dense borderless debounce="0" :placeholder="pt('搜索人物姓名','Search people')" :aria-label="pt('搜索人物姓名','Search people')" v-if="view!=='review'"><template #prepend><q-icon name="search" size="18px"></q-icon></template></q-input><q-space></q-space>
      <q-select v-if="view!=='review'" v-model="sort" dense borderless emit-value map-options :options="[{label:pt('最近出现','Recent'),value:'recent'},{label:pt('姓名顺序','Name'),value:'name'},{label:pt('素材数量','Media count'),value:'count'}]" :aria-label="pt('人物排序','People sort')" class="people-sort"></q-select>
      <q-btn-toggle v-if="view!=='review'" v-model="layout" v-sliding-segments="layout" class="people-view-switcher" :aria-label="pt('人物显示模式','People view mode')" dense flat :options="[{icon:'grid_view',value:'grid',attrs:{'aria-label':pt('网格视图','Grid view')}},{icon:'view_list',value:'list',attrs:{'aria-label':pt('列表视图','List view')}}]"></q-btn-toggle>
      <q-btn flat dense no-caps icon="person_add_alt" :label="pt('新增人物','New person')" @click="root.openPeopleDialog('person')"></q-btn>
      <q-btn color="primary" unelevated dense no-caps icon="auto_awesome" :label="pt('整理人物','Organize people')" @click="root.openPeopleDialog('settings')"></q-btn></div>
    <div class="people-task-strip"><q-icon name="privacy_tip" size="13px"></q-icon><span>{{taskSummary}}</span>
      <q-btn flat dense no-caps size="sm" v-if="jobs.running||jobs.queued" :label="pt('暂停','Pause')" @click="control('pause')"></q-btn>
      <q-btn flat dense no-caps size="sm" v-if="jobs.paused" :label="pt('继续','Resume')" @click="control('resume')"></q-btn>
      <q-btn flat dense no-caps size="sm" v-if="jobs.waiting||jobs.failed" :label="pt('重试','Retry')" @click="control('retry')"></q-btn>
      <q-btn flat dense no-caps size="sm" :label="pt('任务与设置','Tasks & settings')" @click="root.openPeopleDialog('settings')"></q-btn></div>
    <div class="people-scroll">
      <div v-if="error||root.peopleError" class="people-error" role="alert">{{error||root.peopleError}}<q-btn flat dense :label="pt('重试','Retry')" @click="load();root.reloadPeopleStatus()"></q-btn></div>
      <q-linear-progress v-if="loading" indeterminate></q-linear-progress>
      <template v-if="view!=='review'"><div class="people-intro"><span>PEOPLE · {{pt('人物相册','People albums')}}</span><h2>{{view==='unnamed'?pt('给熟悉的面孔，一个名字','A name for a familiar face'):view==='hidden'?pt('暂时收起的面孔','Hidden people'):pt('熟悉的人，都在这里','Familiar faces, together')}}</h2><p>{{pt('从不同文件夹里的片刻，重新找到同一个人。','Find the same person across moments and folders.')}}</p></div>
        <div v-if="people.length" class="people-grid" :class="{'is-list':layout==='list'}"><button v-for="person in people" :key="person.id" class="people-card" @click="root.openPeoplePerson(person.id)"><div class="people-portrait"><q-icon name="person_outline" size="62px"></q-icon><img v-if="person.cover_url" :src="person.cover_url+'?v='+person.version" alt="" loading="lazy" @error="imageError"></div><span class="people-card-name">{{person.display_name}}<q-icon v-if="person.manual_count" name="check" size="13px"></q-icon></span><small>{{person.photo_count}} {{pt('张照片','photos')}} · {{person.video_count}} {{pt('个视频','videos')}}</small></button></div>
        <div v-else-if="!loading" class="people-empty"><q-icon name="people_outline" size="42px"></q-icon><h3>{{query?pt('没有匹配的人物','No matching people'):view==='hidden'?pt('没有隐藏的人物','No hidden people'):pt('还没有可展示的人物','No people yet')}}</h3><p>{{pt('选择外部模型和处理范围后，在本机后台整理。已有 AI 分析不是前提。','Choose external models and a scope to organize locally. Full AI analysis is not required.')}}</p><q-btn no-caps color="primary" :label="pt('设置并整理','Set up and organize')" @click="root.openPeopleDialog('settings')"></q-btn></div>
      </template>
      <template v-else><div class="people-intro"><span>REVIEW · {{pt('人工决定优先','Your decisions take priority')}}</span><h2>{{pt('核对几处，整理一整片回忆','A few decisions, a clearer library')}}</h2></div><q-tabs v-model="reviewKind" dense align="left"><q-tab name="merge" :label="pt('可能是同一人','Possible same person')"></q-tab><q-tab name="face" :label="pt('可能认错','Possible mismatch')"></q-tab></q-tabs>
        <div class="people-review-card" v-for="review in reviews" :key="review.id"><div class="people-compare"><button v-for="person in [review.left,review.right].filter(Boolean)" :key="person.id" @click="root.openPeoplePerson(person.id)"><div class="people-portrait"><q-icon name="person_outline" size="40px"></q-icon><img v-if="person.cover_url" :src="person.cover_url+'?v='+person.version" alt="" @error="imageError"></div><strong>{{person.display_name}}</strong><small>{{person.media_count}} {{pt('个素材','media items')}}</small></button></div>
          <p>{{pt('请结合原图和不同角度确认，相似分数不是身份正确的概率。','Review original media and multiple views. Similarity is not an identity probability.')}}</p>
          <div class="people-actions" v-if="review.kind==='merge'"><q-btn dense no-caps color="primary" :label="pt('合并预览','Preview merge')" @click="preview(review)"></q-btn><q-btn flat dense no-caps :label="pt('不同的人','Different people')" @click="decide(review,'different')"></q-btn><q-btn flat dense no-caps :label="pt('暂时忽略','Dismiss')" @click="decide(review,'dismiss')"></q-btn></div>
          <div class="people-actions" v-else><img v-if="review.face" :src="review.face.crop_url+'?v='+review.face.version" class="people-review-face" alt=""><q-btn dense no-caps color="primary" :label="pt('纠正这张脸','Correct this face')" @click="root.openPeopleDialog('faces',{faces:[review.face]})"></q-btn><q-btn flat dense no-caps :label="pt('原归属正确','Original identity is correct')" @click="decide(review,'confirm')"></q-btn></div></div>
        <div v-if="!reviews.length&&!loading" class="people-empty"><q-icon name="task_alt" size="38px"></q-icon><h3>{{pt('目前没有待核对项目','Nothing to review')}}</h3><p>{{pt('不确定的归组会出现在这里。','Uncertain matches will appear here.')}}</p></div></template>
    </div><div v-if="view==='review'&&reviewPagination.pages>1" class="people-review-pagination"><q-pagination v-model="reviewPage" :max="reviewPagination.pages" :max-pages="6" :disable="loading" direction-links boundary-links :aria-label="pt('核对项目分页','Review pages')"></q-pagination></div><footer class="people-footer"><span>{{view==='review'?reviewPagination.total:people.length}} {{view==='review'?pt('项待核对','to review'):pt('位人物','people')}}</span><span>{{pt('姓名和人工纠正随资料库保存','Names and corrections are saved with the library')}}</span></footer>
  </div>`
};

const PeopleGalleryTools={
  props:['gallery'],data:()=>({loadingFaces:false}),computed:{root(){return this.$root;},person(){return this.root.peopleCurrent;}},beforeUnmount(){this.disposed=true;},methods:{pt:peopleText,
    async organize(){const ids=[...this.gallery.selArr];this.root.openPeopleDialog('settings',{media_ids:ids});},
    async correctSelected(){if(this.loadingFaces)return;const ids=[...this.gallery.selArr],personId=this.person?.id,route=this.root.route;
      if(ids.length>100){Quasar.Notify.create({type:'warning',message:this.pt('每次最多纠正 100 个素材中的人脸，请缩小选择范围。','Correct faces in up to 100 media items at once; narrow the selection.')});return;}
      this.loadingFaces=true;try{const sets=await Promise.all(ids.map(id=>PeopleAPI('/media/'+id)));if(this.disposed||this.root.route!==route||JSON.stringify(this.gallery.selArr)!==JSON.stringify(ids))return;
        const faces=sets.flatMap(s=>s.faces).filter(f=>f.person_id===personId&&f.assignment!=='not_face');
        if(faces.length)this.root.openPeopleDialog('faces',{faces});else Quasar.Notify.create({message:this.pt('所选素材中没有此人物的可纠正人脸；手动关联可从相册移除。','No matching detected faces in the selection. Manual associations can be removed from the album.')});}
      catch(e){if(!this.disposed)Quasar.Notify.create({type:'negative',message:e.message});}finally{if(!this.disposed)this.loadingFaces=false;}
    }},
  template:`<div class="people-gallery-tools" v-if="root.route.startsWith('#/people/person/')||gallery.selArr.length">
    <template v-if="person&&root.route.startsWith('#/people/person/')"><q-btn flat dense no-caps icon="arrow_back" :label="pt('全部人物','All people')" @click="root.nav('#/people')"></q-btn><q-chip v-for="id in root.peopleQuery.person_ids" :key="id" dense icon="person">{{root.peopleCatalog.find(p=>p.id===id)?.display_name||'#'+id}}</q-chip><q-btn flat dense no-caps icon="more_horiz" :label="pt('人物管理','Manage person')" @click="root.openPeopleDialog('person',{person})"></q-btn><q-btn flat dense no-caps icon="filter_alt" :label="pt('组合筛选','Combine filters')" @click="root.openPeopleDialog('filters')"></q-btn></template>
    <q-space></q-space><q-btn v-if="gallery.selArr.length" flat dense no-caps icon="people_outline" :label="pt('整理所选人物','Organize selected people')" @click="organize"></q-btn><q-btn v-if="gallery.selArr.length" flat dense no-caps icon="person_add_alt" :label="pt('关联人物','Associate person')" @click="root.openPeopleDialog('association',{media_ids:[...gallery.selArr]})"></q-btn>
    <q-btn v-if="gallery.selArr.length&&person&&root.route.startsWith('#/people/person/')" flat dense no-caps icon="person_remove" :label="pt('从此人物相册移除','Remove from this person')" @click="root.openPeopleDialog('association',{media_ids:[...gallery.selArr],person_id:person.id,decision:'exclude'})"></q-btn>
    <q-btn v-if="gallery.selArr.length&&person&&root.route.startsWith('#/people/person/')" flat dense no-caps icon="face_retouching_natural" :loading="loadingFaces" :label="pt('纠正此人物的所选人脸','Correct this person in selected media')" @click="correctSelected"></q-btn>
  </div>`
};

const PeopleMedia={
  props:['media','compact'],
  data:()=>({persons:[],faces:[],selected:[],loading:false,error:'',showBoxes:false}),
  computed:{key(){return [this.media?.id,this.$root?.peopleRevision||0].join(':');},options(){return this.$root.peopleOptions;},
    imageFaces(){return this.faces.filter(f=>f.frame_time===null&&f.assignment!=='not_face');}},
  watch:{key:{immediate:true,handler(){this.load();}}},beforeUnmount(){this.disposed=true;this._read=(this._read||0)+1;},
  methods:{pt:peopleText,time:peopleTime,imageError:peopleImageError,
    async load(){if(this.disposed)return;const token=this._read=(this._read||0)+1,id=this.media?.id;this.persons=[];this.faces=[];this.selected=[];this.error='';this.loading=false;
      if(!id||this.media.media_type==='audio')return;this.loading=true;
      try{const r=await PeopleAPI('/media/'+id);if(this.disposed||token!==this._read||this.media?.id!==id)return;this.persons=r.people;this.faces=r.faces;}
      catch(e){if(!this.disposed&&token===this._read)this.error=e.message;}finally{if(!this.disposed&&token===this._read)this.loading=false;}},
    correct(face){this.$root.openPeopleDialog('faces',{faces:face?[face]:this.faces.filter(f=>this.selected.includes(f.id))});},
    boxStyle(face){const [x,y,w,h]=face.bbox;return {left:x*100+'%',top:y*100+'%',width:w*100+'%',height:h*100+'%'};},
  },
  template:`<section v-if="media&&media.media_type!=='audio'" class="people-media-section">
    <div class="inspector-section-heading"><h3>{{pt('此素材中的人物','People in this media')}}</h3><q-btn flat dense no-caps size="sm" icon="person_add_alt" :aria-label="pt('关联人物','Associate person')" @click="$root.openPeopleDialog('association',{media_ids:[media.id]})"></q-btn></div>
    <q-spinner v-if="loading" size="15px"></q-spinner><div v-else-if="error" class="people-error" role="status">{{error}}<q-btn flat dense :label="pt('重试','Retry')" @click="load"></q-btn></div>
    <template v-else><div v-for="person in persons" :key="person.id" class="people-media-person"><button @click="$root.openPeoplePerson(person.id)"><q-icon name="person_outline" size="20px"></q-icon><img v-if="person.cover_url" :src="person.cover_url+'?v='+person.version" alt="" @error="imageError"><span>{{person.display_name}}</span></button><q-btn flat dense size="sm" icon="person_remove" :aria-label="pt('从人物相册移除','Remove from person album')" @click="$root.openPeopleDialog('association',{media_ids:[media.id],person_id:person.id,decision:'exclude'})"></q-btn></div>
      <p v-if="!persons.length" class="people-hint">{{pt('尚未关联人物；可后台识别，也可手动添加背影或遮挡照片。','No associated person yet. Organize locally or manually include an obscured/back-view photo.')}}</p>
      <div v-if="faces.length" class="people-observations"><div class="people-face-card" v-for="face in faces" :key="face.id"><label><input type="checkbox" :value="face.id" v-model="selected" :aria-label="pt('选择这张脸','Select this face')"><img :src="face.crop_url+'?v='+face.version" alt="" @error="imageError"></label><div><button v-if="face.frame_time!==null" class="people-time" @click="$root.peopleOpenAt(media.id,face.frame_time)">{{time(face.frame_time)}}</button><small v-else>{{face.assignment==='manual'?pt('人工确认','Confirmed'):face.assignment==='not_face'?pt('非人脸','Not a face'):face.assignment==='unassigned'?pt('暂不归组','Unassigned'):pt('自动关联','Automatic')}}</small><button @click="correct(face)">{{pt('纠正','Correct')}}</button></div></div></div>
      <div class="people-actions" v-if="faces.length"><q-btn flat dense no-caps size="sm" :disable="!selected.length" :label="pt('批量纠正所选人脸','Correct selected faces')" @click="correct()"></q-btn><q-btn flat dense no-caps size="sm" v-if="media.media_type==='image'" :label="showBoxes?pt('隐藏位置','Hide positions'):pt('显示人脸位置','Show face positions')" @click="showBoxes=!showBoxes"></q-btn></div>
      <div v-if="showBoxes&&media.media_type==='image'" class="people-box-preview"><img :src="API.thumbUrl(media.id)+'?cached=1'" alt=""><span v-for="face in imageFaces" :key="face.id" :style="boxStyle(face)"></span></div>
      <p v-if="media.media_type==='video'" class="people-hint">{{pt('仅显示已检测到的采样时间点，未检出不代表全片没有出现。','Only observed sample times are shown; a missed sample does not prove absence.')}}</p>
    </template></section>`
};

const PeopleDialogs={
  props:['request'],emits:['close'],
  data:()=>({busy:false,error:'',person:null,name:'',allowHomonym:false,target:null,action:'move',newName:'',plan:null,
    settings:{enabled:false,model_dir:'',profile:'buffalo_l',max_frames:24},scope:'selected',folder:'',confirmAll:false,sourceIds:[],filterPersonIds:[],excludePersonIds:[],personMode:'all',tagIds:[],peopleSearch:''}),
  computed:{root(){return this.$root;},kind(){return this.request.kind;},duplicates(){return this.name.trim()&&this.root.peopleCatalog.some(p=>p.id!==this.person?.id&&p.name===this.name.trim());},
    faces(){return this.request.faces||[];},selectedIds(){return this.request.media_ids||[];},filteredPeopleOptions(){return this.root.peopleOptions.filter(p=>p.label.toLocaleLowerCase().includes(this.peopleSearch));},title(){return {person:peopleText('管理人物','Manage person'),faces:peopleText('纠正人脸归属','Correct face identity'),association:peopleText('人物与素材关联','Person association'),merge:peopleText('合并人物预览','Preview person merge'),settings:peopleText('整理人物 · 本地处理','Organize people locally'),cover:peopleText('选择人物封面','Choose person cover'),filters:peopleText('人物组合筛选','Combine people filters')}[this.kind];}},
  created(){this.init();},beforeUnmount(){this.disposed=true;this._read=(this._read||0)+1;},
  methods:{pt:peopleText,stateLabel:peopleJobState,
    filterPeople(value,update){update(()=>{this.peopleSearch=value.toLocaleLowerCase();});},
    async init(){const token=this._read=(this._read||0)+1;this.target=this.request.target_id||this.request.person_id||null;this.sourceIds=this.request.source_ids||[];
      if(this.kind==='person'||this.kind==='cover'){this.person=this.request.person||null;this.name=this.person?.name||'';}
      if(this.kind==='settings'){await this.root.reloadPeopleStatus();if(this.disposed||token!==this._read)return;this.settings={...this.settings,...this.root.peopleStatus?.settings};this.scope=this.selectedIds.length?'selected':'future';this.folder=this.root.selectedFolder||'';}
      if(this.kind==='merge')await this.preview();
      if(this.kind==='filters'){this.filterPersonIds=[...(this.root.peopleQuery.person_ids||[])];this.excludePersonIds=[...(this.root.peopleQuery.exclude_person_ids||[])];this.personMode=this.root.peopleQuery.person_mode||'all';this.folder=this.root.selectedFolder||'';this.tagIds=[...(this.root.taxonomyQuery.tag_ids||[])];}
    },
    close(){if(!this.busy)this.$emit('close');},
    async mutate(path,method,body){const route=this.root.route,dialogToken=this.request.token;
      const active=()=>!this.disposed&&this.root.peopleDialog?.token===dialogToken;
      if(this.busy||!active())return;this.busy=true;this.error='';
      try{const result=await PeopleAPI(path,method,body);if(path==='/merge/apply'&&active()&&this.root.route===route&&route.startsWith('#/people/person/')&&result.person_id)this.root.openPeoplePerson(result.person_id);await this.root.peopleChanged(result);if(active())this.$emit('close');return result;}
      catch(e){if(active())this.error=e.message;}finally{if(active())this.busy=false;}},
    async saveName(){if(!this.name.trim()||this.duplicates&&!this.allowHomonym)return;
      return this.person?this.mutate('/persons/'+this.person.id,'PATCH',{version:this.person.version,name:this.name.trim()}):this.mutate('/persons','POST',{name:this.name.trim()});},
    hide(){return this.mutate('/persons/'+this.person.id,'PATCH',{version:this.person.version,hidden:!this.person.hidden});},
    async preview(){if(!this.target||!this.sourceIds.length)return;this.busy=true;this.error='';
      try{const result=await PeopleAPI('/merge/preview','POST',{source_ids:this.sourceIds,target_id:this.target});if(!this.disposed)this.plan=result;}
      catch(e){if(!this.disposed)this.error=e.message;}finally{if(!this.disposed)this.busy=false;}},
    correct(){const versions=Object.fromEntries(this.faces.map(f=>[f.id,f.version]));return this.mutate('/faces/decide','POST',{face_ids:this.faces.map(f=>f.id),versions,action:this.action,target_id:this.target,name:this.newName.trim()});},
    associate(){return this.mutate('/media/decisions','POST',{media_ids:this.selectedIds,person_id:this.target,decision:this.request.decision||'include'});},
    async settingsSave(run=false){if(this.busy)return;if(run&&this.scope==='all'&&!this.confirmAll)return;this.busy=true;this.error='';
      try{await PeopleAPI('/settings','PATCH',{enabled:!!this.settings.enabled,model_dir:this.settings.model_dir,profile:this.settings.profile,max_frames:Number(this.settings.max_frames)});
        if(run&&this.scope!=='future'){const body={scope:this.scope};if(this.scope==='selected')body.media_ids=this.selectedIds;if(this.scope==='folder')body.folder=this.folder;if(this.scope==='all')body.confirm_all=true;await PeopleAPI('/jobs','POST',body);}
        await this.root.reloadPeopleStatus();if(!this.disposed)this.$emit('close');}
      catch(e){if(!this.disposed)this.error=e.message;}finally{if(!this.disposed)this.busy=false;}},
    async control(action){try{await PeopleAPI('/jobs/control','POST',{action});await this.root.reloadPeopleStatus();}catch(e){this.error=e.message;}},
    mergeChoice(){this.root.openPeopleDialog('merge',{target_id:this.person.id});},
    cover(face){return this.mutate('/persons/'+this.person.id,'PATCH',{version:this.person.version,cover_face_id:face.id});},
    applyFilters(){if(!this.filterPersonIds.includes(this.root.peopleSelected)){this.error=this.pt('请保留当前人物作为筛选条件；其他人物可以追加。','Keep the current person in the filter; additional people can be included.');return;}this.root.peopleQuery={person_ids:[...this.filterPersonIds],exclude_person_ids:[...this.excludePersonIds],person_mode:this.personMode};this.root.selectedFolder=this.folder.trim()||null;this.root.taxonomyQuery={...this.root.taxonomyQuery,tag_ids:[...this.tagIds]};this.root.$refs.gallery?.load();this.close();},
  },
  template:`<q-dialog :model-value="true" :persistent="busy" @hide="close"><q-card class="people-dialog dialog-card"><q-card-section class="people-dialog-heading"><h2>{{title}}</h2><q-btn flat round dense icon="close" :disable="busy" :aria-label="pt('关闭','Close')" @click="close"></q-btn></q-card-section><q-card-section>
    <p v-if="error" class="people-error" role="alert">{{error}}</p>
    <template v-if="kind==='person'"><q-input v-model="name" outlined dense maxlength="80" :label="pt('人物姓名','Person name')" @update:model-value="allowHomonym=false"></q-input><p class="people-hint">{{pt('姓名与人脸归属独立保存；命名不会确认整组素材。','Names and face membership are saved independently; naming does not confirm every member.')}}</p><q-checkbox v-if="duplicates" v-model="allowHomonym" :label="pt('保留两个同名人物，分别管理','Keep two separate people with the same name')"></q-checkbox>
      <div class="people-actions" v-if="person"><q-btn flat dense no-caps :label="person.hidden?pt('取消隐藏','Unhide'):pt('隐藏人物','Hide person')" :disable="busy" @click="hide"></q-btn><q-btn flat dense no-caps :label="pt('与其他人物合并','Merge with another person')" @click="mergeChoice"></q-btn><q-btn flat dense no-caps :label="pt('从图集选择人脸作为封面','Choose a face as cover')" @click="root.openPeopleDialog('cover',{person})"></q-btn></div></template>
    <template v-else-if="kind==='faces'"><p class="people-hint">{{faces.length}} {{pt('张人脸 · 人工纠正会在重扫时保留','faces · corrections survive rescans')}}</p><div class="people-face-selection"><img v-for="face in faces" :key="face.id" :src="face.crop_url+'?v='+face.version" alt=""></div><q-select v-model="action" outlined dense emit-value map-options :options="[{label:pt('移到已有的人物','Move to existing person'),value:'move'},{label:pt('拆出为新人物','Split into a new person'),value:'new'},{label:pt('暂不归组','Leave unassigned'),value:'unassigned'},{label:pt('这不是人脸','Not a face'),value:'not_face'},{label:pt('确认当前归属','Confirm current identity'),value:'confirm'}]" :label="pt('操作','Action')"></q-select><q-select v-if="action==='move'" v-model="target" :options="filteredPeopleOptions" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" emit-value map-options outlined dense :label="pt('目标人物','Target person')"></q-select><q-input v-if="action==='new'" v-model="newName" outlined dense :label="pt('新人物姓名（可以稍后命名）','New name (optional)')"></q-input></template>
    <template v-else-if="kind==='association'"><p>{{selectedIds.length}} {{pt('个素材','media items')}} · {{request.decision==='exclude'?pt('从此人物相册移除；不会删除原文件。','Remove from this person; source files remain intact.'):pt('手动加入人物相册，适用于背影或遮挡照，不生成虚假人脸特征。','Manually include back-view or obscured photos without fabricating face features.')}}</p><q-select v-model="target" :options="filteredPeopleOptions" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" emit-value map-options outlined dense :label="pt('人物','Person')"></q-select><p v-if="!root.peopleOptions.length" class="people-hint">{{pt('先从人物总览新增一个人物，再关联素材。','Create a person in the overview, then associate media.')}}</p></template>
    <template v-else-if="kind==='merge'"><q-select v-model="target" :options="filteredPeopleOptions" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" emit-value map-options outlined dense :label="pt('保留的人物','Keep this person')" @update:model-value="plan=null"></q-select><q-select v-model="sourceIds" :options="filteredPeopleOptions.filter(p=>p.value!==target)" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" multiple emit-value map-options outlined dense :label="pt('合并进来的人物','People to merge in')" @update:model-value="plan=null"></q-select><q-btn class="q-mt-sm" outline dense no-caps :disable="busy||!target||!sourceIds.length" :label="pt('计算合并预览','Calculate merge preview')" @click="preview"></q-btn><div v-if="plan" class="people-merge-preview"><strong>{{plan.target.display_name}}</strong><p>{{pt('合并后按素材去重','Deduplicated media after merge')}}：{{plan.media_count}}</p><p class="people-hint">{{pt('保留目标人物姓名与封面；本次变更可以撤销。','Keeps the target name and cover. This change can be undone.')}}</p><p v-if="plan.conflicts.length" class="people-error">{{pt('存在人工决定冲突，请先纠正归属再重新预览。','Manual decisions conflict. Correct membership and preview again.')}}</p></div></template>
    <template v-else-if="kind==='settings'"><p class="people-hint">{{pt('完全本地处理，模型外部加载。保存设置不会自动扫描历史资料。','Fully local with external models. Saving settings does not scan past media.')}}</p><q-select v-model="settings.profile" outlined dense emit-value map-options :options="[{label:'Buffalo L',value:'buffalo_l'},{label:'Raccoon S',value:'raccoon_s'}]" :label="pt('模型组合','Model pair')"></q-select><q-input v-model="settings.model_dir" outlined dense :label="pt('外部模型目录（绝对路径）','External model directory (absolute path)')"></q-input><p class="people-hint" v-if="root.peopleStatus?.model">{{root.peopleStatus.model.ready?pt('当前配置已找到模型文件；识别时验证模型接口。','Files found; model interfaces are validated during inference.'):root.peopleStatus.model.error||pt('尚未找到模型文件','Model files not found')}}</p><p class="people-hint">{{settings.profile==='buffalo_l'?'det_10g.onnx + w600k_r50.onnx':'det_10g_wo.onnx + w600k_mbf.onnx'}}<br>{{pt('目录内需包含这两个匹配文件，应用不会自动下载模型；缺模型时任务等待，不会调用云端。','The directory must contain this matching pair. No automatic downloads; missing models leave jobs waiting, without cloud calls.')}}</p><q-input v-model.number="settings.max_frames" type="number" min="1" max="48" outlined dense :label="pt('每个视频最多采样帧数（1～48）','Video sample frame budget (1–48)')"></q-input><q-checkbox v-model="settings.enabled" :label="pt('今后导入后，自动在后台整理人物','Organize future imports in the background')"></q-checkbox>
      <q-select v-model="scope" outlined dense emit-value map-options :options="[{label:pt('仅保存今后导入设置','Save future-import settings only'),value:'future'},...(selectedIds.length?[{label:pt('所选素材','Selected media')+' ('+selectedIds.length+')',value:'selected'}]:[]),{label:pt('指定历史文件夹','Specific past folder'),value:'folder'},{label:pt('全部历史照片与视频','All past photos and videos'),value:'all'}]" :label="pt('本次范围','Scope for this run')"></q-select><q-input v-if="scope==='folder'" v-model="folder" outlined dense :label="pt('文件夹绝对路径','Absolute folder path')"></q-input><q-checkbox v-if="scope==='all'" v-model="confirmAll" :label="pt('确认对全部历史照片与视频登记识别任务','Confirm queueing all past photos and videos')"></q-checkbox>
      <div class="people-actions"><q-btn flat dense no-caps :label="pt('暂停','Pause')" @click="control('pause')"></q-btn><q-btn flat dense no-caps :label="pt('继续','Resume')" @click="control('resume')"></q-btn><q-btn flat dense no-caps :label="pt('重试等待/失败','Retry waiting/failed')" @click="control('retry')"></q-btn><q-btn flat dense no-caps :label="pt('取消未完成任务','Cancel unfinished')" @click="control('cancel')"></q-btn></div>
      <div class="people-job-list" v-if="root.peopleStatus?.recent?.length"><div v-for="job in root.peopleStatus.recent" :key="job.id"><strong>{{job.file_name||'#'+job.media_id}}</strong><span>{{stateLabel(job.state)}} · {{job.scope==='sampled_video'?pt('视频采样','Video samples'):job.scope==='image_preview'||job.scope==='image_preview_lowres'?pt('图片预览','Image preview'):''}}</span><small v-if="job.error">{{job.error}}</small></div></div>
    </template>
    <template v-else-if="kind==='filters'"><q-select v-model="filterPersonIds" :options="filteredPeopleOptions" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" multiple emit-value map-options use-chips outlined dense :label="pt('包含人物','Include people')"></q-select><q-select v-model="personMode" emit-value map-options outlined dense :options="[{label:pt('全部人物都出现','All selected people'),value:'all'},{label:pt('任一人物出现','Any selected person'),value:'any'}]" :label="pt('人物组合','Person matching')"></q-select><q-select v-model="excludePersonIds" :options="filteredPeopleOptions" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" multiple emit-value map-options use-chips outlined dense :label="pt('不包含人物','Exclude people')"></q-select><taxonomy-tag-picker v-model="tagIds" multiple :label="pt('叠加内容标签','Content tags')"></taxonomy-tag-picker><q-input v-model="folder" outlined dense clearable :label="pt('限定文件夹绝对路径（留空不限）','Folder absolute path (optional)')" @clear="folder=''"></q-input><p class="people-hint">{{pt('喜欢、媒体类型等条件继续使用原有筛选栏。','Use the existing toolbar for favorites, media types and other conditions.')}}</p></template>
    <template v-else-if="kind==='cover'"><people-cover-picker :person="request.person" @choose="cover"></people-cover-picker></template>
    <q-inner-loading :showing="busy"></q-inner-loading>
  </q-card-section><q-card-actions align="right"><q-btn flat no-caps :disable="busy" :label="pt('取消','Cancel')" @click="close"></q-btn>
    <q-btn v-if="kind==='person'" color="primary" no-caps :disable="busy||!name.trim()||(duplicates&&!allowHomonym)" :label="pt('保存姓名','Save name')" @click="saveName"></q-btn>
    <q-btn v-if="kind==='faces'" color="primary" no-caps :disable="busy||!faces.length||(action==='move'&&!target)" :label="pt('确认纠正','Confirm correction')" @click="correct"></q-btn>
    <q-btn v-if="kind==='association'" color="primary" no-caps :disable="busy||!target" :label="pt('确认关联变更','Confirm association')" @click="associate"></q-btn>
    <q-btn v-if="kind==='filters'" color="primary" no-caps :label="pt('应用筛选','Apply filters')" @click="applyFilters"></q-btn>
    <q-btn v-if="kind==='merge'" color="primary" no-caps :disable="busy||!plan||!!plan.conflicts.length" :label="pt('确认合并','Confirm merge')" @click="mutate('/merge/apply','POST',{plan_id:plan.plan_id})"></q-btn>
    <template v-if="kind==='settings'"><q-btn flat no-caps :disable="busy" :label="pt('只保存设置','Save settings')" @click="settingsSave(false)"></q-btn><q-btn color="primary" no-caps :disable="busy||(scope==='all'&&!confirmAll)||(scope==='folder'&&!folder.trim())" :label="scope==='future'?pt('保存设置','Save settings'):pt('保存并开始','Save and start')" @click="settingsSave(true)"></q-btn></template>
  </q-card-actions></q-card></q-dialog>`
};

const PeopleCoverPicker={
  props:['person'],emits:['choose'],data:()=>({faces:[],loading:false,error:'',page:0,pagination:null}),
  watch:{'person.id':{immediate:true,handler(){this.faces=[];this.page=0;this.pagination=null;this.loadPage(1,false);}}},
  beforeUnmount(){this.disposed=true;this._read=(this._read||0)+1;},methods:{pt:peopleText,
    async loadPage(page,append=true){if(this.disposed)return;const token=this._read=(this._read||0)+1,id=this.person.id;this.loading=true;this.error='';
      try{const result=await PeopleAPI('/persons/'+id+'/faces?'+new URLSearchParams({page,per_page:60}));if(this.disposed||token!==this._read||id!==this.person.id)return;
        this.faces=append?[...new Map([...this.faces,...result.data].map(face=>[face.id,face])).values()]:result.data;this.page=page;this.pagination=result.pagination;}
      catch(e){if(!this.disposed&&token===this._read)this.error=e.message;}finally{if(!this.disposed&&token===this._read)this.loading=false;}}
  },
  template:`<div><p v-if="error" class="people-error" role="status">{{error}}<q-btn flat dense :label="pt('重试','Retry')" :disable="loading" @click="loadPage(page+1,!!page)"></q-btn></p><p class="people-hint">{{pt('选择封面后不会自动更换，可继续加载此人物的全部人脸。','Your selected cover stays fixed. Load more to browse every face for this person.')}}</p><div class="people-cover-grid"><button v-for="face in faces" :key="face.id" @click="$emit('choose',face)"><img :src="face.crop_url+'?v='+face.version" alt="" loading="lazy"></button></div><p v-if="pagination" class="people-hint" role="status">{{pt('已显示','Showing')}} {{faces.length}} / {{pagination.total}}</p><q-spinner v-if="loading"></q-spinner><q-btn v-if="pagination&&page<pagination.pages" outline dense no-caps :disable="loading" :label="pt('加载更多人脸','Load more faces')" @click="loadPage(page+1,true)"></q-btn><p v-if="!loading&&!error&&!faces.length" class="people-hint">{{pt('此人物还没有可用的人脸封面。','No face covers are available for this person yet.')}}</p></div>`
};
