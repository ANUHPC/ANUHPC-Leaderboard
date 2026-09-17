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
import { mfcDecomposition, gridFromCase } from "./lib/mfc-decomp.mjs";
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
    // input/<cluster>/<suite>/<group>/<run>
    for (const cl of await listDirs(path.join(CWD, "input"))) {
      if (cl.startsWith("_")) continue;                    // input/_TEMPLATES
      for (const suite of await listDirs(path.join(CWD, "input", cl))) {
        for (const group of await listDirs(path.join(CWD, "input", cl, suite))) {
          if (group.startsWith("_")) continue;
          for (const run of await listDirs(path.join(CWD, "input", cl, suite, group))) {
            targets.push(path.join("input", cl, suite, group, run));
          }
        }
      }
    }
  }
  if (!targets.length) { console.log("No submitted jobs to validate."); return; }

  for (const rel of targets) {
    const parts = rel.split(path.sep);
    const pathCluster = parts[1];               // input/<cluster>/<suite>/...
    const suiteName   = parts[2];
    const where = rel;
    const suite = suites[suiteName];
    if (pathCluster && pathCluster.startsWith("_")) continue;   // templates

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
      // HPL needs no job.yml. Everything it describes -- partition, nodes,
      // tasks, walltime -- is already in run.sh's #SBATCH lines, and keeping
      // both invites them to disagree. None of Raijin's 137 runs has one.
      // MFC is different: its job.yml names which pinned case to run, which
      // exists nowhere else, so that stays required via suite.yml.
      if (suiteName === "HPL" || suiteName === "HPL_NVIDIA") {
        await checkSbatch(rel, where, files, clusters[pathCluster], pathCluster);
        continue;
      }
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

    // --- can MFC actually decompose this grid over the ranks asked for? ---
    if (hasCustomCase) {
      const r = job.resources || {};
      const ranks = (r.nodes ?? 1) * (r.tasks_per_node ?? 1);
      let caseText = "";
      try { caseText = await fs.readFile(path.join(CWD, rel, "case.py"), "utf8"); } catch { /* reported elsewhere */ }
      const g = gridFromCase(caseText);
      if (g.m != null && g.n != null && g.p != null && ranks > 0) {
        const d = mfcDecomposition(g.m, g.n, g.p, ranks, g.weno);
        if (!d.ok) {
          err(where,
            `${g.m}x${g.n}x${g.p} cannot be split over ${ranks} rank(s): MFC needs at least ` +
            `${d.need} cells per rank in every direction at weno_order ${g.weno}, and no factorisation ` +
            `of ${ranks} satisfies that. pre_process would abort with "Unsupported combination of values ` +
            `of num_procs, m, n, p and weno/muscl/igr_order" after the job had queued. Use fewer ranks ` +
            `or a larger grid.`);
        }
      }
    }

    // --- which cluster? the directory decides ---
    const cname = pathCluster;
    const allowed = suite.clusters || [];
    if (job.cluster && job.cluster !== cname) {
      err(where, `job.yml says cluster "${job.cluster}" but the job sits under input/${cname}/ — move the directory or fix the field`);
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
    if (suiteName === "MFC") {
      if (pname === "all") err(where, "MFC cannot mix Haswell and Zen 3 nodes; use cpu or gpu");
      if (job.build?.case_optimization) err(where, "case_optimization would modify the shared MFC build and is unsupported");
      const gpu = job.build?.gpu ?? "none";
      if (!["none", "acc"].includes(gpu)) err(where, "build.gpu must be none or acc");
      const expected = gpu === "acc" ? "nvhpc-acc" : "gcc-ompi5";
      if (job.build?.toolchain && job.build.toolchain !== expected) err(where, `build.gpu=${gpu} requires toolchain ${expected}`);
      if (!Number.isInteger(r.tasks_per_node ?? 1) || (r.tasks_per_node ?? 1) < 1) err(where, "tasks_per_node must be a positive integer");
      if (!Number.isInteger(r.nodes ?? 1) || (r.nodes ?? 1) < 1) err(where, "nodes must be a positive integer");
      if (!Number.isInteger(job.tuning?.gbpp ?? 16) || (job.tuning?.gbpp ?? 16) < 1) err(where, "gbpp must be a positive integer");
    }

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

// HPL carries its resources in run.sh's #SBATCH lines rather than a job.yml,
// so the checks that job.yml gets have to read the script instead. Catching a
// bad core count here is the difference between a clear message on the pull
// request and "Requested node configuration is not available" from sbatch,
// after which the workflow used to go green having submitted nothing.
async function checkSbatch(rel, where, files, cluster, cname) {
  const name = files.find((f) => /^run(\.[a-z0-9_-]+)?\.sh$/i.test(f));
  if (!name) { err(where, `no run.sh (or run.<cluster>.sh) — nothing to submit`); return; }

  // run.raijin.sh sitting in an input/xenon/ directory is always a mistake.
  const m = /^run\.([a-z0-9_-]+)\.sh$/i.exec(name);
  if (m && m[1].toLowerCase() !== cname.toLowerCase()) {
    err(where, `"${name}" is another cluster's script but this job is under input/${cname}/`);
    return;
  }

  let text = "";
  try { text = await fs.readFile(path.join(CWD, rel, name), "utf8"); }
  catch (e) { err(where, `${name} is unreadable (${e.message})`); return; }

  const directive = (k) => {
    const re = new RegExp(`^\\s*#SBATCH\\s+--${k}[= ]\\s*([^\\s#]+)`, "im");
    const mm = re.exec(text);
    return mm ? mm[1] : null;
  };

  if (/CHANGE-ME/.test(text)) {
    warn(where, `${name} still has the template placeholder in --job-name; give the run a real name`);
  }

  const pname = directive("partition");
  if (!pname) { err(where, `${name} has no #SBATCH --partition`); return; }
  const part = cluster?.partitions?.[pname];
  if (!part) {
    err(where, `${name} asks for partition "${pname}", which does not exist on ${cname} (have: ${Object.keys(cluster?.partitions || {}).join(", ")})`);
    return;
  }

  const nodes = Number(directive("nodes") || 1);
  if (part.max_nodes && nodes > part.max_nodes) {
    err(where, `${name} asks for ${nodes} nodes but partition "${pname}" has ${part.max_nodes}`);
  }

  // The real trap: cores a job may have is cores_total minus CoreSpecCount.
  const tasks = Number(directive("ntasks-per-node") || 0);
  const cpt   = Number(directive("cpus-per-task") || 1);
  if (tasks > 0) {
    const want = tasks * cpt;
    // A single-node job needs ONE node that fits, so the ceiling is the
    // largest in the partition -- Slurm simply places it there. A multi-node
    // job has to fit every node it lands on, so the ceiling is the smallest.
    const names = part.nodes || [];
    const avails = names
      .map((n) => [n, cluster?.nodes?.[n]?.cores_available])
      .filter(([, a]) => typeof a === "number");
    let limit = Infinity, limiting = null;
    if (avails.length) {
      const pick = nodes > 1
        ? avails.reduce((a, b) => (b[1] < a[1] ? b : a))
        : avails.reduce((a, b) => (b[1] > a[1] ? b : a));
      limiting = pick[0]; limit = pick[1];
    }
    if (Number.isFinite(limit) && want > limit) {
      err(where, `${name} asks for ${tasks} x ${cpt} = ${want} cores per node, but ${limiting} offers ${limit} to jobs` +
                 (cluster.nodes[limiting]?.cores_reserved ? ` (${cluster.nodes[limiting].cores_reserved} reserved for system use)` : "") +
                 ` — sbatch will refuse this before it queues`);
    }
  }
}
