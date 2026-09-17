#!/usr/bin/env bash
# Turn a job.yml into an ./mfc.sh run invocation and execute it.
#
#   render.sh <job-dir> <run-id>
#
# Called by .github/workflows/submit.yml. Runs on the controller, with the job
# directory already staged on the shared filesystem.
set -euo pipefail

JOB_DIR="${1:?usage: render.sh <job-dir> <run-id>}"
RUN_ID="${2:?usage: render.sh <job-dir> <run-id>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

APPS_MFC="${APPS_MFC:-/apps/mfc/current}"
SCRATCH="${SCRATCH:-/scratch/jobs/$RUN_ID}"
TEMPLATE="$REPO/suites/MFC/xenon.mako"

y() {  # y <file> <dotted.path> [default] — minimal reader for our own job.yml
  node -e '
    const {parseYaml}=await import(process.argv[1]);
    const fs=require("fs");
    const d=parseYaml(fs.readFileSync(process.argv[2],"utf8"));
    const v=process.argv[3].split(".").reduce((a,k)=>a==null?a:a[k],d);
    process.stdout.write(String(v==null?(process.argv[4]??""):v));
  ' "$REPO/scripts/lib/yaml.mjs" "$1" "$2" "${3:-}" 2>/dev/null
}

JOB="$JOB_DIR/job.yml"
[ -f "$JOB" ] || { echo "render: no job.yml in $JOB_DIR" >&2; exit 1; }

CASE=$(y "$JOB" case)
PART=$(y "$JOB" resources.partition cpu)
NODES=$(y "$JOB" resources.nodes 1)
TPN=$(y "$JOB" resources.tasks_per_node 1)
WALL=$(y "$JOB" resources.walltime 01:00:00)
GPU=$(y "$JOB" build.gpu none)
COPT=$(y "$JOB" build.case_optimization false)
GBPP=$(y "$JOB" tuning.gbpp 16)

# MFC builds into its own checkout (MFC_BUILD_DIR is hardcoded to
# <checkout>/build and is not settable from the environment), so give this run
# a private copy. cp -al makes it a hardlink tree: near-instant, and the build
# writes new files rather than editing tracked ones.
WORK="$SCRATCH/mfc"
if [ ! -d "$WORK" ]; then
  echo "render: linking $APPS_MFC/reference -> $WORK"
  cp -al "$APPS_MFC/reference" "$WORK"
fi

CFG="cpu"; [ "$GPU" != "none" ] && CFG="gpu"
PREBUILT="$APPS_MFC/build-$CFG"
if [ -d "$PREBUILT" ] && [ ! -d "$WORK/build" ]; then
  echo "render: seeding build/ from $PREBUILT"
  cp -a "$PREBUILT" "$WORK/build"
fi

# The case comes from the pinned checkout unless the entrant supplied their own
# (which makes the run unranked — see suites/MFC/suite.yml).
if [ -f "$JOB_DIR/case.py" ]; then
  CASE_PY="$JOB_DIR/case.py"
  echo "render: using submitted case.py (UNRANKED)"
else
  CASE_PY="$WORK/$(grep -A1 "slug: $CASE\$" "$REPO/suites/MFC/suite.yml" | awk '/path:/{print $2}')"
  [ -f "$CASE_PY" ] || { echo "render: case '$CASE' not found at $CASE_PY" >&2; exit 1; }
  cp "$CASE_PY" "$JOB_DIR/case.py"
  CASE_PY="$JOB_DIR/case.py"
fi

cd "$WORK"

if [ "$COPT" = "true" ]; then
  echo "render: case-optimized build (this costs the job's own walltime)"
  ./mfc.sh build --case-optimization -i "$CASE_PY" \
      ${GPU:+$([ "$GPU" != none ] && echo "--gpu $GPU")} -j "$(nproc)"
fi

set -x
exec ./mfc.sh run "$CASE_PY" \
  -e batch \
  -c "$TEMPLATE" \
  -t pre_process simulation \
  -N "$NODES" -n "$TPN" -p "$PART" -w "$WALL" \
  --name "mfc-$(basename "$JOB_DIR")" \
  -o "$JOB_DIR/summary.yaml" \
  $([ "$GPU" != none ] && echo "--gpu $GPU") \
  --wait \
  -- --gbpp "$GBPP"
