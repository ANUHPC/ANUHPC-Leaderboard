// When each run was submitted and finished, and who submitted it.
//
// Neither fact is in the artifacts. MFC's banner prints Start-date and
// End-date but both hold a time of day, and only 73 of 132 Raijin HPL runs
// carry HPL's own "start time" line -- the rest failed before reaching it.
// What always exists is git: a job spec is added under input/ by whoever
// submitted it, and the results under output/ when the job finishes.
//
// This is the FALLBACK. A run that timestamps itself is dated from that
// instead; see scripts/collect.mjs. So what matters most here is being
// deterministic, not being clever.
//
// Renames MUST be followed. output/ became cluster-scoped in e0448b19, so
// every Raijin run's current path was created that day; without following the
// move, all 151 runs date to it and the ordering is worthless.
//
// TWO EARLIER ATTEMPTS SHIPPED WRONG DATES, both silently:
//
//   --diff-filter=A     reports a move as a rename and drops it, so all 137
//                       Raijin runs came back undated.
//   --no-renames        catches the move as an add at the NEW path, dating
//                       every run to the day of the reorganisation.
//   --follow per run    matches on content similarity and jumps between
//                       unrelated files; it dated two 2026 runs to the
//                       repository's first commit in 2025.
//
// The current form carries each file's origin across renames. It is correct
// on every checkout tested here, and it was still wrong in CI once -- 77 of
// 151 runs collapsed onto the HEAD commit's timestamp, the shape a shallow
// clone produces. The cause is not yet identified, so the important part of
// this module is now historyWarnings() below: whatever the mechanism, that
// shape is detectable, and it must never reach the site unnoticed again.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// input|output/<cluster>/<suite>/<group>/<run>/<file> -> the run directory.
// Anything shallower (a README, a .gitignore placeholder) is not a run.
function runDirOf(file) {
  const p = file.split("/");
  return p.length >= 6 && (p[0] === "input" || p[0] === "output")
    ? { side: p[0], id: `${p[1]}/${p[2]}/${p[3]}/${p[4]}` }
    : null;
}

export async function loadRunHistory(cwd = process.cwd()) {
  const submitted = new Map();
  const completed = new Map();

  let stdout;
  try {
    ({ stdout } = await run("git", [
      // Pinned explicitly rather than left to the ambient default, which is
      // what made the previous version environment-dependent.
      // Pinned explicitly so the walk cannot depend on ambient git defaults.
      "-c", "diff.renames=true", "-c", "diff.renameLimit=100000",
      "log", "--diff-filter=ARD", "--reverse", "--name-status", "-M",
      // \x01 opens a commit header so it can never be mistaken for a path.
      // Some historical run directories have spaces in their names
      // ("09-30 - 2 0"), so splitting on whitespace is not safe.
      "--format=\x01%aI\x02%an\x02%ae",
      "--", "input", "output",
    ], { cwd, maxBuffer: 512 << 20 }));
  } catch (e) {
    return { submitted, completed, available: false, reason: e.message, commits: 0 };
  }

  // path -> where that file came into existence, carried across renames.
  const origin = new Map();
  let at = null, by = null, email = null, commits = 0;

  for (const line of stdout.split("\n")) {
    if (line.startsWith("\x01")) { [at, by, email] = line.slice(1).split("\x02"); commits++; continue; }
    if (!line || !at) continue;
    const [status, a, b] = line.split("\t");
    if (!status || !a) continue;

    if (status[0] === "R") {
      // The same file under a new name: it keeps the date it first appeared.
      if (b) { origin.set(b, origin.get(a) ?? { at, by, email }); origin.delete(a); }
    } else if (status[0] === "D") {
      origin.delete(a);
    } else if (status[0] === "A" && !origin.has(a)) {
      origin.set(a, { at, by, email });
    }
  }

  // A run is as old as the earliest of the files it still has.
  for (const [file, o] of origin) {
    const d = runDirOf(file);
    if (!d) continue;
    const into = d.side === "input" ? submitted : completed;
    const have = into.get(d.id);
    if (!have || o.at < have.at) into.set(d.id, o);
  }

  return { submitted, completed, available: true, commits };
}

// Did the walk actually see history?
//
// The failure that reached production was silent: every git-dated run got the
// same timestamp -- the HEAD commit's -- and nothing complained, so a board
// ordered by recency showed 80 runs as having happened in the same second.
// A shallow clone produces exactly that shape too, since with one commit every
// file looks newly added. Cheap to detect, so detect it.
export function historyWarnings(history) {
  const out = [];
  if (!history.available) {
    out.push(`git history unavailable (${history.reason ?? "unknown"}) — runs will be dated only where they timestamp themselves`);
    return out;
  }
  if (history.commits <= 1) {
    out.push(`git log saw ${history.commits} commit(s) — this is a shallow clone; checkout with fetch-depth: 0`);
  }
  const dates = [...history.completed.values()].map((v) => v.at);
  if (dates.length >= 10) {
    const counts = new Map();
    for (const d of dates) counts.set(d, (counts.get(d) ?? 0) + 1);
    const [top, n] = [...counts].sort((a, b) => b[1] - a[1])[0];
    if (n / dates.length > 0.5) {
      out.push(`${n} of ${dates.length} runs share one commit date (${top}) — history is probably truncated, dates are not trustworthy`);
    }
  }
  return out;
}

// House entries: seeded by whoever set the suite up, not by an entrant. Naming
// them as people would be wrong, and leaving the column blank loses the
// information that they are reference points rather than someone's attempt.
//
// Only unambiguous ones. VarSweep was in this list and should not have been:
// it is a folder alongside the entrants' own, holds 45 runs -- more than any
// person -- and calling someone's parameter sweep "not a real entry" on the
// strength of its name is a judgement this code has no business making.
const HOUSE = new Set(["benchmark", "baseline", "demo", "reference"]);

export function submitterOf(id, history) {
  const group = String(id).split("/")[2] ?? null;
  const s = history.submitted.get(id) ?? null;
  return {
    name: group,
    house: group ? HOUSE.has(group) : false,
    by: s?.by ?? null,
    at: s?.at ?? null,
  };
}
