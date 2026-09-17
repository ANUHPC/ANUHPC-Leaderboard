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

Use up to 36 CPU ranks on one CPU node, or up to 34 per node on two CPU
nodes (cpu-node1 reserves two cores). A GPU node has four A100-SXM4-40GB
devices: use `tasks_per_node: 4` for one rank per GPU. `nodes: 2` therefore
uses eight GPUs. More ranks are not automatically faster, especially for a
small case. Decomposition must leave enough cells in each direction.

`gbpp` controls grid size, not a Slurm memory reservation or a guarantee of
actual memory use. Most pinned cases use about 500,000 cells per rank per GB.
Custom cases set their own grid in `case.py`; `gbpp` is not passed to them.

The installed MFC source is pinned to `e2f0e267` (the PDF uses the same commit's
short prefix `e2f0e26`). CPU and GPU builds are ready under `/work/mfc/current`.
The pipeline picks the architecture and MPI runtime automatically. Do not
build, clean, or change the shared installation as part of a submission.
`build.case_optimization` is unsupported because it recompiles shared binaries.
OpenMP GPU offload is not configured here; use `acc`, not `omp` or a bare `--gpu`.
The runner maps the YAML CPU value `none` to the pinned MFC CLI's `--gpu no`.

## Pinned cases and scoring

These slugs select benchmark files from the pinned installation:

```text
5eq_rk3_weno3_hllc
5eq_rk3_weno3_hll
5eq_rk3_weno3_lf
viscous_weno5_sgb_acoustic
ibm
hypo_hll
igr
```

MFC reports **grind time in ns/gp/eq/rhs; lower is better**. The board separates
cases, clusters, and CPU/GPU hardware. Only a successfully completed pinned
benchmark with verified provenance ranks. Supplying any `case.py` makes the
run **unranked**, even if `job.yml` also names a pinned case. PDF practice
problems are learning exercises, not these seven leaderboard benchmarks.

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
