# SCC26 Practice Problem 3: shock–droplet from GitHub

This is a ready-to-submit version of **Problem 3, pages 4–6**, in
`SCC26_MFC_Practice_Tasks.pdf` (August 26, 2026). It uses the PDF's pinned
MFC source, `e2f0e267`, and its `examples/2D_shockdroplet/case.py`.

A Mach-1.4 shock in air interacts with a water droplet. The example runs on
four CPU ranks, saves Silo fields, and makes an MP4 plus a final PNG of
`alpha1`, the water volume fraction. It appears as a **Verified custom run**
when execution succeeds and the staged case hash and source pin match. The
practice study compares settings, cost and flow rather than entering a speed ranking.

The starting grid is **240 × 60 cells** (`RESOLUTION = 0.2`), with
`END_TIME = 1.0` and `CFL = 0.2`. This is a quick learning example, not a
converged reproduction of the PDF's figure. The figure uses resolution 4.0,
end time 2.0, Mach 1.4 and CFL 0.2; its much larger 4800 × 1200 grid needs
substantially more time and memory. Start with the small example.

## Files to upload

Download the [starter ZIP](../downloads/scc26-p3-cpu-01.zip) and extract it,
or download [`job.yml`](job.yml) and [`case.py`](case.py), keeping those exact
filenames, and put both inside a new folder named `scc26-p3-cpu-01`.
For example, upload that folder into `input/xenon/MFC/Ayush/` so GitHub shows:

```text
input/xenon/MFC/Ayush/scc26-p3-cpu-01/
├── job.yml
└── case.py
```

Replace `Ayush` with your own group/name. **Commit both files together to
`main`**, or upload them on a branch and merge a validated PR into `main`.
Do not upload a `run.sh`, and do not place the files in `output/`, `website`,
or `gh-pages`. See the [GitHub upload walkthrough](../README.md#submit-using-the-github-website).

Then open **Actions → Submit jobs (xenon)**. The runner automatically:

1. Validates the job and selects the prebuilt Haswell CPU installation.
2. Runs MFC's system check, preprocessing, simulation and postprocessing.
3. Renders `alpha1.mp4` and a final PNG using MFC's headless 2D visualizer.
4. Commits the small result files and previews to
   `output/xenon/MFC/Ayush/scc26-p3-cpu-01/`.
5. Preserves the large Silo fields on Xenon and starts the website deployment.

In the output directory, click the MP4/PNG and use GitHub's download button.
The [MFC page](https://anuhpc.github.io/ANUHPC-Leaderboard/#/MFC?cluster=xenon)
shows the run under **Runs & settings** once deployment finishes. Filter by
your name and **CPU**, then open **Details → Video**. Select multiple rows to
compare their retained settings and costs. A pending Actions workflow or running simulation has no result yet.

## Equivalent Git commands

From a clone of ANUHPC/ANUHPC-Leaderboard:

```bash
git switch main
git pull --ff-only
mkdir -p input/xenon/MFC/Ayush/scc26-p3-cpu-01
cp input/_TEMPLATES/MFC/practice-problem3/job.yml input/xenon/MFC/Ayush/scc26-p3-cpu-01/
cp input/_TEMPLATES/MFC/practice-problem3/case.py input/xenon/MFC/Ayush/scc26-p3-cpu-01/
git add input/xenon/MFC/Ayush/scc26-p3-cpu-01
git commit -m "Run SCC26 MFC Problem 3 on Xenon"
git push origin main
```

## What to inspect

- `summary.yaml`: simulation `exec` in seconds and `grind` in ns/gp/eq/rhs.
- `time_data.dat`: ranks, seconds per step and grind.
- `simulation.inp`: grid, time step, solver and enabled physics actually passed
  to MFC. Fields omitted by MFC remain unknown on the website.
- `alpha1.mp4`: blue/low values indicate air; high values indicate water
  under the default viridis colormap. Only the upper half of the droplet is
  simulated; the lower boundary is a symmetry plane.
- The PNG shows the final saved state. Silo snapshots are saved about 100
  times during the run; the last saved time can precede the final solver step.
- `mfc-status.yml` should say `state: COMPLETED`. An `.err` file alone does
  not mean failure: it also contains launcher commands and MPI notices.

`visualize: true` requests the Silo data. `preview: alpha1` additionally makes
the 2D movie and PNG. Use `preview: pres` for pressure, or remove `preview`
if you only want simulation output. A movie made this way is suitable for
1D/2D data; it does not make a true 3D volume visualization.

## Explore the PDF's questions

Copy the two files into a **new run directory** for each experiment. Record
its settings, `exec`, `grind`, and what changes in the visualization.

| Experiment | Change | What to compare |
|---|---|---|
| MPI scaling | `tasks_per_node: 1`, then `4` | Same physics and grid; compare time and grind |
| Shock strength | `args: ["--mach", "1.8"]` | Droplet deformation and pressure; physics changes |
| Resolution | `args: ["-N", "480"]` | 480 × 120 cells, finer interface, more work |
| Adaptive time step | `args: ["--adap-dt"]` | Same target CFL; compare stability, time and solution |
| CFL | `args: ["--cfl", "0.1"]` | Smaller step size, more time steps |
| Viscosity | `args: ["--viscous"]` | Flow and seconds per step |
| Surface tension | `args: ["--sigma", "0.0728"]` | Flow and seconds per step; equation count changes |
| GPU execution | Changes below | Compare hardware with identical case.py |

Pass options through `args` in job.yml; the constants near the top of case.py
are defaults. Keep one case file for a sweep so settings, rather than code
changes, explain differences. The CLI currently covers viscosity and surface
tension. Bubble-model experiments require a separate custom case with the
appropriate MFC bubble parameters; there is no `--bubbles` switch in this
starter.

For a registered study requiring only job.yml, use `case: shock_droplet_2d`
and omit case.py. To generate the existing CPU or GPU parameter study:

```bash
bash input/_TEMPLATES/MFC/practice-problem3/make-sweep.sh <your-name> cpu
# Review the generated job.yml files, then commit and push.
```

Review the requested sizes and wall times before submitting the entire sweep.
Surface tension changes the equation count, so use seconds per step and
simulation time alongside grind. The rest
retains the pinned example's initial conditions and numerical scheme. The
PDF calls the default scheme WENO-Z, but its pinned case file actually sets
`mapped_weno: T`; this template follows the source rather than silently
changing its numerics. The source also uses ambient air density 1.204 kg/m³;
the PDF diagram rounds/differs at 1.17 kg/m³. Use the actual case parameters
when interpreting the results.

For a four-A100 run, copy the case unchanged to a new folder, then replace
these sections in `job.yml`:

```yaml
resources:
  partition: gpu
  nodes: 1
  tasks_per_node: 4
  walltime: "00:30:00"
build:
  gpu: acc
  toolchain: nvhpc-acc
```

Keep `suite: MFC`, `visualize: true`, and `preview: alpha1`. Do not add a
`case:` slug or `tuning.gbpp`: this custom case determines its own grid.
The small starting grid may be faster on CPUs; GPU launch/communication
costs matter at small sizes. Increase resolution only after the first run
works. Do not use the PDF's bare `--gpu` command in `job.yml`.

The complete Problem 3 exercise includes comparing several physics/numerics
choices; a single baseline run and movie are the starting point, not the
entire exploration. Do not compare modified physics as ranked benchmarks.

## Optional cluster-side TUI / further visualization

No cluster login is needed for the GitHub-generated previews. If you already
have Xenon access and want the PDF's interactive MFC visualizer, use the path
shown in the Actions summary:

```bash
cd /work/mfc/current/haswell
./mfc.sh viz /scratch/jobs/visualizations/ACTIONS_RUN_ID/MFC/Ayush/scc26-p3-cpu-01/
```

Run it after the submission completes. Replace `ACTIONS_RUN_ID` with the
GitHub Actions run ID, not the Slurm job ID. Coordinate use of the shared
MFC tree with the cluster maintainer; do not run build/clean commands there.
For Task 4, use the installed `/work/pv-5.11.2` server with a matching
ParaView 5.11.2 laptop client. Follow the [Task 4 connection guide](../practice-task4/README.md);
the older `/work/paraview` 5.13 installation does not read the fields correctly.

## Verified starter run

On Xenon cpu-node1, 2026-09-17, Slurm job 144 completed the baseline with
four MPI ranks: 240 × 60 cells, 2812 steps, **53.49 s simulation time** and
**56.1581 ns/gp/eq/rhs**. MFC's visualizer produced a **98-frame, 4.9 s MP4**
and final PNG. This was a direct cluster verification using the repository's
submission scripts; the GitHub submission under `demo/scc26-p3-cpu` is a
separate completed run with its own measured values. These numbers are a starter
reference, not a promise of identical performance or a ranked result.
