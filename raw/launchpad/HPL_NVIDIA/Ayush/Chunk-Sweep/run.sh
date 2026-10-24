#!/bin/bash
#SBATCH --job-name=hpl-chunk-sweep
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=00:30:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
# Best config (N=143360 NB=2048 1x2, 400 W), sweep HPL_CHUNK_SIZE_NBS and HPL_FCT_CHUNK_SIZE
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

HPL=("$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat")

run() {
  local name=$1; shift
  echo "=== $name ==="
  mpirun -np "${SLURM_NTASKS}" "$@" 2>&1 | tee "hpl-$name.log"
  awk -v t="$name" '/^ *W[RC]/{g=$7; s=$6} END{if(g) printf "%-14s %8.0f GFLOP/s  %6.2f s\n", t, g, s; else print t ": FAILED, no result"}' \
    "hpl-$name.log" | tee -a summary.txt
}

# Baseline (defaults: CHUNK_SIZE_NBS=16, FCT_CHUNK_SIZE=32)
run base "${HPL[@]}"
grep -q '^base ' summary.txt || { cat summary.txt; exit 1; }

# Skip the component tests from here
NOTEST=(-x HPL_CUSOLVER_MP_TESTS=0)
for nbs in 8 32; do
  run "nbs$nbs" "${NOTEST[@]}" -x HPL_CHUNK_SIZE_NBS=$nbs "${HPL[@]}"
done
for fct in 64 128; do
  run "fct$fct" "${NOTEST[@]}" -x HPL_FCT_CHUNK_SIZE=$fct "${HPL[@]}"
done
# Default again to see run to run noise
run base-again "${NOTEST[@]}" "${HPL[@]}"

echo "=== summary ==="; cat summary.txt
