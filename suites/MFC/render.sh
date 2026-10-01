#!/usr/bin/env bash
# Turn a job.yml into an ./mfc.sh run invocation and execute it.
#
#   render.sh <job-dir> <run-id>
#
# Called by scripts/submit-jobs.sh. Runs on the cluster, as the runner account,
# with the job directory already staged on shared storage.
#
# jobs share one MFC checkout per arch (MFC always builds into <checkout>/build,
# and copying it per job is too slow on NFS). safe because submits are serialised.
# one tree per arch since MFC builds with -march=native; wrong arch = SIGILL.
set -euo pipefail

JOB_DIR="${1:?usage: render.sh <job-dir> <run-id>}"
RUN_ID="${2:?usage: render.sh <job-dir> <run-id>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# /work not /apps: MFC writes build/lock.yaml every run and /apps is read-only
MFC_ROOT="${MFC_ROOT:-/work/mfc/current}"
# CLUSTER comes from the submit workflow, unset means xenon
CLUSTER_NAME="${CLUSTER:-xenon}"
TEMPLATE="${MFC_TEMPLATE:-$REPO/suites/MFC/$CLUSTER_NAME.mako}"

die() { echo "render: $*" >&2; exit 1; }

NODE_BIN="${NODE_BIN:-node}"
command -v "$NODE_BIN" >/dev/null 2>&1 || NODE_BIN=/work/leaderboard/bin/node

y() {  # y <file> <dotted.path> [default]
  "$NODE_BIN" "$REPO/scripts/read-yaml.mjs" "$1" "$2" "${3:-}"
}

JOB="$JOB_DIR/job.yml"
[ -f "$JOB" ] || die "no job.yml in $JOB_DIR (MFC needs one: it names the case)"

CASE=$(y "$JOB" case)
PART=$(y "$JOB" resources.partition cpu)
NODES=$(y "$JOB" resources.nodes 1)
TPN=$(y "$JOB" resources.tasks_per_node 1)
WALL=$(y "$JOB" resources.walltime 01:00:00)
GPU=$(y "$JOB" build.gpu none)
# job.yml says 'none', MFC wants 'no'
MFC_GPU_MODE="$GPU"
[ "$GPU" != none ] || MFC_GPU_MODE=no
COPT=$(y "$JOB" build.case_optimization false)
GBPP=$(y "$JOB" tuning.gbpp 16)
# viz runs also need post_process for the silo output
VIZ=$(y "$JOB" visualize false)
PREVIEW=$(y "$JOB" preview)
TARGETS="pre_process simulation"
if [ "$VIZ" = "true" ]; then
  TARGETS="$TARGETS post_process"
fi

# --- pick the tree that matches the hardware this partition runs on ---------
case "$CLUSTER_NAME:$PART" in
  xenon:cpu) ARCH=haswell ;;
  xenon:gpu) ARCH=zen3 ;;
  xenon:all) die "partition 'all' mixes Haswell and Zen 3 nodes; MFC is built -march=native per architecture, so one job cannot span them. Use 'cpu' or 'gpu'." ;;
  xenon:*)   die "unknown partition '$PART' (expected cpu or gpu)" ;;
  # one tree per compiler, MFC shares lapack/hdf5/silo between builds in a tree
  launchpad:*) [ "$GPU" = acc ] && ARCH=emr-acc || ARCH=emr-cpu ;;
  *) die "MFC is not set up on cluster '$CLUSTER_NAME'" ;;
esac
[ -f "$TEMPLATE" ] || die "no batch template at $TEMPLATE for cluster $CLUSTER_NAME"

TREE="$MFC_ROOT/$ARCH"
[ -d "$TREE" ]            || die "no MFC tree at $TREE — build it first (see clusters/$CLUSTER_NAME/toolchains.yml)"
[ -d "$TREE/build/install" ] || die "$TREE has no build/install — the tree is present but not built"
[ -w "$TREE/build/lock.yaml" ] || die "cannot write $TREE/build/lock.yaml as $(id -un); MFC rewrites it on every run"

# --- the run must be reproducible, so the source has to be the pinned sha ---
PIN=$(awk '/^  pin:/{print $2}' "$REPO/suites/MFC/suite.yml" 2>/dev/null)
# tree is owned by anuhpc, so mark just this checkout safe for the read
HEAD=$(git -c safe.directory="$(realpath "$TREE")" -C "$TREE" rev-parse HEAD 2>/dev/null || echo unknown)
if [ -n "$PIN" ] && [ "$PIN" != "null" ]; then
  case "$HEAD" in
    "$PIN"*) : ;;
    *) die "$TREE is at $HEAD but suites/MFC/suite.yml pins $PIN — results would not be comparable" ;;
  esac
fi
echo "render: $ARCH tree $TREE @ ${HEAD:0:12}"

# --- case optimization, opt-in --------------------------------------------
# builds into its own hashed install dir so it doesn't touch the shared tree,
# but each parameter set is a ~12 min compile
CASE_OPT_ARGS=()
if [ "$COPT" = "true" ]; then
  CASE_OPT_ARGS=(--case-optimization)
  echo "render: case optimization ON — simulation will be compiled for these exact parameters (first run adds ~12 min)"
fi

# --- arguments for the case itself -----------------------------------------
#   args: ["-N", "128", "--order", "5"]
# yaml list so args with spaces survive; appended last so the case can override
mapfile -t USER_ARGS < <("$NODE_BIN" "$REPO/scripts/read-yaml.mjs" "$JOB" args --list 2>/dev/null || true)

# --- the case comes from the pinned checkout unless one was submitted -------
if [ -f "$JOB_DIR/case.py" ]; then
  CASE_SOURCE=custom
  CASE_ARGS=()
  echo "render: using the submitted case.py — this run does not join a ranked board"
else
  CASE_SOURCE=pinned
  [ -n "$CASE" ] || die "job.yml sets no case, and no case.py was supplied"
  if ! REL=$("$NODE_BIN" "$REPO/suites/MFC/case-path.mjs" "$CASE" 2>&1); then
    die "$REL"
  fi
  CASE_ORIGIN=$("$NODE_BIN" "$REPO/suites/MFC/case-path.mjs" "$CASE" --field source)
  CASE_SIZING=$("$NODE_BIN" "$REPO/suites/MFC/case-path.mjs" "$CASE" --field sizing)

  # case is either in the pinned MFC checkout or in this repo
  if [ "$CASE_ORIGIN" = repo ]; then
    SRC="$REPO/$REL"
    [ -f "$SRC" ] || die "case '$CASE' is registered as source: repo at $REL, which does not exist in this checkout"
  else
    SRC="$TREE/$REL"
    [ -f "$SRC" ] || die "case '$CASE' resolves to $SRC, which does not exist in the pinned checkout"
  fi

  # fixed-grid cases reject --gbpp in argparse
  if [ "$CASE_SIZING" = fixed ]; then
    CASE_ARGS=()
    echo "render: case $CASE has a fixed grid; --gbpp ($GBPP) is not passed"
  else
    CASE_ARGS=(--gbpp "$GBPP")
  fi

  cp "$SRC" "$JOB_DIR/case.py"
  echo "render: case $CASE from $CASE_ORIGIN:$REL"
fi

if [ ${#USER_ARGS[@]} -gt 0 ]; then
  CASE_ARGS+=("${USER_ARGS[@]}")
  echo "render: case arguments: ${USER_ARGS[*]}"
fi

python3 - "$JOB_DIR" "$CASE_SOURCE" "$HEAD" "$CASE" "${CASE_ORIGIN:-tree}" <<'PY'
import hashlib, json, pathlib, sys
directory, origin, commit, slug, registry = sys.argv[1:]
p = pathlib.Path(directory)
(p / 'mfc-provenance.json').write_text(json.dumps({
    'case_source': origin, 'mfc_sha': commit, 'case': slug or None,
    # 'tree' or 'repo'; missing on old runs means 'tree'
    'case_registry': registry,
    'case_sha256': hashlib.sha256((p / 'case.py').read_bytes()).hexdigest(),
}, indent=2) + '\n')
PY

# mfc.sh must run from the checkout root; the batch script lands next to case.py
cp "$REPO/suites/MFC/environment.sh" "$JOB_DIR/mfc-environment.sh"

# load the env here too, case-specific builds compile on this host
# shellcheck source=suites/MFC/environment.sh
. "$REPO/suites/MFC/environment.sh" "$GPU" "$CLUSTER_NAME" || die "could not load the MFC environment for gpu=$GPU on $CLUSTER_NAME"
command -v mpif90 >/dev/null || die "no mpif90 on PATH after loading the environment for gpu=$GPU; MFC cannot build a target that needs compiling"
# cmake can still pick /usr/bin/gfortran unless FC is set
if [ "$GPU" = acc ]; then
  [ "${FC:-}" = nvfortran ] || die "FC is '${FC:-unset}', not nvfortran — CMake would configure the GPU build with gfortran and fail in a way that names neither MFC nor the case"
  command -v nvfortran >/dev/null || die "FC=nvfortran but nvfortran is not on PATH"
fi
cd "$TREE"

# analytic ICs and case-opt get their own hashed install dirs, so ask MFC which
# targets are missing and only build those. rebuilding installed ones makes
# cmake chmod files owned by another account and fail.
./mfc.sh run "$JOB_DIR/case.py" \
  -e batch -c "$REPO/suites/MFC/build-probe.mako" \
  -t $TARGETS -N "$NODES" -n "$TPN" -p "$PART" -w "$WALL" \
  --name build-probe --dry-run --no-build \
  ${CASE_OPT_ARGS[0]+"${CASE_OPT_ARGS[@]}"} \
  --gpu "$MFC_GPU_MODE" -- "${CASE_ARGS[@]}" \
  || die "could not resolve this case's build targets"
mapfile -t MISSING_TARGETS < <(python3 - "$JOB_DIR/build-probe.sh" <<'PYPROBE'
import json, sys
with open(sys.argv[1]) as f:
    targets = json.load(f)
for name in dict.fromkeys(t['name'] for t in targets if not t['installed']):
    print(name)
PYPROBE
)
# process substitution hides parse errors, so check separately
python3 -m json.tool "$JOB_DIR/build-probe.sh" >/dev/null || die "invalid build probe"
if [ ${#MISSING_TARGETS[@]} -gt 0 ]; then
set -x
./mfc.sh run "$JOB_DIR/case.py" \
  -e batch \
  -c "$TEMPLATE" \
  -t "${MISSING_TARGETS[@]}" \
  -N "$NODES" -n "$TPN" -p "$PART" -w "$WALL" \
  --name "mfc-$(basename "$JOB_DIR")" \
  --dry-run \
  -j 8 \
  ${CASE_OPT_ARGS[0]+"${CASE_OPT_ARGS[@]}"} \
  --gpu "$MFC_GPU_MODE" \
  -- "${CASE_ARGS[@]}" \
  || die "MFC could not build the targets this case needs"
else
  echo "render: all case-specific targets already installed; reusing cached binaries"
fi

# --clean matters: time_data.dat is appended to, so a dirty dir gives an old grind
./mfc.sh run "$JOB_DIR/case.py" \
  -e batch \
  -c "$TEMPLATE" \
  -t $TARGETS \
  -N "$NODES" -n "$TPN" -p "$PART" -w "$WALL" \
  --name "mfc-$(basename "$JOB_DIR")" \
  -o "$JOB_DIR/summary.yaml" \
  --clean \
  --no-build \
  ${CASE_OPT_ARGS[0]+"${CASE_OPT_ARGS[@]}"} \
  --gpu "$MFC_GPU_MODE" \
  --wait \
  -- "${CASE_ARGS[@]}"

# optional 1D/2D preview. 3D movies use video.sh
if [ -n "$PREVIEW" ]; then
  ./mfc.sh viz "$JOB_DIR" --var "$PREVIEW" --step all --mp4 --fps 20 --output "$JOB_DIR"
  ./mfc.sh viz "$JOB_DIR" --var "$PREVIEW" --step last --png --output "$JOB_DIR"
fi

# Measure the registered one-period advection case before field data is left
# on cluster storage. Custom simulations need their own exact solution.
if [ "$CASE" = advection_1d ] && [ "$CASE_SOURCE" = pinned ]; then
  python3 "$REPO/suites/MFC/convergence-error.py" "$JOB_DIR" --json > "$JOB_DIR/convergence.json.tmp"
  mv "$JOB_DIR/convergence.json.tmp" "$JOB_DIR/convergence.json"
fi
