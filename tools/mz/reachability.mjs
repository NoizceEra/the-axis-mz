// THE AXIS — offline passage + reachability check against the real tileset flags.
//
//   node tools/mz/reachability.mjs
//
// RTP flags are bitfields and RTP scenery is not impassable by default, so a
// repaint can silently wall the player in or strand an interactable. This walks
// each map the way Game_Map.checkPassage does and proves what can be reached.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(ROOT, 'data');
const load = n => JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8'));

const system = load('System.json');
const tilesets = load('Tilesets.json');
const mapInfos = load('MapInfos.json').filter(Boolean);

const DIRS = [[0, 1, 2], [-1, 0, 4], [1, 0, 6], [0, -1, 8]];   // [dx, dy, direction]
const BIT = { 2: 0x01, 4: 0x02, 6: 0x04, 8: 0x08 };

function makeChecker(map) {
  const flags = tilesets[map.tilesetId].flags;
  const w = map.width, h = map.height, d = map.data;
  const all = (x, y) => [0, 1, 2, 3].map(z => d[(z * h + y) * w + x]).filter(t => t);
  // MZ: Game_Map.checkPassage — a tile blocks a direction when it has any
  // impassable bits AND the bit for that direction.
  const passable = (x, y, dir) => {
    if (x < 0 || y < 0 || x >= w || y >= h) return false;
    const bit = BIT[dir];
    for (const tile of all(x, y)) {
      const f = flags[tile];
      if (f === undefined) continue;
      if ((f & 0x0f) !== 0 && (f & bit) !== 0) return false;
    }
    return true;
  };
  return { passable, w, h };
}

const problems = [];
let mapsChecked = 0, interactables = 0, unreachable = 0;

for (const info of mapInfos) {
  const map = load('Map' + String(info.id).padStart(3, '0') + '.json');
  const { passable, w, h } = makeChecker(map);
  mapsChecked++;

  // start: the map's first transfer target, else the system start, else scan
  let start = null;
  if (info.id === system.startMapId) start = [system.startX, system.startY];
  if (!start) {
    outer: for (const ev of map.events) {
      if (!ev) continue;
      for (const page of ev.pages) {
        for (const c of page.list) {
          if (c.code === 201 && c.parameters[1] === info.id) { start = [c.parameters[2], c.parameters[3]]; break outer; }
        }
      }
    }
  }
  if (!start) {
    for (let y = 0; y < h && !start; y++) for (let x = 0; x < w; x++) if (passable(x, y, 2)) { start = [x, y]; break; }
  }
  if (!start) { problems.push(`map ${info.id}: no walkable start tile`); continue; }

  // BFS over walkable cells (4-way, respecting per-direction flags both ways)
  const seen = new Set([start.join(',')]);
  const queue = [start];
  while (queue.length) {
    const [x, y] = queue.shift();
    for (const [dx, dy, dir] of DIRS) {
      const nx = x + dx, ny = y + dy;
      const back = { 2: 8, 8: 2, 4: 6, 6: 4 }[dir];
      if (!passable(x, y, dir) || !passable(nx, ny, back)) continue;
      const key = nx + ',' + ny;
      if (seen.has(key)) continue;
      seen.add(key);
      queue.push([nx, ny]);
    }
  }

  // every action-button event must be reachable from an adjacent walkable cell
  for (const ev of map.events) {
    if (!ev) continue;
    const isAction = ev.pages.some(p => p.trigger === 0 && p.list.some(c => c.code !== 0));
    if (!isAction) continue;
    interactables++;
    const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => seen.has((ev.x + dx) + ',' + (ev.y + dy)));
    if (!adj) { unreachable++; problems.push(`map ${info.id} (${map.displayName}): event '${ev.name}' at (${ev.x},${ev.y}) cannot be reached`); }
  }

  // the borders must actually block, or the player strolls off the map
  let borderOpen = 0;
  for (let x = 0; x < w; x++) { if (passable(x, 0, 8)) borderOpen++; if (passable(x, h - 1, 2)) borderOpen++; }
  for (let y = 0; y < h; y++) { if (passable(0, y, 4)) borderOpen++; if (passable(w - 1, y, 6)) borderOpen++; }
  if (borderOpen > 0) problems.push(`map ${info.id} (${map.displayName}): ${borderOpen} open border tile(s)`);

  const pct = Math.round(seen.size / (w * h) * 100);
  console.log(`map ${String(info.id).padStart(2)} ${map.displayName.slice(0, 28).padEnd(28)} tileset ${map.tilesetId} · ${seen.size}/${w * h} tiles reachable (${pct}%)`);
}

console.log(`\n${mapsChecked} maps · ${interactables} interactables · ${unreachable} unreachable`);
for (const p of problems) console.log('  PROBLEM  ' + p);
process.exitCode = problems.length ? 1 : 0;
