#!/usr/bin/env python3
"""
Which A1/A2 autotile kinds can be re-shaped safely?

Not every autotile kind is a full 48-shape terrain. Some kinds exist only as a
"solid" variant - their isolated/edge shapes pull quadrants that are fully
transparent in the sheet, so painting a lone tile of that kind with the isolated
shape leaves a transparent cell and the canvas backdrop shows through as a black
48x48 hole. That is exactly what happened to A2 kind 23 on the shrine map.

So: render all 48 shapes of every kind through the real FLOOR_AUTOTILE_TABLE and
record which kinds have a fully-transparent shape. autotile.mjs then leaves the
unsafe kinds at shape 0 instead of guessing.

Writes tools/mz/autotile-kinds.json.
"""
import importlib.util
import json
import os

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(HERE))
TILE = 48
HALF = 24


def load_renderer():
    spec = importlib.util.spec_from_file_location('a', os.path.join(HERE, 'autotile-sheet.py'))
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def block_origin(sheet, kind):
    """The autotile block origin in quarter-cells, exactly as _addAutotile computes it."""
    tx, ty = kind % 8, kind // 8
    if kind < 16:                      # A1
        if kind == 0:  return 0, 0
        if kind == 1:  return 0, 3
        if kind == 2:  return 6, 0
        if kind == 3:  return 6, 3
        bx = (tx // 4) * 8
        by = ty * 6 + ((tx // 2) % 2) * 3
        return bx, by
    return tx * 2, (ty - 2) * 3        # A2


def shape_is_blank(sheet, kind, table, shape):
    bx, by = block_origin(sheet, kind)
    opaque = 0
    for qsx, qsy in table[shape]:
        sx = (bx * 2 + qsx) * HALF
        sy = (by * 2 + qsy) * HALF
        if sx + HALF > sheet.width or sy + HALF > sheet.height:
            continue
        q = sheet.crop((sx, sy, sx + HALF, sy + HALF))
        opaque += sum(1 for p in q.get_flattened_data() if p[3] > 32)
    return opaque == 0


def interior_opacity(sheet, kind, table):
    bx, by = block_origin(sheet, kind)
    opaque = 0
    for qsx, qsy in table[0]:
        sx = (bx * 2 + qsx) * HALF
        sy = (by * 2 + qsy) * HALF
        if sx + HALF > sheet.width or sy + HALF > sheet.height:
            continue
        q = sheet.crop((sx, sy, sx + HALF, sy + HALF))
        opaque += sum(1 for p in q.get_flattened_data() if p[3] > 32)
    return opaque / (TILE * TILE)


def main():
    m = load_renderer()
    a2 = Image.open(os.path.join(PROJ, 'img', 'tilesets', 'Outside_A2.png')).convert('RGBA')
    a1 = Image.open(os.path.join(PROJ, 'img', 'tilesets', 'Outside_A1.png')).convert('RGBA')

    report = {'A1': {}, 'A2': {}}
    for label, sheet, kinds in (('A1', a1, range(16)), ('A2', a2, range(16, 64))):
        for kind in kinds:
            blanks = [s for s in range(48) if shape_is_blank(sheet, kind, m.FLOOR, s)]
            # how much of the cell the INTERIOR shape covers: a real ground autotile
            # is ~1.0, a sparse overlay (puddle, rubble patch) is far less. Painting a
            # sparse kind on z0 leaves the canvas backdrop showing through as black.
            interior = interior_opacity(sheet, kind, m.FLOOR)
            report[label][kind] = {'blankShapes': len(blanks), 'safe': len(blanks) == 0,
                                   'interior': round(interior, 3)}

    safe_a1 = [k for k, v in report['A1'].items() if v['safe']]
    safe_a2 = [k for k, v in report['A2'].items() if v['safe']]
    dest = os.path.join(HERE, 'autotile-kinds.json')

    sparse = [k for k, v in report['A2'].items() if v['interior'] < 0.60]
    report_safe = {'safeA1': safe_a1,
                   'safeA2': [k for k in safe_a2 if report['A2'][k]['interior'] >= 0.60],
                   'sparseA2': sparse,
                   'interior': {k: v['interior'] for k, v in report['A2'].items()},
                   'safeRaw': {'A1': safe_a1, 'A2': safe_a2},
                   'detail': report}
    with open(dest, 'w', encoding='utf-8') as f:
        json.dump(report_safe, f, indent=0)
    unsafe = [(k, v['blankShapes']) for k, v in report['A2'].items() if not v['safe']]
    print(f'safe A1 kinds: {safe_a1}')
    print(f'safe A2 kinds ({len(safe_a2)}): {safe_a2}')
    print(f'unsafe A2 kinds: {[(k, n) for k, n in unsafe]}')
    print(f'sparse A2 kinds (painted on z0 by mistake): {sparse}')
    print('->', os.path.relpath(dest, PROJ))


if __name__ == '__main__':
    main()
