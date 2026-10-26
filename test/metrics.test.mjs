import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRT } from './helpers/load.mjs';
import { figure } from './helpers/figure.mjs';
import { calFor } from './helpers/cal.mjs';

const RT = loadRT();
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} ${a} vs ${b} (tol ${tol})`);
const M = (o) => { const f = figure(o); return RT.measure(f.lm, f.wl, f.aspect); };

test('standing reads ratio 1 and level 1 in every source', () => {
  const cal = calFor();
  const r = RT.readouts(M({}), cal);
  for (const k of ['img', 'imgS', 'world']) near(r.ratios[k], 1, 0.01, k);
  near(r.level, 1, 0.01);
  assert.equal(r.zone, 'tall');
});

test('the calibrated square stance sits at the stance level, in the band', () => {
  const cal = calFor();
  for (const src of ['img', 'imgS', 'world']) {
    const r = RT.readouts(M({ hip: 0.62, footW: 0.5, lean: 0.35 }), cal, src);
    near(r.level, RT.STANCE_LEVEL, 0.01, src);
    assert.equal(r.zone, 'stance', src);
  }
});

test('hip height ratio follows the hips on a gradient', () => {
  const cal = calFor();
  const lv = [0.95, 0.8, 0.62, 0.5, 0.4].map((hip) => RT.readouts(M({ hip, footW: 0.5, lean: 0.35 }), cal).level);
  for (let i = 1; i < lv.length; i++) assert.ok(lv[i] < lv[i - 1], `level drops: ${lv}`);
  assert.equal(RT.stanceZone(lv[4]), 'deep');
  // world ratio is hip-to-ankle height against standing
  near(RT.readouts(M({ hip: 0.5, lean: 0.35 }), cal).ratios.world, (0.5 - 0.08) / (0.95 - 0.08), 0.005);
});

test('stepping closer moves the raw image ratio, not the scaled or world ones', () => {
  const cal = calFor();
  const r = RT.readouts(M({ hip: 0.62, footW: 0.5, lean: 0.35, dist: 1.4 }), cal);
  assert.ok(r.ratios.img > cal.square.ratios.img + 0.1, 'raw image ratio grows when closer');
  near(r.ratios.imgS, cal.square.ratios.imgS, 0.02, 'imgS');
  near(r.ratios.world, cal.square.ratios.world, 0.005, 'world');
});

test('aspect ratio: a 16:9 frame reads the same widths as 4:3', () => {
  const a = RT.readouts(M({ footW: 0.5, elbowOut: 0.3 }), null);
  const b = RT.readouts(M({ footW: 0.5, elbowOut: 0.3, aspect: 16 / 9 }), null);
  near(a.footS, b.footS, 1e-9); near(a.elbowL, b.elbowL, 1e-9);
  // the shoulders sit nearer the camera than the ankles, so the image width reads a little narrow; world is exact
  near(a.footS, 0.5 / 0.4, 0.03, 'image foot width in shoulder widths');
  near(a.footWorld, 0.5 / 0.4, 0.001, 'world foot width');
});

test('mirroring never flips left and right', () => {
  const o = { elbowOut: 0.3, footW: 0.5 };
  const a = M(o), b = M(Object.assign({ mirror: true }, o));
  assert.equal(a.img.dir, -1, 'raw front camera: player right shows at smaller x');
  assert.equal(b.img.dir, 1);
  near(a.img.elbowL, b.img.elbowL, 1e-9); near(a.img.footW, b.img.footW, 1e-9);
  const asym = (mirror) => { const f = figure({ mirror }); f.lm[13][0] += (mirror ? -1 : 1) * 0.03; return RT.readouts(RT.measure(f.lm, null, f.aspect), null); };
  assert.ok(asym(false).elbowL > asym(false).elbowR, 'left elbow pushed out reads on the left');
  assert.ok(asym(true).elbowL > asym(true).elbowR, 'and the same when mirrored');
});

test('elbows in vs out', () => {
  const tucked = RT.readouts(M({ elbowOut: 0.15 }), null), wide = RT.readouts(M({ elbowOut: 0.32 }), null);
  assert.ok(tucked.elbowL <= 1 && tucked.elbowR <= 1, 'tucked inside the shoulder line');
  assert.ok(wide.elbowL > 1 && wide.elbowR > 1, 'flared');
  near(tucked.elbowLWorld, 0.75, 0.01);
});

test('floor position runs -1 at the left edge to +1 at the right, from the shuffle', () => {
  const cal = calFor();
  near(cal.floor.width, 2.0, 0.06, 'the shuffle covered 2.1 m');
  near(RT.readouts(M({ hip: 0.62, footW: 0.5, lean: 0.35, x: 1.0 }), cal).floorX, -1, 0.03);
  near(RT.readouts(M({ hip: 0.62, footW: 0.5, lean: 0.35, x: -1.0 }), cal).floorX, 1, 0.03);
  near(RT.readouts(M({ hip: 0.62, footW: 0.5, lean: 0.35 }), cal).floorX, 0, 0.03);
});

test('each lens sets the field of view the distance uses', () => {
  const was = RT.CAMERA.vfovDeg;
  RT.CAMERA.vfovDeg = RT.LENSES.phone_back;
  const f = figure({ vfov: RT.LENSES.phone_back, dist: 3.0 }), m = RT.measure(f.lm, f.wl, f.aspect);
  near(m.D, 3.0, 0.08, 'a phone back camera at 3 m');
  RT.CAMERA.vfovDeg = was;
  for (const k of ['tablet_front', 'tablet_back_ultra', 'tablet_back', 'phone_front', 'phone_back_ultra', 'phone_back']) assert.ok(RT.LENSES[k] > 40 && RT.LENSES[k] < 110, k);
});

test('your floor comes from shuffling side to side, in meters, robust to a stray frame', () => {
  const xs = Array.from({ length: 200 }, (_, i) => -1.4 + 2.8 * (i / 199));
  xs.push(-3, 3); // two stray frames
  const f = RT.floorFrom(xs);
  assert.ok(Math.abs(f.left + 1.4) < 0.07 && Math.abs(f.right - 1.4) < 0.07 && Math.abs(f.width - 2.8) < 0.14, JSON.stringify(f));
  assert.equal(RT.floorFrom([0.1, 0.2, 0.15]), null, 'too little movement sets no floor');
  const tr = new RT.FloorTracker({ left: -0.5, right: 0.5, width: 1, center: 0 });
  for (const x of xs) tr.push(x);
  assert.ok(tr.floor().width > 2.7, 'the warm-in widens it');
  const nar = new RT.FloorTracker({ left: -2, right: 2, width: 4, center: 0 });
  for (const x of xs) nar.push(x);
  assert.equal(nar.floor().width, 4, 'and never narrows it');
});

const LONG94 = 2 * Math.atan(Math.tan(47 * Math.PI / 180) * 4 / 3) * 180 / Math.PI; // a 3:4 portrait frame's vertical view
const FR = { portrait: { aspect: 3 / 4, vfov: LONG94 }, '4:3': { vfov: 94 }, '16:9': { aspect: 16 / 9, vfov: 2 * Math.atan(Math.tan(47 * Math.PI / 180) * 0.75) * 180 / Math.PI }, mirrored: { vfov: 94, mirror: true } };
for (const [name, fr] of Object.entries(FR)) {
  test(`meters: sideways, distance and eyes match the body (${name})`, () => {
    const cal = calFor(fr);
    for (const [x, dist] of [[0, 2.0], [0.6, 2.0], [-0.8, 1.6], [0.3, 2.6]]) {
      const r = RT.readouts(M({ ...fr, hip: 0.62, footW: 0.5, lean: 0.35, x, dist }), cal);
      near(r.X, -x, 0.03, `sideways at x ${x} (the player's right is -x)`);
      near(r.D, dist, 0.06, `distance at ${dist} m`);
      near(r.z, dist - 1.8, 0.06, 'forward-back from the stance spot (the test calibration stands at 1.8 m)');
    }
    const st = RT.readouts(M({ ...fr, dist: 2.0 }), cal);
    near(st.eye, 0.95 + 0.52 * Math.cos(0.05) + 0.22 + 0.03, 0.06, 'standing eye height');
    // turning the body doesn't change the meters: a staggered stance at the same spot
    const turned = RT.readouts(M({ ...fr, hip: 0.66, footW: 0.36, lean: 0.3, stagger: 0.35, x: 0.5, dist: 2.0 }), cal);
    near(turned.X, -0.5, 0.04, 'staggered');
    // either lead reads the same: left foot forward or right foot forward
    for (const stagger of [0.35, -0.35]) {
      const q = RT.readouts(M({ ...fr, hip: 0.62, footW: 0.36, lean: 0.35, stagger, x: 0.4, dist: 2.0 }), cal);
      near(q.level, RT.STANCE_LEVEL, 0.05, `level with stagger ${stagger}`);
      near(q.X, -0.4, 0.04, `sideways with stagger ${stagger}`);
    }
  });
}

test('the directed shuffle: each edge is where you pause at the far end', () => {
  // 30 fps: shuffle 1.2 m to your left over 1.5 s, pause 1 s with a little sway
  const run = (side, path) => { const p = new RT.EdgePass(side); for (const [t, x] of path) { const r = p.push(t, x); if (r) return r; } return p.timeout(); };
  const path = (to, moveMs, holdMs, sway = 0.01) => {
    const out = [];
    for (let t = 0; t <= moveMs + holdMs; t += 33) out.push([t, t < moveMs ? to * t / moveMs : to + sway * Math.sin(t / 50)]);
    return out;
  };
  let r = run(-1, path(-1.2, 1500, 1200));
  assert.ok(r.paused && Math.abs(r.edge + 1.2) < 0.03, JSON.stringify(r));
  r = run(1, path(1.35, 1500, 1200));
  assert.ok(r.paused && Math.abs(r.edge - 1.35) < 0.03, JSON.stringify(r));
  // a quick touch at the edge and straight back, no pause: the farthest point still counts
  const touch = []; for (let t = 0; t <= 3000; t += 33) touch.push([t, -1.2 * Math.sin(Math.min(1, t / 1500) * Math.PI)]);
  r = run(-1, touch);
  assert.ok(!r.paused && r.edge < -1.1, 'a touch with no pause still reaches the edge: ' + JSON.stringify(r));
  // camera jitter of a few centimeters during the pause still reads as a pause
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5);
  const noisy = path(-1.2, 1500, 1500).map(([t, x]) => [t, x + rnd() * 0.08]);
  r = run(-1, noisy);
  assert.ok(r.paused && Math.abs(r.edge + 1.2) < 0.05, 'noisy pause: ' + JSON.stringify(r));
  // standing still at the start never ends the pass, and too little travel gives nothing
  assert.equal(run(-1, path(0, 0, 3000)), null);
});

test('calibration keeps medians and per-stance ratios', () => {
  const cal = calFor();
  near(cal.stand.world.hipH, 0.87, 0.001);
  assert.ok(cal.stagger.ratios.world > cal.square.ratios.world, 'this stagger is a little taller');
  near(cal.square.footWorld, 1.25, 0.01);
  assert.ok(cal.square.footS < 1.25, 'image foot width shrinks with a forward lean');
  assert.equal(RT.median([3, 1, 2, null, NaN]), 2);
  assert.equal(RT.median([4, 1, 2, 3]), 2.5);
});

test('frame check', () => {
  assert.equal(RT.frameCheck(figure({ dist: 2.4 }).lm).ok, true);
  assert.equal(RT.frameCheck(figure({ dist: 0.9 }).lm).hint, 'Step back');
  assert.equal(RT.frameCheck(figure({ dist: 2, x: 2.2 }).lm).hint, 'Move to the middle');
  assert.equal(RT.frameCheck(figure({ dist: 12 }).lm).hint, 'Step closer');
  assert.equal(RT.frameCheck(figure({ hip: 0.55, lean: 0.4, footW: 0.5, dist: 2.4, vfov: 95 }).lm).ok, true, 'a deep stance at 8 ft on the ultra-wide is still in frame');
  assert.equal(RT.frameCheck(null).hint, 'Step into view');
});

test('timestamps always increase', () => {
  let last = 0;
  for (const now of [10, 20, 20, 15, 0, 30]) { const t = RT.nextTs(last, now); assert.ok(t > last); last = t; }
});

test('soak and bench verdicts', () => {
  const steady = Array.from({ length: 91 }, (_, i) => ({ t: i * 10, fps: 30 }));
  assert.equal(RT.soakVerdict(steady).pass, true);
  const throttled = steady.map((s) => ({ t: s.t, fps: s.t > 600 ? 22 : 30 }));
  const v = RT.soakVerdict(throttled);
  assert.equal(v.pass, false); near(v.ratio, 22 / 30, 0.01);
  assert.equal(RT.percentile([5, 1, 3, 2, 4], 0.5), 3);
  assert.equal(RT.benchVerdict({ p95: 20, detectFps: 30 }), 'main thread is fine');
  assert.equal(RT.benchVerdict({ p95: 45, detectFps: 20 }), 'needs a worker');
});
