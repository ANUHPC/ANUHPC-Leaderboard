#!/bin/bash
#SBATCH --job-name=hpl-3node
#SBATCH --nodes=3
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
       --map-by core --bind-to core --report-bindings \
       -x OMP_NUM_THREADS -x OPENBLAS_NUM_THREADS ./xhpl