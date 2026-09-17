#!/usr/bin/env bash
# Run MFC's own test suite on Xenon.  SCC26 practice task 1.
#
#   suites/MFC/run-tests.sh cpu           # full suite on one Haswell node (~1 h)
#   suites/MFC/run-tests.sh gpu           # full suite on 4 A100s (~35-60 min)
#   suites/MFC/run-tests.sh cpu --smoke   # 17 one-dimensional tests (~5 min)
#   suites/MFC/run-tests.sh gpu --smoke
#
# Submits one batch job and waits. Exit code is the number of failed tests,
# which is what ./mfc.sh test itself returns.
#
# THIS IS NOT A LEADERBOARD SUBMISSION, deliberately. The suite verifies the
# build; it produces one bit and a log, with no grind time and nothing to
# rank. It also takes about an hour, and submissions are serialised, so
# routing it through the pipeline would park every entrant's benchmark behind
# it. And ./mfc.sh test --generate REWRITES the tracked golden files that
# every later test is compared against; a job.yml field that could reach it
# would be a live footgun. So it is a script you run, not a job you submit.
#
# EVERY FLAG BELOW IS LOAD-BEARING. Measured on this cluster:
#
#   --binary mpirun   MFC's default template picks its launcher from
#                     "jsrun srun mpirun mpiexec" and srun wins here. That is
#                     317 s per test against 42 s with mpirun, because Slurm
#                     serialises step creation, and it also produces spurious
#                     failures -- concurrent execve() of the same NFS binary
#                     gives "Text file busy" (6 of 34 tests in one sample).
#                     On GPU srun does not merely slow things down: NVHPC's
#                     HPC-X is not built with Slurm PMI, so all 17 GPU tests
#                     failed with "OPAL ERROR: Unreachable" until forced to
#                     mpirun.
#   --ntasks-per-node PRRTE reads SLURM_TASKS_PER_NODE for its slot count.
#                     Without it the two-rank tests die with "There are not
#                     enough slots available".
#   --max-attempts 3  NFS leaves a residual "Text file busy" flake even with
#                     mpirun. This is what MFC's own CI uses.
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
STAGE=/work/leaderboard/mfc-tests
mkdir -p "$STAGE"

# /home is node-local on this cluster, so a batch script running on a compute
# node cannot read the repository. Stage what it needs onto shared storage --
# the same reason render.sh copies environment.sh into the job directory.
cp "$REPO/suites/MFC/environment.sh" "$STAGE/environment.sh"

case "$MODE" in
  cpu)
    TREE=/work/mfc/current/haswell
    SBATCH_ARGS=(--partition=cpu --nodes=1 --ntasks-per-node=36 --exclusive --hint=nomultithread)
    ENVARG=none
    TESTARGS=(-j 32)
    ;;
  gpu)
    TREE=/work/mfc/current/zen3
    SBATCH_ARGS=(--partition=gpu --nodes=1 --ntasks-per-node=8 --gres=gpu:a100:4 --exclusive)
    ENVARG=acc
    # One worker per A100; -g hands each test the least-loaded device.
    TESTARGS=(--gpu acc -j 4 -g 0 1 2 3)
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
. "$STAGE/environment.sh" $ENVARG || exit 1
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
