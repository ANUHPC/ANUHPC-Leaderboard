#!/usr/bin/env bash
# Build cpu xhpl on launchpad: netlib HPL 2.3 + OpenBLAS + ubuntu OpenMPI 4.1.6.
# OpenBLAS is built here, the ubuntu package is old (0.3.26).
#
#   sbatch -p all -c 32 -t 00:30:00 suites/HPL/build-launchpad.sh
#
# installs to /data/benchmarks, submit-launchpad.yml copies hpl/current/bin/xhpl into each job.
set -euo pipefail

ROOT="${HPL_ROOT:-/data/benchmarks}"
OPENBLAS_VER="${OPENBLAS_VER:-0.3.34}"
HPL_VER=2.3
# 6548Y+ is emerald rapids, OpenBLAS has no target for it, sapphire rapids is the same core
TARGET="${OPENBLAS_TARGET:-SAPPHIRERAPIDS}"
JOBS="${JOBS:-${SLURM_CPUS_PER_TASK:-32}}"

OPENBLAS="$ROOT/openblas/$OPENBLAS_VER"
HPL="$ROOT/hpl/$HPL_VER-openblas$OPENBLAS_VER-ompi$(mpirun --version | awk 'NR==1{print $NF}')"
SRC="$ROOT/src"

die() { echo "build-launchpad: $*" >&2; exit 1; }
command -v mpicc >/dev/null    || die "need openmpi-bin libopenmpi-dev"
command -v gfortran >/dev/null || die "need gfortran"

mkdir -p "$SRC"
cd "$SRC"

if [ ! -f "$OPENBLAS/lib/libopenblas.so" ]; then
  [ -f "OpenBLAS-$OPENBLAS_VER.tar.gz" ] || curl -fsSLO "https://github.com/OpenMathLib/OpenBLAS/releases/download/v$OPENBLAS_VER/OpenBLAS-$OPENBLAS_VER.tar.gz"
  rm -rf "OpenBLAS-$OPENBLAS_VER" && tar xzf "OpenBLAS-$OPENBLAS_VER.tar.gz"
  # openmp threads so OMP_NUM_THREADS/OMP_PLACES in run.sh work
  make -C "OpenBLAS-$OPENBLAS_VER" -j "$JOBS" TARGET="$TARGET" DYNAMIC_ARCH=0 \
       USE_OPENMP=1 NUM_THREADS=128 > "openblas-$OPENBLAS_VER.build.log" 2>&1 \
    || { tail -40 "openblas-$OPENBLAS_VER.build.log"; die "OpenBLAS build failed"; }
  make -C "OpenBLAS-$OPENBLAS_VER" PREFIX="$OPENBLAS" install > "openblas-$OPENBLAS_VER.install.log" 2>&1
fi
echo "build-launchpad: OpenBLAS $OPENBLAS_VER ($TARGET) at $OPENBLAS"

[ -f "hpl-$HPL_VER.tar.gz" ] || curl -fsSLO "https://www.netlib.org/benchmark/hpl/hpl-$HPL_VER.tar.gz"
rm -rf "hpl-$HPL_VER" && tar xzf "hpl-$HPL_VER.tar.gz"
( cd "hpl-$HPL_VER"
  # rpath so the xhpl copied into a job dir still finds OpenBLAS
  ./configure --prefix="$HPL" CC=mpicc \
      CFLAGS="-O3 -march=sapphirerapids -fopenmp" \
      LDFLAGS="-L$OPENBLAS/lib -Wl,-rpath,$OPENBLAS/lib -fopenmp" \
      LIBS="-lopenblas" > ../hpl-configure.log 2>&1 \
    || { tail -40 ../hpl-configure.log; die "HPL configure failed"; }
  make -j "$JOBS" > ../hpl-build.log 2>&1 || { tail -40 ../hpl-build.log; die "HPL build failed"; }
  make install > ../hpl-install.log 2>&1 )

ln -sfn "$HPL" "$ROOT/hpl/current"
ldd "$ROOT/hpl/current/bin/xhpl" | grep -E 'openblas|libmpi' || die "xhpl is not linked against OpenBLAS and MPI"
echo "build-launchpad: $ROOT/hpl/current -> $HPL"
