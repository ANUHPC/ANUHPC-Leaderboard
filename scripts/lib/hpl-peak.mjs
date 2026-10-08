// Theoretical peak (Rpeak) and efficiency for CPU HPL, the Top500 way:
//   Rpeak = base GHz x physical cores x FP64 FLOPs per core per cycle
// The specs come from clusters/<name>/partitions.yml. A node without base_ghz
// and flops_per_cycle has no Rpeak, so its runs get no efficiency.

function nodePeak(node) {
  const { base_ghz: ghz, cores_total: cores, flops_per_cycle: fpc } = node ?? {};
  return [ghz, cores, fpc].every((v) => Number.isFinite(v) && v > 0) ? { ghz, cores, fpc } : null;
}

// Rpeak counts every core on the nodes the job held, not just the ranks HPL
// started: leaving cores idle is a tuning choice, not smaller hardware.
// clockMHz is the measured all-core mean run.launchpad.sh prints, if any.
export function hplEfficiency({ cluster, config = {}, gflops, clockMHz = null }) {
  if (!cluster || !Number.isFinite(gflops) || gflops <= 0) return null;
  const parts = cluster.partitions ?? {};
  const pname = parts[config.partition] ? config.partition
    : Object.keys(parts).find((p) => parts[p].default === true);
  const specs = (parts[pname]?.nodes ?? []).map((n) => nodePeak(cluster.nodes?.[n]));
  // which nodes a job lands on isn't recorded, so the partition has to be uniform
  if (!specs.length || specs.some((s) => !s || JSON.stringify(s) !== JSON.stringify(specs[0]))) return null;

  const { ghz, cores, fpc } = specs[0];
  const nodes = Number.isSafeInteger(config.nodes) && config.nodes > 0 ? config.nodes : 1;
  const rpeak = ghz * cores * nodes * fpc;
  const avgGhz = Number.isFinite(clockMHz?.avg) && clockMHz.avg > 0 ? clockMHz.avg / 1000 : null;
  return {
    value: gflops / rpeak,
    rpeakGflops: rpeak,
    basis: { ghz, coresPerNode: cores, nodes, flopsPerCycle: fpc },
    // the same run against the clock it actually held, to separate
    // tuning from thermal and power limits
    measuredClock: avgGhz ? { ghz: avgGhz, rpeakGflops: avgGhz * cores * nodes * fpc,
                              value: gflops / (avgGhz * cores * nodes * fpc) } : null,
  };
}
