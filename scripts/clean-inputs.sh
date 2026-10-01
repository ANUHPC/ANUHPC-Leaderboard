#!/usr/bin/env bash
# Remove input/<cluster>/<suite>/<group>/<run> for jobs that have run, after harvest.
#
#   scripts/clean-inputs.sh <stage> <cluster>
#   DRY_RUN=1 scripts/clean-inputs.sh ...     # only print what would go
#
# Reads <stage>.jobs.txt from stage-submissions.mjs. An input is only removed
# (git rm) if its output dir exists and has a file of the same name for every
# input file, so a crashed or cancelled run never loses anyone's job.
set -euo pipefail

STAGE="${1:?usage: clean-inputs.sh <stage> <cluster>}"
CLUSTER="${2:?usage: clean-inputs.sh <stage> <cluster>}"
LIST="$STAGE.jobs.txt"
[ -f "$LIST" ] || { echo "clean-inputs: no $LIST, nothing to do"; exit 0; }

while IFS= read -r rel; do
  [ -n "$rel" ] || continue
  in="input/$CLUSTER/$rel" out="output/$CLUSTER/$rel"
  [ -d "$in" ] || continue
  if [ ! -d "$out" ]; then
    echo "::warning::keeping $in, no output at $out"; continue
  fi
  missing=""
  while IFS= read -r f; do
    [ -e "$out/$f" ] || missing="$missing $f"
  done < <(cd "$in" && find . -type f -printf '%P\n')
  if [ -n "$missing" ]; then
    echo "::warning::keeping $in, not in output:$missing"; continue
  fi
  if [ -n "${DRY_RUN:-}" ]; then echo "would remove $in"; continue; fi
  git rm -r -q -- "$in"
  echo "removed $in"
done < "$LIST"
