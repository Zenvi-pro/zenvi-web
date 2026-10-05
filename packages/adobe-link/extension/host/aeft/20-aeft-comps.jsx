// Zenvi Link: comp tools: ae_create_comp, ae_set_comp, ae_precompose,
// ae_add_marker.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    var COMP_PRESETS = {
        "1080p": [1920, 1080],
        "4k": [3840, 2160],
        "vertical": [1080, 1920],
        "square": [1080, 1080],
        "720p": [1280, 720]
    };
    var PRESET_NAMES = ["1080p", "4k", "vertical", "square", "720p"];

    function sameColor(a, b) {
        return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
    }

    // ------------------------------------------------------------------
    // ae_create_comp

    Z.register("ae_create_comp", function (args, ctx) {
        var project = AE.requireProject();
        var name = Z.optional(args, "name", "string", "Zenvi Comp");
        var preset = Z.optional(args, "preset", "string", null);
        var width = Z.optional(args, "width", "integer", null);
        var height = Z.optional(args, "height", "integer", null);
        var fps = Z.optional(args, "fps", "number", 30);
        var duration = Z.optional(args, "duration", "number", 10);
        var pixelAspect = Z.optional(args, "pixel_aspect", "number", 1);
        var background = AE.color(Z.optional(args, "background", "any", TASTE.color.palette.ink), "background");
        var folderName = Z.optional(args, "folder", "string", null);
        var open = Z.optional(args, "open", "boolean", true);
        var size;
        var folder;
        var comp;
        var data;
        if (preset !== null) {
            Z.oneOf("preset", preset, PRESET_NAMES);
        }
        if ((width === null) !== (height === null)) {
            throw Z.refuse("INVALID_ARGUMENT", "Pass both `width` and `height`, or a `preset`");
        }
        if (width !== null) {
            Z.inRange("width", width, 4, 30000);
            Z.inRange("height", height, 4, 30000);
            if (preset !== null) {
                ctx.warn("width and height override preset " + preset);
            }
            size = [width, height];
        } else {
            size = COMP_PRESETS[preset !== null ? preset : "1080p"];
        }
        Z.inRange("fps", fps, 1, 999);
        Z.inRange("duration", duration, 1 / fps, 10800);
        Z.inRange("pixel_aspect", pixelAspect, 0.01, 100);
        if (name.length > 255) {
            throw Z.refuse("INVALID_ARGUMENT", "`name` is longer than 255 characters");
        }
        ctx.changed();
        folder = folderName !== null ? AE.findOrCreateFolder(folderName) : null;
        comp = (folder ? folder.items : project.items).addComp(AE.uniqueCompName(name, ctx), size[0], size[1], pixelAspect, duration, fps);
        comp.bgColor = background;
        if (open) {
            comp.openInViewer();
        }
        data = AE.compSummary(comp);
        data.folder = folder ? {id: folder.id, name: folder.name} : null;
        data.opened = open;
        return Z.applied("Created comp \"" + comp.name + "\" (id " + comp.id + "): " + comp.width + "x" + comp.height + ", " + Z.round(fps, 3) + " fps, " +
            Z.round(duration, 3) + " s" + (open ? "; opened it" : ""), data);
    });

    // ------------------------------------------------------------------
    // ae_set_comp

    Z.register("ae_set_comp", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var changes = [];
        var plan = [];
        var name = Z.optional(args, "name", "string", null);
        var duration = Z.optional(args, "duration", "number", null);
        var fps = Z.optional(args, "fps", "number", null);
        var width = Z.optional(args, "width", "integer", null);
        var height = Z.optional(args, "height", "integer", null);
        var background = Z.optional(args, "background", "any", null);
        var workArea = Z.optional(args, "work_area", "object", null);
        var motionBlur = Z.optional(args, "motion_blur", "boolean", null);
        var shutterAngle = Z.optional(args, "shutter_angle", "number", null);
        var shutterPhase = Z.optional(args, "shutter_phase", "number", null);
        var frameBlending = Z.optional(args, "frame_blending", "boolean", null);
        var open = Z.optional(args, "open", "boolean", null);
        var newDuration;
        var start;
        var end;
        var rgb;
        var i;
        function plan1(label, current, wanted, apply) {
            if (wanted === null || current === wanted) {
                return;
            }
            plan.push({label: label, apply: apply});
        }
        if (duration !== null) {
            Z.inRange("duration", duration, 1 / comp.frameRate, 10800);
        }
        if (fps !== null) {
            Z.inRange("fps", fps, 1, 999);
        }
        if (width !== null) {
            Z.inRange("width", width, 4, 30000);
        }
        if (height !== null) {
            Z.inRange("height", height, 4, 30000);
        }
        if (shutterAngle !== null) {
            Z.inRange("shutter_angle", shutterAngle, 0, 720);
        }
        if (shutterPhase !== null) {
            Z.inRange("shutter_phase", shutterPhase, -360, 360);
        }
        newDuration = duration !== null ? duration : comp.duration;
        if (workArea !== null) {
            start = Z.required(workArea, "start", "number");
            end = Z.required(workArea, "end", "number");
            Z.inRange("work_area.start", start, 0, null);
            if (end <= start || end > newDuration + 1e-6) {
                throw Z.refuse("INVALID_ARGUMENT", "`work_area` must end after it starts and within the comp (0-" + Z.round(newDuration) + " s)");
            }
            start = AE.snapTime(comp, start, ctx, "work_area.start");
            end = AE.snapTime(comp, end, ctx, "work_area.end");
        }
        if (name !== null && name.length > 255) {
            throw Z.refuse("INVALID_ARGUMENT", "`name` is longer than 255 characters");
        }
        rgb = background !== null ? AE.color(background, "background") : null;

        plan1("name \"" + name + "\"", comp.name, name, function () { comp.name = name; });
        plan1("duration " + duration + " s", Z.round(comp.duration, 6), duration === null ? null : Z.round(duration, 6), function () { comp.duration = duration; });
        plan1("fps " + fps, Z.round(comp.frameRate, 6), fps === null ? null : Z.round(fps, 6), function () { comp.frameRate = fps; });
        plan1("width " + width, comp.width, width, function () { comp.width = width; });
        plan1("height " + height, comp.height, height, function () { comp.height = height; });
        if (rgb !== null && !sameColor(comp.bgColor, rgb)) {
            plan.push({label: "background " + Z.color.toHex(rgb), apply: function () { comp.bgColor = rgb; }});
        }
        if (workArea !== null && (Math.abs(comp.workAreaStart - start) > 1e-6 || Math.abs(comp.workAreaStart + comp.workAreaDuration - end) > 1e-6)) {
            plan.push({label: "work area " + Z.round(start) + "-" + Z.round(end) + " s", apply: function () {
                comp.workAreaStart = start;
                comp.workAreaDuration = end - start;
            }});
        }
        plan1("motion blur " + (motionBlur ? "on" : "off"), comp.motionBlur, motionBlur, function () { comp.motionBlur = motionBlur; });
        plan1("shutter angle " + shutterAngle, comp.shutterAngle, shutterAngle, function () { comp.shutterAngle = shutterAngle; });
        plan1("shutter phase " + shutterPhase, comp.shutterPhase, shutterPhase, function () { comp.shutterPhase = shutterPhase; });
        plan1("frame blending " + (frameBlending ? "on" : "off"), comp.frameBlending, frameBlending, function () { comp.frameBlending = frameBlending; });

        if (!plan.length && open !== true) {
            return Z.unchanged("Comp \"" + comp.name + "\" already has these settings", AE.compSummary(comp));
        }
        if (plan.length) {
            ctx.changed();
        }
        for (i = 0; i < plan.length; i += 1) {
            plan[i].apply();
            changes.push(plan[i].label);
        }
        if (open === true) {
            comp.openInViewer();
            changes.push("opened in the viewer");
        }
        if (!plan.length) {
            return Z.applied("Opened comp \"" + comp.name + "\"", AE.compSummary(comp), 0);
        }
        return Z.applied("Changed comp \"" + comp.name + "\": " + changes.join(", "), (function () {
            var data = AE.compSummary(comp);
            data.changed = changes;
            return data;
        }()));
    });

    // ------------------------------------------------------------------
    // ae_precompose

    Z.register("ae_precompose", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var refs = Z.required(args, "layers", "array");
        var moveAll = Z.optional(args, "move_all_attributes", "boolean", true);
        var open = Z.optional(args, "open", "boolean", false);
        var indexes = [];
        var layers = [];
        var layer;
        var name;
        var top;
        var precomp;
        var precompLayer = null;
        var i;
        if (!refs.length) {
            throw Z.refuse("INVALID_ARGUMENT", "`layers` needs at least one layer");
        }
        for (i = 0; i < refs.length; i += 1) {
            layer = AE.findLayer(comp, refs[i]);
            if (indexes.indexOf(layer.index) < 0) {
                indexes.push(layer.index);
                layers.push(layer);
            }
        }
        indexes.sort(function (a, b) { return a - b; });
        if (!moveAll && indexes.length !== 1) {
            throw Z.refuse("INVALID_ARGUMENT", "move_all_attributes: false works on exactly one layer (After Effects' rule)");
        }
        top = comp.layer(indexes[0]);
        name = Z.optional(args, "name", "string", top.name + " Comp");
        ctx.changed();
        precomp = comp.layers.precompose(indexes, AE.uniqueCompName(name, ctx), moveAll);
        for (i = 1; i <= comp.numLayers; i += 1) {
            layer = comp.layer(i);
            if (layer instanceof AVLayer && layer.source && layer.source.id === precomp.id) {
                precompLayer = layer;
                break;
            }
        }
        if (open) {
            precomp.openInViewer();
        }
        return Z.applied("Precomposed " + Z.plural(indexes.length, "layer") + " of \"" + comp.name + "\" into \"" + precomp.name + "\" (id " + precomp.id + ")", {
            comp_id: precomp.id,
            comp_name: precomp.name,
            moved_layers: indexes.length,
            precomp_layer: precompLayer ? AE.layerRef(precompLayer) : null,
            parent_comp_id: comp.id
        });
    });

    // ------------------------------------------------------------------
    // ae_add_marker

    Z.register("ae_add_marker", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = Z.has(args, "layer") && args.layer !== null ? AE.findLayer(comp, args.layer) : null;
        var time = Z.optional(args, "time", "number", comp.time);
        var comment = Z.optional(args, "comment", "string", "");
        var duration = Z.optional(args, "duration", "number", 0);
        var chapter = Z.optional(args, "chapter", "string", null);
        var url = Z.optional(args, "url", "string", null);
        var label = Z.optional(args, "label", "integer", null);
        var protectedRegion = Z.optional(args, "protected_region", "boolean", null);
        var target;
        var marker;
        var replaced;
        var data;
        time = AE.compTime(comp, time, ctx, "time");
        Z.inRange("duration", duration, 0, 10800);
        if (label !== null) {
            Z.inRange("label", label, 0, 16);
        }
        if (protectedRegion !== null && layer) {
            throw Z.refuse("INVALID_ARGUMENT", "`protected_region` applies to comp markers only");
        }
        if (layer) {
            AE.requireUnlocked(layer);
        }
        target = layer ? /** @type {Property} */ (layer.property("ADBE Marker")) : comp.markerProperty;
        replaced = target.numKeys > 0 && Math.abs(target.keyTime(target.nearestKeyIndex(time)) - time) < 1e-4;
        marker = new MarkerValue(comment);
        marker.duration = duration;
        if (chapter !== null) {
            marker.chapter = chapter;
        }
        if (url !== null) {
            marker.url = url;
        }
        if (label !== null) {
            marker.label = label;
        }
        if (protectedRegion !== null) {
            marker.protectedRegion = protectedRegion;
        }
        ctx.changed();
        target.setValueAtTime(time, marker);
        if (replaced) {
            ctx.warn("Replaced the marker that was at " + Z.round(time) + " s");
        }
        data = {time: Z.round(time, 4), comment: comment, duration: Z.round(duration, 4), comp_id: comp.id, layer: layer ? AE.layerRef(layer) : null};
        return Z.applied("Added a " + (layer ? "layer marker to \"" + layer.name + "\"" : "comp marker to \"" + comp.name + "\"") + " at " + Z.round(time) + " s" +
            (comment ? ": " + AE.clip(comment, 60) : ""), data);
    });
}(ZenviLink));
