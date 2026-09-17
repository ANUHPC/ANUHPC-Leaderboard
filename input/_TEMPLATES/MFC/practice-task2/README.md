# Practice Task 2 — 1D convergence study

> Run a 1D advection simulation across different grid resolutions to plot the
> error scaling, showing how higher-order reconstruction achieves higher
> accuracy much faster as resolution increases.

## What you are measuring

The case advects a sine wave exactly one period. The exact answer at the end
is therefore the initial condition, and whatever differs is purely the
scheme's accumulated error:

```
L2 = sqrt( mean( (q(T) - q(0))^2 ) )
```

Halve the grid spacing and a *p*-th order scheme should cut that error by
2^*p*. Measuring *p* is the task.

## Submit

There is no `case.py` to copy. `advection_1d` is a registered case, frozen at
MFC commit `e2f0e267`, so every point of your sweep provably ran identical
code — the only thing that makes comparing them mean anything.

One folder per point. From the repository root:

```bash
bash input/_TEMPLATES/MFC/practice-task2/make-sweep.sh <your-name>
git add input/xenon/MFC/<your-name> && git commit -m "task 2 sweep" && git push
```

That writes 18 jobs: resolutions 32–512 at WENO 1, 3 and 5, plus three
low-CFL points explained below. Each runs in well under a minute.

For a single point, copy [`job.yml`](job.yml), or extract the
[Task 2 starter ZIP](../downloads/scc26-task2-n128-weno5.zip), and edit `args`:

```yaml
case: advection_1d
args: ["-N", "128", "--order", "5"]
```

## Read the result

Open the website's **Convergence** view and filter by your name or run names.
New registered `advection_1d` runs automatically publish `convergence.json`
with measured L1, L2 and L∞ errors. Different CFL arguments, solver settings,
clusters and hardware form separate series. Repeated resolutions are shown
without an order estimate until you filter to one sweep.

Raw fields stay on Xenon; they are not copied into GitHub. If you are working
in the full run directories on the cluster, the equivalent command is:

```bash
python3 suites/MFC/convergence-error.py /scratch/jobs/<run>/.../task2-n*-weno5
```

Use the actual staging path from the Actions log. The committed
`output/xenon/MFC/<you>/<run>/convergence.json` contains the small error report;
`simulation.inp` contains the settings actually passed to MFC. Example measured
results from the initial cluster study follow (not automatically imported as
website results):

```
     N             L1             L2           Linf     order(L2)
------------------------------------------------------------------
    32   5.426297e-06   6.025051e-06   8.481850e-06
    64   3.143034e-07   3.489724e-07   4.930439e-07         4.110
   128   2.800955e-08   3.110784e-08   4.398323e-08         3.488
   256   3.144987e-09   3.493131e-09   4.939830e-09         3.155
   512   3.823931e-10   4.247298e-10   6.006600e-10         3.040
```

The headline holds overwhelmingly: at N=512, WENO1 gives 5.3e-03 and WENO5
gives 4.2e-10 — **seven orders of magnitude** for the same grid.

## Two results that look like failures and are not

Both were measured here, not assumed. Neither is your mistake.

### WENO5 measures 3rd order, not 5th

At fixed CFL, `dt` shrinks with `dx`, so the RK3 **time** error falls as
N⁻³ and eventually buries the N⁻⁵ spatial error. You are measuring
`min(spatial_order, 3)`.

Proven by holding N=128 and refining CFL alone: the error ratio came out
exactly 2³ each time. Suppress the time error and the real order appears —

| N | L2 at CFL 0.025 | order |
|---|---|---|
| 32 | 4.319940e-06 | |
| 64 | 1.349585e-07 | **5.000** |
| 128 | 4.225841e-09 | **4.997** |

which is why the sweep includes a low-CFL WENO5 series. This is the actual
lesson of the task, not a detail.

### WENO3 measures about 1.86, not 3

Not a time-step artifact — it is identical at CFL 0.025. It is the classic
Jiang–Shu order loss at smooth extrema: where the smoothness indicators are
nearly equal, `weno_eps = 1e-16` lets the nonlinear weights drift from ideal.
The giveaway is that the order depends on the norm (L1 ≈ 2.2, L2 ≈ 1.86,
L∞ ≈ 1.48) — the error sits at the sine's peaks.

Raising `weno_eps` to `1e-2` linearises the weights and restores it:

| N | L2 at eps 1e-2 | order |
|---|---|---|
| 32 | 5.576479e-04 | |
| 64 | 6.999454e-05 | **2.994** |
| 128 | 8.756691e-06 | **2.999** |

— third order exactly, and a hundredfold more accurate. WENO-Z (`wenoz = T`)
does **not** fix it. `weno_eps` is fixed inside the case, so changing it
means supplying your own `case.py`; the point here is to recognise the
symptom.

## Plotting

The system `python3` has no numpy or matplotlib. MFC ships both:

```bash
/work/mfc/current/haswell/build/venv/bin/python your_plot.py
```

Plot log(error) against log(N); the negative slope is the observed order.

## Where the numbers come from

MFC writes plain ASCII to `<run>/D/`, not Silo, because the case sets
`parallel_io = F`:

```
D/cons.5.<rank>.<tstep>.dat        "<x>   <value>" per cell
```

Index 5 is the advected volume fraction α₁ (see `indices.dat`). Only two
steps are saved, and the final step number changes with the grid — N=32 ends
at 175, N=128 at 699 — so the script finds it rather than assuming.
