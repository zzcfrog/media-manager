const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectDirectory: () => ipcRenderer.invoke("select-directory"),
  openInFinder: (path) => ipcRenderer.invoke("open-in-finder", path),
  pickSavePath: (suggestedName, filterExt) => ipcRenderer.invoke("pick-save-path", suggestedName, filterExt),
  writeFile: (filePath, data) => ipcRenderer.invoke("write-file", filePath, data),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
