// Read the parameters MFC actually ran with.
//
// simulation.inp is a Fortran namelist MFC writes after resolving the case:
//
//     &user_inputs
//     m = 239
//     weno_order = 3
//     fluid_pp(1)%gamma = 0.1953125
//     &end/
//
// This matters because case.py is a PROGRAM, not a record. It computes the
// grid from the rank count, derives dt from a CFL number, and reads command
// line arguments -- so reading it tells you what a run COULD do, not what it
// did. Two runs of one case.py at different settings are indistinguishable
// from their case.py alone. This file is the only per-run record of the
// settings, which is what makes a parameter sweep comparable.
export function parseInp(raw) {
  const out = {};
  if (typeof raw !== "string") return out;
  for (const line of raw.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("&") || t.startsWith("!")) continue;
    const m = /^([A-Za-z_][\w%()]*)\s*=\s*(.+?)\s*$/.exec(t);
    if (!m) continue;
    const [, key, rawVal] = m;
    const v = rawVal.replace(/,$/, "").trim();
    // Fortran logicals are bare T and F.
    if (v === "T" || v === "F") out[key] = v === "T";
    else if (/^-?\d+$/.test(v)) out[key] = Number(v);
    else if (/^-?(\d+\.?\d*|\.\d+)([eEdD][-+]?\d+)?$/.test(v)) out[key] = Number(v.replace(/[dD]/, "e"));
    else out[key] = v.replace(/^['"]|['"]$/g, "");
  }
  return out;
}

// The handful worth putting in a table. MFC resolves well over a hundred
// parameters; a sweep is read by looking at the few that were varied, so the
// rest stay in the file rather than the interface.
//
// Named for what they mean rather than what MFC calls them: "m" is the last
// index in x, not a count, and nobody tuning a case thinks in those terms.
export function summarizeInp(inp) {
  if (!inp || typeof inp !== "object") return null;
  const n = (k) => (Number.isFinite(inp[k]) ? inp[k] : null);
  const cells = (k) => (n(k) == null ? null : n(k) + 1);

  const nx = cells("m"), ny = cells("n"), nz = cells("p");
  const dims = [nx, ny, nz].filter((d) => d && d > 1);

  return {
    // 240 x 60, or 634 x 317 x 317 -- cells, not last indices.
    grid: dims.length ? dims.join(" x ") : null,
    cells: dims.length ? dims.reduce((a, b) => a * b, 1) : null,
    dimensions: dims.length || null,
    dt: n("dt"),
    steps: n("t_step_stop"),
    wenoOrder: n("weno_order"),
    // MFC spells these as integers in the .inp even when the case.py used a
    // name, so translate back to the names the documentation uses.
    riemann: { 1: "HLL", 2: "HLLC", 3: "exact", 4: "HLLD" }[n("riemann_solver")] ?? n("riemann_solver"),
    timeStepper: n("time_stepper") ? `RK${n("time_stepper")}` : null,
    modelEqns: n("model_eqns"),
    numFluids: n("num_fluids"),
    // The three Task 3 asks you to turn on and off.
    viscous: inp.viscous === true || Number.isFinite(inp["fluid_pp(1)%Re(1)"]),
    surfaceTension: inp.surface_tension === true || Number.isFinite(inp.sigma),
    bubbles: inp.bubbles === true || inp.bubbles_euler === true,
  };
}
