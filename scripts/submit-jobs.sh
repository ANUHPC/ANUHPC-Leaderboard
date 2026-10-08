#!/usr/bin/env bash
# Submit every staged job, report progress while it runs, and explain failures.
#
#   submit-jobs.sh <stage-dir> <cluster> <run-id>
#
# Called by .github/workflows/submit-<cluster>.yml. stage is
# <stage>/<suite>/<group>/<run>/ on shared storage.
set -uo pipefail

STAGE="${1:?usage: submit-jobs.sh <stage-dir> <cluster> <run-id>}"
CLUSTER="${2:?}"
RUN_ID="${3:?}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

HPL_BIN="${HPL_BIN:-/apps/benchmarks/hpl/current/bin/xhpl}"
# hpl.sh finds its libs relative to itself, so run it in place, don't copy it
HPL_NVIDIA_SH="${HPL_NVIDIA_SH:-/apps/benchmarks/hpl-nvidia/current/workspace/hpl.sh}"
MPI_PREFIX="${MPI_PREFIX:-/apps/openmpi/5.0.10}"
export MFC_ROOT="${MFC_ROOT:-/work/mfc/current}"
POLL="${POLL_INTERVAL:-30}"
SUMMARY="${GITHUB_STEP_SUMMARY:-/dev/null}"

joblist="$STAGE/.joblist"; : > "$joblist"
# jobs that failed to submit, any of these fails the run
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

# fallback for clusters without sacct accounting. leading space so NodeList=
# doesn't match ReqNodeList=
scontrol_field() { scontrol show job "$1" 2>/dev/null | grep -oE "[[:space:]]$2=\S+" | head -1 | cut -d= -f2-; }

final_state(){
  local v; v="$(sacct -n -X -j "$1" -o State 2>/dev/null | head -1 | tr -d ' ')"
  [ -n "$v" ] || v="$(scontrol_field "$1" JobState)"
  echo "$v"
}
final_code() {
  local v; v="$(sacct -n -X -j "$1" -o ExitCode 2>/dev/null | head -1 | tr -d ' ')"
  [ -n "$v" ] || v="$(scontrol_field "$1" ExitCode)"
  echo "$v"
}
final_time() {
  local v; v="$(sacct -n -X -j "$1" -o Elapsed 2>/dev/null | head -1 | tr -d ' ')"
  [ -n "$v" ] || v="$(scontrol_field "$1" RunTime)"
  echo "$v"
}
final_node() {
  local v; v="$(sacct -n -X -j "$1" -o NodeList 2>/dev/null | head -1 | tr -d ' ')"
  [ -n "$v" ] || v="$(scontrol_field "$1" NodeList)"
  echo "$v"
}

# headline result from the job output
result_line() {
  local dir="$1" suite="$2"
  case "$suite" in
    HPL|HPL_NVIDIA)
      # netlib prints WR..., xhpl-nvidia WC..., same columns
      local wr; wr="$(sed -E 's/^\[[^]]+\]<stdout>:[[:space:]]*//' "$dir"/*.out 2>/dev/null | grep -E '^[[:space:]]*W[RC][0-9A-Za-z]+' | tail -1 || true)"
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
    | awk '/FAILED/{failed=1} /PASSED/{passed=1} END{if(failed) print "FAILED"; else if(passed) print "PASSED"}' || true
}

# print the actual error into the actions log
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
    HPL|HPL_NVIDIA)
      # cpu xhpl gets copied in, gpu hpl.sh runs in place
      if [ "$suite" = HPL_NVIDIA ]; then
        if [ ! -x "$HPL_NVIDIA_SH" ]; then
          gh_error "$label: no hpl.sh at $HPL_NVIDIA_SH — publish HPL-NVIDIA to /apps first"; rejected=$((rejected+1)); continue
        fi
      else
        if [ ! -x "$HPL_BIN" ]; then
          gh_error "$label: no xhpl at $HPL_BIN — build or publish it first (launchpad: suites/HPL/build-launchpad.sh)"; rejected=$((rejected+1)); continue
        fi
        cp "$HPL_BIN" "$jobdir/xhpl" && chmod +x "$jobdir/xhpl"
      fi
      # run.sh or run.<cluster>.sh. don't glob *.sh, it could pick another cluster's script
      script=""
      for cand in "$jobdir/run.sh" "$jobdir/run.$CLUSTER.sh"; do
        [ -f "$cand" ] && { script="$cand"; break; }
      done
      if [ -z "$script" ]; then
        other="$(cd "$jobdir" && ls run.*.sh 2>/dev/null | tr '\n' ' ')"
        if [ -n "$other" ]; then
          gh_error "$label: found $other, which is for another cluster — use run.sh or run.$CLUSTER.sh"
        else
          gh_error "$label: no run.sh (cp input/_TEMPLATES/$suite/run.$CLUSTER.sh input/$CLUSTER/$label/run.sh)"
        fi
        rejected=$((rejected+1))
        continue
      fi
      echo "  using $(basename "$script") for $label"
      # node names differ between clusters
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
        # usually means more cores than the node has (CoreSpecCount cores don't count)
        case "$jid" in
          *"node configuration is not available"*)
            gh_error "$label: check #SBATCH ntasks-per-node x cpus-per-task against 'scontrol show node' (CPUTot minus CoreSpecCount)" ;;
        esac
        rejected=$((rejected+1))
      fi
      ;;
    MFC)
      # render.sh picks the per-arch tree and checks the rest
      if [ ! -d "$MFC_ROOT" ]; then
        gh_error "$label: no MFC install at $MFC_ROOT — build it before submitting"; continue
      fi
      # MFC doesn't record a date, so write one
      mfc_started=$(date -u +%Y-%m-%dT%H:%M:%SZ)
      if bash "$REPO/suites/MFC/render.sh" "$jobdir" "$RUN_ID"; then
        { echo 'state: COMPLETED'
          echo "started_at: $mfc_started"
          echo "finished_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        } > "$jobdir/mfc-status.yml"
        echo "  completed $label: $(result_line "$jobdir" MFC)"
        printf '| %s | %s | %s |\n' "$label" COMPLETED "$(result_line "$jobdir" MFC)" >> "$SUMMARY"
      else
        { echo 'state: FAILED'
          echo "started_at: $mfc_started"
          echo "finished_at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
        } > "$jobdir/mfc-status.yml"
        dump_failure "$jobdir" unknown "$label"
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
    gh_error "$rejected job(s) failed during submission or execution; see the errors above"
    exit 1
  fi
  echo "No asynchronous jobs remain (MFC submissions wait for completion)."
  exit 0
fi

total="$(wc -l < "$joblist")"
ids="$(cut -d: -f2 "$joblist" | paste -sd,)"

# live speed from HPL-NVIDIA's progress lines in run.out, e.g.
#   Prog= 47.09%  N_left= 112640  Time= 11.72  Time_left= 13.17  iGF= 76237.86  GF= 72343.95 ...
# iGF is the speed over the last step, GF the running average. Empty when there is no
# progress line (start-up, CPU HPL), so the caller falls back to the output size.
live_perf() {  # live_perf <jobdir>
  local f line
  for f in "$1"/*.out; do [ -f "$f" ] || continue
    line=$(grep -a 'Prog=' "$f" 2>/dev/null | tail -1 | sed 's/\x1b\[[0-9;]*m//g')
    [ -n "$line" ] && break
  done
  [ -n "${line:-}" ] || { live_cpu "$1"; return 0; }
  awk '{ for (i = 1; i < NF; i++) v[$i] = $(i+1)
         gsub(/%/, "", v["Prog="])
         printf "%s%% done, now %.2f TF, avg %.2f TF (%.2f TF/GPU), ~%ds left",
           v["Prog="], v["iGF="]/1000, v["GF="]/1000, v["GF_per="]/1000, v["Time_left="] }' <<< "$line"
}

# cpu xhpl built with -DHPL_PROGRESS_REPORT (suites/HPL/build-launchpad.sh) prints per panel
#   Column=000012288 Fraction= 3.7% Gflops=2.345e+03
# intel's xhpl (HPL_LOG=1) prints the host first, fraction as 0-1 and Mflops
#   scc-connect-03-gpu01 : Column=045696 Fraction=0.145 Kernel=4243366.24 Mflops=4294235.00
# Fraction is columns, not work: the trailing matrix shrinks, so 19% of columns is ~46% of
# the flops. N isn't on the line, so take the N from the header that matches the fraction
# (a sweep has several). Gflops is the average since the solve started; time left assumes
# it holds, the last panels are slower so it's a bit optimistic. clock is the last
# cpufreq.log sample from run.launchpad.sh. prints nothing for builds without either.
live_cpu() {  # live_cpu <jobdir>
  local f mhz=""
  [ -s "$1/cpufreq.log" ] && mhz=$(tail -1 "$1/cpufreq.log")
  for f in "$1"/*.out; do [ -f "$f" ] || continue
    awk -v mhz="$mhz" '
      /^N +:/   { for (i = 3; i <= NF; i++) if ($i ~ /^[0-9]+$/) ns[++k] = $i }
      /^Column=|^[^ ]+ : Column=/ { line = $0 }
      END {
        if (line) {
          gsub(/[=%]/, " ", line); nv = split(line, v, " ")
          for (i = 1; i < nv; i++) {
            if (v[i] == "Column")   j = v[i+1] + 0
            if (v[i] == "Fraction") frac = v[i+1] + 0
            if (v[i] == "Gflops")   gf = v[i+1] + 0
            if (v[i] == "Mflops") { gf = v[i+1] / 1000; frac *= 100 }
          }
          for (i = 1; i <= k; i++) {
            if (ns[i] <= j) continue
            d = j * 100 / ns[i] - frac; if (d < 0) d = -d
            if (!n || d < bd) { n = ns[i]; bd = d }
          }
          if (n) printf "%.1f%% of flops done, avg %.2f TF", 100 * (1 - ((n - j) / n) ^ 3), gf / 1000
          else   printf "column %.1f%%, avg %.2f TF", frac, gf / 1000
          if (n && gf > 0) printf ", ~%ds left", 2 * (n - j) ^ 3 / 3 / (gf * 1e9)
          if (mhz) printf ", %.2f GHz", mhz / 1000
        } else if (mhz) printf "%.2f GHz, no HPL progress yet", mhz / 1000
      }' "$f"
    return 0
  done
}

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
    # growing output is the only sign HPL is alive
    sz=0; for f in "$dir"/*.out; do [ -f "$f" ] && sz=$((sz + $(stat -c %s "$f"))); done
    delta=$(( sz - ${last_size[$jid]:-0} )); last_size[$jid]=$sz
    case "$st" in
      PENDING) printf '  [%3dm] job %-7s PENDING    %-38s reason=%s\n' "$mins" "$jid" "$label" "$(live_reason "$jid")" ;;
      RUNNING) perf="$(live_perf "$dir")"
               if [ -n "$perf" ]; then
                 printf '  [%3dm] job %-7s RUNNING    %-38s elapsed=%s  %s\n' \
                   "$mins" "$jid" "$label" "$(live_time "$jid")" "$perf"
               else
                 printf '  [%3dm] job %-7s RUNNING    %-38s on=%s elapsed=%s out=%sB(+%s)\n' \
                   "$mins" "$jid" "$label" "$(live_node "$jid")" "$(live_time "$jid")" "$sz" "$delta"
               fi ;;
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
[ "$rejected" -eq 0 ] || rc=1
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

  if [ "$state" != "COMPLETED" ] || [ "$code" != "0:0" ] || [ "$chk" != "PASSED" ] || [ -z "$res" ]; then
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
