# HPL_NVIDIA entry template

HPL on the A100 nodes. Copy this directory into
`input/xenon/HPL_NVIDIA/<your-name>/<run-name>/`, rename `run.xenon.sh` to
`run.sh`, and push.

| | |
|---|---|
| Metric | Rmax, GFLOP/s |
| Direction | **higher is better** |
| Hardware | 2 nodes x 4 x A100-SXM4-40GB |
| Partition | `gpu` |

This is a **separate board from HPL**, not a variant of it. 4 x A100 and 36
Haswell cores are not the same measurement, and the leaderboard ranks per
suite — sharing one board would bury every CPU entry.

## Sizing

One MPI rank per GPU, so `P x Q` = the number of GPUs (4 for one node, 8 for
two). Memory is the limit on `N`: each GPU has 40 GB, and HPL needs roughly
`8 * N^2` bytes spread across all of them. For 8 GPUs (320 GB total), aim at
about 80% occupancy:

    N ~= sqrt(0.8 * 320e9 / 8) ~= 178,000

`NB` should be 192 or 256 for A100 — much larger than a CPU run wants.

## Measured baselines

Xenon, 2026-09-19, HPL-NVIDIA 26.02, `N=184320 NB=512 P=4 Q=2 PMAP=1`, residual PASSED:

| config | Rmax | per GPU | time |
|---|---|---|---|
| 8 x A100, 2 nodes | **101.7 TFLOP/s** | 12.72 TF | 41.0 s |
| 4 x A100, 1 node  | 65.5 TFLOP/s | 16.37 TF | 20.9 s |

Two nodes buy 1.55x one node, not 2x -- the second node is reached over 56 Gb/s
FDR InfiniBand, and HPL's panel broadcast is on the critical path. Beating
101.7 TF is mostly about N; beating 16.37 TF/GPU is not going to happen here.

## Things that are already known, so you do not burn runs rediscovering them

- **`P` must be the GPUs-per-node (4), `Q` the node count (2), with `PMAP=1`.**
  That puts each process column inside one node, so the column AllGather stays
  on NVLink and only the row broadcast crosses InfiniBand. `PMAP=0` with the
  same HPL.dat measured 48% slower last year; `2x4` measured 8% slower.
- **`NB=512`.** Beat 384 at every N tested and beat 1024 on 8 GPUs, while using
  0.85 GiB/GPU less workspace.
- **N is limited by GPU memory, not time.** 8*N^2 bytes spread over 8 x 40 GB.
  N=184320 uses 37.7 of 40 GiB. There is room to push, but not much.
- **PFACT, RFACT, NBMIN, NDIV, BCAST, DEPTH, L1, U, EQUIL and ALIGN do nothing.**
  xhpl-nvidia prints that it ignores them, and an A/B at identical N/NB/grid
  confirmed it. Sweeping them wastes cluster time.
- **Do not reorder `CUDA_VISIBLE_DEVICES`.** Chasing NIC locality with `2,3,0,1`
  cost 30% last year; it breaks the alignment `ppr:2:numa:pe=8` sets up.
- **`HPL_USE_NVSHMEM=0` is required for multi-node** on this cluster. Without it
  the job dies in about six seconds in NVSHMEM heap registration.
