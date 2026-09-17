#!/usr/bin/env bash
# Submit every staged job, report progress while it runs, and explain failures.
#
#   submit-jobs.sh <stage-dir> <cluster> <run-id>
#
# Called by .github/workflows/submit-<cluster>.yml. The staged tree is
# <stage>/<suite>/<group>/<run>/ and lives on the shared filesystem, so compute
# nodes open the same files the runner wrote — no distribute, no gather.
#
# Output is written for the Actions log: ::group:: to keep it navigable,
# ::error:: / ::warning:: so problems surface in the UI, and a markdown table in
# $GITHUB_STEP_SUMMARY so the run page shows results without opening the log.
set -uo pipefail

STAGE="${1:?usage: submit-jobs.sh <stage-dir> <cluster> <run-id>}"
CLUSTER="${2:?}"
RUN_ID="${3:?}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HPL_BIN="${HPL_BIN:-/apps/benchmarks/hpl/current/bin/xhpl}"
MPI_PREFIX="${MPI_PREFIX:-/apps/openmpi/5.0.10}"
POLL="${POLL_INTERVAL:-30}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

joblist="$STAGE/.joblist"; : > "$joblist"
# Jobs the scheduler refused. A run that stages work and submits none of it
# must not report success -- that is how a broken template stayed green while
# every student's job silently went nowhere.
rejected=0
shopt -s nullglob

# ---------------------------------------------------------------- helpers ---
group()    { echo "::group::$*"; }
endgroup() { echo "::endgroup::"; }
gh_error() { echo "::error::$*"; }
gh_warn()  { echo "::warning::$*"; }

# squeue knows about queued and running jobs; sacct knows about finished ones.
live_state() { squeue -h -j "$1" -o '%T' 2>/dev/null | head -1; }
live_reason(){ squeue -h -j "$1" -o '%R' 2>/dev/null | head -1; }
live_node()  { squeue -h -j "$1" -o '%N' 2>/dev/null | head -1; }
live_time()  { squeue -h -j "$1" -o '%M' 2>/dev/null | head -1; }

final_state(){ sacct -n -X -j "$1" -o State    2>/dev/null | head -1 | tr -d ' '; }
final_code() { sacct -n -X -j "$1" -o ExitCode 2>/dev/null | head -1 | tr -d ' '; }
final_time() { sacct -n -X -j "$1" -o Elapsed  2>/dev/null | head -1 | tr -d ' '; }
final_node() { sacct -n -X -j "$1" -o NodeList 2>/dev/null | head -1 | tr -d ' '; }

# Pull the headline number straight out of what the application wrote, so the
# log and the summary show the result rather than just "COMPLETED".
result_line() {
  local dir="$1" suite="$2"
  case "$suite" in
    HPL)
      local wr; wr="$(grep -hE '^WR[0-9A-Za-z]+' "$dir"/*.out 2>/dev/null | tail -1)"
      [ -n "$wr" ] || { echo ""; return; }
      # HPL prints Gflops in scientific notation; +0 coerces it to a number.
      awk '{printf "%.1f GFLOP/s  (N=%s NB=%s %sx%s, %.0fs)", $7+0, $2, $3, $4, $5, $6+0}' <<<"$wr"
      ;;
    MFC)
      local g; g="$(awk 'NF>=3 && $3+0==$3 {v=$3} END{if(v) print v}' "$dir/time_data.dat" 2>/dev/null)"
      [ -n "$g" ] && echo "$g ns/gp/eq/rhs" || echo ""
      ;;
    *) echo "" ;;
  esac
}

residual_line() {
  grep -hoE '\|\|Ax-b\|\|_oo[^=]*=\s*[0-9.eE+-]+\s*\.*\s*(PASSED|FAILED)' "$1"/*.out 2>/dev/null \
    | tail -1 | grep -oE '(PASSED|FAILED)'
}

# On failure the Actions log is the only place anyone will look, so put the
# actual error there rather than a path to a file on a cluster they cannot reach.
dump_failure() {
  local dir="$1" jid="$2" label="$3"
  group "FAILED: $label (job $jid)"
  echo "--- slurm ---"
  scontrol show job "$jid" 2>/dev/null | grep -oE 'JobState=\S+|Reason=\S+|ExitCode=\S+|DerivedExitCode=\S+|NodeList=\S+|RunTime=\S+' | sed 's/^/  /'
  sacct -j "$jid" --format=JobID,JobName,State,ExitCode,Elapsed,MaxRSS,NodeList 2>/dev/null | head -5 | sed 's/^/  /'
  for f in "$dir"/*.err; do
    [ -s "$f" ] || continue
    echo "--- $(basename "$f") (last 40 lines) ---"
    tail -40 "$f" | sed 's/^/  /'
  done
  for f in "$dir"/*.out; do
    [ -s "$f" ] || continue
    echo "--- $(basename "$f") (last 40 lines) ---"
    tail -40 "$f" | sed 's/^/  /'
  done
  endgroup
}

# ----------------------------------------------------------------- submit ---
group "Submitting"
for jobdir in "$STAGE"/*/*/*/; do
  jobdir="${jobdir%/}"
  suite="$(basename "$(dirname "$(dirname "$jobdir")")")"
  label="${jobdir#$STAGE/}"

  case "$suite" in
    HPL)
      if [ ! -x "$HPL_BIN" ]; then
        gh_error "$label: no xhpl at $HPL_BIN — publish it to /apps first"; continue
      fi
      cp "$HPL_BIN" "$jobdir/xhpl" && chmod +x "$jobdir/xhpl"
      # run.sh, or run.<this cluster>.sh -- the template ships the latter and
      # asking people to rename it buys nothing: the directory already says
      # which cluster this is. What must NOT happen is picking up another
      # cluster's script, so never glob *.sh and take the first match; that
      # would choose run.raijin.sh out of a wholesale template copy purely
      # because it sorts first.
      script=""
      for cand in "$jobdir/run.sh" "$jobdir/run.$CLUSTER.sh"; do
        [ -f "$cand" ] && { script="$cand"; break; }
      done
      if [ -z "$script" ]; then
        other="$(cd "$jobdir" && ls run.*.sh 2>/dev/null | tr '\n' ' ')"
        if [ -n "$other" ]; then
          gh_error "$label: found $other, which is for another cluster — use run.sh or run.$CLUSTER.sh"
        else
          gh_error "$label: no run.sh (cp input/_TEMPLATES/HPL/run.$CLUSTER.sh input/$CLUSTER/$label/run.sh)"
        fi
        continue
      fi
      echo "  using $(basename "$script") for $label"
      # A run.sh carried over from another cluster names nodes that do not exist
      # here and fails only after it has queued.
      if grep -qE '^\s*#SBATCH\s+--nodelist=' "$script"; then
        gh_warn "$label: run.sh pins --nodelist; node names differ between clusters"
      fi
      jid="$(sbatch --parsable --chdir="$jobdir" \
               --output="$jobdir/run.out" --error="$jobdir/run.err" "$script" 2>&1)"
      if [[ "$jid" =~ ^[0-9]+$ ]]; then
        echo "$jobdir|$suite|$label:$jid" >> "$joblist"
        echo "  submitted $label -> job $jid"
      else
        gh_error "$label: sbatch refused: $jid"
        # "Requested node configuration is not available" almost always means
        # the script asks for more cores than a node actually offers. Cores
        # reserved with CoreSpecCount do not count towards a job.
        case "$jid" in
          *"node configuration is not available"*)
            gh_error "$label: check #SBATCH ntasks-per-node x cpus-per-task against 'scontrol show node' (CPUTot minus CoreSpecCount)" ;;
        esac
        rejected=$((rejected+1))
      fi
      ;;
    MFC)
      if [ ! -d /apps/mfc/current ]; then
        gh_error "$label: /apps/mfc/current missing — MFC is not published on $CLUSTER"; continue
      fi
      if bash "$REPO/suites/MFC/render.sh" "$jobdir" "$RUN_ID"; then
        echo "  submitted $label"
      else
        gh_error "$label: MFC submit failed"
        rejected=$((rejected+1))
      fi
      ;;
    *) gh_warn "$label: no submit path for suite $suite" ;;
  esac
done
endgroup

if [ ! -s "$joblist" ]; then
  if [ "$rejected" -gt 0 ]; then
    gh_error "$rejected job(s) were staged but the scheduler refused every one — nothing ran"
    exit 1
  fi
  echo "Nothing queued via sbatch."
  exit 0
fi

total="$(wc -l < "$joblist")"
ids="$(cut -d: -f2 "$joblist" | paste -sd,)"

# ------------------------------------------------------------------- wait ---
echo "Waiting for $total job(s): $ids  (polling every ${POLL}s)"
start_ts=$(date +%s)
declare -A last_size
while squeue -h -j "$ids" -o '%i' 2>/dev/null | grep -q .; do
  now=$(date +%s); mins=$(( (now - start_ts) / 60 ))
  while IFS= read -r line; do
    entry="${line%:*}"; jid="${line##*:}"
    dir="${entry%%|*}"; rest="${entry#*|}"; label="${rest#*|}"
    st="$(live_state "$jid")"
    if [ -z "$st" ]; then
      printf '  [%3dm] job %-7s %-10s %s\n' "$mins" "$jid" "finished" "$label"
      continue
    fi
    # Output size growing is the only liveness signal HPL gives before it ends.
    sz=0; for f in "$dir"/*.out; do [ -f "$f" ] && sz=$((sz + $(stat -c %s "$f"))); done
    delta=$(( sz - ${last_size[$jid]:-0} )); last_size[$jid]=$sz
    case "$st" in
      PENDING) printf '  [%3dm] job %-7s PENDING    %-38s reason=%s\n' "$mins" "$jid" "$label" "$(live_reason "$jid")" ;;
      RUNNING) printf '  [%3dm] job %-7s RUNNING    %-38s on=%s elapsed=%s out=%sB(+%s)\n' \
                 "$mins" "$jid" "$label" "$(live_node "$jid")" "$(live_time "$jid")" "$sz" "$delta" ;;
      *)       printf '  [%3dm] job %-7s %-10s %s\n' "$mins" "$jid" "$st" "$label" ;;
    esac
  done < "$joblist"
  sleep "$POLL"
done
echo "All jobs have left the queue."

# --------------------------------------------------------------- report -----
{
  echo "## ${CLUSTER} — run \`${RUN_ID}\`"
  echo
  echo "| Job | Suite | State | Elapsed | Node | Result | Check |"
  echo "|-----|-------|-------|---------|------|--------|-------|"
} >> "$SUMMARY"

rc=0; failed=0; ok=0
while IFS= read -r line; do
  entry="${line%:*}"; jid="${line##*:}"
  dir="${entry%%|*}"; rest="${entry#*|}"; suite="${rest%%|*}"; label="${rest#*|}"

  state="$(final_state "$jid")"; [ -n "$state" ] || state="UNKNOWN"
  code="$(final_code "$jid")";   [ -n "$code" ]  || code="?"
  elapsed="$(final_time "$jid")"; node="$(final_node "$jid")"
  res="$(result_line "$dir" "$suite")"
  chk="$(residual_line "$dir")"

  printf '%-10s %-12s exit=%-6s %-9s %-11s %s\n' "job $jid" "$state" "$code" "$elapsed" "$node" "$label"
  [ -n "$res" ] && echo "           result: $res${chk:+  residual: $chk}"

  printf '| %s | %s | %s | %s | %s | %s | %s |\n' \
    "$jid" "$suite" "$state" "${elapsed:-–}" "${node:-–}" "${res:-–}" "${chk:-–}" >> "$SUMMARY"

  if [ "$state" != "COMPLETED" ] || [ "$chk" = "FAILED" ]; then
    dump_failure "$dir" "$jid" "$label"
    gh_error "$label (job $jid): state=$state exit=$code${chk:+ residual=$chk}"
    failed=$((failed + 1)); rc=1
  else
    ok=$((ok + 1))
  fi
done < "$joblist"

{
  echo
  echo "**${ok} succeeded, ${failed} failed** out of ${total}."
  [ "$failed" -gt 0 ] && echo "Failure details are in the \`Stage, submit, wait\` step log."
} >> "$SUMMARY"

echo "Summary: $ok succeeded, $failed failed, $total total."
exit $rc
