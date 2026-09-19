// HPL result collector.
//
// Two sources, in priority order:
// Performance and residual verification always come from HPL stdout.
// A submitted result.json cannot bypass the numerical correctness check.
//
// Netlib, AOCL and NVIDIA output share result and residual records. Keep each
// result tied to its own residual: another candidate passing cannot validate
// a faster candidate that failed or never completed its check.

function firstToken(line) {
    const m = line.trim().match(/^(\S+)/);
    return m ? m[1] : "";
}

function numbersIn(line) {
    // capture ints/floats incl. scientific
    const re = /[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g;
    return (line.match(re) || []).map((s) => Number(s));
}

function intToken(line) {
    const t = firstToken(line);
    const n = Number(t);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

function floatToken(line) {
    const t = firstToken(line);
    const n = Number(t);
    return Number.isFinite(n) ? n : null;
}

function parseHplDat(raw) {
    const lines = raw.split(/\r?\n/);
    const out = {
        header: [],
        outputFilename: null,
        deviceOut: null,
        numProblemSizes: null,
        Ns: [],
        numNBs: null,
        NBs: [],
        pmap: null,
        numGrids: null,
        Ps: [],
        Qs: [],
        threshold: null,
        numPFACT: null,
        PFACTs: [],
        numNBMIN: null,
        NBMINs: [],
        numPanelsInRecursion: null,
        NDIVs: [],
        numRFACT: null,
        RFACTs: [],
        numBCAST: null,
        BCASTs: [],
        numDEPTH: null,
        DEPTHs: [],
        swapMode: null,
        swapThreshold: null,
        L1: null,
        U: null,
        equilibration: null,
        memoryAlignment: null,
    };

    // First 1-2 lines are often title/comments; keep as header up to 2 lines
    for (let i = 0; i < Math.min(lines.length, 2); i++) {
        if (lines[i].trim()) out.header.push(lines[i].trim());
    }

    for (const line of lines) {
        const l = line.trim();
        if (!l) continue;

        // Output file name
        if (!out.outputFilename && l.includes("output file name")) {
            out.outputFilename = firstToken(l);
            continue;
        }
        // Device out
        if (!out.deviceOut && l.includes("device out")) {
            out.deviceOut = intToken(l);
            continue;
        }
        // Number of problem sizes
        if (!out.numProblemSizes && l.includes("# of problems sizes")) {
            out.numProblemSizes = intToken(l);
            continue;
        }
        if (out.numProblemSizes && out.Ns.length === 0 && /\bNs\b/.test(l)) {
            out.Ns = numbersIn(l);
            continue;
        }
        // NBs
        if (!out.numNBs && l.includes("# of NBs")) {
            out.numNBs = intToken(l);
            continue;
        }
        if (out.numNBs && out.NBs.length === 0 && /\bNBs\b/.test(l)) {
            out.NBs = numbersIn(l);
            continue;
        }
        // PMAP
        if (out.pmap === null && /PMAP.*process mapping/i.test(l)) {
            out.pmap = intToken(l);
            continue;
        }
        // Process grids
        if (!out.numGrids && l.includes("# of process grids")) {
            out.numGrids = intToken(l);
            continue;
        }
        if (out.numGrids && out.Ps.length === 0 && /^\d+(\s+\d+)*/.test(l) &&
            /\bPs\b/.test(l)) {
            out.Ps = numbersIn(l);
            continue;
        }
        if (out.numGrids && out.Qs.length === 0 && /^\d+(\s+\d+)*/.test(l) &&
            /\bQs\b/.test(l)) {
            out.Qs = numbersIn(l);
            continue;
        }
        // Threshold (not swapping threshold)
        if (out.threshold === null &&
            /threshold/i.test(l) &&
            !/swapping threshold/i.test(l)) {
            out.threshold = floatToken(l);
            continue;
        }
        // PFACT
        if (!out.numPFACT && /# of panel fact/i.test(l)) {
            out.numPFACT = intToken(l);
            continue;
        }
        if (out.numPFACT && out.PFACTs.length === 0 && /PFACTs/i.test(l)) {
            out.PFACTs = numbersIn(l);
            continue;
        }
        // NBMIN
        if (!out.numNBMIN && /# of recursive stopping criterium/i.test(l)) {
            out.numNBMIN = intToken(l);
            continue;
        }
        if (out.numNBMIN && out.NBMINs.length === 0 && /NBMINs/i.test(l)) {
            out.NBMINs = numbersIn(l);
            continue;
        }
        // Panels in recursion
        if (out.numPanelsInRecursion === null &&
            /# of panels in recursion/i.test(l)) {
            out.numPanelsInRecursion = intToken(l);
            continue;
        }
        // NDIVs
        if (out.NDIVs.length === 0 && /\bNDIVs\b/i.test(l)) {
            out.NDIVs = numbersIn(l);
            continue;
        }
        // RFACT
        if (!out.numRFACT && /# of recursive panel fact/i.test(l)) {
            out.numRFACT = intToken(l);
            continue;
        }
        if (out.numRFACT && out.RFACTs.length === 0 && /RFACTs/i.test(l)) {
            out.RFACTs = numbersIn(l);
            continue;
        }
        // BCAST
        if (!out.numBCAST && /# of broadcast/i.test(l)) {
            out.numBCAST = intToken(l);
            continue;
        }
        if (out.numBCAST && out.BCASTs.length === 0 && /BCASTs/i.test(l)) {
            out.BCASTs = numbersIn(l);
            continue;
        }
        // DEPTHs
        if (!out.numDEPTH && /# of lookahead depth/i.test(l)) {
            out.numDEPTH = intToken(l);
            continue;
        }
        if (out.numDEPTH && out.DEPTHs.length === 0 && /DEPTHs/i.test(l)) {
            out.DEPTHs = numbersIn(l);
            continue;
        }
        // SWAP
        if (out.swapMode === null && /\bSWAP\b/.test(l)) {
            out.swapMode = intToken(l);
            continue;
        }
        if (out.swapThreshold === null && /swapping threshold/i.test(l)) {
            out.swapThreshold = intToken(l);
            continue;
        }
        // L1/U/equil/memory alignment
        if (out.L1 === null && /L1 .*form/i.test(l)) {
            out.L1 = intToken(l);
            continue;
        }
        if (out.U === null && /\bU\s+.*form/i.test(l)) {
            out.U = intToken(l);
            continue;
        }
        if (out.equilibration === null && /Equilibration/i.test(l)) {
            out.equilibration = intToken(l);
            continue;
        }
        if (out.memoryAlignment === null && /memory alignment/i.test(l)) {
            out.memoryAlignment = intToken(l);
            continue;
        }
    }

    return out;
}

function parseSbatch(shRaw) {
    const sb = {};
    const numeric = new Set(["nodes", "ntasks", "ntasks-per-node", "cpus-per-task"]);
    for (const line of shRaw.split(/\r?\n/)) {
        // Both --nodes=2 and --nodes 2 occur in submitted scripts. A trailing
        // shell comment is not part of the value; never publish NaN resources.
        const m = line.match(/^\s*#SBATCH\s+--([^=\s]+)(?:[=\s]+([^#]*))?/);
        if (!m) continue;
        const key = m[1];
        const val = (m[2] || "").trim();
        sb[key] = numeric.has(key)
            ? (/^\d+$/.test(val) && Number.isSafeInteger(Number(val)) && Number(val) > 0 ? Number(val) : null)
            : val || true;
    }
    return sb;
}

function normalizeOutput(raw) {
    // Open MPI --tag-output prefixes every line, including the numeric row.
    // Strip only its known transport wrapper, not arbitrary bracketed content.
    return raw.replace(/^\s*\[\d+,\d+\]<(?:stdout|stderr)>:\s?/gm, "");
}

function parseOutCpu(raw) {
  const lines = raw.split(/\r?\n/);
  const runs = [];
  let cur = null;

  // Flexible run line matcher:
  //  - optional SWP column between T/V and N
  //  - supports various spacing & E-notation floats
  const tvRe =
    /^\s*(W[RC]\S*)\s+(?:\S+\s+)?(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s+([0-9.eE+\-]+)\s+([0-9.eE+\-]+)(?:\s+\(\s*([0-9.eE+\-]+)\s*\))?\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];

    const m = l.match(tvRe);
    if (m) {
      // shift indexes depending on optional "SWP"
      // The pattern above tolerates an optional unknown token,
      // so indices 2..7 are always numeric columns
      if (cur) runs.push(cur);
      cur = {
        tv: m[1],
        N: Number(m[2]),
        NB: Number(m[3]),
        P: Number(m[4]),
        Q: Number(m[5]),
        timeSec: Number(m[6]),
        gflops: Number(m[7]),
        ...(m[8] ? { gflopsPerGpu: Number(m[8]) } : {}),
        startTime: null,
        endTime: null,
        residual: null,
        residualPassed: null,
      };
      continue;
    }

    // A malformed candidate still ends the previous candidate. Its later
    // PASSED line must never validate the preceding, incomplete result.
    if (/^\s*W[RC]\S*\s+/.test(l)) {
      if (cur) runs.push(cur);
      cur = null;
      continue;
    }

    if (cur) {
      const s = l.match(/HPL_pdgesv\(\)\s+start time\s+(.+)/);
      if (s) cur.startTime = s[1].trim();
      const e = l.match(/HPL_pdgesv\(\)\s+end time\s+(.+)/);
      if (e) cur.endTime = e[1].trim();
      const r = l.match(
        /\|\|Ax-b\|\|_oo.*=\s*(\S+).*?\b(PASSED|FAILED)\b/i
      );
      if (r) {
        cur.residual = Number(r[1]);
        cur.residualPassed = r[2].toUpperCase() === "PASSED" && Number.isFinite(cur.residual) && cur.residual >= 0;
        if (!Number.isFinite(cur.residual)) cur.residual = null;
      }
    }
  }
  if (cur) runs.push(cur);

  // Summary extraction (still compatible with old format)
  const summary = {
    testsTotal: null,
    testsPassed: null,
    testsFailed: null,
    testsSkipped: null,
  };
  
  // AOCL and standard variants both use a similar summary wording
  const m = raw.match(
    /Finished\s+(\d+)\s+tests[\s\S]*?(\d+)\s+tests\s+completed\s+and\s+passed[\s\S]*?(\d+)\s+tests\s+completed\s+and\s+failed[\s\S]*?(\d+)\s+tests\s+skipped/i
  );
  if (m) {
    summary.testsTotal = Number(m[1]);
    summary.testsPassed = Number(m[2]);
    summary.testsFailed = Number(m[3]);
    summary.testsSkipped = Number(m[4]);
  } else {
    // fallback for AOCL phrasing like:
    // "18 tests completed and passed residual checks"
    const aocl = raw.match(
      /(\d+)\s+tests\s+completed\s+and\s+passed\s+residual[\s\S]*?(\d+)\s+tests\s+completed\s+and\s+failed[\s\S]*?(\d+)\s+tests\s+skipped/i
    );
    if (aocl) {
      summary.testsTotal =
        Number(aocl[1]) + Number(aocl[2]) + Number(aocl[3]);
      summary.testsPassed = Number(aocl[1]);
      summary.testsFailed = Number(aocl[2]);
      summary.testsSkipped = Number(aocl[3]);
    }
  }

  return { runs, summary };
}

function parseOutNvidia(raw) {
    const lines = raw.split(/\r?\n/);
    const parsed = parseOutCpu(raw);
    const deviceInfo = {};
    const memInfo = { DEVICE: {}, HOST: {} };
    const traces = [];
    let section = null;

    for (const l of lines) {
        if (/--- DEVICE INFO ---/.test(l)) {
            section = "DEVICE_INFO";
            continue;
        }
        if (/--- MEMORY INFO ---/.test(l)) {
            section = "MEM_INFO";
            continue;
        }
        if (/^DEVICE\s*$/.test(l)) {
            section = "MEM_DEVICE";
            continue;
        }
        if (/^HOST\s*$/.test(l)) {
            section = "MEM_HOST";
            continue;
        }
        if (/^\[HPL TRACE\]/.test(l)) {
            traces.push(l.trim());
            continue;
        }

        if (section === "DEVICE_INFO") {
            const p = l.match(/Peak clock frequency:\s+(\d+)\s*MHz/i);
            if (p) deviceInfo.peakClockMHz = Number(p[1]);
            const sm = l.match(/SM version\s*:\s*(\d+)/i);
            if (sm) deviceInfo.smVersion = Number(sm[1]);
            const nsm = l.match(/Number of SMs\s*:\s*(\d+)/i);
            if (nsm) deviceInfo.numSms = Number(nsm[1]);
        }

        if (section === "MEM_DEVICE" || section === "MEM_HOST") {
            const mm = l.match(
                /^\s*(System|HPL buffers|Used|Total)\s*=\s*([0-9.]+)\s*GiB\s*\(MIN\)\s*([0-9.]+)\s*GiB\s*\(MAX\)\s*([0-9.]+)\s*GiB\s*\(AVG\)/
            );
            if (mm) {
                const key = mm[1];
                const rec = {
                    minGiB: Number(mm[2]),
                    maxGiB: Number(mm[3]),
                    avgGiB: Number(mm[4]),
                };
                if (section === "MEM_DEVICE") memInfo.DEVICE[key] = rec;
                else memInfo.HOST[key] = rec;
            }
        }
    }

    const best = bestFromRuns(parsed.runs);
    return {
        ...parsed,
        deviceInfo,
        memInfo,
        traces,
        // Backwards-compatible overview fields, always from the same result.
        startTime: best?.startTime ?? null,
        endTime: best?.endTime ?? null,
        residual: best?.residual ?? null,
        residualPassed: best?.residualPassed ?? null,
    };
}

// "Wed Apr  1 01:42:05 2026" -> "2026-04-01T01:42:05.000Z", or null if the
// line was absent or unparseable. Date.parse handles asctime, but returns NaN
// rather than throwing, so the result has to be checked.
function toIso(asctime) {
  if (typeof asctime !== "string" || !asctime.trim()) return null;
  const t = Date.parse(asctime.trim() + " UTC");
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function bestFromRuns(runs) {
    const usable = (runs || []).filter((r) =>
        Number.isFinite(r.gflops) && r.gflops > 0 &&
        Number.isFinite(r.timeSec) && r.timeSec >= 0 &&
        [r.N, r.NB, r.P, r.Q].every((n) => Number.isSafeInteger(n) && n > 0));
    if (!usable.length) return null;
    return usable.reduce((best, r) => r.gflops > best.gflops ? r : best);

}

// --- suite interface -------------------------------------------------------

export const name = "HPL";

/**
 * @param {{dir:string, files:string[], read:(f:string)=>Promise<string|null>}} ctx
 * @returns {Promise<object|null>} normalised result, or null if nothing usable
 */
export async function collect(ctx) {
  const { files, read } = ctx;

  const datName = files.find((f) => /^HP[LT]\.dat$/i.test(f));
  const shName  = files.find((f) => /\.sh$/i.test(f));
  const outName = files.find((f) => /\.out$/i.test(f)) || files.find((f) => /out/i.test(f));
  const errName = files.find((f) => /\.err$/i.test(f)) || files.find((f) => /err/i.test(f));

  const [datRaw, shRaw, outRaw, errRaw] = await Promise.all(
    [datName, shName, outName, errName].map((f) => (f ? read(f) : Promise.resolve(null)))
  );

  if (!datRaw && !outRaw && !shRaw) return null;

  const dat    = datRaw ? parseHplDat(datRaw) : null;
  const sbatch = shRaw ? parseSbatch(shRaw) : null;

  // The NVIDIA container prints an extra per-GPU column; pick the parser by
  // which shape the file actually has, not by directory name.
  const normalizedOut = outRaw ? normalizeOutput(outRaw) : "";
  const isNvidia = !!outRaw && /--- DEVICE INFO ---|gflopsPerGpu|\(\s*[0-9.eE+\-]+\s*\)\s*$/m.test(normalizedOut);
  const parsed   = outRaw ? (isNvidia ? parseOutNvidia(normalizedOut) : parseOutCpu(normalizedOut)) : null;
  const best     = parsed ? bestFromRuns(parsed.runs) : null;

  const passed = best?.residualPassed ?? null;
  const status = !best ? "no-result" : passed === true ? "ok"
    : passed === false ? "failed-residual" : "unverified-residual";

  return {
    metric: best?.gflops != null ? { key: "gflops", value: best.gflops } : null,
    secondary: [
      best?.timeSec != null ? { key: "time", value: best.timeSec } : null,
      best?.residual != null ? { key: "residual", value: best.residual } : null,
    ].filter(Boolean),
    config: {
      N: best?.N ?? dat?.Ns?.[0] ?? null,
      NB: best?.NB ?? dat?.NBs?.[0] ?? null,
      P: best?.P ?? dat?.Ps?.[0] ?? null,
      Q: best?.Q ?? dat?.Qs?.[0] ?? null,
      variant: isNvidia ? "nvidia" : "cpu",
      nodes: sbatch?.nodes ?? null,
      tasks_per_node: sbatch?.["ntasks-per-node"] ?? null,
      cpus_per_task: sbatch?.["cpus-per-task"] ?? null,
      partition: sbatch?.partition ?? null,
    },
    provenance: { started: best?.startTime ?? null,
                  ended: best?.endTime ?? null },
    // When the run happened, as the run itself reports it. HPL prints
    // "HPL_pdgesv() start time Wed Apr  1 01:42:05 2026" in C asctime format,
    // which has no timezone -- it is local to the cluster that ran it, and is
    // read as UTC here because that is the only consistent choice available.
    // Present in 73 of 132 Raijin runs; the rest failed before reaching it and
    // are dated from git history instead.
    ranAt: toIso(best?.startTime ?? null),
    status,
    ranking: {
      eligible: status === "ok",
      reason: status === "ok" ? null : status === "failed-residual"
        ? "Fastest result failed its residual check"
        : status === "unverified-residual" ? "Fastest result has no verified residual check"
        : "No valid performance result",
    },
    detail: {
      dat: datRaw ? { raw: datRaw, parsed: dat, file: datName } : null,
      job: shRaw ? { raw: shRaw, sbatch, file: shName } : null,
      out: parsed ? { file: outName, ...parsed } : null,
      err: errRaw ? { file: errName, size: errRaw.length } : null,
      best,
    },
    rawFiles: [datName, shName, outName, errName].filter(Boolean),
  };
}
