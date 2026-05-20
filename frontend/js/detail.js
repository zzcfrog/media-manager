const DetailPage = {
  template: `
  <div style="flex:1;display:flex;flex-direction:column;overflow:hidden">
    <q-toolbar style="border-bottom:1px solid var(--border);min-height:40px">
      <q-btn flat dense icon="arrow_back" :label="t('d.back')" color="grey-6" style="margin-right:6px;border-radius:6px;padding:3px 6px;font-size:13px" @click="goBack"></q-btn>
      <q-toolbar-title class="text-body2 text-weight-bold" style="font-size:13px">{{ media?.file_name || '' }}</q-toolbar-title>
      <div class="filter-stars" style="margin-left:16px">
        <span v-for="n in 5" :key="n" class="star-btn" :class="{lit: media?.rating && n <= media.rating}" @click="setRating(media?.rating === n ? 0 : n)">★</span>
      </div>
      <div class="filter-colors" style="margin-left:10px">
        <span v-for="c in colors" :key="c" class="color-swatch" :class="['bg-'+c, {active: media?.color_label===c, dim: media?.color_label && media?.color_label!==c}]" @click="setColor(media?.color_label === c ? null : c)"></span>
      </div>
      <q-btn flat round dense :color="media?.favorite ? 'red' : 'grey-6'" icon="favorite" size="sm" style="margin-left:10px" @click="toggleFav">
        <q-tooltip :delay="1000">{{ t('d.favorite') }}</q-tooltip>
      </q-btn>
      <q-btn v-if="media?.media_type==='image' && analysis.status==='done'" flat round dense size="sm" style="margin-left:6px" @click="doWriteXmp">
        <img :src="media?.has_xmp ? '/static/img/xmp-refresh.svg' : '/static/img/xmp-write.svg'" style="width:18px;height:18px" :style="{opacity: media?.has_xmp ? 1 : 0.45}">
        <q-tooltip :delay="1000">{{ media?.has_xmp ? t('d.xmp_update') : t('d.xmp_write') }}</q-tooltip>
      </q-btn>
    </q-toolbar>
    <div style="flex:1;display:flex;overflow:hidden">
      <div style="flex:1;display:flex;flex-direction:column;min-width:0">
        <div v-if="media?.media_type==='video'" style="flex:1;display:flex;flex-direction:column;min-height:0">
          <div v-if="media" class="img-meta-bar">
            <div class="img-meta-block">
              <div class="img-meta-title">{{ t('d.video') }}</div>
              <div style="display:flex;gap:14px;align-items:flex-start">
                <div class="meta-grid" style="gap:4px 14px">
                  <span class="meta-label">{{ t('d.resolution') }}</span><span>{{ media.width }}x{{ media.height }}</span>
                  <span class="meta-label">{{ t('d.duration') }}</span><span>{{ fmtDur(media.duration) }}</span>
                  <span class="meta-label">{{ t('d.codec') }}</span><span>{{ media.video_codec }}<template v-if="media.video_profile"> ({{ media.video_profile }})</template></span>
                </div>
                <div class="meta-grid" style="gap:4px 14px">
                  <span class="meta-label">{{ t('d.fps') }}</span><span>{{ fmtFps(media.fps) }}</span>
                  <span class="meta-label">{{ t('d.bitrate') }}</span><span v-if="media.bit_rate">{{ (media.bit_rate / 1000000).toFixed(1) }} Mbps</span><span v-else>-</span>
                  <span class="meta-label">{{ t('d.color_space') }}</span><span>{{ media.color_space || '-' }}</span>
                  <span v-if="media.picture_control" class="meta-label">{{ t('d.color_curve') }}</span><span v-if="media.picture_control" style="display:inline-flex;align-items:center;gap:3px">{{ media.picture_control }}<q-icon name="help_outline" size="12px" color="grey-6"><q-tooltip :delay="500" style="max-width:280px">{{ t('d.color_curve_tip') }}</q-tooltip></q-icon></span>
                </div>
              </div>
            </div>
            <div class="img-meta-block">
              <div class="img-meta-title">{{ t('d.audio') }}</div>
              <div class="meta-grid" style="gap:4px 14px">
                <template v-if="media.audio_codec">
                  <span class="meta-label">{{ t('d.codec') }}</span><span>{{ media.audio_codec }}</span>
                  <span class="meta-label">{{ t('d.sample_rate') }}</span><span v-if="media.audio_sample_rate">{{ (media.audio_sample_rate / 1000).toFixed(1) }} kHz</span><span v-else>-</span>
                  <span class="meta-label">{{ t('d.channels') }}</span><span>{{ media.audio_channels === 1 ? t('d.mono') : media.audio_channels === 2 ? t('d.stereo') : t('d.ch_n', {n: media.audio_channels || '-'}) }}</span>
                </template>
                <template v-else>
                  <span style="color:var(--text3)">{{ t('d.no_audio') }}</span>
                </template>
              </div>
            </div>
            <div class="img-meta-block">
              <div class="img-meta-title">{{ t('d.camera_info') }}</div>
              <div class="meta-grid" style="gap:4px 14px">
                <span class="meta-label">{{ t('d.make') }}</span><span>{{ media.camera_make || '-' }}</span>
                <span class="meta-label">{{ t('d.model') }}</span><span>{{ media.camera_model || '-' }}</span>
                <span class="meta-label">{{ t('d.lens') }}</span><span>{{ media.lens_model || '-' }}</span>
              </div>
            </div>
            <div class="img-meta-block" style="flex:1 1 0;min-width:0;overflow:hidden">
              <div class="img-meta-title">{{ t('d.file_info') }}</div>
              <div class="meta-grid" style="gap:4px 14px">
                <span class="meta-label">{{ t('d.date_taken') }}</span><span>{{ fmtDate(media.date_taken) }}</span>
                <span class="meta-label">{{ t('d.size') }}</span><span>{{ fmtSize(media.file_size) }}</span>
                <span class="meta-label">{{ t('d.location') }}</span><span style="display:flex;align-items:center;gap:4px"><span class="meta-path" style="cursor:default"><q-tooltip :delay="1000">{{ media.file_path }}</q-tooltip>{{ media.file_path }}</span><q-icon name="folder_open" size="13px" color="grey-6" style="cursor:pointer;flex-shrink:0" @click="openInFinder"></q-icon></span>
              </div>
            </div>
          </div>
          <div style="flex:1;position:relative;min-height:0">
            <video ref="player" :src="API.videoUrl(media.id)" controls preload="auto" tabindex="-1"
                   @loadeddata="onVideoLoaded" @play="onVideoPlay" @pause="onVideoPause" @seeked="onVideoSeeked" @error="onVideoError"
                   style="width:100%;height:100%;background:var(--surface2)"></video>
          </div>
          <div class="waveform-wrap" ref="waveformWrap" @click="onWaveformClick">
            <canvas ref="wfCanvas"></canvas>
          </div>
          <div class="scopes-row" ref="scopesRow">
            <div class="scope-box"><canvas ref="scopeWf"></canvas><span class="scope-label">Waveform</span></div>
            <div class="scope-box"><canvas ref="scopePr"></canvas><span class="scope-label">Parade</span></div>
            <div class="scope-box"><canvas ref="scopeVt"></canvas><span class="scope-label">Vectorscope</span></div>
          </div>
        </div>
        <div v-else-if="media?.media_type==='image'" style="flex:1;display:flex;flex-direction:column;min-height:0">
          <div v-if="media" class="img-meta-bar">
            <div class="img-meta-block">
              <div class="img-meta-title">{{ t('d.image') }}</div>
              <div class="meta-grid" style="gap:4px 14px">
                <span class="meta-label">{{ t('d.resolution') }}</span><span>{{ media.width }}x{{ media.height }}</span>
                <span class="meta-label">{{ t('d.codec') }}</span><span>{{ media.video_codec || '-' }}</span>
                <span class="meta-label">{{ t('d.color_space') }}</span><span>{{ media.color_space || '-' }}</span>
                <span class="meta-label">{{ t('d.bit_depth') }}</span><span>{{ media.pix_fmt || '-' }}</span>
              </div>
            </div>
            <div class="img-meta-block">
              <div class="img-meta-title">{{ t('d.camera_info') }}</div>
              <div class="meta-grid" style="gap:4px 14px">
                <span class="meta-label">{{ t('d.model') }}</span><span>{{ media.camera_model || '-' }}</span>
                <span class="meta-label">{{ t('d.lens') }}</span><span>{{ media.lens_model || '-' }}</span>
              </div>
            </div>
            <div class="img-meta-block" style="flex:1 1 0;min-width:0;overflow:hidden">
              <div class="img-meta-title">{{ t('d.file_info') }}</div>
              <div class="meta-grid" style="gap:4px 14px">
                <span class="meta-label">{{ t('d.date_taken') }}</span><span>{{ fmtDate(media.date_taken) }}</span>
                <span class="meta-label">{{ t('d.size') }}</span><span>{{ fmtSize(media.file_size) }}</span>
                <span class="meta-label">{{ t('d.location') }}</span><span style="display:flex;align-items:center;gap:4px"><span class="meta-path" style="cursor:default"><q-tooltip :delay="1000">{{ media.file_path }}</q-tooltip>{{ media.file_path }}</span><q-icon name="folder_open" size="13px" color="grey-6" style="cursor:pointer;flex-shrink:0" @click="openInFinder"></q-icon><span v-if="media.has_xmp" style="display:inline-flex;cursor:default"><img src="/static/img/xmp-badge.svg" style="width:13px;height:13px"><q-tooltip :delay="1000">{{ t('d.xmp_badge') }}</q-tooltip></span></span>
              </div>
            </div>
          </div>
          <div ref="imgContainer" class="img-view-area">
            <q-spinner-dots v-if="imgLoading" color="grey-6" size="40px" style="position:absolute;z-index:1"></q-spinner-dots>
            <div style="position:relative;display:inline-flex;max-width:100%;max-height:100%;line-height:0">
              <img ref="imgEl" :src="API.imageUrl(media.id)" @load="onImageLoaded" :style="{transform: 'scale(' + imgZoom + ') translate(' + imgPanX + 'px,' + imgPanY + 'px)', transformOrigin: 'center center', maxWidth: '100%', maxHeight: '100%', objectFit: 'contain', background: 'var(--surface2)', transition: imgZooming ? 'transform 0.15s ease' : 'none', cursor: imgZoom > 1 ? (imgDragging ? 'grabbing' : 'grab') : 'default'}" @wheel="onImgWheel" @mousedown="onImgMouseDown" @mousemove="onImgMouseMove" @mouseup="onImgMouseUp" @mouseleave="onImgMouseUp" @dragstart.prevent>
              <div class="img-zoom-bar">
                <q-btn flat round dense icon="remove" size="xs" color="grey-6" @click="imgZoomBy(-0.25)"></q-btn>
                <span style="font-size:11px;color:var(--text2);min-width:36px;text-align:center">{{ Math.round(imgZoom * 100) }}%</span>
                <q-btn flat round dense icon="add" size="xs" color="grey-6" @click="imgZoomBy(0.25)"></q-btn>
                <q-btn flat round dense icon="fit_screen" size="xs" color="grey-6" @click="imgZoom=1;imgPanX=0;imgPanY=0" v-if="imgZoom!==1"></q-btn>
                <q-btn flat round dense :icon="isFullscreen ? 'fullscreen_exit' : 'fullscreen'" size="xs" color="grey-6" @click="toggleFullscreen"><q-tooltip :delay="1000">{{ t('d.fullscreen') }}</q-tooltip></q-btn>
              </div>
            </div>
            <div v-if="imgZoom > 1" class="img-minimap" @click="onMinimapClick">
              <img :src="API.imageUrl(media.id)" class="img-minimap-bg" draggable="false">
              <div class="img-minimap-rect" :style="minimapRectStyle"></div>
            </div>
          </div>
          <div class="histogram-wrap" ref="histWrap"><canvas ref="histCanvas"></canvas></div>
        </div>
      </div>
      <div class="detail-sidebar">
        <!-- Analysis section -->
        <div v-if="analysis.status==='done' && analysis.segments?.length" style="border-top:1px solid var(--border);display:flex;flex-direction:column;flex:1;min-height:0">
          <div style="padding:10px 14px;font-size:12px;font-weight:600;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:8px;flex-shrink:0">
            <span v-if="media?.media_type==='video'" style="color:var(--accent)">◎ {{ t('d.seg_count', {n: analysis.segments.length}) }}</span>
            <div style="flex:1"></div>
            <q-btn flat dense icon="delete_outline" :label="t('d.clear_analysis')" color="grey-6" size="sm" :disable="analyzing" @click="showClearDialog=true" style="font-size:11px"></q-btn>
            <q-btn dense icon="auto_awesome" :label="t('d.reanalyze')" color="primary" size="sm" :disable="analyzing" @click="openAnalysisConfirm" style="font-size:11px;border-radius:4px;padding-left:12px;padding-right:12px"></q-btn>
          </div>
          <q-scroll-area ref="segScroll" style="flex:1">
            <div v-for="(seg,i) in analysis.segments" :key="i" class="segment" :class="{active: activeSeg===i}" @click="seekTo(seg.time_start)">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <template v-if="media?.media_type==='video'"><span class="seg-time"><span class="seg-editable" contenteditable @click.stop @blur="e => { saveSegField(seg, 'time_start', e.target.innerText.trim()) }" v-text="seg.time_start"></span> → <span class="seg-editable" contenteditable @click.stop @blur="e => { saveSegField(seg, 'time_end', e.target.innerText.trim()) }" v-text="seg.time_end"></span></span>
                <div style="display:flex;align-items:center;gap:6px">
                  <span class="seg-dur">{{ fmtSegDur(seg.time_start, seg.time_end) }}</span>
                  <q-btn flat round dense icon="delete_outline" size="xs" color="grey-6" class="seg-del-btn" @click.stop="confirmDeleteSeg(seg, i)"><q-tooltip :delay="800">{{ t('d.delete_seg') }}</q-tooltip></q-btn>
                </div></template>
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
        </div>
        <div v-else style="border-top:1px solid var(--border);flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;min-height:0">
          <template v-if="analyzing">
            <div style="display:flex;flex-direction:column;align-items:center;gap:16px;width:240px">
              <div ref="aiLottieBusy" style="width:64px;height:64px"></div>
              <div class="tl-wrap">
                <div v-for="(s,i) in analysisStages" :key="s.key" class="tl-step" :class="s.status">
                  <div class="tl-dot">
                    <span v-if="s.status==='done'" class="tl-check">✓</span>
                  </div>
                  <div class="tl-body">
                    <div class="tl-title">{{ s.label }}<span v-if="s.status==='active' && s.key==='analyze' && analyzeTipText" class="tl-tip">{{ analyzeTipText }}<span class="tl-cursor">|</span></span></div>
                    <div class="tl-bar-track"><div class="tl-bar-fill" :style="{width: s.progress+'%'}"></div></div>
                    <div class="tl-info"><span>{{ s.substepText || s.statusText }}<span v-if="s.extra" class="tl-extra">{{ s.extra }}</span></span><span v-if="s.duration" class="tl-time">{{ s.duration.toFixed(1) }}s</span></div>
                  </div>
                </div>
              </div>
            </div>
          </template>
          <template v-else>
            <div ref="aiLottieIdle" style="width:80px;height:80px"></div>
            <q-btn color="primary" :label="t('d.ai_analyze')" icon="auto_awesome" style="border-radius:6px;padding:6px 16px" @click="openAnalysisConfirm"></q-btn>
          </template>
        </div>
      </div>
    </div>

    <!-- Clear analysis confirm -->
    <q-dialog v-model="showClearDialog">
      <q-card style="min-width:320px" class="dialog-card">
        <q-card-section>
          <div class="text-h6">{{ t('d.clear_analysis') }}</div>
        </q-card-section>
        <q-card-section>
          <p style="font-size:13px;color:var(--text2)">{{ t('d.clear_confirm') }}</p>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="t('d.cancel')" v-close-popup></q-btn>
          <q-btn color="negative" :label="t('d.clear')" @click="showClearDialog=false; clearAnalysis()"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Delete segment dialog -->
    <q-dialog v-model="showDeleteSegDialog">
      <q-card style="min-width:320px" class="dialog-card">
        <q-card-section>
          <div class="text-h6">{{ t('d.delete_seg') }}</div>
        </q-card-section>
        <q-card-section>
          <p style="font-size:13px;color:var(--text2)">{{ t('d.delete_seg_confirm') }}</p>
          <div style="display:flex;flex-direction:column;gap:8px;margin-top:8px">
            <q-btn v-if="deleteSegInfo && deleteSegInfo.hasPrev" outline color="primary" no-caps style="justify-content:flex-start;font-size:12px" @click="doDeleteSeg('prev')">{{ t('d.seg_adj_prev', {time: deleteSegInfo.timeEnd}) }}</q-btn>
            <q-btn v-if="deleteSegInfo && deleteSegInfo.hasNext" outline color="primary" no-caps style="justify-content:flex-start;font-size:12px" @click="doDeleteSeg('next')">{{ t('d.seg_adj_next', {time: deleteSegInfo.timeStart}) }}</q-btn>
            <q-btn flat color="grey" no-caps style="font-size:12px" @click="doDeleteSeg('none')">{{ t('d.seg_adj_none') }}</q-btn>
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="t('d.cancel')" v-close-popup></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>

    <!-- Analysis confirm dialog -->
    <q-dialog v-model="showAnalysisDialog">
      <q-card style="min-width:360px" class="dialog-card">
        <q-btn flat round dense icon="close" size="sm" color="grey-6" class="dialog-close" v-close-popup></q-btn>
        <q-card-section>
          <div class="text-h6">{{ t('d.confirm_analysis') }}</div>
        </q-card-section>
        <q-card-section>
          <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
            <div v-if="media?.media_type==='video'" class="row items-center">
              <span class="text-grey-6" style="width:80px">{{ t('d.compress') }}</span>
              <span>{{ confirmInfo.resolution }} / {{ confirmInfo.fps }}fps / {{ confirmInfo.bitrate }}</span>
            </div>
            <div class="row items-center">
              <span class="text-grey-6" style="width:80px">{{ t('d.model') }}</span>
              <span>{{ confirmInfo.modelLabel }}</span>
            </div>
            <div v-if="media?.media_type==='video'" class="row items-center">
              <span class="text-grey-6" style="width:80px">{{ t('d.audio') }}</span>
              <span>{{ confirmInfo.useMultimodal ? t('d.multimodal') : t('d.independent_asr', {engine: confirmInfo.asrEngine}) }}</span>
            </div>
          </div>
          <div style="margin-top:16px;padding:8px 12px;border-radius:6px;background:var(--surface2);font-size:12px;color:var(--text3)">
            <q-icon name="info" size="14px" style="margin-right:4px"></q-icon>
            {{ t('d.ai_cost_warning') }}
          </div>
        </q-card-section>
        <q-card-actions align="right">
          <q-btn flat :label="t('d.cancel')" v-close-popup></q-btn>
          <q-btn color="primary" :label="t('d.start_analysis')" @click="showAnalysisDialog=false; doAnalysis()"></q-btn>
        </q-card-actions>
      </q-card>
    </q-dialog>
      </div>
    </div>
  </div>
  `,
  data() {
    return {
      media: null, analysis: { status: "none", segments: [] },
      imgLoading: false,
      imgZoom: 1,
      imgZooming: false,
      imgPanX: 0, imgPanY: 0,
      imgDragging: false, imgDragStart: null,
      imgNatW: 0, imgNatH: 0,
      isFullscreen: false,
      analyzing: false, analysisProgress: "", activeSeg: -1,
      analysisStages: [], analyzeTipText: "",
      showAnalysisDialog: false, showClearDialog: false, showDeleteSegDialog: false,
      deleteSegInfo: null,
      confirmInfo: { resolution: "480P", fps: "30", bitrate: "2.00 Mbps", modelLabel: "智谱 GLM-4.6V", useMultimodal: true, asrEngine: "Whisper" },
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
      colors: ["red", "yellow", "green", "blue", "purple"],
    };
  },
  computed: {
    minimapRectStyle() {
      const Z = this.imgZoom;
      const PX = this.imgPanX, PY = this.imgPanY;
      const cont = this.$refs.imgContainer;
      if (!cont || Z <= 1 || !this.imgNatW || !this.imgNatH) return {};
      const contW = cont.clientWidth, contH = cont.clientHeight;
      const fitScale = Math.min(contW / this.imgNatW, contH / this.imgNatH);
      const fitW = this.imgNatW * fitScale, fitH = this.imgNatH * fitScale;
      const mmW = 160, mmH = fitH / fitW * 160;
      const mmScale = mmW / fitW;
      const visW = contW / Z, visH = contH / Z;
      let rx = (fitW / 2 - PX - visW / 2) * mmScale;
      let ry = (fitH / 2 - PY - visH / 2) * mmScale;
      let rw = visW * mmScale, rh = visH * mmScale;
      rx = Math.max(0, Math.min(rx, mmW - rw));
      ry = Math.max(0, Math.min(ry, mmH - rh));
      rw = Math.min(rw, mmW);
      rh = Math.min(rh, mmH);
      return { left: rx + 'px', top: ry + 'px', width: rw + 'px', height: rh + 'px' };
    },
  },
  beforeUnmount() {
    if (this._onKey) document.removeEventListener("keydown", this._onKey, true);
    if (this._onFsChange) document.removeEventListener("fullscreenchange", this._onFsChange);
    this.stopScopes();
    this.stopWaveformAnim();
    if (this._segTrackInterval) { clearInterval(this._segTrackInterval); this._segTrackInterval = null; }
    if (this._lottie) { this._lottie.destroy(); this._lottie = null; }
    this._stopAnalyzeTips();
    this._stopAllStepTimers();
  },
  async created() {
    this._onKey = (e) => this.handleKey(e);
    document.addEventListener("keydown", this._onKey, true);
    this._onFsChange = () => { this.isFullscreen = !!document.fullscreenElement; };
    document.addEventListener("fullscreenchange", this._onFsChange);
    const hash = location.hash || "";
    const id = parseInt(hash.split("/")[2]);
    try {
      this.media = await API.getMedia(id);
    } catch (e) {
      console.error("load media error:", e);
      location.hash = "#/gallery";
      return;
    }
    try {
      const res = await API.getAnalysis(id);
      if (res.status === "processing") res.status = "none";
      this.analysis = res;
    } catch (e) {
      this.analysis = { status: "none", segments: [] };
    }
    this.$nextTick(() => {
      if (this.analysis.status !== "done") this._initLottieIdle();
      if (this.media?.media_type === "image") this.imgLoading = true;
    });
  },
  methods: {
    t,
    API,
    onImageLoaded(e) {
      this.imgLoading = false;
      this.imgZoom = 1;
      this.imgPanX = 0;
      this.imgPanY = 0;
      this.imgNatW = e.target.naturalWidth;
      this.imgNatH = e.target.naturalHeight;
      this.drawHistogram();
    },
    imgZoomBy(delta) {
      this.imgZooming = true;
      this.imgZoom = Math.max(0.25, Math.min(5, Math.round((this.imgZoom + delta) * 100) / 100));
      if (this.imgZoom <= 1) { this.imgPanX = 0; this.imgPanY = 0; }
      setTimeout(() => { this.imgZooming = false; }, 160);
    },
    onImgWheel(e) {
      e.preventDefault();
      if (e.ctrlKey) {
        this.imgZooming = false;
        const factor = 1 - e.deltaY * 0.005;
        this.imgZoom = Math.max(0.25, Math.min(5, Math.round(this.imgZoom * factor * 100) / 100));
      } else if (e.deltaMode === 0) {
        this.imgZooming = false;
        this.imgPanX -= e.deltaX;
        this.imgPanY -= e.deltaY;
        if (this.imgZoom <= 1) { this.imgPanX = 0; this.imgPanY = 0; }
      } else {
        this.imgZooming = false;
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        this.imgZoom = Math.max(0.25, Math.min(5, Math.round((this.imgZoom + delta) * 100) / 100));
      }
      if (this.imgZoom <= 1) { this.imgPanX = 0; this.imgPanY = 0; }
    },
    onImgMouseDown(e) {
      if (this.imgZoom <= 1) return;
      e.preventDefault();
      this.imgDragging = true;
      this.imgDragStart = { x: e.clientX - this.imgPanX, y: e.clientY - this.imgPanY };
    },
    onImgMouseMove(e) {
      if (!this.imgDragging) return;
      this.imgPanX = e.clientX - this.imgDragStart.x;
      this.imgPanY = e.clientY - this.imgDragStart.y;
    },
    onImgMouseUp() {
      this.imgDragging = false;
    },
    toggleFullscreen() {
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        this.$refs.imgContainer.requestFullscreen();
      }
    },
    onMinimapClick(e) {
      const cont = this.$refs.imgContainer;
      if (!cont || !this.imgNatW || !this.imgNatH) return;
      const contW = cont.clientWidth, contH = cont.clientHeight;
      const fitScale = Math.min(contW / this.imgNatW, contH / this.imgNatH);
      const fitW = this.imgNatW * fitScale, fitH = this.imgNatH * fitScale;
      const mmW = 160, mmH = fitH / fitW * 160;
      const mmScale = mmW / fitW;
      const rect = e.currentTarget.getBoundingClientRect();
      const cx = e.clientX - rect.left, cy = e.clientY - rect.top;
      const imgCX = cx / mmScale, imgCY = cy / mmScale;
      this.imgPanX = -(imgCX - fitW / 2);
      this.imgPanY = -(imgCY - fitH / 2);
    },
    drawHistogram() {
      const img = this.$refs.imgEl;
      const canvas = this.$refs.histCanvas;
      const wrap = this.$refs.histWrap;
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
      offscreen.width = sw;
      offscreen.height = sh;
      const octx = offscreen.getContext("2d");
      octx.drawImage(img, 0, 0, sw, sh);
      const idata = octx.getImageData(0, 0, sw, sh).data;
      const rHist = new Uint32Array(256);
      const gHist = new Uint32Array(256);
      const bHist = new Uint32Array(256);
      for (let i = 0; i < idata.length; i += 4) {
        rHist[idata[i]]++;
        gHist[idata[i + 1]]++;
        bHist[idata[i + 2]]++;
      }
      const maxVal = Math.max(1, ...rHist, ...gHist, ...bHist);
      ctx.clearRect(0, 0, w, h);
      const drawCh = (hist, color) => {
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let i = 0; i < 256; i++) {
          const x = (i / 255) * w;
          const y = h - (hist[i] / maxVal) * h * 0.95;
          ctx.lineTo(x, y);
        }
        ctx.lineTo(w, h);
        ctx.closePath();
        ctx.fillStyle = color;
        ctx.fill();
      };
      drawCh(rHist, "rgba(255,80,80,0.35)");
      drawCh(gHist, "rgba(80,220,80,0.35)");
      drawCh(bHist, "rgba(80,120,255,0.35)");
    },
    _initLottieIdle() {
      if (this._lottie) { this._lottie.destroy(); this._lottie = null; }
      const el = this.$refs.aiLottieIdle;
      if (el && window.lottie) {
        this._lottie = lottie.loadAnimation({ container: el, renderer: "svg", loop: true, autoplay: true, path: "/static/img/ai-animation.json" });
      }
    },
    _initLottieBusy() {
      if (this._lottie) { this._lottie.destroy(); this._lottie = null; }
      const el = this.$refs.aiLottieBusy;
      if (el && window.lottie) {
        this._lottie = lottie.loadAnimation({ container: el, renderer: "svg", loop: true, autoplay: true, path: "/static/img/ai-animation.json" });
      }
    },
    _updateStage(key, newStatus, extra) {
      this.analysisStages = this.analysisStages.map(s => {
        if (s.key !== key) return s;
        const u = { ...s };
        if (newStatus === "active" && s.status === "pending") {
          u.status = "active"; u.t0 = Date.now(); u.statusText = s.activeText;
          this._startStepTimer(key);
        }
        if (newStatus === "done" && s.status === "active") {
          u.status = "done"; u.duration = (Date.now() - s.t0) / 1000; u.progress = 100;
          u.statusText = s.doneText; u.extra = extra || ""; u.substepText = "";
          this._stopStepTimer(key);
        }
        return u;
      });
    },
    _startStepTimer(key) {
      this._stopStepTimer(key);
      const timer = setInterval(() => {
        const s = this.analysisStages.find(x => x.key === key);
        if (!s || s.status !== "active") { clearInterval(timer); return; }
        const sec = ((Date.now() - s.t0) / 1000).toFixed(1);
        this.analysisStages = this.analysisStages.map(x => x.key === key ? { ...x, duration: parseFloat(sec) } : x);
      }, 100);
      if (!this._stepTimers) this._stepTimers = {};
      this._stepTimers[key] = timer;
    },
    _stopStepTimer(key) {
      if (this._stepTimers?.[key]) { clearInterval(this._stepTimers[key]); delete this._stepTimers[key]; }
    },
    _stopAllStepTimers() {
      if (this._stepTimers) Object.values(this._stepTimers).forEach(t => clearInterval(t));
      this._stepTimers = {};
    },
    _setStageProgress(key, percent) {
      this.analysisStages = this.analysisStages.map(s =>
        s.key === key && s.status === "active" ? { ...s, progress: Math.min(percent, 99.9) } : s
      );
    },
    _setAnalyzeSubstep(name, chars) {
      this._analyzeSubstep = true;
      this._stopAnalyzeTips();
      const text = name === "receiving" && chars > 0
        ? t('d.tip_receiving_chars', {n: chars.toLocaleString()})
        : (name === "uploading" ? t('d.tip_uploading') : name === "receiving" ? t('d.tip_receiving') : "");
      this.analyzeTipText = text;
      this.analysisStages = this.analysisStages.map(s =>
        s.key === "analyze" && s.status === "active" ? { ...s, substepText: text } : s
      );
    },
    _setAsrSubstep(name, text) {
      this.analysisStages = this.analysisStages.map(s =>
        s.key === "asr" && s.status === "active" ? { ...s, substepText: text } : s
      );
    },
    _startAnalyzeTips() {
      this._stopAnalyzeTips();
      const tips = t('d.tips');
      const shuffled = [...tips].sort(() => Math.random() - 0.5);
      let idx = 0;
      this._tipTimers = [];
      const typeTip = (text, cb) => {
        this._clearTipTimers();
        this.analyzeTipText = "";
        let i = 0;
        const speed = 55 + Math.random() * 40;
        const next = () => {
          if (i < text.length) {
            this.analyzeTipText = text.slice(0, i + 1);
            i++;
            this._tipTimers.push(setTimeout(next, speed + Math.random() * 50));
          } else if (cb) {
            this._tipTimers.push(setTimeout(cb, 2500 + Math.random() * 2000));
          }
        };
        next();
      };
      const showNext = () => {
        const text = shuffled[idx % shuffled.length];
        idx++;
        typeTip(text, () => {
          const eraseTimer = setInterval(() => {
            if (this.analyzeTipText.length > 0) {
              this.analyzeTipText = this.analyzeTipText.slice(0, -1);
            } else {
              clearInterval(eraseTimer);
              this._tipTimers.push(setTimeout(showNext, 200));
            }
          }, 25);
          this._tipTimers.push(eraseTimer);
        });
      };
      showNext();
    },
    _stopAnalyzeTips() {
      this._clearTipTimers();
      this.analyzeTipText = "";
    },
    _clearTipTimers() {
      if (this._tipTimers) this._tipTimers.forEach(t => clearTimeout(t));
      this._tipTimers = [];
    },
    async openAnalysisConfirm() {
      try {
        const s = await API.getSettings();
        const modelLabels = { "glm-4v-plus": "智谱 GLM-4V-Plus", "glm-4.6v": "智谱 GLM-4.6V", "glm-4.6v-flash": "智谱 GLM-4.6V-Flash", "glm-4.6v-flashx": "智谱 GLM-4.6V-FlashX", "glm-4.5v": "智谱 GLM-4.5V" };
        this.confirmInfo.resolution = s.resolution === "320" ? "320P" : s.resolution === "240" ? "240P" : "480P";
        this.confirmInfo.fps = s.fps || "30";
        const resPixels = { "240": 426 * 240, "320": 640 * 360, "480": 854 * 480 };
        const rPx = resPixels[s.resolution] || 854 * 480;
        const rFps = parseInt(s.fps) || 30;
        const bps = 2_000_000 * (rPx / (854 * 480)) * (rFps / 30);
        this.confirmInfo.bitrate = bps >= 1_000_000 ? (bps / 1_000_000).toFixed(2) + " Mbps" : (bps / 1_000).toFixed(0) + " Kbps";
        this.confirmInfo.modelLabel = this.media?.media_type === "image"
          ? (modelLabels[s.image_model] || s.image_model)
          : (modelLabels[s.model] || s.model);
        this.confirmInfo.useMultimodal = s.use_multimodal !== "false";
        this.confirmInfo.asrEngine = (s.asr_engine || "whisper") === "whisper" ? "Whisper" : s.asr_engine;
      } catch (e) { console.error(e); }
      this.showAnalysisDialog = true;
    },
    dimRowCam(seg) { return this.camFields.some(f => seg[f.key]); },
    dimRowScene(seg) { return this.sceneFields.some(f => seg[f.key]); },
    dimRowStyle(seg) { return this.styleFields.some(f => seg[f.key]); },
    fmtSegDur(start, end) {
      const s = this.parseTime(start), e = this.parseTime(end);
      if (isNaN(s) || isNaN(e)) return "";
      const d = e - s;
      return d.toFixed(1) + "s";
    },
    parseTime(str) {
      if (!str) return NaN;
      const parts = str.split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parseFloat(str);
    },
    async saveSegField(seg, field, value) {
      const old = seg[field];
      if (value === old) return;
      seg[field] = value;
      try {
        await API.updateSegment(seg.media_id, seg.id, { [field]: value });
      } catch (e) {
        seg[field] = old;
        Quasar.Notify.create({ message: t('d.n_save_fail', {err: e.message || e}), position: 'top', color: 'negative', timeout: 2000 });
      }
    },
    async removeTag(seg, field, tag) {
      const arr = seg[field] || [];
      const newArr = arr.filter(t => t !== tag);
      if (newArr.length === arr.length) return;
      const old = [...arr];
      seg[field] = newArr;
      try {
        await API.updateSegment(seg.media_id, seg.id, { [field]: newArr });
      } catch (e) {
        seg[field] = old;
        Quasar.Notify.create({ message: t('d.n_save_fail', {err: e.message || e}), position: 'top', color: 'negative', timeout: 2000 });
      }
    },
    async addTag(seg, field, inputEl) {
      const val = (inputEl.value || "").trim();
      if (!val) return;
      const arr = seg[field] || [];
      if (arr.includes(val)) return;
      const old = [...arr];
      arr.push(val);
      seg[field] = [...arr];
      try {
        await API.updateSegment(seg.media_id, seg.id, { [field]: arr });
      } catch (e) {
        seg[field] = old;
        Quasar.Notify.create({ message: t('d.n_save_fail', {err: e.message || e}), position: 'top', color: 'negative', timeout: 2000 });
      }
    },
    confirmDeleteSeg(seg, index) {
      const segs = this.analysis.segments;
      this.deleteSegInfo = {
        seg, index,
        hasPrev: index > 0,
        hasNext: index < segs.length - 1,
        timeStart: seg.time_start,
        timeEnd: seg.time_end,
      };
      this.showDeleteSegDialog = true;
    },
    async doDeleteSeg(adjust) {
      const info = this.deleteSegInfo;
      if (!info) return;
      this.showDeleteSegDialog = false;
      try {
        await API.deleteSegment(info.seg.media_id, info.seg.id, adjust);
        if (adjust === 'prev' && info.hasPrev) {
          this.analysis.segments[info.index - 1].time_end = info.timeEnd;
        } else if (adjust === 'next' && info.hasNext) {
          this.analysis.segments[info.index + 1].time_start = info.timeStart;
        }
        this.analysis.segments.splice(info.index, 1);
        Quasar.Notify.create({ message: t('d.seg_deleted'), position: 'top', color: 'dark', textColor: 'white', timeout: 1500 });
      } catch (e) {
        Quasar.Notify.create({ message: t('d.n_delete_fail', {err: e.message || e}), position: 'top', color: 'negative', timeout: 2000 });
      }
      this.deleteSegInfo = null;
    },
    handleKey(e) {
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA" || e.target.isContentEditable) return;
      const key = e.key;
      // Arrow left/right - prev/next
      if (key === "ArrowLeft" || key === "ArrowRight") {
        e.preventDefault(); e.stopPropagation();
        const dir = key === "ArrowLeft" ? -1 : 1;
        const adjId = this.$root.getAdjacentId(this.media?.id, dir);
        if (adjId) location.hash = "#/detail/" + adjId;
        return;
      }
      // Rating 0-5
      if (key >= "0" && key <= "5") {
        e.preventDefault();
        this.setRating(parseInt(key));
        return;
      }
      // F - toggle fullscreen
      if (key === "f" || key === "F") {
        e.preventDefault();
        if (this.media?.media_type === 'image') this.toggleFullscreen();
        return;
      }
      // Space - play/pause
      if (key === " ") {
        e.preventDefault(); e.stopPropagation();
        const player = this.$refs.player;
        if (player) { player.paused ? player.play().catch(() => {}) : player.pause(); }
        return;
      }
      // Backspace - go back
      if (key === "Backspace") {
        e.preventDefault();
        this.goBack();
        return;
      }
    },
    goBack() { window.location.hash = "#/gallery"; },
    async setRating(val) {
      try {
        await API.updateMedia(this.media.id, { rating: val });
        this.media.rating = val;
        Quasar.Notify.create({ message: val ? t('d.n_rated', {stars: '★'.repeat(val)}) : t('d.n_unrated'), position: 'top', timeout: 1200 });
      } catch (e) {
        Quasar.Notify.create({ message: t('d.n_rate_fail'), position: 'top', color: 'negative', timeout: 1500 });
      }
    },
    async setColor(c) {
      try {
        await API.updateMedia(this.media.id, { color_label: c });
        this.media.color_label = c;
        const names = { red: t('d.color.red'), yellow: t('d.color.yellow'), green: t('d.color.green'), blue: t('d.color.blue'), purple: t('d.color.purple') };
        Quasar.Notify.create({ message: c ? t('d.n_color_set', {color: names[c] || c}) : t('d.n_color_clear'), position: 'top', timeout: 1200 });
      } catch (e) {
        Quasar.Notify.create({ message: t('d.n_rate_fail'), position: 'top', color: 'negative', timeout: 1500 });
      }
    },
    async toggleFav() {
      try {
        const fav = this.media.favorite ? 0 : 1;
        await API.updateMedia(this.media.id, { favorite: fav });
        this.media.favorite = fav;
        Quasar.Notify.create({ message: fav ? t('d.n_fav') : t('d.n_unfav'), position: 'top', timeout: 1200 });
      } catch (e) {
        Quasar.Notify.create({ message: t('d.n_fav_fail'), position: 'top', color: 'negative', timeout: 1500 });
      }
    },
    openInFinder() {
      if (window.electronAPI?.openInFinder) window.electronAPI.openInFinder(this.media.file_path);
    },
    async doWriteXmp() {
      try {
        const res = await API.writeXmp(this.media.id);
        if (res.ok) {
          this.media.has_xmp = 1;
          Quasar.Notify.create({ message: t('d.n_xmp_ok'), position: 'top', timeout: 1500 });
        } else {
          Quasar.Notify.create({ message: t('d.n_xmp_fail'), position: 'top', color: 'negative', timeout: 2000 });
        }
      } catch (e) {
        Quasar.Notify.create({ message: t('d.n_xmp_err', {err: e.message}), position: 'top', color: 'negative', timeout: 2000 });
      }
    },
    async clearAnalysis() {
      try {
        await API.clearAnalysis(this.media.id);
        this.analysis = { status: "none", segments: [] };
        this.$nextTick(() => this._initLottieIdle());
      } catch (e) {
        Quasar.Notify.create({ message: t('d.n_clear_fail', {err: e.message}), position: "top", color: "negative", timeout: 2000 });
      }
    },
    async doAnalysis() {
      try {
        const s = await API.getSettings();
        this.confirmInfo.useMultimodal = s.use_multimodal !== "false";
      } catch (e) {}
      this.analyzing = true;
      this._analyzeSubstep = false;
      this.analysisProgress = t('d.preparing');
      this.analysis = { status: "processing", segments: [] };
      const isImage = this.media?.media_type === "image";
      const useMultimodal = this.confirmInfo.useMultimodal;
      this.analysisStages = isImage ? [
        { key: "analyze", label: t('d.img_analysis'), status: "pending", progress: 0, duration: null, t0: null, statusText: t('d.waiting'), activeText: t('d.analyzing'), doneText: t('d.analysis_done_short') },
      ] : useMultimodal ? [
        { key: "compress", label: t('d.video_compress'), status: "pending", progress: 0, duration: null, t0: null, statusText: t('d.waiting'), activeText: t('d.compressing'), doneText: t('d.compress_done') },
        { key: "encode", label: t('d.video_encode'), status: "pending", progress: 0, duration: null, t0: null, statusText: t('d.waiting'), activeText: t('d.encoding'), doneText: t('d.encode_done') },
        { key: "analyze", label: t('d.ai_comprehensive'), status: "pending", progress: 0, duration: null, t0: null, statusText: t('d.waiting'), activeText: t('d.analyzing'), doneText: t('d.analysis_done_short') },
      ] : [
        { key: "compress", label: t('d.video_compress'), status: "pending", progress: 0, duration: null, t0: null, statusText: t('d.waiting'), activeText: t('d.compressing'), doneText: t('d.compress_done') },
        { key: "encode", label: t('d.video_encode'), status: "pending", progress: 0, duration: null, t0: null, statusText: t('d.waiting'), activeText: t('d.encoding'), doneText: t('d.encode_done') },
        { key: "analyze", label: t('d.ai_model_analysis'), status: "pending", progress: 0, duration: null, t0: null, statusText: t('d.waiting'), activeText: t('d.analyzing'), doneText: t('d.analysis_done_short') },
        { key: "asr", label: t('d.asr'), status: "pending", progress: 0, duration: null, t0: null, statusText: t('d.waiting'), activeText: t('d.transcribing'), doneText: t('d.transcribe_done') },
      ];
      this.$nextTick(() => this._initLottieBusy());
      try {
        const resp = await API.startAnalysis(this.media.id);
        if (!resp.ok) {
          let msg = t('d.n_request_fail', {status: resp.status});
          try { const body = await resp.json(); if (body.error) msg = body.error; } catch {}
          throw new Error(msg);
        }
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("data: ")) continue;
            const jsonStr = trimmed.slice(6);
            if (!jsonStr) continue;
            let evt;
            try { evt = JSON.parse(jsonStr); } catch { continue; }
            if (evt.type === "progress") {
              this.analysisProgress = evt.message;
              if (evt.step === "compressing") {
                this._updateStage("compress", "active");
                if (evt.percent != null) this._setStageProgress("compress", evt.percent);
              }
              if (evt.step === "compressed") {
                const res = (evt.width && evt.height) ? `${evt.width}×${evt.height}` : "";
                const fps = evt.fps ? ` ${evt.fps}fps` : "";
                this._updateStage("compress", "done", `${res}${fps}`);
                this._compressedSize = evt.size_bytes;
                this._updateStage("encode", "active");
              }
              if (evt.step === "analyzing") {
                if (!isImage) {
                  const fmtSize = (b) => {
                    if (!b) return "Base64";
                    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + " GB";
                    if (b >= 1048576) return (b / 1048576).toFixed(1) + " MB";
                    return (b / 1024).toFixed(0) + " KB";
                  };
                  this._updateStage("encode", "done", fmtSize(this._compressedSize));
                }
                this._updateStage("analyze", "active");
                if (evt.substep) {
                  this._setAnalyzeSubstep(evt.substep, evt.chars || 0);
                } else if (!this._analyzeSubstep) {
                  this._startAnalyzeTips();
                }
              }
              if (evt.step === "analyze_done") {
                this._stopAnalyzeTips();
                this._analyzeSubstep = false;
                this._updateStage("analyze", "done");
              }
              if (evt.step === "asr_start") {
                this._updateStage("asr", "active");
              }
              if (evt.step === "asr_progress") {
                const asrLabels = { loading: t('d.asr_loading'), transcribing: t('d.asr_transcribing') };
                this._setAsrSubstep(evt.substep, evt.message || asrLabels[evt.substep] || "");
              }
            } else if (evt.type === "done") {
              this._stopAnalyzeTips();
              this._analyzeSubstep = false;
              this._updateStage("analyze", "done");
              const asrStage = this.analysisStages.find(s => s.key === "asr");
              if (asrStage) {
                if (asrStage.status === "active") {
                  this._updateStage("asr", "done");
                } else if (asrStage.status === "pending") {
                  this.analysisStages = this.analysisStages.map(s =>
                    s.key === "asr" ? { ...s, status: "done", statusText: t('d.asr_not_enabled'), progress: 100, extra: t('d.asr_install_hint') } : s
                  );
                }
              }
              this._stopAllStepTimers();
              this.analysisProgress = "";
              try {
                const res = await API.getAnalysis(this.media.id);
                this.analysis = res;
              } catch {
                this.analysis = { status: "done", segments: [] };
              }
              if (evt.tokens) {
                const fmt = v => v >= 1000 ? (v / 1000).toFixed(1) + 'k' : v;
                Quasar.Dialog.create({
                  title: t('d.analysis_done'),
                  message: `<div style="font-size:13px;line-height:1.8">
                    <div>${t('d.segment_count', {n: evt.segments_count})}</div>
                    <div>${t('d.analyze_time', {t: (evt.analyze_time || 0).toFixed(1)})}</div>
                    ${evt.compress_time ? '<div>' + t('d.compress_time', {t: evt.compress_time.toFixed(1)}) + '</div>' : ''}
                    <div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
                      <div>${t('d.prompt_tokens', {n: fmt(evt.tokens.prompt)})}</div>
                      <div>${t('d.completion_tokens', {n: fmt(evt.tokens.completion)})}</div>
                      <div style="font-weight:600">${t('d.total_tokens', {n: fmt(evt.tokens.total)})}</div>
                    </div>
                  </div>`,
                  html: true,
                  ok: { label: t('d.ok'), color: 'primary', flat: true },
                });
              } else {
                Quasar.Notify.create({ message: t('d.analysis_done_n', {n: evt.segments_count}), position: "top", timeout: 2500 });
              }
            } else if (evt.type === "error") {
              this._stopAnalyzeTips();
              this._stopAllStepTimers();
              this.analysisProgress = "";
              this.analysis = { status: "none", segments: [] };
              Quasar.Notify.create({ message: t('d.n_analysis_fail', {err: evt.message}), position: "top", color: "negative", timeout: 3000 });
            }
          }
        }
      } catch (e) {
        this._stopAnalyzeTips();
        this._stopAllStepTimers();
        this.analysis = { status: "none", segments: [] };
        Quasar.Notify.create({ message: t('d.n_analysis_fail', {err: e.message}), position: "top", color: "negative", timeout: 3000 });
      }
      this.analyzing = false;
    },
    seekTo(timeStr) {
      const player = this.$refs.player;
      if (!player || !timeStr) return;
      const parts = timeStr.split(":").map(Number);
      const secs = parts.length === 3
        ? parts[0] * 3600 + parts[1] * 60 + parts[2]
        : parts[0] * 60 + parts[1];
      player.currentTime = secs;
      player.play().catch(() => {});
    },
    // -- Audio waveform --
    onVideoLoaded() {
      const player = this.$refs.player;
      if (!player) return;
      this.loadWaveform();
      player.currentTime = 0.1;
      this.startSegTrack();
    },
    onVideoPlay() { this.startWaveformAnim(); this.startScopes(); },
    onVideoPause() { this.stopWaveformAnim(); this.stopScopes(); this.drawWaveform(); this.drawScopesOnce(); },
    onVideoSeeked() { this.initScopes(); this.drawWaveform(); this.drawScopesOnce(); this.updateActiveSeg(); },
    onVideoError() {
      const player = this.$refs.player;
      let msg = t('d.video_load_fail');
      if (player?.error) {
        const codes = { 1: t('d.err_aborted'), 2: t('d.err_network'), 3: t('d.err_decode'), 4: t('d.err_format') };
        msg = codes[player.error.code] || msg;
      }
      Quasar.Notify.create({ message: msg, position: "top", color: "negative", timeout: 4000 });
    },
    startSegTrack() {
      if (this._segTrackInterval) return;
      this._segTrackInterval = setInterval(() => this.updateActiveSeg(), 250);
    },
    updateActiveSeg() {
      const player = this.$refs.player;
      const segs = this.analysis.segments;
      if (!player || !segs?.length) return;
      const t = player.currentTime;
      let idx = segs.findIndex(s => t >= this.parseTime(s.time_start) && t < this.parseTime(s.time_end));
      if (idx === -1) return;
      if (idx === this.activeSeg) return;
      this.activeSeg = idx;
      this.$nextTick(() => {
        const scroll = this.$refs.segScroll;
        if (!scroll) return;
        const container = scroll.getScrollTarget();
        const content = container.firstElementChild;
        const el = content?.children[idx];
        if (!el) return;
        const containerH = container.clientHeight;
        const scrollTop = container.scrollTop;
        const elTop = el.offsetTop;
        const elH = el.offsetHeight;
        if (elTop >= scrollTop && elTop + elH <= scrollTop + containerH) return;
        const scrollTo = elTop - (containerH - elH) / 2;
        scroll.setScrollPosition("vertical", Math.max(0, scrollTo), 200);
      });
    },
    async loadWaveform() {
      const player = this.$refs.player;
      const canvas = this.$refs.wfCanvas;
      if (!player || !canvas) return;
      try {
        const resp = await fetch(player.src);
        const buf = await resp.arrayBuffer();
        const actx = new (window.AudioContext || window.webkitAudioContext)();
        const audio = await actx.decodeAudioData(buf);
        actx.close();
        const data = audio.getChannelData(0);
        this._wfDuration = audio.duration;
        const rect = this.$refs.waveformWrap.getBoundingClientRect();
        const w = Math.floor(rect.width);
        const samplesPerPeak = Math.max(1, Math.floor(data.length / w));
        this._wfPeaks = [];
        for (let i = 0; i < w; i++) {
          let max = 0;
          const start = i * samplesPerPeak;
          for (let j = 0; j < samplesPerPeak; j++) {
            const idx = start + j;
            if (idx < data.length) { const v = Math.abs(data[idx]); if (v > max) max = v; }
          }
          this._wfPeaks.push(max);
        }
        this.resizeWaveformCanvas();
        this.drawWaveform();
      } catch (e) { this._wfPeaks = null; }
    },
    resizeWaveformCanvas() {
      const canvas = this.$refs.wfCanvas;
      const wrap = this.$refs.waveformWrap;
      if (!canvas || !wrap) return;
      const dpr = window.devicePixelRatio || 1;
      const rect = wrap.getBoundingClientRect();
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext('2d');
      ctx.scale(dpr, dpr);
    },
    drawWaveform() {
      const canvas = this.$refs.wfCanvas;
      const player = this.$refs.player;
      if (!canvas || !player || !this._wfPeaks) return;
      const wrap = this.$refs.waveformWrap;
      const rect = wrap.getBoundingClientRect();
      const w = rect.width, h = rect.height;
      const ctx = canvas.getContext('2d');
      const dpr = window.devicePixelRatio || 1;
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const mid = h / 2;
      const time = player.currentTime;
      const played = (time / this._wfDuration) * w;
      for (let i = 0; i < this._wfPeaks.length; i++) {
        const barH = Math.max(1, this._wfPeaks[i] * mid * 0.85);
        ctx.fillStyle = i < played ? 'rgba(108,140,255,0.5)' : getComputedStyle(document.documentElement).getPropertyValue('--border2').trim();
        ctx.fillRect(i, mid - barH, 1, barH * 2);
      }
      const x = (time / this._wfDuration) * w;
      ctx.fillStyle = '#6c8cff';
      ctx.fillRect(Math.round(x) - 1, 0, 2, h);
      ctx.restore();
    },
    startWaveformAnim() {
      if (this._wfAnimFrame) return;
      const loop = () => {
        if (this.$refs.player?.paused) { this._wfAnimFrame = null; return; }
        this.drawWaveform();
        this._wfAnimFrame = requestAnimationFrame(loop);
      };
      this._wfAnimFrame = requestAnimationFrame(loop);
    },
    stopWaveformAnim() {
      if (this._wfAnimFrame) { cancelAnimationFrame(this._wfAnimFrame); this._wfAnimFrame = null; }
    },
    onWaveformClick(e) {
      const player = this.$refs.player;
      if (!player || !this._wfPeaks || !this._wfDuration) return;
      const rect = this.$refs.waveformWrap.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      player.currentTime = ratio * this._wfDuration;
      this.drawWaveform();
    },
    // -- Video scopes --
    initScopes() {
      const dpr = window.devicePixelRatio || 1;
      ['scopeWf', 'scopePr', 'scopeVt'].forEach(ref => {
        const c = this.$refs[ref];
        if (c) { const r = c.parentElement.getBoundingClientRect(); c.width = Math.round(r.width * dpr); c.height = Math.round(r.height * dpr); }
      });
      this._scopeOffscreen = document.createElement('canvas');
      this._scopeOffCtx = this._scopeOffscreen.getContext('2d', { willReadFrequently: true });
    },
    captureFrame() {
      const player = this.$refs.player;
      if (!player?.videoWidth) return null;
      const scale = 0.2;
      const sw = Math.max(1, Math.floor(player.videoWidth * scale));
      const sh = Math.max(1, Math.floor(player.videoHeight * scale));
      this._scopeOffscreen.width = sw;
      this._scopeOffscreen.height = sh;
      this._scopeOffCtx.drawImage(player, 0, 0, sw, sh);
      return this._scopeOffCtx.getImageData(0, 0, sw, sh);
    },
    drawWaveformScope(imgData) {
      const c = this.$refs.scopeWf; if (!c) return;
      const ctx = c.getContext('2d');
      const cw = c.width, ch = c.height;
      const out = ctx.createImageData(cw, ch);
      const px = out.data;
      const { data, width: fw, height: fh } = imgData;
      for (let y = 0; y < fh; y += 2) {
        for (let x = 0; x < fw; x += 2) {
          const i = (y * fw + x) * 4;
          const luma = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
          const sx = Math.floor((x / fw) * cw);
          const sy = Math.floor((1 - luma / 255) * (ch - 1));
          if (sx >= 0 && sx < cw && sy >= 0 && sy < ch) {
            const pi = (sy * cw + sx) * 4;
            px[pi] = Math.min(255, px[pi] + 20);
            px[pi+1] = Math.min(255, px[pi+1] + 22);
            px[pi+2] = Math.min(255, px[pi+2] + 28);
            px[pi+3] = 255;
          }
        }
      }
      ctx.putImageData(out, 0, 0);
    },
    drawParadeScope(imgData) {
      const c = this.$refs.scopePr; if (!c) return;
      const ctx = c.getContext('2d');
      const cw = c.width, ch = c.height;
      const out = ctx.createImageData(cw, ch);
      const px = out.data;
      const { data, width: fw, height: fh } = imgData;
      const third = Math.floor(cw / 3);
      for (let y = 0; y < fh; y += 2) {
        for (let x = 0; x < fw; x += 2) {
          const i = (y * fw + x) * 4;
          const ch_ = [data[i], data[i+1], data[i+2]];
          for (let ci = 0; ci < 3; ci++) {
            const sx = Math.floor((x / fw) * third) + ci * third;
            const sy = Math.floor((1 - ch_[ci] / 255) * (ch - 1));
            if (sx >= 0 && sx < cw && sy >= 0 && sy < ch) {
              const pi = (sy * cw + sx) * 4;
              if (ci === 0) px[pi] = Math.min(255, px[pi] + 18);
              else if (ci === 1) px[pi+1] = Math.min(255, px[pi+1] + 18);
              else px[pi+2] = Math.min(255, px[pi+2] + 18);
              px[pi+3] = 255;
            }
          }
        }
      }
      for (let y = 0; y < ch; y++) {
        for (const dx of [third, third * 2]) {
          if (dx < cw) { const pi = (y * cw + dx) * 4; px[pi] = px[pi+1] = px[pi+2] = 25; px[pi+3] = 255; }
        }
      }
      ctx.putImageData(out, 0, 0);
    },
    drawVectorscope(imgData) {
      const c = this.$refs.scopeVt; if (!c) return;
      const ctx = c.getContext('2d');
      const cw = c.width, ch = c.height;
      const out = ctx.createImageData(cw, ch);
      const px = out.data;
      const cx = cw / 2, cy = ch / 2;
      const radius = Math.min(cx, cy) * 0.9;
      const { data, width: fw, height: fh } = imgData;
      for (let y = 0; y < fh; y += 3) {
        for (let x = 0; x < fw; x += 3) {
          const i = (y * fw + x) * 4;
          const r = data[i], g = data[i+1], b = data[i+2];
          const cb = (-0.169 * r - 0.331 * g + 0.5 * b) / 127.5;
          const cr = (0.5 * r - 0.419 * g - 0.081 * b) / 127.5;
          const sx = Math.round(cx + cb * radius);
          const sy = Math.round(cy - cr * radius);
          if (sx >= 0 && sx < cw && sy >= 0 && sy < ch) {
            const pi = (sy * cw + sx) * 4;
            px[pi] = Math.min(255, px[pi] + 10);
            px[pi+1] = Math.min(255, px[pi+1] + 12);
            px[pi+2] = Math.min(255, px[pi+2] + 14);
            px[pi+3] = 255;
          }
        }
      }
      ctx.putImageData(out, 0, 0);
      ctx.strokeStyle = 'rgba(255,255,255,0.08)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(cx - radius, cy); ctx.lineTo(cx + radius, cy);
      ctx.moveTo(cx, cy - radius); ctx.lineTo(cx, cy + radius);
      ctx.stroke();
    },
    drawScopesOnce() {
      const frame = this.captureFrame();
      if (frame) { this.drawWaveformScope(frame); this.drawParadeScope(frame); this.drawVectorscope(frame); }
    },
    startScopes() {
      if (this._scopeFrame) return;
      const loop = () => {
        const now = performance.now();
        if (now - (this._lastScopeTime || 0) >= 66) {
          this._lastScopeTime = now;
          this.drawScopesOnce();
        }
        this._scopeFrame = requestAnimationFrame(loop);
      };
      this._scopeFrame = requestAnimationFrame(loop);
    },
    stopScopes() {
      if (this._scopeFrame) { cancelAnimationFrame(this._scopeFrame); this._scopeFrame = null; }
    },
    // -- Format helpers --
    fmtDur,
    fmtFps(fps) {
      if (!fps) return "-";
      const parts = fps.split("/");
      if (parts.length === 2) return (parseFloat(parts[0]) / parseFloat(parts[1])).toFixed(2);
      return parseFloat(fps).toFixed(2);
    },
    fmtDate(d) {
      if (!d) return "-";
      const dt = new Date(d);
      if (isNaN(dt)) return d;
      const pad = (n) => n.toString().padStart(2, "0");
      return `${dt.getFullYear()}-${pad(dt.getMonth()+1)}-${pad(dt.getDate())} ${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
    },
    fmtSize,
  },
};
