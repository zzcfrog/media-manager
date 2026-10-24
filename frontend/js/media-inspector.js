const MediaInspector = {
  props: ['media', 'selectionCount'],
  emits: ['close', 'open', 'analyze'],
  template: `
    <aside class="media-inspector" :aria-label="t('ui.inspector')">
      <div class="inspector-header"><span>{{ t('ui.inspector') }}</span>
        <q-btn flat round dense icon="close" size="sm" :aria-label="t('ui.close_inspector')" @click="$emit('close')"></q-btn>
      </div>
      <div v-if="!media" class="inspector-empty">
        <q-icon :name="selectionCount > 1 ? 'photo_library' : 'touch_app'" size="36px"></q-icon>
        <strong>{{ selectionCount > 1 ? t('g.selected', {n: selectionCount}) : t('ui.select_media') }}</strong>
        <p>{{ selectionCount > 1 ? t('ui.multiple_selection') : t('ui.inspector_hint') }}</p>
        <q-btn v-if="selectionCount > 1" outline no-caps color="primary" :label="t('g.ctx_analyze_n', {n: selectionCount})" @click="$emit('analyze')"></q-btn>
      </div>
      <div v-else class="inspector-content">
        <img class="inspector-preview" :class="{'audio-waveform-thumb': media.media_type==='audio' && !previewFailed}" :src="previewFailed ? '/static/img/no-thumb.svg' : API.thumbUrl(media.id)" alt="" @error="previewFailed=true">
        <div class="inspector-name"><h2>{{ media.file_name }}</h2><q-icon v-if="media.favorite" name="favorite" color="red" size="18px"></q-icon></div>
        <div class="inspector-rating" :aria-label="t('ui.rating', {n: media.rating || 0})"><span v-for="n in 5" :key="n" :class="{filled: n <= media.rating}">★</span></div>
        <section class="inspector-section">
          <h3>{{ t('d.file_info') }}</h3>
          <dl>
            <template v-if="media.width"><dt>{{ t('d.resolution') }}</dt><dd>{{ media.width }} × {{ media.height }}</dd></template>
            <template v-if="media.duration"><dt>{{ t('d.duration') }}</dt><dd>{{ fmtDur(media.duration) }}</dd></template>
            <template v-if="media.fps"><dt>{{ t('d.fps') }}</dt><dd>{{ media.fps }} fps</dd></template>
            <dt>{{ t('d.size') }}</dt><dd>{{ fmtSize(media.file_size || 0) }}</dd>
            <template v-if="media.camera_model"><dt>{{ t('d.model') }}</dt><dd>{{ media.camera_model }}</dd></template>
            <template v-if="media.date_taken"><dt>{{ t('d.date_taken') }}</dt><dd>{{ media.date_taken }}</dd></template>
          </dl>
        </section>
        <section class="inspector-section">
          <div class="inspector-section-heading"><h3>{{ t('ui.ai_analysis') }}</h3>
            <span class="analysis-state" :class="{'is-complete': media.analysis_status === 'done'}"><q-icon v-if="media.analysis_status === 'done'" name="check_circle" size="14px"></q-icon>{{ media.analysis_status === 'done' ? t('ui.analyzed') : media.analysis_status === 'processing' ? t('g.bg_running') : media.analysis_status === 'error' ? t('g.bg_error') : t('ui.not_analyzed') }}</span>
          </div>
          <q-spinner v-if="loading" size="22px" color="primary"></q-spinner>
          <div v-else-if="error" role="status"><p>{{ t('g.load_failed') }}</p><q-btn flat dense color="primary" :label="t('g.retry')" @click="loadAnalysis"></q-btn></div>
          <template v-else>
            <p v-if="description" class="inspector-description">{{ description }}</p>
            <p v-else class="inspector-description">{{ t('ui.analysis_hint') }}</p>
            <div v-if="subjects.length" class="inspector-tags"><span v-for="tag in subjects" :key="tag">{{ tag }}</span></div>
          </template>
        </section>
        <div class="inspector-actions">
          <q-btn outline no-caps color="primary" :label="t('g.ctx_view_detail')" icon-right="chevron_right" @click="$emit('open', media.id)"></q-btn>
          <q-btn flat no-caps :label="t('g.ctx_reveal')" icon="folder_open" @click="reveal"></q-btn>
        </div>
      </div>
    </aside>`,
  data() { return { analysis: null, loading: false, error: false, previewFailed: false }; },
  computed: {
    analysisKey() { return this.media ? this.media.id + ':' + this.media.analysis_status : ''; },
    description() {
      return this.analysis?.segments?.map(segment => segment.visual || segment.asr || '').filter(Boolean).slice(0, 2).join(' ')
        || this.analysis?.summary?.mood?.map(item => this.$root.musicTaxZh?.[item.label] || item.label).join(' · ') || '';
    },
    subjects() {
      return [...new Set((this.analysis?.segments || []).flatMap(segment => segment.main_subjects || []))].slice(0, 8);
    },
  },
  watch: { analysisKey: { immediate: true, handler() { this.previewFailed = false; this.loadAnalysis(); } } },
  beforeUnmount() { this._generation = (this._generation || 0) + 1; },
  methods: {
    t, API, fmtSize, fmtDur,
    async loadAnalysis() {
      const generation = this._generation = (this._generation || 0) + 1;
      this.analysis = null; this.loading = false; this.error = false;
      if (!this.media || this.media.analysis_status !== 'done') return;
      this.loading = true;
      try {
        const analysis = await API.getAnalysis(this.media.id);
        if (generation === this._generation) this.analysis = analysis;
      } catch (error) {
        if (generation === this._generation) this.error = true;
      } finally {
        if (generation === this._generation) this.loading = false;
      }
    },
    async reveal() {
      try { await API.revealFile(this.media.id); }
      catch (error) { Quasar.Notify.create({type: 'negative', message: error.message}); }
    },
  },
};
