#!/usr/bin/env bash
# Multiplicity demo: one shot repeated into a field and folded into kaleidoscopes (the grid
# template's repeat and kaleidoscope layouts), four sections on a 120 BPM click, on one timeline.
#
#   scripts/demo/multiplicity.sh [out-dir] [profile] [clip1 clip2 clip3]
#
# Sections (4 s each): repeat 9 copies out of phase, arriving one per beat, the field pulling
# out; a 4-segment kaleidoscope pushing in; a kaleidoscope re-cut 2 -> 4 -> 8 on the beat; a
# mirrored repeat 4 -> 16 panning left. Optional GRADE="lut=dark_&_moody/teal_horror lut_intensity=0.8"
# grades every clip with color_grade_clip_tool after. Clips default to ffmpeg test sources
# (mandelbrot, testsrc2, life). Writes multiplicity.mp4 and multiplicity_sheet.png into
# out-dir. Needs ffmpeg.
set -euo pipefail

OUT="${1:-/tmp/zenvi-multiplicity}"
PROFILE="${2:-HD Vertical 720p 30 fps}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/zenvi-multiplicity-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

clips=("${@:3}")
if [ "${#clips[@]}" -eq 0 ]; then
  i=0
  for src in "mandelbrot=size=720x1280:rate=30" "testsrc2=size=720x1280:rate=30" "life=size=180x320:rate=30:mold=10:ratio=0.1:death_color=#0B3B3B:life_color=#7FE0C8,scale=720:1280:flags=neighbor"; do
    i=$((i + 1))
    ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$src" -t 10 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -an "$WORK/clip$i.mp4"
    clips+=("$WORK/clip$i.mp4")
  done
fi
[ "${#clips[@]}" -ge 3 ] || { echo "give three clips (or none)" >&2; exit 2; }
ffmpeg -hide_banner -loglevel error -y -f lavfi \
  -i "aevalsrc='(0.5+0.4*lt(mod(t,2),0.02))*sin(2*PI*(1000+400*lt(mod(t,2),0.02))*t)*exp(-90*mod(t,0.5))':s=48000:d=17" \
  -c:a pcm_s16le "$WORK/click.wav"

cd "$ROOT"
project="$WORK/multiplicity.zvn"
z=(npx --no-install tsx packages/cli/src/bin.ts -p "$project")
"${z[@]}" new "$project" --profile "$PROFILE" -f >/dev/null
"${z[@]}" import "${clips[@]:0:3}" "$WORK/click.wav" >/dev/null
"${z[@]}" add "$WORK/click.wav" --at 0 -t 1 >/dev/null
ids="$("${z[@]}" files --json | python3 -c '
import json, os, re, sys
found = {name: i for i, name in re.findall(r"media_bin_file_id=(\w+) name=.([^\x27]+).", json.load(sys.stdin)["summary"])}
print(" ".join(found[os.path.basename(path)] for path in sys.argv[1:]))' "${clips[@]:0:3}")"
read -r A B C <<<"$ids"

section() { # position, file id, tool arguments...
  local at="$1" file="$2"
  shift 2
  "${z[@]}" call add_motion_template_tool template=grid file_ids="[\"$file\"]" bpm=120 position_seconds="$at" duration_seconds=4 "$@" --json >"$WORK/s$at.json" || true
  python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print(sys.argv[2], "->", r["summary"])' "$WORK/s$at.json" "at $at s"
}
section 0 "$A" layout=repeat tiles=9 phase=0.15 drift=out
section 4 "$B" layout=kaleidoscope tiles=4 drift=in
section 8 "$C" layout=kaleidoscope steps='[2,4,8]'
section 12 "$A" layout=repeat steps='[4,16]' mirror=true drift=left
if [ -n "${GRADE:-}" ]; then
  # shellcheck disable=SC2086
  "${z[@]}" call color_grade_clip_tool scope=all $GRADE --json | python3 -c 'import json,sys; print("grade ->", json.load(sys.stdin)["summary"])'
fi
"${z[@]}" render "$OUT/multiplicity.mp4" --end 16 >/dev/null
ffmpeg -hide_banner -loglevel error -y -i "$OUT/multiplicity.mp4" -vf "fps=2,scale=144:-1,tile=8x4" -frames:v 1 "$OUT/multiplicity_sheet.png"
echo "wrote $OUT/multiplicity.mp4 and multiplicity_sheet.png"
