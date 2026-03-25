#!/bin/bash
# ============================================================
# IQ-TREE submission script (works on Xenon or Raijin)
# Usage: ./submit-iqtree.sh <GROUP> <RUN_NAME> <ALIGNMENT_FILE> [CLUSTER]
#   e.g. ./submit-iqtree.sh Ayush iqtree-run-1 sequences.fasta Xenon
#
# After completing, copy the output files into:
#   public/data/runs/IQTree/<GROUP>/<RUN_NAME>/
# then run:
#   node scripts/generate-index.mjs
# and commit + push to the `website` branch.
# ============================================================

GROUP=${1:?Usage: $0 <GROUP> <RUN_NAME> <ALIGNMENT_FILE> [CLUSTER]}
RUN_NAME=${2:?Usage: $0 <GROUP> <RUN_NAME> <ALIGNMENT_FILE> [CLUSTER]}
ALIGNMENT=${3:?Usage: $0 <GROUP> <RUN_NAME> <ALIGNMENT_FILE> [CLUSTER]}
CLUSTER=${4:-Xenon}

SUITE="IQTree"
OUT_DIR="$(dirname "$0")/../public/data/runs/${SUITE}/${GROUP}/${RUN_NAME}"
mkdir -p "$OUT_DIR"

cp "$ALIGNMENT" "$OUT_DIR/alignment.fasta"

# Generate the job script (SLURM for Xenon, PBS for Raijin)
if [ "$CLUSTER" = "Raijin" ]; then
cat > "$OUT_DIR/job.sh" << PBSEOF
#!/bin/bash
#PBS -N iqtree-${RUN_NAME}
#PBS -l ncpus=48
#PBS -l mem=64GB
#PBS -l walltime=24:00:00
#PBS -l wd
#PBS -q normal
#PBS -l storage=scratch/your_project

module load iqtree/2.3.0

iqtree2 -s alignment.fasta -m MFP -bb 1000 -nt AUTO -ntmax 48 -pre iqtree_out 2>&1 | tee iqtree.log
PBSEOF
  cd "$OUT_DIR" && qsub job.sh
else
cat > "$OUT_DIR/job.sh" << SLURMEOF
#!/bin/bash
#SBATCH --job-name=iqtree-${RUN_NAME}
#SBATCH --ntasks=1
#SBATCH --cpus-per-task=16
#SBATCH --time=24:00:00
#SBATCH --mem=64G

module load iqtree/2.3.0 || true

iqtree2 -s alignment.fasta -m MFP -bb 1000 -nt AUTO -ntmax 16 -pre iqtree_out 2>&1 | tee iqtree.log
SLURMEOF
  cd "$OUT_DIR" && sbatch job.sh
fi

echo ""
echo "Submitted IQ-TREE job to ${CLUSTER}."
echo "After completion, run the parser:"
echo "  node scripts/parse-iqtree.mjs ${SUITE} ${GROUP} ${RUN_NAME} ${CLUSTER}"
