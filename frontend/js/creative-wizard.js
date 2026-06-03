// AI Creative Guide Wizard — 6-step creative brief dialog
const CreativeWizard = {
  template: `
    <q-dialog :model-value="show && !pickerOpen" @update:model-value="pickerOpen ? null : $emit('update:show', $event)" transition-show="fade" transition-hide="fade">
      <q-card class="cg-wizard-card" style="background:var(--surface);width:90vw;max-width:90vw;height:90vh;max-height:90vh">
        <!-- Header -->
        <div class="cg-header">
          <span class="cg-title">{{ t('cg.section') }}</span>
          <div class="cg-steps">
            <div v-for="i in 6" :key="i" class="cg-step-dot" :class="{active: step===i, done: step>i}">
              <q-icon v-if="step>i" name="check" size="14px"></q-icon>
              <span v-else>{{ i }}</span>
            </div>
          </div>
          <q-btn flat round dense icon="close" @click="$emit('update:show', false)"></q-btn>
        </div>

        <!-- Step content -->
        <div class="cg-body" v-if="!generating">
          <!-- Step 1: Select Media -->
          <div v-if="step===1" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.select_media') }}</h3>
            <div v-if="selectedMediaIds.length" class="cg-selected-grid">
              <div v-for="m in selectedMediaInfo" :key="m.id" class="cg-selected-card" @click="previewMedia(m)">
                <div class="cg-media-thumb-wrap">
                  <img :src="'/media/thumbnail/'+m.id" class="cg-media-thumb" />
                  <div v-if="m.media_type==='video'" class="cg-play-btn"><q-icon name="play_arrow" size="24px" color="white"></q-icon></div>
                </div>
                <div class="cg-media-info">{{ m.file_name }}</div>
              </div>
            </div>
            <div class="cg-media-actions">
              <q-btn unelevated no-caps icon="add_circle_outline"
                     :label="selectedMediaIds.length ? t('cg.reselect') : t('wb.add_media')"
                     color="accent" @click="openPicker"></q-btn>
              <span v-if="selectedMediaIds.length" class="cg-media-status">
                {{ t('cg.confirm_segments', {n: selectedMediaIds.length}) }}
              </span>
            </div>
          </div>

          <!-- Step 2: Template -->
          <div v-if="step===2" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.step_template') }}</h3>
            <div class="cg-template-grid">
              <div v-for="tp in templates" :key="tp.id" class="cg-template-card"
                   :class="{selected: brief.template===tp.id}" @click="selectTemplate(tp.id)">
                <span class="cg-template-icon">{{ tp.icon }}</span>
                <div class="cg-template-name">{{ t(tp.nameKey) }}</div>
                <div class="cg-template-desc">{{ t(tp.descKey) }}</div>
              </div>
            </div>
            <!-- Sub-options for long documentary -->
            <template v-if="brief.template==='long_documentary'">
              <div class="cg-sub-section">
                <div class="cg-sub-title">{{ t('cg.opening') }}</div>
                <div class="cg-option-row">
                  <div v-for="opt in openingOptions" :key="opt.id" class="cg-option-chip"
                       :class="{active: brief.opening.type===opt.id}" @click="brief.opening.type=opt.id">
                    {{ t(opt.labelKey) }}
                  </div>
                </div>
              </div>
              <div class="cg-sub-section">
                <div class="cg-sub-title">{{ t('cg.ending') }}</div>
                <div class="cg-option-row">
                  <div v-for="opt in endingOptions" :key="opt.id" class="cg-option-chip"
                       :class="{active: brief.ending.type===opt.id}" @click="brief.ending.type=opt.id">
                    {{ t(opt.labelKey) }}
                  </div>
                </div>
              </div>
            </template>
            <!-- Sub-options for quick montage -->
            <template v-if="brief.template==='quick_montage'">
              <div class="cg-sub-section">
                <div class="cg-sub-title">{{ t('cg.quick_montage_style') }}</div>
                <div class="cg-option-row">
                  <div v-for="opt in montageOptions" :key="opt.id" class="cg-option-chip"
                       :class="{active: brief.montage_style===opt.id}" @click="brief.montage_style=opt.id">
                    {{ t(opt.labelKey) }}
                  </div>
                </div>
              </div>
            </template>
          </div>

          <!-- Step 3: Structure -->
          <div v-if="step===3" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.step_structure') }}</h3>
            <div class="cg-option-grid4">
              <div v-for="opt in structureOptions" :key="opt.id" class="cg-struct-card"
                   :class="{active: brief.structure===opt.id}" @click="brief.structure=opt.id">
                <div class="cg-struct-icon">{{ opt.icon }}</div>
                <div class="cg-option-name">{{ t(opt.labelKey) }}</div>
                <div class="cg-struct-desc">{{ t(opt.descKey) }}</div>
                <div class="cg-struct-example">{{ t(opt.exampleKey) }}</div>
              </div>
            </div>
            <div class="cg-input-row" style="margin-top:20px;display:flex;gap:14px">
              <q-input v-model="planName" :label="t('wb.name_label')"
                       outlined dense style="flex:3"
                       :style="'--q-primary:var(--accent)'"></q-input>
              <q-input v-model.number="brief.duration_target" type="number" min="1" max="120"
                       :label="t('cg.duration_target')" outlined dense style="flex:1"
                       :style="'--q-primary:var(--accent)'"></q-input>
            </div>
            <div class="cg-input-row">
              <q-input v-model="brief.theme_description" :label="t('cg.theme_desc')"
                       outlined dense
                       :style="'--q-primary:var(--accent)'"></q-input>
            </div>
            <div v-if="stats" class="cg-stats-inline">
              <span>{{ t('cg.stats_media', {v: stats.video_count || 0, i: stats.image_count || 0}) }}</span>
              <span style="margin:0 8px;opacity:0.3">|</span>
              <span>{{ t('cg.stats_total', {n: stats.total_segments, d: fmtDur(stats.total_duration)}) }}</span>
            </div>
          </div>

          <!-- Step 4: Emotion Arc -->
          <div v-if="step===4" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.step_emotion') }}</h3>
            <div class="cg-arc-grid">
              <div v-for="arc in emotionArcs" :key="arc.id" class="cg-arc-card"
                   :class="{active: brief.emotion_arc===arc.id}" @click="brief.emotion_arc=arc.id">
                <svg class="cg-arc-svg" viewBox="0 0 200 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
                  <path :d="arc.fill" fill="var(--accent)" fill-opacity="0.12" />
                  <path :d="arc.path" stroke="var(--accent)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" fill="none" />
                </svg>
                <div class="cg-arc-label">{{ t(arc.labelKey) }}</div>
              </div>
            </div>
            <div v-if="stats" class="cg-stats-inline">
              <span>{{ t('cg.stats_media', {v: stats.video_count || 0, i: stats.image_count || 0}) }}</span>
              <span style="margin:0 8px;opacity:0.3">|</span>
              <span>{{ t('cg.stats_total', {n: stats.total_segments, d: fmtDur(stats.total_duration)}) }}</span>
            </div>
          </div>

          <!-- Step 5: Sound Design -->
          <div v-if="step===5" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.step_sound') }}</h3>
            <div class="cg-sub-section">
              <div class="cg-sub-title">{{ t('cg.voice_style') }}</div>
              <div class="cg-option-grid4">
                <div v-for="opt in voiceOptions" :key="opt.id" class="cg-struct-card"
                     :class="{active: brief.voice.style===opt.id}" @click="brief.voice.style=opt.id">
                  <div class="cg-struct-icon">{{ opt.icon }}</div>
                  <div class="cg-option-name">{{ t(opt.labelKey) }}</div>
                  <div class="cg-struct-desc">{{ t(opt.descKey) }}</div>
                </div>
              </div>
            </div>
            <div class="cg-sound-note">{{ t('cg.music_auto_note') }}</div>
            <div v-if="stats" class="cg-stats-inline">
              <span>{{ t('cg.stats_media', {v: stats.video_count || 0, i: stats.image_count || 0}) }}</span>
              <span style="margin:0 8px;opacity:0.3">|</span>
              <span>{{ t('cg.stats_total', {n: stats.total_segments, d: fmtDur(stats.total_duration)}) }}</span>
            </div>
          </div>

          <!-- Step 6: Confirm -->
          <div v-if="step===6" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.confirm_title') }}</h3>
            <div class="cg-confirm-card">
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('wb.name_label') }}</span><span>{{ planName }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_template') }}</span><span>{{ templateLabel }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_structure') }}</span><span>{{ structureLabel }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_arc') }}</span><span>{{ arcLabel }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_voice') }}</span><span>{{ voiceLabel }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_music') }}</span><span>{{ t('cg.music_auto_note').replace('🎬 ', '') }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_ending') }}</span><span>{{ endingLabel }}</span></div>
            </div>
            <div class="cg-confirm-stats" v-if="stats">
              {{ t('cg.confirm_materials') }}：{{ t('cg.confirm_segments', {n: stats.total_segments}) }} / {{ fmtDur(stats.total_duration) }}
            </div>
            <div class="cg-confirm-note">{{ t('cg.confirm_fee') }}</div>
          </div>
        </div>

        <!-- Generating progress -->
        <div v-if="generating" class="cg-generating">
          <div class="cg-gen-icon">🎬</div>
          <div class="cg-gen-title">{{ t('cg.generating') }}</div>
          <div class="cg-gen-steps">
            <div v-for="gs in genSteps" :key="gs.key" class="cg-gen-step" :class="genStepClass(gs.key)">
              <q-icon :name="genStepIcon(gs.key)" size="18px"></q-icon>
              <span>{{ t(gs.labelKey) }}</span>
            </div>
          </div>
          <q-linear-progress :value="genProgress/100" color="accent" size="8px" rounded style="max-width:400px;margin:16px auto"></q-linear-progress>
          <div class="cg-gen-info">{{ t('cg.gen_progress', {p: genProgress}) }}</div>
          <div v-if="genShots" class="cg-gen-info">{{ t('cg.gen_shots', {n: genShots}) }}</div>
        </div>

        <!-- Footer -->
        <div class="cg-footer" v-if="!generating">
          <q-btn flat :label="t('cg.prev')" @click="step--" :disable="step<=1"></q-btn>
          <q-space></q-space>
          <q-btn v-if="step>1 && step<6" flat no-caps :label="t('cg.skip_create')" color="grey-6" @click="skipAndCreate"></q-btn>
          <q-btn v-if="step<6" unelevated :label="t('cg.next')" @click="step++"
                 color="accent" :disable="!canNext"></q-btn>
          <q-btn v-if="step===6" unelevated :label="t('cg.generate_btn')" @click="startGenerate"
                 color="accent" :loading="generating" :disable="!canNext"></q-btn>
        </div>
      </q-card>
    </q-dialog>
  `,

  props: {
    show: Boolean,
    editProjectId: { type: Number, default: null },
  },

  emits: ["update:show", "done"],

  data() {
    return {
      step: 1,
      generating: false,
      genProgress: 0,
      genShots: 0,
      genCurrentStep: "",
      stats: null,
      pickerOpen: false,
      planName: "",
      selectedMediaIds: [],
      selectedMediaInfo: [],
      brief: {
        template: "long_documentary",
        montage_style: "beat",
        duration_target: 30,
        theme_description: "",
        opening: { type: "atmosphere" },
        structure: "three_act",
        emotion_arc: "gradual_build",
        voice: { style: "mixed" },
        music: { mood: "", tempo: "", style: "", reference: "" },
        ending: { type: "bookend" },
      },
      // Static option arrays — must be in data() for template access
      templates: [
        { id: "long_documentary", icon: "🎬", nameKey: "cg.template_long", descKey: "cg.template_long_desc" },
        { id: "quick_montage", icon: "⚡", nameKey: "cg.template_quick", descKey: "cg.template_quick_desc" },
        { id: "free_creation", icon: "📝", nameKey: "cg.template_free", descKey: "cg.template_free_desc" },
      ],
      openingOptions: [
        { id: "suspense", labelKey: "cg.opening_suspense" },
        { id: "atmosphere", labelKey: "cg.opening_atmosphere" },
        { id: "character", labelKey: "cg.opening_character" },
        { id: "quote", labelKey: "cg.opening_quote" },
      ],
      endingOptions: [
        { id: "bookend", labelKey: "cg.ending_bookend" },
        { id: "elevation", labelKey: "cg.ending_elevation" },
        { id: "open", labelKey: "cg.ending_open" },
        { id: "call", labelKey: "cg.ending_call" },
      ],
      montageOptions: [
        { id: "beat", labelKey: "cg.montage_beat" },
        { id: "montage", labelKey: "cg.montage_montage" },
        { id: "transition", labelKey: "cg.montage_transition" },
      ],
      structureOptions: [
        { id: "timeline", icon: "📅", labelKey: "cg.struct_timeline", descKey: "cg.struct_timeline_desc", exampleKey: "cg.struct_timeline_ex" },
        { id: "thematic", icon: "🗂", labelKey: "cg.struct_thematic", descKey: "cg.struct_thematic_desc", exampleKey: "cg.struct_thematic_ex" },
        { id: "three_act", icon: "🎭", labelKey: "cg.struct_three_act", descKey: "cg.struct_three_act_desc", exampleKey: "cg.struct_three_act_ex" },
        { id: "contrast", icon: "🔄", labelKey: "cg.struct_contrast", descKey: "cg.struct_contrast_desc", exampleKey: "cg.struct_contrast_ex" },
      ],
      emotionArcs: [
        {
          id: "gradual_build",
          labelKey: "cg.arc_gradual",
          // 平缓起步，持续攀升，末段陡升到高点
          path: "M 0 65 Q 50 58 80 40 T 200 8",
          fill: "M 0 65 Q 50 58 80 40 T 200 8 L 200 80 L 0 80 Z",
        },
        {
          id: "rollercoaster",
          labelKey: "cg.arc_rollercoaster",
          // 三起三落，波动剧烈
          path: "M 0 55 C 25 15 45 15 55 50 S 80 75 100 30 S 135 5 155 40 S 185 70 200 10",
          fill: "M 0 55 C 25 15 45 15 55 50 S 80 75 100 30 S 135 5 155 40 S 185 70 200 10 L 200 80 L 0 80 Z",
        },
        {
          id: "deep_narrative",
          labelKey: "cg.arc_deep",
          // 长期低位盘旋，最后大幅攀升
          path: "M 0 60 C 40 62 70 58 100 52 S 140 30 160 18 L 200 6",
          fill: "M 0 60 C 40 62 70 58 100 52 S 140 30 160 18 L 200 6 L 200 80 L 0 80 Z",
        },
        {
          id: "custom",
          labelKey: "cg.arc_custom",
          // 起伏不定的锯齿线
          path: "M 0 45 L 30 20 L 55 60 L 85 15 L 110 55 L 140 10 L 170 50 L 200 25",
          fill: "M 0 45 L 30 20 L 55 60 L 85 15 L 110 55 L 140 10 L 170 50 L 200 25 L 200 80 L 0 80 Z",
        },
      ],
      voiceOptions: [
        { id: "sync", icon: "🎙", labelKey: "cg.voice_sync", descKey: "cg.voice_sync_desc" },
        { id: "narration", icon: "🎙", labelKey: "cg.voice_narration", descKey: "cg.voice_narration_desc" },
        { id: "mixed", icon: "🎙", labelKey: "cg.voice_mixed", descKey: "cg.voice_mixed_desc" },
        { id: "music_only", icon: "🎵", labelKey: "cg.voice_music_only", descKey: "cg.voice_music_only_desc" },
      ],
      moodOptions: [
        { value: "", labelKey: "" },
        { value: "calm", labelKey: "cg.mood_calm" },
        { value: "epic", labelKey: "cg.mood_epic" },
        { value: "warm", labelKey: "cg.mood_warm" },
        { value: "mystery", labelKey: "cg.mood_mystery" },
      ],
      tempoOptions: [
        { value: "", labelKey: "" },
        { value: "slow", labelKey: "cg.tempo_slow" },
        { value: "medium", labelKey: "cg.tempo_medium" },
        { value: "fast", labelKey: "cg.tempo_fast" },
      ],
      musicStyleOptions: [
        { value: "", labelKey: "" },
        { value: "piano", labelKey: "cg.music_piano" },
        { value: "strings", labelKey: "cg.music_strings" },
        { value: "electronic", labelKey: "cg.music_electronic" },
        { value: "folk", labelKey: "cg.music_folk" },
        { value: "ambient", labelKey: "cg.music_ambient" },
      ],
      genSteps: [
        { key: "analyzing", labelKey: "cg.gen_analyzing" },
        { key: "generating", labelKey: "cg.gen_generating" },
        { key: "parsing", labelKey: "cg.gen_parsing" },
      ],
    };
  },

  computed: {
    canNext() {
      if (this.step === 1) return this.selectedMediaIds.length > 0;
      if (this.step === 2) return !!this.brief.template;
      if (this.step === 3) return this.planName.trim().length > 0;
      return true;
    },
    templateLabel() {
      const m = this.templates.find(t => t.id === this.brief.template);
      return m ? this.t(m.nameKey) : "";
    },
    structureLabel() {
      const o = this.structureOptions.find(o => o.id === this.brief.structure);
      return o ? this.t(o.labelKey) : "";
    },
    arcLabel() {
      const a = this.emotionArcs.find(a => a.id === this.brief.emotion_arc);
      return a ? this.t(a.labelKey) : "";
    },
    voiceLabel() {
      const v = this.voiceOptions.find(v => v.id === this.brief.voice.style);
      return v ? this.t(v.labelKey) : "";
    },
    endingLabel() {
      const e = this.endingOptions.find(e => e.id === this.brief.ending.type);
      return e ? this.t(e.labelKey) : "";
    },
  },

  watch: {
    show(v) {
      if (v) {
        this.generating = false;
        this.genProgress = 0;
        this.genShots = 0;
        if (this.editProjectId) {
          // Edit mode: load existing project data and skip to step 2
          this.step = 2;
          this.loadEditProject();
        } else {
          // New plan: start from step 1 (media picker)
          this.step = 1;
          this.planName = "";
          this.selectedMediaIds = [];
          this.selectedMediaInfo = [];
          this.$nextTick(() => this.openPicker());
        }
      }
    },
    step(v) {
      this.loadStats();
      if (v === 1 && this.selectedMediaIds.length) this.$nextTick(() => this.openPicker());
    },
  },

  methods: {
    t(key, params) {
      if (typeof i18nState !== "undefined" && typeof t === "function") return t(key, params);
      return key;
    },
    fmtDur(sec) {
      if (!sec) return "0:00";
      const m = Math.floor(sec / 60);
      const s = Math.round(sec % 60);
      return m + ":" + String(s).padStart(2, "0");
    },
    selectTemplate(id) {
      this.brief.template = id;
    },

    async skipAndCreate() {
      // Prompt for name, then create a minimal project and go to workbench
      const name = this.planName.trim() || this.t('cg.new_plan');
      try {
        const mediaIds = this.selectedMediaIds.length ? this.selectedMediaIds : undefined;
        const res = await API.createCreativePlan({ name, media_ids: mediaIds });
        const pid = res.data.id;
        this.$emit("done", pid);
        this.$emit("update:show", false);
        this.$root.loadProjectList();
        location.hash = "#/workbench/" + pid;
      } catch (e) {
        Quasar.Notify.create({ type: "negative", message: e.message || this.t('cg.gen_fail') });
      }
    },

    async loadEditProject() {
      // Load existing project data for re-editing from workbench
      try {
        const res = await API.getProject(this.editProjectId);
        this.planName = res.data.name || "";
        const media = res.data.media || [];
        this.selectedMediaIds = media.map(m => m.id);
        this.selectedMediaInfo = media;
        // Restore brief if exists
        const brief = res.data.creative_brief;
        if (brief && typeof brief === "object") Object.assign(this.brief, brief);
        this.loadStats();
      } catch (e) {
        console.error(e);
      }
    },

    previewMedia(m) {
      if (m.media_type === 'video') {
        window.open('/media/stream/' + m.id, '_blank');
      }
    },

    openPicker() {
      this.pickerOpen = true;
      const root = this.$root;
      root.pickerSelected = [...this.selectedMediaIds];
      root.pickerExcludeIds = [];
      root.pickerProjectId = null;
      root._pickerCallback = (ids) => {
        this.selectedMediaIds = [...ids];
        this.pickerOpen = false;
        this.loadSelectedInfo(ids);
        if (ids.length) this.step = 2;
      };
      root.pickerMode = true;
    },
    async loadSelectedInfo(ids) {
      if (!ids.length) { this.selectedMediaInfo = []; return; }
      try {
        const infos = await API.batchGet(ids);
        this.selectedMediaInfo = infos;
      } catch (e) {
        this.selectedMediaInfo = [];
      }
    },

    async loadStats() {
      if (!this.selectedMediaIds.length) { this.stats = null; return; }
      try {
        const res = await API.getSegmentStats(this.selectedMediaIds);
        this.stats = res;
      } catch (e) {
        console.error(e);
      }
    },

    async startGenerate() {
      if (!this.selectedMediaIds.length && !this.editProjectId) return;
      this.generating = true;
      this.genProgress = 0;
      this.genShots = 0;
      this.genCurrentStep = "analyzing";

      try {
        let pid;
        if (this.editProjectId) {
          // Edit mode: update existing project
          pid = this.editProjectId;
          await API.updateProject(pid, { name: this.planName.trim() || this.t('cg.new_plan') });
          await API.updateProjectMedia(pid, this.selectedMediaIds);
          await API.updateCreativeBrief(pid, this.brief);
        } else {
          // New project: create now
          const name = this.planName.trim() || this.t('cg.new_plan');
          const createRes = await API.createCreativePlan({ name, media_ids: this.selectedMediaIds, creative_brief: this.brief });
          pid = createRes.data.id;
        }

        // Call generate (SSE)
        const resp = await API.generateCreativePlan(pid);
        const reader = resp.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("event: ")) {
              const eventType = line.slice(7).trim();
              continue;
            }
            if (line.startsWith("data: ")) {
              try {
                const data = JSON.parse(line.slice(6));
                if (data.percent !== undefined) this.genProgress = data.percent;
                if (data.shots !== undefined) this.genShots = data.shots;
                if (data.step) this.genCurrentStep = data.step;
                if (data.error) {
                  this.generating = false;
                  Quasar.Notify.create({ type: "negative", message: data.error });
                  return;
                }
                if (data.plan) {
                  // Plan received — apply to tracks
                  this.genProgress = 95;
                  await API.applyCreativePlan(pid);
                  this.genProgress = 100;
                  this.generating = false;
                  this.$emit("done", pid);
                  this.$emit("update:show", false);
                  location.hash = "#/workbench/" + pid;
                  return;
                }
              } catch (e) {}
            }
          }
        }
      } catch (e) {
        Quasar.Notify.create({ type: "negative", message: e.message || this.t('cg.gen_fail') });
      } finally {
        this.generating = false;
      }
    },

    genStepClass(key) {
      const order = ["analyzing", "generating", "parsing"];
      const cur = order.indexOf(this.genCurrentStep);
      const idx = order.indexOf(key);
      if (idx < cur) return "done";
      if (idx === cur) return "active";
      return "pending";
    },
    genStepIcon(key) {
      const cls = this.genStepClass(key);
      if (cls === "done") return "check_circle";
      if (cls === "active") return "radio_button_checked";
      return "radio_button_unchecked";
    },
  },
};
