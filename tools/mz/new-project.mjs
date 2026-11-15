// Scaffold a BRAND NEW, runnable RPG Maker MZ project — no editor required.
//
//   node tools/mz/new-project.mjs D:/ai-studio/my-game "MY GAME"
//
// Copies the MZ 1.9.0 runtime + RTP bits from a donor project on this machine,
// then generates a minimal but real database and two maps:
//   map 1  a village field with an NPC (text + a key item) and a door
//   map 2  a small room with a door back
// Everything is native MZ data: switches, items, a common event, transfers.
// Grow it with the same patterns as the-axis-mz/tools/mz/build.mjs.

import fs from 'node:fs';
import path from 'node:path';

const [targetArg, titleArg] = process.argv.slice(2);
if (!targetArg){
  console.error('usage: node new-project.mjs <targetDir> ["Game Title"]');
  process.exit(1);
}
const DST = path.resolve(targetArg);
const TITLE = titleArg || 'NEW GAME';
const DONOR = 'D:/FOF/AI Games/RMMZ/BasherZ';          // any working MZ 1.9 project
const TILE = 48;

/* ---------------- copy the runtime ---------------- */
const copy = (rel) => {
  const src = path.join(DONOR, rel), dst = path.join(DST, rel);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
};
for (const rel of ['js', 'css', 'fonts', 'icon', 'index.html', 'package.json', 'game.rmmzproject',
                   'audio/se', 'audio/bgs',
                   'img/system', 'img/characters/Vehicle.png', 'img/characters/Actor1.png',
                   'img/faces/Actor1.png', 'img/titles1/Ruins.png']){
  copy(rel);
}
// a single clean tileset sheet + the player sprite from the AXIS build
fs.mkdirSync(path.join(DST, 'img/tilesets'), { recursive: true });
fs.mkdirSync(path.join(DST, 'data'), { recursive: true });
fs.copyFileSync('D:/ai-studio/the-axis-mz/img/tilesets/axis_B.png', path.join(DST, 'img/tilesets/axis_B.png'));
fs.copyFileSync('D:/ai-studio/the-axis-mz/js/plugins/AxisExt.js', path.join(DST, 'js/plugins/AxisExt.js'));
fs.rmSync(path.join(DST, 'js/plugins'), { recursive: true, force: true });
fs.mkdirSync(path.join(DST, 'js/plugins'), { recursive: true });
fs.copyFileSync('D:/ai-studio/the-axis-mz/js/plugins/AxisExt.js', path.join(DST, 'js/plugins/AxisExt.js'));
fs.writeFileSync(path.join(DST, 'js/plugins.js'),
  '// Generated.\nvar $plugins =\n[\n{"name":"AxisExt","status":true,"description":"objective/toast/push helpers","parameters":{}}\n];\n');

// retitle the shell
const idx = fs.readFileSync(path.join(DST, 'index.html'), 'utf8')
  .replace(/<title>[^<]*<\/title>/, '<title>' + TITLE + '</title>');
fs.writeFileSync(path.join(DST, 'index.html'), idx);
const pkg = JSON.parse(fs.readFileSync(path.join(DST, 'package.json'), 'utf8'));
pkg.name = TITLE.toLowerCase().replace(/[^a-z0-9]+/g, '-');
pkg.window.title = TITLE;
fs.writeFileSync(path.join(DST, 'package.json'), JSON.stringify(pkg, null, 2));

/* ---------------- tiles ----------------
   axis_B.png slot ids: 1 grass, 2 grass2, 3 path, 4 tree, 5 wall, 9 ifloor, 10 iwall
   Solid = 0x0f, walkable = 0, unused = 0x10 (star, ignored by passage checks).   */
const T = { '.': 1, ',': 2, '-': 3, 'T': 4, '#': 5, 'J': 9, 'H': 10 };
const SOLID = new Set(['T', '#', 'H']);

/* ---------------- maps ---------------- */
const maps = {
  1: {
    name: 'Starter Field', w: 17, h: 13,
    tiles: [
      'TTTTTTTTTTTTTTTTT',
      'T...............T',
      'T..TT......TT...T',
      'T..TT......TT...T',
      'T...............T',
      'T......-........T',
      'T......-........T',
      'T......-........T',
      'T......-........T',
      'T......-........T',
      'T......-........T',
      'T......-........T',
      'TTTTTTT-TTTTTTTTT'
    ],
    events: [
      { name: 'Greeter', x: 9, y: 5, charName: 'Actor1', charIndex: 0, dir: 4,
        commands: (c) => {
          c.sayText('Villager', ['First light on a new project.', 'Here — take this. It is not a gift, it is an excuse to test an item.']);
          c.gainItem(1, 1);
          c.sayText('Villager', ['Come back when you have a story worth putting on a map.']);
        } },
      { name: 'DoorToRoom', x: 7, y: 12, transfer: { map: 2, x: 6, y: 8, dir: 8 } }
    ]
  },
  2: {
    name: 'Starter Room', w: 13, h: 11,
    tiles: [
      'HHHHHHHHHHHHH',
      'HJJJJJJJJJJJH',
      'HJJJJJJJJJJJH',
      'HJJJJJJJJJJJH',
      'HJJJJJJJJJJJH',
      'HJJJJJJJJJJJH',
      'HJJJJJJJJJJJH',
      'HJJJJJJJJJJJH',
      'HJJJJJJJJJJJH',
      'HJJJJJJJJJJJH',
      'HHHHHJJJHHHHH'
    ],
    events: [
      { name: 'DoorToField', x: 6, y: 10, transfer: { map: 1, x: 7, y: 11, dir: 2 } }
    ]
  }
};

/* ---------------- command list builder ---------------- */
function buildList(fn){
  const list = [];
  const api = {
    sayText(speaker, lines){
      list.push({ code: 101, indent: 0, parameters: ['', 0, 0, 2, speaker || ''] });
      for (const line of lines) list.push({ code: 401, indent: 0, parameters: [line] });
    },
    gainItem(itemId, n = 1){ list.push({ code: 126, indent: 0, parameters: [itemId, 0, 0, n] }); },
    transfer(mapId, x, y, dir){ list.push({ code: 201, indent: 0, parameters: [0, mapId, x, y, dir || 2, 0] }); }
  };
  fn(api);
  list.push({ code: 0, indent: 0, parameters: [] });
  return list;
}

/* ---------------- data files ---------------- */
const emptyImage = () => ({ tileId: 0, characterName: '', direction: 2, pattern: 0, characterIndex: 0 });
const basePage = () => ({
  conditions: { actorId: 1, actorValid: false, itemId: 1, itemValid: false,
    selfSwitchCh: 'A', selfSwitchValid: false, switch1Id: 1, switch1Valid: false,
    switch2Id: 1, switch2Valid: false, variableId: 1, variableValid: false, variableValue: 0 },
  directionFix: false, image: emptyImage(), list: [{ code: 0, indent: 0, parameters: [] }],
  moveFrequency: 3,
  moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
  moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false,
  trigger: 0, walkAnime: true
});

function makeMap(id){
  const def = maps[id];
  const rows = def.tiles;
  const w = def.w, h = def.h;
  const data = new Array(w * h * 6).fill(0);
  for (let y = 0; y < h; y++){
    for (let x = 0; x < w; x++){
      const ch = rows[y][x];
      data[(0 * h + y) * w + x] = T[ch] || 1;
    }
  }
  const events = [null];
  let nextId = 1;
  for (const ev of def.events){
    const page = basePage();
    if (ev.transfer){
      page.list = buildList(c => c.transfer(ev.transfer.map, ev.transfer.x, ev.transfer.y, ev.transfer.dir));
      page.trigger = 1;             // player touch
      page.priorityType = 0;        // must be below-priority for walk-on triggers
      page.through = true;
    } else {
      page.list = buildList(ev.commands);
      page.image = { tileId: 0, characterName: ev.charName, direction: ev.dir || 2, pattern: 1, characterIndex: ev.charIndex || 0 };
      page.priorityType = 1;
      page.trigger = 0;             // action button
    }
    events.push({ id: nextId++, name: ev.name, note: '', pages: [page], x: ev.x, y: ev.y });
  }
  return {
    autoplayBgm: false, autoplayBgs: false, battleback1Name: '', battleback2Name: '',
    bgm: { name: '', pan: 0, pitch: 100, volume: 90 }, bgs: { name: '', pan: 0, pitch: 100, volume: 90 },
    disableDashing: false, displayName: def.name, encounterList: [], encounterStep: 30,
    height: h, note: '', parallaxLoopX: false, parallaxLoopY: false, parallaxName: '',
    parallaxShow: true, parallaxSx: 0, parallaxSy: 0, scrollType: 0,
    specifyBattleback: false, tilesetId: 1, width: w, data, events
  };
}

// tileset: one B sheet, unused ids flagged star so they don't read as walkable
const TILE_ID = { grass: 1, grass2: 2, path: 3, tree: 4, wall: 5, ifloor: 9, iwall: 10, flowers: 6, water: 7, well: 8, sign: 11 };
const flags = new Array(8192).fill(0x10);
flags[TILE_ID.grass] = 0; flags[TILE_ID.grass2] = 0; flags[TILE_ID.path] = 0;
flags[TILE_ID.ifloor] = 0;
for (const k of ['tree', 'wall', 'iwall', 'water', 'well', 'sign']) flags[TILE_ID[k]] = 0x0f;

const readDonor = f => JSON.parse(fs.readFileSync(path.join(DONOR, 'data', f), 'utf8'));
const write = (f, v) => fs.writeFileSync(path.join(DST, 'data', f), JSON.stringify(v, null, '\t'), 'utf8');

// untouched database parts come from the donor (valid structure by definition)
for (const f of ['Troops.json','Enemies.json','States.json','Skills.json','Weapons.json','Armors.json','Animations.json']){
  fs.copyFileSync(path.join(DONOR, 'data', f), path.join(DST, 'data', f));
}

const sys = readDonor('System.json');
sys.gameTitle = TITLE;
sys.title1Name = 'Ruins';
sys.title2Name = '';
sys.startMapId = 1;
sys.startX = 7;
sys.startY = 9;
sys.partyMembers = [1];
sys.optFollowers = false;
sys.optSideView = battingSideView();
sys.tileSize = TILE;
sys.switches = [''].concat(['TalkedToGreeter', 'DoorOpen', 'FoundKey', 'MetElder', 'QuestStarted', 'QuestDone']);
sys.variables = [''].concat(['Counter']);
sys.titleBgm = { name: '', pan: 0, pitch: 100, volume: 90 };
sys.battleBgm = { name: '', pan: 0, pitch: 100, volume: 90 };
sys.victoryMe = { name: '', pan: 0, pitch: 100, volume: 90 };
sys.defeatMe = { name: '', pan: 0, pitch: 100, volume: 90 };
sys.gameoverMe = { name: '', pan: 0, pitch: 100, volume: 90 };
function battingSideView(){ return false; }
write('System.json', sys);

const actors = readDonor('Actors.json');
actors[1] = Object.assign({}, actors[1], { id: 1, name: 'Hero', characterName: 'Actor1', characterIndex: 0, faceName: 'Actor1' });
for (let i = 2; i < actors.length; i++) actors[i] = null;
write('Actors.json', actors);

const classes = readDonor('Classes.json');
classes[1] = Object.assign({}, classes[1], { id: 1, name: 'Wanderer', traits: [], learnings: [] });
for (let i = 2; i < classes.length; i++) classes[i] = null;
write('Classes.json', classes);

write('Items.json', [null, {
  id: 1, animationId: 0, consumable: false,
  damage: { critical: false, elementId: 0, formula: '0', type: 0, variance: 20 },
  description: 'A placeholder key item. Rename it and give it a purpose.',
  effects: [], hitType: 0, iconIndex: 176, itypeId: 2, name: 'Starter Key',
  note: '', occasion: 2, price: 0, repeats: 1, scope: 7, speed: 0, successRate: 100, tpGain: 0
}]);

write('CommonEvents.json', [null, {
  id: 1, name: 'ShowToast',
  switchId: 1, trigger: 0,
  list: [
    { code: 355, indent: 0, parameters: ['AxisExt.toast("common event ran");'] },
    { code: 0, indent: 0, parameters: [] }
  ]
}]);

write('Tilesets.json', [null, {
  id: 1, flags, mode: 0, name: 'STARTER', note: '',
  tilesetNames: ['', '', '', '', '', 'axis_B', '', '', '']
}]);

write('MapInfos.json', [null,
  { id: 1, expanded: false, name: maps[1].name, order: 1, parentId: 0, scrollX: 0, scrollY: 0 },
  { id: 2, expanded: false, name: maps[2].name, order: 2, parentId: 0, scrollX: 0, scrollY: 0 }
]);

write('Map001.json', makeMap(1));
write('Map002.json', makeMap(2));

let commands = 0, events = 0;
for (const f of ['Map001.json','Map002.json']){
  const m = JSON.parse(fs.readFileSync(path.join(DST, 'data', f), 'utf8'));
  for (const ev of m.events) if (ev){ events++; for (const p of ev.pages) commands += p.list.length; }
}
console.log(`scaffolded ${DST}`);
console.log(`  title "${TITLE}" · 2 maps · ${events} events · ${commands} event commands · tileset STARTER`);
console.log(`  next:  cd "${DST}" && python -m http.server 8150  ->  http://127.0.0.1:8150/`);
