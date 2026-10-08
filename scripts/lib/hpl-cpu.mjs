// Static checks for CPU HPL.dat against the ranks run.sh starts.
// HPL.dat is positional, the labels are just comments.
// ranks is null if run.sh doesn't say.
export function validateCpuHpl(dat, ranks) {
  const errors = [], warnings = [];
  const integer = (v) => Number.isInteger(v) && v > 0;
  const lines = String(dat ?? '').trimEnd().split(/\r?\n/);
  const values = (i) => (lines[i] ?? '').trim().split(/\s+/).map(Number);
  if (values(3)[0] !== 6) errors.push('HPL.dat device out must be 6 so results are retained in run.out');
  const grids = values(9)[0], ps = values(10).slice(0, grids), qs = values(11).slice(0, grids);
  if (!integer(grids) || ps.length !== grids || qs.length !== grids || !ps.every(integer) || !qs.every(integer)) {
    errors.push('HPL.dat has invalid process grids');
  } else if (integer(ranks)) {
    const sizes = ps.map((p, j) => p * qs[j]);
    // HPL skips grids bigger than the rank count, smaller ones leave ranks idle
    if (sizes.every((s) => s > ranks)) errors.push(`every HPL.dat P × Q needs more than the ${ranks} MPI ranks run.sh starts; HPL would skip them all`);
    else if (sizes.some((s) => s > ranks)) warnings.push(`HPL.dat grids ${sizes.filter((s) => s > ranks).join(', ')} need more than ${ranks} ranks and will be skipped`);
    if (sizes.some((s) => s < ranks)) warnings.push(`HPL.dat P × Q of ${sizes.filter((s) => s < ranks).join(', ')} leaves some of the ${ranks} ranks idle`);
  }
  const threshold = values(12)[0];
  if (!Number.isFinite(threshold) || threshold <= 0) errors.push('HPL.dat must enable residual checking with a positive threshold; unchecked results are not ranked');
  return { errors, warnings };
}

// literal mpirun -np first, then the #SBATCH lines
export function cpuRanks(script, directive) {
  const np = /\bmpirun\b[^\n]*?\s(?:-np|-n|--np)[ =](\d+)\b/.exec(script);
  if (np) return Number(np[1]);
  const ntasks = Number(directive('ntasks'));
  if (Number.isInteger(ntasks) && ntasks > 0) return ntasks;
  const nodes = Number(directive('nodes') ?? 1), tpn = Number(directive('ntasks-per-node'));
  return Number.isInteger(nodes) && Number.isInteger(tpn) && nodes > 0 && tpn > 0 ? nodes * tpn : null;
}
