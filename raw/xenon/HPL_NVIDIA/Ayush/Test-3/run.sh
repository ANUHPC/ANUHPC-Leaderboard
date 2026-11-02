#!/bin/bash
# GPU HPL on the A100 nodes. Copy to your run directory AS run.sh.

#SBATCH --job-name=hplgpu-8a100-baseline
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=4          
#SBATCH --gres=gpu:a100:4
#SBATCH --cpus-per-task=8           
#SBATCH --partition=gpu
#SBATCH --time=01:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --distribution=block:block

set -euo pipefail

HPL_ROOT=/apps/benchmarks/hpl-nvidia/current


export OPAL_PREFIX=$HPL_ROOT/opt/hpcx/ompi
export PATH=$HPL_ROOT/opt/hpcx/ompi/bin:$PATH
export LD_LIBRARY_PATH=$HPL_ROOT/usr/local/cuda-13.1/targets/x86_64-linux/lib:$HPL_ROOT/lib/x86_64-linux-gnu:$HPL_ROOT/opt/hpcx/ompi/lib:$HPL_ROOT/opt/hpcx/ucx/lib
# hpl.sh prepends workspace/lib/{nvshmem,omp} itself.


export HPL_USE_NVSHMEM=0

export CUDA_VISIBLE_DEVICES=0,1,2,3  

export OMPI_MCA_pml=ucx
export OMPI_MCA_osc=ucx
export OMPI_MCA_btl=^openib
export OMPI_MCA_opal_cuda_support=true
export OMPI_MCA_mpi_leave_pinned=1
export OMPI_MCA_rmaps_base_mapping_policy="ppr:2:numa:pe=8"
export OMPI_MCA_hwloc_base_binding_policy=core


export UCX_TLS=rc,sm,self,cuda_copy,cuda_ipc
export UCX_IB_GPU_DIRECT_RDMA=y
export UCX_MEMTYPE_CACHE=y
export UCX_RNDV_SCHEME=put_zcopy

export NCCL_PXN_DISABLE=0
export NCCL_IB_GDR_LEVEL=5
export NCCL_DEBUG=INFO

ulimit -l unlimited
ulimit -n 65536

echo "node    : $(hostname -s)"
echo "gpus    : $(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l) x $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
echo "ranks   : ${SLURM_NTASKS}"
echo "fabric  : $(ls /sys/class/infiniband/ 2>/dev/null | tr '\n' ' ')(UCX_TLS=${UCX_TLS})"

test -r "$PWD/HPL.dat"
test -x "$HPL_ROOT/workspace/hpl.sh"
exec mpirun -np "${SLURM_NTASKS}" "$HPL_ROOT/workspace/hpl.sh" --dat "$PWD/HPL.dat"
