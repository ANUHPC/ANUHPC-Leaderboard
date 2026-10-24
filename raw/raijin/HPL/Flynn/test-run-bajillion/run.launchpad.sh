#!/bin/bash
# CPU HPL on Launchpad. Copy to your run directory AS run.sh:
#     cp run.launchpad.sh <your-run-dir>/run.sh
# GPU HPL is the HPL_NVIDIA suite, not this.

#SBATCH --job-name=hpl-CHANGE-ME
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=4
#SBATCH --cpus-per-task=16
#SBATCH --partition=all
#SBATCH --time=01:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread

# 2x Xeon Gold 6548Y+, 64 physical cores (0-31 socket 0, 32-63 socket 1), 1 TiB RAM.
#
# ntasks-per-node x cpus-per-task must be <= 64. 4 x 16 = 2 ranks per socket,
# matches the 2 x 2 grid in the template HPL.dat. Change P x Q if you change ranks.
#
# memory is 8 x N^2 bytes. N=20000 is just a smoke test. 4 x 16 with N=100000 took
# 282 s (2.37 TFLOP/s), N=200000 (~300 GB) will need ~40 min so raise --time.

# single node, shared memory only
export UCX_TLS=sm,self

export OMP_NUM_THREADS=${SLURM_CPUS_PER_TASK:-16}
export OPENBLAS_NUM_THREADS=${SLURM_CPUS_PER_TASK:-16}
export OMP_PROC_BIND=close
export OMP_PLACES=cores

ulimit -l unlimited
ulimit -n 65536

echo "node    : $(hostname -s)"
echo "cpu     : $(lscpu | sed -n 's/^Model name: *//p')"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} threads"
echo "binary  : $(readlink -f ./xhpl)"
echo "blas    : $(ldd ./xhpl | awk '/openblas|mkl|blis/{print $3}' | xargs -r readlink -f)"
echo "mpi     : $(mpirun --version | head -1)"

# log the real clock under load for the peak calc.
# max of the two SMT siblings per core, the idle one reads ~800 MHz.
# only while HPL is solving (it prints Column= lines then), matrix generation reads low.
# a binary without the progress report gets every sample
out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
solving=true; grep -q 'Column=%09d' ./xhpl && solving="grep -q ^Column= $out"
( while sleep 10; do
    $solving 2>/dev/null || continue
    awk -F'\n' 'BEGIN{RS=""} {for (i=1; i<=NF; i++) {split($i, kv, /\t*: /); f[kv[1]]=kv[2]}
                k=f["physical id"] "-" f["core id"]; if (f["cpu MHz"]+0 > m[k]) m[k]=f["cpu MHz"]+0}
                END{for (k in m) {s+=m[k]; n++} if (n) printf "%.0f\n", s/n}' /proc/cpuinfo
  done ) > cpufreq.log &
sampler=$!

# xhpl gets copied in from /data/benchmarks by the workflow
mpirun -np "${SLURM_NTASKS}" --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core ./xhpl
rc=$?

kill "$sampler" 2>/dev/null
awk '{s+=$1; n++; if (n==1 || $1<lo) lo=$1; if ($1>hi) hi=$1}
     END{if(n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples 10 s apart (mean over the 64 cores)\n", s/n, lo, hi, n}' cpufreq.log
exit $rc
