#!/bin/sh
# Fetches tasks-vision 1.1.1 and three.js 0.186.1 (from npm) and the three pose models into $MP_DIR for the headless check,
# for machines where jsdelivr is blocked. Usage: MP_DIR=/some/dir sh test/browser/fetch-mediapipe.sh
set -e
: "${MP_DIR:?set MP_DIR}"
mkdir -p "$MP_DIR" && cd "$MP_DIR"
npm pack @mediapipe/tasks-vision@1.1.1 >/dev/null && tar xzf mediapipe-tasks-vision-1.1.1.tgz
mkdir -p three && npm pack three@0.186.1 >/dev/null && tar xzf three-0.186.1.tgz -C three
for n in lite full heavy; do
  curl -sS -o pose_landmarker_$n.task "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_$n/float16/1/pose_landmarker_$n.task"
done
echo "MediaPipe ready in $MP_DIR"
