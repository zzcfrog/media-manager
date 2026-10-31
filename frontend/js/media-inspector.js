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
        <div class="inspector-identity">
          <img :key="previewKey + ':' + previewAttempt" class="inspector-preview" :data-media-id="media.id"
               :class="{'audio-waveform-thumb': media.media_type==='audio' && !previewFailed}"
               :src="previewSrc" alt="" @load="onPreviewLoaded" @error="onPreviewError">
          <div class="inspector-identity-info">
            <div class="inspector-name"><h2 :title="media.file_name">{{ media.file_name }}</h2><q-icon v-if="media.favorite" name="favorite" color="red" size="18px"></q-icon></div>
            <div class="inspector-summary">
              <div class="inspector-rating" :aria-label="t('ui.rating', {n: media.rating || 0})"><span v-for="n in 5" :key="n" :class="{filled: n <= media.rating}">★</span></div>
              <span class="inspector-format">{{ fileFormat }}</span>
              <span v-if="media.has_xmp" class="inspector-format" :title="t('d.xmp_badge')">XMP</span>
            </div>
          </div>
        </div>
        <people-media :media="media" compact></people-media>
        <section v-if="media.media_type==='image'" class="inspector-section inspector-tones" :aria-label="t('ui.histograms')">
          <div class="inspector-section-heading"><h3>{{ t('ui.histograms') }}</h3>
            <span class="inspector-histogram-source" :title="t('ui.histogram_source_hint')">{{ t('ui.histogram_source') }}</span>
          </div>
          <div v-if="histogram" class="inspector-histograms">
            <figure v-for="chart in histogramCharts" :key="chart.key" class="inspector-histogram">
              <figcaption><span>{{ chart.label }}</span><span v-if="chart.key==='rgb'" class="inspector-channel-legend" aria-hidden="true"><i class="histogram-red">R</i><i class="histogram-green">G</i><i class="histogram-blue">B</i></span></figcaption>
              <svg viewBox="0 0 255 64" preserveAspectRatio="none" role="img" :aria-label="chart.label + ' · ' + t('ui.histogram_source')">
                <path class="histogram-grid" d="M64,0V64 M128,0V64 M192,0V64 M0,32H255" />
                <path v-for="series in chart.series" :key="series.key" :d="series.path" :class="'histogram-' + series.key" vector-effect="non-scaling-stroke" />
              </svg>
              <div class="inspector-histogram-axis" aria-hidden="true"><span>0</span><span>255</span></div>
            </figure>
          </div>
          <div v-else class="inspector-histogram-status" role="status">
            <template v-if="previewFailed || histogramError"><span>{{ t('ui.histogram_unavailable') }}</span><q-btn flat dense no-caps :label="t('g.retry')" @click="retryPreview"></q-btn></template>
            <template v-else><q-spinner size="14px" color="primary"></q-spinner><span>{{ t('ui.histogram_loading') }}</span></template>
          </div>
        </section>
        <section v-for="section in metadataSections" :key="section.label" class="inspector-section">
          <h3>{{ section.label }}</h3>
          <dl><template v-for="row in section.rows" :key="row.label"><dt>{{ row.label }}</dt><dd>{{ row.value }}</dd></template></dl>
        </section>
        <div v-if="media.file_path" class="inspector-path" :title="media.file_path"><q-icon name="folder_open" size="12px" aria-hidden="true"></q-icon><span>{{ media.file_path }}</span></div>
        <section v-if="media.notes" class="inspector-section"><h3>{{ t('ui.notes') }}</h3><p class="inspector-description">{{ media.notes }}</p></section>
        <section class="inspector-section inspector-classification">
          <div class="inspector-section-heading"><h3>{{ t('ui.classification_tags') }}</h3><q-checkbox v-model="labelsManualOnly" dense size="xs" :label="t('ui.manual_only')"></q-checkbox></div>
          <q-spinner v-if="labelsLoading" size="15px"></q-spinner>
          <div v-else-if="labelsError" role="status"><span>{{t('g.load_failed')}}</span><q-btn flat dense :label="t('g.retry')" @click="loadLabels"></q-btn></div>
          <div v-else class="inspector-tags"><q-chip v-for="label in visibleLabels" :key="label.id" dense clickable @click="$root.nav('#/classify/'+label.id)">{{label.name}}<q-tooltip>{{label.path}} · {{label.sources.map(s=>sourceLabel(s.origin)).join(' / ')}}</q-tooltip></q-chip>
            <span v-if="!visibleLabels.length" class="taxonomy-hint">{{t('ui.no_classification_tags')}}</span></div>
          <q-select v-model="labelToAdd" :options="$root.taxonomyOptions || []" dense borderless emit-value map-options :label="t('ui.add_classification_tag')" @update:model-value="addLabel"></q-select>
          <q-btn flat dense v-if="labels.length" :label="t('ui.edit_classification_tags')" @click="$root.taxonomySelectedMedia=[media.id];$root.nav('#/taxonomy/'+labels[0].id)"></q-btn>
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
      </div>
      <div v-if="media" class="inspector-actions">
        <q-btn outline no-caps color="primary" :label="t('g.ctx_view_detail')" icon-right="chevron_right" @click="$emit('open', media.id)"></q-btn>
        <q-btn flat no-caps :label="t('g.ctx_reveal')" icon="folder_open" @click="reveal"></q-btn>
      </div>
    </aside>`,
  data() { return { analysis: null, loading: false, error: false, previewFailed: false,
    previewAttempt: 0, histogram: null, histogramError: false, labels:[],labelsLoading:false,labelsError:false,labelsManualOnly:false,labelToAdd:null }; },
  computed: {
    labelKey(){return this.media ? [this.media.id,this.media.tag_count??'',this.$root?.taxonomyRevision||0].join(':') : '';},
    visibleLabels(){return this.labelsManualOnly?this.labels.filter(n=>n.decisions.some(d=>d.decision==='confirm')):this.labels;},
    previewKey() { return this.media ? [this.media.id, this.media.thumbnail_path || '', this.media.file_mtime || ''].join(':') : ''; },
    previewSrc() {
      if (this.previewFailed || !this.media) return '/static/img/no-thumb.svg';
      return API.thumbUrl(this.media.id) + '?cached=1&v=' + encodeURIComponent(this.previewKey) + '&retry=' + this.previewAttempt;
    },
    fileFormat() { return this.media?.file_name?.split('.').pop()?.toUpperCase() || ''; },
    metadataSections() {
      if (!this.media) return [];
      const m = this.media;
      const rows = entries => entries.filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([label, value]) => ({ label: this.t(label), value }));
      const [numerator, denominator = 1] = String(m.fps || '').split('/').map(Number);
      const fps = numerator / denominator;
      const sections = [
        { label: this.t('d.file_info'), rows: rows([
          ['d.resolution', m.width && m.height ? m.width + ' × ' + m.height : null],
          ['d.size', this.fmtSize(m.file_size || 0)],
          ['d.duration', m.duration > 0 ? this.fmtDur(m.duration) : null],
          ['d.fps', Number.isFinite(fps) && fps > 0 ? Number(fps.toFixed(2)) + ' fps' : null],
          ['d.codec', m.video_codec], ['ui.encoding_profile', m.video_profile],
          ['d.bitrate', m.bit_rate > 0 ? Number((m.bit_rate / 1000000).toFixed(2)) + ' Mbps' : null],
        ]) },
        { label: this.t('ui.capture_color'), rows: rows([
          ['d.make', m.camera_make], ['d.model', m.camera_model], ['d.lens', m.lens_model],
          ['d.color_curve', m.picture_control], ['d.color_space', m.color_space],
          [m.media_type === 'image' ? 'd.bit_depth' : 'ui.pixel_format', m.pix_fmt],
          ['ui.color_range', m.color_range],
        ]) },
        { label: this.t('d.audio'), rows: rows([
          ['d.codec', m.audio_codec],
          ['d.sample_rate', m.audio_sample_rate > 0 ? Number((m.audio_sample_rate / 1000).toFixed(2)) + ' kHz' : null],
          ['d.channels', m.audio_channels > 0 ? m.audio_channels : null],
          ['ui.music_title', m.music_title], ['ui.artist', m.music_artist], ['ui.album', m.music_album],
        ]) },
        { label: this.t('ui.library_dates'), rows: rows([
          ['d.date_taken', m.date_taken], ['ui.imported_at', m.imported_at],
        ]) },
      ];
      return sections.filter(section => section.rows.length);
    },
    histogramCharts() {
      if (!this.histogram) return [];
      const h = this.histogram;
      const rgbMax = Math.max(1, ...h.red, ...h.green, ...h.blue);
      return [
        { key: 'luminance', label: this.t('ui.luminance_histogram'), series: [
          { key: 'luminance', path: this.histogramPath(h.luminance, Math.max(1, ...h.luminance)) },
        ] },
        { key: 'rgb', label: this.t('ui.rgb_histogram'), series: ['red', 'green', 'blue'].map(key => (
          { key, path: this.histogramPath(h[key], rgbMax) }
        )) },
      ];
    },
    analysisKey() { return this.media ? this.media.id + ':' + this.media.analysis_status : ''; },
    description() {
      return this.analysis?.segments?.map(segment => segment.visual || segment.asr || '').filter(Boolean).slice(0, 2).join(' ')
        || this.analysis?.summary?.mood?.map(item => this.$root.musicTaxZh?.[item.label] || item.label).join(' · ') || '';
    },
    subjects() {
      return [...new Set((this.analysis?.segments || []).flatMap(segment => segment.main_subjects || []))].slice(0, 8);
    },
  },
  watch: {
    labelKey:{immediate:true,handler(){this.loadLabels();}},
    analysisKey: { immediate: true, handler() { this.loadAnalysis(); } },
    previewKey: { immediate: true, handler() {
      this.previewFailed = false; this.previewAttempt = 0; this.histogram = null; this.histogramError = false;
    } },
  },
  beforeUnmount() { this._generation = (this._generation || 0) + 1; this._labelGeneration=(this._labelGeneration||0)+1; },
  methods: {
    t, API, fmtSize, fmtDur,
    sourceLabel(origin){return this.t(origin==='manual'?'ui.source_manual':origin==='legacy_unknown'?'ui.source_unknown':origin==='confirmed_historical_baseline'?'ui.source_baseline':'ui.source_machine');},
    async loadLabels(){
      const generation=this._labelGeneration=(this._labelGeneration||0)+1,id=this.media?.id;
      this.labels=[];this.labelsError=false;this.labelsLoading=false;this.labelToAdd=null;
      if(!id || typeof API._fetch!=='function')return;
      this.labelsLoading=true;
      try{const result=await API._fetch('/api/taxonomy/media/'+id+'/labels');if(generation===this._labelGeneration)this.labels=result.data;}
      catch(e){if(generation===this._labelGeneration)this.labelsError=true;}
      finally{if(generation===this._labelGeneration)this.labelsLoading=false;}
    },
    async addLabel(tagId){
      const id=this.media?.id;if(!id||!tagId)return;
      try{await API._fetch('/api/taxonomy/decisions',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({media_ids:[id],tag_id:tagId,decision:'confirm'})});
        if(this.media?.id===id)await this.loadLabels();await this.$root.reloadTaxonomy();}
      catch(e){Quasar.Notify.create({message:e.message,type:'negative'});}
    },
    histogramFromPixels(pixels) {
      const histogram = { red: new Uint32Array(256), green: new Uint32Array(256),
        blue: new Uint32Array(256), luminance: new Uint32Array(256) };
      for (let i = 0; i < pixels.length; i += 4) {
        if (!pixels[i + 3]) continue;
        histogram.red[pixels[i]]++; histogram.green[pixels[i + 1]]++; histogram.blue[pixels[i + 2]]++;
        histogram.luminance[Math.round(.2126 * pixels[i] + .7152 * pixels[i + 1] + .0722 * pixels[i + 2])]++;
      }
      return histogram;
    },
    histogramPath(bins, maximum) {
      return 'M0,64 ' + Array.from(bins, (value, index) => index + ',' + (64 - value / Math.max(1, maximum) * 61).toFixed(2))
        .map(point => 'L' + point).join(' ') + ' L255,64 Z';
    },
    onPreviewLoaded(event) {
      const image = event.target;
      if (!this.media || this.media.media_type !== 'image' || this.previewFailed
          || image.dataset.mediaId !== String(this.media.id)) return;
      this.histogram = null; this.histogramError = false;
      try {
        if (!image.naturalWidth || !image.naturalHeight) throw new Error('Empty preview');
        const scale = Math.min(1, 320 / image.naturalWidth, 320 / image.naturalHeight);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        this.histogram = this.histogramFromPixels(context.getImageData(0, 0, canvas.width, canvas.height).data);
      } catch (error) { this.histogramError = true; }
    },
    onPreviewError(event) {
      if (!this.media || event.target.dataset.mediaId !== String(this.media.id)) return;
      this.previewFailed = true; this.histogram = null; this.histogramError = false;
    },
    retryPreview() {
      this.previewFailed = false; this.histogram = null; this.histogramError = false; this.previewAttempt++;
    },
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
