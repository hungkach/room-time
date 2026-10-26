// Writes test/fixtures/synthetic-stance.json: stand, stance, deep level change, stance, stand,
// in the same trace format the camera check exports. Run: node test/helpers/make-synthetic-fixture.mjs
import { writeFileSync } from 'node:fs';
import { loadRT } from './load.mjs';
import { trace } from './figure.mjs';
import { calFor } from './cal.mjs';

const RT = loadRT();
const sq = { footW: 0.5, lean: 0.35 };
const { frames, labels } = trace([
  { ms: 0, label: 'tall', hip: 0.95, footW: 0.3, lean: 0.05 },
  { ms: 1500, label: 'stance', hip: 0.62, ...sq },
  { ms: 3500, label: 'deep', hip: 0.42, ...sq },
  { ms: 4300, label: 'stance', hip: 0.64, ...sq },
  { ms: 6000, label: 'tall', hip: 0.95, footW: 0.3, lean: 0.05 },
  { ms: 7000, hip: 0.95, footW: 0.3, lean: 0.05 },
], {}, 15);
const out = {
  format: 'room-time-trace', version: 1,
  meta: { source: 'synthetic', aspect: 4 / 3, w: 1920, h: 1440, src: 'world', cal: calFor() },
  frames: frames.map((f) => ({ t: f.t, lm: RT.pack(f.lm), wl: RT.pack(f.wl) })),
  labels,
};
writeFileSync(new URL('../fixtures/synthetic-stance.json', import.meta.url), JSON.stringify(out));
console.log(frames.length, 'frames', labels.length, 'labels');
