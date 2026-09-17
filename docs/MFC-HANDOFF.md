# MFC on the ANU Leaderboard — context, state, and what the web UI still needs

Written for someone picking up the **MFC page's UI/UX** on
`anuhpc.github.io/ANUHPC-Leaderboard/#/MFC`. It assumes no prior knowledge of
this repository. Everything below was verified by running it; where something
is extrapolated or unverified it says so.

---

## 1. What this project is, and the mistake to avoid repeating

A leaderboard for HPC benchmarks on two ANU clusters (Raijin, Xenon), fed by
GitHub: a user commits a job spec, a self-hosted runner executes it on the
cluster, results are committed back, and a React site renders them.

**The MFC page was originally designed as a race — fixed benchmark cases,
ranked by speed.** That was wrong, and it is the single most important thing
to understand before touching the UI.

The real goal is the **SCC26 student cluster competition**, where the
organisers hand you a simulation and you must:

1. reproduce it correctly, and
2. understand how physical and numerical settings affect its cost.

So the primary question the page must answer is *"what settings did this run
use, and what did they cost"* — not *"who is fastest"*. A design that treats a
user's own case as a second-class "unranked demo" is actively hostile to the
actual task.

### The measurement that proves the point

MFC reports **grind time** in ns per grid point, per equation, per
right-hand-side evaluation. Measured on this cluster:

| run | grind | s/step | equations |
|---|---|---|---|
| baseline | 56.08 | 0.005535 | 7 |
| `--sigma 0.0728` (surface tension on) | **53.24** | **0.006006** | 8 |

Surface tension made every step **8.5% more expensive** and the reported grind
time **go down**, because it adds an equation to the system and grind divides
by the equation count. Cross-checked: deriving grind from `s/step` reproduces
both figures at a consistent 0.98 ratio.

**A lower grind time does not mean a faster run.** Any UI that sorts by grind
across runs with different physics is lying to the reader. `sweep-table.py`
(CLI) already warns about this; the web page does not.

---

## 2. Repository layout

Two branches, and this trips people up:

| branch | holds | checkout used here |
|---|---|---|
| `main` | pipeline, suites, job specs, results | `/home/anuhpc/lb-work` |
| `website` | the React/Vite/TypeScript site | `/tmp/web` |

`gh-pages` is built output — never edit it.

**Data flow.** `main`'s `scripts/collect.mjs` reads `output/**` and writes
`data/runs/<id>/run.json` plus `data/index.json`. A workflow copies those onto
`website`, where `scripts/generate-index.mjs` **re-projects** `run.json` into
`index.json`.

> That projection is a trap. A field present in `run.json` is invisible to any
> table unless `generate-index.mjs` copies it across, because `run.json` is
> fetched one run at a time when a details panel opens. This has already
> caused one shipped bug.

### Files that matter for the UI

```
website branch
  src/components/MfcPage.tsx        336 lines — the board
  src/components/MfcRunDetails.tsx  309 lines — the per-run modal
  scripts/generate-index.mjs        the projection described above

main branch (produces the data)
  suites/MFC/collect.mjs            parses a finished run into a record
  suites/MFC/parse-inp.mjs          reads the settings a run actually used
  suites/MFC/suite.yml              the case registry + artifact manifest
  suites/MFC/sweep-table.py         CLI equivalent of the view the web lacks
```

---

## 3. The data contract

Live fields on an MFC run in `index.json` (verified against the deployed
site):

```
id, suite, group, run, cluster, metric, secondary, config, status,
ranking, raw, rank, best, outSummary, hasErr, wallSec, hasMedia,
date, dateSource, submittedAt, submitter
```

`config` carries: `case, nodes, tasks_per_node, ranks, partition, gpu,
case_optimization, gbpp, toolchain, mfc_sha`.

Notes on the less obvious ones:

- **`metric.value`** — grind time. Lower is better. See §1 before sorting by it.
- **`ranking.eligible` / `ranking.reason`** — whether it joins a board, and why
  not. Reasons include `"Reference case — compared by settings, not ranked"`,
  which is a legitimate, verified run, **not** a failure.
- **`submitter`** — `{ name, house, by }`. `name` is the folder under
  `input/`, which is the identity the board is organised by. `house: true`
  marks seeded reference entries (`benchmark`, `baseline`, `demo`) that belong
  to nobody. `by` is the git author of the commit that submitted it.
- **`date` / `dateSource`** — `"run"` when the run timestamped itself,
  `"git"` when derived from the commit that published its results. See §6.
- **`wallSec`**, **`hasMedia`** — summaries so a row needs no extra fetch.

### The gap that blocks the most valuable UI work

`suites/MFC/collect.mjs` now emits a **`parameters`** object — the settings a
run actually resolved to, read from the `simulation.inp` MFC writes:

```json
{ "grid": "240 x 60", "cells": 14400, "dimensions": 2, "dt": 1.9e-06,
  "steps": 2812, "wenoOrder": 3, "riemann": "HLLC", "timeStepper": "RK3",
  "modelEqns": 2, "numFluids": 2,
  "viscous": false, "surfaceTension": false, "bubbles": false }
```

**Two things stop it reaching the page:**

1. `generate-index.mjs` on `website` does not project `parameters`. One line.
2. **0 of the 11 existing runs have it.** `simulation.inp` was previously
   dropped by the artifact manifest as clutter — a mistake, now fixed, but
   only runs harvested *after* that change carry it. Existing runs need
   re-running, or the UI must degrade gracefully when `parameters` is null.

This matters because `parameters` is what makes a parameter study readable,
and a parameter study is the actual task.

---

## 4. What the MFC page does today

Rewritten once already, after a first attempt put **one tab per case** — with
eight cases it wrapped onto two rows, most tabs led to a single row of data,
and labels like `viscous_weno5_sgb_acoustic` were wider than the numbers they
led to. Case is a data dimension with no ceiling; it does not belong in
navigation.

Current shape:

- Two views, as a segmented control: **Recent** (default — every run, newest
  first) and **Leaderboards** (ranked boards, one per case × hardware).
- **Search** as the primary control. Matches run name, user, case, cluster,
  hardware, toolchain and ranked/unranked, with AND semantics
  (`benchmark gpu` → 8 of 11, where OR would return nearly everything).
  `/` focuses, `Esc` clears.
- Dropdown filters for case and hardware; always-visible result count; one
  click clears all filters; empty state names what matched nothing.
- Columns: **Run · User · Grind · Wall · Resources · When**.
- Leaderboards is a single grouped table, not one card per board — nine boards
  of one entry each would otherwise mean eight redundant headers.
- `MfcRunDetails` modal: Overview, case.py, Output, run.sh, Errors, Video.

Scale today: **11 MFC runs, 9 ranked, 151 runs total** across all suites.

---

## 5. What the UI still needs — the actual brief

Ordered by value. Nothing here is started.

### 5.1 Show the settings, not just the cost — the important one

The page cannot currently answer *"what did this run actually do?"*. Add a
comparison view keyed on `parameters`: one row per run, settings as columns
(grid, WENO order, Riemann solver, viscous, surface tension, steps) beside
grind and `s/step`.

`suites/MFC/sweep-table.py` is a working CLI version — read it for the shape
and, more importantly, for the equation-count warning it emits.

**Do not let a user sort by grind across runs with different equation counts
without warning them.** That is the §1 trap, and it is the single easiest way
for this page to mislead.

Prerequisites: project `parameters` in `generate-index.mjs`; handle `null` for
the 11 existing runs.

### 5.2 Retire the "unranked" framing

`ranking.reason` currently reads `"Custom or unverified case — unranked"` for
a user's own case. Under the real goal, supplying your own case is the *main
activity*, not a demotion. Three distinct states are conflated and should not
be:

| state | meaning |
|---|---|
| verified + on a board | a pinned benchmark case |
| verified + deliberately not ranked | `ranked: false` in the registry (convergence, parameter studies) |
| unverified | genuinely could not be checked |

The third is a warning. The first two are not.

### 5.3 A convergence view

Practice task 2 produces a set of runs whose meaning is a **slope**, not a
number: error against resolution, on log axes, per WENO order. There is a
verified CLI (`suites/MFC/convergence-error.py`) but nothing on the web.

Real measured numbers to design against:

| N | WENO1 | WENO3 | WENO5 |
|---|---|---|---|
| 32 | 6.51e-02 | 1.13e-02 | 6.03e-06 |
| 512 | 5.35e-03 | 7.75e-05 | 4.25e-10 |
| observed order | 0.97 | **1.86** | **3.04** |

Note WENO3 and WENO5 do *not* match their nominal orders, for two different
and well-understood reasons (§7). Any UI showing "observed order" must not
present that as a failure.

### 5.4 Smaller, real

- **Verify it in a browser.** Every UI change so far has been type-checked,
  built, and server-rendered — but *never seen*. There is no npm on the
  cluster, so no jsdom, no screenshot. This is the largest untested surface.
- **Mobile.** Never checked at any width.
- **Media.** `hasMedia` shows a film icon; the modal has a Video tab. Unverified
  visually.
- **Empty MFC/HPL_NVIDIA states.** `HPL_NVIDIA` has 0 runs and shows a "soon" badge.
- **Cross-suite consistency.** HPL uses `LeaderboardTable.tsx`, MFC has its
  own page. They look different. Decide whether that is intended.

---

## 6. Sharp edges — read before changing anything

**Dates are fragile and have already shipped wrong.** No MFC artifact contains
a date (MFC's banner prints a *time* where the date should be), and only 73 of
132 Raijin HPL runs carry their own timestamp. The rest come from git history.
A deployed build once showed **80 runs finishing in the same second** because
`collect.mjs` ran against a one-commit clone; reproduced exactly with
`git clone --depth 1`. There is now a detector that **discards** git dates when
they collapse, rather than publishing them, plus an unshallow guard in
`website.yml`. Do not remove either.

**`generate-index.mjs` silently drops unknown fields.** §3. A field in
`run.json` that a table reads will be `undefined` unless projected.

**Grind time is per equation.** §1.

**The `website` branch gets bot commits.** `website.yml` pushes regenerated
data artifacts on every `main` push, so hand edits routinely need
`git pull --rebase`. They only ever touch `public/data/**`; source conflicts
should not happen.

**Never commit `public/data`.** It is generated. Doing so has caused a mess
once already.

---

## 7. Findings a UI author may need to explain to a reader

All measured on this cluster.

- **WENO5 measures 3rd order, not 5th**, at fixed CFL — the RK3 *time* error
  dominates. Proven by refining CFL alone: the error ratio came out exactly
  2³. At CFL 0.025 it is 5.000 and 4.997.
- **WENO3 measures ~1.86, not 3** — Jiang–Shu order loss at smooth extrema with
  `weno_eps = 1e-16`. Raising it to `1e-2` gives 2.994/2.999 and a hundredfold
  lower error. Not a time-step artifact.
- **Viscosity costs +34.7% per stage on CPU, +36.6% on A100.**
- **Mach number barely affects grind (<2%) but changes wall time 1.8×**, purely
  through step count.
- **`run_time_info` costs 9.5× wall time on GPU** (311 s vs 33 s) while barely
  moving grind — because its cost lands in the stage grind takes the minimum
  over. Another demonstration that grind and wall answer different questions.
- **GPU starvation is violent**: the same case at 240×60 versus 2400×600 on
  four A100s is 8.34 versus 0.28 ns — a 29× efficiency collapse.

---

## 8. Pipeline state (context, not UI work)

Recently fixed on `main`, all verified:

- MFC compiles a case's analytic initial conditions into `pre_process`, so such
  a case needs its own binary. `--no-build` made those cases impossible; now
  built in a separate pass, then submitted with `--no-build` so the run never
  races the shared install directory.
- `job.yml` takes `args: ["-N", "128"]`, passed to the case — so a sweep runs
  one file at many settings instead of an edited file per point.
- `case_optimization` re-enabled (it was blocked on a false premise; MFC's own
  help calls it "10x faster").
- A registry entry can be `ranked: false` — frozen and shared without being a race.
- GPU builds export `CC/CXX/FC`; without it CMake silently picked `gfortran`.
- Four SCC26 practice-task templates, each verified by running it.

**13 commits on `main` are unpushed.** 12 tests, 10 registered cases, 14 job
specs — all green.

---

## 9. How to work on this

```bash
cd /tmp/web
git pull --rebase origin website
export PATH=/work/leaderboard/bin:$PATH     # node lives here; there is NO npm
./node_modules/.bin/tsc --noEmit -p tsconfig.app.json
./node_modules/.bin/vite build
```

To test against real data, copy `public/data` from a `collect.mjs` run on
`main`, then `node scripts/generate-index.mjs`.

**You cannot run a browser here.** Type-check, build, and reason about the
data contract; then have a human look at the deployed page. Do not claim
visual correctness you have not observed — that has been a recurring failure
in this work and it should not continue.
