// Static checks for the supported native NVIDIA HPL submission shape.
// HPL.dat is positional; labels/comments are explanatory, not syntax.
export function validateGpuHpl(dat, directive, cluster) {
  const errors = [];
  const integer = (v) => Number.isInteger(v) && v > 0;
  const nodes = Number(directive('nodes'));
  const tasks = Number(directive('ntasks-per-node'));
  const gres = /^gpu(?::[a-zA-Z0-9_-]+)?:(\d+)$/.exec(directive('gres') ?? '');
  const gpus = gres ? Number(gres[1]) : 0;
  const part = cluster?.partitions?.[directive('partition')];
  if (directive('partition') !== 'gpu') errors.push('HPL_NVIDIA requires the gpu partition');
  if (!integer(nodes) || !integer(tasks)) errors.push('set positive integer --nodes and --ntasks-per-node');
  if (!integer(gpus) || gpus !== tasks) errors.push('reserve one GPU per MPI rank with --gres=gpu:a100:<tasks-per-node>');
  const available = (part?.nodes ?? []).map(n => cluster.nodes[n]?.gpus ?? 0);
  if (!available.length || available.some(n => gpus > n)) errors.push('GPU request exceeds the GPUs available per node');
  if (directive('ntasks') != null && Number(directive('ntasks')) !== nodes * tasks) errors.push('--ntasks contradicts nodes × tasks-per-node');
  const lines = String(dat ?? '').trimEnd().split(/\r?\n/);
  let i = 4;
  const values = () => (lines[i++] ?? '').trim().split(/\s+/).map(Number);
  const vector = (label) => {
    const count = values()[0]; const row = values().slice(0, count);
    if (!integer(count) || row.length !== count || !row.every(integer)) errors.push(`HPL.dat has invalid ${label}`);
    return row;
  };
  const ns = vector('problem sizes'), nbs = vector('block sizes');
  const mapping = values()[0];
  if (![0,1].includes(mapping)) errors.push('HPL.dat PMAP must be 0 or 1');
  const grids = values()[0], ps = values().slice(0,grids), qs = values().slice(0,grids);
  if (!integer(grids) || ps.length !== grids || qs.length !== grids || !ps.every(integer) || !qs.every(integer)) errors.push('HPL.dat has invalid process grids');
  else if (ps.some((p,j) => p * qs[j] !== nodes * tasks)) errors.push('every HPL.dat P × Q must equal nodes × tasks-per-node');
  const threshold = values()[0];
  if (!Number.isFinite(threshold) || threshold <= 0) errors.push('HPL.dat must enable residual checking with a positive threshold');
  if (Number(lines[3]?.trim().split(/\s+/)[0]) !== 6) errors.push('HPL.dat device out must be 6 so results are retained in run.out');
  if (ns.length && nbs.some(nb => ns.some(n => nb > n))) errors.push('HPL.dat NB cannot exceed N');
  return errors;
}
