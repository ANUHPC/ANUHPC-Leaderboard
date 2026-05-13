#!/bin/bash
#SBATCH --nodelist=hpc-03
#SBATCH --job-name=hpl-vtune
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=8
#SBATCH --cpus-per-task=1
#SBATCH --partition=batch
#SBATCH --time=02:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
#SBATCH --output=vtune-%j.out
#SBATCH --error=vtune-%j.err

# =========================================================
# Load VTune / Intel environment
# =========================================================
# Uncomment or adjust if your cluster uses modules

# module load intel
# module load vtune

# =========================================================
# Pure MPI configuration
# =========================================================
export OMP_NUM_THREADS=1
export OPENBLAS_NUM_THREADS=1

# =========================================================
# MPI / InfiniBand settings
# =========================================================
export OMPI_MCA_btl=openib,vader,self
export OMPI_MCA_pml=ob1
export OMPI_MCA_btl_openib_allow_ib=1
export OMPI_MCA_btl_openib_warn_default_gid_prefix=0

# =========================================================
# Ulimits
# =========================================================
ulimit -l unlimited
ulimit -n 65536

# =========================================================
# VTune collection
# =========================================================
vtune -collect hotspots \
      -trace-mpi \
      -result-dir vtune_hotspots_${SLURM_JOB_ID} \
      -- mpirun \
         --map-by core \
         --bind-to core \
         --report-bindings \
         -x OMP_NUM_THREADS \
         -x OPENBLAS_NUM_THREADS \
         ./xhpl