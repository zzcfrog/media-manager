// Additional jobs share the existing Header entry; analysis and people keep their detailed adapters.
const backgroundTaskNames={
  fast_classification:['快速分类','Fast classification','auto_awesome'],
  local_refinement:['本地标签补充','Local tag refinement','auto_fix_high'],
  analysis_tags:['分析结果标签整理','Analysis tag mapping','sell'],
  relationships:['词库关系整理','Vocabulary relationships','account_tree'],
  model_download:['模型下载','Model download','downloading'],
  creative:['剪辑构思','Creative planning','movie_filter'],
  import:['导入素材','Media import','add_photo_alternate'],sync:['文件夹同步','Folder sync','sync'],
  embeddings:['相似特征补建','Similarity indexing','image_search'],thumbnails:['缩略图补建','Thumbnail rebuilding','photo_library'],
  metadata_write:['写入 XMP','Writing XMP','edit_note'],file_time:['文件时间调整','File time adjustment','schedule'],
  duplicates:['查找重复','Duplicate scan','collections'],export:['导出工程','Project export','ios_share'],
  model_migration:['模型目录迁移','Model directory migration','drive_file_move']
};
const backgroundStateName=state=>({running:taxText('进行中','Running'),queued:taxText('排队中','Queued'),paused:taxText('已暂停','Paused'),waiting:taxText('等待模型或原文件','Waiting for model or source'),failed:taxText('失败，可重试','Failed; retry available')}[state]||state);
const BackgroundTasksMixin={
  data:()=>({serverBackgroundTasks:[],backgroundTasksError:'',backgroundControlError:'',backgroundControlBusy:'',backgroundSupportedKinds:[]}),
  computed:{
    backgroundRows(){
      const rows=[...this.serverBackgroundTasks];
      if(this.modelDirectory?.progress&&this.settingsSaving)rows.push({id:'model_migration',kind:'model_migration',count:1,counts:{running:1},progress:['preparing','activating'].includes(this.modelDirectory.progress.phase)?null:this.modelDirectoryMigrationProgress});
      return rows;
    },
    auxiliaryPendingCount(){return this.backgroundRows.reduce((n,row)=>n+row.count,0);},
    backgroundRunning(){return this.bgTasks.some(t=>t.status==='running')||!!(this.peopleStatus?.jobs?.running||this.peopleStatus?.jobs?.queued)||this.backgroundRows.some(row=>row.counts.running||row.counts.queued&&!row.foreground_wait);}
  },
  mounted(){this._backgroundDisposed=false;this.pollBackgroundTasks();this._backgroundTimer=setInterval(()=>this.pollBackgroundTasks(),3000);},
  beforeUnmount(){this._backgroundDisposed=true;clearInterval(this._backgroundTimer);},
  methods:{
    mergeBackgroundAnalysis(tasks){
      for(const task of tasks){
        if(this.bgTasks.some(row=>row.id===task.id))continue;
        this.bgTasks.push({id:task.id,fileName:task.file_name||'',mediaType:task.media_type||'',status:'running',percent:0,
          stageLabel:task.id==='__preload__'?t('g.bg_model_loading'):t('g.bg_running'),startTime:Date.now()});
      }
    },
    async pollBackgroundTasks(){
      if(this._backgroundPolling||this._backgroundDisposed)return;
      this._backgroundPolling=true;
      try{
        const [snapshot,analysis]=await Promise.allSettled([API._fetch('/api/background-tasks'),API.getProgress()]);
        if(this._backgroundDisposed)return;
        if(snapshot.status==='fulfilled'){this.serverBackgroundTasks=snapshot.value.data;this.backgroundSupportedKinds=snapshot.value.supported_kinds;this.backgroundTasksError='';}
        else this.backgroundTasksError=taxText('后台任务状态读取失败','Could not load background tasks');
        if(analysis.status==='fulfilled')this.mergeBackgroundAnalysis(analysis.value);
      }finally{this._backgroundPolling=false;}
    },
    refreshBackgroundTasks(){this.reloadPeopleStatus();return this.pollBackgroundTasks();},
    async controlBackgroundTasks(task,action){
      if(this.backgroundControlBusy)return;
      this.backgroundControlBusy=task.id;this.backgroundControlError='';
      try{await API._fetch('/api/background-tasks/control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:task.kind,action})});await this.pollBackgroundTasks();}
      catch(error){this.backgroundControlError=error.message;}
      finally{this.backgroundControlBusy='';}
    }
  }
};
const BackgroundTaskGroups={
  computed:{root(){return this.$root;}},
  methods:{tt:taxText,stateName:backgroundStateName,
    taskName(task){const names=backgroundTaskNames[task.kind];let name=names?taxText(names[0],names[1]):task.kind;
      if(task.kind==='model_download')name+=' · '+({people:taxText('人脸模型','Face models'),classification:'SigLIP 2',local:taxText('本地大模型','Local VLM')}[task.source]||'');return name;},
    taskIcon(task){return backgroundTaskNames[task.kind]?.[2]||'pending_actions';},
    details(task){if(task.kind==='import')this.root.showImport=true;else if(task.kind==='sync')this.root.showSyncModal=true;else if(task.kind==='model_download')this.root.openRecognitionSettings({people:'people',classification:'classification',local:'image'}[task.source]);}
  },
  template:`<div v-if="root.backgroundRows.length||root.backgroundTasksError||root.backgroundControlError" class="background-task-groups">
    <div v-if="root.backgroundTasksError||root.backgroundControlError" class="background-task-error" role="alert"><span>{{root.backgroundControlError||root.backgroundTasksError}}</span><q-btn flat dense icon="refresh" :aria-label="tt('重试读取后台任务','Retry loading background tasks')" @click="root.refreshBackgroundTasks()"></q-btn></div>
    <section v-for="task in root.backgroundRows" :key="task.id" class="background-task-group" :aria-label="taskName(task)" :aria-busy="root.backgroundControlBusy===task.id">
      <div class="people-background-heading"><q-icon :name="taskIcon(task)" size="18px"></q-icon><strong>{{taskName(task)}}</strong><span>{{task.count}}</span></div>
      <div class="background-task-states"><span v-for="(count,state) in task.counts" :key="state">{{stateName(state)}} {{count}}</span></div>
      <div v-if="task.foreground_wait" class="background-task-note">{{tt('等待前台任务结束后自动继续','Resumes after foreground tasks finish')}}</div>
      <q-linear-progress v-if="task.counts.running" :value="task.progress??0" :indeterminate="task.progress==null" rounded class="background-task-progress" :aria-label="taskName(task)"></q-linear-progress>
      <div v-if="task.controllable" class="people-background-actions">
        <q-btn v-if="task.counts.running||task.counts.queued" flat dense no-caps icon="pause" :disable="!!root.backgroundControlBusy" :label="tt('暂停','Pause')" @click="root.controlBackgroundTasks(task,'pause')"></q-btn>
        <q-btn v-if="task.counts.paused||task.counts.waiting||task.counts.failed" flat dense no-caps icon="play_arrow" :disable="!!root.backgroundControlBusy" :label="tt('继续／重试','Resume / retry')" @click="root.controlBackgroundTasks(task,'resume')"></q-btn>
        <q-btn flat dense no-caps icon="stop" :disable="!!root.backgroundControlBusy" :label="tt('停止','Stop')" @click="root.controlBackgroundTasks(task,'cancel')"></q-btn>
      </div>
      <q-btn v-else-if="['import','sync','model_download'].includes(task.kind)" flat dense no-caps class="background-task-details" :icon="task.kind==='model_download'?'settings':'open_in_new'" :label="task.kind==='model_download'?tt('打开设置','Open settings'):tt('查看详情','View details')" @click="details(task)"></q-btn>
    </section>
  </div>`
};
