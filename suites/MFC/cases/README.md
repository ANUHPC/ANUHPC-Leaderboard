# Contributing an MFC case

A **case** is a board. Every ranked MFC run names one, and only runs of the
same case on the same hardware are compared, so adding a case adds a new
contest rather than a new entry in an existing one.

This directory holds cases contributed here. The other kind lives upstream in
MFC itself; both are listed in [`../suite.yml`](../suite.yml) under `cases:`.

## Why cases are fixed at all

Grind time is normalised per grid point and per equation, which cancels out
problem size — that is why `gbpp` is safe to leave free. It does **not** cancel
out how expensive the physics is per cell. Our seven upstream cases span **4.2x**
on identical hardware:

```
hypo_hll   0.1662        ibm   0.6939        ns/gp/eq/rhs on 8 A100s
```

If entrants supplied their own case, the shortest route to the top of a board
would be writing the cheapest physics that still runs. So the case is held
constant and everything else — decomposition, ranks, `gbpp`, toolchain, build
flags — is yours.

Adding a case does not break that, as long as the case is then frozen. That is
what the rest of this document is about.

## Add one

```
suites/MFC/cases/<slug>/case.py     the case
suites/MFC/suite.yml                one entry under cases:
```

The registry entry:

```yaml
  - slug: anu_tgv_3d
    source: repo                                    # in this repo, not in MFC
    path: suites/MFC/cases/anu_tgv_3d/case.py       # from the repo root
    sizing: gbpp                                    # or: fixed
    title: Taylor-Green vortex, 3D, weak-scaled
    added: 2026-09-17
```

Open a pull request. CI runs your case for real — every node and rank count the
suite allows — and merging makes the board live.

## What a case must be

An MFC case is a **Python program that prints a JSON dict on stdout**. MFC's
toolchain always passes `--mfc '<json>'` carrying `nodes`, `tasks_per_node` and
`gpu`. Nothing else may be printed; a stray `print()` makes the dict unparseable.

### `sizing: gbpp` — weak-scaled (preferred)

The case sizes its own grid from the rank count, so work per rank is constant
as nodes are added. A 1-node and a 2-node entry then measure the machine rather
than the grid. Take `--gbpp` and compute the grid from it:

```python
parser.add_argument("--mfc",  type=json.loads, default="{}")
parser.add_argument("--gbpp", type=int, default=16)
...
procs  = DICT["nodes"] * DICT["tasks_per_node"]
ncells = math.floor((8000000 / 16.0) * procs * ARGS["gbpp"])
N      = math.floor(ncells ** (1 / 3))
```

### `sizing: fixed` — grid written into the case

Allowed, and right for a case whose grid is part of its definition. `--gbpp` is
**not** passed to a fixed case: argparse in a case that does not define it would
reject the argument and the job would die in `pre_process` with a Python
traceback. The declaration is what tells `render.sh` which to do, and CI checks
the declaration is true.

## Rules the checks enforce

| | |
|---|---|
| It runs | executed at 1x1, 1x2, 1x4, 2x1, 2x2, 2x4 |
| It prints a JSON dict | with `m`, `n`, `p` |
| The sizing declaration is true | a `gbpp` case must grow with ranks; a `fixed` case must not |
| It decomposes | **≥ 25 cells per rank per direction** (`num_stcls_min` 5 x WENO order 5) at every allowed rank count |
| The path stays in the repo | a registry entry cannot point outside it |
| Slugs are unique | two entries would claim one board |

The decomposition rule is the one that bites. MFC searches factorisations of
the rank count and aborts if none gives every direction enough cells, which
historically happened only *after* the job had queued and started.

## Never edit a registered case

Editing a case silently changes what every past run of it measured.

The collector re-hashes each run's harvested `case.py` against the file
registered here. Change the file and past runs stop matching — they drop off
the board with:

> Case "anu_tgv_3d" has been edited since this run — re-run to rank

which is honest, but it is a bad way to find out. **Add a new slug instead**
(`anu_tgv_3d_v2`). Old runs keep their board, new runs get theirs.

This hash check is the whole freeze for a contributed case. Upstream cases get
theirs from MFC's commit pin, which a contributed case has no equivalent of.

## Worth contributing

Something the existing seven do not cover. They are all shock-driven and all
but one inviscid, so they stress the Riemann solver. Gaps:

- smooth flows with no discontinuity for WENO to detect
- viscous cases, which add a halo exchange per stage
- geometry-dominated cases (immersed boundaries beyond `ibm`)
- anything that shifts the compute/communication balance

[`anu_tgv_3d`](anu_tgv_3d/case.py) is the worked example — a Taylor-Green
vortex, smooth, periodic and viscous, derived from MFC's own
`examples/3D_TaylorGreenVortex` and weak-scaled.

## Run it locally first

```bash
python3 suites/MFC/cases/<slug>/case.py \
    --mfc '{"nodes":2,"tasks_per_node":4,"gpu":true}' --gbpp 16 | python3 -m json.tool

node scripts/validate-cases.mjs      # the same checks CI runs
```
