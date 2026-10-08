import test from 'node:test';
import assert from 'node:assert/strict';
import { loadClusters } from './cluster.mjs';
import { hplEfficiency } from './hpl-peak.mjs';

const clusters = await loadClusters();

test('launchpad Rpeak is 2.5 GHz x 64 cores x 32 FLOPs/cycle', () => {
  const e = hplEfficiency({ cluster: clusters.launchpad, gflops: 4247.83, clockMHz: { avg: 2214 } });
  assert.equal(e.rpeakGflops, 5120);
  assert.equal(e.value.toFixed(4), '0.8297');
  assert.equal(e.measuredClock.rpeakGflops.toFixed(1), '4534.3');
  assert.deepEqual(e.basis, { ghz: 2.5, coresPerNode: 64, nodes: 1, flopsPerCycle: 32 });
});

test('Rpeak scales with the nodes a job holds, not its ranks', () => {
  const cluster = { partitions: { cpu: { default: true, nodes: ['a', 'b'] } },
    nodes: { a: { base_ghz: 2, cores_total: 10, flops_per_cycle: 16 }, b: { base_ghz: 2, cores_total: 10, flops_per_cycle: 16 } } };
  assert.equal(hplEfficiency({ cluster, config: { nodes: 2, tasks_per_node: 1 }, gflops: 320 }).rpeakGflops, 640);
  assert.equal(hplEfficiency({ cluster, gflops: 320 }).measuredClock, null);
});

test('no efficiency without specs, on mixed partitions, or without a result', () => {
  assert.equal(hplEfficiency({ cluster: clusters.raijin, gflops: 100 }), null);
  const mixed = { partitions: { all: { default: true, nodes: ['a', 'b'] } },
    nodes: { a: { base_ghz: 2, cores_total: 10, flops_per_cycle: 16 }, b: { base_ghz: 3, cores_total: 10, flops_per_cycle: 16 } } };
  assert.equal(hplEfficiency({ cluster: mixed, gflops: 100 }), null);
  assert.equal(hplEfficiency({ cluster: clusters.launchpad, gflops: null }), null);
});
