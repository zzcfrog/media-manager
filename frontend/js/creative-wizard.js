// AI Creative Guide Wizard — 5-step creative brief dialog
const CreativeWizard = {
  template: `
    <q-dialog :model-value="show" @update:model-value="$emit('update:show', $event)" maximized transition-show="fade" transition-hide="fade">
      <q-card class="cg-wizard-card" style="background:var(--surface)">
        <!-- Header -->
        <div class="cg-header">
          <span class="cg-title">{{ t('cg.section') }}</span>
          <div class="cg-steps">
            <div v-for="i in 5" :key="i" class="cg-step-dot" :class="{active: step===i, done: step>i}">
              <q-icon v-if="step>i" name="check" size="14px"></q-icon>
              <span v-else>{{ i }}</span>
            </div>
          </div>
          <q-btn flat round dense icon="close" @click="$emit('update:show', false)"></q-btn>
        </div>

        <!-- Step content -->
        <div class="cg-body" v-if="!generating">
          <!-- Step 1: Template -->
          <div v-if="step===1" class="cg-step-content">
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

          <!-- Step 2: Structure -->
          <div v-if="step===2" class="cg-step-content">
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

          <!-- Step 3: Emotion Arc -->
          <div v-if="step===3" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.step_emotion') }}</h3>
            <div class="cg-arc-grid">
              <div v-for="arc in emotionArcs" :key="arc.id" class="cg-arc-card"
                   :class="{active: brief.emotion_arc===arc.id}" @click="brief.emotion_arc=arc.id">
                <svg class="cg-arc-svg" viewBox="0 0 120 50" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <defs>
                    <linearGradient :id="'arc-grad-'+arc.id" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.2"/>
                      <stop offset="100%" stop-color="var(--accent)" stop-opacity="0.8"/>
                    </linearGradient>
                  </defs>
                  <!-- Fill area under curve -->
                  <path :d="arc.fill" :fill="'url(#arc-grad-'+arc.id+')'" />
                  <!-- Curve line -->
                  <path :d="arc.path" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" fill="none" />
                  <!-- Dots at key points -->
                  <circle v-for="(pt, i) in arc.dots" :key="i" :cx="pt[0]" :cy="pt[1]" r="3" fill="var(--accent)" />
                </svg>
                <div class="cg-arc-name">{{ t(arc.labelKey) }}</div>
              </div>
            </div>
            <cg-stats-panel v-if="stats" :stats="stats"></cg-stats-panel>
          </div>

          <!-- Step 4: Sound Design -->
          <div v-if="step===4" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.step_sound') }}</h3>
            <div class="cg-sub-section">
              <div class="cg-sub-title">{{ t('cg.voice_style') }}</div>
              <div class="cg-option-row">
                <div v-for="opt in voiceOptions" :key="opt.id" class="cg-option-chip"
                     :class="{active: brief.voice.style===opt.id}" @click="brief.voice.style=opt.id">
                  {{ t(opt.labelKey) }}
                </div>
              </div>
            </div>
            <div class="cg-sound-grid">
              <q-select v-model="brief.music.mood" :options="moodOptions" :label="t('cg.music_mood')"
                        outlined dense emit-value map-options
                        :style="'--q-primary:var(--accent);min-width:140px'"></q-select>
              <q-select v-model="brief.music.tempo" :options="tempoOptions" :label="t('cg.music_tempo')"
                        outlined dense emit-value map-options
                        :style="'--q-primary:var(--accent);min-width:140px'"></q-select>
              <q-select v-model="brief.music.style" :options="musicStyleOptions" :label="t('cg.music_style')"
                        outlined dense emit-value map-options
                        :style="'--q-primary:var(--accent);min-width:140px'"></q-select>
            </div>
            <div class="cg-input-row" style="margin-top:12px">
              <q-input v-model="brief.music.reference" :label="t('cg.music_ref')"
                       outlined dense style="max-width:400px"
                       :style="'--q-primary:var(--accent)'"></q-input>
            </div>
          </div>

          <!-- Step 5: Confirm -->
          <div v-if="step===5" class="cg-step-content">
            <h3 class="cg-step-title">{{ t('cg.confirm_title') }}</h3>
            <div class="cg-confirm-card">
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_template') }}</span><span>{{ templateLabel }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_structure') }}</span><span>{{ structureLabel }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_arc') }}</span><span>{{ arcLabel }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_voice') }}</span><span>{{ voiceLabel }}</span></div>
              <div class="cg-confirm-row"><span class="cg-confirm-label">{{ t('cg.confirm_music') }}</span><span>{{ brief.music.mood }} · {{ brief.music.tempo }} · {{ brief.music.style }}</span></div>
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
          <q-btn v-if="step<5" unelevated :label="t('cg.next')" @click="step++"
                 color="accent" :disable="!canNext"></q-btn>
          <q-btn v-if="step===5" unelevated :label="t('cg.generate_btn')" @click="startGenerate"
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
          // 从左下缓慢上升到右上——渐入高潮
          path: "M 5 45 C 20 42, 35 38, 50 32 S 75 18, 90 10 L 115 5",
          fill: "M 5 45 C 20 42, 35 38, 50 32 S 75 18, 90 10 L 115 5 L 115 50 L 5 50 Z",
          dots: [[5,45],[50,32],[90,10],[115,5]],
        },
        {
          id: "rollercoaster",
          labelKey: "cg.arc_rollercoaster",
          // 多次起伏，波峰波谷交替
          path: "M 5 35 C 15 10, 25 10, 35 30 S 50 48, 60 25 S 75 5, 85 20 S 100 45, 115 8",
          fill: "M 5 35 C 15 10, 25 10, 35 30 S 50 48, 60 25 S 75 5, 85 20 S 100 45, 115 8 L 115 50 L 5 50 Z",
          dots: [[5,35],[25,12],[50,42],[75,8],[100,38],[115,8]],
        },
        {
          id: "deep_narrative",
          labelKey: "cg.arc_deep",
          // 低沉开始，缓慢上升，末段攀升
          path: "M 5 40 C 15 42, 25 40, 35 38 S 55 35, 65 30 S 80 20, 90 14 L 115 6",
          fill: "M 5 40 C 15 42, 25 40, 35 38 S 55 35, 65 30 S 80 20, 90 14 L 115 6 L 115 50 L 5 50 Z",
          dots: [[5,40],[35,38],[65,30],[90,14],[115,6]],
        },
        {
          id: "custom",
          labelKey: "cg.arc_custom",
          // 水平虚线表示用户自定义
          path: "M 5 25 L 35 25 L 65 25 L 95 25 L 115 25",
          fill: "M 5 25 L 35 25 L 65 25 L 95 25 L 115 25 L 115 50 L 5 50 Z",
          dots: [[5,25],[65,25],[115,25]],
        },
      ],
      voiceOptions: [
        { id: "sync", labelKey: "cg.voice_sync" },
        { id: "narration", labelKey: "cg.voice_narration" },
        { id: "mixed", labelKey: "cg.voice_mixed" },
        { id: "music_only", labelKey: "cg.voice_music_only" },
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
      if (this.step === 1) return !!this.brief.template;
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
        // Save brief first
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
