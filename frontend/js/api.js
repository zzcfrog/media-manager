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
  getTags() {
    return this._fetch(`/api/tags/`);
  },
  getFolders() {
    return this._fetch(`/api/library/folders`);
  },
  createTag(name) {
    return this._fetch(`/api/tags/`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
  },
  deleteTag(id) {
    return this._fetch(`/api/tags/${id}`, { method: "DELETE" });
  },
  assignTags(mediaId, tags) {
    return this._fetch(`/api/tags/assign`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ media_id: mediaId, tags }) });
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
  thumbUrl(id) { return `/media/thumbnail/${id}`; },
  videoUrl(id) { return `/media/video/${id}`; },
  imageUrl(id) { return `/media/image/${id}`; },
};
