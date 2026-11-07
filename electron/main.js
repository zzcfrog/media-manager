const { app, BrowserWindow, ipcMain, dialog, nativeImage, nativeTheme, Menu, shell } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");
const crypto = require("crypto");
const { runtimeConfig } = require("./runtime");
const { readModelPaths, modelDirectoryState } = require("./model-paths");
const { applyModelDirectory } = require("./model-migration");

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
let backendInstance = crypto.randomUUID();
let pyProc = null, win = null, quitting = false, maintenance = false, modelMigration = false;
let config;

function loadRuntimeConfig() {
  const modelPaths = readModelPaths(app.getPath("userData"));
  return runtimeConfig({ packaged: app.isPackaged, appRoot: __dirname, resources: process.resourcesPath, userData: app.getPath("userData"), modelPaths });
}

function getJSON(endpoint, method = "GET") {
  return new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${PORT}${endpoint}`, { method, headers: { "X-Media-Manager-Instance": backendInstance } }, res => {
      let body = "";
      res.on("data", chunk => { body += chunk; });
      res.on("end", () => { try { const data = JSON.parse(body);if (res.statusCode !== 200) throw new Error(data.error || `HTTP ${res.statusCode}`);resolve(data); } catch (error) { reject(error); } });
    });
    req.setTimeout(method === "POST" ? 10000 : 2000, () => req.destroy(new Error("backend timeout")));
    req.on("error", reject);
    req.end();
  });
}

function startPython() {
  return new Promise((resolve, reject) => {
    backendInstance = crypto.randomUUID();
    const child = spawn(config.command, config.args, { cwd: config.library, detached: true,
      stdio: ["ignore", "pipe", "pipe"], env: { ...config.env, PORT: String(PORT),
        MEDIA_MANAGER_VERSION: app.getVersion(), MEDIA_MANAGER_INSTANCE: backendInstance } });
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
        if (health.application !== "media-manager" || health.instance !== backendInstance) throw new Error("端口已被其他服务占用");
        if (health.models_root && path.resolve(health.models_root) !== path.resolve(config.env.MEDIA_MANAGER_MODELS)) throw new Error("模型目录尚未切换");
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
    if (modelMigration) throw new Error("模型正在迁移，请完成后再导出资料库。");
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

  ipcMain.handle("select-directory", async (event, defaultPath) => {
    const result = await dialog.showOpenDialog(win, {
      title: "选择文件夹",
      defaultPath: typeof defaultPath === "string" && path.isAbsolute(defaultPath) ? defaultPath : undefined,
      properties: defaultPath ? ["openDirectory", "createDirectory"] : ["openDirectory"],
    });
    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle("get-model-directory", (event) => {
    if (event.sender !== win?.webContents) throw new Error("Invalid settings sender");
    return { ...modelDirectoryState(app.getPath("userData"), config.env.MEDIA_MANAGER_MODELS), migrationSupported: true, liveApplySupported: true };
  });

  ipcMain.handle("save-model-directory", async (event, directory, options) => {
    if (event.sender !== win?.webContents) throw new Error("Invalid settings sender");
    if (maintenance || modelMigration) throw new Error("资料库维护或模型迁移正在进行，请完成后重试");
    modelMigration = true;
    try {
      const activity = await getJSON("/api/desktop/activity");
      if (!activity.supports_model_directory_apply) throw new Error("请重新打开应用，以加载支持即时切换目录的服务");
      if (activity.model_directory_busy) throw new Error("请先完成或停止导入、分析、识别及下载任务，再切换模型目录");
      const result = await applyModelDirectory({ profile: app.getPath("userData"), directory, activePath: config.env.MEDIA_MANAGER_MODELS,
        env: process.env, migrate: options?.migrate === true,
        onProgress: progress => { try { if (!event.sender.isDestroyed()) event.sender.send("model-directory-progress", progress); } catch {} },
        prepare: async () => { await getJSON("/api/desktop/model-directory/prepare", "POST");maintenance = true; },
        stopBackend: stopPython,
        startBackend: async () => { config = loadRuntimeConfig();await startPython();return config.env.MEDIA_MANAGER_MODELS; },
      });
      maintenance = false;return result;
    } finally { modelMigration = false; }
  });

  ipcMain.handle("select-model-file", async () => {
    const result = await dialog.showOpenDialog(win, {
      title: "选择人脸模型文件",
      properties: ["openFile"],
      filters: [{ name: "ONNX 模型", extensions: ["onnx"] }],
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
