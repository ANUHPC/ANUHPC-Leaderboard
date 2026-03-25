#!/bin/bash
# ============================================================
# HPL submission script for the XENON cluster
# Usage: ./submit-hpl-xenon.sh <GROUP> <RUN_NAME>
#   e.g. ./submit-hpl-xenon.sh Ayush test-run-1
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
CLUSTER="Xenon"
OUT_DIR="$(dirname "$0")/../public/data/runs/${SUITE}/${GROUP}/${RUN_NAME}"
mkdir -p "$OUT_DIR"

cat > job.sh << 'SLURM'
#!/bin/bash
#SBATCH --job-name=hpl
#SBATCH --ntasks=16
#SBATCH --cpus-per-task=4
#SBATCH --time=04:00:00
#SBATCH --nodes=4
#SBATCH --nodelist=node1,node2,node3,node4

export PATH=/opt/ompi-4.1.6/bin:$PATH
export LD_LIBRARY_PATH=/opt/ompi-4.1.6/lib:$LD_LIBRARY_PATH

mpirun ./xhpl 2>&1 | tee hpl.out
SLURM

sbatch job.sh
echo "Submitted HPL job. After completion, parse results into ${OUT_DIR}/run.json"
echo "Cluster tag to include in run.json: \"cluster\": \"${CLUSTER}\""
