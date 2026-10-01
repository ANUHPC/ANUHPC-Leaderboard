#!/bin/bash
#SBATCH --job-name=hplgpu-launchpad-baseline
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

# shellcheck source=/dev/null
source "$HPL_ROOT/hpc-benchmarks-gpu-env.sh"

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
