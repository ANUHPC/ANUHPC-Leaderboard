# HPL entry template

Copy this directory, edit your `HPL.dat`, rename the run script for your
cluster, push. A run is two files, the same as every Raijin entry:

```
HPL.dat     the problem: N, NB, P x Q
run.sh      the job: #SBATCH lines, ranks, threads, binding
```

There is no `job.yml`. Everything it used to declare — partition, nodes,
tasks, walltime — already lives in `run.sh`'s `#SBATCH` lines, and keeping
both only lets them disagree.

| | |
|---|---|
| Metric | Rmax, GFLOP/s |
| Direction | **higher is better** |
| Tuning | `N`, `NB`, `P`, `Q`, and the factorisation options — all yours |

## `run.sh` is required, and it is cluster-specific

There is one template per cluster. Copy the one matching the directory you are
submitting into, and rename it to `run.sh`:

```
cp input/_TEMPLATES/HPL/run.xenon.sh     input/xenon/HPL/<you>/<run>/run.sh
cp input/_TEMPLATES/HPL/run.raijin.sh    input/raijin/HPL/<you>/<run>/run.sh
cp input/_TEMPLATES/HPL/run.launchpad.sh input/launchpad/HPL/<you>/<run>/run.sh
```

They are not interchangeable. `run.raijin.sh` asks for `--partition=batch`,
which does not exist on Xenon, and pins MPI to TCP over Ethernet; on the Xenon
fabric that is roughly a 50x slowdown. Launchpad's only partition is `all`.

Keep `P x Q` in `HPL.dat` equal to the MPI ranks `run.sh` starts
(`nodes x ntasks-per-node`). The template `HPL.dat` is a 2 x 2 grid, which
matches `run.xenon.sh` and `run.launchpad.sh` (4 ranks); `run.raijin.sh` also
starts 4. A grid larger than the rank count is skipped by HPL, so validation
rejects it; a smaller one leaves ranks idle and gets a warning.

## Launchpad

One node, 2x Xeon Gold 6548Y+, 64 physical cores, 1 TiB RAM. The binary is
netlib HPL 2.3 + OpenBLAS 0.3.34 (built for Sapphire/Emerald Rapids) + Ubuntu
OpenMPI 4.1.6, from `/data/benchmarks/hpl/current`; `run.out` prints the
binary, BLAS and MPI it used, and the average core clock under load. Raise `N`
from the template's 20000 smoke test: memory is `8 x N^2` bytes, and the
template's notes give a starting size. Bringing your own BLAS or MPI is fine:
call your binary from `run.sh` instead of `./xhpl`, and the results are
parsed the same way. HPL ranks CPU only; the H100s are the
[HPL_NVIDIA](../HPL_NVIDIA/README.md) suite.

Do **not** hardcode `--nodelist`: node names differ between the clusters, and a
stale nodelist fails only after the job has already queued.
