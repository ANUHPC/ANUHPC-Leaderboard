// Cluster registry and inference.
//
// The leaderboard spans more than one machine: Raijin (7 x hpc-0N, the original
// target) and Xenon (cpu-node1..2, gpu-node1..2). Results from different
// clusters are NOT comparable, so every run carries the cluster that produced
// it and boards are ranked per (suite, cluster).
//
// The 137 runs committed before Xenon existed have no cluster recorded. Rather
// than editing them, the cluster is inferred from the node names the run left
// behind — matched against each cluster's own node list, so adding a cluster
// needs no code change here.

import fs from "fs/promises";
import path from "path";
import { parseYaml } from "./yaml.mjs";

export async function loadClusters(root = process.cwd()) {
  const dir = path.join(root, "clusters");
  const out = {};
  let names = [];
  try {
    names = (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return out; }

  for (const name of names) {
    let cfg;
    try { cfg = parseYaml(await fs.readFile(path.join(dir, name, "partitions.yml"), "utf8")); }
    catch { continue; }
    let toolchains = null;
    try { toolchains = parseYaml(await fs.readFile(path.join(dir, name, "toolchains.yml"), "utf8")); }
    catch { /* optional */ }
    out[name] = {
      name,
      label: cfg.label ?? name,
      description: cfg.description ?? "",
      runnerLabel: cfg.runner_label ?? name,
      status: cfg.status ?? "active",
      derived: cfg.derived === true,
      nodes: cfg.nodes ?? {},
      partitions: cfg.partitions ?? {},
      toolchains,
    };
  }
  return out;
}

// Escape a node name for use in a word-boundary regex. Node names contain "-",
// which is literal, but be defensive about anything else.
function nodePattern(names) {
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\w-])(${esc.join("|")})(?![\\w-])`);
}

/**
 * Decide which cluster produced a run.
 *
 * Order:
 *   1. an explicit cluster recorded in the run (result.json / job.yml)
 *   2. node names appearing in the run's own output (.out/.err) — strongest
 *   3. node names in a --nodelist inside the submitted script
 *   4. the configured fallback
 *
 * Returns { cluster, source } so the collector can report how it was decided.
 */
export function inferCluster({ clusters, explicit = null, text = "", script = "", fallback = null }) {
  if (explicit && clusters[explicit]) return { cluster: explicit, source: "declared" };

  const matchers = Object.entries(clusters).map(([name, c]) => ({
    name,
    re: Object.keys(c.nodes).length ? nodePattern(Object.keys(c.nodes)) : null,
  }));

  const hits = (hay) => matchers.filter((m) => m.re && m.re.test(hay)).map((m) => m.name);

  const fromOut = hits(text);
  if (fromOut.length === 1) return { cluster: fromOut[0], source: "output" };
  if (fromOut.length > 1) return { cluster: null, source: "ambiguous", candidates: fromOut };

  const nodelist = /(?:--nodelist|-w)[= ]([^\s]+)/i.exec(script);
  if (nodelist) {
    const fromList = hits(nodelist[1]);
    if (fromList.length === 1) return { cluster: fromList[0], source: "nodelist" };
  }

  if (fallback && clusters[fallback]) return { cluster: fallback, source: "fallback" };
  return { cluster: null, source: "unknown" };
}
