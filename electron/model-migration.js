const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { Transform } = require("stream");
const { pipeline } = require("stream/promises");
const { readModelPaths, modelDirectoryState, saveModelDirectory, validateModelDirectory, writeModelPaths, containsPath } = require("./model-paths");

async function inventory(root) {
  const entries = [];
  async function visit(directory) {
    const names = (await fs.promises.readdir(directory)).sort();
    for (const name of names) {
      const file = path.join(directory, name), stat = await fs.promises.lstat(file);
      const entry = { name: path.relative(root, file), size: stat.size, mtime: stat.mtimeMs, ctime: stat.ctimeMs,
        ino: stat.ino, dev: stat.dev, type: stat.isDirectory() ? "directory" : stat.isFile() ? "file" : "link" };
      if (stat.isSymbolicLink()) {
        entry.link = await fs.promises.realpath(file);
        if (!containsPath(root, entry.link)) throw new Error("模型目录包含指向外部的链接，请先整理该链接再迁移：" + entry.name);
      } else if (!stat.isDirectory() && !stat.isFile()) throw new Error("模型目录包含不支持迁移的特殊文件：" + entry.name);
      entries.push(entry);
      if (stat.isDirectory()) await visit(file);
    }
  }
  await visit(root);return entries;
}

async function digest(file, progress) {
  const hash = crypto.createHash("sha256");
  for await (const chunk of fs.createReadStream(file)) { hash.update(chunk);progress(chunk.length); }
  return hash.digest("hex");
}

async function migrateModelDirectory(profile, directory, activePath, env = process.env, onProgress = () => {}, beforeCommit = async () => {}) {
  const target = validateModelDirectory(profile, directory, env), source = await fs.promises.realpath(activePath);
  if (containsPath(source, target) || containsPath(target, source)) throw new Error("新旧模型目录不能相同或互相包含");
  if (containsPath(source, await fs.promises.realpath(profile))) throw new Error("原模型目录包含应用配置，无法按模型目录迁移");
  readModelPaths(profile);
  if ((await fs.promises.readdir(target)).length) throw new Error("迁移目标必须为空目录，已有文件不会被覆盖");
  const targetStat = await fs.promises.stat(target), parentStat = await fs.promises.stat(path.dirname(target));
  if (targetStat.dev !== parentStat.dev) throw new Error("请在目标磁盘内选择一个独立空文件夹，不要直接选择磁盘根目录");
  onProgress({ phase: "preparing", doneBytes: 0, totalBytes: 0 });
  const entries = await inventory(source), files = entries.filter(entry => entry.type === "file");
  const totalBytes = files.reduce((sum, entry) => sum + entry.size, 0);
  const space = await fs.promises.statfs(target, { bigint: true });
  if (space.bavail * space.bsize < BigInt(totalBytes) + 4n * 1024n * 1024n) throw new Error("目标磁盘空间不足，请腾出空间后重试；原目录和路径配置未改动");
  const staging = await fs.promises.mkdtemp(path.join(path.dirname(target), ".luminisle-model-migration-"));
  let published = false, doneBytes = 0, lastUpdate = 0;
  const emit = (phase, force = false) => {
    const now = Date.now();
    if (force || now - lastUpdate >= 150) { lastUpdate = now;onProgress({ phase, doneBytes, totalBytes }); }
  };
  try {
    emit("copying", true);
    for (const entry of entries.filter(entry => entry.type === "directory")) {
      await fs.promises.mkdir(path.join(staging, entry.name));
    }
    const hashes = new Map();
    for (const entry of files) {
      const hash = crypto.createHash("sha256");
      await pipeline(fs.createReadStream(path.join(source, entry.name)), new Transform({
        transform(chunk, encoding, callback) { hash.update(chunk);doneBytes += chunk.length;emit("copying");callback(null, chunk); },
      }), fs.createWriteStream(path.join(staging, entry.name), { flags: "wx", mode: 0o600 }));
      hashes.set(entry.name, hash.digest("hex"));
    }
    for (const entry of entries.filter(entry => entry.type === "link")) {
      const link = path.join(staging, entry.name), mapped = path.join(staging, path.relative(source, entry.link));
      await fs.promises.symlink(path.relative(path.dirname(link), mapped), link);
    }
    doneBytes = 0;emit("verifying", true);
    for (const entry of files) {
      const actual = await digest(path.join(staging, entry.name), bytes => { doneBytes += bytes;emit("verifying"); });
      if (actual !== hashes.get(entry.name)) throw new Error("模型副本校验失败：" + entry.name);
    }
    if (JSON.stringify(await inventory(source)) !== JSON.stringify(entries)) throw new Error("原模型目录在迁移期间发生变化，请停止下载或修改后重试");
    const currentTarget = await fs.promises.stat(target);
    if (currentTarget.ino !== targetStat.ino || currentTarget.dev !== targetStat.dev || (await fs.promises.readdir(target)).length) {
      throw new Error("目标目录在迁移期间发生变化，未覆盖其中的文件");
    }
    await beforeCommit();
    await fs.promises.rename(staging, target);published = true;
    const paths = readModelPaths(profile), updated = { ...paths, modelsDir: target };
    if (paths.hfHome && !env.HF_HOME && !env.HF_HUB_CACHE) {
      const cache = await fs.promises.realpath(paths.hfHome).catch(() => path.resolve(paths.hfHome));
      if (containsPath(source, cache)) updated.hfHome = path.join(target, path.relative(source, cache));
    }
    updated.lastModelMigration = { source, target, files: files.length, bytes: totalBytes, sourceRetained: true, verifiedAt: new Date().toISOString() };
    writeModelPaths(profile, updated);
    emit("done", true);
    return { ...modelDirectoryState(profile, activePath, env), migrated: true, sourceRetained: true };
  } catch (error) {
    throw new Error(error.message + "；原模型文件保留，迁移副本保留在 " + (published ? target : staging));
  }
}

async function applyModelDirectory({ profile, directory, activePath, env = process.env, migrate = false,
  onProgress = () => {}, prepare, stopBackend, startBackend }) {
  const target = validateModelDirectory(profile, directory, env);
  let quiesced = false;
  const beforeCommit = async () => {
    await prepare();quiesced = true;
    await stopBackend();
  };
  try {
    if (migrate) {
      await migrateModelDirectory(profile, directory, activePath, env, progress => {
        if (progress.phase !== "done") onProgress(progress);
      }, beforeCommit);
    } else {
      onProgress({ phase: "preparing", doneBytes: 0, totalBytes: 0 });
      await beforeCommit();
      saveModelDirectory(profile, directory, activePath, env);
    }
    onProgress({ phase: "activating", doneBytes: 0, totalBytes: 0 });
    const appliedPath = await startBackend();
    if (path.resolve(appliedPath) !== target) throw new Error("服务模型目录未正确切换");
    onProgress({ phase: "done", doneBytes: 0, totalBytes: 0 });
    return { ...modelDirectoryState(profile, appliedPath, env), applied: true };
  } catch (error) {
    if (quiesced) {
      await stopBackend();
      throw new Error(error.message + "；服务尚未恢复，配置和副本已保留，未自动回退。请查看 logs/desktop.log 后重新打开应用。");
    }
    throw error;
  }
}

module.exports = { migrateModelDirectory, applyModelDirectory };
