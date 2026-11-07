const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function readModelPaths(profile) {
  const file = path.join(profile, "model-paths.json");
  if (!fs.existsSync(file)) return {};
  const paths = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!paths || typeof paths !== "object" || Array.isArray(paths)) throw new Error("模型路径配置格式无效");
  return paths;
}

function modelDirectoryState(profile, activePath, env = process.env) {
  const paths = readModelPaths(profile), locked = !!env.MEDIA_MANAGER_MODELS;
  const directory = locked ? activePath : paths.modelsDir || activePath;
  return { path: directory, activePath, locked, restartRequired: path.resolve(directory) !== path.resolve(activePath) };
}

function containsPath(parent, child) {
  const relative = path.relative(parent, child);
  return !relative || relative !== ".." && !relative.startsWith(".." + path.sep) && !path.isAbsolute(relative);
}

function validateModelDirectory(profile, directory, env) {
  if (env.MEDIA_MANAGER_MODELS) throw new Error("模型目录由环境变量指定，请移除 MEDIA_MANAGER_MODELS 后再修改");
  if (typeof directory !== "string" || !path.isAbsolute(directory)) throw new Error("请选择模型目录的绝对路径");
  const modelsDir = fs.realpathSync(directory), userData = fs.realpathSync(profile);
  if (!fs.statSync(modelsDir).isDirectory()) throw new Error("请选择文件夹作为模型目录");
  if (containsPath(userData, modelsDir) || containsPath(modelsDir, userData)) {
    throw new Error("请选择用户配置目录之外的独立模型目录，以免导出资料库时重复包含模型");
  }
  return modelsDir;
}

function writeModelPaths(profile, paths) {
  const file = path.join(profile, "model-paths.json"), temporary = file + ".tmp-" + crypto.randomUUID();
  try {
    fs.writeFileSync(temporary, JSON.stringify(paths, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, file);
  } finally {
    if (fs.existsSync(temporary)) fs.unlinkSync(temporary);
  }
}

function saveModelDirectory(profile, directory, activePath, env = process.env) {
  const modelsDir = validateModelDirectory(profile, directory, env);
  writeModelPaths(profile, { ...readModelPaths(profile), modelsDir });
  return modelDirectoryState(profile, activePath, env);
}

module.exports = { readModelPaths, modelDirectoryState, saveModelDirectory, validateModelDirectory, writeModelPaths, containsPath };
