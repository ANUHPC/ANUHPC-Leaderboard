#!/bin/bash
# intel HPL NB sweep, N=329856 (89% of max N) 1x2, from Intel-Max-Fans-85%-N
# NB 320 384 448 480: NB*NB*8 bytes = 0.78-1.76 MiB, inside the 2 MiB L2 per core

#SBATCH --job-name=hpl-launchpad-intel-n89-nb-sweep
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=07:30:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread

# intel-oneapi-mkl-core-devel-2026.1, intel MPI 2021.18
IHPL=/opt/intel/oneapi/mkl/2026.1/share/mkl/benchmarks/mp_linpack/xhpl_intel64_dynamic
source /opt/intel/oneapi/mpi/2021.18/env/vars.sh

export I_MPI_FABRICS=shm
export I_MPI_HYDRA_BOOTSTRAP=fork
export I_MPI_PIN_DOMAIN=numa
export I_MPI_DEBUG=4
export HPL_LOG=1

ulimit -l unlimited
ulimit -n 65536

echo "cpu     : $(lscpu | sed -n 's/^Model name: *//p')"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} cores"
echo "binary  : $IHPL"
echo "sha256  : $(sha256sum "$IHPL" | cut -c1-64)"
echo "blas    : oneMKL $(dpkg-query -W -f='${Version}' intel-oneapi-mkl-core-devel-2026.1)"
echo "mpi     : $(mpirun --version | head -1)"
echo "fan     : mode $(sudo -n ipmitool raw 0x30 0x45 0x00 | tr -d ' ') (01 full, 02 optimal)"
echo "governor: $(cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_governor 2>/dev/null || echo unknown), epp $(cat /sys/devices/system/cpu/cpu0/cpufreq/energy_performance_preference 2>/dev/null || echo n/a)"

echo "pkg cap : $(for z in /sys/class/powercap/intel-rapl:[0-9]; do awk -v n="$(cat "$z/name")" '{printf "%s %.0f W  ", n, $1/1e6}' "$z/constraint_0_power_limit_uw"; done 2>/dev/null)"
env | grep -E '^(I_MPI_|HPL_LOG=|HPL_LARGEPAGE=|HPL_HOST_)' | sort | sed 's/^/env     : /'

sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
echo "numa    : $(numactl -H | awk '/free:/{printf "node %s %d GiB free  ", $2, $4/1024}')"

# clock + numa placement, sampled only while solving
out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
solving() { tail -n1 "$out" 2>/dev/null | grep -q 'Column='; }
( while sleep 10; do
    solving || continue
    [ -s numa.log ] || numastat -p xhpl > numa.log 2>&1
    awk -F'\n' 'BEGIN{RS=""} {for (i=1; i<=NF; i++) {split($i, kv, /\t*: /); f[kv[1]]=kv[2]}
                k=f["physical id"] "-" f["core id"]; if (f["cpu MHz"]+0 > m[k]) m[k]=f["cpu MHz"]+0}
                END{for (k in m) {s+=m[k]; n++} printf "%.0f\n", s/n}' /proc/cpuinfo
  done ) > cpufreq.log &
sampler=$!


( while :; do
    solving || { sleep 10; continue; }
    sudo -n turbostat --quiet --Summary --show Bzy_MHz,PkgWatt,PkgTmp --interval 10 --num_iterations 1 2>/dev/null || sleep 10
  done ) > power.log &
power=$!

# rank 0 -> numa node 0, rank 1 -> numa node 1
mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
       bash -c 'export HPL_HOST_NODE=$((PMI_RANK % SLURM_NTASKS_PER_NODE)); exec numactl --localalloc "$0"' "$IHPL"
rc=$?

kill "$sampler" "$power"
awk '/PkgWatt/ {for (i = 1; i <= NF; i++) c[$i] = i; next}
     c["PkgWatt"] && $1 + 0 > 0 {w = $c["PkgWatt"]; s += w; if (w > mw) mw = w; if (c["PkgTmp"]) {t = $c["PkgTmp"]; if (t > mt) mt = t}; f += $c["Bzy_MHz"]; n++}
     END {if (n) printf "power   : avg %.0f W, max %.0f W over both packages; pkg temp max %d C; busy %.0f MHz avg over %d samples\n", s/n, mw, mt, f/n, n
          else print "power   : not measured (turbostat unavailable)"}' power.log
sort -n cpufreq.log | awk '{v[++n]=$1; s+=$1} END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples, median %.0f\n", s/n, v[1], v[n], n, v[int((n+1)/2)]}'
[ -s numa.log ] && { echo "numa placement while solving (MB):"; cat numa.log; }
exit $rc
