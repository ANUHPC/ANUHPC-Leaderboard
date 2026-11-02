#!/bin/bash
# intel HPL, N=314880 (85% of max N) NB=480 1x2, two solves:
# default pinning, then bound to physical cores with HPL_HOST_NODE off. ~82 min each

#SBATCH --job-name=hpl-launchpad-intel-nb480-bound
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=04:00:00
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
env | grep -E '^(I_MPI_|HPL_LOG=|HPL_LARGEPAGE=|HPL_HOST_)' | sort | sed 's/^/env     : /'
echo "governor: $(sort /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_governor 2>/dev/null | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}')"
echo "turbo   : no_turbo=$(cat /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null || echo n/a)"
echo "load    : $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null) (1, 5, 15 min, before the first solve)"
echo "pkg cap : $(for z in /sys/class/powercap/intel-rapl:[0-9]; do awk -v n="$(cat "$z/name")" '{printf "%s %.0f W  ", n, $1/1e6}' "$z/constraint_0_power_limit_uw"; done 2>/dev/null)"

trap 'kill $(jobs -p) 2>/dev/null' EXIT
trap 'exit 143' TERM INT

# numa, threads and power, sampled only while solving
out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
out=${out:-$PWD/run.out}
solving() { tail -n1 "$out" 2>/dev/null | grep -q 'Column='; }
# turbostat busy clock; /proc/cpuinfo shows the requested clock, not the real one
busy() { awk '/Bzy_MHz/ {for (i = 1; i <= NF; i++) c[$i] = i; next} c["Bzy_MHz"] && $1 + 0 > 0 {print $c["Bzy_MHz"]}' "$@"; }
failed=

# solve <test> <numa|cores>
solve() {
  local t=$1 bind=$2
  echo
  echo "test    : $t | NB 480 | binding $bind"
  sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
  echo "numa    : $(numactl -H | awk '/free:/{printf "node %s %d GiB free  ", $2, $4/1024}')"

  ( while sleep 10; do
      solving || continue
      [ -s "numa.$t.log" ] || numastat -p xhpl > "numa.$t.log" 2>&1
      # per rank, every sample: allowed cpus, busy threads, cores used, cores with both
      # hardware threads busy. cpu c and c+64 are one core
      for p in $(pgrep xhpl_intel64); do
        ps -L -o psr=,pcpu= -p "$p" | awk -v p="$p" -v a="$(sed -n 's/^Cpus_allowed_list:[[:space:]]*//p' "/proc/$p/status")" \
          '$2 > 50 {busy++; n[$1 % 64]++} END {for (c in n) {cores++; if (n[c] > 1) both++}; printf "%s %s %d %d %d\n", p, (a == "" ? "?" : a), busy, cores, both}'
      done >> "threads.$t.log" 2>/dev/null
    done ) &
  local sampler=$!
  ( while :; do
      solving || { sleep 10; continue; }
      sudo -n turbostat --quiet --Summary --show Bzy_MHz,PkgWatt,PkgTmp --interval 10 --num_iterations 1 2>/dev/null || sleep 10
    done ) > "power.$t.log" &
  local power=$!

  if [ "$bind" = cores ]; then
    # no MPI pinning and no HPL_HOST_NODE: both re-bind to the whole numa node
    # rank r -> cores r*32..r*32+31 and memory node r, one thread per core
    I_MPI_PIN=0 OMP_NUM_THREADS=$SLURM_CPUS_PER_TASK MKL_NUM_THREADS=$SLURM_CPUS_PER_TASK \
    KMP_AFFINITY=granularity=fine,compact mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
      bash -c 'r=$((PMI_RANK % SLURM_NTASKS_PER_NODE)) c=$SLURM_CPUS_PER_TASK
               exec numactl --physcpubind=$((r * c))-$((r * c + c - 1)) --membind=$r "$0"' "$IHPL"
  else
    # rank 0 -> numa node 0, rank 1 -> numa node 1
    mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
      bash -c 'export HPL_HOST_NODE=$((PMI_RANK % SLURM_NTASKS_PER_NODE)); exec numactl --localalloc "$0"' "$IHPL"
  fi
  local rc=$?
  kill "$sampler" "$power"

  local mhz watts gflops
  mhz=$(busy "power.$t.log" | awk '{s += $1; n++} END {if (n) printf "%.0f", s/n}')
  watts=$(awk '/PkgWatt/ {for (i = 1; i <= NF; i++) c[$i] = i; next} c["PkgWatt"] && $1 + 0 > 0 {s += $c["PkgWatt"]; n++} END {if (n) printf "%.0f", s/n}' "power.$t.log")
  awk -v t="$t" '/PkgWatt/ {for (i = 1; i <= NF; i++) c[$i] = i; next}
       c["PkgWatt"] && $1 + 0 > 0 {w = $c["PkgWatt"]; s += w; if (w > mw) mw = w; if (c["PkgTmp"]) {x = $c["PkgTmp"]; if (x > mt) mt = x}; f += $c["Bzy_MHz"]; n++}
       END {if (n) printf "power   : %s avg %.0f W, max %.0f W over both packages; pkg temp max %d C; busy %.0f MHz avg over %d samples\n", t, s/n, mw, mt, f/n, n
            else printf "power   : %s not measured (turbostat unavailable)\n", t}' "power.$t.log"
  [ -s "threads.$t.log" ] && awk -v t="$t" '!(($1, $2) in seen) {seen[$1, $2]; masks[$1] = masks[$1] " " $2}
       {k[$1]++; b[$1] += $3; u[$1] += $4; s[$1] += $5; if ($5 > m[$1]) m[$1] = $5}
       END {for (p in k) printf "threads : %s pid %s allowed%s: %.0f busy threads on %.0f cores, %.1f cores with both threads busy (max %d) over %d samples\n",
                                 t, p, masks[p], b[p]/k[p], u[p]/k[p], s[p]/k[p], m[p], k[p]}' "threads.$t.log"
  [ -s "numa.$t.log" ] && { echo "numa placement while solving, $t (MB):"; cat "numa.$t.log"; }
  # WR line after this test's marker
  gflops=$(awk -v t="$t" '/^test    : / {cur = $3} cur == t && $1 ~ /^W[RC]/ && NF >= 7 {g = $7} END {print g}' "$out")
  echo "$t ${gflops:--} ${mhz:--} ${watts:--}" >> results.txt
  [ "$rc" -eq 0 ] || { failed="$failed $t"; echo "failed  : $t exited $rc"; }
}

solve 1-nb480       numa
solve 2-nb480-cores cores

# vs 1-nb480
echo
awk 'NR == 1 {b = $2 + 0}
     {printf "summary : %-14s %9s GFLOPS  %8s  %5s MHz  %4s W\n", $1, ($2 == "-" ? "-" : sprintf("%.2f", $2)),
             ($2 == "-" || b <= 0 ? "-" : sprintf("%+.2f%%", ($2 / b - 1) * 100)), $3, $4}' results.txt
# the site reads the first cpu MHz line
busy power.*.log 2>/dev/null | sort -n | awk '{v[++n]=$1; s+=$1} END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples, median %.0f\n", s/n, v[1], v[n], n, v[int((n+1)/2)]}'
[ -z "$failed" ] || { echo "failed  :$failed"; exit 1; }
