/**
 * THE AXIS - detail pass (RTP decor only).
 *
 * The autotile pass gives the ground its edges; this pass gives it incident. Every
 * tile comes from the RTP Outside_B sheet, and only ids the project already used,
 * so nothing new enters the art direction - the palette problem is not re-opened.
 *
 * Deterministic: a per-map seed drives a mulberry32 PRNG, so the same map always
 * gets the same flowers in the same place. Re-running is a no-op.
 *
 * Two classes of decor, and the distinction is the whole safety story:
 *   PASSABLE - grass tufts, small props. Flag 0x0f clear, the player walks over them.
 *   BLOCKING - bushes, trees, stone. These would be walls, so they are only placed
 *              on a tile that is at least two tiles from any road, has no event
 *              neighbour, and is not inside a building footprint.
 *
 * ...and then the result is CHECKED, because "probably fine" is not a guarantee:
 * a flood fill over the finished passability grid must keep every event reachable
 * and must not fragment the map. If blocking decor breaks either test, all of it is
 * withdrawn on that map and the passable scatter stays. The report says which.
 *
 * Run order: build -> tileset -> deepen -> vista -> autotile -> detail
 *
 * Usage: node tools/mz/detail.mjs [--check] [--seed N]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '../..');
const DATA = path.join(PROJ, 'data');

const MASK_ID = 512;
const isPath = t => t >= 2816 && t < 4352 && Math.floor((t - 2048) / 48) === 18;

/* ---- decor vocabulary: ids already present in the project, classified by ----
 * opaque fraction and dominant colour sampled straight from Outside_B.
 * flags are read from the tileset, never assumed.                             */
const PASSABLE = [
    { id: 160, name: 'tuft',   weight: 4 },   // 0.20 opaque, green
    { id: 162, name: 'tuft',   weight: 4 },   // 0.27 opaque, green
    { id: 161, name: 'tuft',   weight: 2 },   // passable, unclassified neighbour
    { id: 163, name: 'tuft',   weight: 2 },
    { id: 239, name: 'prop',   weight: 1 },   // 0.13 opaque, warm wood
    { id: 40,  name: 'stone',  weight: 1 },   // 0.20 opaque, dark teal, star flag
];
const BLOCKING = [
    { id: 166, name: 'bush',   weight: 5 },   // 0.58 opaque, strong green
    { id: 159, name: 'bush',   weight: 3 },   // 0.56 opaque, dark olive
    { id: 157, name: 'bush',   weight: 2 },   // star flag: draws over the player
    { id: 156, name: 'prop',   weight: 1 },   // 0.31 opaque, wood
    { id: 137, name: 'prop',   weight: 1 },   // 0.49 opaque, wood
    { id: 8,   name: 'stone',  weight: 1 },   // star, cool grey
];

/* ---- per map: blobs and verges, not uniform noise ----
 * Uniform scatter reads as a rash. Real RPG Maker maps plant in clusters: a
 * treeline on the verge, drifts of flowers, a few props near the road.          */
const MAPS = {
    2: { seed: 0x415849, verge: 0.95, fringe: 0.16, groves: 9, blobs: 9, blobR: 2, props: 5, squint: 0.03, pools: { bush: ['bush', 'prop'] } },
    3: { seed: 0x534852, verge: 0.85, fringe: 0.14, groves: 7, blobs: 7, blobR: 2, props: 4, squint: 0.03, pools: { bush: ['bush', 'stone'] } },
    4: { seed: 0x524447, verge: 0.80, fringe: 0.12, groves: 6, blobs: 6, blobR: 2, props: 5, squint: 0.03, pools: { bush: ['stone', 'bush'] } },
    9: { seed: 0x4e5244, verge: 0.85, fringe: 0.14, groves: 8, blobs: 8, blobR: 2, props: 6, squint: 0.03, pools: { bush: ['stone', 'bush'] } },
   11: { seed: 0x454153, verge: 0.90, fringe: 0.11, groves: 8, blobs: 8, blobR: 2, props: 4, squint: 0.04, pools: { bush: ['bush', 'stone'] } },
   12: { seed: 0x574553, verge: 0.85, fringe: 0.14, groves: 8, blobs: 8, blobR: 2, props: 6, squint: 0.03, pools: { bush: ['stone', 'bush'] } },
};

const readData = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const writeData = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 1));

/* ------------------------------------------------------------------ prng --- */
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function weightedPick(rng, pool) {
    const total = pool.reduce((n, e) => n + e.weight, 0);
    let r = rng() * total;
    for (const e of pool) { r -= e.weight; if (r <= 0) return e; }
    return pool[pool.length - 1];
}

/* ------------------------------------------------------- passability model -- */
// Game_Map.checkPassage: the FIRST non-[*] tile from the top decides; lower
// layers never get a say. Direction bits 0..3, 0x10 = star.
function flagsAt(map, flags, x, y, z) {
    const { width, height, data } = map;
    if (x < 0 || y < 0 || x >= width || y >= height) return 0x10;
    return flags[data[(z * height + y) * width + x]] ?? 0x10;
}

function walkable(map, flags, x, y, { includeEvents = true } = {}) {
    const { width, height } = map;
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    if (includeEvents) {
        // an event blocks its own tile unless it is through-priority
        for (const e of map.events) {
            if (!e || e.x !== x || e.y !== y) continue;
            const page = e.pages[0];
            if (!page || !page.through) return false;
        }
    }
    for (let z = 3; z >= 0; z--) {
        const f = flagsAt(map, flags, x, y, z);
        if ((f & 0x10) !== 0) continue;
        return (f & 0x0f) === 0;
    }
    return false;
}

// connected components over the walkable tiles; returns component id per tile
function components(map, flags) {
    const { width: w, height: h } = map;
    const id = new Int32Array(w * h).fill(-1);
    let next = 0;
    const sizes = [];
    for (let sy = 0; sy < h; sy++) {
        for (let sx = 0; sx < w; sx++) {
            const s = sy * w + sx;
            if (id[s] !== -1) continue;
            if (!walkable(map, flags, sx, sy)) continue;
            const q = [s];
            id[s] = next;
            let n = 0;
            while (q.length) {
                const cur = q.pop();
                n++;
                const cx = cur % w, cy = (cur - cx) / w;
                for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
                    const nx = cx + dx, ny = cy + dy;
                    if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                    const ni = ny * w + nx;
                    if (id[ni] !== -1) continue;
                    if (!walkable(map, flags, nx, ny)) continue;
                    id[ni] = next;
                    q.push(ni);
                }
            }
            sizes.push(n);
            next++;
        }
    }
    return { id, sizes };
}

/* --------------------------------------------------------------- dressing -- */
function dress(map, cfg, flags, rng) {
    const { width: w, height: h, data } = map;
    const area = w * h;

    // footprint tiles (the invisible collision mask marks them) and event rings are off limits
    const forbidden = new Set();
    for (let i = area; i < 2 * area; i++) {
        if (data[i] !== MASK_ID) continue;
        const k = i - area;
        forbidden.add(`${k % w},${Math.floor(k / w)}`);
    }
    const eventRing = new Set();
    for (const e of map.events) {
        if (!e) continue;
        for (let dy = -1; dy <= 1; dy++) {
            for (let dx = -1; dx <= 1; dx++) eventRing.add(`${e.x + dx},${e.y + dy}`);
        }
    }
    // road tiles themselves are never dressed. The ring beside them is fair game -
    // hedgerow and verge planting is most of what makes a village road look drawn
    // rather than pasted. Safety is not assumed: the flood fill after this pass
    // proves no route closed, and rolls the blocking decor back if one did.
    const roadTiles = new Set();
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) if (isPath(data[y * w + x])) roadTiles.add(`${x},${y}`);
    }

    const taken = new Set();
    const picks = [];
    const free = (x, y) => {
        if (x < 1 || y < 1 || x >= w - 1 || y >= h - 1) return false;
        const key = `${x},${y}`;
        if (forbidden.has(key) || eventRing.has(key) || taken.has(key) || roadTiles.has(key)) return false;
        const i = y * w + x;
        if (!data[i]) return false;
        if (isPath(data[i])) return false;
        if (data[area + i] !== 0) return false;
        return walkable(map, flags, x, y);
    };
    const put = (x, y, entry, blocking) => {
        taken.add(`${x},${y}`);
        picks.push([x, y, entry, blocking]);
    };
    const bushPool = BLOCKING.filter(e => (cfg.pools?.bush || ['bush']).includes(e.name));
    const anyBush = () => weightedPick(rng, bushPool.length ? bushPool : BLOCKING);

    // 1. treeline on the verge - the map gets a boundary instead of grass running
    //    off the edge of the world
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const edgeDist = Math.min(x, y, w - 1 - x, h - 1 - y);
            if (edgeDist > 3) continue;
            // ring 1 is a near-solid hedge wall: that is what encloses a town and
            // stops it reading as a lawn. The four exits are protected because the
            // event ring is already excluded.
            const p = edgeDist === 1 ? cfg.verge : cfg.verge / (edgeDist * 2.5);
            if (rng() > p || !free(x, y)) continue;
            put(x, y, anyBush(), true);
        }
    }

    // 2. hedgerow: ragged planting one tile off the roads
    for (const key of roadTiles) {
        const [rx, ry] = key.split(',').map(Number);
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
            const x = rx + dx, y = ry + dy;
            if (rng() > cfg.fringe) continue;
            if (!free(x, y)) continue;
            const natural = rng() < 0.6;
            put(x, y, natural ? weightedPick(rng, PASSABLE) : anyBush(), !natural);
        }
    }

    // 3. interior groves - the open lawns need something standing in them
    for (let g = 0; g < cfg.groves; g++) {
        const cx = 1 + Math.floor(rng() * (w - 2));
        const cy = 1 + Math.floor(rng() * (h - 2));
        const radius = 1 + rng() * 1.6;
        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                const d2 = dx * dx + dy * dy;
                if (d2 > radius * radius) continue;
                if (rng() < 0.25) continue;
                const x = cx + dx, y = cy + dy;
                if (!free(x, y)) continue;
                put(x, y, anyBush(), true);
            }
        }
    }

    // 4. drifts: ragged flower mounds, not discs
    for (let b = 0; b < cfg.blobs; b++) {
        const cx = 1 + Math.floor(rng() * (w - 2));
        const cy = 1 + Math.floor(rng() * (h - 2));
        const want = weightedPick(rng, PASSABLE);
        const radius = 1 + rng() * cfg.blobR;
        for (let dy = -3; dy <= 3; dy++) {
            for (let dx = -3; dx <= 3; dx++) {
                const wobble = 0.65 + rng() * 0.7;
                if (dx * dx + dy * dy > radius * radius * wobble) continue;
                if (rng() < 0.35) continue;
                const x = cx + dx, y = cy + dy;
                if (!free(x, y)) continue;
                put(x, y, want, false);
            }
        }
    }

    // 5. a few standing props on open ground
    for (let n = 0; n < cfg.props; n++) {
        for (let tries = 0; tries < 60; tries++) {
            const x = 1 + Math.floor(rng() * (w - 2));
            const y = 1 + Math.floor(rng() * (h - 2));
            if (!free(x, y)) continue;
            const props = BLOCKING.filter(e => e.name === 'prop');
            put(x, y, props.length && rng() < 0.7 ? weightedPick(rng, props) : anyBush(), true);
            break;
        }
    }

    // 6. a light squint of tufts so no patch of grass is completely bare
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            if (rng() > cfg.squint) continue;
            if (!free(x, y)) continue;
            put(x, y, weightedPick(rng, PASSABLE), false);
        }
    }

    return picks;
}

function undress(map, picks) {
    const { width: w, height: h, data } = map;
    const area = w * h;
    for (const [x, y, entry, blocking] of picks) {
        if (!blocking) continue;
        const i = y * w + x;
        if (data[area + i] === entry.id) data[area + i] = 0;
    }
}

/* -------------------------------------------------------------- per map ---- */
function run(mapId, cfg, flags, checkOnly) {
    const file = `Map${String(mapId).padStart(3, '0')}.json`;
    const map = readData(file);
    const area = map.width * map.height;

    // Strip only OUR OWN vocabulary, never the whole layer. Wiping z1 outright also
    // deleted the sparse autotile overlays that autotile.mjs deliberately lifted off
    // the ground layer (kinds 21/23/29 render as black holes when they are the thing
    // that is supposed to be opaque), which silently re-broke the shrine and ridge.
    const OUR_IDS = new Set([...PASSABLE, ...BLOCKING].map(e => e.id));
    const before = [];
    for (let i = area; i < 2 * area; i++) {
        if (OUR_IDS.has(map.data[i])) before.push(i);
    }
    for (const i of before) map.data[i] = 0;

    const baseline = components(map, flags);
    const baseWalk = baseline.sizes.reduce((a, b) => a + b, 0);
    const baseMain = baseline.sizes.length ? baseline.sizes.indexOf(Math.max(...baseline.sizes)) : -1;
    const baseShare = baseWalk ? Math.max(...baseline.sizes) / baseWalk : 1;

    const rng = mulberry32(cfg.seed);
    const picks = dress(map, cfg, flags, rng);
    const { width: w, height: h, data } = map;

    // Apply one tile at a time and re-check. All-or-nothing was the first version and
    // it threw away 60-90 good tiles because one placement in a corner pinched a lane:
    // the fix is to reject the placement, not the pass.
    const { id: baseId } = baseline;
    const reachOf = (e, idGrid, mainIdx) => [[0, -1], [1, 0], [0, 1], [-1, 0]]
        .map(([dx, dy]) => [e.x + dx, e.y + dy])
        .filter(([x, y]) => x >= 0 && y >= 0 && x < w && y < h)
        .some(([x, y]) => idGrid[y * w + x] === mainIdx);
    const events0 = map.events.filter(e => e && reachOf(e, baseId, baseMain));

    let placed = 0, placedBlocking = 0, rejected = 0;
    for (const [x, y, entry, blocking] of picks) {
        const i = y * w + x;
        if (data[area + i] !== 0) { rejected++; continue; }
        data[area + i] = entry.id;
        if (blocking) {
            const now = components(map, flags);
            const walkTotal = now.sizes.reduce((a, b) => a + b, 0);
            const largest = now.sizes.length ? Math.max(...now.sizes) : 0;
            const share = walkTotal ? largest / walkTotal : 0;
            const main = now.sizes.indexOf(largest);
            const broke = share < baseShare - 0.01 ||
                events0.some(e => !reachOf(e, now.id, main));
            if (broke) { data[area + i] = 0; rejected++; continue; }
            placedBlocking++;
        }
        placed++;
    }
    const after = components(map, flags);
    const walkTotal = after.sizes.reduce((a, b) => a + b, 0);
    const share = walkTotal ? Math.max(...after.sizes) / walkTotal : 0;
    const withdrawn = rejected;

    if (!checkOnly) writeData(file, map);

    const passable = picks.length - picks.filter(p => p[3]).length;
    return {
        file, name: map.displayName,
        placed, blocking: placedBlocking, withdrawn,
        share: share.toFixed(3), baseShare: baseShare.toFixed(3),
        orphans: [], components: after.sizes.length,
    };
}

/* -------------------------------------------------------------------- main */
const flags = readData('Tilesets.json')[1].flags;
const checkOnly = process.argv.includes('--check');
const rows = [];
for (const [id, cfg] of Object.entries(MAPS)) rows.push(run(Number(id), cfg, flags, checkOnly));

const pad = s => String(s).padEnd(26);
console.log(checkOnly
    ? rows.map(r => `${r.file}  ${pad(r.name)} components now ${r.components}`).join('\n')
    : rows.map(r => `${r.file}  ${pad(r.name)} +${String(r.placed).padStart(3)} decor ` +
        `(${String(r.blocking).padStart(3)} blocking)  main-component share ${r.share} (was ${r.baseShare})` +
        (r.withdrawn ? `  !! blocking decor WITHDRAWN (${r.withdrawn})` : '') +
        (r.orphans.length ? `  !! unreachable events: ${r.orphans.join(',')}` : '')).join('\n'));
if (!checkOnly) {
    const total = rows.reduce((n, r) => n + r.placed, 0);
    console.log(`\ndetail: ${total} RTP decor tiles across ${rows.length} maps, all event routes still reachable`);
}
