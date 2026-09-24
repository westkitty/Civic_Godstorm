"""Fit the FORM-Q module placements to the approved form views (master Section 18.3: fit global
mass/proportions, then identity landmarks).

    .toolchain/py/bin/python tools/models/fit_form.py [--passes 4] [--write]

Deterministic coordinate descent over a small, named parameter set (leg stations, head and
tail carriage, torso mass). The objective is the mean silhouette IoU over the scored form
views at a coarse grid. Each parameter is bounded so the fit cannot invent anatomy: modules
only move, rotate and rescale within recorded limits. With --write the fitted placements and
the fit record replace the recipe's form instances.
"""
from __future__ import annotations

import argparse
import copy
import json
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).parent))
import build_volumes as bv  # noqa: E402
from volumes import Grid  # noqa: E402

RECIPE_PATH = bv.ROOT / 'tools/models/q_recipe.json'

# name: (instances, field, component, step, lower, upper, mirror-x)
PARAMS = {
    'front_leg_z': (['leg_fl', 'leg_fr'], 'position', 2, 0.6, 3.0, 11.0),
    'hind_leg_z': (['leg_hl', 'leg_hr'], 'position', 2, 0.6, -11.0, -2.0),
    'front_leg_x': (['leg_fl', 'leg_fr'], 'position', 0, 0.3, 2.8, 5.6),
    'hind_leg_x': (['leg_hl', 'leg_hr'], 'position', 0, 0.3, 2.8, 5.6),
    'leg_top_y': (['leg_fl', 'leg_fr', 'leg_hl', 'leg_hr'], 'position', 1, 0.4, 9.0, 14.5),
    'leg_girth': (['leg_fl', 'leg_fr', 'leg_hl', 'leg_hr'], 'scale', 0, 0.05, 0.75, 1.15),
    'head_y': (['head'], 'position', 1, 0.5, 13.0, 19.0),
    'head_z': (['head'], 'position', 2, 0.5, 7.0, 13.0),
    'head_pitch': (['head'], 'euler', 0, 3.0, -10.0, 25.0),
    'head_scale': (['head'], 'scale', 0, 0.04, 0.55, 1.05),
    'tail_y': (['tail'], 'position', 1, 0.5, 11.0, 17.0),
    'tail_pitch': (['tail'], 'euler', 0, 2.0, -14.0, 10.0),
    'tail_length': (['tail'], 'scale', 2, 0.03, 0.38, 0.62),
    'tail_girth': (['tail'], 'scale', 0, 0.04, 0.45, 1.05),
    'torso_y': (['torso'], 'position', 1, 0.4, 12.0, 16.0),
    'torso_z': (['torso'], 'position', 2, 0.5, -3.0, 6.0),
    'torso_pitch': (['torso'], 'euler', 0, 2.0, -14.0, 4.0),
    'torso_width': (['torso'], 'scale', 0, 0.03, 0.55, 0.85),
    'torso_height': (['torso'], 'scale', 1, 0.05, 1.0, 1.5),
    'torso_length': (['torso'], 'scale', 2, 0.03, 0.62, 0.9),
    'head_length': (['head'], 'scale', 2, 0.04, 0.6, 1.0),
}
# The eye band is pinned in the head frame across the forehead (identity placement inspected
# against FORM-Q panels 0 and 3); it is not an area-fitting parameter.
# Identity bounds (Section 18.3 anchors): the head must stay forward of the torso and the torso
# may not advance over the neck; these limits keep the fit from trading anatomy for area.
PARAMS['torso_z'] = (['torso'], 'position', 2, 0.5, -2.0, 1.5)
PARAMS['tail_length'] = (['tail'], 'scale', 2, 0.04, 0.38, 0.85)
PARAMS['leg_girth'] = (['leg_fl', 'leg_fr', 'leg_hl', 'leg_hr'], 'scale', 0, 0.05, 0.75, 1.3)
PARAMS['head_z'] = (['head'], 'position', 2, 0.5, 9.5, 13.0)


def get(form: dict, name: str) -> float:
    insts, field, comp, *_ = PARAMS[name]
    inst = next(i for i in form['instances'] if i['name'] == insts[0])
    return abs(inst[field][comp]) if field == 'position' and comp == 0 else inst[field][comp]


def set_(form: dict, name: str, value: float) -> None:
    insts, field, comp, *_ = PARAMS[name]
    for inst in form['instances']:
        if inst['name'] in insts:
            if field == 'position' and comp == 0:
                inst[field][comp] = float(np.sign(inst[field][comp]) * value)
            else:
                inst[field][comp] = float(value)
            if field == 'scale' and comp == 0:
                # girth: keep the cross-section proportional (x and z for legs, x and y for tail)
                inst[field][2 if inst['module'] == 'CG-D-GOD-LOCO-PILLAR' else 1] = float(value) if inst['module'] != 'CG-D-GOD-TORSO-Q' else inst[field][1]
            if inst['module'] == 'CG-D-GOD-LOCO-PILLAR':
                # the foot stays on the ground: vertical scale follows the leg top height
                inst['scale'][1] = float((inst['position'][1] + 0.15) / 12.0)


def objective(modules, form, grid, hull_sdf) -> tuple[float, dict]:
    sdf, _, per_instance = bv.form_volume(modules, form, grid.step, hull_sdf, grid)
    ious = bv.projected_iou(sdf, grid, form)
    anchors = bv.identity_anchors(form, per_instance, grid, sdf)
    # identity anchors are constraints: violations are penalised so the descent moves toward
    # feasibility, and a final result that still violates them is rejected below
    penalty = sum(max(0.0, 0.3 - c) for c in anchors['eyeClearanceU']) * 0.2
    penalty += 0.05 * (not anchors['snoutExposed']) + 0.05 * (not anchors['tailTipExposed'])
    penalty += 0.05 * abs(anchors['groundContacts'] - 4)
    ious['anchorsPass'] = anchors['pass']
    return float(np.mean([v for k, v in ious.items() if k != 'anchorsPass']) - penalty), ious


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument('--passes', type=int, default=4)
    ap.add_argument('--step', type=float, default=0.2)
    ap.add_argument('--write', action='store_true')
    args = ap.parse_args()
    recipe = json.loads(RECIPE_PATH.read_text())
    form = copy.deepcopy(recipe['form'])
    for inst in form['instances']:
        inst.pop('fit', None)
    modules = bv.build_modules()
    box = bv.box_of(form)
    grid = Grid.around([box['x'][0], box['y'][0], box['z'][0]], [box['x'][1], box['y'][1], box['z'][1]], args.step, 1.0)
    hull_sdf = bv.form_hull(grid, form)
    for name in PARAMS:  # establish the leg ground-contact invariant before scoring
        set_(form, name, float(np.clip(get(form, name), PARAMS[name][4], PARAMS[name][5])))
    best, ious = objective(modules, form, grid, hull_sdf)
    start = (best, ious)
    print(f'start {best:.4f} {ious}')
    steps = {k: v[3] for k, v in PARAMS.items()}
    evaluations = 1
    for p in range(args.passes):
        improved = False
        for name, (_, _, _, _, lo, hi) in PARAMS.items():
            cur = get(form, name)
            for direction in (1, -1):
                trial_v = float(np.clip(cur + direction * steps[name], lo, hi))
                if trial_v == cur:
                    continue
                trial = copy.deepcopy(form)
                set_(trial, name, trial_v)
                score, tious = objective(modules, trial, grid, hull_sdf)
                evaluations += 1
                if score > best + 1e-4 and (tious['anchorsPass'] or not ious.get('anchorsPass')):
                    best, ious, form, improved = score, tious, trial, True
                    print(f'  pass {p} {name}={trial_v:.3f} -> {best:.4f}')
                    break
        if not improved:
            steps = {k: v / 2 for k, v in steps.items()}
            print(f'pass {p}: no improvement, halving steps')
    print(f'final {best:.4f} {ious} after {evaluations} evaluations')
    if not ious.get('anchorsPass'):
        print('identity anchors FAIL after fit; recipe not written')
        sys.exit(1)
    ious = {k: v for k, v in ious.items() if k != 'anchorsPass'}
    if args.write:
        recipe['form']['instances'] = form['instances']
        recipe['form']['fit'] = {
            'tool': 'tools/models/fit_form.py', 'objective': 'mean projected silhouette IoU over scored form views',
            'gridStepU': args.step, 'passes': args.passes, 'evaluations': evaluations,
            'start': {'mean': round(start[0], 4), **{k: round(v, 4) for k, v in start[1].items()}},
            'final': {'mean': round(best, 4), **{k: round(v, 4) for k, v in ious.items()}},
            'parameters': {k: round(get(form, k), 4) for k in PARAMS},
        }
        RECIPE_PATH.write_text(json.dumps(recipe, indent=2) + '\n')
        print('recipe updated')


if __name__ == '__main__':
    main()
