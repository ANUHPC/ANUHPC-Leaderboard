# True 3D render of an MFC case, using VTK directly.
#
#   /work/viz-venv/bin/python render3d_vtk.py <vtk_dir> <out_dir> [--var velmag]
#
# Two earlier routes failed, both verified rather than assumed:
#
#   ./mfc.sh viz --mp4   cannot do 3D. render_3d_slice() takes a 2D midplane
#                        cut, which is why the first video looked flat.
#   ParaView 5.13 osmesa reads MFC's Silo as 0 points / 0 cells / no arrays,
#                        and its renderer segfaults on these nodes because the
#                        osmesa build links the system NVIDIA libGL, which
#                        wants a display.
#
# So: silo2vtk.py re-emits the fields through MFC's own reader, and this
# renders them with a self-contained vtk-osmesa wheel that has no system GL
# dependency at all.
#
# What it draws:
#   * the immersed body from the sphere geometry supplied from case.py
#   * the air as a translucent volume coloured by pressure, so the
#     bow shock is the bright shell standing off the nose
#   * a camera orbiting as time advances, so the image reads as solid
import argparse
import glob
import os
import sys

import vtk

# (fraction of the way from free stream to peak, opacity of that shell)
# Multiples of the free-stream value, and how solid each shell is. The shock
# occupies well under 1% of the domain (measured: 0.4% of cells exceed 1.5x
# free-stream pressure), so the shells have to be near the free stream and
# fairly opaque or there is nothing to see.
ISO_LEVELS = ((1.08, 0.22), (1.35, 0.40), (2.20, 0.75))


def build_lut(lo, hi):
    """Inferno-ish: dark at the free stream, hot through the shock."""
    lut = vtk.vtkColorTransferFunction()
    span = (hi - lo) or 1.0
    for frac, rgb in (
        (0.00, (0.001, 0.000, 0.014)),
        (0.25, (0.258, 0.039, 0.406)),
        (0.50, (0.578, 0.148, 0.404)),
        (0.75, (0.865, 0.317, 0.226)),
        (0.90, (0.988, 0.645, 0.040)),
        (1.00, (0.988, 0.998, 0.645)),
    ):
        lut.AddRGBPoint(lo + frac * span, *rgb)
    return lut


def build_opacity(lo, hi, ref):
    """Make the undisturbed flow invisible, so only the disturbance shows.

    Colouring the whole domain by a field that is nearly uniform gives a solid
    block of one colour -- the first attempt did exactly that with velocity,
    where the free stream is 527 m/s almost everywhere. `ref` is the
    undisturbed value taken from frame 0, which at t=0 is uniform by
    construction. Everything at or below it is fully transparent, so what you
    see is the shock and the wake rather than the box they sit in.
    """
    o = vtk.vtkPiecewiseFunction()
    top = max(hi, ref * 1.001)
    o.AddPoint(lo, 0.0)
    o.AddPoint(ref, 0.0)
    o.AddPoint(ref + 0.08 * (top - ref), 0.030)
    o.AddPoint(ref + 0.30 * (top - ref), 0.150)
    o.AddPoint(ref + 0.60 * (top - ref), 0.420)
    o.AddPoint(top, 0.850)
    return o


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("vtk_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--var", default="pres")
    ap.add_argument("--body", default="ib_markers")
    ap.add_argument("--spin", type=float, default=1.5, help="degrees per frame")
    ap.add_argument("--size", default="1280x720")
    ap.add_argument("--samples", type=int, default=224)
    ap.add_argument("--zoom", type=float, default=1.35)
    ap.add_argument("--sphere", default=None,
                    help="cx,cy,cz,r of the immersed body (from the case file)")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(args.vtk_dir, "field_*.vtk")))
    if not files:
        sys.exit(f"render3d_vtk: no field_*.vtk in {args.vtk_dir}")
    os.makedirs(args.out_dir, exist_ok=True)
    w, h = (int(v) for v in args.size.lower().split("x"))

    # --- one pass to fix the colour range across the whole animation --------
    # Per-frame autoscaling would make the shock pulse as the range moves,
    # which reads as flicker rather than physics.
    lo, hi = None, None
    for f in files:
        r = vtk.vtkRectilinearGridReader()
        r.SetFileName(f)
        r.ReadAllScalarsOn()
        r.Update()
        arr = r.GetOutput().GetPointData().GetArray(args.var)
        if arr is None:
            sys.exit(f"render3d_vtk: no array '{args.var}' in {f}")
        a, b = arr.GetRange()
        lo = a if lo is None else min(lo, a)
        hi = b if hi is None else max(hi, b)
    print(f"render3d_vtk: {len(files)} frames, {args.var} range {lo:.4g}..{hi:.4g}", flush=True)

    ren = vtk.vtkRenderer()
    ren.SetBackground(0.03, 0.04, 0.08)
    rw = vtk.vtkRenderWindow()
    rw.SetOffScreenRendering(1)
    rw.AddRenderer(ren)
    rw.SetSize(w, h)

    # The undisturbed value: frame 0 is uniform, so its median is the free
    # stream. Opacity is keyed off this, not off the raw minimum.
    r0 = vtk.vtkRectilinearGridReader()
    r0.SetFileName(files[0])
    r0.ReadAllScalarsOn()
    r0.Update()
    a0 = r0.GetOutput().GetPointData().GetArray(args.var)
    vals = sorted(a0.GetValue(i) for i in range(0, a0.GetNumberOfTuples(), 97))
    ref = vals[len(vals) // 2] if vals else lo
    print(f"render3d_vtk: free-stream {args.var} = {ref:.4g} (transparent below this)", flush=True)

    # Map colour over the range the shock actually occupies, not out to the
    # global peak. The peak is a handful of stagnation-point cells; stretching
    # the map to reach it leaves the whole visible shock in the darkest 10% of
    # the colours, which is what made the first attempt look nearly black.
    ctop = min(hi, ref * 3.0)
    colour, opacity = build_lut(ref, ctop), build_opacity(lo, hi, ref)

    vol_prop = vtk.vtkVolumeProperty()
    vol_prop.SetColor(colour)
    vol_prop.SetScalarOpacity(opacity)
    vol_prop.SetInterpolationTypeToLinear()
    vol_prop.ShadeOff()

    volume = vtk.vtkVolume()
    volume.SetProperty(vol_prop)
    ren.AddVolume(volume)

    # Fractions above the free stream, and how solid each shell is.
    iso_actors = []
    for _frac, _opac in ISO_LEVELS:
        a = vtk.vtkActor()
        a.GetProperty().SetOpacity(_opac)
        ren.AddActor(a)
        iso_actors.append(a)

    body_actor = vtk.vtkActor()
    body_actor.GetProperty().SetColor(0.88, 0.90, 0.95)
    body_actor.GetProperty().SetSpecular(0.7)
    body_actor.GetProperty().SetSpecularPower(40)
    ren.AddActor(body_actor)

    bar = vtk.vtkScalarBarActor()
    bar.SetLookupTable(colour)
    bar.SetTitle("Pressure (Pa)" if args.var == "pres" else "|u|  m/s" if args.var == "velmag" else args.var)
    bar.SetNumberOfLabels(5)
    bar.GetTitleTextProperty().SetColor(1, 1, 1)
    bar.GetLabelTextProperty().SetColor(1, 1, 1)
    bar.SetWidth(0.07)
    bar.SetHeight(0.40)
    bar.SetPosition(0.90, 0.30)
    ren.AddActor2D(bar)

    for i, f in enumerate(files):
        r = vtk.vtkRectilinearGridReader()
        r.SetFileName(f)
        r.ReadAllScalarsOn()
        r.Update()
        grid = r.GetOutput()

        # Volume rendering needs uniform image data; MFC grids are rectilinear.
        grid.GetPointData().SetActiveScalars(args.var)
        resample = vtk.vtkResampleToImage()
        resample.SetInputDataObject(grid)
        resample.UseInputBoundsOn()
        resample.SetSamplingDimensions(args.samples, args.samples // 2, args.samples // 2)
        resample.Update()
        img = resample.GetOutput()
        img.GetPointData().SetActiveScalars(args.var)

        mapper = vtk.vtkSmartVolumeMapper()
        mapper.SetInputData(img)
        mapper.SetBlendModeToComposite()
        volume.SetMapper(mapper)

        # Isosurfaces of the same field, layered over the volume. Volume
        # rendering alone is fragile here: the shock is a thin sheet, and once
        # it is resampled onto a coarser uniform grid the opacity needed to see
        # it is a knife edge -- too low and the domain is empty, too high and
        # it is a solid block. Shells at fixed fractions above the free stream
        # always show the shock's shape, whatever the resolution.
        for k, (frac, opac) in enumerate(ISO_LEVELS):
            level = ref * frac
            if level >= hi:
                iso_actors[k].SetMapper(vtk.vtkPolyDataMapper())
                continue
            iso = vtk.vtkContourFilter()
            iso.SetInputData(grid)
            grid.GetPointData().SetActiveScalars(args.var)
            iso.SetValue(0, level)
            iso.Update()
            nrm = vtk.vtkPolyDataNormals()
            nrm.SetInputConnection(iso.GetOutputPort())
            nrm.SetFeatureAngle(60)
            im = vtk.vtkPolyDataMapper()
            im.SetInputConnection(nrm.GetOutputPort())
            im.ScalarVisibilityOff()
            iso_actors[k].SetMapper(im)
            rgb = colour.GetColor(level)
            iso_actors[k].GetProperty().SetColor(*rgb)
            iso_actors[k].GetProperty().SetOpacity(opac)
            iso_actors[k].GetProperty().SetAmbient(0.45)
            iso_actors[k].GetProperty().SetDiffuse(0.75)
            iso_actors[k].GetProperty().SetSpecular(0.25)

        # The body is drawn from its geometry, not from ib_markers. MFC marks
        # only the cells the immersed boundary touches -- 1190 points out of
        # 1.05M here -- so contouring that field gives a handful of disconnected
        # fragments, not a sphere. The case file knows the real centre and
        # radius, so use them.
        if i == 0 and args.sphere:
            cx, cy, cz, rad = (float(v) for v in args.sphere.split(","))
            src = vtk.vtkSphereSource()
            src.SetCenter(cx, cy, cz)
            src.SetRadius(rad)
            src.SetThetaResolution(64)
            src.SetPhiResolution(64)
            bmap = vtk.vtkPolyDataMapper()
            bmap.SetInputConnection(src.GetOutputPort())
            bmap.ScalarVisibilityOff()
            body_actor.SetMapper(bmap)

        if i == 0:
            ren.ResetCamera()
            ren.GetActiveCamera().Elevation(16)
            ren.GetActiveCamera().Zoom(args.zoom)
            ren.ResetCameraClippingRange()
        else:
            ren.GetActiveCamera().Azimuth(args.spin)
            ren.ResetCameraClippingRange()

        rw.Render()
        w2i = vtk.vtkWindowToImageFilter()
        w2i.SetInput(rw)
        w2i.ReadFrontBufferOff()
        w2i.Update()
        png = os.path.join(args.out_dir, f"frame_{i:04d}.png")
        writer = vtk.vtkPNGWriter()
        writer.SetFileName(png)
        writer.SetInputConnection(w2i.GetOutputPort())
        writer.Write()
        print(f"render3d_vtk: frame {i + 1}/{len(files)}", flush=True)

    print(f"render3d_vtk: wrote {len(files)} frames to {args.out_dir}", flush=True)


if __name__ == "__main__":
    main()
