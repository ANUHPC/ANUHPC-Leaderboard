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
# job.yml uses 'none'; the pinned MFC CLI spells disabled offload 'no'.
MFC_GPU_MODE="$GPU"
[ "$GPU" != none ] || MFC_GPU_MODE=no
COPT=$(y "$JOB" build.case_optimization false)
GBPP=$(y "$JOB" tuning.gbpp 16)
# Ranked runs need only pre_process and simulation -- grind comes from
# simulation. A visualisation run also needs post_process, which turns the
# raw output into the Silo/binary database ./mfc.sh viz reads.
VIZ=$(y "$JOB" visualize false)
PREVIEW=$(y "$JOB" preview)
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

# --- case optimization, opt-in --------------------------------------------
#
# MFC's own help calls this "10x faster with case optimization!". It bakes
# parameters the solver would otherwise read at run time -- WENO order,
# bubble model, number of fluids -- into simulation as compile-time
# constants, which lets the compiler unroll and specialise.
#
# This was rejected here on the grounds that it "would rewrite the shared
# tree every other job reads". That was wrong. It changes only the generated
# source for simulation (case.py __get_sim_fpp), and build.py hashes that
# generated source into the install path, so a case-optimized build lands in
# its OWN directory beside the others and replaces nothing -- the same
# property that makes building an analytic-IC case safe.
#
# The real cost is time, so it stays opt-in: every distinct parameter set
# needs its own compile, roughly twelve minutes. For a single fast run that
# is worth it; for a sweep of twenty points it is twenty compiles.
CASE_OPT_ARGS=()
if [ "$COPT" = "true" ]; then
  CASE_OPT_ARGS=(--case-optimization)
  echo "render: case optimization ON — simulation will be compiled for these exact parameters (first run adds ~12 min)"
fi

# --- arguments for the case itself -----------------------------------------
#
# An MFC case is a program, and many take options: the 1D convergence example
# takes -N and --order, so a convergence study is the SAME case.py run at
# several grid sizes. Without a way to pass them, a sweep means editing the
# case between runs, which loses the one thing that makes a sweep readable --
# every run demonstrably came from identical code.
#
#   args: ["-N", "128", "--order", "5"]
#
# Read as a YAML sequence rather than a string so an argument containing
# spaces survives, and appended after MFC's own so a case can override.
mapfile -t USER_ARGS < <("$NODE_BIN" "$REPO/scripts/read-yaml.mjs" "$JOB" args --list 2>/dev/null || true)

# --- the case comes from the pinned checkout unless one was submitted -------
if [ -f "$JOB_DIR/case.py" ]; then
  CASE_SOURCE=custom
  CASE_ARGS=()
  echo "render: using the submitted case.py — this run does not join a ranked board"
else
  CASE_SOURCE=pinned
  [ -n "$CASE" ] || die "job.yml sets no case, and no case.py was supplied"
  # Resolve the slug through a real parser, not grep: the case list is a YAML
  # sequence of maps and "grep -A1 slug:" returns the wrong path the moment
  # anyone reorders it or writes path before slug.
  if ! REL=$("$NODE_BIN" "$REPO/suites/MFC/case-path.mjs" "$CASE" 2>&1); then
    die "$REL"
  fi
  CASE_ORIGIN=$("$NODE_BIN" "$REPO/suites/MFC/case-path.mjs" "$CASE" --field source)
  CASE_SIZING=$("$NODE_BIN" "$REPO/suites/MFC/case-path.mjs" "$CASE" --field sizing)

  # A registered case lives either in the pinned MFC checkout or in this repo.
  # Both are frozen -- the first by the commit pin verified above, the second
  # by git plus the hash check collect.mjs does on the harvested case.py.
  if [ "$CASE_ORIGIN" = repo ]; then
    SRC="$REPO/$REL"
    [ -f "$SRC" ] || die "case '$CASE' is registered as source: repo at $REL, which does not exist in this checkout"
  else
    SRC="$TREE/$REL"
    [ -f "$SRC" ] || die "case '$CASE' resolves to $SRC, which does not exist in the pinned checkout"
  fi

  # --gbpp goes only to cases that declare they take it. argparse in a
  # fixed-grid case rejects an unrecognised option and the job dies in
  # pre_process with a Python traceback rather than anything about MFC.
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
    # Which freeze applies: 'tree' cases are guaranteed by the commit pin,
    # 'repo' cases by the file committed here. Absent on runs from before
    # contributed cases existed, and read as 'tree'.
    'case_registry': registry,
    'case_sha256': hashlib.sha256((p / 'case.py').read_bytes()).hexdigest(),
}, indent=2) + '\n')
PY

# mfc.sh insists on being run from the checkout root, and writes the generated
# batch script next to the case file (which is in $JOB_DIR, not here).
cp "$REPO/suites/MFC/environment.sh" "$JOB_DIR/mfc-environment.sh"

# Load the same compiler and MPI here, not only inside the batch script.
#
# The batch template sources this on the compute node at job time, which was
# enough while --no-build meant nothing was ever compiled on the runner. It is
# not enough now: a case with analytic initial conditions compiles its own
# pre_process, that happens HERE, and cmake on this host without the Fortran
# MPI fails with
#
#     Could NOT find MPI (missing: MPI_Fortran_FOUND Fortran)
#
# which names neither MFC nor the case. Sourcing it twice is harmless -- the
# script only exports variables.
# shellcheck source=suites/MFC/environment.sh
. "$REPO/suites/MFC/environment.sh" "$GPU" || die "could not load the MFC environment for gpu=$GPU"
command -v mpif90 >/dev/null || die "no mpif90 on PATH after loading the environment for gpu=$GPU; MFC cannot build a target that needs compiling"
# mpif90 alone is not enough on the GPU side: nvfortran can be on PATH while
# CMake still picks /usr/bin/gfortran, because it takes the first Fortran
# compiler it finds rather than preferring PATH order. Check the variable that
# actually decides, not just that a compiler exists somewhere.
if [ "$GPU" = acc ]; then
  [ "${FC:-}" = nvfortran ] || die "FC is '${FC:-unset}', not nvfortran — CMake would configure the GPU build with gfortran and fail in a way that names neither MFC nor the case"
  command -v nvfortran >/dev/null || die "FC=nvfortran but nvfortran is not on PATH"
fi
cd "$TREE"

# --clean matters more than it looks. simulation opens time_data.dat with
# position='append' (src/simulation/m_start_up.fpp), and the grind figure the
# summary reports is the last field of the last line. Re-running into a dirty
# case directory therefore reports a number from a previous run.
#
# BUILDING IS ALLOWED, and must be.
#
# MFC compiles the case's analytic initial conditions into pre_process: a case
# that writes
#
#     "patch_icpp(1)%alpha_rho(1)": "0.5 + 0.2 * sin(2.0 * pi * x / lx)"
#
# has that expression turned into Fortran, and build.py hashes the generated
# source into the install path. Such a case therefore needs its OWN binary, and
# with --no-build it failed with "No such file or directory" on a build slug
# that had never existed -- after the job had queued.
#
# Every case that has run on this cluster so far happens to use numeric initial
# conditions, which is why this went unnoticed. It is not a safe assumption for
# a case handed to us to reproduce.
#
# Rebuilding under another job was the original worry, and it does not apply:
# build/install is keyed by that same slug, so a new build adds a directory and
# leaves every existing binary untouched. MFC also skips a target that is
# already built, so a case using an existing slug still compiles nothing.
# Submissions are serialised by the submit-xenon concurrency group, so two
# builds cannot race in build/staging.
# MFC hashes analytic initial conditions and optimized settings into each
# target's install path. Resolve those paths with MFC itself first. A complete
# cached install needs no rebuild: CMake otherwise reinstalls unchanged files
# and tries chmod on binaries owned by the account that built them, which
# fails for the Actions runner even when directories are group-writable.
# Missing targets still receive the required build pass; --no-build is never
# used to assume that a case-specific binary already exists.
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
# Validate independently: process substitution cannot propagate a parse error.
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

# Optional 1D/2D preview, generated headlessly by MFC's own visualization tool.
# 3D volume movies use suites/MFC/video.sh instead of this slice renderer.
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
