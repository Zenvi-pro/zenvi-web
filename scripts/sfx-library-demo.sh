#!/usr/bin/env bash
# Sound-kit demo: the reel of scripts/sfx-demo.sh sound-designed three ways
# with the zenvi CLI: procedural (no kit), through a dark procedural kit,
# and through a mixed kit of Openverse sounds (live: needs the network;
# anonymous Openverse allows 20 requests a minute, 200 a day). The library
# sounds are openly licensed and downloaded at run time; their credits go
# to credits.txt.
#
#   scripts/sfx-library-demo.sh <out-dir>
#
# Writes <out-dir>/demo.mp4 (procedural), demo-kit.mp4 (dark kit),
# demo-library.mp4 (mixed kit), a WAV of each mix, the receipts (*.json)
# and credits.txt.
set -euo pipefail

out="${1:?usage: scripts/sfx-library-demo.sh <out-dir>}"
root="$(cd "$(dirname "$0")/.." && pwd)"
zenvi() { (cd "$out" && npx --prefix "$root" tsx "$root/packages/cli/src/bin.ts" -p demo.zvn "$@"); }

"$root/scripts/sfx-demo.sh" "$out" hype
cd "$out"
ffmpeg -v error -y -i demo.mp4 -vn -c:a pcm_s16le demo.wav

zenvi --json call search_sfx_tool query=whoosh provider=openverse count=5 > search-whoosh.json

zenvi --json call create_sound_kit_tool name=Dark tone=dark seed=3 > kit-dark.json
zenvi --json call auto_sound_design_tool intensity=hype > sound-design-kit.json
zenvi render demo-kit.mp4 --quality medium >/dev/null
ffmpeg -v error -y -i demo-kit.mp4 -vn -c:a pcm_s16le demo-kit.wav

zenvi --json call create_sound_kit_tool name=Library source=mixed style=cinematic > kit-library.json
zenvi --json call auto_sound_design_tool intensity=hype > sound-design-library.json
zenvi render demo-library.mp4 --quality medium >/dev/null
ffmpeg -v error -y -i demo-library.mp4 -vn -c:a pcm_s16le demo-library.wav

zenvi call list_credits_tool > credits.txt
echo "wrote $out/demo{,-kit,-library}.{mp4,wav}; kits in kit-*.json, credits in credits.txt"
