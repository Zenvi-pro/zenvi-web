// Zenvi Link: render tools: ae_render and ae_render_for_zenvi (AE -> Zenvi).
//
// Output module template names differ by version: After Effects 2022+ ships
// "High Quality" (ProRes 422 HQ) and "High Quality with Alpha" (ProRes
// 4444), 2023+ adds "H.264 - Match Render Settings - 5/15/40 Mbps", and
// older versions have "Lossless" / "Lossless with Alpha" (QuickTime
// Animation). Templates are matched by name with fallbacks, and a render only
// renders its own queue item (others are unchecked and restored).

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;

    var CHAINS = {
        "h264": [
            {pattern: /^H\.264.*\b40\s?Mbps/i, codec: "h264", ext: "mp4"},
            {pattern: /^H\.264.*\b15\s?Mbps/i, codec: "h264", ext: "mp4"},
            {pattern: /^H\.264/i, codec: "h264", ext: "mp4"}
        ],
        "prores-422": [
            {exact: "High Quality", codec: "prores422", ext: "mov"},
            {pattern: /ProRes 422/i, codec: "prores422", ext: "mov"}
        ],
        "prores-4444": [
            {exact: "High Quality with Alpha", codec: "prores4444", ext: "mov"},
            {pattern: /4444/, codec: "prores4444", ext: "mov"}
        ],
        "lossless": [{exact: "Lossless", codec: "qtrle", ext: "mov"}],
        "lossless-alpha": [{exact: "Lossless with Alpha", codec: "qtrle", ext: "mov"}]
    };
    var FALLBACK = {"h264": "prores-422", "prores-422": "lossless", "prores-4444": "lossless-alpha"};
    var PRESETS = ["h264", "prores-422", "prores-4444", "lossless", "lossless-alpha"];

    function templateList(module) {
        var list = module.templates;
        var out = [];
        var i;
        for (i = 0; i < list.length; i += 1) {
            out.push(String(list[i]));
        }
        return out;
    }

    function firstMatch(templates, candidate) {
        var i;
        for (i = 0; i < templates.length; i += 1) {
            if (candidate.exact ? templates[i] === candidate.exact : candidate.pattern.test(templates[i])) {
                return templates[i];
            }
        }
        return null;
    }

    /** Codec and extension for a template chosen by name. */
    function describeTemplate(name) {
        if (/H\.264/i.test(name)) {
            return {codec: "h264", ext: "mp4"};
        }
        if (/4444|High Quality with Alpha/i.test(name)) {
            return {codec: "prores4444", ext: "mov"};
        }
        if (/ProRes|High Quality/i.test(name)) {
            return {codec: "prores422", ext: "mov"};
        }
        if (/Lossless/i.test(name)) {
            return {codec: "qtrle", ext: "mov"};
        }
        return {codec: "other", ext: null};
    }

    /**
     * The template for `preset` from the module's list, falling back along
     * h264 -> prores-422 -> lossless and prores-4444 -> lossless-alpha (with a
     * warning). Returns {template, codec, ext, preset}.
     */
    AE.pickTemplate = function (templates, preset, ctx) {
        var current = preset;
        var found;
        var i;
        while (current) {
            for (i = 0; i < CHAINS[current].length; i += 1) {
                found = firstMatch(templates, CHAINS[current][i]);
                if (found) {
                    if (current !== preset) {
                        ctx.warn("This After Effects has no " + preset + " output template; rendered " + current + " (\"" + found + "\")");
                    }
                    return {template: found, codec: CHAINS[current][i].codec, ext: CHAINS[current][i].ext, preset: current};
                }
            }
            current = FALLBACK[current] || null;
        }
        throw Z.refuse("UNSUPPORTED", "No output module template for " + preset + "; this After Effects has: " + templates.join(", "));
    };

    /** `path` with the extension the format writes (warns when it changed). */
    function withExtension(path, ext, ctx) {
        var slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        var dot = path.lastIndexOf(".");
        var base = dot > slash ? path.slice(0, dot) : path;
        var given = dot > slash ? path.slice(dot + 1).toLowerCase() : "";
        if (!ext || given === ext) {
            return path;
        }
        if (given) {
            ctx.warn("Changed the output extension from ." + given + " to ." + ext + " to match the format");
        }
        return base + "." + ext;
    }

    function ensureFolder(folder) {
        if (!folder.exists && !folder.create()) {
            throw Z.fail("HOST_ERROR", "Could not create folder " + folder.fsName);
        }
    }

    function requireIdleQueue() {
        if (app.project.renderQueue.rendering) {
            throw Z.refuse("BUSY", "The render queue is already rendering; wait for it to finish");
        }
    }

    /** Uncheck queued items other than `index`, run fn, restore them. */
    function onlyItem(queue, index, fn) {
        var others = [];
        var item;
        var i;
        for (i = 1; i <= queue.numItems; i += 1) {
            item = queue.item(i);
            if (i !== index && item.render && item.status === RQItemStatus.QUEUED) {
                item.render = false;
                others.push(i);
            }
        }
        try {
            fn();
        } finally {
            for (i = 0; i < others.length; i += 1) {
                queue.item(others[i]).render = true;
            }
        }
    }

    /** Add `comp` to the render queue with a template, file and time span. Returns {item, index}. */
    function queueComp(comp, choice, file, workAreaOnly, renderSettings, ctx) {
        var queue = app.project.renderQueue;
        var item = queue.items.add(comp);
        var index = queue.numItems;
        var module;
        var settings;
        if (renderSettings) {
            settings = item.templates;
            if (Z.filter(settings, function (name) { return String(name) === renderSettings; }).length) {
                item.applyTemplate(renderSettings);
            } else {
                ctx.warn("No render settings template \"" + renderSettings + "\"; kept the default");
            }
        }
        item.timeSpanStart = workAreaOnly ? comp.workAreaStart : 0;
        item.timeSpanDuration = workAreaOnly ? comp.workAreaDuration : comp.duration;
        module = item.outputModule(1);
        module.applyTemplate(choice.template);
        module.file = file;
        return {item: queue.item(index), index: index};
    }

    function renderNow(index) {
        var queue = app.project.renderQueue;
        var item;
        var started = new Date().getTime();
        onlyItem(queue, index, function () {
            queue.render();
        });
        item = queue.item(index);
        if (item.status !== RQItemStatus.DONE) {
            throw Z.fail("HOST_ERROR", "The render did not finish (status " + AE.renderStatusName(item.status) + "); see the Render Queue panel");
        }
        return (new Date().getTime() - started) / 1000;
    }

    function chooseTemplate(templates, templateName, preset, ctx) {
        var described;
        if (templateName) {
            if (templates.indexOf(templateName) < 0) {
                throw Z.refuse("NOT_FOUND", "No output module template \"" + templateName + "\"; this After Effects has: " + templates.join(", "));
            }
            described = describeTemplate(templateName);
            return {template: templateName, codec: described.codec, ext: described.ext, preset: null};
        }
        return AE.pickTemplate(templates, preset, ctx);
    }

    // Output module templates are the same for every output module. With an
    // empty queue they are read from a probe item (added and removed again,
    // net no change) and remembered for the session.
    var probedTemplates = null;

    function probeTemplates(comp) {
        var probe = app.project.renderQueue.items.add(comp);
        try {
            probedTemplates = templateList(probe.outputModule(1));
        } finally {
            probe.remove();
        }
        return probedTemplates;
    }

    /** Pick the template before changing anything. */
    function templatesFor(comp, templateName, preset, ctx) {
        var queue = app.project.renderQueue;
        var remembered = probedTemplates !== null;
        var templates;
        if (queue.numItems > 0) {
            templates = templateList(queue.item(1).outputModule(1));
        } else {
            templates = remembered ? probedTemplates : probeTemplates(comp);
            if (remembered && templateName && templates.indexOf(templateName) < 0) {
                // A template saved since the last probe.
                templates = probeTemplates(comp);
            }
        }
        return chooseTemplate(templates, templateName, preset, ctx);
    }

    function fileSize(path) {
        var file = new File(path);
        return file.exists ? file.length : null;
    }

    // ------------------------------------------------------------------
    // ae_render

    Z.register("ae_render", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var project = AE.requireProject();
        var preset = Z.oneOf("preset", Z.optional(args, "preset", "string", "h264"), PRESETS);
        var templateName = Z.optional(args, "template", "string", null);
        var renderSettings = Z.optional(args, "render_settings", "string", "Best Settings");
        var workAreaOnly = Z.optional(args, "work_area_only", "boolean", false);
        var mode = Z.oneOf("mode", Z.optional(args, "mode", "string", "render_now"), ["render_now", "queue_only", "media_encoder"]);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var output = Z.optional(args, "output", "string", null);
        var choice;
        var file;
        var queued;
        var seconds = null;
        var data;
        var summary;
        if (output !== null) {
            AE.requireAbsolutePath(output, "output");
        } else if (!project.file) {
            throw Z.refuse("INVALID_ARGUMENT", "The project is unsaved; pass `output` (an absolute file path)");
        }
        if (mode === "media_encoder" && !project.renderQueue.canQueueInAME) {
            throw Z.refuse("UNSUPPORTED", "Adobe Media Encoder is not available to this After Effects; use mode render_now");
        }
        requireIdleQueue();
        choice = templatesFor(comp, templateName, preset, ctx);
        if (output === null) {
            output = project.file.parent.fsName + "/Renders/" + AE.safeFileName(comp.name) + "." + (choice.ext || "mov");
        }
        file = new File(withExtension(output, choice.ext, ctx));
        if (file.exists && !overwrite) {
            throw Z.refuse("INVALID_ARGUMENT", file.fsName + " already exists; pass overwrite: true or another `output`");
        }
        if (workAreaOnly && comp.workAreaDuration <= 0) {
            throw Z.refuse("INVALID_ARGUMENT", "Comp \"" + comp.name + "\" has an empty work area");
        }
        ctx.changed();
        ensureFolder(file.parent);
        if (file.exists) {
            file.remove();
        }
        queued = queueComp(comp, choice, file, workAreaOnly, renderSettings, ctx);
        if (mode === "render_now") {
            seconds = renderNow(queued.index);
            summary = "Rendered \"" + comp.name + "\" to " + file.fsName + " in " + Z.round(seconds, 1) + " s";
        } else if (mode === "media_encoder") {
            onlyItem(project.renderQueue, queued.index, function () {
                project.renderQueue.queueInAME(false);
            });
            summary = "Queued \"" + comp.name + "\" in Adobe Media Encoder (" + choice.template + "); start its queue there";
        } else {
            summary = "Added \"" + comp.name + "\" to the render queue as item " + queued.index + " (" + choice.template + ")";
        }
        data = {
            comp_id: comp.id,
            comp_name: comp.name,
            output: file.fsName,
            template: choice.template,
            codec: choice.codec,
            mode: mode,
            render_queue_index: queued.index,
            status: AE.renderStatusName(project.renderQueue.item(queued.index).status),
            render_seconds: seconds !== null ? Z.round(seconds, 2) : null,
            size_bytes: mode === "render_now" ? fileSize(file.fsName) : null,
            work_area_only: workAreaOnly
        };
        if (mode === "render_now" && data.size_bytes === null) {
            ctx.warn("After Effects reported success but " + file.fsName + " is not there; check the Render Queue's output name");
        }
        return Z.applied(summary, data);
    });

    // ------------------------------------------------------------------
    // ae_render_for_zenvi

    Z.register("ae_render_for_zenvi", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var project = AE.requireProject();
        var alpha = Z.optional(args, "alpha", "boolean", false);
        var output = Z.optional(args, "output", "string", null);
        var workAreaOnly = Z.optional(args, "work_area_only", "boolean", false);
        var templateName = Z.optional(args, "template", "string", null);
        var now = new Date();
        var choice;
        var file;
        var queued;
        var seconds;
        var duration = workAreaOnly ? comp.workAreaDuration : comp.duration;
        var fps = AE.fpsRational(comp.frameRate);
        var frames = Math.round(duration * comp.frameRate);
        var renderedAt;
        var aep = AE.projectPath();
        var data;
        if (output !== null) {
            AE.requireAbsolutePath(output, "output");
        }
        requireIdleQueue();
        choice = templatesFor(comp, templateName, alpha ? "prores-4444" : "h264", ctx);
        if (alpha && choice.codec !== "prores4444" && choice.codec !== "qtrle") {
            ctx.warn("alpha: true asked for transparency, but template \"" + choice.template + "\" may not keep it");
        }
        if (output === null) {
            output = AE.tempFolder("renders").fsName + "/" + AE.safeFileName(comp.name) + "-" + comp.id + "-" + AE.fileStamp(now) + "." + (choice.ext || "mov");
        }
        file = new File(withExtension(output, choice.ext, ctx));
        if (!aep) {
            ctx.warn("The project is unsaved, so Zenvi cannot re-render this clip later; save it (ae_save_project) and send again");
        }
        ctx.changed();
        ensureFolder(file.parent);
        if (file.exists) {
            file.remove();
        }
        queued = queueComp(comp, choice, file, workAreaOnly, "Best Settings", ctx);
        seconds = renderNow(queued.index);
        project.renderQueue.item(queued.index).remove();
        if (!new File(file.fsName).exists) {
            throw Z.fail("HOST_ERROR", "After Effects finished but " + file.fsName + " is not there");
        }
        renderedAt = AE.isoTime(new Date());
        data = {
            path: file.fsName,
            comp_id: comp.id,
            comp_name: comp.name,
            project: aep,
            width: comp.width,
            height: comp.height,
            fps: Z.round(comp.frameRate, 6),
            fps_rational: fps,
            duration: Z.round(duration, 6),
            duration_frames: frames,
            codec: choice.codec,
            template: choice.template,
            alpha: alpha,
            work_area_only: workAreaOnly,
            render_seconds: Z.round(seconds, 2),
            size_bytes: fileSize(file.fsName),
            rendered_at: renderedAt,
            link: {
                version: 1,
                kind: "aftereffects",
                source: {project_dir: null, entry: null, composition: comp.name, composition_key: comp.id, file: null, line: null, aep: aep},
                props: {},
                render: {
                    codec: choice.codec,
                    width: comp.width,
                    height: comp.height,
                    fps: fps,
                    duration_frames: frames,
                    output: file.fsName,
                    rendered_at: renderedAt,
                    fingerprint: null
                },
                state: "fresh",
                error: null
            }
        };
        return Z.applied("Rendered \"" + comp.name + "\" for Zenvi (" + choice.codec + ", " + comp.width + "x" + comp.height + ", " + frames + " frames) to " +
            file.fsName, data);
    });
}(ZenviLink));
