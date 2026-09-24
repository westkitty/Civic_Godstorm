"""Reference-constrained implicit volumes (master Sections 18.1 and 18.3).

A module volume is a *slice loft*: along the module's long axis, every slice is a superellipse
whose extents come from the two approved orthographic views that contain that axis. Its
projection onto either lofting view is therefore that view's silhouette. The remaining
approved views then carve the volume (visual-hull intersection). The surface is rounded by
filtering the signed distance field, never by inventing anatomy.

All coordinates are model space: +X anatomical right, +Y up, +Z forward, units U.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
from scipy import ndimage

AXES = {'x': 0, 'y': 1, 'z': 2}


@dataclass
class Grid:
    lo: np.ndarray  # (3,) min corner, U
    step: float
    shape: tuple[int, int, int]

    @staticmethod
    def around(lo, hi, step: float, margin: float) -> 'Grid':
        lo = np.asarray(lo, float) - margin
        hi = np.asarray(hi, float) + margin
        shape = tuple(int(np.ceil((h - l) / step)) + 1 for l, h in zip(lo, hi))
        return Grid(lo, step, shape)  # type: ignore[arg-type]

    def axis(self, i: int) -> np.ndarray:
        return self.lo[i] + self.step * np.arange(self.shape[i])

    def points(self) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
        return np.meshgrid(self.axis(0), self.axis(1), self.axis(2), indexing='ij')


@dataclass
class View:
    """An approved orthographic panel: image u (right) and v (down) map to signed model axes,
    and the silhouette bounding box maps onto the declared model box (declared alignment)."""
    mask: np.ndarray
    u: str  # e.g. '+z'
    v: str  # e.g. '-y'
    _sdf: np.ndarray | None = None

    def pixel_sdf(self) -> np.ndarray:
        """Signed distance to the silhouette edge in pixels (negative inside), lightly smoothed
        so that sampling between pixels is continuous rather than stair-stepped."""
        if self._sdf is None:
            pad = 16
            m = np.pad(self.mask, pad)
            d = np.where(m, -(ndimage.distance_transform_edt(m) - 0.5), ndimage.distance_transform_edt(~m) - 0.5)
            self._sdf = ndimage.gaussian_filter(d, 1.2)[pad:-pad, pad:-pad].astype(np.float32)
        return self._sdf

    def prism_sdf(self, coords: dict[str, np.ndarray], box: dict[str, tuple[float, float]]) -> np.ndarray:
        """Approximate signed distance (U) to this view's silhouette prism."""
        h, w = self.mask.shape
        fu = self.frac(coords, box, 'u')
        fv = self.frac(coords, box, 'v')
        su = (box[self.u[1]][1] - box[self.u[1]][0]) / w
        sv = (box[self.v[1]][1] - box[self.v[1]][0]) / h
        pix = self.pixel_sdf()
        d = ndimage.map_coordinates(pix, [fv.ravel() * h - 0.5, fu.ravel() * w - 0.5], order=1, mode='nearest')
        # outside the image the nearest-edge value underestimates distance; add the overshoot
        over = np.maximum(np.maximum(-fu, fu - 1) * w, np.maximum(-fv, fv - 1) * h).ravel()
        d = np.where(over > 0, np.maximum(d, 0) + over, d)
        return (d * np.sqrt(su * sv)).reshape(fu.shape)

    def frac(self, coords: dict[str, np.ndarray], box: dict[str, tuple[float, float]], which: str) -> np.ndarray:
        spec = self.u if which == 'u' else self.v
        sign, ax = spec[0], spec[1]
        lo, hi = box[ax]
        f = (coords[ax] - lo) / (hi - lo)
        return f if sign == '+' else 1.0 - f

    def inside(self, coords: dict[str, np.ndarray], box: dict[str, tuple[float, float]]) -> np.ndarray:
        h, w = self.mask.shape
        fu = self.frac(coords, box, 'u')
        fv = self.frac(coords, box, 'v')
        ok = (fu >= 0) & (fu < 1) & (fv >= 0) & (fv < 1)
        iu = np.clip((fu * w).astype(int), 0, w - 1)
        iv = np.clip((fv * h).astype(int), 0, h - 1)
        return ok & self.mask[iv, iu]

    def extents_along(self, axis: str, t: np.ndarray, box: dict[str, tuple[float, float]]) -> tuple[np.ndarray, np.ndarray, np.ndarray, str]:
        """For model coordinate(s) t on `axis` (one of this view's axes), the model-space extent of
        the silhouette along the view's other axis. Returns (lo, hi, valid, other_axis)."""
        h, w = self.mask.shape
        along_u = self.u[1] == axis
        spec_t = self.u if along_u else self.v
        spec_o = self.v if along_u else self.u
        lo_t, hi_t = box[axis]
        ft = (t - lo_t) / (hi_t - lo_t)
        ft = ft if spec_t[0] == '+' else 1.0 - ft
        n_t = w if along_u else h
        idx = np.clip((ft * n_t).astype(int), 0, n_t - 1)
        valid = (ft >= 0) & (ft < 1)
        lines = self.mask[:, idx].T if along_u else self.mask[idx, :]  # (len(t), n_other)
        n_o = lines.shape[1]
        has = lines.any(axis=1)
        first = np.where(has, lines.argmax(axis=1), 0)
        last = np.where(has, n_o - 1 - lines[:, ::-1].argmax(axis=1), 0)
        o_ax = spec_o[1]
        lo_o, hi_o = box[o_ax]
        a = (first / n_o) if spec_o[0] == '+' else 1.0 - (last + 1) / n_o
        b = ((last + 1) / n_o) if spec_o[0] == '+' else 1.0 - first / n_o
        return lo_o + a * (hi_o - lo_o), lo_o + b * (hi_o - lo_o), valid & has, o_ax


def slice_loft(grid: Grid, box: dict[str, tuple[float, float]], long_axis: str,
               loft_a: View, loft_b: View, carve: list[View], exponent: float, carve_softness: float = 0.0) -> np.ndarray:
    """Signed-distance-like field (U, negative inside) of the superellipse slice loft, carved by
    the remaining views."""
    X, Y, Z = grid.points()
    coords = {'x': X, 'y': Y, 'z': Z}
    t_axis = grid.axis(AXES[long_axis])
    alo, ahi, aval, a_ax = loft_a.extents_along(long_axis, t_axis, box)
    blo, bhi, bval, b_ax = loft_b.extents_along(long_axis, t_axis, box)
    val = aval & bval
    # smooth the per-slice extents along the axis (removes pixel-row stair steps)
    def smooth(arr):
        filled = np.where(val, arr, np.nan)
        idx = np.arange(len(arr))
        good = ~np.isnan(filled)
        filled = np.interp(idx, idx[good], filled[good])
        return ndimage.gaussian_filter1d(filled, 1.5)
    alo, ahi, blo, bhi = smooth(alo), smooth(ahi), smooth(blo), smooth(bhi)
    shape = [1, 1, 1]
    shape[AXES[long_axis]] = -1
    r = lambda arr: arr.reshape(shape)  # noqa: E731
    ca, ra = r((alo + ahi) / 2), r(np.maximum((ahi - alo) / 2, 1e-3))
    cb, rb = r((blo + bhi) / 2), r(np.maximum((bhi - blo) / 2, 1e-3))
    F = (np.abs((coords[a_ax] - ca) / ra) ** exponent + np.abs((coords[b_ax] - cb) / rb) ** exponent) ** (1.0 / exponent)
    d = (F - 1.0) * np.minimum(ra, rb)
    # slices beyond the silhouette ends: distance past the end along the axis
    tv = t_axis[val]
    t = coords[long_axis]
    end = np.maximum(tv.min() - t, t - tv.max())
    d = np.maximum(d, end)
    for view in carve:
        c = view.prism_sdf(coords, box)
        # smooth intersection keeps carved edges rounded instead of planar creases
        d = -smooth_union(-d, -c, carve_softness) if carve_softness > 0 else np.maximum(d, c)
    return d.astype(np.float32)


def hull(grid: Grid, box: dict[str, tuple[float, float]], views: list[View]) -> np.ndarray:
    """Signed-distance-like field of the visual hull (intersection of view prisms)."""
    X, Y, Z = grid.points()
    coords = {'x': X, 'y': Y, 'z': Z}
    d = np.full(grid.shape, -1e3, np.float32)
    for view in views:
        d = np.maximum(d, view.prism_sdf(coords, box))
    return d.astype(np.float32)


def sdf_from_occupancy(occ: np.ndarray, step: float, smooth_voxels: float) -> np.ndarray:
    """Signed distance in U (negative inside), low-pass filtered to round the carved surface."""
    outside = ndimage.distance_transform_edt(~occ)
    inside = ndimage.distance_transform_edt(occ)
    sdf = np.where(occ, -(inside - 0.5) * step, (outside - 0.5) * step)
    if smooth_voxels > 0:
        sdf = ndimage.gaussian_filter(sdf, smooth_voxels)
    return sdf.astype(np.float32)


def sample(sdf: np.ndarray, grid: Grid, pts: np.ndarray, far: float = 1e3) -> np.ndarray:
    """Trilinear SDF lookup at model points (N,3); outside the grid returns a large distance."""
    idx = (pts - grid.lo) / grid.step
    out = ndimage.map_coordinates(sdf, idx.T, order=1, mode='constant', cval=far)
    return out


def smooth_union(a: np.ndarray, b: np.ndarray, k: float) -> np.ndarray:
    if k <= 0:
        return np.minimum(a, b)
    h = np.clip(0.5 + 0.5 * (b - a) / k, 0.0, 1.0)
    return (b * (1 - h) + a * h - k * h * (1 - h)).astype(np.float32)


def rotation(euler_deg) -> np.ndarray:
    """Rotation matrix from XYZ Euler angles in degrees (applied X, then Y, then Z)."""
    ax, ay, az = np.radians(euler_deg)
    cx, sx, cy, sy, cz, sz = np.cos(ax), np.sin(ax), np.cos(ay), np.sin(ay), np.cos(az), np.sin(az)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rz @ ry @ rx


def instance_sdf(module_sdf: np.ndarray, module_grid: Grid, target: Grid,
                 position, euler_deg, scale) -> np.ndarray:
    """Resample a module SDF into a target grid under position/rotation/(anisotropic) scale.
    The distance is rescaled by the smallest scale factor, a conservative Lipschitz bound."""
    X, Y, Z = target.points()
    pts = np.stack([X.ravel(), Y.ravel(), Z.ravel()], axis=1)
    R = rotation(euler_deg)
    s = np.asarray(scale, float)
    local = ((pts - np.asarray(position, float)) @ R) / s
    d = sample(module_sdf, module_grid, local) * s.min()
    return d.reshape(target.shape).astype(np.float32)
