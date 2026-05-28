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
        <div class="wb-material-header">
          {{ t('wb.material') }}
          <span style="font-size:11px;color:var(--text3);margin-left:4px">{{ project.media ? project.media.length : 0 }}</span>
          <q-btn flat round dense icon="add_circle_outline" size="xs" style="color:var(--accent);margin-left:auto"
                 @click="openMediaPicker">
            <q-tooltip>{{ t('wb.add_media') }}</q-tooltip>
          </q-btn>
        </div>
        <div class="wb-material-list">
          <div v-if="!project.media || !project.media.length" class="wb-empty-material">{{ t('wb.no_segments') }}</div>
          <div v-for="m in project.media" :key="m.id" class="wb-seg-card"
               :class="{ selected: selectedMedia && selectedMedia.id === m.id }"
               @click="selectedMedia = m">
            <img :src="'/media/thumbnail/' + m.id" class="wb-seg-thumb" loading="lazy">
            <div class="wb-seg-info">
              <div class="wb-seg-source" style="font-size:12px">{{ m.file_name }}</div>
              <div style="display:flex;gap:4px;align-items:center">
                <span v-if="m.duration" class="wb-seg-tag">{{ m.duration }}</span>
                <span class="wb-seg-tag">{{ mediaSegments(m.id).length }} {{ t('wb.seg_unit') }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Right: Preview -->
      <div class="wb-preview">
        <template v-if="selectedMedia">
          <img v-if="selectedMedia.media_type === 'image'"
               :src="'/media/image/' + selectedMedia.id" class="wb-preview-media">
          <video v-else :src="'/media/video/' + selectedMedia.id"
                 class="wb-preview-media" controls></video>
          <div class="wb-preview-detail">
            <div style="font-size:13px;font-weight:500;margin-bottom:4px">{{ selectedMedia.file_name }}</div>
            <div v-if="mediaSegments(selectedMedia.id).length" class="wb-seg-list">
              <div v-for="seg in mediaSegments(selectedMedia.id)" :key="seg.id" class="wb-seg-item"
                   :class="{ active: activeSeg && activeSeg.id === seg.id }"
                   @click="activeSeg = seg">
                <span class="wb-seg-item-time">{{ seg.time_start }} - {{ seg.time_end }}</span>
                <div style="display:flex;gap:4px;flex-wrap:wrap">
                  <span v-if="seg.mood" class="wb-seg-tag">{{ seg.mood }}</span>
                  <span v-if="seg.shot_type" class="wb-seg-tag">{{ seg.shot_type }}</span>
                  <span v-if="seg.scene_type" class="wb-seg-tag">{{ seg.scene_type }}</span>
                </div>
                <div v-if="activeSeg && activeSeg.id === seg.id && seg.visual"
                     style="font-size:11px;color:var(--text2);margin-top:4px;line-height:1.4">{{ seg.visual }}</div>
              </div>
            </div>
            <div v-else style="font-size:11px;color:var(--text3);margin-top:6px">{{ t('wb.no_segments') }}</div>
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
      trackTypes: [
        { key: "theme" },
        { key: "emotion" },
        { key: "narration" },
        { key: "subtitle" },
        { key: "text" },
        { key: "video" },
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
  },

  watch: {
    projectId() { this.load(); },
    selectedMedia() { this.activeSeg = null; },
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
    mediaSegments(mediaId) {
      return this.segments.filter(s => s.media_id === mediaId);
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
      this.$root.pickerFolder = null;
      this.$root.pickerProjectId = this.projectId;
      this.$root.pickerMode = true;
    },
  },
};
