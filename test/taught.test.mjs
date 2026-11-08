// Taught moves (Mark, 11/8): sprawls and down blocks never registered in his garage (no mats, so no sprawl to the
// floor) and his shots are shot fakes (no room to step in). He shows each move twice in the warm-up; the detector then
// reads his moves against his own reps. Synthetic clips through the same path as the game.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRT } from './helpers/load.mjs';
import { trace } from './helpers/figure.mjs';
import { calFor } from './helpers/cal.mjs';

const RT = loadRT();
const SQ = { hip: 0.62, footW: 0.5, lean: 0.35, dist: 2.0 };
const FRAMINGS = { '4:3': {}, mirrored: { mirror: true }, closer: { vfov: 70 } };

// a move from the stance and back: hold, go to `to` over `ms`, hold it, come back up
const rep = (to, ms = 300, hold = 600) => [{ ms: 0, ...SQ }, { ms: 600, ...SQ }, { ms: 600 + ms, ...SQ, ...to }, { ms: 600 + ms + hold, ...SQ, ...to }, { ms: 1500 + ms + hold, ...SQ }, { ms: 2200 + ms + hold, ...SQ }];
// Mark's moves in a small garage with no mats
const MOVES = {
  sprawl: { hip: 0.5, footW: 0.6, lean: 0.8, dist: 2.25, handY: 0.42 },               // hips back and down, no floor
  shot: { hip: 0.52, footW: 0.5, lean: 0.62, dist: 2.0, handY: 0.82 },                 // a shot fake: level change, no step
  down_block: { hip: 0.57, lean: 0.48, dist: 2.08, handY: 0.66 },                      // hands toward the knees, small drop
  snap: { ...SQ, handY: 0.62 }                                                         // from a tie (below) to the belt
};
const SNAP_FROM = { handY: 1.08 };

function inputs(script, opts) {
  const cal = calFor(opts), out = [];
  const { frames } = trace(script, opts, 30);
  for (const f of frames) {
    const m = RT.measure(f.lm, f.wl, opts.aspect || 4 / 3), r = RT.readouts(m, cal);
    const s = RT.moveInput(f.t, m, r);
    if (s) out.push(s);
  }
  return out;
}
const scriptOf = (m, k = 1) => m === 'snap'
  ? [{ ms: 0, ...SQ, ...SNAP_FROM }, { ms: 600, ...SQ, ...SNAP_FROM }, { ms: 600 + 260 * k, ...SQ, handY: 0.62 }, { ms: 1500, ...SQ, handY: 0.62 }, { ms: 2200, ...SQ, handY: 0.62 }]
  : rep(MOVES[m], 300 * k);
function run(script, opts, taught) {
  const det = new RT.MoveDetector({ taught }), out = [];
  for (const s of inputs(script, opts)) { const ev = det.push(s); if (ev) out.push(ev.type); }
  return out;
}
function teach(opts) {
  const reps = {};
  for (const m of Object.keys(MOVES)) reps[m] = [inputs(scriptOf(m), opts), inputs(scriptOf(m, 1.2), opts)];
  return RT.learnMoves(reps);
}

for (const [name, fr] of Object.entries(FRAMINGS)) {
  test(`his garage sprawl and down block never read by the rules, every move once taught (${name})`, () => {
    assert.ok(!run(scriptOf('sprawl'), fr, null).includes('sprawl'), 'a sprawl with no floor is not a rules sprawl');
    assert.ok(!run(scriptOf('down_block'), fr, null).includes('down_block'), 'nor his block a rules block');
    assert.ok(!run(scriptOf('shot'), fr, null).includes('shot'), 'nor a shot fake a rules shot (no step)');
    const taught = teach(fr);
    for (const m of Object.keys(MOVES)) assert.ok(taught[m] && taught[m].n === 2, 'learned ' + m);
    for (const m of Object.keys(MOVES)) assert.deepEqual(run(scriptOf(m, 1.1), fr, taught), [m], m + ' reads as ' + m);
  });

  test(`taught moves stay apart, and a tired, shallower rep still counts (${name})`, () => {
    const taught = teach(fr);
    // 80% of the depth: still the move
    const tired = { ...MOVES.sprawl, hip: 0.62 - 0.8 * (0.62 - 0.5), lean: 0.7 };
    assert.deepEqual(run(rep(tired, 380), fr, taught), ['sprawl']);
    // half the depth: not a sprawl
    assert.ok(!run(rep({ ...MOVES.sprawl, hip: 0.62 - 0.4 * (0.62 - 0.5), lean: 0.5 }, 380), fr, taught).includes('sprawl'));
  });

  test(`moving in your stance, standing up and sinking a little throw nothing once taught (${name})`, () => {
    const taught = teach(fr);
    const circle = [{ ms: 0, ...SQ }, { ms: 800, ...SQ, x: 0.4 }, { ms: 1600, ...SQ, x: -0.4 }, { ms: 2400, ...SQ, x: 0.3 }, { ms: 3200, ...SQ }];
    const standUp = [{ ms: 0, ...SQ }, { ms: 600, ...SQ }, { ms: 1200, hip: 0.95, footW: 0.3, lean: 0.05, dist: 2.0 }, { ms: 2400, hip: 0.95, footW: 0.3, lean: 0.05, dist: 2.0 }, { ms: 3000, ...SQ }, { ms: 3600, ...SQ }];
    const sink = rep({ hip: 0.58, lean: 0.4 }, 400);
    for (const [what, sc] of [['circling', circle], ['standing up and back', standUp], ['sinking a little', sink]]) assert.deepEqual(run(sc, fr, taught), [], what);
  });
}

test('learning: reps with no real movement are left out; the detector remembers the closest attempt', () => {
  const fr = {};
  const still = inputs([{ ms: 0, ...SQ }, { ms: 2500, ...SQ }], fr);
  const t = RT.learnMoves({ sprawl: [still, inputs(scriptOf('sprawl'), fr)], snap: [still] });
  assert.equal(t.sprawl.n, 1); assert.equal(t.snap, undefined);
  const det = new RT.MoveDetector({ taught: teach(fr) }), half = rep({ ...MOVES.sprawl, hip: 0.58, lean: 0.5 }, 380);
  let t0 = null;
  for (const s of inputs(half, fr)) { if (t0 == null) t0 = s.t; det.push(s); }
  const n = det.nearest(t0, 'drop');
  assert.ok(n && n.kind === 'drop' && n.drop > 0.03 && n.drop < 0.1, 'the near miss: ' + JSON.stringify(n));
});
