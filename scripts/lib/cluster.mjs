// Cluster registry and inference.
// old runs have no cluster recorded, so it's inferred from node names in the output.

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

function nodePattern(names) {
  const esc = names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(`(?<![\\w-])(${esc.join("|")})(?![\\w-])`);
}

// order: explicit cluster, node names in output, --nodelist in the script, fallback
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
