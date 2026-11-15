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
tools/mz/deepen.mjs   the game-design pass: faces, audio, stress, combat, repairs
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

## Regenerating the data

`data/*.json` is generated, not hand-edited:

```bash
node tools/mz/build.mjs
```

It reads `../the-axis/js/data.js` (the story, maps, switches, every script) and
emits the MZ files. Edit the web build's data, re-run, and the MZ project follows.
The art is generated the same way — `tools/art-export/index.html` renders the
procedural tiles/sprites from `../the-axis/js/art.js` straight into MZ's sheet
formats (16×16 art scaled 3× into 48×48 tiles, 3×4 character sheets, 240×144
pictures at 3×).

## Verification (what was actually run)

Two layers, both against the real MZ 1.9.0 runtime in a headless browser:

**`node tools/mz/validate.mjs`** — 14 maps · 79 events · 124 pages · **1,155
commands · 0 errors · 0 warnings**. It checks branch nesting (111/411/412 and
102/402/404 balance), text boxes with no lines, switch/variable/troop/item ids,
transfer targets inside the target map, every referenced picture/face/audio file
on disk, tileset flag sanity, and the two event-page reachability rules above.

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
- **Art is 3× upscaled 16×16** for the tiles and characters. MZ's grid is locked
  to 48×48; redrawing at native 48×48 is the upgrade path. Faces and pictures are
  generated at MZ's native sizes (144×144 cells, 816×624 pictures).
- **Audio is RTP** — real .ogg tracks chosen per map, not a bespoke score. It is
  sparse and restrained by track choice, not by composition.
- Save/load, menus, and the message system are MZ's own (better than the web
  build's localStorage).

