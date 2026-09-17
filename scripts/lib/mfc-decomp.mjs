// Can MFC split this grid across this many ranks?
//
// MFC refuses to start if it cannot. src/common/m_mpi_common.fpp searches
// factorisations of num_procs and requires, in every direction,
//
//     cells_in_direction / procs_in_direction >= num_stcls_min * recon_order
//
// with num_stcls_min = 5 (src/common/m_constants.fpp) and recon_order the WENO
// order — so 25 cells per rank per direction at WENO5. When no factorisation
// works it aborts in pre_process with
//
//     Unsupported combination of values of num_procs, m, n, p and
//     weno/muscl/igr_order
//
// which arrives only after the job has queued, waited and started. Checking it
// when the job is filed costs nothing.
//
// Lives in its own module rather than inside validate-job.mjs because that
// script runs and exits on import, so anything defined there cannot be tested.

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

// Pull the grid out of a case.py. MFC cases are Python that print a JSON dict,
// so the values are plain "key": number pairs. Running the file would need
// MFC's own environment, and this only has to read four integers.
export function gridFromCase(text) {
  if (typeof text !== "string" || !text) return { m: null, n: null, p: null, weno: 5 };
  const num = (k) => {
    const mm = new RegExp(`["']${k}["']\\s*:\\s*(-?[0-9]+)`).exec(text);
    return mm ? Number(mm[1]) : null;
  };
  return { m: num("m"), n: num("n"), p: num("p"), weno: num("weno_order") ?? 5 };
}
