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
  <template v-else-if="project">

    <!-- Top: Material (left) + Preview (right) -->
    <div class="wb-top">
      <!-- Left: Material panel -->
      <div class="wb-material">
        <div class="wb-mat-toolbar">
          <q-input v-model="matSearch" dense filled clearable
                   :placeholder="'共' + filteredMedia.length + '个素材，搜索试试看'"
                   class="wb-mat-search"
                   @keyup.enter="searchMedia">
            <template v-slot:prepend><q-icon name="search" size="14px"></q-icon></template>
          </q-input>
          <q-btn-group unelevated>
            <q-btn unelevated dense size="sm" label="ALL"
                   :class="{'mat-type-active': matType===''}"
                   @click="matType=''">
              <q-tooltip :delay="1000">{{ t('wb.all') }}</q-tooltip>
            </q-btn>
            <q-btn unelevated dense size="sm" icon="image"
                   :class="{'mat-type-active': matType==='image'}"
                   @click="matType='image'">
              <q-tooltip :delay="1000">{{ t('wb.type_image') }}</q-tooltip>
            </q-btn>
            <q-btn unelevated dense size="sm" icon="smart_display"
                   :class="{'mat-type-active': matType==='video'}"
                   @click="matType='video'">
              <q-tooltip :delay="1000">{{ t('wb.type_video') }}</q-tooltip>
            </q-btn>
          </q-btn-group>
          <div class="sort-group wb-mat-sort-group">
            <q-select v-model="matSort" dense filled flat
                      :options="matSortOptions" emit-value map-options
                      popup-content-class="wb-mat-sort-popup"></q-select>
            <q-btn flat dense :icon="matSortOrder==='desc' ? 'arrow_downward' : 'arrow_upward'"
                   color="grey-6" size="sm" @click="matSortOrder=matSortOrder==='desc'?'asc':'desc'"></q-btn>
          </div>
          <q-btn flat round dense icon="add_circle_outline" size="xs" style="color:var(--accent);flex-shrink:0"
                 @click="openMediaPicker">
            <q-tooltip>{{ t('wb.add_media') }}</q-tooltip>
          </q-btn>
        </div>
        <div class="wb-material-list wb-mat-grid" :style="{'grid-template-columns': 'repeat('+matCols+',1fr)'}">
          <div v-if="!project.media || !project.media.length" class="wb-empty-material" style="grid-column:1/-1">{{ t('wb.no_segments') }}</div>
          <div v-else-if="!filteredMedia.length" class="wb-empty-material" style="grid-column:1/-1">{{ t('wb.no_match') }}</div>
          <div v-for="m in filteredMedia" :key="m.id" class="wb-mat-card"
               :class="{ selected: selectedMedia && selectedMedia.id === m.id }"
               @click="selectedMedia = m">
            <img :src="'/media/thumbnail/' + m.id" class="wb-mat-thumb" loading="lazy">
            <div class="wb-mat-overlay">
              <div class="wb-mat-meta">
                <span v-if="m.duration">{{ fmtDur(m.duration) }}</span>
                <span>{{ mediaSegments(m.id).length }} {{ t('wb.seg_unit') }}</span>
              </div>
              <div class="wb-mat-name" :title="m.file_name">{{ m.file_name }}</div>
            </div>
          </div>
        </div>
        <div class="wb-mat-footer">
          <span style="font-size:10px;color:var(--text3);margin-right:8px;min-width:24px;text-align:right">{{ matCols }}列</span>
          <q-slider v-model="matCols" :min="2" :max="4" :step="1"
                    style="width:90px;--q-primary:var(--accent);padding:0 10px" color="primary"></q-slider>
        </div>
      </div>

      <!-- Right: Preview -->
      <div class="wb-preview">
        <template v-if="selectedMedia">
          <!-- Left: player area -->
          <div class="wb-preview-left">
            <!-- Video -->
            <template v-if="selectedMedia.media_type === 'video'">
              <div class="img-meta-bar">
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.video') }}</div>
                  <div style="display:flex;gap:14px;align-items:flex-start">
                    <div class="meta-grid" style="gap:4px 14px">
                      <span class="meta-label">{{ t('d.resolution') }}</span><span>{{ selectedMedia.width }}x{{ selectedMedia.height }}</span>
                      <span class="meta-label">{{ t('d.duration') }}</span><span>{{ fmtDur(selectedMedia.duration) }}</span>
                      <span class="meta-label">{{ t('d.codec') }}</span><span>{{ selectedMedia.video_codec }}<template v-if="selectedMedia.video_profile"> ({{ selectedMedia.video_profile }})</template></span>
                    </div>
                    <div class="meta-grid" style="gap:4px 14px">
                      <span class="meta-label">{{ t('d.fps') }}</span><span>{{ fmtFps(selectedMedia.fps) }}</span>
                      <span class="meta-label">{{ t('d.bitrate') }}</span><span v-if="selectedMedia.bit_rate">{{ (selectedMedia.bit_rate / 1000000).toFixed(1) }} Mbps</span><span v-else>-</span>
                      <span class="meta-label">{{ t('d.color_space') }}</span><span>{{ selectedMedia.color_space || '-' }}</span>
                    </div>
                  </div>
                </div>
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.audio') }}</div>
                  <div class="meta-grid" style="gap:4px 14px">
                    <template v-if="selectedMedia.audio_codec">
                      <span class="meta-label">{{ t('d.codec') }}</span><span>{{ selectedMedia.audio_codec }}</span>
                      <span class="meta-label">{{ t('d.sample_rate') }}</span><span v-if="selectedMedia.audio_sample_rate">{{ (selectedMedia.audio_sample_rate / 1000).toFixed(1) }} kHz</span><span v-else>-</span>
                      <span class="meta-label">{{ t('d.channels') }}</span><span>{{ selectedMedia.audio_channels === 1 ? t('d.mono') : selectedMedia.audio_channels === 2 ? t('d.stereo') : t('d.ch_n', {n: selectedMedia.audio_channels || '-'}) }}</span>
                    </template>
                    <template v-else><span style="color:var(--text3)">{{ t('d.no_audio') }}</span></template>
                  </div>
                </div>
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.camera_info') }}</div>
                  <div class="meta-grid" style="gap:4px 14px">
                    <span class="meta-label">{{ t('d.make') }}</span><span>{{ selectedMedia.camera_make || '-' }}</span>
                    <span class="meta-label">{{ t('d.model') }}</span><span>{{ selectedMedia.camera_model || '-' }}</span>
                    <span class="meta-label">{{ t('d.lens') }}</span><span>{{ selectedMedia.lens_model || '-' }}</span>
                  </div>
                </div>
              </div>
              <div style="flex:1;position:relative;min-height:0">
                <video ref="wbPlayer" :key="selectedMedia.id" :src="'/media/video/' + selectedMedia.id"
                       style="width:100%;height:100%;background:#000" controls preload="auto"
                       @loadeddata="onWbVideoLoaded" @play="onWbVideoPlay" @pause="onWbVideoPause" @seeked="onWbVideoSeeked"></video>
              </div>
              <div class="waveform-wrap" ref="wbWaveformWrap" @click="onWbWaveformClick">
                <canvas ref="wbWfCanvas"></canvas>
              </div>
              <div class="scopes-row" ref="wbScopesRow">
                <div class="scope-box"><canvas ref="wbScopeWf"></canvas><span class="scope-label">Waveform</span></div>
                <div class="scope-box"><canvas ref="wbScopePr"></canvas><span class="scope-label">Parade</span></div>
                <div class="scope-box"><canvas ref="wbScopeVt"></canvas><span class="scope-label">Vectorscope</span></div>
              </div>
            </template>
            <!-- Image -->
            <template v-else>
              <div class="img-meta-bar">
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.image') }}</div>
                  <div class="meta-grid" style="gap:4px 14px">
                    <span class="meta-label">{{ t('d.resolution') }}</span><span>{{ selectedMedia.width }}x{{ selectedMedia.height }}</span>
                    <span class="meta-label">{{ t('d.codec') }}</span><span>{{ selectedMedia.video_codec || '-' }}</span>
                    <span class="meta-label">{{ t('d.color_space') }}</span><span>{{ selectedMedia.color_space || '-' }}</span>
                    <span class="meta-label">{{ t('d.bit_depth') }}</span><span>{{ selectedMedia.pix_fmt || '-' }}</span>
                  </div>
                </div>
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.camera_info') }}</div>
                  <div class="meta-grid" style="gap:4px 14px">
                    <span class="meta-label">{{ t('d.model') }}</span><span>{{ selectedMedia.camera_model || '-' }}</span>
                    <span class="meta-label">{{ t('d.lens') }}</span><span>{{ selectedMedia.lens_model || '-' }}</span>
                  </div>
                </div>
              </div>
              <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0;background:#000;position:relative">
                <q-spinner v-if="previewLoading" size="40px" color="grey-6" style="position:absolute"></q-spinner>
                <img ref="wbImgEl" :src="'/media/image/' + selectedMedia.id"
                     @load="onWbImageLoaded" @error="previewLoading=false"
                     style="max-width:100%;max-height:100%;object-fit:contain">
              </div>
              <div class="histogram-wrap" ref="wbHistWrap"><canvas ref="wbHistCanvas"></canvas></div>
            </template>
          </div>
          <!-- Right: segment info -->
          <div class="wb-preview-sidebar">
            <div class="wb-preview-sidebar-header">
              <span style="font-weight:500">{{ selectedMedia.file_name }}</span>
              <span v-if="selectedMedia.duration" style="font-size:11px;color:var(--text3);margin-left:8px">{{ fmtDur(selectedMedia.duration) }}</span>
            </div>
            <template v-if="mediaSegments(selectedMedia.id).length">
              <q-scroll-area style="flex:1">
                <div v-for="seg in mediaSegments(selectedMedia.id)" :key="seg.id" class="segment"
                     :class="{ active: activeSeg && activeSeg.id === seg.id }"
                     @click="activeSeg = seg">
                  <div style="display:flex;align-items:center;justify-content:space-between">
                    <span class="seg-time"><span class="seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'time_start', e.target.innerText.trim())" v-text="seg.time_start"></span> → <span class="seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'time_end', e.target.innerText.trim())" v-text="seg.time_end"></span></span>
                    <div style="display:flex;align-items:center;gap:6px">
                      <span class="seg-dur">{{ fmtSegDur(seg.time_start, seg.time_end) }}</span>
                    </div>
                  </div>
                  <div class="seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'visual', e.target.innerText)" v-text="seg.visual"></div>
                  <div v-if="seg.asr && seg.asr!=='无'" class="seg-text-line seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'asr', e.target.innerText)"><span class="prefix">{{ t('d.dialog_asr') }}</span><span v-text="seg.asr"></span></div>
                  <div v-if="seg.subtitle && seg.subtitle!=='无'" class="seg-text-line seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'subtitle', e.target.innerText)"><span class="prefix">{{ t('d.dialog_subtitle') }}</span><span v-text="seg.subtitle"></span></div>
                  <div v-if="dimRowCam(seg)" class="dim-row">
                    <span style="font-size:12px">🎥</span>
                    <template v-for="f in camFields" :key="f.key"><span v-if="seg[f.key]" class="dim-pair"><span class="dim-label">{{ t('d.dim.' + f.key) }}</span><span class="dim-value seg-editable" :class="f.cls" contenteditable @click.stop @blur="e => saveSegField(seg, f.key, e.target.innerText.trim())" v-text="seg[f.key]"></span></span></template>
                  </div>
                  <div v-if="dimRowScene(seg)" class="dim-row">
                    <span style="font-size:12px">🌍</span>
                    <template v-for="f in sceneFields" :key="f.key"><span v-if="seg[f.key]" class="dim-pair"><span class="dim-label">{{ t('d.dim.' + f.key) }}</span><span class="dim-value seg-editable" :class="f.cls" contenteditable @click.stop @blur="e => saveSegField(seg, f.key, e.target.innerText.trim())" v-text="seg[f.key]"></span></span></template>
                  </div>
                  <div v-if="dimRowStyle(seg)" class="dim-row">
                    <span style="font-size:12px">🎨</span>
                    <template v-for="f in styleFields" :key="f.key"><span v-if="seg[f.key]" class="dim-pair"><span class="dim-label">{{ t('d.dim.' + f.key) }}</span><span class="dim-value seg-editable" :class="f.cls" contenteditable @click.stop @blur="e => saveSegField(seg, f.key, e.target.innerText.trim())" v-text="seg[f.key]"></span></span></template>
                  </div>
                  <div class="array-group"><span class="array-label icon-label"><span class="label-icon">🌈</span>{{ t('d.colors') }}</span><div class="array-pills"><span v-for="c in (seg.dominant_colors||[])" :key="c" class="pill color seg-editable-tag" @click.stop="removeTag(seg, 'dominant_colors', c)">{{ c }}<span style="margin-left:2px;opacity:0.5">×</span></span><input class="tag-add-input" placeholder="+" @click.stop @keydown.enter.stop.prevent="e => { addTag(seg, 'dominant_colors', e.target); e.target.value='' }" /></div></div>
                  <div class="array-group"><span class="array-label icon-label"><span class="label-icon">🏷️</span>{{ t('d.subjects') }}</span><div class="array-pills"><span v-for="s in (seg.main_subjects||[])" :key="s" class="pill subject seg-editable-tag" @click.stop="removeTag(seg, 'main_subjects', s)">{{ s }}<span style="margin-left:2px;opacity:0.5">×</span></span><input class="tag-add-input" placeholder="+" @click.stop @keydown.enter.stop.prevent="e => { addTag(seg, 'main_subjects', e.target); e.target.value='' }" /></div></div>
                </div>
              </q-scroll-area>
            </template>
            <div v-else style="font-size:11px;color:var(--text3);padding:12px">{{ t('wb.no_segments') }}</div>
          </div>
        </template>
        <div v-else class="wb-preview-empty">
          <q-icon name="play_circle_outline" size="48px" color="grey-6" style="opacity:0.3"></q-icon>
          <span style="font-size:12px;color:var(--text3)">{{ t('wb.no_segments') }}</span>
        </div>
      </div>
    </div>

    <!-- Bottom: Tracks -->
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
                <span>{{ item.emotion_value?.toFixed(2) }}</span>
              </template>
              <template v-else>
                <span>{{ item.content || '...' }}</span>
              </template>
            </div>
          </template>
          <div v-else class="wb-track-empty">
            <span v-if="tt.key === 'video'">{{ t('wb.empty_hint') }}</span>
          </div>
        </div>
      </div>
    </div>

  </template>

  <!-- Status bar -->
  <div class="wb-statusbar">
    <span>{{ t('wb.total_duration') }}：{{ totalDuration }}</span>
    <span>{{ t('wb.segment_count') }}：{{ videoTrackCount }}</span>
  </div>
</div>
  `,

  data() {
    return {
      project: null,
      segments: [],
      tracks: [],
      loading: true,
      selectedMedia: null,
      activeSeg: null,
      previewLoading: false,
      matSearch: "",
      matType: "",
      matSort: "file_name",
      matSortOrder: "asc",
      matCols: parseInt(localStorage.getItem('wb_matCols')) || 3,
      matSortOptions: [
        { label: t('wb.sort_name'), value: "file_name" },
        { label: t('wb.sort_duration'), value: "duration" },
        { label: t('wb.sort_date'), value: "date_taken" },
      ],
      trackTypes: [
        { key: "theme" },
        { key: "emotion" },
        { key: "narration" },
        { key: "subtitle" },
        { key: "text" },
        { key: "video" },
      ],
      camFields: [
        { key: "shot_type", cls: "shot" },
        { key: "focal_length", cls: "lens" },
        { key: "camera_angle", cls: "angle" },
        { key: "camera_movement", cls: "move" },
        { key: "perspective", cls: "persp" },
      ],
      sceneFields: [
        { key: "scene_type", cls: "scene" },
        { key: "mood", cls: "mood" },
        { key: "lighting", cls: "light" },
        { key: "weather", cls: "weather" },
      ],
      styleFields: [
        { key: "style", cls: "style" },
        { key: "color_tone", cls: "color" },
        { key: "tone", cls: "tone" },
        { key: "dof", cls: "dof" },
        { key: "composition", cls: "comp" },
      ],
    };
  },

  computed: {
    t() { return t; },
    filteredMedia() {
      if (!this.project || !this.project.media) return [];
      let list = this.project.media;
      if (this.matType) list = list.filter(m => m.media_type === this.matType);
      const key = this.matSort;
      const desc = this.matSortOrder === 'desc';
      list = [...list].sort((a, b) => {
        let r;
        if (key === "duration") r = (a.duration || 0) - (b.duration || 0);
        else if (key === "date_taken") r = (a.date_taken || "").localeCompare(b.date_taken || "");
        else r = (a.file_name || "").localeCompare(b.file_name || "");
        return desc ? -r : r;
      });
      return list;
    },
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
  },

  beforeUnmount() {
    this.stopWbWaveformAnim();
    this.stopWbScopes();
    this.$root.pickerMode = false;
  },

  watch: {
    projectId() { this.load(); },
    selectedMedia() {
      this.activeSeg = null;
      this.stopWbWaveformAnim(); this.stopWbScopes();
      this._wbWfPeaks = null;
      this.previewLoading = this.selectedMedia?.media_type === 'image';
    },
    matCols(val) { localStorage.setItem('wb_matCols', val); },
    matSearch(val) {
      clearTimeout(this._searchTimer);
      if (!val) { this.searchMedia(); return; }
      this._searchTimer = setTimeout(() => this.searchMedia(), 400);
    },
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
          API.getProject(this.projectId, this.matSearch),
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
    async searchMedia() {
      if (!this.projectId) return;
      try {
        const res = await API.getProject(this.projectId, this.matSearch);
        this.project = { ...this.project, media: res.data.media };
      } catch (e) {
        console.error(e);
      }
    },
    getTrackItems(trackType) {
      return this.tracks.filter(tr => tr.track_type === trackType);
    },
    mediaSegments(mediaId) {
      return this.segments.filter(s => s.media_id === mediaId);
    },
    fmtDur(sec) {
      if (!sec) return "";
      sec = Math.round(sec);
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const s = sec % 60;
      if (h) return h + ":" + String(m).padStart(2, "0") + ":" + String(s).padStart(2, "0");
      return m + ":" + String(s).padStart(2, "0");
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
    openMediaPicker() {
      this.$root.pickerSelected = [];
      this.$root.pickerExcludeIds = (this.project?.media || []).map(m => m.id);
      this.$root.pickerFolder = null;
      this.$root.pickerProjectId = this.projectId;
      this.$root.pickerMode = true;
    },
    dimRowCam(seg) { return this.camFields.some(f => seg[f.key]); },
    dimRowScene(seg) { return this.sceneFields.some(f => seg[f.key]); },
    dimRowStyle(seg) { return this.styleFields.some(f => seg[f.key]); },
    fmtSegDur(start, end) {
      const ts = (s) => { if (!s) return NaN; const p = s.split(":").map(Number); return p.length===3 ? p[0]*3600+p[1]*60+p[2] : p.length===2 ? p[0]*60+p[1] : parseFloat(s); };
      const d = ts(end) - ts(start);
      return isNaN(d) ? "" : d.toFixed(1) + "s";
    },
    async saveSegField(seg, field, value) {
      const old = seg[field];
      if (value === old) return;
      seg[field] = value;
      try { await API.updateSegment(seg.media_id, seg.id, { [field]: value }); }
      catch (e) { seg[field] = old; Quasar.Notify.create({ message: e.message, color: "negative", position: "top" }); }
    },
    async removeTag(seg, field, tag) {
      const arr = seg[field] || [];
      const newArr = arr.filter(t => t !== tag);
      if (newArr.length === arr.length) return;
      const old = [...arr];
      seg[field] = newArr;
      try { await API.updateSegment(seg.media_id, seg.id, { [field]: newArr }); }
      catch (e) { seg[field] = old; Quasar.Notify.create({ message: e.message, color: "negative", position: "top" }); }
    },
    async addTag(seg, field, inputEl) {
      const val = (inputEl.value || "").trim();
      if (!val) return;
      const arr = seg[field] || [];
      if (arr.includes(val)) return;
      const old = [...arr];
      arr.push(val);
      seg[field] = [...arr];
      try { await API.updateSegment(seg.media_id, seg.id, { [field]: arr }); }
      catch (e) { seg[field] = old; Quasar.Notify.create({ message: e.message, color: "negative", position: "top" }); }
    },
    fmtFps(fps) {
      if (!fps) return "-";
      const parts = fps.split("/");
      if (parts.length === 2) return (parseFloat(parts[0]) / parseFloat(parts[1])).toFixed(2);
      return parseFloat(fps).toFixed(2);
    },
    // -- Image --
    onWbImageLoaded() {
      this.previewLoading = false;
      this.$nextTick(() => this.drawWbHistogram());
    },
    drawWbHistogram() {
      const img = this.$refs.wbImgEl;
      const canvas = this.$refs.wbHistCanvas;
      const wrap = this.$refs.wbHistWrap;
      if (!img || !canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      ctx.scale(dpr, dpr);
      const w = rect.width, h = rect.height;
      const offscreen = document.createElement("canvas");
      const sw = Math.min(img.naturalWidth, 800);
      const sh = Math.round(sw / img.naturalWidth * img.naturalHeight);
      offscreen.width = sw; offscreen.height = sh;
      const octx = offscreen.getContext("2d");
      octx.drawImage(img, 0, 0, sw, sh);
      const idata = octx.getImageData(0, 0, sw, sh).data;
      const rH = new Uint32Array(256), gH = new Uint32Array(256), bH = new Uint32Array(256);
      for (let i = 0; i < idata.length; i += 4) { rH[idata[i]]++; gH[idata[i+1]]++; bH[idata[i+2]]++; }
      const maxVal = Math.max(1, ...rH, ...gH, ...bH);
      ctx.clearRect(0, 0, w, h);
      const drawCh = (hist, color) => {
        ctx.beginPath(); ctx.moveTo(0, h);
        for (let i = 0; i < 256; i++) { ctx.lineTo((i/255)*w, h - (hist[i]/maxVal)*h*0.95); }
        ctx.lineTo(w, h); ctx.closePath(); ctx.fillStyle = color; ctx.fill();
      };
      drawCh(rH, "rgba(255,80,80,0.35)"); drawCh(gH, "rgba(80,220,80,0.35)"); drawCh(bH, "rgba(80,120,255,0.35)");
    },
    // -- Video waveform --
    onWbVideoLoaded() {
      this.initWbScopes();
      this.loadWbWaveform();
    },
    onWbVideoPlay() { this.startWbWaveformAnim(); this.startWbScopes(); },
    onWbVideoPause() { this.stopWbWaveformAnim(); this.stopWbScopes(); this.drawWbWaveform(); if (this._wbScopeOffscreen) this.drawWbScopesOnce(); },
    onWbVideoSeeked() { this.initWbScopes(); this.drawWbWaveform(); this.drawWbScopesOnce(); },
    async loadWbWaveform() {
      const player = this.$refs.wbPlayer;
      const canvas = this.$refs.wbWfCanvas;
      if (!player || !canvas) return;
      try {
        const resp = await fetch(player.src);
        const buf = await resp.arrayBuffer();
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const audio = await actx.decodeAudioData(buf);
        actx.close();
        const data = audio.getChannelData(0);
        this._wbWfDuration = audio.duration;
        const rect = this.$refs.wbWaveformWrap.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const samplesPerPeak = Math.max(1, Math.floor(data.length / w));
        this._wbWfPeaks = [];
        for (let i = 0; i < w; i++) {
          let max = 0;
          const start = i * samplesPerPeak;
          for (let j = 0; j < samplesPerPeak; j++) {
            const idx = start + j;
            if (idx < data.length) { const v = Math.abs(data[idx]); if (v > max) max = v; }
          }
          this._wbWfPeaks.push(max);
        }
        this.resizeWbWaveformCanvas();
        this.drawWbWaveform();
      } catch (e) { this._wbWfPeaks = null; }
    },
    resizeWbWaveformCanvas() {
      const canvas = this.$refs.wbWfCanvas;
      const wrap = this.$refs.wbWaveformWrap;
      if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      canvas.getContext('2d').scale(dpr, dpr);
    },
    drawWbWaveform() {
      const canvas = this.$refs.wbWfCanvas;
      const player = this.$refs.wbPlayer;
      if (!canvas || !player || !this._wbWfPeaks) return;
      const wrap = this.$refs.wbWaveformWrap;
      const rect = wrap.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.save(); ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, w, h);
      const mid = h / 2;
      const time = player.currentTime;
      const played = (time / this._wbWfDuration) * w;
      for (let i = 0; i < this._wbWfPeaks.length; i++) {
        const barH = Math.max(1, this._wbWfPeaks[i] * mid * 0.85);
        ctx.fillStyle = i < played ? 'rgba(108,140,255,0.5)' : getComputedStyle(document.documentElement).getPropertyValue('--border2').trim();
        ctx.fillRect(i, mid - barH, 1, barH * 2);
      }
      const x = (time / this._wbWfDuration) * w;
      ctx.fillStyle = '#6c8cff'; ctx.fillRect(Math.round(x) - 1, 0, 2, h);
      ctx.restore();
    },
    startWbWaveformAnim() {
      if (this._wbWfAnim) return;
      const loop = () => {
        if (this.$refs.wbPlayer?.paused) { this._wbWfAnim = null; return; }
        this.drawWbWaveform();
        this._wbWfAnim = requestAnimationFrame(loop);
      };
      this._wbWfAnim = requestAnimationFrame(loop);
    },
    stopWbWaveformAnim() { if (this._wbWfAnim) { cancelAnimationFrame(this._wbWfAnim); this._wbWfAnim = null; } },
    onWbWaveformClick(e) {
      const player = this.$refs.wbPlayer;
      if (!player || !this._wbWfPeaks || !this._wbWfDuration) return;
      const rect = this.$refs.wbWaveformWrap.getBoundingClientRect();
      player.currentTime = ((e.clientX - rect.left) / rect.width) * this._wbWfDuration;
      this.drawWbWaveform();
    },
    // -- Video scopes --
    initWbScopes() {
      const dpr = window.devicePixelRatio || 1;
      ['wbScopeWf', 'wbScopePr', 'wbScopeVt'].forEach(ref => {
        const c = this.$refs[ref];
        if (c) { const r = c.parentElement.getBoundingClientRect(); c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
      });
      this._wbScopeOffscreen = document.createElement('canvas');
      this._wbScopeOffCtx = this._wbScopeOffscreen.getContext('2d', { willReadFrequently: true });
    },
    captureWbFrame() {
      const player = this.$refs.wbPlayer;
      if (!player?.videoWidth) return null;
      const scale = 0.2;
      const sw = Math.max(1, Math.floor(player.videoWidth * scale));
      const sh = Math.max(1, Math.floor(player.videoHeight * scale));
      this._wbScopeOffscreen.width = sw; this._wbScopeOffscreen.height = sh;
      this._wbScopeOffCtx.drawImage(player, 0, 0, sw, sh);
      return this._wbScopeOffCtx.getImageData(0, 0, sw, sh);
    },
    drawWbWaveformScope(imgData) {
      const c = this.$refs.wbScopeWf; if (!c) return;
      const ctx = c.getContext('2d'); const cw = c.width, ch = c.height;
      const out = ctx.createImageData(cw, ch); const px = out.data;
      const { data, width: fw, height: fh } = imgData;
      for (let y = 0; y < fh; y += 2) for (let x = 0; x < fw; x += 2) {
        const i = (y * fw + x) * 4;
        const luma = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
        const sx = Math.floor((x / fw) * cw); const sy = Math.floor((1 - luma / 255) * (ch - 1));
        if (sx >= 0 && sx < cw && sy >= 0 && sy < ch) { const pi = (sy * cw + sx) * 4; px[pi] = Math.min(255, px[pi]+20); px[pi+1] = Math.min(255, px[pi+1]+22); px[pi+2] = Math.min(255, px[pi+2]+28); px[pi+3] = 255; }
      }
      ctx.putImageData(out, 0, 0);
    },
    drawWbParadeScope(imgData) {
      const c = this.$refs.wbScopePr; if (!c) return;
      const ctx = c.getContext('2d'); const cw = c.width, ch = c.height;
      const out = ctx.createImageData(cw, ch); const px = out.data;
      const { data, width: fw, height: fh } = imgData;
      const third = Math.floor(cw / 3);
      for (let y = 0; y < fh; y += 2) for (let x = 0; x < fw; x += 2) {
        const i = (y * fw + x) * 4; const ch_ = [data[i], data[i+1], data[i+2]];
        for (let ci = 0; ci < 3; ci++) {
          const sx = Math.floor((x / fw) * third) + ci * third;
          const sy = Math.floor((1 - ch_[ci] / 255) * (ch - 1));
          if (sx >= 0 && sx < cw && sy >= 0 && sy < ch) {
            const pi = (sy * cw + sx) * 4;
            if (ci === 0) px[pi] = Math.min(255, px[pi]+18);
            else if (ci === 1) px[pi+1] = Math.min(255, px[pi+1]+18);
            else px[pi+2] = Math.min(255, px[pi+2]+18);
            px[pi+3] = 255;
          }
        }
      }
      for (let y = 0; y < ch; y++) for (const dx of [third, third * 2]) if (dx < cw) { const pi = (y * cw + dx) * 4; px[pi] = px[pi+1] = px[pi+2] = 25; px[pi+3] = 255; }
      ctx.putImageData(out, 0, 0);
    },
    drawWbVectorscope(imgData) {
      const c = this.$refs.wbScopeVt; if (!c) return;
      const ctx = c.getContext('2d'); const cw = c.width, ch = c.height;
      const out = ctx.createImageData(cw, ch); const px = out.data;
      const cx = cw / 2, cy = ch / 2; const radius = Math.min(cx, cy) * 0.9;
      const { data, width: fw, height: fh } = imgData;
      for (let y = 0; y < fh; y += 3) for (let x = 0; x < fw; x += 3) {
        const i = (y * fw + x) * 4; const r = data[i], g = data[i+1], b = data[i+2];
        const cb = (-0.169 * r - 0.331 * g + 0.5 * b) / 127.5;
        const cr = (0.5 * r - 0.419 * g - 0.081 * b) / 127.5;
        const sx = Math.round(cx + cb * radius); const sy = Math.round(cy - cr * radius);
        if (sx >= 0 && sx < cw && sy >= 0 && sy < ch) { const pi = (sy * cw + sx) * 4; px[pi] = Math.min(255, px[pi]+10); px[pi+1] = Math.min(255, px[pi+1]+12); px[pi+2] = Math.min(255, px[pi+2]+14); px[pi+3] = 255; }
      }
      ctx.putImageData(out, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI * 2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy); ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius); ctx.stroke();
    },
    drawWbScopesOnce() {
      const frame = this.captureWbFrame();
      if (frame) { this.drawWbWaveformScope(frame); this.drawWbParadeScope(frame); this.drawWbVectorscope(frame); }
    },
    startWbScopes() {
      if (this._wbScopeFrame) return;
      const loop = () => {
        const now = performance.now();
        if (now - (this._wbLastScopeTime || 0) >= 66) { this._wbLastScopeTime = now; this.drawWbScopesOnce(); }
        this._wbScopeFrame = requestAnimationFrame(loop);
      };
      this._wbScopeFrame = requestAnimationFrame(loop);
    },
    stopWbScopes() { if (this._wbScopeFrame) { cancelAnimationFrame(this._wbScopeFrame); this._wbScopeFrame = null; } },
  },
};
