"""Zenvi 3D worker: runs inside Blender (`blender -b --factory-startup -P
worker.py -- [--job job.json]`). With --job it renders that job and exits;
otherwise it reads one JSON command per line on stdin and keeps running, so
shaders compiled for one job are reused by the next (drafts in about a
second instead of four).

Commands: {"cmd": "render", "job": {...}} and {"cmd": "quit"}. Events go to
stdout as `@@zenvi3d {json}` lines: ready, frame, done, error."""

import importlib
import json
import os
import sys
import time
import traceback

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.dont_write_bytecode = True  # the scripts may sit in a read-only or bundled folder

import bpy  # noqa: E402

PREFIX = "@@zenvi3d "


def emit(**event):
    sys.stdout.write(PREFIX + json.dumps(event) + "\n")
    sys.stdout.flush()


def fresh_modules(scene):
    """Import the library and the scene anew, so a long-lived worker renders
    the scripts as they are on disk now."""
    for name in [n for n in sys.modules if n == "zenvi3d" or n.startswith(("zenvi3d.", "scenes"))]:
        del sys.modules[name]
    importlib.invalidate_caches()
    core = importlib.import_module("zenvi3d.core")
    return core, importlib.import_module("scenes." + scene)


def render(job):
    started = time.time()
    if not job["scene"].replace("_", "").isalnum():
        raise ValueError("bad scene id %r" % job["scene"])
    core, module = fresh_modules(job["scene"])
    os.makedirs(job["output_dir"], exist_ok=True)
    scene = core.setup(job)
    module.build(job)
    backdrop = core.write_backdrop(job)
    built = time.time()
    frames = job["frames"]

    def written(sc, *_):
        emit(event="frame", id=job["id"], frame=sc.frame_current, frames=frames)

    bpy.app.handlers.render_write.append(written)
    try:
        if job.get("stills"):
            # Selected frames only (contact sheets, a quick look): same file names as the animation.
            base = scene.render.filepath
            for f in job["stills"]:
                scene.frame_set(int(f))
                scene.render.filepath = "%s%04d" % (base, int(f))
                bpy.ops.render.render(write_still=True)
            scene.render.filepath = base
        else:
            bpy.ops.render.render(animation=True)
    finally:
        bpy.app.handlers.render_write.remove(written)
    emit(event="done", id=job["id"], frames=frames, build_seconds=round(built - started, 3),
         render_seconds=round(time.time() - built, 3), backdrop=backdrop)


def run(job):
    try:
        render(job)
        return True
    except Exception as error:  # report to Node, keep the worker alive
        emit(event="error", id=job.get("id"), message="%s: %s" % (type(error).__name__, error),
             trace=traceback.format_exc()[-4000:])
        return False


def main(argv):
    args = argv[argv.index("--") + 1:] if "--" in argv else []
    if "--job" in args:
        with open(args[args.index("--job") + 1], encoding="utf-8") as f:
            ok = run(json.load(f))
        sys.exit(0 if ok else 1)
    emit(event="ready", blender=bpy.app.version_string)
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            command = json.loads(line)
        except ValueError:
            emit(event="error", id=None, message="not JSON: %s" % line[:200])
            continue
        if command.get("cmd") == "quit":
            break
        if command.get("cmd") == "render":
            run(command["job"])


main(sys.argv)
