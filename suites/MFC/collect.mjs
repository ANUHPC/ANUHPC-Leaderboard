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

export async function collect(ctx) {
  const { files, read } = ctx;

  const sumName  = files.find((f) => /^summary\.ya?ml$/i.test(f));
  const timeName = files.find((f) => /^time_data\.dat$/i.test(f));
  const caseName = files.find((f) => /^case\.py$/i.test(f));
  const outName  = files.find((f) => /\.out$/i.test(f));
  const errName  = files.find((f) => /\.err$/i.test(f));
  const jobName  = files.find((f) => /^job\.ya?ml$/i.test(f));

  const [sumRaw, timeRaw, caseRaw, outRaw, errRaw, jobRaw] = await Promise.all(
    [sumName, timeName, caseName, outName, errName, jobName]
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

  return {
    metric: grind != null ? { key: "grind", value: grind } : null,
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
      mfc_sha: job?.source?.pin ?? null,
    },
    provenance: {
      invocation: Array.isArray(summary?.invocation) ? summary.invocation.join(" ") : null,
      lock,
    },
    status: grind != null ? "ok" : "no-result",
    notes,
    detail: {
      summary,
      timeData: rows,
      case: caseRaw ? { file: caseName, raw: caseRaw } : null,
      out: outRaw ? { file: outName, size: outRaw.length } : null,
      err: errRaw ? { file: errName, size: errRaw.length } : null,
    },
    rawFiles: [caseName, sumName, timeName, outName, errName, jobName].filter(Boolean),
  };
}
