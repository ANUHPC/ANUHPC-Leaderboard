# MFC workflow isolation

MFC has its own **Submit MFC (xenon)** Actions workflow. HPL and HPL NVIDIA use
**Submit jobs (xenon)**. Each validates and stages only its own suites. Both
share the `submit-xenon` concurrency group, with up to 100 pending runs, so
shared MFC build directories and cluster resources cannot be used by two
submission workflows simultaneously. An HPL submission no longer retries a
failed MFC case or waits for validation of unrelated MFC input.

## Branches and publication

Use an MFC feature branch for development and review, then merge to `main`.
Keep submitted inputs and canonical results on `main`. The deployment checks
out `main` for collection and `website` for the React source. Both submission
workflows trigger deployment when they finish, including failed submissions
whose harvested diagnostic output should remain visible.

A permanent, separate MFC production branch would not fix the observed build
and staging failures. It would add a second source of result history and need
cross-branch promotion before the collector could see each run. The existing
`suites-mfc` branch is older than current main; its local `625b4727` runner ESM
fix is already present in main and should not replace the newer integration.

For a targeted retry, open **Submit MFC (xenon) → Run workflow**, enter
`group/run` in **job**, and enable **rerun**. Rerun without a target is rejected.
Use a new run directory for a new experiment so previous results are retained.
With no target, the workflow submits unfinished MFC jobs and skips completed
ones. HPL dispatch offers `HPL` and `HPL_NVIDIA` explicitly.

## Evidence reviewed, 19 September 2026

- [MFC run 35233454697](https://github.com/ANUHPC/ANUHPC-Leaderboard/actions/runs/35233454697)
  failed installing `pre_process`: CMake could not change permissions on an
  already installed binary belonging to another account. Main's existing
  case-specific cache reuse fix addressed this; subsequent
  [run 35234061736](https://github.com/ANUHPC/ANUHPC-Leaderboard/actions/runs/35234061736)
  succeeded. A branch change cannot repair filesystem ownership.
- The previous Xenon workflow watched every suite and scanned every retained
  input on each push. A new HPL input could therefore select unfinished MFC
  runs. Its validator also checked every suite before staging anything.
- The old `rerun=true, suite=MFC` option replayed all retained MFC jobs. The
  dedicated workflow accepts one explicit `group/run` instead.

The staging regression tests cover suite isolation, completed/failed inputs,
explicit GPU selection, targeted reruns, invalid selectors, validation
failure before copying, and the empty-selection case.

GitHub documents [workflow triggers and default-branch requirements](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
and [concurrency queues](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax#example-queueing-multiple-pending-runs).
The shared group uses `queue: max` with `cancel-in-progress: false`; the default
single pending slot could otherwise replace a queued HPL run with an MFC run.
