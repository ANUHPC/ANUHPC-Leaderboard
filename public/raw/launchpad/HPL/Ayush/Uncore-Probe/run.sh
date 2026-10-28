#!/bin/bash
# intel HPL uncore probe, NB=480 1x2. stop vllm and ollama before pushing
# A default at 60% N, B at 80% N with the uncore cap stepped every 5 min,
# then C best cap and D default at 60% N if a cap helped. ~2.9 h

#SBATCH --job-name=hpl-launchpad-intel-uncore-probe
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=03:30:00
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

# uncore range from the node survey, kHz. UNCORE_SYSFS is only set to dry-run this off the node
U=${UNCORE_SYSFS:-/sys/devices/system/cpu/intel_uncore_frequency}
umin=800000
umax=2500000
# B's caps, ABBA so drift cancels. D = default range
levels="D 1600000 2000000 1800000 1500000 1500000 1800000 2000000 1600000 D"
na=221760
nb=296640

echo "cpu     : $(lscpu | sed -n 's/^Model name: *//p')"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} cores"
echo "binary  : $IHPL"
echo "sha256  : $(sha256sum "$IHPL" | cut -c1-64)"
echo "blas    : oneMKL $(dpkg-query -W -f='${Version}' intel-oneapi-mkl-core-devel-2026.1)"
echo "mpi     : $(mpirun --version | head -1)"
echo "fan     : mode $(sudo -n ipmitool raw 0x30 0x45 0x00 | tr -d ' ') (01 full, 02 optimal)"
echo "governor: $(sort /sys/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_governor 2>/dev/null | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}')"
echo "turbo   : no_turbo=$(cat /sys/devices/system/cpu/intel_pstate/no_turbo 2>/dev/null || echo n/a)"
echo "epb     : $(sort /sys/devices/system/cpu/cpu[0-9]*/power/energy_perf_bias 2>/dev/null | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}')"
echo "pkg cap : $(for z in /sys/class/powercap/intel-rapl:[0-9]; do awk -v n="$(cat "$z/name")" '{printf "%s %.0f W  ", n, $1/1e6}' "$z/constraint_0_power_limit_uw"; done 2>/dev/null)"
echo "gpu     : $(nvidia-smi --query-gpu=pstate,power.draw,memory.used --format=csv,noheader 2>/dev/null | paste -sd';' -)"
env | grep -E '^(I_MPI_|HPL_LOG=|HPL_LARGEPAGE=|HPL_HOST_)' | sort | sed 's/^/env     : /'
p=$(pgrep -f 'vllm|ollama' | paste -sd' ' -)
[ -z "$p" ] || echo "warning : vllm/ollama still running (pids $p), A-D still compare but not with older jobs"

sudo -n modprobe intel_uncore_frequency 2>/dev/null
pk=$(echo "$U"/package_*_die_00)
[ -e "${pk%% *}/max_freq_khz" ] || { echo "failed  : no uncore control at $U"; exit 1; }
put() { sudo -n sh -c 'v=$1; shift; for f; do echo "$v" > "$f"; done' sh "$@"; }
unc() { local d; for d in $pk; do printf 'pkg %s %s-%s cur %s  ' "${d##*/package_}" "$(cat "$d/min_freq_khz")" "$(cat "$d/max_freq_khz")" "$(sudo -n cat "$d/current_freq_khz" 2>/dev/null || echo -)"; done; }
cap() { local d; for d in $pk; do put "$1" "$d/max_freq_khz"; [ "$(cat "$d/max_freq_khz")" = "$1" ] || return 1; done; }
restore() { local d; for d in $pk; do put "$umin" "$d/min_freq_khz"; put "$umax" "$d/max_freq_khz"; done; }

# guard before anything else, a killed job could have left a cap
for d in $pk; do
  r="$(cat "$d/min_freq_khz")-$(cat "$d/max_freq_khz")"
  [ "$r" = "$umin-$umax" ] || echo "guard   : ${d##*/} was $r, reset to $umin-$umax"
done
restore
echo "uncore  : $(unc)(kHz, driver initial $(cat "${pk%% *}/initial_min_freq_khz")-$(cat "${pk%% *}/initial_max_freq_khz"))"

left() { squeue -h -j "$SLURM_JOB_ID" -o %L 2>/dev/null | awk -F'[-:]' 'NF {s = $NF + 60 * $(NF-1); if (NF > 2) s += 3600 * $(NF-2); if (NF > 3) s += 86400 * $(NF-3); print s}'; }
# outside the job: puts the range back if this job dies without its trap, unless a job is running by then
wd=hpl-uncore-$SLURM_JOB_ID
lft=$(left)
fire=$(( ${lft:-12600} + 300 ))
if sudo -n systemd-run --quiet --unit="$wd" --on-active="${fire}s" /bin/sh -c \
     "squeue -h -t R | grep -q . || for d in $pk; do echo $umin > \$d/min_freq_khz; echo $umax > \$d/max_freq_khz; done"; then
  echo "watchdog: $wd restores the uncore in $fire s if the job dies"
else
  echo "warning : no restore watchdog, systemd-run failed"
fi
trap 'restore; sudo -n systemctl stop "$wd.timer" 2>/dev/null; pkill -P $$ 2>/dev/null; echo "uncore  : $(unc)(kHz, at exit)"' EXIT
trap 'exit 143' TERM INT

out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
out=${out:-$PWD/run.out}
: > marks.log
mark() { echo "$(date +%s) $*" >> marks.log; }
# every progress line with a timestamp, for the block numbers
tail -n0 -F "$out" 2>/dev/null | while IFS= read -r l; do
  case $l in *Column=*) echo "$(date +%s) $l" ;; esac
done > kern.log &
solving() { awk -v s="$1" '$1 >= s {f = 1} END {exit !f}' kern.log 2>/dev/null; }

msr() { sudo -n dd if="/dev/cpu/$1/msr" bs=8 count=1 skip=$(($2)) iflag=skip_bytes status=none 2>/dev/null | od -An -tx8 | tr -d ' \n'; }
# perf limit reasons 0x64f, live bits 0-13 and the same logged at 16-29
plr() { local v=$((16#${1:-0})) s=$2 o= i; for i in 0:prochot 1:thermal 4:residency 5:ratl 6:vr-therm 7:vr-tdc 8:other 10:pl1 11:pl2 12:max-turbo 13:attenuation; do
          (( v >> (${i%%:*} + s) & 1 )) && o="$o ${i#*:}"; done; o=${o# }; echo "${o:-none}"; }
lim() { local c v o=; for c in 0 32; do v=$(msr $c 0x64f); [ -n "$v" ] || { echo "msr unreadable"; return; }; o="$o  cpu$c live $(plr "$v" 0), log $(plr "$v" 16)"; done; echo "${o#  }"; }
smi() { local v; v=$(msr 0 0x34); echo $(( ${v:+16#$v} + 0 )); }
# run_delay of the hpl threads, ns
rq() { local p; for p in $(pgrep xhpl_intel64); do cat /proc/$p/task/*/schedstat; done 2>/dev/null | awk '{d += $2} END {print d + 0}'; }

# matrix on 2 MB pages and on which node
mem() {
  local p
  for p in $(pgrep xhpl_intel64); do
    awk -v t="$1" -v p="$p" '{v[$1] = $2} END {printf "pages   : %s pid %s rss %.0f GiB, thp %.0f GiB\n", t, p, v["Rss:"]/1048576, v["AnonHugePages:"]/1048576}' "/proc/$p/smaps_rollup" 2>/dev/null
    numastat -p "$p" 2>/dev/null | awk -v t="$1" -v p="$p" '/^Total/ {printf "numa    : %s pid %s node0 %.0f MB, node1 %.0f MB\n", t, p, $2, $3}'
  done
}

# who does the work: per-cpu busy clock and IPC by package, live limits, what else is busy
snap() {
  sudo -n turbostat --quiet --show Package,CPU,Busy%,Bzy_MHz,IPC --interval 10 --num_iterations 1 2>/dev/null |
    awk -v t="$1" '/Bzy_MHz/ {for (i = 1; i <= NF; i++) c[$i] = i; next}
      $c["Package"] ~ /^[0-9]+$/ && $c["Busy%"] > 50 {k = $c["Package"]; n[k]++; m[k] += $c["Bzy_MHz"]; q[k] += $c["IPC"]
        if (!(k in lo) || $c["IPC"] < lo[k]) {lo2[k] = lo[k]; lc2[k] = lc[k]; lo[k] = $c["IPC"]; lc[k] = $c["CPU"]}
        else if (!(k in lo2) || lo2[k] == "" || $c["IPC"] < lo2[k]) {lo2[k] = $c["IPC"]; lc2[k] = $c["CPU"]}}
      END {for (k in n) printf "percpu  : %s pkg %s %d busy cpus, %.0f MHz, ipc %.2f avg, lowest cpu %s %.2f and cpu %s %.2f\n",
             t, k, n[k], m[k] / n[k], q[k] / n[k], lc[k], lo[k], lc2[k], lo2[k]}'
  echo "limits  : $1 under load $(lim)"
  echo "cpuinfo : $1 $(awk -F': ' '/^cpu MHz/ {if (n < 64) {s += $2; n++}} END {if (n) printf "%.0f MHz avg over cpus 0-63", s / n}' /proc/cpuinfo 2>/dev/null)"
  top -b -n 2 -d 5 -w 200 2>/dev/null | awk -v t="$1" '/^top -/ {f++; next} f == 2 && $1 ~ /^[0-9]+$/ && $12 !~ /xhpl/ && $9 + 0 >= 0.5 {o = o sprintf("%s %s%%  ", $12, $9)} END {print "busy    : " t " " o}'
}

# timeline inside each solve
probe() {
  local t0 r0 r1
  until solving "$2"; do sleep 5; done
  sleep 120; mem "$1"
  t0=$(date +%s); r0=$(rq)
  sleep 60; snap "$1"
  sleep 840
  r1=$(rq)
  awk -v t="$1" -v a="$r0" -v b="$r1" -v dt=$(( $(date +%s) - t0 )) -v n=$((SLURM_NTASKS * SLURM_CPUS_PER_TASK)) \
    'BEGIN {if (dt > 0 && n > 0) printf "sched   : %s hpl threads waited for a cpu %.3f%% of %d s\n", t, (b - a) / (dt * 1e9 * n) * 100, dt}'
}

# B only: step the cap every 5 min once solving
switchback() {
  local l
  until solving "$1"; do sleep 5; done
  sleep 120
  for l in $levels; do
    if [ "$l" = D ]; then restore; else cap "$l" || echo "warning : could not set cap $l"; fi
    mark cap "$l"
    sleep 300
  done
  restore; mark cap tail
}

# package power, uncore and all-core busy clock every 30 s. --cpu package only filters the print
tstat() { sudo -n turbostat --quiet --cpu package --interval 30 --show Time_Of_Day_Seconds,Package,CPU,Busy%,Bzy_MHz,UncMHz,PkgWatt,PkgTmp > "$1" 2>/dev/null & tsp=$!; }

failed=
# solve <test> <N> <D | cap kHz | switch>
solve() {
  local t=$1 n=$2 m=$3 need lft st rc pr sw= s0
  need=$(awk -v n="$n" 'BEGIN {printf "%d", 2 / 3 * n ^ 3 / 4.2e12 + 300}')
  lft=$(left)
  if [ -n "$lft" ] && [ "$lft" -lt "$need" ]; then echo; echo "skip    : $t needs ~$need s, $lft s left"; return; fi
  echo
  case $m in D) echo "test    : $t | N $n | uncore default" ;; switch) echo "test    : $t | N $n | uncore stepped every 5 min: $levels" ;;
             *) echo "test    : $t | N $n | uncore cap $m kHz" ;; esac
  mkdir -p "$t"
  sed "s/^[0-9][0-9]* *Ns/$n       Ns/" HPL.dat > "$t/HPL.dat"
  grep -q "^$n  *Ns" "$t/HPL.dat" || { echo "failed  : $t, could not set N=$n in HPL.dat"; failed="$failed $t"; return; }
  restore
  case $m in D | switch) ;; *) cap "$m" || { echo "failed  : $t, could not set cap $m"; restore; failed="$failed $t"; return; } ;; esac
  sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
  echo "numa    : $(numactl -H | awk '/free:/{printf "node %s %d GiB free  ", $2, $4/1024}')"
  echo "uncore  : $(unc)(kHz)"
  echo "limits  : before $(lim)"
  s0=$(smi)
  st=$(date +%s); mark start "$t"
  tstat "ts.$t.log"
  probe "$t" "$st" & pr=$!
  [ "$m" = switch ] && { switchback "$st" & sw=$!; }
  # rank 0 -> numa node 0, rank 1 -> numa node 1. in the background so a TERM reaches the trap now
  ( cd "$t" && exec mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
      bash -c 'export HPL_HOST_NODE=$((PMI_RANK % SLURM_NTASKS_PER_NODE)); exec numactl --localalloc "$0"' "$IHPL" ) &
  wait $!; rc=$?
  mark end "$t"
  pkill -P $pr 2>/dev/null; [ -n "$sw" ] && pkill -P $sw 2>/dev/null; kill $pr $sw $tsp 2>/dev/null
  wait $pr $sw $tsp 2>/dev/null
  restore
  echo "limits  : after $(lim)"
  echo "smi     : $t $(( $(smi) - s0 )) during the solve"
  [ "$rc" -eq 0 ] || { failed="$failed $t"; echo "failed  : $t exited $rc"; }
}

# B's blocks: kernel rate, busy clock, uncore and power per cap level. last line: pick <level> <kernel %> <clock %>
blocks() {
  awk -v t="$1" 'FNR == 1 {f++}
    f == 1 && $2 == "start" && $3 == t {s = $1} f == 1 && $2 == "end" && $3 == t {e = $1}
    f == 1 && $2 == "cap" && s && !e {nb++; bt[nb] = $1; bl[nb] = $3}
    f == 2 && s && $1 >= s && (!e || $1 <= e) {
      line = $0; gsub(/=/, " ", line); m = split(line, v, " ")
      for (i = 1; i < m; i++) {if (v[i] == "Fraction") fr = v[i+1] + 0; if (v[i] == "Kernel") k = v[i+1] / 1000}
      for (j = nb; j >= 1; j--) if ($1 > bt[j]) break
      if (j >= 1 && j < nb && k > 1000 && fr <= 0.55) {if (seen[j]++) {ks[j] += k; kn[j]++}}
    }
    f == 3 && /Time_Of_Day_Seconds/ {for (i = 1; i <= NF; i++) c[$i] = i; next}
    f == 3 && c["Package"] {
      x = $c["Time_Of_Day_Seconds"] + 0
      for (j = nb; j >= 1; j--) if (x > bt[j]) break
      # summary row first, then the first cpu of each package; they go in the block of the summary row
      if ($c["Package"] == "-") {iv = (lx ? x - lx : 0); lx = x; cj = 0
        if (j >= 1 && j < nb && iv > 0 && x - iv >= bt[j] && x <= bt[j+1]) {zs[j] += $c["Bzy_MHz"]; ws[j] += $c["PkgWatt"]; zn[j]++; cj = j}}
      else if (cj && c["UncMHz"]) {us[cj, $c["Package"]] += $c["UncMHz"]; un[cj, $c["Package"]]++}
    }
    END {
      for (j = 1; j < nb; j++) {
        u0 = un[j, 0] ? us[j, 0] / un[j, 0] : 0; u1 = un[j, 1] ? us[j, 1] / un[j, 1] : 0
        K = kn[j] ? ks[j] / kn[j] : 0; Z = zn[j] ? zs[j] / zn[j] : 0; W = zn[j] ? ws[j] / zn[j] : 0
        printf "block   : %2d %-7s kernel %7.1f GF (%d lines)  %4.0f MHz  unc %4.0f/%4.0f MHz  %3.0f W\n", j, bl[j], K, kn[j], Z, u0, u1, W
        if (K) {L = bl[j]; if (!(L in lk)) ord[++no] = L; lk[L] += K; lc[L]++; if (Z) {lz[L] += Z; lzn[L]++}; lu[L] += (u0 + u1) / 2; lw[L] += W}
      }
      if (!lc["D"]) {print "pick none 0 0"; exit}
      dk = lk["D"] / lc["D"]; dz = lzn["D"] ? lz["D"] / lzn["D"] : 0
      for (i = 1; i <= no; i++) {L = ord[i]; K = lk[L] / lc[L]; Z = lzn[L] ? lz[L] / lzn[L] : 0
        printf "level   : %-7s kernel %7.1f GF %+6.2f%%  clock %4.0f MHz %+6.2f%%  unc %4.0f MHz  %3.0f W  (%d blocks)\n",
               L, K, (K / dk - 1) * 100, Z, (dz && Z ? (Z / dz - 1) * 100 : 0), lu[L] / lc[L], lw[L] / lc[L], lc[L]
        if (L != "D" && (best == "" || K > bk)) {best = L; bk = K; bz = Z}}
      printf "pick %s %.2f %.2f\n", (best == "" ? "none" : best), (best == "" ? 0 : (bk / dk - 1) * 100), (best == "" || !dz || !bz ? 0 : (bz / dz - 1) * 100)
    }' marks.log kern.log "ts.$1.log"
}

# per solve: GFLOPS, busy clock, uncore, power, temp, residual -> results.txt
report() {
  local t=$1 w g r
  w=$(awk -v t="$t" '$2 == "start" && $3 == t {s = $1} $2 == "end" && $3 == t {e = $1} END {print s + 0, e + 0}' marks.log)
  w=$(awk -v s="${w% *}" -v e="${w#* }" '$1 >= s && $1 <= e {if (!a) a = $1; b = $1} END {print a + 0, b + 0}' kern.log)
  g=$(awk -v t="$t" '/^test    : / {c = $3} c == t && $1 ~ /^W[RC]/ && NF >= 7 {g = $7} END {print g + 0}' "$out")
  r=$(awk -v t="$t" '/^test    : / {c = $3} c == t && /\.\.\.\.\.\. (PASSED|FAILED)/ {r = $NF} END {print (r == "" ? "-" : r)}' "$out")
  awk -v t="$t" -v g="$g" -v r="$r" -v a="${w% *}" -v b="${w#* }" '/Time_Of_Day_Seconds/ {for (i = 1; i <= NF; i++) c[$i] = i; next}
    c["Package"] {x = $c["Time_Of_Day_Seconds"] + 0; if (x < a + 30 || x > b) next
      if ($c["Package"] == "-") {z += $c["Bzy_MHz"]; w += $c["PkgWatt"]; n++; print $c["Bzy_MHz"] > ("mhz." t ".log")}
      else {if (c["UncMHz"]) {u[$c["Package"]] += $c["UncMHz"]; un[$c["Package"]]++}; if ($c["PkgTmp"] > m) m = $c["PkgTmp"]}}
    END {printf "%s %s %.0f %.0f %.0f %.0f %.0f %s\n", t, g, (n ? z / n : 0), (un[0] ? u[0] / un[0] : 0), (un[1] ? u[1] / un[1] : 0), (n ? w / n : 0), m, r}' "ts.$t.log" >> results.txt
}

: > results.txt
solve A-default "$na" D
solve B-switch "$nb" switch

echo
if [ -s ts.B-switch.log ] && [ -s kern.log ]; then
  blocks B-switch > blocks.txt
  grep -v '^pick ' blocks.txt
  read -r _ best gain dclk < <(grep '^pick ' blocks.txt)
else
  best=skip gain=0 dclk=0
fi
if [ "$best" = skip ]; then
  echo "decision: B did not run, C and D skipped"
elif [ "$best" != none ] && awk -v g="$gain" -v z="$dclk" 'BEGIN {exit !(g >= 0.15 && z > 0)}'; then
  echo "decision: cap $best kHz, kernel ${gain}% and clock ${dclk}% over default in B, so C and D run"
  solve C-cap "$na" "$best"
  solve D-default "$na" D
else
  echo "decision: no cap beat default in B (best ${best} ${gain}% kernel, ${dclk}% clock), C and D skipped"
fi

for t in A-default B-switch C-cap D-default; do grep -q " start $t$" marks.log && report "$t"; done
echo
awk 'NR == 1 {b = $2 + 0}
     {printf "summary : %-10s %8.2f GFLOPS %+6.2f%% vs A  %4s MHz  unc %s/%s MHz  %3s W  %2s C  %s\n", $1, $2,
             (b > 0 ? ($2 / b - 1) * 100 : 0), $3, $4, $5, $6, $7, $8}' results.txt
awk '$1 == "A-default" {a = $2} $1 == "C-cap" {c = $2; cz = $3} $1 == "D-default" {d = $2} $1 == "A-default" || $1 == "D-default" {z += $3; n++}
     END {if (c && a && d) printf "compare : C vs mean of A and D %+.2f%% GFLOPS, %+.2f%% busy clock\n", (c / ((a + d) / 2) - 1) * 100, (n ? (cz / (z / n) - 1) * 100 : 0)}' results.txt
# the site reads the first cpu MHz line: the best solve that ran one setting
bt=$(awk '$1 != "B-switch" && $2 > g {g = $2; t = $1} END {print t}' results.txt)
[ -n "$bt" ] && sort -n "mhz.$bt.log" 2>/dev/null |
  awk -v t="$bt" '{v[++n]=$1; s+=$1} END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples, median %.0f (%s)\n", s/n, v[1], v[n], n, v[int((n+1)/2)], t}'
[ -z "$failed" ] || { echo "failed  :$failed"; exit 1; }
