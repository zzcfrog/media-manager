const MindMap = {
  props: {
    plan: { type: Object, default: null },
    segments: { type: Array, default: () => [] },
  },
  emits: ["shot-click", "plan-changed"],
  template: `
<div class="wb-mindmap" v-if="plan">
  <div v-for="(act, ai) in plan.acts" :key="act.act_id"
       class="mm-act" :style="{'--act-color': actColors[ai % actColors.length]}">

    <!-- Act Header -->
    <div class="mm-act-header" @click="toggleAct(act.act_id)">
      <div class="mm-act-color-bar"></div>
      <q-icon :name="expandedActs.includes(act.act_id) ? 'expand_more' : 'chevron_right'" size="18px" color="grey-6"></q-icon>
      <div class="mm-act-info">
        <div class="mm-act-title-row">
          <span v-if="editingField?.type==='act' && editingField?.id===act.act_id && editingField?.field==='title'"
                class="mm-edit-inline">
            <input ref="editInput" v-model="editValue" @blur="saveEdit(act, 'title')"
                   @keydown.enter="$event.target.blur()" @keydown.escape="cancelEdit" />
          </span>
          <span v-else class="mm-editable" @dblclick.stop="startEdit('act', act.act_id, 'title', act.title)">{{ act.title }}</span>
          <span class="mm-act-purpose" v-if="act.purpose"
                @dblclick.stop="startEdit('act', act.act_id, 'purpose', act.purpose)">{{ act.purpose }}</span>
        </div>
        <div class="mm-emotion-range">
          <span class="mm-emotion-label">{{ (act.emotion_start ?? 0).toFixed(1) }}</span>
          <div class="mm-emotion-bar">
            <div class="mm-emotion-bar-fill" :style="{left: ((act.emotion_start??0)*100)+'%', width: (((act.emotion_end??0.5)-(act.emotion_start??0))*100)+'%'}"></div>
          </div>
          <span class="mm-emotion-label">{{ (act.emotion_end ?? 0.5).toFixed(1) }}</span>
        </div>
      </div>
      <div class="mm-actions">
        <span class="mm-badge">{{ t('wb.mm_shots', {n: countActShots(act)}) }}</span>
        <q-btn flat round dense icon="delete_outline" size="xs" color="grey-6" class="mm-delete-btn"
               @click.stop="deleteAct(ai)">
          <q-tooltip :delay="500">{{ t('wb.delete') }}</q-tooltip>
        </q-btn>
      </div>
    </div>

    <!-- Act Body -->
    <div v-if="expandedActs.includes(act.act_id)" class="mm-act-body">
      <div v-for="(nar, ni) in act.narratives" :key="nar.narrative_id"
           class="mm-narrative" draggable="true"
           @dragstart="onDragStart($event, 'narrative', ai, ni)"
           @dragover.prevent="onDragOver"
           @drop.stop="onDrop($event, 'narrative', ni, ai)">

        <!-- Narrative Header -->
        <div class="mm-narrative-header" @click="toggleNarrative(nar.narrative_id)">
          <q-icon :name="expandedNarratives.includes(nar.narrative_id) ? 'expand_more' : 'chevron_right'" size="16px" color="grey-6"></q-icon>
          <span class="mm-nar-time">{{ fmtNarrEntry(getNarrativeEntryTime(ai, ni)) }}</span>
          <div style="flex:1;min-width:0">
            <span v-if="editingField?.type==='narrative' && editingField?.id===nar.narrative_id && editingField?.field==='text'"
                  class="mm-edit-inline">
              <input ref="editInput" v-model="editValue" @blur="saveEdit(nar, 'text')"
                     @keydown.enter="$event.target.blur()" @keydown.escape="cancelEdit" />
            </span>
            <span v-else class="mm-narrative-text mm-editable"
                  @dblclick.stop="startEdit('narrative', nar.narrative_id, 'text', nar.text)">{{ nar.text }}</span>
          </div>
          <div class="mm-actions">
            <span class="mm-badge mm-nar-dur">{{ fmtNarrDur(getNarrativeDuration(nar)) }}</span>
            <span class="mm-badge">{{ nar.shots ? nar.shots.length : 0 }}</span>
            <q-btn flat round dense icon="delete_outline" size="xs" color="grey-6" class="mm-delete-btn"
                   @click.stop="deleteNarrative(ai, ni)">
              <q-tooltip :delay="500">{{ t('wb.delete') }}</q-tooltip>
            </q-btn>
          </div>
        </div>

        <!-- Shots — horizontal flow -->
        <div v-if="expandedNarratives.includes(nar.narrative_id)" class="mm-shots-flow"
             :data-ai="ai" :data-ni="ni"
             @dragover.prevent="onFlowDragOver($event)"
             @dragleave="onFlowDragLeave($event)"
             @drop.stop="onFlowDrop($event, ai, ni)">
          <!-- Floating drop hint (always rendered, shown/hidden via JS to avoid Vue re-renders during drag) -->
          <div class="mm-drop-hint" :data-nar="ai+'-'+ni" style="display:none">
            <img class="mm-drop-hint-img" style="display:none" />
            <div class="mm-drop-hint-icon" style="display:none"><q-icon name="add" size="14px" color="accent"></q-icon></div>
          </div>
          <template v-for="(shot, si) in (nar.shots || [])" :key="shot._mmid">
            <div class="mm-shot-card" :class="{'dragging': isShotDragging(ai, ni, si)}" draggable="true"
                 @dragstart.stop="onDragStart($event, 'shot', ai, ni, si)"
                 @dragend="onDragEnd"
                 @mouseenter="showShotDetail(shot, act, nar, $event)"
                 @mouseleave="scheduleHideDetail"
                 @click="$emit('shot-click', shot)">
              <img v-if="getThumbUrl(shot.segment_id)" :src="getThumbUrl(shot.segment_id)"
                   class="mm-shot-img" loading="lazy" @error="$event.target.style.display='none'" />
              <div v-else class="mm-shot-img mm-shot-img-placeholder">
                <q-icon name="videocam" size="16px" color="grey-6"></q-icon>
              </div>
              <div class="mm-shot-label">
                <span class="mm-shot-emotion" :style="{background: emotionColor(shot.emotion ?? 0.5)}"></span>
                <span class="mm-shot-purpose">{{ shot.purpose }}</span>
              </div>
              <q-btn flat round dense icon="close" size="xs" color="grey-6" class="mm-shot-del"
                     @click.stop="deleteShot(ai, ni, si)"></q-btn>
            </div>
          </template>
          <div v-if="!nar.shots || nar.shots.length === 0" class="mm-empty-inline">空</div>
        </div>
      </div>

      <div v-if="!act.narratives || act.narratives.length === 0" class="mm-empty">{{ t('wb.mm_no_plan') }}</div>

      <!-- Emotion sparkline -->
      <svg v-if="actEmotionPath(act)" class="mm-emotion-sparkline"
           :viewBox="'0 0 ' + sparklineWidth + ' 24'" preserveAspectRatio="none">
        <path :d="actEmotionPath(act)" fill="none" :stroke="'var(--act-color)'" stroke-width="2" stroke-linecap="round" opacity="0.5"/>
      </svg>
    </div>
  </div>

  <div v-if="!plan.acts || plan.acts.length === 0" class="mm-empty" style="padding:40px">
    {{ t('wb.mm_no_plan') }}
  </div>

  <!-- Shot hover detail panel -->
  <transition name="mm-detail">
    <div v-if="hoverShot" class="mm-detail" :style="hoverDetailPos" @mouseenter="cancelHideDetail" @mouseleave="hoverShot = null">
      <div class="mm-detail-header">
        <img v-if="hoverShot.thumbUrl" :src="hoverShot.thumbUrl" class="mm-detail-thumb" />
        <div class="mm-detail-title">
          <div class="mm-detail-purpose">{{ hoverShot.purpose }}</div>
          <div class="mm-detail-time">
            <span class="mm-detail-tl">⏱ {{ hoverShot.timelineStartFmt }}</span>
            <span class="mm-detail-dur-badge">{{ hoverShot.durationFmt }}</span>
            <span class="mm-detail-orig"> 原 {{ hoverShot.origTimeRange }}</span>
          </div>
        </div>
        <span class="mm-detail-emotion" :style="{background: emotionColor(hoverShot.emotion ?? 0.5)}">{{ (hoverShot.emotion ?? 0.5).toFixed(1) }}</span>
      </div>
      <div class="mm-detail-visual">{{ hoverShot.visual }}</div>
      <div v-if="hoverShot.asr" class="mm-detail-row"><span class="mm-detail-label">💬 ASR</span>{{ hoverShot.asr }}</div>
      <div v-if="hoverShot.subtitle" class="mm-detail-row"><span class="mm-detail-label">📝 字幕</span>{{ hoverShot.subtitle }}</div>
      <div v-if="dimRowCam(hoverShot)" class="mm-detail-dims">
        <span class="mm-detail-dim-icon">🎥</span>
        <span v-for="f in camFields" :key="f.key">
          <span v-if="hoverShot[f.key]" class="mm-detail-dim">{{ hoverShot[f.key] }}</span>
        </span>
      </div>
      <div v-if="dimRowScene(hoverShot)" class="mm-detail-dims">
        <span class="mm-detail-dim-icon">🌍</span>
        <span v-for="f in sceneFields" :key="f.key">
          <span v-if="hoverShot[f.key]" class="mm-detail-dim">{{ hoverShot[f.key] }}</span>
        </span>
      </div>
      <div v-if="dimRowStyle(hoverShot)" class="mm-detail-dims">
        <span class="mm-detail-dim-icon">🎨</span>
        <span v-for="f in styleFields" :key="f.key">
          <span v-if="hoverShot[f.key]" class="mm-detail-dim">{{ hoverShot[f.key] }}</span>
        </span>
      </div>
      <div v-if="hoverShot.dominant_colors?.length" class="mm-detail-pills">
        <span class="mm-detail-pill-label">🌈</span>
        <span v-for="c in hoverShot.dominant_colors" :key="c" class="mm-detail-pill">{{ c }}</span>
      </div>
      <div v-if="hoverShot.main_subjects?.length" class="mm-detail-pills">
        <span class="mm-detail-pill-label">🏷️</span>
        <span v-for="s in hoverShot.main_subjects" :key="s" class="mm-detail-pill">{{ s }}</span>
      </div>
      <div v-if="hoverShot.narration" class="mm-detail-narration">{{ hoverShot.narration }}</div>
      <div class="mm-detail-meta">
        <span v-if="hoverShot.music">🎵 {{ hoverShot.music }}</span>
        <span v-if="hoverShot.transition">→ {{ hoverShot.transition }}</span>
      </div>
    </div>
  </transition>
</div>
<div v-else class="wb-mindmap-empty">
  <q-icon name="account_tree" size="48px" color="grey-5"></q-icon>
  <div style="margin-top:12px;color:var(--text3)">{{ t('wb.mm_no_plan') }}</div>
</div>
  `,

  data() {
    return {
      expandedActs: [],
      expandedNarratives: [],
      editingField: null,
      editValue: "",
      dragState: null,
      hoverShot: null,
      hoverTimer: null,
      hoverAnchor: null,
      _ver: 0,
      actColors: ["#4FC3F7", "#81C784", "#FFB74D", "#E57373", "#BA68C8", "#4DD0E1"],
      sparklineWidth: 600,
      camFields: [
        { key: "shot_type", label: "景别" },
        { key: "focal_length", label: "焦段" },
        { key: "camera_angle", label: "视角" },
        { key: "camera_movement", label: "运镜" },
        { key: "perspective", label: "透视" },
      ],
      sceneFields: [
        { key: "scene_type", label: "场景" },
        { key: "mood", label: "氛围" },
        { key: "lighting", label: "光线" },
        { key: "weather", label: "天气" },
      ],
      styleFields: [
        { key: "style", label: "风格" },
        { key: "color_tone", label: "色调" },
        { key: "tone", label: "影调" },
        { key: "dof", label: "景深" },
        { key: "composition", label: "构图" },
      ],
    };
  },

  watch: {
    plan: {
      handler(p, oldP) {
        if (p && p.acts) {
          // Assign stable ids to shots so Vue tracks DOM elements across reorders (enables FLIP)
          if (!this._mmidCounter) this._mmidCounter = 0;
          for (const act of p.acts) {
            for (const nar of (act.narratives || [])) {
              for (const shot of (nar.shots || [])) {
                if (!shot._mmid) shot._mmid = "s" + (++this._mmidCounter);
              }
            }
          }
          // Only initialize expansion on first load (oldP is undefined)
          if (!oldP) {
            this.expandedActs = p.acts.map(a => a.act_id);
            this.expandedNarratives = [];
          }
        }
      },
      immediate: true,
    },
  },

  computed: {
    timelineInfoMap() {
      return this.computeTimelineInfo();
    },
    hoverDetailPos() {
      if (!this.hoverAnchor) return {};
      const r = this.hoverAnchor;
      return {
        position: 'fixed',
        left: Math.max(8, r.left) + 'px',
        bottom: (window.innerHeight - r.top + 8) + 'px',
      };
    },
  },

  methods: {
    t(key, params) { return this.$root.t(key, params); },

    _parseTimeToSec(t) {
      if (t == null) return 0;
      const parts = String(t).split(':').map(Number);
      if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
      if (parts.length === 2) return parts[0] * 60 + parts[1];
      return parseFloat(t) || 0;
    },
    _fmtSec(sec) {
      if (!sec && sec !== 0) return '';
      const h = Math.floor(sec / 3600);
      const m = Math.floor((sec % 3600) / 60);
      const sRaw = Math.round((sec % 60) * 10) / 10;
      const sInt = Math.floor(sRaw);
      const sDec = Math.round((sRaw - sInt) * 10);
      const sStr = String(sInt).padStart(2, '0') + '.' + sDec;
      return h + ':' + String(m).padStart(2, '0') + ':' + sStr;
    },

    computeTimelineInfo() {
      const info = {};
      let acc = 0;
      if (!this.plan || !this.plan.acts) return info;
      for (const act of this.plan.acts) {
        for (const nar of (act.narratives || [])) {
          for (const shot of (nar.shots || [])) {
            const seg = this.segments.find(s => s.id === shot.segment_id);
            let dur;
            if (shot.src_start != null && shot.src_end != null) {
              dur = this._parseTimeToSec(shot.src_end) - this._parseTimeToSec(shot.src_start);
            } else if (seg) {
              dur = this._parseTimeToSec(seg.time_end) - this._parseTimeToSec(seg.time_start);
            } else {
              dur = 0;
            }
            dur = Math.max(0, dur);
            const key = `${act.act_id}-${nar.narrative_id}-${shot.segment_id}-${acc.toFixed(2)}`;
            info[key] = { timelineStart: acc, duration: dur };
            acc += dur;
          }
        }
      }
      return info;
    },

    dimRowCam(d) { return this.camFields.some(f => d && d[f.key]); },
    dimRowScene(d) { return this.sceneFields.some(f => d && d[f.key]); },
    dimRowStyle(d) { return this.styleFields.some(f => d && d[f.key]); },

    getThumbUrl(segmentId) {
      if (!segmentId) return null;
      const seg = this.segments.find(s => s.id === segmentId);
      return seg ? `/media/thumbnail/${seg.media_id}` : null;
    },

    showShotDetail(shot, act, nar, e) {
      if (this.dragState) return; // skip during drag to prevent Vue re-render
      this.cancelHideDetail();
      const detail = this.getShotDetail(shot, act, nar);
      this.hoverAnchor = e?.target?.closest('.mm-shot-card')?.getBoundingClientRect() || null;
      this.hoverTimer = setTimeout(() => { this.hoverShot = detail; }, 300);
    },
    scheduleHideDetail() {
      if (this.dragState) return;
      this.cancelHideDetail();
      this.hoverTimer = setTimeout(() => { this.hoverShot = null; }, 200);
    },
    cancelHideDetail() {
      if (this.hoverTimer) { clearTimeout(this.hoverTimer); this.hoverTimer = null; }
    },

    collapseAll() { this.expandedNarratives = []; },
    collapseAllActs() { this.expandedActs = []; this.expandedNarratives = []; },
    expandAll() {
      if (!this.plan || !this.plan.acts) return;
      this.expandedNarratives = this.plan.acts.flatMap(a => (a.narratives || []).map(n => n.narrative_id));
    },
    expandAllActs() {
      if (!this.plan || !this.plan.acts) return;
      this.expandedActs = this.plan.acts.map(a => a.act_id);
      this.expandAll();
    },

    getShotDetail(shot, act, nar) {
      if (!shot || !shot.segment_id) return null;
      const seg = this.segments.find(s => s.id === shot.segment_id);
      if (!seg) return null;

      // Timeline info
      const tlKey = `${act.act_id}-${nar.narrative_id}-${shot.segment_id}`;
      let tlInfo = null;
      // Find by prefix match (key includes accumulated time suffix)
      for (const k in this.timelineInfoMap) {
        if (k.startsWith(tlKey + "-")) { tlInfo = this.timelineInfoMap[k]; break; }
      }

      const srcStart = shot.src_start || seg.time_start;
      const srcEnd = shot.src_end || seg.time_end;

      return {
        thumbUrl: `/media/thumbnail/${seg.media_id}`,
        purpose: shot.purpose || "",
        visual: seg.visual || "",
        asr: (seg.asr && seg.asr !== "无") ? seg.asr : null,
        subtitle: (seg.subtitle && seg.subtitle !== "无") ? seg.subtitle : null,
        // Camera fields
        shot_type: seg.shot_type || null,
        focal_length: seg.focal_length || null,
        camera_angle: seg.camera_angle || null,
        camera_movement: seg.camera_movement || null,
        perspective: seg.perspective || null,
        // Scene fields
        scene_type: seg.scene_type || null,
        mood: seg.mood || null,
        lighting: seg.lighting || null,
        weather: seg.weather || null,
        // Style fields
        style: seg.style || null,
        color_tone: seg.color_tone || null,
        tone: seg.tone || null,
        dof: seg.dof || null,
        composition: seg.composition || null,
        // Arrays
        dominant_colors: seg.dominant_colors || [],
        main_subjects: seg.main_subjects || [],
        // Time info
        origTimeRange: `${seg.time_start} → ${seg.time_end}`,
        timelineStartFmt: tlInfo ? this._fmtSec(tlInfo.timelineStart) : "-",
        durationFmt: tlInfo ? (tlInfo.duration.toFixed(1) + "s") : "-",
        // Shot creative fields
        narration: shot.narration || null,
        music: shot.music ? (shot.music.mood || "") : null,
        transition: shot.transition || null,
        emotion: shot.emotion ?? 0.5,
      };
    },

    // Narrative helpers
    getNarrativeDuration(nar) {
      let total = 0;
      for (const shot of (nar.shots || [])) {
        const seg = this.segments.find(s => s.id === shot.segment_id);
        if (shot.src_start != null && shot.src_end != null) {
          total += this._parseTimeToSec(shot.src_end) - this._parseTimeToSec(shot.src_start);
        } else if (seg) {
          total += this._parseTimeToSec(seg.time_end) - this._parseTimeToSec(seg.time_start);
        }
      }
      return Math.max(0, total);
    },

    getNarrativeEntryTime(actIdx, narIdx) {
      let acc = 0;
      if (!this.plan || !this.plan.acts) return 0;
      for (let ai = 0; ai < this.plan.acts.length; ai++) {
        const a = this.plan.acts[ai];
        if (ai > actIdx) break;
        for (let ni = 0; ni < (a.narratives || []).length; ni++) {
          if (ai === actIdx && ni >= narIdx) break;
          acc += this.getNarrativeDuration(a.narratives[ni]);
        }
      }
      return acc;
    },

    fmtNarrDur(sec) { return sec.toFixed(1) + "s"; },
    fmtNarrEntry(sec) { return this._fmtSec(sec); },

    emotionColor(v) {
      v = Math.max(0, Math.min(1, v));
      const r = Math.round(66 + v * 185);
      const g = Math.round(165 - v * 100);
      const b = Math.round(245 - v * 185);
      return `rgb(${r},${g},${b})`;
    },

    actEmotionPath(act) {
      const shots = (act.narratives || []).flatMap(n => n.shots || []);
      if (shots.length < 2) return null;
      const w = this.sparklineWidth, h = 24, pad = 4;
      const step = (w - pad * 2) / (shots.length - 1);
      let d = "";
      shots.forEach((s, i) => {
        const x = pad + i * step;
        const y = h - pad - (s.emotion ?? 0.5) * (h - pad * 2);
        d += (i === 0 ? "M" : "L") + x.toFixed(1) + "," + y.toFixed(1);
      });
      return d;
    },

    countActShots(act) {
      return (act.narratives || []).reduce((sum, n) => sum + (n.shots ? n.shots.length : 0), 0);
    },

    toggleAct(id) {
      const i = this.expandedActs.indexOf(id);
      if (i >= 0) this.expandedActs.splice(i, 1);
      else this.expandedActs.push(id);
    },
    toggleNarrative(id) {
      const i = this.expandedNarratives.indexOf(id);
      if (i >= 0) this.expandedNarratives.splice(i, 1);
      else this.expandedNarratives.push(id);
    },

    startEdit(type, id, field, value) {
      this.editingField = { type, id, field };
      this.editValue = value || "";
      this.$nextTick(() => {
        const inp = this.$el?.querySelector(".mm-edit-inline input");
        if (inp) { inp.focus(); inp.select(); }
      });
    },
    saveEdit(item, field) {
      if (this.editingField && this.editValue !== item[field]) {
        item[field] = this.editValue;
        this._changed();
      }
      this.editingField = null;
    },
    cancelEdit() { this.editingField = null; },

    _changed() {
      this._ver++;
      this.$emit("plan-changed");
    },

    deleteAct(actIdx) {
      if (!confirm(this.t("wb.mm_delete_act"))) return;
      this.plan.acts.splice(actIdx, 1);
      this._changed();
    },
    deleteNarrative(actIdx, narIdx) {
      if (!confirm(this.t("wb.mm_delete_narrative"))) return;
      this.plan.acts[actIdx].narratives.splice(narIdx, 1);
      this._changed();
    },
    deleteShot(actIdx, narIdx, shotIdx) {
      this.plan.acts[actIdx].narratives[narIdx].shots.splice(shotIdx, 1);
      this._changed();
    },

    isShotDragging(actIdx, narIdx, shotIdx) {
      return this.dragState?.type === "shot"
        && this.dragState.actIdx === actIdx
        && this.dragState.narIdx === narIdx
        && this.dragState.shotIdx === shotIdx;
    },
    onDragStart(e, type, actIdx, narIdx, shotIdx) {
      this.cancelHideDetail();
      this.hoverShot = null; // hide hover detail popup during drag (safe now — .dragging uses :class binding)
      this.dragState = { type, actIdx, narIdx, shotIdx };
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", "");
      if (type === "shot") {
        this._dragCardWidth = e.target.offsetWidth;
      }
    },
    onDragEnd() {
      this.dragState = null; // Vue removes .dragging class via :class binding
      this._hideDropHint();
      // On successful drop, _flipSettle handles --tx cleanup. On cancel, animate back here.
      if (!this._dropHandled) {
        this.$el.querySelectorAll(".mm-shots-flow").forEach(f => {
          f.querySelectorAll(".mm-shot-card").forEach(c => {
            c.style.removeProperty("--tx");
            c.style.removeProperty("--ty");
          });
        });
      }
      this._dropHandled = false;
    },

    // --- Shot flow drag/drop with gap animation ---
    // All hint/transform state uses non-reactive _dropHint to avoid Vue re-renders during drag
    _hideDropHint() {
      this._dropHint = null;
      this.$el.querySelectorAll(".mm-drop-hint").forEach(h => { h.style.display = "none"; });
    },
    _showDropHint(narKey, insertIdx, hintLeft, hintTop, thumbUrl) {
      this._dropHint = { narKey, insertIdx };
      this.$el.querySelectorAll(".mm-drop-hint").forEach(h => { h.style.display = "none"; });
      const hint = this.$el.querySelector(`.mm-drop-hint[data-nar="${narKey}"]`);
      if (!hint) return;
      hint.style.display = "flex";
      hint.style.left = hintLeft + "px";
      hint.style.top = hintTop + "px";
      const img = hint.querySelector(".mm-drop-hint-img");
      const icon = hint.querySelector(".mm-drop-hint-icon");
      if (thumbUrl) {
        img.src = thumbUrl;
        img.style.display = "";
        icon.style.display = "none";
      } else {
        img.style.display = "none";
        icon.style.display = "";
      }
    },
    onFlowDragOver(e) {
      e.dataTransfer.dropEffect = this.dragState ? "move" : "copy";
      const flow = e.target.closest(".mm-shots-flow");
      if (!flow) { this._hideDropHint(); return; }
      const ai = parseInt(flow.dataset.ai);
      const ni = parseInt(flow.dataset.ni);
      const narKey = ai + "-" + ni;

      // Identify the dragged card by dragState index — do NOT rely on .dragging class
      const isSourceFlow = this.dragState && this.dragState.type === "shot"
        && this.dragState.actIdx === ai && this.dragState.narIdx === ni;
      const dragIdx = isSourceFlow ? this.dragState.shotIdx : -1;

      const allCards = Array.from(flow.querySelectorAll(".mm-shot-card"));
      const cards = allCards.filter((c, i) => i !== dragIdx);

      const flowRect = flow.getBoundingClientRect();
      const relX = e.clientX - flowRect.left + flow.scrollLeft;
      const cardW = this._dragCardWidth || cards[0]?.offsetWidth || 140;
      const gapW = cardW + 5;

      // 二维 insertIdx：flex-wrap 多行，先按 clientY 找行，再按 clientX 找列
      const cardRects = cards.map(c => c.getBoundingClientRect());
      let rowTop = null;
      for (let i = 0; i < cardRects.length; i++) {
        const r = cardRects[i];
        if (e.clientY >= r.top - 2 && e.clientY < r.bottom + 2) { rowTop = r.top; break; }
      }
      if (rowTop === null) {
        for (let i = 0; i < cardRects.length; i++) {
          if (cardRects[i].top > e.clientY) { rowTop = cardRects[i].top; break; }
        }
        rowTop = rowTop ?? cardRects[cardRects.length - 1]?.top;
      }
      const rowCards = [];
      for (let i = 0; i < cardRects.length; i++) {
        if (Math.abs(cardRects[i].top - rowTop) < 2) rowCards.push({ i, r: cardRects[i] });
      }
      let insertIdx = cards.length;
      for (const { i, r } of rowCards) {
        if (e.clientX < r.left + r.width / 2) { insertIdx = i; break; }
      }
      if (rowCards.length && e.clientX >= rowCards[rowCards.length - 1].r.left + rowCards[rowCards.length - 1].r.width / 2) {
        insertIdx = Math.min(rowCards[rowCards.length - 1].i + 1, cards.length);
      }

      if (isSourceFlow) {
        // FLIP：每卡移到 drop 后的目标位置（二维，跨行带 Y）。offsetLeft/Top 不含 transform。
        allCards.forEach((card, i) => {
          let targetIdx;
          if (i === dragIdx) {
            targetIdx = insertIdx;
          } else {
            const nonDragIdx = i < dragIdx ? i : i - 1;
            targetIdx = nonDragIdx < insertIdx ? nonDragIdx : nonDragIdx + 1;
          }
          let tx = 0, ty = 0;
          const tgt = cards[targetIdx];
          if (tgt) {
            tx = tgt.offsetLeft - card.offsetLeft;
            ty = tgt.offsetTop - card.offsetTop;
          } else if (cards.length) {
            const last = cards[cards.length - 1];
            tx = (last.offsetLeft + cardW + 5) - card.offsetLeft;
            ty = last.offsetTop - card.offsetTop;
          }
          card.style.setProperty("--tx", tx + "px");
          card.style.setProperty("--ty", ty + "px");
        });
        if (this._dropHint?.narKey !== narKey || this._dropHint?.insertIdx !== insertIdx) {
          this.$el.querySelectorAll(".mm-drop-hint").forEach(h => { h.style.display = "none"; });
          this._dropHint = { narKey, insertIdx };
        }
      } else {
        // 外部/跨叙事拖入：兄弟让位（二维），显示带缩略图的 hint
        for (let i = 0; i < cards.length; i++) {
          let tx = 0, ty = 0;
          if (i >= insertIdx) {
            const next = cards[i + 1];
            if (next) { tx = next.offsetLeft - cards[i].offsetLeft; ty = next.offsetTop - cards[i].offsetTop; }
            else { tx = cardW + 5; }
          }
          cards[i].style.setProperty("--tx", tx + "px");
          cards[i].style.setProperty("--ty", ty + "px");
        }
        if (this._dropHint?.narKey === narKey && this._dropHint?.insertIdx === insertIdx) return;

        let thumbUrl = "";
        if (this.dragState && this.dragState.type === "shot") {
          const shot = this.plan.acts[this.dragState.actIdx]?.narratives[this.dragState.narIdx]?.shots[this.dragState.shotIdx];
          if (shot) thumbUrl = this.getThumbUrl(shot.segment_id) || "";
        }

        let hintLeft, hintTop;
        if (cards.length === 0) {
          hintLeft = 44; hintTop = 4;
        } else if (insertIdx === 0) {
          hintLeft = (4 + cards[0].offsetLeft + gapW) / 2;
          hintTop = cardRects[0].top - flowRect.top + cardRects[0].height / 2;
        } else if (insertIdx >= cards.length) {
          const last = cards[cards.length - 1], lastR = cardRects[cardRects.length - 1];
          hintLeft = last.offsetLeft + last.offsetWidth + 43;
          hintTop = lastR.top - flowRect.top + lastR.height / 2;
        } else {
          const prev = cards[insertIdx - 1], next = cards[insertIdx], nextR = cardRects[insertIdx];
          hintLeft = (prev.offsetLeft + prev.offsetWidth + next.offsetLeft + gapW) / 2;
          hintTop = nextR.top - flowRect.top + nextR.height / 2;
        }
        this._showDropHint(narKey, insertIdx, hintLeft, hintTop, thumbUrl);
      }
    },
    onFlowDragLeave(e) {
      const flow = e.target.closest(".mm-shots-flow");
      if (!flow) return;
      const rect = flow.getBoundingClientRect();
      if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) {
        this._hideDropHint();
        flow.querySelectorAll(".mm-shot-card").forEach(c => {
          c.style.removeProperty("--tx");
          c.style.removeProperty("--ty");
        });
      }
    },
    async onFlowDrop(e, actIdx, narIdx) {
      const insertIdx = this._dropHint?.insertIdx ?? this.plan.acts[actIdx]?.narratives[narIdx]?.shots?.length ?? 0;
      this._hideDropHint();
      this._dropHandled = true; // tell onDragEnd to skip --tx clear (FLIP handles it)

      const nar = this.plan.acts[actIdx]?.narratives[narIdx];
      if (!nar) { this._flipSettle(); return; }

      // Capture visual positions (with --tx) of source-flow cards BEFORE any change
      const flow = e.target.closest(".mm-shots-flow");
      const cards = flow ? Array.from(flow.querySelectorAll(".mm-shot-card")) : [];
      const oldRects = new Map();
      cards.forEach(c => oldRects.set(c, c.getBoundingClientRect()));

      // External segment drop
      if (!this.dragState) {
        const raw = e.dataTransfer.getData("application/json");
        if (!raw) { this._flipSettle(); return; }
        try {
          const data = JSON.parse(raw);
          if (data.type === "segment" && data.id != null) {
            nar.shots.splice(insertIdx, 0, { segment_id: data.id, purpose: data.visual || "", emotion: 0.5 });
            nar.shots = [...nar.shots];
            this._changed();
          }
        } catch (err) { /* ignore */ }
        this._flipSettle(oldRects);
        return;
      }

      // Internal shot drag
      const ds = this.dragState;
      this.dragState = null;
      if (ds.type !== "shot") { this._flipSettle(oldRects); return; }
      const srcNar = this.plan.acts[ds.actIdx]?.narratives[ds.narIdx];
      if (!srcNar) { this._flipSettle(oldRects); return; }
      const [moved] = srcNar.shots.splice(ds.shotIdx, 1);
      nar.shots.splice(insertIdx, 0, moved);
      nar.shots = [...nar.shots];
      if (srcNar !== nar) srcNar.shots = [...srcNar.shots];
      this._changed();
      // FLIP: cards were already at target positions during drag (--tx), so after Vue
      // reorders the DOM, they're in the same visual spots — settle without redundant animation.
      this._flipSettle(oldRects);
    },
    // After a drop, clear stale --tx and animate any residual delta to 0.
    // During-drag FLIP already placed cards at their target positions, so deltas are ~0 → seamless.
    _flipSettle(oldRects) {
      this.$nextTick(() => {
        this.$el.querySelectorAll(".mm-shot-card").forEach(c => {
          c.style.transition = "none";
          c.style.removeProperty("--tx");
          c.style.removeProperty("--ty");
        });
        if (oldRects && oldRects.size) {
          this.$el.offsetHeight; // force reflow so the cleared state applies
          oldRects.forEach((oldRect, c) => {
            if (!c.isConnected) return;
            const newRect = c.getBoundingClientRect();
            const dx = oldRect.left - newRect.left;
            const dy = oldRect.top - newRect.top;
            if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
              c.style.setProperty("--tx", dx + "px");
              c.style.setProperty("--ty", dy + "px");
              c.offsetHeight; // reflow to lock the inverted position
              c.style.transition = "";
              c.style.setProperty("--tx", "0px"); // animate to natural
              c.style.setProperty("--ty", "0px");
            } else {
              c.style.transition = "";
            }
          });
        } else {
          // No captured rects (e.g. external flow): just re-enable transition
          this.$el.querySelectorAll(".mm-shot-card").forEach(c => { c.style.transition = ""; });
        }
      });
    },

    // Narrative / act level drop (for reordering narratives/acts)
    onDrop(e, type, targetIdx, actIdx, narIdx) {
      this.$el.querySelectorAll(".dragging").forEach(el => el.classList.remove("dragging"));
      if (!this.dragState) return;
      const ds = this.dragState;
      this.dragState = null;
      if (ds.type !== type) return;
      if (type === "act") {
        if (ds.actIdx === targetIdx) return;
        const acts = this.plan.acts;
        const [moved] = acts.splice(ds.actIdx, 1);
        acts.splice(targetIdx, 0, moved);
      } else if (type === "narrative") {
        const srcAct = this.plan.acts[ds.actIdx];
        const dstAct = this.plan.acts[actIdx];
        if (!srcAct || !dstAct) return;
        const [moved] = srcAct.narratives.splice(ds.narIdx, 1);
        dstAct.narratives.splice(targetIdx, 0, moved);
      }
      this._changed();
    },
  },
};
