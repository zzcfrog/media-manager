// Apply the saved material before first paint; mode and theme are independent.
const Appearance = {
  themes: ['jade', 'paper', 'study', 'porcelain'],
  modes: ['light', 'dark', 'auto'],
  read() {
    const theme = localStorage.getItem('appearanceTheme');
    const mode = localStorage.getItem('theme');
    return {
      theme: this.themes.includes(theme) ? theme : 'jade',
      mode: this.modes.includes(mode) ? mode : 'auto',
    };
  },
  apply(theme, mode) {
    const dark = mode === 'auto' ? window.matchMedia('(prefers-color-scheme: dark)').matches : mode === 'dark';
    document.documentElement.dataset.appearanceTheme = theme;
    document.documentElement.dataset.appearanceMode = dark ? 'dark' : 'light';
    return dark;
  },
};
const initialAppearance = Appearance.read();
Appearance.apply(initialAppearance.theme, initialAppearance.mode);

// Shared by the toolbar popover and General settings. Previews use the actual
// theme tokens, so their materials cannot drift away from the selected theme.
const AppearancePicker = {
  props: { theme: String, mode: String },
  emits: ['theme-change', 'mode-change', 'dismiss'],
  data() {
    return { themes: Appearance.themes, modes: Appearance.modes,
      modeIcons: { light: 'light_mode', dark: 'dark_mode', auto: 'desktop_windows' } };
  },
  methods: { t(...args) { return t(...args); } },
  template: `
    <section class="appearance-picker" :aria-label="t('appearance.title')" @keydown.stop @keydown.esc.prevent="$emit('dismiss')">
      <div class="appearance-section-heading">
        <span>{{ t('appearance.styles') }}</span>
        <small>{{ t('appearance.styles_hint') }}</small>
      </div>
      <div class="appearance-theme-grid" role="group" :aria-label="t('appearance.styles')">
        <button v-for="item in themes" :key="item" type="button" class="appearance-theme-card"
                :data-theme-choice="item" :aria-pressed="theme === item" :aria-label="t('appearance.' + item)"
                @click="$emit('theme-change', item)">
          <span class="theme-preview" aria-hidden="true">
            <span v-for="side in ['light', 'dark']" :key="side" class="theme-preview-half" :data-theme="item" :data-mode="side">
              <span class="theme-preview-title"><i></i><i></i><i></i></span>
              <span class="theme-preview-body">
                <span class="theme-preview-sidebar"><b></b><i></i><i></i><i></i></span>
                <span class="theme-preview-workspace">
                  <span class="theme-preview-toolbar"></span>
                  <span class="theme-preview-media"><i v-for="n in 6" :key="n"></i></span>
                </span>
                <span class="theme-preview-inspector"><b></b><i></i><i></i></span>
              </span>
            </span>
          </span>
          <q-icon v-if="theme === item" name="check" class="appearance-theme-check" aria-hidden="true"></q-icon>
          <span class="appearance-theme-name">{{ t('appearance.' + item) }}</span>
        </button>
      </div>
      <div class="appearance-mode-section">
        <div class="appearance-section-heading">{{ t('appearance.mode') }}</div>
        <div class="appearance-modes" role="group" :aria-label="t('appearance.mode')">
          <button v-for="item in modes" :key="item" type="button" :data-mode-choice="item"
                  :aria-pressed="mode === item" @click="$emit('mode-change', item)">
            <q-icon :name="modeIcons[item]" aria-hidden="true"></q-icon>
            <span>{{ t('s.theme_' + item) }}</span>
          </button>
        </div>
      </div>
      <p class="appearance-save-hint">{{ t('appearance.saved') }}</p>
    </section>
  `,
};
