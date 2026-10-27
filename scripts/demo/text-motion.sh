#!/usr/bin/env bash
# Text that moves: kinetic captions with the new entrances (tilt, typewriter, scramble, letters)
# and five add_kinetic_title_tool title cards, rendered with contact sheets.
#
#   scripts/demo/text-motion.sh [out-dir] [talking-head.mp4]
#
# Without a clip the footage is generated (testsrc2, 16:9, 7 s). With a clip of a person talking
# (your own footage), the script first makes its subject matte (generate_subject_matte_tool, needs
# onnxruntime-node; the model downloads on first use), so the captions keep off the head and the
# emphasis words go behind it where there is headroom.
#
# Writes captions_<animation>.mp4, titles.mp4 and a _sheet.png next to each into out-dir. Needs ffmpeg.
set -euo pipefail

OUT="${1:-/tmp/zenvi-text-motion}"
CLIP="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/zenvi-text-motion-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

if [ -n "$CLIP" ]; then
  ffmpeg -hide_banner -loglevel error -y -t 7 -i "$CLIP" -an -vf scale=1920:-2 -c:v libx264 -preset veryfast -pix_fmt yuv420p "$WORK/head.mp4"
else
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=1920x1080:rate=30" -t 7 -c:v libx264 -preset veryfast -pix_fmt yuv420p "$WORK/head.mp4"
fi

CUES='[{"text":"I have over","start":0.1,"end":0.9},{"text":"ten","start":0.9,"end":1.5},{"text":"terabytes of","start":1.5,"end":2.3},{"text":"footage","start":2.3,"end":3.1},{"text":"sitting on my","start":3.3,"end":4.2},{"text":"desk","start":4.2,"end":5.0},{"text":"every single day","start":5.1,"end":6.6}]'

cd "$ROOT"
zen() { npx --no-install tsx packages/cli/src/bin.ts "$@"; }
sheet() { ffmpeg -hide_banner -loglevel error -y -t 7 -i "$1" -vf "fps=4,scale=320:-1,tile=4x7" -frames:v 1 "${1%.mp4}_sheet.png"; }

# One base project (the footage, its matte), copied per run with its assets folder.
base="$WORK/base.zvn"
zen new --profile "HD 1080p 30 fps" -f "$base" > /dev/null
clip=$(zen -p "$base" add "$WORK/head.mp4" --json | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["clips"][0]["id"])')
[ -n "$CLIP" ] && zen -p "$base" call generate_subject_matte_tool "clip_id=$clip"
copy() { cp "$base" "$WORK/$1.zvn"; mkdir -p "$WORK/${1}_assets"; [ -d "$WORK/base_assets" ] && cp -R "$WORK/base_assets/." "$WORK/${1}_assets/"; echo "$WORK/$1.zvn"; }

for anim in tilt typewriter scramble letters; do
  project=$(copy "$anim")
  args=$(python3 -I -c 'import json,sys; print(json.dumps({"timeline_clip_ids": [sys.argv[1]], "style": "creator", "animation": sys.argv[2], "text_size": 0.05, "emphasis": ["ten", "footage", "desk"], "cues": json.loads(sys.argv[3])}))' "$clip" "$anim" "$CUES")
  zen -p "$project" call kinetic_captions_tool --args "$args"
  zen -p "$project" render "$OUT/captions_$anim.mp4" > /dev/null
  sheet "$OUT/captions_$anim.mp4"
done

project=$(copy titles)
at=0
for spec in 'NO LIGHTS NO BRAKES|stack|slam' 'Living symmetry|editorial|letters' 'Rho saves 491GB|creator|scramble' 'build. ship. repeat.|documentary|typewriter' 'The idea first|creator|tilt'; do
  IFS='|' read -r text style anim <<< "$spec"
  args=$(python3 -I -c 'import json,sys; print(json.dumps({"text": sys.argv[1], "style": sys.argv[2], "animation": sys.argv[3], "position_seconds": float(sys.argv[4]), "duration_seconds": 1.4}))' "$text" "$style" "$anim" "$at")
  zen -p "$project" call add_kinetic_title_tool --args "$args"
  at=$(python3 -I -c "print(round($at + 1.4, 2))")
done
zen -p "$project" render "$OUT/titles.mp4" > /dev/null
sheet "$OUT/titles.mp4"
echo "wrote $OUT/captions_{tilt,typewriter,scramble,letters}.mp4, $OUT/titles.mp4 and their _sheet.png"
