# Run MFC on Xenon through GitHub

Submit files to **ANUHPC/ANUHPC-Leaderboard, branch `main`**, under:

```text
input/xenon/MFC/<your-name>/<unique-run-name>/
```

The directory selects the cluster and suite. A commit changing `input/xenon/`
starts **Actions → Submit jobs (xenon)**. It queues a Slurm job, waits for it,
commits the results, and triggers the website deployment. A pull request runs
validation; the simulation starts when the PR is merged into `main`.
Committing templates under `input/_TEMPLATES/` does not submit a simulation.

You need repository write access, or a PR that a maintainer can merge. You do
not need SSH, a Slurm account, compilers, or MFC installed on your laptop.

## Choose the files to copy

| Example | Files to submit | Result |
|---|---|---|
| Small ranked CPU benchmark | [`job.yml`](job.yml) only | Four CPU ranks, modest problem size |
| Ranked A100 benchmark | [`gpu/job.yml`](gpu/job.yml) only | Four A100 GPUs on one node |
| SCC26 PDF, Problem 3: shock–droplet | [`practice-problem3/job.yml`](practice-problem3/job.yml) **and** [`practice-problem3/case.py`](practice-problem3/case.py) | Custom 2D case with Silo data; unranked |

Copy the selected files, **not this entire tree**. Do not include `run.sh`,
`sbatch` scripts, binaries, or old results. MFC generates its batch script.
For the PDF exercise, follow the [Problem 3 walkthrough](practice-problem3/README.md).

## Submit using the GitHub website

1. Open the repository's `main` branch and navigate to
   `input/xenon/MFC/<your-name>/`.
2. On your computer, make a new folder, for example `scc26-p3-cpu-01`.
   Put the selected `job.yml` and, for a custom case, `case.py` inside it.
3. Use **Add file → Upload files** and drag the folder into GitHub. Check that
   the proposed paths are `input/xenon/MFC/<your-name>/scc26-p3-cpu-01/job.yml`
   and, when needed, `.../case.py`.
4. Commit both files together. Either commit to `main`, or create a branch,
   open a pull request, wait for validation, and merge it into `main`.
5. Open **Actions → Submit jobs (xenon)**. The run may wait behind an existing
   submission: Xenon serializes jobs because MFC uses shared build directories.

For a ranked benchmark with just one file, **Add file → Create new file** also
works: enter the full path ending in `/job.yml` and paste the chosen template.
For custom cases, upload both files in the same commit so validation sees
the complete submission.

## Submit using Git

Run from a clone of this repository:

```bash
git switch main
git pull --ff-only
mkdir -p input/xenon/MFC/Ayush/cpu-benchmark-01
cp input/_TEMPLATES/MFC/job.yml input/xenon/MFC/Ayush/cpu-benchmark-01/job.yml
# Edit job.yml, including resources if desired.
git add input/xenon/MFC/Ayush/cpu-benchmark-01
git commit -m "Submit MFC CPU benchmark"
git push origin main
```

Replace `Ayush` and the run name. Choose a **new run directory for every
experiment**. Editing a run that already completed does not automatically
rerun it: the workflow skips completed output. The Actions **Run workflow**
form can force reruns with `suite=MFC` and `rerun=true`, but that reruns **all
retained MFC jobs**, so use a new directory for an ordinary experiment.

## Fields and supported resources

| Field | Meaning / allowed values |
|---|---|
| `suite` | `MFC` |
| `case` | One pinned slug below; omit if submitting `case.py` |
| `preview` | Optional variable such as `alpha1` or `pres`; makes an MP4 and final PNG; requires `visualize: true` (1D/2D) |
| `visualize` | `true` adds `post_process` and preserves Silo data; `false` or omitted runs the benchmark only |
| `resources.partition` | `cpu` or `gpu`; `all` mixes CPU architectures and is rejected |
| `resources.nodes` | `1` or `2` |
| `resources.tasks_per_node` | MPI ranks **per node**; total ranks = nodes × tasks_per_node |
| `resources.walltime` | Quoted `HH:MM:SS`, up to `"04:00:00"`; allow time for pre/postprocessing |
| `build.gpu` | `none` for CPU execution, `acc` for NVIDIA OpenACC |
| `build.toolchain` | `gcc-ompi5` with `none`; `nvhpc-acc` with `acc` |
| `tuning.gbpp` | Positive integer sizing parameter for pinned benchmarks; start with `1` on CPU or `16` on A100 |
| `args` | Options passed to your `case.py`, one list entry per argument: `args: ["-N", "128", "--order", "5"]` |

Use up to 36 CPU ranks on one CPU node, or up to 34 per node on two CPU
nodes (cpu-node1 reserves two cores). A GPU node has four A100-SXM4-40GB
devices: use `tasks_per_node: 4` for one rank per GPU. `nodes: 2` therefore
uses eight GPUs. More ranks are not automatically faster, especially for a
small case. Decomposition must leave enough cells in each direction.

`gbpp` controls grid size, not a Slurm memory reservation or a guarantee of
actual memory use. Most pinned cases use about 500,000 cells per rank per GB.
Custom cases set their own grid in `case.py`; `gbpp` is not passed to them.

## Sweeping a parameter with `args`

An MFC case is a Python program, and many take options. The 1D convergence
example takes `-N` and `--order`, so a convergence study is the *same*
`case.py` run at several resolutions:

```yaml
args: ["-N", "128", "--order", "5"]
```

Write one list entry per argument. `args: "-N 128"` and `args: ["-N 128"]`
both arrive as a single argument containing a space, which the case rejects;
validation catches both before the job is submitted.

This matters for a sweep. Editing `case.py` between runs would also work, but
then each point came from different code and the comparison means nothing —
with `args` every point demonstrably came from the same file.

Which settings a run actually used are recorded in its `simulation.inp`, kept
with the results.

## About the shared installation

The installed MFC source is pinned to `e2f0e267` (the PDF uses the same commit's
short prefix `e2f0e26`). CPU and GPU builds are ready under `/work/mfc/current`.
The pipeline picks the architecture and MPI runtime automatically.

**Your case may be compiled.** MFC turns an initial condition written as an
expression —

```python
"patch_icpp(1)%alpha_rho(1)": "0.5 + 0.2 * sin(2.0 * pi * x / lx)"
```

— into Fortran, and a case that does this needs its own `pre_process` binary.
The pipeline builds it on demand. That takes roughly twelve minutes the first
time a given case is submitted and nothing thereafter, because MFC keys each
build by a hash of the generated source: a new build is added alongside the
existing ones and never replaces them. Cases whose initial conditions are
plain numbers compile nothing and start immediately.

`build.case_optimization` is still unsupported: unlike the above it bakes the
whole case into every target, including `simulation`.
OpenMP GPU offload is not configured here; use `acc`, not `omp` or a bare `--gpu`.
The runner maps the YAML CPU value `none` to the pinned MFC CLI's `--gpu no`.

## Registered cases and scoring

`case:` takes one of these slugs. The list is
[`suites/MFC/suite.yml`](../../../suites/MFC/suite.yml); run
`node suites/MFC/case-path.mjs --list` for the current set.

From MFC's own benchmark set, in the pinned installation:

```text
5eq_rk3_weno3_hllc
5eq_rk3_weno3_hll
5eq_rk3_weno3_lf
viscous_weno5_sgb_acoustic
ibm
hypo_hll
igr
```

Contributed here, in this repository:

```text
anu_tgv_3d      Taylor-Green vortex, 3D, weak-scaled
```

Both kinds rank identically. They differ only in what freezes them: an upstream
case by MFC's commit pin, a contributed one by the file committed in this repo,
which the collector re-hashes against every run.

MFC reports **grind time in ns/gp/eq/rhs; lower is better**. The board separates
cases, clusters, and CPU/GPU hardware. Only a successfully completed registered
case with verified provenance ranks. Supplying your own `case.py` makes the run
**unranked**, even if `job.yml` also names a case — grind time does not cancel
out how expensive the physics is, so a free choice of case would reward picking
cheap physics rather than running it well. PDF practice problems are learning
exercises, not leaderboard benchmarks.

## Adding a case

A case is a board, so adding one opens a new contest rather than an entry in an
existing one. You may contribute one: put it in `suites/MFC/cases/<slug>/case.py`,
add an entry to `suite.yml`, open a pull request. CI runs it at every allowed
node and rank count before it can merge.

Full instructions, including the interface a case must implement and the
decomposition rule it has to satisfy, are in
[`suites/MFC/cases/README.md`](../../../suites/MFC/cases/README.md).

## Find results and visualization data

- Actions shows progress and failures in **Stage, submit, wait**. An `.err`
  file can contain ordinary launcher tracing; check the job state and error
  message, not just whether that file exists.
- Results are committed to `output/xenon/MFC/<your-name>/<run-name>/`.
  `summary.yaml` contains per-target elapsed seconds and simulation grind;
  `time_data.dat` contains ranks, seconds per step and grind.
- `mfc-provenance.json` records the source commit and case hash;
  `mfc-status.yml` records successful or failed completion.
- After **website.yml** and **pages build and deployment** complete, open
  [MFC on Xenon](https://anuhpc.github.io/ANUHPC-Leaderboard/#/MFC?cluster=xenon).
  Select **CPU** for the default template; the page initially shows **GPU**.
  Custom cases appear under **Demos and unranked runs**. Running jobs do not
  appear until results are harvested and deployed.
- With `visualize: true`, the Actions summary gives the preserved cluster
  directory `/scratch/jobs/visualizations/<Actions-run-ID>/MFC/<your-name>/<run-name>/`.
  Large Silo files are kept there, not committed to Git. `visualize: true`
  produces data; add `preview: alpha1` (or another output variable) for a
  GitHub-downloadable 1D/2D movie and final PNG.
  See the practice walkthrough for 2D visualization and download commands.

If validation fails, fix the reported field before resubmitting. A partition
of `all`, a CPU toolchain with GPU offload, or too many ranks for the grid are
common causes. If the workflow is pending, inspect the earlier Xenon run
before creating more submissions; extra pushes do not bypass the queue.
