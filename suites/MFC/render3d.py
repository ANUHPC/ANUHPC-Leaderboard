# True 3D render of an MFC case, for pvbatch.
#
#   /work/paraview/bin/pvbatch render3d.py <vtk_dir> <out_dir> [--var velmag]
#
# Input is the .vtk series written by silo2vtk.py, NOT MFC's Silo output
# directly: ParaView's VisIt Silo reader opens MFC's collection, reports the
# right timestep count, then returns zero points and no arrays. silo2vtk.py
# reuses MFC's own reader and re-emits rectilinear grids ParaView reads.
#
# Why this rather than ./mfc.sh viz --mp4: that path cannot do 3D. Its
# render_3d_slice() takes a 2D midplane cut out of the field, which is why it
# produces a flat picture of a 3D simulation.
#
# What it draws:
#   * the immersed body as an opaque isosurface of ib_markers -- the sphere
#   * the air as a translucent volume coloured by velocity magnitude, so the
#     bow shock reads as a bright shell standing off the nose and the wake
#     trails behind it
#   * a camera that orbits as time advances, so the result reads as solid
#
# Headless: the osmesa ParaView build needs no X server. It does need
# libglapi.so.0 and libGL.so.1, which on this cluster exist only on the GPU
# nodes, so run it there.
import argparse
import glob
import os
import sys

from paraview.simple import *  # noqa: F403

ap = argparse.ArgumentParser()
ap.add_argument("vtk_dir")
ap.add_argument("out_dir")
ap.add_argument("--var", default="velmag")
ap.add_argument("--spin", type=float, default=1.2, help="degrees of orbit per frame")
ap.add_argument("--size", default="1280x720")
args = ap.parse_args()

files = sorted(glob.glob(os.path.join(args.vtk_dir, "field_*.vtk")))
if not files:
    sys.exit(f"render3d: no field_*.vtk in {args.vtk_dir} — run silo2vtk.py first")
os.makedirs(args.out_dir, exist_ok=True)
w, h = (int(v) for v in args.size.lower().split("x"))

paraview.simple._DisableFirstRenderCameraReset()  # noqa: F405

reader = LegacyVTKReader(FileNames=files)  # noqa: F405
reader.UpdatePipeline()
steps = list(reader.TimestepValues) or [0.0]
print(f"render3d: {len(files)} files, {len(steps)} timesteps", flush=True)

view = GetActiveViewOrCreate("RenderView")  # noqa: F405
view.ViewSize = [w, h]
view.Background = [0.03, 0.04, 0.08]
view.UseColorPaletteForBackground = 0
view.OrientationAxesVisibility = 0

# Volume rendering needs uniform image data; MFC grids are rectilinear, and
# stretched ones are not volume-renderable as-is. Resampling also caps memory
# independently of the simulation resolution.
img = ResampleToImage(Input=reader)  # noqa: F405
img.SamplingDimensions = [256, 160, 160]
img.UpdatePipeline()

air = Show(img, view)  # noqa: F405
air.SetRepresentationType("Volume")
ColorBy(air, ("POINTS", args.var))  # noqa: F405

# Take the range from the data itself. RescaleTransferFunctionToDataRange on
# the LUT object wants a VTK proxy and fails from a plain script, so set the
# points explicitly instead.
info = img.PointData[args.var]
lo, hi = (float(v) for v in info.GetRange())
if hi <= lo:
    hi = lo + 1.0
span = hi - lo

lut = GetColorTransferFunction(args.var)  # noqa: F405
lut.ApplyPreset("Inferno (matplotlib)", True)
lut.RGBPoints = [
    lo, 0.001, 0.000, 0.014,
    lo + 0.25 * span, 0.35, 0.07, 0.43,
    lo + 0.50 * span, 0.74, 0.22, 0.30,
    lo + 0.75 * span, 0.98, 0.56, 0.04,
    hi, 0.99, 0.99, 0.75,
]

# Keep the free stream nearly invisible so the shock and wake are what the eye
# lands on; ramp opacity hard at the top of the range.
pwf = GetOpacityTransferFunction(args.var)  # noqa: F405
pwf.Points = [
    lo, 0.0, 0.5, 0.0,
    lo + 0.40 * span, 0.012, 0.5, 0.0,
    lo + 0.72 * span, 0.16, 0.5, 0.0,
    hi, 0.72, 0.5, 0.0,
]

# --- the object ------------------------------------------------------------
# ib_markers is 0 in the fluid and non-zero inside the body, so 0.5 is its skin.
body = Contour(Input=reader)  # noqa: F405
body.ContourBy = ["POINTS", "ib_markers"]
body.Isosurfaces = [0.5]
body.UpdatePipeline()
bd = Show(body, view)  # noqa: F405
bd.SetRepresentationType("Surface")
ColorBy(bd, None)  # noqa: F405
bd.AmbientColor = [0.88, 0.90, 0.95]
bd.DiffuseColor = [0.88, 0.90, 0.95]
bd.Specular = 0.7
bd.SpecularPower = 40

bar = GetScalarBar(lut, view)  # noqa: F405
bar.Title = "|u|  m/s" if args.var == "velmag" else args.var
bar.ComponentTitle = ""
bar.TitleColor = [1, 1, 1]
bar.LabelColor = [1, 1, 1]
air.SetScalarBarVisibility(view, True)

ResetCamera()  # noqa: F405
cam = GetActiveCamera()  # noqa: F405
cam.Elevation(18)
Render()  # noqa: F405

for i, t in enumerate(steps):
    view.ViewTime = t
    if i:
        cam.Azimuth(args.spin)  # a steady orbit; depth reads from the motion
    Render()  # noqa: F405
    png = os.path.join(args.out_dir, f"frame_{i:04d}.png")
    SaveScreenshot(png, view, ImageResolution=[w, h])  # noqa: F405
    print(f"render3d: frame {i + 1}/{len(steps)}", flush=True)

print(f"render3d: wrote {len(steps)} frames to {args.out_dir}", flush=True)
