// Copy a finished run's artifacts out of scratch and into output/.
//
//   node scripts/harvest.mjs <stage-dir> <cluster>
//
// Replaces the inline "copy everything that is not xhpl/*.o/*.mod" loop the
// submit workflows used. That loop is why an MFC run landed 16 files in
// output/ -- MFC leaves its own .inp files, three separate timing files and an
// indices table in the case directory -- and the four that matter drowned in
// them on the website.
//
// Each suite declares what to keep in its suite.yml:
//
//   artifacts:
//     run.out: ["mfc-*.out"]     canonical name <- source globs, first match wins
//   metadata:
//     - mfc-provenance.json      kept for verification, not shown as an artifact
//
// Canonical names matter beyond tidiness. MFC names its batch files after the
// job (mfc-<run-name>.out), so without renaming, every run's stdout has a
// different filename and the website cannot link to "the output" generically.
import fs from "node:fs/promises";
import path from "node:path";
import { parseYaml } from "./lib/yaml.mjs";

const CWD = process.cwd();
const [stage, cluster] = process.argv.slice(2);

if (!stage || !cluster) {
  console.error("usage: harvest.mjs <stage-dir> <cluster>");
  process.exit(2);
}

const globToRe = (g) =>
  new RegExp("^" + g.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");

async function suiteManifest(suite) {
  try {
    const y = parseYaml(await fs.readFile(path.join(CWD, "suites", suite, "suite.yml"), "utf8"));
    return { artifacts: y.artifacts ?? null, metadata: Array.isArray(y.metadata) ? y.metadata : [], keep: Array.isArray(y.keep) ? y.keep : [] };
  } catch {
    return { artifacts: null, metadata: [] };
  }
}

async function listDirs(p) {
  try {
    return (await fs.readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
}

let kept = 0, skipped = 0, runs = 0;

for (const suite of await listDirs(stage)) {
  const manifest = await suiteManifest(suite);
  for (const group of await listDirs(path.join(stage, suite))) {
    for (const run of await listDirs(path.join(stage, suite, group))) {
      const src = path.join(stage, suite, group, run);
      const dest = path.join(CWD, "output", cluster, suite, group, run);
      const present = (await fs.readdir(src, { withFileTypes: true }))
        .filter((e) => e.isFile()).map((e) => e.name);

      // No manifest: fall back to the old behaviour rather than silently
      // harvesting nothing. A suite added without one still works.
      const pairs = [];
      if (manifest.artifacts) {
        // Metadata is claimed first so a glob cannot swallow it. "mfc-*.sh"
        // otherwise matches mfc-environment.sh before mfc-<run>.sh -- readdir
        // returns it first alphabetically -- and the website would show the
        // environment helper where the batch script belongs.
        const claimed = new Set();
        for (const m of manifest.metadata) {
          if (present.includes(m)) { pairs.push([m, m]); claimed.add(m); }
        }
        // "keep" globs take every match, under the original name.
        for (const g of manifest.keep) {
          for (const hit of present.filter((x) => !claimed.has(x) && globToRe(g).test(x))) {
            pairs.push([hit, hit]); claimed.add(hit);
          }
        }
        for (const [canonical, globs] of Object.entries(manifest.artifacts)) {
          const hit = (Array.isArray(globs) ? globs : [globs])
            .map((g) => present.find((f) => !claimed.has(f) && globToRe(g).test(f)))
            .find(Boolean);
          if (hit) { pairs.push([hit, canonical]); claimed.add(hit); }
        }
      } else {
        for (const f of present) {
          if (/^xhpl$|\.(o|mod)$/i.test(f)) continue;
          pairs.push([f, f]);
        }
      }

      await fs.mkdir(dest, { recursive: true });
      const taken = new Set(pairs.map(([from]) => from));
      for (const [from, to] of pairs) {
        await fs.copyFile(path.join(src, from), path.join(dest, to));
        kept++;
      }
      skipped += present.length - taken.size;
      runs++;
      const renamed = pairs.filter(([f, t]) => f !== t).map(([f, t]) => `${f}->${t}`);
      console.log(
        `harvested ${suite}/${group}/${run}: ${pairs.length} file(s)` +
        (present.length - taken.size ? `, ${present.length - taken.size} left behind` : "") +
        (renamed.length ? ` (${renamed.join(", ")})` : "")
      );
    }
  }
}

console.log(`harvest: ${runs} run(s), ${kept} file(s) kept, ${skipped} left in scratch`);
