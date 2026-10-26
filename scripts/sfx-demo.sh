#!/usr/bin/env bash
# Sound-design demo: eight generated test clips and a generated beat are cut
# into a reel (build_reel_tool), sound-designed (auto_sound_design_tool) and
# rendered, all with the zenvi CLI. Every input is made here with ffmpeg
# (testsrc2, solid colours, sine/noise expressions): no third-party media.
#
#   scripts/sfx-demo.sh <out-dir> [intensity]     # intensity: subtle | normal (default) | hype
#
# Writes <out-dir>/demo.mp4 (with sound design), <out-dir>/demo-dry.mp4 (the
# same reel without it), <out-dir>/sound-design.json (the receipt) and the
# project <out-dir>/demo.zvn.
set -euo pipefail

out="${1:?usage: scripts/sfx-demo.sh <out-dir> [subtle|normal|hype]}"
intensity="${2:-normal}"
root="$(cd "$(dirname "$0")/.." && pwd)"
zenvi() { (cd "$out" && npx --prefix "$root" tsx "$root/packages/cli/src/bin.ts" -p demo.zvn "$@"); }

mkdir -p "$out/media"
cd "$out"
rm -f demo.zvn demo.mp4 demo-dry.mp4

# Eight moving test patterns and colour fields, 4 s each.
i=0
for src in \
  "testsrc2=size=1280x720:rate=30" \
  "color=c=0xff3d5a:size=1280x720:rate=30,drawbox=x='mod(t*700,1280)':y=0:w=180:h=720:color=white@0.9:t=fill" \
  "mandelbrot=size=1280x720:rate=30" \
  "color=c=0x1d4ed8:size=1280x720:rate=30,drawbox=x=0:y='mod(t*500,720)':w=1280:h=120:color=0xfacc15:t=fill" \
  "testsrc2=size=1280x720:rate=30,hue=h=t*90,rotate=a=t" \
  "life=size=1280x720:rate=30:mold=10:life_color=0x22c55e:death_color=0x052e16" \
  "color=c=0x111827:size=1280x720:rate=30,drawbox=x='640-t*150':y='360-t*85':w='t*300':h='t*170':color=0xf97316:t=fill" \
  "cellauto=size=1280x720:rate=30:rule=110,negate"; do
  i=$((i + 1))
  ffmpeg -v error -y -f lavfi -i "$src" -t 4 -pix_fmt yuv420p -c:v libx264 -preset veryfast "media/shot$i.mp4"
done

# A 120 BPM beat: a sparse intro, then the drop at 12 s (kick, off-beat hats, bass, a chord pad).
# ffmpeg expressions keep values in registers: 0 = time in the beat, 1 = time in the off-beat, 2 = after the drop.
beat="st(0,mod(t,0.5));st(1,mod(t+0.25,0.5));st(2,gte(t,12));
(0.35+0.65*ld(2))*(0.9*sin(2*PI*(48*ld(0)+3.5*(1-exp(-ld(0)/0.02))))*exp(-ld(0)/0.14)
+ld(2)*((random(0)*2-1)*exp(-ld(1)/0.018)*0.25+0.35*sin(2*PI*55*t)*(1-exp(-ld(0)/0.01))*exp(-ld(0)/0.4)))
+0.06*(sin(2*PI*220*t)+sin(2*PI*277.2*t)+sin(2*PI*329.6*t))"
ffmpeg -v error -y -f lavfi -i "aevalsrc='$(echo "$beat" | tr -d '\n')':s=48000:d=24" -af "volume=-3dB,alimiter=limit=0.9" "media/beat.wav"

zenvi new demo.zvn --profile "HD 720p 30 fps" >/dev/null
zenvi import media/shot1.mp4 media/shot2.mp4 media/shot3.mp4 media/shot4.mp4 media/shot5.mp4 media/shot6.mp4 media/shot7.mp4 media/shot8.mp4 media/beat.wav >/dev/null
zenvi call build_reel_tool style=hype duration_seconds=16 hook="Sound design" end_card="Zenvi" >/dev/null
zenvi render demo-dry.mp4 --quality medium >/dev/null
zenvi --json call auto_sound_design_tool intensity="$intensity" > sound-design.json
zenvi render demo.mp4 --quality medium >/dev/null
echo "wrote $out/demo.mp4 (and demo-dry.mp4 without sound design); cues in $out/sound-design.json"
