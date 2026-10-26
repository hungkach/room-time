// The calibration's stance coaching: each point a coach checks, read from synthetic stances.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRT } from './helpers/load.mjs';
import { figure } from './helpers/figure.mjs';
import { calFor } from './helpers/cal.mjs';

const RT = loadRT();
const GOOD = { hip: 0.62, footW: 0.5, lean: 0.45, elbowOut: 0.17 };
const FR = { '4:3': {}, mirrored: { mirror: true }, '16:9': { aspect: 16 / 9 } };
const check = (o, kind, fr) => { const f = figure({ ...fr, ...o }); return RT.stanceCheck(RT.measure(f.lm, f.wl, f.aspect), calFor(fr), kind); };
const off = (list) => list.filter((x) => !x.ok).map((x) => x.key).join(',');

for (const [name, fr] of Object.entries(FR)) {
  test(`a good square and staggered stance pass, either lead (${name})`, () => {
    assert.equal(off(check(GOOD, 'square', fr)), '');
    assert.equal(off(check({ ...GOOD, footW: 0.36, stagger: 0.35 }, 'stagger', fr)), '', 'left lead');
    assert.equal(off(check({ ...GOOD, footW: 0.36, stagger: -0.35 }, 'stagger', fr)), '', 'right lead');
  });
  test(`each fault is caught, one at a time (${name})`, () => {
    assert.equal(off(check({ ...GOOD, hip: 0.78 }, 'square', fr)), 'hips', 'too tall');
    assert.equal(off(check({ ...GOOD, hip: 0.4, lean: 0.6 }, 'square', fr)), 'hips', 'sitting too low');
    assert.equal(off(check({ ...GOOD, footW: 0.32 }, 'square', fr)), 'feet', 'feet narrow');
    assert.equal(off(check({ ...GOOD, footW: 0.36 }, 'stagger', fr)), 'feet', 'no stagger');
    assert.equal(off(check({ ...GOOD, lean: 0.1 }, 'square', fr)), 'chest', 'upright');
    assert.equal(off(check({ ...GOOD, headDown: true }, 'square', fr)), 'head', 'head down');
    assert.equal(off(check({ ...GOOD, elbowOut: 0.3 }, 'square', fr)), 'elbows', 'elbows out');
    assert.equal(off(check({ ...GOOD, handY: 0.35 }, 'square', fr)), 'hands', 'hands dropped');
  });
}

test('the cues say what to do, never left or right', () => {
  const all = check({ hip: 0.9, footW: 0.2, lean: 0.05, elbowOut: 0.35, handY: 0.3, headDown: true }, 'square', {});
  assert.ok(all.filter((x) => !x.ok).length >= 5);
  for (const x of all) assert.ok(!/\b(left|right)\b/i.test(x.say), x.say);
});
