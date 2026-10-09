#!/usr/bin/env bash
# Carry recently replaced JS/CSS bundles into a new site build.
#
# GitHub Pages lets browsers cache index.html for 10 minutes, and website.yml
# replaces the whole site on every deploy (force_orphan). A browser still
# holding the old page then asks for hashed bundles that no longer exist, and
# the site renders blank. This keeps every bundle that was live within the last
# hour. assets/retired.txt lists "<epoch> <file>": when each kept bundle stopped
# being current, so they drop out instead of piling up.
#
# usage: keep-recent-bundles.sh <new build's assets dir>   (run inside the repo)
set -euo pipefail
dist=$1
keep=${KEEP_SECONDS:-3600}
now=$(date +%s)

if ! git fetch --quiet origin gh-pages; then
  echo "no live site yet, nothing to keep"
  exit 0
fi

old=$(git show FETCH_HEAD:assets/retired.txt 2>/dev/null || true)
live=$(git ls-tree --name-only FETCH_HEAD assets/ | sed 's|^assets/||' | grep -vx retired.txt || true)

{
  # already retired: they keep their date and expire after $keep seconds
  awk -v cut=$((now - keep)) 'NF == 2 && $1 > cut' <<<"$old"
  # the live build's own bundles retire now
  comm -23 <(sort <<<"$live") <(awk 'NF == 2 {print $2}' <<<"$old" | sort) | sed "/^$/d; s|^|$now |"
} | while read -r at f; do
  [[ $f =~ ^[A-Za-z0-9._-]+$ ]] || continue
  # rebuilt with the same hash, so it's current again
  [ -e "$dist/$f" ] && continue
  git show "FETCH_HEAD:assets/$f" > "$dist/$f" 2>/dev/null || { rm -f "$dist/$f"; continue; }
  echo "$at $f"
done > "$dist/retired.txt"

echo "kept $(wc -l < "$dist/retired.txt" | tr -d ' ') bundle(s) from deploys in the last $((keep / 60)) min"
