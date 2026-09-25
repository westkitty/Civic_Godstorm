"""Reimport each delivered Q GLB into a fresh Blender scene and compare with the file's own
accessors (master Section 18.4: reimport the exact delivered GLB).

    .toolchain/py/bin/python tools/models/reimport_check.py [--revision c001]

Checks per model: the three LOD meshes return with the same triangle counts; the skinned models
return an armature whose bones equal the GLB skin joints; every reimported vertex has
normalized weights; and the bounds agree with the POSITION accessor bounds. It writes reimport.json
and a Cycles render of the reimported LOD0 (reimport-views.png) beside the other inspection files.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path

import bpy
import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import validate_q as vq  # noqa: E402

ROOT = vq.ROOT


def check(model_id: str, slug: str, out: Path) -> dict:
    path = ROOT / 'assets/runtime/models' / f'{slug}.glb'
    glb = vq.Glb(path)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=str(path))
    meshes = {o.data.name: o for o in bpy.context.scene.objects if o.type == 'MESH'}
    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    result = {'id': model_id, 'glb': str(path.relative_to(ROOT)), 'lods': {}}
    ok = True
    for level in range(3):
        m = glb.mesh(f'LOD{level}')
        obj = next((o for name, o in meshes.items() if name.endswith(f'LOD{level}')), None)
        if obj is None:
            result['lods'][f'LOD{level}'] = {'present': False}
            ok = False
            continue
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        co = np.array([obj.matrix_world @ v.co for v in obj.data.vertices])
        co_model = np.stack([co[:, 0], co[:, 2], -co[:, 1]], axis=1)
        pos = m['POSITION']
        bounds_error = float(np.abs(np.concatenate([co_model.min(axis=0) - pos.min(axis=0), co_model.max(axis=0) - pos.max(axis=0)])).max())
        entry = {'present': True, 'trianglesFile': int(len(m['indices'])), 'trianglesReimported': int(tris), 'boundsErrorU': round(bounds_error, 6)}
        if arms:
            sums = np.zeros(len(obj.data.vertices))
            for v in obj.data.vertices:
                sums[v.index] = sum(g.weight for g in v.groups)
            entry['weightSumMaxError'] = round(float(np.abs(sums - 1).max()), 6)
            entry['vertexGroups'] = len(obj.vertex_groups)
            ok &= entry['weightSumMaxError'] < 1e-3
        ok &= entry['trianglesFile'] == entry['trianglesReimported'] and bounds_error < 1e-3
        result['lods'][f'LOD{level}'] = entry
    skins = glb.doc.get('skins', [])
    if skins:
        joints = sorted(glb.doc['nodes'][j]['name'] for j in skins[0]['joints'])
        bones = sorted(b.name for b in arms[0].data.bones) if arms else []
        result['skeleton'] = {'jointsInFile': len(joints), 'bonesReimported': len(bones), 'namesEqual': joints == bones}
        ok &= joints == bones
    result['pass'] = bool(ok)
    out.mkdir(parents=True, exist_ok=True)
    (out / 'reimport.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--revision', default=vq.RECIPE['revision'])
    args = ap.parse_args()
    models = [(mid, spec['slug']) for mid, spec in vq.RECIPE['modules'].items()] + [(vq.RECIPE['form']['id'], vq.RECIPE['form']['slug'])]
    failed = False
    for mid, slug in models:
        out = ROOT / 'artifacts/inspection' / mid / args.revision
        r = check(mid, slug, out)
        failed |= not r['pass']
        print(f"{'PASS' if r['pass'] else 'FAIL'}  {mid}  reimport {json.dumps(r.get('skeleton', 'rigid'))} {[(k, v.get('trianglesReimported')) for k, v in r['lods'].items()]}")
        # A reimport render in a separate process (render_views resets the scene itself).
        subprocess.run([sys.executable, str(ROOT / 'tools/models/render_views.py'), str(ROOT / 'assets/runtime/models' / f'{slug}.glb'),
                        str(out / 'reimport-views.png'), '--size', '512'], check=True, capture_output=True)
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
