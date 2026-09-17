// Observe the submitted integration batch through to the deployed site and video.
// Run on cpu-node1: node scripts/watch-mfc-integration.mjs [timeout-seconds]
// Read-only checks; writes a durable status file so progress survives logout.
import fs from 'node:fs/promises';
import path from 'node:path';
import { parseYaml } from './lib/yaml.mjs';

const base = 'https://anuhpc.github.io/ANUHPC-Leaderboard/';
const report = '/work/leaderboard/mfc-integration-status.json';
const videoDir = '/work/leaderboard/videos/bowshock-gpu-35186426864';
const suite = parseYaml(await fs.readFile(new URL('../suites/MFC/suite.yml', import.meta.url), 'utf8'));
const deadline = Date.now() + Number(process.argv[2] ?? 28800) * 1000;
const expected = suite.cases.map(c => `benchmark/${c.slug}-a100`)
  .concat('benchmark/5eq_rk3_weno3_hllc-cpu', 'demo/bowshock-gpu');
let last = '';
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30000), cache: 'no-store' });
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.json();
}
do {
  const status = { checkedAt: new Date().toISOString(), complete: false, runs: [], video: null, errors: [] };
  try {
    const index = await json(`${base}data/index.json?t=${Date.now()}`);
    for (const name of expected) {
      const run = index.runs.find(r => r.id === `xenon/MFC/${name}`);
      const ranked = !name.startsWith('demo/');
      const good = run?.status === 'ok' && run?.metric?.key === 'grind' &&
        run.metric.direction === 'lower' && run.metric.unit === 'ns/gp/eq/rhs' &&
        Number.isFinite(run.metric.value) && run.metric.value > 0 &&
        run.ranking?.eligible === ranked;
      status.runs.push({ name, verified: Boolean(good), status: run?.status ?? 'pending', grind: run?.metric?.value });
    }
    try {
      const video = JSON.parse(await fs.readFile(path.join(videoDir, 'video.json'), 'utf8'));
      const stat = await fs.stat(path.join(videoDir, video.video));
      if (video.frames === 60 && stat.size > 0) status.video = { ...video, path: path.join(videoDir, video.video) };
    } catch { /* Render is still queued or in progress. */ }
    if (status.runs.every(r => r.verified) && status.video) {
      // Confirm links that users will actually open, not just the index values.
      for (const name of expected) {
        const run = await json(`${base}data/runs/xenon/MFC/${name}/run.json?t=${Date.now()}`);
        for (const artifact of ['summary.yaml', 'time_data.dat', 'case.py']) {
          if (!run.raw?.[artifact]) throw new Error(`Missing ${artifact}: ${name}`);
          const response = await fetch(`${base}${run.raw[artifact]}`, { signal: AbortSignal.timeout(30000) });
          if (!response.ok) throw new Error(`Broken artifact link: ${name}/${artifact}`);
          await response.arrayBuffer();
        }
      }
      const destination = '/home/anuhpc/videos/bowshock-gpu.mp4';
      await fs.copyFile(status.video.path, destination);
      status.video.localCopy = destination;
      status.complete = true;
    }
  } catch (error) { status.errors.push(String(error)); }
  await fs.writeFile(`${report}.tmp`, JSON.stringify(status, null, 2) + '\n');
  await fs.rename(`${report}.tmp`, report);
  const signature = JSON.stringify({ runs: status.runs, video: status.video, errors: status.errors });
  if (signature !== last) { console.log(JSON.stringify(status)); last = signature; }
  if (status.complete) { console.log('MFC integration verified: nine runs, raw artifacts and 60-frame GPU video.'); process.exit(0); }
  if (Date.now() >= deadline) break;
  await new Promise(resolve => setTimeout(resolve, 60000));
} while (Date.now() < deadline);
console.error(`Verification timed out; inspect ${report} and the Actions/Slurm logs.`);
process.exitCode = 1;
