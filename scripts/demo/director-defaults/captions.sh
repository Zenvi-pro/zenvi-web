#!/usr/bin/env bash
# Kinetic captions without a voice: a generated 9:16 "talking head" captioned from script cues
# (kinetic_captions_tool cues), once per entrance: pop (creator, text_size 0.06, y 0.62),
# slam (creator, text_size 0.075, y 0.55) and slide_up (stack, its own size and spots).
#
#   scripts/demo/director-defaults/captions.sh [out-dir]
#
# Writes captions_<pop|slam|slide_up>.mp4 and a contact sheet captions_<...>_sheet.png (5 frames
# a second, 6 s) into out-dir. Needs ffmpeg.
set -euo pipefail

OUT="${1:-/tmp/zenvi-director-captions}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/zenvi-captions-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

ffmpeg -hide_banner -loglevel error -y -f lavfi -i "testsrc2=size=1080x1920:rate=30" -f lavfi -i "sine=frequency=220:duration=6" \
  -t 6 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac "$WORK/head.mp4"

CUES='[{"text":"Stop chasing the","start":0.2,"end":1.2},{"text":"deadline","start":1.2,"end":2.0},{"text":"start with one","start":2.3,"end":3.4},{"text":"idea","start":3.4,"end":4.1},{"text":"today","start":4.4,"end":5.4}]'

cd "$ROOT"
for look in "pop|creator|0.06|0.62" "slam|creator|0.075|0.55" "slide_up|stack||"; do
  IFS='|' read -r anim style size y <<< "$look"
  project="$WORK/$anim.zvn"
  z=(npx --no-install tsx packages/cli/src/bin.ts -p "$project")
  npx --no-install tsx packages/cli/src/bin.ts new --profile "FHD Vertical 1080p 30 fps" -f "$project" > /dev/null
  clip=$("${z[@]}" add "$WORK/head.mp4" --json | python3 -I -c 'import json,sys; d=json.load(sys.stdin); print((d.get("data") or {}).get("clip_id") or d["clips"][0]["id"])')
  args=$(python3 -I -c '
import json, sys
clip, style, anim, cues, size, y = sys.argv[1:7]
a = {"timeline_clip_ids": [clip], "style": style, "animation": anim, "cues": json.loads(cues),
     "emphasis": ["deadline", "idea", "today"], "avoid": [{"x": 0.5, "y": 0.3, "w": 0.4, "h": 0.28}]}
if size: a["text_size"] = float(size)
if y: a["y"] = float(y)
print(json.dumps(a))' "$clip" "$style" "$anim" "$CUES" "$size" "$y")
  "${z[@]}" call kinetic_captions_tool --args "$args"
  "${z[@]}" render "$OUT/captions_$anim.mp4" > /dev/null
  ffmpeg -hide_banner -loglevel error -y -i "$OUT/captions_$anim.mp4" -vf "fps=5,scale=216:-1,tile=10x3" -frames:v 1 "$OUT/captions_${anim}_sheet.png"
done
echo "wrote $OUT/captions_{pop,slam,slide_up}.mp4 and their _sheet.png"
