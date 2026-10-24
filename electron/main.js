const { app, BrowserWindow, ipcMain, dialog, nativeImage, nativeTheme, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { runtimeConfig } = require("./runtime");

const APP_NAME = "映屿 · luminisle";
app.setName(APP_NAME);
// HTTP headers require an ASCII product token even when the display name is Chinese.
app.userAgentFallback = app.userAgentFallback.replace(APP_NAME.replace(/\s/g, ""), "Luminisle");
// Keep the existing profile and single-instance identity across the brand rename.
app.setPath("userData", process.env.MEDIA_MANAGER_PROFILE || path.join(app.getPath("appData"), "Media Manager"));
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
const ICON = path.join(__dirname, "dock-icon.png");
const PORT = Number(process.env.MEDIA_MANAGER_PORT || 6622);
const INSTANCE = crypto.randomUUID();
let pyProc = null, win = null, quitting = false, maintenance = false;
let config;

function loadRuntimeConfig() {
  const file = path.join(app.getPath("userData"), "model-paths.json");
  const modelPaths = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  return runtimeConfig({ packaged: app.isPackaged, appRoot: __dirname, resources: process.resourcesPath, userData: app.getPath("userData"), modelPaths });
}

async function selectModelDirectory() {
  const chosen = await dialog.showOpenDialog(win, { title: "选择已有模型根目录（包含 vlm 子目录）", defaultPath: config.env.MEDIA_MANAGER_MODELS, properties: ["openDirectory"] });
  if (chosen.canceled) return;
  try {
    const modelsDir = path.resolve(chosen.filePaths[0]), profile = path.resolve(app.getPath("userData"));
    if (modelsDir === profile || modelsDir.startsWith(profile + path.sep) || profile.startsWith(modelsDir + path.sep)) {
      throw new Error("请选择用户配置目录之外的独立模型目录，以免导出资料库时重复包含模型。");
    }
    const file = path.join(profile, "model-paths.json"), temporary = file + ".tmp-" + crypto.randomUUID();
    fs.writeFileSync(temporary, JSON.stringify({ modelsDir, hfHome: path.join(require("os").homedir(), ".cache", "huggingface") }, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
    await dialog.showMessageBox(win, { type: "info", message: "模型目录已保存，重新启动应用后生效", detail: "直接加载所选目录中的模型；不会复制、移动或删除模型文件。Whisper 继续使用本机 Hugging Face 缓存。" });
  } catch (error) { dialog.showErrorBox("无法设置模型目录", error.message); }
}

function getJSON(endpoint) {
  return new Promise((resolve, reject) => {
    const req = http.get(`http://127.0.0.1:${PORT}${endpoint}`, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => { try { if (res.statusCode !== 200) throw new Error(`HTTP ${res.statusCode}`); resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    });
    req.setTimeout(2000, () => req.destroy(new Error("backend timeout")));
    req.on("error", reject);
  });
}

function startPython() {
  return new Promise((resolve, reject) => {
    const child = spawn(config.command, config.args, { cwd: config.library, detached: true,
      stdio: ["ignore", "pipe", "pipe"], env: { ...config.env, PORT: String(PORT),
        MEDIA_MANAGER_VERSION: app.getVersion(), MEDIA_MANAGER_INSTANCE: INSTANCE } });
    pyProc = child;
    const log = fs.createWriteStream(path.join(config.library, "logs", "desktop.log"), { flags: "a", mode: 0o600 });
    child.stdout.pipe(log, { end: false });child.stderr.pipe(log, { end: false });
    let settled = false, attempts = 0;
    const fail = error => { if (!settled) { settled = true; reject(error); } };
    child.on("error", fail);
    child.on("close", code => {
      log.end();if (pyProc === child) pyProc = null;
      if (!settled) fail(new Error(`后端启动失败（退出码 ${code}），请查看数据目录中的 logs/desktop.log`));
      else if (!quitting && !maintenance) { dialog.showErrorBox("后端服务已停止", "请重新启动应用。资料库已保留，详情见数据目录中的日志。");app.quit(); }
    });
    const check = async () => {
      if (settled) return;
      try {
        const health = await getJSON("/api/desktop/health");
        if (health.application !== "media-manager" || health.instance !== INSTANCE) throw new Error("端口已被其他服务占用");
        settled = true;resolve();
      } catch (error) {
        if (++attempts >= 120) fail(error);else setTimeout(check, 500);
      }
    };
    check();
  });
}

async function stopPython() {
  const child = pyProc;if (!child) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => { try { process.kill(-child.pid, "SIGKILL"); } catch {} resolve(); }, 15000);
    child.once("close", () => { clearTimeout(timer);resolve(); });
    try { process.kill(-child.pid, "SIGTERM"); } catch { clearTimeout(timer);resolve(); }
  });
  if (pyProc === child) pyProc = null;
}

async function exportData() {
  const chosen = await dialog.showOpenDialog(win, { title: "选择迁移副本的保存位置", properties: ["openDirectory", "createDirectory"] });
  if (chosen.canceled) return;
  const destination = path.join(chosen.filePaths[0], "Luminisle-Data-" + new Date().toISOString().replace(/[:.]/g, "-"));
  try {
    const active = await getJSON("/api/desktop/activity");
    if (active.busy) throw new Error("仍有分析或模型下载任务，请等待任务结束再导出。");
    maintenance = true;win.setEnabled(false);
    win.webContents.session.flushStorageData();
    await win.webContents.session.cookies.flushStore();
    await stopPython();
    await new Promise((resolve, reject) => {
      const log = fs.openSync(path.join(config.library, "logs", "migration.log"), "a", 0o600);
      let child;
      try {
        child = spawn(config.command, [...config.args, "export", "--library", config.library, "--profile", app.getPath("userData"), "--destination", destination], { cwd: config.library, env: config.env, stdio: ["ignore", log, log] });
      } finally { fs.closeSync(log); }
      child.on("error", reject);child.on("exit", code => code === 0 ? resolve() : reject(new Error("导出校验失败，原资料库未改动。已停止服务，请查看 logs/migration.log 后重新启动应用。")));
    });
    await startPython();maintenance = false;win.setEnabled(true);
    shell.showItemInFolder(destination);
    await dialog.showMessageBox(win, { type: "info", message: "迁移副本已生成并校验", detail: "包含资料库、工程、标注、缩略图和界面配置。外部模型与原视频、照片仍在原磁盘位置。" });
  } catch (error) {
    dialog.showErrorBox("未能导出迁移副本", error.message);
    if (maintenance) { quitting = true;app.quit(); }
  }
}

function createMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: "appMenu" },
    { label: "资料库", submenu: [
      { label: "打开数据目录", click: () => shell.openPath(config.library) },
      { label: "打开模型目录", click: () => shell.openPath(config.env.MEDIA_MANAGER_MODELS) },
      { label: "选择外部模型目录…", click: selectModelDirectory },
      { label: "导出完整迁移副本…", click: exportData },
      { label: "升级与迁移说明", click: () => shell.openPath(path.join(process.resourcesPath, "UPGRADE-AND-DATA.md")) },
    ] },
    { role: "editMenu" }, { role: "viewMenu" }, { role: "windowMenu" },
  ]));
}

function createWindow() {
  win = new BrowserWindow({
    width: 1600,
    height: 900,
    minWidth: 1000,
    minHeight: 600,
    title: APP_NAME,
    ...(process.platform === "darwin" ? {
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 18, y: 20 },
      vibrancy: "under-window",
      visualEffectState: "followWindow",
      backgroundColor: "#00000000",
    } : {}),
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

app.on("ready", async () => {
  if (!hasLock) return;
  try { config = loadRuntimeConfig(); }
  catch (error) { dialog.showErrorBox("模型路径配置无法读取", error.message);app.quit();return; }
  fs.mkdirSync(path.join(config.library, "logs"), { recursive: true, mode: 0o700 });
  createMenu();
  if (process.platform === "darwin") {
    app.dock.setIcon(nativeImage.createFromPath(ICON));
    app.setAboutPanelOptions({ applicationName: APP_NAME });
  }

  ipcMain.handle("set-theme", (event, mode) => {
    if (!["dark", "light", "auto"].includes(mode)) throw new Error("Invalid theme mode");
    nativeTheme.themeSource = mode === "auto" ? "system" : mode;
  });

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

  try {
    await startPython();createWindow();
  } catch (error) {
    dialog.showErrorBox("启动失败", error.message);app.quit();
  }
});

app.on("second-instance", () => { if (win) { if (win.isMinimized()) win.restore();win.focus(); } });
app.on("window-all-closed", () => app.quit());
app.on("before-quit", event => {
  if (quitting) return;
  event.preventDefault();quitting = true;
  stopPython().finally(() => app.quit());
});
