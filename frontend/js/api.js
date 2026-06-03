// Thin wrapper around fetch() for all backend API calls.
const API = {
  async _fetch(url, options) {
    const r = await fetch(url, options);
    if (!r.ok) {
      let msg = t('g.request_fail', { status: r.status });
      try {
        const body = await r.json();
        if (body.error) msg = body.error;
      } catch {}
      const err = new Error(msg);
      err.status = r.status;
      throw err;
    }
    return r.json();
  },
  getSegmentStats(mediaIds) {
    return this._fetch(`/api/library/segment-stats`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_ids: mediaIds }) });
  },
  getLibraryIds(params = {}) {
    params.fields = "id";
    params.per_page = 1; // ignored by backend in id mode, but keeps params clean
    const qs = new URLSearchParams(params).toString();
    return this._fetch(`/api/library/?${qs}`);
  },
  getLibrary(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return this._fetch(`/api/library/?${qs}`);
  },
  getMedia(id) {
    return this._fetch(`/api/library/${id}`);
  },
  updateMedia(id, data) {
    return this._fetch(`/api/library/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  },
  deleteMedia(id) {
    return this._fetch(`/api/library/${id}`, { method: "DELETE" });
  },
  batchUpdate(data) {
    return this._fetch(`/api/library/batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  },
scanPaths(paths) {
    return this._fetch(`/api/library/scan`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) });
  },
  importOne(path) {
    return this._fetch(`/api/library/import-one`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
  },
  importBatch(paths) {
    return fetch(`/api/library/import-batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) })
      .then(r => { if (!r.ok) throw new Error(r.status); return r; });
  },
  getFolders() {
    return this._fetch(`/api/library/folders`);
  },
  getDuplicates(type) {
    return this._fetch(`/api/library/duplicates?type=${type}`);
  },
  getSimilar(mediaId) {
    return this._fetch(`/api/library/${mediaId}/similar`);
  },
  backfillEmbeddings() {
    return this._fetch(`/api/library/backfill-embeddings`, { method: "POST" });
  },
  backfillThumbnails() {
    return this._fetch(`/api/library/backfill-thumbnails`, { method: "POST" });
  },
  deleteFolder(path) {
    return this._fetch(`/api/library/folder`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
  },
  syncFolder(path) {
    return fetch(`/api/library/sync-folder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) })
      .then(r => { if (!r.ok) throw new Error(r.status); return r; });
  },
  addDupExclusions(pairs, dupType) {
    return this._fetch(`/api/library/dup-exclusions`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairs, dup_type: dupType }) });
  },
  resetDupExclusions(dupType) {
    const q = dupType ? `?dup_type=${dupType}` : "";
    return this._fetch(`/api/library/dup-exclusions${q}`, { method: "DELETE" });
  },
  removeDupExclusionPairs(pairs, dupType) {
    return this._fetch(`/api/library/dup-exclusions/pairs`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pairs, dup_type: dupType }) });
  },
  getAnalysis(mediaId) {
    return this._fetch(`/api/analysis/${mediaId}`);
  },
  getProgress() {
    return this._fetch("/api/analysis/progress");
  },
  startAnalysis(mediaId) {
    return fetch(`/api/analysis/${mediaId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });
  },
  startBatchAnalysis(ids, skipDone = false) {
    return this._fetch("/api/analysis/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, skip_done: skipDone }),
    });
  },
  getSettings() {
    return this._fetch(`/api/settings/`);
  },
  saveSettings(data) {
    return this._fetch(`/api/settings/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  },
  clearAnalysis(mediaId) {
    return this._fetch(`/api/analysis/${mediaId}`, { method: "DELETE" });
  },
  updateSegment(mediaId, segId, data) {
    return this._fetch(`/api/analysis/${mediaId}/segments/${segId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
  },
  deleteSegment(mediaId, segId, adjust) {
    const qs = adjust && adjust !== 'none' ? `?adjust=${adjust}` : '';
    return this._fetch(`/api/analysis/${mediaId}/segments/${segId}${qs}`, { method: "DELETE" });
  },
  writeXmp(id) {
    return this._fetch(`/api/library/${id}/write-xmp`, { method: "POST" });
  },
  revealFile(id) {
    return this._fetch(`/api/library/${id}/reveal`, { method: "POST" });
  },
  batchWriteXmp(ids) {
    return this._fetch(`/api/library/batch-write-xmp`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) });
  },
  thumbUrl(id) { return `/media/thumbnail/${id}`; },
  videoUrl(id) { return `/media/video/${id}`; },
  imageUrl(id) { return `/media/image/${id}`; },

  // -- Workbench --
  getProjects() { return this._fetch("/api/workbench/"); },
  createProject(data) { return this._fetch("/api/workbench/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); },
  getProject(id, q) { return this._fetch(`/api/workbench/${id}` + (q ? `?q=${encodeURIComponent(q)}` : '')); },
  updateProject(id, data) { return this._fetch(`/api/workbench/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); },
  deleteProject(id) { return this._fetch(`/api/workbench/${id}`, { method: "DELETE" }); },
  getProjectSegments(id) { return this._fetch(`/api/workbench/${id}/segments`); },
  getProjectTracks(id) { return this._fetch(`/api/workbench/${id}/tracks`); },
  updateProjectTracks(id, tracks) { return this._fetch(`/api/workbench/${id}/tracks`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tracks }) }); },
  updateProjectMedia(id, mediaIds) { return this._fetch(`/api/workbench/${id}/media`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_ids: mediaIds }) }); },

  // -- Creative --
  getCreativePlans() { return this._fetch("/api/creative/"); },
  createCreativePlan(data) { return this._fetch("/api/creative/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) }); },
  getCreativePlan(id) { return this._fetch(`/api/creative/${id}`); },
  updateCreativeBrief(id, brief) { return this._fetch(`/api/creative/${id}/brief`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ creative_brief: brief }) }); },
  generateCreativePlan(id) { return fetch(`/api/creative/${id}/generate`, { method: "POST", headers: { "Content-Type": "application/json" } }); },
  applyCreativePlan(id) { return this._fetch(`/api/creative/${id}/apply`, { method: "POST" }); },
  getCreativeStats(id) { return this._fetch(`/api/creative/${id}/stats`); },
};
