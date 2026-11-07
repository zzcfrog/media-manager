const GeneralSettingsMixin = {
  data: () => ({ modelDirectory: { supported: false, loaded: false, loading: false, picking: false,
    path: '', baseline: '', activePath: '', locked: false, restartRequired: false, error: '',
    migrationSupported: false, liveApplySupported: false, migrate: false, progress: null } }),
  computed: {
    modelDirectoryCanMigrate() {
      const form = this.modelDirectory;
      return form.loaded && !form.locked && !!form.path && form.path !== form.activePath;
    },
    modelDirectoryMigrationProgress() {
      const p = this.modelDirectory.progress;
      if (!p || p.phase === 'preparing') return 0;
      const ratio = p.totalBytes ? Math.min(1, p.doneBytes / p.totalBytes) : 1;
      return ['done', 'activating'].includes(p.phase) ? 1 : p.phase === 'verifying' ? .5 + ratio / 2 : ratio / 2;
    },
  },
  methods: {
    async loadModelDirectory(generation) {
      const supported = typeof window.electronAPI?.getModelDirectory === 'function' &&
        typeof window.electronAPI?.saveModelDirectory === 'function' && typeof window.electronAPI?.selectDirectory === 'function';
      this.modelDirectory = { supported, loaded: false, loading: supported, picking: false,
        path: '', baseline: '', activePath: '', locked: false, restartRequired: false, error: '',
        migrationSupported: false, liveApplySupported: false, migrate: false, progress: null };
      if (!supported) return;
      try {
        const state = await window.electronAPI.getModelDirectory();
        if (!this.showSettings || generation !== this._settingsLoad) return;
        Object.assign(this.modelDirectory, state, { baseline: state.path, loaded: true });
      } catch (error) {
        if (this.showSettings && generation === this._settingsLoad) this.modelDirectory.error = error.message;
      } finally {
        if (this.showSettings && generation === this._settingsLoad) this.modelDirectory.loading = false;
      }
    },
    async pickModelDirectory() {
      const form = this.modelDirectory, generation = this._settingsLoad;
      if (!form.loaded || form.locked || form.picking || this.settingsSaving || this.settingsLoading) return;
      form.picking = true;form.error = '';
      try {
        const paths = await window.electronAPI.selectDirectory(form.path);
        if (this.showSettings && generation === this._settingsLoad && paths?.length) { form.path = paths[0];form.migrate = false; }
      } catch (error) {
        if (this.showSettings && generation === this._settingsLoad) form.error = error.message;
      } finally {
        if (this.showSettings && generation === this._settingsLoad) form.picking = false;
      }
    },
    async saveModelDirectorySetting(saved) {
      const form = this.modelDirectory;
      if (!form.loaded || form.path === form.baseline && !form.migrate && !form.restartRequired) return;
      if (!form.liveApplySupported) throw new Error(taxText('请更新并重新打开桌面应用，以启用即时切换目录', 'Update and reopen the desktop app to apply model folders immediately'));
      const migrate = form.migrate && this.modelDirectoryCanMigrate;
      if (migrate && !form.migrationSupported) throw new Error(taxText('请更新桌面应用后使用模型迁移', 'Update the desktop app to migrate models'));
      let unsubscribe;
      try {
        form.progress = { phase: 'preparing', doneBytes: 0, totalBytes: 0 };
        unsubscribe = window.electronAPI.onModelDirectoryProgress?.(progress => { if (this.modelDirectory === form) form.progress = progress; });
        const state = await window.electronAPI.saveModelDirectory(form.path, { migrate });
        Object.assign(form, state, { baseline: state.path, error: '', migrate: false });
        saved.push(taxText('大模型目录已生效', 'Model directory applied'));
        const models = await API.getLocalVlmModels();
        this.localModels = Array.isArray(models) ? models : [];
      } finally { unsubscribe?.();form.progress = null; }
    },
  },
};
