const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  openInFinder: (path) => ipcRenderer.invoke("open-in-finder", path),
  saveExport: (data, suggestedName, filterExt) => ipcRenderer.invoke("save-export", data, suggestedName, filterExt),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
