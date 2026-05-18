const DuplicatesPage = {
  template: `
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative"
       @mousedown="startLasso" @contextmenu.prevent>
    <div class="filter-bar" @mousedown.stop>
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
            <div v-for="item in g.items" :key="item.id"
                 class="dup-thumb"
                 :class="{selected: selArr.includes(item.id)}"
                 :data-id="item.id"
                 @mousedown.stop
                 @click="onThumbClick(item, $event)"
                 @dblclick.stop="openDetail(item.id)"
                 @contextmenu.prevent="showCtx($event, item)">
              <img :src="'/media/thumbnail/' + item.id" draggable="false">
              <div v-if="selArr.includes(item.id)" class="sel-overlay"></div>
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
    <div v-if="ctxMenu.show" class="ctx-menu-popup" :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }" @mousedown.stop>
      <q-list dense style="min-width:200px;border-radius:8px;overflow:hidden">
        <q-item clickable @click="closeCtx(); openDetail(ctxMenu.item.id)" :disable="selArr.length > 1" style="padding-left:8px;padding-right:12px">
          <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="visibility" size="14px" color="grey-6"></q-icon></q-item-section>
          <q-item-section>查看详情</q-item-section>
          <q-item-section side style="flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:4px"><span style="font-size:10px;color:var(--text3)">↵</span></q-item-section>
        </q-item>
        <q-item clickable @click="closeCtx(); API.revealFile(ctxMenu.item.id)" :disable="selArr.length !== 1" style="padding-left:8px;padding-right:12px">
          <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="folder_open" size="14px" color="grey-6"></q-icon></q-item-section>
          <q-item-section>在文件夹中显示</q-item-section>
        </q-item>
        <q-separator style="background:var(--border)"></q-separator>
        <q-item clickable @click="closeCtx(); deleteCtx()" style="padding-left:8px;padding-right:12px">
          <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="delete_outline" size="14px" color="negative"></q-icon></q-item-section>
          <q-item-section style="color:var(--negative)">{{ selArr.length > 1 ? '移出 ' + selArr.length + ' 个素材' : '移出素材库' }}</q-item-section>
          <q-item-section side style="flex-shrink:0;white-space:nowrap;display:flex;align-items:center;gap:4px"><span style="font-size:10px;color:var(--text3)">⌘+⌫</span></q-item-section>
        </q-item>
      </q-list>
    </div>
    <q-dialog v-model="confirmDelete.show">
      <q-card style="min-width:360px" class="dialog-card">
        <q-btn flat round dense icon="close" size="sm" color="grey-6" class="dialog-close" v-close-popup></q-btn>
        <q-card-section>
          <div class="text-h6">确认移除</div>
        </q-card-section>
        <q-card-section>
          <p class="text-body2">确定要移除「{{ confirmDelete.name }}」吗？</p>
          <p class="text-caption text-grey-6">原文件不会被删除，仅清除库中的记录。</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" @click="confirmDelete.show=false"></q-btn>
          <q-btn color="red" label="确认移除" @click="doDelete"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
    <div v-if="lasso" class="lasso" :style="lassoStyle"></div>
  </div>
  `,
  data() {
    return {
      dupType: "similar",
      groups: [],
      loading: false,
      needBackfill: false,
      selArr: [],
      lastClickIdx: -1,
      ctxMenu: { show: false, item: null, x: 0, y: 0 },
      confirmDelete: { show: false, id: null, name: "" },
      lasso: null,
      lassoStyle: {},
      _lassoStart: null,
    };
  },
  computed: {
    typeLabel() {
      return { exact: "重复", near: "酷似", similar: "相似", cluster: "聚类" }[this.dupType] || "相似";
    },
    flatItems() {
      const items = [];
      for (const g of this.groups) {
        for (const item of g.items) {
          items.push(item);
        }
      }
      return items;
    },
  },
  methods: {
    API,
    goBack() { location.hash = "#/gallery"; },
    openDetail(id) { location.hash = "#/detail/" + id; },
    switchType(type) {
      this.dupType = type;
      this.selArr = [];
      this.loadGroups();
    },
    onThumbClick(item, e) {
      const idx = this.flatItems.findIndex(i => i.id === item.id);
      if (e.shiftKey && this.lastClickIdx >= 0) {
        const from = Math.min(this.lastClickIdx, idx);
        const to = Math.max(this.lastClickIdx, idx);
        this.selArr = this.flatItems.slice(from, to + 1).map(i => i.id);
      } else if (e.ctrlKey || e.metaKey) {
        const arr = [...this.selArr];
        const i = arr.indexOf(item.id);
        if (i >= 0) arr.splice(i, 1); else arr.push(item.id);
        this.selArr = arr;
        this.lastClickIdx = idx;
      } else {
        this.selArr = [item.id];
        this.lastClickIdx = idx;
      }
    },
    showCtx(e, item) {
      if (!this.selArr.includes(item.id)) this.selArr = [item.id];
      this.ctxMenu.item = item;
      this.ctxMenu.x = e.clientX;
      this.ctxMenu.y = e.clientY;
      this.ctxMenu.show = true;
    },
    closeCtx() {
      this.ctxMenu.show = false;
    },
    deleteCtx() {
      if (this.selArr.length > 1) {
        this.confirmDelete = { show: true, id: null, name: this.selArr.length + ' 个素材' };
      } else {
        const id = this.selArr[0];
        const m = this.flatItems.find(i => i.id === id);
        this.confirmDelete = { show: true, id, name: m ? m.file_name : "" };
      }
    },
    async doDelete() {
      const ids = this.confirmDelete.id ? [this.confirmDelete.id] : [...this.selArr];
      this.confirmDelete.show = false;
      try {
        await API.batchUpdate({ action: "delete", ids });
        Quasar.Notify.create({ message: `已移除 ${ids.length} 个素材`, position: 'top', timeout: 1500 });
        this.selArr = [];
        await this.loadGroups();
      } catch (e) {
        Quasar.Notify.create({ message: '移除失败: ' + (e.message || e), position: 'top', color: 'negative', timeout: 2000 });
      }
    },
    startLasso(e) {
      if (e.button !== 0) return;
      this.closeCtx();
      this._lassoStart = { x: e.clientX, y: e.clientY };
      this._onLassoMove = (ev) => this.onLassoMove(ev);
      this._onLassoUp = (ev) => this.onLassoUp(ev);
      document.addEventListener("mousemove", this._onLassoMove);
      document.addEventListener("mouseup", this._onLassoUp);
    },
    onLassoMove(e) {
      if (!this._lassoStart) return;
      const dx = e.clientX - this._lassoStart.x;
      const dy = e.clientY - this._lassoStart.y;
      if (!this.lasso && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      if (!this.lasso) this.lasso = true;
      const l = Math.min(this._lassoStart.x, e.clientX);
      const t = Math.min(this._lassoStart.y, e.clientY);
      this.lassoStyle = {
        left: l + "px", top: t + "px",
        width: Math.abs(dx) + "px", height: Math.abs(dy) + "px",
      };
    },
    onLassoUp(e) {
      document.removeEventListener("mousemove", this._onLassoMove);
      document.removeEventListener("mouseup", this._onLassoUp);
      if (!this.lasso) {
        this.selArr = [];
      } else {
        const r = { l: Math.min(this._lassoStart.x, e.clientX), t: Math.min(this._lassoStart.y, e.clientY),
                    r: Math.max(this._lassoStart.x, e.clientX), b: Math.max(this._lassoStart.y, e.clientY) };
        const ids = [];
        const thumbs = document.querySelectorAll(".dup-thumb[data-id]");
        thumbs.forEach(el => {
          const br = el.getBoundingClientRect();
          if (br.left < r.r && br.right > r.l && br.top < r.b && br.bottom > r.t) {
            ids.push(parseInt(el.dataset.id));
          }
        });
        this.selArr = ids;
      }
      this.lasso = null;
      this.lassoStyle = {};
      this._lassoStart = null;
    },
    handleKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      if (this.$root.currentView !== "duplicates") return;
      const key = e.key;
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(key)) {
        e.preventDefault(); e.stopPropagation();
        if (!this.flatItems.length) return;
        if (!this.selArr.length) { this.selArr = [this.flatItems[0].id]; return; }
        const lastId = this.selArr[this.selArr.length - 1];
        const idx = this.flatItems.findIndex(i => i.id === lastId);
        let ni = idx;
        if (key === "ArrowRight") ni = Math.min(idx + 1, this.flatItems.length - 1);
        else if (key === "ArrowLeft") ni = Math.max(idx - 1, 0);
        else if (key === "ArrowDown") ni = Math.min(idx + 1, this.flatItems.length - 1);
        else if (key === "ArrowUp") ni = Math.max(idx - 1, 0);
        if (ni !== idx) this.selArr = [this.flatItems[ni].id];
        this.$nextTick(() => {
          const el = document.querySelector(`.dup-thumb[data-id="${this.flatItems[ni]?.id}"]`);
          el?.scrollIntoView({ block: "nearest", behavior: "smooth" });
        });
        return;
      }
      if (key === "Enter" && this.selArr.length === 1) {
        e.preventDefault(); e.stopPropagation();
        this.openDetail(this.selArr[0]);
        return;
      }
      if (key === "Backspace") {
        e.preventDefault(); e.stopPropagation();
        this.goBack();
        return;
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
        const res = await API.backfillEmbeddings();
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
        const res = await API.backfillEmbeddings();
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
    this._onKey = (e) => this.handleKey(e);
    document.addEventListener("keydown", this._onKey);
    this._onCloseCtx = (e) => {
      if (!this.ctxMenu.show) return;
      if (e.target.closest(".ctx-menu-popup")) return;
      this.ctxMenu.show = false;
    };
    document.addEventListener("mousedown", this._onCloseCtx);
  },
  beforeUnmount() {
    if (this._onKey) document.removeEventListener("keydown", this._onKey);
    if (this._onCloseCtx) document.removeEventListener("mousedown", this._onCloseCtx);
  },
};
