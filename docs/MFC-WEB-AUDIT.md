# MFC practice-task page: implementation and audit

2026-09-17. Scope: the MFC page, its data pipeline, task guidance and an actual
Task 2 submission through GitHub Actions. Existing HPL routes remain available.

## Review and plan

The handoff and SCC26_MFC_Practice_Tasks.pdf define four learning activities:
build/test, 1D convergence, 2D shock–droplet exploration, and remote ParaView.
The existing page led with grind rankings, omitted resolved parameters from two
index projections, conflated custom studies with unverified results, and grouped
benchmarks without the cluster. Old runs had no retained simulation.inp.

The implementation plan was to repair the pipeline, make tasks/settings/cost
primary, add measured convergence, then audit browser behavior and deployment.
No historical parameters or errors were reconstructed from example code.

## Changes

- Four task guides explain which activities use GitHub and which require a
  cluster terminal or ParaView. Submission templates are linked directly.
- Runs expose resolved grid, WENO/solver/physics settings, seconds per step,
  simulation time, total time, resources, provenance and date provenance.
- Up to four runs can be compared. Missing fields say unknown. Grind ordering
  requires a verified benchmark context and a known matching equation count.
- Benchmarks are secondary and stay separated by cluster, case and hardware.
- Task 2 retains measured periodic-return L1/L2/L∞ errors automatically. Log
  plots and observed orders group by resolved settings and case arguments;
  different CFL settings never share a line. Duplicate resolutions withhold
  lines/orders; zero errors remain in tables but not log plots.
- Modals trap and restore keyboard focus, contain scrolling, and offer media
  download/error fallbacks. Artifact links accept only safe relative raw paths.
- Filters persist in URLs. Empty/error states have recovery controls. Changing
  suites retains the cluster but drops MFC-specific filters.
- Full git history safeguards were synced into the website deployment workflow.
- A live run found a CMake ownership failure on cached binaries. The runner now
  asks MFC for case-specific target paths, reuses completed installs and builds
  missing targets. Case-optimization flags are preserved in the execution pass.

## Evidence before deployment

18 Node tests passed on main (collector, full projection pipeline, Fortran
parameter parsing and decomposition), and one website index-preservation test.
All 17 submitted job specifications and all 10 registered cases validated.
TypeScript, targeted ESLint and the production build passed. Existing build
advisories concern bundle size and the age of Browserslist data.

`scripts/audit-mfc.py` runs ten groups of Playwright Chromium checks against
real records plus request-intercepted synthetic fixtures:

1. Real index rendering and four task-guide links.
2. No page overflow at 320, 390, 768 and 1440 pixels.
3. Search shortcut, URL persistence, empty results and reset.
4. Modal focus containment, Escape/focus restoration and video controls.
5. Convergence and both HPL routes.
6. Log plot and measured order, series separation and duplicate-resolution guard.
7. Mixed-equation sort blocking and cross-cluster separation.
8. Inert HTML strings, blocked traversal/unsafe URLs and missing-media fallback.
9. Malformed detail/index responses, HTTP failure and retry recovery.
10. No uncaught browser errors.

A separate browser check played the real Task 3 video: duration 4.9 seconds,
readyState 4, advancing playback. The mobile modal had no page overflow.
Synthetic fixture data is never written into the published results.

## Reproduce

With Python Playwright and Chromium installed, run a Vite development server,
then `python scripts/audit-mfc.py http://127.0.0.1:5173/`. Set MFC_AUDIT_DIR to
choose the screenshot/results directory. A deployed site URL can be supplied
instead. Run `node --test scripts/generate-index.test.mjs` for index preservation.

## Research sources

- User-supplied SCC26_MFC_Practice_Tasks.pdf and MFC handoff.
- [MFC performance documentation](https://mflowcode.github.io/documentation/expectedPerformance.html).
- [MFC parameters](https://mflowcode.github.io/documentation/parameters.html).
- Pinned local MFC e2f0e267: parameter definitions, equation-vector initialization,
  build target hashing, batch generation and 1D_advection_convergence/case.py.
- [Playwright browser installation](https://playwright.dev/docs/browsers).

## Limits

Unknown historical settings are intentionally not filled in. Provenance
verification is not physical validation. Equation derivation covers the ordinary
5-equation family only when the required settings are retained; advanced or
incomplete configurations keep an unknown count. Task 1 full CPU/GPU suites and
a new interactive Task 4 ParaView session were outside this website audit.
## Live verification

The initial deployment and GitHub Pages publication both succeeded:
[website build](https://github.com/ANUHPC/ANUHPC-Leaderboard/actions/runs/35234893984)
and [Pages deployment](https://github.com/ANUHPC/ANUHPC-Leaderboard/actions/runs/35234974141).
All ten browser audit groups also passed against the deployed site, including
both HPL routes. All four task-guide links returned HTTP 200. The retained
simulation.inp and convergence.json files were downloadable from run details.

The [actual GitHub submission](https://github.com/ANUHPC/ANUHPC-Leaderboard/actions/runs/35234061736)
completed all three Task 2 jobs after fixing cached-build reuse. The live index
contains 14 MFC runs, including these three verified study points. Every error
below was checked against its downloadable convergence.json:

| Cells | L2 error | Observed order |
|---|---|---|
| 32 | 4.319939742785054e-6 | — |
| 64 | 1.3495849315842944e-7 | 5.000424 |
| 128 | 4.225840822132736e-9 | 4.997134 |

[Open the measured convergence plot](https://anuhpc.github.io/ANUHPC-Leaderboard/#/MFC?cluster=xenon&view=convergence&case=advection_1d).
The live plot was checked at desktop and mobile widths; all three points form
one series. The final audit also tightens grind grouping for changed solver or
physics settings even when equation counts match. No fabricated data was
published. Starter ZIPs were rebuilt and their contents compared byte-for-byte
with the current templates.

## Simpler presentation

Following user review, task descriptions were reduced to compact links, the
intro to one sentence, and submission/metric explanations moved into Quick
help. Convergence theory is collapsed under How to read the plot. Run rows
show the key settings and costs; full physics settings remain in comparison
and details. Safety checks, measured errors and submission links are retained.
