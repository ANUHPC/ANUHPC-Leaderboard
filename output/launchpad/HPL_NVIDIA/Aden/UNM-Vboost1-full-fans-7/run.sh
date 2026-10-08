#!/bin/bash
#SBATCH --job-name=hpl-fans-full
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=00:35:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
# Fans on Full. Aden/UNM-Vboost1 ran with the fans on Optimal (02): 78 C peak vs 69 C with Full,
# and its reference runs were ~1% under the earlier Full-fan runs. Same configs again, fans Full,
# to see what the fans are worth (Optimal: unm-vb1 71230/71250, unm-vb0 70350, N=144384 71040, ref-vb1 69970).
# The job sets the fan mode itself, checks it took, and puts the original mode back at the end.
# Each mpirun has a timeout so one hung run can't use up the job.
set -uo pipefail

HPL_ROOT=/home/nvidia/PROGRAMS/nvidia_hpl_benchmarks

source "$HPL_ROOT/hpc-benchmarks-gpu-env.sh"
export UCX_TLS=sm,self,cuda_copy,cuda_ipc CUDA_VISIBLE_DEVICES=0,1
ulimit -l unlimited; ulimit -n 65536

q() { nvidia-smi -i 0 --query-gpu="$1" --format=csv,noheader,nounits | cut -d. -f1; }
vb_now() { nvidia-smi boost-slider -l | awk '/vboost/{print $(NF-1); exit}'; }
PL_START=$(q power.limit); PL_MAX=$(q power.max_limit); VB_START=$(vb_now)
echo "node $(hostname -s): power limit ${PL_START} W, max ${PL_MAX} W, vboost ${VB_START}"
# Fan mode: 01 Full, 02 Optimal (ipmitool raw 0x30 0x45 0x00 reads it, 0x30 0x45 0x01 <mode> sets it)
fan_now() { sudo -n ipmitool raw 0x30 0x45 0x00 2>/dev/null | tr -d ' \n'; }
FAN_START=$(fan_now)
echo "fan mode at start: ${FAN_START:-unreadable}"
# Don't touch the fans if the current mode can't be read back
case "$FAN_START" in 01|02|03|04) ;; *) echo "can't read the fan mode, stopping"; exit 1;; esac

# Put power limit, vboost and fan mode back to what they were
trap 'sudo -n nvidia-smi boost-slider --vboost "$VB_START" >/dev/null; sudo -n nvidia-smi -pl "$PL_START" >/dev/null; sudo -n ipmitool raw 0x30 0x45 0x01 "0x$FAN_START" >/dev/null 2>&1' EXIT
trap 'exit 143' TERM INT

if [ "$FAN_START" != 01 ]; then
  sudo -n ipmitool raw 0x30 0x45 0x01 0x01 >/dev/null 2>&1
  sleep 30   # let the fans spin up and the BMC settle
fi
FAN_NOW=$(fan_now)
echo "fan mode now: $FAN_NOW"
sudo -n ipmitool sdr type Fan 2>&1 | grep -v 'No Reading'
# The whole point of this job is Full fans, so stop here if it didn't take
if [ "$FAN_NOW" != 01 ]; then echo "fans are not on Full, stopping"; exit 1; fi
sudo -n nvidia-smi -pl "$PL_MAX" | grep 'set to' || echo "power limit not changed"

SMI=power.draw,clocks.sm,temperature.gpu,clocks_event_reasons.sw_power_cap,clocks_event_reasons.sw_thermal_slowdown,clocks_event_reasons.hw_slowdown
# A run is ~2 min including the component tests; a hang gets killed after 5
RUN_TIMEOUT=300

# Copy HPL.dat with some lines changed: dat <name> <line>=<value> ...
dat() {
  local name=$1; shift; local e=()
  for kv in "$@"; do e+=(-e "${kv%%=*}s/^[^ ]*/${kv#*=}/"); done
  sed "${e[@]}" HPL.dat > "HPL-$name.dat"
}

# Only count samples from the solve (power > half of peak)
busy() { awk -F', *' 'NR==FNR{if($1>m)m=$1;next} $1>m/2' "$1" "$1"; }
median_clock() { busy "smi-$1.csv" | awk -F', *' '{print $2+0}' | sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]+0}'; }

# run <name> <vboost> <dat file> [mpirun -x args...]
run() {
  local name=$1 vb=$2 datf=$3; shift 3
  echo "=== $name ==="
  # Start logging first so the settings stick (persistence mode is off)
  nvidia-smi --query-gpu="$SMI" --format=csv,noheader,nounits -lms 500 > "smi-$name.csv" & local smi=$!
  sudo -n nvidia-smi boost-slider --vboost "$vb" >/dev/null
  echo "vboost: $(vb_now)"
  # Log to a file, not a pipe: leftover ranks from a killed run would hold a pipe open and hang the script
  : > "hpl-$name.log"
  tail -n +1 -f "hpl-$name.log" & local tl=$!
  timeout -k 30 "$RUN_TIMEOUT" mpirun -np "${SLURM_NTASKS}" "$@" "$HPL_ROOT/hpl.sh" --dat "$PWD/$datf" < /dev/null >> "hpl-$name.log" 2>&1
  local rc=$?
  sleep 1; kill "$tl" "$smi" 2>/dev/null; wait "$tl" "$smi" 2>/dev/null
  # A killed run can leave ranks holding GPU memory, which would fail the next run
  [ "$rc" != 0 ] && { pkill -KILL -x xhpl 2>/dev/null; sleep 5; }
  local g; g=$(awk '/^ *W[RC]/{g=$7} END{print g+0}' "hpl-$name.log")
  if [ "$g" = 0 ]; then
    [ "$rc" = 124 ] && echo "$name: TIMED OUT after ${RUN_TIMEOUT}s" | tee -a summary.txt || echo "$name: FAILED, no result" | tee -a summary.txt
    return 1
  fi
  local gemm used
  gemm=$(grep -a -A1 'GEMM \*\*\*\*' "hpl-$name.log" | sed -n 's/.*, avg = \([0-9]*\.[0-9]*\).*/\1/p' | head -1)
  used=$(grep -a -m1 '^ *Used ' "hpl-$name.log" | awk '{print $6}')   # MAX across ranks
  busy "smi-$name.csv" | awk -F', *' -v t="$name" -v vb="$(vb_now)" -v g="$g" -v gm="${gemm:-?}" -v u="${used:-?}" -v med="$(median_clock "$name")" '
    {w+=$1; if($3>tmax)tmax=$3; cap+=($4~/^Active/); n++}
    END{if(n) printf "%-18s vb%s %6.0f GFLOP/s  %3.0f W/GPU  SM median %4d MHz  capped %3.0f%%  max %d C  GEMM/GPU %s  used %s GiB\n",
        t, vb, g, w/n, med, 100*cap/n, tmax, gm, u}' | tee -a summary.txt
}

# UNM env (component tests stay on, so GEMM/GPU shows the vboost effect)
UNM=(-x HPL_CTA_PER_FCT=32 -x HPL_CHUNK_SIZE_NBS=32 -x HPL_FCT_CHUNK_SIZE=32 -x HPL_ALLOC_HUGEPAGES=1 -x HPL_WARMUP_MPI=1)

# Lines: 6 N, 8 NB. HPL.dat is the UNM size (147456/1536). 148992 doesn't fit, so it's left out
dat ref     6=143360 8=2048
dat n144384 6=144384

# UNM size + env at vboost 1 twice (Optimal fans: 71230 / 71250), then vboost 0 (Optimal: 70350)
run unm-vb1          1 HPL.dat "${UNM[@]}"
run unm-vb1-again    1 HPL.dat "${UNM[@]}"
run unm-vb0          0 HPL.dat "${UNM[@]}"
# Smaller size with more memory headroom (Optimal: 71040)
run unm-144384-vb1   1 HPL-n144384.dat "${UNM[@]}"
# Old best, vboost 1 (Optimal: 69970)
run ref-vb1          1 HPL-ref.dat

echo "=== summary ==="; cat summary.txt
