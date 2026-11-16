#!/usr/bin/env python3
"""
Render all 48 autotile shapes of one A2 kind into a contact sheet, replicating
Tilemap._addAutotile() from js/rmmz_core.js exactly.

Ground truth for "which shape index means which connection mask" - the mapping is
not documented and deriving it from other projects' maps is noisy (the same
neighbour mask maps to several shapes there), so we look at the pixels instead.
"""
import os
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(HERE))
TILE = 48
HALF = TILE // 2

# copied verbatim from js/rmmz_core.js:2793
FLOOR = [
    [[2, 4], [1, 4], [2, 3], [1, 3]], [[2, 0], [1, 4], [2, 3], [1, 3]],
    [[2, 4], [3, 0], [2, 3], [1, 3]], [[2, 0], [3, 0], [2, 3], [1, 3]],
    [[2, 4], [1, 4], [2, 3], [3, 1]], [[2, 0], [1, 4], [2, 3], [3, 1]],
    [[2, 4], [3, 0], [2, 3], [3, 1]], [[2, 0], [3, 0], [2, 3], [3, 1]],
    [[2, 4], [1, 4], [2, 1], [1, 3]], [[2, 0], [1, 4], [2, 1], [1, 3]],
    [[2, 4], [3, 0], [2, 1], [1, 3]], [[2, 0], [3, 0], [2, 1], [1, 3]],
    [[2, 4], [1, 4], [2, 1], [3, 1]], [[2, 0], [1, 4], [2, 1], [3, 1]],
    [[2, 4], [3, 0], [2, 1], [3, 1]], [[2, 0], [3, 0], [2, 1], [3, 1]],
    [[0, 4], [1, 4], [0, 3], [1, 3]], [[0, 4], [3, 0], [0, 3], [1, 3]],
    [[0, 4], [1, 4], [0, 3], [3, 1]], [[0, 4], [3, 0], [0, 3], [3, 1]],
    [[2, 2], [1, 2], [2, 3], [1, 3]], [[2, 2], [1, 2], [2, 3], [3, 1]],
    [[2, 2], [1, 2], [2, 1], [1, 3]], [[2, 2], [1, 2], [2, 1], [3, 1]],
    [[2, 4], [3, 4], [2, 3], [3, 3]], [[2, 4], [3, 4], [2, 1], [3, 3]],
    [[2, 0], [3, 4], [2, 3], [3, 3]], [[2, 0], [3, 4], [2, 1], [3, 3]],
    [[2, 4], [1, 4], [2, 5], [1, 5]], [[2, 0], [1, 4], [2, 5], [1, 5]],
    [[2, 4], [3, 0], [2, 5], [1, 5]], [[2, 0], [3, 0], [2, 5], [1, 5]],
    [[0, 4], [3, 4], [0, 3], [3, 3]], [[2, 2], [1, 2], [2, 5], [1, 5]],
    [[0, 2], [1, 2], [0, 3], [1, 3]], [[0, 2], [1, 2], [0, 3], [3, 1]],
    [[2, 2], [3, 2], [2, 3], [3, 3]], [[2, 2], [3, 2], [2, 1], [3, 3]],
    [[2, 4], [3, 4], [2, 5], [3, 5]], [[2, 0], [3, 4], [2, 5], [3, 5]],
    [[0, 4], [1, 4], [0, 5], [1, 5]], [[0, 4], [3, 0], [0, 5], [1, 5]],
    [[0, 2], [3, 2], [0, 3], [3, 3]], [[0, 2], [1, 2], [0, 5], [1, 5]],
    [[0, 4], [3, 4], [0, 5], [3, 5]], [[2, 2], [3, 2], [2, 5], [3, 5]],
    [[0, 2], [3, 2], [0, 5], [3, 5]], [[0, 0], [1, 0], [0, 1], [1, 1]],
]


def render_shape(sheet, kind, shape):
    """One 48x48 tile of (kind, shape), built the way the engine builds it."""
    out = Image.new('RGBA', (TILE, TILE), (0, 0, 0, 0))
    tx, ty = kind % 8, kind // 8
    bx, by = tx * 2, (ty - 2) * 3
    for i, (qsx, qsy) in enumerate(FLOOR[shape]):
        sx = (bx * 2 + qsx) * HALF
        sy = (by * 2 + qsy) * HALF
        out.alpha_composite(sheet.crop((sx, sy, sx + HALF, sy + HALF)),
                            ((i % 2) * HALF, (i // 2) * HALF))
    return out


def main():
    sheet_name = sys.argv[1] if len(sys.argv) > 1 else 'Outside_A2'
    kind = int(sys.argv[2]) if len(sys.argv) > 2 else 18
    sheet = Image.open(os.path.join(PROJ, 'img', 'tilesets', sheet_name + '.png')).convert('RGBA')
    cols, rows = 8, 6
    out = Image.new('RGBA', (cols * TILE, rows * TILE), (30, 20, 30, 255))
    for shape in range(48):
        out.alpha_composite(render_shape(sheet, kind, shape),
                            ((shape % cols) * TILE, (shape // cols) * TILE))
    dest = os.path.join(PROJ, '_shots', f'autotile_{sheet_name}_kind{kind}.png')
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    out.convert('RGB').save(dest)
    print(dest, out.size, '- cell n is shape n, reading order')


if __name__ == '__main__':
    main()
