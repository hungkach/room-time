// Shot, sprawl and snap from synthetic clips, read through the same path as the game:
// measure -> readouts (against a calibration) -> move detector.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRT } from './helpers/load.mjs';
import { trace } from './helpers/figure.mjs';
import { calFor } from './helpers/cal.mjs';

const RT = loadRT();
const SQ = { hip: 0.62, footW: 0.5, lean: 0.35, dist: 2.0 };
const FRAMINGS = { '4:3': {}, '16:9': { aspect: 16 / 9 }, mirrored: { mirror: true }, closer: { vfov: 70 } };

function moves(script, opts = {}) {
  const cal = calFor(opts), det = new RT.MoveDetector(), out = [];
  const { frames } = trace(script, opts, 30);
  for (const f of frames) {
    const m = RT.measure(f.lm, f.wl, opts.aspect || 4 / 3), r = RT.readouts(m, cal);
    const ev = det.push(RT.moveInput(f.t, m, r));
    if (ev) out.push(ev);
  }
  return out;
}
const types = (evs) => evs.map((e) => e.type).join(',');

for (const [name, fr] of Object.entries(FRAMINGS)) {
  test(`shot: a fast drop stepping in (${name})`, () => {
    const ev = moves([{ ms: 0, ...SQ }, { ms: 1000, ...SQ }, { ms: 1300, hip: 0.42, footW: 0.55, lean: 0.6, dist: 1.5 }, { ms: 2500, hip: 0.42, footW: 0.55, lean: 0.6, dist: 1.5 }], fr);
    assert.equal(types(ev), 'shot');
    assert.ok(ev[0].grow > 0.07 && ev[0].from > ev[0].to + 0.2, JSON.stringify(ev[0]));
  });
  test(`sprawl: a deep drop with the hips back (${name})`, () => {
    const ev = moves([{ ms: 0, ...SQ }, { ms: 1000, ...SQ }, { ms: 1300, hip: 0.32, footW: 0.6, lean: 0.9, dist: 2.3, handY: 0.4 }, { ms: 2500, hip: 0.32, footW: 0.6, lean: 0.9, dist: 2.3, handY: 0.4 }], fr);
    assert.equal(types(ev), 'sprawl');
  });
  test(`snap: hands from the tie to the belt, level held (${name})`, () => {
    const ev = moves([{ ms: 0, ...SQ, handY: 1.15 }, { ms: 1000, ...SQ, handY: 1.15 }, { ms: 1250, ...SQ, handY: 0.66 }, { ms: 2200, ...SQ, handY: 0.66 }], fr);
    assert.equal(types(ev), 'snap');
  });
  test(`nothing: a plain level change, a slow sink, circling, standing up (${name})`, () => {
    assert.equal(types(moves([{ ms: 0, ...SQ }, { ms: 1000, ...SQ }, { ms: 1250, ...SQ, hip: 0.54 }, { ms: 2500, ...SQ, hip: 0.54 }], fr)), '', 'level change');
    assert.equal(types(moves([{ ms: 0, ...SQ }, { ms: 3000, ...SQ, hip: 0.4, ramp: 2500 }, { ms: 4000, ...SQ, hip: 0.4 }], fr)), '', 'slow sink');
    assert.equal(types(moves([{ ms: 0, ...SQ }, { ms: 800, ...SQ, x: 0.5 }, { ms: 1600, ...SQ, x: -0.5 }, { ms: 2400, ...SQ, x: 0 }], fr)), '', 'circling');
    assert.equal(types(moves([{ ms: 0, ...SQ }, { ms: 800, hip: 0.95, footW: 0.3, lean: 0.05, dist: 2.0 }, { ms: 1800, hip: 0.95, footW: 0.3, lean: 0.05, dist: 2.0 }], fr)), '', 'standing up');
  });
}

for (const lead of [0.3, -0.3]) {
  test(`either lead: shot and sprawl from a staggered stance (stagger ${lead})`, () => {
    const st = { ...SQ, stagger: lead };
    assert.equal(types(moves([{ ms: 0, ...st }, { ms: 1000, ...st }, { ms: 1300, hip: 0.42, footW: 0.55, lean: 0.6, dist: 1.5, stagger: lead }, { ms: 2500, hip: 0.42, footW: 0.55, lean: 0.6, dist: 1.5, stagger: lead }])), 'shot');
    assert.equal(types(moves([{ ms: 0, ...st }, { ms: 1000, ...st }, { ms: 1300, hip: 0.32, footW: 0.6, lean: 0.9, dist: 2.3, handY: 0.4, stagger: lead }, { ms: 2500, hip: 0.32, footW: 0.6, lean: 0.9, dist: 2.3, handY: 0.4, stagger: lead }])), 'sprawl');
  });
}

test('a sprawl right after a shot waits out the refractory time, then counts', () => {
  const low = { hip: 0.42, footW: 0.55, lean: 0.6, dist: 1.5 }, sp = { hip: 0.32, footW: 0.6, lean: 0.9, dist: 2.3, handY: 0.4 };
  const ev = moves([{ ms: 0, ...SQ }, { ms: 1000, ...SQ }, { ms: 1300, ...low }, { ms: 2000, ...low }, { ms: 2400, ...SQ }, { ms: 3200, ...SQ }, { ms: 3500, ...sp }, { ms: 4500, ...sp }]);
  assert.equal(types(ev), 'shot,sprawl');
});

test('head height follows your level for the eye view', () => {
  const cal = calFor();
  const rd = (o) => RT.readouts(RT.measure(...(() => { const { frames } = trace([{ ms: 0, ...o }, { ms: 10, ...o }]); return [frames[0].lm, frames[0].wl, 4 / 3]; })()), cal);
  const stand = rd({ hip: 0.95, footW: 0.3, lean: 0.05, dist: 2.0 }), st = rd(SQ), deep = rd({ ...SQ, hip: 0.42, lean: 0.6 });
  assert.ok(Math.abs(stand.headRatio - 1) < 0.02, 'standing is 1: ' + stand.headRatio);
  assert.ok(st.headRatio < 0.85 && deep.headRatio < st.headRatio, `${st.headRatio} ${deep.headRatio}`);
});

test('One Euro settles on a held value and follows a fast change', () => {
  const f = new RT.OneEuro(1.5, 0.5);
  let v; for (let i = 0; i < 60; i++) v = f.filter(0.45 + (i % 2 ? 0.01 : -0.01), i / 30);
  assert.ok(Math.abs(v - 0.45) < 0.01);
  for (let i = 60; i < 75; i++) v = f.filter(0.2, i / 30);
  assert.ok(v < 0.25, 'follows a level change within half a second: ' + v);
});
