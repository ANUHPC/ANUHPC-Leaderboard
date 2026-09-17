// Run an MFC case.py and return the case dictionary it prints.
//
// An MFC case is a Python program that prints a JSON dict on stdout; MFC's own
// toolchain invokes it exactly this way (toolchain/mfc/run/input.py passes
// --mfc <json> and appends any extra arguments). Reading the grid with a regex
// works only for a case that writes "m": 256 literally. A weak-scaled case
// computes its grid from the rank count, so the numbers exist only once the
// file has actually run.
//
// This matters at pull-request time: a contributed case is a file in this
// repository, so the grid it will produce for a given job is knowable before
// anything is queued. That turns "your 8-rank run cannot be decomposed" from a
// failure discovered after a queue wait into a failed check on the PR.
//
// SECURITY: this executes a file from the repository. It is only ever pointed
// at suites/MFC/cases/**, which arrives by pull request and is reviewed before
// merge, and validate.yml runs on `pull_request` -- a fork's PR gets a
// read-only token and no secrets. The same file is going to run on the cluster
// if it is merged; running it in a sandboxed CI job first is strictly earlier.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// Mirrors what MFC's toolchain puts in the --mfc dict, restricted to the keys
// a case can legitimately size itself from.
export function mfcDict({ nodes = 1, tasksPerNode = 1, gpu = false } = {}) {
  return { nodes, tasks_per_node: tasksPerNode, gpu: Boolean(gpu) };
}

export async function evalCase(file, { dict = mfcDict(), args = [], timeout = 20000 } = {}) {
  let stdout;
  try {
    ({ stdout } = await run(
      "python3",
      [file, "--mfc", JSON.stringify(dict), ...args],
      { timeout, maxBuffer: 8 << 20 },
    ));
  } catch (e) {
    // A case that crashes, hangs, or rejects its arguments fails here rather
    // than in pre_process an hour later. stderr carries the traceback, which
    // is the only thing that makes the failure actionable.
    const detail = (e.stderr || e.message || "").trim().split(/\r?\n/).slice(-4).join(" | ");
    return { ok: false, error: detail || "python3 exited non-zero" };
  }

  try {
    const dictOut = JSON.parse(stdout);
    if (!dictOut || typeof dictOut !== "object") {
      return { ok: false, error: "case printed JSON that is not an object" };
    }
    return { ok: true, dict: dictOut };
  } catch {
    // Almost always a stray print() left in the case: MFC's toolchain parses
    // stdout as JSON and fails the same way, less legibly.
    const head = stdout.trim().split(/\r?\n/)[0] ?? "";
    return { ok: false, error: `case did not print valid JSON on stdout (first line: ${JSON.stringify(head.slice(0, 120))})` };
  }
}

// The grid, as MFC will see it. m/n/p are last-index values, so a direction
// holds m+1 cells; mfcDecomposition applies that.
export function gridOf(dict) {
  const num = (k) => (Number.isFinite(Number(dict[k])) ? Number(dict[k]) : null);
  return { m: num("m"), n: num("n"), p: num("p"), weno: num("weno_order") ?? 5 };
}
