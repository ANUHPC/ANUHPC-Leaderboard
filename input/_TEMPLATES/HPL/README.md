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
cp input/_TEMPLATES/HPL/run.xenon.sh  input/xenon/HPL/<you>/<run>/run.sh
cp input/_TEMPLATES/HPL/run.raijin.sh input/raijin/HPL/<you>/<run>/run.sh
```

They are not interchangeable. `run.raijin.sh` asks for `--partition=batch`,
which does not exist on Xenon, and pins MPI to TCP over Ethernet; on the Xenon
fabric that is roughly a 50x slowdown.

Do **not** hardcode `--nodelist`: node names differ between the clusters, and a
stale nodelist fails only after the job has already queued.
