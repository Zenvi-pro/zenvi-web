// Zenvi Link: ae_capture_frame, the agent's eyes.
//
// CompItem.saveFrameToPng returns before the PNG is on disk (the file first
// appears empty), so the tool waits until the PNG ends with its IEND chunk.
// It renders at the comp's resolution factor: wide comps are captured at
// half, third... resolution and the user's factor is restored afterwards,
// inside one undo group of its own in case After Effects records the change.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;

    var CAPTURE_TIMEOUT_MS = 20000;
    var POLL_MS = 50;

    function u32(bytes, offset) {
        return bytes.charCodeAt(offset) * 16777216 + bytes.charCodeAt(offset + 1) * 65536 + bytes.charCodeAt(offset + 2) * 256 + bytes.charCodeAt(offset + 3);
    }

    /** {valid, width, height, complete, size} of a PNG file, read in binary mode; null when unreadable. */
    AE.readPngInfo = function (file) {
        var head = "";
        var tail = "";
        var size;
        file.encoding = "BINARY";
        if (!file.open("r")) {
            return null;
        }
        try {
            size = file.length;
            head = file.read(24);
            if (size > 12) {
                file.seek(size - 12, 0);
                tail = file.read(12);
            }
        } finally {
            file.close();
        }
        if (head.length < 24 || head.charCodeAt(0) !== 0x89 || head.substr(1, 3) !== "PNG") {
            return {valid: false, size: size, complete: false};
        }
        return {valid: true, width: u32(head, 16), height: u32(head, 20), complete: tail.indexOf("IEND") >= 0, size: size};
    };

    /**
     * Wait until `file` is a complete PNG (IEND written). If it cannot be read
     * as a PNG, a non-empty size that stays the same for three polls counts.
     */
    AE.waitForPng = function (file, timeoutMs) {
        var waited = 0;
        var lastSize = -1;
        var stable = 0;
        var info;
        for (;;) {
            if (file.exists && file.length > 0) {
                info = AE.readPngInfo(file);
                if (info && info.valid && info.complete) {
                    return info;
                }
                stable = file.length === lastSize ? stable + 1 : 0;
                lastSize = file.length;
                if (stable >= 3 && !(info && info.valid)) {
                    return {valid: false, size: lastSize, complete: true};
                }
            }
            if (waited >= timeoutMs) {
                throw Z.fail("TIMEOUT", "After Effects did not finish writing the frame within " + Math.round(timeoutMs / 1000) + " s (" + file.fsName + ")");
            }
            $.sleep(POLL_MS);
            waited += POLL_MS;
        }
    };

    function capture(comp, time, file) {
        comp.saveFrameToPng(time, file);
        return AE.waitForPng(file, CAPTURE_TIMEOUT_MS);
    }

    Z.register("ae_capture_frame", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var time = Z.optional(args, "time", "number", null);
        var maxWidth = Z.optional(args, "max_width", "integer", 1280);
        var frameDuration = 1 / comp.frameRate;
        var lastFrameTime = Math.max(0, Math.round((comp.duration - frameDuration) * comp.frameRate) / comp.frameRate);
        var factor;
        var previous;
        var changedFactor = false;
        var file;
        var info;
        var frame;
        var width;
        var height;
        Z.inRange("max_width", maxWidth, 64, 4096);
        if (time === null) {
            time = comp.time;
        } else {
            Z.inRange("time", time, 0, null);
        }
        time = AE.snapTime(comp, time, ctx, "time");
        if (time > comp.duration + 1e-6) {
            throw Z.refuse("INVALID_ARGUMENT", "`time` " + Z.round(time) + " s is after the end of comp \"" + comp.name + "\" (" + Z.round(comp.duration) + " s)");
        }
        if (time > lastFrameTime) {
            ctx.warn("Captured the comp's last frame (" + Z.round(lastFrameTime) + " s); " + Z.round(time) + " s is its end, not a frame");
            time = lastFrameTime;
        }
        frame = Math.round(time * comp.frameRate);
        // After Effects takes resolution factors 1-99.
        factor = Math.min(99, Math.max(1, Math.ceil(comp.width / maxWidth - 1e-9)));
        // Only into Zenvi Link's temp folder: the server deletes a capture there once it has sent it.
        file = AE.fileAt(Z.tempFile("capture-" + comp.id + "-" + frame, "png"));
        previous = comp.resolutionFactor;
        changedFactor = previous[0] !== factor || previous[1] !== factor;
        if (changedFactor) {
            // A read-only tool, but After Effects may record resolution changes as undo steps:
            // keep the change and its restore in one step (no step at all if it records nothing).
            info = AE.inUndoGroup(Z.CATALOG.ae_capture_frame ? Z.CATALOG.ae_capture_frame.title : "Capture comp frame", function () {
                comp.resolutionFactor = [factor, factor];
                try {
                    return capture(comp, time, file);
                } finally {
                    comp.resolutionFactor = [previous[0], previous[1]];
                }
            });
        } else {
            info = capture(comp, time, file);
        }
        width = info.valid ? info.width : Math.round(comp.width / factor);
        height = info.valid ? info.height : Math.round(comp.height / factor);
        if (width > maxWidth) {
            ctx.warn("After Effects saved the frame at " + width + "x" + height + ", wider than max_width " + maxWidth);
        }
        return Z.ok("Captured frame " + frame + " (" + Z.round(time) + " s) of \"" + comp.name + "\" at " + width + "x" + height, {
            image_path: file.fsName,
            width: width,
            height: height,
            time: Z.round(time, 4),
            frame: frame,
            comp_id: comp.id,
            comp_name: comp.name,
            comp_width: comp.width,
            comp_height: comp.height,
            resolution_factor: factor
        });
    });
}(ZenviLink));
