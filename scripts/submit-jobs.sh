#!/usr/bin/env bash
# Submit every staged job and wait for it.
#
#   submit-jobs.sh <stage-dir> <cluster> <run-id>
#
# Called by .github/workflows/submit-<cluster>.yml. The staged tree is
# <stage>/<suite>/<group>/<run>/ and lives on the shared filesystem, so compute
# nodes open the same files the runner wrote — no distribute, no gather.
set -euo pipefail

STAGE="${1:?usage: submit-jobs.sh <stage-dir> <cluster> <run-id>}"
CLUSTER="${2:?}"
RUN_ID="${3:?}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HPL_BIN="${HPL_BIN:-/apps/benchmarks/hpl/current/bin/xhpl}"
MPI_PREFIX="${MPI_PREFIX:-/apps/openmpi/5.0.10}"
UCX_PREFIX="${UCX_PREFIX:-/apps/ucx/1.22.0}"

joblist="$STAGE/.joblist"; : > "$joblist"
shopt -s nullglob

for jobdir in "$STAGE"/*/*/*/; do
  jobdir="${jobdir%/}"
  suite="$(basename "$(dirname "$(dirname "$jobdir")")")"
  label="${jobdir#$STAGE/}"

  case "$suite" in
    HPL)
      if [ ! -x "$HPL_BIN" ]; then
        echo "::error::$label: no xhpl at $HPL_BIN — publish it to /apps first"; continue
      fi
      cp "$HPL_BIN" "$jobdir/xhpl"; chmod +x "$jobdir/xhpl"
      script="$(ls "$jobdir"/*.sh 2>/dev/null | head -1 || true)"
      if [ -z "$script" ]; then
        echo "::error::$label: no run.sh — HPL needs one (see input/_TEMPLATES/HPL)"; continue
      fi
      # A run.sh carried over from another cluster will name nodes that do not
      # exist here and fail after queueing. Catch it now.
      if grep -qE '^\s*#SBATCH\s+--nodelist=' "$script"; then
        echo "::warning::$label: run.sh pins --nodelist; node names differ between clusters"
      fi
      jid="$(sbatch --parsable --chdir="$jobdir" \
               --output="$jobdir/run.out" --error="$jobdir/run.err" "$script" 2>&1)"
      if [[ "$jid" =~ ^[0-9]+$ ]]; then
        echo "$jobdir:$jid" >> "$joblist"; echo "submitted $label -> job $jid"
      else
        echo "::error::$label: sbatch refused: $jid"
      fi
      ;;
    MFC)
      if [ ! -d /apps/mfc/current ]; then
        echo "::error::$label: /apps/mfc/current missing — MFC is not published on $CLUSTER"; continue
      fi
      bash "$REPO/suites/MFC/render.sh" "$jobdir" "$RUN_ID" \
        && echo "submitted $label" || echo "::error::$label: MFC submit failed"
      ;;
    *)
      echo "::warning::$label: no submit path for suite $suite"
      ;;
  esac
done

[ -s "$joblist" ] || { echo "nothing queued via sbatch"; exit 0; }

ids="$(cut -d: -f2 "$joblist" | paste -sd,)"
echo "waiting on: $ids"
while squeue -h -j "$ids" -o '%i' 2>/dev/null | grep -q .; do sleep 15; done

rc=0
while IFS=: read -r d j; do
  state="$(sacct -n -X -j "$j" -o State 2>/dev/null | tr -d ' ' | head -1)"
  printf 'job %-8s %-12s %s\n' "$j" "${state:-UNKNOWN}" "${d#$STAGE/}"
  [ "$state" = "COMPLETED" ] || rc=1
done < "$joblist"
exit $rc
