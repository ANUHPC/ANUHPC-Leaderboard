#!/bin/bash
# intel HPL power limit steps, N=222240 (60% of max N) NB=480 1x2
# PL1 250 -> 350 W per socket (SYS-221GE-NR is rated for 350 W cpus), fans full, turbo on
# stops raising at 87 C, on throttling or a failed run. limits, fans, turbo put back on exit

#SBATCH --job-name=hpl-launchpad-intel-power-limit
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

steps="250 275 300 325 350"
base=250
trip_c=87
# SYSFS is only for dry runs
sys=${SYSFS:-/sys}

echo "cpu     : $(lscpu | sed -n 's/^Model name: *//p')"
echo "ranks   : ${SLURM_NTASKS} x ${SLURM_CPUS_PER_TASK} cores"
echo "binary  : $IHPL"
echo "sha256  : $(sha256sum "$IHPL" | cut -c1-64)"
echo "blas    : oneMKL $(dpkg-query -W -f='${Version}' intel-oneapi-mkl-core-devel-2026.1)"
echo "mpi     : $(mpirun --version | head -1)"
env | grep -E '^(I_MPI_|HPL_LOG=|HPL_LARGEPAGE=|HPL_HOST_)' | sort | sed 's/^/env     : /'
echo "governor: $(sort "$sys"/devices/system/cpu/cpu[0-9]*/cpufreq/scaling_governor 2>/dev/null | uniq -c | awk '{printf "%s%s x%s", (NR > 1 ? ", " : ""), $2, $1}')"
echo "epb     : $(cat "$sys/devices/system/cpu/cpu0/power/energy_perf_bias" 2>/dev/null || echo n/a) (0 performance, 6 balanced, 15 power saving)"
echo "load    : $(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null) (1, 5, 15 min)"
sudo -n turbostat --debug --num_iterations 1 --interval 1 2>&1 | grep -E 'POWER_INFO|PKG Limit|DRAM_POWER_LIMIT|TEMPERATURE_TARGET' | sed 's/^/msr     : /'

put() { sudo -n sh -c 'v=$1; shift; for f; do echo "$v" > "$f"; done' sh "$@"; }
change() { [ "$(cat "$2")" = "$1" ] || put "$1" "$2"; }
zones=()
for z in "$sys"/class/powercap/intel-rapl:[0-9]; do grep -q '^package' "$z/name" 2>/dev/null && zones+=("$z"); done
pl() { local z; for z in "${zones[@]}"; do printf '%s PL1 %d W PL2 %d W  ' "$(cat "$z/name")" $(($(cat "$z/constraint_0_power_limit_uw") / 1000000)) $(($(cat "$z/constraint_1_power_limit_uw") / 1000000)); done; }
temps=()
for f in "$sys"/class/hwmon/hwmon*/temp*_label; do grep -q '^Package id' "$f" 2>/dev/null && temps+=("${f%_label}_input"); done
[ ${#temps[@]} -gt 0 ] || for z in "$sys"/class/thermal/thermal_zone*; do [ "$(cat "$z/type" 2>/dev/null)" = x86_pkg_temp ] && temps+=("$z/temp"); done
hottest() { local f c m=0; for f in "${temps[@]}"; do c=$(cat "$f" 2>/dev/null); c=$((${c:-0} / 1000)); [ "$c" -gt "$m" ] && m=$c; done; echo "$m"; }
throttles() { cat "$sys"/devices/system/cpu/cpu[0-9]*/thermal_throttle/package_throttle_count 2>/dev/null | awk '{s += $1} END {print s + 0}'; }
fan_mode() { sudo -n ipmitool raw 0x30 0x45 0x00 2>/dev/null | tr -d ' \n'; }
# fans ok, faulty (ns = not fitted), min and max RPM
fans() { sudo -n ipmitool sdr type Fan 2>/dev/null | awk -F'|' '{gsub(/ /, "", $3); r = $5 + 0} $3 == "ok" {n++; if (!lo || r < lo) lo = r; if (r > hi) hi = r} $3 != "ok" && $3 != "ns" {bad++} END {printf "%d %d %d %d\n", n, bad, lo, hi}'; }
turbo=$sys/devices/system/cpu/intel_pstate/no_turbo

saved=$(for z in "${zones[@]}"; do echo "$z $(cat "$z/constraint_0_power_limit_uw") $(cat "$z/constraint_1_power_limit_uw")"; done)
fan_found=$(fan_mode)
turbo_found=$(cat "$turbo" 2>/dev/null)
restore() { local z a b; while read -r z a b; do [ -n "$z" ] && change "$a" "$z/constraint_0_power_limit_uw" && change "$b" "$z/constraint_1_power_limit_uw"; done <<<"$saved"; }
# PL2 goes up with PL1 when it's lower
set_limit() {
  local uw=$(($1 * 1000000)) z a b p2
  while read -r z a b; do
    [ -n "$z" ] || continue
    p2=$((b > uw ? b : uw))
    change "$p2" "$z/constraint_1_power_limit_uw" && change "$uw" "$z/constraint_0_power_limit_uw" || return 1
    [ "$(cat "$z/constraint_0_power_limit_uw")" = "$uw" ] && [ "$(cat "$z/constraint_1_power_limit_uw")" = "$p2" ] || return 1
  done <<<"$saved"
}
put_back() {
  restore
  [ -n "$fan_found" ] && [ "$(fan_mode)" != "$fan_found" ] && sudo -n ipmitool raw 0x30 0x45 0x01 "0x$fan_found" > /dev/null
  [ -n "$turbo_found" ] && change "$turbo_found" "$turbo"
  echo "restored: $(pl)fan mode $(fan_mode), no_turbo=$(cat "$turbo" 2>/dev/null || echo n/a)"
}
trap 'put_back; kill $(jobs -p) 2>/dev/null' EXIT
trap 'exit 143' TERM INT

# fans full, turbo on
[ "$fan_found" = 01 ] || { sudo -n ipmitool raw 0x30 0x45 0x01 0x01 > /dev/null; sleep 30; }
[ "$turbo_found" = 1 ] && change 0 "$turbo"
read -r fan_ok fan_bad fan_lo fan_hi < <(fans)
echo "fan     : mode $(fan_mode) (01 full, 02 optimal), was ${fan_found:-?}, $fan_ok ok at $fan_lo-$fan_hi RPM, $fan_bad faulty"
echo "turbo   : no_turbo=$(cat "$turbo" 2>/dev/null || echo n/a), was ${turbo_found:-n/a}"
echo "limits  : $(pl)"
echo "temps   : ${#temps[@]} package sensors, hottest $(hottest) C, trip $trip_c C, $(throttles) throttles since boot"
awk -v b=$((base * 1000000)) 'NF && $2 != b {d = 1} END {exit d}' <<<"$saved" || echo "warning : found $(pl)not $base W, put back on exit"
[ ${#zones[@]} -gt 0 ] && [ ${#temps[@]} -ge ${#zones[@]} ] || { echo "warning : no power limits or package temps, $base W only"; steps=$base; }
[ "$(fan_mode)" = 01 ] && [ "$fan_ok" -gt 0 ] && [ "$fan_bad" -eq 0 ] || { echo "warning : fans not full or one is faulty, $base W only"; steps=$base; }
[ "$(cat "$turbo" 2>/dev/null)" != 1 ] || { echo "warning : turbo still off, $base W only"; steps=$base; }

out=$(scontrol show job "$SLURM_JOB_ID" | sed -n 's/^ *StdOut=//p')
out=${out:-$PWD/run.out}
solving() { tail -n1 "$out" 2>/dev/null | grep -q 'Column='; }
# real clock from turbostat, not /proc/cpuinfo
busy() { awk '/Bzy_MHz/ {for (i = 1; i <= NF; i++) c[$i] = i; next} c["Bzy_MHz"] && $1 + 0 > 0 {print $c["Bzy_MHz"]}' "$@"; }

solve() {
  local t=$1
  echo
  echo "test    : $t | NB 480 | $(pl)| fan mode $(fan_mode)"
  sync; sudo -n sh -c 'echo 3 > /proc/sys/vm/drop_caches' || echo "warning : could not drop the page cache"
  echo "numa    : $(numactl -H | awk '/free:/{printf "node %s %d GiB free  ", $2, $4/1024}')"

  # limits back if a package hits trip_c
  ( while sleep 2; do
      c=$(hottest)
      [ "$c" -ge "$trip_c" ] || continue
      restore; touch "tripped.$t"
      echo "tripped : $t at $c C, back to $(pl)"
      exit
    done ) &
  local watch=$!
  # power, clock, temp + system watts, sampled only while solving
  ( while :; do
      solving || { sleep 10; continue; }
      sudo -n turbostat --quiet --Summary --show Bzy_MHz,PkgWatt,PkgTmp --interval 10 --num_iterations 1 2>/dev/null || sleep 10
      sudo -n ipmitool sdr get "PW Consumption" 2>/dev/null | sed -n 's/^ *Sensor Reading *: *\([0-9.]*\).*/wall \1/p'
    done ) > "power.$t.log" &
  local power=$!

  # rank 0 -> numa node 0, rank 1 -> numa node 1
  mpirun -np "${SLURM_NTASKS}" -ppn "${SLURM_NTASKS_PER_NODE}" \
    bash -c 'export HPL_HOST_NODE=$((PMI_RANK % SLURM_NTASKS_PER_NODE)); exec numactl --localalloc "$0"' "$IHPL"
  local rc=$?
  kill "$watch" "$power" 2>/dev/null

  local watts mhz tmax wall gflops res
  read -r watts mhz tmax < <(awk '/PkgWatt/ {for (i = 1; i <= NF; i++) c[$i] = i; next}
       c["PkgWatt"] && $1 + 0 > 0 {s += $c["PkgWatt"]; f += $c["Bzy_MHz"]; if (c["PkgTmp"] && $c["PkgTmp"] > mt) mt = $c["PkgTmp"]; n++}
       END {if (n) printf "%.0f %.0f %d\n", s/n, f/n, mt; else print "- - -"}' "power.$t.log")
  wall=$(awk '$1 == "wall" && $2 + 0 > m {m = $2 + 0} END {if (m) printf "%.0f", m; else print "-"}' "power.$t.log")
  echo "power   : $t $watts W both packages, $mhz MHz, max $tmax C, system max $wall W"
  gflops=$(awk -v t="$t" '/^test    : / {cur = $3} cur == t && $1 ~ /^W[RC]/ && NF >= 7 {g = $7} END {print g}' "$out")
  res=$(awk -v t="$t" '/^test    : / {cur = $3} cur == t && /\.\.\.\.\.\. (PASSED|FAILED)/ {r = $NF} END {print r}' "$out")
  echo "$t ${gflops:--} $mhz $watts $tmax $wall ${res:--}" >> results.txt
  [ "$rc" -eq 0 ] || { failed="$failed $t"; echo "failed  : $t exited $rc"; return 1; }
}

failed=
for w in $steps; do
  t=pl$w
  [ "$w" = "$base" ] || [ "$(fan_mode)" = 01 ] || { echo "stop    : fans dropped out of full (now $(fan_mode))"; break; }
  set_limit "$w" || { echo "skip    : $t and up, limit didn't take ($(pl))"; restore; break; }
  th=$(throttles)
  stop=
  solve "$t" || stop="run failed"
  read -r _ _ _ watts _ _ res < <(tail -n1 results.txt)
  [ "$res" = PASSED ] || stop="${stop:+$stop, }residual ${res/#-/missing}"
  [ -e "tripped.$t" ] && stop="${stop:+$stop, }package hit $trip_c C"
  [ "$(throttles)" -gt "$th" ] && stop="${stop:+$stop, }throttling ($th -> $(throttles))"
  # not using the extra power = clock is maxed out
  [ -z "$stop" ] && [ "$watts" != - ] && [ "$watts" -lt $((${#zones[@]} * (w - 10))) ] &&
    stop="only using $watts of $((${#zones[@]} * w)) W, clock is maxed out"
  [ -n "$stop" ] && { echo "stop    : $stop"; break; }
done
restore

# vs pl250
echo
awk 'NR == 1 {b = $2 + 0}
     {printf "summary : %-6s %9s GFLOPS  %8s  %5s MHz  %4s W  %3s C  system %5s W  %s\n", $1, ($2 == "-" ? "-" : sprintf("%.2f", $2)),
             ($2 == "-" || b <= 0 ? "-" : sprintf("%+.2f%%", ($2 / b - 1) * 100)), $3, $4, $5, $6, $7}' results.txt
# site reads the first cpu MHz line, so use the best step's
best=$(awk '$2 != "-" && $2 + 0 > g {g = $2 + 0; t = $1} END {print t}' results.txt)
[ -n "$best" ] && busy "power.$best.log" | sort -n | awk -v t="$best" '{v[++n]=$1; s+=$1} END{if (n) printf "cpu MHz : avg %.0f, min %.0f, max %.0f over %d samples, median %.0f (%s)\n", s/n, v[1], v[n], n, v[int((n+1)/2)], t}'
[ -z "$failed" ] || { echo "failed  :$failed"; exit 1; }
