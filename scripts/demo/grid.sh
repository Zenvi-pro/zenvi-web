#!/usr/bin/env bash
# Grid montage demo: six generated clips fill grid / strip / film strip / mosaic montages, one tile
# per beat of a 120 BPM click track, in 9:16 and 16:9.
#
#   scripts/demo/grid.sh [out-dir]
#
# Writes grid_<case>_<916|169>.mp4 (picture + click) and a contact sheet PNG next to each into out-dir.
# Cases: band_steps (a 16:9 / 21:9 band, layouts 3 -> 4 -> 6, merging to full frame), strips (five
# vertical strips wiping in), film (a film strip, the big frame last, tiles sliding in), mosaic
# (a bento that fades in, then the camera zooms into one tile). Needs ffmpeg.
set -euo pipefail

OUT="${1:-/tmp/zenvi-grid}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/zenvi-grid-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Six clips that cannot be mistaken for each other: ffmpeg's own test sources.
i=0
for src in "testsrc2=size=1280x720:rate=30" "mandelbrot=size=1280x720:rate=30" "gradients=size=1280x720:rate=30:speed=0.02" "rgbtestsrc=size=1280x720:rate=30" "life=size=320x180:rate=30:mold=10:ratio=0.1:death_color=#C83232:life_color=#00ff00,scale=1280:720:flags=neighbor" "smptehdbars=size=1280x720:rate=30"; do
  i=$((i + 1))
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$src" -t 10 -c:v libx264 -preset veryfast -crf 20 -pix_fmt yuv420p -an "$WORK/clip$i.mp4"
done
# A click on every beat of 120 BPM (a higher, louder one on the bar).
ffmpeg -hide_banner -loglevel error -y -f lavfi \
  -i "aevalsrc='(0.5+0.4*lt(mod(t,2),0.02))*sin(2*PI*(1000+400*lt(mod(t,2),0.02))*t)*exp(-90*mod(t,0.5))':s=48000:d=14" \
  -c:a pcm_s16le "$WORK/click.wav"

cd "$ROOT"
run_case() { # name, profile, tag, tool arguments...
  local name="$1" profile="$2" tag="$3"
  shift 3
  local project="$WORK/${name}_${tag}.zvn"
  local z=(npx --no-install tsx packages/cli/src/bin.ts -p "$project")
  "${z[@]}" new "$project" --profile "$profile" -f >/dev/null
  "${z[@]}" import "$WORK"/clip{1,2,3,4,5,6}.mp4 "$WORK/click.wav" >/dev/null
  "${z[@]}" add "$WORK/click.wav" --at 0 -t 1 >/dev/null
  local ids
  ids="$("${z[@]}" files --json | python3 -c '
import json, re, sys
text = json.load(sys.stdin)["summary"]
found = re.findall(r"media_bin_file_id=(\w+) name=.(clip\d)\.mp4", text)
print(json.dumps([i for i, _ in sorted(found, key=lambda f: f[1])]))')"
  "${z[@]}" call add_motion_template_tool template=grid file_ids="$ids" bpm=120 position_seconds=0 "$@" --json >"$WORK/${name}_${tag}.json"
  python3 -c 'import json,sys; r=json.load(open(sys.argv[1])); print(sys.argv[2], "->", r["summary"]); [print("  warning:", w) for w in r["warnings"]]' "$WORK/${name}_${tag}.json" "${name}_${tag}"
  local end
  end="$(python3 -c 'import json,sys; d=json.load(open(sys.argv[1]))["data"]; print(d["position"] + d["duration"])' "$WORK/${name}_${tag}.json")"
  "${z[@]}" render "$OUT/grid_${name}_${tag}.mp4" --end "$end" >/dev/null
  local scale="160:-1" tile="10x3"
  if [ "$tag" = 169 ]; then scale="288:-1"; tile="6x5"; fi
  ffmpeg -hide_banner -loglevel error -y -i "$OUT/grid_${name}_${tag}.mp4" -vf "fps=4,scale=$scale,tile=$tile" -frames:v 1 "$OUT/grid_${name}_${tag}_sheet.png"
}

V="HD Vertical 720p 30 fps"
H="HD 720p 30 fps"
run_case band_steps "$V" 916 steps='[3,4,6]' band=16:9 merge=true gutter=3
run_case band_steps "$H" 169 steps='[3,4,6]' band=21:9 merge=true gutter=3
run_case strips "$V" 916 layout=strips_v tiles=5 reveal=wipe gutter=4
run_case strips "$H" 169 layout=strips_v tiles=5 reveal=wipe gutter=4
run_case film "$V" 916 layout=film_strip tiles=5 reveal=slide
run_case film "$H" 169 layout=film_strip tiles=5 reveal=slide
run_case mosaic "$V" 916 layout=mosaic tiles=6 reveal=fade zoom_into=4 radius=16
run_case mosaic "$H" 169 layout=mosaic tiles=6 reveal=fade zoom_into=4 radius=16
echo "wrote grid_*.mp4 and grid_*_sheet.png to $OUT"
