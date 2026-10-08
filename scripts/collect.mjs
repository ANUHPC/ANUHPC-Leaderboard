// Suite-agnostic leaderboard collector.
//
// walks every enabled suite, uses its collect.mjs to parse runs, and writes:
//
//   /tmp/hpl-website-data/data/index.json
//   /tmp/hpl-website-data/data/runs/<cluster>/<suite>/<group>/<run>/run.json
//   /tmp/hpl-website-data/raw/<suite>/<group>/<run>/<files>
//
// ranking is per suite and follows metric.direction (HPL higher, MFC lower).

import fs from "fs/promises";
import path from "path";
import { loadRunHistory, submitterOf, historyWarnings } from "./lib/run-history.mjs";
import { parseYaml } from "./lib/yaml.mjs";
import { loadClusters, inferCluster } from "./lib/cluster.mjs";

const CWD       = process.cwd();
const SUITE_DIR = path.join(CWD, "suites");
const SRC_ROOT  = path.join(CWD, "output");
const OUT_ROOT  = process.env.WEBSITE_DATA_DIR || "/tmp/hpl-website-data";
const DATA_ROOT = path.join(OUT_ROOT, "data");
const RAW_ROOT  = path.join(OUT_ROOT, "raw");
// old runs with no node names are from raijin
const LEGACY_CLUSTER = process.env.LEGACY_CLUSTER || "raijin";

const ensureDir = (p) => fs.mkdir(p, { recursive: true });
const exists = async (p) => { try { await fs.stat(p); return true; } catch { return false; } };
const readSafe = async (p) => { try { return await fs.readFile(p, "utf8"); } catch { return null; } };

async function listDirs(dir) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
  } catch { return []; }
}
async function listFiles(dir) {
  try {
    return (await fs.readdir(dir, { withFileTypes: true })).filter((e) => e.isFile()).map((e) => e.name);
  } catch { return []; }
}

// a dir is a run if it has any run artefact, broad because old runs are messy
const RUN_FILE = /^(HPL|HPT)\.dat$|^case\.py$|^namelist\.input$|^summary\.ya?ml$|^time_data\.dat$|^result\.json$|\.out$|\.err$|\.sh$/i;

async function findRunDirs(base) {
  const out = [];
  async function walk(dir) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    if (entries.some((e) => e.isFile() && RUN_FILE.test(e.name))) { out.push(dir); return; }
    for (const e of entries) if (e.isDirectory()) await walk(path.join(dir, e.name));
  }
  await walk(base);
  return out;
}

async function loadSuites() {
  const suites = [];
  for (const name of await listDirs(SUITE_DIR)) {
    const cfgPath = path.join(SUITE_DIR, name, "suite.yml");
    const raw = await readSafe(cfgPath);
    if (!raw) continue;
    let cfg;
    try { cfg = parseYaml(raw); }
    catch (e) { console.warn(`[collect] ${name}: unreadable suite.yml (${e.message})`); continue; }
    if (cfg.enabled === false) { console.log(`[collect] ${name}: disabled, skipped`); continue; }

    let mod = null;
    const modPath = path.join(SUITE_DIR, name, "collect.mjs");
    if (await exists(modPath)) {
      try { mod = await import(`file://${modPath}`); }
      catch (e) { console.warn(`[collect] ${name}: collect.mjs failed to load (${e.message})`); }
    }
    suites.push({ name, cfg, mod });
  }
  return suites;
}

// rank per cluster, different hardware isn't comparable
function rank(entries, direction) {
  const byCluster = new Map();
  for (const e of entries) {
    const k = `${e.cluster || "__unknown__"}/${e.ranking?.group ?? ""}`;
    if (!byCluster.has(k)) byCluster.set(k, []);
    byCluster.get(k).push(e);
  }
  const out = [];
  for (const [, group] of byCluster) {
    const eligible = (e) => Number.isFinite(e.metric?.value) && e.ranking?.eligible !== false;
    const scored = group.filter(eligible);
    const rest   = group.filter((e) => !eligible(e));
    scored.sort((a, b) =>
      direction === "lower" ? a.metric.value - b.metric.value : b.metric.value - a.metric.value
    );
    scored.forEach((e, i) => { e.rank = i + 1; });
    out.push(...scored, ...rest);
  }
  return out;
}

// Read a file committed in this repo, by repo-relative path. MFC uses it to
// hash-check contributed cases. null if missing, never reads outside the repo.
async function readRepo(rel) {
  const target = path.resolve(CWD, rel);
  if (target !== CWD && !target.startsWith(CWD + path.sep)) return null;
  try {
    return await fs.readFile(target, "utf8");
  } catch {
    return null;
  }
}

let history = { submitted: new Map(), completed: new Map(), available: false };

async function processSuite(suite, index, clusters, clusterName) {
  // output/<cluster>/<suite>/<group>/<run>, cluster comes from the path
  const root = path.join(SRC_ROOT, clusterName, suite.name);
  if (!(await exists(root))) return;

  const metricCfg = suite.cfg.metric || {};
  const runDirs = await findRunDirs(root);
  const entries = [];
  let fromResultJson = 0, fromParser = 0, unusable = 0;
  const clusterCounts = {};
  let mismatches = 0;

  for (const dir of runDirs) {
    const rel   = path.relative(root, dir);
    const parts = rel.split(path.sep);
    const group = parts[0] || "__root__";
    const run   = parts.slice(1).join("/") || "__root__";
    // cluster in the id so it stays unique across clusters
    const id    = [clusterName, suite.name, group, run].join("/");
    const files = await listFiles(dir);
    const read  = (f) => readSafe(path.join(dir, f));

    let result = null;

    // 1. result.json. HPL always parses stdout so the residual check can't be skipped
    if (files.includes("result.json") && !["HPL", "HPL_NVIDIA"].includes(suite.name)) {
      const raw = await read("result.json");
      try {
        const r = JSON.parse(raw);
        result = {
          metric: r.metric ?? null,
          secondary: r.secondary ?? [],
          parameters: r.parameters ?? null,
          verification: r.verification ?? null,
          convergence: r.convergence ?? null,
          config: r.config ?? {},
          provenance: r.provenance ?? {},
          status: r.status ?? "ok",
          ranking: r.ranking,
          notes: r.notes ?? [],
          detail: r.detail ?? null,
          rawFiles: files.filter((f) => f !== "result.json"),
        };
        fromResultJson++;
      } catch (e) {
        console.warn(`[collect] ${id}: result.json is not valid JSON (${e.message})`);
      }
    }

    // 2. suite's own parser, old runs have no result.json
    if (!result && suite.mod?.collect) {
      try {
        result = await suite.mod.collect({ dir, files, read, readRepo, suite: suite.cfg, cluster: clusters[clusterName] });
        if (result) fromParser++;
      } catch (e) {
        console.warn(`[collect] ${id}: collector threw (${e.message})`);
      }
    }

    if (!result) { unusable++; continue; }

    // cross-check the dir's cluster against node names in the output
    let inferText = "", inferScript = "";
    for (const f of files) {
      if (/\.(out|err)$/i.test(f)) inferText += ((await read(f)) || "").slice(0, 20000);
      else if (/\.sh$/i.test(f))   inferScript += ((await read(f)) || "").slice(0, 8000);
    }
    const observed = inferCluster({ clusters, text: inferText, script: inferScript, fallback: null });
    const ci = { cluster: clusterName, source: "path" };
    if (observed.cluster && observed.cluster !== clusterName) {
      console.warn(
        `[collect] ${id}: filed under ${clusterName} but its output names ${observed.cluster} nodes — ` +
        `check the directory it was committed to`
      );
      ci.source = "path (MISMATCH: output says " + observed.cluster + ")";
      mismatches++;
    } else if (observed.cluster === clusterName) {
      ci.source = "path (confirmed by output)";
    }
    clusterCounts[ci.source] = (clusterCounts[ci.source] || 0) + 1;

    const baseParts = [clusterName, suite.name, ...parts];
    const rawPaths = {};
    for (const f of result.rawFiles || []) {
      const dest = path.join(RAW_ROOT, ...baseParts, f);
      await ensureDir(path.dirname(dest));
      // no leading slash, the site is served under /ANUHPC-Leaderboard/
      try { await fs.copyFile(path.join(dir, f), dest); rawPaths[f] = path.posix.join("raw", ...baseParts, f); }
      catch { /* a missing artefact is not fatal */ }
    }

    const metric = result.metric
      ? { ...result.metric, unit: metricCfg.unit ?? "", label: metricCfg.label ?? result.metric.key,
          direction: metricCfg.direction ?? "higher" }
      : null;

    // date from the run itself if it wrote one, else the git commit that added it
    const ranAt = typeof result.ranAt === "string" ? result.ranAt : null;
    const gitAt = history.completed.get(id)?.at ?? null;
    const who = submitterOf(id, history);

    const runJson = {
      id, suite: suite.name, group, run,
      cluster: ci.cluster,
      clusterSource: ci.source,
      date: ranAt ?? gitAt,
      dateSource: ranAt ? "run" : gitAt ? "git" : null,
      submittedAt: who.at,
      // group folder is the entrant; benchmark/baseline/demo are "house" entries
      submitter: { name: who.name, house: who.house, by: who.by },
      metric,
      secondary: (result.secondary || []).map((s) => {
        const def = (suite.cfg.secondary || []).find((d) => d.key === s.key);
        return { ...s, unit: def?.unit ?? "", label: def?.label ?? s.key, direction: def?.direction ?? "none" };
      }),
      parameters: result.parameters ?? null,
      verification: result.verification ?? null,
      convergence: result.convergence ?? null,
      config: result.config || {},
      // HPL CPU: Rmax / Rpeak, null where the cluster has no peak specs
      efficiency: result.efficiency ?? null,
      provenance: result.provenance || {},
      status: result.status || "ok",
      ranking: result.ranking,
      notes: result.notes || [],
      raw: rawPaths,
      // --- backwards compatibility with the existing website ---
      best: result.detail?.best ?? null,
      dat: result.detail?.dat ?? null,
      job: result.detail?.job ?? null,
      out: result.detail?.out ?? null,
      err: result.detail?.err ?? null,
      detail: result.detail ?? null,
    };

    const runJsonPath = path.join(DATA_ROOT, "runs", ...baseParts, "run.json");
    await ensureDir(path.dirname(runJsonPath));
    await fs.writeFile(runJsonPath, JSON.stringify(runJson, null, 2));

    entries.push({
      id, suite: suite.name, group, run,
      cluster: ci.cluster,
      clusterSource: ci.source,
      // anything the tables show or sort on has to be in the index, not just run.json
      date: runJson.date,
      dateSource: runJson.dateSource,
      submittedAt: runJson.submittedAt,
      submitter: runJson.submitter,
      metric,
      secondary: runJson.secondary,
      parameters: runJson.parameters,
      verification: runJson.verification,
      convergence: runJson.convergence,
      config: runJson.config,
      efficiency: runJson.efficiency,
      status: runJson.status,
      ranking: runJson.ranking,
      notes: runJson.notes,
      // legacy fields the current site reads
      best: runJson.best,
      outSummary: result.detail?.out?.summary ?? null,
      hasErr: !!result.detail?.err?.size,
    });
  }

  const ranked = rank(entries, metricCfg.direction);
  index.push(...ranked);

  const scored = ranked.filter((e) => Number.isFinite(e.metric?.value)).length;
  console.log(
    `[collect] ${clusterName}/${suite.name}: ${runDirs.length} dirs -> ${entries.length} runs ` +
    `(${scored} scored, ${fromResultJson} via result.json, ${fromParser} parsed, ${unusable} unusable) ` +
    `ranked ${metricCfg.direction === "lower" ? "ascending" : "descending"} by ${metricCfg.key}`
  );
  if (mismatches) console.warn(`[collect] ${clusterName}/${suite.name}: ${mismatches} run(s) filed under the wrong cluster`);
}

async function main() {
  await ensureDir(DATA_ROOT);
  await ensureDir(RAW_ROOT);
  const clusters = await loadClusters(CWD);

  // one git pass for all dates and submitters, needs full history
  history = await loadRunHistory(CWD);
  console.log(`[collect] git history: ${history.commits} commit(s), ${history.completed.size} run(s) dated, ` +
              `${history.submitted.size} with a recorded submitter`);

  // if every git date is the same (shallow clone), drop them
  const warnings = historyWarnings(history);
  for (const w of warnings) console.warn(`[collect] WARNING: ${w}`);
  if (warnings.length) {
    console.warn("[collect] discarding git-derived dates; only self-timestamped runs will be dated");
    history = { ...history, completed: new Map(), submitted: new Map() };
  }
  if (!Object.keys(clusters).length) throw new Error("no clusters found under clusters/");
  console.log(`[collect] clusters: ${Object.keys(clusters).join(", ")}`);
  const suites = await loadSuites();
  if (!suites.length) throw new Error("no suites found under suites/");
  console.log(`[collect] suites: ${suites.map((s) => s.name).join(", ")}`);

  const index = [];
  for (const c of Object.keys(clusters)) {
    for (const s of suites) {
      if (Array.isArray(s.cfg.clusters) && s.cfg.clusters.length && !s.cfg.clusters.includes(c)) continue;
      await processSuite(s, index, clusters, c);
    }
  }

  const meta = {
    generatedAt: new Date().toISOString(),
    clusters: Object.values(clusters).map((c) => ({
      name: c.name, label: c.label, description: c.description,
      status: c.status, derived: c.derived,
      nodes: Object.keys(c.nodes).length,
      partitions: Object.keys(c.partitions),
      count: index.filter((e) => e.cluster === c.name).length,
    })),
    suites: suites.map((s) => ({
      name: s.name,
      description: s.cfg.description ?? "",
      metric: s.cfg.metric ?? null,
      reference: s.cfg.reference ?? null,
      // clusters this suite runs on, empty means all
      clusters: Array.isArray(s.cfg.clusters) && s.cfg.clusters.length
        ? s.cfg.clusters
        : Object.keys(clusters),
      // available: false means binaries aren't published yet
      available: s.cfg.available !== false,
      missing: s.cfg.missing ?? null,
      count: index.filter((e) => e.suite === s.name).length,
      // per-cluster counts for the tab badges
      countByCluster: Object.fromEntries(
        Object.keys(clusters).map((c) => [
          c, index.filter((e) => e.suite === s.name && e.cluster === c).length,
        ]),
      ),
    })),
    runs: index,
  };
  await fs.writeFile(path.join(DATA_ROOT, "index.json"), JSON.stringify(meta, null, 2));
  console.log(`[collect] wrote ${index.length} runs -> ${OUT_ROOT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
