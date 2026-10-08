#!/bin/bash
# full size cpu HPL on launchpad, N=333312 NB=384 P x Q = 1 x 2, one rank per socket

#SBATCH --job-name=hpl-launchpad-full-n333312
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=04:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread

# OpenBLAS 0.3.34 (SAPPHIRERAPIDS, OpenMP), netlib HPL 2.3, ubuntu OpenMPI 4.1.6
export LD_LIBRARY_PATH=/data/benchmarks/openblas/0.3.34/lib:${LD_LIBRARY_PATH:-}
export UCX_TLS=sm,self

export OMP_NUM_THREADS=${SLURM_CPUS_PER_TASK:-32}
export OPENBLAS_NUM_THREADS=${SLURM_CPUS_PER_TASK:-32}
export OMP_PROC_BIND=close
export OMP_PLACES=cores

ulimit -l unlimited
ulimit -n 65536

echo "cpu     : $(lscpu | sed -n 's/^Model name: *//p')"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} threads"
echo "blas    : $(ldd ./xhpl | awk '/openblas|mkl|blis/{print $3}' | xargs -r readlink -f)"
echo "mpi     : $(mpirun --version | head -1)"

# each rank needs ~417 GiB on its own socket. without dropping the page cache
sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
echo "numa    : $(numactl -H | awk '/free:/{printf "node %s %d GiB free  ", $2, $4/1024}')"

# clock under load for the peak calc, only sampled mid-solve (last line is a Column= line).
out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
solving() { tail -n1 "$out" 2>/dev/null | grep -q '^Column='; }
( while sleep 10; do
    solving || continue
    [ -s numa.log ] || numastat -p xhpl > numa.log 2>&1
    awk -F'\n' 'BEGIN{RS=""} {for (i=1; i<=NF; i++) {split($i, kv, /\t*: /); f[kv[1]]=kv[2]}
                k=f["physical id"] "-" f["core id"]; if (f["cpu MHz"]+0 > m[k]) m[k]=f["cpu MHz"]+0}
                END{for (k in m) {s+=m[k]; n++} printf "%.0f\n", s/n}' /proc/cpuinfo
  done ) > cpufreq.log &
sampler=$!

# rank 0 on socket 0, rank 1 on socket 1, memory stays local
mpirun -np "${SLURM_NTASKS}" --map-by socket:PE=${SLURM_CPUS_PER_TASK} --bind-to core \
       --report-bindings ./xhpl
rc=$?

kill "$sampler"
awk '{s+=$1; n++; if (n==1 || $1<lo) lo=$1; if ($1>hi) hi=$1}
     END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples\n", s/n, lo, hi, n}' cpufreq.log
[ -s numa.log ] && { echo "numa placement while solving (MB):"; cat numa.log; }
exit $rc
