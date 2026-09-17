#!/usr/bin/env python3
# MIT License
#
# Copyright (c) 2021 Spencer Bryngelson and Tim Colonius
#
# Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
#
# The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
#
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

import argparse
import json
import math

# SCC26 Practice Problem 3, pp. 4-6: 2D shock-droplet parameter sweep.
# Based on MFlowCode/MFC e2f0e267 examples/2D_shockdroplet/case.py.
#
# Every knob the task names is a COMMAND-LINE ARGUMENT, so one copy of this
# file serves a whole sweep.  Pass them from job.yml, e.g.
#     args: ["--mach", "2.4"]
#     args: ["-N", "480"]
#     args: ["--viscous"]
#     args: ["--sigma", "0.0728"]
# The constants below are only the defaults used when an argument is absent.
MACH = 1.4
RESOLUTION = 0.2  # 240 x 60 cells; PDF figure uses 4.0 (4800 x 1200).
END_TIME = 1.0  # Dimensionless breakup time; PDF figure uses 2.0.
CFL = 0.2
ADAPTIVE_DT = False
VISCOUS = False  # Upstream case is inviscid.
SIGMA = 0.0  # N/m. 0 disables surface tension (upstream default).
MU_LIQUID = 1.0e-3  # Pa s, liquid water at 20 C.
MU_GAS = 1.81e-5  # Pa s, air at 20 C.
SAVES = 100  # Silo snapshots over the run (upstream behaviour).
RUN_TIME_INFO = True  # Per-step stability table (run_time.inf).

parser = argparse.ArgumentParser(prog="2D_shockdroplet", formatter_class=argparse.ArgumentDefaultsHelpFormatter)
parser.add_argument(
    "--mfc",
    type=json.loads,
    default="{}",
    metavar="DICT",
    help="MFC's toolchain's internal state.",
)
parser.add_argument("--mach", type=float, default=MACH, help="Shock Mach number.")
parser.add_argument("--adap-dt", action="store_true", default=ADAPTIVE_DT, help="Use CFL-based adaptive time-stepping.")
parser.add_argument("--cfl", type=float, default=CFL, help="CFL number.")
parser.add_argument("--tend", type=float, default=END_TIME, help="Dimensionless end time.")
parser.add_argument("--res", type=float, default=RESOLUTION, help="Resolution scaling factor (1.0 = 1200 x 300).")
parser.add_argument(
    "-N",
    "--nx",
    dest="nx",
    type=int,
    default=None,
    help="Cells in x. Overrides --res; the 4:1 domain gives N/4 cells in y.",
)
parser.add_argument(
    "--viscous",
    action=argparse.BooleanOptionalAction,
    default=VISCOUS,
    help="Enable/disable viscous (Navier-Stokes) terms.",
)
parser.add_argument("--mu-liquid", type=float, default=MU_LIQUID, help="Liquid dynamic viscosity [Pa s].")
parser.add_argument("--mu-gas", type=float, default=MU_GAS, help="Gas dynamic viscosity [Pa s].")
parser.add_argument(
    "--run-time-info",
    action=argparse.BooleanOptionalAction,
    default=RUN_TIME_INFO,
    help="Write run_time.inf (ICFL/VCFL/CCFL/Rc every step). Costs a global reduction and a formatted write per step.",
)
parser.add_argument(
    "--saves",
    type=int,
    default=SAVES,
    help="Number of Silo snapshots written over the run. Lower it when sweeping: file writing is not what you are timing.",
)
parser.add_argument(
    "--sigma",
    "--surface-tension",
    dest="sigma",
    type=float,
    default=SIGMA,
    help="Surface tension coefficient [N/m]. 0 turns the model off; water/air is 0.0728.",
)
args = parser.parse_args()

Ma = args.mach
p_a = 101325.0
rho_a = 1.204
rho_w = 1000
gam_a = 1.4
gam_w = 6.12
pi_w = 3.43e8

# Post-shock state from the Rankine-Hugoniot conditions (shock moving into still air)
ps = p_a * (1 + 2 * gam_a / (gam_a + 1) * (Ma**2 - 1))
rho_post_a = rho_a * (gam_a + 1) * Ma**2 / ((gam_a - 1) * Ma**2 + 2)
c_a = math.sqrt(gam_a * p_a / rho_a)
vel = 2 * c_a / (gam_a + 1) * (Ma**2 - 1) / Ma

c_l = math.sqrt(gam_a * ps / rho_a)
eps = 1e-6

D = 0.048
if args.nx is not None:
    # Absolute cell counts; the domain is 24D x 6D, so y gets a quarter of x.
    Nx = args.nx - 1
    Ny = max(4, int(round(args.nx / 4))) - 1
else:
    Ny = (300 * args.res) - 1
    Nx = (1200 * args.res) - 1
dx = 24 * D / Nx

# End time in units of the Ranger & Nicholls (1969) breakup time scale
# t_breakup = D sqrt(rho_l/rho_g) / u_g, with post-shock gas conditions
tau_end = args.tend
time_end = tau_end * D * math.sqrt(rho_w / rho_post_a) / vel
cfl = args.cfl

dt = cfl * dx / c_l
Nt = int(time_end / dt)

if args.adap_dt:
    time_stepping = {
        "cfl_adap_dt": "T",
        "cfl_target": cfl,
        "n_start": 0,
        "t_stop": time_end,
        "t_save": time_end / max(1, args.saves),
    }
else:
    time_stepping = {
        "dt": dt,
        "t_step_start": 0,
        "t_step_stop": Nt,
        "t_step_save": math.ceil(Nt / max(1, args.saves)),
    }

# Viscosity. MFC stores Re(1) = 1/mu (inverse dynamic viscosity) in the same
# dimensional system as the rest of the case, which here is SI.
if args.viscous:
    viscosity = {
        "viscous": "T",
        "fluid_pp(1)%Re(1)": 1.0 / args.mu_liquid,
        "fluid_pp(2)%Re(1)": 1.0 / args.mu_gas,
    }
else:
    viscosity = {}

# Surface tension. Needs model_eqns 2/3, num_fluids 2 and HLLC (all already
# true here) plus a colour function: 1 where alpha_water = 1, 0 where it is 0.
if args.sigma > 0.0:
    capillarity = {
        "surface_tension": "T",
        "sigma": args.sigma,
        "patch_icpp(1)%cf_val": 0.0,
        "patch_icpp(2)%cf_val": 0.0,
        "patch_icpp(3)%cf_val": 1.0,
    }
else:
    capillarity = {}

print(
    json.dumps(
        {
            # Logistics
            "run_time_info": "T" if args.run_time_info else "F",
            # Computational Domain Parameters
            "x_domain%beg": -4 * D,
            "x_domain%end": 20 * D,
            "y_domain%beg": 0.0,
            "y_domain%end": 6 * D,
            "stretch_y": "T",
            "a_y": 3.67,
            "y_a": -5.7 * D,
            "y_b": 5.7 * D,
            "loops_y": 2,
            "m": int(Nx),
            "n": int(Ny),
            "p": 0,
            **time_stepping,
            "elliptic_smoothing": "T",
            "elliptic_smoothing_iters": 20,
            # Simulation Algorithm Parameters
            "num_patches": 3,
            "model_eqns": "5eq",
            "alt_soundspeed": "F",
            "num_fluids": 2,
            "mpp_lim": "F",
            "mixture_err": "F",
            "time_stepper": "rk3",
            "weno_order": 3,
            "weno_eps": 1.0e-16,
            "weno_Re_flux": "F",
            "weno_avg": "F",
            "mapped_weno": "T",
            "null_weights": "F",
            "mp_weno": "F",
            "riemann_solver": "hllc",
            "wave_speeds": "direct",
            "avg_state": "arithmetic",
            "bc_x%beg": -6,  # 11,
            "bc_x%end": -6,  # 12
            "bc_y%beg": -2,
            "bc_y%end": -3,
            **viscosity,
            **capillarity,
            # Formatted Database Files Structure Parameters
            "format": "silo",
            "precision": "double",
            "prim_vars_wrt": "T",
            "parallel_io": "T",
            # Patch 1: Background
            "patch_icpp(1)%geometry": 3,
            "patch_icpp(1)%x_centroid": 8 * D,
            "patch_icpp(1)%y_centroid": 6 * D,
            "patch_icpp(1)%length_x": 24 * D,
            "patch_icpp(1)%length_y": 14 * D,
            "patch_icpp(1)%vel(1)": 0.0,
            "patch_icpp(1)%vel(2)": 0.0e00,
            "patch_icpp(1)%pres": p_a,
            "patch_icpp(1)%alpha_rho(1)": eps * rho_w,
            "patch_icpp(1)%alpha_rho(2)": (1 - eps) * rho_a,
            "patch_icpp(1)%alpha(1)": eps,
            "patch_icpp(1)%alpha(2)": 1 - eps,
            # Patch 2: Shocked state
            "patch_icpp(2)%geometry": 3,
            "patch_icpp(2)%alter_patch(1)": "T",
            "patch_icpp(2)%x_centroid": -2.5 * D,
            "patch_icpp(2)%y_centroid": 6 * D,
            "patch_icpp(2)%length_x": 3 * D,
            "patch_icpp(2)%length_y": 14 * D,
            "patch_icpp(2)%vel(1)": vel,
            "patch_icpp(2)%vel(2)": 0.0e00,
            "patch_icpp(2)%pres": ps,
            "patch_icpp(2)%alpha_rho(1)": eps * rho_w,
            "patch_icpp(2)%alpha_rho(2)": (1 - eps) * rho_post_a,
            "patch_icpp(2)%alpha(1)": eps,
            "patch_icpp(2)%alpha(2)": 1 - eps,
            # Patch 3: Bubble
            "patch_icpp(3)%geometry": 2,
            "patch_icpp(3)%x_centroid": 0,
            "patch_icpp(3)%y_centroid": 0,
            "patch_icpp(3)%radius": D / 2,
            "patch_icpp(3)%alter_patch(1)": "T",
            "patch_icpp(3)%vel(1)": 0.0,
            "patch_icpp(3)%vel(2)": 0.0e00,
            "patch_icpp(3)%pres": p_a,
            "patch_icpp(3)%alpha_rho(1)": (1 - eps) * rho_w,
            "patch_icpp(3)%alpha_rho(2)": eps * 1.17,
            "patch_icpp(3)%alpha(1)": 1 - eps,  # 0.95
            "patch_icpp(3)%alpha(2)": eps,  # 0.05,
            # Fluids Physical Parameters
            "fluid_pp(1)%gamma": 1.0e00 / (gam_w - 1.0e00),
            "fluid_pp(1)%pi_inf": pi_w * gam_w / (gam_w - 1.0e00),
            "fluid_pp(2)%gamma": 1.0e00 / (gam_a - 1.0e00),
            "fluid_pp(2)%pi_inf": 0.0e00,
        }
    )
)
