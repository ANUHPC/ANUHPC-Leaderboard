#!/bin/bash
#SBATCH --job-name=hpl-unm-vboost
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=00:50:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
# UNM Easley settings (NB=1536, CTA 32, chunk 32, hugepages, warmup MPI) at 400 W, fans Full, then vboost 1-4
# https://github.com/afasulo/HPL_GPU (2x H100 NVL, 73.12 TFLOPS)
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
echo "THP: $(cat /sys/kernel/mm/transparent_hugepage/enabled)"

# Put power limit and vboost back to what they were
trap 'sudo -n nvidia-smi boost-slider --vboost "$VB_START" >/dev/null; sudo -n nvidia-smi -pl "$PL_START" >/dev/null' EXIT
trap 'exit 143' TERM INT
sudo -n nvidia-smi -pl "$PL_MAX" | grep 'set to' || echo "power limit not changed"

SMI=power.draw,clocks.sm,temperature.gpu,clocks_event_reasons.sw_power_cap,clocks_event_reasons.sw_thermal_slowdown,clocks_event_reasons.hw_slowdown

# Copy HPL.dat with some lines changed: dat <name> <line>=<value> ...
dat() {
  local name=$1; shift; local e=()
  for kv in "$@"; do e+=(-e "${kv%%=*}s/^[^ ]*/${kv#*=}/"); done
  sed "${e[@]}" HPL.dat > "HPL-$name.dat"
}

# Only count samples from the solve (power > half of peak)
busy() { awk -F', *' 'NR==FNR{if($1>m)m=$1;next} $1>m/2' "$1" "$1"; }
median_clock() { busy "smi-$1.csv" | awk -F', *' '{print $2+0}' | sort -n | awk '{a[NR]=$1} END{print a[int((NR+1)/2)]+0}'; }

# run <name> <vboost> <mpirun args...>
run() {
  local name=$1 vb=$2; shift 2
  echo "=== $name ==="
  # Start logging first so the settings stick (persistence mode is off)
  nvidia-smi --query-gpu="$SMI" --format=csv,noheader,nounits -lms 500 > "smi-$name.csv" & local smi=$!
  sudo -n nvidia-smi boost-slider --vboost "$vb" >/dev/null
  echo "vboost: $(vb_now)"
  mpirun -np "${SLURM_NTASKS}" "$@" < /dev/null 2>&1 | tee "hpl-$name.log"
  kill "$smi"; wait "$smi" 2>/dev/null
  local g; g=$(awk '/^ *W[RC]/{g=$7} END{print g+0}' "hpl-$name.log")
  if [ "$g" = 0 ]; then echo "$name: FAILED, no result" | tee -a summary.txt; return 1; fi
  local gemm used
  gemm=$(grep -a -A1 'GEMM \*\*\*\*' "hpl-$name.log" | sed -n 's/.*, avg = \([0-9]*\.[0-9]*\).*/\1/p' | head -1)
  used=$(grep -a -m1 '^ *Used ' "hpl-$name.log" | awk '{print $3}')
  busy "smi-$name.csv" | awk -F', *' -v t="$name" -v vb="$(vb_now)" -v g="$g" -v gm="${gemm:-?}" -v u="${used:-?}" -v med="$(median_clock "$name")" '
    {w+=$1; if($3>tmax)tmax=$3; cap+=($4~/^Active/); hot+=($5~/^Active/ || $6~/^Active/); n++}
    END{if(n) printf "%-16s vb%s %6.0f GFLOP/s  %3.0f W/GPU  SM median %4d MHz  capped %3.0f%%  max %d C  GEMM/GPU %s  used %s GiB\n",
        t, vb, g, w/n, med, 100*cap/n, tmax, gm, u}' | tee -a summary.txt
}

# UNM env (component tests stay on, no end-of-run stall)
UNM=(-x HPL_CTA_PER_FCT=32 -x HPL_CHUNK_SIZE_NBS=32 -x HPL_FCT_CHUNK_SIZE=32 -x HPL_ALLOC_HUGEPAGES=1 -x HPL_WARMUP_MPI=1)

# Lines: 6 N, 8 NB. 147456 and 148992 are UNM's sizes, 144384 is a safer fit
dat unm-147456 6=147456 8=1536
dat unm-148992 6=148992 8=1536
dat unm-144384 6=144384 8=1536

# Our best (N=143360 NB=2048), vboost 0
run best 0 "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat"

# UNM settings, vboost 0
for n in 147456 148992 144384; do
  run "unm-$n" 0 "${UNM[@]}" "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL-unm-$n.dat"
done

# vboost 1-4 on whichever UNM size was fastest
pick=$(awk '/^unm-/ && $3+0>0 {if($3+0>b){b=$3+0; n=$1}} END{print n}' summary.txt)
if [ -n "$pick" ]; then
  for vb in 1 2 3 4; do
    run "$pick-vb$vb" "$vb" "${UNM[@]}" "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL-$pick.dat"
  done
else
  echo "no UNM size ran, skipping vboost"
fi
# Our best again, vboost 0, to see run to run noise
run best-again 0 "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat"

echo "=== summary ==="; cat summary.txt
