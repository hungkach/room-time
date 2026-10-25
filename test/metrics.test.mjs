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

test('floor position runs -1 at the left wall to +1 at the right', () => {
  const cal = calFor();
  near(RT.readouts(M({ hip: 0.62, footW: 0.5, lean: 0.35, x: 1.0 }), cal).floorX, -1, 0.01);
  near(RT.readouts(M({ hip: 0.62, footW: 0.5, lean: 0.35, x: -1.0 }), cal).floorX, 1, 0.01);
  near(RT.readouts(M({ hip: 0.62, footW: 0.5, lean: 0.35 }), cal).floorX, 0, 0.01);
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
  assert.equal(RT.frameCheck(figure({ dist: 7 }).lm).hint, 'Step closer');
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
