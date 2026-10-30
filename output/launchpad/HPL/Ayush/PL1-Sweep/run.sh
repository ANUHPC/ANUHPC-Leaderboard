#!/bin/bash
# intel HPL 1x2, N=100800 NB=480. PL1 250 225 200 175 150 W per package, 3 solves each, against the power measured

#SBATCH --job-name=hpl-launchpad-intel-pl1-sweep
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=03:00:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread

IHPL=/opt/intel/oneapi/mkl/2026.1/share/mkl/benchmarks/mp_linpack/xhpl_intel64_dynamic
source /opt/intel/oneapi/mpi/2021.18/env/vars.sh

export I_MPI_FABRICS=shm
export I_MPI_HYDRA_BOOTSTRAP=fork
export I_MPI_PIN_DOMAIN=numa
export I_MPI_DEBUG=4
export HPL_LOG=1

ulimit -l unlimited
ulimit -n 65536

levels="250 225 200 175 150 150 175 200 225 250 250 225 200 175 150"
pl1=250000000
pl2=300000000
C=/sys/devices/system/cpu
P=/sys/class/powercap

echo "cpu     : $(lscpu | sed -n 's/^Model name: *//p')"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} cores"
echo "binary  : $IHPL"
echo "sha256  : $(sha256sum "$IHPL" | cut -c1-64)"
echo "blas    : oneMKL $(dpkg-query -W -f='${Version}' intel-oneapi-mkl-core-devel-2026.1)"
echo "mpi     : $(mpirun --version | head -1)"
echo "fan     : mode $(sudo -n ipmitool raw 0x30 0x45 0x00 | tr -d ' ') (01 full, 02 optimal)"
echo "governor: $(sort $C/cpu[0-9]*/cpufreq/scaling_governor 2>/dev/null | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}')"
echo "turbo   : no_turbo=$(cat $C/intel_pstate/no_turbo 2>/dev/null || echo n/a)"
echo "gpu     : $(nvidia-smi --query-gpu=pstate,power.draw,memory.used --format=csv,noheader 2>/dev/null | paste -sd';' -)"
env | grep -E '^(I_MPI_|HPL_LOG=|HPL_LARGEPAGE=|HPL_HOST_)' | sort | sed 's/^/env     : /'
p=$(pgrep -f 'vllm|ollama serve|wrf\.exe|real\.exe|\.vscode-server/|code-server/.*extensionHost' | paste -sd' ' -)
[ -z "$p" ] || echo "warning : wrf, vllm, ollama or an editor window still running (pids $p)"

put() { sudo -n sh -c 'v=$1; shift; for f; do echo "$v" > "$f"; done' sh "$@"; }
zones=()
for z in "$P"/intel-rapl:[0-9]; do grep -q '^package' "$z/name" 2>/dev/null && zones+=("$z"); done
[ ${#zones[@]} -eq 2 ] || { echo "failed  : ${#zones[@]} package power zones, expected 2"; exit 1; }
pl() { local z; for z in "${zones[@]}"; do printf '%s PL1 %d W PL2 %d W  ' "$(cat "$z/name")" $(($(cat "$z/constraint_0_power_limit_uw") / 1000000)) $(($(cat "$z/constraint_1_power_limit_uw") / 1000000)); done; }
limits_ok() { local z; for z in "${zones[@]}"; do [ "$(cat "$z/constraint_0_power_limit_uw")-$(cat "$z/constraint_1_power_limit_uw")" = "$pl1-$pl2" ] || return 1; done; }
restore() { local z; for z in "${zones[@]}"; do put $pl1 "$z/constraint_0_power_limit_uw"; put $pl2 "$z/constraint_1_power_limit_uw"; done; }
setpl() { local z uw=$(($1 * 1000000)); for z in "${zones[@]}"; do put $uw "$z/constraint_0_power_limit_uw"; [ "$(cat "$z/constraint_0_power_limit_uw")" = "$uw" ] || return 1; done; }

limits_ok || { echo "guard   : found $(pl)reset to 250 and 300 W"; restore; }
limits_ok || { echo "failed  : could not reset the power limits, $(pl)"; exit 1; }
echo "limits  : $(pl)"
echo "uncore  : $(cat $C/intel_uncore_frequency/package_*_die_00/max_freq_khz 2>/dev/null | paste -sd' ' -) kHz max"

msr() { sudo -n dd if="/dev/cpu/$1/msr" bs=8 count=1 skip=$(($2)) iflag=skip_bytes status=none 2>/dev/null | od -An -tx8 | tr -d ' \n'; }
rapl() { local c u l i; for c in 0 32; do u=$(msr $c 0x606); l=$(msr $c 0x610); i=$(msr $c 0x614)
    [ -n "$u" ] && [ -n "$l" ] && [ -n "$i" ] || { printf 'cpu%s msr unreadable  ' $c; continue; }
    awk -v c=$c -v u=$(( 16#$u & 15 )) -v l1=$(( 16#$l & 32767 )) -v l2=$(( (16#$l >> 32) & 32767 )) -v lk=$(( (16#$l >> 63) & 1 )) \
        -v td=$(( 16#$i & 32767 )) -v mx=$(( (16#$i >> 32) & 32767 )) \
      'BEGIN {s = 2 ^ -u; printf "cpu%s PL1 %.0f W PL2 %.0f W lock %s, TDP %.0f W max %.0f W  ", c, l1 * s, l2 * s, (lk ? "on" : "off"), td * s, (mx ? mx * s : 0)}'
  done; }
echo "rapl    : $(rapl)"

wd=hpl-pl1-$SLURM_JOB_ID
if sudo -n systemd-run --quiet --unit="$wd" --on-active=11100s /bin/sh -c \
     "for z in ${zones[*]}; do echo $pl1 > \$z/constraint_0_power_limit_uw; echo $pl2 > \$z/constraint_1_power_limit_uw; done"; then
  echo "watchdog: $wd restores the power limits in 11100 s if the job dies"
else
  echo "warning : no restore watchdog, systemd-run failed"
fi
trap 'restore; limits_ok && sudo -n systemctl stop "$wd.timer" 2>/dev/null; pkill -P $$ 2>/dev/null; echo "restored: $(pl)msr 0x610 $(msr 0 0x610) $(msr 32 0x610)"' EXIT
trap 'exit 143' TERM INT

out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
out=${out:-$PWD/run.out}
solving() { tail -n1 "$out" 2>/dev/null | grep -q 'Column='; }
busy() { awk '$1 == "cpu" {printf "%.2f\n", ($2 + $3 + $4 + $7 + $8 + $9) / 100}' /proc/stat 2>/dev/null; }
kids() { awk 'NR == 2 {for (i = 1; i <= 2; i++) {split($i, v, "m"); s += 60 * v[1] + v[2]}} END {printf "%.2f\n", s}' "$1"; }
snap() { ps -eo pid=,times=,comm= 2>/dev/null > "$1"; }
hogs() { awk -v dt="$3" 'FNR == NR {s[$1] = $2; next} {d = $2 - ($1 in s ? s[$1] : 0); c = $3; for (i = 4; i <= NF; i++) c = c " " $i; if (d > 0) g[c] += d}
  END {for (c in g) if (dt > 0 && g[c] / dt >= 0.02) printf "%.2f %s\n", g[c] / dt, c}' "$1" "$2" | sort -rn | head -4 | awk '{printf "%s%s %s", (NR > 1 ? ", " : ""), $2, $1}'; }
energy() { local z; for z in "${zones[@]}"; do sudo -n cat "$z/energy_uj" 2>/dev/null; done | paste -sd' ' -; }
mhzs() { awk '/Bzy_MHz/ {for (i = 1; i <= NF; i++) c[$i] = i; next} c["Bzy_MHz"] && $1 + 0 > 0 {print $c["Bzy_MHz"]}' "$@"; }

b0=$(busy); snap ps.0; sleep 10; snap ps.1
echo "load    : $(awk -v b="$(busy)" -v b0="$b0" 'BEGIN {printf "%.2f", (b > b0 ? (b - b0) / 10 : 0)}') cores busy before the first solve, k8s alone is ~0.6 | $(hogs ps.0 ps.1 10)"

failed=
solve() {
  local t=$1 w=$2 rc power b0 k0 k1 st e0 ol watts mhz tmax wall gflops res
  mkdir -p "$t"
  cp HPL.dat "$t/"
  echo
  echo "test    : $t | PL1 $w W | N 100800 | NB 480 | $(pl)| msr 0x610 $(msr 0 0x610) $(msr 32 0x610)"
  sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
  b0=$(busy); times > tm; k0=$(kids tm); snap "ps0.$t"; st=$(date +%s); e0=$(energy)
  ( while :; do
      solving || { sleep 10; continue; }
      sudo -n turbostat --quiet --Summary --show Bzy_MHz,PkgWatt,PkgTmp --interval 10 --num_iterations 1 2>/dev/null || sleep 10
      sudo -n ipmitool sdr get "PW Consumption" 2>/dev/null | sed -n 's/^ *Sensor Reading *: *\([0-9.]*\).*/wall \1/p'
      echo "limits $(msr 0 0x64f) $(msr 32 0x64f)"
    done ) > "power.$t.log" 2>/dev/null & power=$!
  ( cd "$t" && exec mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
      bash -c 'export HPL_HOST_NODE=$((PMI_RANK % SLURM_NTASKS_PER_NODE)); exec numactl --localalloc "$0"' "$IHPL" ) &
  wait $!; rc=$?
  echo "energy  : $t $e0 to $(energy) uJ in $(( $(date +%s) - st )) s"
  pkill -P $power 2>/dev/null; kill $power 2>/dev/null; wait $power 2>/dev/null
  times > tm; k1=$(kids tm); snap "ps1.$t"
  ol=$(awk -v b="$(busy)" -v b0="$b0" -v k="$k1" -v k0="$k0" -v dt=$(( $(date +%s) - st )) 'BEGIN {printf "%.2f", (dt > 0 && b > b0 ? (b - b0 - k + k0) / dt : 0)}')
  echo "after   : $t other processes $ol cores"
  echo "busiest : $t $(hogs "ps0.$t" "ps1.$t" $(( $(date +%s) - st ))) (cores, by process name)"
  read -r watts mhz tmax < <(awk '/PkgWatt/ {for (i = 1; i <= NF; i++) c[$i] = i; next}
       c["PkgWatt"] && $1 + 0 > 0 {s += $c["PkgWatt"]; f += $c["Bzy_MHz"]; if (c["PkgTmp"] && $c["PkgTmp"] > mt) mt = $c["PkgTmp"]; n++}
       END {if (n) printf "%.0f %.0f %d\n", s/n, f/n, mt; else print "- - -"}' "power.$t.log")
  wall=$(awk '$1 == "wall" && $2 + 0 > m {m = $2 + 0} END {if (m) printf "%.0f", m; else print "-"}' "power.$t.log")
  echo "power   : $t $watts W both packages, $mhz MHz, max $tmax C, system max $wall W"
  gflops=$(awk -v t="$t" '/^test    : / {cur = $3} cur == t && $1 ~ /^W[RC]/ && NF >= 7 {g = $7} END {print g}' "$out")
  res=$(awk -v t="$t" '/^test    : / {cur = $3} cur == t && /\.\.\.\.\.\. (PASSED|FAILED)/ {r = $NF} END {print r}' "$out")
  echo "$t ${gflops:--} $mhz $watts $tmax $wall ${res:--} $w $ol" >> results.txt
  [ "$rc" -eq 0 ] || { failed="$failed $t"; echo "failed  : $t exited $rc"; }
}

: > results.txt
i=0
for w in $levels; do
  i=$((i + 1)); t=$(printf '%02d' $i)-${w}W
  setpl "$w" || { echo; echo "failed  : $t, PL1 did not take, $(pl)"; failed="$failed $t"; restore; continue; }
  solve "$t" "$w"
done
restore

echo
awk '{printf "summary : %-8s PL1 %3s W %9s GFLOPS  %5s MHz  %4s W  %6s W a package  %3s C  system %5s W  %s  other %s cores\n", $1, $8, ($2 == "-" ? "-" : sprintf("%.2f", $2)), $3, $4, ($4 == "-" ? "-" : sprintf("%.1f", $4 / 2)), $5, $6, $7, $9}' results.txt
awk '$2 != "-" && $4 != "-" && $7 == "PASSED" {w = $8; g = $2 + 0; s[w] += g; p[w] += $4; m[w] += $3; c[w]++; if (!(w in lo) || g < lo[w]) lo[w] = g; if (g > hi[w]) hi[w] = g}
  END {for (w in c) printf "level   : PL1 %3d W, %d solves, %8.2f GFLOPS, spread %.2f%%, %5.1f W a package, %4.0f MHz\n", w, c[w], s[w] / c[w], (hi[w] - lo[w]) / (s[w] / c[w]) * 100, p[w] / c[w] / 2, m[w] / c[w]}' results.txt | sort -k4,4rn
best=$(awk '$7 == "PASSED" && $2 + 0 > g {g = $2 + 0; t = $1} END {print t}' results.txt)
[ -n "$best" ] && mhzs "power.$best.log" | sort -n | awk -v t="$best" '{v[++n]=$1; s+=$1} END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples, median %.0f (%s)\n", s/n, v[1], v[n], n, v[int((n+1)/2)], t}'
for f in power.*.log; do echo "== $f"; cat "$f"; done
[ -z "$failed" ] || { echo "failed  :$failed"; exit 1; }
