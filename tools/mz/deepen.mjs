// THE AXIS — the deepening pass.
//
//   node tools/mz/build.mjs      translate the web build into MZ data
//   node tools/mz/deepen.mjs     then make it a game: faces, audio, a live
//                                AxisStress, optional combat, reactive village
//
// This stage never invents new map layouts. It edits the generated data the way
// an author would in the MZ editor: pages, dialogue faces, sound fields, battle
// settings, one optional encounter per deep map, and stress that actually moves.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const DATA = path.join(ROOT, 'data');
const DONOR = 'D:/FOF/AI Games/RMMZ/BasherZ';

const readJ = p => JSON.parse(fs.readFileSync(p, 'utf8'));
const writeJ = (p, v) => fs.writeFileSync(p, JSON.stringify(v, null, '\t'), 'utf8');
const dataFile = n => path.join(DATA, n);
const load = n => readJ(dataFile(n));
const save = (n, v) => writeJ(dataFile(n), v);
const exists = p => fs.existsSync(p);
const faceSheetExists = name => !name || fs.existsSync(path.join(ROOT, 'img', 'faces', name + '.png'));
const report = [];
const note = (section, ok, text) => report.push({ section, ok, text });

const MAP_IDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const mapFile = id => 'Map' + String(id).padStart(3, '0') + '.json';

const system = load('System.json');
const SWITCH_ID = {};
system.switches.forEach((name, i) => { if (name) SWITCH_ID[name] = i; });

/* ============================== helpers ============================== */

const isText = c => c.code === 101 || c.code === 401;
const endIndex = list => {
  for (let i = list.length - 1; i >= 0; i--) if (list[i].code === 0) return i;
  return list.length;
};

function talkList(speaker, lines, face) {
  const p = face ? [face.sheet, face.index, 0, 2, speaker] : ['', 0, 0, 2, speaker];
  const list = [{ code: 101, indent: 0, parameters: p }];
  for (const line of lines) list.push({ code: 401, indent: 0, parameters: [line] });
  list.push({ code: 0, indent: 0, parameters: [] });
  return list;
}

function eachCommand(maps, fn) {
  for (const { map, file } of maps) {
    for (const ev of map.events) {
      if (!ev) continue;
      for (const page of ev.pages) fn(page.list, { map, file, ev, page });
    }
  }
  for (const ce of commonEvents) {
    if (!ce) continue;
    fn(ce.list, { ce });
  }
}

let commonEvents = load('CommonEvents.json');
const audioSpec = {};
const allMaps = MAP_IDS.map(id => ({ id, file: mapFile(id), map: load(mapFile(id)) }));

/* =================== 0. REPAIRS =================== */
// Walk-on transfer pages must sit below the player. A page with the same
// priority as the player blocks the tile, so the player can never stand on it
// and the touch trigger can never fire: the door exists and is unreachable.
// This is a translation artifact, so the repair lives in the pipeline.
{
  const fixed = [];
  for (const { id, file, map } of allMaps) {
    let touched = false;
    for (const ev of map.events) {
      if (!ev) continue;
      for (const page of ev.pages) {
        const isTransfer = page.list.some(c => c.code === 201);
        if (page.trigger !== 1 || !isTransfer) continue;
        if (page.priorityType === 0 && page.through === true) continue;
        page.priorityType = 0;
        page.through = true;
        fixed.push(`map${id}:${ev.name}`);
        touched = true;
      }
    }
    if (touched) save(file, map);
  }
  note('repairs', true, fixed.length
    ? `${fixed.length} unreachable walk-on transfer page(s) lowered below the player: ${fixed.join(', ')}`
    : 'no unreachable walk-on transfers');

  // The mirror image: an action-button page must be at NORMAL priority. MZ only
  // offers the OK button to events whose isNormalPriority() is true, so anything
  // left below the player is scenery the player can never examine — a chest that
  // cannot be opened, a barrier that cannot be touched.
  const unreachable = [];
  for (const { id, file, map } of allMaps) {
    let touched = false;
    for (const ev of map.events) {
      if (!ev) continue;
      for (const page of ev.pages) {
        if (page.trigger !== 0) continue;
        if (page.priorityType === 1) continue;
        const isTransfer = page.list.some(c => c.code === 201);
        const empty = page.list.filter(c => c.code !== 0).length === 0;
        if (isTransfer || empty) continue;
        page.priorityType = 1;
        page.through = false;
        unreachable.push(`map${id}:${ev.name}`);
        touched = true;
      }
    }
    if (touched) save(file, map);
  }
  note('reachable', true, unreachable.length
    ? `${unreachable.length} examinable event page(s) raised to player priority so OK can reach them: ${unreachable.join(', ')}`
    : 'every examinable event page is already reachable with the OK button');
}

/* ============================ 1. FACES ============================ */
// Every line of dialogue gets a portrait, looked up by speaker name. Generated
// artwork lives in img/faces/axis_faces.png (4x2 grid of 144x144 cells).
{
  const manifestPath = path.join(HERE, 'faces-manifest.json');
  if (!exists(manifestPath)) {
    note('faces', false, 'faces-manifest.json missing — dialogue stays faceless');
  } else if (!exists(path.join(ROOT, 'img', 'faces', 'axis_faces.png'))) {
    note('faces', false, 'img/faces/axis_faces.png missing — dialogue stays faceless');
  } else {
    const manifest = readJ(manifestPath);
    const defaultSheet = manifest.sheet;
    const byName = manifest.faces;
    let wired = 0, unknown = new Set(), sheetsUsed = new Set();
    eachCommand(allMaps, list => {
      for (const c of list) {
        if (c.code !== 101) continue;
        const speaker = (c.parameters[4] || '').trim();
        if (!speaker) continue;
        const entry = byName[speaker];
        if (entry === undefined) { unknown.add(speaker); continue; }
        const sheet = typeof entry === 'number' ? defaultSheet : entry.sheet;
        const index = typeof entry === 'number' ? entry : entry.index;
        if (!faceSheetExists(sheet)) { unknown.add(speaker + ' (no ' + sheet + '.png)'); continue; }
        c.parameters[0] = sheet;
        c.parameters[1] = index;
        sheetsUsed.add(sheet);
        wired++;
      }
    });
    note('faces', wired > 0, `${wired} dialogue boxes given a portrait from ${[...sheetsUsed].join(' + ')}.png` +
      (unknown.size ? ` · no portrait defined for: ${[...unknown].join(', ')}` : ''));
    save('CommonEvents.json', commonEvents);
  }
}

/* ============================ 2. AUDIO ============================ */
{
  const manifestPath = path.join(HERE, 'audio-manifest.json');
  if (!exists(manifestPath)) {
    note('audio', false, 'audio-manifest.json missing — the game is still silent');
  } else {
    const a = readJ(manifestPath);
    const track = (kind, name, volume = 80) => {
      if (!name) return null;
      const file = path.join(ROOT, 'audio', kind, name + '.ogg');
      return exists(file) ? { name, pan: 0, pitch: 100, volume } : false;
    };
    let applied = 0, missing = [];
    for (const { id, file, map } of allMaps) {
      const spec = (a.maps || {})[id] || {};
      const bgm = track('bgm', spec.bgm);
      const bgs = track('bgs', spec.bgs, 55);
      if (bgm === false) missing.push(`map${id} bgm ${spec.bgm}`);
      if (bgs === false) missing.push(`map${id} bgs ${spec.bgs}`);
      if (bgm) { map.bgm = bgm; map.autoplayBgm = true; applied++; }
      if (bgs) { map.bgs = bgs; map.autoplayBgs = true; applied++; }
      save(file, map);
    }
    if (a.titleBgm) {
      const t = track('bgm', a.titleBgm, 70);
      if (t) { system.titleBgm = t; applied++; } else missing.push('titleBgm ' + a.titleBgm);
    }
    if (a.victoryMe) {
      const me = track('me', a.victoryMe, 90);
      if (me) { system.victoryMe = me; applied++; } else missing.push('victoryMe ' + a.victoryMe);
    }
    if (a.endingMe) {
      const me = track('me', a.endingMe, 90);
      if (me) { audioSpec.endingMe = me.name; applied++; } else missing.push('endingMe ' + a.endingMe);
    }
    audioSpec.tokenMe = a.tokenMe || '';
    save('System.json', system);
    note('audio', applied > 0 && missing.length === 0,
      `${applied} sound fields set` + (missing.length ? ` · MISSING FILES: ${missing.join(', ')}` : ''));
  }
}

/* ==================== 3. AXIS STRESS MADE REAL ==================== */
// The translation stage left `AxisExt.toast("Axis stress rises")` calls — text
// claiming a change that never happened. Each becomes a real shift, and
// resolving a support lets some of the pressure back out.
{
  const SOURCE = { 5: 6, 7: 8, 8: 8, 9: 5, 11: 5, 12: 5, 13: 6, 14: 6 };
  let raised = 0;
  for (const { id, file, map } of allMaps) {
    const delta = SOURCE[id] || 6;
    let touched = false;
    for (const ev of map.events) {
      if (!ev) continue;
      for (const page of ev.pages) {
        for (const c of page.list) {
          if (c.code !== 355) continue;
          const src = String(c.parameters[0] || '');
          if (!src.includes('Axis stress rises')) continue;
          if (src.includes('AxisExt.stress(')) continue;       // already wired
          c.parameters[0] = `AxisExt.stress(${delta}); ` + src;
          raised++; touched = true;
        }
      }
    }
    if (touched) save(file, map);
  }

  // Relief: the first time each support token is granted, stress drops.
  const TOKENS = ['northToken', 'eastToken', 'westToken'];
  let relieved = 0;
  for (const { id, file, map } of allMaps) {
    let touched = false;
    for (const ev of map.events) {
      if (!ev) continue;
      for (const page of ev.pages) {
        const list = page.list;
        for (let i = list.length - 1; i >= 0; i--) {
          const c = list[i];
          if (c.code !== 121) continue;
          const target = system.switches[c.parameters[0]];
          if (!TOKENS.includes(target)) continue;
          if (c.parameters[2] !== 0) continue;                 // only when set ON
          const next = list[i + 1];
          if (next && next.code === 355 && String(next.parameters[0]).includes('stress(-')) continue;
          list.splice(i + 1, 0, {
            code: 355, indent: c.indent,
            parameters: ['AxisExt.stress(-8); AxisExt.toast("The pressure eases, a little");']
          });
          relieved++; touched = true;
        }
      }
    }
    if (touched) save(file, map);
  }

  // Assert state, not this run's delta: the pass is idempotent and a second run
  // must report the same truth.
  let wired = 0, declared = 0, reliefs = 0;
  for (const { map } of allMaps) {
    for (const ev of map.events) {
      if (!ev) continue;
      for (const page of ev.pages) {
        for (const c of page.list) {
          if (c.code === 355 && String(c.parameters[0]).includes('Axis stress rises')) {
            declared++;
            if (String(c.parameters[0]).includes('AxisExt.stress(')) wired++;
          }
          if (c.code === 355 && String(c.parameters[0]).includes('AxisExt.stress(-8)')) reliefs++;
        }
      }
    }
  }
  note('stress', declared > 0 && wired === declared && reliefs === 3,
    `${wired}/${declared} "stress rises" warnings move the meter · ${reliefs}/3 support tokens relieve it (-8 each)` +
    (relieved ? ` · ${relieved} relief(s) inserted this run` : ''));
}

/* ====================== 4. OPTIONAL COMBAT ====================== */
// The spec asks for combat that is secondary and avoidable. One creature per
// deep map: you can walk past it, flee it, and losing costs stress — not the run.
{
  const ASSETS = [
    ['img/enemies/Matango.png', 'img/enemies/Matango.png'],
    ['img/enemies/SF_Shadow.png', 'img/enemies/SF_Shadow.png'],
    ['img/battlebacks1/Wood1.png', 'img/battlebacks1/Wood1.png'],
    ['img/battlebacks2/DarkSpace.png', 'img/battlebacks2/DarkSpace.png']
  ];
  let copied = 0;
  for (const [rel] of ASSETS) {
    const dst = path.join(ROOT, rel);
    const src = path.join(DONOR, rel);
    if (!exists(dst) && exists(src)) {
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(src, dst);
      copied++;
    }
  }

  const enemy = (id, name, battler, params, gold, exp) => ({
    id, name, battlerName: battler, battlerHue: 0, params, exp, gold,
    dropItems: [
      { kind: 0, dataId: 1, denominator: 1 },
      { kind: 0, dataId: 1, denominator: 1 },
      { kind: 0, dataId: 1, denominator: 1 }
    ],
    actions: [{ skillId: 1, rating: 5, conditionType: 0, conditionParam1: 0, conditionParam2: 0 }],
    traits: [],
    note: 'Optional encounter. Never blocks the story.'
  });
  const enemies = load('Enemies.json').map(() => null);
  enemies[1] = enemy(1, 'Hollow Growth', 'Matango', [150, 0, 16, 8, 12, 8, 10, 6], 0, 4);
  enemies[2] = enemy(2, 'Root Shadow', 'SF_Shadow', [120, 40, 14, 6, 18, 10, 22, 8], 0, 5);
  save('Enemies.json', enemies);

  const troopPage = () => ({
    conditions: {
      actorHp: 50, actorId: 1, actorValid: false, enemyHp: 50, enemyIndex: 0,
      enemyValid: false, switchId: 1, switchValid: false,
      turnA: 0, turnB: 0, turnEnding: false, turnValid: false
    },
    list: [{ code: 0, indent: 0, parameters: [] }],
    span: 0
  });
  const troops = load('Troops.json').map(() => null);
  troops[1] = { id: 1, name: 'Hollow Growth', members: [{ enemyId: 1, x: 420, y: 400, hidden: false }], pages: [troopPage()] };
  troops[2] = { id: 2, name: 'Root Shadow', members: [{ enemyId: 2, x: 420, y: 400, hidden: false }], pages: [troopPage()] };
  save('Troops.json', troops);

  // One optional creature on each deep map, once only (self switch A).
  const ENCOUNTERS = [
    { map: 5, x: 10, y: 6, troop: 1, name: 'hollowgrowth', label: 'Something is growing in the root seam, and it is breathing.' },
    { map: 6, x: 11, y: 8, troop: 1, name: 'hollowgrowthB', label: 'A growth the size of a dog, bark-skinned, half-fused to the wall.' },
    { map: 8, x: 3, y: 3, troop: 2, name: 'rootshadow', label: 'Your own shape, standing in the trunk, one breath behind you.' },
    { map: 13, x: 3, y: 9, troop: 2, name: 'rootshadowB', label: 'A shadow with no one casting it.' }
  ];
  let added = 0;
  for (const e of ENCOUNTERS) {
    const entry = allMaps.find(m => m.id === e.map);
    const map = load(entry.file);
    const named = map.events.find(ev => ev && ev.name === e.name);
    const battle = [
      { code: 101, indent: 0, parameters: ['', 0, 0, 2, ''] },
      { code: 401, indent: 0, parameters: [e.label] },
      { code: 301, indent: 0, parameters: [0, e.troop, true, true] },   // canEscape, canLose
      { code: 111, indent: 0, parameters: [12, '$gameTroop.isAllDead()'] },
      { code: 355, indent: 1, parameters: ['AxisExt.stress(-4); AxisExt.toast("It comes apart like wet bark");'] },
      { code: 411, indent: 0, parameters: [] },
      { code: 355, indent: 1, parameters: ['AxisExt.stress(15); AxisExt.toast("You come to on the floor of the hollow");'] },
      { code: 122, indent: 1, parameters: [1, 1, 0, 0, 15] },
      { code: 412, indent: 0, parameters: [] },
      { code: 123, indent: 0, parameters: ['A', 0] },
      { code: 0, indent: 0, parameters: [] }
    ];
    if (named) {
      named.pages[0].list = battle;
    } else {
      const base = {
        conditions: {
          actorId: 1, actorValid: false, itemId: 1, itemValid: false,
          selfSwitchCh: 'A', selfSwitchValid: false,
          switch1Id: 1, switch1Valid: false, switch2Id: 1, switch2Valid: false,
          variableId: 1, variableValid: false, variableValue: 0
        },
        directionFix: false,
        image: { tileId: 0, characterName: '', direction: 2, pattern: 0, characterIndex: 0 },
        list: battle,
        moveFrequency: 3,
        moveRoute: { list: [{ code: 0, parameters: [] }], repeat: true, skippable: false, wait: false },
        moveSpeed: 3, moveType: 0, priorityType: 1, stepAnime: false, through: false, trigger: 0, walkAnime: true
      };
      const spent = JSON.parse(JSON.stringify(base));
      spent.conditions.selfSwitchValid = true;
      spent.list = [{ code: 0, indent: 0, parameters: [] }];
      map.events.push({ id: map.events.length, name: e.name, note: 'optional encounter', x: e.x, y: e.y, pages: [base, spent] });
      added++;
    }
    save(entry.file, map);
  }
  note('combat', copied >= 0 && troops.every((t, i) => i === 0 || !t || typeof t.name === 'string') && added >= 0
    ? (allMaps.reduce((n, { map }) => n + map.events.filter(e => e && ENCOUNTERS.some(x => x.name === e.name)).length, 0) === ENCOUNTERS.length)
    : false,
    `${copied} battler/backdrop files copied this run · 2 enemies + 2 troops defined · ` +
    `${allMaps.reduce((n, { map }) => n + map.events.filter(e => e && ENCOUNTERS.some(x => x.name === e.name)).length, 0)}/${ENCOUNTERS.length} optional encounters in place (escape or lose allowed)`);
}

/* =================== 5. THE VILLAGE NOTICES =================== */
// Ambient villagers react to where the story has got to, the way §3.1 asks.
{
  const LINES = {
    v1: [
      { when: null, speaker: 'Ospen', lines: ['Felt it again at first light. Whole shelf of pots came off the wall.'] },
      { when: 'firstHollow', speaker: 'Ospen', lines: ['You went down into it, then. And came back up. That is more than the dog did.'] },
      { when: 'threeTokens', speaker: 'Ospen', lines: ['All three of them steady, they say. I will believe it when my cups stay on the shelf a week.'] }
    ],
    v2: [
      { when: null, speaker: 'Nell', lines: ['Mara has been at the shrine since dawn. She does not eat when she is thinking.'] },
      { when: 'firstHollow', speaker: 'Nell', lines: ['The roots are in the walls down there, she says. Growing through the rock like it is nothing.'] },
      { when: 'threeTokens', speaker: 'Nell', lines: ['Take the good blankets down to the shrine, will you? She will not ask for them.'] }
    ],
    v3: [
      { when: null, speaker: 'Halder', lines: ['Wind came up the road backwards yesterday. No, I do not know what I mean by that.'] },
      { when: 'finalChoice', speaker: 'Halder', lines: ['It is quiet. Not the quiet of nothing happening. The other kind.'] }
    ]
  };
  let done = 0;
  const entry = allMaps.find(m => m.id === 2);
  const map = load(entry.file);
  for (const [name, variants] of Object.entries(LINES)) {
    const ev = map.events.find(e => e && e.name === name);
    if (!ev) continue;
    const template = JSON.parse(JSON.stringify(ev.pages[0]));
    const pages = [];
    for (const v of variants) {
      const page = JSON.parse(JSON.stringify(template));
      page.conditions.switch1Valid = !!v.when;
      if (v.when) page.conditions.switch1Id = SWITCH_ID[v.when];
      page.list = talkList(v.speaker, v.lines);
      pages.push(page);
    }
    ev.pages = pages;
    done++;
  }
  save(entry.file, map);
  note('village', done === 3, `${done}/3 ambient villagers now have progress-reactive dialogue pages`);
}

/* ================= 6. ENDINGS READ THE METER ================= */
// §5.2: stress flavours the ending text. Insert a variant line into both endings.
{
  const entry = allMaps.find(m => m.id === 14);
  const map = load(entry.file);
  const ev = map.events.find(e => e && e.name === 'axisheart');
  let inserted = 0, meWired = 0;
  if (ev) {
    for (const page of ev.pages) {
      const list = page.list;
      for (let i = list.length - 1; i >= 0; i--) {
        const c = list[i];
        if (c.code !== 401) continue;
        const line = String(c.parameters[0] || '');
        if (!line.includes('supports take the weight back')) continue;
        // walk back to the 101 that opened this text box
        let start = i;
        while (start > 0 && list[start].code !== 101) start--;
        if (list[start - 1] && list[start - 1].code === 355 &&
            String(list[start - 1].parameters[0]).includes('ENDING_STRESS_VARIANT')) continue;
        const variant = [
          { code: 111, indent: c.indent, parameters: [1, 1, 0, 70, 3] },   // AxisStress >= 70
          { code: 101, indent: c.indent + 1, parameters: ['', 0, 0, 2, ''] },
          { code: 401, indent: c.indent + 1, parameters: ['Your hands are still shaking an hour later. The wood has taken the weight back and left the tremor in you, where it will stay for a while.'] },
          { code: 355, indent: c.indent + 1, parameters: ['// ENDING_STRESS_VARIANT'] },
          { code: 412, indent: c.indent, parameters: [] }
        ];
        // insert after the current text box ends
        let end = i;
        while (end < list.length && list[end].code === 401) end++;
        list.splice(end, 0, ...variant);
        inserted++;
        break;
      }
      // the ending theme: an ME before every return to the title, in both endings
      if (audioSpec.endingMe) {
        for (let i = list.length - 1; i >= 0; i--) {
          if (list[i].code !== 354) continue;
          const prev = list[i - 1];
          if (prev && prev.code === 249) continue;
          list.splice(i, 0, {
            code: 249, indent: list[i].indent,
            parameters: [{ name: audioSpec.endingMe, volume: 90, pitch: 100, pan: 0 }]
          });
          meWired++;
        }
      }
    }
    save(entry.file, map);
  }
  note('endings', inserted > 0, `${inserted} ending paragraph now varies with AxisStress >= 70`
    + (audioSpec.endingMe ? ` · ending ME '${audioSpec.endingMe}' placed ${meWired}x` : ' · no ending ME available'));
}

/* ============================== REPORT ============================== */

save('System.json', system);
let bad = 0;
for (const r of report) {
  if (!r.ok) bad++;
  console.log(`${r.ok ? 'OK  ' : 'FAIL'}  ${r.section.padEnd(8)} ${r.text}`);
}
console.log(`\n${report.length - bad}/${report.length} deepening steps applied`);
process.exitCode = bad ? 1 : 0;
