#!/bin/bash
# GPU HPL on the A100 nodes. Copy to your run directory AS run.sh.
#
# Nothing is staged into the job directory: HPL-NVIDIA is a vendor tree that
# resolves its libraries and CUDA/NCCL/NVSHMEM settings relative to its own
# location, so it is run where it lives and pointed at your HPL.dat with --dat.

#SBATCH --job-name=hplgpu-8a100-baseline
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=4          # one rank per GPU: ranks 0-3 node1, 4-7 node2
#SBATCH --gres=gpu:a100:4
#SBATCH --cpus-per-task=8            # 2 sockets x 16 cores = 2 ranks x 8 cores/socket
#SBATCH --partition=gpu
#SBATCH --time=00:40:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --distribution=block:block

set -euo pipefail

HPL_ROOT=/apps/benchmarks/hpl-nvidia/current

# The binary is built against OpenMPI 4.1.x and ships its own HPC-X, so use that
# rather than the host stack -- it removes any version-match question. Do not try
# to run this inside the container: Slurm offers only pmix_v5 while the image
# carries OpenMPI 4.1.x (PMIx 4), so srun cannot bootstrap the container's MPI.
export OPAL_PREFIX=$HPL_ROOT/opt/hpcx/ompi
export PATH=$HPL_ROOT/opt/hpcx/ompi/bin:$PATH
export LD_LIBRARY_PATH=$HPL_ROOT/usr/local/cuda-13.1/targets/x86_64-linux/lib:$HPL_ROOT/lib/x86_64-linux-gnu:$HPL_ROOT/opt/hpcx/ompi/lib:$HPL_ROOT/opt/hpcx/ucx/lib
# hpl.sh prepends workspace/lib/{nvshmem,omp} itself.

# THE setting that makes multi-node work here. NVSHMEM's IB transports (ibrc,
# ucx, ibdevx) all fail to register GPU memory with the HCA on this cluster:
# nvidia_peermem needs MLNX/DOCA-OFED's ib_core and Xenon runs the inbox RDMA
# stack, which does not export ib_register_peer_memory_client. Turning NVSHMEM
# off makes HPL use MPI/NCCL for inter-node instead. Measured cost: ~5.5%
# (12.71 vs 13.46 TF/GPU). Without it, 2-node runs die in ~6 seconds.
export HPL_USE_NVSHMEM=0

export CUDA_VISIBLE_DEVICES=0,1,2,3   # do NOT reorder; 2,3,0,1 cost 30% last year

export OMPI_MCA_pml=ucx
export OMPI_MCA_osc=ucx
export OMPI_MCA_btl=^openib
export OMPI_MCA_opal_cuda_support=true
export OMPI_MCA_mpi_leave_pinned=1
export OMPI_MCA_rmaps_base_mapping_policy="ppr:2:numa:pe=8"
export OMPI_MCA_hwloc_base_binding_policy=core

# gdr_copy is absent deliberately: gdrdrv is not installed here.
# Do NOT pin UCX_NET_DEVICES: the HCA is ibp161s0 on gpu nodes, ibp129s0 on cpu.
export UCX_TLS=rc,sm,self,cuda_copy,cuda_ipc
export UCX_IB_GPU_DIRECT_RDMA=y
export UCX_MEMTYPE_CACHE=y
export UCX_RNDV_SCHEME=put_zcopy

export NCCL_PXN_DISABLE=0
export NCCL_IB_GDR_LEVEL=5
# Never NCCL_NET=UCX -- every run that set it died in nvshmem team_internal.cpp.

ulimit -l unlimited
ulimit -n 65536

echo "node    : $(hostname -s)"
echo "gpus    : $(nvidia-smi --query-gpu=name --format=csv,noheader | wc -l) x $(nvidia-smi --query-gpu=name --format=csv,noheader | head -1)"
echo "ranks   : ${SLURM_NTASKS}"
echo "fabric  : $(ls /sys/class/infiniband/ 2>/dev/null | tr '\n' ' ')(UCX_TLS=${UCX_TLS})"

test -r "$PWD/HPL.dat"
test -x "$HPL_ROOT/workspace/hpl.sh"
exec mpirun -np "${SLURM_NTASKS}" "$HPL_ROOT/workspace/hpl.sh" --dat "$PWD/HPL.dat"
