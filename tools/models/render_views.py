"""Reimport a delivered GLB in Blender and render orthographic diagnostic views with Cycles (CPU).

    .toolchain/py/bin/python tools/models/render_views.py <glb> <out.png> [--size 512] [--lod LOD0]

Views: front (+Z camera), left (-X camera), rear (-Z camera), top (+Y camera, +Z up in image),
and a 3/4 view. The image is a reimport of the exact delivered file, not the authoring scene.
"""
from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

VIEWS = {
    # name: camera direction in model space (from target toward camera), up vector (model)
    'front': ((0, 0, 1), (0, 1, 0)),
    'left': ((-1, 0, 0), (0, 1, 0)),
    'rear': ((0, 0, -1), (0, 1, 0)),
    'top': ((0, 1, 0), (0, 0, 1)),
    'three_quarter': ((-0.62, 0.45, 0.64), (0, 1, 0)),
}


def model_to_blender(v):
    return Vector((v[0], -v[2], v[1]))


def setup(glb: str, lod: str) -> tuple[Vector, float]:
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    for o in meshes:
        keep = o.name.endswith(lod) or o.data.name.endswith(lod)
        o.hide_render = not keep
    shown = [o for o in meshes if not o.hide_render]
    if not shown:
        raise SystemExit(f'no mesh named *{lod} in {glb}')
    pts = []
    for o in shown:
        for v in o.data.vertices:
            pts.append(o.matrix_world @ v.co)
    arr = np.array([[p.x, p.y, p.z] for p in pts])
    lo, hi = arr.min(axis=0), arr.max(axis=0)
    centre = Vector(((lo + hi) / 2).tolist())
    radius = float(np.linalg.norm(hi - lo)) / 2
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs['Color'].default_value = (0.216, 0.216, 0.216, 1)
    world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55
    bpy.context.scene.world = world
    sun = bpy.data.lights.new('key', 'SUN')
    sun.energy = 3.2
    so = bpy.data.objects.new('key', sun)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(-35))
    bpy.context.scene.collection.objects.link(so)
    fill = bpy.data.lights.new('fill', 'SUN')
    fill.energy = 0.9
    fo = bpy.data.objects.new('fill', fill)
    fo.rotation_euler = (math.radians(-60), 0, math.radians(150))
    bpy.context.scene.collection.objects.link(fo)
    return centre, radius


def render(out: str, size: int, lod: str, glb: str) -> None:
    centre, radius = setup(glb, lod)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.device = 'CPU'
    scene.cycles.samples = 24
    scene.cycles.use_denoising = False
    scene.render.resolution_x = scene.render.resolution_y = size
    scene.render.film_transparent = False
    scene.view_settings.view_transform = 'Standard'
    cam_data = bpy.data.cameras.new('cam')
    cam_data.type = 'ORTHO'
    cam_data.ortho_scale = radius * 2.1
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    scene.camera = cam
    tiles = []
    tmp = Path(out).with_suffix('')
    for name, (direction, up) in VIEWS.items():
        d = model_to_blender(np.array(direction, float) / np.linalg.norm(direction))
        u = model_to_blender(up)
        cam.location = centre + d * radius * 4
        # camera looks down its local -Z with local +Y up: columns are (right, up, back)
        back = d.normalized()
        right = u.cross(back).normalized()
        upv = back.cross(right).normalized()
        from mathutils import Matrix
        basis = Matrix((right, upv, back)).transposed()
        cam.rotation_mode = 'QUATERNION'
        cam.rotation_quaternion = basis.to_quaternion()
        cam_data.clip_end = radius * 10
        scene.render.filepath = f'{tmp}_{name}.png'
        bpy.ops.render.render(write_still=True)
        tiles.append(scene.render.filepath)
    from PIL import Image
    ims = [Image.open(t) for t in tiles]
    sheet = Image.new('RGB', (size * len(ims), size))
    for i, im in enumerate(ims):
        sheet.paste(im.convert('RGB'), (i * size, 0))
    sheet.save(out)
    for t in tiles:
        Path(t).unlink()


if __name__ == '__main__':
    argv = sys.argv[1:]
    p = argparse.ArgumentParser()
    p.add_argument('glb')
    p.add_argument('out')
    p.add_argument('--size', type=int, default=512)
    p.add_argument('--lod', default='LOD0')
    a = p.parse_args(argv)
    render(a.out, a.size, a.lod, a.glb)
