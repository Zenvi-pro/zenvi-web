// Zenvi Link: render tools: ae_render and ae_render_for_zenvi (AE -> Zenvi).
//
// Output module template names differ by version: After Effects 2022+ ships
// "High Quality" (ProRes 422 HQ) and "High Quality with Alpha" (ProRes
// 4444), 2023+ adds "H.264 - Match Render Settings - 5/15/40 Mbps", and
// older versions have "Lossless" / "Lossless with Alpha" (QuickTime
// Animation). Templates are matched by name with fallbacks, and a render only
// renders its own queue item (others are unchecked and restored).
// ae_render_for_zenvi falls back only to codecs Zenvi links: H.264, ProRes
// 4444 and QuickTime Animation (qtrle).

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

    /** Uncheck the queued items other than `index`, so only it renders. Returns their indexes. */
    function uncheckOthers(queue, index) {
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
        return others;
    }

    /** Set up a new queue item: render settings, time span, output template and file. */
    function configureItem(item, comp, plan, workAreaOnly, renderSettings, ctx) {
        var module;
        if (renderSettings) {
            if (Z.filter(item.templates, function (name) { return String(name) === renderSettings; }).length) {
                item.applyTemplate(renderSettings);
            } else {
                ctx.warn("No render settings template \"" + renderSettings + "\"; kept the default");
            }
        }
        item.timeSpanStart = workAreaOnly ? comp.workAreaStart : 0;
        item.timeSpanDuration = workAreaOnly ? comp.workAreaDuration : comp.duration;
        module = item.outputModule(1);
        module.applyTemplate(plan.choice.template);
        module.file = plan.writeTo;
    }

    /** Render the queue (only item `index` is checked). Returns the seconds it took. */
    function renderNow(index) {
        var queue = app.project.renderQueue;
        var item;
        var started = new Date().getTime();
        queue.render();
        item = queue.item(index);
        if (item.status !== RQItemStatus.DONE) {
            throw Z.fail("HOST_ERROR", "The render did not finish (status " + AE.renderStatusName(item.status) + "); see the Render Queue panel");
        }
        return (new Date().getTime() - started) / 1000;
    }

    function chooseTemplate(templates, templateName, preset, ctx) {
        var described;
        if (templateName) {
            if (Z.indexOf(templates, templateName) < 0) {
                throw Z.refuse("NOT_FOUND", "No output module template \"" + templateName + "\"; this After Effects has: " + templates.join(", "));
            }
            described = describeTemplate(templateName);
            return {template: templateName, codec: described.codec, ext: described.ext, preset: null};
        }
        return AE.pickTemplate(templates, preset, ctx);
    }

    // Output module templates are the same for every output module: read
    // from a queued item, else remembered across host-script reloads
    // (AE.state), else read from the new queue item itself (queueForRender).

    /** The output module template names when known without changing anything, else null. */
    function knownTemplates(templateName) {
        var queue = app.project.renderQueue;
        var remembered = AE.state.outputTemplates;
        if (queue.numItems > 0 && queue.item(1).numOutputModules > 0) {
            return templateList(queue.item(1).outputModule(1));
        }
        if (remembered === null || (templateName && Z.indexOf(remembered, templateName) < 0)) {
            // Never read, or a template saved since.
            return null;
        }
        return remembered;
    }

    // Zenvi links only these codecs (SPEC 3.6; the desktop refuses others), so
    // ae_render_for_zenvi never falls back to ProRes 422.
    var ZENVI_CODECS = ["h264", "prores4444", "qtrle"];
    var ZENVI_CHAINS = {
        alpha: ["prores-4444", "lossless-alpha"],
        opaque: ["h264", "prores-4444", "lossless", "lossless-alpha"]
    };

    /** The first available template along `presets`; warns when it is not the first choice. */
    function zenviTemplate(templates, alpha, ctx) {
        var presets = alpha ? ZENVI_CHAINS.alpha : ZENVI_CHAINS.opaque;
        var found;
        var i;
        var j;
        for (i = 0; i < presets.length; i += 1) {
            for (j = 0; j < CHAINS[presets[i]].length; j += 1) {
                found = firstMatch(templates, CHAINS[presets[i]][j]);
                if (!found) {
                    continue;
                }
                if (i > 0) {
                    ctx.warn("This After Effects has no " + presets[0] + " output template; rendered " + presets[i] + " (\"" + found + "\")" +
                        (!alpha && CHAINS[presets[i]][j].codec !== "h264" ? "; transparent areas of the comp stay transparent in Zenvi" : ""));
                }
                return {template: found, codec: CHAINS[presets[i]][j].codec, ext: CHAINS[presets[i]][j].ext, preset: presets[i]};
            }
        }
        throw Z.refuse("UNSUPPORTED", "No output module template renders a codec Zenvi can link (" + ZENVI_CODECS.join(", ") + "); this After Effects has: " +
            templates.join(", ") + "; pass `template`");
    }

    function fileSize(path) {
        var file = AE.fileAt(path);
        return file.exists ? file.length : null;
    }

    function splitName(file) {
        var name = File.decode(file.name);
        var dot = name.lastIndexOf(".");
        return dot > 0 ? {base: name.slice(0, dot), ext: name.slice(dot)} : {base: name, ext: ""};
    }

    /**
     * A render that replaces an existing file goes to a staging file next to
     * it and replaces it only once complete, so a failed render never costs
     * the old file; a render to a new file deletes what it wrote when it fails.
     */
    function stagingFile(target) {
        var parts = splitName(target);
        return new File(target.parent.fullName + "/" + AE.uriName(parts.base + ".zenvi-partial-" + new Date().getTime() + parts.ext));
    }

    /** Move a finished staging render into place (replacing an old file there). */
    function install(staging, target) {
        installed(staging);
        if (target.exists && !target.remove()) {
            throw Z.fail("HOST_ERROR", "Could not replace " + target.fsName + "; the render is at " + staging.fsName);
        }
        if (!staging.rename(File.decode(target.name))) {
            throw Z.fail("HOST_ERROR", "Could not move the render to " + target.fsName + "; it is at " + staging.fsName);
        }
        return AE.fileAt(target.fsName);
    }

    /** The rendered file, which must exist. */
    function installed(file) {
        var parts;
        if (!file.exists) {
            parts = splitName(file);
            throw Z.fail("HOST_ERROR", "After Effects finished but " + file.fsName + " is not there (look for " + parts.base + ".* in " +
                file.parent.fsName + "; the template may write another format)");
        }
        return file;
    }

    function discard(file) {
        if (file.exists) {
            file.remove();
        }
    }

    function renderTitle(name) {
        return Z.CATALOG[name] ? Z.CATALOG[name].title : name;
    }

    /** folder/base.ext, or base-2.ext, base-3.ext ... when that is taken. */
    function uniqueFile(folder, base, ext) {
        var file = new File(folder.fullName + "/" + AE.uriName(base + "." + ext));
        var n;
        for (n = 2; file.exists && n < 1000; n += 1) {
            file = new File(folder.fullName + "/" + AE.uriName(base + "-" + n + "." + ext));
        }
        return file;
    }

    // ------------------------------------------------------------------
    // Queueing. The render tools are registered without dispatch's undo
    // group, because After Effects must not render (or hand over to Adobe
    // Media Encoder) inside one. Every render queue change still happens in
    // an undo group "Zenvi: <title>": one to queue, and one to tidy up after
    // the render when there is anything to tidy.

    /**
     * Queue `comp` in one undo group. `plan(templates)` chooses the template
     * and output and refuses when it cannot: {choice, file, writeTo}. It runs
     * before anything changes when the templates are known, else on the new
     * queue item, which is removed again (same undo group) when plan refuses.
     * With `alone`, the other queued items are unchecked so only this one
     * renders. Returns {index, plan, others}.
     */
    function queueForRender(title, summary, comp, templateName, plan, alone, settings, ctx) {
        var queue = app.project.renderQueue;
        var templates = knownTemplates(templateName);
        var planned = templates ? plan(templates) : null;
        return AE.inUndoGroup(title, function () {
            var item = queue.items.add(comp);
            var index = queue.numItems;
            try {
                if (!planned) {
                    AE.state.outputTemplates = templateList(item.outputModule(1));
                    planned = plan(AE.state.outputTemplates);
                }
                ensureFolder(planned.file.parent);
            } catch (refused) {
                item.remove();
                throw refused;
            }
            ctx.changed();
            configureItem(queue.item(index), comp, planned, settings.workAreaOnly, settings.renderSettings, ctx);
            return {index: index, plan: planned, others: alone ? uncheckOthers(queue, index) : []};
        }, summary);
    }

    /**
     * After the render: check the other queued items again and, with
     * `removeIndex`, remove that item, in one undo group. Returns the undo
     * steps it added (0 or 1).
     */
    function tidyQueue(title, comp, others, removeIndex) {
        var queue = app.project.renderQueue;
        var parts = [];
        var summary;
        if (removeIndex) {
            parts.push("removed the finished render queue item for \"" + comp.name + "\"");
        }
        if (others.length) {
            parts.push("checked " + Z.plural(others.length, "other render queue item") + " again");
        }
        if (!parts.length) {
            return 0;
        }
        summary = parts.join("; ");
        AE.inUndoGroup(title, function () {
            var i;
            for (i = 0; i < others.length; i += 1) {
                queue.item(others[i]).render = true;
            }
            if (removeIndex) {
                queue.item(removeIndex).remove();
            }
        }, summary.charAt(0).toUpperCase() + summary.slice(1));
        return 1;
    }

    /**
     * A call that fails after queueing says what it left in the undo history
     * (dispatch reports undoSteps null for tools outside its undo group).
     */
    function warnSteps(ctx, title, comp, steps) {
        ctx.warn(steps > 1 ?
            "This call made 2 undo steps (\"Zenvi: " + title + "\" twice): queueing \"" + comp.name + "\" and tidying the render queue after" :
            "This call made 1 undo step: Edit > Undo \"Zenvi: " + title + "\" takes \"" + comp.name + "\" off the render queue again");
    }

    // ------------------------------------------------------------------
    // ae_render

    Z.register("ae_render", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var project = AE.requireProject();
        var queue = project.renderQueue;
        var preset = Z.oneOf("preset", Z.optional(args, "preset", "string", "h264"), PRESETS);
        var templateName = Z.optional(args, "template", "string", null);
        var renderSettings = Z.optional(args, "render_settings", "string", "Best Settings");
        var workAreaOnly = Z.optional(args, "work_area_only", "boolean", false);
        var mode = Z.oneOf("mode", Z.optional(args, "mode", "string", "render_now"), ["render_now", "queue_only", "media_encoder"]);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var output = Z.optional(args, "output", "string", null);
        var title = renderTitle("ae_render");
        var queued;
        var choice;
        var file;
        var steps = 1;
        var finished = false;
        var seconds = null;
        var summary;
        if (output !== null) {
            AE.requireAbsolutePath(output, "output");
        } else if (!project.file) {
            throw Z.refuse("INVALID_ARGUMENT", "The project is unsaved; pass `output` (an absolute file path)");
        }
        if (mode === "media_encoder" && !Z.hasMethod(queue, "queueInAME")) {
            throw Z.refuse("UNSUPPORTED", "This After Effects cannot queue renders in Adobe Media Encoder; use mode render_now");
        }
        if (workAreaOnly && comp.workAreaDuration <= 0) {
            throw Z.refuse("INVALID_ARGUMENT", "Comp \"" + comp.name + "\" has an empty work area");
        }
        requireIdleQueue();
        queued = queueForRender(title, "Queued \"" + comp.name + "\" for rendering", comp, templateName, function (templates) {
            var picked = chooseTemplate(templates, templateName, preset, ctx);
            var target = output !== null ? AE.fileAt(withExtension(output, picked.ext, ctx)) :
                new File(project.file.parent.fullName + "/Renders/" + AE.uriName(AE.safeFileName(comp.name) + "." + (picked.ext || "mov")));
            if (target.exists && !overwrite) {
                throw Z.refuse("INVALID_ARGUMENT", target.fsName + " already exists; pass overwrite: true or another `output`");
            }
            if (target.exists && mode !== "render_now") {
                ctx.warn(target.fsName + " already exists; the render will replace it when it runs");
            }
            // A render that replaces a file goes to a staging file first, so a failed render keeps the old one.
            return {choice: picked, file: target, writeTo: target.exists && mode === "render_now" ? stagingFile(target) : target};
        }, mode !== "queue_only", {workAreaOnly: workAreaOnly, renderSettings: renderSettings}, ctx);
        choice = queued.plan.choice;
        file = queued.plan.file;
        try {
            if (mode === "render_now") {
                try {
                    seconds = renderNow(queued.index);
                } catch (failedRender) {
                    discard(queued.plan.writeTo);
                    throw failedRender;
                }
            } else if (mode === "media_encoder") {
                // canQueueInAME says whether there is anything queued to send; ours is now.
                if (!queue.canQueueInAME) {
                    throw Z.fail("UNSUPPORTED", "After Effects reports nothing it can send to Adobe Media Encoder (is it installed?); \"" +
                        comp.name + "\" stays in the render queue as item " + queued.index);
                }
                queue.queueInAME(false);
            }
            finished = true;
        } finally {
            steps += tidyQueue(title, comp, queued.others, 0);
            if (!finished) {
                warnSteps(ctx, title, comp, steps);
            }
        }
        if (mode === "render_now") {
            try {
                file = queued.plan.writeTo !== file ? install(queued.plan.writeTo, file) : installed(file);
            } catch (notInstalled) {
                warnSteps(ctx, title, comp, steps);
                throw notInstalled;
            }
            summary = "Rendered \"" + comp.name + "\" to " + file.fsName + " in " + Z.round(seconds, 1) + " s";
        } else if (mode === "media_encoder") {
            summary = "Queued \"" + comp.name + "\" in Adobe Media Encoder (" + choice.template + "); start its queue there";
        } else {
            summary = "Added \"" + comp.name + "\" to the render queue as item " + queued.index + " (" + choice.template + ")";
        }
        return Z.applied(summary, {
            comp_id: comp.id,
            comp_name: comp.name,
            output: file.fsName,
            template: choice.template,
            codec: choice.codec,
            mode: mode,
            render_queue_index: queued.index,
            status: AE.renderStatusName(queue.item(queued.index).status),
            render_seconds: seconds !== null ? Z.round(seconds, 2) : null,
            size_bytes: mode === "render_now" ? fileSize(file.fsName) : null,
            work_area_only: workAreaOnly
        }, steps);
    }, {mutating: false});

    // ------------------------------------------------------------------
    // ae_render_for_zenvi

    Z.register("ae_render_for_zenvi", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var project = AE.requireProject();
        var alpha = Z.optional(args, "alpha", "boolean", false);
        var output = Z.optional(args, "output", "string", null);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var workAreaOnly = Z.optional(args, "work_area_only", "boolean", false);
        var templateName = Z.optional(args, "template", "string", null);
        var title = renderTitle("ae_render_for_zenvi");
        var now = new Date();
        var queued;
        var choice;
        var file;
        var seconds;
        var steps;
        var finished = false;
        var duration = workAreaOnly ? comp.workAreaDuration : comp.duration;
        var fps = AE.fpsRational(comp.frameRate);
        var frames = Math.round(duration * comp.frameRate);
        var renderedAt;
        var aep = AE.projectPath();
        var data;
        if (output !== null) {
            AE.requireAbsolutePath(output, "output");
        }
        if (workAreaOnly && comp.workAreaDuration <= 0) {
            throw Z.refuse("INVALID_ARGUMENT", "Comp \"" + comp.name + "\" has an empty work area");
        }
        requireIdleQueue();
        queued = queueForRender(title, "Queued \"" + comp.name + "\" for Zenvi", comp, templateName, function (templates) {
            var picked;
            var target;
            if (templateName) {
                picked = chooseTemplate(templates, templateName, null, ctx);
                if (Z.indexOf(ZENVI_CODECS, picked.codec) < 0) {
                    throw Z.refuse("INVALID_ARGUMENT", "Template \"" + templateName + "\" renders " + picked.codec + "; Zenvi links only " + ZENVI_CODECS.join(", ") +
                        " (an H.264, ProRes 4444 or QuickTime Animation template)");
                }
                if (alpha && picked.codec === "h264") {
                    ctx.warn("alpha: true asked for transparency, but H.264 template \"" + templateName + "\" has none");
                }
            } else {
                picked = zenviTemplate(templates, alpha, ctx);
            }
            if (output === null) {
                // Zenvi's own renders folder: a new name per render, never another file.
                target = uniqueFile(AE.tempFolder("renders"), AE.safeFileName(comp.name) + "-" + comp.id + "-" + AE.fileStamp(now), picked.ext || "mov");
            } else {
                target = AE.fileAt(withExtension(output, picked.ext, ctx));
            }
            if (target.exists && !overwrite) {
                throw Z.refuse("INVALID_ARGUMENT", target.fsName + " already exists; pass overwrite: true or another `output`");
            }
            return {choice: picked, file: target, writeTo: target.exists ? stagingFile(target) : target};
        }, true, {workAreaOnly: workAreaOnly, renderSettings: "Best Settings"}, ctx);
        choice = queued.plan.choice;
        file = queued.plan.file;
        if (!aep) {
            ctx.warn("The project is unsaved, so Zenvi cannot re-render this clip later; save it (ae_save_project) and send again");
        }
        try {
            seconds = renderNow(queued.index);
            finished = true;
        } catch (failedRender) {
            discard(queued.plan.writeTo);
            throw failedRender;
        } finally {
            // A failed render stays in the queue for inspection; a finished one is removed.
            steps = 1 + tidyQueue(title, comp, queued.others, finished ? queued.index : 0);
            if (!finished) {
                warnSteps(ctx, title, comp, steps);
            }
        }
        try {
            file = queued.plan.writeTo !== file ? install(queued.plan.writeTo, file) : installed(file);
        } catch (notInstalled) {
            warnSteps(ctx, title, comp, steps);
            throw notInstalled;
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
            file.fsName, data, steps);
    }, {mutating: false});
}(ZenviLink));
