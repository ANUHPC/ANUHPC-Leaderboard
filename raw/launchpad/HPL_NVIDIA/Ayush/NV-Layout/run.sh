#!/bin/bash
#SBATCH --job-name=hpl-nv-layout
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=00:30:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
# NVIDIA sample-dat layout (NB=1024, 2x1, N sized for 94 GB) vs our best (NB=2048, 1x2), 400 W
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

trap 'sudo -n nvidia-smi -pl "$PL_START" >/dev/null' EXIT
trap 'exit 143' TERM INT
sudo -n nvidia-smi -pl "$PL_MAX" | grep 'set to' || echo "power limit not changed"

# Copy HPL.dat with some lines changed: dat <name> <line>=<value> ...
dat() {
  local name=$1; shift; local e=()
  for kv in "$@"; do e+=(-e "${kv%%=*}s/^[^ ]*/${kv#*=}/"); done
  sed "${e[@]}" HPL.dat > "HPL-$name.dat"
}

run() {
  local name=$1; shift
  echo "=== $name ==="
  mpirun -np "${SLURM_NTASKS}" "$@" < /dev/null 2>&1 | tee "hpl-$name.log"
  local used; used=$(grep -a -m1 '^ *Used ' "hpl-$name.log" | awk '{print $3}')
  awk -v t="$name" -v u="${used:-?}" '/^ *W[RC]/{g=$7; s=$6; n=$2; nb=$3; p=$4; qq=$5}
    END{if(g) printf "%-12s %8.0f GFLOP/s  %6.2f s  N=%s NB=%s %sx%s  used %s GiB\n", t, g, s, n, nb, p, qq, u; else print t ": FAILED, no result"}' \
    "hpl-$name.log" | tee -a summary.txt
}

# Lines: 6 N, 8 NB, 11 P, 12 Q
dat nv-2x1      6=147456 8=1024 11=2 12=1
dat nv-1x2      6=147456 8=1024
dat nv-2x1-safe 6=145408 8=1024 11=2 12=1

# Our best (N=143360 NB=2048 1x2)
run best "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat"
grep -q '^best ' summary.txt || { cat summary.txt; exit 1; }

# Skip the component tests from here
NOTEST=(-x HPL_CUSOLVER_MP_TESTS=0)
for name in nv-2x1 nv-1x2 nv-2x1-safe; do
  run "$name" "${NOTEST[@]}" "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL-$name.dat"
done
# Best again to see run to run noise
run best-again "${NOTEST[@]}" "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat"

echo "=== summary ==="; cat summary.txt
