# ANUHPC Leaderboard

Benchmark leaderboard across the ANU HPC clusters. Push a job spec, the cluster
runs it, the result lands on the board.

## Clusters

| Cluster | Nodes | Partitions | Available suites |
|---------|-------|-----------|------------------|
| **Raijin** | 7 x `hpc-01..07`, 32 threads each | `batch` | HPL CPU |
| **Xenon** | 2 CPU nodes + 2 GPU nodes (4x A100 each) | `cpu` `gpu` `all` | HPL CPU, HPL NVIDIA, MFC |

The two are separate machines with no network path between them, so each is
driven by its own self-hosted runner and jobs route by runner label. **Results
are ranked per cluster** — a Raijin number and a Xenon number measure different
hardware and are not comparable.

A run's cluster comes from its directory. The collector cross-checks that
against the node names the run actually reported and warns if they disagree —
a run filed under the wrong cluster would otherwise corrupt the board silently.

## Suites

| Suite | Metric | Better | Status |
|-------|--------|--------|--------|
| **HPL** | Rmax, GFLOP/s | higher | live |
| **HPL_NVIDIA** | Rmax, GFLOP/s | higher | live on Xenon |
| **MFC** | grind time, ns/gp/eq/rhs; accuracy and timing for studies | **lower** | live on Xenon; SCC26 tasks and simulation studies |
| **WRF** | forecast throughput, sim-h/wall-h | higher | designed, not enabled |

The two directions are why ranking is per suite and reads `metric.direction`
from the suite definition rather than assuming bigger wins.

## Submitting a run

Copy a template into the cluster you want, edit, push to `main`:

```
input/<cluster>/<suite>/<your-name>/<run-name>/
```

**The directory selects the workflow and cluster.** Xenon HPL inputs trigger
**Submit jobs (xenon)**; MFC inputs trigger **Submit MFC (xenon)**. Both use a
runner labelled `xenon` and a shared queue. Raijin has its own runner and workflow.

```
input/
  _TEMPLATES/       HPL/  HPL_NVIDIA/  MFC/  copy these; not picked up as jobs
  raijin/           HPL/<user>/<run>/
  xenon/            <suite>/<user>/<run>/
output/
  raijin/  xenon/   same shape, results committed back by the runner
```

- **HPL** — `HPL.dat` plus your own `run.sh`. Choosing `N`, `NB` and the `P x Q`
  grid *is* the exercise, so nothing is pinned.
- **HPL NVIDIA** — copy [`HPL.dat` and `run.xenon.sh`](input/_TEMPLATES/HPL_NVIDIA/),
  renaming the script to `run.sh`. The template uses both Xenon GPU nodes,
  eight A100s, and a 4×2 MPI grid. See the [GPU guide](input/_TEMPLATES/HPL_NVIDIA/README.md).
- **MFC** — copy a [task template](input/_TEMPLATES/MFC/README.md). It provides
  `job.yml` and, for custom studies, `case.py`. The website separates studies
  from comparable pinned benchmarks; provenance verification does not validate physics.

Validation runs on the pull request, so "5 nodes on a 2-node partition" fails
there rather than after the job has queued.

## Layout

```
suites/<NAME>/
  suite.yml      metric, direction, limits, pinned cases
  collect.mjs    turns a finished run into a normalised result
  xenon.mako     (MFC) batch template for this cluster
  render.sh      (MFC) job.yml -> ./mfc.sh run
.github/workflows/
  submit-<cluster>.yml   HPL submissions; path filter + runner label
  submit-mfc-xenon.yml   MFC submissions and targeted retries
  validate.yml           PR-time checks
  website.yml            rebuilds the site from main
clusters/<NAME>/
  partitions.yml nodes, partitions and limits for that cluster
  toolchains.yml named toolchains, and what is not built yet
scripts/
  collect.mjs        suite-agnostic collector; writes the website data
  validate-job.mjs   PR-time checks, against the cluster the path names
  submit-jobs.sh     stages, submits and waits; called by the workflows
  lib/cluster.mjs    cluster registry; cross-checks a run against its directory
  lib/yaml.mjs       zero-dependency YAML subset reader
  collect-hpl.js     superseded by collect.mjs; kept until the site is verified
input/  output/      one directory per run, per suite, per person
```

## Results

HPL results are parsed from stdout. A finite performance result ranks only
when that same result has a passing numerical residual check. Failed or
unverified checks remain visible for diagnosis.

MFC collects timing, resolved parameters, execution provenance and task outputs.
The [MFC workflow guide](docs/MFC-WORKFLOWS.md) explains targeted retries and
why inputs/results remain on `main`. Deployment collects from `main` and builds
the React source from `website`; submission completion publishes new results.

## Xenon

4 nodes. cpu-node1 is the Slurm controller; cpu-node2 serves `/export` over NFS
to `/apps`, `/cluster`, `/work`, `/scratch` on every node.

| Partition | Nodes | Per node |
|-----------|-------|----------|
| `cpu` | cpu-node1, cpu-node2 | 36 physical cores; 34 usable on the controller, 36 on cpu-node2 |
| `gpu` | gpu-node1, gpu-node2 | 32 physical cores, 64 threads, 4x A100-SXM4-40GB |

A 56 Gb/s FDR InfiniBand fabric carries MPI and NFS between cpu-node2 and the
GPU nodes; cpu-node1 is not on it yet.

## Raijin

7 nodes, `hpc-01` to `hpc-07`, single `batch` partition, 2 sockets x 8 cores
with SMT (32 threads) per node. Its specs in `clusters/raijin/partitions.yml`
are **derived** from the committed run output rather than measured — validation
says so when you submit against it. Correct them when convenient.
