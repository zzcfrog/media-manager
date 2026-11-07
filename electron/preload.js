const { contextBridge, ipcRenderer, webUtils } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  isElectron: true,
  platform: process.platform,
  setTheme: (mode) => ipcRenderer.invoke("set-theme", mode),
  selectFiles: () => ipcRenderer.invoke("select-files"),
  selectDirectory: (defaultPath) => ipcRenderer.invoke("select-directory", defaultPath),
  getModelDirectory: () => ipcRenderer.invoke("get-model-directory"),
  saveModelDirectory: (directory, options) => ipcRenderer.invoke("save-model-directory", directory, options),
  onModelDirectoryProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on("model-directory-progress", listener);
    return () => ipcRenderer.removeListener("model-directory-progress", listener);
  },
  selectModelFile: () => ipcRenderer.invoke("select-model-file"),
  openInFinder: (path) => ipcRenderer.invoke("open-in-finder", path),
  pickSavePath: (suggestedName, filterExt) => ipcRenderer.invoke("pick-save-path", suggestedName, filterExt),
  writeFile: (filePath, data) => ipcRenderer.invoke("write-file", filePath, data),
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
});
