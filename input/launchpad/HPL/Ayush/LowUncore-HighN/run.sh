#!/bin/bash
# intel HPL 1x2, NB 720. uncore capped at 1.2 GHz against the default at N=276480, then the better one twice at N=322560

#SBATCH --job-name=hpl-launchpad-intel-lowuncore-highn
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=07:30:00
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

arms="B U12 U12 B"
n1=276480
ns="322560 322560"
nb=720

C=/sys/devices/system/cpu
U=$C/intel_uncore_frequency
umin=800000
umax=2500000
epb0=6
nbal0=1

armcap() { case $1 in U12) echo 1200000 ;; *) echo D ;; esac; }

echo "cpu     : $(lscpu | sed -n 's/^Model name: *//p')"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} cores"
echo "binary  : $IHPL"
echo "sha256  : $(sha256sum "$IHPL" | cut -c1-64)"
echo "blas    : oneMKL $(dpkg-query -W -f='${Version}' intel-oneapi-mkl-core-devel-2026.1)"
echo "mpi     : $(mpirun --version | head -1)"
echo "fan     : mode $(sudo -n ipmitool raw 0x30 0x45 0x00 | tr -d ' ') (01 full, 02 optimal)"
echo "governor: $(sort $C/cpu[0-9]*/cpufreq/scaling_governor 2>/dev/null | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}')"
echo "turbo   : no_turbo=$(cat $C/intel_pstate/no_turbo 2>/dev/null || echo n/a)"
echo "pkg cap : $(for z in /sys/class/powercap/intel-rapl:[0-9]; do awk -v n="$(cat "$z/name")" '{printf "%s %.0f W  ", n, $1/1e6}' "$z/constraint_0_power_limit_uw"; done 2>/dev/null)"
echo "gpu     : $(nvidia-smi --query-gpu=pstate,power.draw,memory.used --format=csv,noheader 2>/dev/null | paste -sd';' -)"
env | grep -E '^(I_MPI_|HPL_LOG=|HPL_LARGEPAGE=|HPL_HOST_)' | sort | sed 's/^/env     : /'
p=$(pgrep -f 'vllm|ollama serve|wrf\.exe|real\.exe|\.vscode-server/|code-server/.*extensionHost' | paste -sd' ' -)
[ -z "$p" ] || echo "warning : wrf, vllm, ollama or an editor window still running (pids $p)"

sudo -n modprobe intel_uncore_frequency 2>/dev/null
pk=$(echo "$U"/package_*_die_00)
[ -e "${pk%% *}/max_freq_khz" ] || { echo "failed  : no uncore control at $U"; exit 1; }
put() { sudo -n sh -c 'v=$1; shift; for f; do echo "$v" > "$f"; done' sh "$@"; }
unc() { local d; for d in $pk; do printf 'pkg %s %s-%s cur %s  ' "${d##*/package_}" "$(cat "$d/min_freq_khz")" "$(cat "$d/max_freq_khz")" "$(sudo -n cat "$d/current_freq_khz" 2>/dev/null || echo -)"; done; }
setcap() { local d; [ "$1" = D ] && return 0; for d in $pk; do put "$1" "$d/max_freq_khz"; [ "$(cat "$d/max_freq_khz")" = "$1" ] || return 1; done; }
restore() { local d; for d in $pk; do put "$umin" "$d/min_freq_khz"; put "$umax" "$d/max_freq_khz"; done; }
epbs() { sort $C/cpu[0-9]*/power/energy_perf_bias 2>/dev/null | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}'; }
nbals() { sysctl -n kernel.numa_balancing 2>/dev/null || echo -; }

for d in $pk; do
  r="$(cat "$d/min_freq_khz")-$(cat "$d/max_freq_khz")"
  [ "$r" = "$umin-$umax" ] || echo "guard   : ${d##*/} was $r, reset to $umin-$umax"
done
restore
[ "$(epbs)" = "$epb0 x$(ls -d $C/cpu[0-9]* | wc -l | tr -d ' ')" ] || { echo "guard   : epb was $(epbs), reset to $epb0"; put $epb0 $C/cpu[0-9]*/power/energy_perf_bias; }
[ "$(nbals)" = "$nbal0" ] || { echo "guard   : numa_balancing was $(nbals), reset to $nbal0"; sudo -n sysctl -qw kernel.numa_balancing=$nbal0; }
echo "uncore  : $(unc)(kHz, driver initial $(cat "${pk%% *}/initial_min_freq_khz")-$(cat "${pk%% *}/initial_max_freq_khz"))"
echo "epb     : $(epbs)"
echo "numa bal: $(nbals)"

msr() { sudo -n dd if="/dev/cpu/$1/msr" bs=8 count=1 skip=$(($2)) iflag=skip_bytes status=none 2>/dev/null | od -An -tx8 | tr -d ' \n'; }
smi() { local v; v=$(msr 0 0x34); echo $(( ${v:+16#$v} + 0 )); }
rapl() { local c u l i; for c in 0 32; do u=$(msr $c 0x606); l=$(msr $c 0x610); i=$(msr $c 0x614)
    [ -n "$u" ] && [ -n "$l" ] && [ -n "$i" ] || { printf 'cpu%s msr unreadable  ' $c; continue; }
    awk -v c=$c -v u=$(( 16#$u & 15 )) -v l1=$(( 16#$l & 32767 )) -v l2=$(( (16#$l >> 32) & 32767 )) -v lk=$(( (16#$l >> 63) & 1 )) \
        -v td=$(( 16#$i & 32767 )) -v mx=$(( (16#$i >> 32) & 32767 )) \
      'BEGIN {s = 2 ^ -u; printf "cpu%s PL1 %.0f W PL2 %.0f W lock %s, TDP %.0f W max %.0f W  ", c, l1 * s, l2 * s, (lk ? "on" : "off"), td * s, (mx ? mx * s : 0)}'
  done; }
echo "rapl    : $(rapl)"

left() { squeue -h -j "$SLURM_JOB_ID" -o %L 2>/dev/null | awk -F'[-:]' 'NF {s = $NF + 60 * $(NF-1); if (NF > 2) s += 3600 * $(NF-2); if (NF > 3) s += 86400 * $(NF-3); print s}'; }
wd=hpl-uncore-$SLURM_JOB_ID
lft=$(left)
fire=$(( ${lft:-27000} + 300 ))
if sudo -n systemd-run --quiet --unit="$wd" --on-active="${fire}s" /bin/sh -c \
     "squeue -h -t R | grep -q . || { for d in $pk; do echo $umin > \$d/min_freq_khz; echo $umax > \$d/max_freq_khz; done; }"; then
  echo "watchdog: $wd restores the uncore in $fire s if the job dies"
else
  echo "warning : no restore watchdog, systemd-run failed"
fi
uncore_ok() { local d; for d in $pk; do [ "$(cat "$d/min_freq_khz")-$(cat "$d/max_freq_khz")" = "$umin-$umax" ] || return 1; done; }
trap 'restore; uncore_ok && sudo -n systemctl stop "$wd.timer" 2>/dev/null; pkill -P $$ 2>/dev/null; echo "restored: uncore $(unc)"' EXIT
trap 'exit 143' TERM INT

out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
out=${out:-$PWD/run.out}

vm() { cat /proc/vmstat 2>/dev/null | awk '{v[$1] = $2} END {print v["numa_hint_faults"] + 0, v["numa_pages_migrated"] + 0, v["thp_fault_alloc"] + 0, v["thp_fault_fallback"] + 0}'; }
nfree() { local f; for f in /sys/devices/system/node/node[0-9]*/meminfo; do awk '$3 == "MemFree:" {printf "node %s %.0f GiB free  ", $2, $4 / 2 ^ 20}' "$f"; done 2>/dev/null; }
busy() { awk '$1 == "cpu" {printf "%.2f\n", ($2 + $3 + $4 + $7 + $8 + $9) / 100}' /proc/stat 2>/dev/null; }
kids() { awk 'NR == 2 {for (i = 1; i <= 2; i++) {split($i, v, "m"); s += 60 * v[1] + v[2]}} END {printf "%.2f\n", s}' "$1"; }
snap() { ps -eo pid=,times=,comm= 2>/dev/null > "$1"; }
hogs() { awk -v dt="$3" 'FNR == NR {s[$1] = $2; next} {d = $2 - ($1 in s ? s[$1] : 0); c = $3; for (i = 4; i <= NF; i++) c = c " " $i; if (d > 0) g[c] += d}
  END {for (c in g) if (dt > 0 && g[c] / dt >= 0.02) printf "%.2f %s\n", g[c] / dt, c}' "$1" "$2" | sort -rn | head -4 | awk '{printf "%s%s %s", (NR > 1 ? ", " : ""), $2, $1}'; }
probe() { while sleep 300; do
    printf '%s %s %s %s\n' "$(date +%s)" "$(awk -F'\n' 'BEGIN {RS = ""} {delete f; for (i = 1; i <= NF; i++) {split($i, kv, /[ \t]*: /); f[kv[1]] = kv[2]}
        k = f["physical id"] "-" f["core id"]; if (f["cpu MHz"] + 0 > m[k]) m[k] = f["cpu MHz"] + 0}
        END {for (k in m) {s += m[k]; n++} printf "%.0f", (n ? s / n : 0)}' /proc/cpuinfo)" "$(msr 0 0x64f)" "$(msr 32 0x64f)"
  done; }
probesum() { local e m a b v i n=0 r= ms= hit=(0 0 0 0 0 0 0 0 0 0 0 0 0 0)
  local nm=(prochot thermal - - residency ratl vr-therm vr-tdc other - pl1 pl2 max-turbo attenuation)
  while read -r e m a b; do
    n=$((n + 1)); ms="$ms $m"
    for v in "$a" "$b"; do [ -n "$v" ] || continue
      for i in 0 1 4 5 6 7 8 10 11 12 13; do (( (16#$v >> i) & 1 )) && hit[i]=$(( hit[i] + 1 )); done
    done
  done < "$1"
  [ "$n" -gt 0 ] || { echo "no samples"; return; }
  for i in 0 1 4 5 6 7 8 10 11 12 13; do [ "${hit[i]}" -gt 0 ] && r="$r ${nm[i]} ${hit[i]}"; done
  echo "cpuinfo $(printf '%s\n' $ms | sort -n | awk '{v[++c] = $1} END {print v[int((c + 1) / 2)]}') MHz median over $n samples | live limits in $((2 * n)) reads:${r:- none}"
}

b0=$(busy); snap ps.0; sleep 10; snap ps.1
echo "load    : $(awk -v b="$(busy)" -v b0="$b0" 'BEGIN {printf "%.2f", (b > b0 ? (b - b0) / 10 : 0)}') cores busy before the first solve, k8s alone is ~0.6 | $(hogs ps.0 ps.1 10)"

failed=
solve() {
  local t=$1 a=$2 n=$3 nb=$4 cap=$5 need lft rc s0 v0 tsp psp b0 k0 k1 st ol
  need=$(awk -v n="$n" 'BEGIN {printf "%d", 2 / 3 * n ^ 3 / 4.2e12 + 300}')
  lft=$(left)
  if [ -n "$lft" ] && [ "$lft" -lt "$need" ]; then echo; echo "skip    : $t needs ~$need s, $lft s left"; return; fi
  mkdir -p "$t"
  sed -e "s/^[0-9][0-9]* *Ns/$n       Ns/" -e "s/^[0-9][0-9]* *NBs/$nb          NBs/" HPL.dat > "$t/HPL.dat"
  grep -q "^$n  *Ns" "$t/HPL.dat" && grep -q "^$nb  *NBs" "$t/HPL.dat" || { echo "failed  : $t, could not set N=$n NB=$nb in HPL.dat"; failed="$failed $t"; return; }
  restore
  setcap "$cap" || { echo "failed  : $t, could not set uncore cap $cap"; restore; failed="$failed $t"; return; }
  echo
  echo "test    : $t | $a | N $n | NB $nb | uncore $([ "$cap" = D ] && echo default || echo "max $cap kHz") | $(awk -v n="$n" 'BEGIN {printf "%.0f", 4 * n ^ 2 / 2 ^ 30}') GiB per rank"
  sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
  echo "numa    : $(nfree)"
  s0=$(smi); v0=$(vm); b0=$(busy); times > tm; k0=$(kids tm); snap "ps0.$t"; st=$(date +%s)
  sudo -n turbostat --quiet --cpu package --interval 300 --show Time_Of_Day_Seconds,Package,CPU,Bzy_MHz,UncMHz,PkgWatt,PkgTmp > "ts.$t.log" 2>/dev/null & tsp=$!
  probe > "probe.$t.log" 2>/dev/null & psp=$!
  ( cd "$t" && exec mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
      bash -c 'export HPL_HOST_NODE=$((PMI_RANK % SLURM_NTASKS_PER_NODE)); exec numactl --localalloc "$0"' "$IHPL" ) &
  wait $!; rc=$?
  kill $tsp 2>/dev/null; pkill -P $psp 2>/dev/null; kill $psp 2>/dev/null; wait $tsp $psp 2>/dev/null
  times > tm; k1=$(kids tm); snap "ps1.$t"
  ol=$(awk -v b="$(busy)" -v b0="$b0" -v k="$k1" -v k0="$k0" -v dt=$(( $(date +%s) - st )) 'BEGIN {printf "%.2f", (dt > 0 && b > b0 ? (b - b0 - k + k0) / dt : 0)}')
  restore
  set -- $v0 $(vm)
  echo "after   : $t smi $(( $(smi) - s0 )), numa hint faults $(( $5 - $1 )), pages migrated $(( $6 - $2 )), huge page faults $(( $7 - $3 )), 4k fallbacks $(( $8 - $4 )), other processes $ol cores"
  echo "busiest : $t $(hogs "ps0.$t" "ps1.$t" $(( $(date +%s) - st ))) (cores, by process name)"
  echo "probe   : $t $(probesum "probe.$t.log")"
  [ "$rc" -eq 0 ] || { failed="$failed $t"; echo "failed  : $t exited $rc"; }
  result "$t" "$a" "$n" "$nb" "$ol" "$cap"
}

result() {
  local t=$1 a=$2 n=$3 nb=$4 ol=$5 cap=$6
  awk -v t="$t" -v a="$a" -v n="$n" -v nb="$nb" -v ol="$ol" -v cap="$cap" '
    function f(c,  r) {r = n - c; return 2 / 3 * (n ^ 3 - r ^ 3) + 1.5 * (n ^ 2 - r ^ 2)}
    function ep(d,  cmd, v) {cmd = "date -d \"" d "\" +%s"; cmd | getline v; close(cmd); return v + 0}
    FNR == NR {
      if (/^test    : /) s = ($3 == t)
      else if (s && /Column=/) {l = $0; gsub(/=/, " ", l); m = split(l, v, " ")
        for (i = 1; i < m; i++) {if (v[i] == "Column") c = v[i+1] + 0; if (v[i] == "Fraction") fr = v[i+1] + 0; if (v[i] == "Mflops") mf = v[i+1] + 0}
        if (fr >= 0.10 && fr <= 0.60 && mf > 0) {x = f(c - nb); y = f(c) / (mf * 1e6); if (!y0) {x0 = x; y0 = y}; x1 = x; y1 = y}}
      else if (s && /^W[RC]/ && NF >= 7) g = $7
      else if (s && /\.\.\.\.\.\. (PASSED|FAILED)/) r = $NF
      else if (s && sub(/^HPL_pdgesv\(\) start time */, "")) ws = ep($0)
      else if (s && sub(/^HPL_pdgesv\(\) end time */, "")) we = ep($0)
      next}
    /Time_Of_Day_Seconds/ {for (i = 1; i <= NF; i++) k[$i] = i; next}
    k["Package"] && $k["Package"] == "-" {x = $k["Time_Of_Day_Seconds"] + 0; ok = (ws && px >= ws && x <= we); px = x
      if (ok) {z += $k["Bzy_MHz"]; w += $k["PkgWatt"]; nz++; print $k["Bzy_MHz"] > ("mhz." t ".log")}; next}
    k["Package"] && ok {u[$k["Package"]] += $k["UncMHz"]; un[$k["Package"]]++; if ($k["PkgTmp"] > hot) hot = $k["PkgTmp"]}
    END {printf "%s %s %s %.1f %.0f %.0f %.0f %.0f %.0f %s %s %s %s %s\n", t, a, g + 0, (y1 > y0 ? (x1 - x0) / (y1 - y0) / 1e9 : 0),
           (nz ? z / nz : 0), (un[0] ? u[0] / un[0] : 0), (un[1] ? u[1] / un[1] : 0), (nz ? w / nz : 0), hot, (r == "" ? "-" : r), ol, n, nb, cap}' "$out" "ts.$t.log" >> results.txt
}

: > results.txt
i=0
for a in $arms; do i=$((i + 1)); solve "$(printf '%02d' $i)-$a" "$a" $n1 $nb "$(armcap $a)"; done

gain() { awk -v a="$1" '$3 > 0 && $10 == "PASSED" {g[$2] += $3; c[$2]++} END {b = (c["B"] ? g["B"] / c["B"] : 0); m = (c[a] ? g[a] / c[a] : 0); printf "%.3f", (b > 0 && m > 0 ? (m / b - 1) * 100 : -99)}' results.txt; }
g12=$(gain U12)
cap2=$(awk -v a="$g12" 'BEGIN {print (a >= 0.15 ? 1200000 : "D")}')
echo
echo "pick    : uncore $cap2 for N $ns. U12 vs B: $g12% (0.15% needed)"
for n in $ns; do i=$((i + 1)); solve "$(printf '%02d' $i)-N$n" "N$n" $n $nb "$cap2"; done

echo
awk '{printf "summary : %-10s N %6s NB %3s unc %-7s %8.2f GFLOPS  plateau %7.1f  %4s MHz  unc %s/%s MHz  %3s W  %5.1f pJ/FLOP  %2s C  %s  other %s cores\n", $1, $12, $13, $14, $3, $4, $5, $6, $7, $8, ($3 > 0 ? 1000 * $8 / $3 : 0), $9, $10, $11}' results.txt
awk '
  function d(x, y) {return y ? (x / y - 1) * 100 : 0}
  $3 > 0 && $10 == "PASSED" {a = $2; g[a] += $3; k[a] += $4; z[a] += $5; e[a] += 1000 * $8 / $3; c[a]++; if (!(a in seen)) {seen[a] = 1; ord[++no] = a; lo[a] = $3}
    if ($3 < lo[a]) lo[a] = $3; if ($3 > hi[a]) hi[a] = $3}
  END {for (i = 1; i <= no; i++) {a = ord[i]; r = "B"; m = g[a] / c[a]
      printf "arm     : %-7s %d solve%s %8.2f GFLOPS", a, c[a], (c[a] > 1 ? "s" : " "), m
      if (c[a] > 1) printf ", spread %.3f%%", (hi[a] - lo[a]) / m * 100
      if (a != r && c[r]) printf "  %+6.2f%% GFLOPS  %+6.2f%% plateau  %+6.2f%% clock  %+6.2f%% pJ/FLOP  vs %s", d(m, g[r] / c[r]), d(k[a] / c[a], k[r] / c[r]), d(z[a] / c[a], z[r] / c[r]), d(e[a] / c[a], e[r] / c[r]), r
      print ""}}' results.txt
bt=$(awk '$10 == "PASSED" && $3 > g {g = $3; t = $1} END {print t}' results.txt)
[ -n "$bt" ] && sort -n "mhz.$bt.log" 2>/dev/null |
  awk -v t="$bt" '{v[++n]=$1; s+=$1} END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples, median %.0f (%s)\n", s/n, v[1], v[n], n, v[int((n+1)/2)], t}'
awk '$10 == "PASSED" && $3 > g {g = $3; t = $1} END {printf "best    : %s %.2f GFLOPS, %.1f%% of 5120 (85%% = 4352)\n", t, g, g / 51.2}' results.txt
for f in ts.*.log probe.*.log; do echo "== $f"; cat "$f"; done
[ -z "$failed" ] || { echo "failed  :$failed"; exit 1; }
