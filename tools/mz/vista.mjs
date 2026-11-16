/**
 * THE AXIS - vista pass: real buildings, and the collision that makes them solid.
 *
 * Runs AFTER build.mjs (translation) and deepen.mjs (design), and BEFORE
 * autotile.mjs (which recomputes the shape bits of every A1/A2 tile, including the
 * road spurs this pass paints).
 *
 * This pass owns layout rather than story, because build.mjs regenerates every map
 * from the web build's ops and would lose hand-edited tiles on the next rebuild.
 *
 * Four mechanics, each checked against the shipped runtime rather than assumed:
 *
 * 1. A big-building sprite is ONE event using a `!$name.png` sheet.
 *    ImageManager.isBigCharacter() treats '$' as a single character; '!' drops
 *    the +6px foot offset so the sprite anchors exactly to its tile;
 *    Sprite_Character's anchor is (0.5, 1), so the image grows up and out from
 *    the bottom-centre of the event's tile.
 *
 * 2. That event blocks exactly ONE tile - isCollidedWithCharacters() only tests
 *    this.pos(x, y) && !isThrough(). The body is made solid by painting an
 *    invisible impassable tile on layer z1: layeredTiles() walks z3 -> z0, so a
 *    blocked z1 tile returns impassable from checkPassage() before the grass
 *    underneath is consulted. The mask is tileset slot 7 ("axis_mask"), id 512.
 *
 * 3. An action-button page must be priorityType 1 - Game_Player.startMapEvent()
 *    only fires pages whose isNormalPriority() matches. A door left at priority
 *    0 is scenery that never responds.
 *
 * 4. You press OK at the tile you FACE, not the tile you stand on. The
 *    interaction therefore lives ON the building event; a separate door event on
 *    the front tile would shadow it and the wall would never answer. Existing
 *    door events are adopted into the building page and removed.
 *
 * Usage: node tools/mz/vista.mjs [--check]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '../..');
const DATA = path.join(PROJ, 'data');

const MASK_SHEET = 'axis_mask';
const MASK_SLOT = 7;            // sheet slot 7 = tile ids 512..767
const MASK_ID = 512;            // cell 0 of that sheet, fully transparent
const MASK_FLAGS = 0x60f;       // impassable in all four directions
const GRASS = 1556;             // the A5 plain tile Ashhollow's ground layer uses
const PATH = 2912;              // A2 autotile kind 18, shape 0
const PATH_KIND = 18;
// compare by KIND, not by id: autotile.mjs rewrites the shape bits afterwards
const isPath = t => t >= 2816 && t < 4352 && Math.floor((t - 2048) / 48) === PATH_KIND;
const OLD_SLAB = 4736;          // the 4x3 brick blocks this pass replaces
// 7520 is the other translation remnant: an Outside_C cell that renders as a
// solid black 48x48 square (80 of them sat on the village's border). Neither id
// belongs to a real map, so both are cleared everywhere.
const LEGACY_DECOR = [OLD_SLAB, 7520];

/* ------------------------------------------------------------------ layout */
// Per map. `door` is the tile the PLAYER STANDS ON; the building event sits at
// [x, y-1] and its sprite covers rows y-h .. y-1, centred on x. `spur` connects
// the door to existing traffic, because paintPath writes kind-18 road tiles.
// `as` lets one sprite be placed more than once (event names must differ).
const SITES = {
    2: {
        // Ashhollow is 24x18 and has to keep two spine roads: y=9 (west <-> east)
        // and x=11 (north <-> shrine). The old layout had a road every third row,
        // leaving 2-tile bands - no plot could hold a building. `openLanes` gives
        // the decorative lanes back to grass and each door gets its own spur.
        spineRows: [9], spineCols: [11], openLanes: true,
        buildings: [
            { key: 'home',    door: [4, 5],   spur: [4, 5, 4, 9] },
            { key: 'elder',   door: [15, 5],  spur: [15, 5, 15, 9], adopt: 'marahouse' },
            { key: 'shop',    door: [20, 5],  spur: [20, 5, 20, 9], adopt: 'shopdoor' },
            { key: 'forge',   door: [8, 8],   spur: [8, 8, 8, 9],
              line: 'The forge is cold, and has been for a season. Someone still sweeps it.' },
            { key: 'granary', door: [5, 15],  spur: [5, 15, 11, 15],
              line: 'Bare rafters. The grain went south with the last cart, and the cart never came back.' },
        ],
        moves: { to_home: [4, 5], well: [13, 12], v1: [8, 13], v2: [16, 13], v3: [19, 10], sign_n: [11, 4] },
    },
    3: {
        // The Old Root Shrine, 15x13. The approach runs down x=7 from the village
        // gate at (7,0); the stones, the root and Mara sit on that axis. The hall
        // therefore goes to the side, facing the ridge exit at (7,12).
        spineRows: [], spineCols: [], openLanes: false,
        buildings: [
            { key: 'shrine_hall', door: [10, 12], spur: [8, 12, 10, 12],
              line: 'The hall is older than the village and smaller than you expected. The root has been let inside the walls.' },
        ],
        moves: {},
    },
    4: {
        // The Ridge Track, 17x13. Two ruins frame the descent to the hollow mouth.
        spineRows: [], spineCols: [], openLanes: false,
        buildings: [
            { key: 'ruin', as: 'ruin_west', door: [3, 5],  spur: [3, 5, 6, 5],
              line: 'A chimney with no house under it. The hearthstone is still warm, which is not possible.' },
            { key: 'ruin', as: 'ruin_east', door: [13, 5], spur: [8, 5, 13, 5],
              line: 'Roof beams lie in the grass like ribs. Moss has been at them a long time.' },
        ],
        // lean_tree used to sit on the west spur
        moves: { lean_tree: [5, 6] },
    },
};

/* ------------------------------------------------------------------ helpers */
const TERM = { code: 0, indent: 0, parameters: [] };

const say = text => [
    { code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] },
    { code: 401, indent: 0, parameters: [text] },
    TERM,
];

function makePage({ imageName, list }) {
    return {
        conditions: {
            actorId: 1, actorValid: false, itemId: 1, itemValid: false,
            selfSwitchCh: 'A', selfSwitchValid: false,
            switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false,
            variableId: 1, variableValid: false, variableValue: 0,
        },
        directionFix: false,
        image: {
            tileId: 0, characterName: imageName ?? '', direction: 2,
            pattern: 0, characterIndex: 0,
        },
        list,
        moveFrequency: 3,
        moveRoute: { list: [TERM], repeat: true, skippable: false, wait: false },
        moveSpeed: 3,
        moveType: 0,
        priorityType: 1,
        stepAnime: false,
        through: false,
        trigger: 0,
        walkAnime: true,
    };
}

function ensureMaskSheet() {
    const ts = readData('Tilesets.json');
    const set = ts[1];
    let changed = false;
    if (set.tilesetNames[MASK_SLOT] !== MASK_SHEET) { set.tilesetNames[MASK_SLOT] = MASK_SHEET; changed = true; }
    if (set.flags[MASK_ID] !== MASK_FLAGS) { set.flags[MASK_ID] = MASK_FLAGS; changed = true; }
    if (changed) writeData('Tilesets.json', ts);
    return changed;
}

// strip the legacy translation decor everywhere, not just under the new footprints
function clearSlabs(map) {
    let n = 0;
    const area = map.width * map.height;
    for (let z = 1; z <= 3; z++) {
        for (let i = z * area; i < (z + 1) * area; i++) {
            if (LEGACY_DECOR.includes(map.data[i])) { map.data[i] = 0; n++; }
        }
    }
    return n;
}

function clearFootprint(map, x0, y0, w, h) {
    const { width, height, data } = map;
    let n = 0;
    for (let y = y0; y < y0 + h; y++) {
        for (let x = x0; x < x0 + w; x++) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            for (const z of [1, 2, 3]) {
                const i = (z * height + y) * width + x;
                if (data[i] !== 0 && data[i] !== MASK_ID) { data[i] = 0; n++; }
            }
        }
    }
    return n;
}

function paintMask(map, x0, y0, cover) {
    const { width, height, data } = map;
    let n = 0;
    for (let ty = 0; ty < cover.length; ty++) {
        for (let tx = 0; tx < cover[ty].length; tx++) {
            if (cover[ty][tx] < 0.15) continue;         // a transparent corner is not a wall
            const x = x0 + tx, y = y0 + ty;
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const i = height * width + y * width + x;   // z1
            if (data[i] !== MASK_ID) { data[i] = MASK_ID; n++; }
        }
    }
    return n;
}

function paintPath(map, x0, y0, x1, y1) {
    const { width, height, data } = map;
    let n = 0;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) {
            if (x < 0 || y < 0 || x >= width || y >= height) continue;
            const i = y * width + x;
            if (!isPath(data[i])) { data[i] = PATH; n++; }
        }
    }
    return n;
}

// A door is only a door if the player can stand on its front tile, and old maps
// had decor (a B-sheet bush) sitting on one of them. Decor lives above the ground
// layer, so painting a path underneath it changes nothing - the tile has to go.
function clearDecor(map, x, y) {
    const { width, height, data } = map;
    let n = 0;
    for (const z of [1, 2, 3]) {
        const i = (z * height + y) * width + x;
        if (data[i] !== 0) { data[i] = 0; n++; }
    }
    return n;
}

// Replica of Game_Map.checkPassage, so vista can refuse to ship a door nobody
// can reach without booting the engine first. The rule is not an AND across
// layers: the FIRST non-[*] tile from the top decides, and lower layers never
// get a say.
function firstMeaningfulFlags(map, flags, x, y) {
    const { width, height, data } = map;
    for (let z = 3; z >= 0; z--) {
        const f = flags[data[(z * height + y) * width + x]] ?? 0x10;
        if ((f & 0x10) !== 0) continue;
        return f;
    }
    return 0x10;
}

function openInnerLanes(map, spineRows, spineCols, keep) {
    let n = 0;
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
            if (spineRows.includes(y) || spineCols.includes(x)) continue;
            if (keep.has(`${x},${y}`)) continue;          // a spur is a road on purpose
            const i = y * map.width + x;
            if (!isPath(map.data[i])) continue;
            if (y === map.height - 1 && x >= 11 && x <= 12) continue;  // shrine exit stubs
            map.data[i] = GRASS; n++;
        }
    }
    return n;
}

const spurCells = spur => {
    const cells = new Set();
    const [x0, y0, x1, y1] = spur;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) cells.add(`${x},${y}`);
    }
    return cells;
};

/* -------------------------------------------------------------------- main */
const readData = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const writeData = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 1));

function buildMap(mapId, site, manifest, totals) {
    const file = `Map${String(mapId).padStart(3, '0')}.json`;
    const map = readData(file);
    const r = { cleared: 0, painted: 0, events: 0, adopted: 0, spurs: 0, moved: 0, lanes: 0 };
    r.slabs = clearSlabs(map);

    const keep = new Set();
    for (const b of site.buildings) for (const c of spurCells(b.spur)) keep.add(c);
    if (site.openLanes) r.lanes = openInnerLanes(map, site.spineRows, site.spineCols, keep);

    let nextId = Math.max(...map.events.filter(Boolean).map(e => e.id)) + 1;
    for (const b of site.buildings) {
        const info = manifest.buildings[b.key];
        if (!info) throw new Error(`no sprite for "${b.key}" - run tools/mz/buildings.py first`);
        const [doorX, doorY] = b.door;
        const [tw, th] = info.cellTiles;
        const evX = doorX, evY = doorY - 1;
        const x0 = evX - Math.floor((tw - 1) / 2);
        const y0 = evY - (th - 1);

        r.cleared += clearFootprint(map, x0, y0, tw, th);
        r.painted += paintMask(map, x0, y0, info.cover);
        r.spurs += paintPath(map, ...b.spur);
        r.cleared += clearDecor(map, doorX, doorY);

        // the interaction: adopt the old door event's commands, else write our own
        let list;
        if (b.adopt) {
            const src = map.events.find(e => e && e.name === b.adopt);
            if (src) {
                list = src.pages[0].list.slice();
                map.events[map.events.indexOf(src)] = null;
                r.adopted++;
            }
        }
        const name = `bldg_${b.as || b.key}`;
        if (!list) {
            const prior = map.events.find(e => e && e.name === name);
            list = prior ? prior.pages[0].list.slice() : say(b.line ?? 'The door is barred.');
        }

        const sheet = info.sheet.replace(/\.png$/i, '');   // MZ stores the name without extension
        const note = `vista | ${info.sheet} | ${tw}x${th} tiles from ${x0},${y0} | stand on ${doorX},${doorY}`;
        const page = makePage({ imageName: sheet, list });
        const existing = map.events.find(e => e && e.name === name);
        if (existing) {
            existing.x = evX; existing.y = evY; existing.note = note; existing.pages = [page];
        } else {
            map.events.push({ id: nextId++, name, note, x: evX, y: evY, pages: [page] });
        }
        r.events++;
    }

    for (const [name, [x, y]] of Object.entries(site.moves || {})) {
        const ev = map.events.find(e => e && e.name === name);
        if (!ev) throw new Error(`event "${name}" not found in ${file}`);
        if (ev.x !== x || ev.y !== y) { ev.x = x; ev.y = y; r.moved++; }
    }

    // MZ indexes $dataMap.events BY EVENT ID (Game_Event.initialize -> this.event()
    // -> $dataMap.events[this._eventId]), so the array must stay dense with
    // events[i].id === i and a null at 0. Removing an adopted door event therefore
    // leaves a null hole rather than shifting everything down - shifting is what
    // crashed Game_Map.setupEvents with "reading 'x'".
    if (map.events[0] !== null) throw new Error(`${file}: events[0] must be null`);
    for (let i = 1; i < map.events.length; i++) {
        const e = map.events[i];
        if (!e) continue;
        if (e.id !== i) throw new Error(`${file}: events[${i}].id = ${e.id}`);
    }

    // every door front tile must be walkable in all four directions
    const flags = readData('Tilesets.json')[map.tilesetId].flags;
    for (const b of site.buildings) {
        const [dx, dy] = b.door;
        const f = firstMeaningfulFlags(map, flags, dx, dy);
        if ((f & 0x0f) !== 0) {
            throw new Error(`${file}: door for "${b.as || b.key}" at ${dx},${dy} is not walkable (flags 0x${f.toString(16)})`);
        }
    }

    writeData(file, map);
    for (const k of ['cleared', 'painted', 'events', 'adopted', 'spurs', 'moved', 'lanes', 'slabs']) {
        totals[k] = (totals[k] || 0) + (r[k] || 0);
    }
    return r;
}

if (process.argv.includes('--check')) {
    const ts = readData('Tilesets.json')[1];
    console.log(`mask sheet : ${ts.tilesetNames[MASK_SLOT] || '(none)'}  flags[${MASK_ID}]=0x${ts.flags[MASK_ID].toString(16)}`);
    for (const id of Object.keys(SITES)) {
        const map = readData(`Map${String(id).padStart(3, '0')}.json`);
        const area = map.width * map.height;
        let mask = 0;
        for (let i = area; i < 2 * area; i++) if (map.data[i] === MASK_ID) mask++;
        const bldgs = map.events.filter(e => e && e.name.startsWith('bldg_'));
        console.log(`map ${id} ${map.displayName.padEnd(24)} ${bldgs.length} buildings, ${mask} mask cells :: ` +
            bldgs.map(b => `${b.name}@${b.x},${b.y}`).join(' '));
    }
} else {
    const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'buildings.json'), 'utf8'));
    const mask = ensureMaskSheet();
    const totals = {};
    for (const [id, site] of Object.entries(SITES)) buildMap(Number(id), site, manifest, totals);
    console.log(
        `vista: ${totals.events} buildings (${totals.adopted} doors adopted) | ${totals.painted} collision tiles | ` +
        `${totals.cleared} stale decor cleared | ${totals.slabs} old slabs removed | ` +
        `${totals.lanes} lane tiles -> grass | ${totals.spurs} spur tiles | ${totals.moved} events moved | ` +
        `tileset ${mask ? 'updated' : 'unchanged'}`);
}
