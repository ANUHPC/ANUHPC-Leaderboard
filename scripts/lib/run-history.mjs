// When each run was submitted and finished, and who submitted it.
// from git, since the artifacts don't record it. fallback only, collect.mjs
// prefers a timestamp the run wrote itself.
// renames have to be followed, output/ was moved to per-cluster dirs at one point.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// input|output/<cluster>/<suite>/<group>/<run>/<file> -> the run directory.
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
      // set explicitly, don't depend on the user's git config
      "-c", "diff.renames=true", "-c", "diff.renameLimit=100000",
      "log", "--diff-filter=ARD", "--reverse", "--name-status", "-M",
      // \x01 marks a commit header; some run dirs have spaces so don't split on whitespace
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
      // renamed file keeps its original date
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

// warn if history looks truncated (shallow clone, most runs on one date)
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

// reference entries, not a person's attempt
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
