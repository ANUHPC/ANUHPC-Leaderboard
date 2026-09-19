# Xenon integration verification — 19 September 2026

The site shows only clusters with recorded runs for the selected application. HPL CPU offers Raijin and
Xenon; HPL NVIDIA and MFC offer Xenon. A stale `?cluster=raijin` link to either
Xenon-only suite resolves to Xenon and preserves other query parameters.
Single-cluster pages show one compact cluster label instead of a picker.

## GitHub-to-Slurm checks

- [HPL GPU run 35430536530](https://github.com/ANUHPC/ANUHPC-Leaderboard/actions/runs/35430536530):
  successful, Slurm job 364, `gpu-node[1-2]`, eight A100-SXM4-40GB GPUs.
  N=184320, NB=512, P=4, Q=2, PMAP=1. Reported 101700 GFLOP/s in 41.06 s;
  residual 0.000401414390, PASSED. Raw output is retained in
  `output/xenon/HPL_NVIDIA/baseline/a100-8gpu-n184320-nb512/`.
- [MFC run 35430572731](https://github.com/ANUHPC/ANUHPC-Leaderboard/actions/runs/35430572731):
  successful targeted rerun of `demo/task2-n32-weno5-cfl0025`. It waited for
  the HPL workflow through the shared queue, then ran only the selected case.
- [Validation run 35430573909](https://github.com/ANUHPC/ANUHPC-Leaderboard/actions/runs/35430573909):
  successful. 43 Node tests, 18 input specifications and 10 registered cases.
  The two existing custom MFC inputs intentionally produce unranked warnings.

## Failure cases checked

Collector tests cover failed/missing/nonfinite residuals, multiple candidates,
malformed results, MPI output tags, scheduler comments and a forged result.json.
GPU input checks reject unsupported clusters, invalid GPU/rank counts, mismatched
MPI grids and disabled residual checking. Workflow tests cover suite isolation,
targeted retries, invalid selectors and validation before staging.

The website browser audits cover stale bookmarks, suite-specific counts,
back navigation, 320–1440 px layouts, keyboard navigation and future supported
clusters appearing only after their first application run. Applications with no
runs have no cluster row. Injected failed/unverified GPU scores cannot enter
the performance table. MFC checks cover task links, details, focus trapping,
convergence comparisons, mixed configurations, unsafe artifact links, inert HTML,
missing media, malformed responses and retry behavior. Fixtures exist only inside
the test browser; no synthetic results are published.

The final published site passed all 8 cluster audit groups and all 10 MFC
browser audit groups after [Pages deployment 35430680957](https://github.com/ANUHPC/ANUHPC-Leaderboard/actions/runs/35430680957).
A separate live-data check confirmed the GPU baseline is rank 1 with its passing
residual and 41.06-second timing, its detail view opens, and MFC Quick help links
to the dedicated workflow. The updated dependency lockfile reports zero known
vulnerabilities in `npm audit` at this verification time.

## Runtime and publication decisions

Production inputs/results stay on `main`; React source stays on `website`.
MFC has its own submission workflow. See [workflow isolation](MFC-WORKFLOWS.md)
for the observed failures and branch rationale.

NVIDIA HPL uses the installed native vendor launcher and bundled HPC-X.
`HPL_USE_NVSHMEM=0` is required for Xenon's current inter-node stack. The
[NVIDIA HPL guide](https://docs.nvidia.com/nvidia-hpc-benchmarks/HPL_benchmark.html)
documents that switch, one GPU per MPI rank and the supported tuning surface.
The baseline verifies this deployment; it is not an exhaustive tuning study.
