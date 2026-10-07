// Qt 5.15 oracle for the TS ports in packages/engine/src/render/qt.
// Images are raw RGBA8888_Premultiplied files.
#include <QtGui/QImage>
#include <QtGui/QPainter>
#include <QtGui/QPainterPath>
#include <QtGui/QTransform>
#include <cstdio>
#include <cstdlib>
#include <cmath>
#include <string>
static QImage load(const char* path, int w, int h) {
  QImage img(w, h, QImage::Format_RGBA8888_Premultiplied);
  FILE* f = fopen(path, "rb"); if (!f) { perror(path); exit(2); }
  for (int y = 0; y < h; ++y) if (fread(img.scanLine(y), 1, w * 4, f) != (size_t)(w * 4)) { fprintf(stderr, "short read\n"); exit(2); }
  fclose(f); return img;
}
static void save(const QImage& in, const char* path) {
  QImage img = in.format() == QImage::Format_RGBA8888_Premultiplied ? in : in.convertToFormat(QImage::Format_RGBA8888_Premultiplied);
  FILE* f = fopen(path, "wb");
  for (int y = 0; y < img.height(); ++y) fwrite(img.constScanLine(y), 1, img.width() * 4, f);
  fclose(f);
  printf("%d %d\n", img.width(), img.height());
}
static bool isNear(double a, double b) { return fabs(a - b) < 0.000001; }
int main(int argc, char** argv) {
  std::string cmd = argv[1];
  if (cmd == "smooth") { // in w h ow oh out
    QImage img = load(argv[2], atoi(argv[3]), atoi(argv[4]));
    save(img.scaled(atoi(argv[5]), atoi(argv[6]), Qt::IgnoreAspectRatio, Qt::SmoothTransformation), argv[7]);
  } else if (cmd == "fast") { // in w h ow oh out
    QImage img = load(argv[2], atoi(argv[3]), atoi(argv[4]));
    save(img.scaled(atoi(argv[5]), atoi(argv[6]), Qt::IgnoreAspectRatio, Qt::FastTransformation), argv[7]);
  } else if (cmd == "towidth") { // in w h tw out  (scaledToWidth smooth)
    QImage img = load(argv[2], atoi(argv[3]), atoi(argv[4]));
    save(img.scaledToWidth(atoi(argv[5]), Qt::SmoothTransformation), argv[6]);
  } else if (cmd == "rectblit") { // canvas cw ch img w h tx ty tw th sx sy sw sh out
    QImage canvas = load(argv[2], atoi(argv[3]), atoi(argv[4]));
    QImage img = load(argv[5], atoi(argv[6]), atoi(argv[7]));
    QPainter p(&canvas);
    p.drawImage(QRectF(atof(argv[8]), atof(argv[9]), atof(argv[10]), atof(argv[11])), img,
                QRectF(atof(argv[12]), atof(argv[13]), atof(argv[14]), atof(argv[15])));
    p.end(); save(canvas, argv[16]);
  } else if (cmd == "clip") { // in w h cw ch x y r shx shy ox oy Sw Sh opacity mode corner out
    // Clip::apply_keyframes + get_transform's QTransform construction (Clip.cpp:1384-1469, 1718-1738).
    QImage img = load(argv[2], atoi(argv[3]), atoi(argv[4]));
    int cw = atoi(argv[5]), ch = atoi(argv[6]);
    float x = atof(argv[7]), y = atof(argv[8]), r = atof(argv[9]), shx = atof(argv[10]), shy = atof(argv[11]);
    float ox = atof(argv[12]), oy = atof(argv[13]), Sw = atof(argv[14]), Sh = atof(argv[15]);
    float alpha = atof(argv[16]); int mode = atoi(argv[17]); double corner = atof(argv[18]);
    QImage canvas(cw, ch, QImage::Format_RGBA8888_Premultiplied); canvas.fill(QColor(Qt::transparent));
    QTransform t;
    if (!isNear(x, 0) || !isNear(y, 0)) t.translate(x, y);
    if (!isNear(r, 0) || !isNear(shx, 0) || !isNear(shy, 0)) { t.translate(ox, oy); t.rotate(r); t.shear(shx, shy); t.translate(-ox, -oy); }
    if (!isNear(Sw, 1.0) || !isNear(Sh, 1.0)) t.scale(Sw, Sh);
    QPainter p(&canvas);
    p.setRenderHint(QPainter::TextAntialiasing, true);
    if (!t.isIdentity()) p.setRenderHint(QPainter::SmoothPixmapTransform, true);
    p.setTransform(t);
    p.setCompositionMode((QPainter::CompositionMode)mode);
    double cr = std::max(0.0, std::min(0.5, corner));
    if (cr > 0.0) {
      p.setRenderHint(QPainter::Antialiasing, true);
      double rp = cr * std::min(img.width(), img.height());
      QPainterPath path; path.addRoundedRect(QRectF(0, 0, img.width(), img.height()), rp, rp);
      p.setClipPath(path);
    }
    if (alpha != 1.0f) { p.setOpacity(alpha); p.drawImage(0, 0, img); p.setOpacity(1.0); } else p.drawImage(0, 0, img);
    p.end(); save(canvas, argv[19]);
  } else if (cmd == "compose") { // dst w h src mode out  (apply_background)
    int w = atoi(argv[3]), h = atoi(argv[4]);
    QImage dst = load(argv[2], w, h); QImage src = load(argv[5], w, h);
    QPainter p(&dst); p.setCompositionMode((QPainter::CompositionMode)atoi(argv[6])); p.drawImage(0, 0, src); p.end();
    save(dst, argv[7]);
  } else if (cmd == "rrfill") { // cw ch x y w h r out : AA rounded rect coverage in alpha
    int cw = atoi(argv[2]), ch = atoi(argv[3]);
    QImage canvas(cw, ch, QImage::Format_RGBA8888_Premultiplied); canvas.fill(Qt::transparent);
    QPainter p(&canvas); p.setRenderHint(QPainter::Antialiasing, true);
    QPainterPath path; double r = atof(argv[8]);
    path.addRoundedRect(QRectF(atof(argv[4]), atof(argv[5]), atof(argv[6]), atof(argv[7])), r, r);
    p.fillPath(path, QColor(255, 255, 255, 255)); p.end(); save(canvas, argv[9]);
  } else if (cmd == "polyfill") { // cw ch aa n x0 y0 ... out
    int cw = atoi(argv[2]), ch = atoi(argv[3]); int aa = atoi(argv[4]); int n = atoi(argv[5]);
    QImage canvas(cw, ch, QImage::Format_RGBA8888_Premultiplied); canvas.fill(Qt::transparent);
    QPainter p(&canvas); p.setRenderHint(QPainter::Antialiasing, aa != 0);
    QPainterPath path; path.moveTo(atof(argv[6]), atof(argv[7]));
    for (int i = 1; i < n; ++i) path.lineTo(atof(argv[6 + 2 * i]), atof(argv[7 + 2 * i]));
    path.closeSubpath();
    p.fillPath(path, QColor(255, 255, 255, 255)); p.end(); save(canvas, argv[6 + 2 * n]);
  } else { fprintf(stderr, "unknown\n"); return 1; }
  return 0;
}
