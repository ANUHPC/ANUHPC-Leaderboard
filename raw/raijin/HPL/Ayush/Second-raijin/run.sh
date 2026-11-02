#!/bin/bash
#SBATCH --job-name=hpl-test
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=8
#SBATCH --partition=batch
#SBATCH --time=01:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread

# --- OpenBLAS threading (8 cores per MPI task) ---
export OMP_NUM_THREADS=8
export OMP_PROC_BIND=close
export OMP_PLACES=cores
export OPENBLAS_NUM_THREADS=8

# --- MPI transport: TCP over Ethernet, use SSH launcher (no srun on compute nodes) ---
export OMPI_MCA_btl=tcp,self
export OMPI_MCA_btl_tcp_if_include=enp32s0f0
export OMPI_MCA_pml=ob1
export OMPI_MCA_plm=rsh

# Ulimits
ulimit -l unlimited
ulimit -n 65536

# Run HPL — single line to avoid line-continuation issues
mpirun --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core --report-bindings -x OMP_NUM_THREADS -x OMP_PROC_BIND -x OMP_PLACES -x OPENBLAS_NUM_THREADS ./xhpl