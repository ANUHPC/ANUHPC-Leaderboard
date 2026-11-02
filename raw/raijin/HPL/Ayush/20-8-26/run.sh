#!/bin/bash
#SBATCH --nodelist=hpc-02,hpc-03,hpc-04,hpc-05,hpc-06,hpc-07
#SBATCH --job-name=hpl-tes
#SBATCH --nodes=6
#SBATCH --ntasks-per-node=16
#SBATCH --cpus-per-task=1
#SBATCH --partition=batch
#SBATCH --time=02:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --output=run.sh-%j.out
#SBATCH --error=run.sh-%j.err

# --- Single-threaded BLAS (pure MPI, 1 process per core) ---
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1

# --- MPI transport: InfiniBand via OpenIB ---
export OMPI_MCA_btl=openib,vader,self
export OMPI_MCA_pml=ob1
export OMPI_MCA_btl_openib_allow_ib=1
export OMPI_MCA_btl_openib_warn_default_gid_prefix=0

# Ulimits
ulimit -l unlimited
ulimit -n 65536

# Run HPL — 1 rank per core
mpirun --map-by core --bind-to core --report-bindings \
  -x OMP_NUM_THREADS -x OPENBLAS_NUM_THREADS \
  ./xhpl