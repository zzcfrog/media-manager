const WorkbenchPage = {
  props: ["projectId"],
  template: `
<div class="wb-container">
  <!-- Toolbar -->
  <div class="wb-toolbar">
    <div style="display:flex;align-items:center;gap:8px">
      <q-btn flat round dense icon="arrow_back" size="sm" color="grey-6" @click="$root.nav('#/gallery')"></q-btn>
      <span v-if="project" style="font-size:15px;font-weight:500">{{ project.name }}</span>
      <span v-if="project && project.description" style="font-size:12px;color:var(--text3);margin-left:8px">{{ project.description }}</span>
    </div>
    <div style="display:flex;align-items:center;gap:4px">
      <q-btn v-if="project" flat round dense icon="delete" size="sm" color="grey-6" @click="deleteProject">
        <q-tooltip>{{ t('wb.delete_project') }}</q-tooltip>
      </q-btn>
    </div>
  </div>

  <!-- Main area -->
  <div v-if="loading" style="display:flex;align-items:center;justify-content:center;flex:1">
    <q-spinner size="32px" color="primary"></q-spinner>
  </div>
  <div v-else-if="project" class="wb-main">
    <!-- Left: Material panel -->
    <div class="wb-material">
      <div class="wb-material-header">
        {{ t('wb.material') }}
        <span style="font-size:11px;color:var(--text3);margin-left:4px">{{ segments.length }}</span>
        <q-btn flat round dense icon="add" size="xs" color="primary" style="margin-left:auto"
               @click="openMediaPicker">
          <q-tooltip>{{ t('wb.add_media') }}</q-tooltip>
        </q-btn>
      </div>
      <div class="wb-material-list">
        <div v-if="!segments.length" class="wb-empty-material">{{ t('wb.no_segments') }}</div>
        <div v-for="seg in segments" :key="seg.id" class="wb-seg-card"
             :class="{ selected: selectedSegment && selectedSegment.id === seg.id }"
             @click="selectedSegment = seg">
          <img :src="'/media/thumbnail/' + seg.media_id" class="wb-seg-thumb" loading="lazy">
          <div class="wb-seg-info">
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              <span v-if="seg.mood" class="wb-seg-tag">{{ seg.mood }}</span>
              <span v-if="seg.shot_type" class="wb-seg-tag">{{ seg.shot_type }}</span>
            </div>
            <div class="wb-seg-time">{{ seg.time_start }} - {{ seg.time_end }}</div>
            <div class="wb-seg-source">{{ seg.file_name }}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- Right: Tracks -->
    <div class="wb-tracks">
      <div v-for="tt in trackTypes" :key="tt.key" class="wb-track-row">
        <div class="wb-track-label">{{ t('wb.track_' + tt.key) }}</div>
        <div class="wb-track-content">
          <template v-if="getTrackItems(tt.key).length">
            <div v-for="item in getTrackItems(tt.key)" :key="item.id" class="wb-track-item"
                 :class="'wb-track-' + tt.key">
              <template v-if="tt.key === 'video'">
                <img v-if="item._segment" :src="'/media/thumbnail/' + item._segment.media_id" class="wb-track-thumb">
                <span>{{ item._segment ? (item._segment.mood || item._segment.shot_type || '...') : '?' }}</span>
              </template>
              <template v-else-if="tt.key === 'emotion'">
                <span style="font-size:11px">{{ item.emotion_value?.toFixed(2) }}</span>
              </template>
              <template v-else>
                <span style="font-size:12px">{{ item.content || '...' }}</span>
              </template>
            </div>
          </template>
          <div v-else class="wb-track-empty">
            <span v-if="tt.key === 'video'" style="font-size:12px;color:var(--text3)">{{ t('wb.empty_hint') }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>

  <!-- Status bar -->
  <div class="wb-statusbar">
    <span>{{ t('wb.total_duration') }}：{{ totalDuration }}</span>
    <span>{{ t('wb.segment_count') }}：{{ videoTrackCount }}</span>
  </div>

  <!-- Media picker dialog -->
  <q-dialog v-model="showMediaPicker" maximized>
    <q-card style="background:var(--bg)" class="dialog-card">
      <div class="wb-picker-toolbar">
        <div style="display:flex;align-items:center;gap:8px">
          <q-btn flat round dense icon="close" size="sm" color="grey-6" @click="showMediaPicker=false"></q-btn>
          <span style="font-size:14px;font-weight:500">{{ t('wb.add_media') }}</span>
          <span v-if="pickerSelected.length" style="font-size:12px;color:var(--accent)">
            {{ t('wb.media_selected', {n: pickerSelected.length}) }}
          </span>
        </div>
        <!-- Filters -->
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <q-select v-model="pickerFilter.type" :options="pickerTypeOptions" dense outlined emit-value map-options
                    style="min-width:80px;width:80px" @update:model-value="loadPickerMedia"></q-select>
          <q-select v-model="pickerFilter.analysis_status" :options="pickerAnalysisOptions" dense outlined emit-value map-options
                    style="min-width:90px;width:90px" @update:model-value="loadPickerMedia"></q-select>
          <q-input v-model="pickerFilter.q" dense outlined :placeholder="t('g.search')" clearable
                   style="width:160px" @keyup.enter="loadPickerMedia" @clear="loadPickerMedia"></q-input>
          <q-select v-model="pickerSort" :options="pickerSortOptions" dense outlined emit-value map-options
                    style="min-width:100px;width:100px" @update:model-value="loadPickerMedia"></q-select>
        </div>
        <div style="display:flex;align-items:center;gap:4px">
          <q-btn flat dense :label="t('g.select_all')" size="12px" @click="selectAllPicker"></q-btn>
          <q-btn color="primary" :label="t('wb.confirm_add')" dense
                 :disable="!pickerSelected.length" @click="confirmAddMedia"></q-btn>
        </div>
      </div>

      <!-- Media grid -->
      <div class="wb-picker-grid" @scroll.passive="onPickerScroll">
        <div v-for="m in pickerMedia" :key="m.id" class="wb-picker-item"
             :class="{ selected: pickerSelected.includes(m.id) }"
             @click="togglePickerSelect(m.id)">
          <img :src="'/media/thumbnail/' + m.id" loading="lazy">
          <div class="wb-picker-overlay">
            <q-icon :name="pickerSelected.includes(m.id) ? 'check_circle' : 'radio_button_unchecked'"
                    :color="pickerSelected.includes(m.id) ? 'primary' : 'white'" size="22px"></q-icon>
          </div>
          <div class="wb-picker-name">{{ m.file_name }}</div>
          <div class="wb-picker-badges">
            <span v-if="m.analysis_status==='done'" style="color:var(--accent)">AI</span>
            <span v-if="m.favorite" style="color:#ff5555">♥</span>
            <span v-if="m.rating" style="color:var(--text3)">{{ '★'.repeat(m.rating) }}</span>
          </div>
        </div>
        <div v-if="pickerLoading" style="padding:20px;text-align:center">
          <q-spinner size="24px" color="primary"></q-spinner>
        </div>
        <div v-if="!pickerLoading && !pickerMedia.length" style="padding:40px;text-align:center;color:var(--text3);font-size:13px">
          {{ t('wb.media_empty') }}
        </div>
      </div>
    </q-card>
  </q-dialog>
</div>
  `,

  data() {
    return {
      project: null,
      segments: [],
      tracks: [],
      loading: true,
      selectedSegment: null,
      trackTypes: [
        { key: "theme" },
        { key: "emotion" },
        { key: "narration" },
        { key: "subtitle" },
        { key: "text" },
        { key: "video" },
      ],
      // Media picker state
      showMediaPicker: false,
      pickerMedia: [],
      pickerSelected: [],
      pickerLoading: false,
      pickerAllLoaded: false,
      pickerPage: 1,
      pickerFilter: { type: "all", analysis_status: "all", q: "" },
      pickerSort: "imported_at",
      pickerSortOptions: [
        { value: "imported_at", label: "导入时间" },
        { value: "date_taken", label: "拍摄时间" },
        { value: "file_name", label: "名称" },
        { value: "rating", label: "评分" },
        { value: "duration", label: "时长" },
      ],
    };
  },

  computed: {
    t() { return t; },
    totalDuration() {
      const videoItems = this.getTrackItems("video");
      if (!videoItems.length) return "00:00";
      let total = 0;
      for (const item of videoItems) {
        total += this._parseDuration(item.time_start, item.time_end);
      }
      const m = Math.floor(total / 60);
      const s = Math.floor(total % 60);
      return `${m}:${String(s).padStart(2, "0")}`;
    },
    videoTrackCount() {
      return this.getTrackItems("video").length;
    },
    pickerTypeOptions() {
      return [
        { value: "all", label: t("g.all") },
        { value: "video", label: t("g.videos") },
        { value: "image", label: t("g.images") },
      ];
    },
    pickerAnalysisOptions() {
      return [
        { value: "all", label: t("g.all") },
        { value: "done", label: t("g.analyzed") },
        { value: "none", label: t("g.not_analyzed") },
      ];
    },
  },

  watch: {
    projectId() { this.load(); },
  },

  created() {
    this.load();
  },

  methods: {
    async load() {
      if (!this.projectId) return;
      this.loading = true;
      try {
        const [projRes, segRes, trackRes] = await Promise.all([
          API.getProject(this.projectId),
          API.getProjectSegments(this.projectId),
          API.getProjectTracks(this.projectId),
        ]);
        this.project = projRes.data;
        this.segments = segRes.data;
        this.tracks = trackRes.data;
        for (const tr of this.tracks) {
          if (tr.segment_id) {
            tr._segment = this.segments.find(s => s.id === tr.segment_id) || null;
          }
        }
      } catch (e) {
        console.error(e);
        Quasar.Notify.create({ message: e.message, color: "negative", position: "top" });
      }
      this.loading = false;
    },
    getTrackItems(trackType) {
      return this.tracks.filter(tr => tr.track_type === trackType);
    },
    _parseDuration(start, end) {
      const toSec = (t) => {
        if (!t) return 0;
        const parts = t.split(":").map(Number);
        if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
        if (parts.length === 2) return parts[0] * 60 + parts[1];
        return 0;
      };
      return Math.max(0, toSec(end) - toSec(start));
    },
    async deleteProject() {
      if (!this.project) return;
      Quasar.Dialog.create({
        title: t("wb.delete_project"),
        message: t("wb.confirm_delete", { name: this.project.name }),
        cancel: true,
        persistent: false,
      }).onOk(async () => {
        await API.deleteProject(this.project.id);
        await this.$root.loadProjects();
        location.hash = "#/gallery";
      });
    },

    // ── Media picker ──────────────────────────────

    async openMediaPicker() {
      this.pickerSelected = [];
      this.pickerMedia = [];
      this.pickerPage = 1;
      this.pickerAllLoaded = false;
      this.showMediaPicker = true;
      // Pre-select media already in project
      const existingIds = new Set(this.project.media.map(m => m.id));
      this.pickerSelected = [...existingIds];
      await this.loadPickerMedia();
    },
    async loadPickerMedia(reset) {
      if (reset) {
        this.pickerPage = 1;
        this.pickerMedia = [];
        this.pickerAllLoaded = false;
      }
      this.pickerLoading = true;
      try {
        const params = {
          page: this.pickerPage,
          per_page: 60,
          sort: this.pickerSort,
          order: "DESC",
        };
        if (this.pickerFilter.type && this.pickerFilter.type !== "all") params.media_type = this.pickerFilter.type;
        if (this.pickerFilter.analysis_status && this.pickerFilter.analysis_status !== "all") params.analysis_status = this.pickerFilter.analysis_status;
        if (this.pickerFilter.q) params.q = this.pickerFilter.q;
        const res = await API.getLibrary(params);
        const data = res.data || [];
        if (reset || this.pickerPage === 1) {
          this.pickerMedia = data;
        } else {
          this.pickerMedia = [...this.pickerMedia, ...data];
        }
        this.pickerAllLoaded = data.length < 60;
      } catch (e) { console.error(e); }
      this.pickerLoading = false;
    },
    onPickerScroll(e) {
      if (this.pickerAllLoaded || this.pickerLoading) return;
      const el = e.target;
      if (el.scrollHeight - el.scrollTop - el.clientHeight < 200) {
        this.pickerPage++;
        this.loadPickerMedia();
      }
    },
    togglePickerSelect(id) {
      const idx = this.pickerSelected.indexOf(id);
      if (idx >= 0) this.pickerSelected.splice(idx, 1);
      else this.pickerSelected.push(id);
    },
    selectAllPicker() {
      const visibleIds = this.pickerMedia.map(m => m.id);
      const allSelected = visibleIds.every(id => this.pickerSelected.includes(id));
      if (allSelected) {
        this.pickerSelected = this.pickerSelected.filter(id => !visibleIds.includes(id));
      } else {
        const set = new Set(this.pickerSelected);
        for (const id of visibleIds) set.add(id);
        this.pickerSelected = [...set];
      }
    },
    async confirmAddMedia() {
      try {
        await API.updateProjectMedia(this.projectId, this.pickerSelected);
        this.showMediaPicker = false;
        await this.load();
        await this.$root.loadProjects();
      } catch (e) {
        Quasar.Notify.create({ message: e.message, color: "negative", position: "top" });
      }
    },
  },
};
