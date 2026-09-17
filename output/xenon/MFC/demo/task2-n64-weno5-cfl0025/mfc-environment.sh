#!/usr/bin/env bash
# Source from the generated batch script: . environment.sh none|acc
# Keep the compiler, MPI and UCX runtime from the same installation.
case "${1:-none}" in
  none)
    export OMPI_PREFIX=/work/openmpi/5.0.10
    export PATH="$OMPI_PREFIX/bin:$PATH"
    export LD_LIBRARY_PATH="$OMPI_PREFIX/lib:/apps/ucx/1.22.0/lib:${LD_LIBRARY_PATH:-}"
    export UCX_TLS=rc,sm,self
    ;;
  acc)
    export NVHPC_ROOT=/work/nvhpc/Linux_x86_64/25.7
    export HPCX_DIR="$NVHPC_ROOT/comm_libs/12.9/hpcx/hpcx-2.22.1"
    export NVHPC_HPCX_USE_SERIAL=1
    . "$HPCX_DIR/hpcx-init.sh"
    hpcx_load
    export OMPI_PREFIX="$HPCX_DIR/ompi"
    export PATH="$NVHPC_ROOT/compilers/bin:$PATH"
    export LD_LIBRARY_PATH="$NVHPC_ROOT/compilers/lib:$NVHPC_ROOT/cuda/12.9/lib64:$NVHPC_ROOT/math_libs/12.9/lib64:$LD_LIBRARY_PATH"
    # Name the compilers, do not merely put them on PATH.
    #
    # CMake does not search PATH preferentially for nvfortran -- it takes the
    # first Fortran compiler it finds, which is /usr/bin/gfortran, and then
    # dies with "CMake detected the GNU Fortran compiler v13.3.0 ... Failed to
    # configure the syscheck target". That names neither MFC nor the case.
    #
    # This was dormant while render.sh passed --no-build and nothing ever
    # compiled during a job. It went live the moment building was enabled, so
    # a GPU submission whose case needs its own binary -- one with analytic
    # initial conditions -- would have hit it. Matches /work/mfc/build-gpu.sh,
    # which is how the working GPU tree was built.
    export CC=nvc CXX=nvc++ FC=nvfortran
    export MFC_CUDA_CC=80                 # A100 is sm_80
    # CUDA transports handle device buffers; inter-node traffic still uses RDMA.
    export UCX_TLS=rc,sm,self,cuda_copy,cuda_ipc
    export UCX_MEMTYPE_CACHE=n
    export MFC_GPU=1
    ;;
  *) echo "Unsupported MFC GPU mode: $1" >&2; return 1 ;;
esac
# HCA names differ between CPU and GPU nodes. Never inherit a pinned device.
unset UCX_NET_DEVICES
export OMPI_MCA_pml=ucx
export OMP_NUM_THREADS=1
