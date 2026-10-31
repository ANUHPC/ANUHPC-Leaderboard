#!/usr/bin/env python3
# Taylor-Green vortex, 3D, weak-scaled.  slug: anu_tgv_3d
#
# Contributed to the ANU leaderboard. Derived from MFC's own
# examples/3D_TaylorGreenVortex, with three changes that make it a benchmark
# rather than a demonstration:
#
#   1. The grid is sized from the rank count and --gbpp instead of a fixed
#      N = 256, so work per rank is constant as nodes are added. Comparing a
#      1-node and a 2-node run then measures the machine, not the grid.
#   2. t_step_start is 0. The upstream example starts at 13529, which is a
#      restart from a checkpoint nobody else has.
#   3. Per-step output is off and the step count follows MFC's benchmark
#      convention, so a run costs minutes rather than hours.
#
# Why this case is worth having on the board: the seven upstream benchmarks are
# all shock-driven and inviscid except one. TGV is smooth, periodic and
# viscous -- no discontinuities for WENO to detect, so the reconstruction takes
# a different branch, and the viscous fluxes add a second halo exchange per
# step. It stresses communication where the shock cases stress the Riemann
# solver.
#
# The initial condition is MFC's hardcoded analytic patch 380
# (src/common/include/3dHardcodedIC.fpp), which fixes Mach = 0.1 and L = 1.
# Those two constants are therefore NOT free here -- the domain below must stay
# 2*pi on a side for the IC to be periodic.
import argparse
import json
import math

parser = argparse.ArgumentParser(
    prog="anu_tgv_3d",
    description="Taylor-Green vortex, weak-scaled for the ANU leaderboard.",
    formatter_class=argparse.ArgumentDefaultsHelpFormatter,
)
parser.add_argument("--mfc", type=json.loads, default="{}", metavar="DICT", help="MFC's toolchain's internal state.")
parser.add_argument("--gbpp", type=int, metavar="MEM", default=16, help="Problem size per rank, in GB of device memory.")
parser.add_argument("--steps", type=int, default=None, help="Override t_step_stop/t_step_save.")

ARGS = vars(parser.parse_args())
DICT = ARGS["mfc"]

# Copied verbatim from MFC's benchmarks/ so this case takes the same number of
# steps as the seven it shares a board format with.
#
# It does not do what it appears to do. MFC passes gpu as a STRING -- 'no' for
# a CPU run, 'acc' for offload -- and a non-empty string is truthy, so size is
# always 1 and the step count is always 20, never 10. Verified: a CPU run of
# this case reports "Time step 1 of 21".
#
# Left as-is deliberately. Fixing it here alone would make this case run half
# as many steps as the others on CPU, which is a worse problem than the one it
# fixes; it belongs upstream, in all eight cases at once.
size = 1 if DICT["gpu"] else 0

# 8e6 grid points per 16 GB per rank, matching benchmarks/. TGV is isotropic
# and periodic, so unlike the shock cases the domain is a cube: one cube root
# rather than the benchmarks' 2s x s x s.
ppg = 8000000 / 16.0
procs = DICT["nodes"] * DICT["tasks_per_node"]
ncells = math.floor(ppg * procs * ARGS["gbpp"])
N = math.floor(ncells ** (1 / 3))

# --- physics, all fixed by hardcoded IC 380 --------------------------------
Re = 1600        # Reynolds number of the classic TGV benchmark
L = 1            # vortex length scale; hcid 380 hardcodes this
P0 = 101325      # Pa
C0 = math.sqrt(1.4 * P0)
V0 = 0.1 * C0    # Mach 0.1; hcid 380 hardcodes this too
mu = V0 * L / Re

cfl = 0.5
dx = 2 * math.pi * L / (N + 1)
dt = cfl * dx / C0

print(
    json.dumps(
        {
            # Logistics
            "run_time_info": "F",
            # Computational Domain Parameters -- a 2*pi cube, periodic
            "x_domain%beg": -math.pi * L,
            "x_domain%end": math.pi * L,
            "y_domain%beg": -math.pi * L,
            "y_domain%end": math.pi * L,
            "z_domain%beg": -math.pi * L,
            "z_domain%end": math.pi * L,
            "m": N,
            "n": N,
            "p": N,
            "cyl_coord": "F",
            "dt": dt,
            "t_step_start": 0,
            "t_step_stop": ARGS["steps"] if ARGS["steps"] is not None else int(2 * (5 * size + 5)),
            "t_step_save": ARGS["steps"] if ARGS["steps"] is not None else int(2 * (5 * size + 5)),
            # Simulation Algorithm Parameters
            "num_patches": 1,
            "model_eqns": "5eq",
            "alt_soundspeed": "F",
            "num_fluids": 1,
            "mixture_err": "T",
            "time_stepper": "rk3",
            "weno_order": 5,
            "weno_eps": 1.0e-16,
            "weno_Re_flux": "F",
            "weno_avg": "F",
            "mapped_weno": "T",
            "riemann_solver": "hllc",
            "wave_speeds": "direct",
            "avg_state": "arithmetic",
            # -1 is periodic on every face: TGV has no boundaries.
            "bc_x%beg": -1,
            "bc_x%end": -1,
            "bc_y%beg": -1,
            "bc_y%end": -1,
            "bc_z%beg": -1,
            "bc_z%end": -1,
            # The reason this case is not just another shock tube: viscous
            # fluxes add a second halo exchange per stage.
            "viscous": "T",
            # Formatted Database Files Structure Parameters
            "format": "silo",
            "precision": "double",
            "prim_vars_wrt": "T",
            "fd_order": 4,
            "parallel_io": "T",
            # Patch 1: the whole domain, initialised analytically by hcid 380.
            "patch_icpp(1)%geometry": 9,
            "patch_icpp(1)%x_centroid": 0,
            "patch_icpp(1)%y_centroid": 0,
            "patch_icpp(1)%z_centroid": 0,
            "patch_icpp(1)%length_x": 2 * math.pi * L,
            "patch_icpp(1)%length_y": 2 * math.pi * L,
            "patch_icpp(1)%length_z": 2 * math.pi * L,
            "patch_icpp(1)%vel(1)": 0.0,
            "patch_icpp(1)%vel(2)": 0.0,
            "patch_icpp(1)%vel(3)": 0.0,
            "patch_icpp(1)%pres": 0.0,
            "patch_icpp(1)%hcid": 380,
            "patch_icpp(1)%alpha_rho(1)": 1,
            "patch_icpp(1)%alpha(1)": 1,
            # Fluids Physical Parameters -- ideal air, viscous
            "fluid_pp(1)%gamma": 1.0e00 / (1.4 - 1),
            "fluid_pp(1)%pi_inf": 0,
            "fluid_pp(1)%Re(1)": 1 / mu,
        }
    )
)
