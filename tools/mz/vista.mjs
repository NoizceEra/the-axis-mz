/**
 * THE AXIS - village vista pass.
 *
 * Runs AFTER build.mjs (translation) and deepen.mjs (design). It owns the part
 * of the game that is layout rather than story: real buildings instead of tile
 * slabs, and the collision that makes them solid.
 *
 * Why a separate pass: build.mjs regenerates every map from the web build's ops,
 * so hand-edited tiles would be lost on the next rebuild. build -> deepen -> vista
 * always converges on the same map.
 *
 * Four mechanics, each checked against the shipped runtime:
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
 *    door events are adopted into the building page and removed - which is why
 *    running vista again after build.mjs picks them up again.
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
const GRASS = 1556;             // the A5 plain tile the whole ground layer uses
const PATH = 2912;              // A2 autotile kind 18 shape 0 - what the map uses
const OLD_SLAB = 4736;          // the 4x3 brick blocks this pass replaces
// 7520 is the other translation remnant: an Outside_C cell that renders as a
// solid black 48x48 square (80 of them sat on the village's top border and
// scattered through it). Neither id belongs to a real map, so both are cleared
// everywhere rather than only where a new building happens to land.
const LEGACY_DECOR = [OLD_SLAB, 7520];
const SPINE_ROWS = [9];
const SPINE_COLS = [11];

const readData = f => JSON.parse(fs.readFileSync(path.join(DATA, f), 'utf8'));
const writeData = (f, v) => fs.writeFileSync(path.join(DATA, f), JSON.stringify(v, null, 1));

/* ------------------------------------------------------------------ layout */
// door: [x, y] = the tile the player STANDS on. The building event sits at
// [x, y-1] and its sprite covers rows y-h .. y-1, centred on x.
// adopt: existing event whose command list becomes the building's interaction.
// line: used when there is no existing event to adopt.
//
// Ashhollow is 24x18 and has to keep two spine roads: y=9 (west <-> east) and
// x=11 (north <-> shrine). The old layout had a road every third row, leaving
// only 2-tile bands - no plot could hold a building. This pass returns the
// decorative inner lanes to grass and lays one spur per door to a spine road.
const VILLAGE = [
    { key: 'home',    door: [4, 5],   spur: [4, 5, 4, 9] },
    { key: 'elder',   door: [15, 5],  spur: [15, 5, 15, 9], adopt: 'marahouse' },
    { key: 'shop',    door: [20, 5],  spur: [20, 5, 20, 9], adopt: 'shopdoor' },
    { key: 'forge',   door: [8, 8],   spur: [8, 8, 8, 9],
      line: 'The forge is cold, and has been for a season. Someone still sweeps it.' },
    { key: 'granary', door: [5, 15],  spur: [5, 15, 11, 15],
      line: 'Bare rafters. The grain went south with the last cart, and the cart never came back.' },
];

// props whose position follows the layout
const MOVES = {
    to_home: [4, 5],
    well: [13, 12],
    v1: [8, 13],
    v2: [16, 13],
    v3: [19, 10],
    sign_n: [11, 4],
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
            if (data[i] !== PATH) { data[i] = PATH; n++; }
        }
    }
    return n;
}

// A door is only a door if the player can stand on its front tile, and the old
// map had decor (a B-sheet bush) sitting on one of them. Decor lives above the
// ground layer, so painting a path underneath it changes nothing - the tile
// itself has to go.
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

function openInnerLanes(map, keep = new Set()) {
    let n = 0;
    for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
            if (SPINE_ROWS.includes(y) || SPINE_COLS.includes(x)) continue;
            if (keep.has(`${x},${y}`)) continue;          // a spur is a road on purpose
            const i = y * map.width + x;
            if (map.data[i] !== PATH) continue;
            if (y === map.height - 1 && x >= 11 && x <= 12) continue;  // shrine exit stubs
            map.data[i] = GRASS; n++;
        }
    }
    return n;
}

const spurCells = (spur) => {
    const cells = new Set();
    const [x0, y0, x1, y1] = spur;
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) cells.add(`${x},${y}`);
    }
    return cells;
};

/* -------------------------------------------------------------------- main */
function build() {
    const manifest = JSON.parse(fs.readFileSync(path.join(HERE, 'buildings.json'), 'utf8'));
    const r = { mask: ensureMaskSheet(), slabs: 0, lanes: 0, cleared: 0, painted: 0,
                events: 0, adopted: 0, spurs: 0, moved: 0 };

    const map = readData('Map002.json');
    r.slabs = clearSlabs(map);
    const keep = new Set();
    for (const site of VILLAGE) for (const c of spurCells(site.spur)) keep.add(c);
    r.lanes = openInnerLanes(map, keep);

    let nextId = Math.max(...map.events.filter(Boolean).map(e => e.id)) + 1;
    for (const site of VILLAGE) {
        const info = manifest.buildings[site.key];
        if (!info) throw new Error(`no sprite for "${site.key}" - run tools/mz/buildings.py first`);
        const [doorX, doorY] = site.door;
        const [tw, th] = info.cellTiles;
        const evX = doorX, evY = doorY - 1;
        const x0 = evX - Math.floor((tw - 1) / 2);
        const y0 = evY - (th - 1);

        r.cleared += clearFootprint(map, x0, y0, tw, th);
        r.painted += paintMask(map, x0, y0, info.cover);
        r.spurs += paintPath(map, ...site.spur);
        r.cleared += clearDecor(map, doorX, doorY);       // the player has to be able to stand here

        // the interaction: adopt the old door event's commands, else write our own
        let list;
        if (site.adopt) {
            const src = map.events.find(e => e && e.name === site.adopt);
            if (src) {
                list = src.pages[0].list.slice();
                map.events[map.events.indexOf(src)] = null;
                r.adopted++;
            }
        }
        if (!list) {
            const prior = map.events.find(e => e && e.name === `bldg_${site.key}`);
            list = prior ? prior.pages[0].list.slice() : say(site.line ?? 'The door is barred.');
        }

        const name = `bldg_${site.key}`;
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

    for (const [name, [x, y]] of Object.entries(MOVES)) {
        const ev = map.events.find(e => e && e.name === name);
        if (!ev) throw new Error(`event "${name}" not found in Map002`);
        if (ev.x !== x || ev.y !== y) { ev.x = x; ev.y = y; r.moved++; }
    }

    // MZ indexes $dataMap.events BY EVENT ID (Game_Event.initialize ->
    // this.event() -> $dataMap.events[this._eventId]), so the array must stay
    // dense with events[i].id === i and a null at 0. Removing an adopted door
    // event therefore leaves a null hole rather than shifting everything down -
    // shifting is what crashed Game_Map.setupEvents with "reading 'x'".
    if (map.events[0] !== null) throw new Error('Map002 events[0] must be null');
    for (let i = 1; i < map.events.length; i++) {
        const e = map.events[i];
        if (!e) continue;
        if (e.id !== i) throw new Error(`event index/id mismatch: events[${i}].id = ${e.id}`);
    }

    // every door front tile must be walkable in all four directions, or the
    // building is decoration the player can never touch
    const flags = readData('Tilesets.json')[map.tilesetId].flags;
    for (const site of VILLAGE) {
        const [dx, dy] = site.door;
        const f = firstMeaningfulFlags(map, flags, dx, dy);
        if ((f & 0x0f) !== 0) {
            throw new Error(`door for "${site.key}" at ${dx},${dy} is not walkable (flags 0x${f.toString(16)})`);
        }
    }

    writeData('Map002.json', map);
    return r;
}

if (process.argv.includes('--check')) {
    const map = readData('Map002.json');
    const ts = readData('Tilesets.json')[1];
    const area = map.width * map.height;
    const bldgs = map.events.filter(e => e && e.name.startsWith('bldg_'));
    let maskCells = 0;
    for (let i = area; i < 2 * area; i++) if (map.data[i] === MASK_ID) maskCells++;
    console.log(`mask sheet : ${ts.tilesetNames[MASK_SLOT] || '(none)'}  flags[${MASK_ID}]=0x${ts.flags[MASK_ID].toString(16)}`);
    console.log(`buildings  : ${bldgs.length} -> ${bldgs.map(b => `${b.name}@${b.x},${b.y}`).join('  ')}`);
    console.log(`mask cells : ${maskCells} on z1`);
    console.log(`slabs left : ${map.data.filter(v => v === OLD_SLAB).length}`);
} else {
    const r = build();
    console.log(
        `vista: ${r.events} buildings (${r.adopted} doors adopted) | ${r.painted} collision tiles | ` +
        `${r.cleared} stale decor cleared | ${r.slabs} old slabs removed | ` +
        `${r.lanes} lane tiles -> grass | ${r.spurs} spur tiles | ${r.moved} events moved | ` +
        `tileset ${r.mask ? 'updated' : 'unchanged'}`);
}
