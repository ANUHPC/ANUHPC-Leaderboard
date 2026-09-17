#!/bin/bash
# HPL on Xenon. Copy this to your run directory AS run.sh:
#     cp run.xenon.sh <your-run-dir>/run.sh
# Do not use run.raijin.sh here -- it asks for --partition=batch, which does
# not exist on Xenon, and forces MPI over Ethernet.

#SBATCH --job-name=hpl-CHANGE-ME
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=4
#SBATCH --cpus-per-task=9
#SBATCH --partition=cpu
#SBATCH --time=01:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread

# Partitions: cpu (cpu-node2, 72 threads) | gpu (2 x 4 A100) | all
# ntasks-per-node x cpus-per-task must equal the physical cores you want.
# --hint=nomultithread keeps HPL off the SMT siblings; HPL gains nothing from
# them and loses to the cache contention.

export PATH=/apps/openmpi/5.0.10/bin:$PATH
export LD_LIBRARY_PATH=/apps/openmpi/5.0.10/lib:/apps/ucx/1.22.0/lib:${LD_LIBRARY_PATH:-}

# Fabric: 56 Gb/s FDR InfiniBand on all four nodes.
#
# Do NOT set UCX_NET_DEVICES. The kernel names the HCA after its PCI slot and
# the name differs by node type -- ibp129s0 on the cpu nodes, ibp161s0 on the
# gpu nodes -- so any single value is wrong on half the cluster and UCX just
# warns and falls back. Raijin measured autodetect faster than pinning anyway
# (47.3 vs 42.7 Gbit/s). If you ever must pin it, name every device:
#     UCX_NET_DEVICES=ibp129s0:1,ibp161s0:1
#
# UCX_TLS is the setting that matters: with rc (RDMA) and no tcp, UCX fails
# loudly rather than quietly dropping to the 1 GbE management network and
# handing you a multi-node number that means nothing.
export UCX_TLS=rc,sm,self
export PMIX_MCA_pcompress_base_silence_warning=1

# No CUDA on the cpu partition; stop OpenMPI probing for it. Drop this line if
# you are running on the gpu partition.
export OMPI_MCA_accelerator=^cuda

export OMP_NUM_THREADS=${SLURM_CPUS_PER_TASK:-9}
export OPENBLAS_NUM_THREADS=${SLURM_CPUS_PER_TASK:-9}
export OMP_PROC_BIND=close
export OMP_PLACES=cores

ulimit -l unlimited
ulimit -n 65536

# Never hardcode --nodelist. Let Slurm place the job; node names differ
# between clusters and a stale nodelist fails only after it has queued.

echo "node    : $(hostname -s)"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} threads"
echo "fabric  : $(ls /sys/class/infiniband/ 2>/dev/null | tr '\n' ' ')(UCX_TLS=${UCX_TLS})"
echo "binary  : $(readlink -f ./xhpl)"

# xhpl is staged into this directory from /apps by the submit workflow.
mpirun -np "${SLURM_NTASKS}" --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core ./xhpl
