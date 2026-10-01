#!/usr/bin/env bash
# Source from the generated batch script: . environment.sh none|acc [cluster]
# Keep the compiler, MPI and UCX runtime from the same installation.
# cluster defaults to $CLUSTER, then xenon.
case "${2:-${CLUSTER:-xenon}}:${1:-none}" in
  xenon:none)
    export OMPI_PREFIX=/work/openmpi/5.0.10
    export PATH="$OMPI_PREFIX/bin:$PATH"
    export LD_LIBRARY_PATH="$OMPI_PREFIX/lib:/apps/ucx/1.22.0/lib:${LD_LIBRARY_PATH:-}"
    export UCX_TLS=rc,sm,self
    ;;
  xenon:acc)
    export NVHPC_ROOT=/work/nvhpc/Linux_x86_64/25.7
    export HPCX_DIR="$NVHPC_ROOT/comm_libs/12.9/hpcx/hpcx-2.22.1"
    export NVHPC_HPCX_USE_SERIAL=1
    . "$HPCX_DIR/hpcx-init.sh"
    hpcx_load
    export OMPI_PREFIX="$HPCX_DIR/ompi"
    export PATH="$NVHPC_ROOT/compilers/bin:$PATH"
    export LD_LIBRARY_PATH="$NVHPC_ROOT/compilers/lib:$NVHPC_ROOT/cuda/12.9/lib64:$NVHPC_ROOT/math_libs/12.9/lib64:$LD_LIBRARY_PATH"
    # set these explicitly, otherwise cmake picks /usr/bin/gfortran
    export CC=nvc CXX=nvc++ FC=nvfortran
    export MFC_CUDA_CC=80                 # A100 is sm_80
    # cuda transports for device buffers
    export UCX_TLS=rc,sm,self,cuda_copy,cuda_ipc
    export UCX_MEMTYPE_CACHE=n
    export MFC_GPU=1
    ;;
  # launchpad: single node, 2x H100 NVL. No rc in UCX_TLS, no IB fabric here.
  launchpad:none)
    # system OpenMPI 4.1.6, built with gfortran
    export CC=gcc CXX=g++ FC=gfortran
    export UCX_TLS=sm,self
    ;;
  launchpad:acc)
    # NVHPC 26.9 ships CUDA 13.3, driver is 13.2. Works via minor version compat.
    export NVHPC_ROOT=/opt/nvidia/hpc_sdk/Linux_x86_64/26.9
    export HPCX_DIR="$NVHPC_ROOT/comm_libs/13.3/hpcx/hpcx-2.50"
    export NVHPC_HPCX_USE_SERIAL=1
    # hpcx-init.sh breaks under set -u
    _mfc_nounset=0; case $- in *u*) _mfc_nounset=1; set +u ;; esac
    . "$HPCX_DIR/hpcx-init.sh"
    hpcx_load
    if [ "$_mfc_nounset" = 1 ]; then set -u; fi; unset _mfc_nounset
    export OMPI_PREFIX="$HPCX_DIR/ompi"
    export PATH="$NVHPC_ROOT/compilers/bin:$PATH"
    export LD_LIBRARY_PATH="$NVHPC_ROOT/compilers/lib:$NVHPC_ROOT/cuda/13.3/lib64:$NVHPC_ROOT/math_libs/13.3/lib64:$LD_LIBRARY_PATH"
    # MFC links -lnvhpcwrapnvtx, which 26.9 renamed to libnvhpcnvtx.
    # /data/mfc/nvhpc-compat has a symlink, made by build-launchpad.sh.
    export LDFLAGS="-L/data/mfc/nvhpc-compat ${LDFLAGS:-}"
    export CC=nvc CXX=nvc++ FC=nvfortran
    export MFC_CUDA_CC=90
    export UCX_TLS=sm,self,cuda_copy,cuda_ipc
    export UCX_MEMTYPE_CACHE=n
    export MFC_GPU=1
    ;;
  *) echo "Unsupported MFC environment: cluster=${2:-${CLUSTER:-xenon}} mode=${1:-none}" >&2; return 1 ;;
esac
# HCA names differ between cpu and gpu nodes
unset UCX_NET_DEVICES
# launchpad cpu has no ucx network transport, so the ucx pml won't load. use shared memory.
if [ "${2:-${CLUSTER:-xenon}}:${1:-none}" = launchpad:none ]; then
  export OMPI_MCA_pml=ob1
else
  export OMPI_MCA_pml=ucx
fi
export OMP_NUM_THREADS=1
