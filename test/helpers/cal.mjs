import { loadRT } from './load.mjs';
import { figure } from './figure.mjs';

const RT = loadRT();
const M = (o) => { const f = figure(o); return RT.measure(f.lm, f.wl, f.aspect); };

// The calibration poses for a synthetic player, captured over a few slightly different frames.
export function calFor(o = {}) {
  const caps = {};
  const pose = {
    stand: { hip: 0.95, footW: 0.3, lean: 0.05 },
    square: { hip: 0.62, footW: 0.5, lean: 0.35 },
    stagger: { hip: 0.66, footW: 0.36, lean: 0.3, stagger: 0.35 },
  };
  for (const k of RT.POSES) caps[k] = [0, 1, 2, 3, 4].map((i) => M(Object.assign({}, o, pose[k], { hip: pose[k].hip + (i - 2) * 0.003 })));
  // the walls: shuffling side to side in stance, the player's left wall at +X 1.0 and right at -1.0
  caps.sweep = Array.from({ length: 43 }, (_, i) => M(Object.assign({}, o, pose.square, { x: -1.05 + i * 0.05 })));
  return RT.buildCal(caps, { aspect: o.aspect || 4 / 3 });
}
