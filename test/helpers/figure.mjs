// Synthetic wrestler: a 3D stick figure in meters, seen by a pinhole camera at hip height.
// Returns MediaPipe-shaped image landmarks (0 to 1, y down) and world landmarks
// (meters from the hip midpoint, y down, x along the image's x).
// Camera space: +X is the camera's right, +Y up, +Z away from the camera. The player faces
// the camera, so the player's right side sits at -X (it shows on the left of the raw frame).

export const STAND = { hip: 0.95, footW: 0.3, elbowOut: 0.2, lean: 0.05 };

export function figure(o = {}) {
  const p = Object.assign({
    hip: 0.95,          // hip height above the floor
    footW: 0.3,         // ankle to ankle
    elbowOut: 0.2,      // each elbow out from the midline (shoulder half width is 0.2)
    lean: 0.05,         // torso lean toward the camera, radians
    stagger: 0,         // lead (left) foot this far nearer the camera
    dist: 1.8,          // camera to hips
    x: 0,               // sideways position
    camH: 0.95,         // camera height
    vfov: 80,           // vertical field of view, degrees
    aspect: 4 / 3,      // frame width / height
    mirror: false,      // a mirrored frame (x flipped)
    torso: 0.52, shoulderW: 0.4, vis: 0.95,
  }, o);
  const ank = 0.08, Z = p.dist;
  const sy = p.hip + p.torso * Math.cos(p.lean), sz = Z - p.torso * Math.sin(p.lean);
  const R = -1, L = 1; // player's right at -X
  const P = new Array(33);
  const set = (i, X, Y, Zz) => { P[i] = [X + p.x, Y, Zz]; };
  set(0, 0, sy + 0.22, sz - 0.08);
  for (let i = 1; i <= 10; i++) set(i, (i <= 3 || i === 7 || i === 9 ? L : R) * 0.04, sy + 0.24, sz - 0.06);
  set(11, L * p.shoulderW / 2, sy, sz); set(12, R * p.shoulderW / 2, sy, sz);
  set(13, L * p.elbowOut, sy - 0.26, sz - 0.12); set(14, R * p.elbowOut, sy - 0.26, sz - 0.12);
  set(15, L * 0.12, sy - 0.2, sz - 0.35); set(16, R * 0.12, sy - 0.2, sz - 0.35);
  for (const [i, s] of [[17, L], [19, L], [21, L], [18, R], [20, R], [22, R]]) set(i, s * 0.12, sy - 0.22, sz - 0.38);
  set(23, L * 0.1, p.hip, Z); set(24, R * 0.1, p.hip, Z);
  const zl = Z - p.stagger, zr = Z;
  set(25, L * p.footW / 2, (p.hip + ank) / 2, zl - 0.12); set(26, R * p.footW / 2, (p.hip + ank) / 2, zr - 0.12);
  set(27, L * p.footW / 2, ank, zl); set(28, R * p.footW / 2, ank, zr);
  set(29, L * p.footW / 2, 0.04, zl + 0.05); set(30, R * p.footW / 2, 0.04, zr + 0.05);
  set(31, L * p.footW / 2, 0.02, zl - 0.15); set(32, R * p.footW / 2, 0.02, zr - 0.15);

  const f = 0.5 / Math.tan((p.vfov * Math.PI) / 360); // focal length in frame heights
  const hm = [(P[23][0] + P[24][0]) / 2, p.hip, Z];
  const lm = P.map(([X, Y, Zz]) => {
    let x = 0.5 + (f * X) / Zz / p.aspect;
    if (p.mirror) x = 1 - x;
    return [x, 0.5 - (f * (Y - p.camH)) / Zz, (Zz - Z) / 2, p.vis];
  });
  const wl = P.map(([X, Y, Zz]) => [(p.mirror ? -1 : 1) * (X - hm[0]), -(Y - hm[1]), Zz - hm[2], p.vis]);
  return { lm, wl, aspect: p.aspect };
}

// A trace of scripted poses over time. script: [{ms, label, ...figure options}]; each key holds
// until the next, with a 200 ms ramp into it. Labels cover each hold, 250 ms clear of the ramps.
export function trace(script, opts = {}, fps = 30) {
  const ramp = 200, frames = [], end = script[script.length - 1].ms;
  for (let t = 0; t <= end; t += 1000 / fps) {
    let k = 0;
    while (k + 1 < script.length && script[k + 1].ms <= t) k++;
    const a = script[k], b = script[k + 1], key = {};
    for (const n of Object.keys(a)) {
      if (n === 'ms' || n === 'label') continue;
      key[n] = b && typeof b[n] === 'number' && t > b.ms - ramp ? a[n] + ((b[n] - a[n]) * (t - (b.ms - ramp))) / ramp : a[n];
    }
    const fr = figure(Object.assign({}, opts, key));
    frames.push({ t: Math.round(t), lm: fr.lm, wl: fr.wl });
  }
  const labels = [];
  for (let k = 0; k + 1 < script.length; k++) if (script[k].label) labels.push({ from: script[k].ms + 250, to: script[k + 1].ms - 250, label: script[k].label });
  return { frames, labels };
}
