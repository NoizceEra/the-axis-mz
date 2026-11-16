#!/usr/bin/env python3
"""
THE AXIS - village building sprites.

Renders parametric top-down buildings with D:/ai-studio/parametric-topdown's CLI,
quantises them to the locked AXIS palette, and composes them into MZ character
sheets (3 cols x 4 rows) whose cell size is an exact multiple of MZ's 48px grid.

Output: img/characters/!$axis_bldg_<key>.png   (the !$ prefix matters: '$' makes
MZ treat it as a single big character, '!' disables the +6px foot offset so the
sprite anchors exactly to its tile).

An event using one of these sheets blocks exactly ONE tile (its own). Footprint
collision is painted separately as an invisible impassable tile on layer z1 by
tools/mz/vista.mjs - see that file for why.
"""
import json
import os
import subprocess
import sys

from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
PROJ = os.path.dirname(os.path.dirname(HERE))          # .../the-axis-mz
PT = 'D:/ai-studio/parametric-topdown'                  # renderer
TILE = 48                                               # MZ's locked grid

# ---------------------------------------------------------------- locked palette
# 32 colours, no more. Two families deliberately merged:
#   * the RTP Outside greens/browns actually on Ashhollow's ground layer, so the
#     buildings sit in the existing world instead of on top of it;
#   * THE AXIS' own moss/ochre/rust, so the result still reads as this game.
# Anything not in here gets snapped to the nearest entry - that is the whole
# point: one palette across tiles and buildings is what stops asset soup.
AXIS_PAL = [
    # RTP greens actually present under the village
    '#25670a', '#306119', '#419026', '#4e9a1a', '#64aa41',
    '#6bb71a', '#73d630', '#91c75c', '#a3de5c',
    # THE AXIS moss
    '#3f4a35', '#4d5940', '#5f6b47', '#7d8a5c', '#9aa878',
    # earth (RTP browns + the doc's earth tones)
    '#3b2815', '#5b3b19', '#5a4a30', '#724d26', '#875f2d',
    '#9e652c', '#8a7550', '#bc944d', '#d7b16f',
    # roof rust - the only warm accent the buildings get
    '#7a3b2a', '#a05a3c',
    # cream / plaster / cloth
    '#e4dbcc', '#edd79a', '#f6f6f2',
    # ink + slate
    '#000000', '#221e19', '#3e4041', '#545758',
]


def palette_image():
    im = Image.new('P', (1, 1))
    flat = []
    for h in AXIS_PAL:
        flat += [int(h[1:3], 16), int(h[3:5], 16), int(h[5:7], 16)]
    flat += [0] * (768 - len(flat))
    im.putpalette(flat)
    return im


# ---------------------------------------------------------------- building set
# key, style, type, (tiles wide, tiles tall), extra CLI args
#
# Sizes are chosen against Ashhollow's 24x18 grid: the map keeps its x=11
# north-south road and its y=9 east-west road, so a building may be 6 tiles wide
# without eating the village's circulation.
BUILDINGS = [
    # the village proper. Widths are capped against Ashhollow's 24 columns: the
    # map has to keep its x=11 north-south road and its y=6 / y=9 east-west roads.
    ('home',   'forest', 'house',         (5, 5), ['--param', 'floors=1']),
    ('elder',  'forest', 'manor',         (6, 5), ['--param', 'floors=1']),
    ('shop',   'forest', 'general_store', (5, 5), []),
    ('forge',  'jiangnan_pixel', 'forge', (4, 4), []),
    # the Old Root Shrine
    ('shrine', 'forest', 'temple',        (8, 6), []),
    # ridge / hollow dressing
    ('ruin',   'forest', 'abandoned_house', (4, 3), []),
    ('granary', 'forest', 'granary',      (4, 4), []),
]


def render(key, style, btype, extra):
    out = os.path.join(PT, 'out', 'axis', f'{key}_raw.png')
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = [ 'node', 'cli/tb.js', 'render', style, btype,
            '--no-aa',                    # no antialiasing: it must be pixel art
            '--outline-silhouette', '1',  # one-pixel dark rim, RPG Maker's habit
            '--size', '384',
            '-o', out, '--quiet' ] + extra
    r = subprocess.run(cmd, cwd=PT, capture_output=True, text=True, timeout=240)
    if r.returncode != 0:
        raise SystemExit(f'render failed for {key}: {(r.stderr or r.stdout)[:400]}')
    return out


def make_sheet(key, style, btype, tiles, extra):
    tw, th = tiles[0] * TILE, tiles[1] * TILE
    raw = Image.open(render(key, style, btype, extra)).convert('RGBA')
    bbox = raw.getchannel('A').getbbox()
    if not bbox:
        raise SystemExit(f'{key}: rendered frame is empty')
    body = raw.crop(bbox)

    # snap to the palette while it is still at render resolution
    q = body.convert('RGB').quantize(palette=palette_image(), dither=Image.Dither.NONE)
    body = q.convert('RGBA')
    alpha = raw.crop(bbox).getchannel('A')
    body.putalpha(alpha)                                        # keep the silhouette

    # fit inside the cell, preserving aspect, nearest-neighbour both ways
    k = min(tw / body.width, th / body.height)
    w, hgt = max(1, round(body.width * k)), max(1, round(body.height * k))
    body = body.resize((w, hgt), Image.NEAREST)

    cell = Image.new('RGBA', (tw, th), (0, 0, 0, 0))
    cell.alpha_composite(body, ((tw - w) // 2, th - hgt))       # bottom-centred

    # Trim the cell to the tiles the sprite actually covers. Requested sizes are
    # an upper bound only: aspect ratio decides, so a tall narrow building comes
    # out narrow instead of sitting in a wide cell with dead space that MZ would
    # then anchor off-centre. Cell dims stay multiples of 48 by construction.
    a = cell.getchannel('A')
    cover_t = []
    for ty in range(th // TILE):
        row = []
        for tx in range(tw // TILE):
            box = a.crop((tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE))
            row.append(sum(box.histogram()[128:]) / (TILE * TILE))
        cover_t.append(row)
    cols_hit = [x for x in range(tw // TILE) if max(r[x] for r in cover_t) > 0.02]
    rows_hit = [y for y in range(th // TILE) if max(cover_t[y]) > 0.02]
    x0, x1 = cols_hit[0], cols_hit[-1] + 1
    y0, y1 = rows_hit[0], rows_hit[-1] + 1
    cell = cell.crop((x0 * TILE, y0 * TILE, x1 * TILE, y1 * TILE))
    tw, th = cell.width, cell.height

    sheet = Image.new('RGBA', (tw * 3, th * 4), (0, 0, 0, 0))
    for row in range(4):
        for col in range(3):
            sheet.alpha_composite(cell, (col * tw, row * th))

    name = f'!$axis_bldg_{key}.png'
    dest = os.path.join(PROJ, 'img', 'characters', name)
    sheet.save(dest)

    # per-tile alpha coverage of one cell: vista.mjs paints collision only where
    # the sprite actually has body, so transparent roof corners stay walkable
    a = cell.getchannel('A')
    cover = []
    for ty in range(th // TILE):
        row = []
        for tx in range(tw // TILE):
            box = a.crop((tx * TILE, ty * TILE, (tx + 1) * TILE, (ty + 1) * TILE))
            hist = box.histogram()
            solid = sum(hist[128:])
            row.append(round(solid / (TILE * TILE), 3))
        cover.append(row)

    px = [p for p in cell.get_flattened_data() if p[3] > 0]
    cols = len({p[:3] for p in px})
    return {'sheet': name, 'cell': [tw, th], 'cellTiles': [tw // TILE, th // TILE],
            'colours': cols, 'opaque': len(px), 'cover': cover}


def make_mask():
    """768x768 all-transparent B/D-sheet: the invisible collision tile.

    vista.mjs paints this on z1 under a building's body. MZ's checkPassage walks
    layers top-down, so an impassable z1 tile blocks even though z0 is grass, and
    being fully transparent the player never sees it.
    """
    dest = os.path.join(PROJ, 'img', 'tilesets', 'axis_mask.png')
    Image.new('RGBA', (768, 768), (0, 0, 0, 0)).save(dest)
    return dest


if __name__ == '__main__':
    manifest = {}
    print(f'{"sheet":30s} {"cell":11s} {"tiles":7s} {"cols":>4s} {"opaque":>7s}')
    for key, style, btype, tiles, extra in BUILDINGS:
        info = make_sheet(key, style, btype, tiles, extra)
        manifest[key] = info
        print(f'{info["sheet"]:30s} {str(tuple(info["cell"])):11s} '
              f'{str(tuple(info["cellTiles"])):7s} {info["colours"]:4d} {info["opaque"]:7d}')

    make_mask()
    man = os.path.join(HERE, 'buildings.json')
    with open(man, 'w', encoding='utf-8') as f:
        json.dump({'palette': AXIS_PAL, 'tile': TILE, 'buildings': manifest}, f, indent=1)
    print('manifest ->', os.path.relpath(man, PROJ))
