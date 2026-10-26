// Headless check of the camera check screen in Chromium with a fake camera (no person in it).
// MediaPipe and the models come from $MP_DIR (see fetch-mediapipe.sh), so it runs offline from jsdelivr.
// The real model loads and runs on the fake camera; then the landmarker is swapped for the synthetic
// figure (test/helpers/figure.mjs), posed per spoken cue, to run calibration, readouts and recording.
// Usage: MP_DIR=/some/dir node test/browser/check.mjs   (about two minutes; ?fast shortens bench and soak)
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const MP = process.env.MP_DIR;
if (!MP) { console.error('set MP_DIR (see test/browser/fetch-mediapipe.sh)'); process.exit(2); }

const server = http.createServer((q, r) => {
  const rel = decodeURIComponent(q.url.split('?')[0]);
  const f = path.join(ROOT, rel === '/' ? 'index.html' : rel);
  try { r.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' }); r.end(readFileSync(f)); }
  catch { r.writeHead(404); r.end(); }
}).listen(8099);

const fail = [];
const check = (ok, msg) => { console.log((ok ? 'ok   ' : 'FAIL ') + msg); if (!ok) fail.push(msg); };
const POSE = {
  Standing: { hip: 0.95, footW: 0.3, lean: 0.05 },
  'Square stance': { hip: 0.62, footW: 0.5, lean: 0.35 },
  'Staggered stance': { hip: 0.66, footW: 0.36, lean: 0.3, stagger: 0.35 },
};

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['camera'] })).newPage();
  page.on('pageerror', (e) => check(false, 'page error: ' + e.message));
  await page.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/**', (rt) => {
    const rel = rt.request().url().split('@1.1.1/')[1];
    rt.fulfill({ status: 200, headers: { 'content-type': rel.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', 'access-control-allow-origin': '*' }, body: readFileSync(path.join(MP, 'package', rel)) });
  });
  await page.route('https://cdn.jsdelivr.net/npm/three@0.186.1/**', (rt) => {
    const rel = rt.request().url().split('@0.186.1/')[1];
    rt.fulfill({ status: 200, headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' }, body: readFileSync(path.join(MP, 'three/package', rel)) });
  });
  await page.route('https://storage.googleapis.com/**', (rt) => rt.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(path.join(MP, rt.request().url().split('/').pop())) }));
  await page.route('https://fonts.googleapis.com/**', (rt) => rt.fulfill({ status: 200, body: '' }));
  await page.goto('http://localhost:8099/?fast');
  check(await page.isHidden('#labBtn'), 'Camera check is not in the menu');
  check(await page.isVisible('#segDevice') && await page.isVisible('#segFacing'), 'the menu offers tablet or phone, front or back camera');
  await page.goto('http://localhost:8099/?fast#check'); await page.reload();

  // camera and real model
  await page.click('#labBtn');
  await page.click('#labModel button[data-v="lite"]');
  await page.click('#labStart');
  await page.waitForFunction(() => /detect \d+ fps/.test(document.getElementById('labHud').textContent), null, { timeout: 90000 });
  check(/1920x1440/.test(await page.textContent('#labStatus')), 'camera opened at 4:3: ' + await page.textContent('#labStatus'));
  check(await page.textContent('#labHint') === 'No body seen', 'real model runs, no body in the fake camera');

  // synthetic figure in place of the model
  const fig = readFileSync(path.join(ROOT, 'test/helpers/figure.mjs'), 'utf8').replace(/^export /gm, '');
  await page.addScriptTag({ content: fig + '\nwindow.figure = figure;' });
  await page.evaluate(() => {
    window.__pose = { hip: 0.95, footW: 0.3, lean: 0.05, dist: 2.0, vfov: 94 }; // the iPad front ultra-wide's 4:3 field of view
    const obj = (a) => a.map(([x, y, z, v]) => ({ x, y, z, visibility: v }));
    RoomTimeLab.L.lmk = { detectForVideo() { const f = figure(window.__pose); return { landmarks: [obj(f.lm)], worldLandmarks: [obj(f.wl)] }; }, close() {} };
  });
  const pose = (p) => page.evaluate((p) => Object.assign(window.__pose, { stagger: 0, x: 0, elbowOut: 0.2 }, p), p);

  // shuffling side to side in stance, the player's left wall at +X 1.0 and right at -1.0
  const sweep = (on) => page.evaluate((on) => {
    clearInterval(window.__sweep);
    if (on) window.__sweep = setInterval(() => { window.__pose.x = Math.sin(performance.now() / 600) * 1.05; }, 50);
    else window.__pose.x = 0;
  }, on);
  // follows the spoken cues on the status line until done() is true; with tallFirst, the square stance starts
  // too tall and is fixed once the coaching says so
  const coached = [];
  const followCues = async (done, ms = 150000, tallFirst = false) => {
    const seen = new Set(), t0 = Date.now();
    while (Date.now() - t0 < ms && !(await done())) {
      const st = await page.textContent('#labStatus');
      const m = st.match(/Calibrate: (.*)/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        if (m[1] === 'Floor') { await pose(POSE['Square stance']); await sweep(true); }
        else if (m[1] === 'Square stance' && tallFirst) { await sweep(false); await pose({ ...POSE['Square stance'], hip: 0.8 }); }
        else if (POSE[m[1]]) { await sweep(false); await pose(POSE[m[1]]); }
      }
      const fix = st.match(/^Square stance: (.*)/);
      if (fix && !coached.includes(fix[1])) { coached.push(fix[1]); await pose(POSE['Square stance']); }
      await page.waitForTimeout(150);
    }
    await sweep(false);
    return [...seen];
  };

  // calibration, posed per cue
  await page.click('#calBtn');
  const cues = await followCues(async () => await page.textContent('#calBtn') === 'Calibrate', 150000, true);
  check(coached[0] === 'Sink your hips. Bend your knees.', 'stance coaching: a tall stance hears "' + coached.join('", "') + '"');
  const cal = await page.evaluate(() => RoomTimeLab.L.cal);
  check(cal && ['stand', 'square', 'stagger', 'floor'].every((k) => cal[k]), 'calibrated: three holds and the floor from the shuffle (' + cues.join(', ') + ')');
  check(Math.abs(cal.floor.width - 2.0) < 0.15, `the shuffle measured the floor in meters: ${cal.floor.width.toFixed(2)} m (moved 2.1 m)`);
  check(Math.abs(cal.square.D - 2.0) < 0.1, `distance from the iPad: ${cal.square.D.toFixed(2)} m (stood at 2.0)`);
  check(!(cal.square.form || []).length, 'the square stance was held once fixed: no form notes');

  // live readouts
  const live = async (p) => { await pose(p); await page.waitForTimeout(800); return page.evaluate(() => RoomTimeLab.L.cur.r); };
  let r = await live(POSE.Standing); check(r.zone === 'tall', 'standing reads tall');
  r = await live(POSE['Square stance']); check(r.zone === 'stance' && Math.abs(r.level - 0.45) < 0.03, 'square stance reads stance at 0.45: ' + r.level.toFixed(2));
  r = await live({ hip: 0.42, footW: 0.5, lean: 0.4 }); check(r.zone === 'deep', 'a deep drop reads deep');
  r = await live({ ...POSE['Square stance'], x: 1.0 }); check(Math.abs(r.floorX + 1) < 0.08, 'your left edge is floor -1: ' + r.floorX.toFixed(2));
  r = await live({ ...POSE['Square stance'], x: -0.6, dist: 1.6 }); check(Math.abs(r.X - 0.6) < 0.04 && Math.abs(r.z + 0.4) < 0.06, `0.6 m right and 0.4 m forward reads ${r.X.toFixed(2)} m and ${r.z.toFixed(2)} m`);

  // recording
  await page.click('#recBtn'); await page.waitForTimeout(2500); await page.click('#recBtn');
  await page.waitForSelector('#recTrace:not([hidden])', { timeout: 15000 });
  check(/frames/.test(await page.textContent('#recOut')), 'recording made a trace: ' + await page.textContent('#recOut'));

  // the touch game still works, now in 3D
  await page.click('#labBack');
  await page.click('#autoBtn'); await page.waitForTimeout(1500);
  check(await page.textContent('#phaseName') === 'Warm-in', 'touch auto-play still starts');
  await page.waitForFunction(() => globalThis.RoomTime3D && RoomTime3D.ok, null, { timeout: 30000 }).catch(() => {});
  const r3 = await page.evaluate(() => ({ ok: RoomTime3D.ok, ms: RoomTime3D.buildMs }));
  check(r3.ok, `3D view renders (body built in ${r3.ms} ms)`);

  // camera play with the synthetic figure: the warm-up calibration, walls from the warm-in's circling,
  // then the tracker drives level, floor and eye height, and a shot comes in as a move
  await page.click('#endBtn');
  await page.evaluate(() => { const c = JSON.parse(localStorage.getItem('roomtime.cal')); delete c.floor; localStorage.setItem('roomtime.cal', JSON.stringify(c)); });
  await page.click('#camPlayBtn');
  await page.waitForFunction(() => RoomTimeLab.L.src === 'camera' && RoomTimeGame.S && RoomTimeGame.S.cam, null, { timeout: 60000 });
  check(await page.evaluate(() => RoomTimeGame.S.mode) === 'calib', 'camera play opens with the warm-up calibration');
  check(await page.isHidden('#deck'), 'camera play hides the touch buttons');
  const holds = await followCues(async () => await page.evaluate(() => RoomTimeGame.S.mode !== 'calib'));
  check(await page.evaluate(() => RoomTimeGame.S.mode) === 'work' && holds.join() === 'Standing,Square stance,Staggered stance,Floor', 'then the warm-in starts: ' + holds.join(', '));
  // (this container renders camera play at about 2 fps, so the short ?fast shuffle catches only part of the floor)
  const fl = await page.evaluate(() => ({ halfW: RoomTimeGame.S.cam.halfW, floor: RoomTimeLab.L.cal.floor }));
  check(fl.floor && fl.halfW > 0.4 && Math.abs(fl.halfW - fl.floor.width / 2) < 0.01, `camera play knows the floor: ${fl.halfW.toFixed(2)} m each side`);
  await page.evaluate(() => { window.__moves = []; const orig = RoomTimeGame.camMove; RoomTimeGame.camMove = (t, p) => { window.__moves.push(t); orig(t, p); }; });
  const camState = async (p, ms = 1500) => { await pose(p); await page.waitForTimeout(ms); return page.evaluate(() => { const S = RoomTimeGame.S; return { level: S.level, x: S.youX, eye: S.cam.head && S.cam.head.eye, moves: window.__moves.join(',') }; }); };
  let c = await camState({ ...POSE['Square stance'], dist: 2.0 });
  check(Math.abs(c.level - 0.45) < 0.05, 'camera play: stance drives the level: ' + c.level.toFixed(2));
  c = await camState({ ...POSE.Standing, dist: 2.0 });
  check(c.level > 0.9 && c.eye > 1.55, `camera play: standing raises level and eyes (${c.level.toFixed(2)}, ${c.eye.toFixed(2)} m)`);
  c = await camState({ ...POSE['Square stance'], x: -0.7, dist: 2.0 });
  check(c.x > 0.5, 'camera play: moving toward the right wall moves you on the floor: ' + c.x.toFixed(2));
  const vx = await page.evaluate(() => RoomTime3D.view.x - RoomTime3D.view.dx), want = 0.7 - fl.floor.center;
  check(Math.abs(vx - want) < 0.08, `the 3D view moves 1:1: you are ${want.toFixed(2)} m right of your floor's center, the view ${vx.toFixed(2)} m`);
  await camState({ ...POSE['Square stance'], dist: 2.0 });
  c = await camState({ hip: 0.42, footW: 0.55, lean: 0.6, dist: 1.5 }, 1200);
  check(c.moves === 'shot', 'camera play: a drop stepping in is a shot: ' + c.moves);
  await camState({ ...POSE['Square stance'], dist: 2.0 }, 1500);
  c = await camState({ ...POSE['Square stance'], hip: 0.58, lean: 0.5, dist: 2.1, handY: 0.33 }, 1200);
  check(c.moves === 'shot,down_block', 'camera play: hands to the knees with the hips back is a down block: ' + c.moves);
  await page.click('#endBtn'); await page.waitForTimeout(300);
  check(await page.evaluate(() => RoomTimeLab.L.src) === null, 'leaving camera play stops the camera');
} finally {
  await browser.close(); server.close();
}
console.log(fail.length ? `${fail.length} failed` : 'all passed');
process.exit(fail.length ? 1 : 0);
