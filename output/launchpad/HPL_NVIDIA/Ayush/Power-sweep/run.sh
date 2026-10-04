#!/bin/bash
#SBATCH --job-name=hpl-power-sweep
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=00:45:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
# Power sweep: Test03 config at 310/350/400 W, then locked SM clocks
set -uo pipefail

HPL_ROOT=/home/nvidia/PROGRAMS/nvidia_hpl_benchmarks

source "$HPL_ROOT/hpc-benchmarks-gpu-env.sh"
export UCX_TLS=sm,self,cuda_copy,cuda_ipc CUDA_VISIBLE_DEVICES=0,1
ulimit -l unlimited; ulimit -n 65536

q() { nvidia-smi -i 0 --query-gpu="$1" --format=csv,noheader,nounits | cut -d. -f1; }
PL_DEF=$(q power.default_limit); PL_MAX=$(q power.max_limit)
echo "node $(hostname -s): power limit default ${PL_DEF} W, max ${PL_MAX} W"

trap 'sudo -n nvidia-smi -rgc >/dev/null; sudo -n nvidia-smi -pl "$PL_DEF" >/dev/null' EXIT
trap 'exit 143' TERM INT

SMI=power.draw,clocks.sm,temperature.gpu,clocks_event_reasons.sw_power_cap,clocks_event_reasons.sw_thermal_slowdown,clocks_event_reasons.hw_slowdown
# Hide the persistence mode warnings
set_gpus() { sudo -n nvidia-smi "$@" 2>&1 | grep -vE 'persistence mode|^$|All done'; }

# Only count samples from the solve (power > half of peak)
busy() { awk -F', *' 'NR==FNR{if($1>m)m=$1;next} $1>m/2' "$1" "$1"; }
median_clock() { busy "smi-$1.csv" | awk -F', *' '{print $2+0}' | sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]+0}'; }


run() {
  local name=$1 pl=$2 clk=${3:-}
  echo "=== $name ==="
  # Start logging first so the settings stick (persistence mode is off)
  nvidia-smi --query-gpu="$SMI" --format=csv,noheader,nounits -lms 500 > "smi-$name.csv" & local smi=$!
  set_gpus -pl "$pl"
  if [ -n "$clk" ]; then set_gpus -lgc "$clk,$clk"; else set_gpus -rgc; fi
  mpirun -np "${SLURM_NTASKS}" "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat" 2>&1 | tee "hpl-$name.log"
  kill "$smi"; wait "$smi" 2>/dev/null
  local g; g=$(awk '/^ *W[RC]/{g=$7} END{print g+0}' "hpl-$name.log")
  if [ "$g" = 0 ]; then echo "$name: FAILED, no result" | tee -a summary.txt; return 1; fi
  # If max clock > lock, the lock didn't apply
  busy "smi-$name.csv" | awk -F', *' -v t="$name" -v g="$g" -v med="$(median_clock "$name")" '
    {w+=$1; if($2>cmax)cmax=$2; if($3>tmax)tmax=$3; cap+=($4~/^Active/); hot+=($5~/^Active/ || $6~/^Active/); n++}
    END{if(n) printf "%-15s %6.0f GFLOP/s  %3.0f W/GPU  %5.1f GFLOP/s/W  SM median %4d MHz (max %4d)  power-capped %3.0f%%  max %d C  thermal slowdown: %s\n",
        t, g, w/n, g/(2*w/n), med, cmax, 100*cap/n, tmax, hot ? hot " samples" : "none"}' | tee -a summary.txt
}

# Baseline (same as Test03), then raise the power limit
run "pl$PL_DEF" "$PL_DEF" || { cat summary.txt; exit 1; }
run pl350 350
run "pl$PL_MAX" "$PL_MAX"

# Lock clocks at the median from each run, then 100 MHz lower
for pl in "$PL_DEF" "$PL_MAX"; do
  grep -q "^pl$pl " summary.txt || continue
  c=$(median_clock "pl$pl")
  for lock in "$c" $((c - 100)); do run "pl$pl-lock$lock" "$pl" "$lock"; done
done

echo "=== summary ==="; cat summary.txt
