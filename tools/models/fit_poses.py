"""Ground-contact solve for the seven ordinary poses against the delivered FORM-Q GLB.

    .toolchain/py/bin/python tools/models/fit_poses.py [--write]

Joint rotations are authored data and are not changed. For each pose, the root's vertical offset is
raised (never lowered) just enough that the lowest skinned LOD0 vertex stays within the allowed
ground penetration. The same linear-blend skinning and model-space pose rule as the runtime are used
(validate_q.Skeleton), so the result is measured on the exact delivered bytes.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import validate_q as vq  # noqa: E402

POSE_PATH = vq.ROOT / 'src/render/god/qPoses.json'
ALLOWED_PENETRATION_U = 0.25


def lowest(sk: vq.Skeleton, mesh: dict, spec: dict) -> float:
    v = mesh['POSITION'].astype(float)
    pv = sk.skin(sk.pose(spec), v, mesh['JOINTS_0'].astype(int), mesh['WEIGHTS_0'].astype(float))
    return float(pv[:, 1].min())


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    data = json.loads(POSE_PATH.read_text())
    glb = vq.Glb(vq.ROOT / 'assets/runtime/models' / f"{vq.RECIPE['form']['slug']}.glb")
    sk = vq.Skeleton(glb)
    mesh = glb.mesh('LOD0')
    for name, spec in data['poses'].items():
        y0 = lowest(sk, mesh, spec)
        if y0 >= -ALLOWED_PENETRATION_U:
            print(f'{name}: lowest {y0:.3f} U, unchanged')
            continue
        raise_by = -ALLOWED_PENETRATION_U - y0
        spec['rootOffsetU'][1] = round(spec['rootOffsetU'][1] + raise_by + 0.02, 3)
        print(f'{name}: lowest {y0:.3f} U -> raised root by {raise_by + 0.02:.3f} U, now {lowest(sk, mesh, spec):.3f} U')
    if args.write:
        POSE_PATH.write_text(json.dumps(data, indent=2) + '\n')
        print('poses updated')


if __name__ == '__main__':
    main()
