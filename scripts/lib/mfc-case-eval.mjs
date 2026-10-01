// Run an MFC case.py and return the case dictionary it prints.
// called the same way MFC does (--mfc <json> + extra args). needed because
// weak-scaled cases compute their grid from the rank count.
// runs repo code, only used on suites/MFC/cases/** in PR checks.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const run = promisify(execFile);

// subset of MFC's --mfc dict that a case can size itself from
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
    // include stderr, it has the traceback
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
    // usually a stray print() in the case
    const head = stdout.trim().split(/\r?\n/)[0] ?? "";
    return { ok: false, error: `case did not print valid JSON on stdout (first line: ${JSON.stringify(head.slice(0, 120))})` };
  }
}

// m/n/p are last indices (m+1 cells), mfcDecomposition handles that
export function gridOf(dict) {
  const num = (k) => (Number.isFinite(Number(dict[k])) ? Number(dict[k]) : null);
  return { m: num("m"), n: num("n"), p: num("p"), weno: num("weno_order") ?? 5 };
}
