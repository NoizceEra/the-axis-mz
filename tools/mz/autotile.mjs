/**
 * THE AXIS - autotile pass.
 *
 * Every map in this project was generated with a single autotile shape: 0. Shape 0
 * is the fully-interior tile, so a road never has an edge, a patch of dirt never
 * has a border, and the whole map reads as flat colour where the ground type
 * changes. This pass recomputes the shape of every A1/A2 tile from its neighbours,
 * which is what makes RTP ground look drawn rather than flooded.
 *
 * The shape index is not documented anywhere. It is `tileId % 48` and its meaning
 * lives in Tilemap.FLOOR_AUTOTILE_TABLE (js/rmmz_core.js:2793) - a table of which
 * 24x24 quarter of the autotile block each quadrant of the drawn tile comes from.
 * The mapping below was measured, not guessed: tools/mz/autotile-sheet.py renders
 * all 48 shapes through that table, and each was classified by how much grass
 * shows in its four edge bands and four corners against A2 kind 18.
 *
 *   all four sides connected -> shape = diagonal mask, 0..15
 *       bit value: NW 1, NE 2, SW 4, SE 8   (bit set = that corner is a different tile)
 *   otherwise                -> the table below
 *
 * A1 and A2 share FLOOR_AUTOTILE_TABLE, so the same mapping applies to both.
 * A3/A4 use WALL_AUTOTILE_TABLE (16 shapes) and are left alone here - this
 * project does not place any, and guessing would be worse than not touching them.
 *
 * Run order: build -> tileset -> deepen -> vista -> autotile
 *   (vista is before autotile because vista paints new road tiles, and those need
 *    their shapes computed too)
 *
 * Usage: node tools/mz/autotile.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '../..');
const DATA = path.join(PROJ, 'data');

const A1 = 2048, A2 = 2816, A3 = 4352;
const CHECK = process.argv.includes('--check');

/* The measured side-mask -> shape table (all four sides NOT all connected). */
const SIDE_SHAPE = {
    14: 20,   // N is an edge, ESW continue
    13: 24,   // E is an edge, NSW continue
    12: 36,   // NE are edges, SW continue
    11: 28,   // S is an edge, NEW continue
    10: 33,   // NS edges, EW continue  -> horizontal corridor
    9: 38,    // ES edges, NW continue
    8: 45,    // NES edges, W only     -> right-hand end
    7: 16,    // W is an edge, NES continue
    6: 34,    // NW edges, ES continue
    5: 32,    // EW edges, NS continue -> vertical corridor
    4: 42,    // only S connects       -> top end
    3: 40,    // SW edges, NE continue
    2: 43,    // only E connects       -> left end
    1: 44,    // only N connects       -> bottom end
    0: 46,    // nothing connects      -> isolated tile
};

const kindOf = t => Math.floor((t - 2048) / 48);
const isAutotile12 = t => t >= A1 && t < A3;      // A1 and A2 both use the floor table

// tools/mz/autotile-kinds.py measures every kind's INTERIOR shape coverage against
// the real sheets. A sparse kind (a puddle, a rubble patch) is a few percent opaque,
// so painting one on z0 leaves the canvas backdrop showing through as a black
// 48x48 square. Kinds 21, 23 and 29 in this project's maps were used that way.
const KINDS = JSON.parse(fs.readFileSync(path.join(HERE, 'autotile-kinds.json'), 'utf8'));
const SPARSE = new Set(KINDS.sparseA2 || []);
const UNSAFE = new Set(Object.keys(KINDS.interior || {})
    .map(Number).filter(k => (KINDS.interior[k] ?? 1) < 0.60));

/**
 * Lift a sparse autotile off the ground layer and onto an overlay layer, then put a
 * solid tile of the same map's own ground underneath it. The sparse tile keeps its
 * look; it just stops being the thing that is supposed to be opaque.
 */
function liftSparseGround(map) {
    const { width: w, height: h, data } = map;
    const area = w * h;
    const solid = new Map();                      // solid z0 tile -> count
    for (let i = 0; i < area; i++) {
        const t = data[i];
        if (!t) continue;
        if (isAutotile12(t) && UNSAFE.has(kindOf(t))) continue;
        solid.set(t, (solid.get(t) || 0) + 1);
    }
    if (!solid.size) return { lifted: 0, dropped: 0, ground: 0 };
    const ground = [...solid.entries()].sort((a, b) => b[1] - a[1])[0][0];

    let lifted = 0, dropped = 0;
    for (let i = 0; i < area; i++) {
        const t = data[i];
        if (!t || !isAutotile12(t) || !UNSAFE.has(kindOf(t))) continue;
        let placedOn = -1;
        for (const z of [1, 2, 3]) {
            if (data[z * area + i] === 0) { data[z * area + i] = t; placedOn = z; break; }
        }
        if (placedOn === -1) dropped++;
        else lifted++;
        data[i] = ground;                         // solid ground underneath
    }
    return { lifted, dropped, ground };
}

function shapeFor(sides, diagMask) {
    if (sides === 15) return diagMask;             // interior: only corners vary
    return SIDE_SHAPE[sides] ?? 0;
}

/**
 * Recompute every A1/A2 tile's shape in one map, in place.
 * A neighbour "continues" when Tilemap.isSameKindTile() would say so: for
 * autotiles that means the same kind, for everything else the same tile id.
 */
function autotileMap(map) {
    const { width: w, height: h, data } = map;
    const layerCount = 4;                          // z0..z3; A-tiles normally live on z0
    let changed = 0, seen = 0;
    for (let z = 0; z < layerCount; z++) {
        const base = z * h * w;
        const get = (x, y) => {
            if (x < 0 || y < 0 || x >= w || y >= h) return 0;
            return data[base + y * w + x];
        };
        const same = (x, y, kind, self) => {
            const t = get(x, y);
            if (t === self) return true;
            if (!t) return false;
            if (isAutotile12(t) && isAutotile12(self)) return kindOf(t) === kind;
            return t === self;
        };
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const t = get(x, y);
                if (!isAutotile12(t)) continue;
                seen++;
                const kind = kindOf(t);
                let sides = 0;
                if (same(x, y - 1, kind, t)) sides |= 1;
                if (same(x + 1, y, kind, t)) sides |= 2;
                if (same(x, y + 1, kind, t)) sides |= 4;
                if (same(x - 1, y, kind, t)) sides |= 8;
                let diag = 0;
                if (!same(x - 1, y - 1, kind, t)) diag |= 1;   // NW
                if (!same(x + 1, y - 1, kind, t)) diag |= 2;   // NE
                if (!same(x - 1, y + 1, kind, t)) diag |= 4;   // SW
                if (!same(x + 1, y + 1, kind, t)) diag |= 8;   // SE
                const next = 2048 + kind * 48 + shapeFor(sides, diag);
                if (next !== t) { data[base + y * w + x] = next; changed++; }
            }
        }
    }
    return { changed, seen };
}

const load = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const save = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 1));

const infos = load('MapInfos.json').filter(Boolean);
let totalChanged = 0, totalSeen = 0, mapsTouched = 0, totalLifted = 0;
const rows = [];
for (const info of infos) {
    const file = `Map${String(info.id).padStart(3, '0')}.json`;
    const map = load(file);
    if (CHECK) {
        let same = 0, all = 0;
        for (let i = 0; i < map.width * map.height; i++) {
            const t = map.data[i];
            if (!isAutotile12(t)) continue;
            all++;
            if ((t - 2048) % 48 === 0) same++;
        }
        rows.push(`${file}  ${map.displayName.padEnd(28)} ${same}/${all} still at shape 0`);
        continue;
    }
    const lift = liftSparseGround(map);
    const r = autotileMap(map);
    if (r.changed || lift.lifted) { save(file, map); mapsTouched++; }
    totalChanged += r.changed;
    totalSeen += r.seen;
    totalLifted += lift.lifted;
    if (r.seen) rows.push(`${file}  ${map.displayName.padEnd(28)} ${String(r.changed).padStart(4)}/${String(r.seen).padStart(4)} reshaped` +
        (lift.lifted ? `  ${lift.lifted} sparse ground tile(s) lifted to an overlay` : ''));
}

if (CHECK) {
    console.log(rows.join('\n'));
} else {
    console.log(rows.join('\n'));
    console.log(`\nautotile: ${totalChanged} of ${totalSeen} A1/A2 tiles reshaped across ${mapsTouched} maps` +
        (totalChanged ? '' : ' (already correct)'));
}
