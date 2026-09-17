// Check the MFC case registry itself.
//
//   node scripts/validate-cases.mjs
//
// validate-job.mjs checks a submitted job against the registry. This checks the
// registry, which is the thing a case contribution actually changes. A bad
// entry here does not break one job -- it breaks every future run of that case,
// and worse, it can make a board that looks fine mean nothing.
//
// Tree cases are listed but not executed: they live in the MFC installation,
// which the pull-request runner does not have. render.sh verifies those on the
// cluster against the commit pin.
import fs from "node:fs/promises";
import path from "node:path";
import { loadCases, REPO_ROOT } from "../suites/MFC/case-path.mjs";
import { evalCase, mfcDict, gridOf } from "./lib/mfc-case-eval.mjs";
import { mfcDecomposition } from "./lib/mfc-decomp.mjs";

const problems = [];
const notes = [];
const err = (slug, msg) => problems.push(`${slug}: ${msg}`);

const cases = loadCases();

const seen = new Set();
for (const c of cases) {
  if (seen.has(c.slug)) err(c.slug, "duplicate slug — two entries claim the same board");
  seen.add(c.slug);
  // The slug becomes a board heading and part of a run id.
  if (!/^[a-z0-9][a-z0-9_]*$/.test(c.slug)) {
    err(c.slug, "slug must be lower-case letters, digits and underscores");
  }
}

for (const c of cases) {
  if (c.source !== "repo") { notes.push(`${c.slug}: tree case, verified on the cluster against the pin`); continue; }

  // A registry entry must not be able to point outside the repository.
  const file = path.resolve(REPO_ROOT, c.path);
  if (file !== REPO_ROOT && !file.startsWith(REPO_ROOT + path.sep)) {
    err(c.slug, `path "${c.path}" resolves outside the repository`);
    continue;
  }
  try { await fs.access(file); }
  catch { err(c.slug, `path "${c.path}" does not exist`); continue; }

  // Does it run at all, and does it produce a grid?
  const base = { nodes: 1, tasksPerNode: 4, gpu: true };
  const gbppArgs = (g) => (c.sizing === "fixed" ? [] : ["--gbpp", String(g)]);
  const first = await evalCase(file, { dict: mfcDict(base), args: gbppArgs(16) });
  if (!first.ok) { err(c.slug, `does not run: ${first.error}`); continue; }

  const g1 = gridOf(first.dict);
  if (g1.m == null || g1.n == null || g1.p == null) {
    err(c.slug, "case dictionary has no m/n/p — MFC cannot build a grid from it");
    continue;
  }

  // The sizing declaration has to be true, not just plausible. Getting it
  // wrong is silent: a case declared gbpp that ignores --gbpp turns every
  // multi-node entry on its board into strong scaling without saying so, and
  // the board then compares runs that did different amounts of work per rank.
  const scaled = await evalCase(file, {
    dict: mfcDict({ ...base, nodes: 2 }),
    args: gbppArgs(16),
  });
  if (!scaled.ok) { err(c.slug, `fails at 2 nodes: ${scaled.error}`); continue; }
  const g2 = gridOf(scaled.dict);
  const grew = g2.m > g1.m || g2.n > g1.n || g2.p > g1.p;

  if (c.sizing === "gbpp" && !grew) {
    err(c.slug, "declares sizing: gbpp but the grid does not grow with the rank count — " +
                "it must read --gbpp and the --mfc dict, or be declared sizing: fixed");
  }
  if (c.sizing === "fixed" && grew) {
    err(c.slug, "declares sizing: fixed but the grid changes with the rank count — declare sizing: gbpp");
  }

  // Every configuration the limits allow must decompose, or the board has
  // entries that cannot exist.
  for (const nodes of [1, 2]) {
    for (const tpn of [1, 2, 4]) {
      const r = await evalCase(file, { dict: mfcDict({ nodes, tasksPerNode: tpn, gpu: true }), args: gbppArgs(16) });
      if (!r.ok) { err(c.slug, `fails at ${nodes}x${tpn}: ${r.error}`); continue; }
      const g = gridOf(r.dict);
      const d = mfcDecomposition(g.m, g.n, g.p, nodes * tpn, g.weno);
      if (d.ok === false) {
        err(c.slug, `${g.m}x${g.n}x${g.p} cannot be decomposed over ${nodes * tpn} rank(s) ` +
                    `(needs ${d.need} cells per rank per direction)`);
      }
    }
  }

  notes.push(`${c.slug}: repo case, ${c.sizing}, ${g1.m}^3-ish at 4 ranks -> ${g2.m} at 8, decomposes 1-8 ranks`);
}

for (const n of notes) console.log(`  ok   ${n}`);
for (const p of problems) console.error(`ERROR ${p}`);
console.log(`\n${cases.length} registered case(s) — ${problems.length} error(s)`);
process.exit(problems.length ? 1 : 0);
