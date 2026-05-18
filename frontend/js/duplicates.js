const DuplicatesPage = {
  template: `
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden" @click="closeCtx">
    <div class="filter-bar">
      <q-btn flat dense icon="arrow_back" label="返回" color="grey-6" style="border-radius:6px;padding:3px 6px;font-size:13px" @click="goBack"></q-btn>
      <q-btn-group unelevated style="border-radius:6px;overflow:hidden">
        <q-btn unelevated dense :color="dupType==='exact'?'primary':'grey-9'" :text-color="dupType==='exact'?'white':'grey-6'" icon="content_copy" size="sm" label="重复" @click="switchType('exact')">
          <q-tooltip :delay="1000">同一个文件出现了多次</q-tooltip>
        </q-btn>
        <q-btn unelevated dense :color="dupType==='near'?'primary':'grey-9'" :text-color="dupType==='near'?'white':'grey-6'" icon="filter_none" size="sm" label="酷似" @click="switchType('near')">
          <q-tooltip :delay="1000">几乎一模一样的照片</q-tooltip>
        </q-btn>
        <q-btn unelevated dense :color="dupType==='similar'?'primary':'grey-9'" :text-color="dupType==='similar'?'white':'grey-6'" icon="difference" size="sm" label="相似" @click="switchType('similar')">
          <q-tooltip :delay="1000">画面非常接近的照片</q-tooltip>
        </q-btn>
        <q-btn unelevated dense :color="dupType==='cluster'?'primary':'grey-9'" :text-color="dupType==='cluster'?'white':'grey-6'" icon="bubble_chart" size="sm" label="聚类" @click="switchType('cluster')">
          <q-tooltip :delay="1000">同场景不同角度或时间</q-tooltip>
        </q-btn>
      </q-btn-group>
      <q-icon name="help_outline" size="16px" color="grey-6">
        <q-tooltip :delay="300" max-width="400px">
          <div style="font-size:12px;line-height:1.8;white-space:nowrap">
            <b>重复</b>：同一个文件出现了多次<br>
            <b>酷似</b>：几乎一模一样的照片，比如同一张照片的 JPG 和 RAW<br>
            <b>相似</b>：画面非常接近，比如连拍的照片<br>
            <b>聚类</b>：同一个场景的不同角度或不同时间拍的照片
          </div>
        </q-tooltip>
      </q-icon>
      <div style="flex:1"></div>
      <q-btn v-if="needBackfill" flat dense no-caps icon="sync" label="计算特征向量" color="grey-6" size="sm" @click="backfillAndReload" style="border:1px solid var(--border);border-radius:6px"></q-btn>
    </div>
    <div v-if="loading" style="flex:1;display:flex;align-items:center;justify-content:center">
      <q-spinner-dots color="grey-6" size="40px"></q-spinner-dots>
    </div>
    <div v-else-if="!groups.length" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text3);gap:8px">
      <q-icon name="check_circle" size="36px" style="opacity:0.3"></q-icon>
      <span>没有发现{{ typeLabel }}素材</span>
    </div>
    <q-scroll-area v-else style="flex:1">
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
        <div v-for="(g, gi) in groups" :key="gi" class="dup-group">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span class="dup-badge">{{ g.items.length }}</span>
            <span style="font-size:12px;color:var(--text2)">个{{ typeLabel }}文件</span>
            <span v-if="dupType !== 'exact' && g.similarity != null" style="font-size:11px;color:var(--accent)">相似度 {{ g.similarity }}%</span>
          </div>
          <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px">
            <div v-for="item in g.items" :key="item.id" class="dup-thumb" @click="openDetail(item.id)" @contextmenu.prevent="showCtx($event, item)">
              <img :src="'/media/thumbnail/' + item.id" draggable="false">
              <div class="dup-thumb-name">{{ item.file_name }}</div>
              <div style="font-size:10px;color:var(--text3)">{{ item.media_type === 'video' ? '视频' : '图片' }} · {{ (item.file_size / 1048576).toFixed(1) }}MB</div>
              <q-tooltip :delay="800" :offset="[0, 4]">{{ item.file_path }}</q-tooltip>
            </div>
          </div>
        </div>
      </div>
    </q-scroll-area>
    <div style="flex-shrink:0;padding:6px 20px;font-size:12px;color:var(--text3);border-top:1px solid var(--border);text-align:center">
      共 {{ groups.length }} 组{{ typeLabel }}素材
    </div>
    <div v-if="ctxMenu.show" class="ctx-menu-popup" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
      <q-list dense style="min-width:120px">
        <q-item clickable @click="closeCtx(); openDetail(ctxMenu.item.id)" style="padding-left:10px;padding-right:14px">
          <q-item-section side style="padding:0"><q-icon name="visibility" size="15px" color="grey-6"></q-icon></q-item-section>
          <q-item-section>查看详情</q-item-section>
        </q-item>
        <q-item clickable @click="closeCtx(); revealFile(ctxMenu.item.file_path)" style="padding-left:10px;padding-right:14px">
          <q-item-section side style="padding:0"><q-icon name="folder_open" size="15px" color="grey-6"></q-icon></q-item-section>
          <q-item-section>在文件夹中显示</q-item-section>
        </q-item>
      </q-list>
    </div>
  </div>
  `,
  data() {
    return {
      dupType: "similar",
      groups: [],
      loading: false,
      needBackfill: false,
      ctxMenu: { show: false, item: null, x: 0, y: 0 },
    };
  },
  computed: {
    typeLabel() {
      return { exact: "重复", near: "酷似", similar: "相似", cluster: "聚类" }[this.dupType] || "相似";
    },
  },
  methods: {
    API,
    goBack() { location.hash = "#/gallery"; },
    openDetail(id) { location.hash = "#/detail/" + id; },
    switchType(type) {
      this.dupType = type;
      this.loadGroups();
    },
    showCtx(e, item) {
      this.ctxMenu.item = item;
      this.ctxMenu.x = e.clientX;
      this.ctxMenu.y = e.clientY;
      this.ctxMenu.show = true;
    },
    closeCtx() {
      this.ctxMenu.show = false;
    },
    revealFile(path) {
      if (window.electronAPI && window.electronAPI.showInFolder) {
        window.electronAPI.showInFolder(path);
      }
    },
    async loadGroups() {
      this.loading = true;
      try {
        const res = await API.getDuplicates(this.dupType);
        this.groups = res.groups || [];
      } catch (e) {
        this.groups = [];
      }
      this.loading = false;
    },
    async checkBackfill() {
      try {
        const res = await API.backfillHashes();
        if (res.count > 0) {
          Quasar.Notify.create({ message: `已为 ${res.count} 个素材计算特征向量`, position: 'top', timeout: 2000 });
          await this.loadGroups();
        }
        this.needBackfill = false;
      } catch (e) {
        this.needBackfill = false;
      }
    },
    async backfillAndReload() {
      try {
        const res = await API.backfillHashes();
        Quasar.Notify.create({ message: `已计算 ${res.count} 个素材的特征向量`, position: 'top', timeout: 2000 });
        await this.loadGroups();
      } catch (e) {
        Quasar.Notify.create({ message: '计算失败: ' + (e.message || e), position: 'top', color: 'negative', timeout: 2000 });
      }
    },
  },
  created() {
    this.checkBackfill();
    this.loadGroups();
  },
};
