# ANUHPC Leaderboard

Benchmark leaderboard across the ANU HPC clusters. Push a job spec, the cluster
runs it, the result lands on the board.

## Clusters

| Cluster | Nodes | Partitions | Runs | Status |
|---------|-------|-----------|------|--------|
| **Raijin** | 7 x `hpc-01..07`, 32 threads each | `batch` | 137 | original target |
| **Xenon** | `cpu-node2` (72t) + 2 x GPU (4x A100) | `cpu` `gpu` `all` | 0 | new |

The two are separate machines with no network path between them, so each is
driven by its own self-hosted runner and jobs route by runner label. **Results
are ranked per cluster** — a Raijin number and a Xenon number measure different
hardware and are not comparable.

Every job names its cluster in `job.yml`. The 137 runs committed before Xenon
existed are attributed automatically from the node names they left behind
(123 from output, 10 from a `--nodelist`, 4 by fallback).

## Suites

| Suite | Metric | Better | Status |
|-------|--------|--------|--------|
| **HPL** | Rmax, GFLOP/s | higher | live — 137 runs |
| **MFC** | grind time, ns/gp/eq/rhs | **lower** | wired up, waiting on toolchain |
| **WRF** | forecast throughput, sim-h/wall-h | higher | designed, not enabled |

The two directions are why ranking is per suite and reads `metric.direction`
from the suite definition rather than assuming bigger wins.

## Submitting a run

Copy a template, edit, push:

```
input/<SUITE>/<your-name>/<run-name>/
```

- **HPL** — `HPL.dat` plus your own `run.sh`. Choosing `N`, `NB` and the `P x Q`
  grid *is* the exercise, so nothing is pinned.
- **MFC** — `job.yml` only. The case comes from the pinned checkout in
  `/apps/mfc` so everyone runs identical physics; you compete on decomposition,
  toolchain and build flags. See `input/MFC/_TEMPLATE/`. Supplying your own
  `case.py` is allowed but makes the run unranked.

Validation runs on the pull request, so "5 nodes on a 2-node partition" fails
there rather than after the job has queued.

## Layout

```
suites/<NAME>/
  suite.yml      metric, direction, limits, pinned cases
  collect.mjs    turns a finished run into a normalised result
  xenon.mako     (MFC) batch template for this cluster
  render.sh      (MFC) job.yml -> ./mfc.sh run
clusters/<NAME>/
  partitions.yml nodes, partitions and limits for that cluster
  toolchains.yml named toolchains, and what is not built yet
scripts/
  collect.mjs        suite-agnostic collector; writes the website data
  validate-job.mjs   PR-time checks, against the cluster the job names
  select-jobs.mjs    routes each job to its cluster's runner
  lib/cluster.mjs    cluster registry and attribution of legacy runs
  lib/yaml.mjs       zero-dependency YAML subset reader
  collect-hpl.js     superseded by collect.mjs; kept until the site is verified
input/  output/      one directory per run, per suite, per person
```

## Results

A finished run is read from `result.json` when present, and otherwise by
parsing what the application left behind. Every one of the 137 historical HPL
runs predates `result.json` and is recovered by the stdout parser — that
fallback is load-bearing, do not remove it.

MFC needs no parser: it writes `summary.yaml` (`exec` and `grind`) and
`time_data.dat` itself. Note `time_data.dat` *appends* across runs, so the
collector flags a run whose case directory was reused.

## Xenon

4 nodes. cpu-node1 is the Slurm controller; cpu-node2 serves `/export` over NFS
to `/apps`, `/cluster`, `/work`, `/scratch` on every node.

| Partition | Nodes | Per node |
|-----------|-------|----------|
| `cpu` | cpu-node2 | 72 cores, 500 GB |
| `gpu` | gpu-node1, gpu-node2 | 64 cores, 2 TB, 4x A100-SXM4-40GB |

A 56 Gb/s FDR InfiniBand fabric carries MPI and NFS between cpu-node2 and the
GPU nodes; cpu-node1 is not on it yet.

## Raijin

7 nodes, `hpc-01` to `hpc-07`, single `batch` partition, 2 sockets x 8 cores
with SMT (32 threads) per node. Its specs in `clusters/raijin/partitions.yml`
are **derived** from the committed run output rather than measured — validation
says so when you submit against it. Correct them when convenient.
