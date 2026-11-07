const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { applyModelDirectory } = require('../electron/model-migration');
const { readModelPaths } = require('../electron/model-paths');
const scratch = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'luminisle-model-apply-'))), passed = [];
function setup(name) {
  const root = path.join(scratch, name), profile = path.join(root, 'profile'), source = path.join(root, 'source'), target = path.join(root, 'target');
  for (const directory of [profile, source, target]) fs.mkdirSync(directory, { recursive: true });
  const file = path.join(profile, 'model-paths.json');fs.writeFileSync(file, JSON.stringify({ modelsDir: source, extra: 'preserve' }));
  fs.writeFileSync(path.join(source, 'model.gguf'), 'synthetic model');
  const events = [], phases = [];
  const options = { profile, directory: target, activePath: source, env: {},
    prepare: async () => { events.push('prepare');assert.equal(readModelPaths(profile).modelsDir, source); },
    stopBackend: async () => events.push('stop'),
    startBackend: async () => { events.push('start');assert.equal(readModelPaths(profile).modelsDir, target);return target; },
    onProgress: progress => phases.push(progress.phase),
  };
  return { profile, source, target, file, options, events, phases };
}
const check = async (name, fn) => { await fn();passed.push(name); };
(async () => {
  await check('Path-only changes become active before returning and preserve original files', async () => {
    const f = setup('path-only'), result = await applyModelDirectory(f.options);
    assert.equal(result.activePath, f.target);assert.equal(result.path, f.target);assert.equal(result.restartRequired, false);assert.equal(result.applied, true);
    assert.deepEqual(f.events, ['prepare', 'stop', 'start']);assert.deepEqual(f.phases, ['preparing', 'activating', 'done']);
    assert.deepEqual(fs.readdirSync(f.target), []);assert.equal(fs.readFileSync(path.join(f.source, 'model.gguf'), 'utf8'), 'synthetic model');
  });
  await check('Migration verifies copies before quiescence, commits before start, and reports completion only when active', async () => {
    const f = setup('copy');f.options.migrate = true;
    f.options.prepare = async () => { assert(f.phases.includes('verifying'));assert.equal(readModelPaths(f.profile).modelsDir, f.source);f.events.push('prepare'); };
    const result = await applyModelDirectory(f.options);
    assert.equal(result.activePath, f.target);assert.equal(result.restartRequired, false);
    assert.equal(fs.readFileSync(path.join(f.target, 'model.gguf'), 'utf8'), 'synthetic model');
    assert.equal(fs.readFileSync(path.join(f.source, 'model.gguf'), 'utf8'), 'synthetic model');
    assert.deepEqual(f.events, ['prepare', 'stop', 'start']);assert.equal(f.phases.filter(p => p === 'done').length, 1);
    assert(f.phases.indexOf('activating') > f.phases.indexOf('verifying'));assert.equal(f.phases.at(-1), 'done');
  });
  await check('Busy work and invalid destinations never stop the backend or change configuration', async () => {
    for (const migrate of [false, true]) {
      const f = setup('busy-' + migrate);f.options.migrate = migrate;f.options.prepare = async () => { throw new Error('Synthetic active import'); };
      await assert.rejects(applyModelDirectory(f.options), /Synthetic active import/);
      assert.deepEqual(f.events, []);assert.equal(readModelPaths(f.profile).modelsDir, f.source);assert.deepEqual(fs.readdirSync(f.target), []);
    }
    const f = setup('invalid');f.options.directory = path.join(f.profile, 'missing');
    await assert.rejects(applyModelDirectory(f.options));assert.deepEqual(f.events, []);
  });
  await check('Service startup failure stops writes and preserves committed configuration and originals without rollback', async () => {
    const f = setup('start-failure');f.options.migrate = true;
    f.options.startBackend = async () => { f.events.push('start');throw new Error('Synthetic startup failure'); };
    await assert.rejects(applyModelDirectory(f.options), /Synthetic startup failure.*未自动回退/);
    assert.deepEqual(f.events, ['prepare', 'stop', 'start', 'stop']);assert.equal(readModelPaths(f.profile).modelsDir, f.target);
    assert.equal(fs.readFileSync(path.join(f.source, 'model.gguf'), 'utf8'), 'synthetic model');
    assert.equal(fs.readFileSync(path.join(f.target, 'model.gguf'), 'utf8'), 'synthetic model');assert(!f.phases.includes('done'));
  });
  await check('Commit failure preserves previous configuration and does not automatically restart writers', async () => {
    const f = setup('commit-failure'), rename = fs.renameSync;
    try {
      fs.renameSync = () => { throw new Error('Synthetic configuration failure'); };
      await assert.rejects(applyModelDirectory(f.options), /Synthetic configuration failure.*未自动回退/);
    } finally { fs.renameSync = rename; }
    assert.deepEqual(f.events, ['prepare', 'stop', 'stop']);assert.equal(readModelPaths(f.profile).modelsDir, f.source);
  });
  await check('A mismatched running root cannot be reported as successfully applied', async () => {
    const f = setup('wrong-root');f.options.startBackend = async () => { f.events.push('start');return f.source; };
    await assert.rejects(applyModelDirectory(f.options), /服务模型目录未正确切换/);assert(!f.phases.includes('done'));
    assert.deepEqual(f.events, ['prepare', 'stop', 'start', 'stop']);
  });
  console.log('PASS ' + passed.length + ' live model directory groups: ' + passed.join('; '));
})().catch(error => { console.error(error);process.exitCode = 1; }).finally(() => fs.rmSync(scratch, { recursive: true, force: true }));
