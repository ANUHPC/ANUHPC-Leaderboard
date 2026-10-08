#!/bin/bash
#SBATCH --job-name=hpl-unm-vboost1
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=00:50:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
# Finishes Ayush/UNM-Vboost, which hung on N=148992 (out of GPU memory) before the vboost runs.
# UNM size (N=147456 NB=1536) at 400 W, fans Full, vboost 0/1/2, with and without the UNM env,
# plus N=144384, and our old best (N=143360 NB=2048) at the start and end for run to run noise.
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
# Fan mode: 01 Full, 02 Optimal
echo "fan mode: $(sudo -n ipmitool raw 0x30 0x45 0x00 2>&1)"

# Put power limit and vboost back to what they were
trap 'sudo -n nvidia-smi boost-slider --vboost "$VB_START" >/dev/null; sudo -n nvidia-smi -pl "$PL_START" >/dev/null' EXIT
trap 'exit 143' TERM INT
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

# Old best, vboost 0
run ref-vb0          0 HPL-ref.dat
# UNM size + env: vboost 0 (Ayush got 71110), then 1 twice and 2
run unm-vb0          0 HPL.dat "${UNM[@]}"
run unm-vb1          1 HPL.dat "${UNM[@]}"
run unm-vb1-again    1 HPL.dat "${UNM[@]}"
run unm-vb2          2 HPL.dat "${UNM[@]}"
# Same size without the UNM env: is the gain from N/NB or from the env?
run plain-vb1        1 HPL.dat
# Smaller UNM size with more memory headroom
run unm-144384-vb1   1 HPL-n144384.dat "${UNM[@]}"
# Old best again, vboost 1, for noise and to compare against unm-vb1
run ref-vb1          1 HPL-ref.dat

echo "=== summary ==="; cat summary.txt
