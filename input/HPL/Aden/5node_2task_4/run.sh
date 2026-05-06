#!/bin/bash
#SBATCH --nodelist=hpc-02,hpc-03,hpc-04,hpc-06,hpc-07
#SBATCH --job-name=hpl-5node_2task
#SBATCH --nodes=5
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=8
#SBATCH --partition=batch
#SBATCH --time=02:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --output=run.sh-%j.out
#SBATCH --error=run.sh-%j.err

# --- Single-threaded BLAS (pure MPI, 1 process per core) ---
export OMP_NUM_THREADS=8
export OPENBLAS_NUM_THREADS=8

# --- MPI transport: InfiniBand via OpenIB ---
export OMPI_MCA_btl=openib,vader,self
export OMPI_MCA_pml=ob1
export OMPI_MCA_btl_openib_allow_ib=1
export OMPI_MCA_btl_openib_warn_default_gid_prefix=0

# Ulimits
ulimit -l unlimited
ulimit -n 65536

# Run HPL
mpirun --map-by socket --bind-to socket --report-bindings \
  -x OMP_NUM_THREADS -x OPENBLAS_NUM_THREADS \
  ./xhpl