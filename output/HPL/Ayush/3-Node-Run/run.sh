#!/bin/bash
#SBATCH --job-name=hpl-3node
#SBATCH --nodes=3
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=8
#SBATCH --partition=batch
#SBATCH --time=02:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --output=run.sh-%j.out
#SBATCH --error=run.sh-%j.err

# --- OpenBLAS threading (8 cores per MPI task) ---
export OMP_NUM_THREADS=8
export OMP_PROC_BIND=close
export OMP_PLACES=cores
export OPENBLAS_NUM_THREADS=8

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
mpirun --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core --report-bindings -x OMP_NUM_THREADS -x OMP_PROC_BIND -x OMP_PLACES -x OPENBLAS_NUM_THREADS ./xhpl