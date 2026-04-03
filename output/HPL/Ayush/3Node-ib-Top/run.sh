#!/bin/bash
#SBATCH --job-name=hpl-3node-ib
#SBATCH --nodes=3
#SBATCH --nodelist=hpc-02,hpc-03,hpc-04
#SBATCH --exclude=hpc-05
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=8
#SBATCH --partition=batch
#SBATCH --time=01:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --output=run.sh-%j.out
#SBATCH --error=run.sh-%j.err

# --- OpenBLAS threading (8 cores per MPI task = 1 socket) ---
export OMP_NUM_THREADS=8
export OMP_PROC_BIND=close
export OMP_PLACES=cores
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
mpirun --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core --report-bindings \
  -x OMP_NUM_THREADS -x OMP_PROC_BIND -x OMP_PLACES -x OPENBLAS_NUM_THREADS \
  ./xhpl