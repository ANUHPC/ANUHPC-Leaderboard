// List the submitted job directories that belong to a given cluster.
//
//   node scripts/select-jobs.mjs <cluster>
//
// Used by submit.yml so each cluster's runner picks up only its own work.
// A job with no job.yml is legacy HPL: attributed by the --nodelist in its
// run.sh, matched against each cluster's node names, so old Raijin scripts
// keep routing to Raijin without being edited.

import fs from "fs/promises";
import path from "path";
import { parseYaml } from "./lib/yaml.mjs";
import { loadClusters, inferCluster } from "./lib/cluster.mjs";

const want = process.argv[2];
if (!want) { console.error("usage: select-jobs.mjs <cluster>"); process.exit(2); }

const listDirs = async (d) => {
  try { return (await fs.readdir(d, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
};
const readSafe = async (p) => { try { return await fs.readFile(p, "utf8"); } catch { return null; } };

const clusters = await loadClusters(process.cwd());
if (!clusters[want]) { console.error(`unknown cluster "${want}"`); process.exit(2); }

const picked = [];
for (const suite of await listDirs("input")) {
  for (const group of await listDirs(path.join("input", suite))) {
    if (group.startsWith("_")) continue;
    for (const run of await listDirs(path.join("input", suite, group))) {
      const dir = path.join("input", suite, group, run);
      const files = await fs.readdir(dir).catch(() => []);

      let declared = null;
      const jf = files.find((f) => /^job\.ya?ml$/i.test(f));
      if (jf) {
        try { declared = parseYaml(await readSafe(path.join(dir, jf)))?.cluster ?? null; } catch { /* fall through */ }
      }

      let script = "";
      for (const f of files) if (/\.sh$/i.test(f)) script += (await readSafe(path.join(dir, f))) || "";

      const { cluster } = inferCluster({ clusters, explicit: declared, script,
                                         fallback: process.env.LEGACY_CLUSTER || "raijin" });
      if (cluster === want) picked.push(dir);
    }
  }
}
for (const p of picked) console.log(p);
