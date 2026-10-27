#!/usr/bin/env bash
# A repeated shot and its fix: a 9 s cut A B A C (shot A back at 4 s from the same moment) with a
# fourth clip D unused in the bin. review_render_tool lists the swap_shot_tool call for the repeat,
# the script makes that call, renders again and reviews again.
#
#   scripts/demo/director-defaults/swap.sh [out-dir]
#
# Writes swap_before.mp4, swap_after.mp4, both reviews' contact sheets (swap_<before|after>_sheet.*)
# and their text (swap_review_<before|after>.txt) into out-dir. Needs ffmpeg.
set -euo pipefail

OUT="${1:-/tmp/zenvi-director-swap}"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/zenvi-swap-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

# Four clips that cannot be mistaken for each other: ffmpeg's own test sources, each with a tone.
i=0
for src in "testsrc2=size=1280x720:rate=30" "smptebars=size=1280x720:rate=30" "rgbtestsrc=size=1280x720:rate=30" "life=size=1280x720:rate=30:mold=10:ratio=0.1:death_color=#202060:life_color=#f0c040"; do
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "$src" -f lavfi -i "sine=frequency=$((330 + i * 110)):duration=6" \
    -t 6 -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac "$WORK/shot$i.mp4"
  i=$((i + 1))
done

cd "$ROOT"
project="$WORK/swap.zvn"
z=(npx --no-install tsx packages/cli/src/bin.ts -p "$project")
npx --no-install tsx packages/cli/src/bin.ts new --profile "HD 720p 30 fps" -f "$project" > /dev/null
"${z[@]}" import "$WORK/shot0.mp4" "$WORK/shot1.mp4" "$WORK/shot2.mp4" "$WORK/shot3.mp4" > /dev/null
file_id() { "${z[@]}" files --json | python3 -I -c 'import json,re,sys; t=json.load(sys.stdin)["summary"]; print(re.search(r"media_bin_file_id=(\S+) name=.?" + sys.argv[1] + r"\.mp4", t).group(1))' "$1"; }
A=$(file_id shot0); B=$(file_id shot1); C=$(file_id shot2)
# A from 1-3 s at 0 s, B, A again from the same 1-3 s at 4 s, C; shot3 stays in the bin.
# add_clip_to_timeline_tool takes start/end as the window to place and its watch may move the
# in-point inside it, so trim_clip_tool pins the exact source in/out: the repeat is the same moment.
for cut in "$A 0 1 3" "$B 2 0 2" "$A 4 1 3" "$C 6 0 3"; do
  read -r file at src_in src_out <<< "$cut"
  clip=$("${z[@]}" call add_clip_to_timeline_tool --json --args "{\"file_id\":\"$file\",\"position_seconds\":$at,\"start_seconds\":$src_in,\"end_seconds\":$src_out}" | python3 -I -c 'import json,sys; print(json.load(sys.stdin)["clips"][0]["id"])')
  "${z[@]}" call trim_clip_tool --args "{\"clip_id\":\"$clip\",\"start_seconds\":$src_in,\"end_seconds\":$src_out}" > /dev/null
done
"${z[@]}" clips

review() {
  "${z[@]}" render "$WORK/$1.mp4" > /dev/null
  "${z[@]}" call review_render_tool --images "$WORK/$1_review" --args "{\"path\":\"$WORK/$1.mp4\"}" --json > "$WORK/$1.json"
  python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1]))["summary"])' "$WORK/$1.json" | tee "$OUT/swap_review_$1.txt"
  cp "$WORK/$1.mp4" "$OUT/swap_$1.mp4"
  sheet=$(ls "$WORK/$1_review"/* | head -1)
  cp "$sheet" "$OUT/swap_$1_sheet.${sheet##*.}"
}
review before
swap=$(python3 -I -c 'import json,sys; s=json.load(open(sys.argv[1]))["data"]["swaps"][0]; print(json.dumps({"clip_id":s["clip_id"],"file_id":s["to_file_id"],"start_seconds":s["start_seconds"]}))' "$WORK/before.json")
echo "applying: swap_shot_tool $swap"
"${z[@]}" call swap_shot_tool --args "$swap"
review after
echo "wrote $OUT/swap_{before,after}.mp4, swap_*_sheet.*, swap_review_*.txt"
