# ANUHPC Leaderboard — Xenon cluster

Benchmark leaderboard for the ANU Xenon cluster. Push a job spec, the cluster
runs it, the result lands on the board.

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
cluster/
  partitions.yml what the cluster actually offers — kept in step with slurm.conf
  toolchains.yml named toolchains, and what is not built yet
scripts/
  collect.mjs        suite-agnostic collector; writes the website data
  validate-job.mjs   PR-time checks
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

## Cluster

4 nodes. cpu-node1 is the Slurm controller; cpu-node2 serves `/export` over NFS
to `/apps`, `/cluster`, `/work`, `/scratch` on every node.

| Partition | Nodes | Per node |
|-----------|-------|----------|
| `cpu` | cpu-node2 | 72 cores, 500 GB |
| `gpu` | gpu-node1, gpu-node2 | 64 cores, 2 TB, 4x A100-SXM4-40GB |

A 56 Gb/s FDR InfiniBand fabric carries MPI and NFS between cpu-node2 and the
GPU nodes; cpu-node1 is not on it yet.
