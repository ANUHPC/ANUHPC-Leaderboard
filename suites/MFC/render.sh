#!/usr/bin/env bash
# Turn a job.yml into an ./mfc.sh run invocation and execute it.
#
#   render.sh <job-dir> <run-id>
#
# Called by scripts/submit-jobs.sh. Runs on the cluster, as the runner account,
# with the job directory already staged on shared storage.
#
# ---------------------------------------------------------------------------
# Why this runs MFC in place rather than copying it per job
#
# MFC derives MFC_ROOT_DIR from realpath(toolchain/mfc/__init__.py) and hangs
# MFC_BUILD_DIR off it, so the build it uses is always <checkout>/build. You
# cannot point it elsewhere with an environment variable, which is why the
# obvious "one shared install, many jobs" layout needs care.
#
# The previous version gave each job a private hardlink copy. Measured, that
# does not work here:
#
#   cp -al /work -> /scratch     fails, separate NFS exports (EXDEV)
#   cp -al within /work          301 seconds, ~40k files of NFS metadata
#
# Five minutes of staging per job, or a 3.7 GB real copy, to run a benchmark
# that itself takes minutes. So jobs share one checkout per architecture and
# the only mutable file in it, build/lock.yaml, is group-writable.
#
# That is safe because submissions are serialised: submit-<cluster>.yml holds
# a concurrency group for the whole run and mfc.sh is invoked with --wait, so
# two MFC jobs never overlap on one cluster.
#
# ---------------------------------------------------------------------------
# Why there is one tree per CPU architecture
#
# MFC compiles Release builds with -march=native (cmake/GPU.cmake) and there is
# no switch to turn it off. The two node types are different microarchitectures
# -- Haswell on the cpu nodes, Zen 3 on the gpu nodes -- and the binaries really
# do differ, so one build cannot serve both:
#
#   haswell/build/install/*/bin/simulation   md5 aa0de75b...  3631896 bytes
#   zen3/build/install/*/bin/simulation      md5 9577d9e7...  3607256 bytes
#
# A binary built for the wrong one dies with SIGILL partway through a run, which
# looks like a crashed benchmark rather than a packaging mistake. Hence the
# partition -> tree mapping below, and the refusal to run on a mixed partition.
set -euo pipefail

JOB_DIR="${1:?usage: render.sh <job-dir> <run-id>}"
RUN_ID="${2:?usage: render.sh <job-dir> <run-id>}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# /work, not /apps: MFC writes build/lock.yaml on every run and /apps is
# exported read-only to the compute nodes, so it cannot live there.
MFC_ROOT="${MFC_ROOT:-/work/mfc/current}"
TEMPLATE="${MFC_TEMPLATE:-$REPO/suites/MFC/xenon.mako}"

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
COPT=$(y "$JOB" build.case_optimization false)
GBPP=$(y "$JOB" tuning.gbpp 16)
# Ranked runs need only pre_process and simulation -- grind comes from
# simulation. A visualisation run also needs post_process, which turns the
# raw output into the Silo/binary database ./mfc.sh viz reads.
VIZ=$(y "$JOB" visualize false)
TARGETS="pre_process simulation"
if [ "$VIZ" = "true" ]; then
  TARGETS="$TARGETS post_process"
fi

# --- pick the tree that matches the hardware this partition runs on ---------
case "$PART" in
  cpu) ARCH=haswell ;;
  gpu) ARCH=zen3 ;;
  all) die "partition 'all' mixes Haswell and Zen 3 nodes; MFC is built -march=native per architecture, so one job cannot span them. Use 'cpu' or 'gpu'." ;;
  *)   die "unknown partition '$PART' (expected cpu or gpu)" ;;
esac

TREE="$MFC_ROOT/$ARCH"
[ -d "$TREE" ]            || die "no MFC tree at $TREE — build it first (see clusters/xenon/toolchains.yml)"
[ -d "$TREE/build/install" ] || die "$TREE has no build/install — the tree is present but not built"
[ -w "$TREE/build/lock.yaml" ] || die "cannot write $TREE/build/lock.yaml as $(id -un); MFC rewrites it on every run"

# --- the run must be reproducible, so the source has to be the pinned sha ---
PIN=$(awk '/^  pin:/{print $2}' "$REPO/suites/MFC/suite.yml" 2>/dev/null)
# The installation is owned by anuhpc and used by xenonrun. Trust only this
# exact resolved checkout for the read, without changing global Git config.
HEAD=$(git -c safe.directory="$(realpath "$TREE")" -C "$TREE" rev-parse HEAD 2>/dev/null || echo unknown)
if [ -n "$PIN" ] && [ "$PIN" != "null" ]; then
  case "$HEAD" in
    "$PIN"*) : ;;
    *) die "$TREE is at $HEAD but suites/MFC/suite.yml pins $PIN — results would not be comparable" ;;
  esac
fi
echo "render: $ARCH tree $TREE @ ${HEAD:0:12}"

if [ "$COPT" = "true" ]; then
  die "case_optimization is not available yet: it recompiles MFC with the case baked in, which would rewrite the shared tree every other job reads. It needs a private per-job checkout, and staging one costs ~5 minutes of NFS metadata here."
fi

# --- the case comes from the pinned checkout unless one was submitted -------
if [ -f "$JOB_DIR/case.py" ]; then
  CASE_SOURCE=custom
  echo "render: using the submitted case.py — this run is UNRANKED"
else
  CASE_SOURCE=pinned
  [ -n "$CASE" ] || die "job.yml sets no case, and no case.py was supplied"
  # Resolve the slug through a real parser, not grep: the case list is a YAML
  # sequence of maps and "grep -A1 slug:" returns the wrong path the moment
  # anyone reorders it or writes path before slug.
  if ! REL=$("$NODE_BIN" "$REPO/suites/MFC/case-path.mjs" "$CASE" 2>&1); then
    die "$REL"
  fi
  SRC="$TREE/$REL"
  [ -f "$SRC" ] || die "case '$CASE' resolves to $SRC, which does not exist in the pinned checkout"
  cp "$SRC" "$JOB_DIR/case.py"
  echo "render: case $CASE from $REL"
fi

python3 - "$JOB_DIR" "$CASE_SOURCE" "$HEAD" "$CASE" <<'PY'
import hashlib, json, pathlib, sys
directory, origin, commit, slug = sys.argv[1:]
p = pathlib.Path(directory)
(p / 'mfc-provenance.json').write_text(json.dumps({
    'case_source': origin, 'mfc_sha': commit, 'case': slug or None,
    'case_sha256': hashlib.sha256((p / 'case.py').read_bytes()).hexdigest(),
}, indent=2) + '\n')
PY

# mfc.sh insists on being run from the checkout root, and writes the generated
# batch script next to the case file (which is in $JOB_DIR, not here).
cp "$REPO/suites/MFC/environment.sh" "$JOB_DIR/mfc-environment.sh"
cd "$TREE"

# --clean matters more than it looks. simulation opens time_data.dat with
# position='append' (src/simulation/m_start_up.fpp), and the grind figure the
# summary reports is the last field of the last line. Re-running into a dirty
# case directory therefore reports a number from a previous run.
#
# --no-build keeps the job off the shared tree's build/: the binaries are
# already there and a job must never recompile them underneath another job.
set -x
exec ./mfc.sh run "$JOB_DIR/case.py" \
  -e batch \
  -c "$TEMPLATE" \
  -t $TARGETS \
  -N "$NODES" -n "$TPN" -p "$PART" -w "$WALL" \
  --name "mfc-$(basename "$JOB_DIR")" \
  -o "$JOB_DIR/summary.yaml" \
  --no-build \
  --clean \
  --gpu "$GPU" \
  --wait \
  -- --gbpp "$GBPP"
