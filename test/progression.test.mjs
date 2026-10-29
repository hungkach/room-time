// The progression algorithm: plans from saved sessions, the reaction staircase, records and CSV.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRT } from './helpers/load.mjs';

const RT = loadRT();
const DAY = 86400000, T0 = Date.parse('2026-11-02T12:00:00Z');
const at = (d) => new Date(T0 + d * DAY).toISOString();
const test0 = (d, holdS = 60) => ({ date: at(d), mode: 'progression', kind: 'baseline', holdS, stancePct: 0.7, rounds: [{}, {}, {}], trials: [] });
const sess = (d, o = {}) => ({ date: at(d), mode: 'progression', kind: 'session', work: 45, rest: 45, cap: 16, stancePct: 0.7, rounds: [{}, {}, {}, {}, {}, {}], trials: [], ...o });

test('no history: the baseline test comes first', () => {
  const p = RT.planNext([], T0);
  assert.equal(p.kind, 'baseline');
  assert.equal(p.rounds.map((r) => r.phase).join(), 'hold,react,live');
});

test('the first session after the test starts from your stance hold', () => {
  const p = RT.planNext([test0(0, 60)], T0 + DAY);
  assert.equal(p.kind, 'session');
  assert.equal(p.work, 35); // 60% of a 60 s hold, to 5 s
  assert.equal(p.rest, 45);
  const strong = RT.planNext([test0(0, 200)], T0 + DAY);
  assert.equal(strong.work, 120); assert.equal(strong.rest, 30);
  const total = p.rounds.length * p.work + (p.rounds.length - 1) * p.rest;
  assert.ok(total > 10 * 60 && total < 17 * 60, 'about 15 minutes: ' + total);
});

test('stance holding: rounds get longer, then rest gets shorter, one step a week at most', () => {
  const h = [test0(0), sess(1, { stancePct: 0.86 }), sess(4, { stancePct: 0.84 }), sess(7, { stancePct: 0.88 })];
  assert.equal(RT.planNext(h, T0 + 8 * DAY).work, 60);
  const soon = [test0(0), sess(1, { stancePct: 0.86 }), sess(2, { stancePct: 0.84 }), sess(3, { stancePct: 0.88 })];
  const q = RT.planNext(soon, T0 + 4 * DAY);
  assert.equal(q.work, 45, 'three sessions in three days: not yet');
  assert.ok(q.why.some((x) => /next step comes after 3 more days/.test(x)), q.why.join(' | '));
  const full = [test0(0), sess(1, { work: 120, rest: 40, stancePct: 0.86 }), sess(4, { work: 120, rest: 40, stancePct: 0.9 }), sess(7, { work: 120, rest: 40, stancePct: 0.88 })];
  const p = RT.planNext(full, T0 + 8 * DAY);
  assert.equal(p.work, 120); assert.equal(p.rest, 35);
  // the step resets the clock: the session after a step up stays put
  const stepped = [...h, sess(8, { work: 60, stancePct: 0.9 })];
  assert.equal(RT.planNext(stepped, T0 + 9 * DAY).work, 60);
});

test('one bad day alone moves nothing; a low trend adds rest', () => {
  const good = [0.84, 0.86, 0.85, 0.87, 0.85];
  const h = [test0(0), ...good.map((v, i) => sess(2 * i + 1, { stancePct: v })), sess(11, { stancePct: 0.55 })];
  const p = RT.planNext(h, T0 + 12 * DAY);
  assert.equal(p.work, 45, 'no progress after a bad day'); assert.equal(p.rest, 45, 'and no back-off either');
  const low = [test0(0), sess(1, { stancePct: 0.5 }), sess(2, { stancePct: 0.55 }), sess(3, { stancePct: 0.52 })];
  assert.equal(RT.planNext(low, T0 + 4 * DAY).rest, 55);
});

test('a downward trend against the last four weeks is a deload', () => {
  const h = [test0(0), ...[0.85, 0.86, 0.84, 0.85].map((v, i) => sess(i + 1, { stancePct: v })), ...[0.7, 0.72, 0.71].map((v, i) => sess(i + 6, { stancePct: v }))];
  const p = RT.planNext(h, T0 + 10 * DAY);
  assert.equal(p.deload, true);
  assert.ok(p.windows.sprawl > RT.PROG.window0, 'easier reads');
  assert.ok(p.cap < 16 && p.work < 45);
});

test('a retest every 4 weeks, after at least 6 sessions', () => {
  const h = [test0(0), ...Array.from({ length: 6 }, (_, i) => sess(4 * i + 1))];
  assert.equal(RT.planNext(h, T0 + 28 * DAY).kind, 'retest');
  assert.equal(RT.planNext(h, T0 + 26 * DAY).kind, 'session', 'not before 4 weeks');
  assert.equal(RT.planNext(h.slice(0, 6), T0 + 28 * DAY).kind, 'session', 'not before 6 sessions');
});

test('explosive cap: down when your last round fades, up once a week when it holds', () => {
  const fade = [test0(0), sess(1, { speed: { first: 2.0, last: 1.4 } })];
  assert.equal(RT.planNext(fade, T0 + 2 * DAY).cap, 14);
  const held = [test0(0), sess(1, { speed: { first: 2.0, last: 1.95 } }), sess(8, { speed: { first: 2.0, last: 1.95 } })];
  assert.equal(RT.planNext(held, T0 + 9 * DAY).cap, 18);
  const tooSoon = [test0(0), sess(5, { speed: { first: 2.0, last: 1.95 } })];
  assert.equal(RT.planNext(tooSoon, T0 + 6 * DAY).cap, 16, 'not twice in a week');
});

test('the staircase settles where you make about three in four', () => {
  // a simulated athlete: makes the read more often with a longer window (50% at 0.8 s)
  let seed = 3; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const trials = [], ws = []; let w = RT.PROG.window0;
  for (let i = 0; i < 600; i++) {
    const h = rnd() < 1 / (1 + Math.exp(-(w - 0.8) / 0.08));
    trials.push({ m: 'sprawl', h, rt: 0.4, w });
    w = RT.staircase(trials).sprawl; ws.push(w);
  }
  const rate = trials.slice(200).filter((t) => t.h).length / 400;
  const avgW = ws.slice(200).reduce((a, b) => a + b, 0) / 400;
  assert.ok(rate > 0.68 && rate < 0.8, 'hit rate ' + rate.toFixed(2));
  // this athlete makes 74% at about 0.88 s
  assert.ok(avgW > 0.8 && avgW < 1.0, 'window ' + avgW.toFixed(2));
});

test('every rep counts across sessions, and the weakest move gets more calls', () => {
  // the staircase as the game runs it: each call at the window it was given, which then steps
  const P = RT.PROG, w = { sprawl: 1.25, snap: 1.25 };
  const t = (m, h, n) => Array.from({ length: n }, () => { const x = { m, h, rt: h ? 0.4 : null, w: w[m] }; w[m] = Math.min(P.wMax, Math.max(P.wMin, w[m] * (h ? P.hitStep : P.missStep))); return x; });
  const h = [test0(0), sess(1, { trials: [...t('sprawl', true, 10), ...t('snap', false, 4)] }), sess(2, { trials: [...t('snap', true, 2), ...t('snap', false, 4)] })];
  const p = RT.planNext(h, T0 + 3 * DAY);
  assert.equal(p.weak, 'snap');
  assert.ok(Math.abs(p.windows.sprawl - w.sprawl) < 1e-9 && Math.abs(p.windows.snap - w.snap) < 1e-9, 'the next session carries on from the last call');
  assert.ok(p.windows.sprawl < P.window0 && p.windows.snap > P.window0);
  assert.ok(p.why.some((x) => /snaps/.test(x)));
});

test('after the baseline, each move starts from your test reads', () => {
  const tr = [0.5, 0.6, 0.7, 0.55, 0.65].map((rt) => ({ m: 'sprawl', h: true, rt }));
  const p = RT.planNext([{ ...test0(0), trials: tr }], T0 + DAY);
  assert.ok(Math.abs(p.windows.sprawl - 0.6 * 1.33) < 1e-9, 'median read 0.6 s plus a third: ' + p.windows.sprawl);
  assert.equal(p.windows.snap, RT.PROG.window0, 'no reads of a move: the default');
});

test('a simulated season: an improving player grows to the goal, a flat one holds', () => {
  const run = (improve) => {
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    const g = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
    const P = RT.PROG, h = [], plans = [];
    for (let wk = 0; wk < 12; wk++) for (let d = 0; d < 5; d++) {
      const now = T0 + (wk * 7 + d) * DAY, fit = improve ? wk / 10 : 0;
      const p = RT.planNext(h, now, { minutes: 15 }), s = p.session || p, win = { ...s.windows }, trials = [];
      for (const rd of p.rounds) if (rd.phase === 'tech' || rd.phase === 'sit' || rd.phase === 'react') for (let k = 0; k < 4; k++) for (const m of P.moves) {
        const rt = 0.95 - 0.25 * fit + 0.18 * g(), test = p.kind !== 'session', ww = test ? P.testWindow : win[m], hit = rt < ww;
        const x = { m, h: hit, rt: hit ? rt : null };
        if (!test) { x.w = ww / (s.ease || 1); win[m] *= hit ? P.hitStep : P.missStep; }
        trials.push(x);
      }
      const cap = 45 + 120 * fit;
      const stance = Math.max(0.4, Math.min(0.92, 0.72 + 0.15 * fit - 0.25 * Math.max(0, s.work - cap) / 60 + 0.04 * g()));
      h.push({ date: new Date(now).toISOString(), mode: 'train', kind: p.kind, minutes: 15, work: p.work, rest: p.rest, cap: p.cap,
        rounds: p.rounds.map((r) => ({ phase: r.phase })), stancePct: stance, trials, holdS: p.kind !== 'session' ? cap : null, speed: { first: 1, last: 0.9 } });
      if (p.kind === 'session') plans.push(p);
    }
    return plans;
  };
  const up = run(true), flat = run(false);
  const steps = up.slice(1).filter((p, i) => p.work !== up[i].work || p.rest !== up[i].rest).length;
  assert.ok(up[up.length - 1].work === 120, 'reaches 2:00 rounds in 12 weeks: ' + up.map((p) => p.work).join());
  assert.ok(steps <= 12, 'about one step a week: ' + steps);
  assert.ok(flat.every((p) => p.work === 30), 'a flat player stays at 30 s rounds: ' + [...new Set(flat.map((p) => p.work))].join());
  const lastWin = up[up.length - 1].windows.sprawl;
  assert.ok(lastWin > 0.75 && lastWin < 0.95, 'reads follow the improving player (74% point about 0.81 s): ' + lastWin.toFixed(2));
});

test('records and CSV', () => {
  const h = [test0(0, 75), sess(1, { stancePct: 0.8, moves: { sprawl: { n: 6, hitRate: 0.83, rtMed: 0.41 } }, score: { you: 2, opp: 1 } }), sess(2, { stancePct: 0.9, moves: { sprawl: { n: 6, hitRate: 1, rtMed: 0.38 } } })];
  const r = RT.records(h);
  assert.equal(r.holdS, 75); assert.equal(r.stancePct, 0.9); assert.equal(r.rt.sprawl, 0.38);
  const csv = RT.toCSV(h).trim().split('\n');
  assert.equal(csv.length, 4);
  assert.ok(csv[0].startsWith('date,mode,kind') && csv[0].includes('sprawl_rt_ms'));
  assert.ok(csv[2].includes(',80,') && csv[2].includes(',410'));
});

test('the plan fits the length you pick', () => {
  const h = [test0(0, 120)];
  for (const minutes of [10, 15, 20, 30]) {
    const p = RT.planNext(h, T0 + DAY, { minutes });
    const total = p.rounds.length * p.session.work + (p.rounds.length - 1) * p.session.rest;
    assert.ok(Math.abs(total - minutes * 60) <= p.session.work + p.session.rest, `${minutes} min plan runs ${total} s`);
  }
});

test('recent history: days off, days in a row, twice in a day, a long layoff', () => {
  const back = RT.planNext([test0(0), sess(1)], T0 + 6 * DAY);
  assert.ok(back.session.work < back.work && back.session.windows.sprawl > back.windows.sprawl && back.why.some((x) => /Back after 5 days/.test(x)));
  const streak = RT.planNext([test0(0), sess(1), sess(2), sess(3)], T0 + 4 * DAY);
  assert.ok(streak.session.cap < streak.cap && streak.why.some((x) => /Day 5 in a row/.test(x)), streak.why.join(' | ')); // the test day counts too
  const twice = RT.planNext([test0(0), sess(1)], T0 + DAY + 3600e3);
  assert.ok(twice.session.cap <= twice.cap / 2 + 1 && twice.why.some((x) => /Second session today/.test(x)));
  const layoff = RT.planNext([test0(0), sess(1)], T0 + 25 * DAY);
  assert.equal(layoff.kind, 'retest');
  // today's adjustments never carry into the plan the next session builds on
  assert.equal(back.work, 45);
});

test('goal progress toward 15 minutes at Hard pace', () => {
  const g = RT.goalProgress(60, 45, { sprawl: 1.25, block: 1.25, shot: 1.25, snap: 1.25, level: 1.25, circle: 1.25 });
  assert.equal(g.work, 0.5); assert.ok(Math.abs(g.rest - 30 / 45) < 1e-9); assert.ok(Math.abs(g.reads - 0.76) < 0.01);
  assert.ok(/Goal 15 min at Hard pace/.test(g.text));
});

test('levels: the highest one 2 of your last 5 sessions meet, and what the next one needs', () => {
  const jv = { minutes: 15, stancePct: 0.72, readWindow: 1.2, onTime: 0.71, moves: { sprawl: { n: 8, hitRate: 0.8, rtMed: 0.75 } } };
  assert.equal(RT.levelOf([]).name, 'Novice');
  assert.equal(RT.levelOf([sess(1, jv)]).name, 'Novice', 'one session is not enough for any level');
  const lv = RT.levelOf([sess(1, jv), sess(2, jv)]);
  assert.equal(lv.name, 'HS JV'); assert.equal(lv.next, 'HS varsity');
  assert.ok(lv.needs.some((x) => /stance 75%/.test(x)) && lv.needs.some((x) => /700 ms/.test(x)), lv.needs.join(' | '));
  const elite = { minutes: 20, stancePct: 0.92, readWindow: 0.58, onTime: 0.8, moves: { sprawl: { n: 8, hitRate: 0.9, rtMed: 0.36 } } };
  assert.equal(RT.levelOf([sess(1, elite), sess(2, elite)]).name, 'D1 All-American');
  assert.equal(RT.LEVELS.map((l) => l.name).join(), 'Novice,Beginner,HS JV,HS varsity,College D3,College D2,College D1,D1 qualifier,D1 All-American');
});

test('backup and restore: sessions merge once each, oldest first, and the newer calibration wins', () => {
  const old = { at: at(-10), stand: {} }, newer = { at: at(-1), stand: {} };
  const b = JSON.parse(JSON.stringify(RT.backupOf([test0(0), sess(2)], newer, T0)));
  assert.equal(b.format, 'room-time-backup');
  const r = RT.restoreFrom(b, [sess(2), sess(5)], old);
  assert.equal(r.history.map((s) => s.date).join(), [at(0), at(2), at(5)].join());
  assert.equal(r.added, 1);
  assert.equal(r.cal.at, newer.at);
  assert.equal(RT.restoreFrom(b, [], { at: at(3) }).cal.at, at(3));
  assert.equal(RT.restoreFrom(b, [], null).history.length, 2);
  assert.ok(RT.restoreFrom({ foo: 1 }, [], null).error);
});
