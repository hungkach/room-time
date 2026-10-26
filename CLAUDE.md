# Room Time: notes for Claude

A wrestling training simulator, neutral position only, played with body tracking on an iPad camera. `index.html` is the working touch prototype and the source of truth for game design: read it fully before changing anything. Live at https://hungkach.github.io/room-time (GitHub Pages, main, root).

Player: Mark, former wrestler, USAW certified, S&C coach. Trains in half a small garage with no mats, so nothing ever puts a knee on the floor.

## Stack (do not change without asking)

- One self-contained `index.html`: plain canvas for the 2D overlay, no framework, no build step.
- three.js `0.186.1` from jsdelivr through an import map (Mark approved it for the 3D view on 10/26). The 3D view is optional: if three.js or WebGL is missing, the 2D prototype view draws instead.
- MediaPipe Pose Landmarker from `@mediapipe/tasks-vision@1.1.1` (jsdelivr), not the legacy `@mediapipe/pose`. Default model `pose_landmarker_full` (float16/1), GPU delegate with CPU fallback. Lite and heavy only for comparison.
- iPad front ultra-wide camera, landscape, mounted at hip height facing the player. An optional side device comes later.
- Shared engine patterns come from `hungkach/body-arcade` (`engine/`). Copying code is fine; note the source commit next to it. Never edit body-arcade from here.

## Design rules

- The touch demo mode keeps working at all times. Camera mode is added alongside it, never in place of it.
- Audio first and glanceable. Spoken lines are information or short external cues ("Stay under the bar", "Feet moving"), never cheerleading. At most one correction about every 10 seconds.
- Everything is scored against the player's own calibration (standing, square stance, staggered stance, left and right walls), on a gradient, so fatigued reps still count.
- Calibration is part of the warm-up (Mark, 10/26): three held poses, then the athlete shuffles left and right to the edges of the picture (or their walls); never walking to each wall and holding. No height or other typed measurements.
- Movement is 1:1 in meters (Mark, 10/26): what you see in 3D moves as far as you really move.
- Session structure, live go opponent, small-space edge logic and debrief follow the prototype.
- Small, reviewable commits. Plan mode for each feature; wait for Mark's approval before implementing.

## Code layout

- Metric and classifier functions are pure functions over landmark arrays, separate from rendering, in one `<script id="rt-metrics">` block in `index.html` that adds to `globalThis.RoomTime`. No DOM, no `</script` inside it. Node tests extract that block and run it in `vm`.
- Landmark traces (JSON) live in `test/fixtures/`. Each classifier gets a test on labeled traces.
- An always-available debug overlay shows FPS, inference time, landmark visibility and live metric values.
- Camera check (menu button, Phase 0): `<script id="rt-lab">` (camera, model, loop, overlay) and `<script id="rt-lab-tools">` (bench, soak, calibration, live readouts, recording, video files). They share `globalThis.RoomTimeLab`; each frame goes to the `L.on` listeners as `{t, vt, lm, wl, aspect, w, h, inf, m, fc, r}`.
- Traces (recorded, from a video file, or fixtures): `{format: 'room-time-trace', version: 1, meta: {aspect, w, h, cal, src, model, ...}, frames: [{t, lm, wl}], labels: [{from, to, label}]}`, landmarks packed as `[x, y, z, visibility]`. Labels are `tall`, `stance` or `deep` for now.
- 3D view: `<script type="module" id="rt-3d">` renders the room, the opponent and your arms on `#cv3d` under the 2D canvas `#cv`, reading the game through `globalThis.RoomTimeGame` (read only); `RoomTime3D.ok` tells the 2D `draw()` to skip its own room and wrestler. The opponent is built in code: soft shapes summed into one surface with marching cubes, skinned to a skeleton (the head on a finer grid on the head bone), the singlet and shoes painted by smooth scores in a shader. Poses: legs and upper arms are absolute angles from hanging straight down. `RoomTime3D.debug.cam` can override the camera for close-ups.
- Camera play (menu button): `startSession(false, true)` opens in mode `calib` (the three holds and the shuffle, on the game screen), then `RoomTimeGame.begin()` starts the warm-in. Skip during the holds keeps the saved calibration. The tracker in `rt-lab-tools` writes `S.cam` {level, floorX, halfW, z, head {eye, dx}, seen} each frame (One Euro smoothed) and sends `RT.MoveDetector` moves through `RoomTimeGame.camMove`. The camera preview docks into `#pip`. His press is an offset on your floor (`S.camOff`); a reset waits for you to walk back to the middle. - Moves (`RT.MoveDetector`, `RT.MOVES`): shot is a fast drop (0.2 level in 650 ms) while hip width on screen grows 7%; sprawl is a drop to level 0.24 or lower with the hips not coming in; snap is the hands from tie height (0.6 torso lengths above the hips) to the belt (0.25) in 500 ms with the level held. Camera check's Live card names each move as it reads it.
- Meters (`RT.measure`): `k`, meters per picture height at the hips, is the shoulders' and hips' side-to-side span in world landmarks over the same span in the picture (turning cancels out), with the shoulders scaled back to hip depth for a forward lean. From it: `Xcam` (sideways), `D` (distance; the only number that uses the assumed lens angle, `RT.CAMERA.vfovDeg` 94 for the iPad front ultra-wide in 4:3) and `eye`. Readouts add `X` (+ toward the player's right), `z` (back from the square stance spot), `floorX` from `cal.floor` {left, right, width, center} in meters (`RT.floorFrom`: 2nd to 98th percentile of the shuffle; `RT.FloorTracker` widens it during the warm-in, never narrows). MediaPipe's world scale assumes an average body, so meters can be off about 10% for an unusual build; step-out is exact regardless, since the floor is measured in the same units.
- 3D in camera play: `S.cam.halfW` (half the floor in meters) places you and him 1:1, `S.cam.z` moves you toward and away from him, and the mat draws a lane: in bounds between your edges, the orange band beyond.
- Calibration lives in localStorage `roomtime.cal` (Camera check calibrates the same way: three holds, then a 12 s shuffle to the edges of the picture, beeping at the edge); the level scale puts the calibrated square stance at 0.45 inside the prototype's band (0.32 to 0.58).

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
- Headless browser check (Chromium, fake camera, about two minutes): `MP_DIR=<dir> sh test/browser/fetch-mediapipe.sh` once, then `MP_DIR=<dir> node test/browser/check.mjs`. It serves MediaPipe and three.js from `MP_DIR` (jsdelivr is blocked in the cloud container) and swaps the model for the synthetic figure to drive calibration and recording.
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
