#!/bin/bash
# HPL on the A100 nodes. Copy to your run directory AS run.sh.
#
# NOTE: this cannot run until a GPU HPL binary is published to
# /apps/benchmarks/hpl-nvidia/current/bin/. See README.md.

#SBATCH --job-name=hplgpu-CHANGE-ME
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=4          # one rank per GPU
#SBATCH --gres=gpu:4
#SBATCH --cpus-per-task=8
#SBATCH --partition=gpu
#SBATCH --time=01:00:00
#SBATCH --exclusive

export PATH=/apps/openmpi/5.0.10/bin:$PATH
export LD_LIBRARY_PATH=/apps/openmpi/5.0.10/lib:/apps/ucx/1.22.0/lib:${LD_LIBRARY_PATH:-}

# Fabric: 56 Gb/s FDR on all four nodes. Do NOT pin UCX_NET_DEVICES -- the HCA
# is named for its PCI slot and differs by node type (ibp161s0 on the gpu
# nodes, ibp129s0 on the cpu nodes), so any single value is wrong on half the
# cluster. UCX_TLS is what keeps traffic off the 1 GbE management network.
# cuda_copy/gdr_copy let UCX move data straight between GPU and HCA.
export UCX_TLS=rc,sm,self,cuda_copy,gdr_copy

# One rank per visible device.
export CUDA_VISIBLE_DEVICES=0,1,2,3
export OMP_NUM_THREADS=${SLURM_CPUS_PER_TASK:-8}

ulimit -l unlimited
ulimit -n 65536

echo "node    : $(hostname -s)"
echo "gpus    : $(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l) x $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
echo "ranks   : ${SLURM_NTASKS}"
echo "fabric  : $(ls /sys/class/infiniband/ 2>/dev/null | tr '\n' ' ')(UCX_TLS=${UCX_TLS})"

mpirun -np "${SLURM_NTASKS}" --bind-to none ./xhpl
