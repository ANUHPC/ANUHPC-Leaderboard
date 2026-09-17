// MFC result collector.
//
// Unlike HPL, MFC emits a machine-readable result itself, so there is no
// stdout scraping. Two files matter, both written by MFC:
//
//   summary.yaml    written by run_epilogue in toolchain/templates/include/
//                   helpers.mako. Per target:  exec (seconds) and, for
//                   simulation, grind. ONLY produced if the batch template
//                   calls the helper macros — a hand-rolled sbatch silently
//                   yields no result at all.
//
//   time_data.dat   written by rank 0 at the end of simulation
//                   (src/simulation/m_start_up.fpp). Columns:
//                       Ranks | s/step | ns/gp/eq/rhs
//                   It APPENDS if the file already exists, so a re-run in a
//                   dirty case directory leaves several rows. MFC's own
//                   epilogue takes the last one; we do the same, and flag it.

import { parseYaml } from "../../scripts/lib/yaml.mjs";
import { createHash } from "node:crypto";

export const name = "MFC";

// "Ranks  s/step  ns/gp/eq/rhs" — header line, then one row per run.
function parseTimeData(raw) {
  const rows = [];
  for (const line of String(raw).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^Ranks/i.test(t)) continue;
    const n = t.split(/\s+/).map(Number);
    if (n.length >= 3 && n.every((v) => Number.isFinite(v))) {
      rows.push({ ranks: n[0], sPerStep: n[1], grind: n[2] });
    }
  }
  return rows;
}

// MFC's stdout is long but highly structured, so it is parsed rather than
// embedded. A 3000-step run writes one progress line per step -- 399 KB and
// 3137 lines at the largest measured here -- and putting that raw into every
// run.json would add megabytes to the data the site downloads. HPL can embed
// its stdout because HPL's is 3.6 KB.
//
// Four things are worth lifting out:
//   * the banner MFC prints  (partition, nodes, walltime, engine)
//   * the environment line our own template echoes (host, mpirun, fabric) --
//     this is what shows a GPU run really used the A100s and InfiniBand
//   * the per-step timing series, downsampled, so the run can be charted
//   * the closing block (total time, exit code)
export function parseMfcOut(raw) {
  const text = String(raw);
  const lines = text.split(/\r?\n/);

  // "| * Start-time     08:32:01    * Start-date   08:32:01   |" — two
  // key/value pairs per row inside MFC's box drawing.
  const banner = {};
  for (const line of lines) {
    if (!line.startsWith("|")) continue;
    for (const m of line.matchAll(/\*\s+([A-Za-z][A-Za-z\- ]*?)\s{2,}([^*|]+?)\s{2,}/g)) {
      const k = m[1].trim().toLowerCase().replace(/[\s-]+/g, "_");
      const v = m[2].trim();
      if (k && v && v !== "N/A" && !(k in banner)) banner[k] = v;
    }
  }

  // Emitted by suites/MFC/xenon.mako, not by MFC itself.
  const one = (re) => { const m = text.match(re); return m ? m[1].trim() : null; };
  const env = {
    host: one(/^host\s*:\s*(.+)$/m),
    nodesTasks: one(/^nodes\/tasks\s*:\s*(.+)$/m),
    mpirun: one(/^mpirun\s*:\s*(.+)$/m),
    fabric: one(/^fabric\s*:\s*(.+)$/m),
  };

  // " [ 24%]  Time step  6 of 21 @ t_step = 5 Time Avg = 1.07E+00 Time/step= 1.08E+00 ETA (HH:MM:SS) = 0:00:16"
  const steps = [];
  for (const line of lines) {
    const m = line.match(
      /\[\s*(\d+)%\]\s+Time step\s+(\d+)\s+of\s+(\d+).*?Time Avg\s*=\s*([0-9.eE+-]+)\s+Time\/step=\s*([0-9.eE+-]+)/
    );
    if (m) {
      steps.push({
        step: Number(m[2]),
        total: Number(m[3]),
        avg: Number(m[4]),
        perStep: Number(m[5]),
      });
    }
  }
  // Downsample: a chart needs shape, not 3000 points.
  const MAX = 120;
  const series = steps.length > MAX
    ? steps.filter((_, i) => i % Math.ceil(steps.length / MAX) === 0 || i === steps.length - 1)
    : steps;

  const perf = text.match(/Performance:\s+([0-9.eE+-]+)\s+ns\/gp\/eq\/rhs/);
  const total = text.match(/Total-time:\s*(\d+)s/);
  const exit = text.match(/Exit Code:\s*(\d+)/);

  return {
    banner,
    env,
    steps: series,
    stepCount: steps.length,
    performance: perf ? Number(perf[1]) : null,
    totalTimeSec: total ? Number(total[1]) : null,
    exitCode: exit ? Number(exit[1]) : null,
    lines: lines.length,
  };
}

// First and last few lines, so the modal can show the real text without
// carrying the whole log.
export function excerpt(raw, head = 24, tail = 28) {
  const lines = String(raw).split(/\r?\n/);
  if (lines.length <= head + tail) return { head: lines, tail: [], elided: 0 };
  return {
    head: lines.slice(0, head),
    tail: lines.slice(-tail),
    elided: lines.length - head - tail,
  };
}

export async function collect(ctx) {
  const { files, read, suite } = ctx;

  const sumName  = files.find((f) => /^summary\.ya?ml$/i.test(f));
  const timeName = files.find((f) => /^time_data\.dat$/i.test(f));
  const caseName = files.find((f) => /^case\.py$/i.test(f));
  const outName  = files.find((f) => /\.out$/i.test(f));
  const errName  = files.find((f) => /\.err$/i.test(f));
  const jobName  = files.find((f) => /^job\.ya?ml$/i.test(f));
  // harvest.mjs renames MFC's mfc-<run>.sh to run.sh; older results still carry
  // the original name, so accept either.
  const shName   = files.find((f) => /^run\.sh$/i.test(f)) ?? files.find((f) => /\.sh$/i.test(f) && !/environment/i.test(f));

  const [sumRaw, timeRaw, caseRaw, outRaw, errRaw, jobRaw, shRaw] = await Promise.all(
    [sumName, timeName, caseName, outName, errName, jobName, shName]
      .map((f) => (f ? read(f) : Promise.resolve(null)))
  );

  if (!sumRaw && !timeRaw) return null;

  let summary = null;
  try { summary = sumRaw ? parseYaml(sumRaw) : null; } catch { summary = null; }

  const sim = summary?.simulation ?? null;
  const pre = summary?.pre_process ?? null;
  const rows = timeRaw ? parseTimeData(timeRaw) : [];
  const last = rows.length ? rows[rows.length - 1] : null;

  // Prefer the summary's grind (that is what MFC itself reports); fall back to
  // the raw table if the epilogue did not manage to write the summary.
  const grind = Number.isFinite(sim?.grind) ? sim.grind : (last?.grind ?? null);
  const exec  = Number.isFinite(sim?.exec) ? sim.exec : null;

  const usedSummary = Number.isFinite(sim?.grind);
  const notes = [];
  if (rows.length > 1) {
    notes.push(
      `time_data.dat holds ${rows.length} rows — it appends across runs. ` +
      (usedSummary
        ? `Scored summary.yaml (${sim.grind} ns); the table's last row is ${last.grind} ns.`
        : `Scored its last row (${last.grind} ns).`) +
      " A clean per-run directory avoids the ambiguity."
    );
    if (usedSummary && last && Math.abs(sim.grind - last.grind) > 1e-9) {
      notes.push(
        `summary.yaml (${sim.grind}) and the last table row (${last.grind}) disagree — ` +
        "the case directory was reused. Treat this result as unreliable."
      );
    }
  }
  if (!sumRaw && timeRaw) {
    notes.push("No summary.yaml: the batch template probably did not call MFC's helper macros.");
  }

  const job = jobRaw ? (() => { try { return parseYaml(jobRaw); } catch { return null; } })() : null;
  const lock = summary?.lock ?? {};
  let provenance = {}, completion = {};
  try { provenance = JSON.parse(await read("mfc-provenance.json")); } catch { /* legacy result */ }
  try { completion = parseYaml(await read("mfc-status.yml")) ?? {}; } catch { /* legacy result */ }
  const successful = completion.state === "COMPLETED" && Number.isFinite(grind) && grind > 0;
  const pinned = provenance.case_source === "pinned" &&
    provenance.mfc_sha?.startsWith(suite?.source?.pin ?? "INVALID") &&
    suite?.cases?.some((c) => c.slug === job?.case) && provenance.case === job?.case &&
    provenance.case_sha256 === createHash("sha256").update(caseRaw ?? "").digest("hex");
  const ranking = {
    eligible: Boolean(successful && pinned),
    reason: !successful ? "Run has no verified successful completion" :
      !pinned ? "Custom or unverified case — unranked" : "Pinned benchmark case",
    group: `${job?.case ?? "custom"}/${job?.build?.gpu === "acc" ? "GPU" : "CPU"}`,
  };

  return {
    metric: Number.isFinite(grind) && grind > 0 ? { key: "grind", value: grind } : null,
    ranking,
    secondary: [
      exec != null ? { key: "exec", value: exec } : null,
      last?.sPerStep != null ? { key: "s_step", value: last.sPerStep } : null,
      last?.ranks != null ? { key: "ranks", value: last.ranks } : null,
    ].filter(Boolean),
    config: {
      case: job?.case ?? null,
      nodes: job?.resources?.nodes ?? null,
      tasks_per_node: job?.resources?.tasks_per_node ?? null,
      ranks: last?.ranks ?? null,
      partition: job?.resources?.partition ?? null,
      gpu: job?.build?.gpu ?? lock?.gpu ?? "none",
      case_optimization: job?.build?.case_optimization ?? null,
      gbpp: job?.tuning?.gbpp ?? null,
      toolchain: job?.build?.toolchain ?? null,
      mfc_sha: provenance.mfc_sha ?? null,
    },
    provenance: {
      ...provenance,
      invocation: Array.isArray(summary?.invocation) ? summary.invocation.join(" ") : null,
      lock,
    },
    status: completion.state === "FAILED" ? "failed" : successful ? "ok" : "no-result",
    notes,
    detail: {
      summary,
      timeData: rows,
      // Small enough to carry whole: the case is what defines the run, and the
      // batch script is what actually ran. Largest measured: 8.6 KB and 7.8 KB.
      case:   caseRaw ? { file: caseName, raw: caseRaw } : null,
      script: shRaw   ? { file: shName,   raw: shRaw   } : null,
      // stdout is parsed, not embedded -- see parseMfcOut. The excerpt gives
      // the modal real text to show; the full file stays one link away.
      out: outRaw ? {
        file: outName,
        size: outRaw.length,
        parsed: parseMfcOut(outRaw),
        excerpt: excerpt(outRaw),
      } : null,
      // stderr is small (8.8 KB at most) and is where a failure explains
      // itself, so it is carried in full.
      err: errRaw ? { file: errName, size: errRaw.length, raw: errRaw } : null,
    },
    rawFiles: [caseName, sumName, timeName, outName, errName, jobName, shName,
      ...files.filter((f) => /\.(png|mp4)$/i.test(f)),
      ...["mfc-provenance.json", "mfc-status.yml"].filter((f) => files.includes(f))].filter(Boolean),
  };
}
