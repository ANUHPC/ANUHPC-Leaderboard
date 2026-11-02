#!/bin/bash
#SBATCH --job-name=hpl-params
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=01:15:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
# HPL.dat params: best config (N=143360 NB=2048 1x2, 400 W), one param changed per run
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
  awk -v t="$name" '/^ *W[RC]/{g=$7; s=$6} END{if(g) printf "%-12s %8.0f GFLOP/s  %6.2f s\n", t, g, s; else print t ": FAILED, no result"}' \
    "hpl-$name.log" | tee -a summary.txt
}

# Baseline
run base "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat"
grep -q '^base ' summary.txt || { cat summary.txt; exit 1; }

# Lines: 9 PMAP, 15 PFACT, 17 NBMIN, 19 NDIV, 21 RFACT, 23 BCAST, 25 DEPTH,
#        26 SWAP, 27 swap threshold, 28 L1, 29 U, 30 EQUIL, 31 ALIGN
TESTS=(
  "pfact0 15=0"
  "pfact2 15=2"
  "nbmin4 17=4"
  "nbmin8 17=8"
  "ndiv3 19=3"
  "rfact1 21=1"
  "rfact2 21=2"
  "bcast0 23=0"
  "bcast1 23=1"
  "bcast4 23=4"
  "bcast5 23=5"
  "depth0 25=0"
  "depth2 25=2"
  "swap0 26=0"
  "swap2 26=2 27=2048"
  "l1-0 28=0"
  "u1 29=1"
  "equil1 30=1"
  "align16 31=16"
  "pmap0 9=0"
  "netlib 17=4 21=2 28=0 30=1"
)

# Skip the component tests from here
NOTEST=(-x HPL_CUSOLVER_MP_TESTS=0)
for t in "${TESTS[@]}"; do
  set -- $t; name=$1; shift
  dat "$name" "$@"
  run "$name" "${NOTEST[@]}" "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL-$name.dat"
done
# Baseline again to see run to run noise
run base-again "${NOTEST[@]}" "$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat"

echo "=== summary ==="; cat summary.txt
