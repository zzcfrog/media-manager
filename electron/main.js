const { app, BrowserWindow, ipcMain, dialog, nativeImage } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");

const ICON = path.join(__dirname, "dock-icon.png");

const PORT = 6622;
let pyProc = null;
let win = null;

function startPython() {
  const pyPath = path.join(__dirname, "..", "run.py");
  const PYTHON = process.platform === "win32" ? "python" : "python3";
  pyProc = spawn(PYTHON, [pyPath], { stdio: "pipe", detached: true, env: { ...process.env, ELECTRON: "1" } });
  pyProc.stdout.on("data", (data) => process.stdout.write(data));
  pyProc.stderr.on("data", (data) => process.stderr.write(data));
  pyProc.on("close", () => { pyProc = null; });
}

function killPython() {
  if (pyProc) {
    try { process.kill(-pyProc.pid); } catch {}
    pyProc = null;
  }
}

function waitForServer(url, cb, retries = 30) {
  http.get(url, (res) => { res.resume(); cb(null); }).on("error", () => {
    if (retries > 0) setTimeout(() => waitForServer(url, cb, retries - 1), 500);
    else cb(new Error("Server failed to start"));
  });
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: "Media Manager",
    icon: path.join(__dirname, "icon.icns"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadURL(`http://127.0.0.1:${PORT}`);
  win.on("closed", () => { win = null; });

  win.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F12") {
      win.webContents.toggleDevTools();
    }
  });
}

app.on("ready", () => {
  if (process.platform === "darwin") {
    app.dock.setIcon(nativeImage.createFromPath(ICON));
    app.setAboutPanelOptions({ applicationName: "Media Manager" });
  }

  ipcMain.handle("select-files", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "选择视频或图片文件",
      properties: ["openFile", "multiSelections"],
      filters: [
        { name: "所有文件", extensions: ["*"] },
      ],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("select-directory", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "选择文件夹",
      properties: ["openDirectory"],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("open-in-finder", async (event, filePath) => {
    const { shell } = require("electron");
    shell.showItemInFolder(filePath);
  });

  // 原生存盘对话框（先弹，不依赖后端），返回用户选的路径或 null（取消）。
  ipcMain.handle("pick-save-path", async (event, suggestedName, filterExt) => {
    const ext = (filterExt || "zip").replace(/^\./, "");
    const result = await dialog.showSaveDialog(win, {
      title: "保存到",
      defaultPath: suggestedName || `export.${ext}`,
      filters: [{ name: ext.toUpperCase(), extensions: [ext] }],
    });
    return result.canceled || !result.filePath ? null : result.filePath;
  });

  // Node fs 写文件（renderer 的 showSaveFilePicker 在某些版本写出 0 字节，故走主进程）。
  // data: ArrayBuffer/Uint8Array。
  ipcMain.handle("write-file", (event, filePath, data) => {
    fs.writeFileSync(filePath, Buffer.from(data));
    return true;
  });

  startPython();
  waitForServer(`http://127.0.0.1:${PORT}/`, (err) => {
    if (err) {
      dialog.showErrorBox("启动失败", "后端服务未能启动，请检查 Python 环境。");
      app.quit();
      return;
    }
    createWindow();
  });
});

app.on("window-all-closed", () => {
  killPython();
  app.quit();
});

app.on("before-quit", () => {
  killPython();
});
