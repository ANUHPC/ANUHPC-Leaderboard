# MFC on launchpad

Notes for rebuilding MFC on the NVIDIA LaunchPad node (`scc-connect-03-gpu01`).
The reservation is temporary, so everything needed to redo it is here.

## Node

- 2x Xeon Gold 6548Y+ (Emerald Rapids), 64 cores, 1 TB RAM
- 2x H100 NVL 94 GB, NVLink between them, both on NUMA 0 (cores 0-31)
- Ubuntu 24.04, driver 595.71.05 (CUDA 13.2)
- Slurm on the node: partition `all`, `gpu:h100_nvl:2`
- mlx5 NICs are RoCE, not used (single node)

## Toolchain

| | CPU | GPU |
|---|---|---|
| Compiler | gfortran 13.3 | NVHPC 26.9 (nvfortran) |
| MPI | Ubuntu OpenMPI 4.1.6 | HPC-X 2.50 (OpenMPI 5.0.10) from the SDK |
| UCX_TLS | `sm,self` | `sm,self,cuda_copy,cuda_ipc` |
| MFC_CUDA_CC | | 90 |

Install (once, needs sudo):

```bash
sudo apt install python3.12-venv cmake
curl -fsSL https://developer.download.nvidia.com/hpc-sdk/ubuntu/DEB-GPG-KEY-NVIDIA-HPC-SDK \
  | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg
echo 'deb [signed-by=/usr/share/keyrings/nvidia-hpcsdk-archive-keyring.gpg] https://developer.download.nvidia.com/hpc-sdk/ubuntu/amd64 /' \
  | sudo tee /etc/apt/sources.list.d/nvhpc.list
sudo apt update && sudo apt install nvhpc-26-9
```

Then build both:

```bash
suites/MFC/build-launchpad.sh        # or: cpu / gpu
```

Trees are `/data/mfc/current/emr-cpu` and `emr-acc`, both at `e2f0e267`. They have to
be separate: MFC builds lapack/hdf5/silo once per tree, and the GPU post_process
won't link against the gfortran ones.

## Other Informaton

- **CUDA 13.3 vs driver 13.2.** NVHPC 26.9 only bundles 13.3. It still runs
  (minor version compat), checked with an OpenACC test on both GPUs before building MFC.
- **`-lnvhpcwrapnvtx` not found.** MFC (also current master) links this for
  CUDA >= 12.9, but 26.9 renamed it to `libnvhpcnvtx`. The real NVTX symbols
  come from `-cudalib=nvtx3` anyway. Fix: symlink in `/data/mfc/nvhpc-compat`
  and `LDFLAGS=-L/data/mfc/nvhpc-compat` (both in the build script / environment.sh).
  If the GPU build already failed, delete `build/staging/gpu-acc-*` before
  rebuilding, CMake caches the old flags.
- **`hpcx-init.sh` dies under `set -u`.** environment.sh turns it off around the source.
- **Don't run MFC while a build is going** in the same tree, they share `build/lock.yaml`.
- **CPU runs need `OMPI_MCA_pml=ob1`.** OpenMPI 4.1's ucx pml only loads if there's
  an IB/mlx5 or cuda_ipc transport, so with `UCX_TLS=sm,self` every run dies with
  "PML ucx cannot be selected". environment.sh sets ob1 for launchpad CPU.
- OpenMPI 4.1 wants `--map-by socket`, not `package` (that's OpenMPI 5 only).
- Kubernetes and dcgm-exporter run on this node too, a bit of background noise.

## Results

Build: CPU 3m40s, GPU 7m35s. Smoke tests (`run-tests.sh cpu|gpu --smoke`): 17/17 pass on both.

SCC26 practice problem 3 (2D shock-droplet, WENO3, HLLC, RK3), run through
`launchpad.mako`. s/step is MFC's solver time from `time_data.dat`.

| Run | Grid | Steps | s/step | Grind (ns) | Sim time (s) |
|---|---|---|---|---|---|
| CPU 4 ranks | 240x60 | 2812 | 0.00200 | 20.28 | 23.7 |
| CPU 64 ranks | 240x60 | 2812 | 0.00031 | 3.14 | 13.2 |
| 1x H100 | 240x60 | 2812 | 0.00081 | 8.23 | 26.5 |
| 2x H100 | 240x60 | 2812 | 0.00063 | 6.38 | 20.5 |
| CPU 64 ranks * | 1200x300 | 1128 | 0.00530 | 2.11 | 32.8 |
| 2x H100 | 1200x300 | 1128 | 0.00129 | 0.516 | 110 |
| 1x H100 | 4800x1200 | 1129 | 0.0197 | 0.489 | 2865 |
| 2x H100 | 4800x1200 | 1129 | 0.0102 | 0.253 | 1467 |
| 2x H100 * | 9600x2400 | 1129 | 0.0377 | 0.234 | 141 |

\* with `--no-run-time-info --saves 1`. The rest use the case defaults.

Xenon (4 ranks Haswell, same 240x60 case): 0.00554 s/step, 56.16 ns. So launchpad
is ~2.8x faster per step on 4 ranks.

Takeaways:

- 240x60 is far too small for the GPUs. 64 CPU cores beat both H100s there.
  At 1200x300 the 2 GPUs are ~4x faster than 64 cores, and grind keeps dropping
  to 0.23 ns at 9600x2400 (published H100 SXM is 0.38).
- **`run_time_info` dominates wall time on big grids, and grind doesn't show it.**
  A/B at 4800x1200 on 2 GPUs, 226 steps:

  | run_time_info | Sim time (s) | Grind (ns) |
  |---|---|---|
  | on (default) | 290 | 0.252 |
  | off | 11 | 0.250 |

  26x slower for the same grind. Turn it off (and lower `--saves`) when timing.
- Pipeline test: a `5eq_rk3_weno3_hllc` job on 2 GPUs (gbpp 4) went through
  stage -> render -> harvest -> collect and came out as a verified launchpad
  benchmark, grind 0.435 ns.
