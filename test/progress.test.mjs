// The Progress screen's numbers (Mark, 11/6): each session at a glance, your numbers over time, weekly load against
// your usual, and a session against your last few.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRT } from './helpers/load.mjs';
import { simulate, weekdays } from './helpers/season.mjs';

const RT = loadRT();
const DAY = 86400000, T0 = Date.parse('2026-11-02T12:00:00Z');
const at = (d) => new Date(T0 + d * DAY).toISOString();
const R = (phase, work, o = {}) => ({ phase, work, stancePct: 0.7, highPct: 0.2, uprightPct: 0.05, ...o });

test('a session at a glance: the stance split over its rounds, its calls, the longest round held', () => {
  const s = { date: at(0), minutes: 16, rounds: [R('warm', 45, { stancePct: 1, highPct: 0, uprightPct: 0 }), R('tech', 30, { stancePct: 0.8, late: 1 }), R('sit', 60, { stancePct: 0.6, missed: 2 })],
    trials: [{ m: 'sprawl', h: true }, { m: 'shot', h: false }, { m: 'block', h: false, undetected: 1 }], explosive: 6 };
  const x = RT.sessionSummary(s);
  assert.ok(Math.abs(x.stance - (0.8 * 30 + 0.6 * 60) / 90) < 1e-9, 'warm-in left out, weighted by round length');
  assert.ok(Math.abs(x.stance + x.high + x.upright + x.low - 1) < 1e-9, 'the split adds up');
  assert.equal(x.longest, 30, 'only rounds held at 75% or better');
  assert.equal(x.late, 1); assert.equal(x.missed, 2); assert.equal(x.undetected, 1);
  assert.equal(x.onTime, 0.5, 'calls not detected are left out of on time');
});

test('your numbers over time follow the planner, and weekly load sits against your usual', () => {
  const h = simulate(RT, weekdays(6), { cap: 35 }).history;
  const ser = RT.progressSeries(h);
  assert.equal(ser.length, h.length);
  assert.ok(ser.every((p, i) => !i || p.t > ser[i - 1].t), 'oldest first');
  assert.ok(ser[ser.length - 1].cap > ser[0].cap, `rounds held grow: ${ser[0].cap.toFixed(0)} s to ${ser[ser.length - 1].cap.toFixed(0)} s`);
  assert.ok(ser[ser.length - 1].rest < ser[0].rest, 'rest per minute of work falls');
  const st = RT.state(h, ser[ser.length - 1].t + 60e3);
  assert.ok(Math.abs(ser[ser.length - 1].cap - st.cap) < 1e-9, 'the last point is what the planner knows now');
  const wk = RT.weeklyLoads(h, T0 + 41 * DAY);
  assert.equal(wk.length, 6);
  assert.ok(wk.every((w) => w.sessions === 5 && w.load > 0 && w.usual >= RT.PROG.usual0));
  assert.ok(Math.abs(wk.reduce((a, w) => a + w.load, 0) - h.reduce((a, s) => a + RT.loadOf(s), 0)) < 1e-6, 'every session in one week');
});

test('a session against your last five', () => {
  const s = (d, stance) => ({ date: at(d), minutes: 15, rounds: [R('tech', 40, { stancePct: stance, highPct: 1 - stance - 0.05 })], trials: [] });
  const h = [s(0, 0.6), s(1, 0.62), s(2, 0.64), s(3, 0.66), s(4, 0.68), s(5, 0.6)];
  const c = RT.sessionCompare(s(6, 0.8), h);
  assert.equal(c.n, 5, 'the five before it');
  const row = c.rows.find((r) => r.key === 'stance');
  assert.ok(Math.abs(row.now - 0.8) < 1e-9 && Math.abs(row.before - (0.62 + 0.64 + 0.66 + 0.68 + 0.6) / 5) < 1e-9);
  assert.equal(row.better, 'up');
  assert.equal(RT.sessionCompare(s(0, 0.7), []).n, 0, 'a first session has nothing to compare with');
});
