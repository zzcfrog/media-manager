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
      <q-btn v-if="project" unelevated no-caps dense icon="auto_awesome"
             :label="t('cg.section')" color="accent" @click="openWizard"
             style="font-size:12px;padding:2px 12px;border-radius:8px"></q-btn>
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
      <div style="position:relative;display:flex;flex-shrink:0">
        <div class="wb-material" :class="{'mat-collapsed': matCollapsed}">
          <div class="wb-mat-toolbar">
          <q-input v-model="matSearch" dense filled clearable
                   :placeholder="t('wb.search_placeholder', {n: filteredMedia.length})"
                   class="wb-mat-search"
                   @keyup.enter="searchMedia">
            <template v-slot:prepend><q-icon name="search" size="14px"></q-icon></template>
          </q-input>
          </div>
          <div class="wb-mat-filters">
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
            <q-btn-group unelevated>
              <q-btn unelevated dense size="sm" :label="t('wb.all')"
                     :class="{'mat-type-active': matAdded===''}"
                     @click="matAdded=''"></q-btn>
              <q-btn unelevated dense size="sm" :label="t('wb.added')"
                     :class="{'mat-type-active': matAdded==='added'}"
                     @click="matAdded='added'"></q-btn>
              <q-btn unelevated dense size="sm" :label="t('wb.not_added')"
                     :class="{'mat-type-active': matAdded==='not_added'}"
                     @click="matAdded='not_added'"></q-btn>
            </q-btn-group>
            <div style="flex:1"></div>
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
        <div class="wb-material-list">
          <div class="wb-mat-grid" :style="matGridStyle">
            <div v-if="!project.media || !project.media.length" class="wb-empty-material" style="grid-column:1/-1">{{ t('wb.no_segments') }}</div>
            <div v-else-if="!filteredMedia.length" class="wb-empty-material" style="grid-column:1/-1">{{ t('wb.no_match') }}</div>
            <div v-for="m in filteredMedia" :key="m.id" class="wb-mat-card"
                 :class="{ selected: selectedMedia && selectedMedia.id === m.id }"
                 @click="selectedMedia = m; timelinePlayMode = false"
                 draggable="true"
                 @dragstart="onMatDragStart($event, m)">
              <img :src="'/media/thumbnail/' + m.id" class="wb-mat-thumb" loading="lazy">
              <span v-if="isMediaOnTimeline(m.id)" class="wb-mat-badge">{{ t('wb.added') }}</span>
              <div class="wb-mat-overlay">
                <div class="wb-mat-meta">
                  <span v-if="m.duration">{{ fmtDur(m.duration) }}</span>
                  <span>{{ mediaSegments(m.id).length }} {{ t('wb.seg_unit') }}</span>
                </div>
                <div class="wb-mat-name" :title="m.file_name">{{ m.file_name }}</div>
              </div>
            </div>
          </div>
        </div>
        <div class="wb-mat-footer">
          <span style="font-size:10px;color:var(--text3);margin-right:8px;min-width:24px;text-align:right">{{ matCols }}{{ t('wb.cols') }}</span>
          <q-slider v-model="matCols" :min="2" :max="4" :step="1"
                    style="width:90px;--q-primary:var(--accent);padding:0 10px" color="primary"></q-slider>
        </div>
        </div>
      </div>

      <!-- Right: Preview -->
      <div class="wb-preview">
        <template v-if="selectedMedia">
          <!-- Left: player area -->
          <div class="wb-preview-left">
            <!-- Video -->
            <template v-if="selectedMedia.media_type === 'video'">
              <div v-if="mediaDetail" style="flex-shrink:0;position:relative">
                <q-btn flat round dense :icon="metaCollapsed?'expand_more':'expand_less'"
                       size="xs" class="wb-collapse-btn" style="position:absolute;top:4px;right:4px;z-index:1"
                       @click="metaCollapsed=!metaCollapsed"></q-btn>
                <div class="img-meta-bar" v-show="!metaCollapsed">
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.video') }}</div>
                  <div style="display:flex;gap:14px;align-items:flex-start">
                    <div class="meta-grid" style="gap:4px 14px">
                      <span class="meta-label">{{ t('d.resolution') }}</span><span>{{ mediaDetail.width }}x{{ mediaDetail.height }}</span>
                      <span class="meta-label">{{ t('d.duration') }}</span><span>{{ fmtDur(mediaDetail.duration) }}</span>
                      <span class="meta-label">{{ t('d.codec') }}</span><span>{{ mediaDetail.video_codec }}<template v-if="mediaDetail.video_profile"> ({{ mediaDetail.video_profile }})</template></span>
                    </div>
                    <div class="meta-grid" style="gap:4px 14px">
                      <span class="meta-label">{{ t('d.fps') }}</span><span>{{ fmtFps(mediaDetail.fps) }}</span>
                      <span class="meta-label">{{ t('d.bitrate') }}</span><span v-if="mediaDetail.bit_rate">{{ (mediaDetail.bit_rate / 1000000).toFixed(1) }} Mbps</span><span v-else>-</span>
                      <span class="meta-label">{{ t('d.color_space') }}</span><span>{{ mediaDetail.color_space || '-' }}</span>
                    </div>
                  </div>
                </div>
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.audio') }}</div>
                  <div class="meta-grid" style="gap:4px 14px">
                    <template v-if="mediaDetail.audio_codec">
                      <span class="meta-label">{{ t('d.codec') }}</span><span>{{ mediaDetail.audio_codec }}</span>
                      <span class="meta-label">{{ t('d.sample_rate') }}</span><span v-if="mediaDetail.audio_sample_rate">{{ (mediaDetail.audio_sample_rate / 1000).toFixed(1) }} kHz</span><span v-else>-</span>
                      <span class="meta-label">{{ t('d.channels') }}</span><span>{{ mediaDetail.audio_channels === 1 ? t('d.mono') : mediaDetail.audio_channels === 2 ? t('d.stereo') : t('d.ch_n', {n: mediaDetail.audio_channels || '-'}) }}</span>
                    </template>
                    <template v-else><span style="color:var(--text3)">{{ t('d.no_audio') }}</span></template>
                  </div>
                </div>
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.camera_info') }}</div>
                  <div class="meta-grid" style="gap:4px 14px">
                    <span class="meta-label">{{ t('d.make') }}</span><span>{{ mediaDetail.camera_make || '-' }}</span>
                    <span class="meta-label">{{ t('d.model') }}</span><span>{{ mediaDetail.camera_model || '-' }}</span>
                    <span class="meta-label">{{ t('d.lens') }}</span><span>{{ mediaDetail.lens_model || '-' }}</span>
                  </div>
                </div>
              </div>
              </div>
              <div class="wb-video-wrap" style="flex:1;position:relative;min-height:0;overflow:hidden"
                   @mouseenter="showWbOverlay=true" @mouseleave="showWbOverlay=false">
                <video ref="wbPlayer" :src="'/media/video/' + selectedMedia.id"
                       style="width:100%;height:100%;background:#000" preload="auto"
                       @loadeddata="onWbVideoLoaded" @play="onWbVideoPlay" @pause="onWbVideoPause" @seeked="onWbVideoSeeked"
                       @timeupdate="onWbTimeUpdate" @ended="onWbVideoEnded" @click="toggleWbPlay" @error="onWbMediaError"></video>
                <!-- Hidden video for preloading next segment into browser cache -->
                <video ref="wbPreload" style="display:none" preload="auto"></video>
                <div v-show="showWbOverlay" class="wb-player-overlay">{{ selectedMedia.file_name }}</div>
                <div class="wb-controls" v-show="showWbOverlay" @mouseenter="showWbOverlay=true">
                  <q-btn flat round dense :icon="wbPlaying?'pause':'play_arrow'" size="sm" color="white" @click="toggleWbPlay"></q-btn>
                  <q-btn flat round dense icon="fullscreen" size="sm" color="white" @click="toggleWbFullscreen">
                    <q-tooltip :delay="500">{{ t('wb.fullscreen') }}</q-tooltip>
                  </q-btn>
                  <span class="wb-ctrl-time">{{ fmtSec(timelinePlayMode ? playheadTime : wbCurrentTime) }} / {{ fmtSec(displayDuration) }}</span>
                  <div class="wb-seekbar" ref="wbSeekbar" @mousedown="onWbSeekStart" @mousemove="onWbSeekHover" @mouseleave="hoverSegIndex=-1;wbHoverTime=-1">
                    <div v-for="(seg,i) in seekbarSegments" :key="'s'+seg.id"
                         class="wb-seg-mark"
                         :class="{ active: activeSegIndex === i }"
                         :style="segBlockStyle(seg)"
                         @mouseenter="hoverSegIndex=i" @mouseleave="hoverSegIndex=-1">
                      <q-tooltip anchor="top middle" self="bottom middle" :delay="0" :offset="[0,8]" class="wb-seg-tooltip">
                        <div style="font-weight:600;margin-bottom:4px">{{ timelinePlayMode ? seg._tlTimeStart : seg.time_start }} → {{ timelinePlayMode ? seg._tlTimeEnd : seg.time_end }} <span style="opacity:0.6">{{ fmtSegDur(timelinePlayMode ? seg._tlTimeStart : seg.time_start, timelinePlayMode ? seg._tlTimeEnd : seg.time_end) }}</span></div>
                        <div v-if="seg.visual" style="margin-bottom:3px">{{ seg.visual }}</div>
                        <div v-if="seg.asr && seg.asr!=='无'" style="opacity:0.8;margin-bottom:2px"><span style="opacity:0.5">ASR:</span> {{ seg.asr }}</div>
                        <div v-if="seg.subtitle && seg.subtitle!=='无'" style="opacity:0.8;margin-bottom:2px"><span style="opacity:0.5">SUB:</span> {{ seg.subtitle }}</div>
                        <div v-if="dimRowCam(seg)" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:2px">
                          <template v-for="f in camFields" :key="f.key"><span v-if="seg[f.key]" class="wb-tip-dim"><span class="wb-tip-label">{{ t('d.dim.' + f.key) }}</span>{{ seg[f.key] }}</span></template>
                        </div>
                        <div v-if="dimRowScene(seg)" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:2px">
                          <template v-for="f in sceneFields" :key="f.key"><span v-if="seg[f.key]" class="wb-tip-dim"><span class="wb-tip-label">{{ t('d.dim.' + f.key) }}</span>{{ seg[f.key] }}</span></template>
                        </div>
                        <div v-if="dimRowStyle(seg)" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:2px">
                          <template v-for="f in styleFields" :key="f.key"><span v-if="seg[f.key]" class="wb-tip-dim"><span class="wb-tip-label">{{ t('d.dim.' + f.key) }}</span>{{ seg[f.key] }}</span></template>
                        </div>
                        <div v-if="seg.dominant_colors?.length" style="display:flex;gap:3px;flex-wrap:wrap;margin-bottom:2px">
                          <span v-for="c in seg.dominant_colors" :key="c" class="wb-tip-pill">{{ c }}</span>
                        </div>
                        <div v-if="seg.main_subjects?.length" style="display:flex;gap:3px;flex-wrap:wrap">
                          <span v-for="s in seg.main_subjects" :key="s" class="wb-tip-pill">{{ s }}</span>
                        </div>
                      </q-tooltip>
                    </div>
                    <div class="wb-seek-hover" v-if="wbHoverTime>=0 && displayDuration" :style="wbHoverStyle"></div>
                    <div class="wb-seek-progress" v-if="displayDuration" :style="wbProgressStyle"></div>
                  </div>
                </div>
                <q-btn v-if="scopesCollapsed" flat round dense icon="expand_less"
                       size="xs" color="grey-6" @click="scopesCollapsed=!scopesCollapsed"
                       style="position:absolute;bottom:6px;right:4px;z-index:3">
                  <q-tooltip :delay="500">{{ t('wb.expand_scopes') }}</q-tooltip>
                </q-btn>
              </div>

              <div v-if="!scopesCollapsed" style="flex-shrink:0;position:relative">
                  <div v-show="!timelinePlayMode" class="waveform-wrap" ref="wbWaveformWrap" @click="onWbWaveformClick">
                    <canvas ref="wbWfCanvas"></canvas>
                  </div>
                  <div class="scopes-row" ref="wbScopesRow">
                <div class="scope-box"><canvas ref="wbScopeWf"></canvas><span class="scope-label">Waveform</span></div>
                <div class="scope-box"><canvas ref="wbScopePr"></canvas><span class="scope-label">Parade</span></div>
                <div class="scope-box"><canvas ref="wbScopeVt"></canvas><span class="scope-label">Vectorscope</span></div>
                </div>
                <q-btn flat round dense icon="expand_more"
                       size="xs" class="wb-collapse-btn" style="position:absolute;bottom:4px;right:4px;z-index:1"
                       @click="scopesCollapsed=!scopesCollapsed">
                  <q-tooltip :delay="500">{{ t('wb.collapse_scopes') }}</q-tooltip>
                </q-btn>
              </div>
            </template>
            <!-- Image -->
            <template v-else>
              <div v-if="mediaDetail" style="flex-shrink:0;position:relative">
                <q-btn flat round dense :icon="metaCollapsed?'expand_more':'expand_less'"
                       size="xs" class="wb-collapse-btn" style="position:absolute;top:4px;right:4px;z-index:1"
                       @click="metaCollapsed=!metaCollapsed"></q-btn>
                <div class="img-meta-bar" v-show="!metaCollapsed">
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.image') }}</div>
                  <div class="meta-grid" style="gap:4px 14px">
                    <span class="meta-label">{{ t('d.resolution') }}</span><span>{{ mediaDetail.width }}x{{ mediaDetail.height }}</span>
                    <span class="meta-label">{{ t('d.codec') }}</span><span>{{ mediaDetail.video_codec || '-' }}</span>
                    <span class="meta-label">{{ t('d.color_space') }}</span><span>{{ mediaDetail.color_space || '-' }}</span>
                    <span class="meta-label">{{ t('d.bit_depth') }}</span><span>{{ mediaDetail.pix_fmt || '-' }}</span>
                  </div>
                </div>
                <div class="img-meta-block">
                  <div class="img-meta-title">{{ t('d.camera_info') }}</div>
                  <div class="meta-grid" style="gap:4px 14px">
                    <span class="meta-label">{{ t('d.model') }}</span><span>{{ mediaDetail.camera_model || '-' }}</span>
                    <span class="meta-label">{{ t('d.lens') }}</span><span>{{ mediaDetail.lens_model || '-' }}</span>
                  </div>
                </div>
              </div>
              </div>
              <div style="flex:1;display:flex;align-items:center;justify-content:center;min-height:0;background:#000;position:relative"
                   @mouseenter="showWbOverlay=true" @mouseleave="showWbOverlay=false">
                <q-spinner v-if="previewLoading" size="40px" color="grey-6" style="position:absolute"></q-spinner>
                <img ref="wbImgEl" :src="'/media/image/' + selectedMedia.id"
                     @load="onWbImageLoaded" @error="previewLoading=false"
                     style="max-width:100%;max-height:100%;object-fit:contain">
                <div v-show="showWbOverlay" class="wb-player-overlay">{{ selectedMedia.file_name }}</div>
              </div>
              <div class="histogram-wrap" ref="wbHistWrap"><canvas ref="wbHistCanvas"></canvas></div>
            </template>
          </div>
          <!-- Right: segment info -->
          <div style="position:relative;flex-shrink:0;display:flex">
            <q-btn flat round dense :icon="segCompact?'unfold_more':'unfold_less'"
                   size="xs" class="wb-collapse-btn" style="position:absolute;top:50%;left:-8px;transform:translateY(-50%);z-index:5"
                   @click="segCompact=!segCompact">
            </q-btn>
          <div class="wb-preview-sidebar" :class="{compact: segCompact}">
            <!-- Timeline mode: read-only track items with timeline positions -->
            <template v-if="timelinePlayMode && timelineSegments.length">
              <q-scroll-area ref="wbSegScroll" style="flex:1">
                <div v-for="(seg,i) in timelineSegments" :key="seg.id" class="segment"
                     :class="{ active: activeSegIndex === i }"
                     @click="onSegClick(seg, i)">
                  <div style="display:flex;align-items:center;justify-content:space-between">
                    <div style="display:flex;align-items:center;gap:4px">
                      <span class="seg-time"><span v-text="seg._tlTimeStart"></span> → <span v-text="seg._tlTimeEnd"></span></span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px">
                      <span class="seg-dur">{{ fmtSegDur(seg._tlTimeStart, seg._tlTimeEnd) }}</span>
                    </div>
                  </div>
                  <div class="seg-visual" v-text="seg.visual"></div>
                  <div v-if="!segCompact && seg.asr && seg.asr!=='无'" class="seg-text-line"><span class="prefix">{{ t('d.dialog_asr') }}</span><span v-text="seg.asr"></span></div>
                  <div v-if="!segCompact && seg.subtitle && seg.subtitle!=='无'" class="seg-text-line"><span class="prefix">{{ t('d.dialog_subtitle') }}</span><span v-text="seg.subtitle"></span></div>
                  <div v-if="!segCompact && dimRowCam(seg)" class="dim-row">
                    <span style="font-size:12px">🎥</span>
                    <template v-for="f in camFields" :key="f.key"><span v-if="seg[f.key]" class="dim-pair"><span class="dim-label">{{ t('d.dim.' + f.key) }}</span><span class="dim-value" :class="f.cls" v-text="seg[f.key]"></span></span></template>
                  </div>
                  <div v-if="!segCompact && dimRowScene(seg)" class="dim-row">
                    <span style="font-size:12px">🌍</span>
                    <template v-for="f in sceneFields" :key="f.key"><span v-if="seg[f.key]" class="dim-pair"><span class="dim-label">{{ t('d.dim.' + f.key) }}</span><span class="dim-value" :class="f.cls" v-text="seg[f.key]"></span></span></template>
                  </div>
                  <div v-if="!segCompact && dimRowStyle(seg)" class="dim-row">
                    <span style="font-size:12px">🎨</span>
                    <template v-for="f in styleFields" :key="f.key"><span v-if="seg[f.key]" class="dim-pair"><span class="dim-label">{{ t('d.dim.' + f.key) }}</span><span class="dim-value" :class="f.cls" v-text="seg[f.key]"></span></span></template>
                  </div>
                  <div v-if="!segCompact" class="array-group"><span class="array-label icon-label"><span class="label-icon">🌈</span>{{ t('d.colors') }}</span><div class="array-pills"><span v-for="c in (seg.dominant_colors||[])" :key="c" class="pill color">{{ c }}</span></div></div>
                  <div v-if="!segCompact" class="array-group"><span class="array-label icon-label"><span class="label-icon">🏷️</span>{{ t('d.subjects') }}</span><div class="array-pills"><span v-for="s in (seg.main_subjects||[])" :key="s" class="pill subject">{{ s }}</span></div></div>
                </div>
              </q-scroll-area>
            </template>
            <!-- Media mode: editable segments with original positions -->
            <template v-else-if="!timelinePlayMode && mediaSegments(selectedMedia.id).length">
              <q-scroll-area ref="wbSegScroll" style="flex:1">
                <div v-for="(seg,i) in mediaSegments(selectedMedia.id)" :key="seg.id" class="segment"
                     :class="{ active: activeSegIndex === i }"
                     @click="onSegClick(seg, i)"
                     draggable="true"
                     @dragstart="onSegDragStart($event, seg)">
                  <div style="display:flex;align-items:center;justify-content:space-between">
                    <div style="display:flex;align-items:center;gap:4px">
                      <span class="seg-drag-handle" :title="t('wb.drag_to_track')"><q-icon name="drag_indicator" size="16px" color="grey-5"></q-icon></span>
                      <span class="seg-time"><span class="seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'time_start', e.target.innerText.trim())" v-text="seg.time_start"></span> → <span class="seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'time_end', e.target.innerText.trim())" v-text="seg.time_end"></span></span>
                    </div>
                    <div style="display:flex;align-items:center;gap:6px">
                      <span v-if="isSegOnTimeline(seg.id)" class="seg-added-badge">{{ t('wb.added') }}</span>
                      <span class="seg-dur">{{ fmtSegDur(seg.time_start, seg.time_end) }}</span>
                    </div>
                  </div>
                  <div class="seg-visual seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'visual', e.target.innerText)" v-text="seg.visual"></div>
                  <div v-if="!segCompact && seg.asr && seg.asr!=='无'" class="seg-text-line seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'asr', e.target.innerText)"><span class="prefix">{{ t('d.dialog_asr') }}</span><span v-text="seg.asr"></span></div>
                  <div v-if="!segCompact && seg.subtitle && seg.subtitle!=='无'" class="seg-text-line seg-editable" contenteditable @click.stop @blur="e => saveSegField(seg, 'subtitle', e.target.innerText)"><span class="prefix">{{ t('d.dialog_subtitle') }}</span><span v-text="seg.subtitle"></span></div>
                  <div v-if="!segCompact && dimRowCam(seg)" class="dim-row">
                    <span style="font-size:12px">🎥</span>
                    <template v-for="f in camFields" :key="f.key"><span v-if="seg[f.key]" class="dim-pair"><span class="dim-label">{{ t('d.dim.' + f.key) }}</span><span class="dim-value seg-editable" :class="f.cls" contenteditable @click.stop @blur="e => saveSegField(seg, f.key, e.target.innerText.trim())" v-text="seg[f.key]"></span></span></template>
                  </div>
                  <div v-if="!segCompact && dimRowScene(seg)" class="dim-row">
                    <span style="font-size:12px">🌍</span>
                    <template v-for="f in sceneFields" :key="f.key"><span v-if="seg[f.key]" class="dim-pair"><span class="dim-label">{{ t('d.dim.' + f.key) }}</span><span class="dim-value seg-editable" :class="f.cls" contenteditable @click.stop @blur="e => saveSegField(seg, f.key, e.target.innerText.trim())" v-text="seg[f.key]"></span></span></template>
                  </div>
                  <div v-if="!segCompact && dimRowStyle(seg)" class="dim-row">
                    <span style="font-size:12px">🎨</span>
                    <template v-for="f in styleFields" :key="f.key"><span v-if="seg[f.key]" class="dim-pair"><span class="dim-label">{{ t('d.dim.' + f.key) }}</span><span class="dim-value seg-editable" :class="f.cls" contenteditable @click.stop @blur="e => saveSegField(seg, f.key, e.target.innerText.trim())" v-text="seg[f.key]"></span></span></template>
                  </div>
                  <div v-if="!segCompact" class="array-group"><span class="array-label icon-label"><span class="label-icon">🌈</span>{{ t('d.colors') }}</span><div class="array-pills"><span v-for="c in (seg.dominant_colors||[])" :key="c" class="pill color seg-editable-tag" @click.stop="removeTag(seg, 'dominant_colors', c)">{{ c }}<span style="margin-left:2px;opacity:0.5">×</span></span><input class="tag-add-input" placeholder="+" @click.stop @keydown.enter.stop.prevent="e => { addTag(seg, 'dominant_colors', e.target); e.target.value='' }" /></div></div>
                  <div v-if="!segCompact" class="array-group"><span class="array-label icon-label"><span class="label-icon">🏷️</span>{{ t('d.subjects') }}</span><div class="array-pills"><span v-for="s in (seg.main_subjects||[])" :key="s" class="pill subject seg-editable-tag" @click.stop="removeTag(seg, 'main_subjects', s)">{{ s }}<span style="margin-left:2px;opacity:0.5">×</span></span><input class="tag-add-input" placeholder="+" @click.stop @keydown.enter.stop.prevent="e => { addTag(seg, 'main_subjects', e.target); e.target.value='' }" /></div></div>
                </div>
              </q-scroll-area>
            </template>
            <div v-else style="font-size:11px;color:var(--text3);padding:12px">{{ t('wb.no_segments') }}</div>
          </div>
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
      <div class="wb-track-toolbar">
        <div style="display:flex;align-items:center;gap:2px">
          <q-btn flat dense icon="undo" size="sm" color="grey-6" :disable="!trackCanUndo" @click="trackUndo">
            <q-tooltip :delay="500">{{ t('wb.undo') }}</q-tooltip>
          </q-btn>
          <q-btn flat dense icon="redo" size="sm" color="grey-6" :disable="!trackCanRedo" @click="trackRedo">
            <q-tooltip :delay="500">{{ t('wb.redo') }}</q-tooltip>
          </q-btn>
          <q-btn flat dense icon="content_cut" size="sm" color="grey-6" :disable="!trackSelectedItem" @click="trackSplit">
            <q-tooltip :delay="500">{{ t('wb.split') }}</q-tooltip>
          </q-btn>
          <q-btn flat dense icon="delete_outline" size="sm" color="grey-6" :disable="!trackSelectedItem" @click="trackDelete">
            <q-tooltip :delay="500">{{ t('wb.delete') }}</q-tooltip>
          </q-btn>
        </div>
        <div style="flex:1"></div>
        <div style="display:flex;align-items:center;gap:2px">
          <q-btn flat dense size="sm" color="grey-6" @click="zoomToFit">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="22" height="9" rx="2"/><line x1="5" y1="3" x2="5" y2="7"/><line x1="9" y1="3" x2="9" y2="9"/><line x1="13" y1="3" x2="13" y2="7"/><line x1="17" y1="3" x2="17" y2="9"/><line x1="21" y1="3" x2="21" y2="7"/><line x1="2" y1="16.5" x2="2" y2="20.5"/><line x1="22" y1="16.5" x2="22" y2="20.5"/><line x1="4.5" y1="18.5" x2="19.5" y2="18.5"/><polyline points="4.5,18.5 7,17"/><polyline points="4.5,18.5 7,20"/><polyline points="19.5,18.5 17,17"/><polyline points="19.5,18.5 17,20"/></svg>
            <q-tooltip :delay="500">{{ t('wb.zoom_fit') }}</q-tooltip>
          </q-btn>
          <q-btn flat dense size="sm" color="grey-6" style="margin-right:6px" @click="trackZoom = Math.max(1, trackZoom - 1)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10" cy="10" r="7"/><line x1="14.95" y1="14.95" x2="18" y2="18"/><line x1="7" y1="10" x2="13" y2="10"/></svg>
            <q-tooltip :delay="500">{{ t('wb.zoom_out') }}</q-tooltip>
          </q-btn>
          <q-slider v-model="trackZoom" :min="1" :max="10" :step="1"
                    style="width:80px;--q-primary:var(--accent);padding:0" color="primary" dense></q-slider>
          <q-btn flat dense size="sm" color="grey-6" style="margin-left:6px" @click="trackZoom = Math.min(10, trackZoom + 1)">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="10" cy="10" r="7"/><line x1="14.95" y1="14.95" x2="18" y2="18"/><line x1="10" y1="7" x2="10" y2="13"/><line x1="7" y1="10" x2="13" y2="10"/></svg>
            <q-tooltip :delay="500">{{ t('wb.zoom_in') }}</q-tooltip>
          </q-btn>
        </div>
      </div>
      <div class="wb-timeline-scroll" ref="wbTimelineScroll" @click="onTimelineClick">
        <div class="wb-playhead" :style="{left: (60 + Math.round(playheadTime * pps)) + 'px'}" @mousedown.stop="onPlayheadDown"></div>
        <div class="wb-ruler-row">
          <div class="wb-track-label"></div>
          <div class="wb-ruler-content" :style="rulerStyle">
            <span v-for="tick in rulerTicks" :key="tick.t" class="wb-ruler-tick" :style="{left: tick.x + 'px'}">
              <span class="wb-ruler-label">{{ tick.label }}</span>
            </span>
          </div>
        </div>
        <div v-for="tt in trackTypes" :key="tt.key" class="wb-track-row" :class="{'wb-track-row-video': tt.key === 'video'}">
          <div class="wb-track-label">{{ t('wb.track_' + tt.key) }}</div>
          <div class="wb-track-content" :style="{width: timelineWidth + 'px'}"
               @dragover="onTrackDragOver($event, tt.key)"
               @dragleave="clearDragShift()"
               @drop="onTrackDrop($event, tt.key)">
            <svg v-if="tt.key === 'emotion' && emotionCurvePath.line"
                 class="wb-emotion-curve" :viewBox="'0 0 ' + timelineWidth + ' 28'"
                 preserveAspectRatio="none">
              <path :d="emotionCurvePath.fill" fill="var(--accent)" fill-opacity="0.12"/>
              <path :d="emotionCurvePath.line" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linecap="round"/>
            </svg>
            <div v-for="item in getTrackItems(tt.key)" :key="item.id" class="wb-track-item"
                 :class="['wb-track-' + tt.key, {selected: trackSelectedItem === item.id}]"
                 :style="trackItemPos(item)"
                 @click="trackSelectedItem = item.id"
                 @mousedown="onTrackItemDown($event, item, tt.key)"
                 @mousemove="onTrackItemHover">
              <template v-if="tt.key === 'video'">
                <div v-if="item._segment" class="wb-track-filmstrip"
                     :style="filmstripStyle(item)"></div>
                <span class="wb-track-item-label">{{ item._segment ? (item._segment.mood || item._segment.shot_type || '...') : '?' }}</span>
              </template>
              <template v-else-if="tt.key === 'emotion'">
                <q-tooltip :delay="300" :offset="[0, 4]">
                  {{ (item.emotion_value ?? 0.5).toFixed(2) }}<span v-if="item.content"> · {{ item.content }}</span>
                </q-tooltip>
              </template>
              <template v-else>
                <span class="wb-track-text">{{ item.content || '...' }}</span>
                <q-tooltip v-if="item.content" :delay="400" :offset="[0, 4]">{{ item.content }}</q-tooltip>
              </template>
              <q-menu touch-position context-menu>
                <q-list dense style="min-width: 80px">
                  <q-item clickable v-close-popup @click="trackDelete()">
                    <q-item-section>{{ t('wb.ctx_delete') || '删除' }}</q-item-section>
                  </q-item>
                </q-list>
              </q-menu>
            </div>
            <div class="wb-track-add" :style="trackAddPos(tt.key)" @click="addTrackItem(tt.key)">
              <q-icon name="add" size="14px" color="grey-6"></q-icon>
            </div>
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
      mediaDetail: null,
      activeSegIndex: -1,
      timelinePlayMode: false,
      showWbOverlay: false,
      hoverSegIndex: -1,
      _matPanelWidth: 400,
      metaCollapsed: true,
      scopesCollapsed: true,
      segCompact: false,
      trackPlaying: false,
      trackSpeed: 1,
      trackZoom: 1,
      zoomPps: 2,
      trackCanUndo: false,
      trackCanRedo: false,
      trackSelectedItem: null,
      playheadTime: 0,
      wbPlaying: false,
      wbCurrentTime: 0,
      wbDuration: 0,
      wbHoverTime: -1,
      previewLoading: false,
      matSearch: "",
      matType: "",
      matAdded: "",
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
    _timelineMediaIds() {
      const ids = new Set();
      for (const tr of this.tracks) {
        if (tr.track_type !== 'video') continue;
        try {
          const m = JSON.parse(tr.metadata || '{}');
          if (m.srcMediaId) ids.add(m.srcMediaId);
        } catch(e) {}
        if (tr.segment_id) {
          const seg = this.segments.find(s => s.id === tr.segment_id);
          if (seg) ids.add(seg.media_id);
        }
      }
      return ids;
    },
    matCollapsed: {
      get() { return this.$root.matCollapsed; },
      set(v) { this.$root.matCollapsed = v; }
    },
    filteredMedia() {
      if (!this.project || !this.project.media) return [];
      let list = this.project.media;
      if (this.matType) list = list.filter(m => m.media_type === this.matType);
      if (this.matAdded === 'added') list = list.filter(m => this._timelineMediaIds.has(m.id));
      else if (this.matAdded === 'not_added') list = list.filter(m => !this._timelineMediaIds.has(m.id));
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
    // Total duration of all video track items on timeline (sum of each segment's duration)
    timelineTotalDuration() {
      const items = this.getTrackItems('video');
      if (!items.length) return 0;
      return items.reduce((sum, it) => sum + this._timeToSec(it.time_end) - this._timeToSec(it.time_start), 0);
    },
    // Display duration: timeline total or source video duration
    displayDuration() {
      return this.timelinePlayMode ? this.timelineTotalDuration : this.wbDuration;
    },
    pps() { return this.zoomPps; },
    timelineDuration() {
      let max = 60;
      for (const tr of this.tracks) {
        const s = this._timeToSec(tr.time_end);
        if (s > max) max = s;
      }
      return max + 30;
    },
    timelineWidth() { return Math.round(this.zoomPps * this.timelineDuration); },
    emotionCurvePath() {
      const items = this.getTrackItems('emotion')
        .map(it => ({
          t: (this._timeToSec(it.time_start) + this._timeToSec(it.time_end)) / 2,
          v: it.emotion_value ?? 0.5,
        }))
        .sort((a, b) => a.t - b.t);
      if (!items.length) return { line: '', fill: '' };
      const pps = this.pps;
      const H = 28;
      const pts = [{ x: 0, y: (1 - items[0].v) * H }];
      for (const it of items) pts.push({ x: it.t * pps, y: (1 - it.v) * H });
      pts.push({ x: this.timelineWidth, y: (1 - items[items.length - 1].v) * H });
      let d = `M${pts[0].x},${pts[0].y}`;
      for (let i = 1; i < pts.length; i++) {
        const dx = (pts[i].x - pts[i - 1].x) / 3;
        d += ` C${pts[i - 1].x + dx},${pts[i - 1].y} ${pts[i].x - dx},${pts[i].y} ${pts[i].x},${pts[i].y}`;
      }
      return { line: d, fill: d + ` L${pts[pts.length - 1].x},${H} L${pts[0].x},${H}Z` };
    },
    rulerStyle() {
      const pps = this.zoomPps;
      let interval;
      if (pps >= 100) interval = 1;
      else if (pps >= 40) interval = 5;
      else if (pps >= 20) interval = 10;
      else if (pps >= 8) interval = 30;
      else interval = 60;
      const minor = interval / 10;
      const bgColor = getComputedStyle(document.documentElement).getPropertyValue('--border2').trim() || '#333';
      const grad = `repeating-linear-gradient(to right, ${bgColor} 0px, ${bgColor} 1px, transparent 1px, transparent ${Math.round(minor * pps)}px)`;
      return {
        width: this.timelineWidth + 'px',
        backgroundImage: grad,
        backgroundSize: '100% 4px',
        backgroundPosition: 'bottom left',
        backgroundRepeat: 'no-repeat',
      };
    },
    rulerTicks() {
      const pps = this.zoomPps;
      const w = this.timelineWidth;
      let interval;
      if (pps >= 100) interval = 1;
      else if (pps >= 40) interval = 5;
      else if (pps >= 20) interval = 10;
      else if (pps >= 8) interval = 30;
      else interval = 60;
      const ticks = [];
      for (let t = 0; t * pps < w; t += interval) {
        const m = Math.floor(t / 60);
        const s = t % 60;
        ticks.push({ t, x: Math.round(t * pps), label: m + ':' + String(s).padStart(2, '0') });
      }
      return ticks;
    },
    matGridStyle() {
      return { 'grid-template-columns': `repeat(${this.matCols},1fr)` };
    },
    // Segments shown on the seekbar: timeline or source depending on mode
    seekbarSegments() {
      return this.timelinePlayMode ? this.timelineSegments : this.mediaSegments(this.selectedMedia?.id);
    },
    // Timeline segments: video track items with their timeline positions + original analysis data
    timelineSegments() {
      return this.getTrackItems('video')
        .sort((a, b) => this._timeToSec(a.time_start) - this._timeToSec(b.time_start))
        .map(item => {
          const seg = item._segment || {};
          return {
            ...seg,
            id: item.id,
            _tlTimeStart: item.time_start,
            _tlTimeEnd: item.time_end,
          };
        });
    },
    wbHoverStyle() {
      const total = this.timelinePlayMode ? this.displayDuration : this.wbDuration;
      if (!total) return {};
      return { left: (this.wbHoverTime / total * 100) + '%' };
    },
    wbProgressStyle() {
      const total = this.timelinePlayMode ? this.displayDuration : this.wbDuration;
      const pos = this.timelinePlayMode ? this.playheadTime : this.wbCurrentTime;
      if (!total) return {};
      return { width: (pos / total * 100) + '%' };
    },
  },

  beforeUnmount() {
    this.stopSegTrack();
    this.stopWbWaveformAnim();
    this.stopWbScopes();
    if (this._onWbKey) document.removeEventListener('keydown', this._onWbKey);
    if (this._onDragMove) document.removeEventListener('mousemove', this._onDragMove);
    if (this._onDragEnd) document.removeEventListener('mouseup', this._onDragEnd);
    if (this._zoomAnim) cancelAnimationFrame(this._zoomAnim);
    if (this._playheadAnim) cancelAnimationFrame(this._playheadAnim);
    this.$root.pickerMode = false;
  },

  watch: {
    projectId() { this.load(); },
    selectedMedia(m) {
      this.activeSegIndex = -1;
      this.mediaDetail = null;
      this.wbPlaying = false;
      this.wbCurrentTime = 0;
      this.wbDuration = 0;
      this.wbHoverTime = -1;
      this.hoverSegIndex = -1;
      this.stopSegTrack(); this.stopWbWaveformAnim(); this.stopWbScopes();
      this._wbWfPeaks = null;
      const savedSeek = this._pendingTlSeek;
      this._pendingTlSeek = null;
      this.$nextTick(() => { if (savedSeek) this._pendingTlSeek = savedSeek; });
      this.previewLoading = this.selectedMedia?.media_type === 'image';
      if (m) {
        API.getMedia(m.id).then(res => { this.mediaDetail = res; }).catch(() => {});
      }
    },
    matCols(val) { localStorage.setItem('wb_matCols', val); },
    matSearch(val) {
      clearTimeout(this._searchTimer);
      if (!val) { this.searchMedia(); return; }
      this._searchTimer = setTimeout(() => this.searchMedia(), 400);
    },
    trackSpeed(v) {
      const p = this.$refs.wbPlayer;
      if (p) p.playbackRate = v;
    },
    trackZoom(val) {
      const el = this.$refs.wbTimelineScroll;
      const target = 1 * Math.pow(2, val);
      const centerTime = this.playheadTime;
      const animate = () => {
        const cur = this.zoomPps;
        const diff = target - cur;
        if (Math.abs(diff) < 0.5) {
          this.zoomPps = target;
          if (el) el.scrollLeft = Math.max(0, Math.round(centerTime * target + 60 - el.clientWidth / 2));
          this._zoomAnim = null;
          return;
        }
        this.zoomPps = cur + diff * 0.15;
        if (el) el.scrollLeft = Math.max(0, Math.round(centerTime * this.zoomPps + 60 - el.clientWidth / 2));
        this._zoomAnim = requestAnimationFrame(animate);
      };
      if (this._zoomAnim) cancelAnimationFrame(this._zoomAnim);
      animate();
    },
    tracks: { deep: true },
  },

  created() {
    this._preloadedMediaId = null;
    this.load();
    this._onWbKey = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;
      if (e.code === 'Space') {
        e.preventDefault();
        const p = this.$refs.wbPlayer;
        if (!p) return;
        p.paused ? p.play().catch(() => {}) : p.pause();
      } else if (e.code === 'Delete' || e.code === 'Backspace') {
        e.preventDefault();
        this.trackDelete();
      }
    };
    document.addEventListener('keydown', this._onWbKey);
  },

  methods: {
    zoomToFit() {
      const el = this.$refs.wbTimelineScroll;
      if (!el) return;
      const availWidth = el.clientWidth - 60;
      this.zoomPps = availWidth / this.timelineDuration;
    },
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
      // Auto-select first media so the video player is ready for timeline playback
      if (!this.selectedMedia && this.project?.media?.length) {
        // Prefer the media used in the first video track item
        const videoTracks = this.getTrackItems('video')
          .sort((a, b) => this._timeToSec(a.time_start) - this._timeToSec(b.time_start));
        let mediaId = null;
        if (videoTracks.length) {
          let meta = {};
          try { meta = JSON.parse(videoTracks[0].metadata || '{}'); } catch(e) {}
          mediaId = meta.srcMediaId || (videoTracks[0]._segment?.media_id);
        }
        const m = mediaId
          ? this.project.media.find(x => x.id === mediaId)
          : this.project.media[0];
        if (m) this.selectedMedia = m;
      }
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
    isMediaOnTimeline(mediaId) {
      return this._timelineMediaIds.has(mediaId);
    },
    isSegOnTimeline(segId) {
      return this.tracks.some(tr => tr.segment_id === segId);
    },
    trackSkipStart() {
      const p = this.$refs.wbPlayer;
      if (p) { p.currentTime = 0; p.pause(); }
    },
    trackSkipEnd() {
      const p = this.$refs.wbPlayer;
      if (p && p.duration) { p.currentTime = p.duration; p.pause(); }
    },
    trackTogglePlay() {
      const p = this.$refs.wbPlayer;
      if (!p) return;
      if (p.paused) { p.play().catch(() => {}); this.trackPlaying = true; }
      else { p.pause(); this.trackPlaying = false; }
    },
    trackZoomIn() { this.trackZoom = Math.min(10, this.trackZoom + 1); },
    trackZoomOut() { this.trackZoom = Math.max(1, this.trackZoom - 1); },
    trackFitWidth() { this.trackZoom = 1; },
    filmstripStyle(item) {
      const seg = item._segment;
      if (!seg) return {};
      return {
        backgroundImage: `url(/media/thumbnail/${seg.media_id})`,
        backgroundSize: 'auto 100%',
        backgroundRepeat: 'repeat-x',
      };
    },
    toggleWbFullscreen() {
      const wrap = this.$refs.wbPlayer?.parentElement;
      if (!wrap) return;
      if (!document.fullscreenElement) wrap.requestFullscreen?.();
      else document.exitFullscreen?.();
    },
    _trackSnapshot() {
      if (!this._undoStack) this._undoStack = [];
      if (!this._redoStack) this._redoStack = [];
      this._undoStack.push(JSON.parse(JSON.stringify(this.tracks)));
      this._redoStack = [];
      this.trackCanUndo = true;
      this.trackCanRedo = false;
    },
    _getVideoDur(item) {
      try {
        const m = JSON.parse(item.metadata || '{}');
        if (m.srcStart != null && m.srcEnd != null)
          return Math.max(this._timeToSec(m.srcEnd) - this._timeToSec(m.srcStart), 0.1);
      } catch(e) {}
      return Math.max(this._timeToSec(item.time_end) - this._timeToSec(item.time_start), 0.1);
    },
    _normalizeVideoTrack() {
      const videos = this.tracks.filter(t => t.track_type === 'video');
      if (!videos.length) return;
      // Use array order (user intent), not time-based sort
      const mapping = []; // { oldStart, oldEnd, newStart, newEnd }
      let pos = 0;
      for (const v of videos) {
        const oldStart = this._timeToSec(v.time_start);
        const dur = this._getVideoDur(v);
        const newStart = pos;
        const newEnd = pos + dur;
        v.time_start = this._secToStr(newStart);
        v.time_end = this._secToStr(newEnd);
        mapping.push({ oldStart, oldEnd: oldStart + dur, newStart, newEnd });
        pos = newEnd;
      }
      // Sync other tracks: match by [oldStart, oldEnd) left-closed right-open
      for (const tr of this.tracks) {
        if (tr.track_type === 'video') continue;
        const ts = this._timeToSec(tr.time_start);
        const te = this._timeToSec(tr.time_end);
        for (const m of mapping) {
          if (ts >= m.oldStart && ts < m.oldEnd) {
            const offset = m.newStart - m.oldStart;
            tr.time_start = this._secToStr(ts + offset);
            tr.time_end = this._secToStr(te + offset);
            break;
          }
        }
      }
    },
    async _trackSave() {
      if (!this.projectId) return;
      this._normalizeVideoTrack();
      const payload = this.tracks.map(t => {
        const o = { ...t };
        delete o._segment;
        return o;
      });
      try {
        await API.updateProjectTracks(this.projectId, payload);
      } catch (e) {
        Quasar.Notify.create({ message: t('wb.track_save_fail'), color: 'negative', position: 'top' });
      }
    },
    trackUndo() {
      if (!this._undoStack || !this._undoStack.length) return;
      if (!this._redoStack) this._redoStack = [];
      this._redoStack.push(JSON.parse(JSON.stringify(this.tracks)));
      this.tracks = this._undoStack.pop();
      this.trackCanUndo = this._undoStack.length > 0;
      this.trackCanRedo = true;
      this.trackSelectedItem = null;
      this._trackSave();
    },
    trackRedo() {
      if (!this._redoStack || !this._redoStack.length) return;
      this._undoStack.push(JSON.parse(JSON.stringify(this.tracks)));
      this.tracks = this._redoStack.pop();
      this.trackCanUndo = true;
      this.trackCanRedo = this._redoStack.length > 0;
      this.trackSelectedItem = null;
      this._trackSave();
    },
    trackSplit() {
      if (!this.trackSelectedItem) return;
      const idx = this.tracks.findIndex(t => t.id === this.trackSelectedItem);
      if (idx < 0) return;
      const item = this.tracks[idx];
      if (item.track_type === 'video') {
        // Video split: divide srcStart/srcEnd at midpoint
        let meta = {};
        try { meta = JSON.parse(item.metadata || '{}'); } catch(e) {}
        const srcS = this._timeToSec(meta.srcStart || '0');
        const srcE = this._timeToSec(meta.srcEnd || '5');
        const dur = srcE - srcS;
        if (dur < 1) return;
        const mid = (srcS + srcE) / 2;
        const meta1 = { ...meta, srcEnd: this._secToStr(mid) };
        const meta2 = { ...meta, srcStart: this._secToStr(mid) };
        this._trackSnapshot();
        const part1 = { ...item, id: Date.now(), metadata: JSON.stringify(meta1) };
        const part2 = { ...item, id: Date.now() + 1, metadata: JSON.stringify(meta2) };
        this.tracks.splice(idx, 1, part1, part2);
      } else {
        // Non-video split: divide time_start/time_end at midpoint
        const ts = this._parseDuration(item.time_start, item.time_end);
        if (ts < 2) return;
        this._trackSnapshot();
        const half = ts / 2;
        const tsNum = this._timeToSec(item.time_start);
        const mid = tsNum + half;
        const part1 = { ...item, id: Date.now(), time_end: this._secToStr(mid) };
        const part2 = { ...item, id: Date.now() + 1, time_start: this._secToStr(mid) };
        this.tracks.splice(idx, 1, part1, part2);
      }
      this.trackSelectedItem = null;
      this._trackSave();
    },
    trackDelete() {
      if (!this.trackSelectedItem) return;
      const idx = this.tracks.findIndex(t => t.id === this.trackSelectedItem);
      if (idx < 0) return;
      this._trackSnapshot();
      this.tracks.splice(idx, 1);
      this.trackSelectedItem = null;
      this._trackSave();
    },
    _timeToSec(t) {
      if (!t) return 0;
      const parts = String(t).split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parseFloat(t) || 0;
    },
    trackItemPos(item) {
      const s = this._timeToSec(item.time_start);
      const e = this._timeToSec(item.time_end);
      if (e <= s) return { left: '0px', width: '40px' };
      return {
        left: Math.round(s * this.pps) + 'px',
        width: Math.max(30, Math.round((e - s) * this.pps)) + 'px',
      };
    },
    trackAddPos(trackType) {
      const items = this.getTrackItems(trackType);
      if (!items.length) return { left: '4px' };
      let maxEnd = 0;
      for (const item of items) {
        const e = this._timeToSec(item.time_end);
        if (e > maxEnd) maxEnd = e;
        else {
          const s = this._timeToSec(item.time_start);
          if (s > maxEnd) maxEnd = s;
        }
      }
      return { left: Math.round(maxEnd * this.pps + 4) + 'px' };
    },
    onTimelineClick(e) {
      if (e.target.closest('.wb-track-item') || e.target.closest('.wb-track-add') || e.target.closest('.wb-track-label')) return;
      const scroll = this.$refs.wbTimelineScroll;
      if (!scroll) return;
      const rect = scroll.getBoundingClientRect();
      const x = e.clientX - rect.left + scroll.scrollLeft - 60;
      if (x < 0) return;
      const player = this.$refs.wbPlayer;
      const wasPlaying = player && !player.paused;
      this.playheadTime = x / this.pps;
      this.seekToPlayhead(wasPlaying);
    },
    onPlayheadDown(e) {
      e.preventDefault();
      const scroll = this.$refs.wbTimelineScroll;
      if (!scroll) return;
      const player = this.$refs.wbPlayer;
      const wasPlaying = player && !player.paused;
      if (wasPlaying) player.pause();
      const onMove = (ev) => {
        const rect = scroll.getBoundingClientRect();
        const x = ev.clientX - rect.left + scroll.scrollLeft - 60;
        this.playheadTime = Math.max(0, x / this.pps);
      };
      const onUp = () => {
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
        this.seekToPlayhead(wasPlaying);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    seekToPlayhead(wasPlaying) {
      this.timelinePlayMode = true;
      const player = this.$refs.wbPlayer;
      const items = this.getTrackItems('video').sort((a, b) => this._timeToSec(a.time_start) - this._timeToSec(b.time_start));
      if (!items.length) return;
      // No media selected yet — find the track item at playhead and select its source media
      if (!this.selectedMedia) {
        const item = items.find(it => this.playheadTime >= this._timeToSec(it.time_start) && this.playheadTime < this._timeToSec(it.time_end));
        if (item) {
          let meta = {};
          try { meta = JSON.parse(item.metadata || '{}'); } catch(e) {}
          const mediaId = meta.srcMediaId || (item._segment?.media_id);
          if (mediaId) {
            const m = this.project.media.find(x => x.id === mediaId);
            if (m) this.selectedMedia = m;
          }
        }
        if (!this.selectedMedia) return;
      }
      for (const item of items) {
        const start = this._timeToSec(item.time_start);
        const end = this._timeToSec(item.time_end);
        if (this.playheadTime >= start && this.playheadTime < end) {
          let meta = {};
          try { meta = JSON.parse(item.metadata || '{}'); } catch(e) {}
          const srcStart = this._timeToSec(meta.srcStart || '0:00');
          const offset = this.playheadTime - start;
          const targetTime = srcStart + offset;
          const mediaId = meta.srcMediaId || (item._segment?.media_id);
          const needSwitch = mediaId && this.selectedMedia.id !== mediaId;
          this._currentTlItem = item;
          // Preload next segment's video in hidden element
          this._preloadNextSegment(items, item);
          if (needSwitch) {
            const m = this.project.media.find(x => x.id === mediaId);
            if (m) {
              this._pendingTlSeek = { time: targetTime, play: wasPlaying };
              this.selectedMedia = m;
            }
          } else {
            // Same media — seek directly (video already loaded)
            const doSeek = () => {
              const p = this.$refs.wbPlayer;
              if (p) {
                p.currentTime = targetTime;
                if (wasPlaying) p.play().catch(() => {});
              }
            };
            if (player) doSeek();
            else this.$nextTick(doSeek);
          }
          return;
        }
      }
    },
    _preloadNextSegment(items, currentItem) {
      const tlEnd = this._timeToSec(currentItem.time_end);
      const next = items.find(it => this._timeToSec(it.time_start) >= tlEnd - 0.01);
      if (!next) return;
      let meta = {};
      try { meta = JSON.parse(next.metadata || '{}'); } catch(e) {}
      const mediaId = meta.srcMediaId || (next._segment?.media_id);
      if (!mediaId || mediaId === this._preloadedMediaId) return;
      const el = this.$refs.wbPreload;
      if (el) {
        el.src = '/media/video/' + mediaId;
        this._preloadedMediaId = mediaId;
      }
    },
    syncPlayheadFromPlayer() {
      const player = this.$refs.wbPlayer;
      if (!player || player.paused) return;
      if (!this.timelinePlayMode) return;
      if (this._pendingTlSeek) return;
      const item = this._currentTlItem;
      if (!item) return;
      let meta = {};
      try { meta = JSON.parse(item.metadata || '{}'); } catch(e) {}
      const srcStart = this._timeToSec(meta.srcStart || '0:00');
      const tlEnd = this._timeToSec(item.time_end);
      const tlDur = tlEnd - this._timeToSec(item.time_start);
      const t = player.currentTime;
      const elapsed = Math.max(0, Math.min(t - srcStart, tlDur));
      if (elapsed >= tlDur) {
        const items = this.getTrackItems('video').sort((a, b) => this._timeToSec(a.time_start) - this._timeToSec(b.time_start));
        const next = items.find(it => this._timeToSec(it.time_start) >= tlEnd - 0.01);
        if (next) {
          this.playheadTime = this._timeToSec(next.time_start);
          this.seekToPlayhead(true);
        } else {
          player.pause();
        }
      }
    },
    onSegDragStart(e, seg) {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'segment', ...seg }));
      e.dataTransfer.effectAllowed = 'copy';
      this._extDragDur = this._parseDuration(seg.time_start, seg.time_end) || 5;
    },
    onMatDragStart(e, m) {
      e.dataTransfer.setData('application/json', JSON.stringify({ type: 'media', id: m.id, file_name: m.file_name, media_type: m.media_type, duration: m.duration }));
      e.dataTransfer.effectAllowed = 'copy';
      this._extDragDur = Math.min(m.duration || 5, 5);
    },
    _secToStr(sec) {
      const m = Math.floor(sec / 60);
      const s = sec % 60;
      return m + ':' + String(Math.round(s * 10) / 10).padStart(4, '0');
    },
    onTrackDrop(e, trackType) {
      const data = e.dataTransfer?.getData('application/json');
      if (!data) return;
      try {
        const payload = JSON.parse(data);
        this._trackSnapshot();
        // Compute duration from source segment or media
        let dur;
        if (payload.type === 'segment') {
          dur = this._parseDuration(payload.time_start, payload.time_end) || 5;
        } else {
          dur = Math.min(payload.duration || 5, 5);
        }
        if (trackType === 'video') {
          // Video track: just create item with srcStart/srcEnd, normalization handles position
          const newItem = {
            id: Date.now(),
            track_type: 'video',
            content: payload.visual || '',
            time_start: '0:00.0',
            time_end: this._secToStr(dur),
            emotion_value: 0.5,
            metadata: '{}',
          };
          if (payload.type === 'segment') {
            newItem.segment_id = payload.id;
            newItem._segment = payload;
            newItem.metadata = JSON.stringify({ srcStart: payload.time_start, srcEnd: payload.time_end, srcMediaId: payload.media_id });
          } else {
            newItem.metadata = JSON.stringify({ srcMediaId: payload.id, srcStart: '0:00', srcEnd: this._secToStr(dur) });
          }
          this.tracks.push(newItem);
        } else {
          // Non-video track: compute drop position and insert
          const contentEl = e.currentTarget;
          const rect = contentEl.getBoundingClientRect();
          const dropSec = Math.max(0, (e.clientX - rect.left) / this.pps);
          const items = this.getTrackItems(trackType)
            .map(item => ({ item, start: this._timeToSec(item.time_start), end: this._timeToSec(item.time_end) }))
            .sort((a, b) => a.start - b.start);
          let insertIdx = items.length;
          for (let i = 0; i < items.length; i++) {
            if (dropSec < items[i].end) { insertIdx = i; break; }
          }
          for (let i = insertIdx; i < items.length; i++) {
            const it = items[i].item;
            it.time_start = this._secToStr(this._timeToSec(it.time_start) + dur);
            it.time_end = this._secToStr(this._timeToSec(it.time_end) + dur);
          }
          let newStart = dropSec;
          if (insertIdx > 0 && dropSec < items[insertIdx - 1].end) {
            newStart = items[insertIdx - 1].end;
          }
          const newItem = {
            id: Date.now(),
            track_type: trackType,
            content: payload.visual || '',
            time_start: this._secToStr(newStart),
            time_end: this._secToStr(newStart + dur),
            emotion_value: 0.5,
            metadata: '{}',
          };
          if (payload.type === 'segment') {
            newItem.segment_id = payload.id;
            newItem._segment = payload;
            newItem.metadata = JSON.stringify({ srcStart: payload.time_start, srcEnd: payload.time_end, srcMediaId: payload.media_id });
          } else {
            newItem.metadata = JSON.stringify({ srcMediaId: payload.id, srcStart: '0:00', srcEnd: this._secToStr(dur) });
          }
          this.tracks.push(newItem);
        }
        this.clearDragShift();
        this._extDragDur = null;
        this._trackSave();
      } catch(err) { console.error('onTrackDrop', err); }
    },
    onTrackDragOver(e, trackType) {
      e.preventDefault();
      this.clearDragShift();
      if (!this._extDragDur) return;
      const gapWidth = this._extDragDur * this.pps;
      const contentEl = e.currentTarget;
      const contentRect = contentEl.getBoundingClientRect();
      const mouseX = e.clientX - contentRect.left;
      const children = Array.from(contentEl.querySelectorAll('.wb-track-item'));
      // Use CSS left (original position) not getBoundingClientRect to avoid jitter
      let insertIdx = children.length;
      for (let i = 0; i < children.length; i++) {
        const itLeft = parseFloat(children[i].style.left) || 0;
        const itWidth = children[i].offsetWidth;
        if (mouseX < itLeft + itWidth / 2) { insertIdx = i; break; }
      }
      for (let i = insertIdx; i < children.length; i++) {
        children[i].style.transition = 'transform 0.15s ease';
        children[i].style.transform = `translateX(${gapWidth}px)`;
      }
    },
    addTrackItem(type) {
      this._trackSnapshot();
      if (type === 'video') {
        // Video track: srcStart/srcEnd in metadata, normalization handles timeline position
        this.tracks.push({
          id: Date.now(),
          track_type: 'video',
          content: '',
          time_start: '0:00.0',
          time_end: '0:05.0',
          emotion_value: 0.5,
          metadata: JSON.stringify({ srcStart: '0:00.0', srcEnd: '0:05.0', srcMediaId: null }),
        });
      } else {
        const items = this.getTrackItems(type);
        let maxEnd = 0;
        for (const item of items) {
          const e = this._timeToSec(item.time_end);
          if (e > maxEnd) maxEnd = e;
        }
        this.tracks.push({
          id: Date.now(),
          track_type: type,
          content: '',
          time_start: this._secToStr(maxEnd),
          time_end: this._secToStr(maxEnd + 5),
          emotion_value: 0.5,
          metadata: '{}',
        });
      }
      this._trackSave();
    },
    onTrackItemHover(e) {
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      e.currentTarget.style.cursor = (x < 5 || rect.width - x < 5) ? 'col-resize' : 'grab';
    },
    onTrackItemDown(e, item, trackType) {
      if (e.button !== 0) return;
      const rect = e.currentTarget.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const nearLeft = x < 5;
      const nearRight = rect.width - x < 5;
      this._drag = {
        mode: nearLeft || nearRight ? 'resize' : 'reorder',
        edge: nearLeft ? 'left' : nearRight ? 'right' : null,
        trackType, item,
        startX: e.clientX,
        startY: e.clientY,
        startWidth: rect.width,
        el: e.currentTarget,
      };
      this._onDragMove = (ev) => this._handleDragMove(ev);
      this._onDragEnd = (ev) => this._handleDragEnd(ev);
      document.addEventListener('mousemove', this._onDragMove);
      document.addEventListener('mouseup', this._onDragEnd);
      e.preventDefault();
    },
    clearDragShift() {
      const el = this.$refs.wbTimelineScroll;
      if (!el) return;
      for (const it of el.querySelectorAll('.wb-track-item')) {
        it.style.transition = '';
        it.style.transform = '';
      }
    },
    _handleDragMove(e) {
      const d = this._drag;
      if (!d) return;
      const dx = e.clientX - d.startX;
      if (d.mode === 'reorder') {
        // Create floating thumbnail ghost on first move
        if (!d.ghost) {
          let thumbUrl = '';
          try {
            const meta = JSON.parse(d.item.metadata || '{}');
            const mediaId = meta.srcMediaId || (d.item._segment?.media_id);
            if (mediaId) thumbUrl = `/media/thumbnail/${mediaId}`;
          } catch(e) {}
          const ghost = document.createElement('div');
          ghost.style.cssText = `position:fixed;z-index:9999;pointer-events:none;width:80px;height:50px;border-radius:6px;background:var(--bg,#222) center/cover no-repeat;box-shadow:0 4px 16px rgba(0,0,0,0.4);opacity:0.9;transition:none;cursor:grabbing;`;
          if (thumbUrl) ghost.style.backgroundImage = `url(${thumbUrl})`;
          else ghost.style.background = 'var(--bg,#333)';
          document.body.appendChild(ghost);
          d.ghost = ghost;
          d.el.style.opacity = '0.25';
          d.el.style.cursor = 'grabbing';
          // Store click offset within the element so ghost stays at press point
          const rect = d.el.getBoundingClientRect();
          d.ghostOffX = d.startX - rect.left - 40; // offset to center ghost 80px wide
          d.ghostOffY = d.startY - rect.top - 25;  // offset to center ghost 50px tall
        }
        // Move ghost centered on press point (no jump)
        d.ghost.style.left = (e.clientX - 40) + 'px';
        d.ghost.style.top = (e.clientY - 25) + 'px';
        // Reorder animation: shift siblings to show insertion gap
        // Use CSS left (original position) not getBoundingClientRect (affected by transforms)
        const contentEl = d.el.parentElement;
        const children = Array.from(contentEl.querySelectorAll('.wb-track-item'));
        const fromIdx = children.indexOf(d.el);
        let toIdx = 0;
        for (let i = 0; i < children.length; i++) {
          if (children[i] === d.el) continue;
          const itLeft = parseFloat(children[i].style.left) || 0;
          const itWidth = children[i].offsetWidth;
          const itCenter = itLeft + itWidth / 2;
          if (e.clientX - contentEl.getBoundingClientRect().left > itCenter) toIdx = i;
          else break;
        }
        let adjIdx = toIdx;
        if (fromIdx <= toIdx) adjIdx = Math.min(toIdx, children.length - 1);
        const itemW = d.startWidth;
        for (let i = 0; i < children.length; i++) {
          if (children[i] === d.el) continue;
          children[i].style.transition = 'transform 0.15s ease';
          if (fromIdx < adjIdx) {
            children[i].style.transform = (i > fromIdx && i <= adjIdx) ? `translateX(${-itemW}px)` : '';
          } else if (fromIdx > adjIdx) {
            children[i].style.transform = (i >= adjIdx && i < fromIdx) ? `translateX(${itemW}px)` : '';
          } else {
            children[i].style.transform = '';
          }
        }
      } else {
        if (d.edge === 'right') {
          d.el.style.width = Math.max(30, d.startWidth + dx) + 'px';
        } else {
          d.el.style.width = Math.max(30, d.startWidth - dx) + 'px';
          d.el.style.transform = `translateX(${dx}px)`;
        }
        // Resize push animation: shift subsequent items on all tracks
        if (d.trackType === 'video' && d.edge === 'right') {
          const rightEdge = parseFloat(d.el.style.left) + d.startWidth;
          const timelineEl = this.$refs.wbTimelineScroll;
          if (timelineEl) {
            for (const it of timelineEl.querySelectorAll('.wb-track-item')) {
              if (it === d.el) continue;
              const itLeft = parseFloat(it.style.left);
              if (itLeft >= rightEdge - 1) {
                it.style.transition = 'transform 0.1s ease';
                it.style.transform = `translateX(${dx}px)`;
              } else {
                it.style.transition = 'transform 0.1s ease';
                it.style.transform = '';
              }
            }
          }
        }
      }
    },
    _handleDragEnd(e) {
      document.removeEventListener('mousemove', this._onDragMove);
      document.removeEventListener('mouseup', this._onDragEnd);
      const d = this._drag;
      if (!d) return;
      this.clearDragShift();
      if (d.ghost) { d.ghost.remove(); d.ghost = null; }
      d.el.style.transform = '';
      d.el.style.opacity = '';
      d.el.style.zIndex = '';
      d.el.style.cursor = '';
      if (d.mode === 'reorder') {
        const dx = e.clientX - d.startX;
        if (Math.abs(dx) < 5) { this._drag = null; return; }
        const items = this.getTrackItems(d.trackType);
        const fromIdx = items.indexOf(d.item);
        let toIdx = 0;
        const contentEl = d.el.parentElement;
        const children = Array.from(contentEl.querySelectorAll('.wb-track-item'));
        for (let i = 0; i < children.length; i++) {
          const cr = children[i].getBoundingClientRect();
          if (e.clientX > cr.left + cr.width / 2) toIdx = i;
        }
        if (fromIdx === toIdx) { this._drag = null; return; }
        this._trackSnapshot();
        const actualFrom = this.tracks.indexOf(d.item);
        this.tracks.splice(actualFrom, 1);
        const targetItems = this.getTrackItems(d.trackType);
        const actualTo = toIdx >= targetItems.length
          ? this.tracks.length
          : this.tracks.indexOf(targetItems[Math.min(toIdx, targetItems.length - 1)]);
        this.tracks.splice(actualTo, 0, d.item);
        this._trackSave();
      } else {
        const dx = e.clientX - d.startX;
        if (Math.abs(dx) < 3) { this._drag = null; return; }
        this._trackSnapshot();
        if (d.trackType === 'video') {
          // Video resize: update srcStart/srcEnd in metadata
          let meta = {};
          try { meta = JSON.parse(d.item.metadata || '{}'); } catch(e) {}
          let srcStart = this._timeToSec(meta.srcStart || '0');
          let srcEnd = this._timeToSec(meta.srcEnd || '5');
          const media = this.project?.media?.find(m => m.id === meta.srcMediaId);
          const maxDur = media?.duration || Infinity;
          const deltaSec = dx / this.pps;
          if (d.edge === 'right') {
            srcEnd = Math.min(srcEnd + deltaSec, maxDur);
            if (srcEnd <= srcStart + 0.1) srcEnd = srcStart + 0.1;
          } else {
            srcStart = Math.max(srcStart + deltaSec, 0);
            if (srcStart >= srcEnd - 0.1) srcStart = srcEnd - 0.1;
          }
          meta.srcStart = this._secToStr(srcStart);
          meta.srcEnd = this._secToStr(srcEnd);
          d.item.metadata = JSON.stringify(meta);
        } else {
          // Non-video resize: update time_start/time_end directly
          const deltaSec = dx / this.pps;
          let ts = this._timeToSec(d.item.time_start);
          let te = this._timeToSec(d.item.time_end);
          if (d.edge === 'right') {
            te = Math.max(te + deltaSec, ts + 0.1);
          } else {
            ts = Math.min(ts + deltaSec, te - 0.1);
            if (ts < 0) ts = 0;
          }
          d.item.time_start = this._secToStr(ts);
          d.item.time_end = this._secToStr(te);
        }
        this._trackSave();
      }
      this._drag = null;
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
    openWizard() {
      Quasar.Dialog.create({
        title: t('wb.regenerate_title'),
        message: t('wb.regenerate_msg'),
        cancel: true,
        persistent: false,
        ok: { label: t('wb.regenerate_ok'), color: 'accent', unelevated: true },
      }).onOk(() => {
        const root = this.$root;
        root.wizardEditProjectId = this.projectId;
        root.showCreativeWizard = true;
      });
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
        await this.$root.loadProjectList();
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
    parseTime(str) {
      if (!str) return NaN;
      const parts = str.split(":").map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parseFloat(str);
    },
    segBlockStyle(seg) {
      if (this.timelinePlayMode) {
        const total = this.displayDuration;
        if (!total) return {};
        const s = this._timeToSec(seg._tlTimeStart);
        const e = this._timeToSec(seg._tlTimeEnd);
        const gapPx = 2;
        const pctPerPx = 100 / (this.$refs.wbSeekbar?.clientWidth || 1);
        const gap = Math.min(gapPx * pctPerPx, 0.3);
        return {
          left: (s / total * 100) + '%',
          width: Math.max(0.5, (e - s) / total * 100 - gap) + '%',
        };
      }
      const total = this.selectedMedia?.duration;
      if (!total) return {};
      const s = this.parseTime(seg.time_start);
      const e = this.parseTime(seg.time_end);
      if (isNaN(s) || isNaN(e)) return {};
      const gapPx = 2;
      const pctPerPx = 100 / (this.$refs.wbSeekbar?.clientWidth || 1);
      const gap = Math.min(gapPx * pctPerPx, 0.3);
      return {
        left: (s / total * 100) + '%',
        width: Math.max(0.5, (e - s) / total * 100 - gap) + '%',
      };
    },
    onSegClick(seg, i) {
      this.activeSegIndex = i;
      if (this.selectedMedia?.media_type === 'video') {
        const player = this.$refs.wbPlayer;
        if (player) {
          player.currentTime = this.parseTime(seg.time_start);
          player.play().catch(() => {});
        }
      }
    },
    toggleWbPlay() {
      const p = this.$refs.wbPlayer;
      if (!p) return;
      p.paused ? p.play().catch(() => {}) : p.pause();
    },
    onWbTimeUpdate() {
      const p = this.$refs.wbPlayer;
      if (!p) return;
      this.wbCurrentTime = p.currentTime;
      this.syncPlayheadFromPlayer();
    },
    fmtSec(s) {
      if (!s && s !== 0) return '--:--';
      s = Math.floor(s);
      const m = Math.floor(s / 60);
      const sec = s % 60;
      return m + ':' + String(sec).padStart(2, '0');
    },
    onWbSeekStart(e) {
      const bar = this.$refs.wbSeekbar;
      if (!bar) return;
      const rect = bar.getBoundingClientRect();
      if (this.timelinePlayMode) {
        const seek = (ev) => {
          const x = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
          this.playheadTime = (x / rect.width) * this.displayDuration;
          this.seekToPlayhead(true);
        };
        seek(e);
        const onMove = (ev) => seek(ev);
        const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        return;
      }
      const p = this.$refs.wbPlayer;
      if (!p) return;
      const seek = (ev) => {
        const x = Math.max(0, Math.min(ev.clientX - rect.left, rect.width));
        p.currentTime = (x / rect.width) * this.wbDuration;
        this.wbCurrentTime = p.currentTime;
      };
      seek(e);
      const onMove = (ev) => seek(ev);
      const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    onWbSeekHover(e) {
      const bar = this.$refs.wbSeekbar;
      const total = this.timelinePlayMode ? this.displayDuration : this.wbDuration;
      if (!bar || !total) return;
      const rect = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
      this.wbHoverTime = (x / rect.width) * total;
    },
    startSegTrack() {
      if (this._segTrackInterval) return;
      this._segTrackInterval = setInterval(() => this.updateActiveSeg(), 250);
      this._startPlayheadAnim();
    },
    stopSegTrack() {
      if (this._segTrackInterval) { clearInterval(this._segTrackInterval); this._segTrackInterval = null; }
      this._stopPlayheadAnim();
    },
    _startPlayheadAnim() {
      if (this._playheadAnim) return;
      const tick = () => {
        const player = this.$refs.wbPlayer;
        if (!player || player.paused || !this.timelinePlayMode || !this._currentTlItem) {
          this._playheadAnim = null;
          return;
        }
        let meta = {};
        try { meta = JSON.parse(this._currentTlItem.metadata || '{}'); } catch(e) {}
        const srcStart = this._timeToSec(meta.srcStart || '0:00');
        const tlStart = this._timeToSec(this._currentTlItem.time_start);
        const tlEnd = this._timeToSec(this._currentTlItem.time_end);
        const tlDur = tlEnd - tlStart;
        const t = player.currentTime;
        const elapsed = Math.max(0, Math.min(t - srcStart, tlDur));
        this.playheadTime = tlStart + elapsed;
        this._playheadAnim = requestAnimationFrame(tick);
      };
      this._playheadAnim = requestAnimationFrame(tick);
    },
    _stopPlayheadAnim() {
      if (this._playheadAnim) { cancelAnimationFrame(this._playheadAnim); this._playheadAnim = null; }
    },
    updateActiveSeg() {
      const player = this.$refs.wbPlayer;
      if (!player) return;
      // In timeline mode, also check segment boundaries
      if (this.timelinePlayMode && !player.paused) {
        this.syncPlayheadFromPlayer();
      }
      let idx = -1;
      if (this.timelinePlayMode) {
        // Timeline mode: match by playheadTime vs track item timeline positions
        const segs = this.timelineSegments;
        if (!segs.length) return;
        idx = segs.findIndex(s => this.playheadTime >= this._timeToSec(s._tlTimeStart) && this.playheadTime < this._timeToSec(s._tlTimeEnd));
      } else {
        // Media mode: match by video currentTime vs original segment positions
        const segs = this.mediaSegments(this.selectedMedia?.id);
        if (!segs.length) return;
        const t = player.currentTime;
        idx = segs.findIndex(s => t >= this.parseTime(s.time_start) && t < this.parseTime(s.time_end));
      }
      if (idx === -1 || idx === this.activeSegIndex) return;
      this.activeSegIndex = idx;
      this.$nextTick(() => {
        const scroll = this.$refs.wbSegScroll;
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
        scroll.setScrollPosition("vertical", Math.max(0, elTop - (containerH - elH) / 2), 200);
      });
    },
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
      const p = this.$refs.wbPlayer;
      if (p) { this.wbDuration = p.duration; this.wbCurrentTime = 0; }
      if (this._pendingTlSeek) {
        const { time, play } = this._pendingTlSeek;
        this._pendingTlSeek = null;
        if (p) {
          p.currentTime = time;
          if (play) p.play().catch(() => {});
        }
      }
      this.initWbScopes();
      this.loadWbWaveform();
    },
    onWbMediaError() {
      const name = this.selectedMedia?.file_name || '';
      Quasar.Notify.create({ message: t('wb.media_play_error', { name }), color: 'negative', position: 'top', timeout: 3000 });
      this.wbPlaying = false;
      this.wbDuration = 0;
      this.previewLoading = false;
      this.startSegTrack();
    },
    onWbVideoPlay() { this.wbPlaying = true; this.trackPlaying = true; this.startSegTrack(); this.startWbWaveformAnim(); this.startWbScopes(); },
    onWbVideoPause() { this.wbPlaying = false; this.trackPlaying = false; this.stopSegTrack(); this.stopWbWaveformAnim(); this.stopWbScopes(); this.drawWbWaveform(); if (this._wbScopeOffscreen) this.drawWbScopesOnce(); },
    onWbVideoEnded() {
      // Timeline mode: video ended means this segment's source is done — jump to next
      if (this.timelinePlayMode && this._currentTlItem) {
        const tlEnd = this._timeToSec(this._currentTlItem.time_end);
        const items = this.getTrackItems('video').sort((a, b) => this._timeToSec(a.time_start) - this._timeToSec(b.time_start));
        const next = items.find(it => this._timeToSec(it.time_start) >= tlEnd - 0.01);
        if (next) {
          this.playheadTime = this._timeToSec(next.time_start);
          this.seekToPlayhead(true);
        }
        return;
      }
    },
    onWbVideoSeeked() { this.initWbScopes(); this.drawWbWaveform(); this.drawWbScopesOnce(); this.updateActiveSeg(); },
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
      const borderClr = getComputedStyle(document.documentElement).getPropertyValue('--border2').trim();
      for (let i = 0; i < this._wbWfPeaks.length; i++) {
        const barH = Math.max(1, this._wbWfPeaks[i] * mid * 0.85);
        ctx.fillStyle = i < played ? 'rgba(108,140,255,0.5)' : borderClr;
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
      const c = this.$refs.wbScopeWf; if (!c || !c.width || !c.height) return;
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
      const c = this.$refs.wbScopePr; if (!c || !c.width || !c.height) return;
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
      const c = this.$refs.wbScopeVt; if (!c || !c.width || !c.height) return;
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
