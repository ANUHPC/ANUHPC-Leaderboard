#!/bin/bash
# intel HPL knobs screen, N=230400 (62% of max N) 1x2, 12 solves:
# NB 512 and 576, EPB 15, numa_balancing 0, each twice, against 4 baselines at NB 480.
# order is mirrored so drift cancels. stop vllm and ollama before pushing. ~7 h
# during a solve only turbostat runs, once every 300 s. everything else is read before or after

#SBATCH --job-name=hpl-launchpad-intel-knobs-screen
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

# uncore max for every solve, from the probe. D = default range
cap=D
arms="B NB512 NB576 EPB15 B NUMA0 NUMA0 B EPB15 NB576 NB512 B"
n=230400

# defaults from the node survey. CPU_SYSFS is only set to dry-run this off the node
C=${CPU_SYSFS:-/sys/devices/system/cpu}
U=$C/intel_uncore_frequency
umin=800000
umax=2500000
epb0=6
nbal0=1

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
p=$(pgrep -f 'vllm|ollama' | paste -sd' ' -)
[ -z "$p" ] || echo "warning : vllm/ollama still running (pids $p), solves still compare but not with older jobs"

sudo -n modprobe intel_uncore_frequency 2>/dev/null
pk=$(echo "$U"/package_*_die_00)
[ -e "${pk%% *}/max_freq_khz" ] || { echo "failed  : no uncore control at $U"; exit 1; }
put() { sudo -n sh -c 'v=$1; shift; for f; do echo "$v" > "$f"; done' sh "$@"; }
unc() { local d; for d in $pk; do printf 'pkg %s %s-%s cur %s  ' "${d##*/package_}" "$(cat "$d/min_freq_khz")" "$(cat "$d/max_freq_khz")" "$(sudo -n cat "$d/current_freq_khz" 2>/dev/null || echo -)"; done; }
setcap() { local d; [ "$1" = D ] && return 0; for d in $pk; do put "$1" "$d/max_freq_khz"; [ "$(cat "$d/max_freq_khz")" = "$1" ] || return 1; done; }
epb() { put "$1" $C/cpu[0-9]*/power/energy_perf_bias; }
epbs() { sort $C/cpu[0-9]*/power/energy_perf_bias 2>/dev/null | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}'; }
nbal() { sudo -n sysctl -qw kernel.numa_balancing="$1"; }
nbals() { sysctl -n kernel.numa_balancing 2>/dev/null || echo -; }
restore() { local d; for d in $pk; do put "$umin" "$d/min_freq_khz"; put "$umax" "$d/max_freq_khz"; done; epb $epb0; nbal $nbal0; }

# guard before anything else, a killed job could have left a setting
for d in $pk; do
  r="$(cat "$d/min_freq_khz")-$(cat "$d/max_freq_khz")"
  [ "$r" = "$umin-$umax" ] || echo "guard   : ${d##*/} was $r, reset to $umin-$umax"
done
[ "$(epbs)" = "$epb0 x$(ls -d $C/cpu[0-9]* | wc -l | tr -d ' ')" ] || echo "guard   : epb was $(epbs), reset to $epb0"
[ "$(nbals)" = "$nbal0" ] || echo "guard   : numa_balancing was $(nbals), reset to $nbal0"
restore
echo "uncore  : $(unc)(kHz, driver initial $(cat "${pk%% *}/initial_min_freq_khz")-$(cat "${pk%% *}/initial_max_freq_khz"))"
echo "epb     : $(epbs)"
echo "numa bal: $(nbals)"

left() { squeue -h -j "$SLURM_JOB_ID" -o %L 2>/dev/null | awk -F'[-:]' 'NF {s = $NF + 60 * $(NF-1); if (NF > 2) s += 3600 * $(NF-2); if (NF > 3) s += 86400 * $(NF-3); print s}'; }
# outside the job: puts everything back if this job dies without its trap, unless a job is running by then
wd=hpl-knobs-$SLURM_JOB_ID
lft=$(left)
fire=$(( ${lft:-27000} + 300 ))
if sudo -n systemd-run --quiet --unit="$wd" --on-active="${fire}s" /bin/sh -c \
     "squeue -h -t R | grep -q . || { for d in $pk; do echo $umin > \$d/min_freq_khz; echo $umax > \$d/max_freq_khz; done
      for f in $C/cpu[0-9]*/power/energy_perf_bias; do echo $epb0 > \$f; done; sysctl -qw kernel.numa_balancing=$nbal0; }"; then
  echo "watchdog: $wd restores uncore, epb and numa_balancing in $fire s if the job dies"
else
  echo "warning : no restore watchdog, systemd-run failed"
fi
trap 'restore; sudo -n systemctl stop "$wd.timer" 2>/dev/null; pkill -P $$ 2>/dev/null; echo "restored: uncore $(unc)| epb $(epbs) | numa_balancing $(nbals)"' EXIT
trap 'exit 143' TERM INT

out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
out=${out:-$PWD/run.out}

msr() { sudo -n dd if="/dev/cpu/$1/msr" bs=8 count=1 skip=$(($2)) iflag=skip_bytes status=none 2>/dev/null | od -An -tx8 | tr -d ' \n'; }
smi() { local v; v=$(msr 0 0x34); echo $(( ${v:+16#$v} + 0 )); }
# numa balancing hint faults and page migrations since boot
vm() { cat /proc/vmstat 2>/dev/null | awk '{v[$1] = $2} END {print v["numa_hint_faults"] + 0, v["numa_pages_migrated"] + 0}'; }
# cpu seconds used by every process on the node, and by this script's finished children (hpl, turbostat).
# times only sees them in this shell, not in a $( ), so it goes to a file
busy() { awk '$1 == "cpu" {print ($2 + $3 + $4 + $7 + $8 + $9) / 100}' /proc/stat 2>/dev/null; }
kids() { awk 'NR == 2 {for (i = 1; i <= 2; i++) {split($i, v, "m"); s += 60 * v[1] + v[2]}} END {print s + 0}' "$1"; }

failed=
# solve <test> <arm>: B is NB 480 with every default, the others change one thing
solve() {
  local t=$1 a=$2 nb=480 need lft rc s0 v0 tsp b0 k0 k1 st ol
  need=$(awk -v n="$n" 'BEGIN {printf "%d", 2 / 3 * n ^ 3 / 4.2e12 + 300}')
  lft=$(left)
  if [ -n "$lft" ] && [ "$lft" -lt "$need" ]; then echo; echo "skip    : $t needs ~$need s, $lft s left"; return; fi
  case $a in NB*) nb=${a#NB} ;; esac
  mkdir -p "$t"
  sed -e "s/^[0-9][0-9]* *Ns/$n       Ns/" -e "s/^[0-9][0-9]* *NBs/$nb          NBs/" HPL.dat > "$t/HPL.dat"
  grep -q "^$n  *Ns" "$t/HPL.dat" && grep -q "^$nb  *NBs" "$t/HPL.dat" || { echo "failed  : $t, could not set N=$n NB=$nb in HPL.dat"; failed="$failed $t"; return; }
  restore
  setcap "$cap" || { echo "failed  : $t, could not set uncore cap $cap"; restore; failed="$failed $t"; return; }
  case $a in EPB15) epb 15 ;; NUMA0) nbal 0 ;; esac
  echo
  echo "test    : $t | $a | N $n | NB $nb | uncore $([ "$cap" = D ] && echo default || echo "cap $cap kHz") | epb $(epbs) | numa_balancing $(nbals)"
  sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
  s0=$(smi); v0=$(vm); b0=$(busy); times > tm; k0=$(kids tm); st=$(date +%s)
  # package power, uncore and all-core busy clock every 300 s. --cpu package only filters the print
  sudo -n turbostat --quiet --cpu package --interval 300 --show Time_Of_Day_Seconds,Package,CPU,Bzy_MHz,UncMHz,PkgWatt,PkgTmp > "ts.$t.log" 2>/dev/null & tsp=$!
  # rank 0 -> numa node 0, rank 1 -> numa node 1. in the background so a TERM reaches the trap now
  ( cd "$t" && exec mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
      bash -c 'export HPL_HOST_NODE=$((PMI_RANK % SLURM_NTASKS_PER_NODE)); exec numactl --localalloc "$0"' "$IHPL" ) &
  wait $!; rc=$?
  kill $tsp 2>/dev/null; wait $tsp 2>/dev/null
  # cores used by everything else on the node during the solve: all busy time minus hpl's. k8s alone is ~0.6
  times > tm; k1=$(kids tm)
  ol=$(awk -v b="$(busy)" -v b0="$b0" -v k="$k1" -v k0="$k0" -v dt=$(( $(date +%s) - st )) 'BEGIN {printf "%.2f", (dt > 0 && b > b0 ? (b - b0 - k + k0) / dt : 0)}')
  restore
  set -- $v0 $(vm)
  echo "after   : $t smi $(( $(smi) - s0 )), numa hint faults $(( $3 - $1 )), pages migrated $(( $4 - $2 )), other processes $ol cores"
  [ "$rc" -eq 0 ] || { failed="$failed $t"; echo "failed  : $t exited $rc"; }
  result "$t" "$a" "$nb" "$ol"
}

# -> results.txt: test arm GFLOPS plateau MHz unc0 unc1 W C residual other-cores
# plateau = GFLOPS over columns 10-60%, where NB and the tail matter least, from HPL's own progress lines:
# a line's time is the flops to its column over its running Mflops, and the work done is one NB behind that column.
# a turbostat row counts if its whole interval is inside HPL_pdgesv() start to end
result() {
  local t=$1 a=$2 nb=$3 ol=$4
  awk -v t="$t" -v a="$a" -v n="$n" -v nb="$nb" -v ol="$ol" '
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
    END {printf "%s %s %s %.1f %.0f %.0f %.0f %.0f %.0f %s %s\n", t, a, g + 0, (y1 > y0 ? (x1 - x0) / (y1 - y0) / 1e9 : 0),
           (nz ? z / nz : 0), (un[0] ? u[0] / un[0] : 0), (un[1] ? u[1] / un[1] : 0), (nz ? w / nz : 0), hot, (r == "" ? "-" : r), ol}' "$out" "ts.$t.log" >> results.txt
}

: > results.txt
i=0
for a in $arms; do i=$((i + 1)); solve "$(printf '%02d' $i)-$a" "$a"; done

echo
# every solve, then each knob against the mean of the B solves. pJ/FLOP = package W / GFLOPS
awk '{printf "summary : %-9s %8.2f GFLOPS  plateau %7.1f  %4s MHz  unc %s/%s MHz  %3s W  %5.1f pJ/FLOP  %2s C  %s  other %s cores\n", $1, $3, $4, $5, $6, $7, $8, ($3 > 0 ? 1000 * $8 / $3 : 0), $9, $10, $11}' results.txt
awk '$3 > 0 {a = $2; g[a] += $3; k[a] += $4; z[a] += $5; e[a] += 1000 * $8 / $3; n[a]++; if (!(a in seen)) {seen[a] = 1; ord[++no] = a}
       if (a == "B") {if (!bl || $3 < bl) bl = $3; if ($3 > bh) bh = $3}}
     END {if (!n["B"]) exit
       G = g["B"] / n["B"]; K = k["B"] / n["B"]; Z = z["B"] / n["B"]; E = e["B"] / n["B"]
       printf "arm     : B      %d solves %8.2f GFLOPS, spread %.3f%% (max - min over mean)\n", n["B"], G, (bh - bl) / G * 100
       for (i = 1; i <= no; i++) {a = ord[i]; if (a == "B") continue
         printf "arm     : %-6s %d solves %+6.2f%% GFLOPS  %+6.2f%% plateau  %+6.2f%% clock  %+6.2f%% pJ/FLOP  vs B\n", a, n[a],
                (g[a] / n[a] / G - 1) * 100, (K ? (k[a] / n[a] / K - 1) * 100 : 0), (Z ? (z[a] / n[a] / Z - 1) * 100 : 0), (E ? (e[a] / n[a] / E - 1) * 100 : 0)}}' results.txt
# the site reads the first cpu MHz line: the best solve
bt=$(awk '$3 > g {g = $3; t = $1} END {print t}' results.txt)
[ -n "$bt" ] && sort -n "mhz.$bt.log" 2>/dev/null |
  awk -v t="$bt" '{v[++n]=$1; s+=$1} END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples, median %.0f (%s)\n", s/n, v[1], v[n], n, v[int((n+1)/2)], t}'
[ -z "$failed" ] || { echo "failed  :$failed"; exit 1; }
