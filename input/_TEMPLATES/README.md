# Job templates

Copy the template for your suite into the cluster you want to run on:

```
input/<cluster>/<suite>/<your-name>/<run-name>/
```

for example `input/xenon/HPL/ayush/first-try/`.

**The directory picks the cluster.** A job under `input/xenon/` triggers only
the Xenon workflow, on only the Xenon runner. Nothing else parses a field to
decide — the path is the routing.

| Cluster | Partitions | Notes |
|---------|-----------|-------|
| `raijin` | `batch` | 7 x hpc-0N, 32 threads each |
| `xenon` | `cpu` `gpu` `all` | 2 CPU nodes + 2 GPU nodes (4x A100 each) |

Results are ranked **per cluster** — the two measure different hardware.

Don't copy a `run.sh` between clusters: node names differ, and a Raijin
`--nodelist` submitted on Xenon fails after it has already queued. The HPL
template ships one `run.*.sh` per cluster for this reason — copy the matching
one and rename it to `run.sh`.

For MFC, start with the [MFC GitHub submission guide](MFC/README.md), including
CPU and GPU benchmarks and a ready-to-run SCC26 Problem 3 shock–droplet case.
MFC uses `job.yml` and optional `case.py`, not an HPL-style run script.
