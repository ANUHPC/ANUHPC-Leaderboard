# HPL GPU on Xenon

Run NVIDIA HPL on Xenon's eight A100-SXM4-40GB GPUs. Raijin has no supported
GPU HPL installation and is not offered on this board.

## Submit through GitHub

Copy **HPL.dat** and **run.xenon.sh** (renamed **run.sh**) into a new folder:

```text
input/xenon/HPL_NVIDIA/<your-name>/<run-name>/
```

Change the job name, then commit both files to `main`, or merge a validated PR.
Open **Actions → Submit jobs (xenon)**. Results are committed under
`output/xenon/HPL_NVIDIA/` and appear on the
[HPL GPU board](https://anuhpc.github.io/ANUHPC-Leaderboard/#/HPL_NVIDIA)
after website deployment. No `job.yml`, container download or local GPU is needed.

From a repository clone:

```bash
mkdir -p input/xenon/HPL_NVIDIA/YourName/a100-8gpu
cp input/_TEMPLATES/HPL_NVIDIA/HPL.dat input/xenon/HPL_NVIDIA/YourName/a100-8gpu/
cp input/_TEMPLATES/HPL_NVIDIA/run.xenon.sh input/xenon/HPL_NVIDIA/YourName/a100-8gpu/run.sh
# Edit --job-name in run.sh, then:
git add input/xenon/HPL_NVIDIA/YourName/a100-8gpu
git commit -m "Submit Xenon GPU HPL"
git push origin main
```

## Defaults and tuning

| Setting | Default |
|---|---|
| Nodes × ranks per node | 2 × 4, one GPU per rank |
| N / NB | 184320 / 512 |
| P × Q / PMAP | 4 × 2 / 1 (column-major) |
| GPU allocation | 4 A100s per node |
| Time limit | 40 minutes |

A direct Xenon run on 2026-09-19 measured **101.7 TFLOP/s**, 41.03 s solve
time, with its residual check passing. The GitHub run will report its own
measurement; throughput varies between runs.

Keep `P × Q = nodes × ranks per node`. The validator checks that, the GPU
allocation, and that residual checking is enabled. For one node, set nodes=1,
P=4, Q=1 and reduce N to fit four GPUs (start at 122880). Do not reuse the
eight-GPU matrix size on four devices.

N is memory limited: 184320 used about 37.7 GiB per GPU in the measured
eight-GPU run. NB=512 is the tested baseline. The matrix-only estimate
`8 × N² / GPUs` excludes solver workspace.

NVIDIA HPL ignores panel factorization, broadcast, look-ahead, L1/U layout,
equilibration and alignment settings. Avoid sweeping those fields. See the
[official NVIDIA HPL guide](https://docs.nvidia.com/nvidia-hpc-benchmarks/HPL_benchmark.html).

## Runtime and result checks

The launcher uses the native extracted NVIDIA HPC Benchmarks 26.02.01 tree at
`/apps/benchmarks/hpl-nvidia/current`, including its HPC-X MPI and CUDA 13.1
libraries. It does not invoke a container or Slurm's incompatible PMIx launcher.

Keep `HPL_USE_NVSHMEM=0`: Xenon's inbox RDMA stack cannot provide the GPU
memory registration required by NVSHMEM's inter-node transports. The tested
MPI/NCCL path works across both nodes. Keep GPU ordering and the affinity
settings in the template; do not set `NCCL_NET=UCX`.

A ranked result requires a finite positive GFLOP/s measurement paired with a
passing residual. Failed or unchecked results remain visible for diagnosis but
are not ranked. Check `run.out`, `run.err` and the Actions job summary if a run
fails; an error-file's existence alone does not mean the solve failed.
