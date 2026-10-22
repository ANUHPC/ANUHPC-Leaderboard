#!/bin/bash
# intel HPL system-settings tests, solved back to back in one job. every solve uses
# the exact config of the best 85% run (Intel-Max-Fans-85%-N: N=314880 NB=384 1x2,
# same binary, MPI and binding) and changes one thing, so each is compared with the
# baseline solved first in this same job:
#   1-baseline   nothing changed
#   2-governor   scaling_governor=performance on every cpu
#   3-no-turbo   turbo off (intel_pstate no_turbo, or cpufreq boost)
#   4-largepage  HPL_LARGEPAGE=1, Intel HPL maps its memory with 2 MB pages
#   5-combined   governor + large pages
# no EPP test: this node has no energy_performance_preference (the sweep logged "epp n/a").
# no huge page reservation: the matrix is 739 GiB, which 4 GiB of hugetlb pages can't
# hold, so each solve records how much of its memory actually landed on huge pages.
# every test starts from the node's normal state (schedutil, turbo on), and whatever
# state the job found is put back on exit, however it ends.
# ~83 min a solve, ~7 h in all

#SBATCH --job-name=hpl-launchpad-intel-settings
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
# the submit workflow gives up at 8 h; end the job first so the results still get harvested
#SBATCH --time=07:45:00
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

# cpufreq knobs. CPU_SYSFS is only ever set to dry-run this script off the node
cpu=${CPU_SYSFS:-/sys/devices/system/cpu}
govs=("$cpu"/cpu[0-9]*/cpufreq/scaling_governor)
[ -e "${govs[0]}" ] || govs=()
# intel_pstate turns turbo off with no_turbo=1, acpi-cpufreq with boost=0
if [ -e "$cpu/intel_pstate/no_turbo" ]; then turbo=$cpu/intel_pstate/no_turbo turbo_off=1
elif [ -e "$cpu/cpufreq/boost" ]; then turbo=$cpu/cpufreq/boost turbo_off=0
else turbo= turbo_off=; fi
gov_now() { [ ${#govs[@]} -gt 0 ] && sort "${govs[@]}" | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}'; }
turbo_now() { if [ -n "$turbo" ]; then echo "${turbo##*/}=$(cat "$turbo")"; else echo none; fi; }
# put <value> <file>...: one sudo call, the value passed as an argument rather than on stdin
put() { sudo -n sh -c 'v=$1; shift; for f; do echo "$v" > "$f"; done' sh "$@"; }

echo "cpufreq : driver $(cat "$cpu/cpu0/cpufreq/scaling_driver" 2>/dev/null || echo unknown); governors $(cat "$cpu/cpu0/cpufreq/scaling_available_governors" 2>/dev/null || echo unknown)"
echo "governor: $(gov_now)"
echo "turbo   : $(turbo_now) (no_turbo=1 or boost=0 means off)"
echo "thp     : enabled $(cat /sys/kernel/mm/transparent_hugepage/enabled 2>/dev/null || echo unknown); defrag $(cat /sys/kernel/mm/transparent_hugepage/defrag 2>/dev/null || echo unknown); hugetlb $(awk '/^HugePages_Total/ {print $2}' /proc/meminfo 2>/dev/null) pages reserved"
echo "load    : $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null) (1, 5, 15 min, before the first solve)"
# the long-term package power cap; a package pinned at it under load is power limited, not thermal
echo "pkg cap : $(for z in /sys/class/powercap/intel-rapl:[0-9]; do awk -v n="$(cat "$z/name")" '{printf "%s %.0f W  ", n, $1/1e6}' "$z/constraint_0_power_limit_uw"; done 2>/dev/null)"

# the 85% run ran on the node's normal state, schedutil with turbo on, so every test starts
# from that. the node is shared: whatever is found here is put back on exit, however it ends
found="governor $(gov_now), turbo $(turbo_now)"
gov_saved=$(for f in "${govs[@]}"; do printf '%s %s\n' "$f" "$(cat "$f")"; done)
turbo_saved=${turbo:+$(cat "$turbo")}
def_gov=schedutil
grep -qw "$def_gov" "$cpu/cpu0/cpufreq/scaling_available_governors" 2>/dev/null || def_gov=$(cat "${govs[0]}" 2>/dev/null)
turbo_on=${turbo:+$((1 - turbo_off))}
defaults() {
  [ ${#govs[@]} -gt 0 ] && put "$def_gov" "${govs[@]}"
  [ -n "$turbo" ] && put "$turbo_on" "$turbo"
}
restore() {
  local g
  for g in $(awk 'NF == 2 {print $2}' <<<"$gov_saved" | sort -u); do
    put "$g" $(awk -v g="$g" '$2 == g {print $1}' <<<"$gov_saved")
  done
  [ -n "$turbo" ] && put "$turbo_saved" "$turbo"
}
trap 'restore; echo "restored: governor $(gov_now), turbo $(turbo_now)"; kill $(jobs -p) 2>/dev/null' EXIT
trap 'exit 143' TERM INT
defaults
[ "governor $(gov_now), turbo $(turbo_now)" = "$found" ] ||
  echo "warning : the node was left at $found; the tests run from governor $(gov_now), turbo $(turbo_now), and the found state is put back on exit"

# each returns non-zero unless the setting reads back as changed, so a solve never
# runs on a setting that silently failed to apply
set_governor() {
  grep -qw performance "$cpu/cpu0/cpufreq/scaling_available_governors" 2>/dev/null || return 1
  put performance "${govs[@]}"
  [ "$(gov_now)" = "performance x${#govs[@]}" ]
}
set_no_turbo() {
  [ -n "$turbo" ] || return 1
  put "$turbo_off" "$turbo"
  [ "$(cat "$turbo")" = "$turbo_off" ]
}

# clock, power, numa and huge pages, sampled only while solving
out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
# submit-jobs.sh sends stdout to run.out in the job dir: the fallback if scontrol says nothing
out=${out:-$PWD/run.out}
solving() { tail -n1 "$out" 2>/dev/null | grep -q 'Column='; }
failed=

# solve <test> [VAR=value ...]: one HPL run with the settings already applied
solve() {
  local t=$1; shift
  echo
  echo "test    : $t | governor $(gov_now) | turbo $(turbo_now) | env ${*:-none}"
  sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
  echo "numa    : $(numactl -H | awk '/free:/{printf "node %s %d GiB free  ", $2, $4/1024}')"

  ( while sleep 10; do
      solving || continue
      [ -s "numa.$t.log" ] || numastat -p xhpl > "numa.$t.log" 2>&1
      # once the matrix is allocated: how much of each rank is on 2 MB pages (THP or hugetlb)
      # and whether HPL_LARGEPAGE actually reached the rank
      [ -s "pages.$t.log" ] || for p in $(pgrep xhpl_intel64); do
        lp=$(tr '\0' '\n' < "/proc/$p/environ" | sed -n 's/^HPL_LARGEPAGE=//p')
        awk -v p="$p" -v lp="${lp:-unset}" '{v[$1] = $2} END {printf "pid %s HPL_LARGEPAGE=%s, rss %.0f GiB, thp %.0f GiB, hugetlb %.0f GiB\n",
                       p, lp, v["Rss:"]/1048576, v["AnonHugePages:"]/1048576, (v["Private_Hugetlb:"] + v["Shared_Hugetlb:"])/1048576}' "/proc/$p/smaps_rollup"
      done > "pages.$t.log" 2>/dev/null
      awk -F'\n' 'BEGIN{RS=""} {for (i=1; i<=NF; i++) {split($i, kv, /\t*: /); f[kv[1]]=kv[2]}
                  k=f["physical id"] "-" f["core id"]; if (f["cpu MHz"]+0 > m[k]) m[k]=f["cpu MHz"]+0}
                  END{for (k in m) {s+=m[k]; n++} printf "%.0f\n", s/n}' /proc/cpuinfo
    done ) > "cpufreq.$t.log" &
  local sampler=$!
  # turbostat's summary row sums PkgWatt over both packages and reports the hotter one's PkgTmp
  ( while :; do
      solving || { sleep 10; continue; }
      sudo -n turbostat --quiet --Summary --show Bzy_MHz,PkgWatt,PkgTmp --interval 10 --num_iterations 1 2>/dev/null || sleep 10
    done ) > "power.$t.log" &
  local power=$!

  # rank 0 -> numa node 0, rank 1 -> numa node 1, as in the baseline
  env "$@" mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
       bash -c 'export HPL_HOST_NODE=$((PMI_RANK % SLURM_NTASKS_PER_NODE)); exec numactl --localalloc "$0"' "$IHPL"
  local rc=$?
  kill "$sampler" "$power"
  defaults

  local mhz watts gflops
  mhz=$(sort -n "cpufreq.$t.log" | awk '{v[++n]=$1; s+=$1} END{if (n) printf "%.0f", s/n}')
  sort -n "cpufreq.$t.log" | awk -v t="$t" '{v[++n]=$1; s+=$1} END{if (n) printf "clock   : %s avg %.0f MHz, min %.0f, max %.0f over %d samples, median %.0f\n", t, s/n, v[1], v[n], n, v[int((n+1)/2)]}'
  watts=$(awk '/PkgWatt/ {for (i = 1; i <= NF; i++) c[$i] = i; next} c["PkgWatt"] && $1 + 0 > 0 {s += $c["PkgWatt"]; n++} END {if (n) printf "%.0f", s/n}' "power.$t.log")
  awk -v t="$t" '/PkgWatt/ {for (i = 1; i <= NF; i++) c[$i] = i; next}
       c["PkgWatt"] && $1 + 0 > 0 {w = $c["PkgWatt"]; s += w; if (w > mw) mw = w; if (c["PkgTmp"]) {x = $c["PkgTmp"]; if (x > mt) mt = x}; f += $c["Bzy_MHz"]; n++}
       END {if (n) printf "power   : %s avg %.0f W, max %.0f W over both packages; pkg temp max %d C; busy %.0f MHz avg over %d samples\n", t, s/n, mw, mt, f/n, n
            else printf "power   : %s not measured (turbostat unavailable)\n", t}' "power.$t.log"
  [ -s "pages.$t.log" ] && sed "s/^/pages   : $t /" "pages.$t.log"
  [ -s "numa.$t.log" ] && { echo "numa placement while solving, $t (MB):"; cat "numa.$t.log"; }
  # this test's result is the WR line after its own "test    :" marker
  gflops=$(awk -v t="$t" '/^test    : / {cur = $3} cur == t && $1 ~ /^W[RC]/ && NF >= 7 {g = $7} END {print g}' "$out")
  echo "$t ${gflops:--} ${mhz:--} ${watts:--}" >> results.txt
  [ "$rc" -eq 0 ] || { failed="$failed $t"; echo "failed  : $t exited $rc"; }
}

solve 1-baseline

if set_governor; then solve 2-governor
else echo "skip    : 2-governor, the governor did not change ($(gov_now))"; defaults; fi

if set_no_turbo; then solve 3-no-turbo
else echo "skip    : 3-no-turbo, turbo could not be turned off (${turbo:-no control found})"; defaults; fi

solve 4-largepage HPL_LARGEPAGE=1

if set_governor; then solve 5-combined HPL_LARGEPAGE=1
else echo "skip    : 5-combined, the governor did not change ($(gov_now))"; defaults; fi

# one table to read, every test against the baseline solved first
echo
awk 'NR == 1 {b = $2 + 0}
     {printf "summary : %-12s %9s GFLOPS  %8s  %5s MHz  %4s W\n", $1, ($2 == "-" ? "-" : sprintf("%.2f", $2)),
             ($2 == "-" || b <= 0 ? "-" : sprintf("%+.2f%%", ($2 / b - 1) * 100)), $3, $4}' results.txt
# the site reads the first "cpu MHz :" line: the mean over every test's samples
cat cpufreq.*.log 2>/dev/null | sort -n | awk '{v[++n]=$1; s+=$1} END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples, median %.0f\n", s/n, v[1], v[n], n, v[int((n+1)/2)]}'
[ -z "$failed" ] || { echo "failed  :$failed"; exit 1; }
