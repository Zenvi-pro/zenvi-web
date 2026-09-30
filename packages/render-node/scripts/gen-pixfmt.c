/*
 * Dumps FFmpeg pixel format ids, used to regenerate src/probe/pixfmt.gen.ts:
 *   cc -I"$(brew --prefix ffmpeg)/include" gen-pixfmt.c -L"$(brew --prefix ffmpeg)/lib" -lavutil -o /tmp/pixfmt
 *   /tmp/pixfmt   # "<name> <id>" per line; drop hardware surface formats
 */
#include <stdio.h>
#include <libavutil/pixdesc.h>
int main(void) {
  const AVPixFmtDescriptor *d = NULL;
  while ((d = av_pix_fmt_desc_next(d))) {
    printf("%s %d\n", d->name, (int)av_pix_fmt_desc_get_id(d));
  }
  return 0;
}
