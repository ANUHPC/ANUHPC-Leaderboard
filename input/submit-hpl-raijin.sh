#!/bin/bash
# ============================================================
# HPL submission script for the RAIJIN cluster (NCI)
# Usage: ./submit-hpl-raijin.sh <GROUP> <RUN_NAME>
#   e.g. ./submit-hpl-raijin.sh Ayush test-raijin-1
#
# After completing, copy the output files into:
#   public/data/runs/HPL/<GROUP>/<RUN_NAME>/
# then run:
#   node scripts/generate-index.mjs
# and commit + push to the `website` branch.
# ============================================================

GROUP=${1:?Usage: $0 <GROUP> <RUN_NAME>}
RUN_NAME=${2:?Usage: $0 <GROUP> <RUN_NAME>}

SUITE="HPL"
CLUSTER="Raijin"
OUT_DIR="$(dirname "$0")/../public/data/runs/${SUITE}/${GROUP}/${RUN_NAME}"
mkdir -p "$OUT_DIR"

cat > job-raijin.sh << 'PBS'
#!/bin/bash
#PBS -N hpl
#PBS -l ncpus=48
#PBS -l mem=192GB
#PBS -l walltime=04:00:00
#PBS -l wd
#PBS -q normal
#PBS -l storage=scratch/your_project

module load openmpi/4.1.5
module load intel-mkl/2023.2.0

mpirun -np 48 ./xhpl 2>&1 | tee hpl.out
PBS

qsub job-raijin.sh
echo "Submitted HPL job to Raijin (NCI PBS). After completion, parse results into ${OUT_DIR}/run.json"
echo "Cluster tag to include in run.json: \"cluster\": \"${CLUSTER}\""
