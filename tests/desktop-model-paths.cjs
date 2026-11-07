const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), vm = require('node:vm');
const { readModelPaths, modelDirectoryState, saveModelDirectory } = require('../electron/model-paths');
const { runtimeConfig } = require('../electron/runtime');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'luminisle-model-paths-')));
try {
  const profile = path.join(scratch, 'profile'), original = path.join(scratch, 'original'), selected = path.join(scratch, 'selected');
  for (const directory of [profile, original, selected, path.join(profile, 'nested')]) fs.mkdirSync(directory, { recursive: true });
  const file = path.join(profile, 'model-paths.json'), sentinel = path.join(original, 'model.gguf');
  fs.writeFileSync(sentinel, 'synthetic model contents');
  assert.deepEqual(readModelPaths(profile), {});
  assert.deepEqual(modelDirectoryState(profile, original, {}), { path: original, activePath: original, locked: false, restartRequired: false });
  assert.equal(fs.existsSync(file), false, 'Opening settings must not write configuration');
  const previous = { modelsDir: original, hfHome: path.join(scratch, 'external-hf'), extraPreference: 'preserve' };
  fs.writeFileSync(file, JSON.stringify(previous));
  const state = saveModelDirectory(profile, selected, original, {});
  assert.deepEqual(state, { path: selected, activePath: original, locked: false, restartRequired: true });
  assert.deepEqual(readModelPaths(profile), { ...previous, modelsDir: selected });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const restarted = runtimeConfig({ packaged: true, appRoot: '/app', resources: '/resources', userData: profile, modelPaths: readModelPaths(profile), env: {} });
  assert.equal(restarted.env.MEDIA_MANAGER_MODELS, selected);
  assert.equal(restarted.env.HF_HOME, previous.hfHome);
  assert.equal(modelDirectoryState(profile, selected, {}).restartRequired, false);
  const unchanged = fs.readFileSync(file, 'utf8'), invalidFile = path.join(scratch, 'file.onnx');
  fs.writeFileSync(invalidFile, 'not a directory');
  const link = path.join(scratch, 'profile-link');fs.symlinkSync(profile, link);
  for (const candidate of ['', 'relative/path', path.join(scratch, 'missing'), invalidFile, profile, path.join(profile, 'nested'), scratch, path.parse(scratch).root, link]) {
    assert.throws(() => saveModelDirectory(profile, candidate, original, {}), undefined, candidate);
    assert.equal(fs.readFileSync(file, 'utf8'), unchanged, 'Rejected paths must preserve prior configuration');
  }
  const override = { MEDIA_MANAGER_MODELS: original };
  assert.equal(modelDirectoryState(profile, original, override).locked, true);
  assert.equal(modelDirectoryState(profile, original, override).path, original);
  assert.throws(() => saveModelDirectory(profile, selected, original, override), /MEDIA_MANAGER_MODELS/);
  const rename = fs.renameSync;
  try {
    fs.renameSync = () => { throw new Error('Synthetic write failure'); };
    assert.throws(() => saveModelDirectory(profile, original, original, {}), /Synthetic write failure/);
  } finally { fs.renameSync = rename; }
  assert.equal(fs.readFileSync(file, 'utf8'), unchanged);
  assert.deepEqual(fs.readdirSync(profile).sort(), ['model-paths.json', 'nested']);
  assert.equal(fs.readFileSync(sentinel, 'utf8'), 'synthetic model contents');
  assert.deepEqual(fs.readdirSync(selected), [], 'Changing the root must not move or create model files');
  fs.writeFileSync(file, '{broken');
  assert.throws(() => saveModelDirectory(profile, original, original, {}));
  assert.equal(fs.readFileSync(file, 'utf8'), '{broken');
  let bridge;const calls = [], listeners = new Map();
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../electron/preload.js'), 'utf8'), {
    process: { platform: 'darwin' }, require: () => ({
      contextBridge: { exposeInMainWorld: (name, api) => { bridge = api; } },
      ipcRenderer: { invoke: (...args) => { calls.push(args); }, on: (channel, listener) => listeners.set(channel, listener),
        removeListener: (channel, listener) => { assert.equal(listeners.get(channel), listener);listeners.delete(channel); } }, webUtils: {},
    }),
  });
  bridge.getModelDirectory();bridge.saveModelDirectory(selected, { migrate: true });
  assert.deepEqual(calls, [['get-model-directory'], ['save-model-directory', selected, { migrate: true }]]);
  const progress = [], unsubscribe = bridge.onModelDirectoryProgress(value => progress.push(value));
  listeners.get('model-directory-progress')({ sender: 'must stay private' }, { phase: 'copying', doneBytes: 5, totalBytes: 10 });
  assert.deepEqual(progress, [{ phase: 'copying', doneBytes: 5, totalBytes: 10 }]);unsubscribe();assert.equal(listeners.size, 0);
  assert(require('../electron/package.json').build.files.includes('model-paths.js'));
  console.log('PASS desktop model directory: read-only loading; atomic save; restart persistence; HF/extra preferences preserved; invalid/overlapping/symlink paths and environment overrides rejected; failure preserves configuration; models untouched; preload bridge and packaged helper included');
} finally { fs.rmSync(scratch, { recursive: true, force: true }); }
