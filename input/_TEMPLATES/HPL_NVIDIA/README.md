# HPL_NVIDIA entry template

HPL on the A100 nodes. Copy this directory into
`input/xenon/HPL_NVIDIA/<your-name>/<run-name>/`, rename `run.xenon.sh` to
`run.sh`, and push.

| | |
|---|---|
| Metric | Rmax, GFLOP/s |
| Direction | **higher is better** |
| Hardware | 2 nodes x 4 x A100-SXM4-40GB |
| Partition | `gpu` |

This is a **separate board from HPL**, not a variant of it. 4 x A100 and 36
Haswell cores are not the same measurement, and the leaderboard ranks per
suite — sharing one board would bury every CPU entry.

## Sizing

One MPI rank per GPU, so `P x Q` = the number of GPUs (4 for one node, 8 for
two). Memory is the limit on `N`: each GPU has 40 GB, and HPL needs roughly
`8 * N^2` bytes spread across all of them. For 8 GPUs (320 GB total), aim at
about 80% occupancy:

    N ~= sqrt(0.8 * 320e9 / 8) ~= 178,000

`NB` should be 192 or 256 for A100 — much larger than a CPU run wants.

## Not runnable yet

`/apps/benchmarks/hpl-nvidia` is an empty placeholder. GPU HPL normally comes
from NVIDIA's NGC container, `nvcr.io/nvidia/hpc-benchmarks`, which needs a
container runtime — neither apptainer nor enroot is installed, and
`/apps/containers` is empty. Until one of those is in place, jobs here will
fail at submission with a clear message rather than silently.
