#!/usr/bin/env bash
# Build MFC on launchpad into /data/mfc/current/emr-cpu and emr-acc.
# Separate trees because MFC shares lapack/hdf5/silo between builds in one tree.
#
#   suites/MFC/build-launchpad.sh            # both
#   suites/MFC/build-launchpad.sh cpu|gpu    # one
#
# Toolchain install steps are in docs/MFC-LAUNCHPAD.md.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ROOT="${MFC_ROOT:-/data/mfc/current}"
PIN=$(awk '/^  pin:/{print $2}' "$REPO/suites/MFC/suite.yml")
NVHPC=/opt/nvidia/hpc_sdk/Linux_x86_64/26.9
JOBS="${JOBS:-64}"
MODE="${1:-all}"

die() { echo "build-launchpad: $*" >&2; exit 1; }

python3 -c 'import ensurepip' 2>/dev/null || die "need python3.12-venv"
command -v cmake >/dev/null                 || die "need cmake"
command -v mpif90 >/dev/null                || die "need openmpi-bin libopenmpi-dev"
[ "$MODE" = cpu ] || [ -x "$NVHPC/compilers/bin/nvfortran" ] || die "need nvhpc-26-9"

# MFC links -lnvhpcwrapnvtx, 26.9 calls it libnvhpcnvtx. environment.sh adds this dir to LDFLAGS.
mkdir -p /data/mfc/nvhpc-compat
ln -sfn "$NVHPC/compilers/lib/libnvhpcnvtx.so" /data/mfc/nvhpc-compat/libnvhpcwrapnvtx.so

TARGETS=(pre_process simulation post_process)

build() {  # build <tree> <none|acc>
  local tree=$ROOT/$1 mode=$2 gpu=no
  if [ "$mode" = acc ]; then gpu=acc; fi
  if [ ! -d "$tree/.git" ]; then
    mkdir -p "$ROOT"
    git clone https://github.com/MFlowCode/MFC.git "$tree"
  fi
  git -C "$tree" checkout -q "$PIN"
  echo "build-launchpad: $tree @ $(git -C "$tree" describe --tags)"
  ( cd "$tree"
    . "$REPO/suites/MFC/environment.sh" "$mode" launchpad
    ./mfc.sh build --gpu "$gpu" -t "${TARGETS[@]}" -j "$JOBS" )
  ls -d "$tree"/build/install/*/
}

if [ "$MODE" = all ] || [ "$MODE" = cpu ]; then build emr-cpu none; fi
if [ "$MODE" = all ] || [ "$MODE" = gpu ]; then build emr-acc acc; fi
