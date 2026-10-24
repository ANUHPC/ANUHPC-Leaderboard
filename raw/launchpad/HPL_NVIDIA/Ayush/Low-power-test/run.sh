#!/bin/bash
#SBATCH --job-name=hpl-lowpower
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --cpus-per-task=32
#SBATCH --gres=gpu:2
#SBATCH --partition=all
#SBATCH --time=00:30:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
set -uo pipefail   # no -e: a failed run must not skip the power reset

HPL_ROOT=/home/nvidia/PROGRAMS/nvidia_hpl_benchmarks

source "$HPL_ROOT/hpc-benchmarks-gpu-env.sh"
export UCX_TLS=sm,self,cuda_copy,cuda_ipc CUDA_VISIBLE_DEVICES=0,1
ulimit -l unlimited; ulimit -n 65536

q() { nvidia-smi -i 0 --query-gpu="$1" --format=csv,noheader,nounits | cut -d. -f1; }
PL_DEF=$(q power.default_limit); PL_MIN=$(q power.min_limit)
echo "node $(hostname -s): power limit default ${PL_DEF} W, min ${PL_MIN} W; cpus allowed: $(taskset -cp $$ | cut -d: -f2)"
nvidia-smi topo -m

# restore the node for the next user, even if a run fails or slurm kills the job
# (memory clocks can't be locked in a job here: H100 NVL only takes -lmcd, which needs a GPU reset)
trap 'sudo -n nvidia-smi -rgc; sudo -n nvidia-smi -pl "$PL_DEF"' EXIT
trap 'exit 143' TERM INT

# HPL output goes to stdout so it lands in run.out (the only .out the harvest keeps).
# --bind-to none: mpirun's default binds each rank to one core, which makes hpl.sh's numactl reject 0-15
run() {
  echo "=== $1 ==="
  nvidia-smi --query-gpu=power.draw,clocks.sm --format=csv,noheader,nounits -lms 500 > "smi-$1.csv" & local smi=$!
  mpirun -np 2 --bind-to none "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat" \
       --gpu-affinity 0:1 --cpu-affinity 0-15:16-31 --mem-affinity 0:0 2>&1 | tee "hpl-$1.log"
  kill "$smi"
  local g; g=$(awk '/^ *W[RC]/{g=$7} END{print g+0}' "hpl-$1.log")
  if [ "$g" = 0 ]; then echo "$1: FAILED, no result" | tee -a summary.txt; return 1; fi
  # average only the busy samples (> half of peak) so setup/verify don't dilute the solve
  awk -F', *' -v t="$1" -v g="$g" 'NR==FNR{if($1>m)m=$1;next} $1>m/2{w+=$1;s+=$2;n++}
       END{if(n) printf "%s: %.0f GFLOP/s, ~%.0f W per GPU, SM ~%.0f MHz, ~%.1f GFLOP/s/W\n", t, g, w/n, s/n, g/(2*w/n)}' \
       "smi-$1.csv" "smi-$1.csv" | tee -a summary.txt
}

# no point sweeping if the plain run doesn't work
run baseline || { cat summary.txt; exit 1; }

if ! sudo -n nvidia-smi -pl "$PL_DEF" >/dev/null; then
  echo "no passwordless sudo for nvidia-smi on this node: only the baseline ran"; exit 0
fi

# efficiency sweep, down from the default limit
for w in 275 250 225 200; do
  if (( w < PL_MIN )); then echo "pl$w: skipped, below min power limit ${PL_MIN} W"; continue; fi
  sudo -n nvidia-smi -pl "$w" >/dev/null && run "pl$w"
done

echo "=== summary ==="; cat summary.txt
