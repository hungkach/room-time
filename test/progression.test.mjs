// Train me: the adaptive planner (fitness and fatigue, capacity, tolerance, reads, day types), the mid-session
// adjustment, the read staircase, records, CSV, levels and backup. Season tests run a simulated player through the
// real planner (test/helpers/season.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadRT } from './helpers/load.mjs';
import { simulate, weekdays } from './helpers/season.mjs';

const RT = loadRT();
const DAY = 86400000, T0 = Date.parse('2026-11-02T12:00:00Z');
const at = (d) => new Date(T0 + d * DAY).toISOString();
const test0 = (d, holdS = 60) => ({ date: at(d), mode: 'progression', kind: 'baseline', holdS, stancePct: 0.7, rounds: [{}, {}, {}], trials: [] });
const sess = (d, o = {}) => ({ date: at(d), mode: 'progression', kind: 'session', work: 45, rest: 45, cap: 16, stancePct: 0.7, rounds: [{}, {}, {}, {}, {}, {}], trials: [], ...o });
const length = (p) => p.rounds.reduce((a, r) => a + r.work + r.rest, 0);
const round = (phase, work, stancePct, o = {}) => ({ phase, work, stancePct, ...o });

test('first session: no test, a normal session at the length you pick', () => {
  for (const minutes of [10, 15, 20, 30]) {
    const p = RT.planNext([], T0, { minutes });
    assert.equal(p.day, 'start');
    assert.ok(!p.rounds.some((r) => r.phase === 'hold' || r.phase === 'react'), 'no test rounds');
    assert.ok(Math.abs(length(p) - minutes * 60) <= 15, `${minutes} min runs ${length(p)} s`);
    assert.equal(p.rounds[0].phase, 'warm');
    assert.ok(p.rounds.some((r) => r.phase === 'live'));
  }
});

test('every session fits the length you pick, any day type', () => {
  const h = simulate(RT, weekdays(3)).history;
  for (const minutes of [10, 15, 20, 30]) for (const d of [0, 1, 2, 5]) {
    const p = RT.planNext(h, T0 + (21 + d) * DAY, { minutes });
    assert.ok(Math.abs(length(p) - minutes * 60) <= 15, `${p.day} ${minutes} min runs ${length(p)} s`);
  }
});

test('capacity: read from every round, smooth, recent rounds counting most', () => {
  assert.equal(RT.capacityObs(round('tech', 40, 0.75)), 40, 'at 75% in stance the round was right');
  assert.ok(Math.abs(RT.capacityObs(round('tech', 40, 0.8)) - 40 * (0.8 / 0.75) ** 2) < 1e-9);
  assert.equal(RT.capacityObs(round('tech', 40, 0.95)), 50, 'at most a quarter more per round');
  assert.equal(RT.capacityObs(round('tech', 40, 0.4)), 24, 'at most 40% less');
  assert.equal(RT.capacityObs(round('tech', 60, 0.72, { breakT: 20 })), 36, 'broke early and stayed broken: down to the 40% floor');
  assert.equal(RT.capacityObs(round('warm', 40, 0.9)), null);
  assert.equal(RT.capacityObs({ phase: 'hold', hold: 100 }), 60);
  // a session of rounds held well raises it; badly, lowers it; a month later, a new reading counts most
  const good = sess(0, { rounds: Array.from({ length: 10 }, () => round('tech', 30, 0.82)) });
  const bad = sess(0, { rounds: Array.from({ length: 10 }, () => round('tech', 30, 0.6)) });
  assert.ok(RT.state([good], T0 + DAY).cap > 30 && RT.state([bad], T0 + DAY).cap < 30);
  const later = sess(30, { rounds: Array.from({ length: 10 }, () => round('tech', 40, 0.75)) });
  const c = RT.state([bad, later], T0 + 31 * DAY).cap;
  const c0 = RT.state([bad], T0 + 31 * DAY).cap;
  assert.ok(c > c0 + 5 && c < 40, `the recent session counts most: ${c0.toFixed(1)} without it, ${c.toFixed(1)} with it`);
});

test('an easy round only ever raises capacity', () => {
  const easy = sess(0, { rounds: Array.from({ length: 10 }, () => round('tech', 20, 0.97)) });
  assert.ok(RT.state([easy], T0 + DAY).cap >= RT.PROG.cap0, 'short easy rounds say at least 25 s, under the 30 s start: nothing new');
  const base = sess(0, { rounds: Array.from({ length: 10 }, () => round('tech', 50, 0.75)) });
  const after = sess(1, { rounds: Array.from({ length: 10 }, () => round('tech', 20, 0.97)) });
  assert.ok(Math.abs(RT.state([base, after], T0 + 2 * DAY).cap - RT.state([base], T0 + 2 * DAY).cap) < 1e-9);
});

test('history fades: this week counts in fatigue, the last six weeks in fitness, two months ago barely', () => {
  const L = (d) => sess(d, { load: 10 });
  const st = RT.state([L(0), L(1), L(2), L(3), L(4)], T0 + 5 * DAY);
  assert.equal(st.fat, 50); assert.equal(st.week, 5);
  assert.equal(st.fit, RT.PROG.usual0, 'this week is not part of your usual week: the starting usual holds');
  const old = RT.state([L(0)], T0 + 60 * DAY);
  assert.equal(old.fat, 0);
  // capacity readings: half weight every 21 days, and a long layoff drifts back toward the start
  const hi = sess(0, { rounds: Array.from({ length: 12 }, () => round('tech', 60, 0.75)) });
  const c1 = RT.state([hi], T0 + DAY).cap, c60 = RT.state([hi], T0 + 60 * DAY).cap;
  assert.ok(c1 > 50 && c60 < c1 && c60 > RT.PROG.cap0, `${c1.toFixed(1)} the next day, ${c60.toFixed(1)} two months later`);
});

test('the day: what you did today, this week and lately decides it', () => {
  const h = simulate(RT, weekdays(4)).history;
  const last = Date.parse(h[h.length - 1].date);
  const second = RT.planNext(h, last + 2 * 3600e3, { minutes: 15 });
  assert.equal(second.day, 'light'); assert.ok(second.why.some((x) => /Session 2 today/.test(x)), second.why.join(' | '));
  const fresh = RT.planNext(h, last + 2 * DAY, { minutes: 15 });
  assert.ok(['volume', 'pace', 'live'].includes(fresh.day), 'a normal day: ' + fresh.day);
  assert.ok(second.cap < fresh.cap && second.windows.sprawl > fresh.windows.sprawl, 'the second session today is lighter');
  const back = RT.planNext(h, last + 9 * DAY, { minutes: 15 });
  assert.equal(back.day, 'light'); assert.ok(back.why.some((x) => /Back after 9 days/.test(x)));
  // a big week: doubles and long sessions push this week's load over your usual
  const big = simulate(RT, [...weekdays(3), ...[21, 21.4, 22, 22.4, 23, 23.4].map((d) => ({ day: Math.floor(d), hour: (d % 1) * 20, minutes: 30 }))]).history;
  const after = RT.planNext(big, T0 + 24 * DAY, { minutes: 15 });
  assert.equal(after.day, 'light'); assert.ok(after.state.acwr > RT.PROG.acwrMax, 'acwr ' + after.state.acwr.toFixed(2));
});

test('no plan takes this week over 1.5 times your usual load', () => {
  const { sessions } = simulate(RT, [...weekdays(4), ...Array.from({ length: 10 }, (_, i) => ({ day: 28 + i, minutes: 30 }))]);
  for (const s of sessions.slice(5)) {
    if (s.plan.day === 'light') continue;
    const st = s.state, L = s.plan.rounds.reduce((a, r) => a + r.work / 60 * RT.PROG.loadK[r.phase], 0) + s.plan.cap * RT.PROG.repLoad;
    assert.ok((st.fat6 + L) / st.fit <= RT.PROG.acwrCap + 1e-9, `day ${s.day}: ${((st.fat6 + L) / st.fit).toFixed(2)}`);
  }
});

test('mid-session: how the round held and how you started it re-tune the rest, the end time holds', () => {
  const up = [{ phase: 'tech', work: 30, rest: 40 }, { phase: 'sit', work: 30, rest: 40 }, { phase: 'live', work: 30, rest: 40, period: 1 }];
  const hard = RT.adaptRound(round('tech', 30, 0.55), up), strong = RT.adaptRound(round('tech', 30, 0.9), up);
  assert.ok(hard.rounds.every((r) => r.work < 30) && strong.rounds.every((r) => r.work > 30));
  // how you started after the rest: strong, rests shorter (the time goes to work); weak, rests longer
  const fresh = RT.adaptRound(round('tech', 30, 0.76, { rest: 40, startPct: 0.9 }), up), spent = RT.adaptRound(round('tech', 30, 0.76, { rest: 40, startPct: 0.5 }), up);
  assert.ok(fresh.rounds.every((r) => r.rest < 40) && spent.rounds.every((r) => r.rest > 40), JSON.stringify([fresh.rounds[0], spent.rounds[0]]));
  for (const a of [hard, strong, fresh, spent]) a.rounds.forEach((r) => assert.equal(r.work + r.rest, 70, 'work plus rest unchanged'));
  assert.ok(RT.adaptRound(round('tech', 30, 0.9, { rest: 40, startPct: 0.9 }), up, 'light').rounds.every((r) => r.work === 30), 'a light day never grows');
  const tight = RT.adaptRound(round('tech', 30, 0.95, { rest: 12, startPct: 0.9 }), [{ phase: 'tech', work: 30, rest: 12 }]).rounds[0];
  assert.ok(tight.rest >= RT.PROG.restMin, 'rest never under the minimum: ' + tight.rest);
});

test('recovery: learned from how you start each round after a rest', () => {
  const sess2 = (d, startPct, rest) => sess(d, { rounds: [round('warm', 30, 0.9), ...Array.from({ length: 10 }, (_, i) => round('tech', 40, 0.76, { rest, startPct: i ? startPct : null }))] });
  const P = RT.PROG;
  assert.equal(RT.state([], T0).rec, P.rec0);
  const strong = RT.state([sess2(0, 0.9, 30)], T0 + DAY).rec, weak = RT.state([sess2(0, 0.45, 30)], T0 + DAY).rec, mid = RT.state([sess2(0, 0.7, 30)], T0 + DAY).rec;
  assert.ok(strong < P.rec0 && strong > 0.6, 'started strong after 30 s per 40 s: ' + strong.toFixed(2));
  assert.ok(mid < P.rec0 && mid > strong, 'about right at 0.75: ' + mid.toFixed(2));
  const tight = RT.state([sess2(0, 0.45, 20)], T0 + DAY).rec;
  assert.ok(Math.abs(tight - P.rec0) < 1e-9, 'weak after a short rest says you need at least 0.63, under the estimate: nothing new');
  // the plan's rest follows it
  const p = RT.planNext([sess2(0, 0.9, 30), sess2(2, 0.9, 30), sess2(4, 0.9, 30)], T0 + 6 * DAY);
  assert.ok(p.rounds[2].rest / p.rounds[1].work < P.rec0, 'rest per second of work under the start');
});

test('rounds have no fixed ceiling: a big capacity makes fewer, longer rounds, and in the end one block', () => {
  const st = (cap, rec) => ({ ...RT.state([], T0), cap, rec, n: 3, todayN: 0, acwr: 1, ready: 0, since: { volume: 5, pace: 0, live: 1 }, lastDay: 'pace' });
  const P = RT.PROG;
  for (const [cap, rec, minutes] of [[60, 0.5, 15], [300, 0.2, 15], [900, 0.05, 15], [400, 0.1, 30]]) {
    const r = RT.buildRounds('volume', Math.min(cap, minutes * 60 - 45), Math.max(P.restMin, cap * rec), minutes * 60);
    const total = r.reduce((a, x) => a + x.work + x.rest, 0);
    assert.equal(total, minutes * 60, `${cap} s rounds in ${minutes} min: ${total} s`);
    if (cap >= 900) assert.equal(r.length, 2, 'warm-in, then one block');
  }
});

test('the warm-in: today against your own recent warm-ins', () => {
  const w = (d, stance, rt, low) => sess(d, { warm: { stance, rt, low } });
  const h = [w(0, 0.8, 0.9, 0.3), w(1, 0.82, 0.88, 0.3), w(2, 0.78, 0.92, 0.32), w(3, 0.8, 0.9, 0.3)];
  const now = T0 + 4 * DAY;
  assert.equal(RT.warmReadiness({ stance: 0.8, rt: 0.9, low: 0.3 }, h.slice(0, 2), now).k, 1, 'fewer than 3 warm-ins: nothing to compare');
  const usual = RT.warmReadiness({ stance: 0.79, rt: 0.91, low: 0.3 }, h, now);
  assert.equal(usual.k, 1); assert.ok(/about your usual/.test(usual.text));
  const tired = RT.warmReadiness({ stance: 0.6, rt: 1.05, low: 0.38 }, h, now);
  assert.ok(tired.k < 1 && tired.k >= 0.75, 'k ' + tired.k.toFixed(2));
  assert.ok(/stance 25% under your usual\. Rounds shortened/.test(tired.text), tired.text);
  const sharp = RT.warmReadiness({ stance: 0.92, rt: 0.8, low: 0.26 }, h, now);
  assert.equal(sharp.k, 1.05); assert.ok(/over your usual/.test(sharp.text), sharp.text);
  assert.equal(RT.warmReadiness(null, h, now).k, 1);
});

test('scaling the rounds left keeps the end time', () => {
  const up = [{ phase: 'tech', work: 40, rest: 40 }, { phase: 'hold', work: 90, rest: 40 }, { phase: 'live', work: 40, rest: 40, period: 1 }, { phase: 'live', work: 40, rest: 15, period: 2 }];
  const down = RT.scaleRounds(up, 0.8), upk = RT.scaleRounds(up, 1.05);
  down.forEach((r, i) => assert.equal(r.work + r.rest, up[i].work + up[i].rest));
  assert.equal(down[0].work, 30); assert.equal(down[1].work, 90, 'a hold is never scaled');
  assert.equal(upk[3].work, 40, 'no room in a 15 s break: stays');
  assert.ok(upk[0].work >= 40);
});

test('high stance, no stance and missed calls read as fatigue', () => {
  const base = RT.capacityObs(round('tech', 40, 0.76));
  assert.ok(RT.capacityObs(round('tech', 40, 0.76, { uprightPct: 0.2 })) <= 28, 'upright a fifth of the round: spent');
  assert.ok(RT.capacityObs(round('tech', 40, 0.76, { calls: 6, missed: 2 })) <= 28, 'a third of the calls not done: spent');
  assert.equal(RT.capacityObs(round('tech', 40, 0.76, { calls: 6, missed: 1 })), base, 'one missed call is not a pattern');
  assert.ok(RT.capacityObs(round('tech', 40, 0.76, { highPct: 0.3 })) <= 36, 'high a third of the round: tiring');
  const next = [{ phase: 'tech', work: 40, rest: 40 }];
  assert.ok(RT.adaptRound(round('tech', 40, 0.76, { uprightPct: 0.25 }), next).rounds[0].work < 40, 'and the next rounds shorten');
  // a missed call says nothing about your reads: the staircase only reads the calls with a window
  const trials = [{ m: 'sprawl', h: true, rt: 0.5, w: 1.0 }, { m: 'sprawl', h: false, missed: 1 }];
  assert.ok(Math.abs(RT.staircase(trials).sprawl - 0.97) < 1e-9);
});

test('long sessions: up to 90 minutes, filled exactly, and lighter until you have built up to them', () => {
  const h = simulate(RT, weekdays(4)).history, now = T0 + 28 * DAY;
  for (const minutes of [45, 60, 90]) {
    const p = RT.planNext(h, now, { minutes });
    assert.ok(Math.abs(length(p) - minutes * 60) <= 15, `${minutes} min runs ${length(p)} s`);
  }
  const p15 = RT.planNext(h, now, { minutes: 15 }), p90 = RT.planNext(h, now, { minutes: 90 });
  const L = (p) => p.rounds.reduce((a, r) => a + r.work / 60 * RT.PROG.loadK[r.phase], 0) + p.cap * RT.PROG.repLoad;
  assert.ok((p90.state.fat6 + L(p90)) / p90.state.fit <= RT.PROG.acwrCap + 1e-9 || p90.day === 'light', '90 min stays inside your load');
  assert.ok(p90.rest >= p15.rest, 'longer rests');
});

test('practice blocks: technique, situations, then a live go, repeating in long sessions', () => {
  const short = RT.buildRounds('volume', 35, 35, 900), long = RT.buildRounds('volume', 35, 35, 3600);
  const shape = (r) => r.map((x) => x.phase[0]).join('');
  assert.match(shape(short), /^wt+s+l+$/, 'one block in 15 min: ' + shape(short));
  assert.match(shape(long), /^w(t+s+l+){3,}$/, 'several in 60: ' + shape(long));
  for (const r of [short, long]) assert.equal(r.reduce((a, x) => a + x.work + x.rest, 0), r === short ? 900 : 3600);
  assert.ok(long.filter((x) => x.phase === 'live').every((x) => x.periods <= 3));
});

test('the next round is picked from how the session is going', () => {
  const tg = { tech: 2, sit: 2, live: 2 }, R = (phase, o = {}) => ({ phase, work: 30, stancePct: 0.78, ...o });
  const pick = (rs, cap) => RT.pickPhase([R('warm'), ...rs], tg, cap);
  assert.equal(pick([]).phase, 'tech');
  assert.equal(pick([R('tech')]).k, 1);
  assert.equal(pick([R('tech'), R('tech')]).phase, 'sit');
  const go = pick([R('tech'), R('tech'), R('sit'), R('sit')]);
  assert.equal(go.phase, 'live'); assert.equal(go.period, 1); assert.equal(go.periods, 2);
  assert.equal(pick([R('tech'), R('tech'), R('sit'), R('sit'), R('live')]).period, 2, 'the rest of the go');
  assert.equal(pick([R('tech'), R('tech'), R('sit'), R('sit'), R('live'), R('live')]).phase, 'tech', 'then a new block');
  assert.equal(pick([R('tech'), R('tech'), R('sit'), R('sit', { uprightPct: 0.3 })]).phase, 'tech', 'spent: technique, not the live go');
  assert.equal(pick([R('tech'), R('tech'), R('sit'), R('sit', { stancePct: 0.5 })]).phase, 'tech', 'stance not holding: one more technique round first');
  assert.notEqual(pick([R('tech'), R('tech'), R('sit'), R('sit')], true).phase, 'live', 'explosive work done: no live go');
  assert.equal(pick([R('tech'), R('tech'), R('sit'), R('sit'), R('live', { calls: 6, missed: 3 })]).phase, 'tech', 'spent mid-go: back to technique');
});

test('an open session plans its first stretch and the blocks to keep going', () => {
  const h = simulate(RT, weekdays(2)).history;
  const p = RT.planNext(h, T0 + 14 * DAY, { open: true });
  assert.equal(p.open, true); assert.equal(length(p), RT.PROG.openS);
  assert.ok(p.blocks.tech >= 1 && p.blocks.sit >= 1 && p.blocks.live >= 1 && p.blocks.live <= 3);
  assert.ok(p.why.some((x) => /Open session/.test(x)));
  // no round ceiling in an open session: a big round length gets its full rounds, at least two of them
  const fit = sess(0, { rounds: Array.from({ length: 30 }, () => round('tech', 1500, 0.75)) });
  const q = RT.planNext([fit], T0 + DAY, { open: true }), longest = Math.max(...q.rounds.map((r) => r.work));
  assert.ok(longest > 855, 'rounds past the old 14 minute cap: ' + longest);
  assert.ok(q.rounds.filter((r) => r.phase !== 'warm').length >= 2 && length(q) > RT.PROG.openS, `${q.rounds.length - 1} rounds over ${length(q)} s`);
  // a long open session's load counts like any other: the next day is lighter
  const big = { date: new Date(T0 + 14 * DAY).toISOString(), kind: 'session', day: 'volume', open: true, minutes: 60,
    rounds: Array.from({ length: 50 }, () => round('sit', 45, 0.76)), explosive: 40, trials: [] };
  const next = RT.planNext([...h, big], T0 + 15 * DAY, { minutes: 15 });
  assert.equal(next.day, 'light', 'after a 60 minute open session: ' + next.why[0]);
});

test('explosive tolerance: reps until the speed fades', () => {
  const fade = [1, 1, 1, 0.98, 0.96, 0.95, 0.9, 0.85, 0.78, 0.75, 0.7];
  assert.equal(RT.explosiveTol(fade), 8); assert.equal(RT.speedHolding(fade), false);
  const held = Array(10).fill(1);
  assert.equal(RT.explosiveTol(held), 12); assert.equal(RT.speedHolding(held), true);
  assert.equal(RT.explosiveTol([1, 1]), null);
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
  const h = [sess(1, { trials: [...t('sprawl', true, 10), ...t('snap', false, 4)] }), sess(2, { trials: [...t('snap', true, 2), ...t('snap', false, 4)] })];
  const st = RT.state(h, T0 + 3 * DAY), p = RT.planNext(h, T0 + 3 * DAY);
  assert.ok(Math.abs(st.windows.sprawl - w.sprawl) < 1e-9 && Math.abs(st.windows.snap - w.snap) < 1e-9, 'the next session carries on from the last call');
  assert.equal(p.weak, 'snap'); assert.ok(p.why.some((x) => /snaps/.test(x)));
});

test('older test sessions still count: the hold and the test reads', () => {
  const tr = [0.5, 0.6, 0.7, 0.55, 0.65].map((rt) => ({ m: 'sprawl', h: true, rt }));
  const st = RT.state([{ ...test0(0, 40), trials: tr }], T0 + DAY);
  assert.ok(Math.abs(st.windows.sprawl - 0.6 * 1.33) < 1e-9, 'median read plus a third');
  assert.ok(st.cap < RT.PROG.cap0, 'a 40 s hold says rounds of about 24 s: ' + st.cap.toFixed(1));
  assert.notEqual(RT.planNext([test0(0, 40)], T0 + DAY).day, 'start');
});

test('a simulated season: an improving player grows, a flat one holds, the day changes', () => {
  const sched = weekdays(10).map((x, i) => ({ ...x, minutes: i % 5 === 2 ? 30 : 15 }));
  const up = simulate(RT, sched, { cap: 35 }).sessions, flat = simulate(RT, sched, { cap: 35, grow: 0 }).sessions;
  const work = (ss, a, b) => ss.slice(a, b).filter((s) => s.minutes === 15 && s.plan.day !== 'light').map((s) => s.plan.work);
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  assert.ok(avg(work(up, 40, 50)) > avg(work(up, 0, 10)) + 8, `rounds grow: ${avg(work(up, 0, 10)).toFixed(0)} s to ${avg(work(up, 40, 50)).toFixed(0)} s`);
  assert.ok(Math.abs(avg(work(flat, 40, 50)) - avg(work(flat, 5, 15))) < 8, `a flat player holds: ${avg(work(flat, 5, 15)).toFixed(0)} s, ${avg(work(flat, 40, 50)).toFixed(0)} s`);
  // rest per second of work falls as the player recovers faster, and the estimate never asks for less than they need
  const rec = (ss, a, b) => avg(ss.slice(a, b).map((x) => x.state.rec));
  assert.ok(rec(up, 40, 50) < rec(up, 5, 15) - 0.15, `rest per second of work: ${rec(up, 5, 15).toFixed(2)} to ${rec(up, 40, 50).toFixed(2)}`);
  assert.ok(Math.abs(rec(flat, 40, 50) - rec(flat, 5, 15)) < 0.15, `flat: ${rec(flat, 5, 15).toFixed(2)}, ${rec(flat, 40, 50).toFixed(2)}`);
  for (const x of up) assert.ok(x.state.rec >= x.me.rec * 0.9, `day ${x.day}: rest estimate ${x.state.rec.toFixed(2)}, need ${x.me.rec.toFixed(2)}`);
  // the estimate never runs ahead of the player
  for (const s of up) assert.ok(s.state.cap <= s.me.cap * 1.1, `day ${s.day}: estimate ${s.state.cap.toFixed(0)}, player ${s.me.cap.toFixed(0)}`);
  // every week has more than one kind of day, and all of them show up
  const kinds = new Set(up.map((s) => s.plan.day));
  for (const d of ['volume', 'pace', 'live']) assert.ok(kinds.has(d), 'has ' + d);
  for (let wk = 1; wk < 10; wk++) assert.ok(new Set(up.filter((s) => Math.floor(s.day / 7) === wk).map((s) => s.plan.day)).size >= 2, 'week ' + wk);
  // the reads follow the player's own 74% point
  const last = up[up.length - 1], point = last.me.rt + 0.64 * 0.18, mean = RT.qualities(last.state).readWindow;
  assert.ok(Math.abs(mean - point) < 0.2, `reads ${mean.toFixed(2)} s, the player's 74% point ${point.toFixed(2)} s`);
});

test('a 30 minute day is not double the load of a 15', () => {
  const h = simulate(RT, weekdays(3)).history;
  const p15 = RT.planNext(h, T0 + 21 * DAY, { minutes: 15 }), p30 = RT.planNext(h, T0 + 21 * DAY, { minutes: 30 });
  const L = (p) => p.rounds.reduce((a, r) => a + r.work / 60 * RT.PROG.loadK[r.phase], 0) + p.cap * RT.PROG.repLoad;
  assert.ok(L(p30) < 1.9 * L(p15) && L(p30) > 1.2 * L(p15), `${L(p15).toFixed(1)} and ${L(p30).toFixed(1)}`);
  assert.ok(p30.rest >= p15.rest);
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

test('goal: the whole session continuous at a hard pace', () => {
  const st = RT.state([], T0), g = RT.goalProgress(st);
  assert.equal(g.stance, 0, 'at the start'); assert.ok(Math.abs(g.reads - 0.76) < 0.01); assert.equal(g.explosive, 0.4);
  assert.ok(Math.abs(RT.qualities({ ...st, cap: Math.sqrt(30 * 900) }).stance - 0.5) < 1e-9, 'halfway on a log scale');
  assert.equal(RT.qualities({ ...st, cap: 900 }).stance, 1);
  assert.ok(/Goal: 15 min continuous at 0\.95 s reads/.test(g.text), g.text);
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
