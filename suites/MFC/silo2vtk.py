# Convert MFC Silo-HDF5 output into legacy VTK rectilinear grids.
#
#   <mfc>/build/venv/bin/python silo2vtk.py <case_dir> <out_dir> [--var NAME ...]
#
# Why this exists: ParaView cannot read MFC's Silo output. Its VisIt Silo
# reader opens the collection, reports the right number of timesteps, and then
# returns zero points, zero cells and no arrays, throwing
# "vtkVisItSiloReader: VisIt Exception caught" for every file. MFC's own reader
# handles the layout correctly -- it is what ./mfc.sh viz uses -- so this reuses
# it and re-emits the fields in a format ParaView reads natively.
#
# Legacy VTK rather than .vti because the format is simple, binary, and
# rectilinear grids carry MFC's cell-centre coordinates directly, including
# stretched grids. Legacy binary VTK is big-endian by definition, hence the
# byte-swapping below.
#
# Must run under MFC's venv: it imports MFC's toolchain and needs h5py.
import argparse
import os
import sys

import numpy as np

# MFC's toolchain is importable only from the checkout root.
HERE = os.path.dirname(os.path.abspath(__file__))


def _find_mfc_root(case_dir):
    for env in ("MFC_ROOT", "MFC_TREE"):
        if os.environ.get(env):
            return os.environ[env]
    # walk up from this script: suites/MFC/ -> repo, not the MFC checkout,
    # so fall back to the published tree.
    for guess in ("/work/mfc/current/haswell", "/work/mfc/current/zen3"):
        if os.path.isdir(os.path.join(guess, "toolchain")):
            return guess
    sys.exit("silo2vtk: cannot locate an MFC checkout; set MFC_ROOT")


def write_rectilinear(path, x, y, z, arrays):
    """Legacy VTK RECTILINEAR_GRID, binary, big-endian."""
    nx, ny, nz = len(x), len(y), len(z)
    with open(path, "wb") as f:
        w = lambda s: f.write(s.encode("ascii"))  # noqa: E731
        w("# vtk DataFile Version 3.0\n")
        w("MFC field\n")
        w("BINARY\n")
        w("DATASET RECTILINEAR_GRID\n")
        w(f"DIMENSIONS {nx} {ny} {nz}\n")
        for name, coord in (("X", x), ("Y", y), ("Z", z)):
            w(f"{name}_COORDINATES {len(coord)} float\n")
            f.write(np.asarray(coord, dtype=">f4").tobytes())
            w("\n")
        w(f"POINT_DATA {nx * ny * nz}\n")
        for name, data in arrays.items():
            w(f"SCALARS {name} float 1\n")
            w("LOOKUP_TABLE default\n")
            # VTK expects x fastest. MFC hands back (x, y, ...) so the axes are
            # reversed before flattening, or the field comes out mirrored.
            #
            # Reversed generically rather than transpose(2, 1, 0): a 2D case
            # hands back a 2-D array and the fixed form raised
            # "ValueError: axes don't match array", so this script worked only
            # on 3D. 2D previews go through `mfc.sh viz` today and so never hit
            # it, which is why it went unnoticed.
            arr = np.asarray(data, dtype=">f4")
            f.write(arr.transpose(*range(arr.ndim - 1, -1, -1)).ravel().tobytes())
            w("\n")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--var", action="append", default=None)
    ap.add_argument("--max-frames", type=int, default=None)
    args = ap.parse_args()

    root = _find_mfc_root(args.case_dir)
    sys.path.insert(0, os.path.join(root, "toolchain"))
    from mfc.viz import reader as mfc_reader  # noqa: E402
    from mfc.viz import silo_reader  # noqa: E402

    fmt = mfc_reader.discover_format(args.case_dir)
    if fmt != "silo":
        sys.exit(f"silo2vtk: expected silo output, found {fmt}")
    steps = mfc_reader.discover_timesteps(args.case_dir, fmt)
    if not steps:
        sys.exit("silo2vtk: no timesteps found — did post_process run?")
    # A 3000-step run saving every 50 steps has 60 evolved frames plus t=0.
    # Retain the final 60 for a uniformly spaced animation ending at step 3000.
    if args.max_frames is not None:
        if args.max_frames < 1:
            sys.exit("silo2vtk: --max-frames must be positive")
        steps = steps[-args.max_frames:]

    os.makedirs(args.out_dir, exist_ok=True)
    print(f"silo2vtk: {len(steps)} timesteps from {args.case_dir}", flush=True)

    for i, step in enumerate(steps):
        # Reading only pressure keeps the 33M-cell demo within a few GB of
        # host memory instead of assembling every flow field unnecessarily.
        a = silo_reader.assemble_silo(args.case_dir, step,
                                     var=args.var[0] if args.var and len(args.var) == 1 else None)
        wanted = args.var or list(a.variables.keys())
        arrays = {k: a.variables[k] for k in wanted if k in a.variables}
        if not arrays:
            sys.exit(f"silo2vtk: requested variables {wanted} missing at step {step}")

        # Velocity magnitude is the thing worth looking at: it is what makes
        # the shock and the wake visible. MFC stores the components separately.
        comps = [a.variables.get(f"vel{j}") for j in (1, 2, 3)]
        if all(c is not None for c in comps):
            arrays["velmag"] = np.sqrt(sum(np.square(c) for c in comps))

        out = os.path.join(args.out_dir, f"field_{i:04d}.vtk")
        write_rectilinear(out, a.x_cc, a.y_cc, a.z_cc, arrays)
        print(f"  step {step} -> {os.path.basename(out)} "
              f"({'x'.join(str(s) for s in next(iter(arrays.values())).shape)}) "
              f"vars={','.join(arrays)}", flush=True)

    print(f"silo2vtk: wrote {len(steps)} files to {args.out_dir}", flush=True)


if __name__ == "__main__":
    main()
