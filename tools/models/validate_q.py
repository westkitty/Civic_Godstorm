"""Stage 3 of the Q conversion: measure delivered GLBs against the approved references.

    .toolchain/py/bin/python tools/models/validate_q.py [--out artifacts/inspection] [--revision c001]

Reads each GLB directly (no Blender), so the measurement is of the exact delivered bytes.
Per master Section 18.3 it reports, per orthographic view, silhouette IoU after the declared
alignment (the recipe's view-to-box mapping, whose per-axis stretch is reported alongside),
landmark error as a fraction of body length, triangle budgets per LOD, joint count, skin
weight sums, and material/texture facts. Non-projectable reference panels are listed, not
scored. Exit status is nonzero when a required criterion fails.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import struct
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

sys.path.insert(0, str(Path(__file__).parent))
from silhouettes import sheet_masks  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RECIPE = json.loads((ROOT / 'tools/models/q_recipe.json').read_text())
SOURCES = json.loads((ROOT / 'assets/provenance.json').read_text())['records']
SOURCE_PATH = {r['id']: r['path'] for r in SOURCES}
COMPONENTS = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}
WIDTH = {'SCALAR': 1, 'VEC2': 2, 'VEC3': 3, 'VEC4': 4, 'MAT4': 16}
IOU_TARGET = 0.90
LANDMARK_TARGET = 0.03


# ------------------------------------------------------------------ GLB reading
class Glb:
    def __init__(self, path: Path):
        data = path.read_bytes()
        magic, version, _ = struct.unpack_from('<III', data, 0)
        if magic != 0x46546C67 or version != 2:
            raise ValueError(f'{path}: not glTF 2.0 binary')
        jlen, _ = struct.unpack_from('<II', data, 12)
        self.doc = json.loads(data[20:20 + jlen])
        blen = struct.unpack_from('<I', data, 20 + jlen)[0]
        self.bin = data[28 + jlen:28 + jlen + blen]

    def accessor(self, index: int) -> np.ndarray:
        acc = self.doc['accessors'][index]
        view = self.doc['bufferViews'][acc['bufferView']]
        dtype = COMPONENTS[acc['componentType']]
        width = WIDTH[acc['type']]
        start = view.get('byteOffset', 0) + acc.get('byteOffset', 0)
        stride = view.get('byteStride', 0)
        count = acc['count']
        item = np.dtype(dtype).itemsize * width
        if stride and stride != item:
            raw = np.frombuffer(self.bin, np.uint8, count * stride, start).reshape(count, stride)[:, :item]
            arr = np.frombuffer(raw.tobytes(), dtype).reshape(count, width)
        else:
            arr = np.frombuffer(self.bin, dtype, count * width, start).reshape(count, width)
        if acc.get('normalized'):
            arr = arr.astype(np.float32) / np.iinfo(dtype).max
        return arr

    def mesh(self, name_suffix: str) -> dict:
        for m in self.doc['meshes']:
            if m['name'].endswith(name_suffix):
                prim = m['primitives'][0]
                out = {k: self.accessor(v) for k, v in prim['attributes'].items()}
                out['indices'] = self.accessor(prim['indices']).reshape(-1, 3)
                out['name'] = m['name']
                return out
        raise KeyError(name_suffix)


# ------------------------------------------------------------------ projection
def project(verts: np.ndarray, view: dict, box: dict, shape: tuple[int, int]) -> np.ndarray:
    """Model points -> reference pixel coordinates (u, v) using the declared mapping."""
    h, w = shape
    coords = {'x': verts[:, 0], 'y': verts[:, 1], 'z': verts[:, 2]}

    def frac(spec: str) -> np.ndarray:
        lo, hi = box[spec[1]]
        f = (coords[spec[1]] - lo) / (hi - lo)
        return f if spec[0] == '+' else 1 - f
    return np.stack([frac(view['u']) * w, frac(view['v']) * h], axis=1)


def rasterize(uv: np.ndarray, tris: np.ndarray, shape: tuple[int, int], pad: int) -> np.ndarray:
    h, w = shape
    img = Image.new('1', (w + 2 * pad, h + 2 * pad), 0)
    draw = ImageDraw.Draw(img)
    for t in tris:
        pts = [(float(uv[i, 0]) + pad, float(uv[i, 1]) + pad) for i in t]
        draw.polygon(pts, fill=1)
    return np.asarray(img, bool)


def view_iou(verts: np.ndarray, tris: np.ndarray, ref: np.ndarray, view: dict, box: dict) -> dict:
    pad = 64
    model = rasterize(project(verts, view, box, ref.shape), tris, ref.shape, pad)
    refp = np.pad(ref, pad)
    inter = (model & refp).sum()
    union = (model | refp).sum()
    return {'iou': float(inter / union), 'modelPixels': int(model.sum()), 'referencePixels': int(refp.sum()),
            'overlay': (model, refp)}


def declared_stretch(view: dict, box: dict, ref_shape: tuple[int, int]) -> float:
    """Per-axis stretch of the declared mapping: ratio of model units per pixel along u vs v,
    minus one (0 means the reference was not stretched)."""
    h, w = ref_shape
    su = (box[view['u'][1]][1] - box[view['u'][1]][0]) / w
    sv = (box[view['v'][1]][1] - box[view['v'][1]][0]) / h
    return float(su / sv - 1)


def landmarks(mask: np.ndarray) -> dict[str, np.ndarray]:
    """Mass landmarks in normalized image coordinates: the silhouette centroid and the centroids of
    its four bounding-box quadrants (robust to single-pixel extremes on flat edges)."""
    ys, xs = np.nonzero(mask)
    h, w = mask.shape
    pts = np.stack([xs / w, ys / h], axis=1)
    out = {'centroid': pts.mean(axis=0)}
    cx, cy = (xs.min() + xs.max()) / 2 / w, (ys.min() + ys.max()) / 2 / h
    for name, sel in {'upperLeft': (pts[:, 0] < cx) & (pts[:, 1] < cy), 'upperRight': (pts[:, 0] >= cx) & (pts[:, 1] < cy),
                      'lowerLeft': (pts[:, 0] < cx) & (pts[:, 1] >= cy), 'lowerRight': (pts[:, 0] >= cx) & (pts[:, 1] >= cy)}.items():
        out[name] = pts[sel].mean(axis=0) if sel.any() else np.array([np.nan, np.nan])
    return out


def landmark_error(model: np.ndarray, ref: np.ndarray, pad: int) -> dict:
    """Largest landmark displacement as a fraction of the reference silhouette's longest side."""
    ref_c = ref[pad:-pad, pad:-pad]
    mod_c = model[pad:-pad, pad:-pad]
    if not mod_c.any():
        return {'max': 1.0}
    h, w = ref_c.shape
    scale = np.array([w, h]) / max(w, h)
    lm_m, lm_r = landmarks(mod_c), landmarks(ref_c)
    errs = {}
    for k in lm_r:
        if np.isnan(lm_r[k]).any() or np.isnan(lm_m[k]).any():
            errs[k] = 1.0
        else:
            errs[k] = float(np.linalg.norm((lm_m[k] - lm_r[k]) * scale))
    errs['max'] = max(errs.values())
    return errs


def save_overlay(path: Path, overlays: list[tuple[str, tuple[np.ndarray, np.ndarray]]]) -> None:
    tiles = []
    for name, (model, ref) in overlays:
        img = np.zeros(model.shape + (3,), np.uint8) + 40
        img[ref & model] = (200, 200, 200)
        img[ref & ~model] = (230, 80, 80)      # reference not covered (missing volume)
        img[model & ~ref] = (70, 140, 240)     # model outside reference (excess volume)
        tile = Image.fromarray(img)
        tile.thumbnail((512, 512))
        canvas = Image.new('RGB', (512, 540), (20, 20, 20))
        canvas.paste(tile, ((512 - tile.width) // 2, 28 + (512 - tile.height) // 2))
        ImageDraw.Draw(canvas).text((8, 6), name, fill=(240, 240, 240))
        tiles.append(canvas)
    sheet = Image.new('RGB', (512 * len(tiles), 540))
    for i, t in enumerate(tiles):
        sheet.paste(t, (512 * i, 0))
    sheet.save(path)


# ------------------------------------------------------------------ skinning and poses
POSES = json.loads((ROOT / 'src/render/god/qPoses.json').read_text())


def quat_to_mat(q) -> np.ndarray:
    x, y, z, w = q
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def axis_mat(axis: str, degrees: float) -> np.ndarray:
    a = np.radians(degrees)
    c, s_ = np.cos(a), np.sin(a)
    return {'x': np.array([[1, 0, 0], [0, c, -s_], [0, s_, c]]),
            'y': np.array([[c, 0, s_], [0, 1, 0], [-s_, 0, c]]),
            'z': np.array([[c, -s_, 0], [s_, c, 0], [0, 0, 1]])}[axis]


class Skeleton:
    """Node hierarchy of the delivered GLB with the same model-space pose rule as qRig.ts."""

    def __init__(self, glb: Glb):
        doc = glb.doc
        self.nodes = doc['nodes']
        self.parent = {}
        for i, n in enumerate(self.nodes):
            for c in n.get('children', []):
                self.parent[c] = i
        self.rest_R, self.rest_T, self.S = [], [], []
        for n in self.nodes:
            if 'matrix' in n:
                m = np.array(n['matrix']).reshape(4, 4).T
                self.rest_R.append(m[:3, :3].copy()); self.rest_T.append(m[:3, 3].copy()); self.S.append(np.ones(3))
            else:
                self.rest_R.append(quat_to_mat(n.get('rotation', [0, 0, 0, 1])))
                self.rest_T.append(np.array(n.get('translation', [0, 0, 0]), float))
                self.S.append(np.array(n.get('scale', [1, 1, 1]), float))
        roots = [i for i in range(len(self.nodes)) if i not in self.parent]
        self.order = []
        stack = list(reversed(roots))
        while stack:
            i = stack.pop()
            self.order.append(i)
            stack.extend(reversed(self.nodes[i].get('children', [])))
        skin = doc['skins'][0]
        self.joints = skin['joints']
        self.ibm = glb.accessor(skin['inverseBindMatrices']).reshape(-1, 4, 4).transpose(0, 2, 1)
        self.name_to_node = {self.nodes[j]['name']: j for j in self.joints}

    def world(self, R, T) -> list[np.ndarray]:
        W = [None] * len(self.nodes)
        for i in self.order:
            local = np.eye(4)
            local[:3, :3] = R[i] * self.S[i]
            local[:3, 3] = T[i]
            p = self.parent.get(i)
            W[i] = local if p is None else W[p] @ local
        return W

    def pose(self, spec: dict | None) -> list[np.ndarray]:
        R = [r.copy() for r in self.rest_R]
        T = [t.copy() for t in self.rest_T]
        if spec:
            for i in self.order:
                name = self.nodes[i].get('name')
                rots = spec['rotations'].get(name)
                if not rots or i not in self.joints:
                    continue
                W = self.world(R, T)
                D = np.eye(3)
                for axis, deg in rots:
                    D = axis_mat(axis, deg) @ D
                Rw = W[i][:3, :3] / np.linalg.norm(W[i][:3, :3], axis=0)
                p = self.parent.get(i)
                Rp = np.eye(3) if p is None else W[p][:3, :3] / np.linalg.norm(W[p][:3, :3], axis=0)
                R[i] = Rp.T @ (D @ Rw)
            root = self.name_to_node.get('root')
            if root is not None and spec.get('rootOffsetU'):
                W = self.world(R, T)
                p = self.parent.get(root)
                Rp = np.eye(3) if p is None else W[p][:3, :3] / np.linalg.norm(W[p][:3, :3], axis=0)
                T[root] = T[root] + Rp.T @ np.array(spec['rootOffsetU'], float)
        return self.world(R, T)

    def skin(self, W: list[np.ndarray], verts: np.ndarray, joints: np.ndarray, weights: np.ndarray) -> np.ndarray:
        J = np.stack([W[j] @ self.ibm[k] for k, j in enumerate(self.joints)])  # (J,4,4)
        vh = np.concatenate([verts, np.ones((len(verts), 1))], axis=1)
        out = np.zeros((len(verts), 4))
        for c in range(joints.shape[1]):
            M = J[joints[:, c]]
            out += weights[:, c:c + 1] * np.einsum('nij,nj->ni', M, vh)
        return out[:, :3]


def signed_volume(v: np.ndarray, f: np.ndarray) -> float:
    a, b, c = v[f[:, 0]], v[f[:, 1]], v[f[:, 2]]
    return float(np.einsum('ij,ij->i', a, np.cross(b, c)).sum() / 6.0)


def pose_checks(glb: Glb) -> dict:
    sk = Skeleton(glb)
    m = glb.mesh('LOD0')
    v = m['POSITION'].astype(float)
    f = m['indices'].astype(int)
    j = m['JOINTS_0'].astype(int)
    w = m['WEIGHTS_0'].astype(float)
    rest = sk.skin(sk.pose(None), v, j, w)
    bind_error = float(np.abs(rest - v).max())
    vol0 = signed_volume(rest, f)
    edges = np.concatenate([f[:, [0, 1]], f[:, [1, 2]], f[:, [2, 0]]])
    len0 = np.linalg.norm(rest[edges[:, 0]] - rest[edges[:, 1]], axis=1)
    out = {'bindPoseReproductionErrorU': round(bind_error, 5), 'restVolumeU3': round(vol0, 2), 'poses': {}}
    for name, spec in POSES['poses'].items():
        pv = sk.skin(sk.pose(spec), v, j, w)
        vol = signed_volume(pv, f)
        ln = np.linalg.norm(pv[edges[:, 0]] - pv[edges[:, 1]], axis=1)
        ratio = ln / np.maximum(len0, 1e-6)
        moved = float(np.linalg.norm(pv - rest, axis=1).max())
        entry = {'volumeRatio': round(vol / vol0, 4), 'edgeStretchP99': round(float(np.percentile(ratio, 99)), 3),
                 'edgeCompressP1': round(float(np.percentile(ratio, 1)), 3), 'maxDisplacementU': round(moved, 3),
                 'minY': round(float(pv[:, 1].min()), 3), 'finite': bool(np.isfinite(pv).all())}
        entry['pass'] = bool(entry['finite'] and 0.9 <= entry['volumeRatio'] <= 1.1 and entry['edgeStretchP99'] <= 2.0
                             and entry['edgeCompressP1'] >= 0.35 and moved > 0.2 and entry['minY'] >= -0.3)
        out['poses'][name] = entry
    out['pass'] = bool(bind_error < 1e-3 and all(p['pass'] for p in out['poses'].values()))
    return out


# ------------------------------------------------------------------ structural checks
def structure(glb: Glb, budget: list[int], joint_limit: int, rigid: bool) -> dict:
    doc = glb.doc
    checks = {}
    lods = {}
    for level in range(3):
        m = glb.mesh(f'LOD{level}')
        tris = len(m['indices'])
        lods[f'LOD{level}'] = {'triangles': tris, 'vertices': len(m['POSITION']), 'budget': budget[level],
                                'withinBudget': tris <= budget[level]}
        if not rigid:
            w = m['WEIGHTS_0'].astype(np.float64)
            j = m['JOINTS_0']
            lods[f'LOD{level}']['weightSumMaxError'] = float(np.abs(w.sum(axis=1) - 1).max())
            lods[f'LOD{level}']['nanWeights'] = bool(np.isnan(w).any())
            lods[f'LOD{level}']['jointsReferenced'] = int(len(np.unique(j[w > 0])))
        lods[f'LOD{level}']['hasVertexColor'] = 'COLOR_0' in m
    checks['lods'] = lods
    checks['lodBudgets'] = all(v['withinBudget'] for v in lods.values())
    skins = doc.get('skins', [])
    checks['skins'] = len(skins)
    if not rigid:
        joints = skins[0]['joints'] if skins else []
        ibm = glb.accessor(skins[0]['inverseBindMatrices']).reshape(-1, 4, 4) if skins else np.zeros((0, 4, 4))
        dets = [float(np.linalg.det(m.T[:3, :3])) for m in ibm]
        checks['joints'] = len(joints)
        checks['jointLimit'] = joint_limit
        checks['withinJointLimit'] = len(joints) <= joint_limit
        checks['inverseBindFinite'] = bool(np.isfinite(ibm).all())
        checks['inverseBindPositiveDeterminant'] = bool(all(d > 0 for d in dets))
        checks['weightsNormalized'] = all(v['weightSumMaxError'] <= 1e-4 for v in lods.values())
    mats = doc.get('materials', [])
    checks['materials'] = len(mats)
    checks['materialsWithinLimit'] = len(mats) <= 2
    checks['textures'] = len(doc.get('textures', [])) + len(doc.get('images', []))
    checks['animations'] = len(doc.get('animations', []))
    checks['opaqueNonMetal'] = all(m.get('alphaMode', 'OPAQUE') == 'OPAQUE' and m.get('pbrMetallicRoughness', {}).get('metallicFactor', 1) == 0 for m in mats)
    return checks


# ------------------------------------------------------------------ per model
def validate(model_id: str, spec: dict, views: dict[str, dict], box: dict, budget: list[int], joint_limit: int,
             rigid: bool, out_dir: Path) -> dict:
    slug = spec['slug']
    glb_path = ROOT / 'assets/runtime/models' / f'{slug}.glb'
    glb = Glb(glb_path)
    lod0 = glb.mesh('LOD0')
    verts = lod0['POSITION'].astype(np.float64)
    tris = lod0['indices']
    result = {'id': model_id, 'glb': str(glb_path.relative_to(ROOT)), 'sha256': hashlib.sha256(glb_path.read_bytes()).hexdigest(),
              'bounds': {'min': verts.min(axis=0).round(4).tolist(), 'max': verts.max(axis=0).round(4).tolist()},
              'views': {}, 'nonProjectable': {}}
    overlays = []
    body_len = max(b[1] - b[0] for b in box.values())
    for name, v in views.items():
        if 'nonProjectable' in v:
            result['nonProjectable'][name] = v['nonProjectable']
            continue
        sheet = v.get('sheet', spec['source'])
        grid = v.get('grid', spec.get('grid'))
        ref = sheet_masks(str(ROOT / SOURCE_PATH[sheet]), grid[0], grid[1])[v['panel']]['mask']
        m = view_iou(verts, tris, ref, v, box)
        lm = landmark_error(m['overlay'][0], m['overlay'][1], 64)
        result['views'][name] = {'sheet': sheet, 'panel': v['panel'], 'iou': round(m['iou'], 4),
                                 'declaredStretch': round(declared_stretch(v, box, ref.shape), 4),
                                 'landmarkErrorMaxFraction': round(lm['max'], 4),
                                 'passes': m['iou'] >= IOU_TARGET and lm['max'] <= LANDMARK_TARGET}
        overlays.append((f'{name}  IoU {m["iou"]:.3f}', m['overlay']))
    result['structure'] = structure(glb, budget, joint_limit, rigid)
    if model_id == RECIPE['form']['id']:
        result['deformation'] = pose_checks(glb)
        anchors_path = ROOT / 'artifacts/local/q/identity-anchors.json'
        result['identityAnchors'] = json.loads(anchors_path.read_text()) if anchors_path.exists() else {'pass': False, 'error': 'not measured'}
    result['silhouettePass'] = all(v['passes'] for v in result['views'].values())
    s = result['structure']
    result['structuralPass'] = bool(s['lodBudgets'] and s['materialsWithinLimit'] and s['textures'] == 0 and s['animations'] == 0
                                    and s['opaqueNonMetal'] and (rigid or (s['withinJointLimit'] and s['inverseBindFinite']
                                                                            and s['inverseBindPositiveDeterminant'] and s['weightsNormalized'])))
    if 'deformation' in result:
        result['structuralPass'] = bool(result['structuralPass'] and result['deformation']['pass'])
    if 'identityAnchors' in result:
        # an identity veto fails the model even when silhouette averages pass (Section 18.3)
        result['silhouettePass'] = bool(result['silhouettePass'] and result['identityAnchors'].get('pass'))
    out_dir.mkdir(parents=True, exist_ok=True)
    save_overlay(out_dir / 'silhouette-overlay.png', overlays)
    return result


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(ROOT / 'artifacts/inspection'))
    parser.add_argument('--revision', default=RECIPE['revision'])
    parser.add_argument('--only', default='')
    args = parser.parse_args()
    results = {}
    for mid, spec in RECIPE['modules'].items():
        if args.only and args.only != mid:
            continue
        box = {k: tuple(v) for k, v in spec['box'].items()}
        results[mid] = validate(mid, spec, spec['views'], box, spec['triangleBudget'], 64, not spec['skeleton'],
                                Path(args.out) / mid / args.revision)
    form = RECIPE['form']
    if not args.only or args.only == 'form':
        box = {k: tuple(v) for k, v in form['box'].items()}
        views = dict(form['hullViews'])
        for name, why in form['nonProjectable'].items():
            views[name] = {'nonProjectable': why}
        results[form['id']] = validate(form['id'], form, views, box, form['triangleBudget'], form['jointLimit'], False,
                                       Path(args.out) / form['id'] / args.revision)
    failed = False
    for mid, r in results.items():
        ious = ', '.join(f"{k} {v['iou']:.3f}/{v['landmarkErrorMaxFraction']:.3f}" for k, v in r['views'].items())
        print(f"{'PASS' if r['silhouettePass'] and r['structuralPass'] else 'FAIL'}  {mid}  silhouette[{ious}]  structure={'ok' if r['structuralPass'] else 'FAIL'}")
        if 'deformation' in r:
            d = r['deformation']
            print('   deformation', 'bind error', d['bindPoseReproductionErrorU'], {k: (v['volumeRatio'], v['edgeStretchP99'], v['edgeCompressP1'], v['minY'], v['pass']) for k, v in d['poses'].items()})
        failed |= not (r['silhouettePass'] and r['structuralPass'])
        (Path(args.out) / mid / args.revision).mkdir(parents=True, exist_ok=True)
        (Path(args.out) / mid / args.revision / 'measurements.json').write_text(json.dumps(r, indent=2) + '\n')
    sys.exit(1 if failed else 0)


if __name__ == '__main__':
    main()
