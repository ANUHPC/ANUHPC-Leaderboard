// Validate submitted jobs against the suite definition and the real cluster.
//
//   node scripts/validate-job.mjs [input/...]     # specific dirs, or all of input/
//
// Runs on the pull request, where there is no cluster — everything checked here
// is static. The point is that "you asked for 5 nodes but the gpu partition has
// 2" becomes a failed check on the PR instead of a job that queues and dies.

import fs from "fs/promises";
import path from "path";
import { parseYaml } from "./lib/yaml.mjs";
import { loadClusters } from "./lib/cluster.mjs";

const CWD = process.cwd();
const problems = [];
const warnings = [];
const err  = (where, msg) => problems.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const readSafe = async (p) => { try { return await fs.readFile(p, "utf8"); } catch { return null; } };
const listDirs = async (d) => {
  try { return (await fs.readdir(d, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name); }
  catch { return []; }
};
const listFiles = async (d) => {
  try { return (await fs.readdir(d, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name); }
  catch { return []; }
};

function globMatch(pattern, name) {
  const re = new RegExp("^" + pattern.split("*").map((s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$", "i");
  return re.test(name);
}

function toSeconds(hms) {
  if (typeof hms !== "string") return null;
  const p = hms.split(":").map(Number);
  if (p.some((n) => !Number.isFinite(n))) return null;
  if (p.length === 3) return p[0] * 3600 + p[1] * 60 + p[2];
  if (p.length === 2) return p[0] * 60 + p[1];
  return null;
}

async function main() {
  const clusters = await loadClusters(CWD);
  if (!Object.keys(clusters).length) { console.error("no clusters found under clusters/"); process.exit(1); }

  const suites = {};
  for (const name of await listDirs(path.join(CWD, "suites"))) {
    const raw = await readSafe(path.join(CWD, "suites", name, "suite.yml"));
    if (raw) suites[name] = parseYaml(raw);
  }

  // Which run directories to check.
  let targets = process.argv.slice(2);
  if (!targets.length) {
    for (const suite of await listDirs(path.join(CWD, "input"))) {
      for (const group of await listDirs(path.join(CWD, "input", suite))) {
        if (group.startsWith("_")) continue;
        for (const run of await listDirs(path.join(CWD, "input", suite, group))) {
          targets.push(path.join("input", suite, group, run));
        }
      }
    }
  }
  if (!targets.length) { console.log("No submitted jobs to validate."); return; }

  for (const rel of targets) {
    const parts = rel.split(path.sep);
    const suiteName = parts[1];
    const where = rel;
    const suite = suites[suiteName];

    if (!suite)              { err(where, `unknown suite "${suiteName}" — no suites/${suiteName}/suite.yml`); continue; }
    if (suite.enabled === false) { err(where, `suite ${suiteName} is not enabled yet`); continue; }

    const files = await listFiles(path.join(CWD, rel));

    for (const req of suite.inputs?.required || []) {
      if (!files.some((f) => globMatch(req, f))) err(where, `missing required input "${req}"`);
    }
    for (const bad of suite.inputs?.forbidden || []) {
      for (const f of files) {
        if (globMatch(bad, f)) {
          err(where, `"${f}" is not allowed for ${suiteName} — it generates its own batch script from ${suite.run?.template}`);
        }
      }
    }

    const jobFile = files.find((f) => /^job\.ya?ml$/i.test(f));
    if (!jobFile) {
      if (suiteName === "HPL") { warn(where, "no job.yml — falling back to the legacy run.sh path"); continue; }
      err(where, "missing job.yml"); continue;
    }

    let job;
    try { job = parseYaml(await readSafe(path.join(CWD, rel, jobFile))); }
    catch (e) { err(where, `job.yml is unreadable (${e.message})`); continue; }

    // --- case must be one the suite pins ---
    const cases = suite.cases || [];
    const hasCustomCase = files.some((f) => /^case\.py$/i.test(f));
    if (cases.length) {
      if (hasCustomCase) {
        // A custom case is allowed but cannot be compared with the fixed set.
        if (job.case) {
          warn(where, `both case.py and case: "${job.case}" are present — the supplied case.py wins and this run is UNRANKED`);
        } else {
          warn(where, "custom case.py supplied — this run is UNRANKED, it is not comparable with the pinned cases");
        }
      } else if (!job.case) {
        err(where, `job.yml must name a case (or supply your own case.py for an unranked run); one of: ${cases.map((c) => c.slug).join(", ")}`);
      } else if (!cases.some((c) => c.slug === job.case)) {
        err(where, `unknown case "${job.case}" — must be one of: ${cases.map((c) => c.slug).join(", ")}`);
      }
    }

    // --- which cluster? everything below depends on it ---
    const cname = job.cluster;
    const allowed = suite.clusters || [];
    if (!cname) {
      err(where, `job.yml must name a cluster; ${suiteName} runs on: ${allowed.join(", ") || "(none configured)"}`);
      continue;
    }
    const cluster = clusters[cname];
    if (!cluster) {
      err(where, `unknown cluster "${cname}" (have: ${Object.keys(clusters).join(", ")})`); continue;
    }
    if (allowed.length && !allowed.includes(cname)) {
      err(where, `${suiteName} is not set up on cluster "${cname}" (allowed: ${allowed.join(", ")})`); continue;
    }
    if (cluster.derived) {
      warn(where, `cluster "${cname}" has DERIVED specs (inferred from past runs, not measured) — limits here are approximate`);
    }

    // --- resources against that cluster ---
    const r = job.resources || {};
    const pname = r.partition;
    const part = pname ? cluster.partitions[pname] : null;

    if (!pname) err(where, "resources.partition is required");
    else if (!part) {
      err(where, `partition "${pname}" does not exist on ${cname} (have: ${Object.keys(cluster.partitions).join(", ")})`);
    }

    if (part) {
      const capNodes = Math.min(part.max_nodes ?? Infinity, suite.limits?.max_nodes ?? Infinity);
      const nodes = r.nodes ?? 1;
      if (!Number.isFinite(nodes) || nodes < 1) err(where, `resources.nodes must be a positive integer`);
      else if (nodes > capNodes) {
        err(where, `nodes=${nodes} exceeds the limit for partition "${pname}" on ${cname} (max ${capNodes}; it has ${part.nodes.length} node(s))`);
      }

      const tpn = r.tasks_per_node ?? 1;
      const nodeNames = part.nodes || [];
      const specs = nodeNames.map((n) => cluster.nodes?.[n]).filter(Boolean);
      const minCpus = specs.length ? Math.min(...specs.map((s) => s.cpus ?? Infinity)) : Infinity;
      const minGpus = specs.length ? Math.min(...specs.map((s) => s.gpus ?? 0)) : 0;

      if (tpn > minCpus) err(where, `tasks_per_node=${tpn} exceeds the ${minCpus} CPUs per node on ${cname}/${pname}`);

      const wantsGpu = (job.build?.gpu ?? "none") !== "none";
      if (wantsGpu) {
        if (minGpus === 0) err(where, `build.gpu=${job.build.gpu} but ${cname}/${pname} has no GPUs`);
        else if (tpn > minGpus) err(where, `tasks_per_node=${tpn} exceeds the ${minGpus} GPUs per node; MFC wants one rank per device`);
        else if (tpn < minGpus) warn(where, `tasks_per_node=${tpn} leaves ${minGpus - tpn} of ${minGpus} GPUs per node idle`);
      }

      const want = toSeconds(r.walltime);
      const capW = toSeconds(part.max_walltime) ?? toSeconds(suite.limits?.max_walltime);
      if (r.walltime && want == null) err(where, `walltime "${r.walltime}" is not HH:MM:SS`);
      else if (want != null && capW != null && want > capW) {
        err(where, `walltime ${r.walltime} exceeds the ${part.max_walltime} limit on ${cname}/${pname}`);
      }
    }

    // --- toolchain availability: a warning, not a failure ---
    const tc = job.build?.toolchain;
    if (tc) {
      const avail = cluster.toolchains?.toolchains || {};
      const def = avail[tc];
      if (!def) {
        if (!Object.keys(avail).length) warn(where, `cluster "${cname}" declares no toolchains; cannot check "${tc}"`);
        else err(where, `unknown toolchain "${tc}" on ${cname} (have: ${Object.keys(avail).join(", ")})`);
      }
      else if (def.available === false) {
        warn(where, `toolchain "${tc}" is not built on ${cname} yet — missing ${(def.missing || []).join(", ")}. The job will queue but cannot run.`);
      }
    }
  }

  for (const w of warnings) console.log(`warning  ${w}`);
  for (const p of problems) console.error(`ERROR    ${p}`);
  console.log(`\n${targets.length} job(s) checked — ${problems.length} error(s), ${warnings.length} warning(s)`);
  if (problems.length) process.exit(1);
}

main().catch((e) => { console.error(e); process.exit(1); });
