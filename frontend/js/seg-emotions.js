// 情绪分布展示组件：把分片的 emotions 数组渲染成药丸(标签+占比) + 唤醒条 + 效价。
// 用法：<seg-emotions :seg="seg"></seg-emotions>  紧凑版：<seg-emotions :seg="seg" compact></seg-emotions>
// seg 需含：emotions(数组[{mood,weight,intensity}])、arousal(0-1)、valence(-1..+1)（后端 _segment_to_dict 派生）
const SegEmotions = {
  name: "SegEmotions",
  props: {
    seg: { type: Object, required: true },
    compact: { type: Boolean, default: false },
  },
  template: `
    <div v-if="seg && seg.emotions && seg.emotions.length" class="seg-emotions" :class="{compact}">
      <span v-if="!compact" class="dim-label emo-label">{{ t('d.dim.emotions') }}</span>
      <span class="emo-pills">
        <span v-for="(e,i) in seg.emotions" :key="i" class="pill emo-pill">
          <span class="emo-mood">{{ e.mood }}</span><span v-if="!compact && e.weight!=null" class="emo-weight">{{ Math.round((e.weight||0)*100) }}%</span>
        </span>
      </span>
      <span v-if="seg.arousal!=null" class="emo-metric emo-arousal">
        <span v-if="!compact" class="emo-metric-label">{{ t('d.dim.arousal') }}</span>
        <span class="arousal-bar"><i :style="{width:(seg.arousal*100)+'%'}"></i></span>
        <span class="emo-metric-val">{{ seg.arousal.toFixed(2) }}</span>
      </span>
      <span v-if="seg.valence!=null" class="emo-metric emo-valence" :class="seg.valence>=0?'pos':'neg'">
        <span v-if="!compact" class="emo-metric-label">{{ t('d.dim.valence') }}</span>
        <span class="emo-metric-val">{{ (seg.valence>=0?'+':'')+seg.valence.toFixed(2) }}</span>
      </span>
    </div>
  `,
  methods: {
    t(key, params) { return this.$root.t(key, params); },
  },
};
