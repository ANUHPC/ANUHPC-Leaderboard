#!/bin/bash
#SBATCH --job-name=hpl-ib-test
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=8
#SBATCH --partition=batch
#SBATCH --time=00:50:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --output=run.sh-%j.out
#SBATCH --error=run.sh-%j.err

# --- OpenBLAS threading (8 cores per MPI task) ---
export OMP_NUM_THREADS=8
export OMP_PROC_BIND=close
export OMP_PLACES=cores
export OPENBLAS_NUM_THREADS=8

# --- MPI transport: InfiniBand (56 Gb/s FDR) ---
export OMPI_MCA_btl=openib,self,vader
export OMPI_MCA_btl_openib_if_include=mlx4_0
export OMPI_MCA_btl_openib_allow_ib=1
export OMPI_MCA_btl_openib_warn_no_device_params_found=0
export OMPI_MCA_pml=ob1
export OMPI_MCA_plm=rsh
export OMPI_MCA_plm_rsh_agent="ssh -o StrictHostKeyChecking=no"
export OMPI_MCA_orte_keep_fqdn_hostnames=t

# Ulimits
ulimit -l unlimited
ulimit -n 65536

# Run HPL
mpirun --mca routed direct \
       --map-by socket:PE=8 --bind-to core --report-bindings \
       -x OMP_NUM_THREADS -x OMP_PROC_BIND -x OMP_PLACES -x OPENBLAS_NUM_THREADS ./xhpl