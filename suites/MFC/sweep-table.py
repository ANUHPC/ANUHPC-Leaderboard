#!/usr/bin/env python3
"""Compare runs of one case at different settings.

    python3 suites/MFC/sweep-table.py output/xenon/MFC/<you>/task3-*

Prints one row per run: the settings it actually used beside what it cost.
That pairing is the whole point of a parameter study, and neither half is
available on its own -- case.py is a program and does not record what a given
run resolved to, so the settings come from the simulation.inp MFC writes.

WHY THERE ARE TWO COST COLUMNS, AND WHY IT MATTERS.

  grind   ns per grid point, per equation, per right-hand-side evaluation.
          Normalised, so it compares different grids -- and it is the minimum
          RK stage time, so it is very reproducible (about 0.3% here).
  s/step  seconds per time step. Not normalised at all.

Grind divides by the number of equations, and some settings CHANGE that
number. Surface tension adds a colour-function equation, taking sys_size from
7 to 8. Measured on this cluster, turning it on made each stage 8.5% MORE
expensive and the reported grind time go DOWN, 56.08 to 53.24, because the
denominator grew 14%.

So a lower grind does not always mean a faster run. Compare grind between
runs that solve the same equations; compare s/step when they do not. This
script flags the pairs where that distinction applies, rather than leaving
you to notice.

Stdlib only: the system python3 here has no numpy.
"""

import argparse
import os
import re
import sys


def read_inp(path):
    """Fortran namelist -> dict. MFC writes the resolved parameters here."""
    out = {}
    try:
        with open(path) as f:
            for line in f:
                t = line.strip()
                if not t or t.startswith("&") or t.startswith("!"):
                    continue
                m = re.match(r"^([A-Za-z_][\w%()]*)\s*=\s*(.+?)\s*$", t)
                if not m:
                    continue
                k, v = m.group(1), m.group(2).rstrip(",").strip()
                if v in ("T", "F"):
                    out[k] = v == "T"
                else:
                    try:
                        out[k] = float(v) if re.search(r"[.eEdD]", v) else int(v)
                    except ValueError:
                        out[k] = v.strip("'\"")
    except OSError:
        pass
    return out


def read_time_data(path):
    """Last row of time_data.dat: Ranks | s/step | ns/gp/eq/rhs."""
    try:
        rows = []
        with open(path) as f:
            for line in f:
                p = line.split()
                if len(p) >= 3 and not line.lstrip().startswith("Ranks"):
                    try:
                        rows.append((int(float(p[0])), float(p[1]), float(p[2])))
                    except ValueError:
                        pass
        return rows[-1] if rows else None
    except OSError:
        return None


def read_args(path):
    """The args: line from job.yml, shown verbatim so a row is reproducible."""
    try:
        with open(path) as f:
            for line in f:
                if line.startswith("args:"):
                    return line.split(":", 1)[1].strip()
    except OSError:
        pass
    return ""


def equations(inp):
    """How many equations this run solved -- the grind denominator.

    For the 5-equation model MFC carries, per fluid, a partial density AND a
    volume fraction, plus one momentum component per dimension, plus energy:

        sys_size = 2*num_fluids + dimensions + 1

    and one more for the colour function when surface tension is on. For the
    2D shock-droplet with two fluids that is 2*2 + 2 + 1 = 7, rising to 8 --
    which matches what MFC reports, and is the denominator grind divides by.
    """
    nf = inp.get("num_fluids") or 1
    dims = sum(1 for k in ("m", "n", "p") if (inp.get(k) or 0) > 0)
    return 2 * nf + dims + 1 + (1 if inp.get("surface_tension") else 0)


def main():
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("run_dirs", nargs="+")
    args = ap.parse_args()

    rows = []
    for d in args.run_dirs:
        if not os.path.isdir(d):
            continue
        inp = read_inp(os.path.join(d, "simulation.inp"))
        td = read_time_data(os.path.join(d, "time_data.dat"))
        if not inp and not td:
            print(f"  (skipped {os.path.basename(d)}: no simulation.inp or time_data.dat)", file=sys.stderr)
            continue
        nx, ny = (inp.get("m") or 0) + 1, (inp.get("n") or 0) + 1
        rows.append({
            "name": os.path.basename(d.rstrip("/")),
            "grid": f"{nx}x{ny}" if ny > 1 else str(nx),
            "steps": inp.get("t_step_stop"),
            "visc": "yes" if inp.get("viscous") else "-",
            "sigma": inp.get("sigma") if inp.get("surface_tension") else None,
            "eqs": equations(inp),
            "ranks": td[0] if td else None,
            "sstep": td[1] if td else None,
            "grind": td[2] if td else None,
            "args": read_args(os.path.join(d, "job.yml")),
        })

    if not rows:
        sys.exit("no runs found")

    hdr = f"{'run':<26} {'grid':>10} {'steps':>7} {'visc':>5} {'sigma':>8} {'eqs':>4} {'grind':>10} {'s/step':>10}"
    print(hdr)
    print("-" * len(hdr))
    for r in sorted(rows, key=lambda r: r["name"]):
        print(f"{r['name'][:26]:<26} {r['grid']:>10} {str(r['steps'] or '-'):>7} "
              f"{r['visc']:>5} {(f'{r['sigma']:g}' if r['sigma'] else '-'):>8} "
              f"{str(r['eqs']):>4} "
              f"{(f'{r['grind']:.4f}' if r['grind'] is not None else '-'):>10} "
              f"{(f'{r['sstep']:.6f}' if r['sstep'] is not None else '-'):>10}")

    # The warning this script exists for.
    counts = {r["eqs"] for r in rows if r["eqs"]}
    if len(counts) > 1:
        print()
        print(f"NOTE: these runs do not all solve the same number of equations ({sorted(counts)}).")
        print("      Grind time is per equation, so it is NOT comparable across them --")
        print("      a run can show a lower grind while every step costs more. Compare the")
        print("      s/step column instead, and only compare grind within one equation count.")


if __name__ == "__main__":
    main()
