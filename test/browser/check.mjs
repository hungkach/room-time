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
  'Left wall': { hip: 0.62, footW: 0.5, lean: 0.35, x: 1.0 },
  'Right wall': { hip: 0.62, footW: 0.5, lean: 0.35, x: -1.0 },
};

const browser = await chromium.launch({ args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'] });
try {
  const page = await (await browser.newContext({ viewport: { width: 1180, height: 820 }, permissions: ['camera'] })).newPage();
  page.on('pageerror', (e) => check(false, 'page error: ' + e.message));
  await page.route('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.1.1/**', (rt) => {
    const rel = rt.request().url().split('@1.1.1/')[1];
    rt.fulfill({ status: 200, headers: { 'content-type': rel.endsWith('.wasm') ? 'application/wasm' : 'text/javascript', 'access-control-allow-origin': '*' }, body: readFileSync(path.join(MP, 'package', rel)) });
  });
  await page.route('https://storage.googleapis.com/**', (rt) => rt.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, body: readFileSync(path.join(MP, rt.request().url().split('/').pop())) }));
  await page.route('https://fonts.googleapis.com/**', (rt) => rt.fulfill({ status: 200, body: '' }));
  await page.goto('http://localhost:8099/?fast');

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
    window.__pose = { hip: 0.95, footW: 0.3, lean: 0.05, dist: 2.0, vfov: 90 };
    const obj = (a) => a.map(([x, y, z, v]) => ({ x, y, z, visibility: v }));
    RoomTimeLab.L.lmk = { detectForVideo() { const f = figure(window.__pose); return { landmarks: [obj(f.lm)], worldLandmarks: [obj(f.wl)] }; }, close() {} };
  });
  const pose = (p) => page.evaluate((p) => Object.assign(window.__pose, { stagger: 0, x: 0, elbowOut: 0.2 }, p), p);

  // calibration, posed per cue
  await page.click('#calBtn');
  const seen = new Set(), t0 = Date.now();
  while (Date.now() - t0 < 120000 && await page.textContent('#calBtn') !== 'Calibrate') {
    const m = (await page.textContent('#labStatus')).match(/Calibrate: (.*)/);
    if (m && POSE[m[1]] && !seen.has(m[1])) { seen.add(m[1]); await pose(POSE[m[1]]); }
    await page.waitForTimeout(150);
  }
  const cal = await page.evaluate(() => RoomTimeLab.L.cal);
  check(cal && ['stand', 'square', 'stagger', 'wallL', 'wallR'].every((k) => cal[k]), 'all five poses calibrated');

  // live readouts
  const live = async (p) => { await pose(p); await page.waitForTimeout(800); return page.evaluate(() => RoomTimeLab.L.cur.r); };
  let r = await live(POSE.Standing); check(r.zone === 'tall', 'standing reads tall');
  r = await live(POSE['Square stance']); check(r.zone === 'stance' && Math.abs(r.level - 0.45) < 0.03, 'square stance reads stance at 0.45: ' + r.level.toFixed(2));
  r = await live({ hip: 0.42, footW: 0.5, lean: 0.4 }); check(r.zone === 'deep', 'a deep drop reads deep');
  r = await live({ ...POSE['Square stance'], x: 1.0 }); check(Math.abs(r.floorX + 1) < 0.05, 'left wall is floor -1: ' + r.floorX.toFixed(2));

  // recording
  await page.click('#recBtn'); await page.waitForTimeout(2500); await page.click('#recBtn');
  await page.waitForSelector('#recTrace:not([hidden])', { timeout: 15000 });
  check(/frames/.test(await page.textContent('#recOut')), 'recording made a trace: ' + await page.textContent('#recOut'));

  // the touch game still works
  await page.click('#labBack');
  await page.click('#autoBtn'); await page.waitForTimeout(1500);
  check(await page.textContent('#phaseName') === 'Warm-in', 'touch auto-play still starts');
} finally {
  await browser.close(); server.close();
}
console.log(fail.length ? `${fail.length} failed` : 'all passed');
process.exit(fail.length ? 1 : 0);
