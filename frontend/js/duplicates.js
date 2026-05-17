const DuplicatesPage = {
  template: `
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
    <div class="filter-bar">
      <q-btn flat dense icon="arrow_back" label="返回" color="grey-6" style="border-radius:6px;padding:3px 6px;font-size:13px" @click="goBack"></q-btn>
      <q-btn-group unelevated style="border-radius:6px;overflow:hidden">
        <q-btn unelevated dense :color="dupType==='exact'?'primary':'grey-9'" :text-color="dupType==='exact'?'white':'grey-6'" icon="content_copy" size="sm" label="重复" @click="switchType('exact')">
          <q-tooltip :delay="1000">完全相同文件</q-tooltip>
        </q-btn>
        <q-btn unelevated dense :color="dupType==='similar'?'primary':'grey-9'" :text-color="dupType==='similar'?'white':'grey-6'" icon="difference" size="sm" label="相似" @click="switchType('similar')">
          <q-tooltip :delay="1000">视觉相似内容</q-tooltip>
        </q-btn>
      </q-btn-group>
      <div style="flex:1"></div>
      <q-btn v-if="needBackfill" flat dense no-caps icon="sync" label="计算哈希" color="grey-6" size="sm" @click="backfillAndReload" style="border:1px solid var(--border);border-radius:6px"></q-btn>
    </div>
    <div v-if="loading" style="flex:1;display:flex;align-items:center;justify-content:center">
      <q-spinner-dots color="grey-6" size="40px"></q-spinner-dots>
    </div>
    <div v-else-if="!groups.length" style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;color:var(--text3);gap:8px">
      <q-icon name="check_circle" size="36px" style="opacity:0.3"></q-icon>
      <span>没有发现{{ dupType === 'exact' ? '重复' : '相似' }}素材</span>
    </div>
    <q-scroll-area v-else style="flex:1">
      <div style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
        <div v-for="(g, gi) in groups" :key="gi" class="dup-group">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="display:flex;align-items:center;gap:8px">
              <span class="dup-badge">{{ g.items.length }}</span>
              <span style="font-size:12px;color:var(--text2)">个{{ dupType === 'exact' ? '重复' : '相似' }}文件</span>
            </div>
            <span v-if="dupType === 'similar'" style="font-size:11px;color:var(--accent)">相似度 {{ Math.round((1 - g.distance / 256) * 100) }}%</span>
          </div>
          <div style="display:flex;gap:10px;overflow-x:auto;padding-bottom:4px">
            <div v-for="item in g.items" :key="item.id" class="dup-thumb" @click="openDetail(item.id)">
              <img :src="'/media/thumbnail/' + item.id">
              <div class="dup-thumb-name">{{ item.file_name }}</div>
              <div style="font-size:10px;color:var(--text3)">{{ item.media_type === 'video' ? '视频' : '图片' }} · {{ (item.file_size / 1048576).toFixed(1) }}MB</div>
            </div>
          </div>
        </div>
      </div>
    </q-scroll-area>
    <div style="flex-shrink:0;padding:6px 20px;font-size:12px;color:var(--text3);border-top:1px solid var(--border);text-align:center">
      共 {{ groups.length }} 组{{ dupType === 'exact' ? '重复' : '相似' }}素材
    </div>
  </div>
  `,
  data() {
    return {
      dupType: "exact",
      groups: [],
      loading: false,
      needBackfill: false,
    };
  },
  methods: {
    API,
    goBack() { location.hash = "#/gallery"; },
    openDetail(id) { location.hash = "#/detail/" + id; },
    switchType(type) {
      this.dupType = type;
      this.loadGroups();
    },
    async loadGroups() {
      this.loading = true;
      try {
        const res = await API.getDuplicates(this.dupType, 10);
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
          Quasar.Notify.create({ message: `已为 ${res.count} 个素材计算哈希`, position: 'top', timeout: 2000 });
        }
      } catch (e) { /* ignore */ }
      this.needBackfill = false;
    },
    async backfillAndReload() {
      try {
        const res = await API.backfillHashes();
        Quasar.Notify.create({ message: `已计算 ${res.count} 个素材的哈希`, position: 'top', timeout: 2000 });
        await this.loadGroups();
      } catch (e) {
        Quasar.Notify.create({ message: '回填失败: ' + (e.message || e), position: 'top', color: 'negative', timeout: 2000 });
      }
    },
  },
  created() {
    this.checkBackfill();
    this.loadGroups();
  },
};
