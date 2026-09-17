#!/usr/bin/env python3
"""Truncation error and observed order of accuracy for an MFC convergence study.

    python3 suites/MFC/convergence-error.py <case_dir> [<case_dir> ...]

Each case directory is one completed run of a periodic advection case. The case
advects a sine wave exactly one period, so the exact solution at the end IS the
initial condition and the difference between them is purely the scheme's
accumulated error:

    L2 = sqrt( mean_i ( q_i(T) - q_i(0) )^2 )

MFC does not compute this. It writes the fields and leaves the analysis to you,
which is the point of the exercise.

WHERE THE DATA IS. With parallel_io = F, MFC writes plain ASCII to <case>/D/
regardless of `format: silo` in the case:

    D/<cons|prim>.<var>.<rank>.<tstep>.dat      "<x>   <value>" per cell

Only two steps are saved (t_step_save = t_step_stop): step 0 and the final one.
The final step number varies with the grid (N=32 -> 175, N=128 -> 699), so it is
discovered rather than assumed. Ranks are merged and sorted by x.

WHICH VARIABLE. For model_eqns=2 (5-equation) with num_fluids=2, index 5 is the
advected volume fraction alpha_1 -- see the indices.dat MFC writes next to it.
Index 1 (alpha_1 * rho_1) gives bit-identical errors here because rho_1 = 1 by
construction.

Deliberately stdlib-only: the system python3 on this cluster has no numpy. If
you want to plot, MFC ships one that does, at
/work/mfc/current/haswell/build/venv/bin/python.

READING THE RESULT. Two things routinely make the observed order look "wrong",
and both are physics rather than mistakes:

  * At fixed CFL, dt is proportional to dx, so the RK3 time error falls as
    N^-3 and eventually dominates any higher-order spatial scheme. WENO5 then
    measures 3, not 5. Refine CFL (0.4 -> 0.025) and 5th order appears.
  * WENO3 measures about 1.86 with weno_eps = 1e-16, the classic Jiang-Shu
    order loss at smooth extrema. Raising weno_eps to 1e-2 restores 3.0 and
    lowers the error a hundredfold.
"""

import argparse
import glob
import json
import math
import os
import re
import sys


def _read_dat(path):
    """(x, value) pairs from one MFC ASCII field file."""
    out = []
    with open(path) as f:
        for line in f:
            parts = line.split()
            if len(parts) >= 2:
                try:
                    out.append((float(parts[0]), float(parts[1])))
                except ValueError:
                    pass  # a header or stray line is not fatal
    return out


def _steps(case_dir, var, kind):
    rx = re.compile(rf"{kind}\.{var}\.\d+\.(\d+)\.dat$")
    found = set()
    for fp in glob.glob(os.path.join(case_dir, "D", f"{kind}.{var}.*.*.dat")):
        m = rx.search(os.path.basename(fp))
        if m:
            found.add(int(m.group(1)))
    return sorted(found)


def _field(case_dir, var, tstep, kind):
    """One field at one step, all ranks merged and ordered by x."""
    files = sorted(glob.glob(os.path.join(case_dir, "D", f"{kind}.{var}.*.{tstep:06d}.dat")))
    if not files:
        raise FileNotFoundError(f"no files for {kind}.{var} at step {tstep} in {case_dir}/D")
    pts = []
    for fp in files:
        pts.extend(_read_dat(fp))
    pts.sort(key=lambda p: p[0])
    return [p[0] for p in pts], [p[1] for p in pts]


def norms(case_dir, var=5, kind="cons"):
    steps = _steps(case_dir, var, kind)
    if len(steps) < 2:
        raise RuntimeError(f"{case_dir}: need two saved steps for {kind}.{var}, found {steps}")
    first, last = steps[0], steps[-1]
    x0, q0 = _field(case_dir, var, first, kind)
    x1, q1 = _field(case_dir, var, last, kind)
    if len(q0) != len(q1):
        raise RuntimeError(f"{case_dir}: {len(q0)} cells at step {first} but {len(q1)} at {last}")
    # A grid that moved between the two steps would make the difference
    # meaningless, so check rather than trust.
    for a, b in zip(x0, x1):
        if abs(a - b) > 1e-12 * max(1.0, abs(a)):
            raise RuntimeError(f"{case_dir}: grid differs between steps {first} and {last}")

    if not q0 or not all(math.isfinite(v) for v in x0 + x1 + q0 + q1) or len(set(x0)) != len(x0):
        raise RuntimeError(f"{case_dir}: empty, nonfinite or duplicate field data")
    d = [b - a for a, b in zip(q0, q1)]
    n = len(d)
    return {
        "N": n, "first": first, "last": last,
        "L1": sum(abs(v) for v in d) / n,
        "L2": math.sqrt(sum(v * v for v in d) / n),
        "Linf": max(abs(v) for v in d),
    }


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("case_dirs", nargs="+", help="run directories, each containing D/")
    ap.add_argument("--var", type=int, default=5, help="field index (default 5, alpha_1)")
    ap.add_argument("--kind", default="cons", choices=["cons", "prim"])
    ap.add_argument("--norm", default="L2", choices=["L1", "L2", "Linf"],
                    help="which norm the order column is computed from")
    ap.add_argument("--json", action="store_true", help="emit one machine-readable run; use only for a full periodic return")
    args = ap.parse_args()
    if args.json and len(args.case_dirs) != 1:
        ap.error("--json requires exactly one case directory")

    rows, failed = [], False
    for d in args.case_dirs:
        try:
            rows.append(norms(d, args.var, args.kind))
        except Exception as e:  # one bad run should not hide the rest
            print(f"ERROR {d}: {e}", file=sys.stderr)
            failed = True
    if not rows:
        sys.exit(1)

    if args.json:
        print(json.dumps({**rows[0], "kind": args.kind, "variable": args.var}, allow_nan=False))
        return

    rows.sort(key=lambda r: r["N"])
    key = args.norm
    print(f"{'N':>6} {'L1':>14} {'L2':>14} {'Linf':>14} {'order(' + key + ')':>13}")
    print("-" * 66)
    prev = None
    for r in rows:
        # p = log(err_coarse / err_fine) / log(N_fine / N_coarse)
        order = ""
        if prev and r["N"] > prev["N"] and r[key] > 0 and prev[key] > 0:
            order = f"{math.log(prev[key] / r[key]) / math.log(r['N'] / prev['N']):13.3f}"
        print(f"{r['N']:>6} {r['L1']:14.6e} {r['L2']:14.6e} {r['Linf']:14.6e} {order:>13}")
        prev = r

    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
