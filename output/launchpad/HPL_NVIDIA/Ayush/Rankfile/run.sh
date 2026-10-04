#!/bin/bash
#SBATCH --job-name=hpl-rankfile
#SBATCH --nodes=1
#SBATCH --ntasks-per-node=2
#SBATCH --gres=gpu:2
#SBATCH --cpus-per-task=32
#SBATCH --partition=all
#SBATCH --time=00:30:00
#SBATCH --exclusive
#SBATCH --hint=nomultithread
# Rankfile: Test03 config at max power, ranks bound to NUMA 0 cores by mpirun
set -uo pipefail

HPL_ROOT=/home/nvidia/PROGRAMS/nvidia_hpl_benchmarks

source "$HPL_ROOT/hpc-benchmarks-gpu-env.sh"
export UCX_TLS=sm,self,cuda_copy,cuda_ipc CUDA_VISIBLE_DEVICES=0,1
ulimit -l unlimited; ulimit -n 65536

q() { nvidia-smi -i 0 --query-gpu="$1" --format=csv,noheader,nounits | cut -d. -f1; }
PL_START=$(q power.limit); PL_MAX=$(q power.max_limit)
echo "node $(hostname -s): power limit ${PL_START} W, max ${PL_MAX} W"

trap 'sudo -n nvidia-smi -pl "$PL_START" >/dev/null' EXIT
trap 'exit 143' TERM INT
sudo -n nvidia-smi -pl "$PL_MAX" | grep 'set to' || echo "power limit not changed"

# Both GPUs are on NUMA 0 (cores 0-31), 16 cores each
cat > rankfile <<EOF
rank 0=$(hostname -s) slot=0-15
rank 1=$(hostname -s) slot=16-31
EOF
cat rankfile

HPL=("$HPL_ROOT/hpl.sh" --dat "$PWD/HPL.dat" --gpu-affinity 0:1)

run() {
  local name=$1; shift
  echo "=== $name ==="
  mpirun -np "${SLURM_NTASKS}" --report-bindings "$@" 2>&1 | tee "hpl-$name.log"
  awk -v t="$name" '/^ *W[RC]/{g=$7; s=$6} END{if(g) printf "%-14s %8.0f GFLOP/s  %6.2f s\n", t, g, s; else print t ": FAILED, no result"}' \
    "hpl-$name.log" | tee -a summary.txt
}

# Baseline, same as Test03
run default "${HPL[@]}"
grep -q '^default ' summary.txt || { cat summary.txt; exit 1; }

# Skip the component tests from here
NOTEST=(-x HPL_CUSOLVER_MP_TESTS=0)
run rankfile      "${NOTEST[@]}" --rankfile rankfile "${HPL[@]}"
run default-again "${NOTEST[@]}" "${HPL[@]}"

echo "=== summary ==="; cat summary.txt
