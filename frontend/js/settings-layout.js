// Settings presentation only. Drafts, downloads and persistence remain in their owning mixins.
const SettingsHelp = {
  props:{title:{type:String,required:true},text:{type:String,required:true}},
  data:()=>({visible:false}),
  methods:{tt:taxText},
  template:`<q-btn flat round dense icon="error_outline" class="settings-help classification-help" :aria-label="title+tt('说明',' help')" aria-haspopup="dialog" :aria-expanded="visible" @click="visible=true">
    <q-menu v-model="visible" no-parent-event anchor="bottom left" self="top left" :offset="[0,8]" class="classification-help-panel" role="dialog" :aria-label="title+tt('说明',' help')">
      <div class="classification-help-heading"><strong>{{title}}</strong><q-btn flat round dense icon="close" size="sm" :aria-label="tt('关闭说明','Close help')" @click="visible=false"></q-btn></div><p>{{text}}</p>
    </q-menu>
  </q-btn>`
};

const SettingsGroup = {
  props:{title:{type:String,required:true},icon:String,note:String,label:String,surface:{type:String,default:'grouped'}},
  methods:{tt:taxText},
  template:`<section class="settings-group" :class="{'settings-group--bare':surface==='none'}" role="group" :aria-label="label||title+tt('设置',' settings')">
    <header class="settings-group-heading"><q-icon v-if="icon" :name="icon" aria-hidden="true"></q-icon><h3>{{title}}</h3><span v-if="note" class="settings-group-note">{{note}}</span><slot name="heading"></slot></header>
    <div class="settings-group-body"><slot></slot></div>
  </section>`
};

const SettingsRow = {
  props:{label:{type:String,required:true},help:String,note:String},
  template:`<div class="settings-row"><div class="settings-row-label settings-label"><span>{{label}}</span><settings-help v-if="help" :title="label" :text="help"></settings-help><slot name="help"></slot></div>
    <div class="settings-row-control"><span v-if="note" class="settings-row-note">{{note}}</span><slot></slot></div>
  </div>`
};

const SettingsModelStatus = {
  computed:{root(){return this.$root;},download(){return this.root.vlmDownload;}},
  methods:{t(...args){return t(...args);}},
  template:`<div v-if="download.state==='downloading'||download.state==='error'" class="settings-status" :class="{'settings-status--error':download.state==='error'}" :role="download.state==='error'?'alert':'status'" aria-live="polite">
    <template v-if="download.state==='downloading'"><q-linear-progress :value="download.total_bytes?download.done_bytes/download.total_bytes:0" rounded></q-linear-progress><span>{{t('s.model_dl_running')}} · {{Math.floor(download.done_bytes/(download.total_bytes||1)*100)}}% · {{root.fmtBytes(download.speed_bps)}}/s</span></template>
    <template v-else><q-icon name="error_outline" aria-hidden="true"></q-icon><span>{{t('s.model_dl_failed')}}: {{download.error}}</span></template>
  </div>`
};
