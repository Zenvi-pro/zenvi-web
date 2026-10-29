#!/usr/bin/env bash
# The seven add_type_block_tool moves back to back over footage, rendered with a contact sheet:
# a spinning ring of type, a write-on (text, then an SVG swoosh), a stencil that flies through a
# letter into the shot, an echo stack, a type strobe ending on a lockup, a word wheel and paper-cut type.
#
#   scripts/demo/type-blocks.sh [out-dir] [footage.mp4]
#
# Without footage it is generated (ffmpeg gradients + testsrc2, 20 s). Writes type-blocks.mp4,
# type-blocks_sheet.png and one close sheet per block into out-dir. Needs ffmpeg.
set -euo pipefail

OUT="${1:-/tmp/zenvi-type-blocks}"
CLIP="${2:-}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
mkdir -p "$OUT"
OUT="$(cd "$OUT" && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/zenvi-type-blocks-XXXXXX")"
trap 'rm -rf "$WORK"' EXIT

if [ -n "$CLIP" ]; then
  ffmpeg -hide_banner -loglevel error -y -stream_loop -1 -t 20 -i "$CLIP" -an -vf "scale=1920:1080:force_original_aspect_ratio=increase,crop=1920:1080,fps=30" -c:v libx264 -preset veryfast -pix_fmt yuv420p "$WORK/footage.mp4"
else
  ffmpeg -hide_banner -loglevel error -y -f lavfi -i "gradients=size=1920x1080:rate=30:speed=0.02:c0=0x1b1f3a:c1=0x3a1030:c2=0x0d3b3a:nb_colors=3" -f lavfi -i "testsrc2=size=1920x1080:rate=30" \
    -filter_complex "[0:v]trim=0:6.4,setpts=PTS-STARTPTS[a];[1:v]trim=0:2.6,setpts=PTS-STARTPTS[b];[0:v]trim=9:20,setpts=PTS-STARTPTS[c];[a][b][c]concat=n=3:v=1[v]" -map "[v]" -t 20 -c:v libx264 -preset veryfast -pix_fmt yuv420p "$WORK/footage.mp4"
fi

cd "$ROOT"
zen() { npx --no-install tsx packages/cli/src/bin.ts "$@"; }
project="$WORK/type.zvn"
zen new --profile "HD 1080p 30 fps" -f "$project" > /dev/null
zen -p "$project" add "$WORK/footage.mp4" > /dev/null

call() { zen -p "$project" call add_type_block_tool --args "$1"; }
call '{"block": "text_on_path", "text": "SPIN · THE · RECORD · SIDE · A · ", "shape": "ring", "radius": 0.32, "spin": 60, "position_seconds": 0, "duration_seconds": 3}'
call '{"block": "write_on", "text": "written by hand", "position_seconds": 3.2, "duration_seconds": 3, "y": 0.45}'
call '{"block": "write_on", "paths": ["M10 40 C 120 10, 260 70, 380 30 S 560 10, 620 40"], "width": 0.5, "y": 0.66, "stroke_width": 14, "position_seconds": 4.6, "duration_seconds": 1.6, "draw_seconds": 0.6, "ink": "#ff3b1f"}'
call '{"block": "stencil", "text": "BLOOM", "position_seconds": 6.4, "duration_seconds": 2.6}'
call '{"block": "echo_stack", "text": "NO DAYS OFF", "copies": 9, "position_seconds": 9.2, "duration_seconds": 1.8}'
call '{"block": "strobe", "text": "BUILD SHIP LEARN REPEAT FAST LOUD", "lockup": "SHIP IT.", "hold_frames": 4, "position_seconds": 11.2, "duration_seconds": 2.6}'
call '{"block": "wheel", "words": ["APPS", "SITES", "BRANDS", "STORIES"], "hold_frames": 12, "position_seconds": 14}'
call '{"block": "paper", "text": "BUY IT", "position_seconds": 17.4, "duration_seconds": 2.4, "accent": "#ffd23f"}'

zen -p "$project" render "$OUT/type-blocks.mp4" > /dev/null
ffmpeg -hide_banner -loglevel error -y -i "$OUT/type-blocks.mp4" -vf "fps=4,scale=320:-1,tile=8x10" -frames:v 1 "$OUT/type-blocks_sheet.png"
close() { ffmpeg -hide_banner -loglevel error -y -ss "$2" -t "$3" -i "$OUT/type-blocks.mp4" -vf "fps=$4,scale=480:-1,tile=4x3" -frames:v 1 "$OUT/$1_sheet.png"; }
close text_on_path 0 3 4
close write_on 3.2 3 4
close stencil 6.4 2.6 4.6
close echo_stack 9.2 1.8 6.7
close strobe 11.2 2.6 4.6
close wheel 14 3.2 3.8
close paper 17.4 2.4 5
echo "wrote $OUT/type-blocks.mp4, type-blocks_sheet.png and {text_on_path,write_on,stencil,echo_stack,strobe,wheel,paper}_sheet.png"
