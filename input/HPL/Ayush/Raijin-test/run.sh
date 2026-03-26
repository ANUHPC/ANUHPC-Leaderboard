#!/bin/bash
#SBATCH --job-name=HPL-test
#SBATCH --partition=batch
#SBATCH --nodes=2
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=8
#SBATCH --time=00:30:00
#SBATCH --exclusive

export OMP_NUM_THREADS=${SLURM_CPUS_PER_TASK}
export OMP_PROC_BIND=close
export OMP_PLACES=cores

echo "=== HPL Test Run ==="
echo "Date: $(date)"
echo "Nodes: $(scontrol show hostname $SLURM_JOB_NODELIST | paste -sd,)"
echo "Tasks: $SLURM_NTASKS"
echo "CPUs per task: $SLURM_CPUS_PER_TASK"
echo "OMP_NUM_THREADS: $OMP_NUM_THREADS"
echo "==================="

mpirun --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core \
  --mca btl ^openib \
  ./xhpl
  