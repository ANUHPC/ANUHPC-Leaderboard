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
    const key = m[1].toLowerCase(), rawVal = m[2];
    const v = rawVal.replace(/,$/, "").trim();
    // Fortran logicals are bare T and F.
    if (/^(?:\.?true\.?|\.?false\.?|t|f)$/i.test(v)) out[key] = /^(?:\.?true\.?|t)$/i.test(v);
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
  const n = (k) => Number.isFinite(inp[k]) ? inp[k] : null;
  const flag = (k) => typeof inp[k] === "boolean" ? inp[k] : null;
  const sizes = ["m", "n", "p"].map(k => n(k) != null && n(k) >= 0 ? n(k) + 1 : null);
  const completeGrid = sizes.every(v => v != null);
  const dims = sizes.filter(v => v > 1);
  // Equation count is derived only for the ordinary 5-equation family.
  // Advanced models remain unknown rather than receiving the wrong denominator.
  const simple = n("model_eqns") === 2 && n("num_fluids") > 0 && completeGrid &&
    !["bubbles_euler", "bubbles_lagrange", "mhd", "igr", "hypoelasticity", "cont_damage", "hyper_cleaning", "chemistry"]
      .some(k => inp[k] === true) && flag("surface_tension") != null;
  return {
    grid: completeGrid && dims.length ? dims.join(" × ") : null,
    cells: completeGrid ? sizes.reduce((a, b) => a * b, 1) : null,
    dimensions: completeGrid ? dims.length : null,
    dt: n("dt"),
    steps: n("t_step_stop") != null && n("t_step_start") != null ? n("t_step_stop") - n("t_step_start") : null,
    wenoOrder: n("weno_order"), wenoEps: n("weno_eps"),
    riemann: { 1: "HLL", 2: "HLLC", 3: "exact", 4: "HLLD", 5: "Lax–Friedrichs" }[n("riemann_solver")] ?? n("riemann_solver"),
    timeStepper: {1: "RK1", 2: "RK2", 3: "RK3"}[n("time_stepper")] ?? n("time_stepper"),
    modelEqns: n("model_eqns"), numFluids: n("num_fluids"),
    viscous: flag("viscous"), surfaceTension: flag("surface_tension"),
    bubbles: flag("bubbles_euler") ?? flag("bubbles"),
    equations: simple ? 2 * n("num_fluids") + dims.length + 1 + Number(inp.surface_tension) : null,
    equationSource: simple ? "derived from resolved 5-equation model settings" : null,
  };
}
