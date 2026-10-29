# Room Time: notes for Claude

A wrestling training simulator, neutral position only, played with body tracking on an iPad camera. `index.html` is the working touch prototype and the source of truth for game design: read it fully before changing anything. Live at https://hungkach.github.io/room-time (GitHub Pages, main, root).

Player: Mark, former wrestler, USAW certified, S&C coach. Trains in half a small garage with no mats, so nothing ever puts a knee on the floor.

## Stack (do not change without asking)

- One self-contained `index.html`: plain canvas for the 2D overlay, no framework, no build step.
- three.js `0.186.1` from jsdelivr through an import map (Mark approved it for the 3D view on 10/26). The 3D view is optional: if three.js or WebGL is missing, the 2D prototype view draws instead.
- MediaPipe Pose Landmarker from `@mediapipe/tasks-vision@1.1.1` (jsdelivr), not the legacy `@mediapipe/pose`. Default model `pose_landmarker_full` (float16/1), GPU delegate with CPU fallback. Lite and heavy only for comparison.
- Camera play runs on a tablet or a phone, front or back camera (menu, saved in `roomtime.settings` as `device` and `facing`); the default is the iPad front ultra-wide, landscape, at hip height facing the player. The lens picks the field of view for the distance estimate (`RT.LENSES`); the front camera's preview is mirrored, the back camera's isn't. An optional side device comes later.
- Shared engine patterns come from `hungkach/body-arcade` (`engine/`). Copying code is fine; note the source commit next to it. Never edit body-arcade from here.

## Design rules

- The touch demo mode keeps working at all times. Camera mode is added alongside it, never in place of it.
- Audio first and glanceable. Spoken lines are information or short external cues ("Stay under the bar", "Feet moving"), never cheerleading. At most one correction about every 10 seconds.
- Everything is scored against the player's own calibration (standing, square stance, staggered stance, left and right walls), on a gradient, so fatigued reps still count.
- Calibration is part of the warm-up (Mark, 10/26): three held poses, then a directed shuffle: to your left until it beeps (the edge of the picture) or your wall, pause, then all the way to your right, pause; never walking to each wall and holding a pose. No height or other typed measurements. Saying left and right here is fine: it's the player's own left and right.
- Movement is 1:1 in meters (Mark, 10/26): what you see in 3D moves as far as you really move.
- Session structure, live go opponent, small-space edge logic and debrief follow the prototype.
- Small, reviewable commits. Plan mode for each feature; wait for Mark's approval before implementing.

## Code layout

- Metric and classifier functions are pure functions over landmark arrays, separate from rendering, in one `<script id="rt-metrics">` block in `index.html` that adds to `globalThis.RoomTime`. No DOM, no `</script` inside it. Node tests extract that block and run it in `vm`.
- Landmark traces (JSON) live in `test/fixtures/`. Each classifier gets a test on labeled traces.
- An always-available debug overlay shows FPS, inference time, landmark visibility and live metric values.
- Camera check (Phase 0; not in the menu since 10/26, calibration covers it in play; `#check` in the URL shows its button for development): `<script id="rt-lab">` (camera, model, loop, overlay) and `<script id="rt-lab-tools">` (bench, soak, calibration, live readouts). They share `globalThis.RoomTimeLab`; each frame goes to the `L.on` listeners as `{t, vt, lm, wl, aspect, w, h, inf, m, fc, r}`.
- No video is ever recorded, saved or uploaded (Mark, 10/27): the camera feed lives only in memory for tracking. Don't add recording back.
- Traces (test fixtures, synthetic for now): `{format: 'room-time-trace', version: 1, meta: {aspect, w, h, cal, src, model, ...}, frames: [{t, lm, wl}], labels: [{from, to, label}]}`, landmarks packed as `[x, y, z, visibility]`. Labels are `tall`, `stance` or `deep` for now.
- 3D view: `<script type="module" id="rt-3d">` renders the room, the opponent and your arms on `#cv3d` under the 2D canvas `#cv`, reading the game through `globalThis.RoomTimeGame` (read only); `RoomTime3D.ok` tells the 2D `draw()` to skip its own room and wrestler. The opponent is built in code: soft shapes summed into one surface with marching cubes, skinned to a skeleton (the head on a finer grid on the head bone), the singlet and shoes painted by smooth scores in a shader. Poses: legs and upper arms are absolute angles from hanging straight down. `RoomTime3D.debug.cam` can override the camera for close-ups.
- Camera play (menu button): `startSession(false, true)` opens in mode `calib` (the three holds and the shuffle, on the game screen), then `RoomTimeGame.begin()` starts the warm-in. Skip during the holds keeps the saved calibration. The tracker in `rt-lab-tools` writes `S.cam` {level, floorX, halfW, z, head {eye, dx}, seen} each frame (One Euro smoothed) and sends `RT.MoveDetector` moves through `RoomTimeGame.camMove`. The camera preview docks into `#pip`. His press is an offset on your floor (`S.camOff`); a reset waits for you to walk back to the middle. - Moves (`RT.MoveDetector`, `RT.MOVES`): shot is a fast drop (0.2 level in 650 ms) while hip width on screen grows 7%; sprawl is a drop to level 0.24 or lower with the hips not coming in; down block is the hands from your stance to knee level (0.3 torso lengths below the hips) with a small drop and the hips not coming in; snap is the hands from tie height (0.75 torso lengths above the hips) to the belt (0.25) in 500 ms with the level held. In the game the down block is `block` (button, key h): it stops his shot from range (the tell or the first 0.12 s of the shot) and costs nothing against the explosive cap; a deep shot runs through it.
- Camera play has no touch deck (`#game.cam #deck` hidden): the stage takes the screen.
- Stance coaching (`RT.stanceCheck`, `RT.FORM`): before each stance hold, calibration speaks the stance, then one fix at a time from what the camera can check (feet, hips against your standing hips including the tall-stance check, chest over knees, head up, elbows in, hands in front), up to 8 s, then holds; points still off are saved as `form` on that stance. Cues never say left or right. Camera check's Live card names each move as it reads it.
- Meters (`RT.measure`): `k`, meters per picture height at the hips, is the shoulders' and hips' side-to-side span in world landmarks over the same span in the picture (turning cancels out), with the shoulders scaled back to hip depth for a forward lean. From it: `Xcam` (sideways), `D` (distance; the only number that uses the lens angle, `RT.CAMERA.vfovDeg`, set from `RT.LENSES` by device and lens when the camera opens) and `eye`. Readouts add `X` (+ toward the player's right), `z` (back from the square stance spot), `floorX` from `cal.floor` {left, right, width, center} in meters (`RT.EdgePass`: each edge is the median of the pause at the far end of its pass, or the farthest point reached if time runs out; `RT.floorFrom` is the free-sweep version the warm-in's `RT.FloorTracker` uses to widen it, never narrow). MediaPipe's world scale assumes an average body, so meters can be off about 10% for an unusual build; step-out is exact regardless, since the floor is measured in the same units.
- 3D in camera play: `S.cam.halfW` (half the floor in meters) places you and him 1:1, `S.cam.z` moves you toward and away from him, and the mat draws a lane: in bounds between your edges, the orange band beyond.
- Train me (Mark, 10/27 to 10/29: "personalisation is the key", "a curated algorithm that progresses the user through consistent use, not a predetermined progression plan", no test day): camera sessions save to localStorage `roomtime.history` (record schema above `RT.PROG` in rt-metrics; rounds carry `work`, `stancePct`, `breakT`, `hold`; partial if quit with a round 5 s in, and it still counts). `RT.state(history, now)` keeps three running estimates, each reading weighted by recency (half-life 21 days), the starting value counting as a few readings, drifting back toward it after a layoff, and "at least" readings (an easy round, no speed fade) counting only when above the estimate: stance capacity (`RT.capacityObs`: the round length you hold at 75% in stance, from every round, bounded to a quarter either way per round; a stance hold says 60% of it), reads (the live staircase: `recordMove(..., stair)` steps each drill call's window, which the call keeps as `w`, so `RT.staircase` carries on from the last call) and explosive tolerance (`RT.explosiveTol`, shots and sprawls until the speed fades to 80% of the first ones). Load (`RT.loadOf`: work minutes by round type plus reps) gives this week's total against your usual week (the weeks before, weighted e^(-days/42), corrected while it fills, never under `usual0`): the acute:chronic ratio. `RT.planNext(history, now, {minutes})` builds today fresh: the day (`RT.DAYS`: first session, technique when it's a second session today, the ratio is over 1.4 or you're back after 5+ days, else volume, pace or live by the quality furthest from `RT.GOAL`, not the same twice running, each type now and then), then work, rest and cap from your estimates, the day and how fresh you are, rounds that fill the minutes exactly (`RT.buildRounds`, each round with its own `work` and the `rest` before it), a stance-hold round about every 4 weeks, and no plan over 1.5 times your usual (longer rests first, else a technique day). In the game, `RT.adaptRound` re-tunes the rounds still to come after every round (work up to 10% more or 15% less, the rest taking up the difference so the end time holds; a technique day only shortens), and shots and sprawls that lose their speed end the explosive work for the day. Free play sessions save too and their calls count. `test/helpers/season.mjs` simulates a player through the real planner; the season tests check growth, a flat player holding, day variety, length and load. `progPace` scales the live opponent by the windows. `RT.levelOf` names a level (Novice to D1 All-American, thresholds are estimates) from 2 of the last 5 sessions. The menu (Train me first; Pace, Preview and the touch session only in Free play) shows today's day, rounds, why, your numbers, the level, records and history, with Back up, Restore (`RT.backupOf`, `RT.restoreFrom`) and CSV. The app asks for persistent storage. Saved data lives in the browser's storage for the site, so updates never touch it; a Home Screen icon and a Safari tab keep separate stores.
- The warm-up calibration on the game screen (`drawCalib`, from `S.calibView` that rt-lab-tools keeps): a step row that ticks green as each part saves, a ring through each 3 s hold, and during the shuffle a floor bar with you on it, each edge as it sets, and the bar's end flashing at the edge of the picture.
- 3D diagnosis: a classic script after the import map catches the first script error or failed script load (`RoomTime3DErr`); `check3d` shows it on the menu at 8 s, or at 25 s tries `import('three')` itself for the browser's reason.
- Calibration in camera play: the full one (three holds with up to 8 s of coaching each and a stand-up break after each stance, then the shuffle) when none is recent; within 14 days of the last full one (`cal.fullAt`) from the same camera and picture size, a quick check: standing, then the shuffle.
- Calibration lives in localStorage `roomtime.cal` (Camera check calibrates the same way: three holds, then the directed shuffle, up to 10 s a side, beeping at the edge of the picture); the level scale puts the calibrated square stance at 0.45 inside the prototype's band (0.32 to 0.58).

## Landmarks (MediaPipe Pose, 33 points)

```
0 nose        11 L shoulder  12 R shoulder  23 L hip    24 R hip
1-3 L eye     13 L elbow     14 R elbow     25 L knee   26 R knee
4-6 R eye     15 L wrist     16 R wrist     27 L ankle  28 R ankle
7 L ear       17,19,21 L hand (pinky, index, thumb)       29 L heel   30 R heel
8 R ear       18,20,22 R hand                             31 L foot index  32 R foot index
9,10 mouth
```

L and R are the player's own left and right.

## Coordinates

- `landmarks`: x, y normalized to the raw (unmirrored) video frame, 0 to 1, image y grows down; z is relative depth, about the hip scale, smaller is nearer. `visibility` 0 to 1.
- `worldLandmarks`: meters, origin at the hip midpoint, y down. Use for lengths and angles that must not depend on distance.
- Before any angle or distance from normalized coordinates, scale x by `videoWidth / videoHeight` (the frame is 4:3 or 16:9, not square).
- Body units: S = calibrated shoulder width, T = calibrated torso length (shoulder midpoint to hip midpoint). Ratios are against the player's calibration.
- +x = player's right, read from the shoulders at calibration (body-arcade's rule), so mirroring never flips it. +y = up.

## Commands

- Tests: `node --test test/*.test.mjs` (Node 20+, no dependencies).
- Regenerate the synthetic fixture: `node test/helpers/make-synthetic-fixture.mjs`.
- Headless browser check (Chromium, fake camera, about three minutes; it opens Camera check through `#check`): `MP_DIR=<dir> sh test/browser/fetch-mediapipe.sh` once, then `MP_DIR=<dir> node test/browser/check.mjs`. It serves MediaPipe and three.js from `MP_DIR` (jsdelivr is blocked in the cloud container) and swaps the model for the synthetic figure to drive calibration and camera play.
- `?fast` in the URL shortens the bench and the soak.
- Serve locally: `npx http-server -p 8080` and open `http://localhost:8080` (localhost counts as secure for the camera).
- iPad on the LAN needs https: `mkcert -install && mkcert <lan-ip>`, then `npx http-server -S -C <lan-ip>.pem -K <lan-ip>-key.pem -p 8443`, or just push to a branch and test on GitHub Pages.

## Pitfalls

- Left and right flip under the mirrored front camera. Process the raw frame, mirror only the display (CSS `scaleX(-1)` on the wrapper holding the video and skeleton canvas; text, the level meter and the floor strip sit outside it), and take the player's right from the shoulders. Spoken hints never say left or right.
- Aspect ratio: normalized x and y have different scales; correct before computing angles.
- Timestamps passed to `detectForVideo` must strictly increase (use `max(now, last + 1)`; video files restart at 0 on a loop).
- iOS audio and speech only unlock after a tap: create and resume the AudioContext and speak once inside the start tap.
- Inference can block the main thread: measure it per frame; move it to a worker if it costs frames.
- Request a screen wake lock while tracking, and request it again on `visibilitychange`.
- iPad Center Stage pans and zooms the front camera: turn it off in Control Center before calibrating.
