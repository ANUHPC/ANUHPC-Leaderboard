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

// --- contributed cases (source: repo) --------------------------------------
//
// A tree case is frozen by MFC's commit pin. A repo case has no upstream
// commit to appeal to, so the freeze is the file committed here: the run is
// ranked only if the case.py it executed still hashes to the registered file.
// These cover the three ways that can go.

const repoCaseRaw = 'print("contributed physics")';
const repoSuite = {
  source: { pin: 'e2f0e267' },
  cases: [{ slug: 'anu_tgv_3d', source: 'repo', path: 'suites/MFC/cases/anu_tgv_3d/case.py' }],
};

async function repoFixture({ registered = repoCaseRaw, ran = repoCaseRaw, suiteOverride = null, ...overrides } = {}) {
  const data = {
    'case.py': ran,
    'job.yml': 'case: anu_tgv_3d\nresources:\n  nodes: 2\n  tasks_per_node: 4\nbuild:\n  gpu: acc\n',
    'summary.yaml': 'simulation:\n  grind: 0.42\n  exec: 9.0\n',
    'time_data.dat': 'Ranks s/step ns/gp/eq/rhs\n8 0.05 0.42\n',
    'mfc-status.yml': 'state: COMPLETED\n',
    'mfc-provenance.json': JSON.stringify({
      case_source: 'pinned', mfc_sha: 'e2f0e2671234', case: 'anu_tgv_3d', case_registry: 'repo',
      case_sha256: createHash('sha256').update(ran).digest('hex'),
    }),
    ...overrides,
  };
  return collect({
    suite: suiteOverride ?? repoSuite,
    files: Object.keys(data),
    read: async f => data[f] ?? null,
    readRepo: async () => registered,
  });
}

test('a contributed case that matches the committed file is ranked', async () => {
  const r = await repoFixture();
  assert.equal(r.ranking.eligible, true);
  assert.equal(r.ranking.reason, 'Contributed benchmark case');
  assert.equal(r.metric.value, 0.42);
});

test('editing a registered case unranks past runs, and says so', async () => {
  // The run was legitimate; the case moved underneath it. Reporting this as
  // "custom or unverified" would send the entrant hunting a fault in their job.
  const r = await repoFixture({ registered: 'print("edited physics")' });
  assert.equal(r.ranking.eligible, false);
  assert.match(r.ranking.reason, /has been edited since this run/);
});

test('a contributed case deleted from the repo cannot rank', async () => {
  const r = await repoFixture({ registered: null });
  assert.equal(r.ranking.eligible, false);
  assert.doesNotMatch(r.ranking.reason, /edited/);
});

test('a repo case does not fall back to the commit pin', async () => {
  // The tree check must not be able to rank a repo case: mfc_sha is valid here
  // and the committed file still differs, so the answer has to be no.
  const r = await repoFixture({ registered: 'print("something else")' });
  assert.equal(r.ranking.eligible, false);
});

test('an unregistered slug is unranked even with perfect provenance', async () => {
  const r = await collect({
    suite: repoSuite,
    files: ['case.py', 'job.yml', 'summary.yaml', 'mfc-status.yml', 'mfc-provenance.json'],
    read: async f => ({
      'case.py': repoCaseRaw,
      'job.yml': 'case: not_registered\nbuild:\n  gpu: acc\n',
      'summary.yaml': 'simulation:\n  grind: 0.1\n',
      'mfc-status.yml': 'state: COMPLETED\n',
      'mfc-provenance.json': JSON.stringify({
        case_source: 'pinned', mfc_sha: 'e2f0e2671234', case: 'not_registered',
        case_sha256: createHash('sha256').update(repoCaseRaw).digest('hex'),
      }),
    }[f] ?? null),
    readRepo: async () => repoCaseRaw,
  });
  assert.equal(r.ranking.eligible, false);
});

test('a registered case declared ranked: false is verified but not ranked', async () => {
  // Frozen and hash-checked like any other, so the result is trustworthy --
  // it simply does not join a board, because a convergence study's coarser
  // grids are faster for no merit.
  const r = await repoFixture({
    suiteOverride: {
      source: { pin: 'e2f0e267' },
      cases: [{ slug: 'anu_tgv_3d', source: 'repo', path: 'suites/MFC/cases/anu_tgv_3d/case.py', ranked: false }],
    },
  });
  assert.equal(r.ranking.eligible, false);
  assert.equal(r.ranking.reason, 'Reference case — compared by settings, not ranked');
  assert.equal(r.metric.value, 0.42);      // the measurement still stands
});
