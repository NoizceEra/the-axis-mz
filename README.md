# THE AXIS — Game 1: The Trembling (RPG Maker MZ project)

**Play: https://noizceera.github.io/the-axis-mz/**


A real **RPG Maker MZ 1.9.0** project, generated from the design doc and the
playable web build in `../the-axis`. It runs in a browser as-is (that is how MZ
projects run) and opens in the MZ editor if you have it.

```
index.html            the game — open it through a static server
game.rmmzproject      MZ project marker
data/                 the database + 14 maps, all native MZ JSON
js/                   the untouched MZ runtime + js/plugins/AxisExt.js
img/                  tileset, character sheets, 2 face sheets, pictures, title
audio/                bgm + bgs + me + se (RTP), all wired per map
tools/mz/build.mjs    translates the web build's content into native MZ JSON
tools/mz/tileset.mjs  restores the RTP sheet names + flags build.mjs does not emit
tools/mz/deepen.mjs   the game-design pass: faces, audio, stress, combat, repairs
tools/mz/vista.mjs    the village layout pass: real buildings + invisible collision
tools/mz/buildings.py renders the building sprites (see "The village vista pass")
tools/mz/tileset-rtp.json  the RTP tileset contract (names + 8192 passage flags)
tools/mz/validate.mjs structural validator (branch nesting, ids, assets, reachability)
tools/mz/playtest-lib.js + playtest.js   in-engine verification drivers
```

## The deepening pass

`build.mjs` only *translates*. `deepen.mjs` is where it becomes a game, and it is
idempotent — run it twice and it reports the same state:

| step | what it does |
|---|---|
| repairs | fixes event pages the translation got subtly wrong (see below) |
| faces | every speaker's line gets a portrait, looked up by name |
| audio | a BGM per map, ambience BGS, title theme, ending ME, from real RTP files |
| stress | turns `AxisExt.toast("Axis stress rises")` into an actual meter change |
| combat | one optional creature per deep map; escapable, losing costs stress not the run |
| village | three ambient villagers whose dialogue follows your progress |
| endings | an extra ending paragraph when AxisStress ≥ 70, and the ending ME |

### Two bug classes the translation introduced, and the repairs

1. **Unreachable walk-on transfers.** A transfer page at the same priority as the
   player blocks the tile, so you can never stand on it and the touch trigger
   never fires — the North Ridge vent door existed and could not be entered.
2. **Unreachable interactables.** MZ only offers the OK button to events at
   *normal* priority (`isNormalPriority()`); 11 examinable pages — the sap, the
   lean tree, the west pit, the Deep Root barrier, the trunk notch — were below
   the player and could never be examined.

Both are now repaired by the pipeline and **enforced** by `validate.mjs`, so they
cannot come back silently.

## The Axis stress meter

`js/plugins/AxisExt.js` draws a persistent meter for the `AxisStress` variable
(1, 0–100) in the top-right, plus the objective line and toasts. Colour is
semantic: moss → ochre → rust. `AxisExt.stress(n)` shifts it, clamps 0–100, and
sets/clears `AxisHighStress` at 50 / 45 (hysteresis, so a value sitting on the
line cannot chatter). At high stress the hollow maps load with a darker tint —
presentation only: **the meter never locks content out**, exactly as §5.2 asks.


## Run it

```bash
python -m http.server 8145
# open http://127.0.0.1:8145/
```

MZ projects are served, not double-clicked: `index.html` loads `data/*.json` over
XHR, so `file://` will not work.

**To open it in RPG Maker MZ:** copy this folder anywhere and open
`game.rmmzproject`. Requires MZ 1.9+ (built and tested on 1.9.0). The MZ editor
is *not* installed on this machine — the runtime is, inside existing project
folders — so this project was authored as data, not through the GUI.

## What is native MZ and what is a plugin

Everything the doc asks for is **native RPG Maker**, editable in the editor:

- **14 maps** (Ashhollow, home, shrine, ridge track, 4 hollow rooms, north ridge,
  vent shaft, east marsh, west circle, deep root, trunk), 2,917 tiles, 79 events,
  **1,155 event commands**.
- **42 named switches** with the same names as the web build (`firstHollow`,
  `ventOpen`, `threeTokens`, `FinalChoiceStabilize`, …) and one variable,
  `AxisStress` (0–100).
- Real command codes throughout: Show Text (101/401) with speaker names, Show
  Choices (102/402/404), Conditional Branch (111/411/412), Control Switches (121),
  Control Variables (122), Change Items (126), Transfer Player (201), Call Common
  Event (117), Show/Erase Picture (231/235), Screen Shake (225), Play SE (250),
  Wait (230), Return to Title (354).
- **6 common events**: `TremorEffect`, `ShowCaretakerMessage`, `CheckTokens`, and
  one per consumable (using an item fires its common event and lowers stress).
- Key items vs regular items use MZ's own key-item flag.

Four script calls exist, in `js/plugins/AxisExt.js` (~230 lines):

| call | why it is not native |
|---|---|
| `AxisExt.stress(n)` | the meter is a drawn bar, not a window; this is the only writer of AxisStress |
| `AxisExt.objective("…")` | MZ has no text variable for a HUD line |
| `AxisExt.toast("…")` | same — a brief centred notice |
| `AxisExt.push(this._eventId)` | pushing a block needs a passability test the event commands cannot express |

The endings, transfers, gates, puzzles, dialogue and the Axis-stress logic are
all ordinary events.

## The village vista pass

The first build put Ashhollow's houses on the map as 4×3 blocks of one brick tile:
no roof pitch, no door, no windows, and six buildings all the same. `vista.mjs`
replaces them with real sprites, and the interesting part is that MZ needed
nothing new to do it.

**The art.** `tools/mz/buildings.py` drives
[`parametric-topdown`](../../parametric-topdown) — 10 architectural styles × 46
building types rendered from a CLI — and then knocks the output into shape:
`--no-aa` for hard pixel edges, crop to the opaque bbox, **quantise to a locked
33-colour palette**, crop again to the tiles the sprite actually covers, and
compose a `!$axis_bldg_<name>.png` sheet of 3×4 cells. Cell sizes are exact
multiples of MZ's 48px grid (home 5×5, elder 6×5, shop 5×5, forge 4×4, granary
4×4 — plus shrine 8×6 and a ruin 4×3 for later maps).

The palette is the point. It merges two families on purpose: the RTP greens and
browns that are actually on Ashhollow's ground layer, and THE AXIS' own
moss/ochre/rust. Rendered at 1,441–12,539 distinct colours, quantised to 12–19.
One palette across tiles and buildings is what stops asset soup.

**The mechanics**, each checked against the shipped runtime rather than assumed:

| what | how | why it is not obvious |
|---|---|---|
| one big sprite per building | `!$name.png` on a single event | `ImageManager.isBigCharacter()` keys on `$`; `!` drops the +6px foot offset; `Sprite_Character` anchors (0.5, 1), so the image grows up and out from the event's tile |
| the body is solid | invisible impassable tile on layer z1, id 512 | an event blocks exactly ONE tile — `isCollidedWithCharacters()` only tests `pos(x,y) && !isThrough()`. `layeredTiles()` walks z3→z0, so a blocked z1 tile beats the grass underneath |
| the door answers | the interaction lives ON the building page | you press OK at the tile you *face*. A separate door event on the front tile shadows the building and the wall never responds |
| the plots exist | the decorative lanes go back to grass, one spur per door | the old map had a road every third row, leaving 2-tile bands — no plot could ever hold a building |

## Regenerating the data

```bash
npm run art      # the building sprites  (needs python + Pillow, and parametric-topdown beside this repo)
npm run build    # tileset -> deepen -> vista
npm run check    # the same, then the validator
```

`data/*.json` is generated, not hand-edited. **`npm run regen` also runs
`build.mjs` first, and that will undo two things only a human did**: it re-emits
a tileset whose A-sheets are unnamed (every animated-water tile then renders as a
48px black hole) and it repaints the ground with procedural ids instead of the
RTP ones the maps ship with. `tileset.mjs` repairs the first from
`tileset-rtp.json`; the second has no automatic repair, which is why `build` does
not call `build.mjs` and `regen` is the explicit opt-in.

build → tileset → deepen → vista is **idempotent**: run it three times and the
project stays at 82 events · 127 pages · 1,144 commands with 0 errors. Getting
there meant two fixes — the ending pass was appending 5 commands to the Last
Door's page on every run (its "already applied" guard looked at the wrong
offset), and `deepen` reported *this run's delta* rather than the project's
state, so a no-op run printed FAIL and, because npm chains with `&&`, silently
stopped the pipeline before vista ever ran.

## Verification (what was actually run)

Two layers, both against the real MZ 1.9.0 runtime in a headless browser:

**`node tools/mz/validate.mjs`** — 14 maps · 82 events · 127 pages · **1,144
commands · 0 errors · 0 warnings**. It checks branch nesting (111/411/412 and
102/402/404 balance), text boxes with no lines, switch/variable/troop/item ids,
transfer targets inside the target map, every referenced picture/face/audio file
on disk, tileset flag sanity, the two event-page reachability rules above, and —
added with the vista pass — two invariants whose violation is a hard crash rather
than a visual glitch:

- **`$dataMap.events` must stay indexed by id** (null at 0, `events[i].id === i`).
  `Game_Event.initialize` does `this.locate(this.event().x, …)` and
  `this.event()` is `$dataMap.events[this._eventId]`, so deleting an event and
  letting the array shift makes the whole map throw
  `Cannot read properties of undefined (reading 'x')` at `Game_Map.setupEvents`.
  Deliberately de-indexing one map makes the validator emit 17 errors.
- **Every `bldg_*` event** must use a `!$` sheet, sit at priority 1 (or the OK
  button can never reach it), and have a cell that is a whole number of 48px tiles.

The village, verified through real input in the headless engine:

- all five door front tiles are walkable in all four directions (the granary's had
  a decor tile on it — decor sits above the ground layer, so painting a path
  underneath changed nothing);
- every tile of every building body is solid: walking north from (15,7) stops at
  (15,5) instead of walking onto the roof;
- the elder's door answers with the line that used to belong to the separate
  `marahouse` event — it was adopted into the building page, not duplicated;
- the forge and granary answer with new lines; the home door still transfers
  walk-on to map 1;
- no console errors, no black holes. (The black holes were a real bug for a while:
  `build.mjs` emits a tileset with unnamed A-sheets, so every animated-water tile
  drew the backdrop as a solid 48px square.)

**In-engine playtest** (`tools/mz/playtest-lib.js` + driven stages) — the runs
that passed, all through real input and MZ's own update loop:

- title → new game boots in the home in Ashhollow
- the stress meter hides at 0, draws at 55 (2,731 opaque pixels), shows `AXIS`
  and the number; `stress()` clamps at 0 and 100
- `AxisHighStress` goes ON at 50, *stays* ON at 45, clears below that
- examining the sap in the First Hollow moves the meter 10 → 18 (this page was
  unreachable before the repair — the test is what proved it)
- the optional creature opens a real `Scene_Battle` with the Hollow Growth troop,
  `canEscape` and `canLose` both true
- ambient villager text changes once `firstHollow` is set
  ("Felt it again at first light…" → "You went down into it, then…")
- save/load restores the map, `AxisStress`, and the support token
- the stabilise ending runs end to end at stress 75: switches set, the extra
  high-stress paragraph appears, 1,567 characters of ending text, back to title
- faces render in the message window with the speaker nameplate (checked visually,
  not just by assertion)

Headless notes, since they cost time: MZ skips scene updates unless
`SceneManager.isGameActive()` (which checks `document.hasFocus()`), so a headless
driver must override it; text reveals progressively per frame, so a mid-reveal
screenshot looks clipped when nothing is wrong; and a battle's defeat message
cannot be dismissed inside one synchronous block, so the escape path was driven
end to end and the defeat path verified by its flags rather than pretence.


## Differences from the web build (honest list)

- **Custom player name** is dropped (MZ actor names are fixed without extra
  scripting); the actor is "Wren".
- **Objective/toast/stress meter** are plugin-drawn HUD text, not MZ windows.
- **Axis-stress visuals** (thinner sap, extra gnaw marks on the root maps) are not
  ported as pixel work — that was per-pixel rendering in the web build. In MZ the
  meter, the `AxisHighStress` switch, the darker tint in the deep maps and the
  ending paragraph carry it instead.
- **Art**: the RTP tiles are RTP, the characters are the procedural 16×16 art
  upscaled 3× into 48×48, and the buildings in Ashhollow are **native 48px-grid
  parametric sprites** (see the vista pass). So the village is the part of the
  game whose art is native MZ resolution; the other maps still ride on upscaled
  tiles, and the cast is upscaled throughout — that is the remaining upgrade path.
- **Audio is RTP** — real .ogg tracks chosen per map, not a bespoke score. It is
  sparse and restrained by track choice, not by composition.
- Save/load, menus, and the message system are MZ's own (better than the web
  build's localStorage).

