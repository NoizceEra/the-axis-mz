/**
 * THE AXIS - tileset pass.
 *
 * build.mjs emits a tileset whose A-sheets are empty: it only knows about the
 * procedural 16x16 'axis_B' sheet, so it writes
 *   tilesetNames: ['', '', '', '', '', 'axis_B', '', '', '']
 * while the maps it generates are painted with *RTP* tile ids (A1 water 1..9,
 * A2 grass/path 2048+, A5 1536+). With no A-sheet names those ids have no
 * texture, and MZ draws the black backdrop where they should be - whole 48px
 * columns of pure #000000 through the village.
 *
 * The RTP names and per-tile flags used to be a hand edit on top of the
 * generated file, which meant `npm run build` silently reverted the game's art.
 * They now live in tools/mz/tileset-rtp.json (checked in, extracted once from a
 * known-good build) and are re-applied here, so the pipeline is reproducible.
 *
 * Run order: build -> tileset -> deepen -> vista.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PROJ = path.resolve(HERE, '../..');
const DATA = path.join(PROJ, 'data');

const template = JSON.parse(fs.readFileSync(path.join(HERE, 'tileset-rtp.json'), 'utf8'));
const file = path.join(DATA, 'Tilesets.json');
const tilesets = JSON.parse(fs.readFileSync(file, 'utf8'));
const set = tilesets[1];

const before = {
    names: (set.tilesetNames || []).filter(Boolean).join(','),
    sheet7: set.tilesetNames?.[7] ?? '',
};

// The A..C sheet names and the flags come from the template. Slots 0..6 are
// FORCED (not merely filled): the map data is painted with Outside_A*/B/C tile
// ids, so if build.mjs has put 'axis_B' in slot 5 that is the wrong sheet for
// those ids and the decor renders as garbage. Slot 7 onward is left alone - that
// is where vista installs the invisible collision sheet.
set.name = template.name;
set.flags = template.flags.slice();
for (let i = 0; i <= 6; i++) {
    if (template.tilesetNames[i]) set.tilesetNames[i] = template.tilesetNames[i];
}
if (!set.tilesetNames[5]) set.tilesetNames[5] = 'axis_B';

/// slot 7 is the invisible collision sheet that tools/mz/vista.mjs paints under
// building bodies. It is part of the tileset contract, not something only vista
// knows about: declare it here too, so re-running the pipeline reports the
// tileset as unchanged instead of flapping the flag back and forth every run.
const MASK_ID = 512;
if (fs.existsSync(path.join(PROJ, 'img/tilesets/axis_mask.png'))) {
    set.tilesetNames[7] = 'axis_mask';
    set.flags[MASK_ID] = 0x60f;      // impassable all four directions, terrain tag 3
}

fs.writeFileSync(file, JSON.stringify(tilesets));

// fail loudly rather than shipping black holes again
const problems = [];
for (let i = 0; i < 5; i++) if (!set.tilesetNames[i]) problems.push(`A-sheet slot ${i} is unnamed`);
const discord = fs.existsSync(path.join(PROJ, 'img/tilesets/Outside_A2.png'));
if (!discord) problems.push('img/tilesets/Outside_A2.png missing - RTP sheets are not in this project');
if (problems.length) {
    console.error('tileset: ' + problems.join(' | '));
    process.exit(1);
}

console.log(`tileset: ${set.name} | A-sheets ${set.tilesetNames.slice(0, 5).join(', ')} | ` +
    `B..E ${set.tilesetNames.slice(5).map(n => n || '-').join(', ')} | ${set.flags.length} flags`);
