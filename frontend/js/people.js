// Person identities stay separate from content labels and share the media gallery.
const PeopleAPI=(path,method='GET',body)=>API._fetch('/api/people'+path,{method,
  ...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
const peopleText=(zh,en)=>taxText(zh,en);
const peopleTime=value=>{const n=Math.max(0,Number(value)||0);return [Math.floor(n/3600),Math.floor(n/60)%60,Math.floor(n)%60].map(v=>String(v).padStart(2,'0')).join(':');};
const peopleImageError=event=>{const image=event.target;image.hidden=true;image.addEventListener('load',()=>{image.hidden=false;},{once:true});};
const peopleJobState=value=>({queued:peopleText('排队中','Queued'),running:peopleText('整理中','Running'),done:peopleText('已完成','Done'),waiting:peopleText('等待模型或原文件','Waiting for model or source'),failed:peopleText('失败，可重试','Failed; retry available'),paused:peopleText('已暂停','Paused'),cancelled:peopleText('已取消','Cancelled'),quality_insufficient:peopleText('画面质量不足','Insufficient quality'),no_faces:peopleText('未检测到人脸','No face detected'),stale:peopleText('输入已变化','Input changed')}[value]||value);

const PeopleRootMixin={
  data:()=>({peopleExpanded:true,peopleRevision:0,peopleCatalog:[],peopleStatus:null,peopleError:'',
    peopleSelected:null,peopleQuery:{},peopleDialog:null,pendingPeopleSeek:null,peopleControlBusy:false,peopleControlError:'',peopleReviewState:{kind:'merge',page:1}}),
  computed:{
    peopleView(){const value=this.route.split('/')[2];return ['unnamed','review','hidden'].includes(value)?value:'all';},
    peopleOptions(){const rows=this.peopleCatalog.filter(p=>!p.redirect_id),counts=new Map();for(const p of rows)counts.set(p.display_name,(counts.get(p.display_name)||0)+1);return rows.map(p=>({label:p.display_name+(counts.get(p.display_name)>1?' · '+peopleText('人物 ','Person ')+String(p.id).padStart(2,'0'):'')+(p.hidden?peopleText('（已隐藏）',' (hidden)'):''),value:p.id}));},
    peopleCurrent(){return this.peopleCatalog.find(p=>p.id===this.peopleSelected);},
    peoplePendingCount(){return ['queued','running','paused','waiting','failed'].reduce((n,state)=>n+(this.peopleStatus?.jobs?.[state]||0),0);}
  },
  mounted(){
    this._peopleDisposed=false;
    this.reloadPeopleStatus();
    this._peopleTimer=setInterval(()=>{if(this.route.startsWith('#/people')||this.peopleStatus?.jobs?.queued||this.peopleStatus?.jobs?.running)this.reloadPeopleStatus();},5000);
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
    async controlPeopleTasks(action){
      if(this.peopleControlBusy)return;this.peopleControlBusy=true;this.peopleControlError='';
      try{await PeopleAPI('/jobs/control','POST',{action});await this.reloadPeopleStatus();}
      catch(e){if(!this._peopleDisposed)this.peopleControlError=e.message;}
      finally{if(!this._peopleDisposed)this.peopleControlBusy=false;}
    },
    openPeoplePerson(id){this.nav('#/people/person/'+id);},
    openPeopleDialog(kind,payload={}){this.peopleDialog={kind,...payload,token:this._peopleDialogKey=(this._peopleDialogKey||0)+1};this.reloadPeopleCatalog();if(kind==='scan')this.reloadPeopleStatus();},
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

const PeopleBackgroundTasks={
  computed:{root(){return this.$root;},jobs(){return this.root.peopleStatus?.jobs||{};},
    recent(){return (this.root.peopleStatus?.recent||[]).slice(0,6);}},
  methods:{pt:peopleText,stateLabel:peopleJobState},
  template:`<section class="people-background-tasks" :aria-label="pt('人脸识别任务','Face recognition tasks')" :aria-busy="root.peopleControlBusy">
    <div class="people-background-heading"><q-icon name="person_search" size="18px"></q-icon><strong>{{pt('人脸识别','Face recognition')}}</strong><span>{{pt('剩余 ','Remaining ')}}{{root.peoplePendingCount}}</span></div>
    <div class="people-background-actions">
      <q-btn v-if="jobs.running||jobs.queued" flat dense no-caps icon="pause" :disable="root.peopleControlBusy" :label="pt('暂停','Pause')" @click="root.controlPeopleTasks('pause')"></q-btn>
      <q-btn v-if="jobs.paused" flat dense no-caps icon="play_arrow" :disable="root.peopleControlBusy" :label="pt('继续','Resume')" @click="root.controlPeopleTasks('resume')"></q-btn>
      <q-btn v-if="jobs.waiting||jobs.failed" flat dense no-caps icon="refresh" :disable="root.peopleControlBusy" :label="pt('重试','Retry')" @click="root.controlPeopleTasks('retry')"></q-btn>
      <q-btn flat dense no-caps icon="stop" :disable="root.peopleControlBusy" :label="pt('停止','Stop')" @click="root.controlPeopleTasks('cancel')"></q-btn>
    </div>
    <p v-if="root.peopleControlError||root.peopleError" class="people-error" role="alert">{{root.peopleControlError||root.peopleError}}</p>
    <div class="people-background-job" v-for="job in recent" :key="job.id">
      <q-icon :name="job.state==='running'?'person_search':job.state==='done'?'check_circle':job.state==='paused'?'pause_circle':'photo_library'" size="18px"></q-icon>
      <span :title="job.file_name">{{job.file_name||'#'+job.media_id}}</span><small>{{stateLabel(job.state)}}</small>
      <q-tooltip v-if="job.error">{{job.error}}</q-tooltip>
    </div>
  </section>`
};

const PeopleOnboarding={
  emits:['scan','settings'],
  data:()=>({motionReady:false,activeStep:2}),
  mounted(){
    this._motionPreference=window.matchMedia('(prefers-reduced-motion: reduce)');
    this._syncMotion=()=>this.syncMotion();
    this._motionPreference.addEventListener('change',this._syncMotion);
    document.addEventListener('visibilitychange',this._syncMotion);
    this.syncMotion();
  },
  beforeUnmount(){
    this._motionPreference.removeEventListener('change',this._syncMotion);
    document.removeEventListener('visibilitychange',this._syncMotion);
    this._animation?.destroy();
  },
  methods:{pt:peopleText,
    syncMotion(){
      if(this._motionPreference.matches){this._animation?.pause();this.activeStep=2;return;}
      if(document.hidden){this._animation?.pause();return;}
      if(!window.lottie)return;
      if(!this._animation){
        this._animation=window.lottie.loadAnimation({container:this.$refs.motion,renderer:'svg',loop:true,autoplay:false,path:'/static/img/people-onboarding-motion.json?v=20261105-photo-stacks'});
        this._animation.addEventListener('DOMLoaded',()=>{this.motionReady=true;this.syncMotion();});
        this._animation.addEventListener('enterFrame',event=>{
          const step=event.currentTime<60?0:event.currentTime<104?1:2;
          if(this.activeStep!==step)this.activeStep=step;
        });
      }else if(this._animation.isLoaded)this._animation.play();
    }
  },
  template:`<section class="people-onboarding" :aria-label="pt('认识人物功能','Discover people albums')">
    <div class="people-onboarding-art" :class="{'is-animated':motionReady}" aria-hidden="true">
      <svg class="people-onboarding-still" viewBox="0 0 520 240" focusable="false"><defs><g id="people-onboarding-person-a"><rect class="people-photo-shadow" opacity="0.07" x="-42.0" y="-31.0" width="84" height="68" rx="8"></rect><rect class="people-photo-paper" x="-42.0" y="-34.0" width="84" height="68" rx="8"></rect><rect class="people-photo-edge" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" x="-42.0" y="-34.0" width="84" height="68" rx="8"></rect><rect class="people-photo-wash-0" x="-36.0" y="-28.0" width="72" height="51" rx="5"></rect><ellipse class="people-photo-light" opacity="0.28" cx="22" cy="-15" rx="17.5" ry="17.5"></ellipse><path class="people-photo-shirt-a" d="M -29 23 C -27 10 -14 8 -8 6 L 8 6 C 14 8 27 10 29 23 Z"></path><rect class="people-photo-skin" x="-4.5" y="0.5" width="9" height="11" rx="3"></rect><ellipse class="people-photo-skin" cx="-13" cy="-8" rx="2.0" ry="3.5"></ellipse><ellipse class="people-photo-skin" cx="13" cy="-8" rx="2.0" ry="3.5"></ellipse><ellipse class="people-photo-skin" cx="0" cy="-10" rx="12.5" ry="15.0"></ellipse><path class="people-photo-ink" d="M -14 -8 C -21 -22 -8 -30 3 -27 C 17 -29 20 -16 13 -6 L 12 -17 C 6 -15 -1 -17 -3 -21 C -5 -15 -12 -15 -14 -8 Z"></path><ellipse class="people-photo-ink" cx="-5" cy="-11" rx="0.95" ry="1.2"></ellipse><ellipse class="people-photo-ink" cx="5" cy="-11" rx="0.95" ry="1.2"></ellipse><path class="people-photo-face-line" fill="none" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" d="M 0 -7 L -1 -4 L 1 -4"></path><path class="people-photo-face-line" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.75" d="M -3 -1 C -1 1 2 1 4 -1"></path><path class="people-photo-collar" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" d="M -10 10 L 0 15 L 10 10"></path><rect class="people-photo-caption" opacity="0.28" x="-26.0" y="27.5" width="28" height="2" rx="1"></rect></g><g id="people-onboarding-person-b"><rect class="people-photo-shadow" opacity="0.07" x="-42.0" y="-31.0" width="84" height="68" rx="8"></rect><rect class="people-photo-paper" x="-42.0" y="-34.0" width="84" height="68" rx="8"></rect><rect class="people-photo-edge" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" x="-42.0" y="-34.0" width="84" height="68" rx="8"></rect><rect class="people-photo-wash-0" x="-36.0" y="-28.0" width="72" height="51" rx="5"></rect><ellipse class="people-photo-light" opacity="0.28" cx="22" cy="-15" rx="17.5" ry="17.5"></ellipse><path class="people-photo-ink" d="M -15 -8 C -20 -21 -10 -30 1 -29 C 16 -30 20 -13 16 6 C 6 13 -9 11 -17 6 Z"></path><path class="people-photo-shirt-b" d="M -29 23 C -27 10 -14 8 -8 6 L 8 6 C 14 8 27 10 29 23 Z"></path><rect class="people-photo-skin" x="-4.5" y="0.5" width="9" height="11" rx="3"></rect><ellipse class="people-photo-skin" cx="-13" cy="-8" rx="2.0" ry="3.5"></ellipse><ellipse class="people-photo-skin" cx="13" cy="-8" rx="2.0" ry="3.5"></ellipse><ellipse class="people-photo-skin" cx="0" cy="-10" rx="12.5" ry="15.0"></ellipse><path class="people-photo-ink" d="M -13 -12 C -11 -28 13 -28 14 -11 C 4 -11 1 -17 -1 -22 C -2 -16 -8 -14 -13 -12 Z"></path><ellipse class="people-photo-ink" cx="-5" cy="-11" rx="0.95" ry="1.2"></ellipse><ellipse class="people-photo-ink" cx="5" cy="-11" rx="0.95" ry="1.2"></ellipse><path class="people-photo-face-line" fill="none" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" d="M 0 -7 L -1 -4 L 1 -4"></path><path class="people-photo-face-line" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.75" d="M -3 -1 C -1 1 2 1 4 -1"></path><path class="people-photo-collar" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" d="M -10 10 L 0 15 L 10 10"></path><rect class="people-photo-caption" opacity="0.28" x="-26.0" y="27.5" width="28" height="2" rx="1"></rect></g><g id="people-onboarding-person-c"><rect class="people-photo-shadow" opacity="0.07" x="-42.0" y="-31.0" width="84" height="68" rx="8"></rect><rect class="people-photo-paper" x="-42.0" y="-34.0" width="84" height="68" rx="8"></rect><rect class="people-photo-edge" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" x="-42.0" y="-34.0" width="84" height="68" rx="8"></rect><rect class="people-photo-wash-0" x="-36.0" y="-28.0" width="72" height="51" rx="5"></rect><ellipse class="people-photo-light" opacity="0.28" cx="22" cy="-15" rx="17.5" ry="17.5"></ellipse><ellipse class="people-photo-ink" cx="-11" cy="-19" rx="6.0" ry="7.0"></ellipse><ellipse class="people-photo-ink" cx="-4" cy="-25" rx="7.0" ry="5.5"></ellipse><ellipse class="people-photo-ink" cx="6" cy="-25" rx="7.0" ry="5.5"></ellipse><ellipse class="people-photo-ink" cx="12" cy="-19" rx="6.0" ry="7.0"></ellipse><path class="people-photo-shirt-c" d="M -29 23 C -27 10 -14 8 -8 6 L 8 6 C 14 8 27 10 29 23 Z"></path><rect class="people-photo-skin" x="-4.5" y="0.5" width="9" height="11" rx="3"></rect><ellipse class="people-photo-skin" cx="-13" cy="-8" rx="2.0" ry="3.5"></ellipse><ellipse class="people-photo-skin" cx="13" cy="-8" rx="2.0" ry="3.5"></ellipse><ellipse class="people-photo-skin" cx="0" cy="-10" rx="12.5" ry="15.0"></ellipse><path class="people-photo-ink" d="M -13 -15 C -10 -29 11 -29 14 -15 L 11 -17 C 6 -15 1 -21 -2 -20 C -5 -16 -9 -18 -13 -15 Z"></path><ellipse class="people-photo-ink" cx="-5" cy="-11" rx="0.95" ry="1.2"></ellipse><ellipse class="people-photo-ink" cx="5" cy="-11" rx="0.95" ry="1.2"></ellipse><rect class="people-photo-face-line" fill="none" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round" x="-10.5" y="-13.0" width="9" height="6" rx="2.6"></rect><rect class="people-photo-face-line" fill="none" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round" x="1.5" y="-13.0" width="9" height="6" rx="2.6"></rect><path class="people-photo-face-line" fill="none" stroke-width="0.85" stroke-linecap="round" stroke-linejoin="round" d="M -1.5 -10 L 1.5 -10"></path><path class="people-photo-face-line" fill="none" stroke-width="0.7" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" d="M 0 -7 L -1 -4 L 1 -4"></path><path class="people-photo-face-line" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.75" d="M -3 -1 C -1 1 2 1 4 -1"></path><path class="people-photo-collar" fill="none" stroke-width="0.8" stroke-linecap="round" stroke-linejoin="round" opacity="0.55" d="M -10 10 L 0 15 L 10 10"></path><rect class="people-photo-caption" opacity="0.28" x="-26.0" y="27.5" width="28" height="2" rx="1"></rect></g></defs>
<ellipse class="people-photo-shadow" cx="112" cy="190" rx="54" ry="6" opacity=".08"></ellipse>
<use href="#people-onboarding-person-a" transform="translate(105 117) scale(1.35) rotate(-7)"></use>
<use href="#people-onboarding-person-a" transform="translate(119 121) scale(1.35) rotate(6)"></use>
<use href="#people-onboarding-person-a" transform="translate(112 129) scale(1.35) rotate(0)"></use>
<ellipse class="people-photo-shadow" cx="260" cy="190" rx="54" ry="6" opacity=".08"></ellipse>
<use href="#people-onboarding-person-b" transform="translate(253 117) scale(1.35) rotate(-7)"></use>
<use href="#people-onboarding-person-b" transform="translate(267 121) scale(1.35) rotate(6)"></use>
<use href="#people-onboarding-person-b" transform="translate(260 129) scale(1.35) rotate(0)"></use>
<ellipse class="people-photo-shadow" cx="408" cy="190" rx="54" ry="6" opacity=".08"></ellipse>
<use href="#people-onboarding-person-c" transform="translate(401 117) scale(1.35) rotate(-7)"></use>
<use href="#people-onboarding-person-c" transform="translate(415 121) scale(1.35) rotate(6)"></use>
<use href="#people-onboarding-person-c" transform="translate(408 129) scale(1.35) rotate(0)"></use>
</svg>
      <div ref="motion" class="people-onboarding-motion"></div>
    </div>
    <div class="people-onboarding-copy"><h2>{{pt('让熟悉的面孔，成为人物相册','Familiar faces, together in an album')}}</h2></div>
    <ol class="people-onboarding-steps">
      <li :class="{'is-current':activeStep===0}"><span class="people-onboarding-step-number">1</span>{{pt('识别位置','Locate faces')}}</li>
      <li :class="{'is-current':activeStep===1}"><span class="people-onboarding-step-number">2</span>{{pt('提取特征','Read features')}}</li>
      <li :class="{'is-current':activeStep===2}"><span class="people-onboarding-step-number">3</span>{{pt('按人归组','Group by person')}}</li>
    </ol>
    <div class="people-onboarding-actions"><q-btn class="people-action-button" color="primary" unelevated dense no-caps icon="person_search" :label="pt('开始人脸识别','Start face recognition')" @click="$emit('scan')"></q-btn><q-btn class="people-action-button" flat dense no-caps icon="settings" :label="pt('人脸识别设置','Face recognition settings')" @click="$emit('settings')"></q-btn></div>
  </section>`
};

// Shared by the inline review and the inspector/bulk correction dialog.
const PeopleFaceEditor={
  props:{faces:{type:Array,required:true},suggested:{type:Object,default:null},showFaces:{type:Boolean,default:true}},emits:['cancel','saved','busy'],
  data:()=>({action:'move',target:null,newName:'',query:'',people:[],loading:true,readError:'',error:'',busy:false,snapshot:[]}),
  computed:{root(){return this.$root;},
    nameCounts(){const counts=new Map();for(const p of this.people)counts.set(p.display_name,(counts.get(p.display_name)||0)+1);return counts;},
    choices(){const query=this.query.trim().toLocaleLowerCase();return this.people.filter(p=>!p.redirect_id&&this.personLabel(p).toLocaleLowerCase().includes(query))
      .sort((a,b)=>Number(b.id===this.suggested?.id)-Number(a.id===this.suggested?.id));},
    selectedPerson(){return this.people.find(p=>p.id===this.target);},
    canConfirm(){return !this.busy&&this.snapshot.length>0&&(this.action!=='move'||(!this.loading&&!this.readError&&!!this.selectedPerson))&&
      (this.action!=='confirm'||this.snapshot.every(f=>f.person_id&&f.assignment!=='not_face'));},
    outcome(){return {move:this.selectedPerson?this.pt('改为：','Move to: ')+this.personLabel(this.selectedPerson):this.pt('请选择人物','Choose a person'),
      new:this.pt('新建人物','New person')+(this.newName.trim()?'：'+this.newName.trim():''),unassigned:this.pt('暂不归组','Leave unassigned'),
      not_face:this.pt('这不是人脸','Not a face'),confirm:this.pt('确认当前归属','Confirm current identity')}[this.action];}
  },
  created(){this.snapshot=this.faces.map(f=>({...f}));this.loadPeople();},
  beforeUnmount(){this.disposed=true;this._read=(this._read||0)+1;if(this.busy)this.$emit('busy',false);},
  methods:{pt:peopleText,imageError:peopleImageError,
    personLabel(person){return person.display_name+(this.nameCounts.get(person.display_name)>1?' · #'+person.id:'')+(person.hidden?this.pt('（已隐藏）',' (hidden)'):'');},
    currentName(face){return this.people.find(p=>p.id===face.person_id)?.display_name||this.root.peopleCatalog.find(p=>p.id===face.person_id)?.display_name||
      (face.person_id?this.pt('人物 ','Person ')+String(face.person_id).padStart(2,'0'):this.pt('尚未归组','Unassigned'));},
    async loadPeople(){const token=this._read=(this._read||0)+1;this.loading=true;this.readError='';
      try{const [all,hidden]=await Promise.all([PeopleAPI('/persons'),PeopleAPI('/persons?view=hidden')]);
        if(!this.disposed&&token===this._read)this.people=[...all.data,...hidden.data];}
      catch(e){if(!this.disposed&&token===this._read)this.readError=e.message;}
      finally{if(!this.disposed&&token===this._read)this.loading=false;}
    },
    choose(person){if(!this.busy){this.action='move';this.target=person.id;}},
    cancel(){if(!this.busy)this.$emit('cancel');},
    editorKey(event){if(event.key==='Escape'){if(event.type==='keydown')this.cancel();event.preventDefault();}event.stopPropagation();},
    async save(){if(!this.canConfirm)return;this.busy=true;this.error='';this.$emit('busy',true);
      const body={face_ids:this.snapshot.map(f=>f.id),versions:Object.fromEntries(this.snapshot.map(f=>[f.id,f.version])),
        action:this.action,target_id:this.action==='move'?this.target:null,name:this.action==='new'?this.newName.trim():''};
      try{const result=await PeopleAPI('/faces/decide','POST',body);await this.root.peopleChanged(result);if(!this.disposed){this.busy=false;this.$emit('busy',false);this.$emit('saved',result);}}
      catch(e){if(!this.disposed)this.error=e.message;}
      finally{if(!this.disposed&&this.busy){this.busy=false;this.$emit('busy',false);}}
    }
  },
  template:`<section class="people-face-editor" :aria-label="pt('纠正人脸归属','Correct face identity')" :aria-busy="busy" @keydown="editorKey" @keyup="editorKey">
    <div v-if="showFaces" class="people-face-selection"><figure v-for="face in snapshot" :key="face.id"><img :src="face.crop_url+'?v='+face.version" :alt="pt('待确认的人脸','Face to review')" @error="imageError"><figcaption :title="currentName(face)">{{currentName(face)}}</figcaption></figure><span class="people-editor-note">{{snapshot.length}} {{pt('张人脸 · 人工纠正会保留','faces · corrections are retained')}}</span></div>
    <div class="people-face-editor-heading"><strong>{{snapshot.length===1?pt('这张脸属于谁？','Who is this?'):pt('这些人脸属于谁？','Who are these faces?')}}</strong>
      <div v-sliding-segments="action" class="people-editor-modes" role="group" :aria-label="pt('归属方式','Identity action')"><q-btn flat dense no-caps :class="{'is-active':action==='move'}" :aria-pressed="action==='move'" :disable="busy" :label="pt('已有的人物','Existing person')" @click="action='move'"></q-btn><q-btn flat dense no-caps :class="{'is-active':action==='new'}" :aria-pressed="action==='new'" :disable="busy" :label="pt('新建人物','New person')" @click="action='new'"></q-btn></div>
      <q-input v-if="action==='move'" v-model="query" filled dense clearable :disable="busy" :placeholder="pt('搜索姓名','Search names')" :aria-label="pt('搜索目标人物','Search target people')" @clear="query=''"><template #prepend><q-icon name="search" size="16px"></q-icon></template></q-input>
    </div>
    <template v-if="action==='move'"><div v-if="readError" class="people-error" role="alert">{{readError}}<q-btn flat dense no-caps :label="pt('重试','Retry')" @click="loadPeople"></q-btn></div><div v-else-if="loading" class="people-editor-state" role="status"><q-spinner size="18px"></q-spinner>{{pt('正在读取人物…','Loading people…')}}</div>
      <div v-else class="people-face-person-grid" role="group" :aria-label="pt('选择目标人物','Choose target person')"><button v-for="person in choices" :key="person.id" type="button" class="people-face-person" :data-person-id="person.id" :class="{'is-selected':target===person.id}" :aria-label="pt('选择人物：','Choose person: ')+personLabel(person)" :aria-pressed="target===person.id" :disabled="busy" @click="choose(person)"><span class="people-portrait"><q-icon name="person_outline" size="32px"></q-icon><img v-if="person.cover_url" :src="person.cover_url+'?v='+person.version" alt="" loading="lazy" @error="imageError"><q-icon v-if="target===person.id" class="people-person-check" name="check_circle" size="20px"></q-icon></span><span class="people-person-name" :title="personLabel(person)">{{personLabel(person)}}</span><small v-if="person.id===suggested?.id">{{pt('建议归属','Suggested identity')}}</small></button>
        <p v-if="!choices.length" class="people-editor-state" role="status">{{query?pt('没有匹配的人物','No matching people'):pt('暂无人物，可新建人物','No people yet. Create a new person.')}}</p></div>
    </template>
    <q-input v-else-if="action==='new'" v-model="newName" filled dense maxlength="80" :disable="busy" :label="pt('新人物姓名（可以稍后命名）','New name (optional)')"></q-input>
    <p v-else class="people-editor-state">{{outcome}}</p>
    <p v-if="error" class="people-error" role="alert">{{error}}</p>
    <div class="people-face-editor-footer"><div class="people-editor-other-actions" role="group" :aria-label="pt('其他纠正方式','Other corrections')"><q-btn flat dense no-caps icon="remove_circle_outline" :class="{'is-active':action==='unassigned'}" :aria-pressed="action==='unassigned'" :disable="busy" :label="pt('暂不归组','Leave unassigned')" @click="action='unassigned'"></q-btn><q-btn flat dense no-caps icon="person_off" :class="{'is-active':action==='not_face'}" :aria-pressed="action==='not_face'" :disable="busy" :label="pt('不是人脸','Not a face')" @click="action='not_face'"></q-btn><q-btn flat dense no-caps icon="verified_user" :class="{'is-active':action==='confirm'}" :aria-pressed="action==='confirm'" :disable="busy||!snapshot.every(f=>f.person_id&&f.assignment!=='not_face')" :label="pt('确认当前归属','Confirm current identity')" @click="action='confirm'"></q-btn></div>
      <span class="people-editor-outcome" aria-live="polite" :title="outcome">{{outcome}}</span><div class="people-editor-submit"><q-btn flat dense no-caps :disable="busy" :label="pt('取消','Cancel')" @click="cancel"></q-btn><q-btn color="primary" unelevated dense no-caps :loading="busy" :disable="!canConfirm" :label="pt('确认纠正','Confirm correction')" @click="save"></q-btn></div></div>
  </section>`
};

const PeoplePage={
  components:{'people-onboarding':PeopleOnboarding,'people-face-editor':PeopleFaceEditor},
  data(){const saved=this.$root.peopleReviewState;return {query:'',sort:'recent',layout:'grid',people:[],reviews:[],loading:false,error:'',reviewKind:saved?.kind||'merge',reviewPage:saved?.page||1,reviewPagination:{page:1,pages:1,total:0},editingReviewId:null,editorBusy:false,decidingReview:null};},
  computed:{root(){return this.$root;},view(){return this.root.peopleView;},status(){return this.root.peopleStatus;},jobs(){return this.status?.jobs||{};},
    reviewBusy(){return this.editorBusy||this.decidingReview!==null;},
    taskSummary(){if(this.jobs.running)return peopleText('正在本地整理人物','Organizing people locally');if(this.jobs.queued)return peopleText('任务已排队，前台操作优先','Queued; foreground work has priority');if(this.jobs.waiting)return peopleText('部分任务正在等待模型或原文件','Some tasks are waiting for a model or source');if(this.jobs.failed)return peopleText('部分任务失败，可以重试','Some tasks failed; retry is available');if(this.jobs.paused)return peopleText('人物整理已暂停','People organization is paused');return peopleText('本地处理 · 可暂停与续跑','Local processing · pause and resume');}},
  watch:{view(){this.editingReviewId=null;this.query='';if(this.reviewPage!==1)this.reviewPage=1;else this.load();},query(){clearTimeout(this._searchTimer);this._searchTimer=setTimeout(()=>this.load(),180);},sort(){this.load();},reviewKind(){this.root.peopleReviewState={kind:this.reviewKind,page:1};this.editingReviewId=null;if(this.reviewPage!==1)this.reviewPage=1;else this.load();},reviewPage(){this.root.peopleReviewState={kind:this.reviewKind,page:this.reviewPage};this.editingReviewId=null;this.load();},'root.peopleRevision'(){this.load();}},
  created(){this.load();this.root.reloadPeopleStatus();this.root.reloadPeopleCatalog();},
  beforeUnmount(){this.disposed=true;this._read=(this._read||0)+1;clearTimeout(this._searchTimer);},
  methods:{pt:peopleText,imageError:peopleImageError,
    async load(){const token=this._read=(this._read||0)+1;this.loading=true;this.error='';
      try{const result=await PeopleAPI(this.view==='review'?'/reviews?'+new URLSearchParams({kind:this.reviewKind,page:this.reviewPage,per_page:40}):'/persons?'+new URLSearchParams({view:this.view,q:this.query,sort:this.sort}));
        if(this.disposed||token!==this._read)return;if(this.view==='review'){this.reviews=result.data;if(this.editingReviewId!=null&&!this.reviews.some(r=>r.id===this.editingReviewId)){this.editingReviewId=null;this.focusReview();}this.reviewPagination=result.pagination||{page:1,pages:1,total:result.data.length};if(this.reviewPagination.pages>0&&this.reviewPage>this.reviewPagination.pages)this.reviewPage=this.reviewPagination.pages;}else this.people=result.data;}
      catch(e){if(!this.disposed&&token===this._read)this.error=e.message;}finally{if(!this.disposed&&token===this._read)this.loading=false;}},
    currentPerson(review){const id=review.face?.person_id;if(!id)return null;return [review.left,review.right,...this.root.peopleCatalog].find(p=>p?.id===id)||{id,display_name:this.pt('人物 ','Person ')+String(id).padStart(2,'0')};},
    identityLabel(person){return this.root.peopleOptions.find(p=>p.value===person.id)?.label||person.display_name;},
    suggestedPerson(review){return review.right&&review.right.id!==review.face?.person_id?review.right:null;},
    reviewReason(reason){return {quality:this.pt('画质不足','Insufficient quality'),track_conflict:this.pt('出镜待核对','Face sequence needs review'),track_match_uncertain:this.pt('归属待核对','Identity needs review')}[reason]||'';},
    openSource(face){if(face.frame_time!==null&&face.frame_time!==undefined)this.root.peopleOpenAt(face.media_id,face.frame_time);else this.root.openDetail(face.media_id);},
    focusReview(id){this.$nextTick(()=>{if(this.disposed||!this.$el?.querySelector)return;const row=id?this.$el.querySelector('[data-review-id="'+id+'"]'):this.$el;const button=row?.querySelector('.people-review-correct')||this.$el.querySelector('.people-review-tabs .q-tab--active');button?.focus();});},
    toggleReview(review){if(this.reviewBusy)return;if(this.editingReviewId===review.id)this.closeReview();else this.editingReviewId=review.id;},
    resizeReviewMenu(id){const value=this.$refs['review-menu-'+id];const menu=Array.isArray(value)?value[0]:value;menu?.updatePosition();},
    closeReview(id=this.editingReviewId){if(this.reviewBusy||id!==this.editingReviewId)return;this.editingReviewId=null;this.focusReview(id);},
    async savedReview(){this.editingReviewId=null;await this.load();this.focusReview();},
    async decide(review,decision){if(this.reviewBusy)return;this.decidingReview=review.id;this.error='';try{const r=await PeopleAPI('/reviews/'+review.id,'POST',{decision});await this.root.peopleChanged(r);await this.load();}catch(e){if(!this.disposed)this.error=e.message;}finally{if(!this.disposed)this.decidingReview=null;}},
    async preview(review){this.root.openPeopleDialog('merge',{source_ids:[review.right.id],target_id:review.left.id});},
  },
  template:`<div class="people-workspace">
    <div class="people-toolbar"><q-input v-model="query" class="people-search" dense filled debounce="0" :placeholder="pt('搜索人物姓名','Search people')" :aria-label="pt('搜索人物姓名','Search people')" v-if="view!=='review'"><template #prepend><q-icon name="search" size="18px"></q-icon></template></q-input><q-tabs v-else v-model="reviewKind" dense align="left" class="people-review-tabs"><q-tab name="merge" :disable="reviewBusy" :label="pt('可能是同一人','Possible same person')"></q-tab><q-tab name="face" :disable="reviewBusy" :label="pt('待确认人脸','Faces to review')"></q-tab></q-tabs><div class="people-toolbar-actions">
      <q-select v-if="view!=='review'" v-model="sort" dense filled options-dense emit-value map-options :options="[{label:pt('最近出现','Recent'),value:'recent'},{label:pt('姓名顺序','Name'),value:'name'},{label:pt('素材数量','Media count'),value:'count'}]" :aria-label="pt('人物排序','People sort')" class="people-sort"></q-select>
      <div v-if="view!=='review'" v-sliding-segments="layout" class="people-view-switcher" role="group" :aria-label="pt('人物显示模式','People view mode')"><q-btn v-for="item in [{value:'grid',label:pt('网格视图','Grid view')},{value:'list',label:pt('列表视图','List view')}]" :key="item.value" flat dense :aria-label="item.label" :aria-pressed="layout===item.value" :class="{'is-active':layout===item.value}" @click="layout=item.value"><gallery-view-icon :mode="item.value"></gallery-view-icon><q-tooltip>{{item.label}}</q-tooltip></q-btn></div>
      <q-btn flat dense no-caps icon="person_add_alt" :label="pt('新增人物','New person')" @click="root.openPeopleDialog('person')"></q-btn>
      <q-btn v-if="view==='review'" class="people-action-button" outline dense no-caps icon="refresh" :disable="reviewBusy||!status?.review_count" :label="pt('全量重新扫描','Rescan all pending media')" @click="editingReviewId=null;root.openPeopleDialog('scan',{scope:'review'})"></q-btn>
      <q-btn class="people-action-button" color="primary" unelevated dense no-caps icon="auto_awesome" :label="pt('人脸识别','Face recognition')" @click="root.openPeopleDialog('scan')"></q-btn></div></div>
    <div class="people-scroll">
      <div v-if="error||root.peopleError" class="people-error" role="alert">{{error||root.peopleError}}<q-btn flat dense :label="pt('重试','Retry')" @click="load();root.reloadPeopleStatus()"></q-btn></div>
      <q-linear-progress v-if="loading" indeterminate></q-linear-progress>
      <template v-if="view!=='review'">
        <div v-if="people.length" class="people-grid" :class="{'is-list':layout==='list'}"><button v-for="person in people" :key="person.id" class="people-card" @click="root.openPeoplePerson(person.id)"><div class="people-portrait"><q-icon name="person_outline" size="62px"></q-icon><img v-if="person.cover_url" :src="person.cover_url+'?v='+person.version" alt="" loading="lazy" @error="imageError"></div><span class="people-card-name"><span class="people-card-label" :title="person.display_name">{{person.display_name}}</span><q-icon v-if="person.manual_count" name="check" size="13px"></q-icon></span><small>{{person.photo_count}} {{pt('张照片','photos')}} · {{person.video_count}} {{pt('个视频','videos')}}</small></button></div>
        <template v-else-if="!loading&&!error&&!root.peopleError">
          <people-onboarding v-if="!query&&view!=='hidden'&&!status?.counts?.all&&!status?.counts?.hidden" @scan="root.openPeopleDialog('scan')" @settings="root.openRecognitionSettings('people')"></people-onboarding>
          <div v-else class="people-empty"><q-icon name="people_outline" size="42px"></q-icon><h3>{{query?pt('没有匹配的人物','No matching people'):view==='hidden'?pt('没有隐藏的人物','No hidden people'):view==='unnamed'?pt('没有待命名的人物','No unnamed people'):pt('还没有可展示的人物','No people yet')}}</h3><p>{{query?pt('试试其他姓名，或清空搜索。','Try another name or clear the search.'):pt('已识别的人物会按当前条件显示在这里。','Recognized people appear here when they match this view.')}}</p></div>
        </template>
      </template>
      <template v-else><div class="people-review-grid" :class="{'is-face-review':reviewKind==='face'}">
        <div class="people-review-card" :class="{'people-face-review':review.kind==='face'}" :data-review-id="review.id" v-for="review in reviews" :key="review.id"><template v-if="review.kind==='merge'"><div class="people-compare"><button v-for="person in [review.left,review.right].filter(Boolean)" :key="person.id" @click="root.openPeoplePerson(person.id)"><div class="people-portrait"><q-icon name="person_outline" size="40px"></q-icon><img v-if="person.cover_url" :src="person.cover_url+'?v='+person.version" alt="" @error="imageError"></div><strong>{{person.display_name}}</strong><small>{{person.media_count}} {{pt('个素材','media items')}}</small></button></div>
          <p>{{pt('请结合原图和不同角度确认，相似分数不是身份正确的概率。','Review original media and multiple views. Similarity is not an identity probability.')}}</p>
          <div class="people-actions"><q-btn dense no-caps color="primary" :disable="reviewBusy" :label="pt('合并预览','Preview merge')" @click="preview(review)"></q-btn><q-btn flat dense no-caps :disable="reviewBusy" :label="pt('不同的人','Different people')" @click="decide(review,'different')"></q-btn><q-btn flat dense no-caps :disable="reviewBusy" :label="pt('暂时忽略','Dismiss')" @click="decide(review,'dismiss')"></q-btn></div></template>
          <template v-else><div class="people-review-face-summary"><button v-if="review.face" type="button" class="people-review-source" :disabled="reviewBusy" :aria-label="pt('查看原图中的这张脸','View this face in the original')" :aria-describedby="reviewReason(review.payload.reason)?'people-review-reason-'+review.id:undefined" @click="openSource(review.face)"><img :src="review.face.crop_url+'?v='+review.face.version" alt="" @error="imageError"><span>{{pt('待确认的人脸','Face to review')}}<small v-if="reviewReason(review.payload.reason)" :id="'people-review-reason-'+review.id">{{reviewReason(review.payload.reason)}}</small></span></button>
            <button v-if="currentPerson(review)" type="button" class="people-review-identity people-review-current" :disabled="reviewBusy" :aria-label="pt('查看当前归属：','View current identity: ')+identityLabel(currentPerson(review))" @click="root.openPeoplePerson(currentPerson(review).id)"><small>{{pt('当前归属','Current identity')}}</small><span class="people-portrait"><q-icon name="person_outline" size="28px"></q-icon><img v-if="currentPerson(review).cover_url" :src="currentPerson(review).cover_url+'?v='+currentPerson(review).version" alt="" @error="imageError"></span><strong :title="identityLabel(currentPerson(review))">{{identityLabel(currentPerson(review))}}</strong></button>
            <div v-else class="people-review-identity people-review-current"><small>{{pt('当前归属','Current identity')}}</small><span class="people-portrait"><q-icon name="person_outline" size="28px"></q-icon></span><strong>{{pt('尚未归组','Unassigned')}}</strong></div>
            <q-icon class="people-review-arrow" name="arrow_forward" size="18px"></q-icon>
            <button v-if="suggestedPerson(review)" type="button" class="people-review-identity people-review-suggested" :disabled="reviewBusy" :aria-label="pt('查看建议归属：','View suggested identity: ')+identityLabel(suggestedPerson(review))" @click="root.openPeoplePerson(suggestedPerson(review).id)"><small>{{pt('建议归属','Suggested identity')}}</small><span class="people-portrait"><q-icon name="person_outline" size="28px"></q-icon><img v-if="suggestedPerson(review).cover_url" :src="suggestedPerson(review).cover_url+'?v='+suggestedPerson(review).version" alt="" @error="imageError"></span><strong :title="identityLabel(suggestedPerson(review))">{{identityLabel(suggestedPerson(review))}}</strong></button>
            <div v-else class="people-review-identity people-review-suggested"><small>{{pt('建议归属','Suggested identity')}}</small><span class="people-portrait"><q-icon name="person_search" size="28px"></q-icon></span><strong>{{pt('暂无建议','No suggestion')}}</strong></div>
            <q-btn class="people-review-open-original" flat dense no-caps icon="open_in_new" :disable="reviewBusy||!review.face" :label="pt('查看原图','View original')" @click="openSource(review.face)"></q-btn>
            <div class="people-actions people-review-row-actions"><q-btn v-if="review.face?.person_id" flat dense no-caps :disable="reviewBusy" :label="pt('原归属正确','Original identity is correct')" @click="decide(review,'confirm')"></q-btn><q-btn v-else flat dense no-caps :disable="reviewBusy" :label="pt('暂时忽略','Dismiss')" @click="decide(review,'dismiss')"></q-btn><q-btn :id="'people-review-correct-'+review.id" class="people-review-correct" color="primary" unelevated dense no-caps :disable="reviewBusy||!review.face" :aria-expanded="editingReviewId===review.id" :aria-controls="'people-review-editor-'+review.id" :icon="editingReviewId===review.id?'expand_less':'expand_more'" :label="review.face?.person_id?pt('纠正','Correct'):pt('指定人物','Assign person')" @click="toggleReview(review)"></q-btn></div>
          </div><q-menu :ref="'review-menu-'+review.id" :id="'people-review-editor-'+review.id" class="people-review-picker" :model-value="editingReviewId===review.id" :target="'#people-review-correct-'+review.id" no-parent-event :persistent="reviewBusy" anchor="bottom right" self="top right" :offset="[0,8]" role="dialog" :aria-label="pt('选择人物','Choose person')" @update:model-value="value=>{if(!value)closeReview(review.id)}"><q-resize-observer :debounce="0" @resize="resizeReviewMenu(review.id)"></q-resize-observer><people-face-editor v-if="editingReviewId===review.id" :faces="[review.face]" :suggested="suggestedPerson(review)" :show-faces="false" @busy="editorBusy=$event" @cancel="closeReview()" @saved="savedReview"></people-face-editor></q-menu></template></div>
        </div><div v-if="!reviews.length&&!loading&&!error&&!root.peopleError" class="people-empty"><q-icon name="task_alt" size="38px"></q-icon><h3>{{pt('目前没有待核对项目','Nothing to review')}}</h3><p>{{pt('不确定的归组会出现在这里。','Uncertain matches will appear here.')}}</p></div></template>
    </div><footer class="people-footer"><span class="people-count">{{view==='review'?reviewPagination.total:people.length}} {{view==='review'?pt('项待核对','to review'):pt('位人物','people')}}</span><div v-if="view==='review'&&reviewPagination.pages>1" class="people-review-pagination"><q-pagination v-model="reviewPage" :max="reviewPagination.pages" :max-pages="6" :disable="loading||reviewBusy" direction-links boundary-links :aria-label="pt('核对项目分页','Review pages')"></q-pagination></div><span v-if="query" class="people-query" :title="query">{{pt('姓名：','Name: ')}}{{query}}</span><div class="people-task-strip"><span class="people-save-hint" tabindex="0" role="img" :aria-label="pt('姓名和人工纠正随资料库保存','Names and corrections are saved with the library')"><q-icon name="privacy_tip" size="13px"></q-icon><q-tooltip>{{pt('姓名和人工纠正随资料库保存','Names and corrections are saved with the library')}}</q-tooltip></span><span :title="taskSummary">{{taskSummary}}</span></div></footer>
  </div>`
};

const PeopleGalleryTools={
  props:['gallery'],data:()=>({loadingFaces:false}),computed:{root(){return this.$root;},person(){return this.root.peopleCurrent;}},beforeUnmount(){this.disposed=true;},methods:{pt:peopleText,
    async organize(){const ids=[...this.gallery.selArr];this.root.openPeopleDialog('scan',{media_ids:ids});},
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
  components:{'people-face-editor':PeopleFaceEditor},
  props:['request'],emits:['close'],
  data:()=>({busy:false,error:'',person:null,name:'',allowHomonym:false,target:null,plan:null,
    scope:'selected',folder:'',folders:[],existing:'skip',rescanLoading:false,rescanSummary:null,sourceIds:[],filterPersonIds:[],excludePersonIds:[],personMode:'all',tagIds:[],peopleSearch:''}),
  computed:{root(){return this.$root;},kind(){return this.request.kind;},duplicates(){return this.name.trim()&&this.root.peopleCatalog.some(p=>p.id!==this.person?.id&&p.name===this.name.trim());},
    scanFolderSelection(){
      const selected=new Set(this.folders),states=new Map(),nodes=new Map();
      const visit=node=>{const children=(node.children||[]).map(visit),self=selected.has(node.path);
        const state=self&&children.every(value=>value===true)?true:self||children.some(value=>value!==false)?null:false;
        states.set(node.path,state);nodes.set(node.path,node);return state;};
      this.root.folderTree.forEach(visit);return {states,nodes};
    },
    scanFolderScope(){
      const folders=[],directFolders=[],selected=new Set(this.folders),states=this.scanFolderSelection.states;
      const visit=node=>{const state=states.get(node.path);if(state===true)folders.push(node.path);
        else if(state===null){if(selected.has(node.path))directFolders.push(node.path);(node.children||[]).forEach(visit);}};
      this.root.folderTree.forEach(visit);return {folders,directFolders,count:folders.length+directFolders.length};
    },
    faces(){return this.request.faces||[];},selectedIds(){return this.request.media_ids||[];},filteredPeopleOptions(){return this.root.peopleOptions.filter(p=>p.label.toLocaleLowerCase().includes(this.peopleSearch));},title(){return {person:peopleText('管理人物','Manage person'),faces:peopleText('纠正人脸归属','Correct face identity'),association:peopleText('人物与素材关联','Person association'),merge:peopleText('合并人物预览','Preview person merge'),scan:this.scope==='review'?peopleText('全量重新扫描','Rescan all pending media'):peopleText('开始人脸识别','Start face recognition'),cover:peopleText('选择人物封面','Choose person cover'),filters:peopleText('人物组合筛选','Combine people filters')}[this.kind];}},
  watch:{'root.folderTree'(){if(this.kind==='scan'&&!this._scanFolderEdited)this.seedScanFolders();}},
  created(){this.init();},beforeUnmount(){this.disposed=true;this._read=(this._read||0)+1;},
  methods:{pt:peopleText,
    filterPeople(value,update){update(()=>{this.peopleSearch=value.toLocaleLowerCase();});},
    async init(){const token=this._read=(this._read||0)+1;this.target=this.request.target_id||this.request.person_id||null;this.sourceIds=this.request.source_ids||[];
      if(this.kind==='person'||this.kind==='cover'){this.person=this.request.person||null;this.name=this.person?.name||'';}
      if(this.kind==='scan'){this.scope=this.request.scope==='review'?'review':this.selectedIds.length?'selected':this.root.selectedFolder?'folders':'all';this.existing=this.scope==='review'?'rescan':'skip';this.seedScanFolders();await this.root.reloadPeopleStatus();if(this.disposed||token!==this._read)return;if(this.scope==='review')await this.loadReviewScan();}
      if(this.kind==='merge')await this.preview();
      if(this.kind==='filters'){this.filterPersonIds=[...(this.root.peopleQuery.person_ids||[])];this.excludePersonIds=[...(this.root.peopleQuery.exclude_person_ids||[])];this.personMode=this.root.peopleQuery.person_mode||'all';this.folder=this.root.selectedFolder||'';this.tagIds=[...(this.root.taxonomyQuery.tag_ids||[])];}
    },
    close(){if(!this.busy)this.$emit('close');},
    async loadReviewScan(){const token=this._read=(this._read||0)+1;this.rescanLoading=true;this.rescanSummary=null;this.error='';
      try{const result=await PeopleAPI('/reviews/rescan');if(!this.disposed&&token===this._read)this.rescanSummary=result;}
      catch(e){if(!this.disposed&&token===this._read)this.error=e.message;}
      finally{if(!this.disposed&&token===this._read)this.rescanLoading=false;}
    },
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
    associate(){return this.mutate('/media/decisions','POST',{media_ids:this.selectedIds,person_id:this.target,decision:this.request.decision||'include'});},
    scanFolderPaths(path){path=path.replace(/\/+$/,'')||'/';const prefix=path==='/'?'/':path+'/';const paths=[...this.scanFolderSelection.nodes.keys()].filter(p=>p===path||p.startsWith(prefix));return paths.length?paths:[path];},
    seedScanFolders(){this.folders=this.root.selectedFolder?this.scanFolderPaths(this.root.selectedFolder):[];},
    toggleScanFolder(path,checked){
      this._scanFolderEdited=true;const selected=new Set(this.folders);
      for(const value of this.scanFolderPaths(path))if(checked)selected.add(value);else selected.delete(value);
      this.folders=[...selected];
    },
    async startRecognition(){if(this.busy||this.scope==='review'&&(this.rescanLoading||!this.rescanSummary?.total)||this.scope==='folders'&&!this.scanFolderScope.count||this.scope==='selected'&&!this.selectedIds.length)return;
      if(this.scope==='folders'&&this.scanFolderScope.directFolders.length&&!this.root.peopleStatus?.supports_direct_folders){this.error=this.pt('文件夹选择界面与后台版本不一致，请重启应用后再试。','Folder selection needs the updated backend. Restart the app and try again.');return;}
      this.busy=true;this.error='';
      try{const body={scope:this.scope,existing:this.existing};if(this.scope==='selected')body.media_ids=this.selectedIds;if(this.scope==='folders'){body.folders=this.scanFolderScope.folders;if(this.scanFolderScope.directFolders.length)body.direct_folders=this.scanFolderScope.directFolders;}if(this.scope==='all')body.confirm_all=true;
        const result=await PeopleAPI('/jobs','POST',body);this.root.peopleControlError='';await this.root.reloadPeopleStatus();Quasar.Notify.create({message:this.pt('已排队 ','Queued ')+result.queued+this.pt(' 个，跳过 ','; skipped ')+result.skipped});if(!this.disposed)this.$emit('close');}
      catch(e){if(!this.disposed)this.error=e.message;}finally{if(!this.disposed)this.busy=false;}},
    openSettings(){this.close();this.root.openRecognitionSettings('people');},
    mergeChoice(){this.root.openPeopleDialog('merge',{target_id:this.person.id});},
    cover(face){return this.mutate('/persons/'+this.person.id,'PATCH',{version:this.person.version,cover_face_id:face.id});},
    applyFilters(){if(!this.filterPersonIds.includes(this.root.peopleSelected)){this.error=this.pt('请保留当前人物作为筛选条件；其他人物可以追加。','Keep the current person in the filter; additional people can be included.');return;}this.root.peopleQuery={person_ids:[...this.filterPersonIds],exclude_person_ids:[...this.excludePersonIds],person_mode:this.personMode};this.root.selectedFolder=this.folder.trim()||null;this.root.taxonomyQuery={...this.root.taxonomyQuery,tag_ids:[...this.tagIds]};this.root.$refs.gallery?.load();this.close();},
  },
  template:`<q-dialog :model-value="true" :persistent="busy" :aria-label="title" @hide="close"><q-card class="people-dialog dialog-card" :class="{'people-scan-dialog':kind==='scan','people-correction-dialog':kind==='faces'}"><q-card-section class="people-dialog-heading"><h2>{{title}}</h2><q-btn flat round dense icon="close" :disable="busy" :aria-label="pt('关闭','Close')" @click="close"></q-btn></q-card-section><q-card-section>
    <p v-if="error" class="people-error" role="alert">{{error}}</p>
    <template v-if="kind==='person'"><q-input v-model="name" outlined dense maxlength="80" :label="pt('人物姓名','Person name')" @update:model-value="allowHomonym=false"></q-input><p class="people-hint">{{pt('姓名与人脸归属独立保存；命名不会确认整组素材。','Names and face membership are saved independently; naming does not confirm every member.')}}</p><q-checkbox v-if="duplicates" v-model="allowHomonym" :label="pt('保留两个同名人物，分别管理','Keep two separate people with the same name')"></q-checkbox>
      <div class="people-actions" v-if="person"><q-btn flat dense no-caps :label="person.hidden?pt('取消隐藏','Unhide'):pt('隐藏人物','Hide person')" :disable="busy" @click="hide"></q-btn><q-btn flat dense no-caps :label="pt('与其他人物合并','Merge with another person')" @click="mergeChoice"></q-btn><q-btn flat dense no-caps :label="pt('从图集选择人脸作为封面','Choose a face as cover')" @click="root.openPeopleDialog('cover',{person})"></q-btn></div></template>
    <people-face-editor v-else-if="kind==='faces'" :faces="faces" @busy="busy=$event" @cancel="close" @saved="close"></people-face-editor>
    <template v-else-if="kind==='association'"><p>{{selectedIds.length}} {{pt('个素材','media items')}} · {{request.decision==='exclude'?pt('从此人物相册移除；不会删除原文件。','Remove from this person; source files remain intact.'):pt('手动加入人物相册，适用于背影或遮挡照，不生成虚假人脸特征。','Manually include back-view or obscured photos without fabricating face features.')}}</p><q-select v-model="target" :options="filteredPeopleOptions" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" emit-value map-options outlined dense :label="pt('人物','Person')"></q-select><p v-if="!root.peopleOptions.length" class="people-hint">{{pt('先从人物总览新增一个人物，再关联素材。','Create a person in the overview, then associate media.')}}</p></template>
    <template v-else-if="kind==='merge'"><q-select v-model="target" :options="filteredPeopleOptions" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" emit-value map-options outlined dense :label="pt('保留的人物','Keep this person')" @update:model-value="plan=null"></q-select><q-select v-model="sourceIds" :options="filteredPeopleOptions.filter(p=>p.value!==target)" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" multiple emit-value map-options outlined dense :label="pt('合并进来的人物','People to merge in')" @update:model-value="plan=null"></q-select><q-btn class="q-mt-sm" outline dense no-caps :disable="busy||!target||!sourceIds.length" :label="pt('计算合并预览','Calculate merge preview')" @click="preview"></q-btn><div v-if="plan" class="people-merge-preview"><strong>{{plan.target.display_name}}</strong><p>{{pt('合并后按素材去重','Deduplicated media after merge')}}：{{plan.media_count}}</p><p class="people-hint">{{pt('保留目标人物姓名与封面；本次变更可以撤销。','Keeps the target name and cover. This change can be undone.')}}</p><p v-if="plan.conflicts.length" class="people-error">{{pt('存在人工决定冲突，请先纠正归属再重新预览。','Manual decisions conflict. Correct membership and preview again.')}}</p></div></template>
    <template v-else-if="kind==='scan'">
      <div class="people-scan-model"><q-icon :name="root.peopleStatus?.model?.ready?'check_circle':'tune'" size="18px"></q-icon><span>{{root.peopleStatus?.model?.ready?(root.peopleStatus.settings.profile==='custom'?pt('自定义组合','Custom stages'):root.peopleStatus.settings.profile.replace('_',' ').toUpperCase()):pt('尚未配置人脸模型','Face models not configured')}}</span><q-btn flat dense no-caps icon="settings" :label="pt('人脸识别设置','Face recognition settings')" @click="openSettings"></q-btn><q-tooltip v-if="root.peopleStatus?.model?.error">{{root.peopleStatus.model.error}}</q-tooltip></div>
      <template v-if="scope==='review'">
        <div class="people-rescan-summary" role="status" aria-live="polite" :aria-busy="rescanLoading"><q-spinner v-if="rescanLoading" size="24px"></q-spinner><q-icon v-else name="photo_library" size="28px"></q-icon><div><strong>{{rescanLoading?pt('正在统计…','Counting…'):rescanSummary?rescanSummary.total:pt('未能读取','Could not load')}}</strong><span>{{pt('全部待核对素材 · 跨分页去重','All pending-review media · deduplicated across pages')}}</span></div><q-btn v-if="!rescanLoading&&!rescanSummary" flat dense no-caps icon="refresh" :label="pt('重试','Retry')" @click="loadReviewScan"></q-btn></div>
        <p class="people-rescan-note">{{pt('保留人工命名、合并和纠正。离线且无高清预览时等待原片。','Keeps names, merges and corrections. Waits for offline originals without a high-quality preview.')}}</p>
        <p v-if="rescanSummary?.active" class="people-rescan-note">{{rescanSummary.active}} {{pt('个素材已在识别队列中，不重复添加。','media already queued or running; no duplicates will be added.')}}</p>
      </template><template v-else>
      <q-select v-model="scope" filled dense emit-value map-options :options="[...(selectedIds.length?[{label:pt('所选素材','Selected media')+' ('+selectedIds.length+')',value:'selected'}]:[]),{label:pt('指定素材库文件夹','Library folders'),value:'folders'},{label:pt('整个素材库的照片与视频','All library photos and videos'),value:'all'}]" :label="pt('本次范围','Scope for this run')"></q-select>
      <div v-if="scope==='folders'" class="people-scan-folders"><div class="people-scan-folder-heading"><q-icon name="folder_open" size="16px"></q-icon><span>{{pt('素材库文件夹','Library folders')}}</span><q-icon name="help_outline" size="14px" tabindex="0" :aria-label="pt('勾选父目录会包含子目录，也可单独取消子目录','Selecting a parent includes subfolders; deselect any subfolder to exclude it')"><q-tooltip>{{pt('勾选父目录会包含子目录，也可单独取消子目录','Selecting a parent includes subfolders; deselect any subfolder to exclude it')}}</q-tooltip></q-icon></div><q-tree :nodes="root.folderTree" node-key="path" label-key="label" dense no-connectors default-expand-all><template v-slot:default-header="prop"><q-checkbox dense :model-value="scanFolderSelection.states.get(prop.node.path)" :label="prop.node.label" @click.stop @update:model-value="toggleScanFolder(prop.node.path,$event)"></q-checkbox></template></q-tree><p v-if="!root.folderTree.length" class="people-hint">{{pt('素材库暂无文件夹','No library folders yet')}}</p></div>
      <q-select v-model="existing" filled dense emit-value map-options :options="[{label:pt('跳过已识别素材','Skip scanned media'),value:'skip'},{label:pt('重新扫描（保留人工纠正）','Rescan (preserve corrections)'),value:'rescan'}]" :label="pt('已识别素材','Previously scanned media')"></q-select>
      </template>
    </template>
    <template v-else-if="kind==='filters'"><q-select v-model="filterPersonIds" :options="filteredPeopleOptions" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" multiple emit-value map-options use-chips outlined dense :label="pt('包含人物','Include people')"></q-select><q-select v-model="personMode" emit-value map-options outlined dense :options="[{label:pt('全部人物都出现','All selected people'),value:'all'},{label:pt('任一人物出现','Any selected person'),value:'any'}]" :label="pt('人物组合','Person matching')"></q-select><q-select v-model="excludePersonIds" :options="filteredPeopleOptions" use-input input-debounce="0" @filter="filterPeople" @popup-show="peopleSearch=''" multiple emit-value map-options use-chips outlined dense :label="pt('不包含人物','Exclude people')"></q-select><taxonomy-tag-picker v-model="tagIds" multiple :label="pt('叠加内容标签','Content tags')"></taxonomy-tag-picker><q-input v-model="folder" outlined dense clearable :label="pt('限定文件夹绝对路径（留空不限）','Folder absolute path (optional)')" @clear="folder=''"></q-input><p class="people-hint">{{pt('喜欢、媒体类型等条件继续使用原有筛选栏。','Use the existing toolbar for favorites, media types and other conditions.')}}</p></template>
    <template v-else-if="kind==='cover'"><people-cover-picker :person="request.person" @choose="cover"></people-cover-picker></template>
    <q-inner-loading :showing="busy&&kind!=='faces'"></q-inner-loading>
  </q-card-section><q-card-actions v-if="kind!=='faces'" align="right"><q-btn v-if="kind!=='scan'||scope==='review'" flat no-caps :disable="busy" :label="pt('取消','Cancel')" @click="close"></q-btn>
    <q-btn v-if="kind==='person'" color="primary" no-caps :disable="busy||!name.trim()||(duplicates&&!allowHomonym)" :label="pt('保存姓名','Save name')" @click="saveName"></q-btn>
    <q-btn v-if="kind==='association'" color="primary" no-caps :disable="busy||!target" :label="pt('确认关联变更','Confirm association')" @click="associate"></q-btn>
    <q-btn v-if="kind==='filters'" color="primary" no-caps :label="pt('应用筛选','Apply filters')" @click="applyFilters"></q-btn>
    <q-btn v-if="kind==='merge'" color="primary" no-caps :disable="busy||!plan||!!plan.conflicts.length" :label="pt('确认合并','Confirm merge')" @click="mutate('/merge/apply','POST',{plan_id:plan.plan_id})"></q-btn>
    <q-btn v-if="kind==='scan'" color="primary" no-caps :loading="busy" :disable="busy||(scope==='review'&&(rescanLoading||!rescanSummary?.total))||(scope==='folders'&&!folders.length)||(scope==='selected'&&!selectedIds.length)" :label="scope==='review'?pt('开始重新扫描','Start rescan'):pt('开始识别','Start recognition')" @click="startRecognition"></q-btn>
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
