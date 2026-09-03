# HPL entry template

Copy this directory, add your `HPL.dat`, edit `job.yml`, push.

| | |
|---|---|
| Metric | Rmax, GFLOP/s |
| Direction | **higher is better** |
| Tuning | `N`, `NB`, `P`, `Q`, and the factorisation options — all yours |

`run.sh` is optional. If you leave it out, one is generated that binds MPI to
the right fabric for the cluster you named. If you supply your own, do **not**
hardcode `--nodelist`: node names differ between Raijin and Xenon, and a
Raijin nodelist submitted to Xenon fails immediately.
