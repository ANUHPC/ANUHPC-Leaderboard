// Refuse to run if this runner is not a node of the cluster it claims.
//
//   node scripts/verify-runner-cluster.mjs <cluster>
//
// Runner labels are set once at registration and can drift or be copied to the
// wrong machine. This checks the actual hostname against the node list in
// clusters/<cluster>/partitions.yml, so a mislabelled runner fails loudly here
// instead of submitting jobs to the wrong cluster.
//
// A .mjs file, not an inline `node -e`: mixing `require` with a top-level
// `await import()` puts node in ES-module mode and `require` stops existing.

import fs from "fs";
import os from "os";
import { parseYaml } from "./lib/yaml.mjs";

const cluster = process.argv[2];
if (!cluster) { console.error("usage: verify-runner-cluster.mjs <cluster>"); process.exit(2); }

const file = `clusters/${cluster}/partitions.yml`;
let cfg;
try { cfg = parseYaml(fs.readFileSync(file, "utf8")); }
catch (e) { console.error(`cannot read ${file}: ${e.message}`); process.exit(2); }

const nodes = Object.keys(cfg.nodes || {});
if (!nodes.length) { console.error(`${file} lists no nodes`); process.exit(2); }

const me = os.hostname().split(".")[0];

// The controller runs the scheduler but is not always a compute node, so accept
// it too — it can legitimately host the runner.
const controller = cfg.controller ? [cfg.controller] : [];
const allowed = [...nodes, ...controller];

if (!allowed.includes(me)) {
  console.error(`refusing: this runner is "${me}", not a ${cluster} node`);
  console.error(`  ${cluster} nodes: ${allowed.join(", ")}`);
  console.error("  the runner's label and the machine it runs on disagree");
  process.exit(1);
}
console.log(`ok: ${me} belongs to ${cluster}`);
