#!/bin/bash
# intel HPL N sweep, NB=480 1x2, N = 50 70 89 91 93% of max N
# all Ns are multiples of NB*Q = 960 so no partial blocks. ~6 h

#SBATCH --job-name=hpl-launchpad-intel-n-sweep
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

# max N = sqrt(1 TiB / 8)
maxn=370728
best=4277.45

echo "cpu     : $(lscpu | sed -n 's/^Model name: *//p')"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} cores"
echo "binary  : $IHPL"
echo "sha256  : $(sha256sum "$IHPL" | cut -c1-64)"
echo "blas    : oneMKL $(dpkg-query -W -f='${Version}' intel-oneapi-mkl-core-devel-2026.1)"
echo "mpi     : $(mpirun --version | head -1)"
echo "fan     : mode $(sudo -n ipmitool raw 0x30 0x45 0x00 | tr -d ' ') (01 full, 02 optimal)"
echo "governor: $(sort /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_governor 2>/dev/null | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}')"
echo "turbo   : no_turbo=$(cat /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null || echo n/a)"
echo "pkg cap : $(for z in /sys/class/powercap/intel-rapl:[0-9]; do awk -v n="$(cat "$z/name")" '{printf "%s %.0f W  ", n, $1/1e6}' "$z/constraint_0_power_limit_uw"; done 2>/dev/null)"
env | grep -E '^(I_MPI_|HPL_LOG=|HPL_LARGEPAGE=|HPL_HOST_)' | sort | sed 's/^/env     : /'

sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
echo "numa    : $(numactl -H | awk '/free:/{printf "node %s %d GiB free  ", $2, $4/1024}')"

# check each N fits NB*Q and memory
nb=$(awk 'NR == 8 {print $1}' HPL.dat)
free=$(numactl -H | awk '/free:/ {if (m == "" || $4 < m) m = $4} END {print int(m / 1024)}')
for n in $(awk 'NR == 6 {for (i = 1; i <= NF && $i ~ /^[0-9]+$/; i++) print $i}' HPL.dat); do
  awk -v n="$n" -v nb="$nb" -v maxn="$maxn" -v free="$free" 'BEGIN {g = 4 * n * n / 2^30
    printf "n       : %d, %.1f%% of max N, %g blocks, %.0f of %d GiB a rank%s\n", n, 100 * n / maxn, n / nb, g, free,
      (n % (2 * nb) ? ", not a multiple of " 2 * nb : "") (free && g + 10 > free ? ", may not fit" : "")}'
done

# power + clock + temp per N, sampled only while solving
out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
out=${out:-$PWD/run.out}
solving() { tail -n1 "$out" 2>/dev/null | grep -q 'Column='; }
( set -o pipefail
  while :; do
    solving || { sleep 10; continue; }
    k=$(grep -c '^W[RC]' "$out")
    sudo -n turbostat --quiet --Summary --show Bzy_MHz,PkgWatt,PkgTmp --interval 10 --num_iterations 1 2>/dev/null |
      awk -v k="$k" '/PkgWatt/ {for (i = 1; i <= NF; i++) c[$i] = i; next} $1 + 0 > 0 {print k, $c["Bzy_MHz"], $c["PkgWatt"], $c["PkgTmp"]}' || sleep 10
  done ) > power.log &
power=$!

# rank 0 -> numa node 0, rank 1 -> numa node 1
mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
       bash -c 'export HPL_HOST_NODE=$((PMI_RANK % SLURM_NTASKS_PER_NODE)); exec numactl --localalloc "$0"' "$IHPL"
rc=$?
kill "$power" 2>/dev/null

# per N vs old best
echo
awk -v nb="$nb" -v maxn="$maxn" -v best="$best" 'BEGIN {k = 0}
  FILENAME == ARGV[1] {m[$1] += $2; w[$1] += $3; if ($4 > t[$1]) t[$1] = $4; c[$1]++; next}
  $1 ~ /^W[RC]/ && NF >= 7 {n[k] = $2; s[k] = $6; g[k] = $7; k++; next}
  /\.\.\.\.\.\. (PASSED|FAILED)/ {r[k - 1] = $NF}
  END {for (i = 0; i < k; i++)
         printf "summary : N %6d  %4.1f%%  %3d blocks  %8.2f GFLOPS  %+6.2f%% vs %s  %5.0f s  %4s MHz  %3s W  %2s C  %s\n", n[i], 100 * n[i] / maxn,
                n[i] / nb, g[i], (g[i] / best - 1) * 100, best, s[i], (c[i] ? sprintf("%.0f", m[i] / c[i]) : "-"),
                (c[i] ? sprintf("%.0f", w[i] / c[i]) : "-"), (c[i] ? t[i] : "-"), r[i]}' power.log "$out"

# GFLOPS vs N
awk '$1 ~ /^W[RC]/ && NF >= 7 {k++; n[k] = $2; g[k] = $7 + 0}
  END {if (k < 2) exit
    W = 48; H = 12; xl = xh = n[1]; yl = yh = g[1]
    for (i = 2; i <= k; i++) {if (n[i] < xl) xl = n[i]; if (n[i] > xh) xh = n[i]; if (g[i] < yl) yl = g[i]; if (g[i] > yh) yh = g[i]}
    if (xh == xl) xh++; if (yh == yl) yh++
    for (i = 1; i <= k; i++) {col[i] = int((n[i] - xl) / (xh - xl) * (W - 1) + 0.5); row[i] = int((g[i] - yl) / (yh - yl) * (H - 1) + 0.5)}
    blank = ""; for (j = 0; j < W; j++) blank = blank " "
    dash = blank; gsub(/ /, "-", dash)
    print ""; print "graph   : GFLOPS vs N, NB 480"
    for (r = H - 1; r >= 0; r--) {
      line = blank; lab = ""
      for (i = 1; i <= k; i++) if (row[i] == r) {line = substr(line, 1, col[i]) "*" substr(line, col[i] + 2); lab = lab " " n[i]}
      sub(/ +$/, "", line)
      o = sprintf("%7s | %s%s", (r == H - 1) ? sprintf("%.0f", yh) : (r == 0 ? sprintf("%.0f", yl) : ""), line, lab); sub(/ +$/, "", o); print o
    }
    printf "        +-%s\n          %d%" (W - length(xl "")) "d\n", dash, xl, xh}' "$out"

# site reads the first cpu MHz line
bestk=$(awk 'BEGIN {k = 0} $1 ~ /^W[RC]/ && NF >= 7 {if ($7 + 0 > g) {g = $7 + 0; b = k}; k++} END {print b}' "$out")
[ -n "$bestk" ] && awk -v k="$bestk" '$1 == k {print $2}' power.log | sort -n |
  awk '{v[++n]=$1; s+=$1} END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples, median %.0f (best N)\n", s/n, v[1], v[n], n, v[int((n+1)/2)]}'
exit $rc
