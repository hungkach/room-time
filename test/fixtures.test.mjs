// Runs every labeled trace in test/fixtures through the stance classifier.
// A trace: {format: 'room-time-trace', version: 1, meta: {aspect, cal, src?}, frames: [{t, lm, wl}],
// labels: [{from, to, label: 'tall' | 'stance' | 'deep'}]}. Frames in a label's range must read
// that zone at least 90% of the time.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { loadRT } from './helpers/load.mjs';

const RT = loadRT();
const dir = new URL('./fixtures/', import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith('.json'));

test('there is at least one fixture', () => assert.ok(files.length > 0));

for (const f of files) {
  const tr = JSON.parse(readFileSync(new URL(f, dir), 'utf8'));
  test(`fixture ${f}`, () => {
    assert.equal(tr.format, 'room-time-trace');
    const { aspect, cal, src } = tr.meta;
    for (const lab of tr.labels || []) {
      if (!['tall', 'stance', 'deep'].includes(lab.label)) continue;
      const fr = tr.frames.filter((x) => x.t >= lab.from && x.t <= lab.to && x.lm);
      assert.ok(fr.length > 0, `frames for ${lab.label} at ${lab.from}`);
      const hit = fr.filter((x) => RT.readouts(RT.measure(x.lm, x.wl, aspect), cal, src).zone === lab.label).length;
      assert.ok(hit / fr.length >= 0.9, `${lab.label} ${lab.from}-${lab.to}: ${hit}/${fr.length}`);
    }
  });
}
