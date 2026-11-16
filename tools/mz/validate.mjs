// THE AXIS — structural validator for the generated MZ data.
//
//   node tools/mz/validate.mjs
//
// Hand-spliced event commands are how a game quietly breaks: an unbalanced
// conditional, a choice with no branches, a transfer to a tile that is not
// there, a picture whose PNG was never exported. This checks the data the way
// the interpreter will read it, before the browser ever loads it.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(ROOT, 'data');
const load = n => JSON.parse(fs.readFileSync(path.join(DATA, n), 'utf8'));

const system = load('System.json');
const items = load('Items.json');
const troops = load('Troops.json');
const common = load('CommonEvents.json');
const mapInfos = load('MapInfos.json').filter(Boolean);
const maps = new Map();
for (const info of mapInfos) {
  maps.set(info.id, load('Map' + String(info.id).padStart(3, '0') + '.json'));
}

const errors = [];
const warnings = [];
const err = (where, msg) => errors.push(`${where}: ${msg}`);
const warn = (where, msg) => warnings.push(`${where}: ${msg}`);

const audioExists = (kind, name) =>
  !name || fs.existsSync(path.join(ROOT, 'audio', kind, name + '.ogg'));
const pictureExists = name =>
  !name || fs.existsSync(path.join(ROOT, 'img', 'pictures', name + '.png'));
const faceSheetExists = name =>
  !name || fs.existsSync(path.join(ROOT, 'img', 'faces', name + '.png'));

const BAD_ARROW = /\u2192|\u2190/;

// PNG size straight from the IHDR chunk: enough to check that a character sheet
// is 3x4 cells of a whole number of tiles, without a dependency.
function imageSize(file) {
  try {
    const b = fs.readFileSync(file);
    if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47) return null;
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
  } catch {
    return null;
  }
}

function checkList(list, where) {
  // ---- structure: conditionals and choices must nest correctly ----
  const stack = [];
  let sawEnd = false;
  let textOpen = false;
  let textLines = 0;

  list.forEach((c, i) => {
    const at = `${where}[${i}] code ${c.code}`;
    const depthIn = stack.length;
    if (sawEnd) err(at, 'command after the list terminator');
    if (c.code === 0) { sawEnd = true; return; }

    if (textOpen && c.code !== 401) {
      if (textLines === 0) err(at, 'text box opened with no lines');
      textOpen = false;
    }

    switch (c.code) {
      case 101:
        if (textOpen) err(at, 'text box opened while another is open');
        textOpen = true;
        textLines = 0;
        if (!faceSheetExists(c.parameters[0])) err(at, `face sheet '${c.parameters[0]}' has no PNG`);
        if (c.parameters[0] && (c.parameters[1] < 0 || c.parameters[1] > 7)) {
          err(at, `face index ${c.parameters[1]} out of range 0..7`);
        }
        break;
      case 401:
        if (!textOpen) err(at, 'text line outside a text box');
        textLines++;
        break;
      case 111:
        stack.push({ kind: 'if', at, elseSeen: false });
        if (!Array.isArray(c.parameters) || c.parameters.length < 2) err(at, 'malformed condition');
        if (c.parameters[0] === 1 && (c.parameters[1] < 1 || c.parameters[1] > system.variables.length - 1)) {
          err(at, `variable ${c.parameters[1]} out of range`);
        }
        if (c.parameters[0] === 0 && (c.parameters[1] < 1 || c.parameters[1] > system.switches.length - 1)) {
          err(at, `switch ${c.parameters[1]} out of range`);
        }
        break;
      case 411: {
        const top = stack[stack.length - 1];
        if (!top || top.kind !== 'if') err(at, 'else without a matching conditional branch');
        else if (top.elseSeen) err(at, 'second else for the same conditional branch');
        else top.elseSeen = true;
        break;
      }
      case 412: {
        const top = stack.pop();
        if (!top || top.kind !== 'if') err(at, 'end-if without a matching conditional branch');
        break;
      }
      case 102:
        stack.push({ kind: 'choice', at, branches: 0 });
        if (!Array.isArray(c.parameters[0]) || c.parameters[0].length === 0) err(at, 'choice with no options');
        break;
      case 402: {
        const top = stack[stack.length - 1];
        if (!top || top.kind !== 'choice') err(at, 'choice branch outside a choice');
        else top.branches++;
        break;
      }
      case 404: {
        const top = stack.pop();
        if (!top || top.kind !== 'choice') {
          err(at, 'end-choice without a matching choice');
        } else {
          const opts = list[list.findIndex(x => x.code === 102 && x.indent === c.indent)]?.parameters[0];
          if (Array.isArray(opts) && top.branches < opts.length) {
            warn(at, `choice has ${opts.length} options but ${top.branches} branches`);
          }
        }
        break;
      }
      case 121:
        if (c.parameters[0] < 1 || c.parameters[0] > system.switches.length - 1) err(at, `switch id ${c.parameters[0]} out of range`);
        else if (!system.switches[c.parameters[0]]) warn(at, `switch ${c.parameters[0]} is unnamed`);
        break;
      case 122:
        if (c.parameters[0] < 1 || c.parameters[0] > system.variables.length - 1) err(at, `variable id ${c.parameters[0]} out of range`);
        break;
      case 123:
        if (!['A', 'B', 'C', 'D'].includes(c.parameters[0])) err(at, `self switch '${c.parameters[0]}' invalid`);
        break;
      case 126:
        if (!items[c.parameters[0]]) err(at, `item ${c.parameters[0]} does not exist`);
        break;
      case 117:
        if (!common[c.parameters[0]]) err(at, `common event ${c.parameters[0]} does not exist`);
        break;
      case 201: {
        const [mode, mapId, x, y] = c.parameters;
        if (mode === 0) {
          if (!maps.has(mapId)) { err(at, `transfer to map ${mapId} which does not exist`); break; }
          const m = maps.get(mapId);
          if (x < 0 || y < 0 || x >= m.width || y >= m.height) err(at, `transfer to (${x},${y}) outside map ${mapId}`);
        }
        break;
      }
      case 231:
        if (!pictureExists(c.parameters[1])) err(at, `picture '${c.parameters[1]}' has no PNG`);
        break;
      case 241:
        if (!audioExists('bgm', c.parameters[0].name)) err(at, `bgm '${c.parameters[0].name}' missing from audio/bgm`);
        break;
      case 245:
        if (!audioExists('bgs', c.parameters[0].name)) err(at, `bgs '${c.parameters[0].name}' missing from audio/bgs`);
        break;
      case 249:
        if (!audioExists('me', c.parameters[0].name)) err(at, `me '${c.parameters[0].name}' missing from audio/me`);
        break;
      case 250:
        if (!audioExists('se', c.parameters[0].name)) err(at, `se '${c.parameters[0].name}' missing from audio/se`);
        break;
      case 301:
        if (!troops[c.parameters[1]]) err(at, `battle with troop ${c.parameters[1]} which does not exist`);
        break;
      case 355: {
        const src = String(c.parameters[0] || '');
        if (src.includes('AxisExt.') && !src.trim().startsWith('//')) {
          const m = src.match(/AxisExt\.(\w+)/);
          const known = ['stress', 'setStress', 'objective', 'toast', 'push'];
          if (m && !known.includes(m[1])) err(at, `script calls AxisExt.${m[1]} which the plugin does not define`);
        }
        break;
      }
      default:
        break;
    }

    // ---- indentation must actually reflect nesting ----
    // A block opener sits at the outer depth; its matching closer (else, end-if,
    // choice branch, end-choice) also sits at the outer depth, not the inner one.
    const closer = c.code === 411 || c.code === 412 || c.code === 402 || c.code === 404;
    const expected = depthIn - (closer ? 1 : 0);
    if (c.indent !== expected) {
      warn(at, `indent ${c.indent} but nesting is ${expected}`);
    }
  });

  if (stack.length) err(where, `${stack.length} unclosed block(s): ${stack.map(s => s.at).join(', ')}`);
  if (!sawEnd) err(where, 'list has no terminator (code 0)');
  if (textOpen && textLines === 0) err(where, 'list ends with an empty text box');
}

/* ---------------------------------------------------------------- maps ---- */

let eventCount = 0, commandCount = 0, pageCount = 0;
const mapNames = new Set();
for (const [id, map] of maps) {
  const where = `map ${id} (${map.displayName})`;
  if (!map.displayName) err(where, 'map has no display name');
  if (mapNames.has(map.displayName)) warn(where, `duplicate display name '${map.displayName}'`);
  mapNames.add(map.displayName);
  if (map.data.length !== map.width * map.height * 6) {
    err(where, `tile data length ${map.data.length} != ${map.width}x${map.height}x6`);
  }
  if (!audioExists('bgm', map.bgm.name)) err(where, `map bgm '${map.bgm.name}' missing`);
  if (!audioExists('bgs', map.bgs.name)) err(where, `map bgs '${map.bgs.name}' missing`);
  if (map.specifyBattleback) {
    for (const [k, dir] of [['battleback1Name', 'battlebacks1'], ['battleback2Name', 'battlebacks2']]) {
      const n = map[k];
      if (n && !fs.existsSync(path.join(ROOT, 'img', dir, n + '.png'))) err(where, `${dir}/${n}.png missing`);
    }
  }

  const occupied = new Map();
  for (const ev of map.events) {
    if (!ev) continue;
    eventCount++;
    const ew = `${where} · event ${ev.id} '${ev.name}'`;
    if (ev.x < 0 || ev.y < 0 || ev.x >= map.width || ev.y >= map.height) err(ew, `position (${ev.x},${ev.y}) outside the map`);
    const key = `${ev.x},${ev.y}`;
    if (occupied.has(key)) warn(ew, `shares tile (${key}) with '${occupied.get(key)}'`);
    occupied.set(key, ev.name);
    if (!ev.pages.length) err(ew, 'event has no pages');
    ev.pages.forEach((page, pi) => {
      pageCount++;
      commandCount += page.list.length;
      checkList(page.list, `${ew} page ${pi + 1}`);
      if (page.image.characterName &&
          !fs.existsSync(path.join(ROOT, 'img', 'characters', page.image.characterName + '.png'))) {
        err(ew, `character sheet '${page.image.characterName}.png' missing`);
      }
      if (page.image.tileId && page.image.tileId > 0 && !map.tilesetId) err(ew, 'tile image with no tileset');
      if (page.conditions.switch1Valid && !system.switches[page.conditions.switch1Id]) {
        err(ew, `page condition on unnamed switch ${page.conditions.switch1Id}`);
      }
      // MZ fires walk-on transfers only from a below-layer page
      const hasTransfer = page.list.some(c => c.code === 201);
      if (hasTransfer && page.trigger === 1 && page.priorityType !== 0) {
        err(ew, 'walk-on transfer page is above the player, so it can never fire');
      }
      // ...and the OK button only reaches NORMAL priority events
      const hasBody = page.list.some(c => c.code !== 0);
      if (!hasTransfer && hasBody && page.trigger === 0 && page.priorityType !== 1) {
        err(ew, 'action-button page is not at normal priority, so the player can never examine it');
      }
    });
  }
}

/* ------------------------------------------------------- common events ---- */

common.forEach(ce => {
  if (!ce) return;
  commandCount += ce.list.length;
  checkList(ce.list, `common event ${ce.id} (${ce.name})`);
  if (ce.trigger === 1 || ce.trigger === 2) {
    if (ce.switchId < 1 || ce.switchId > system.switches.length - 1) {
      err(`common event ${ce.id}`, `automatic trigger bound to switch ${ce.switchId}`);
    }
  }
});

/* ------------------------------------------------------------- database ---- */

const tilesets = load('Tilesets.json');
const ts = tilesets[1];
if (!ts) err('Tilesets', 'no tileset id 1');
else {
  if (ts.flags.length !== 8192) err('Tilesets', `flags length ${ts.flags.length} != 8192`);
  // every B..E slot that is named must exist on disk — a named-but-missing sheet
  // draws nothing, and a missing A-sheet draws the black backdrop (whole 48px
  // columns of #000000 through the map), which is easy to mistake for a bug in
  // the map data rather than in the tileset.
  for (let slot = 0; slot < ts.tilesetNames.length; slot++) {
    const sheet = ts.tilesetNames[slot];
    if (!sheet) continue;
    if (!fs.existsSync(path.join(ROOT, 'img', 'tilesets', sheet + '.png'))) {
      err('Tilesets', `sheet slot ${slot} names '${sheet}.png' but the file is missing`);
    }
  }
  if (!ts.tilesetNames[0]) err('Tilesets', 'A1 sheet unnamed — animated water renders as black holes');
  // MZ flags are bitfields: bits 0-3 = impassable per direction, 0x10 star
  // (drawn above characters), 0x20 ladder, 0x40 bush, 0x80 counter, 0x100
  // damage floor, 0x600+ terrain tag.
  // RTP data is full of composites (0xE0F), so never compare for equality.
  if (!ts.flags.some(f => (f & 0x0f) === 0x0f)) err('Tilesets', 'no impassable flags — every tile would be walkable');
  if (!ts.flags.some(f => (f & 0x10) !== 0)) warn('Tilesets', 'no star/overpass tiles — nothing draws above the player');
}

if (!system.startMapId || !maps.has(system.startMapId)) err('System', `startMapId ${system.startMapId} does not exist`);
if (!fs.existsSync(path.join(ROOT, 'img', 'titles1', system.title1Name + '.png'))) {
  err('System', `title image '${system.title1Name}' missing`);
}
if (!audioExists('bgm', system.titleBgm.name)) err('System', `title bgm '${system.titleBgm.name}' missing`);

/* --------------------------------------------------- the vista buildings ---- */

// MZ indexes $dataMap.events BY EVENT ID: Game_Event.initialize does
// this.locate(this.event().x, ...) and this.event() is $dataMap.events[this._eventId].
// So the array must be dense, events[0] must be null, and events[i].id === i.
// Remove an event without leaving the hole and Game_Map.setupEvents throws
// "Cannot read properties of undefined (reading 'x')" the moment the map loads.
for (const [id, map] of maps) {
  const where = `map ${id} (${map.displayName})`;
  if (map.events[0] !== null) err(where, 'events[0] must be null');
  for (let i = 1; i < map.events.length; i++) {
    const e = map.events[i];
    if (!e) continue;
    if (e.id !== i) err(where, `events[${i}].id is ${e.id} — id and array index must match`);
  }
}

// big-building events: the sheet must be a `!$name` single-character sheet whose
// cell is a whole number of 48px tiles, and the tile they stand on must be solid
// (the body gets its collision from the invisible z1 mask, not from the event)
const TILE = 48;
for (const [id, map] of maps) {
  const where = `map ${id} (${map.displayName})`;
  for (const e of map.events) {
    if (!e || !e.name.startsWith('bldg_')) continue;
    const page = e.pages[0];
    const sheet = page?.image?.characterName || '';
    if (!sheet) { err(where, `event ${e.id} '${e.name}' has no building image`); continue; }
    if (!/^!\$/.test(sheet)) err(where, `event ${e.id} '${e.name}' sheet '${sheet}' must start with !$`);
    if (page.priorityType !== 1) err(where, `event ${e.id} '${e.name}' is priority ${page.priorityType}; the OK button only reaches priority 1`);
    const file = path.join(ROOT, 'img', 'characters', sheet + '.png');
    if (!fs.existsSync(file)) { err(where, `event ${e.id} '${e.name}' sheet '${sheet}.png' missing`); continue; }
    const dims = imageSize(file);
    if (!dims) { warn(where, `event ${e.id} '${e.name}' sheet size unreadable`); continue; }
    const cellW = dims[0] / 3, cellH = dims[1] / 4;
    if (cellW % TILE || cellH % TILE) {
      err(where, `event ${e.id} '${e.name}' cell ${cellW}x${cellH} is not a multiple of ${TILE}`);
    }
  }
}

/* --------------------------------------------------------------- report ---- */

for (const e of errors) console.log('ERROR  ' + e);
for (const w of warnings.slice(0, 25)) console.log('warn   ' + w);
if (warnings.length > 25) console.log(`warn   … ${warnings.length - 25} more`);
console.log(`\n${maps.size} maps · ${eventCount} events · ${pageCount} pages · ${commandCount} commands · ` +
  `${errors.length} errors · ${warnings.length} warnings`);
process.exitCode = errors.length ? 1 : 0;
