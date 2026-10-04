#!/bin/bash
#SBATCH --job-name=hpl-fan-full
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=00:30:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
# Best config (N=143360 NB=2048 1x2, 400 W) with the fans on Full
set -uo pipefail

HPL_ROOT=/home/nvidia/PROGRAMS/nvidia_hpl_benchmarks

source "$HPL_ROOT/hpc-benchmarks-gpu-env.sh"
export UCX_TLS=sm,self,cuda_copy,cuda_ipc CUDA_VISIBLE_DEVICES=0,1
ulimit -l unlimited; ulimit -n 65536

q() { nvidia-smi -i 0 --query-gpu="$1" --format=csv,noheader,nounits | cut -d. -f1; }
PL_START=$(q power.limit); PL_MAX=$(q power.max_limit)
echo "node $(hostname -s): power limit ${PL_START} W, max ${PL_MAX} W"
# Fan mode: 01 Full, 02 Optimal
echo "fan mode: $(sudo -n ipmitool raw 0x30 0x45 0x00 2>&1)"
sudo -n ipmitool sdr type Fan 2>&1 | grep -v 'No Reading'

trap 'sudo -n nvidia-smi -pl "$PL_START" >/dev/null' EXIT
trap 'exit 143' TERM INT
sudo -n nvidia-smi -pl "$PL_MAX" | grep 'set to' || echo "power limit not changed"

SMI=power.draw,clocks.sm,temperature.gpu,clocks_event_reasons.sw_power_cap,clocks_event_reasons.sw_thermal_slowdown,clocks_event_reasons.hw_slowdown
HPL=("$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat")

# Only count samples from the solve (power > half of peak)
busy() { awk -F', *' 'NR==FNR{if($1>m)m=$1;next} $1>m/2' "$1" "$1"; }
median_clock() { busy "smi-$1.csv" | awk -F', *' '{print $2+0}' | sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]+0}'; }

run() {
  local name=$1; shift
  echo "=== $name ==="
  nvidia-smi --query-gpu="$SMI" --format=csv,noheader,nounits -lms 500 > "smi-$name.csv" & local smi=$!
  mpirun -np "${SLURM_NTASKS}" "$@" 2>&1 | tee "hpl-$name.log"
  kill "$smi"; wait "$smi" 2>/dev/null
  local g; g=$(awk '/^ *W[RC]/{g=$7} END{print g+0}' "hpl-$name.log")
  if [ "$g" = 0 ]; then echo "$name: FAILED, no result" | tee -a summary.txt; return 1; fi
  busy "smi-$name.csv" | awk -F', *' -v t="$name" -v g="$g" -v med="$(median_clock "$name")" '
    {w+=$1; if($3>tmax)tmax=$3; cap+=($4~/^Active/); hot+=($5~/^Active/ || $6~/^Active/); n++}
    END{if(n) printf "%-10s %6.0f GFLOP/s  %3.0f W/GPU  SM median %4d MHz  power-capped %3.0f%%  max %d C  thermal slowdown: %s\n",
        t, g, w/n, med, 100*cap/n, tmax, hot ? hot " samples" : "none"}' | tee -a summary.txt
}

# Same two runs as N143-CTA (69190 / 69270 GFLOP/s with fans on Optimal)
run best "${HPL[@]}"
run best-again -x HPL_CUSOLVER_MP_TESTS=0 "${HPL[@]}"

echo "=== summary ==="; cat summary.txt
