#!/usr/bin/env bash
# Run MFC's own test suite on Xenon.  SCC26 practice task 1.
# CLUSTER=launchpad for launchpad.
#
#   suites/MFC/run-tests.sh cpu           # full suite on one Haswell node (~1 h)
#   suites/MFC/run-tests.sh gpu           # full suite on 4 A100s (~35-60 min)
#   suites/MFC/run-tests.sh cpu --smoke   # 17 one-dimensional tests (~5 min)
#   suites/MFC/run-tests.sh gpu --smoke
#
# Submits one batch job and waits. Exit code is the number of failed tests.
#
# not a leaderboard submission: nothing to rank, takes ~1h, and --generate
# would rewrite the golden files.
#
#   --binary mpirun   srun is much slower here and HPC-X has no slurm PMI
#   --ntasks-per-node PRRTE needs it for the slot count
#   --max-attempts 3  NFS "Text file busy" flakes, same as MFC's CI
set -euo pipefail

MODE=${1:-}; shift || true
SMOKE=""
for a in "$@"; do
  case "$a" in
    --smoke) SMOKE=1 ;;
    --generate|--add-new-variables|--remove-old-tests)
      echo "refusing $a: it rewrites the golden files every later test is compared against, in a checkout shared by everyone and pinned by suite.yml" >&2
      exit 2 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
CLUSTER_NAME="${CLUSTER:-xenon}"
case "$CLUSTER_NAME" in
  xenon)     STAGE=/work/leaderboard/mfc-tests ;;
  launchpad) STAGE=/data/leaderboard/mfc-tests ;;
  *) echo "MFC tests are not set up on cluster '$CLUSTER_NAME'" >&2; exit 2 ;;
esac
mkdir -p "$STAGE"

# /home is node-local, stage env onto shared storage
cp "$REPO/suites/MFC/environment.sh" "$STAGE/environment.sh"

case "$CLUSTER_NAME:$MODE" in
  xenon:cpu)
    TREE=/work/mfc/current/haswell
    SBATCH_ARGS=(--partition=cpu --nodes=1 --ntasks-per-node=36 --exclusive --hint=nomultithread)
    ENVARG=none
    TESTARGS=(-j 32)
    ;;
  xenon:gpu)
    TREE=/work/mfc/current/zen3
    SBATCH_ARGS=(--partition=gpu --nodes=1 --ntasks-per-node=8 --gres=gpu:a100:4 --exclusive)
    ENVARG=acc
    # one worker per A100
    TESTARGS=(--gpu acc -j 4 -g 0 1 2 3)
    ;;
  # launchpad: 64 cores, 2x H100 NVL
  launchpad:cpu)
    TREE=/data/mfc/current/emr-cpu
    SBATCH_ARGS=(--partition="${PARTITION:-all}" --nodes=1 --ntasks-per-node=64 --exclusive --hint=nomultithread)
    ENVARG=none
    TESTARGS=(-j 32)
    ;;
  launchpad:gpu)
    TREE=/data/mfc/current/emr-acc
    SBATCH_ARGS=(--partition="${PARTITION:-all}" --nodes=1 --ntasks-per-node=4 --gres=gpu:2 --exclusive)
    ENVARG=acc
    TESTARGS=(--gpu acc -j 2 -g 0 1)
    ;;
  *) echo "usage: run-tests.sh cpu|gpu [--smoke]" >&2; exit 2 ;;
esac

if [ -n "$SMOKE" ]; then
  TESTARGS+=(--only 1D --shard 1/10)
  WALL=00:30:00
else
  WALL=03:00:00
fi

JOB="$STAGE/mfc-test-$MODE-$(date -u +%Y%m%dT%H%M%SZ)"
mkdir -p "$JOB"
cat > "$JOB/run.sh" <<EOF
#!/usr/bin/env bash
set -euo pipefail
. "$STAGE/environment.sh" $ENVARG $CLUSTER_NAME || exit 1
cd "$TREE" || exit 1
./mfc.sh test ${TESTARGS[*]} --max-attempts 3 -- --binary mpirun
EOF
chmod +x "$JOB/run.sh"

echo "tree:    $TREE"
echo "log:     $JOB/test.out"
echo "command: ./mfc.sh test ${TESTARGS[*]} --max-attempts 3 -- --binary mpirun"
echo

set +e
sbatch --wait "${SBATCH_ARGS[@]}" --time="$WALL" \
       --job-name="mfc-test-$MODE" \
       --output="$JOB/test.out" --error="$JOB/test.out" \
       "$JOB/run.sh"
rc=$?
set -e

echo
tail -30 "$JOB/test.out" 2>/dev/null || true
if [ -s "$TREE/tests/failed_uuids.txt" ]; then
  echo
  echo "failed test UUIDs ($(wc -l < "$TREE/tests/failed_uuids.txt")):"
  sed 's/^/  /' "$TREE/tests/failed_uuids.txt"
  echo "inspect one with: ls $TREE/tests/<UUID>/"
fi
echo
echo "exit $rc (this is the number of failed tests)"
exit $rc
