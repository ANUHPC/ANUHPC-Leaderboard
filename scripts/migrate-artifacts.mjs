// Bring already-harvested runs in output/ into line with their suite's
// artifacts manifest.
//
//   node scripts/migrate-artifacts.mjs [--apply] [output/<cluster>/<suite>]
//
// Dry run by default: prints what it would rename and drop, changes nothing.
//
// Runs harvested before suites declared an artifacts manifest kept whatever
// the job left in its directory -- for MFC that is 16 files per run, including
// its .inp files and three separate timing files, with stdout named after the
// job (mfc-<run>.out) so no stable link to "the output" is possible. This
// applies the same manifest harvest.mjs uses to what is already committed.
import fs from "node:fs/promises";
import path from "node:path";
import { parseYaml } from "./lib/yaml.mjs";

const CWD = process.cwd();
const args = process.argv.slice(2);
const apply = args.includes("--apply");
const only = args.find((a) => !a.startsWith("--"));

const globToRe = (g) =>
  new RegExp("^" + g.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");

const dirs = async (p) => {
  try {
    return (await fs.readdir(p, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch {
    return [];
  }
};

async function manifestFor(suite) {
  try {
    const y = parseYaml(await fs.readFile(path.join(CWD, "suites", suite, "suite.yml"), "utf8"));
    return y.artifacts ? { artifacts: y.artifacts, metadata: Array.isArray(y.metadata) ? y.metadata : [], keep: Array.isArray(y.keep) ? y.keep : [] } : null;
  } catch {
    return null;
  }
}

let renamed = 0, dropped = 0, touched = 0;

for (const cluster of await dirs(path.join(CWD, "output"))) {
  for (const suite of await dirs(path.join(CWD, "output", cluster))) {
    if (only && !path.join("output", cluster, suite).startsWith(only.replace(/\/$/, ""))) continue;
    const manifest = await manifestFor(suite);
    if (!manifest) continue;

    for (const group of await dirs(path.join(CWD, "output", cluster, suite))) {
      for (const run of await dirs(path.join(CWD, "output", cluster, suite, group))) {
        const dir = path.join(CWD, "output", cluster, suite, group, run);
        const present = (await fs.readdir(dir, { withFileTypes: true }))
          .filter((e) => e.isFile()).map((e) => e.name);

        const claimed = new Set();
        const moves = [];
        for (const m of manifest.metadata) if (present.includes(m)) claimed.add(m);
        for (const g of manifest.keep) {
          for (const hit of present.filter((x) => !claimed.has(x) && globToRe(g).test(x))) claimed.add(hit);
        }
        for (const [canonical, globs] of Object.entries(manifest.artifacts)) {
          const hit = (Array.isArray(globs) ? globs : [globs])
            .map((g) => present.find((f) => !claimed.has(f) && globToRe(g).test(f)))
            .find(Boolean);
          if (!hit) continue;
          claimed.add(hit);
          if (hit !== canonical) moves.push([hit, canonical]);
        }
        const extra = present.filter((f) => !claimed.has(f));
        if (!moves.length && !extra.length) continue;

        touched++;
        const label = `${cluster}/${suite}/${group}/${run}`;
        for (const [from, to] of moves) {
          console.log(`  ${apply ? "rename" : "would rename"} ${label}: ${from} -> ${to}`);
          if (apply) await fs.rename(path.join(dir, from), path.join(dir, to));
          renamed++;
        }
        if (extra.length) {
          console.log(`  ${apply ? "drop" : "would drop"}   ${label}: ${extra.join(", ")}`);
          if (apply) for (const f of extra) await fs.unlink(path.join(dir, f));
          dropped += extra.length;
        }
      }
    }
  }
}

console.log(
  `${apply ? "migrated" : "dry run"}: ${touched} run(s), ${renamed} rename(s), ${dropped} file(s) dropped` +
  (apply ? "" : " — pass --apply to make the changes")
);
