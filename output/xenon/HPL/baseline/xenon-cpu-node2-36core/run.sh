#!/bin/bash
#SBATCH --job-name=hpl-xenon-baseline
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=4
#SBATCH --cpus-per-task=9
#SBATCH --partition=cpu
#SBATCH --time=01:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread

export PATH=/apps/openmpi/5.0.10/bin:$PATH
export LD_LIBRARY_PATH=/apps/openmpi/5.0.10/lib:/apps/ucx/1.22.0/lib:${LD_LIBRARY_PATH:-}
export UCX_NET_DEVICES=mlx5_0:1
export PMIX_MCA_pcompress_base_silence_warning=1
# No CUDA on the cpu partition; stop OpenMPI probing for it.
export OMPI_MCA_accelerator=^cuda

export OMP_NUM_THREADS=${SLURM_CPUS_PER_TASK:-9}
export OPENBLAS_NUM_THREADS=${SLURM_CPUS_PER_TASK:-9}
export OMP_PROC_BIND=close
export OMP_PLACES=cores

ulimit -l unlimited
ulimit -n 65536

echo "node    : $(hostname -s)"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} threads"
echo "binary  : $(readlink -f ./xhpl)"
mpirun -np "${SLURM_NTASKS}" --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core ./xhpl
