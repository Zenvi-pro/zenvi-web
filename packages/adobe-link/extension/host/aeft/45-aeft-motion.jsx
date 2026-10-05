// Zenvi Link: ae_apply_motion_preset and AE.applyMotionPreset (also used by
// ae_add_text). TASTE 1-3 defaults; everything is editable keyframes or text
// animators, except drift, which is procedural by nature (an expression).
//
// Text cascades use one Range Selector (Shape: Ramp Up, Offset swept from -W
// to 100 %): each unit (word or line) takes `duration` to arrive and units
// start `stagger` apart. The window W = 100 * duration / (units * stagger),
// capped at 100 %; with too few units for that stagger, the stagger widens to
// duration / units and the receipt says so.

(function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;
    var TIMING = TASTE.timing;
    var LAYOUT = TASTE.layout;

    var DRIFT_MARK = "// Zenvi drift";

    // Ranges for presets TASTE gives one number for (documented in docs/AFTER_EFFECTS.md).
    var POP_SHRINK = {"default": 1 - LAYOUT.scale.entranceFrom, range: [0.04, 0.15]};
    var BLUR = {"default": 0.03, range: [0.015, 0.06]};
    var WHIP = {"default": 0.25, range: [0.15, 0.5]};
    var DRIFT = {"default": 0.005, range: [0.0025, 0.01]};
    var PUSH = {"default": LAYOUT.scale.holdPushTo - 1, range: LAYOUT.kenBurns.range};

    var PRESETS = {
        "fade-in": {kind: "entrance", duration: TIMING.entrance["default"]},
        "fade-out": {kind: "exit", duration: TIMING.exit["default"]},
        "slide-in": {kind: "entrance", duration: TIMING.entrance["default"], direction: "up"},
        "slide-out": {kind: "exit", duration: TIMING.exit["default"], direction: "down"},
        "scale-pop": {kind: "entrance", duration: TIMING.micro["default"]},
        "blur-in": {kind: "entrance", duration: TIMING.entrance["default"]},
        "whip-in": {kind: "entrance", duration: TIMING.micro.range[1], direction: "right"},
        "typewriter": {kind: "entrance", text: true, stagger: TIMING.stagger.range[0]},
        "word-cascade": {kind: "entrance", text: true, duration: TIMING.entrance["default"], stagger: TIMING.stagger.word},
        "line-rise": {kind: "entrance", text: true, duration: TIMING.entrance["default"], stagger: TIMING.stagger.line},
        "ken-burns": {kind: "hold", direction: "left"},
        "push-in": {kind: "hold"},
        "drift": {kind: "procedural"}
    };
    AE.MOTION_PRESETS = ["fade-in", "fade-out", "slide-in", "slide-out", "scale-pop", "blur-in", "typewriter", "word-cascade", "line-rise",
        "ken-burns", "push-in", "drift", "whip-in"];

    var DIRECTIONS = {left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]};

    // ------------------------------------------------------------------
    // Helpers.

    function transform(layer, matchName) {
        return layer.property("ADBE Transform Group").property(matchName);
    }

    function keysBetween(property, start, end) {
        var times = [];
        var i;
        for (i = 1; i <= property.numKeys; i += 1) {
            if (property.keyTime(i) >= start - 1e-4 && property.keyTime(i) <= end + 1e-4) {
                times.push(property.keyTime(i));
            }
        }
        return times;
    }

    /**
     * The value the layer rests at: for an entrance the value at the window's
     * end (or at the last key already in the window, so re-applying a preset
     * keeps the old rest), for an exit the value at its start.
     */
    function restValue(property, start, end, entering) {
        var inside = keysBetween(property, start, end);
        var time = entering ? end : start;
        if (inside.length) {
            time = entering ? Math.max(end, inside[inside.length - 1]) : Math.min(start, inside[0]);
        }
        return property.valueAtTime(time, true);
    }

    function animate(property, start, end, from, to, easing, ctx) {
        var curve = AE.curve(easing, "easing");
        return AE.writeKeyframes(property, [
            {time: start, value: from, curve: curve},
            {time: end, value: to, curve: curve}
        ], {replace: false, spatial: "auto-bezier"}, ctx);
    }

    function opacityRest(property, start, end, entering, ctx) {
        var rest = restValue(property, start, end, entering);
        if (rest < 1) {
            ctx.warn("Opacity rests at " + Z.round(rest, 2) + " %; animated to 100 % instead");
            return 100;
        }
        return rest;
    }

    function fadeOpacity(layer, start, end, entering, easing, ctx, paths) {
        var property = transform(layer, "ADBE Opacity");
        var rest = opacityRest(property, start, end, entering, ctx);
        animate(property, start, end, entering ? 0 : rest, entering ? rest : 0, easing, ctx);
        paths.push("Transform/Opacity");
    }

    /** Position targets: Position, or X/Y Position when the dimensions are separated. */
    function positionTargets(layer) {
        var position = transform(layer, "ADBE Position");
        if (position.dimensionsSeparated) {
            return [
                {property: transform(layer, "ADBE Position_0"), axis: 0, path: "Transform/X Position"},
                {property: transform(layer, "ADBE Position_1"), axis: 1, path: "Transform/Y Position"}
            ];
        }
        return [{property: position, axis: -1, path: "Transform/Position"}];
    }

    /** Move between the rest position and rest + offset ([dx, dy]). */
    function move(layer, start, end, offset, entering, easing, ctx, paths) {
        var targets = positionTargets(layer);
        var rest;
        var away;
        var i;
        for (i = 0; i < targets.length; i += 1) {
            if (targets[i].axis >= 0 && offset[targets[i].axis] === 0) {
                continue;
            }
            rest = restValue(targets[i].property, start, end, entering);
            if (targets[i].axis >= 0) {
                away = rest + offset[targets[i].axis];
            } else {
                away = rest.length > 2 ? [rest[0] + offset[0], rest[1] + offset[1], rest[2]] : [rest[0] + offset[0], rest[1] + offset[1]];
            }
            animate(targets[i].property, start, end, entering ? away : rest, entering ? rest : away, easing, ctx);
            paths.push(targets[i].path);
        }
    }

    function scaleBy(layer, start, end, factorFrom, factorTo, easing, ctx, paths, entering) {
        var property = transform(layer, "ADBE Scale");
        var rest = restValue(property, start, end, entering);
        function times(factor) {
            return rest.length > 2 ? [rest[0] * factor, rest[1] * factor, rest[2]] : [rest[0] * factor, rest[1] * factor];
        }
        animate(property, start, end, times(factorFrom), times(factorTo), easing, ctx);
        paths.push("Transform/Scale");
    }

    function offsetFor(direction, distance) {
        return [DIRECTIONS[direction][0] * distance, DIRECTIONS[direction][1] * distance];
    }

    function units(layer, basedOn, ctx) {
        var doc = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
        var text = String(doc.text);
        if (basedOn === "characters") {
            return text.replace(/\s+/g, "").length;
        }
        if (basedOn === "words") {
            return Z.filter(text.split(/\s+/), function (word) { return word.length > 0; }).length;
        }
        if (doc.boxText && typeof doc.composedLineCount === "number" && doc.composedLineCount > 0) {
            return doc.composedLineCount;
        }
        if (doc.boxText) {
            ctx.warn("Counted explicit line breaks only; this After Effects does not report wrapped lines of paragraph text");
        }
        return text.split(/\r\n|\r|\n/).length;
    }

    /** A fresh text animator named `title` (an earlier one with that name is replaced); returns an accessor. */
    function textAnimator(layer, title) {
        var animators = function () { return layer.property("ADBE Text Properties").property("ADBE Text Animators"); };
        var index;
        var i;
        for (i = animators().numProperties; i >= 1; i -= 1) {
            if (animators().property(i).name === title) {
                animators().property(i).remove();
            }
        }
        index = animators().addProperty("ADBE Text Animator").propertyIndex;
        animators().property(index).name = title;
        return function () { return animators().property(index); };
    }

    /** Add a Range Selector and the animator properties; returns accessors. */
    function animatorParts(animator, propertyMatchNames) {
        var i;
        if (animator().property("ADBE Text Selectors").numProperties === 0) {
            animator().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
        }
        for (i = 0; i < propertyMatchNames.length; i += 1) {
            animator().property("ADBE Text Animator Properties").addProperty(propertyMatchNames[i]);
        }
        return {
            selector: function () { return animator().property("ADBE Text Selectors").property(1); },
            advanced: function () { return animator().property("ADBE Text Selectors").property(1).property("ADBE Text Range Advanced"); },
            property: function (matchName) { return animator().property("ADBE Text Animator Properties").property(matchName); }
        };
    }

    // Range Selector menu values (After Effects' dropdowns are 1-based).
    var UNITS_PERCENTAGE = 1;
    var BASED_ON = {characters: 1, charactersExcludingSpaces: 2, words: 3, lines: 4};
    var SHAPE = {square: 1, rampUp: 2};

    // ------------------------------------------------------------------
    // Presets.

    var RUN = {};

    RUN["fade-in"] = function (comp, layer, p, ctx) {
        fadeOpacity(layer, p.start, p.end, true, "out", ctx, p.paths);
    };

    RUN["fade-out"] = function (comp, layer, p, ctx) {
        fadeOpacity(layer, p.start, p.end, false, "in", ctx, p.paths);
    };

    RUN["slide-in"] = function (comp, layer, p, ctx) {
        var distance = AE.ranged(LAYOUT.slide, p.intensity) * comp.width;
        p.data.distance = Z.round(distance, 2);
        move(layer, p.start, p.end, offsetFor(p.direction, -distance), true, "out", ctx, p.paths);
        fadeOpacity(layer, p.start, p.end, true, "out", ctx, p.paths);
    };

    RUN["slide-out"] = function (comp, layer, p, ctx) {
        var distance = AE.ranged(LAYOUT.slide, p.intensity) * comp.width;
        p.data.distance = Z.round(distance, 2);
        move(layer, p.start, p.end, offsetFor(p.direction, distance), false, "in", ctx, p.paths);
        fadeOpacity(layer, p.start, p.end, false, "in", ctx, p.paths);
    };

    RUN["scale-pop"] = function (comp, layer, p, ctx) {
        var from = 1 - AE.ranged(POP_SHRINK, p.intensity);
        p.data.scale_from = Z.round(from * 100, 2);
        scaleBy(layer, p.start, p.end, from, 1, "snap", ctx, p.paths, true);
        fadeOpacity(layer, p.start, p.end, true, "out", ctx, p.paths);
    };

    RUN["blur-in"] = function (comp, layer, p, ctx) {
        var amount = Math.round(AE.ranged(BLUR, p.intensity) * Math.min(comp.width, comp.height) * 10) / 10;
        var effect;
        AE.removeEffectsNamed(layer, "Zenvi Blur In");
        effect = AE.addEffect(layer, "ADBE Gaussian Blur 2", "Zenvi Blur In");
        AE.effectParam(effect, "ADBE Gaussian Blur 2-0003", "Repeat Edge Pixels").setValue(1);
        animate(AE.effectParam(effect, "ADBE Gaussian Blur 2-0001", "Blurriness"), p.start, p.end, amount, 0, "out", ctx);
        p.paths.push("Effects/Zenvi Blur In/Blurriness");
        p.data.effect = "Zenvi Blur In";
        p.data.blur = amount;
        fadeOpacity(layer, p.start, p.end, true, "out", ctx, p.paths);
    };

    RUN["whip-in"] = function (comp, layer, p, ctx) {
        var distance = AE.ranged(WHIP, p.intensity) * comp.width;
        var fadeEnd = AE.snapTime(comp, p.start + (p.end - p.start) * 0.4, null, "fade");
        p.data.distance = Z.round(distance, 2);
        move(layer, p.start, p.end, offsetFor(p.direction, -distance), true, "snap", ctx, p.paths);
        fadeOpacity(layer, p.start, Math.max(fadeEnd, p.start + 1 / comp.frameRate), true, "out", ctx, p.paths);
        layer.motionBlur = true;
        if (!comp.motionBlur) {
            comp.motionBlur = true;
            ctx.warn("Turned on motion blur for comp \"" + comp.name + "\" so the whip blurs");
        }
        p.data.motion_blur = true;
    };

    RUN["ken-burns"] = function (comp, layer, p, ctx) {
        var amount = AE.ranged(LAYOUT.kenBurns, p.intensity);
        // Pan less than the extra width the scale adds, so no edge shows.
        var pan = amount * comp.width * 0.4;
        p.data.scale_to = Z.round((1 + amount) * 100, 2);
        p.data.pan = Z.round(pan, 2);
        scaleBy(layer, p.start, p.end, 1, 1 + amount, "in-out", ctx, p.paths, false);
        move(layer, p.start, p.end, offsetFor(p.direction, pan), false, "in-out", ctx, p.paths);
    };

    RUN["push-in"] = function (comp, layer, p, ctx) {
        var amount = AE.ranged(PUSH, p.intensity);
        p.data.scale_to = Z.round((1 + amount) * 100, 2);
        scaleBy(layer, p.start, p.end, 1, 1 + amount, "in-out", ctx, p.paths, false);
    };

    RUN["drift"] = function (comp, layer, p, ctx) {
        var amplitude = Math.round(AE.ranged(DRIFT, p.intensity) * comp.width * 10) / 10;
        var targets = positionTargets(layer);
        var head = DRIFT_MARK + ": a slow procedural float. a = amplitude in px, f = cycles per second.\n" +
            "var a = " + amplitude + ";\nvar f = 0.12;\nvar t = time - " + Z.round(p.start, 4) + ";\n" +
            "var w = t <= 0 ? 0 : Math.min(1, t / " + TIMING.bigMove["default"] + ");\n";
        var x = "Math.sin(t * f * 2 * Math.PI) * a * w";
        var y = "Math.sin(t * f * 1.37 * 2 * Math.PI + 1.3) * a * 0.6 * w";
        var i;
        for (i = 0; i < targets.length; i += 1) {
            targets[i].property.expression = head + (targets[i].axis < 0 ? "add(value, [" + x + ", " + y + "]);" : "value + " + (targets[i].axis === 0 ? x : y) + ";");
            targets[i].property.expressionEnabled = true;
            if (targets[i].property.expressionError) {
                throw Z.fail("HOST_ERROR", "After Effects rejected the drift expression: " + targets[i].property.expressionError);
            }
            p.paths.push(targets[i].path);
        }
        p.data.expression = true;
        p.data.amplitude = amplitude;
    };

    function cascade(comp, layer, p, ctx, basedOn, title) {
        var count = units(layer, basedOn, ctx);
        var distance = AE.ranged(LAYOUT.slide, p.intensity) * comp.width;
        var animator = textAnimator(layer, title);
        var parts = animatorParts(animator, ["ADBE Text Opacity", "ADBE Text Position 3D"]);
        var per = p.end - p.start;
        var stagger = p.stagger;
        var window;
        var total;
        p.data.animator = title;
        p.data.units = count;
        p.data.distance = Z.round(distance, 2);
        if (count <= 1) {
            // One word or line: animate the animator's own values; the selector covers everything.
            animate(parts.property("ADBE Text Opacity"), p.start, p.end, 0, 100, "out", ctx);
            animate(parts.property("ADBE Text Position 3D"), p.start, p.end, [0, distance, 0], [0, 0, 0], "out", ctx);
            p.paths.push("Text/Animators/" + title);
            p.data.stagger = 0;
            return;
        }
        parts.property("ADBE Text Opacity").setValue(0);
        parts.property("ADBE Text Position 3D").setValue([0, distance, 0]);
        parts.advanced().property("ADBE Text Range Units").setValue(UNITS_PERCENTAGE);
        parts.advanced().property("ADBE Text Range Type2").setValue(basedOn === "words" ? BASED_ON.words : BASED_ON.lines);
        parts.advanced().property("ADBE Text Range Shape").setValue(SHAPE.rampUp);
        // Each unit leaves its offset state gently and settles slowly (TASTE: enter fast, settle slow).
        parts.advanced().property("ADBE Text Levels Max Ease").setValue(50);
        parts.advanced().property("ADBE Text Levels Min Ease").setValue(100);
        window = Math.min(100, 100 * per / (count * stagger));
        total = per * (100 + window) / window;
        if (window >= 100 - 1e-9 && per / count > stagger + 1e-6) {
            ctx.warn(Z.plural(count, basedOn === "words" ? "word" : "line") + " are too few for a " + stagger + " s stagger with one Range Selector; " +
                "they start " + Z.round(per / count, 3) + " s apart");
            stagger = per / count;
        }
        parts.selector().property("ADBE Text Percent Start").setValue(0);
        parts.selector().property("ADBE Text Percent End").setValue(Math.round(window * 100) / 100);
        p.end = AE.snapTime(comp, p.start + total, null, "end");
        animate(parts.selector().property("ADBE Text Percent Offset"), p.start, p.end, -Math.round(window * 100) / 100, 100, "linear", ctx);
        p.paths.push("Text/Animators/" + title);
        p.data.stagger = Z.round(stagger, 4);
        p.data.window = Z.round(window, 2);
    }

    RUN["word-cascade"] = function (comp, layer, p, ctx) {
        cascade(comp, layer, p, ctx, "words", "Zenvi Word Cascade");
    };

    RUN["line-rise"] = function (comp, layer, p, ctx) {
        cascade(comp, layer, p, ctx, "lines", "Zenvi Line Rise");
    };

    RUN.typewriter = function (comp, layer, p, ctx) {
        var animator = textAnimator(layer, "Zenvi Typewriter");
        var parts = animatorParts(animator, ["ADBE Text Opacity"]);
        p.data.animator = "Zenvi Typewriter";
        p.data.units = units(layer, "characters", ctx);
        parts.property("ADBE Text Opacity").setValue(0);
        parts.advanced().property("ADBE Text Range Units").setValue(UNITS_PERCENTAGE);
        parts.advanced().property("ADBE Text Range Type2").setValue(BASED_ON.charactersExcludingSpaces);
        parts.advanced().property("ADBE Text Range Shape").setValue(SHAPE.square);
        parts.advanced().property("ADBE Text Selector Smoothness").setValue(0);
        // A ticker: one character at a time at an even pace (TASTE allows linear here).
        animate(parts.selector().property("ADBE Text Percent Start"), p.start, p.end, 0, 100, "linear", ctx);
        p.paths.push("Text/Animators/Zenvi Typewriter");
        p.data.stagger = Z.round((p.end - p.start) / Math.max(1, p.data.units), 4);
    };

    // ------------------------------------------------------------------
    // Entry point.

    /**
     * Apply preset `name` to `layer`. options: {start, duration, intensity,
     * direction, stagger} (null/undefined = TASTE default). Validates first,
     * then changes the layer. Returns the receipt data.
     */
    AE.applyMotionPreset = function (comp, layer, name, options, ctx) {
        var opts = options || {};
        var spec;
        var p;
        var count;
        var duration;
        var position;
        Z.oneOf("preset", name, AE.MOTION_PRESETS);
        spec = PRESETS[name];
        if (!(layer instanceof AVLayer)) {
            throw Z.refuse("INVALID_ARGUMENT", "Motion presets need a footage, text, shape, solid or precomp layer; \"" + layer.name + "\" is a " + AE.layerType(layer) + " layer");
        }
        if (spec.text && !(layer instanceof TextLayer)) {
            throw Z.refuse("INVALID_ARGUMENT", name + " animates text; \"" + layer.name + "\" is a " + AE.layerType(layer) + " layer (try slide-in or fade-in)");
        }
        AE.requireUnlocked(layer);
        p = {
            intensity: opts.intensity !== undefined && opts.intensity !== null ? Z.inRange("intensity", opts.intensity, 0, 1) : 0.5,
            direction: opts.direction !== undefined && opts.direction !== null ? Z.oneOf("direction", opts.direction, ["left", "right", "up", "down"]) : (spec.direction || "up"),
            stagger: opts.stagger !== undefined && opts.stagger !== null ? Z.inRange("stagger", opts.stagger, 0.01, 2) : spec.stagger,
            paths: [],
            data: {}
        };
        duration = opts.duration !== undefined && opts.duration !== null ? Z.inRange("duration", opts.duration, 1 / comp.frameRate, 600) : spec.duration;
        if (name === "typewriter" && (opts.duration === undefined || opts.duration === null)) {
            count = units(layer, "characters", ctx);
            duration = Math.max(1 / comp.frameRate, count * p.stagger);
        }
        if ((spec.kind === "hold" || spec.kind === "procedural") && (opts.duration === undefined || opts.duration === null)) {
            duration = null;
        }
        if (opts.start !== undefined && opts.start !== null) {
            p.start = AE.compTime(comp, Z.inRange("start", opts.start, 0, null), ctx, "start");
        } else if (spec.kind === "exit") {
            p.start = AE.snapTime(comp, Math.max(layer.inPoint, layer.outPoint - duration), ctx, "start");
        } else {
            p.start = AE.snapTime(comp, Math.max(0, layer.inPoint), ctx, "start");
        }
        if (duration === null) {
            duration = layer.outPoint - p.start;
            if (duration <= 0) {
                throw Z.refuse("INVALID_ARGUMENT", name + " starts at " + Z.round(p.start) + " s, after layer \"" + layer.name + "\" ends; pass `duration`");
            }
        }
        p.end = AE.snapTime(comp, p.start + duration, null, "end");
        if (p.end <= p.start) {
            p.end = p.start + 1 / comp.frameRate;
        }
        if (name === "drift") {
            position = positionTargets(layer);
            if (position[0].property.expression !== "" && position[0].property.expression.indexOf(DRIFT_MARK) !== 0) {
                throw Z.refuse("INVALID_ARGUMENT", position[0].path + " of \"" + layer.name + "\" already has an expression; clear it with ae_add_expression first");
            }
        }
        if (spec.kind === "entrance" && p.start < layer.inPoint - 1e-6) {
            ctx.warn(name + " starts before layer \"" + layer.name + "\" appears (" + Z.round(layer.inPoint) + " s)");
        }

        ctx.changed();
        RUN[name](comp, layer, p, ctx);
        if (spec.kind !== "procedural" && p.end > layer.outPoint + 1e-6) {
            ctx.warn(name + " runs past the layer's out point (" + Z.round(layer.outPoint) + " s)");
        }
        p.data.preset = name;
        p.data.layer = AE.layerRef(layer);
        p.data.start = Z.round(p.start, 4);
        p.data.end = Z.round(p.end, 4);
        p.data.duration = Z.round(p.end - p.start, 4);
        p.data.intensity = p.intensity;
        if (DIRECTIONS[p.direction] && (name === "slide-in" || name === "slide-out" || name === "whip-in" || name === "ken-burns")) {
            p.data.direction = p.direction;
        }
        p.data.properties = p.paths;
        return p.data;
    };

    Z.register("ae_apply_motion_preset", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var preset = Z.required(args, "preset", "string");
        var data = AE.applyMotionPreset(comp, layer, preset, {
            start: Z.optional(args, "start", "number", null),
            duration: Z.optional(args, "duration", "number", null),
            intensity: Z.optional(args, "intensity", "number", null),
            direction: Z.optional(args, "direction", "string", null),
            stagger: Z.optional(args, "stagger", "number", null)
        }, ctx);
        return Z.applied("Applied " + preset + " to \"" + layer.name + "\" (" + data.start + "-" + data.end + " s" +
            (data.direction ? ", " + data.direction : "") + ")", data);
    });
}(ZenviLink));
