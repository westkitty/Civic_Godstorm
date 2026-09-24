"""Stage 2 of the Q conversion: signed distance volumes -> skinned, LOD'd, vertex-coloured GLB2.

    .toolchain/py/bin/python tools/models/build_models.py --volumes artifacts/local/q

Uses Blender as a Python module (bpy) for mesh reduction, armature, skin, .blend authoring
files and the Khronos glTF exporter. Writes, per MODEL-* ID (master Section 17.3):
    assets/runtime/models/<slug>.glb
    assets/runtime/models/<slug>.meta.json
    assets/authoring/<slug>.blend
    assets/authoring/<slug>.recipe.json
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np
from skimage import measure

sys.path.insert(0, str(Path(__file__).parent))
import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402
from volumes import Grid, rotation, sample  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RECIPE_PATH = ROOT / 'tools/models/q_recipe.json'
RECIPE = json.loads(RECIPE_PATH.read_text())


# ---------------------------------------------------------------- coordinates
def to_blender(p: np.ndarray) -> np.ndarray:
    """Model (glTF) space (+Y up, +Z forward) -> Blender (+Z up); the exporter's +Y-up
    conversion maps it back exactly."""
    p = np.asarray(p, float)
    return np.stack([p[..., 0], -p[..., 2], p[..., 1]], axis=-1)


def hex_to_linear(hexstr: str) -> np.ndarray:
    c = np.array([int(hexstr[i:i + 2], 16) / 255 for i in (1, 3, 5)])
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ---------------------------------------------------------------- geometry
def surface(sdf: np.ndarray, grid: Grid) -> tuple[np.ndarray, np.ndarray]:
    verts, faces, _, _ = measure.marching_cubes(sdf, level=0.0, spacing=(grid.step,) * 3, allow_degenerate=False)
    verts = verts + grid.lo
    # keep the largest connected shell (removes isolated specks below one voxel)
    n = len(verts)
    parent = np.arange(n)

    def find(i: int) -> int:
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i
    for a, b, c in faces:
        for x, y in ((a, b), (b, c)):
            rx, ry = find(x), find(y)
            if rx != ry:
                parent[rx] = ry
    roots = np.array([find(i) for i in range(n)])
    keep_root = np.bincount(roots).argmax()
    keep_v = roots == keep_root
    remap = -np.ones(n, int)
    remap[keep_v] = np.arange(keep_v.sum())
    faces = faces[keep_v[faces[:, 0]]]
    # marching_cubes returns faces wound so normals point toward increasing values (outside
    # of an SDF); flip to counter-clockwise-outward for glTF.
    return verts[keep_v], remap[faces][:, ::-1]


def make_mesh_object(name: str, verts: np.ndarray, faces: np.ndarray) -> bpy.types.Object:
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(to_blender(verts).tolist(), [], faces.tolist())
    mesh.validate()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    for poly in mesh.polygons:
        poly.use_smooth = True
    return obj


def decimate_to(obj: bpy.types.Object, target_tris: int) -> None:
    """Collapse-decimate to the triangle budget. Mirror symmetry is preserved when the collapse
    can reach the budget with it; thin shells that cannot are finished without symmetry."""
    for symmetric in (True, False, False):
        tris = sum(len(p.vertices) - 2 for p in obj.data.polygons)
        if tris <= target_tris:
            return
        mod = obj.modifiers.new('decimate', 'DECIMATE')
        mod.decimate_type = 'COLLAPSE'
        mod.ratio = target_tris / tris * 0.985
        mod.use_symmetry = symmetric
        mod.symmetry_axis = 'X'
        mod.use_collapse_triangulate = True
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)
        bpy.ops.object.modifier_apply(modifier=mod.name)


def triangulate(obj: bpy.types.Object) -> None:
    mod = obj.modifiers.new('tri', 'TRIANGULATE')
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=mod.name)


def mesh_arrays(obj: bpy.types.Object) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Vertices and normals back in model space, plus triangle indices."""
    me = obj.data
    v = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('co', v)
    v = v.reshape(-1, 3)
    nrm = np.empty(len(me.vertices) * 3)
    me.vertices.foreach_get('normal', nrm)
    nrm = nrm.reshape(-1, 3)
    f = np.array([list(p.vertices) for p in me.polygons], int)
    back = lambda b: np.stack([b[:, 0], b[:, 2], -b[:, 1]], axis=1)  # noqa: E731
    return back(v), back(nrm), f


# ---------------------------------------------------------------- colour
def vertex_colours(verts: np.ndarray, normals: np.ndarray, spots: list) -> np.ndarray:
    pal = RECIPE['palette']
    teal = hex_to_linear(pal['biologicalTeal'])
    shade = teal * 0.62 + hex_to_linear(pal['charcoal']) * 0.38
    accent = hex_to_linear(pal['organAccent'])
    under = np.clip(-normals[:, 1], 0, 1)[:, None]
    col = teal * (1 - 0.55 * under) + shade * 0.55 * under
    for x, y, z, r in spots:
        d = np.linalg.norm(verts - np.array([x, y, z]), axis=1)
        w = np.clip((r - d) / (0.25 * r), 0, 1)[:, None]
        col = col * (1 - w) + accent * w
    return np.concatenate([col, np.ones((len(col), 1))], axis=1)


def set_colours(obj: bpy.types.Object, rgba_linear: np.ndarray) -> None:
    attr = obj.data.color_attributes.new('Col', 'FLOAT_COLOR', 'POINT')
    attr.data.foreach_set('color', rgba_linear.astype(np.float32).ravel())
    obj.data.color_attributes.active_color = attr


def body_material(name: str, roughness: float) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    bsdf = nodes['Principled BSDF']
    bsdf.inputs['Metallic'].default_value = 0.0
    bsdf.inputs['Roughness'].default_value = roughness
    attr = nodes.new('ShaderNodeVertexColor')
    attr.layer_name = 'Col'
    mat.node_tree.links.new(attr.outputs['Color'], bsdf.inputs['Base Color'])
    return mat


# ---------------------------------------------------------------- skeleton and skin
def seg_distance(p: np.ndarray, a: np.ndarray, b: np.ndarray) -> np.ndarray:
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-9), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def skin_weights(verts: np.ndarray, bones: list[dict], membership: np.ndarray, groups: list[list[int]],
                 power: float = 4.0, max_influences: int = 4) -> np.ndarray:
    """Weights (V, B): inverse-distance to bone segments inside each region, blended by soft
    region membership (V, R). Normalized to 1, at most `max_influences` non-zero."""
    V, B = len(verts), len(bones)
    w = np.zeros((V, B))
    for r, bone_ids in enumerate(groups):
        if not bone_ids:
            continue
        d = np.stack([seg_distance(verts, np.array(bones[i]['head']), np.array(bones[i]['tail'])) for i in bone_ids], axis=1)
        inv = 1.0 / np.maximum(d, 0.05) ** power
        inv /= inv.sum(axis=1, keepdims=True)
        w[:, bone_ids] += inv * membership[:, r:r + 1]
    order = np.argsort(-w, axis=1)
    cut = np.zeros_like(w, bool)
    np.put_along_axis(cut, order[:, :max_influences], True, axis=1)
    w = np.where(cut, w, 0.0)
    w[w < 1e-3] = 0.0
    w /= w.sum(axis=1, keepdims=True)
    return w


def make_armature(name: str, bones: list[dict]) -> bpy.types.Object:
    arm = bpy.data.armatures.new(name)
    obj = bpy.data.objects.new(name, arm)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.select_all(action='DESELECT')
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    made = {}
    for b in bones:
        eb = arm.edit_bones.new(b['name'])
        eb.head = Vector(to_blender(np.array(b['head'])).tolist())
        eb.tail = Vector(to_blender(np.array(b['tail'])).tolist())
        eb.roll = 0.0
        if b['parent']:
            eb.parent = made[b['parent']]
        made[b['name']] = eb
    bpy.ops.object.mode_set(mode='OBJECT')
    return obj


def bind(mesh_obj: bpy.types.Object, arm_obj: bpy.types.Object, bones: list[dict], weights: np.ndarray) -> None:
    groups = [mesh_obj.vertex_groups.new(name=b['name']) for b in bones]
    for bi, g in enumerate(groups):
        idx = np.nonzero(weights[:, bi])[0]
        for vi in idx:
            g.add([int(vi)], float(weights[vi, bi]), 'REPLACE')
    mod = mesh_obj.modifiers.new('armature', 'ARMATURE')
    mod.object = arm_obj
    # Not parented: glTF requires skinned mesh nodes at the scene root (validator
    # NODE_SKINNED_MESH_NON_ROOT); the skin alone carries the joint transforms.


# ---------------------------------------------------------------- GLB facts
def glb_json(path: Path) -> tuple[dict, bytes]:
    data = path.read_bytes()
    magic, version, _ = struct.unpack_from('<III', data, 0)
    assert magic == 0x46546C67 and version == 2, 'not a glTF 2 binary'
    jlen, _ = struct.unpack_from('<II', data, 12)
    doc = json.loads(data[20:20 + jlen])
    blen = struct.unpack_from('<I', data, 20 + jlen)[0]
    return doc, data[28 + jlen:28 + jlen + blen]


def export_facts(path: Path) -> dict:
    doc, _ = glb_json(path)
    meshes = {}
    for m in doc.get('meshes', []):
        tris = 0
        for prim in m['primitives']:
            tris += doc['accessors'][prim['indices']]['count'] // 3
        attrs = sorted(m['primitives'][0]['attributes'])
        pos = doc['accessors'][m['primitives'][0]['attributes']['POSITION']]
        meshes[m['name']] = {'triangles': tris, 'attributes': attrs, 'min': pos['min'], 'max': pos['max'],
                             'vertices': pos['count'], 'materials': sorted({p.get('material', -1) for p in m['primitives']})}
    skins = [{'name': s.get('name'), 'joints': [doc['nodes'][j]['name'] for j in s['joints']],
              'inverseBindMatrices': doc['accessors'][s['inverseBindMatrices']]['count'] if 'inverseBindMatrices' in s else 0}
             for s in doc.get('skins', [])]
    return {
        'asset': doc.get('asset', {}),
        'nodes': [n.get('name') for n in doc.get('nodes', [])],
        'meshes': meshes,
        'skins': skins,
        'materials': [{'name': m.get('name'), 'metallic': m.get('pbrMetallicRoughness', {}).get('metallicFactor', 1.0),
                       'roughness': m.get('pbrMetallicRoughness', {}).get('roughnessFactor', 1.0),
                       'alphaMode': m.get('alphaMode', 'OPAQUE'), 'doubleSided': m.get('doubleSided', False)} for m in doc.get('materials', [])],
        'textures': len(doc.get('textures', [])),
        'images': len(doc.get('images', [])),
        'animations': len(doc.get('animations', [])),
        'extensionsUsed': doc.get('extensionsUsed', []),
    }


# ---------------------------------------------------------------- model assembly
def reset_scene() -> None:
    bpy.ops.wm.read_factory_settings(use_empty=True)


def build_one(model_id: str, slug: str, surface_parts: tuple[np.ndarray, np.ndarray], bones: list[dict],
              membership_fn, groups: list[list[int]], spots: list, budget: list[int], roughness: float,
              extra_meta: dict, out_models: Path, out_authoring: Path) -> dict:
    reset_scene()
    verts, faces = surface_parts
    base = make_mesh_object(f'{slug}_base', verts, faces)
    lods = []
    for level, target in enumerate(budget):
        obj = base.copy()
        obj.data = base.data.copy()
        obj.name = f'LOD{level}'
        obj.data.name = f'{slug}_LOD{level}'
        bpy.context.scene.collection.objects.link(obj)
        decimate_to(obj, target)
        triangulate(obj)
        lods.append(obj)
    bpy.data.objects.remove(base)
    arm = make_armature('skeleton', bones) if bones else None
    mat = body_material(f'{slug}_body', roughness)
    facts_lod = []
    for obj in lods:
        v, n, f = mesh_arrays(obj)
        set_colours(obj, vertex_colours(v, n, spots))
        obj.data.materials.append(mat)
        if arm is not None:
            w = skin_weights(v, bones, membership_fn(v), groups)
            bind(obj, arm, bones, w)
            facts_lod.append({'lod': obj.name, 'weightSumMaxError': float(np.abs(w.sum(axis=1) - 1).max()),
                              'maxInfluences': int((w > 0).sum(axis=1).max()), 'nan': bool(np.isnan(w).any())})
        else:
            facts_lod.append({'lod': obj.name, 'rigid': True})
    out_models.mkdir(parents=True, exist_ok=True)
    out_authoring.mkdir(parents=True, exist_ok=True)
    glb = out_models / f'{slug}.glb'
    bpy.ops.export_scene.gltf(
        filepath=str(glb), export_format='GLB', export_yup=True, export_apply=False,
        export_skins=bool(bones), export_animations=False, export_morph=False,
        export_vertex_color='ACTIVE', export_all_vertex_colors=False,
        export_texcoords=False, export_normals=True, export_tangents=False,
        export_materials='EXPORT', export_cameras=False, export_lights=False,
        export_extras=False, use_selection=False,
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(out_authoring / f'{slug}.blend'), compress=True)
    facts = export_facts(glb)
    meta = {
        'id': model_id,
        'slug': slug,
        'glb': str(glb.relative_to(ROOT)),
        'sha256': hashlib.sha256(glb.read_bytes()).hexdigest(),
        'bytes': glb.stat().st_size,
        'tool': {'blender': bpy.app.version_string, 'exporter': 'io_scene_gltf2 (bundled)', 'python': sys.version.split()[0]},
        'recipe': {'path': 'tools/models/q_recipe.json', 'revision': RECIPE['revision'],
                   'sha256': hashlib.sha256(RECIPE_PATH.read_bytes()).hexdigest()},
        'triangleBudget': budget,
        'skinChecks': facts_lod,
        'export': facts,
        **extra_meta,
    }
    (out_models / f'{slug}.meta.json').write_text(json.dumps(meta, indent=2) + '\n')
    return meta


def load_volumes(vol_dir: Path) -> tuple[dict, dict, dict]:
    arrays = np.load(vol_dir / 'volumes.npz')
    grids_raw = json.loads((vol_dir / 'grids.json').read_text())
    grids = {k: Grid(np.array(g['lo']), g['step'], tuple(g['shape'])) for k, g in grids_raw.items()}
    regions = dict(np.load(vol_dir / 'regions.npz'))
    return {k.split('__')[0]: arrays[k] for k in arrays.files}, grids, regions


def form_skeleton() -> tuple[list[dict], dict[str, list[int]]]:
    form = RECIPE['form']
    modules = RECIPE['modules']
    bones: list[dict] = [{'name': 'root', 'parent': None, 'head': [0, 0, 0], 'tail': [0, 0, 2.0]}]
    by_instance: dict[str, list[int]] = {}
    xf = {}
    for inst in form['instances']:
        R = rotation(inst['euler'])
        s = np.array(inst['scale'])
        pos = np.array(inst['position'])
        xf[inst['name']] = lambda p, R=R, s=s, pos=pos: (pos + R @ (s * np.asarray(p, float))).round(4).tolist()
    parents = {'torso': 'root', 'head': 'neck', 'tail': 'torso_hips',
               'leg_fl': 'torso_chest', 'leg_fr': 'torso_chest', 'leg_hl': 'torso_hips', 'leg_hr': 'torso_hips'}
    for inst in form['instances']:
        name = inst['name']
        spec = modules[inst['module']]
        ids = []
        for b in spec['skeleton']:
            bname = b['name'] if name in ('torso', 'head', 'tail') else f"{name}_{b['name'].replace('leg_', '')}"
            parent = b['parent']
            if parent is None:
                parent_name = parents.get(name)
            else:
                parent_name = parent if name in ('torso', 'head', 'tail') else f"{name}_{parent.replace('leg_', '')}"
            ids.append(len(bones))
            bones.append({'name': bname, 'parent': parent_name, 'head': xf[name](b['head']), 'tail': xf[name](b['tail'])})
            if name == 'torso' and b['name'] == 'torso_chest':
                chest_tail = bones[-1]['tail']
                head_root = xf['head']([0, 0, 0])
                ids.append(len(bones))
                bones.append({'name': 'neck', 'parent': 'torso_chest', 'head': chest_tail, 'tail': head_root})
        by_instance[name] = ids
    by_instance['eyes'] = [i for i, b in enumerate(bones) if b['name'] == 'head']
    # parents referenced before definition are resolved by ordering: reorder so parents precede children
    order, placed = [], set()
    while len(order) < len(bones):
        for b in bones:
            if b['name'] not in placed and (b['parent'] is None or b['parent'] in placed):
                order.append(b)
                placed.add(b['name'])
    index = {b['name']: i for i, b in enumerate(order)}
    old = {i: b['name'] for i, b in enumerate(bones)}
    by_instance = {k: [index[old[i]] for i in v] for k, v in by_instance.items()}
    return order, by_instance


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--volumes', default=str(ROOT / 'artifacts/local/q'))
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    vols, grids, regions = load_volumes(Path(args.volumes))
    out_models = ROOT / 'assets/runtime/models'
    out_authoring = ROOT / 'assets/authoring'
    metas = {}
    for mid, spec in RECIPE['modules'].items():
        if args.only and args.only != mid:
            continue
        bones = spec['skeleton']
        membership = lambda v: np.ones((len(v), 1))  # noqa: E731
        metas[mid] = build_one(
            mid, spec['slug'], surface(vols[mid], grids[mid]), bones, membership, [list(range(len(bones)))],
            spec.get('accentSpots', []), spec['triangleBudget'], 0.75,
            {'source': spec['source'], 'rowDimensionsU': spec['rowDimensionsU'], 'box': spec['box'],
             'junctionOrigin': spec['junctionOrigin'], 'skeleton': bones}, out_models, out_authoring)
        write_recipe(spec['slug'], mid, spec)
        print(mid, {k: v['triangles'] for k, v in metas[mid]['export']['meshes'].items()})
    if not args.only or args.only == 'form':
        form = RECIPE['form']
        bones, by_instance = form_skeleton()
        names = [inst['name'] for inst in form['instances']]
        grid = grids['form']

        def membership(v: np.ndarray) -> np.ndarray:
            d = np.stack([sample(regions[n], grid, v) for n in names], axis=1)
            m = np.exp(-(d - d.min(axis=1, keepdims=True)) / 0.45)
            return m / m.sum(axis=1, keepdims=True)
        groups = [by_instance[n] for n in names]
        metas['form'] = build_one(
            form['id'], form['slug'], surface(vols['form'], grid), bones, membership, groups,
            form['accentSpots'], form['triangleBudget'], 0.75,
            {'source': form['source'], 'modules': sorted({i['module'] for i in form['instances']}), 'box': form['box'],
             'size': form['size'], 'footprintMask': form['footprintMask'], 'skeleton': bones}, out_models, out_authoring)
        write_recipe(form['slug'], form['id'], form)
        print('form', {k: v['triangles'] for k, v in metas['form']['export']['meshes'].items()}, 'joints', len(bones))


def write_recipe(slug: str, model_id: str, spec: dict) -> None:
    out = ROOT / 'assets/authoring' / f'{slug}.recipe.json'
    doc = {'id': model_id, 'recipe': RECIPE['recipe'], 'revision': RECIPE['revision'], 'contract': RECIPE['contract'],
           'stages': ['tools/models/build_volumes.py', 'tools/models/build_models.py'], 'parameters': spec,
           'palette': RECIPE['palette']}
    out.write_text(json.dumps(doc, indent=2) + '\n')


if __name__ == '__main__':
    main()
