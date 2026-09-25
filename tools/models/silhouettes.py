"""Reference-sheet silhouette extraction (master Section 18.3: normalize references).

Deterministic: fixed thresholds, no learned segmentation. Background is the opaque neutral gray
the profile requires; separators are straight neutral lines. Foreground is chromatic or dark
pixels. Output masks are per panel, cropped to the silhouette bounding box.
"""
from __future__ import annotations

import numpy as np
from PIL import Image
from scipy import ndimage


def load_rgb(path: str) -> np.ndarray:
    return np.asarray(Image.open(path).convert('RGB')).astype(np.int16)


def separators(img: np.ndarray, axis: int) -> list[int]:
    """Indices of full-length separator lines: rows (axis=0) or columns (axis=1) whose pixels are
    near-uniform and differ from the background median."""
    gray = img.mean(axis=2)
    bg = np.median(gray)
    line_mean = gray.mean(axis=1 - axis)
    line_std = gray.std(axis=1 - axis)
    hits = np.where((np.abs(line_mean - bg) > 12) & (line_std < 18))[0]
    # collapse runs to their centre
    out: list[int] = []
    for i in hits:
        if out and i - out[-1][-1] <= 3:
            out[-1].append(int(i))
        else:
            out.append([int(i)])
    return [int(round(sum(run) / len(run))) for run in out if 0.08 * gray.shape[axis] < run[0] < 0.92 * gray.shape[axis]]


def panel_bounds(img: np.ndarray, rows: int, cols: int) -> list[tuple[int, int, int, int]]:
    """(y0, y1, x0, x1) per panel in reading order. Uses detected separators when their count
    matches the declared grid, otherwise equal splits."""
    h, w = img.shape[:2]
    ys = separators(img, 0)
    xs = separators(img, 1)
    ys = ys if len(ys) == rows - 1 else [round(h * i / rows) for i in range(1, rows)]
    xs = xs if len(xs) == cols - 1 else [round(w * i / cols) for i in range(1, cols)]
    yb = [0, *ys, h]
    xb = [0, *xs, w]
    return [(yb[r] + 4, yb[r + 1] - 4, xb[c] + 4, xb[c + 1] - 4) for r in range(rows) for c in range(cols)]


def foreground(panel: np.ndarray) -> np.ndarray:
    # Background: the dominant neutral colour of the panel (the profile's uniform gray field).
    flat = panel.reshape(-1, 3)
    neutral = flat[(flat.max(axis=1) - flat.min(axis=1)) < 8]
    lum_hist = np.bincount(neutral.mean(axis=1).astype(int), minlength=256)
    bg_lum = int(lum_hist.argmax())
    bg = np.median(neutral[np.abs(neutral.mean(axis=1) - bg_lum) <= 3], axis=0)
    diff = np.abs(panel - bg).max(axis=2)
    chroma = panel.max(axis=2) - panel.min(axis=2)
    lum = panel.mean(axis=2)
    mask = (diff > 22) & ((chroma > 14) | (lum < bg.mean() - 30) | (lum > bg.mean() + 40))
    # Inspection frames drawn just inside a panel are not anatomy: drop the edge band.
    mask[:10] = mask[-10:] = False
    mask[:, :10] = mask[:, -10:] = False
    mask = ndimage.binary_opening(mask, iterations=1)
    mask = ndimage.binary_closing(mask, iterations=3)
    # A drawn panel frame is a thin component spanning nearly the whole panel; remove it before
    # hole filling so it cannot enclose the panel.
    labels, n = ndimage.label(mask)
    for i, sl in enumerate(ndimage.find_objects(labels), start=1):
        hh, ww = sl[0].stop - sl[0].start, sl[1].stop - sl[1].start
        if hh > 0.85 * mask.shape[0] and ww > 0.85 * mask.shape[1] and (labels[sl] == i).mean() < 0.15:
            mask[labels == i] = False
    mask = ndimage.binary_fill_holes(mask)
    labels, n = ndimage.label(mask)
    if n == 0:
        return mask
    sizes = ndimage.sum(mask, labels, range(1, n + 1))
    keep = np.isin(labels, 1 + np.where(sizes >= max(sizes.max() * 0.02, 60))[0])
    return keep


def crop(mask: np.ndarray) -> tuple[np.ndarray, tuple[int, int, int, int]]:
    ys, xs = np.where(mask)
    if ys.size == 0:
        return mask[:0, :0], (0, 0, 0, 0)
    y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
    return mask[y0:y1, x0:x1], (int(y0), int(y1), int(x0), int(x1))


def sheet_masks(path: str, rows: int, cols: int) -> list[dict]:
    img = load_rgb(path)
    out = []
    for i, (y0, y1, x0, x1) in enumerate(panel_bounds(img, rows, cols)):
        m = foreground(img[y0:y1, x0:x1])
        c, (cy0, cy1, cx0, cx1) = crop(m)
        out.append({'panel': i, 'panelRect': [y0, y1, x0, x1], 'bbox': [y0 + cy0, y0 + cy1, x0 + cx0, x0 + cx1], 'mask': c})
    return out


if __name__ == '__main__':
    import sys
    from pathlib import Path
    path, rows, cols, out = sys.argv[1], int(sys.argv[2]), int(sys.argv[3]), Path(sys.argv[4])
    out.mkdir(parents=True, exist_ok=True)
    img = load_rgb(path).astype(np.uint8)
    over = img.copy()
    for p in sheet_masks(path, rows, cols):
        y0, y1, x0, x1 = p['bbox']
        if p['mask'].size == 0:
            print(p['panel'], p['panelRect'], 'EMPTY')
            continue
        region = over[y0:y1, x0:x1]
        region[p['mask']] = (region[p['mask']] * 0.4 + np.array([255, 0, 180]) * 0.6).astype(np.uint8)
        print(p['panel'], p['panelRect'], p['bbox'], int(p['mask'].sum()))
    Image.fromarray(over).save(out / (Path(path).stem + '_masks.png'))
