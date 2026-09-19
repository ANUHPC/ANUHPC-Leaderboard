import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { collect } from './collect.mjs';
import { collect as collectGpu } from '../HPL_NVIDIA/collect.mjs';

const fixture = name => readFile(new URL(`./fixtures/${name}.out`, import.meta.url), 'utf8');
async function run(raw, script = '#SBATCH --nodes=2\n', collector = collect) {
  const files = { 'run.out': raw, 'run.sh': script };
  return collector({ files: Object.keys(files), read: async f => files[f] ?? null });
}
const row = (gflops, passed = 'PASSED', P = 4, Q = 2, residual = '0.001') => `
WC0 184320 512 ${P} ${Q} 41.05 ${gflops} ( 1.271e+04 )
HPL_pdgesv() start time Wed Sep 17 03:20:22 2025
HPL_pdgesv() end time Wed Sep 17 03:21:37 2025
${passed ? `||Ax-b||_oo/(eps*(||A||_oo*||x||_oo+||b||_oo)*N)= ${residual} ...... ${passed}` : ''}
`;

test('real Netlib result retains dimensions, timing, metric and passed residual', async () => {
  const r = await run(await fixture('netlib'));
  assert.equal(r.metric.value, 12.274);
  assert.equal(r.config.N, 2000);
  assert.equal(r.config.P, 2);
  assert.equal(r.status, 'ok');
  assert.equal(r.ranking.eligible, true);
  assert.equal(r.secondary.find(x => x.key === 'residual').value, 0.00581163259);
  assert.equal(r.ranAt, '2026-04-01T01:42:05.000Z');
});

test('real NVIDIA fixture retains per-GPU metric, device info and dates', async () => {
  const r = await run(await fixture('nvidia'), undefined, collectGpu);
  assert.equal(r.metric.value, 33980);
  assert.equal(r.detail.best.gflopsPerGpu, 8496);
  assert.equal(r.config.variant, 'nvidia');
  assert.equal(r.ranking.eligible, true);
  assert.ok(r.detail.out.deviceInfo.numSms > 0);
  assert.equal(r.provenance.started, 'Fri Aug 29 05:01:17 2025');
  assert.equal(r.provenance.ended, 'Fri Aug 29 05:01:19 2025');
  assert.equal(r.ranAt, '2025-08-29T05:01:17.000Z');
});

test('historical mpirun --tag-output fixture parses all records', async () => {
  const r = await run(await fixture('nvidia-tagged'), undefined, collectGpu);
  assert.equal(r.metric.value, 61140);
  assert.equal(r.detail.best.gflopsPerGpu, 7643);
  assert.equal(r.ranking.eligible, true);
  assert.equal(r.secondary.find(x => x.key === 'residual').value, 0.000412123315);
  assert.equal(r.provenance.ended, 'Wed Sep 17 03:21:37 2025');
});

test('failed NVIDIA residual is retained for inspection but cannot rank', async () => {
  const r = await run((await fixture('nvidia')).replaceAll('PASSED', 'FAILED'), undefined, collectGpu);
  assert.equal(r.metric.value, 33980);
  assert.equal(r.status, 'failed-residual');
  assert.equal(r.ranking.eligible, false);
});

test('fastest candidate owns its residual, grid and overview fields', async () => {
  const r = await run(row('80000', 'PASSED', 4, 2, '0.01') + row('100000', 'PASSED', 2, 4, '0.02'));
  assert.equal(r.metric.value, 100000);
  assert.equal(r.config.P, 2);
  assert.equal(r.config.Q, 4);
  assert.equal(r.detail.out.residual, 0.02);
  assert.equal(r.secondary.find(x => x.key === 'residual').value, 0.02);
});

for (const [label, output, status] of [
  ['faster failed candidate after passing one', row('80000') + row('100000', 'FAILED'), 'failed-residual'],
  ['faster failed candidate before passing one', row('100000', 'FAILED') + row('80000'), 'failed-residual'],
  ['fastest candidate missing its residual', row('80000') + row('100000', null), 'unverified-residual'],
]) test(label, async () => {
  const r = await run(output);
  assert.equal(r.metric.value, 100000);
  assert.equal(r.status, status);
  assert.equal(r.ranking.eligible, false);
});

test('unknown residual does not borrow a summary pass', async () => {
  const r = await run(row('100000', null) + '\nFinished 1 tests\n1 tests completed and passed\n0 tests completed and failed\n0 tests skipped\n');
  assert.equal(r.detail.out.summary.testsPassed, 1);
  assert.equal(r.status, 'unverified-residual');
  assert.equal(r.ranking.eligible, false);
});

test('nonfinite residual or performance cannot become a successful result', async () => {
  for (const residual of ['NaN', 'Inf', '1e999', '-0.5']) {
    const r = await run(row('100000', 'PASSED', 4, 2, residual));
    assert.equal(r.status, 'failed-residual');
    assert.equal(r.ranking.eligible, false);
  }
  for (const gflops of ['NaN', 'Inf', '1e999', '-100', '0']) {
    const r = await run(row(gflops));
    assert.equal(r.metric, null);
    assert.equal(r.status, 'no-result');
    assert.equal(r.ranking.eligible, false);
  }
});

test('SBATCH whitespace and trailing comments preserve resource values', async () => {
  const r = await run(row('100000'), '#SBATCH --nodes=2 # two nodes\n#SBATCH --ntasks-per-node 4 # GPUs\n#SBATCH --cpus-per-task=8\n#SBATCH --partition=gpu # A100\n');
  assert.equal(r.config.nodes, 2);
  assert.equal(r.config.tasks_per_node, 4);
  assert.equal(r.config.cpus_per_task, 8);
  assert.equal(r.config.partition, 'gpu');
  const invalid = await run(row('100000'), '#SBATCH --nodes=bogus\n#SBATCH --ntasks-per-node=0\n');
  assert.equal(invalid.config.nodes, null);
  assert.equal(invalid.config.tasks_per_node, null);
});

test('malformed subsequent candidate cannot donate a passing residual', async () => {
  const r = await run(row('80000', null) + row('NaN'));
  assert.equal(r.metric.value, 80000);
  assert.equal(r.ranking.eligible, false);
  assert.equal(r.status, 'unverified-residual');
});

test('AOCL optional SWP field remains supported', async () => {
  const r = await run(row('80000').replace('WC0 184320', 'WR00C2C2 1 184320').replace(' ( 1.271e+04 )', ''));
  assert.equal(r.metric.value, 80000);
  assert.equal(r.config.N, 184320);
  assert.equal(r.config.NB, 512);
  assert.equal(r.status, 'ok');
});
