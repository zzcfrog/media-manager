// AI Creative Guide Wizard — 6-step creative brief dialog
const CreativeWizard = {
  template: `
    <q-dialog :model-value="show" @update:model-value="$emit('update:show', $event)" maximized transition-show="fade" transition-hide="fade">
      <q-card class="cg-wizard-card" style="background:var(--surface)">
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
            <p class="cg-step-desc">{{ t('cg.select_media_desc') }}</p>
            <div v-if="mediaLoading" style="text-align:center;padding:40px;color:var(--text3)">...</div>
            <div v-else-if="!mediaList.length" class="cg-empty">{{ t('cg.no_media') }}</div>
            <div v-else class="cg-media-grid">
              <div v-for="m in mediaList" :key="m.id" class="cg-media-card"
                   :class="{selected: selectedMediaIds.includes(m.id)}" @click="toggleMedia(m.id)">
                <img :src="'/media/thumbnail/'+m.id" class="cg-media-thumb" />
                <div class="cg-media-check">
                  <q-icon :name="selectedMediaIds.includes(m.id) ? 'check_circle' : 'radio_button_unchecked'"
                          :color="selectedMediaIds.includes(m.id) ? 'accent' : 'grey'" size="22px"></q-icon>
                </div>
                <div class="cg-media-info">{{ m.file_name }}</div>
              </div>
            </div>
            <div class="cg-media-status" v-if="mediaList.length">
              {{ t('cg.confirm_segments', {n: selectedMediaIds.length}) }}
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
            <div class="cg-input-row" style="margin-top:20px">
              <q-input v-model.number="brief.duration_target" type="number" min="1" max="120"
                       :label="t('cg.duration_target')" outlined dense style="max-width:200px"
                       :style="'--q-primary:var(--accent)'"></q-input>
            </div>
            <div class="cg-input-row">
              <q-input v-model="brief.theme_description" :label="t('cg.theme_desc')"
                       outlined dense style="max-width:500px"
                       :style="'--q-primary:var(--accent)'"></q-input>
            </div>
            <cg-stats-panel v-if="stats" :stats="stats"></cg-stats-panel>
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
            <cg-stats-panel v-if="stats" :stats="stats"></cg-stats-panel>
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
            <cg-stats-panel v-if="stats" :stats="stats"></cg-stats-panel>
          </div>

          <!-- Step 6: Confirm -->
          <div v-if="step===6" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.confirm_title') }}</h3>
            <div class="cg-confirm-card">
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
              <span>{{ gs.label }}</span>
            </div>
          </div>
          <q-linear-progress :value="genProgress/100" color="accent" size="8px" rounded style="max-width:400px;margin:16px auto"></q-linear-progress>
          <div class="cg-gen-info">{{ t('cg.gen_progress', {p: genProgress}) }}</div>
          <div v-if="genShots" class="cg-gen-info">{{ t('cg.gen_shots', {n: genShots}) }}</div>
        </div>

        <!-- Footer -->
        <div class="cg-footer" v-if="!generating">
          <q-btn flat :label="t('cg.prev')" @click="step--" :disable="step<=1"></q-btn>
          <q-btn v-if="step<6" unelevated :label="t('cg.next')" @click="step++"
                 color="accent" :disable="!canNext"></q-btn>
          <q-btn v-if="step===6" unelevated :label="t('cg.generate_btn')" @click="startGenerate"
                 color="accent" :loading="generating" :disable="!projectId"></q-btn>
        </div>
      </q-card>
    </q-dialog>
  `,

  props: {
    show: Boolean,
    projectId: { type: Number, default: null },
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
      mediaLoading: false,
      mediaList: [],
      selectedMediaIds: [],
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
        { value: "", label: "—" },
        { value: "calm", label: "沉稳" },
        { value: "epic", label: "激昂" },
        { value: "warm", label: "温暖" },
        { value: "mystery", label: "神秘" },
      ],
      tempoOptions: [
        { value: "", label: "—" },
        { value: "slow", label: "慢" },
        { value: "medium", label: "中" },
        { value: "fast", label: "快" },
      ],
      musicStyleOptions: [
        { value: "", label: "—" },
        { value: "piano", label: "钢琴" },
        { value: "strings", label: "弦乐" },
        { value: "electronic", label: "电子" },
        { value: "folk", label: "民谣" },
        { value: "ambient", label: "氛围" },
      ],
      genSteps: [
        { key: "analyzing", label: "分析素材内容..." },
        { key: "generating", label: "匹配镜头与情绪..." },
        { key: "parsing", label: "解析生成结果..." },
      ],
    };
  },

  computed: {
    canNext() {
      if (this.step === 1) return this.selectedMediaIds.length > 0;
      if (this.step === 2) return !!this.brief.template;
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
        this.step = 1;
        this.generating = false;
        this.genProgress = 0;
        this.genShots = 0;
        this.selectedMediaIds = [];
        this.loadMediaList();
        this.loadStats();
      }
    },
    step() {
      this.loadStats();
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

    async loadMediaList() {
      this.mediaLoading = true;
      try {
        // Load all analyzed media from the library
        const res = await API.getLibrary({ page: 1, per_page: 200, analysis_status: "done" });
        this.mediaList = (res.data || []).filter(m => m.media_type === "video");
      } catch (e) {
        console.error(e);
        this.mediaList = [];
      } finally {
        this.mediaLoading = false;
      }
    },
    toggleMedia(id) {
      const idx = this.selectedMediaIds.indexOf(id);
      if (idx >= 0) this.selectedMediaIds.splice(idx, 1);
      else this.selectedMediaIds.push(id);
    },

    async loadStats() {
      if (!this.projectId) return;
      try {
        const res = await API.getCreativeStats(this.projectId);
        this.stats = res.data;
      } catch (e) {
        console.error(e);
      }
    },

    async startGenerate() {
      if (!this.projectId) return;
      this.generating = true;
      this.genProgress = 0;
      this.genShots = 0;
      this.genCurrentStep = "analyzing";

      try {
        // Save selected media to project first
        if (this.selectedMediaIds.length > 0) {
          await API.updateProjectMedia(this.projectId, this.selectedMediaIds);
        }
        // Save brief
        await API.updateCreativeBrief(this.projectId, this.brief);

        // Call generate (SSE)
        const resp = await API.generateCreativePlan(this.projectId);
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
                  await API.applyCreativePlan(this.projectId);
                  this.genProgress = 100;
                  this.generating = false;
                  this.$emit("done", this.projectId);
                  this.$emit("update:show", false);
                  location.hash = "#/workbench/" + this.projectId;
                  return;
                }
              } catch (e) {}
            }
          }
        }
      } catch (e) {
        Quasar.Notify.create({ type: "negative", message: e.message || "生成失败" });
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
