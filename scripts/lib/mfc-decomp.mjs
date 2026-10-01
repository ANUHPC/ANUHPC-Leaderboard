// Can MFC split this grid across this many ranks?
//
// same rule as src/common/m_mpi_common.fpp: cells/procs >= 5 * weno_order in
// every direction, otherwise pre_process aborts.

export const NUM_STCLS_MIN = 5;

export function mfcDecomposition(m, n, p, ranks, wenoOrder = 5) {
  const need = NUM_STCLS_MIN * wenoOrder;
  if (![m, n, p, ranks].every(Number.isInteger) || m < 1 || n < 0 || p < 0 || ranks < 1 || (n === 0 && p > 0)) {
    return { ok: null, need };
  }
  for (let px = 1; px <= ranks; px++) {
    if (ranks % px) continue;
    for (let py = 1; py <= ranks / px; py++) {
      if (n === 0 && py !== 1) continue;
      if ((ranks / px) % py) continue;
      const pz = ranks / (px * py);
      if (p === 0 && pz !== 1) continue;
      if ((m + 1) / px >= need && (n === 0 || (n + 1) / py >= need) && (p === 0 || (p + 1) / pz >= need)) {
        return { ok: true, split: `${px}x${py}x${pz}`, need };
      }
    }
  }
  return { ok: false, need };
}

// read m, n, p, weno_order out of case.py text without running it
export function gridFromCase(text) {
  if (typeof text !== "string" || !text) return { m: null, n: null, p: null, weno: 5 };
  const num = (k) => {
    const mm = new RegExp(`["']${k}["']\\s*:\\s*(-?[0-9]+)`).exec(text);
    return mm ? Number(mm[1]) : null;
  };
  return { m: num("m"), n: num("n"), p: num("p"), weno: num("weno_order") ?? 5 };
}
