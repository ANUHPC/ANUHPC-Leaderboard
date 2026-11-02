#!/bin/bash
# cpu HPL on launchpad, intel layout: 1 rank per socket, NB=384, P x Q = 1 x 2

#SBATCH --job-name=hpl-launchpad-2x32-nb384
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=04:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread


OPENBLAS=/data/benchmarks/openblas/0.3.34       
HPL=/data/benchmarks/hpl/current                
export LD_LIBRARY_PATH=$OPENBLAS/lib:${LD_LIBRARY_PATH:-}
export PATH=/usr/bin:$PATH                      

# single node, shared memory only
export UCX_TLS=sm,self

# 32 OpenBLAS threads per rank, one rank per socket
export OMP_NUM_THREADS=${SLURM_CPUS_PER_TASK:-32}
export OPENBLAS_NUM_THREADS=${SLURM_CPUS_PER_TASK:-32}
export OMP_PROC_BIND=close
export OMP_PLACES=cores

ulimit -l unlimited
ulimit -n 65536

echo "node    : $(hostname -s)"
echo "cpu     : $(lscpu | sed -n 's/^Model name: *//p')"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} threads"
echo "binary  : $(readlink -f ./xhpl) (from $(readlink -f $HPL))"
echo "blas    : $(ldd ./xhpl | awk '/openblas|mkl|blis/{print $3}' | xargs -r readlink -f)"
echo "mpi     : $(mpirun --version | head -1)"

# log the real clock under load for the peak calc.
# max of the two SMT siblings per core, the idle one reads ~800 MHz
( while sleep 10; do
    awk -F'\n' 'BEGIN{RS=""} {for (i=1; i<=NF; i++) {split($i, kv, /\t*: /); f[kv[1]]=kv[2]}
                k=f["physical id"] "-" f["core id"]; if (f["cpu MHz"]+0 > m[k]) m[k]=f["cpu MHz"]+0}
                END{for (k in m) {s+=m[k]; n++} if (n) printf "%.0f\n", s/n}' /proc/cpuinfo
  done ) > cpufreq.log &
sampler=$!

# rank 0 -> socket 0 (cores 0-31), rank 1 -> socket 1 (cores 32-63).
# binding to the socket keeps each rank's 432 GB on its own NUMA node (first touch).
# --report-bindings puts the proof in run.err for the report
mpirun -np "${SLURM_NTASKS}" --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core \
       --report-bindings ./xhpl
rc=$?

kill "$sampler" 2>/dev/null
awk '{s+=$1; n++; if (n==1 || $1<lo) lo=$1; if ($1>hi) hi=$1}
     END{if(n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples 10 s apart (mean over the 64 cores)\n", s/n, lo, hi, n}' cpufreq.log
exit $rc
