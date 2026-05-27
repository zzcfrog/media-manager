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
      <div class="wb-material-header">{{ t('wb.material') }}
        <span style="font-size:11px;color:var(--text3);margin-left:auto">{{ segments.length }}</span>
      </div>
      <div class="wb-material-list">
        <div v-if="!segments.length" class="wb-empty-material">{{ t('wb.no_segments') }}</div>
        <div v-for="seg in segments" :key="seg.id" class="wb-seg-card"
             :class="{ selected: selectedSegment && selectedSegment.id === seg.id }"
             @click="selectedSegment = seg">
          <img :src="'/media/thumbnail/' + seg.media_id" class="wb-seg-thumb" loading="lazy">
          <div class="wb-seg-info">
            <div v-if="seg.mood" class="wb-seg-tag">{{ seg.mood }}</div>
            <div v-if="seg.shot_type" class="wb-seg-tag">{{ seg.shot_type }}</div>
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
        // Enrich video track items with segment data
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
  },
};
