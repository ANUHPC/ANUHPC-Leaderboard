// Suite-agnostic leaderboard collector.
//
// Replaces the HPL-only scripts/collect-hpl.js. Walks every enabled suite under
// suites/, delegates parsing to that suite's collect.mjs, and writes the same
// output tree the website already consumes:
//
//   /tmp/hpl-website-data/data/index.json
//   /tmp/hpl-website-data/data/runs/<cluster>/<suite>/<group>/<run>/run.json
//   /tmp/hpl-website-data/raw/<suite>/<group>/<run>/<files>
//
// The index keeps every field the current site reads (best, outSummary, hasErr)
// and ADDS metric/config/provenance. That is deliberate: the site keeps working
// unchanged, and can start reading metric.direction whenever it is ready.
//
// Ranking is per suite and honours metric.direction, because HPL wants the
// largest number and MFC wants the smallest.

import fs from "fs/promises";
import path from "path";
import { parseYaml } from "./lib/yaml.mjs";
import { loadClusters, inferCluster } from "./lib/cluster.mjs";

const CWD       = process.cwd();
const SUITE_DIR = path.join(CWD, "suites");
const SRC_ROOT  = path.join(CWD, "output");
const OUT_ROOT  = process.env.WEBSITE_DATA_DIR || "/tmp/hpl-website-data";
const DATA_ROOT = path.join(OUT_ROOT, "data");
const RAW_ROOT  = path.join(OUT_ROOT, "raw");
// Every run committed before Xenon existed came from Raijin. Used only when a
// run leaves no node name anywhere to infer from.
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

// A directory is a run if it holds any recognisable run artefact. Kept broad on
// purpose: the legacy tree has inconsistent naming.
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

// Rank within each cluster separately: a Raijin number and a Xenon number
// measure different hardware and are not comparable.
function rank(entries, direction) {
  const byCluster = new Map();
  for (const e of entries) {
    const k = e.cluster || "__unknown__";
    if (!byCluster.has(k)) byCluster.set(k, []);
    byCluster.get(k).push(e);
  }
  const out = [];
  for (const [, group] of byCluster) {
    const scored = group.filter((e) => Number.isFinite(e.metric?.value));
    const rest   = group.filter((e) => !Number.isFinite(e.metric?.value));
    scored.sort((a, b) =>
      direction === "lower" ? a.metric.value - b.metric.value : b.metric.value - a.metric.value
    );
    scored.forEach((e, i) => { e.rank = i + 1; });
    out.push(...scored, ...rest);
  }
  return out;
}

async function processSuite(suite, index, clusters, clusterName) {
  // Layout is output/<cluster>/<suite>/<group>/<run>. The cluster is part of
  // the path now, so it is read rather than inferred — inference survives only
  // as a cross-check against what the run actually reported.
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
    // Cluster leads the id: two clusters can legitimately hold a run with the
    // same suite/group/run name, and ids must stay unique across the board.
    const id    = [clusterName, suite.name, group, run].join("/");
    const files = await listFiles(dir);
    const read  = (f) => readSafe(path.join(dir, f));

    let result = null;

    // 1. result.json, written by the job epilogue — authoritative.
    if (files.includes("result.json")) {
      const raw = await read("result.json");
      try {
        const r = JSON.parse(raw);
        result = {
          metric: r.metric ?? null,
          secondary: r.secondary ?? [],
          config: r.config ?? {},
          provenance: r.provenance ?? {},
          status: r.status ?? "ok",
          notes: r.notes ?? [],
          detail: r.detail ?? null,
          rawFiles: files.filter((f) => f !== "result.json"),
        };
        fromResultJson++;
      } catch (e) {
        console.warn(`[collect] ${id}: result.json is not valid JSON (${e.message})`);
      }
    }

    // 2. Fall back to the suite's parser. This is what keeps every historical
    //    run rendering — they all predate result.json.
    if (!result && suite.mod?.collect) {
      try {
        result = await suite.mod.collect({ dir, files, read });
        if (result) fromParser++;
      } catch (e) {
        console.warn(`[collect] ${id}: collector threw (${e.message})`);
      }
    }

    if (!result) { unusable++; continue; }

    // The directory says which cluster this is. Cross-check it against the node
    // names the run actually reported: a mismatch means the run was filed under
    // the wrong cluster, which would silently corrupt the board.
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

    // Copy the raw artefacts the site links to.
    const baseParts = [clusterName, suite.name, ...parts];
    const rawPaths = {};
    for (const f of result.rawFiles || []) {
      const dest = path.join(RAW_ROOT, ...baseParts, f);
      await ensureDir(path.dirname(dest));
      // No leading slash: the site is served from /ANUHPC-Leaderboard/, so an
      // absolute "/raw/..." resolves to the domain root and 404s. Keep these
      // relative and let the page prefix import.meta.env.BASE_URL.
      try { await fs.copyFile(path.join(dir, f), dest); rawPaths[f] = path.posix.join("raw", ...baseParts, f); }
      catch { /* a missing artefact is not fatal */ }
    }

    const metric = result.metric
      ? { ...result.metric, unit: metricCfg.unit ?? "", label: metricCfg.label ?? result.metric.key,
          direction: metricCfg.direction ?? "higher" }
      : null;

    const runJson = {
      id, suite: suite.name, group, run,
      cluster: ci.cluster,
      clusterSource: ci.source,
      metric,
      secondary: (result.secondary || []).map((s) => {
        const def = (suite.cfg.secondary || []).find((d) => d.key === s.key);
        return { ...s, unit: def?.unit ?? "", label: def?.label ?? s.key, direction: def?.direction ?? "none" };
      }),
      config: result.config || {},
      provenance: result.provenance || {},
      status: result.status || "ok",
      notes: result.notes || [],
      raw: rawPaths,
      // --- backwards compatibility with the existing website ---
      best: result.detail?.best ?? (metric ? { gflops: metric.value } : null),
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
      metric,
      secondary: runJson.secondary,
      config: runJson.config,
      status: runJson.status,
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
      // Which clusters this suite runs on, so the site can tell "no entries
      // yet" apart from "not offered here" -- HPL_NVIDIA needs GPUs and only
      // exists on Xenon. Empty/absent in suite.yml means every cluster.
      clusters: Array.isArray(s.cfg.clusters) && s.cfg.clusters.length
        ? s.cfg.clusters
        : Object.keys(clusters),
      // available:false means the binaries are not published yet; the board
      // should say so rather than showing a silently empty table.
      available: s.cfg.available !== false,
      missing: s.cfg.missing ?? null,
      count: index.filter((e) => e.suite === s.name).length,
      // Per-cluster counts drive the suite tab badges.
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
