// Thin wrapper around fetch() for all backend API calls.
const API = {
  async _fetch(url, options) {
    const r = await fetch(url, options);
    if (!r.ok) {
      let msg = `请求失败 (${r.status})`;
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
    return fetch(`/api/library/import-batch`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ paths }) });
  },
  getCollections() {
    return this._fetch(`/api/collections/`);
  },
  createCollection(name) {
    return this._fetch(`/api/collections/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  },
  getCollectionMedia(cid) {
    return this._fetch(`/api/collections/${cid}/media`);
  },
  addCollectionItems(cid, mediaIds) {
    return this._fetch(`/api/collections/${cid}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_ids: mediaIds }) });
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
    return fetch(`/api/library/sync-folder`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path }) });
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
  startAnalysis(mediaId) {
    return fetch(`/api/analysis/${mediaId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
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
};
