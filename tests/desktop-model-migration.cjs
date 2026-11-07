const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { migrateModelDirectory } = require('../electron/model-migration');
const { readModelPaths, modelDirectoryState } = require('../electron/model-paths');
const { runtimeConfig } = require('../electron/runtime');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'luminisle-model-migration-')));
const passed = [];
function setup(name) {
  const root = path.join(scratch, name), profile = path.join(root, 'profile'), source = path.join(root, 'source'), target = path.join(root, 'target');
  for (const dir of [profile, source, target, path.join(source, 'vlm', 'example'), path.join(source, 'huggingface', 'blobs'), path.join(source, 'huggingface', 'snapshots')]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(source, 'vlm', 'example', 'model.gguf'), Buffer.alloc(128 * 1024, 37));
  fs.writeFileSync(path.join(source, 'resnet50.onnx'), 'synthetic ONNX');
  fs.writeFileSync(path.join(source, 'huggingface', 'blobs', 'weights'), 'synthetic cache blob');
  fs.symlinkSync(path.join(source, 'huggingface', 'blobs', 'weights'), path.join(source, 'huggingface', 'snapshots', 'weights'));
  const file = path.join(profile, 'model-paths.json');
  fs.writeFileSync(file, JSON.stringify({ modelsDir: source, hfHome: path.join(source, 'huggingface'), extra: 'preserve' }));
  return { root, profile, source, target, file, original: fs.readFileSync(file, 'utf8') };
}
const check = async (name, fn) => { await fn();passed.push(name); };
(async () => {
  await check('Verified copies preserve originals, retarget internal cache links and cache configuration, and apply after restart', async () => {
    const f = setup('success'), progress = [];
    const result = await migrateModelDirectory(f.profile, f.target, f.source, {}, p => progress.push(p));
    const paths = readModelPaths(f.profile);
    assert.equal(result.path, f.target);assert.equal(result.activePath, f.source);assert.equal(result.sourceRetained, true);assert.equal(result.restartRequired, true);
    assert.equal(paths.hfHome, path.join(f.target, 'huggingface'));assert.equal(paths.extra, 'preserve');
    assert.equal(paths.lastModelMigration.source, f.source);assert.equal(paths.lastModelMigration.files, 3);
    for (const name of ['vlm/example/model.gguf', 'resnet50.onnx', 'huggingface/blobs/weights']) assert.deepEqual(fs.readFileSync(path.join(f.target, name)), fs.readFileSync(path.join(f.source, name)));
    assert.equal(fs.realpathSync(path.join(f.target, 'huggingface/snapshots/weights')), path.join(f.target, 'huggingface/blobs/weights'));
    assert.equal(fs.statSync(path.join(f.target, 'vlm/example/model.gguf')).mode & 0o777, 0o600);
    assert.equal(modelDirectoryState(f.profile, f.target, {}).restartRequired, false);
    const runtime = runtimeConfig({ packaged: true, appRoot: '/app', resources: '/resources', userData: f.profile, modelPaths: paths, env: {} });
    assert.equal(runtime.env.MEDIA_MANAGER_MODELS, f.target);assert.equal(runtime.env.HF_HOME, paths.hfHome);
    assert.deepEqual([...new Set(progress.map(p => p.phase))], ['preparing', 'copying', 'verifying', 'done']);
    assert.equal(progress.at(-1).doneBytes, progress.at(-1).totalBytes);
    assert.equal(fs.readdirSync(f.root).filter(name => name.startsWith('.luminisle-model-migration-')).length, 0);
  });
  await check('Nonempty, overlapping, aliased and environment-controlled destinations never write or overwrite', async () => {
    const f = setup('invalid');fs.writeFileSync(path.join(f.target, 'existing.gguf'), 'keep');
    await assert.rejects(migrateModelDirectory(f.profile, f.target, f.source, {}), /空目录/);
    assert.equal(fs.readFileSync(path.join(f.target, 'existing.gguf'), 'utf8'), 'keep');
    for (const target of [f.source, path.join(f.source, 'vlm'), f.root, f.profile]) await assert.rejects(migrateModelDirectory(f.profile, target, f.source, {}));
    const alias = path.join(f.root, 'alias');fs.symlinkSync(f.source, alias);
    await assert.rejects(migrateModelDirectory(f.profile, alias, f.source, {}));
    await assert.rejects(migrateModelDirectory(f.profile, f.target, f.source, { MEDIA_MANAGER_MODELS: f.source }));
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
    assert.equal(fs.readdirSync(f.root).filter(name => name.startsWith('.luminisle-model-migration-')).length, 0);
  });
  await check('Insufficient space and external links fail preflight without changing configuration or either directory', async () => {
    const f = setup('preflight'), statfs = fs.promises.statfs;
    try { fs.promises.statfs = async () => ({ bavail: 0n, bsize: 4096n });await assert.rejects(migrateModelDirectory(f.profile, f.target, f.source, {}), /空间不足/); }
    finally { fs.promises.statfs = statfs; }
    fs.symlinkSync(f.file, path.join(f.source, 'external-link'));
    await assert.rejects(migrateModelDirectory(f.profile, f.target, f.source, {}), /外部的链接/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);assert.deepEqual(fs.readdirSync(f.target), []);
    assert.equal(fs.readdirSync(f.root).filter(name => name.startsWith('.luminisle-model-migration-')).length, 0);
  });
  await check('Source changes during copying preserve configuration and keep an inspectable staging copy', async () => {
    const f = setup('source-change');let changed = false;
    await assert.rejects(migrateModelDirectory(f.profile, f.target, f.source, {}, p => {
      if (p.phase === 'copying' && !changed) { changed = true;fs.writeFileSync(path.join(f.source, 'added.gguf'), 'new model'); }
    }), /原模型目录在迁移期间发生变化/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);assert.deepEqual(fs.readdirSync(f.target), []);
    assert.equal(fs.readFileSync(path.join(f.source, 'added.gguf'), 'utf8'), 'new model');
    assert.equal(fs.readdirSync(f.root).filter(name => name.startsWith('.luminisle-model-migration-')).length, 1);
  });
  await check('Corrupt copies fail checksum verification and never switch the active setting', async () => {
    const f = setup('corrupt');let changed = false;
    await assert.rejects(migrateModelDirectory(f.profile, f.target, f.source, {}, p => {
      if (p.phase === 'verifying' && !changed) {
        changed = true;const stage = fs.readdirSync(f.root).find(name => name.startsWith('.luminisle-model-migration-'));
        fs.writeFileSync(path.join(f.root, stage, 'resnet50.onnx'), 'corrupted');
      }
    }), /校验失败/);
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);assert.deepEqual(fs.readdirSync(f.target), []);
    assert.equal(fs.readFileSync(path.join(f.source, 'resnet50.onnx'), 'utf8'), 'synthetic ONNX');
  });
  await check('Destination changes during copying are preserved, including newly added user files', async () => {
    const f = setup('target-change');let changed = false;
    await assert.rejects(migrateModelDirectory(f.profile, f.target, f.source, {}, p => {
      if (p.phase === 'copying' && !changed) { changed = true;fs.writeFileSync(path.join(f.target, 'user-file'), 'keep'); }
    }), /目标目录在迁移期间发生变化/);
    assert.equal(fs.readFileSync(path.join(f.target, 'user-file'), 'utf8'), 'keep');assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
  });
  await check('Configuration commit failure preserves the verified target, original configuration and source', async () => {
    const f = setup('commit-failure'), rename = fs.renameSync;
    try {
      fs.renameSync = () => { throw new Error('Synthetic config commit failure'); };
      await assert.rejects(migrateModelDirectory(f.profile, f.target, f.source, {}), /Synthetic config commit failure.*迁移副本保留在/);
    } finally { fs.renameSync = rename; }
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);
    assert.deepEqual(fs.readFileSync(path.join(f.target, 'vlm/example/model.gguf')), fs.readFileSync(path.join(f.source, 'vlm/example/model.gguf')));
  });
  await check('Copy IO errors leave originals and configuration intact without publishing partial models', async () => {
    const f = setup('io-failure'), createWriteStream = fs.createWriteStream;
    try {
      const { Writable } = require('node:stream');
      fs.createWriteStream = () => new Writable({ write(chunk, encoding, callback) { callback(new Error('Synthetic disk full')); } });
      await assert.rejects(migrateModelDirectory(f.profile, f.target, f.source, {}), /Synthetic disk full.*迁移副本保留在/);
    } finally { fs.createWriteStream = createWriteStream; }
    assert.equal(fs.readFileSync(f.file, 'utf8'), f.original);assert.deepEqual(fs.readdirSync(f.target), []);
    assert.equal(fs.readFileSync(path.join(f.source, 'resnet50.onnx'), 'utf8'), 'synthetic ONNX');
  });
  await check('External or environment-overridden caches retain their separate configuration', async () => {
    for (const kind of ['outside', 'override']) {
      const f = setup('cache-' + kind), paths = readModelPaths(f.profile);
      if (kind === 'outside') { paths.hfHome = path.join(f.root, 'separate-cache');fs.mkdirSync(paths.hfHome); }
      fs.writeFileSync(f.file, JSON.stringify(paths));
      await migrateModelDirectory(f.profile, f.target, f.source, kind === 'override' ? { HF_HOME: '/independent-cache' } : {});
      assert.equal(readModelPaths(f.profile).hfHome, paths.hfHome);
    }
  });
  assert(require('../electron/package.json').build.files.includes('model-migration.js'));
  console.log('PASS ' + passed.length + ' model migration groups: ' + passed.join('; '));
})().catch(error => { console.error(error);process.exitCode = 1; }).finally(() => fs.rmSync(scratch, { recursive: true, force: true }));
