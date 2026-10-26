#!/usr/bin/env bash
# Velocity edit demo: generated footage with a big source-frame counter, a click on
# every beat of a 120 BPM grid, and speed_ramp_tool landing the near-freeze on a beat.
#
#   scripts/demo/velocity.sh [out-dir] [hit_at-seconds]
#
# Writes velocity.mp4 (picture + click track), two contact sheets (whole clip; the second
# either side of the beat) and velocity_receipt.json into out-dir. Needs ffmpeg.
set -euo pipefail

OUT="${1:-/tmp/zenvi-velocity}"
HIT="${2:-4.0}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/zenvi-velocity-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# 12 s, 30 fps. testsrc2 draws its frame counter in the top-left corner; scale that patch up and
# overlay it in the middle so a viewer can read which source frame is on screen.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "testsrc2=size=1280x720:rate=30:duration=12" \
  -f lavfi -i "sine=frequency=220:sample_rate=48000:duration=12" \
  -filter_complex "[0:v]split[a][b];[b]crop=104:40:0:0,scale=832:320:flags=neighbor[c];[a][c]overlay=224:200[v]" \
  -map "[v]" -map 1:a -c:v libx264 -preset veryfast -crf 18 -pix_fmt yuv420p -c:a aac -shortest "$WORK/footage.mp4"

# 120 BPM click track: a 1 kHz tick every 0.5 s.
ffmpeg -hide_banner -loglevel error -y \
  -f lavfi -i "aevalsrc='0.8*sin(2*PI*1000*t)*exp(-90*mod(t,0.5))':s=48000:d=12" \
  -c:a pcm_s16le "$WORK/click.wav"

cd "$ROOT"
Z=(npx --no-install tsx packages/cli/src/bin.ts -p "$WORK/velocity.zvn")
"${Z[@]}" new "$WORK/velocity.zvn" -f >/dev/null
"${Z[@]}" import "$WORK/footage.mp4" "$WORK/click.wav" >/dev/null
"${Z[@]}" add "$WORK/footage.mp4" --at 0 -t 1 >/dev/null
"${Z[@]}" add "$WORK/click.wav" --at 0 -t 2 >/dev/null
CLIP="$("${Z[@]}" clips -t 1 --json | python3 -c 'import json,sys; d=json.load(sys.stdin); c=d.get("clips") or d.get("data",{}).get("clips"); print(c[0]["id"])')"
"${Z[@]}" call speed_ramp_tool clip_id="$CLIP" preset=velocity hit_at="$HIT" --json >"$OUT/velocity_receipt.json"
python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print(r["summary"]); [print("warning:", w) for w in r["warnings"]]' "$OUT/velocity_receipt.json"

END="$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["data"]["end"])' "$OUT/velocity_receipt.json")"
"${Z[@]}" render "$OUT/velocity.mp4" --end "$END" >/dev/null
# The whole clip every 0.25 s (the counter races, then crawls at the beat), and the beat itself
# every 2 frames from 0.5 s before to 0.5 s after (the counter barely moves).
ffmpeg -hide_banner -loglevel error -y -i "$OUT/velocity.mp4" -vf "fps=4,scale=320:-1,tile=6x4" -frames:v 1 "$OUT/velocity_sheet.png"
ffmpeg -hide_banner -loglevel error -y -ss "$(python3 -c "print(max(0, $HIT - 0.5))")" -t 1 -i "$OUT/velocity.mp4" -vf "fps=15,scale=320:-1,tile=5x3" -frames:v 1 "$OUT/velocity_beat_sheet.png"
echo "wrote $OUT/velocity.mp4, velocity_sheet.png, velocity_beat_sheet.png, velocity_receipt.json"
