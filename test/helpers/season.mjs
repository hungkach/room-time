// A simulated player for the Train me planner: each day on the schedule, plan a session (RT.planNext), play it round
// by round with the game's own mid-session adjustment (RT.adaptRound) and the live read staircase, and save the
// record the game would. The player has a true stance capacity, read speed and explosive tolerance that grow with
// consistent training and fade with time off.
const DAY = 864e5;

export function simulate(RT, schedule, opts = {}) {
  const P = RT.PROG;
  let seed = opts.seed || 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd());
  const grow = opts.grow == null ? 1 : opts.grow;
  // the player: capacity (s at about 75% in stance), mean read (s), explosive reps before speed fades
  const me = { cap: opts.cap || 40, rt: opts.rt || 0.95, tol: opts.tol || 14 };
  const h = opts.history ? opts.history.slice() : [], out = [];
  const T0 = opts.t0 || Date.parse('2026-11-02T12:00:00Z');
  let lastDay = null;
  for (const item of schedule) {
    const { day, minutes = 15 } = typeof item === 'number' ? { day: item } : item;
    const now = T0 + day * DAY + (item.hour || 0) * 3600e3;
    // detraining: after 3 days off, about 1% a day
    if (lastDay != null && day - lastDay > 3) {
      const k = Math.pow(0.99, day - lastDay - 3);
      me.cap = Math.max(30, me.cap * k); me.tol = Math.max(10, me.tol * k); me.rt = Math.min(1.1, me.rt / k);
    }
    lastDay = day;
    const p = RT.planNext(h, now, { minutes });
    const ease = p.ease || 1, win = { ...p.windows };
    let plan = p.rounds.map((r) => ({ ...r }));
    const rounds = [], trials = [], speeds = [];
    let explosive = 0, cap = p.cap, elapsed = 0;
    for (let i = 0; i < plan.length; i++) {
      const rd = plan[i];
      elapsed += rd.work + (i ? rd.rest : 0);
      // stance: about 75% at your capacity, better on shorter rounds, a little worse late in the session
      const tired = 1 - 0.015 * i, c = me.cap * tired;
      let sp, breakT = null, hold = null;
      if (rd.phase === 'hold') {
        hold = Math.min(rd.work, c / 0.6 * (1 + 0.05 * gauss()));
        rounds.push({ phase: 'hold', work: hold, hold, stancePct: 1 });
        continue;
      }
      sp = Math.max(0.3, Math.min(0.97, 0.75 * Math.pow(c / rd.work, 0.5) + 0.03 * gauss()));
      if (rd.phase === 'warm') sp = Math.min(0.97, sp + 0.1);
      if (sp < 0.7) breakT = rd.work * sp / 0.75 * 0.8;
      // calls: about one every 6 s; the staircase steps in drill rounds (not the warm-in or live)
      const n = Math.round(rd.work / 6);
      for (let k = 0; k < n; k++) {
        const m = P.moves[Math.floor(rnd() * P.moves.length)];
        const w = win[m] * (rd.phase === 'warm' ? 1.35 : 1), rt = me.rt + 0.18 * gauss(), hit = rt < w;
        const t = { m, h: hit, rt: hit ? Math.round(rt * 1000) / 1000 : null };
        if (rd.phase !== 'warm' && rd.phase !== 'live') {
          t.w = win[m] / ease;
          win[m] = Math.min(P.wMax * ease, Math.max(P.wMin * ease, win[m] * (hit ? P.hitStep : P.missStep)));
        }
        trials.push(t);
        if ((m === 'shot' || m === 'sprawl') && explosive < cap && rd.phase !== 'warm') {
          explosive++;
          speeds.push(1 - 0.35 * Math.pow(explosive / me.tol, 2) + 0.03 * gauss());
          // the game's live fade check lowers the cap to where you are
          if (RT.explosiveTol(speeds) != null && speeds.length >= 6) {
            const v = speeds.slice(-3).sort()[1], f = speeds.slice(0, 3).sort()[1];
            if (v < P.speedFade * f) cap = explosive;
          }
        }
      }
      const r = { phase: rd.phase, work: rd.work, stancePct: sp, breakT };
      rounds.push(r);
      // the game's mid-session adjustment
      plan = plan.slice(0, i + 1).concat(RT.adaptRound(r, plan.slice(i + 1), p.day).rounds);
    }
    const rec = {
      date: new Date(now).toISOString(), mode: 'train', kind: 'session', day: p.day, partial: false, minutes,
      work: p.work, rest: p.rest, cap: p.cap, rounds, trials, explosive, explosiveTol: RT.explosiveTol(speeds), tolOpen: RT.speedHolding(speeds),
      stancePct: rounds.filter((r) => r.phase !== 'hold').reduce((a, r) => a + r.stancePct * r.work, 0) / rounds.filter((r) => r.phase !== 'hold').reduce((a, r) => a + r.work, 0),
      moves: RT.moveStats(trials), speed: { first: 1, last: speeds.length ? speeds[speeds.length - 1] : null },
      readWindow: P.moves.reduce((a, m) => a + p.windows[m], 0) / P.moves.length,
      onTime: trials.length ? trials.filter((t) => t.h).length / trials.length : null
    };
    rec.load = RT.loadOf(rec);
    h.push(rec);
    out.push({ day, minutes, plan: p, rec, elapsed, me: { ...me }, state: p.state });
    // training effect: steady work builds all three, slowly, toward a ceiling
    const L = rec.load;
    me.cap = Math.min(150, me.cap * (1 + 0.012 * grow * Math.min(L, 12) / 8));
    me.tol = Math.min(40, me.tol * (1 + 0.01 * grow * Math.min(L, 12) / 8));
    me.rt = Math.max(0.55, me.rt * (1 - 0.004 * grow * Math.min(L, 12) / 8));
  }
  return { history: h, sessions: out };
}

// Weekday lunches for some weeks: days 0-4, 7-11, ...
export const weekdays = (weeks, minutes = 15) => Array.from({ length: weeks * 5 }, (_, i) => ({ day: Math.floor(i / 5) * 7 + (i % 5), minutes }));
