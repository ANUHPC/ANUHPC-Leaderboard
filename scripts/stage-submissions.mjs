// Select and validate this workflow's suites before touching Slurm. Keeping
// the allowlist separate from the dispatch selector prevents cross-suite jobs.
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseYaml } from './lib/yaml.mjs';

async function entries(dir) {
  try { return await fs.readdir(dir, { withFileTypes: true }); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
}
const dirs = async (dir) => (await entries(dir)).filter(e => e.isDirectory() && !e.name.startsWith('_')).map(e => e.name).sort();
const segment = /^[A-Za-z0-9][A-Za-z0-9_.-]*$/;

export async function selectSubmissions({ root, cluster, allowed, suite = 'all', job = '', rerun = false }) {
  if (!segment.test(cluster)) throw new Error('Invalid cluster');
  if (!allowed.length || allowed.some(s => !segment.test(s))) throw new Error('Invalid suite allowlist');
  if (suite !== 'all' && !allowed.includes(suite)) throw new Error(`Suite ${suite} is not handled by this workflow (${allowed.join(', ')})`);
  if (job && (job.split('/').length !== 2 || !job.split('/').every(s => segment.test(s)))) {
    throw new Error('Job must be exactly group/run using letters, numbers, dots, underscores or hyphens');
  }
  if (rerun && !job) throw new Error('Rerun requires a specific group/run; use a new run directory for a new experiment');
  if (job && suite === 'all' && allowed.length > 1) throw new Error('Select one suite when targeting a group/run');
  const selected = [], skipped = [];
  let matched = false;
  for (const s of suite === 'all' ? allowed : [suite]) {
    const base = path.join(root, 'input', cluster, s);
    for (const group of await dirs(base)) {
      for (const run of await dirs(path.join(base, group))) {
        if (job && `${group}/${run}` !== job) continue;
        matched = true;
        const output = path.join(root, 'output', cluster, s, group, run);
        let complete;
        if (s === 'MFC') {
          let state = '';
          try { state = parseYaml(await fs.readFile(path.join(output, 'mfc-status.yml'), 'utf8')).state; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          complete = state === 'COMPLETED';
        } else {
          complete = (await entries(output)).some(e => e.isFile() && e.name.endsWith('.out'));
        }
        const rel = path.join(s, group, run);
        if (complete && !rerun) skipped.push(rel);
        else selected.push({ rel, input: path.join('input', cluster, rel) });
      }
    }
  }
  if (job && !matched) throw new Error(`No submitted job matches ${job}`);
  return { selected, skipped };
}

async function main() {
  const root = process.cwd();
  const stage = process.env.STAGE;
  if (!stage || !path.isAbsolute(stage)) throw new Error('STAGE must be an absolute path');
  const { selected, skipped } = await selectSubmissions({
    root, cluster: process.env.CLUSTER,
    allowed: (process.env.ALLOWED_SUITES || '').split(',').filter(Boolean),
    suite: process.env.SELECTED_SUITE || 'all', job: process.env.SELECTED_JOB || '',
    rerun: process.env.RERUN === 'true',
  });
  for (const rel of skipped) console.log(`skip ${rel} (already completed)`);
  if (selected.length) {
    // No empty invocation: validate-job defaults to the entire repository.
    const validation = spawnSync(process.execPath, ['scripts/validate-job.mjs', ...selected.map(j => j.input)], { cwd: root, stdio: 'inherit' });
    if (validation.error) throw validation.error;
    if (validation.status !== 0) throw new Error('Selected job validation failed; nothing was staged');
    for (const { rel, input } of selected) {
      await fs.mkdir(path.dirname(path.join(stage, rel)), { recursive: true });
      await fs.cp(path.join(root, input), path.join(stage, rel), { recursive: true });
      console.log(`staged ${rel}`);
    }
  }
  console.log(`${selected.length} job(s) staged`);
  if (process.env.GITHUB_ENV) await fs.appendFile(process.env.GITHUB_ENV, `STAGED=${selected.length}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(`::error::${error.message}`); process.exitCode = 1; });
}
