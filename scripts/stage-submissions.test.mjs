import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { selectSubmissions } from './stage-submissions.mjs';

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'stage-submissions-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  for (const suite of ['HPL', 'HPL_NVIDIA', 'MFC']) {
    for (const run of ['new', 'completed', 'failed']) {
      await fs.mkdir(path.join(root, 'input/xenon', suite, 'demo', run), { recursive: true });
      if (run !== 'new') {
        const out = path.join(root, 'output/xenon', suite, 'demo', run);
        await fs.mkdir(out, { recursive: true });
        await fs.writeFile(path.join(out, suite === 'MFC' ? 'mfc-status.yml' : 'run.out'), suite === 'MFC' ? `state: ${run === 'completed' ? 'COMPLETED' : 'FAILED'}\n` : 'existing output');
      }
    }
  }
  return { root, cluster: 'xenon', allowed: ['HPL', 'HPL_NVIDIA'] };
}

test('HPL workflow never stages failed or new MFC jobs', async t => {
  const result = await selectSubmissions(await fixture(t));
  assert.deepEqual(result.selected.map(j => j.rel), ['HPL/demo/new', 'HPL_NVIDIA/demo/new']);
});
test('MFC workflow stages only pending MFC and skips completed runs', async t => {
  const options = await fixture(t);
  const result = await selectSubmissions({ ...options, allowed: ['MFC'] });
  assert.deepEqual(result.selected.map(j => j.rel), ['MFC/demo/failed', 'MFC/demo/new']);
  assert.deepEqual(result.skipped, ['MFC/demo/completed']);
});
test('targeted MFC rerun cannot replay other retained runs', async t => {
  const options = await fixture(t);
  const result = await selectSubmissions({ ...options, allowed: ['MFC'], job: 'demo/completed', rerun: true });
  assert.deepEqual(result.selected.map(j => j.rel), ['MFC/demo/completed']);
});
test('dispatch supports HPL_NVIDIA independently', async t => {
  const result = await selectSubmissions({ ...await fixture(t), suite: 'HPL_NVIDIA' });
  assert.deepEqual(result.selected.map(j => j.rel), ['HPL_NVIDIA/demo/new']);
});
test('reject cross-suite dispatch, broad rerun, traversal, missing and ambiguous targets', async t => {
  const options = await fixture(t);
  for (const extra of [
    { suite: 'MFC' }, { rerun: true }, { job: '../outside' },
    { job: 'demo/../../outside' }, { job: 'demo/$(touch BAD)' },
    { suite: 'HPL', job: 'demo/missing' }, { job: 'demo/new' },
  ]) await assert.rejects(selectSubmissions({ ...options, ...extra }));
});
test('absent output and empty suites do not invent jobs', async t => {
  const options = await fixture(t);
  await fs.rm(path.join(options.root, 'input/xenon/MFC'), { recursive: true });
  assert.deepEqual(await selectSubmissions({ ...options, allowed: ['MFC'] }), { selected: [], skipped: [] });
});

test('CLI validates only selected inputs and stages only after validation succeeds', async t => {
  const { spawnSync } = await import('node:child_process');
  const options = await fixture(t);
  await fs.mkdir(path.join(options.root, 'scripts'));
  await fs.writeFile(path.join(options.root, 'scripts/validate-job.mjs'), `
    import fs from 'node:fs';
    fs.writeFileSync('validated.json', JSON.stringify(process.argv.slice(2)));
    if (process.env.REJECT_VALIDATION === 'true') process.exit(1);
  `);
  const stage = path.join(options.root, 'stage');
  const envFile = path.join(options.root, 'github-env');
  const cli = new URL('./stage-submissions.mjs', import.meta.url).pathname;
  const env = { ...process.env, STAGE: stage, CLUSTER: 'xenon', ALLOWED_SUITES: 'HPL,HPL_NVIDIA', SELECTED_SUITE: 'HPL_NVIDIA', SELECTED_JOB: '', RERUN: 'false', GITHUB_ENV: envFile };
  const rejected = spawnSync(process.execPath, [cli], { cwd: options.root, env: { ...env, REJECT_VALIDATION: 'true' }, encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  await assert.rejects(fs.stat(stage), { code: 'ENOENT' });
  const accepted = spawnSync(process.execPath, [cli], { cwd: options.root, env, encoding: 'utf8' });
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(options.root, 'validated.json'), 'utf8')), ['input/xenon/HPL_NVIDIA/demo/new']);
  assert.deepEqual(await fs.readdir(stage), ['HPL_NVIDIA']);
  assert.equal(await fs.readFile(envFile, 'utf8'), 'STAGED=1\n');
});

test('empty CLI selection never invokes repository-wide validator', async t => {
  const { spawnSync } = await import('node:child_process');
  const options = await fixture(t);
  await fs.rm(path.join(options.root, 'input/xenon/MFC'), { recursive: true });
  const envFile = path.join(options.root, 'github-env');
  const result = spawnSync(process.execPath, [new URL('./stage-submissions.mjs', import.meta.url).pathname], {
    cwd: options.root, encoding: 'utf8', env: { ...process.env, STAGE: path.join(options.root, 'stage'), CLUSTER: 'xenon', ALLOWED_SUITES: 'MFC', SELECTED_SUITE: 'MFC', SELECTED_JOB: '', RERUN: 'false', GITHUB_ENV: envFile },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await fs.readFile(envFile, 'utf8'), 'STAGED=0\n');
});
