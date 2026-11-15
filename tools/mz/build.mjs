// THE AXIS -> RPG Maker MZ project builder.
//
// Reads the shipped web build's content (the-axis/js/data.js) and emits genuine
// RPG Maker MZ data files: maps, events as native command lists, switches,
// variables, items, common events, tilesets. Every command below is a real MZ
// event command code, so the result opens and plays in MZ / the MZ runtime, and
// is editable in the MZ editor.
//
//   node tools/mz/build.mjs
//
// Command shapes were read out of this project's own rmmz_objects.js
// (Game_Interpreter.prototype.commandNNN), not from memory.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MZ = path.resolve(HERE, '../..');                 // the-axis-mz
const WEB = path.resolve(MZ, '../the-axis');            // the web build
const DATA = path.join(MZ, 'data');

const { MAPS, TILES, ITEMS, START } = await import(pathToFileURL(path.join(WEB, 'js/data.js')).href);
const { TILE_ART } = await import(pathToFileURL(path.join(WEB, 'js/art.js')).href);

/* ============================ tables ============================ */

// tile kind -> B-sheet tile id (id 0 stays empty). Must match tools/art-export.
const KINDS = Object.keys(TILE_ART);
const TILE_ID = {};
KINDS.forEach((k, i) => { TILE_ID[k] = i + 1; });
const tileIdOfChar = ch => TILE_ID[TILES[ch].t];

// switch ids, in a stable readable order
const SWITCH_ORDER = [
  'started', 'villageSeen', 'villageAfterHollow', 'shrineSeen', 'questHollow',
  'hollowEntered', 'firstHollow', 'caretakerMet', 'promiseStabilize', 'promiseOpen',
  'ledgerRead', 'carveRead', 'windRead', 'sawTrunk',
  'northSeen', 'ventEntered', 'ventQuest', 'plug1', 'plug3', 'plug2', 'ventOpen', 'northToken',
  'eastSeen', 'eastQuest', 'eastFlow', 'cutGrowth', 'eastToken',
  'westSeen', 'westQuest', 'deb1', 'deb2', 'deb3', 'westWarm', 'westToken',
  'threeTokens', 'AxisHighStress', 'deepSeen', 'trunkSeen',
  'finalChoice', 'FinalChoiceStabilize', 'FinalChoiceOpen', 'lastRefusal'
];
const SW = {};
SWITCH_ORDER.forEach((name, i) => { SW[name] = i + 1; });

const VAR_STRESS = 1;

const MAP_IDS = {
  home: 1, village: 2, shrine: 3, ridgepath: 4, hollow1: 5, hollow2: 6,
  hollow3: 7, hollow4: 8, north: 9, northvent: 10, east: 11, west: 12,
  deeproot: 13, trunk: 14
};

const ITEM_IDS = {
  north_token: 1, east_token: 2, west_token: 3, root_mark: 4,
  fragment_a: 5, fragment_b: 6, fragment_c: 7,
  herbs: 8, water: 9, salve: 10
};
const KEY_ITEMS = new Set(['north_token', 'east_token', 'west_token', 'root_mark',
  'fragment_a', 'fragment_b', 'fragment_c']);

const CE = { tremor: 1, caretaker: 2, checkTokens: 3, useHerbs: 4, useWater: 5, useSalve: 6 };

const PICTURE_FILE = {
  caretaker: 'axis_caretaker', trunk: 'axis_trunk',
  hollowentrance: 'axis_hollowentrance',
  ending_stabilize: 'axis_ending_stabilize', ending_open: 'axis_ending_open'
};
const PICTURE_CAPTION = {
  caretaker: 'The Root-Tender',
  trunk: 'Trunk cross-section — bark thinned to light, and hand-sized gnawing.',
  hollowentrance: 'The new hollow. Roots at the rim are braided, not broken.',
  ending_stabilize: 'The supports take the weight back.',
  ending_open: 'The trunk opens along the seam. Not a tear. A door.'
};

const DIR = { down: 2, left: 4, right: 6, up: 8 };

/* ============================ command builder ============================ */

class Cmd {
  constructor(){ this.list = []; this.indent = 0; }
  raw(code, params = [], indent = this.indent){
    this.list.push({ code, indent, parameters: params });
    return this;
  }
  end(){ this.raw(0, [], 0); return this.list; }

  say(speaker, text){
    if (!text) return this;
    this.raw(101, ['', 0, 0, 2, speaker || '']);
    const lines = String(text).split('\n');
    for (const line of lines) this.raw(401, [line]);
    return this;
  }
  choices(labels, bodies){
    this.raw(102, [labels, 0, 0, 2, 0]);
    labels.forEach((label, i) => {
      this.raw(402, [i, label]);
      this.indent++;
      bodies[i]();
      this.indent--;
    });
    this.raw(404, []);
    return this;
  }
  branch(condParams, thenFn, elseFn){
    this.raw(111, condParams);
    this.indent++;
    thenFn();
    this.indent--;
    if (elseFn){
      this.raw(411, []);
      this.indent++;
      elseFn();
      this.indent--;
    }
    this.raw(412, []);
    return this;
  }
  setSwitch(name, on = true){
    const id = SW[name];
    if (!id) throw new Error('unknown switch ' + name);
    return this.raw(121, [id, id, on ? 0 : 1]);
  }
  addVar(n){
    this.raw(122, [VAR_STRESS, VAR_STRESS, 1, 0, n]);
    this.raw(111, [1, VAR_STRESS, 0, 100, 3]);
    this.indent++; this.raw(122, [VAR_STRESS, VAR_STRESS, 0, 0, 100]); this.indent--;
    this.raw(412, []);
    this.raw(111, [1, VAR_STRESS, 0, 0, 4]);
    this.indent++; this.raw(122, [VAR_STRESS, VAR_STRESS, 0, 0, 0]); this.indent--;
    this.raw(412, []);
    this.raw(111, [1, VAR_STRESS, 0, 50, 1]);
    this.indent++; this.setSwitch('AxisHighStress', true); this.indent--;
    this.raw(412, []);
    return this;
  }
  give(item, n = 1){
    const id = ITEM_IDS[item];
    if (!id) throw new Error('unknown item ' + item);
    return this.raw(126, [id, 0, 0, n]);
  }
  take(item, n = 1){
    const id = ITEM_IDS[item];
    if (!id) throw new Error('unknown item ' + item);
    return this.raw(126, [id, 1, 0, n]);
  }
  transfer(map, x, y, dir = 'down'){
    const id = MAP_IDS[map];
    if (!id) throw new Error('unknown map ' + map);
    return this.raw(201, [0, id, x, y, DIR[dir] || 2, 0]);
  }
  shake(power = 5, speed = 5, frames = 40){
    this.raw(225, [power, speed, frames, true]);
    return this;
  }
  se(name, volume = 85, pitch = 100){
    return this.raw(250, [{ name, volume, pitch, pan: 0 }]);
  }
  wait(frames){ return this.raw(230, [frames]); }
  script(code){ return this.raw(355, [code]); }
  common(id){ return this.raw(117, [id]); }
  showPicture(id, name, caption){
    this.raw(231, [id, name, 1, 0, 0, 0, 100, 100, 255, 0]);
    if (caption) this.say('', caption);
    return this;
  }
  erasePicture(id){ return this.raw(235, [id]); }
  fadeout(){ return this.raw(221, []); }
  toTitle(){ return this.raw(354, []); }
  nameInput(actorId = 1, maxLength = 12){
    return this.raw(303, [actorId, maxLength]);
  }
}

/* ============================ condition / text helpers ============================ */

function condParams(cond){
  if (!cond) return [0, 1, 0];
  if (cond.sw) return [0, SW[cond.sw], cond.val === false ? 1 : 0];
  if (cond.item) return [8, ITEM_IDS[cond.item], 0];
  if (cond.varGte) return [1, VAR_STRESS, 0, cond.varGte[1], 1];
  if (cond.not){
    const inner = condParams(cond.not);
    return inner;                       // caller inverts by swapping branches
  }
  throw new Error('unsupported condition ' + JSON.stringify(cond));
}

// Our content uses text functions of state, always a single ternary on one
// switch or on AxisStress. Evaluate both sides and branch in MZ.
function textVariants(value, speakerValue){
  const fn = typeof value === 'function' ? value : null;
  const whoFn = typeof speakerValue === 'function' ? speakerValue : null;
  if (!fn && !whoFn) return null;
  const src = (fn || whoFn).toString();
  const swName = (src.match(/switches\.([A-Za-z_][A-Za-z0-9_]*)/) || [])[1];
  const varName = (src.match(/vars\.([A-Za-z_][A-Za-z0-9_]*)/) || [])[1];
  const base = { switches: {}, vars: { AxisStress: 0 }, items: [] };
  const alt = { switches: {}, vars: { AxisStress: 50 }, items: [] };
  if (swName) alt.switches[swName] = true;
  const read = (v, st) => (typeof v === 'function' ? v(st) : v);
  const out = {
    baseText: read(value, base), altText: read(value, alt),
    baseWho: read(speakerValue, base), altWho: read(speakerValue, alt)
  };
  if (swName) out.cond = [0, SW[swName], 0];
  else if (varName) out.cond = [1, VAR_STRESS, 0, 50, 1];
  else return null;
  return out;
}

/* ============================ script translation ============================ */

function translate(actions, cmd){
  for (const a of actions || []){
    if (!a) continue;
    switch (a.t){
      case 'say': {
        const v = textVariants(a.text, a.who);
        if (v){
          cmd.branch(v.cond,
            () => cmd.say(v.altWho, v.altText),
            () => cmd.say(v.baseWho, v.baseText));
        } else cmd.say(a.who, a.text);
        break;
      }
      case 'choice': {
        const v = textVariants(a.text, a.who);
        const build = () => cmd.choices(
          a.options.map(o => o.label),
          a.options.map(o => () => translate(o.do, cmd))
        );
        if (v){
          cmd.branch(v.cond, () => { cmd.say(v.altWho, v.altText); build(); },
                             () => { cmd.say(v.baseWho, v.baseText); build(); });
        } else {
          if (a.text) cmd.say(a.who, a.text);
          build();
        }
        break;
      }
      case 'set':    cmd.setSwitch(a.sw, a.val === undefined ? true : a.val); break;
      case 'add':    cmd.addVar(a.n || 0); break;
      case 'give':   cmd.give(a.id); break;
      case 'take':   cmd.take(a.id); break;
      case 'pic': {
        const file = PICTURE_FILE[a.id];
        // alternate picture ids so successive pictures don't collide
        const pid = 10 + (Object.keys(PICTURE_FILE).indexOf(a.id) % 5);
        cmd.showPicture(pid, file, PICTURE_CAPTION[a.id]);
        cmd.erasePicture(pid);
        break;
      }
      case 'teleport': cmd.transfer(a.map, a.x, a.y, a.dir); break;
      case 'objective': {
        const v = textVariants(a.text, null);
        const emit = t => cmd.script('AxisExt.objective(' + JSON.stringify(String(t)) + ');');
        if (v) cmd.branch(v.cond, () => emit(v.altText), () => emit(v.baseText));
        else emit(typeof a.text === 'function' ? a.text({ switches:{}, vars:{AxisStress:0}, items:[] }) : a.text);
        break;
      }
      case 'toast':  cmd.script('AxisExt.toast(' + JSON.stringify(String(a.text)) + ');'); break;
      case 'tremor': cmd.shake(2 + Math.round((a.mag || 1) * 3), 5, 40).se('Earth1', 80); break;
      case 'wait':   cmd.wait(Math.max(1, Math.round((a.ms || 100) / 1000 * 60))); break;
      case 'if': {
        if (a.cond && a.cond.not){
          const p = condParams(a.cond.not);
          cmd.branch(p, () => translate(a.else, cmd), () => translate(a.then, cmd));
        } else if (a.cond && a.cond.any){
          // a then b: if a else if b, with the same body
          const parts = a.cond.any;
          const emitFrom = i => {
            if (i >= parts.length){ translate(a.else, cmd); return; }
            cmd.branch(condParams(parts[i]),
              () => translate(a.then, cmd),
              () => emitFrom(i + 1));
          };
          emitFrom(0);
        } else if (a.cond && a.cond.all){
          const parts = a.cond.all;
          const emitFrom = i => {
            if (i >= parts.length){ translate(a.then, cmd); return; }
            cmd.branch(condParams(parts[i]), () => emitFrom(i + 1), () => translate(a.else, cmd));
          };
          emitFrom(0);
        } else {
          cmd.branch(condParams(a.cond),
            () => translate(a.then, cmd),
            () => translate(a.else, cmd));
        }
        break;
      }
      case 'ending': {
        cmd.fadeout();
        cmd.wait(60);
        cmd.se('Bell3', 70);
        cmd.toTitle();
        break;
      }
      default: throw new Error('unhandled action ' + a.t);
    }
  }
  return cmd;
}

/* ============================ map grid ============================ */

function buildGrid(def){
  const g = [];
  for (let y = 0; y < def.h; y++) g.push(new Array(def.w).fill(def.fill || '.'));
  const put = (x, y, ch) => { if (g[y] && g[y][x] !== undefined) g[y][x] = ch; };
  for (const op of def.ops || []){
    const [k] = op;
    if (k === 'put') put(op[1], op[2], op[3]);
    else if (k === 'rect'){ const [, x, y, w, h, ch] = op; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) put(i, j, ch); }
    else if (k === 'h'){ const [, x1, x2, y, ch] = op; for (let i = x1; i <= x2; i++) put(i, y, ch); }
    else if (k === 'v'){ const [, x, y1, y2, ch] = op; for (let j = y1; j <= y2; j++) put(x, j, ch); }
    else if (k === 'border'){ const ch = op[1];
      for (let i = 0; i < def.w; i++){ put(i, 0, ch); put(i, def.h - 1, ch); }
      for (let j = 0; j < def.h; j++){ put(0, j, ch); put(def.w - 1, j, ch); }
    }
  }
  return g;
}

/* ============================ event pages ============================ */

const SHEET = { player: '$axis_player', mara: '$axis_mara', vela: '$axis_vela',
  keeperN: '$axis_keeperN', keeperE: '$axis_keeperE', keeperW: '$axis_keeperW',
  villager1: '$axis_villager1', villager2: '$axis_villager2', villager3: '$axis_villager3',
  remnant: '$axis_remnant', elder_shade: '$axis_elder_shade' };

function emptyImage(){ return { tileId: 0, characterName: '', direction: 2, pattern: 0, characterIndex: 0 }; }
function charImage(sprite, dir = 'down'){
  return { tileId: 0, characterName: SHEET[sprite] || '', direction: DIR[dir] || 2, pattern: 1, characterIndex: 0 };
}
function tileImage(kind){ return { tileId: TILE_ID[kind] || 0, characterName: '', direction: 2, pattern: 0, characterIndex: 0 }; }

function basePage(){
  return {
    conditions: { actorId: 1, actorValid: false, itemId: 1, itemValid: false,
      selfSwitchCh: 'A', selfSwitchValid: false,
      switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false,
      variableId: 1, variableValid: false, variableValue: 0 },
    directionFix: false, image: emptyImage(), list: [{ code: 0, indent: 0, parameters: [] }],
    moveFrequency: 3,
    moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
    moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false,
    trigger: 0, walkAnime: true
  };
}

function applyPageCond(page, cond){
  if (!cond) return page;
  const c = page.conditions;
  if (cond.sw){ c.switch1Valid = true; c.switch1Id = SW[cond.sw]; }
  if (cond.item){ c.itemValid = true; c.itemId = ITEM_IDS[cond.item]; }
  if (cond.varGte){ c.variableValid = true; c.variableId = VAR_STRESS; c.variableValue = cond.varGte[1]; }
  if (cond.not || cond.all || cond.any) {
    // complex conditions are handled inside the command list by translate()
    return page;
  }
  return page;
}

// Does a condition need to live in the command list rather than the page header?
const condIsPageable = c => c && (c.sw || c.item || c.varGte) && !c.not && !c.all && !c.any;

function makePages(ev){
  // Pages are authored most-specific-first in the web data; MZ gives the highest
  // satisfied page number priority, so emit them in reverse (default first).
  // An event may also declare its transfer at the top level instead of in a page.
  const src = (ev.pages && ev.pages.length)
    ? ev.pages
    : [{ to: ev.to, actions: ev.actions || [] }];
  const ordered = [...src].reverse();
  const pages = ordered.map(pg => {
    const page = basePage();
    const actions = [];
    // conditions that MZ cannot express as a page header become an if() wrapper
    if (pg.cond && !condIsPageable(pg.cond)) {
      actions.push({ t: 'if', cond: pg.cond, then: pg.actions || [], else: [] });
    } else {
      if (pg.cond) applyPageCond(page, pg.cond);
      actions.push(...(pg.actions || []));
    }
    const cmd = new Cmd();
    if (pg.to){
      cmd.transfer(pg.to.map, pg.to.x, pg.to.y, pg.to.dir || 'down');
    } else if (ev.to && !pg.actions){
      cmd.transfer(ev.to.map, ev.to.x, ev.to.y, ev.to.dir || 'down');
    }
    if (actions.length) translate(actions, cmd);
    page.list = cmd.end();
    if (pg.hide) page.image = emptyImage();
    return page;
  });
  // a page whose only job is to teleport must fire on contact
  ordered.forEach((pg, i) => {
    if (pg.to) pages[i].trigger = 1;                 // player touch
    else if (ev.kind === 'transfer') pages[i].trigger = 0;
  });
  return pages;
}

function makeEvent(ev, id){
  const pages = makePages(ev);
  for (const page of pages){
    if (ev.kind === 'npc'){
      page.priorityType = 1;
      page.image = charImage(ev.sprite, ev.dir || 'down');
    } else if (ev.kind === 'push'){
      page.priorityType = 1;
      page.image = tileImage(ev.tile || 'pushstone');
      page.through = false;
    } else if (ev.kind === 'object'){
      // solid objects block; loose ones are walked over
      page.priorityType = ev.solid ? 1 : 0;
      page.through = !ev.solid;
    } else if (ev.kind === 'transfer'){
      // MZ quirks, both load-bearing:
      //  - a page that transfers must be priority 0 (below characters) + through,
      //    because same-tile "player touch" only fires for non-normal-priority events;
      //  - a page that only shows a message (a locked gate) must be priority 1 and
      //    blocking, because the action button only triggers normal-priority events.
      const transfers = page.list.some(c => c.code === 201);
      if (transfers){
        page.trigger = 1;
        page.priorityType = 0;
        page.through = true;
      } else {
        page.trigger = 0;
        page.priorityType = 1;
        page.through = false;
      }
    }
  }
  return { id, name: ev.id, note: '', pages, x: ev.x, y: ev.y };
}

/* ============================ maps ============================ */

function buildMap(mapKey){
  const def = MAPS[mapKey];
  const grid = buildGrid(def);
  const width = def.w, height = def.h;
  const data = new Array(width * height * 6).fill(0);
  for (let y = 0; y < height; y++){
    for (let x = 0; x < width; x++){
      const ch = grid[y][x];
      const id = tileIdOfChar(ch);
      data[(0 * height + y) * width + x] = id || 0;      // z=0: ground layer
    }
  }

  const events = [null];
  let nextId = 1;

  // map-entry scene as an autorun event, guarded by the switch the script sets
  if (def.onEnter && def.onEnter.length){
    const guard = findGuardSwitch(def.onEnter);
    const cmd = new Cmd();
    translate(def.onEnter, cmd);

    // page 1: unconditional autorun that runs the scene
    const runPage = basePage();
    runPage.trigger = 3;                 // autorun
    runPage.priorityType = 0;
    runPage.through = true;
    runPage.list = cmd.end();

    // page 2: once the guard switch is set this page takes priority and stops it
    const guardPage = basePage();
    guardPage.priorityType = 0;
    guardPage.through = true;
    if (guard){
      guardPage.conditions.switch1Valid = true;
      guardPage.conditions.switch1Id = SW[guard];
    }
    events.push({ id: nextId++, name: 'OnEnter', note: 'runs once on entry',
      pages: [runPage, guardPage], x: 0, y: 0 });
  }

  // the player's own arrival spot can't be occupied by a blocking event
  for (const ev of def.events || []){
    events.push(makeEvent(ev, nextId++));
  }

  return {
    autoplayBgm: false, autoplayBgs: false,
    battleback1Name: '', battleback2Name: '',
    bgm: { name: '', pan: 0, pitch: 100, volume: 90 },
    bgs: { name: '', pan: 0, pitch: 100, volume: 90 },
    disableDashing: false, displayName: def.name || '', encounterList: [], encounterStep: 30,
    height, note: '', parallaxLoopX: false, parallaxLoopY: false, parallaxName: '',
    parallaxShow: true, parallaxSx: 0, parallaxSy: 0, scrollType: 0,
    specifyBattleback: false, tilesetId: 1, width, data, events
  };
}

// which switch closes the autorun page? the last "Seen"/"started" switch the script sets
function findGuardSwitch(actions){
  let found = null;
  const walk = list => {
    for (const a of list || []){
      if (!a || typeof a !== 'object') continue;
      if (a.t === 'set' && /(Seen|started|firstHollow|trunkSeen)$/.test(a.sw)) found = a.sw;
      if (a.t === 'if'){ walk(a.then); walk(a.else); }
      if (a.t === 'choice') for (const o of a.options || []) walk(o.do);
    }
  };
  walk(actions);
  return found;
}

/* ============================ database ============================ */

function makeTileset(){
  // Unused tile ids must be flagged as "star" (0x10 = ignored by passage checks).
  // With 0 they read as walkable, so the first empty layer in a cell would make
  // every cell passable before the ground tile is ever consulted.
  const flags = new Array(8192).fill(0x10);
  for (const [ch, spec] of Object.entries(TILES)){
    const id = TILE_ID[spec.t];
    if (!id) continue;
    // 0 = walkable, 0x0f = blocked in all four directions
    flags[id] = spec.solid === true || spec.solid === 'mark' ? 0x0f : 0;
  }
  if (TILES['B'] && TILES['B'].solid === 'mark'){
    // the root barrier is opened by a switch, so keep the tile walkable
    flags[TILE_ID[TILES['B'].t]] = 0;
  }
  return [null, { id: 1, flags, mode: 0, name: 'AXIS', note: '', tilesetNames: ['', '', '', '', '', 'axis_B', '', '', ''] }];
}

function makeItems(){
  const items = [null];
  for (const [key, info] of Object.entries(ITEMS)){
    const id = ITEM_IDS[key];
    const isKey = KEY_ITEMS.has(key);
    const ceId = { herbs: CE.useHerbs, water: CE.useWater, salve: CE.useSalve }[key];
    items[id] = {
      id, animationId: 0, consumable: !isKey,
      damage: { critical: false, elementId: 0, formula: '0', type: 0, variance: 20 },
      description: info.desc || '',
      effects: (!isKey && ceId) ? [{ code: 44, dataId: ceId, value1: 1, value2: 0 }] : [],
      hitType: 0, iconIndex: isKey ? 176 : 176, itypeId: isKey ? 2 : 1,
      name: info.name, note: '', occasion: 2, price: 0, repeats: 1, scope: 7,
      speed: 0, successRate: 100, tpGain: 0
    };
  }
  for (let i = 0; i < items.length; i++) if (!items[i]) items[i] = null;
  return items;
}

function makeCommonEvents(){
  const list = new Array(7).fill(null);

  // 1 — TremorEffect: shake + rumble, callable from any map
  {
    const c = new Cmd();
    c.shake(5, 5, 45).se('Earth1', 85);
    list[CE.tremor] = { id: CE.tremor, list: c.end(), name: 'TremorEffect', switchId: 1, trigger: 0 };
  }
  // 2 — ShowCaretakerMessage: picture + lore text
  {
    const c = new Cmd();
    c.showPicture(20, 'axis_caretaker', 'The Root-Tender');
    c.erasePicture(20);
    list[CE.caretaker] = { id: CE.caretaker, list: c.end(), name: 'ShowCaretakerMessage', switchId: 1, trigger: 0 };
  }
  // 3 — CheckTokens: sets threeTokens when all three are held
  {
    const c = new Cmd();
    c.branch([8, ITEM_IDS.north_token, 0],
      () => c.branch([8, ITEM_IDS.east_token, 0],
        () => c.branch([8, ITEM_IDS.west_token, 0],
          () => { c.setSwitch('threeTokens', true); c.script('AxisExt.toast("All three supports are held.");'); },
          () => {}),
        () => {}),
      () => {});
    list[CE.checkTokens] = { id: CE.checkTokens, list: c.end(), name: 'CheckTokens', switchId: 1, trigger: 0 };
  }
  // 4-6 — using a consumable lowers Axis stress
  const consumables = [
    ['useHerbs', CE.useHerbs, 'herbs', -2],
    ['useWater', CE.useWater, 'water', -2],
    ['useSalve', CE.useSalve, 'salve', -1]
  ];
  for (const [name, id, itemKey, delta] of consumables){
    const c = new Cmd();
    c.addVar(delta);
    c.take(itemKey, 1);
    c.script('AxisExt.toast(' + JSON.stringify(ITEMS[itemKey].name + ' — ' + ITEMS[itemKey].desc) + ');');
    list[id] = { id, list: c.end(), name, switchId: 1, trigger: 0 };
  }
  return list;
}

/* ============================ writers ============================ */

const readJSON = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJSON = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, '\t'), 'utf8');

function cloneDefaults(){
  // copy the untouched database parts from a working MZ 1.9.0 project
  const SRC = 'D:/FOF/AI Games/RMMZ/BasherZ/data';
  for (const f of ['Troops.json', 'Enemies.json', 'States.json', 'Skills.json',
                   'Weapons.json', 'Armors.json', 'Animations.json']){
    fs.copyFileSync(path.join(SRC, f), path.join(DATA, f));
  }
  return SRC;
}

function makeSystem(SRC){
  const sys = readJSON(path.join(SRC, 'System.json'));
  sys.gameTitle = 'THE AXIS — The Trembling';
  sys.title1Name = 'axis_title';
  sys.title2Name = '';
  sys.startMapId = MAP_IDS[START.map];
  sys.startX = START.x;
  sys.startY = START.y;
  sys.partyMembers = [1];
  sys.optFollowers = false;
  sys.optSideView = false;
  sys.tileSize = 48;
  sys.locale = 'en_US';
  // no BGM/ME files ship with this project
  sys.titleBgm = { name: '', pan: 0, pitch: 100, volume: 90 };
  sys.battleBgm = { name: '', pan: 0, pitch: 100, volume: 90 };
  sys.victoryMe = { name: '', pan: 0, pitch: 100, volume: 90 };
  sys.defeatMe = { name: '', pan: 0, pitch: 100, volume: 90 };
  sys.gameoverMe = { name: '', pan: 0, pitch: 100, volume: 90 };
  // switches / variables: index 0 is the "empty" slot
  sys.switches = [''].concat(SWITCH_ORDER);
  sys.variables = [''].concat(['AxisStress']);
  sys.editMapId = MAP_IDS.home;
  return sys;
}

function makeActors(SRC){
  const actors = readJSON(path.join(SRC, 'Actors.json'));
  const base = actors[1];
  actors[1] = Object.assign({}, base, {
    id: 1, battlerName: '', characterIndex: 0, characterName: '$axis_player',
    classId: 1, faceIndex: 0, faceName: 'Actor1', traits: [],
    initialLevel: 1, name: 'Wren', nickname: '',
    profile: 'Of Ashhollow. Grandmother tended the old root shrine.'
  });
  for (let i = 2; i < actors.length; i++) actors[i] = null;
  return actors;
}

function makeClasses(SRC){
  const classes = readJSON(path.join(SRC, 'Classes.json'));
  // keep the template's params/expParams tables: a class without them crashes
  // Game_Actor.paramBase the moment an actor is set up.
  classes[1] = Object.assign({}, classes[1], {
    id: 1, traits: [], learnings: [], name: 'Resident', note: ''
  });
  for (let i = 2; i < classes.length; i++) classes[i] = null;
  return classes;
}

function makeMapInfos(){
  const infos = [null];
  let order = 1;
  for (const [key, id] of Object.entries(MAP_IDS)){
    infos[id] = { id, expanded: false, name: MAPS[key].name || key, order: order++,
      parentId: 0, scrollX: 0, scrollY: 0 };
  }
  return infos;
}

/* ============================ main ============================ */

const SRC = cloneDefaults();
fs.mkdirSync(DATA, { recursive: true });

writeJSON(path.join(DATA, 'System.json'), makeSystem(SRC));
writeJSON(path.join(DATA, 'Actors.json'), makeActors(SRC));
writeJSON(path.join(DATA, 'Classes.json'), makeClasses(SRC));
writeJSON(path.join(DATA, 'Items.json'), makeItems());
writeJSON(path.join(DATA, 'CommonEvents.json'), makeCommonEvents());
writeJSON(path.join(DATA, 'Tilesets.json'), makeTileset());
writeJSON(path.join(DATA, 'MapInfos.json'), makeMapInfos());

let totalEvents = 0, totalCommands = 0, totalTiles = 0;
for (const [key, id] of Object.entries(MAP_IDS)){
  const map = buildMap(key);
  const file = path.join(DATA, 'Map' + String(id).padStart(3, '0') + '.json');
  writeJSON(file, map);
  const evs = map.events.filter(Boolean);
  totalEvents += evs.length;
  totalCommands += evs.reduce((n, e) => n + e.pages.reduce((m, p) => m + p.list.length, 0), 0);
  totalTiles += map.width * map.height;
  console.log(`${String(id).padStart(2)} ${key.padEnd(10)} ${map.width}x${map.height}  events ${String(evs.length).padStart(2)}  ${evs.reduce((n, e) => n + e.pages.reduce((m, p) => m + p.list.length, 0), 0)} commands`);
}

console.log(`\n${Object.keys(MAP_IDS).length} maps · ${totalTiles} tiles · ${totalEvents} events · ${totalCommands} event commands`);
console.log(`${SWITCH_ORDER.length} switches · 1 variable · ${Object.keys(ITEMS).length} items · 6 common events`);
