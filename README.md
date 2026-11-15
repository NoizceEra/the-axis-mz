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
img/                  tileset sheet, character sheets, pictures, title
audio/                RTP sound effects (no music ships)
tools/mz/build.mjs    regenerates every data/*.json from the web build's content
tools/mz/playthrough.mztest.js   in-page verification driver
```

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
  vent shaft, east marsh, west circle, deep root, trunk), 2,917 tiles, 75 events,
  **1,012 event commands**.
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

Only three script calls exist, in `js/plugins/AxisExt.js` (~120 lines):

| call | why it is not native |
|---|---|
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

`tools/mz/playthrough.mztest.js` drives the real runtime. Latest run:
**11/11 checks passed, zero console errors.**

- new game boots on the home map; the opening autorun plays Vela's scene and sets
  the `started` switch
- walking with real arrow keys through the door transfers to the village, and the
  village's entry scene runs
- the action button talks to villagers and shows the right (switch-dependent) line
- the north trail is gated with a message before the First Hollow and opens after it
- the east marsh push block moves, the north vent plugs resolve in order
  (one → three → two), the trunk is reachable
- tileset passage is correct: walls block, floors walk
- title screen and maps render (checked visually, not just by assertion)

Headless notes, since they cost time: MZ's loop is a PIXI ticker that dies if the
tab is backgrounded, `DataManager` loads JSON over async XHR, and a missing
`img/characters/Vehicle.png` throws every frame and silently freezes the game via
`SceneManager.catchException`. Kill the cache (`Network.setCacheDisabled`) or the
plugin edits will not load.

## Differences from the web build (honest list)

- **Custom player name** is dropped (MZ actor names are fixed without extra
  scripting); the actor is "Wren".
- **Objective/toast** are plugin-drawn HUD text, not MZ windows.
- **Axis-stress visuals** (thinner sap, extra gnaw marks on the root maps) are not
  ported — that was per-pixel rendering. Stress still drives text and the
  `AxisHighStress` switch.
- **Art is 3× upscaled 16×16.** MZ's grid is locked to 48×48; the doc lists tile
  size as an open point. Redrawing at native 48×48 is the upgrade path.
- **No audio beyond RTP sound effects** — the sparse wind/rumble/chiptune layer
  from the web build would need real .ogg assets.
- Save/load, menus, and the message system are MZ's own (better than the web
  build's localStorage).
