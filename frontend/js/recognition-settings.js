// Settings drafts live with the dialog, separately from processing scopes and jobs.
const RecognitionSettingsMixin = {
  data:()=>({settingsLoading:false,settingsLoaded:false,settingsSaving:false,settingsSaveError:'',
    faceModelChecks:{},faceDownload:{state:'idle'},faceDownloadCatalog:[],faceDownloadError:'',faceDownloadStarting:false,faceDownloadAppliedId:'',
    faceManagedModels:false,faceCatalogLoading:false,faceManagedDirectory:'',
    classificationModels:[],classificationDownload:{state:'idle'},classificationDownloadError:'',classificationCatalogLoading:false,classificationDownloadAppliedId:'',
    recognitionFaceModel:null,recognitionGrouping:null,recognitionSettings:{people:null,classification:null},recognitionErrors:{people:'',classification:''},
    recognitionLoading:{people:false,classification:false}}),
  watch:{showSettings(value){
    this.settingsLoaded=false;
    if(value){this.settingsLoading=true;this.settingsSaveError='';}
    else{this._settingsLoad=(this._settingsLoad||0)+1;this._recognitionSession=(this._recognitionSession||0)+1;clearTimeout(this._faceDownloadTimer);clearTimeout(this._classificationDownloadTimer);}
  }},
  beforeUnmount(){clearTimeout(this._faceDownloadTimer);clearTimeout(this._classificationDownloadTimer);this._recognitionSession=(this._recognitionSession||0)+1;},
  methods:{
    openRecognitionSettings(kind){this.settingsTab=kind;this.showSettings=true;},
    startRecognitionSettings(){
      this._recognitionSession=(this._recognitionSession||0)+1;this._recognitionBaseline={};this._recognitionReads={};this._recognitionFields={};
      this.recognitionSettings={people:null,classification:null};this.recognitionErrors={people:'',classification:''};
      this.faceModelChecks={};this.faceDownloadAppliedId='';this.faceDownloadStarting=false;
      this.faceDownloadCatalog=[];this.faceManagedModels=false;this.classificationModels=[];this.classificationDownloadAppliedId='';
      return Promise.all(['people','classification'].map(kind=>this.loadRecognitionSettings(kind)));
    },
    async loadRecognitionSettings(kind){
      const session=this._recognitionSession,token=this._recognitionReads[kind]=(this._recognitionReads[kind]||0)+1;
      const current=()=>this.showSettings&&session===this._recognitionSession&&token===this._recognitionReads[kind];
      this.recognitionLoading[kind]=true;this.recognitionErrors[kind]='';this.settingsSaveError='';
      try{
        const response=kind==='people'?await PeopleAPI('/status'):await TaxonomyAPI('/configuration');
        if(!current())return;
        const form=taxClone(kind==='people'?response.settings:response);
        if(kind==='people'&&form.model_dir){
          const names={buffalo_l:['det_10g.onnx','w600k_r50.onnx'],buffalo_m:['det_2.5g.onnx','w600k_r50.onnx'],buffalo_s:['det_500m.onnx','w600k_mbf.onnx'],buffalo_sc:['det_500m.onnx','w600k_mbf.onnx'],raccoon_l:['det_10g_wo.onnx','w600k_r50.onnx'],raccoon_s:['det_10g_wo.onnx','w600k_mbf.onnx']}[form.profile];
          if(names)for(const [i,key] of ['detector_path','recognizer_path'].entries())if(!form[key])form[key]=form.model_dir.replace(/\/$/,'')+'/'+names[i];
          if(form.profile.startsWith('raccoon_')&&!form.verifier_path)form.verifier_path=form.model_dir.replace(/\/$/,'')+'/face_verifier_mnv2.onnx';
        }
        if(kind==='people'){form.model_dir='';form.model_enabled??=true;form.video_fps??=1;form.video_resolution??='1080p';form.video_identity_samples??=4;form.similarity_threshold??=.55;form.adaptive_threshold??=true;}
        if(kind==='people'){this.recognitionFaceModel=response.model;this.recognitionGrouping=response.grouping;}
        this.recognitionSettings[kind]=taxClone(form);this._recognitionBaseline[kind]=JSON.stringify(form);
        this._recognitionFields[kind]=Object.keys(kind==='people'?response.settings:response);
      }catch(error){if(current())this.recognitionErrors[kind]=error.message;}
      finally{if(current())this.recognitionLoading[kind]=false;}
    },
    faceDraftKey(){const f=this.recognitionSettings.people;return f?JSON.stringify([f.profile,f.model_enabled,f.model_dir,f.detector_path,f.recognizer_path,f.verifier_path,f.verify_enabled,f.detector_model,f.recognizer_model,f.verifier_model]):'';},
    async probeFaceModel(stage){
      const path=this.recognitionSettings.people?.[stage+'_path'],session=this._recognitionSession;
      if(!path)return;
      if(this.faceModelChecks[stage]?.path===path&&this.faceModelChecks[stage].state==='checking')return;
      const token=Symbol();(this._faceProbes||(this._faceProbes={}))[stage]=token;
      this.faceModelChecks[stage]={path,state:'checking'};
      const current=()=>this.showSettings&&session===this._recognitionSession&&this._faceProbes[stage]===token&&this.recognitionSettings.people?.[stage+'_path']===path;
      try{const result=await PeopleAPI('/models/probe','POST',{stage,path});if(current())this.faceModelChecks[stage]={...result,path,state:'valid'};}
      catch(error){if(current())this.faceModelChecks[stage]={path,state:'error',error:error.message};}
    },
    async loadFaceDownloads(){
      const session=this._recognitionSession;
      this.faceCatalogLoading=true;
      try{const result=await PeopleAPI('/models/catalog');if(!this.showSettings||session!==this._recognitionSession)return;this.faceDownloadCatalog=result.packs;this.faceManagedModels=!!result.managed_models;this.faceManagedDirectory=result.base_directory||'';await this.pollFaceDownload(session);}
      catch(error){if(this.showSettings&&session===this._recognitionSession)this.faceDownloadError=error.message;}
      finally{if(session===this._recognitionSession)this.faceCatalogLoading=false;}
    },
    async pollFaceDownload(session=this._recognitionSession){
      clearTimeout(this._faceDownloadTimer);
      if(!this.showSettings||session!==this._recognitionSession)return;
      const read=this._faceDownloadRead=(this._faceDownloadRead||0)+1;
      const current=()=>this.showSettings&&session===this._recognitionSession&&read===this._faceDownloadRead;
      try{
        const result=await PeopleAPI('/models/download');
        if(!current())return;
        this.faceDownload=result;this.faceDownloadError='';
        const context=this._faceDownloadContext;
        if(result.state==='done'){
          const catalog=await PeopleAPI('/models/catalog');if(!current())return;this.faceDownloadCatalog=catalog.packs;
          if(context?.id===result.id&&context.session===session&&context.draft===this.faceDraftKey()&&this.faceDownloadAppliedId!==result.id)this.applyFaceDownload();
        }
        if(['downloading','validating'].includes(result.state))this._faceDownloadTimer=setTimeout(()=>this.pollFaceDownload(session),600);
      }catch(error){if(current()){this.faceDownloadError=error.message;this._faceDownloadTimer=setTimeout(()=>this.pollFaceDownload(session),1500);}}
    },
    async startFaceDownload(profile,stage=null,subdirectory=null){
      const session=this._recognitionSession,draft=this.faceDraftKey();
      clearTimeout(this._faceDownloadTimer);this._faceDownloadRead=(this._faceDownloadRead||0)+1;
      this.faceDownloadStarting=true;this.faceDownloadError='';
      try{
        const payload={profile};if(stage)payload.stage=stage;if(subdirectory!==null)payload.subdirectory=subdirectory;
        const result=await PeopleAPI('/models/download','POST',payload);
        if(!this.showSettings||session!==this._recognitionSession)return false;
        this._faceDownloadContext={session,draft,id:result.id};this.faceDownload=result;await this.pollFaceDownload(session);
        return true;
      }catch(error){if(this.showSettings&&session===this._recognitionSession)this.faceDownloadError=error.message;return false;}
      finally{if(session===this._recognitionSession)this.faceDownloadStarting=false;}
    },
    async cancelFaceDownload(){
      const session=this._recognitionSession;clearTimeout(this._faceDownloadTimer);this._faceDownloadRead=(this._faceDownloadRead||0)+1;
      try{await PeopleAPI('/models/download/cancel','POST',{id:this.faceDownload.id});if(this.showSettings&&session===this._recognitionSession)await this.pollFaceDownload(session);}
      catch(error){if(this.showSettings&&session===this._recognitionSession)this.faceDownloadError=error.message;}
    },
    applyFaceDownload(){
      if(this.faceDownload.state!=='done'||!this.recognitionSettings.people)return;
      const form=this.recognitionSettings.people,d=this.faceDownload;
      for(const stage of ['detector','recognizer','verifier']){form[stage+'_path']='';form[stage+'_model']='';}
      this.faceModelChecks={};
      const stages=['detector','recognizer','verifier'].filter(stage=>d.paths[stage+'_path']);
      for(const stage of stages){form[stage+'_path']=d.paths[stage+'_path'];if(stage+'_model' in form)form[stage+'_model']=d.managed?d.profile+':'+stage:'';}
      form.verify_enabled=d.profile.startsWith('raccoon_');
      form.profile=d.profile;form.model_enabled=true;form.model_dir='';
      this.faceDownloadAppliedId=this.faceDownload.id;
      for(const stage of stages)this.faceModelChecks[stage]={path:this.faceDownload.paths[stage+'_path'],state:'valid'};
    },
    selectFacePack(profile){
      const form=this.recognitionSettings.people;
      if(profile==='none'){form.model_enabled=false;this.faceModelChecks={};this._faceDownloadContext=null;return;}
      if(!['buffalo_l','buffalo_m','buffalo_s','buffalo_sc','raccoon_s','raccoon_l'].includes(profile))return;
      if(form.profile!==profile){
        for(const stage of ['detector','recognizer','verifier']){form[stage+'_path']='';form[stage+'_model']='';}
        form.model_dir='';this.faceModelChecks={};
      }
      form.profile=profile;form.model_enabled=true;form.verify_enabled=profile.startsWith('raccoon_');
      const pack=this.faceDownloadCatalog.find(item=>item.profile===profile);
      if(this.faceManagedModels&&pack?.installed){
        for(const stage of ['detector','recognizer','verifier']){
          if(pack.paths[stage+'_path']){form[stage+'_path']=pack.paths[stage+'_path'];form[stage+'_model']=profile+':'+stage;}
          else{form[stage+'_path']='';if(stage+'_model' in form)form[stage+'_model']='';}
        }
        form.model_dir='';this.faceModelChecks={};
      }
    },
    classificationDraftKey(){const form=this.recognitionSettings.classification;return form?JSON.stringify([form.classification_model_enabled,form.classification_model_id,form.classification_model_dir]):'';},
    async loadClassificationModels(){
      const session=this._recognitionSession;this.classificationCatalogLoading=true;
      try{const response=await TaxonomyAPI('/models/catalog');if(!this.showSettings||session!==this._recognitionSession)return;this.classificationModels=response.models;await this.pollClassificationDownload(session);}
      catch(error){if(this.showSettings&&session===this._recognitionSession)this.classificationDownloadError=error.message;}
      finally{if(session===this._recognitionSession)this.classificationCatalogLoading=false;}
    },
    async pollClassificationDownload(session=this._recognitionSession){
      clearTimeout(this._classificationDownloadTimer);const token=this._classificationDownloadRead=(this._classificationDownloadRead||0)+1;
      const current=()=>this.showSettings&&session===this._recognitionSession&&token===this._classificationDownloadRead;
      try{
        const result=await TaxonomyAPI('/models/download');if(!current())return;this.classificationDownload=result;this.classificationDownloadError='';
        if(result.state==='done'){
          const response=await TaxonomyAPI('/models/catalog');if(!current())return;this.classificationModels=response.models;
          const context=this._classificationDownloadContext;
          if(context?.session===session&&context.id===result.id&&context.draft===this.classificationDraftKey()&&this.classificationDownloadAppliedId!==result.id)this.applyClassificationDownload();
        }
        if(['downloading','validating'].includes(result.state))this._classificationDownloadTimer=setTimeout(()=>this.pollClassificationDownload(session),600);
      }catch(error){if(current()){this.classificationDownloadError=error.message;this._classificationDownloadTimer=setTimeout(()=>this.pollClassificationDownload(session),1500);}}
    },
    async startClassificationDownload(modelId){
      const session=this._recognitionSession,draft=this.classificationDraftKey();
      clearTimeout(this._classificationDownloadTimer);this._classificationDownloadRead=(this._classificationDownloadRead||0)+1;this.classificationDownloadError='';
      try{
        const result=await TaxonomyAPI('/models/download','POST',{model_id:modelId});if(!this.showSettings||session!==this._recognitionSession)return;
        this._classificationDownloadContext={session,draft,id:result.id};this.classificationDownload=result;await this.pollClassificationDownload(session);
      }catch(error){if(this.showSettings&&session===this._recognitionSession)this.classificationDownloadError=error.message;}
    },
    applyClassificationDownload(){
      const d=this.classificationDownload,form=this.recognitionSettings.classification;
      if(d.state!=='done'||!form)return;
      form.classification_model_enabled='true';form.classification_model_id=d.model_id;form.classification_model_dir=d.directory;this.classificationDownloadAppliedId=d.id;
    },
    async cancelClassificationDownload(){
      const session=this._recognitionSession;clearTimeout(this._classificationDownloadTimer);this._classificationDownloadRead=(this._classificationDownloadRead||0)+1;
      try{await TaxonomyAPI('/models/download/cancel','POST',{id:this.classificationDownload.id});if(this.showSettings&&session===this._recognitionSession)await this.pollClassificationDownload(session);}
      catch(error){if(this.showSettings&&session===this._recognitionSession)this.classificationDownloadError=error.message;}
    },
    recognitionChanges(){
      if(['people','classification'].includes(this.settingsTab)&&!this.recognitionSettings[this.settingsTab])
        throw new Error(taxText('请先成功读取当前设置','Load the current settings before saving'));
      const changes=[];
      for(const kind of ['people','classification']){
        const form=this.recognitionSettings[kind];if(!form||JSON.stringify(form)===this._recognitionBaseline[kind])continue;
        const payload=taxClone(form);
        const range=(key,min,max)=>{const n=Number(payload[key]);if(!Number.isInteger(n)||n<min||n>max)throw new Error(taxText('数值范围应为 ','Value must be between ')+min+'–'+max);return n;};
        try{
          if(kind==='people'){
            if(Object.keys(payload).some(key=>!this._recognitionFields.people.includes(key)))throw new Error(taxText('人脸设置界面与后台版本不一致，请重启应用后再保存。','The face settings UI and backend versions do not match. Restart the app before saving.'));
            payload.video_fps=range('video_fps',1,3);
            if(!['1080p','original'].includes(payload.video_resolution))throw new Error(taxText('视频人脸压缩请选择 1080p 或原片','Choose 1080p or Original for video face scaling'));
            payload.video_identity_samples=range('video_identity_samples',1,48);
            const threshold=Number(payload.similarity_threshold);
            if(payload.similarity_threshold===''||!Number.isFinite(threshold)||threshold<.45||threshold>.85)throw new Error(taxText('自动归组阈值应为 0.45～0.85','Grouping threshold must be between 0.45 and 0.85'));
            if(Math.abs(threshold*100-Math.round(threshold*100))>1e-6)throw new Error(taxText('自动归组阈值请以 0.01 为步长调整','Adjust the grouping threshold in steps of 0.01'));
            payload.similarity_threshold=threshold;
            if(!['buffalo_l','buffalo_m','buffalo_s','buffalo_sc','raccoon_s','raccoon_l','custom'].includes(payload.profile))throw new Error(taxText('请选择人脸模型组合','Choose a face model pair'));
            for(const key of ['model_dir','detector_path','recognizer_path','verifier_path'])if(payload[key]&&!/^(\/|~\/)/.test(payload[key]))throw new Error(taxText('模型路径需为绝对路径','Model paths must be absolute'));
          }else{
            delete payload.classification_budget_seconds;
            delete payload.classification_resource_limit_mb;
            payload.classification_candidate_retention_days=String(range('classification_candidate_retention_days',1,3650));
          }
        }catch(error){this.settingsTab=kind;throw error;}
        changes.push({kind,payload});
      }
      return changes;
    },
    async saveRecognitionChanges(changes,saved){
      for(const {kind,payload} of changes){
        try{
          const result=kind==='people'?await PeopleAPI('/settings','PATCH',payload):await TaxonomyAPI('/configuration','PATCH',payload);
          this.recognitionSettings[kind]=taxClone(result);this._recognitionBaseline[kind]=JSON.stringify(result);
          saved.push(kind==='people'?taxText('人脸识别','Face recognition'):taxText('智能分类','Smart categories'));
          if(kind==='people'){await this.reloadPeopleStatus();this.recognitionFaceModel=this.peopleStatus?.model;this.recognitionGrouping=this.peopleStatus?.grouping;}
        }catch(error){this.settingsTab=kind;this.recognitionErrors[kind]=error.message;throw error;}
      }
    }
  }
};

const RecognitionSettingsPanel = {
  props:['kind'],
  data:()=>({downloadRequest:null,helpVisible:false,sampleHelpVisible:false,groupingHelpVisible:false,stageGuidancePending:false,stageGuidanceMessage:''}),
  mounted(){if(this.kind==='people')this.$root.loadFaceDownloads();else this.$root.loadClassificationModels();},
  computed:{form(){return this.$root.recognitionSettings[this.kind];},error(){return this.$root.recognitionErrors[this.kind];},loading(){return this.$root.recognitionLoading[this.kind];},
    packs(){return [
      {value:'buffalo_l',label:'Buffalo L',zh:'ResNet-50 · 较大的特征模型',en:'ResNet-50 · Larger feature model'},
      {value:'buffalo_m',label:'Buffalo M',zh:'ResNet50 · 较轻的检测器，识别模型与 L 相同',en:'ResNet50 · Lighter detector; same recognizer as L'},
      {value:'buffalo_s',label:'Buffalo S',zh:'MobileFaceNet · 小型检测与识别模型',en:'MobileFaceNet · Small detector and recognizer'},
      {value:'buffalo_sc',label:'Buffalo SC',zh:'MobileFaceNet · S 的精简套装',en:'MobileFaceNet · Compact S package'},
      {value:'raccoon_l',label:'Raccoon L',zh:'ResNet50 · 支持配套人脸复核',en:'ResNet50 · Supports packaged face verification'},
      {value:'raccoon_s',label:'Raccoon S',zh:'MobileFaceNet · 轻量特征模型，默认开启复核',en:'MobileFaceNet · Compact features; verification on by default'}];},
    packOptions(){return this.packs.map(pack=>{const item=this.$root.faceDownloadCatalog.find(row=>row.profile===pack.value);return {
      ...pack,label:'InsightFace · '+pack.label,name:pack.label,profile:pack.value,group:pack.value,installed:!!item?.installed,selectable:true,
      custom:!this.$root.faceManagedModels,
      detail:['InsightFace',this.tt(pack.zh,pack.en),item?.bytes?this.$root.fmtBytes(item.bytes):''].filter(Boolean).join(' · ')};});},
    faceModelDownload(){const d=this.$root.faceDownload;return {...d,model_id:d.stage?d.profile+':'+d.stage:d.profile,group:d.profile,done_bytes:d.received||0,total_bytes:d.total||0};},
    fastModelOptions(){return this.$root.classificationModels.map(model=>({...model,value:model.id,label:'Google · '+model.label,name:model.label,installed:model.installed,detail:'Google · '+model.quant+' · '+this.$root.fmtBytes(model.bytes)}));},
    classificationModelDownload(){const d=this.$root.classificationDownload;return {...d,done_bytes:d.received||0,total_bytes:d.total||0};},
    selectedPack(){return this.packs.find(p=>p.value===this.form?.profile);},
    verifierAvailable(){return this.form?.profile?.startsWith('raccoon_')||!!this.form?.verifier_path;},
    groupingNote(){const g=this.$root.recognitionGrouping;
      if(!g||Number(this.form?.similarity_threshold)!==g.base_threshold||this.form?.adaptive_threshold!==g.enabled||this.form?.profile!==this.$root.recognitionFaceModel?.profile)return this.tt('保存后用于后续识别','Applies to future recognition after saving');
      return this.tt('当前生效 ','Effective ')+g.effective_threshold.toFixed(2);},
    groupingFeedback(){const g=this.$root.recognitionGrouping;return g?this.tt('同一人 ','Same ')+g.positive_feedback+' · '+this.tt('不同人 ','Different ')+g.negative_feedback:'';},
    packFiles(){return {buffalo_l:['det_10g.onnx','w600k_r50.onnx'],buffalo_m:['det_2.5g.onnx','w600k_r50.onnx'],buffalo_s:['det_500m.onnx','w600k_mbf.onnx'],buffalo_sc:['det_500m.onnx','w600k_mbf.onnx'],raccoon_l:['det_10g_wo.onnx','w600k_r50.onnx'],raccoon_s:['det_10g_wo.onnx','w600k_mbf.onnx']}[this.form?.profile]||[];},
    stages(){const recognizer=this.packFiles[1]==='w600k_r50.onnx'?'ArcFace · ResNet-50':this.packFiles[1]==='w600k_mbf.onnx'?'ArcFace · MobileFaceNet':'ArcFace';
      return [{key:'detector',label:this.tt('人脸检测模型','Face detector model'),title:this.tt('人脸检测','Face detection'),description:this.tt('定位画面中的人脸','Locate faces in the image'),model:'SCRFD',hint:this.packFiles[0]||'SCRFD · 640×640'},
      {key:'recognizer',label:this.tt('人脸特征模型','Face feature model'),title:this.tt('人脸特征','Face features'),description:this.tt('辨认是否为同一个人','Recognize the same person'),model:recognizer,hint:this.packFiles[1]||'ArcFace · 112×112'},
      {key:'verifier',label:this.tt('人脸复核模型（可选）','Face verifier model (optional)'),title:this.tt('人脸复核','Face verification'),description:this.tt('排除误检的人脸','Filter false face detections'),model:'FaceVerifier',hint:this.form?.profile?.startsWith('raccoon_')?'face_verifier_mnv2.onnx':this.tt('此套装不含复核模型','Not included in this pack')}];},
    downloadFolderValid(){const path=this.downloadRequest?.subdirectory||'';return /^faces\/[^/\\]+$/.test(path)&&path===path.trim()&&!['.','..'].includes(path.slice(6))&&path.slice(6).length<=128;},
    downloadActive(){return ['downloading','validating'].includes(this.$root.faceDownload.state);},
    downloadProgress(){const d=this.$root.faceDownload;return d.total?Math.min(1,d.received/d.total):0;},
    videoRates(){return [1,2,3].map(value=>({value,label:this.tt(value+' 帧/秒',value+(value===1?' frame/s':' frames/s'))}));},
    videoResolutions(){return [{value:'1080p',label:'1080p'},{value:'original',label:this.tt('原片','Original')}];},
  },
  methods:{tt:taxText,
    checkFor(stage){const c=this.$root.faceModelChecks[stage];return c?.path===this.form[stage+'_path']?c:null;},
    async guideModelStages(){
      if(!this.stageGuidancePending)return;
      this.stageGuidancePending=false;
      await this.$nextTick();
      const group=this.$refs.modelStages;
      if(!group?.isConnected||!this.$root.showSettings||this.$root.settingsTab!=='people'||!this.form)return;
      const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      group.querySelectorAll('.face-model-stage').forEach((card,index)=>{
        card.getAnimations().filter(a=>a.id==='face-stage-guidance').forEach(a=>a.cancel());
        if(reduced)return;
        const color=card.classList.contains('face-model-stage--disabled')?'var(--text3)':'var(--accent)';
        const animation=card.animate([{boxShadow:'inset 0 0 0 0 transparent'},{boxShadow:'inset 0 0 0 2px '+color,offset:.4},{boxShadow:'inset 0 0 0 0 transparent'}],{duration:900,delay:index*100,easing:'ease-in-out'});
        animation.id='face-stage-guidance';
      });
      requestAnimationFrame(()=>{
        if(group.isConnected&&this.$root.showSettings&&this.$root.settingsTab==='people')group.scrollIntoView({block:'nearest',behavior:reduced?'auto':'smooth'});
      });
      this.stageGuidanceMessage=this.tt('已更新'+this.selectedPack.label+'的套装模型信息。','Model information updated for '+this.selectedPack.label+'.');
    },
    choosePack(value){this.$root.selectFacePack(value);this.stageGuidancePending=value!=='none';},
    downloadFace(option){
      const item=this.$root.faceDownloadCatalog.find(row=>row.profile===option.profile);if(!item)return;
      this.$root.faceDownloadError='';
      this.downloadRequest={profile:option.profile,label:this.packs.find(pack=>pack.value===option.profile)?.label||option.name,
        base:this.$root.faceManagedDirectory,subdirectory:'faces/'+option.profile,bytes:item.bytes,files:item.files||[]};
    },
    async confirmFaceDownload(){
      const request=this.downloadRequest;if(!request||!this.downloadFolderValid||this.$root.faceDownloadStarting)return;
      if(await this.$root.startFaceDownload(request.profile,null,request.subdirectory)){
        if(this.downloadRequest===request)this.downloadRequest=null;
      }
    },
    focusDownloadTrigger(){
      if(!this.$root.showSettings||this.$root.settingsTab!=='people')return;
      const selector='.face-model-heading [role="combobox"]';
      this.$el.querySelector(selector)?.focus({preventScroll:true});
    },
    downloadFileModel(file){
      if(file.stage==='detector')return 'SCRFD';
      if(file.stage==='verifier')return 'FaceVerifier';
      return ['buffalo_l','buffalo_m','raccoon_l'].includes(this.downloadRequest?.profile)?'ArcFace · ResNet-50':'ArcFace · MobileFaceNet';
    },
    chooseFastModel(value){
      if(value==='none'){this.form.classification_model_enabled='false';this.$root._classificationDownloadContext=null;return;}
      const model=this.$root.classificationModels.find(item=>item.id===value);if(!model?.installed)return;
      this.form.classification_model_enabled='true';this.form.classification_model_id=value;this.form.classification_model_dir=model.directory;
    },
    downloadFastModel(option){
      Quasar.Dialog.create({title:this.tt('下载模型 ','Download model ')+option.name,
        message:option.detail+this.tt(' · 下载到通用设置中的大模型目录。',' · Download into the model directory in General settings.'),
        ok:{label:this.tt('下载','Download'),color:'primary'},cancel:{label:this.tt('取消','Cancel'),flat:true}})
        .onOk(()=>this.$root.startClassificationDownload(option.value));
    },
    chooseOmniModel(value){this.form.classification_omni_model=value;if(value==='none'){this.form.classification_omni_enabled='false';this.form.classification_relations_enabled='false';}},
    downloadOmni(option){this.$root.confirmModelDownload({id:option.value,label:option.name,size_gb:option.size_gb});},
    removeOmni(option){this.$root.confirmModelDelete({id:option.value,label:option.name,size_gb:option.size_gb});},
  },
  template:`<div class="recognition-settings" :class="{'recognition-settings--people':kind==='people'}">
    <q-dialog v-if="kind==='people'" :model-value="!!downloadRequest" no-refocus :persistent="$root.faceDownloadStarting" :aria-label="tt('下载人脸模型','Download face models')" @update:model-value="!$event&&(downloadRequest=null)" @hide="focusDownloadTrigger">
      <q-card v-if="downloadRequest" class="dialog-card face-download-dialog">
        <q-card-section class="face-download-heading"><h2>{{tt('下载 ','Download ')+downloadRequest.label}}</h2><q-btn flat round dense icon="close" :disable="$root.faceDownloadStarting" :aria-label="tt('关闭下载','Close download')" @click="downloadRequest=null"></q-btn></q-card-section>
        <q-card-section class="face-download-content">
          <div class="face-download-destination">
            <div><div class="settings-label">{{tt('模型根目录','Model root')}}</div><q-input :model-value="downloadRequest.base" readonly dense filled :title="downloadRequest.base" :aria-label="tt('模型根目录','Model root')"><template v-slot:prepend>
              <q-btn flat round dense size="sm" icon="info_outline" :aria-label="tt('模型根目录说明','About the model root')"><q-menu class="model-root-help"><div role="note">{{tt('此前缀为模型根目录，可在「设置 → 通用 → 大模型目录」修改。','This fixed prefix is the model root. Change it in Settings → General → Model directory.')}}</div></q-menu></q-btn>
            </template></q-input></div>
            <div><div class="settings-label">{{tt('套装子目录','Pack subdirectory')}}</div><q-input v-model="downloadRequest.subdirectory" dense filled :disable="$root.faceDownloadStarting" :aria-label="tt('套装子目录','Pack subdirectory')" maxlength="134" @keydown.enter.prevent="confirmFaceDownload"></q-input></div>
          </div>
          <div class="face-download-files" role="list" :aria-label="tt('套装包含的模型','Models in this pack')">
            <div v-for="file in downloadRequest.files" :key="file.stage" class="face-download-file" role="listitem">
              <q-icon :name="{detector:'crop_free',recognizer:'fingerprint',verifier:'verified'}[file.stage]" size="22px" aria-hidden="true"></q-icon>
              <div><div class="face-download-file-title">{{stages.find(stage=>stage.key===file.stage)?.title}}<span>{{downloadFileModel(file)}}</span></div><div class="face-download-file-name">{{file.name}}</div></div>
              <span v-if="file.stage==='verifier'" class="face-download-optional">{{tt('可选','Optional')}}</span>
            </div>
          </div>
          <div class="face-download-description">{{$root.fmtBytes(downloadRequest.bytes)}} · InsightFace</div>
          <div v-if="$root.faceDownloadError" class="face-stage-error" role="alert">{{$root.faceDownloadError}}</div>
          <div v-if="!downloadFolderValid" class="face-stage-error" role="alert">{{tt('使用 faces/套装文件夹 格式，不能跳出模型根目录。','Use faces/pack-folder within the model root.')}}</div>
        </q-card-section>
        <q-card-actions align="right"><q-btn flat no-caps :label="tt('取消','Cancel')" :disable="$root.faceDownloadStarting" @click="downloadRequest=null"></q-btn><q-btn unelevated no-caps color="primary" :label="tt('下载','Download')" :loading="$root.faceDownloadStarting" :disable="!downloadFolderValid" @click="confirmFaceDownload"></q-btn></q-card-actions>
      </q-card>
    </q-dialog>
    <div v-if="loading" class="recognition-settings-status" role="status"><q-spinner size="22px"></q-spinner><span>{{tt('正在读取设置…','Loading settings…')}}</span></div>
    <div v-else-if="error" class="recognition-settings-error" role="alert">{{error}}<q-btn flat dense icon="refresh" :label="tt('重新读取','Reload')" @click="$root.loadRecognitionSettings(kind)"></q-btn></div>
    <template v-if="form">
      <template v-if="kind==='people'">
        <settings-group :title="tt('模型组合','Model pack')" icon="face" :note="tt('从模型菜单下载整套','Download a complete pack from the menu')">
          <template v-slot:heading><q-btn flat round dense class="settings-help" icon="info_outline" :aria-label="tt('模型说明','About models')" :aria-expanded="helpVisible" @click="helpVisible=!helpVisible"></q-btn></template>
          <settings-row class="face-model-heading" :label="tt('模型套装','Model pack')">
            <model-select :model-value="form.model_enabled===false?'none':selectedPack?form.profile:null" allow-none :display-value="form.model_enabled===false||selectedPack?undefined:tt('请选择模型组合','Choose a model pack')" :options="packOptions" :download-state="faceModelDownload" :loading="$root.faceCatalogLoading" :disable="$root.faceCatalogLoading" :aria-label="tt('模型组合','Model pair')"
              @update:model-value="choosePack" @activate="value=>{if(value===form.profile)choosePack(value)}" @hide="guideModelStages" @download="downloadFace"></model-select>
          </settings-row>
          <div v-if="helpVisible" class="settings-status face-model-details">{{tt('InsightFace · Buffalo 默认关闭复核，Raccoon 默认开启。三阶段模型随所选套装配置，无需分别选择。核验检查当前文件接口，不代表准确率评测。人脸复核只过滤误检，不是活体检测。','InsightFace · Verification defaults off for Buffalo and on for Raccoon. Stage models are configured by the pack. Interface checks are not accuracy evaluations. Face verification filters false detections; it is not a liveness test.')}}</div>
          <div v-if="form.model_enabled===false" class="settings-status" role="status">{{tt('人脸识别未启用，导入和人物扫描将跳过。','Face recognition is off for imports and people scans.')}}</div>
        </settings-group>
        <div v-if="downloadActive||$root.faceDownloadError||$root.faceDownload.state==='error'||$root.faceDownload.state==='cancelled'" class="classification-settings-group" role="status">
          <q-linear-progress v-if="downloadActive" :value="downloadProgress" rounded></q-linear-progress>
          <div v-if="downloadActive" class="classification-model-caption"><span>{{$root.faceDownload.profile}} · {{$root.faceDownload.state==='validating'?tt('正在核验模型…','Checking models…'):Math.round(downloadProgress*100)+'%'}}</span><q-btn flat dense no-caps :label="tt('取消下载','Cancel download')" @click="$root.cancelFaceDownload()"></q-btn></div>
          <div v-if="$root.faceDownloadError||$root.faceDownload.state==='error'" class="face-stage-error" role="alert">{{$root.faceDownloadError||$root.faceDownload.error}}</div>
          <div v-if="$root.faceDownload.state==='cancelled'">{{tt('下载已取消','Download cancelled')}}</div>
        </div>
        <div v-if="$root.faceDownload.state==='done'&&$root.faceDownloadAppliedId!==$root.faceDownload.id" class="classification-model-caption"><span>{{tt('下载完成，可选择已下载模型。','Download complete. Choose an installed model.')}}</span><q-btn flat dense no-caps :label="tt('填入已下载模型','Use downloaded models')" @click="$root.applyFaceDownload()"></q-btn></div>
        <settings-group v-if="form.model_enabled!==false" class="face-model-stage-heading" :title="tt('套装模型','Pack models')" icon="view_week" surface="none" :note="tt('随上方组合自动配置','Configured by the selected pack')" :label="tt('套装模型信息','Pack model information')">
        <div class="face-stage-announcement" role="status" aria-live="polite" aria-atomic="true">{{stageGuidanceMessage}}</div>
        <div v-if="form.model_enabled!==false" class="face-model-stages" ref="modelStages">
          <div v-for="stage in stages" :key="stage.key" class="face-model-stage" :class="{'face-model-stage--disabled':stage.key==='verifier'&&!form.verify_enabled}" :data-stage="stage.key" role="group" :aria-label="stage.title">
            <div class="face-stage-hero">
              <svg class="face-stage-icon face-stage-art" viewBox="0 0 96 96" aria-hidden="true" focusable="false">
                <rect x="4" y="4" width="88" height="88" rx="26" fill="currentColor" opacity=".045"></rect>
                <path d="M41 69v8l-9 7h32l-9-7v-8" fill="currentColor" opacity=".12"></path>
                <g fill="currentColor" fill-opacity=".08" stroke="currentColor" stroke-opacity=".5" stroke-width="1.5"><ellipse cx="24" cy="47" rx="4" ry="6"></ellipse><ellipse cx="72" cy="47" rx="4" ry="6"></ellipse></g>
                <path d="M24 39c0-13 9-20 24-20s24 7 24 20v7c0 15-10 26-24 26S24 61 24 46Z" fill="currentColor" fill-opacity=".06" stroke="currentColor" stroke-opacity=".65" stroke-width="1.7" stroke-linejoin="round"></path>
                <path d="M23 40c-2-16 8-25 25-25s27 10 25 25c-9-1-16-5-21-12-6 7-16 11-29 12Z" fill="currentColor" opacity=".24"></path>
                <g fill="currentColor"><circle cx="38" cy="46" r="1.8"></circle><circle cx="58" cy="46" r="1.8"></circle></g>
                <g fill="currentColor" opacity=".1"><ellipse cx="33" cy="54" rx="3.2" ry="2"></ellipse><ellipse cx="63" cy="54" rx="3.2" ry="2"></ellipse></g>
                <g fill="none" stroke="currentColor" stroke-linecap="round"><path d="M48 50v3" stroke-width="1.3" opacity=".45"></path><path d="M43 60q5 2.5 10 0" stroke-width="1.7" opacity=".8"></path></g>
                <path v-if="stage.key==='detector'" d="M26 12H14V24M70 12H82V24M82 66V78H70M26 78H14V66" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"></path>
                <g v-if="stage.key==='recognizer'">
                  <path d="M29 44q-2 7 1 13m37-13q2 7-1 13M38 46q10-5 20 0" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 2.5" opacity=".4" stroke-linecap="round"></path>
                  <g fill="none" stroke="currentColor" stroke-width="1" opacity=".5"><circle cx="38" cy="46" r="3.7"></circle><circle cx="58" cy="46" r="3.7"></circle></g>
                  <g fill="currentColor"><circle v-for="(point,i) in [[29,44],[30,57],[67,44],[66,57],[48,53],[43,60],[53,60]]" :key="i" :cx="point[0]" :cy="point[1]" r="1.3"></circle></g>
                </g>
                <g v-if="stage.key==='verifier'" stroke="currentColor"><circle class="face-verify-badge" cx="74" cy="72" r="13" stroke-width="1.8"></circle><path d="m68 72 4 4 8-9" fill="none" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"></path></g>
              </svg>
              <div class="face-stage-copy"><div class="face-stage-title">{{stage.title}}</div><div class="face-stage-description">{{stage.description}}</div></div>
            </div>
            <div class="face-stage-field">
              <div class="face-stage-model">{{stage.model}}</div>
              <div class="face-stage-recommendation" :title="form[stage.key+'_path']||stage.hint">{{form[stage.key+'_path']?.split('/').pop()||stage.hint}}</div>
              <div v-if="checkFor(stage.key)?.state==='error'" class="face-stage-status face-stage-error" role="alert">{{checkFor(stage.key).error}}</div>
            </div>
            <div class="face-stage-controls">
              <q-toggle v-if="stage.key==='verifier'" v-model="form.verify_enabled" dense :disable="!verifierAvailable" :label="tt('启用','Enable')" :aria-label="tt('启用人脸复核','Enable face verification')"></q-toggle><span v-else class="face-stage-required" :class="{'face-stage-required--pending':!form[stage.key+'_path']}">{{form[stage.key+'_path']?tt('已配置','Configured'):tt('待下载','Not downloaded')}}</span>
              <div class="face-stage-check-actions">
                <div v-if="checkFor(stage.key)?.state==='valid'" class="face-stage-status" role="status" :title="tt('接口核验通过','Interface check passed')"><span class="material-icons" aria-hidden="true">check_circle</span><span>{{tt('接口核验通过','Interface check passed')}}</span></div>
                <q-btn flat dense no-caps class="face-stage-check" icon="fact_check" :label="tt('核验','Check')" :aria-label="tt('核验模型','Check model')" :loading="checkFor(stage.key)?.state==='checking'" :disable="!form[stage.key+'_path']||(stage.key==='verifier'&&!form.verify_enabled)" @click="$root.probeFaceModel(stage.key)"><q-tooltip>{{tt('检查模型能否用于此阶段','Check whether the model fits this stage')}}</q-tooltip></q-btn>
              </div>
            </div>
          </div>
        </div>
        </settings-group>
        <settings-group :title="tt('人物归组','People grouping')" icon="groups" :note="groupingNote">
          <settings-row :label="tt('自动归组阈值','Automatic grouping threshold')" :note="tt('越低越容易归为同一人','Lower values group more faces together')">
            <template v-slot:help><q-btn flat round dense class="settings-help" icon="help_outline" :aria-label="tt('人物归组说明','About people grouping')" aria-haspopup="dialog" :aria-expanded="groupingHelpVisible" @click="groupingHelpVisible=!groupingHelpVisible">
              <q-menu v-model="groupingHelpVisible" no-parent-event class="face-sample-help-panel" role="dialog" :aria-label="tt('人物归组说明','About people grouping')" max-width="360px" :offset="[0,8]">
                <div class="face-sample-help-heading"><strong>{{tt('人物归组','People grouping')}}</strong><q-btn flat round dense size="sm" icon="close" :aria-label="tt('关闭归组说明','Close grouping help')" @click="groupingHelpVisible=false"></q-btn></div>
                <p>{{tt('可设 0.45～0.85，默认 0.55。数值越低，同一人越不容易被拆开，也更容易错合并。相似分数不是身份正确率。待核对阈值仍为 0.40，最佳候选仍需领先第二名 0.08。','Range 0.45–0.85, default 0.55. Lower values reduce fragmentation and increase false matches. Similarity is not identity accuracy. Review starts at 0.40; the best match must still lead the runner-up by 0.08.')}}</p>
                <p>{{tt('启用校准后，仅在本地参考最近 100 次有效人工纠正。当前模型积累至少 5 次同一人反馈后可适度放宽；至少 3 次不同人反馈可收紧。调整范围不超过手动阈值上下 0.05，撤销操作也会撤销对应反馈。','Calibration uses the latest 100 valid human corrections locally. At least 5 same-person decisions can relax the current model threshold; at least 3 different-person decisions can tighten it. Changes stay within ±0.05 of your value. Undoing a decision removes its feedback.')}}</p>
                <p>{{tt('只影响后续识别，不会自动合并已有相册。低清、无特征或其他模型的反馈不会混用，也不训练或上传模型。','Only future recognition changes; existing albums are not merged automatically. Low-quality, featureless and other-model feedback is excluded. No model is trained or uploaded.')}}</p>
              </q-menu>
            </q-btn></template>
            <q-input v-model="form.similarity_threshold" class="settings-number" filled dense type="number" min="0.45" max="0.85" step="0.01" :aria-label="tt('自动归组阈值','Automatic grouping threshold')"></q-input>
          </settings-row>
          <settings-row :label="tt('根据人工纠正校准','Learn from manual corrections')" :note="groupingFeedback">
            <q-toggle v-model="form.adaptive_threshold" dense :aria-label="tt('根据人工纠正校准','Learn from manual corrections')"></q-toggle>
          </settings-row>
        </settings-group>
        <settings-group :title="tt('视频人脸识别','Video face recognition')" icon="video_camera_front">
          <settings-row :label="tt('视频压缩','Video scaling')" :help="tt('仅用于人脸识别。1080p按比例缩小，不放大小尺寸视频；原片保留原始分辨率。实时处理，不生成视频副本。已完成素材需重新扫描才更新。','Only affects face recognition. 1080p scales down proportionally without enlarging smaller videos; Original keeps the source resolution. Processing is in memory without a video copy. Completed media only update after an explicit rescan.')"><q-select v-model="form.video_resolution" filled dense emit-value map-options :options="videoResolutions" :aria-label="tt('视频人脸压缩','Video face scaling')"></q-select></settings-row>
          <settings-row :label="tt('检测帧率','Detection frame rate')"><q-select v-model="form.video_fps" filled dense emit-value map-options :options="videoRates" :aria-label="tt('视频人脸检测帧率','Video face detection frame rate')"></q-select></settings-row>
          <settings-row :label="tt('每次出镜取样数','Samples per appearance')">
            <template v-slot:help><q-btn flat round dense class="face-sample-help settings-help" icon="help_outline" :aria-label="tt('取样数量说明','About sampling per appearance')" aria-haspopup="dialog" :aria-expanded="sampleHelpVisible" @click="sampleHelpVisible=!sampleHelpVisible">
            <q-menu v-model="sampleHelpVisible" no-parent-event class="face-sample-help-panel" role="dialog" :aria-label="tt('取样数量说明','About sampling per appearance')" max-width="360px" max-height="440px" :offset="[0,8]">
              <div class="face-sample-help-heading"><strong>{{tt('每次出镜取样数','Samples per appearance')}}</strong><q-btn flat round dense size="sm" icon="close" :aria-label="tt('关闭取样说明','Close sampling help')" @click="sampleHelpVisible=false"></q-btn></div>
              <div class="face-sample-help-section"><strong>{{tt('数量范围','Sample limit')}}</strong><p>{{tt('可设1～48张，默认4张。它是每条轨迹选用的图片上限，不会限制视频中的人数。','Choose 1–48 images, with a default of 4. This limits samples per track, not the number of people in a video.')}}</p><p>{{tt('同一张脸连续出镜时，自动从不同时刻挑选清晰图片用于识别。数量越多，处理通常越久。','When the same face stays on screen, clear images from different moments are selected for recognition. More samples usually take longer to process.')}}</p></div>
              <div class="face-sample-help-section"><strong>{{tt('什么是一条轨迹','What is a track?')}}</strong><p>{{tt('一张脸在连续画面中被持续跟踪的一段记录。同一个人可以有多条轨迹，轨迹编号本身不代表人物身份。','A track follows one face through a sequence of frames. The same person can have several tracks; a track ID does not establish identity.')}}</p></div>
              <div class="face-sample-help-section"><strong>{{tt('怎样跟踪','How tracking works')}}</strong><p>{{tt('根据人脸框的位置、大小、重叠程度和运动信息关联相邻画面。切镜头、人脸消失或无法可靠关联时，会结束当前轨迹，后续检出再建立新轨迹。','Faces are linked between frames using box position, size, overlap and motion. A scene cut, a missing face or an unreliable match ends a track; later detections can start a new one.')}}</p></div>
              <div class="face-sample-help-section"><strong>{{tt('怎样选图','How samples are selected')}}</strong><p>{{tt('先评估清晰度、人脸大小、姿态、对齐可靠性和检测置信度，再兼顾时间分布挑选代表图片。合格图片不足时少选；全不合格时，只保留一张低质量样本待核对。选出的样本才进行特征提取和可选复核。','Samples are scored for sharpness, face size, pose, alignment and detection confidence, then selected across time. Fewer are used when good samples are scarce; if none qualify, one low-quality sample is kept for review. Only selected samples proceed to feature extraction and optional verification.')}}</p></div>
            </q-menu>
            </q-btn></template><q-input v-model="form.video_identity_samples" class="settings-number" filled dense type="number" min="1" max="48" step="1" :suffix="tt('张','images')" :aria-label="tt('每次出镜取样数','Samples per appearance')"></q-input>
          </settings-row>
        </settings-group>
      </template>
      <template v-else>
        <settings-group :title="tt('快速分类 · Google SigLIP 2','Fast classification · Google SigLIP 2')" icon="auto_awesome" :label="tt('快速分类模型','Fast classification model')" :note="tt('导入时启用 · 仅照片','Enable on import · Photos only')">
          <settings-row :label="tt('快速分类模型','Fast classification model')" :help="tt('使用所选 Google SigLIP 2 为照片推荐场景与物品标签。下载并保存模型后，在导入素材时启用。','The selected Google SigLIP 2 suggests scene and object tags for photos. Download and save a model, then enable it when importing.')+(form.classification_model_dir?' '+tt('模型目录：','Model directory: ')+form.classification_model_dir:'')">
            <model-select :model-value="form.classification_model_enabled==='false'?'none':form.classification_model_id||null" allow-none :display-value="form.classification_model_enabled==='false'||form.classification_model_id?undefined:tt('请选择 SigLIP 2 规格','Choose a SigLIP 2 variant')" :options="fastModelOptions" :download-state="classificationModelDownload" :loading="$root.classificationCatalogLoading" :disable="$root.classificationCatalogLoading" :aria-label="tt('快速分类模型列表','Fast classification model list')" @update:model-value="chooseFastModel" @activate="value=>{if(value==='none')chooseFastModel(value)}" @download="downloadFastModel"></model-select>
          </settings-row>
          <div v-if="['downloading','validating'].includes($root.classificationDownload.state)" class="settings-status" role="status"><q-linear-progress :value="classificationModelDownload.total_bytes?classificationModelDownload.done_bytes/classificationModelDownload.total_bytes:0" rounded></q-linear-progress><span>{{$root.classificationDownload.state==='validating'?tt('正在核验模型…','Checking models…'):Math.round((classificationModelDownload.done_bytes||0)/(classificationModelDownload.total_bytes||1)*100)+'%'}}</span><q-btn flat dense no-caps :label="tt('取消下载','Cancel download')" @click="$root.cancelClassificationDownload()"></q-btn></div>
          <div v-if="$root.classificationDownloadError||$root.classificationDownload.state==='error'" class="settings-status settings-status--error face-stage-error" role="alert">{{$root.classificationDownloadError||$root.classificationDownload.error}}</div>
          <div v-if="$root.classificationDownload.state==='cancelled'" class="settings-status" role="status">{{tt('下载已取消','Download cancelled')}}</div>
          <q-btn v-if="$root.classificationDownload.state==='done'&&$root.classificationDownloadAppliedId!==$root.classificationDownload.id" flat dense no-caps :label="tt('使用已下载模型','Use downloaded model')" @click="$root.applyClassificationDownload()"></q-btn>
        </settings-group>
        <settings-group :title="tt('本地补充与词库整理','Local refinement and vocabulary')" icon="tune" :label="tt('本地补充与词库模型','Local refinement and vocabulary model')" :note="tt('前台优先 · 自动续跑','Foreground first · Resumes automatically')">
          <settings-row :label="tt('共用本地模型','Shared local model')"><model-select :model-value="form.classification_omni_model" @update:model-value="chooseOmniModel" allow-none :options="$root.computedLocalModelOptions" :download-state="$root.vlmDownload" allow-remove :aria-label="tt('本地补充与词库模型列表','Local refinement and vocabulary model list')" @download="downloadOmni" @remove="removeOmni"></model-select></settings-row>
          <settings-model-status></settings-model-status>
          <settings-row :label="tt('本地模型补充标签','Local tag refinement')" :help="tt('快速分类完成后排队补充更细的标签。导入、AI 分析或媒体播放期间让路，结束后自动继续；这里不检测电脑是否无人操作。关闭开关会停止后续自动排队，已有任务在 Header 后台任务中控制。','Queues more detailed tags after fast classification. It yields during import, AI analysis or media playback and resumes afterwards; this is not system idle detection. Turning this off stops new automatic jobs. Control existing jobs in the header.')">
            <q-toggle v-model="form.classification_omni_enabled" :disable="form.classification_omni_model==='none'" dense true-value="true" false-value="false" :aria-label="tt('本地模型补充标签','Local tag refinement')"></q-toggle>
          </settings-row>
          <settings-row :label="tt('AI 整理词库关系','AI-assisted taxonomy relationships')" :help="tt('新增或修改标签后自动排队，也可在标签维护中手动发起。使用上方本地模型寻找同义、近义及关联词；避让导入、AI 分析和媒体播放，结束后自动继续。它整理的是词库，不会重新分析所有照片。','Queues on tag creation or editing; you can also start it from tag maintenance. The shared local model suggests synonyms and related terms. It yields to import, AI analysis and playback, then resumes. It organizes vocabulary, without reanalyzing every photo.')">
            <q-toggle v-model="form.classification_relations_enabled" :disable="form.classification_omni_model==='none'" dense true-value="true" false-value="false" :aria-label="tt('AI 整理词库关系','AI-assisted taxonomy relationships')"></q-toggle>
          </settings-row>
        </settings-group>
        <settings-group :title="tt('审核与保留','Review and retention')" icon="fact_check">
          <settings-row :label="tt('自动应用标签规则','Apply validated tag rules')" :help="tt('只自动应用独立验证通过的标签规则。未验证、有歧义或与人工决定冲突的结果继续待审。与词库关系规则独立控制。','Only independently validated tag rules apply automatically. Unvalidated, ambiguous or conflicting results stay pending. This is independent of relationship rules.')"><q-toggle v-model="form.classification_auto_enabled" dense true-value="true" false-value="false" :aria-label="tt('自动应用独立验证通过的标签规则','Apply independently validated tag rules automatically')"></q-toggle></settings-row>
          <settings-row :label="tt('自动应用关系规则','Apply validated relationship rules')" :help="tt('只自动应用独立验证通过的同义、近义及关联规则；合并、拆分及父子层级等结构变更仍需确认。人工锁定的关系不会被覆盖。','Only independently validated synonym and relationship rules apply automatically. Merges, splits and hierarchy changes still need confirmation. Manual locks are preserved.')"><q-toggle v-model="form.classification_auto_relations_enabled" dense true-value="true" false-value="false" :aria-label="tt('自动应用独立验证通过的关系规则','Apply independently validated relationship rules automatically')"></q-toggle></settings-row>
          <settings-row :label="tt('已拒绝／过期建议保留天数','Retention days for rejected or stale suggestions')" :note="tt('手动清理','Manual cleanup')">
            <template v-slot:help><settings-help :title="tt('建议保留期','Suggestion retention')" :text="tt('只影响已拒绝或已过期的建议记录。超过期限后可在标签维护的后台任务页预览并手动清理，不会自动删除素材、正式标签或人工决定。','Applies only to rejected or stale suggestions. Preview and clean them manually from tag maintenance after this period. Media, assigned tags and manual decisions are retained.')"></settings-help></template>
            <q-input v-model="form.classification_candidate_retention_days" class="settings-number" filled dense type="number" min="1" max="3650" :suffix="tt('天','days')" :aria-label="tt('已拒绝／过期建议保留天数','Retention days for rejected or stale suggestions')"></q-input>
          </settings-row>
        </settings-group>
      </template>
    </template>
  </div>`
};
