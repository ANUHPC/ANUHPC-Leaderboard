#!/bin/bash
# GPU HPL on Launchpad (2x H100 NVL). Copy to your run directory AS run.sh:
#     cp run.launchpad.sh <your-run-dir>/run.sh
#
# Nothing is staged into the job directory: the HPL-NVIDIA tree is run from
# where it lives and pointed at your HPL.dat with --dat.

#SBATCH --job-name=hplgpu-CHANGE-ME
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2          # one rank per GPU
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32           # one socket (32 cores) per rank
#SBATCH --partition=all
#SBATCH --time=00:30:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread

set -euo pipefail

HPL_ROOT=/home/nvidia/PROGRAMS/nvidia_hpl_benchmarks

# Source NVIDIA's env: sets LD_LIBRARY_PATH for NCCL, NVSHMEM, NVPL BLAS/
# LAPACK/SPARSE, OMP, CUDA and sets OMPI_MCA_coll_hcoll_enable=0.
# shellcheck source=/dev/null
source "$HPL_ROOT/hpc-benchmarks-gpu-env.sh"

# Single-node: GPUs communicate over NVLink, not InfiniBand.
export UCX_TLS=sm,self,cuda_copy,cuda_ipc
export CUDA_VISIBLE_DEVICES=0,1

ulimit -l unlimited
ulimit -n 65536

echo "node : $(hostname -s)"
echo "gpus : $(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l) x $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
echo "ranks: ${SLURM_NTASKS}"

test -r "$PWD/HPL.dat"
test -x "$HPL_ROOT/hpl.sh"
exec mpirun -np "${SLURM_NTASKS}" "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat"
