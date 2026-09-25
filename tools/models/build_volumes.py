"""Stage 1 of the Q conversion: approved sheets -> module and form signed distance volumes.

Run with the local toolchain Python (numpy/scipy; no Blender needed):
    .toolchain/py/bin/python tools/models/build_volumes.py --out artifacts/local/q
Writes <out>/volumes.npz and <out>/regions.npz plus quick depth-shaded previews.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
from scipy import ndimage

sys.path.insert(0, str(Path(__file__).parent))
from silhouettes import sheet_masks  # noqa: E402
from volumes import AXES, Grid, View, hull, instance_sdf, rotation, slice_loft, smooth_union  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
RECIPE = json.loads((ROOT / 'tools/models/q_recipe.json').read_text())
SOURCE_PATH = {
    'CG-S-GOD-TORSO-Q': 'assets/source/god/cg_s_god_torso_q.png',
    'CG-S-GOD-LOCO-PILLAR': 'assets/source/god/cg_s_god_loco_pillar.png',
    'CG-S-GOD-FEED-BROWSE': 'assets/source/god/cg_s_god_feed_browse.png',
    'CG-S-GOD-SENSE-EYE-RING': 'assets/source/god/cg_s_god_sense_eye_ring.png',
    'CG-S-GOD-TAIL-BALANCE': 'assets/source/god/cg_s_god_tail_balance.png',
    'CG-S-GOD-FORM-Q': 'assets/source/god/cg_s_god_form_q.png',
    'CG-S-GOD-LIFE-Q': 'assets/source/god/cg_s_god_life_q.png',
}
_mask_cache: dict[tuple[str, int, int], list[dict]] = {}


def masks(source: str, grid: tuple[int, int]) -> list[dict]:
    key = (source, grid[0], grid[1])
    if key not in _mask_cache:
        _mask_cache[key] = sheet_masks(str(ROOT / SOURCE_PATH[source]), grid[0], grid[1])
    return _mask_cache[key]


def box_of(spec: dict) -> dict[str, tuple[float, float]]:
    return {k: (float(v[0]), float(v[1])) for k, v in spec['box'].items()}


def module_views(spec: dict) -> dict[str, View]:
    panels = masks(spec['source'], tuple(spec['grid']))
    return {name: View(panels[v['panel']]['mask'], v['u'], v['v']) for name, v in spec['views'].items()}


def module_step(spec: dict) -> float:
    dims = [b[1] - b[0] for b in box_of(spec).values()]
    return max(dims) / 150.0


def build_loft_module(spec: dict) -> tuple[np.ndarray, Grid]:
    box = box_of(spec)
    step = module_step(spec)
    grid = Grid.around([box['x'][0], box['y'][0], box['z'][0]], [box['x'][1], box['y'][1], box['z'][1]], step, 4 * step)
    views = module_views(spec)
    for name, other in spec.get('loftUnion', {}).items():
        # The two approved panels of one projection axis disagree in width; loft from their union
        # (the other panel resampled onto the same declared box and mirrored across the body plane).
        a, b = views[name], views[other]
        from PIL import Image
        h, w = a.mask.shape
        rb = np.asarray(Image.fromarray(b.mask.astype(np.uint8) * 255).resize((w, h), Image.NEAREST)) > 127
        views[name] = View(a.mask | rb[:, ::-1], a.u, a.v)
    d = slice_loft(grid, box, spec['longAxis'], views[spec['loft'][0]], views[spec['loft'][1]],
                   [views[name] for name in spec['carve']], spec['exponent'], spec.get('carveSoftnessU', 0.0))
    return ndimage.gaussian_filter(d, 1.0).astype(np.float32), grid


def build_band_module(spec: dict) -> tuple[np.ndarray, Grid]:
    """Eye band: the approved top view gives the plan shape; height is the row's 2 U; four
    recessed closed-lid eyes are placed on the outer face at the recorded angles."""
    box = box_of(spec)
    step = module_step(spec) * 0.6
    grid = Grid.around([box['x'][0], box['y'][0], box['z'][0]], [box['x'][1], box['y'][1], box['z'][1]], step, 6 * step)
    top = module_views(spec)['top']
    X, Y, Z = grid.points()
    plan = top.prism_sdf({'x': X, 'y': np.zeros_like(Y), 'z': Z}, box)
    slab = np.abs(Y - (box['y'][0] + box['y'][1]) / 2) - (box['y'][1] - box['y'][0]) / 2
    # rounded band edges: soft intersection of plan prism and height slab
    k = 0.25
    sdf = np.sqrt(np.maximum(plan + k, 0) ** 2 + np.maximum(slab + k, 0) ** 2) + np.minimum(np.maximum(plan, slab) + k, 0) - k
    # Eye centres: outer boundary of the plan along each recorded angle from the plan centre.
    eyes = spec['eyes']
    cz = (box['z'][0] + box['z'][1]) / 2
    for ang in eyes['anglesDeg']:
        a = np.radians(ang)
        direction = np.array([np.sin(a), 0.0, np.cos(a)])
        r = 0.0
        for rr in np.linspace(0, 6, 600):
            p = np.array([0, 0, cz]) + rr * direction
            inside = top.inside({'x': np.array([p[0]]), 'y': np.array([0.0]), 'z': np.array([p[2]])}, box)[0]
            if inside:
                r = rr
        centre = np.array([0, 0, cz]) + (r - 0.05) * direction
        tangent = np.array([np.cos(a), 0.0, -np.sin(a)])
        rel = np.stack([X - centre[0], Y - centre[1], Z - centre[2]], axis=-1)
        du = rel @ tangent
        dn = rel @ direction
        dv = rel[..., 1]
        L, H = eyes['lengthU'] / 2, eyes['heightU'] / 2
        # socket: carve an ellipsoid recess into the outer face
        socket = np.sqrt((du / (L * 1.18)) ** 2 + (dv / (H * 1.35)) ** 2 + (dn / 0.32) ** 2) - 1.0
        sdf = np.maximum(sdf, -socket * 0.3)
        # closed lid: a low ellipsoid dome sitting in the socket
        lid = (np.sqrt((du / L) ** 2 + (dv / H) ** 2 + ((dn + 0.1) / 0.24) ** 2) - 1.0) * 0.24
        # lid seam: a thin horizontal groove across the lid
        seam = np.maximum(np.abs(dv) - 0.035, np.sqrt((du / L) ** 2 + ((dn - 0.1) / 0.2) ** 2) - 1.0) * 0.2
        sdf = np.minimum(sdf, np.maximum(lid, -seam))
    return sdf.astype(np.float32), grid


def build_modules() -> dict[str, tuple[np.ndarray, Grid]]:
    out = {}
    for mid, spec in RECIPE['modules'].items():
        out[mid] = build_band_module(spec) if spec.get('construction') == 'band' else build_loft_module(spec)
    return out


def compose_instances(form: dict) -> list[dict]:
    """Expands instances whose placement is declared relative to another instance (the eye band
    is placed in the head's local frame so it always sits on the brow)."""
    by_name = {i['name']: i for i in form['instances']}
    out = []
    for inst in form['instances']:
        rel = inst.get('relativeTo')
        if not rel:
            out.append(inst)
            continue
        parent = by_name[rel]
        Rp = rotation(parent['euler'])
        sp = np.asarray(parent['scale'], float)
        pos = np.asarray(parent['position'], float) + Rp @ (sp * np.asarray(inst['position'], float))
        euler = (np.asarray(parent['euler'], float) + np.asarray(inst['euler'], float)).tolist()
        scale = (sp * np.asarray(inst['scale'], float)).tolist()
        out.append({**inst, 'position': pos.tolist(), 'euler': euler, 'scale': scale})
    return out


def smooth_max(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    return -smooth_union(-a, -b, k)


def form_hull(grid: Grid, form: dict) -> np.ndarray:
    box = box_of(form)
    views = [View(masks(v['sheet'], tuple(v['grid']))[v['panel']]['mask'], v['u'], v['v']) for v in form['hullViews'].values()]
    return hull(grid, box, views) - form['hullDilationU']


def form_volume(modules: dict[str, tuple[np.ndarray, Grid]], form: dict, step: float, hull_sdf: np.ndarray | None = None,
                grid: Grid | None = None) -> tuple[np.ndarray, Grid, dict[str, np.ndarray]]:
    box = box_of(form)
    if grid is None:
        grid = Grid.around([box['x'][0], box['y'][0], box['z'][0]], [box['x'][1], box['y'][1], box['z'][1]], step, 1.0)
    per_instance = {}
    for inst in compose_instances(form):
        sdf_m, grid_m = modules[inst['module']]
        per_instance[inst['name']] = instance_sdf(sdf_m, grid_m, grid, inst['position'], inst['euler'], inst['scale'])
    names = list(per_instance)
    union = per_instance[names[0]]
    for name in names[1:]:
        k = form['eyeBlendU'] if name == 'eyes' else form['blendU']
        union = smooth_union(union, per_instance[name], k)
    if hull_sdf is None:
        hull_sdf = form_hull(grid, form)
    fitted = smooth_max(union, hull_sdf, form['hullClipSoftnessU']) if form.get('hullClip', True) else union
    # nothing below the ground plane
    Y = grid.axis(1).reshape(1, -1, 1)
    fitted = np.maximum(fitted, -(Y - 0.0))
    fitted = ndimage.gaussian_filter(fitted, 0.8).astype(np.float32)
    return fitted, grid, per_instance


def identity_anchors(form: dict, per_instance: dict[str, np.ndarray], grid: Grid, fitted: np.ndarray) -> dict:
    """Section 18.3 identity anchors for family Q, measured on the assembled volume: four exposed
    closed-lid eyes, an exposed snout and brow, an exposed tail tip, and four separate feet in
    ground contact. Returns counts and a pass flag; any failure is an identity veto."""
    from volumes import sample
    insts = {i['name']: i for i in compose_instances(form)}

    def world(name: str, local) -> np.ndarray:
        inst = insts[name]
        return np.asarray(inst['position'], float) + rotation(inst['euler']) @ (np.asarray(inst['scale'], float) * np.asarray(local, float))

    def others(name: str, pts: np.ndarray) -> np.ndarray:
        d = np.full(len(pts), 1e3)
        for other, sdf in per_instance.items():
            if other != name:
                d = np.minimum(d, sample(sdf, grid, pts))
        return d
    eyes_spec = RECIPE['modules']['CG-D-GOD-SENSE-EYE-RING']
    band_box = box_of(eyes_spec)
    top = module_views(eyes_spec)['top']
    cz = (band_box['z'][0] + band_box['z'][1]) / 2
    eye_pts = []
    for ang in eyes_spec['eyes']['anglesDeg']:
        a = np.radians(ang)
        direction = np.array([np.sin(a), 0.0, np.cos(a)])
        r = 0.0
        for rr in np.linspace(0, 6, 600):
            p = np.array([0, 0, cz]) + rr * direction
            if top.inside({'x': np.array([p[0]]), 'y': np.array([0.0]), 'z': np.array([p[2]])}, band_box)[0]:
                r = rr
        eye_pts.append(world('eyes', np.array([0, 0, cz]) + (r + 0.05) * direction))
    eye_pts = np.array(eye_pts)
    eye_clear = others('eyes', eye_pts)
    snout = world('head', [0, -0.5, 12.6])
    brow = world('head', [0, 2.0, 6.0])
    tail_tip = world('tail', [0, 0, -23.0])
    occ = fitted <= 0
    iy = int(round((1.8 - grid.lo[1]) / grid.step))
    from scipy import ndimage as ndi
    _, feet = ndi.label(occ[:, iy, :])
    _, bodies = ndi.label(occ)
    result = {
        'eyesExposed': int((eye_clear > 0.02).sum()),
        'eyeClearanceU': [round(float(c), 3) for c in eye_clear],
        'snoutExposed': bool(others('head', snout[None])[0] > 0),
        'browExposed': bool(others('head', brow[None])[0] > -0.2),
        'tailTipExposed': bool(others('tail', tail_tip[None])[0] > 0),
        'groundContacts': int(feet),
        'connectedBodies': int(bodies),
    }
    result['pass'] = bool(result['connectedBodies'] == 1 and result['eyesExposed'] == 4 and result['snoutExposed'] and result['tailTipExposed'] and result['groundContacts'] == 4)
    return result


def build_form(modules: dict[str, tuple[np.ndarray, Grid]]) -> tuple[np.ndarray, Grid, dict[str, np.ndarray]]:
    return form_volume(modules, RECIPE['form'], RECIPE['form']['gridStepU'])


def projected_iou(sdf: np.ndarray, grid: Grid, form: dict) -> dict[str, float]:
    """Silhouette IoU of the volume against each form reference view, by projecting occupancy
    along the view's depth axis and resampling at the reference pixel centres."""
    box = box_of(form)
    occ = sdf <= 0
    out = {}
    for name, v in form['hullViews'].items():
        ref = masks(v['sheet'], tuple(v['grid']))[v['panel']]['mask']
        h, w = ref.shape
        au, av = v['u'][1], v['v'][1]
        depth = ({'x', 'y', 'z'} - {au, av}).pop()
        proj = occ.any(axis=AXES[depth])  # remaining axes in x,y,z order
        rem = [a for a in 'xyz' if a != depth]
        fu = (np.arange(w) + 0.5) / w
        fv = (np.arange(h) + 0.5) / h
        cu = box[au][0] + (fu if v['u'][0] == '+' else 1 - fu) * (box[au][1] - box[au][0])
        cv = box[av][0] + (fv if v['v'][0] == '+' else 1 - fv) * (box[av][1] - box[av][0])
        iu = np.clip(np.round((cu - grid.lo[AXES[au]]) / grid.step).astype(int), 0, grid.shape[AXES[au]] - 1)
        iv = np.clip(np.round((cv - grid.lo[AXES[av]]) / grid.step).astype(int), 0, grid.shape[AXES[av]] - 1)
        if rem.index(au) == 0:
            img = proj[np.ix_(iu, iv)].T
        else:
            img = proj[np.ix_(iv, iu)]
        out[name] = float((img & ref).sum() / max((img | ref).sum(), 1))
    return out


def preview(sdf: np.ndarray, grid: Grid, path: Path, title: str) -> None:
    from PIL import Image
    occ = sdf <= 0
    views = []
    # front (+Z camera): project along -z; left (-X camera); rear; top (+Y camera)
    for axis, flip, transpose_uv in [(2, True, None), (0, False, None), (2, False, None), (1, True, None)]:
        o = occ if not flip else np.flip(occ, axis=axis)
        hit = o.any(axis=axis)
        depth = np.where(hit, o.argmax(axis=axis), 0).astype(float)
        gx = np.gradient(depth, axis=0)
        gy = np.gradient(depth, axis=1)
        shade = np.clip(0.75 - 0.08 * gx - 0.05 * gy, 0.15, 1.0)
        img = np.where(hit, shade * 220, 60).astype(np.uint8)
        if axis == 2:  # (x, y) -> image (row=-y, col=x); rear mirrors x
            img = np.flip(img.T, 0)
            if not flip:
                img = np.flip(img, 1)
        elif axis == 0:  # (y, z) -> row=-y, col=z
            img = np.flip(img, 0)
        else:  # top: (x, z) -> row=-z, col=-x
            img = np.flip(np.flip(img.T, 0), 1)
        views.append(Image.fromarray(img).resize((256, int(256 * img.shape[0] / img.shape[1])) if img.shape[1] >= img.shape[0] else (int(256 * img.shape[1] / img.shape[0]), 256)))
    canvas = Image.new('L', (1024, 256), 30)
    for i, v in enumerate(views):
        canvas.paste(v, (i * 256, 0))
    canvas.save(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument('--out', default=str(ROOT / 'artifacts/local/q'))
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    modules = build_modules()
    for mid, (sdf, grid) in modules.items():
        preview(sdf, grid, out / f'{mid}_preview.png', mid)
        print(mid, grid.shape, f'step={grid.step:.4f}', f'inside={(sdf <= 0).sum()}')
    fitted, grid, per_instance = build_form(modules)
    preview(fitted, grid, out / 'form_preview.png', 'form')
    print('form projected IoU', {k: round(v, 4) for k, v in projected_iou(fitted, grid, RECIPE['form']).items()})
    anchors = identity_anchors(RECIPE['form'], per_instance, grid, fitted)
    print('identity anchors', anchors)
    (out / 'identity-anchors.json').write_text(json.dumps(anchors, indent=1))
    arrays = {f'{mid}__sdf': sdf for mid, (sdf, _) in modules.items()}
    grids = {mid: {'lo': grid.lo.tolist(), 'step': grid.step, 'shape': list(grid.shape)} for mid, (_, grid) in modules.items()}
    arrays['form__sdf'] = fitted
    grids['form'] = {'lo': grid.lo.tolist(), 'step': grid.step, 'shape': list(grid.shape)}
    np.savez_compressed(out / 'volumes.npz', **arrays)
    np.savez_compressed(out / 'regions.npz', **{name: arr for name, arr in per_instance.items()})
    (out / 'grids.json').write_text(json.dumps(grids, indent=1))
    print('form', grid.shape, 'inside', int((fitted <= 0).sum()))


if __name__ == '__main__':
    main()
