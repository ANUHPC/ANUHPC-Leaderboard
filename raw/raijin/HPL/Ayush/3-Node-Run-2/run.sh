#!/bin/bash
#SBATCH --job-name=hpl-3node
#SBATCH --nodes=3
#SBATCH --ntasks-per-node=16
#SBATCH --cpus-per-task=1
#SBATCH --partition=batch
#SBATCH --time=05:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --output=run.sh-%j.out
#SBATCH --error=run.sh-%j.err

# --- Single-threaded BLAS (pure MPI, 1 process per core) ---
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1

# --- MPI transport: TCP over Ethernet, SSH launcher (no srun) ---
export OMPI_MCA_btl=tcp,self
export OMPI_MCA_btl_tcp_if_include=enp32s0f0
export OMPI_MCA_pml=ob1
export OMPI_MCA_plm=rsh
export OMPI_MCA_plm_rsh_agent="ssh -o StrictHostKeyChecking=no"

# Ulimits
ulimit -l unlimited
ulimit -n 65536

# Run HPL
mpirun --mca routed direct \
       --map-by core --bind-to core --report-bindings \
       -x OMP_NUM_THREADS -x OPENBLAS_NUM_THREADS ./xhpl