// Model selection with the same download affordance in every settings tab.
const ModelSelect = {
  inheritAttrs: false,
  props: { modelValue: [String, Number], options: { type: Array, default: () => [] },
    downloadState: { type: Object, default: () => ({ state: 'idle' }) }, allowRemove: Boolean, allowNone: Boolean, disable: Boolean },
  emits: ['update:modelValue', 'download', 'remove', 'show', 'hide', 'activate'],
  computed: {
    entries() { return [...(this.allowNone?[{value:'none',label:this.tt('不启用','Not enabled'),name:this.tt('不启用','Not enabled'),none:true,selectable:true,detail:this.tt('停用此功能','Turn this feature off')}]:[]),...this.options].map(option => ({ ...option, disable: !!option.unavailable })); },
    active() { return ['downloading', 'validating'].includes(this.downloadState.state); },
    progress() { const d = this.downloadState;return d.total_bytes ? Math.min(1, d.done_bytes / d.total_bytes) : 0; },
  },
  methods: {
    tt: taxText,
    hide() { this.$refs.select?.hidePopup(); },
    description(option) {
      if (option.detail) return option.detail;
      return [option.quant, option.size_gb ? option.size_gb + 'GB' : '',
        !option.installed && option.min_ram_gb ? t('s.model_need_ram', { gb: option.min_ram_gb }) : ''].filter(Boolean).join(' · ');
    },
    downloading(option) { const d = this.downloadState;return this.active && (d.model_id === option.value || option.group && option.group === d.group); },
    choose(value) {
      if (this.disable) return;
      const option = this.entries.find(item => item.value === value);
      if (!option || option.unavailable) return;
      if (option.installed === false && !option.custom && !option.selectable) { this.download(option);return; }
      this.$emit('update:modelValue', value);
    },
    activate(option) { if (!this.disable && !option.unavailable && (option.custom || option.selectable || option.installed !== false)) this.$emit('activate', option.value); },
    activateHighlighted() {
      const id = this.$el.querySelector('[aria-activedescendant]')?.getAttribute('aria-activedescendant');
      const value = id && document.getElementById(id)?.dataset.modelValue;
      const option = this.entries.find(item => String(item.value) === value);if (option) this.activate(option);
    },
    download(option) { if (this.disable || this.active || option.unavailable) return;this.hide();this.$emit('download', option); },
    remove(option) { if (this.disable) return;this.hide();this.$emit('remove', option); },
  },
  template: `
    <q-select v-bind="$attrs" ref="select" class="model-select" :model-value="modelValue" :options="entries" :disable="disable" dense filled emit-value map-options
      @update:model-value="choose" @popup-show="$emit('show')" @popup-hide="$emit('hide')" @keydown.enter.capture="activateHighlighted">
      <template v-slot:option="scope">
        <div class="model-select-option">
          <q-item v-bind="scope.itemProps" :aria-label="scope.opt.name || scope.opt.label" :data-model-value="scope.opt.value" class="model-select-choice" @click.capture="activate(scope.opt)">
            <q-item-section>
              <q-item-label class="model-select-name" :title="scope.opt.name || scope.opt.label">{{ scope.opt.name || scope.opt.label }}</q-item-label>
              <q-item-label v-if="downloading(scope.opt)" caption class="model-select-detail">
                <q-linear-progress :value="progress" size="4px" rounded color="primary"></q-linear-progress>
                {{ downloadState.state === 'validating' ? tt('正在核验模型…','Checking models…') : Math.floor(progress * 100) + '%' }}
              </q-item-label>
              <q-item-label v-else caption class="model-select-detail">{{ description(scope.opt) }}</q-item-label>
            </q-item-section>
          </q-item>
          <div class="model-select-actions">
            <q-icon v-if="scope.opt.none" name="block" size="18px" aria-hidden="true"></q-icon>
            <q-btn v-else-if="scope.opt.installed && allowRemove && !scope.opt.custom" flat round dense icon="delete_outline" size="sm" :disable="disable"
              :aria-label="tt('删除模型 ','Delete model ') + scope.opt.name" @click.stop="remove(scope.opt)"></q-btn>
            <q-icon v-else-if="scope.opt.installed && !scope.opt.custom" name="check_circle" size="18px" class="model-select-installed" :aria-label="tt('已下载','Downloaded')"></q-icon>
            <q-icon v-else-if="scope.opt.custom" name="folder_open" size="18px" aria-hidden="true"></q-icon>
            <q-btn v-else flat round dense icon="download_for_offline" size="sm" color="primary" :loading="downloading(scope.opt)" :disable="disable || active || scope.opt.unavailable"
              :aria-label="tt('下载模型 ','Download model ') + scope.opt.name" @click.stop="download(scope.opt)"></q-btn>
          </div>
        </div>
      </template>
    </q-select>`,
};
