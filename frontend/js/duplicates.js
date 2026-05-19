const DuplicatesPage = {
  template: `
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative"
       @mousedown="startLasso" @contextmenu.prevent>
    <div class="filter-bar" @mousedown.stop>
      <q-btn flat dense icon="arrow_back" label="返回" color="grey-6" style="border-radius:6px;padding:3px 6px;font-size:13px" @click="goBack"></q-btn>
      <q-btn-group unelevated style="border-radius:6px;overflow:hidden">
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
      <div ref="groupContainer" style="padding:16px 20px;display:flex;flex-direction:column;gap:12px">
        <div v-for="(g, gi) in groups" :key="gi" class="dup-group">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
            <span class="dup-badge">{{ g.items.length }}</span>
            <span style="font-size:12px;color:var(--text2)">个{{ typeLabel }}文件</span>
            <span v-if="dupType !== 'exact' && g.similarity != null" style="font-size:11px;color:var(--accent)">相似度 {{ g.similarity }}%</span>
            <q-btn v-if="g.excluded?.length" flat dense no-caps icon="restore" :label="'恢复排除 (' + g.excluded.length + ')'" color="grey-6" size="sm" @click="openRestoreDialog(g)" style="font-size:11px;border:1px solid var(--border);border-radius:6px;margin-left:4px"></q-btn>
          </div>
          <div class="dup-grid">
            <div v-for="item in g.items" :key="item.id"
                 class="dup-card"
                 :class="{selected: selArr.includes(item.id)}"
                 :data-id="item.id"
                 @mousedown.stop
                 @click="onThumbClick(item, $event)"
                 @dblclick.stop="openDetail(item.id)"
                 @contextmenu.prevent="showCtx($event, item)">
              <div v-if="selArr.includes(item.id)" class="sel-overlay"></div>
              <div class="dup-card-img">
                <img :src="'/media/thumbnail/' + item.id" draggable="false" @load="onThumbLoad">
                <button class="dup-exclude-btn" title="排除" @click.stop="openExcludeDialog(item, g)">✕</button>
              </div>
              <div class="dup-card-info">
                <span class="dup-card-name" :title="item.file_name">{{ item.file_name }}</span>
                <span class="dup-card-size">{{ fmtSize(item.file_size) }}</span>
              </div>
              <q-tooltip :delay="800" :offset="[0, 4]">{{ item.file_path }}</q-tooltip>
            </div>
          </div>
        </div>
      </div>
    </q-scroll-area>
    <q-dialog v-model="restoreDlg.show" persistent>
      <q-card style="min-width:560px;max-width:780px" class="dialog-card">
        <q-btn flat round dense icon="close" size="sm" color="grey-6" class="dialog-close" @click="restoreDlg.show=false"></q-btn>
        <q-card-section>
          <div class="text-h6" style="font-size:16px">恢复排除</div>
          <div style="font-size:12px;color:var(--text3);margin-top:4px">以下照片曾从本分组中排除，勾选需要恢复的配对</div>
        </q-card-section>
        <q-card-section style="max-height:480px;overflow-y:auto">
          <div style="display:flex;flex-direction:column;gap:10px">
            <div v-for="(row, ri) in restoreDlg.items" :key="ri"
                 style="display:flex;align-items:center;gap:14px;padding:10px 12px;border-radius:8px;border:1px solid var(--border)">
              <img :src="'/media/thumbnail/' + row.excluded_id" style="width:86px;height:86px;object-fit:cover;border-radius:6px;flex-shrink:0">
              <div style="flex:1;display:flex;gap:6px;flex-wrap:wrap;align-items:center">
                <div v-for="(p, pi) in row.pairs" :key="pi"
                     style="position:relative;cursor:pointer"
                     @click="p.selected = !p.selected">
                  <img :src="'/media/thumbnail/' + p.with_id" class="restore-pair-thumb"
                       :style="{ outline: p.selected ? '2px solid var(--accent)' : '2px solid transparent', outlineOffset: '-2px' }">
                  <q-checkbox v-model="p.selected" dense style="position:absolute;bottom:-4px;left:0;transform:scale(0.7)" @click.stop></q-checkbox>
                  <q-tooltip :delay="600" :offset="[0, 4]">{{ p.with_name }}</q-tooltip>
                </div>
              </div>
              <q-btn flat dense no-caps icon="restore" label="恢复排重" color="primary" size="sm"
                     :disable="!row.pairs.some(p => p.selected)"
                     @click="doRestoreRow(row)"
                     style="flex-shrink:0;font-size:11px;border:1px solid var(--border);border-radius:6px"></q-btn>
            </div>
          </div>
        </q-card-section>
        <q-card-actions align="right" style="padding:12px 16px">
          <q-btn flat label="关闭" @click="restoreDlg.show=false"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
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
        <q-item clickable @click="closeCtx(); excludeCtx()" :disable="!canExcludeFromGroup" style="padding-left:8px;padding-right:12px">
          <q-item-section avatar style="min-width:24px;padding-right:8px"><q-icon name="group_remove" size="14px" :color="canExcludeFromGroup ? 'grey-6' : 'grey-9'"></q-icon></q-item-section>
          <q-item-section>移出本{{ typeLabel }}组</q-item-section>
          <q-tooltip v-if="!canExcludeFromGroup" :delay="0">选中的素材不在同一分组</q-tooltip>
        </q-item>
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
          <div class="text-h6">确认移出素材库</div>
        </q-card-section>
        <q-card-section>
          <p class="text-body2">确定要移除「{{ confirmDelete.name }}」吗？</p>
          <p class="text-caption text-grey-6">原文件不会被删除，仅清除库中的记录。</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat label="取消" @click="confirmDelete.show=false"></q-btn>
          <q-btn color="red" label="移出素材库" @click="doDelete"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
    <q-dialog v-model="excludeDlg.show" persistent>
      <q-card style="min-width:560px;max-width:700px" class="dialog-card">
        <q-btn flat round dense icon="close" size="sm" color="grey-6" class="dialog-close" @click="excludeDlg.show=false"></q-btn>
        <q-card-section>
          <div class="text-h6" style="font-size:16px">移出本{{ typeLabel }}组</div>
          <div style="font-size:12px;color:var(--text3);margin-top:4px">选择与当前照片<b>不相似</b>的照片，排除后不会出现在同一分组中</div>
        </q-card-section>
        <q-card-section>
          <div style="display:flex;gap:16px;align-items:flex-start">
            <div style="flex-shrink:0;text-align:center">
              <img :src="'/media/thumbnail/' + excludeDlg.item?.id"
                   style="width:140px;height:140px;object-fit:cover;border-radius:8px;border:2px solid var(--accent)">
              <div style="margin-top:6px;font-size:11px;color:var(--text2);max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ excludeDlg.item?.file_name }}</div>
              <div style="font-size:10px;color:var(--text3)">当前照片</div>
            </div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <span style="font-size:12px;color:var(--text2)">以下哪些与它不相似？<span style="color:var(--text3);margin-left:4px">共 {{ excludeDlg.candidates.length }} 张</span></span>
                <q-btn flat dense size="sm" :label="excludeDlg.candidates.every(c => c.selected) ? '取消全选' : '全选'" color="primary" no-caps @click="excludeSelectAll" style="font-size:12px"></q-btn>
              </div>
              <div class="exclude-scroll-wrap">
                <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px;padding:4px">
                  <div v-for="c in excludeDlg.candidates" :key="c.item.id"
                       style="cursor:pointer;border-radius:6px;overflow:hidden;border:2px solid transparent;transition:border-color .15s"
                       :style="c.selected ? 'border-color:var(--negative)' : 'border-color:var(--border)'"
                       @click="c.selected = !c.selected">
                    <img :src="'/media/thumbnail/' + c.item.id" style="width:100%;aspect-ratio:1;object-fit:cover;display:block">
                    <div style="font-size:10px;color:var(--text3);padding:2px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">{{ c.item.file_name }}</div>
                  </div>
                </div>
                <div v-if="excludeHasMore" class="exclude-scroll-hint">↓ 向下滚动查看更多</div>
              </div>
            </div>
          </div>
        </q-card-section>
        <q-card-actions align="right" style="padding:12px 16px">
          <q-btn flat label="取消" @click="excludeDlg.show=false"></q-btn>
          <q-btn color="primary" :label="'排除 ' + excludeSelectedCount + ' 张'" :disable="excludeSelectedCount === 0" @click="doExclude"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
    <div v-if="lasso" class="lasso" :style="lassoStyle"></div>
  </div>
  `,
  data() {
    return {
      dupType: "near",
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
      excludeDlg: { show: false, item: null, group: null, candidates: [] },
      restoreDlg: { show: false, group: null, items: [] },
    };
  },
  computed: {
    typeLabel() {
      return { near: "酷似", similar: "相似", cluster: "聚类" }[this.dupType] || "相似";
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
    excludeSelectedCount() {
      return this.excludeDlg.candidates.filter(c => c.selected).length;
    },
    excludeHasMore() {
      return this.excludeDlg.candidates.length > 6;
    },
    canExcludeFromGroup() {
      if (!this.selArr.length) return false;
      // All selected items must be in the same group
      const ids = new Set(this.selArr);
      for (const g of this.groups) {
        const gids = new Set(g.items.map(i => i.id));
        if ([...ids].every(id => gids.has(id))) return true;
      }
      return false;
    },
  },
  methods: {
    API,
    fmtSize,
    onThumbLoad,
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
    excludeCtx() {
      // Find the group containing the selected item(s)
      const id = this.ctxMenu.item.id;
      const group = this.groups.find(g => g.items.some(i => i.id === id));
      if (!group) return;
      if (this.selArr.length === 1) {
        // Single select → open the dialog for fine-grained selection
        const item = group.items.find(i => i.id === id);
        this.openExcludeDialog(item, group);
      } else {
        // Multi-select → directly exclude all selected items from the group
        const otherIds = group.items.filter(i => !this.selArr.includes(i.id)).map(i => i.id);
        const pairs = [];
        for (const sid of this.selArr) {
          for (const oid of otherIds) {
            pairs.push([sid, oid]);
          }
        }
        this._doExcludePairs(pairs, this.selArr.length);
      }
    },
    async _doExcludePairs(pairs, count) {
      try {
        await API.addDupExclusions(pairs, this.dupType);
        Quasar.Notify.create({ message: `已排除 ${count} 张照片`, position: 'top', timeout: 1500 });
        this.selArr = [];
        await this.loadGroups();
      } catch (e) {
        Quasar.Notify.create({ message: '排除失败: ' + (e.message || e), position: 'top', color: 'negative', timeout: 2000 });
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
        const thumbs = document.querySelectorAll(".dup-card[data-id]");
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
    openExcludeDialog(item, group) {
      const candidates = group.items
        .filter(i => i.id !== item.id)
        .map(i => ({ item: i, selected: false }));
      this.excludeDlg = { show: true, item, group, candidates };
    },
    excludeSelectAll() {
      const allSelected = this.excludeDlg.candidates.every(c => c.selected);
      this.excludeDlg.candidates.forEach(c => { c.selected = !allSelected; });
    },
    async doExclude() {
      const selectedIds = this.excludeDlg.candidates.filter(c => c.selected).map(c => c.item.id);
      if (!selectedIds.length) return;
      const sourceId = this.excludeDlg.item.id;
      const pairs = selectedIds.map(id => [sourceId, id]);
      this.excludeDlg.show = false;
      await this._doExcludePairs(pairs, 1);
    },
    openRestoreDialog(group) {
      const idToName = {};
      for (const item of group.items) idToName[item.id] = item.file_name;
      const excludedMap = {};
      for (const e of (group.excluded || [])) {
        if (!excludedMap[e.id]) {
          excludedMap[e.id] = { excluded_id: e.id, excluded_name: e.file_name, pairs: [] };
        }
        for (const withId of e.excluded_with) {
          excludedMap[e.id].pairs.push({ with_id: withId, with_name: idToName[withId] || '', selected: true });
        }
      }
      this.restoreDlg = { show: true, group, items: Object.values(excludedMap) };
    },
    async doRestoreRow(row) {
      const selected = row.pairs.filter(p => p.selected);
      if (!selected.length) return;
      const pairs = selected.map(p => [row.excluded_id, p.with_id]);
      try {
        await API.removeDupExclusionPairs(pairs, this.dupType);
        Quasar.Notify.create({ message: `已恢复 ${selected.length} 对排除`, position: 'top', timeout: 1500 });
        this.restoreDlg.items = this.restoreDlg.items.filter(i => i !== row);
        if (!this.restoreDlg.items.length) this.restoreDlg.show = false;
        await this.loadGroups();
      } catch (e) {
        Quasar.Notify.create({ message: '恢复失败: ' + (e.message || e), position: 'top', color: 'negative', timeout: 2000 });
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
