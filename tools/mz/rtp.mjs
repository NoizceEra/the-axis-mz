// THE AXIS — the RTP pass.
//
//   node tools/mz/rtp.mjs
//
// Repaints the 14 maps with real RPG Maker MZ RTP tiles instead of the
// generated 16x16 art: Outside / Inside / Dungeon tilesets, their genuine
// autotiles, genuine passage flags lifted from the donor database, and the
// RTP cast for characters and faces.
//
// The map *layouts* do not change — only the vocabulary. Every existing event,
// transfer, page and switch survives untouched; this pass rewrites layers and
// asset references only.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(ROOT, 'data');
const DONOR = 'D:/FOF/AI Games/RMMZ/BasherZ';
const WEB = 'D:/ai-studio/the-axis';

const { TILE_ART } = await import(pathToFileURL(path.join(WEB, 'js/art.js')).href);
const KINDS = Object.keys(TILE_ART);
const KIND_OF = {};                              // our generated id -> kind name
KINDS.forEach((k, i) => { KIND_OF[i + 1] = k; });

const readJ = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJ = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, '\t'), 'utf8');
const load = n => readJ(path.join(DATA, n));
const save = (n, v) => writeJ(path.join(DATA, n), v);

/* ============================ 1. SHEETS ============================ */

const SHEETS = [];
for (const prefix of ['Outside', 'Inside', 'Dungeon']) {
  for (const suffix of ['A1', 'A2', 'A3', 'A4', 'A5', 'B', 'C']) {
    const name = `${prefix}_${suffix}`;
    if (fs.existsSync(path.join(DONOR, 'img', 'tilesets', name + '.png'))) SHEETS.push(name);
  }
}
let copied = 0;
for (const name of SHEETS) {
  const dst = path.join(ROOT, 'img', 'tilesets', name + '.png');
  if (!fs.existsSync(dst)) {
    fs.copyFileSync(path.join(DONOR, 'img', 'tilesets', name + '.png'), dst);
    copied++;
  }
}

/* The RTP ships a .txt next to every sheet listing each tile's name in sheet
   order. That list is the authoritative id->name map, so the vocabulary below
   is read from the RTP itself instead of guessed from pixel inspection. */
function names(prefix, sheet) {
  const p = path.join(DONOR, 'img', 'tilesets', `${prefix}_${sheet}.txt`);
  if (!fs.existsSync(p)) return [];
  return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)
    .map(l => l.split('|')[0].trim()).filter(Boolean);
}
const BASE = { A1: 2048, A2: 2816, A3: 4352, A4: 5888, A5: 1536, B: 0, C: 256, D: 512, E: 768 };
function idOf(prefix, sheet, index) {
  return BASE[sheet] + (['A1', 'A2', 'A3', 'A4'].includes(sheet) ? index * 48 : index);
}
function findTile(prefix, sheet, pattern) {
  const list = names(prefix, sheet);
  const i = list.findIndex(n => pattern.test(n));
  if (i < 0) throw new Error(`RTP ${prefix}_${sheet}: no tile matching ${pattern}`);
  return { id: idOf(prefix, sheet, i), name: list[i] };
}

/* ============================ 2. VOCABULARY ============================ */
// Ground goes on layer 0; objects on layer 1 so they draw over the ground.

const OUT = {
  grass:       findTile('Outside', 'A5', /^Meadow$/),
  grass2:      findTile('Outside', 'A5', /^Meadow A$/),
  path:        findTile('Outside', 'A2', /^Road \(Meadow\)$/),
  dirt:        findTile('Outside', 'A2', /^Dirt \(Meadow\)$/),
  ridgepath:   findTile('Outside', 'A2', /^Road \(Dirt\)$/),
  cockles:     findTile('Outside', 'A5', /^Cobblestones A$/),
  water:       findTile('Outside', 'A1', /^Water A \(Meadow\)$/),
  marshwater:  findTile('Outside', 'A1', /^Swamp Grass A$/),
  marsh:       findTile('Outside', 'A1', /^Poison Swamp$/),
  snow:        findTile('Outside', 'A2', /^Snow$/),
  fissure:     findTile('Outside', 'A2', /^Fissures$/),
  darkness:    findTile('Outside', 'A5', /^Darkness$/),
  wallWood:    findTile('Outside', 'A3', /^Outer Wall E \(Wood\)$/),
  wallStone:   findTile('Outside', 'A3', /^Outer Wall A \(Rock Wall\)$/),
  roofThatch:  findTile('Outside', 'A3', /^Roof L \(Thatched\)$/),
  hedge:       findTile('Outside', 'A4', /^Wall I \(Hedge\)$/),
  forest:      findTile('Outside', 'A4', /^Forest A$/),
  tree:        findTile('Outside', 'B', /^Tree$/),
  bushTile:    findTile('Outside', 'B', /^Bush$/),
  rock:        findTile('Outside', 'B', /^Boulder A$/),
  rocks:       findTile('Outside', 'B', /^Rocks$/),
  flowers:     findTile('Outside', 'B', /^Flowers A$/),
  well:        findTile('Outside', 'B', /^Well$/),
  sign:        findTile('Outside', 'B', /^Sign A$/),
  window:      findTile('Outside', 'B', /^Window A$/),
  deadGrass:   findTile('Outside', 'B', /^Dead Grass A$/),
  caveMouth:   findTile('Outside', 'C', /^Cave Entrance$/)
};

const IN = {
  floor:       findTile('Inside', 'A2', /^Ground A \(Wood Floor Stripe\)$/),
  floor2:      findTile('Inside', 'A2', /^Ground E \(Wood Floor Border\)$/),
  stoneFloor:  findTile('Inside', 'A2', /^Ground B \(Stone Floor Tile\)$/),
  carpet:      findTile('Inside', 'A2', /^Rug A \(Red Flower\)$/),
  wall:        findTile('Inside', 'A4', /^Wall H \(Wood\)$/),
  wallPlaster: findTile('Inside', 'A4', /^Interior Wall B \(Plaster\)$/),
  table:       findTile('Inside', 'B', /^Table A$/),
  window:      findTile('Inside', 'B', /^Window A$/),
  stairsUp:    findTile('Inside', 'B', /^Stairs A \(Up\)$/),
  fireplace:   findTile('Inside', 'A2', /^Hole A \(Orange Cave\)$/),
  water:       findTile('Inside', 'A1', /^Water A$/)
};

const DUN = {
  floorDirt:   findTile('Dungeon', 'A2', /^Ground A \(Dirt Cave\)$/),
  floorRock:   findTile('Dungeon', 'A2', /^Ground C \(Rock Cave\)$/),
  floorCrystal:findTile('Dungeon', 'A2', /^Ground D \(Crystal\)$/),
  floorBody:   findTile('Dungeon', 'A2', /^Ground F \(In Body\)$/),
  darkGround:  findTile('Dungeon', 'A2', /^Dark Ground A \(Dirt Cave\)$/),
  mossGround:  findTile('Dungeon', 'A2', /^Moss on Ground$/),
  cracks:      findTile('Dungeon', 'A2', /^Ground Cracks$/),
  wallDirt:    findTile('Dungeon', 'A4', /^Wall A \(Dirt Cave\)$/),
  wallRock:    findTile('Dungeon', 'A4', /^Wall B \(Rock Cave\)$/),
  wallBody:    findTile('Dungeon', 'A4', /^Wall G \(In Body\)$/),
  wallMoss:    findTile('Dungeon', 'A4', /^Wall M \(Moss\)$/),
  darkness:    findTile('Dungeon', 'A5', /^Darkness$/),
  crystal:     findTile('Dungeon', 'B', /^Crystal$/),
  smallCrystal:findTile('Dungeon', 'B', /^Small Crystals$/),
  boulder:     findTile('Dungeon', 'B', /^Boulder A \(Dirt Cave\)$/),
  gravel:      findTile('Dungeon', 'B', /^Gravel A \(Dirt Cave\)$/),
  tallRock:    findTile('Dungeon', 'B', /^Tall Rock A \(Dirt Cave\)$/),
  bracing:     findTile('Dungeon', 'B', /^Wall Bracing$/)
};

// kind -> { ground, object } per map context
const MAP_TILESET = {
  1: 'inside', 2: 'outside', 3: 'outside', 4: 'outside',
  5: 'dungeon', 6: 'dungeon', 7: 'dungeon', 8: 'dungeon',
  9: 'outside', 10: 'dungeon', 11: 'outside', 12: 'outside',
  13: 'dungeon', 14: 'dungeon'
};

function paint(kind, ctx, aboveIsSame) {
  const g = (t) => t.id;
  if (ctx === 'outside') {
    switch (kind) {
      case 'grass': case 'flowers': case 'platform':
        return { ground: g(OUT.grass) };
      // reeds and corrupted growth stay walkable: making them solid stranded
      // three marsh events (keeper, push stone, the half-sunk tree), and an open
      // swamp edge costs nothing because MZ already stops the player leaving a map
      case 'reeds': return { ground: g(OUT.marshwater) };
      case 'growth': return { ground: g(OUT.grass) };
      case 'grass2': return { ground: g(OUT.grass2) };
      case 'path': return { ground: g(OUT.path) };
      case 'ridgepath': return { ground: g(OUT.ridgepath) };
      case 'circlestone': return { ground: g(OUT.cockles) };
      case 'scree': return { ground: g(OUT.cockles) };
      case 'water': case 'channel': return { ground: g(OUT.water) };
      case 'marsh': return { ground: g(OUT.marsh) };
      case 'marshwater': return { ground: g(OUT.marshwater) };
      case 'snow': case 'ice': case 'iceblock': return { ground: g(OUT.snow) };
      case 'ash': return { ground: g(OUT.fissure) };
      case 'drygrass': return { ground: g(OUT.dirt), object: OUT.deadGrass.id };
      case 'hollowvoid': return { ground: g(OUT.darkness) };
      case 'wall':
        return { ground: g(OUT.grass), object: aboveIsSame ? OUT.wallWood.id : OUT.roofThatch.id };
      case 'iwall': return { ground: g(OUT.grass), object: OUT.wallStone.id };
      case 'tree': return { ground: g(OUT.grass), object: OUT.tree.id };
      case 'rock': return { ground: g(OUT.grass), object: OUT.rock.id };
      case 'cairn': case 'debris': case 'rootbarrier': case 'vent': case 'pushstone':
        return { ground: g(OUT.grass), object: OUT.rocks.id };
      case 'well': return { ground: g(OUT.grass), object: OUT.well.id };
      case 'sign': return { ground: g(OUT.grass), object: OUT.sign.id };
      case 'pit': return { ground: g(OUT.fissure) };
      case 'bed': return { ground: g(OUT.grass) };
      case 'table': return { ground: g(OUT.grass), object: OUT.bushTile.id };
      case 'counter': return { ground: g(OUT.grass), object: OUT.bushTile.id };
      case 'sap': return { ground: g(OUT.grass) };
      case 'livingwood': return { ground: g(OUT.ridgepath) };
      case 'shrinestone': return { ground: g(OUT.cockles) };
      case 'shrinecrack': return { ground: g(OUT.fissure) };
      case 'rootfloor': case 'deepfloor': case 'trunkfloor': return { ground: g(OUT.forest.id >= 0 ? OUT.grass : OUT.grass) };
      case 'rootwall': case 'deepwall': case 'trunkwall': return { ground: g(OUT.grass), object: OUT.hedge.id };
      case 'ifloor': case 'floor': return { ground: g(OUT.grass) };
      case 'pitfloor': return { ground: g(OUT.dirt) };
      default: return { ground: g(OUT.grass) };
    }
  }
  if (ctx === 'inside') {
    switch (kind) {
      case 'floor': case 'ifloor': return { ground: g(IN.floor) };
      case 'grass': case 'grass2': case 'path': return { ground: g(IN.floor2) };
      case 'wall': case 'iwall': return { ground: g(IN.floor), object: IN.wall.id };
      case 'counter': return { ground: g(IN.floor), object: IN.table.id };
      case 'table': return { ground: g(IN.floor), object: IN.table.id };
      case 'bed': return { ground: g(IN.floor), object: IN.table.id };
      case 'well': return { ground: g(IN.floor), object: IN.fireplace.id };
      case 'sign': return { ground: g(IN.floor), object: IN.window.id };
      case 'water': case 'channel': return { ground: g(IN.water) };
      case 'rock': case 'cairn': return { ground: g(IN.stoneFloor) };
      case 'flowers': return { ground: g(IN.carpet) };
      default: return { ground: g(IN.floor) };
    }
  }
  // dungeon
  switch (kind) {
    case 'rootfloor': case 'pitfloor': return { ground: g(DUN.floorDirt) };
    case 'deepfloor': return { ground: g(DUN.floorRock) };
    case 'trunkfloor': return { ground: g(DUN.floorBody) };
    case 'platform': return { ground: g(DUN.floorCrystal) };
    case 'floor': case 'ifloor': return { ground: g(DUN.floorRock) };
    case 'grass': case 'grass2': return { ground: g(DUN.mossGround) };
    case 'path': case 'ridgepath': return { ground: g(DUN.floorDirt) };
    case 'rootwall': return { ground: g(DUN.floorDirt), object: DUN.wallDirt.id };
    case 'deepwall': return { ground: g(DUN.floorRock), object: DUN.wallRock.id };
    case 'trunkwall': return { ground: g(DUN.floorBody), object: DUN.wallBody.id };
    case 'wall': case 'iwall': return { ground: g(DUN.floorDirt), object: DUN.wallMoss.id };
    case 'hollowvoid': return { ground: g(DUN.darkness) };
    case 'sap': return { ground: g(DUN.floorDirt), object: DUN.smallCrystal.id };
    case 'livingwood': return { ground: g(DUN.floorBody), object: DUN.crystal.id };
    case 'rock': case 'cairn': case 'pushstone': return { ground: g(DUN.floorDirt), object: DUN.boulder.id };
    case 'debris': case 'scree': return { ground: g(DUN.floorDirt), object: DUN.gravel.id };
    case 'rootbarrier': case 'vent': return { ground: g(DUN.floorDirt), object: DUN.bracing.id };
    case 'channel': case 'water': return { ground: g(DUN.floorRock) };
    case 'ash': return { ground: g(DUN.cracks) };
    case 'snow': case 'ice': case 'iceblock': return { ground: g(DUN.darkGround) };
    case 'shrinestone': case 'shrinecrack': return { ground: g(DUN.floorCrystal) };
    case 'well': return { ground: g(DUN.floorDirt), object: DUN.tallRock.id };
    case 'sign': return { ground: g(DUN.floorDirt), object: DUN.bracing.id };
    case 'tree': return { ground: g(DUN.floorDirt), object: DUN.tallRock.id };
    case 'table': case 'counter': case 'bed': case 'flowers': case 'growth': case 'reeds':
      return { ground: g(DUN.mossGround) };
    case 'pit': return { ground: g(DUN.darkness) };
    default: return { ground: g(DUN.floorDirt) };
  }
}

/* ============================ 3. METADATA ============================ */

const donorTilesets = readJ(path.join(DONOR, 'data', 'Tilesets.json'));
const byName = {};
for (const t of donorTilesets) if (t && t.name) byName[t.name] = t;
const tilesets = [null];
const TILESET_ID = { outside: 1, inside: 2, dungeon: 3 };
for (const [key, donorName, label] of [['outside', 'Outside', 'AXIS OUTSIDE'],
                                       ['inside', 'Inside', 'AXIS INSIDE'],
                                       ['dungeon', 'Dungeon', 'AXIS DUNGEON']]) {
  const src = byName[donorName];
  if (!src) throw new Error('donor tileset missing: ' + donorName);
  tilesets.push({ ...src, id: TILESET_ID[key], name: label, note: 'RTP ' + donorName });
}
/* Passage overrides.
   RTP scenery in the B sheet is often flagged "star" (0x10, drawn above the
   player) but NOT impassable — 157 'Tree' is 0x610, 8 'Streetlight A' is 0x610.
   Placed as map features they must block, exactly as the editor's passage tab
   would be ticked. Anything we paint as an obstacle gets 0x0F; decorative
   tiles (flowers, grass, roads) keep the RTP flags untouched. */
const OBSTACLES_OUT = [OUT.tree, OUT.forest, OUT.hedge, OUT.wallWood, OUT.wallStone,
  OUT.roofThatch, OUT.rock, OUT.rocks, OUT.well, OUT.sign, OUT.bushTile];
const OBSTACLES_IN = [IN.wall, IN.wallPlaster, IN.table];
const OBSTACLES_DUN = [DUN.wallDirt, DUN.wallRock, DUN.wallBody, DUN.wallMoss,
  DUN.boulder, DUN.tallRock, DUN.bracing, DUN.crystal];
const bump = (idx, list) => {
  for (const t of list) if (t && tilesets[idx] && tilesets[idx].flags[t.id] !== undefined) {
    tilesets[idx].flags[t.id] |= 0x0f;
  }
};
bump(1, OBSTACLES_OUT);
bump(2, OBSTACLES_IN);
bump(3, OBSTACLES_DUN);
// the props we scatter that came straight from the B sheet
const PROP_OBSTACLES = [/^Barrel$/, /^Crate A$/, /^Stump$/, /^Bush$/, /^Streetlight A$/];
for (const re of PROP_OBSTACLES) {
  const t = findTile('Outside', 'B', re);
  tilesets[1].flags[t.id] |= 0x0f;
}

save('Tilesets.json', tilesets);

/* ============================ 4. REPAINT ============================ */

// The generated source layers are snapshotted once (they are the layout truth);
// every run repaints from the snapshot, so this pass is safe to re-run and the
// generated art can always be restored by deleting the snapshot.
const SNAPSHOT = path.join(HERE, 'source-layers.json');
const snapshot = fs.existsSync(SNAPSHOT) ? readJ(SNAPSHOT) : {};
let snapAdded = 0;
const report = [];
for (const mapId of Object.keys(MAP_TILESET).map(Number)) {
  const file = 'Map' + String(mapId).padStart(3, '0') + '.json';
  const map = load(file);
  const ctx = MAP_TILESET[mapId];
  const w = map.width, h = map.height;
  // take the snapshot only from a map that is still in generated form
  const looksGenerated = map.data.some(t => t > 0 && t <= 63);
  if (!snapshot[mapId] && looksGenerated) {
    snapshot[mapId] = Array.from(map.data.slice(0, w * h));   // layer 0 only
    snapAdded++;
  }
  const src = snapshot[mapId] || map.data.slice(0, w * h);
  const kindAt = (x, y) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return null;
    const id = src[y * w + x];
    const k = id ? KIND_OF[id] : null;
    // The East Marsh's "trees" are half-sunk stumps in standing water: they read
    // as reeds and stay walkable, otherwise the keeper, the push stone and the
    // drowned tree itself end up sealed inside scenery.
    if (mapId === 11 && k === 'tree') return 'reeds';
    return k;
  };
  const data = new Array(w * h * 6).fill(0);
  const set = (x, y, id, layer) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    data[((layer || 0) * h + y) * w + x] = id;
  };
  const kindGrid = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) kindGrid.push(kindAt(x, y));
  }
  const K = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? null : kindGrid[y * w + x];

  /* --- 1. ground everywhere, with the simple one-tile objects --- */
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = K(x, y);
      if (!k) continue;
      const p = paint(k, ctx, K(x, y - 1) === k);
      set(x, y, p.ground, 0);
      if (p.object) set(x, y, p.object, 1);
    }
  }

  /* --- 2. buildings --- */
  // A 'wall' block from the abstract layout is a house footprint. Repaint each
  // connected block as a real RTP building: roof rows, a wall row, windows, and
  // a door where the layout put one.
  if (ctx === 'outside') {
    const seen = new Set();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (K(x, y) !== 'wall' || seen.has(y * w + x)) continue;
        const stack = [[x, y]], cells = [];
        seen.add(y * w + x);
        let x0 = x, x1 = x, y0 = y, y1 = y;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          cells.push([cx, cy]);
          x0 = Math.min(x0, cx); x1 = Math.max(x1, cx);
          y0 = Math.min(y0, cy); y1 = Math.max(y1, cy);
          for (const [nx, ny] of [[cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1]]) {
            if (K(nx, ny) !== 'wall') continue;
            const key2 = ny * w + nx;
            if (seen.has(key2)) continue;
            seen.add(key2);
            stack.push([nx, ny]);
          }
        }
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        for (const [cx, cy] of cells) {
          const rowsFromBottom = y1 - cy;
          if (bh >= 3 && rowsFromBottom >= 1) {
            set(cx, cy, OUT.roofThatch.id, 1);          // roof above the wall course
          } else {
            set(cx, cy, OUT.wallWood.id, 1);            // the wall course itself
          }
        }
        if (bw >= 3) {
          // windows either side of the door, door in the middle of the wall row
          if (bw >= 4) {
            set(x0 + 1, y1, OUT.window.id, 1);
            set(x1 - 1, y1, OUT.window.id, 1);
          }
          // a doorway reads as a recessed bay, not a black hole
          set(x0 + Math.floor(bw / 2), y1, OUT.wallWood.id, 1);
          set(x0 + Math.floor(bw / 2), y1 - 1, OUT.window.id, 1);
        }
      }
    }
  }

  /* --- 3. tree masses read as forest, lone trees as single trees --- */
  if (ctx === 'outside' || ctx === 'dungeon') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (K(x, y) !== 'tree') continue;
        const neighbours = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
          .filter(([nx, ny]) => K(nx, ny) === 'tree').length;
        if (neighbours >= 1 && ctx === 'outside') {
          set(x, y, OUT.forest.id, 1);                  // canopy autotile, blends with itself
        } else if (ctx === 'outside') {
          set(x, y, OUT.tree.id, 1);
        }
      }
    }
  }

  /* --- 3b. roadside props, deterministic so a rebuild is identical --- */
  if (ctx === 'outside') {
    const hash = (x, y) => ((x * 73856093) ^ (y * 19349663)) >>> 0;
    const PROP = {
      flowers: findTile('Outside', 'B', /^Flowers A$/).id,
      flowers2: findTile('Outside', 'B', /^Flowers C$/).id,
      barrel: findTile('Outside', 'B', /^Barrel$/).id,
      crate: findTile('Outside', 'B', /^Crate A$/).id,
      stump: findTile('Outside', 'B', /^Stump$/).id,
      bush: findTile('Outside', 'B', /^Bush$/).id,
      lamp: findTile('Outside', 'B', /^Streetlight A$/).id
    };
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (K(x, y) !== 'grass') continue;
        const nearPath = [[1, 0], [-1, 0], [0, 1], [0, -1]]
          .some(([dx, dy]) => K(x + dx, y + dy) === 'path');
        if (!nearPath) continue;
        const roll = hash(x, y) % 100;
        if (roll < 14) set(x, y, PROP.flowers, 1);
        else if (roll < 18) set(x, y, PROP.flowers2, 1);
        else if (roll < 21) set(x, y, PROP.bush, 1);
        else if (roll < 23) set(x, y, PROP.stump, 1);
        else if (roll < 25) set(x, y, PROP.crate, 1);
        else if (roll < 26) set(x, y, PROP.barrel, 1);
      }
    }
    // a lamp either side of the crossroads, if the layout has one
    for (const [lx, ly] of [[w / 2 | 0, h / 2 | 0], [w / 2 + 2 | 0, h / 2 | 0]]) {
      if (K(lx, ly) === 'grass' && K(lx, ly - 1) === 'grass') set(lx, ly, PROP.lamp, 1);
    }
  }

  /* --- 4. dense rock reads as a cliff wall, sparse rock as boulders --- */
  if (ctx === 'outside') {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (K(x, y) !== 'rock') continue;
        const neighbours = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]
          .filter(([nx, ny]) => K(nx, ny) === 'rock').length;
        set(x, y, neighbours >= 2 ? OUT.wallStone.id : OUT.rock.id, 1);
      }
    }
  }

  /* --- 5. reachability repair ---
     Proper collision (RTP trees and walls now block) can strand an interactable
     that the abstract layout left next to walkable scenery. Every action-button
     event must have at least one reachable neighbouring tile: clear the object
     layer there and drop a known-walkable ground tile. */
  {
    const flags = tilesets[TILESET_ID[ctx]].flags;
    const BIT = { 2: 0x01, 4: 0x02, 6: 0x04, 8: 0x08 };
    const BACK = { 2: 8, 8: 2, 4: 6, 6: 4 };
    const pass = (x, y, dir) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return false;
      for (let z = 0; z < 4; z++) {
        const t = data[(z * h + y) * w + x];
        if (!t) continue;
        const f = flags[t];
        if (f === undefined) continue;
        if ((f & 0x0f) !== 0 && (f & BIT[dir]) !== 0) return false;
      }
      return true;
    };
    const GROUND = { outside: OUT.grass.id, inside: IN.floor.id, dungeon: DUN.floorDirt.id };
    const DIRS = [[0, 1, 2], [-1, 0, 4], [1, 0, 6], [0, -1, 8]];
    let start = null;
    for (let y = 1; y < h - 1 && !start; y++) {
      for (let x = 1; x < w - 1; x++) if (pass(x, y, 2) && pass(x, y, 8)) { start = [x, y]; break; }
    }
    let repairs = 0;
    if (start) {
      for (let iter = 0; iter < 30; iter++) {
        const seen = new Set([start.join(',')]);
        const q = [start];
        while (q.length) {
          const [x, y] = q.shift();
          for (const [dx, dy, dir] of DIRS) {
            const nx = x + dx, ny = y + dy;
            if (!pass(x, y, dir) || !pass(nx, ny, BACK[dir])) continue;
            const k = nx + ',' + ny;
            if (seen.has(k)) continue;
            seen.add(k); q.push([nx, ny]);
          }
        }
        let fixed = false;
        for (const ev of map.events) {
          if (!ev) continue;
          const action = ev.pages.some(pg => pg.trigger === 0 && pg.list.some(c => c.code !== 0));
          if (!action) continue;
          const nbrs = DIRS.map(([dx, dy]) => [ev.x + dx, ev.y + dy])
            .filter(([nx, ny]) => nx > 0 && ny > 0 && nx < w - 1 && ny < h - 1);
          if (nbrs.some(([nx, ny]) => seen.has(nx + ',' + ny))) continue;
          const spot = nbrs.find(([nx, ny]) => data[(1 * h + ny) * w + nx] === 0) || nbrs[0];
          if (!spot) continue;
          data[(1 * h + spot[1]) * w + spot[0]] = 0;
          data[(2 * h + spot[1]) * w + spot[0]] = 0;
          data[(0 * h + spot[1]) * w + spot[0]] = GROUND[ctx];
          repairs++;
          fixed = true;
        }
        if (!fixed) break;
      }
    }
    if (repairs) report.repairs = (report.repairs || 0) + repairs;
  }

  map.data = data;
  map.tilesetId = TILESET_ID[ctx];
  // battle maps get their backdrop from the RTP too
  if ([5, 6, 8, 13].includes(mapId)) {
    map.specifyBattleback = true;
    map.battleback1Name = 'DirtCave';
    map.battleback2Name = 'DarkSpace';
  }
  save(file, map);
  const used = new Set(data.filter(t => t));
  report.push({ mapId, ctx, tiles: used.size });
}

/* ============================ 5. CAST ============================ */

// RTP character sheets are 8 sprites each (index 0..7); faces are 4x2 per sheet.
const CAST = {
  Wren:          { char: 'Actor1', index: 0, face: 'Actor1',  faceIndex: 0 },
  'Elder Mara':  { char: 'People4', index: 2, face: 'People4', faceIndex: 2 },
  Vela:          { char: 'People1', index: 0, face: 'People1', faceIndex: 0 },
  Ospen:         { char: 'People2', index: 0, face: 'People2', faceIndex: 0 },
  Nell:          { char: 'People3', index: 1, face: 'People3', faceIndex: 1 },
  Halder:        { char: 'People2', index: 3, face: 'People2', faceIndex: 3 },
  'North Keeper':{ char: 'People4', index: 5, face: 'People4', faceIndex: 5 },
  'East Keeper': { char: 'People1', index: 5, face: 'People1', faceIndex: 5 },
  'West Keeper': { char: 'People3', index: 5, face: 'People3', faceIndex: 5 },
  'Root-Tender': { char: 'Nature',  index: 0, face: 'Nature',  faceIndex: 0 },
  Caretaker:     { char: 'Monster', index: 0, face: 'Monster', faceIndex: 0 }
};
// event sprite sheets (the port named them $axis_<who>.png)
const SPRITE_CAST = {
  player:      { char: 'Actor1',  index: 0 },
  mara:        { char: 'People4', index: 2 },
  vela:        { char: 'People1', index: 0 },
  villager1:   { char: 'People2', index: 0 },
  villager2:   { char: 'People3', index: 1 },
  villager3:   { char: 'People2', index: 3 },
  keeperN:     { char: 'People4', index: 5 },
  keeperE:     { char: 'People1', index: 5 },
  keeperW:     { char: 'People3', index: 5 },
  remnant:     { char: 'Nature',  index: 0 },
  elder_shade: { char: 'Monster', index: 0 }
};
const sheetsNeeded = new Set(), facesNeeded = new Set();
for (const c of Object.values(CAST)) { sheetsNeeded.add(c.char); facesNeeded.add(c.face); }
for (const c of Object.values(SPRITE_CAST)) sheetsNeeded.add(c.char);
let castCopied = 0;
for (const [dir, set] of [['characters', sheetsNeeded], ['faces', facesNeeded]]) {
  for (const name of set) {
    const src = path.join(DONOR, 'img', dir, name + '.png');
    if (!fs.existsSync(src)) continue;
    const dst = path.join(ROOT, 'img', dir, name + '.png');
    if (!fs.existsSync(dst)) { fs.copyFileSync(src, dst); castCopied++; }
  }
}

const oldFaceToName = {                       // what the deepen pass wrote
  axis_faces: null, axis_folk: null
};
let charFixed = 0, faceFixed = 0;
const speakerOf = new Map();                  // sheet+index -> speaker, from the old manifests
for (const f of ['faces-manifest.json']) {
  const p = path.join(HERE, f);
  if (!fs.existsSync(p)) continue;
  const m = readJ(p);
  for (const [speaker, v] of Object.entries(m.faces)) {
    const idx = typeof v === 'number' ? v : v.index;
    const sheet = typeof v === 'number' ? m.sheet : v.sheet;
    speakerOf.set(sheet + ':' + idx, speaker);
  }
}

for (const mapId of Object.keys(MAP_TILESET).map(Number)) {
  const file = 'Map' + String(mapId).padStart(3, '0') + '.json';
  const map = load(file);
  let touched = false;
  for (const ev of map.events) {
    if (!ev) continue;
    for (const page of ev.pages) {
      // character sprite
      const cn = page.image.characterName;
      if (cn && cn.startsWith('$axis_')) {
        const c = SPRITE_CAST[cn.slice('$axis_'.length)];
        if (c) {
          page.image.characterName = c.char;
          page.image.characterIndex = c.index;
          charFixed++;
          touched = true;
        }
      }
      // dialogue face
      for (const cmd of page.list) {
        if (cmd.code !== 101) continue;
        const sheet = cmd.parameters[0], idx = cmd.parameters[1];
        const speaker = (cmd.parameters[4] || '').trim() || speakerOf.get(sheet + ':' + idx) || '';
        const c = CAST[speaker];
        if (c) {
          cmd.parameters[0] = c.face;
          cmd.parameters[1] = c.faceIndex;
          faceFixed++;
          touched = true;
        }
      }
    }
  }
  if (touched) save(file, map);
}

if (snapAdded) writeJ(SNAPSHOT, snapshot);

// RTP battlebacks for the maps that can start a fight
let bbCopied = 0;
for (const [dir, name] of [['battlebacks1', 'DirtCave'], ['battlebacks2', 'DarkSpace']]) {
  const src = path.join(DONOR, 'img', dir, name + '.png');
  const dst = path.join(ROOT, 'img', dir, name + '.png');
  if (fs.existsSync(src) && !fs.existsSync(dst)) {
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
    bbCopied++;
  }
}

// The player is drawn from the actor record, not from an event page, so its
// character sheet has to be swapped here too (faces already point at RTP).
{
  const actors = load('Actors.json');
  const a = actors[1];
  if (a && (String(a.characterName).startsWith('$axis_') || String(a.characterName).startsWith('$lf_'))) {
    const c = SPRITE_CAST.player;
    a.characterName = c.char;
    a.characterIndex = c.index;
    a.faceName = CAST.Wren.face;
    a.faceIndex = CAST.Wren.faceIndex;
    save('Actors.json', actors);
  }
}

/* ============================ REPORT ============================ */

console.log(`${copied} RTP tileset sheets copied · ${castCopied} RTP character/face sheets copied`);
console.log(`${tilesets.length - 1} tilesets: ${tilesets.filter(Boolean).map(t => t.id + '=' + t.name).join(', ')}`);
for (const r of report) console.log(`  map ${String(r.mapId).padStart(2)} ${r.ctx.padEnd(8)} ${r.tiles} distinct RTP tiles`);
console.log(`${charFixed} event sprites and ${faceFixed} dialogue faces now use RTP art`);
console.log(`${bbCopied} battlefield backdrops copied · source layer snapshot: ${snapAdded} map(s) captured`);
console.log(`${report.repairs || 0} tiles cleared so every interactable stays reachable`);
console.log(`vocabulary: ${Object.keys(OUT).length} outdoor + ${Object.keys(IN).length} interior + ${Object.keys(DUN).length} dungeon named tiles`);
