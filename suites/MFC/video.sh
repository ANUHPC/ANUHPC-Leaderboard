#!/usr/bin/env bash
# Run inside a CPU Slurm allocation, after post_process. Output stays in /work.
# video.sh <case-directory> <output-directory> [mfc-tree]
set -euo pipefail
CASE_DIR="$(realpath "${1:?case directory required}")"
OUT_DIR="${2:?output directory required}"
export MFC_ROOT="${3:-/work/mfc/current/haswell}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
mkdir -p "$OUT_DIR"
# Local scratch avoids writing and rereading ~8 GB of intermediate VTK on NFS.
LOCAL_VTK="$(mktemp -d /tmp/mfc-video.XXXXXX)"
trap 'rm -rf "$LOCAL_VTK"' EXIT
"$MFC_ROOT/build/venv/bin/python" "$REPO/suites/MFC/silo2vtk.py" "$CASE_DIR" "$LOCAL_VTK" --var pres --max-frames 60
SPHERE=$(python3 - "$CASE_DIR/case.py" <<'PY'
import json, subprocess, sys
c = json.loads(subprocess.check_output([sys.executable, sys.argv[1]], text=True))
print(','.join(str(c[f'patch_ib(1)%{k}']) for k in ('x_centroid','y_centroid','z_centroid','radius')))
PY
)
"/work/viz-venv/bin/python" "$REPO/suites/MFC/render3d_vtk.py" "$LOCAL_VTK" "$OUT_DIR/frames" \
  --var pres --sphere="$SPHERE" --size 1280x720 --zoom 2.4
FFMPEG=$("$MFC_ROOT/build/venv/bin/python" -c 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())')
"$FFMPEG" -y -framerate 24 -i "$OUT_DIR/frames/frame_%04d.png" \
  -c:v libx264 -crf 18 -pix_fmt yuv420p -movflags +faststart "$OUT_DIR/bowshock-gpu.mp4"
python3 - "$CASE_DIR" "$OUT_DIR" <<'PY'
import json, pathlib, sys
case, out = map(pathlib.Path, sys.argv[1:])
(out / 'video.json').write_text(json.dumps({
    'source': str(case), 'video': 'bowshock-gpu.mp4',
    'frames': len(list((out / 'frames').glob('frame_*.png'))),
    'fps': 24, 'width': 1280, 'height': 720,
}, indent=2) + '\n')
PY
echo "Video: $OUT_DIR/bowshock-gpu.mp4"
