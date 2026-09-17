import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { collect } from './collect.mjs';

const caseRaw = 'print("pinned physics")';
const suite = { source: { pin: 'e2f0e267' }, cases: [{ slug: 'ibm' }] };
async function fixture(overrides = {}) {
  const data = {
    'case.py': caseRaw,
    'job.yml': 'case: ibm\nresources:\n  nodes: 2\n  tasks_per_node: 4\nbuild:\n  gpu: acc\n',
    'summary.yaml': 'simulation:\n  grind: 0.75\n  exec: 12.5\n',
    'time_data.dat': 'Ranks s/step ns/gp/eq/rhs\n8 0.1 1.5\n8 0.05 0.75\n',
    'mfc-status.yml': 'state: COMPLETED\n',
    'mfc-provenance.json': JSON.stringify({ case_source: 'pinned', mfc_sha: 'e2f0e2671234', case: 'ibm',
      case_sha256: createHash('sha256').update(caseRaw).digest('hex') }),
    ...overrides,
  };
  return collect({ suite, files: Object.keys(data), read: async f => data[f] ?? null });
}
test('completed pinned case is ranked using the latest grind and records elapsed time', async () => {
  const r = await fixture();
  assert.equal(r.ranking.eligible, true);
  assert.equal(r.ranking.group, 'ibm/GPU');
  assert.equal(r.metric.value, 0.75);
  assert.equal(r.secondary.find(s => s.key === 'exec').value, 12.5);
  assert.match(r.notes[0], /2 rows/);
});
test('custom, modified, wrong-commit and failed cases cannot rank', async () => {
  for (const overrides of [
    { 'mfc-provenance.json': '{}' },
    { 'case.py': 'different physics' },
    { 'mfc-provenance.json': JSON.stringify({ case_source: 'pinned', mfc_sha: 'bad' }) },
    { 'mfc-status.yml': 'state: FAILED' },
    { 'mfc-status.yml': null },
  ]) assert.equal((await fixture(overrides)).ranking.eligible, false);
});
test('nonfinite or nonpositive metrics are never ranked', async () => {
  for (const grind of ['NaN', '-1', '0']) {
    const r = await fixture({ 'summary.yaml': `simulation:\n  grind: ${grind}`, 'time_data.dat': '' });
    assert.equal(r.ranking.eligible, false);
    assert.equal(r.metric, null);
  }
});
