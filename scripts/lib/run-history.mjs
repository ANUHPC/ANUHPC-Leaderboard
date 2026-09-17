// When each run was submitted and finished, and who submitted it.
//
// Neither fact is in the artifacts. MFC's banner prints Start-date and
// End-date but both are times of day -- there is no date anywhere in an MFC
// run -- and only 73 of 132 Raijin HPL runs carry HPL's own "start time" line
// (the other 59 failed before reaching it). What always exists is git: a job
// spec is added under input/ by whoever submitted it, and the results are
// added under output/ by the runner when the job finishes.
//
// Renames have to be followed, not ignored. Two wrong ways, both tried here:
//
//   --diff-filter=A alone       reports a moved path as a rename (status R),
//                               which the filter drops. output/ became
//                               cluster-scoped once, so every one of the 137
//                               Raijin runs looked as though it was never
//                               added and came back undated.
//   --diff-filter=A --no-renames  counts the move as an add, but at the OLD
//                               path -- ids like "HPL/Sithum/09-30" that no
//                               run has any more, and dates that are the day
//                               of the reorganisation rather than the run.
//
// So the walk carries each file's origin across renames: a path that moves
// keeps the date it was first added, which is what "when did this run happen"
// means. A run directory is dated by the earliest origin among its files.
//
// REQUIRES FULL HISTORY. Under actions/checkout's default fetch-depth: 1 there
// is one commit and every run looks undated; callers that need this must
// checkout with fetch-depth: 0. Missing history degrades to nulls rather than
// throwing, so a shallow clone still builds a site, just without dates.
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
      "log", "--diff-filter=ARD", "--reverse", "--name-status", "-M",
      // \x01 opens a commit header so it can never be mistaken for a path,
      // which matters here: some historical run directories have spaces in
      // their names ("09-30 - 2 0"), so splitting on whitespace is not safe.
      "--format=\x01%aI\x02%an\x02%ae",
      "--", "input", "output",
    ], { cwd, maxBuffer: 256 << 20 }));
  } catch {
    return { submitted, completed, available: false };
  }

  // path -> where that file came into existence, carried across renames.
  const origin = new Map();
  let at = null, by = null, email = null;

  for (const line of stdout.split("\n")) {
    if (line.startsWith("\x01")) { [at, by, email] = line.slice(1).split("\x02"); continue; }
    if (!line || !at) continue;
    const [status, a, b] = line.split("\t");
    if (!status || !a) continue;

    if (status[0] === "R") {
      // The file is the same file; only its name changed.
      if (b) {
        const prior = origin.get(a);
        origin.set(b, prior ?? { at, by, email });
        origin.delete(a);
      }
    } else if (status[0] === "D") {
      origin.delete(a);
    } else if (status[0] === "A" && !origin.has(a)) {
      origin.set(a, { at, by, email });
    }
  }

  // A run is as old as its earliest surviving file.
  for (const [file, o] of origin) {
    const d = runDirOf(file);
    if (!d) continue;
    const into = d.side === "input" ? submitted : completed;
    const have = into.get(d.id);
    if (!have || o.at < have.at) into.set(d.id, o);
  }

  return { submitted, completed, available: true };
}

// House entries: seeded by whoever set the suite up, not by an entrant. Naming
// them as people would be wrong, and leaving the column blank loses the
// information that they are reference points rather than someone's attempt.
// Only unambiguous ones. VarSweep was in this list and should not have been:
// it is a folder alongside the entrants' own, holds 45 runs -- more than any
// person -- and calling someone's parameter sweep "not a real entry" on the
// strength of its name is a judgement this code has no business making.
const HOUSE = new Set(["benchmark", "baseline", "demo", "reference"]);

export function submitterOf(id, history) {
  const group = String(id).split("/")[2] ?? null;
  const s = history.submitted.get(id) ?? null;
  return {
    // The folder is the identity the leaderboard is organised by, and the one
    // entrants recognise as theirs.
    name: group,
    house: group ? HOUSE.has(group) : false,
    // The git author of the commit that added the job spec: who actually
    // pushed it, which for a group folder shared by a team is the only record
    // of which member submitted this particular run.
    by: s?.by ?? null,
    at: s?.at ?? null,
  };
}
