// Zenvi Link: property tools: ae_set_property, ae_animate, ae_add_expression.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    // Properties where TASTE allows linear easing (opacity crossfades).
    var LINEAR_OK = ["ADBE Opacity", "ADBE Text Opacity", "ADBE Vector Fill Opacity", "ADBE Vector Stroke Opacity", "ADBE Mask Opacity"];

    function sameJson(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function lerpValue(a, b, t) {
        var out;
        var i;
        if (typeof a === "number" && typeof b === "number") {
            return a + (b - a) * t;
        }
        out = [];
        for (i = 0; i < a.length; i += 1) {
            out.push(a[i] + ((b[i] !== undefined ? b[i] : a[i]) - a[i]) * t);
        }
        return out;
    }

    function overshootValue(a, b, amount) {
        return lerpValue(a, b, 1 + amount);
    }

    // ------------------------------------------------------------------
    // ae_set_property

    Z.register("ae_set_property", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var target = AE.resolveLeaf(layer, Z.required(args, "property", "any"));
        var property = target.property;
        var time = Z.optional(args, "time", "number", null);
        var value;
        var before;
        var after;
        var data;
        if (!Z.has(args, "value") || args.value === null) {
            throw Z.refuse("INVALID_ARGUMENT", "`value` is required");
        }
        if (time !== null) {
            time = AE.compTime(comp, time, ctx, "time");
            if (!property.canVaryOverTime) {
                throw Z.refuse("UNSUPPORTED", target.path + " cannot be keyframed; set it without `time`");
            }
        } else if (property.numKeys > 0) {
            throw Z.refuse("INVALID_ARGUMENT", target.path + " has " + Z.plural(property.numKeys, "keyframe") +
                "; pass `time` to set a keyframe, or replace them with ae_animate (replace: true)");
        }
        value = AE.toValue(property, args.value, "value", time !== null ? property.valueAtTime(time, true) : property.value);
        before = AE.exportValue(time !== null ? property.valueAtTime(time, true) : property.value);
        after = AE.exportValue(value);
        data = {layer: AE.layerRef(layer), path: target.path, match_path: target.match_path, before: before, value: after, time: time !== null ? Z.round(time, 4) : null, keyframe: null};
        if (time === null && sameJson(before, after)) {
            return Z.unchanged(target.path + " of \"" + layer.name + "\" is already " + JSON.stringify(after), data);
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        if (time === null) {
            property.setValue(value);
        } else {
            property.setValueAtTime(time, value);
            data.keyframe = property.nearestKeyIndex(time);
        }
        if (property.expressionEnabled && property.expression !== "") {
            ctx.warn(target.path + " has an expression, which may override this value");
        }
        return Z.applied("Set " + target.path + " of \"" + layer.name + "\" to " + AE.clip(JSON.stringify(after), 80) +
            (time !== null ? " at " + Z.round(time) + " s" : ""), data);
    });

    // ------------------------------------------------------------------
    // ae_animate

    Z.register("ae_animate", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var target = AE.resolveLeaf(layer, Z.required(args, "property", "any"));
        var property = target.property;
        var raw = Z.required(args, "keyframes", "array");
        var defaultCurve = AE.curve(Z.optional(args, "easing", "any", TASTE.easing["default"]), "easing");
        var replace = Z.optional(args, "replace", "boolean", false);
        var spatial = Z.oneOf("spatial", Z.optional(args, "spatial", "string", "auto-bezier"), ["auto-bezier", "linear"]);
        var overshoot = Z.optional(args, "overshoot", "number", 0);
        var holdOnly = !property.isInterpolationTypeValid(KeyframeInterpolationType.BEZIER);
        var keys = [];
        var written;
        var key;
        var last;
        var settle;
        var previous;
        var linearWarned = false;
        var i;
        if (!raw.length || raw.length > 500) {
            throw Z.refuse("INVALID_ARGUMENT", "`keyframes` takes 1-500 keyframes");
        }
        Z.inRange("overshoot", overshoot, 0, TASTE.easing.overshoot.max);
        if (!property.canVaryOverTime) {
            throw Z.refuse("UNSUPPORTED", target.path + " cannot be keyframed");
        }
        for (i = 0; i < raw.length; i += 1) {
            if (!Z.isObject(raw[i])) {
                throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + i + "]` must be {time, value, easing?}");
            }
            key = {
                time: AE.snapTime(comp, Z.inRange("keyframes[" + i + "].time", Z.required(raw[i], "time", "number"), 0, 10800), ctx, "keyframes[" + i + "].time"),
                value: null,
                curve: Z.has(raw[i], "easing") && raw[i].easing !== null ? AE.curve(raw[i].easing, "keyframes[" + i + "].easing") : defaultCurve
            };
            if (!Z.has(raw[i], "value") || raw[i].value === null) {
                throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + i + "].value` is required");
            }
            key.value = AE.toValue(property, raw[i].value, "keyframes[" + i + "].value", previous);
            if (keys.length && key.time <= keys[keys.length - 1].time + 1e-6) {
                throw Z.refuse("INVALID_ARGUMENT", "Keyframe times must increase; keyframes[" + i + "] (" + Z.round(key.time) + " s) is not after the one before" +
                    " (snapped to frames)");
            }
            if (holdOnly) {
                key.curve = AE.curve("hold", "easing");
            }
            if (key.time > comp.duration + 1e-6) {
                ctx.warn("Keyframe at " + Z.round(key.time) + " s is after the end of the comp (" + Z.round(comp.duration) + " s)");
            }
            previous = Z.isArray(key.value) ? key.value : previous;
            keys.push(key);
        }
        for (i = 0; i < keys.length - 1 && !linearWarned; i += 1) {
            if (keys[i].curve.type === "linear" && Z.indexOf(LINEAR_OK, property.matchName) < 0) {
                ctx.warn("Linear easing on " + target.path + ": TASTE keeps linear for opacity crossfades, loops and tickers; moves should ease (smooth, out, in, in-out)");
                linearWarned = true;
            }
        }
        if (overshoot > 0) {
            if (keys.length < 2 || keys[keys.length - 2].curve.type === "hold" || typeof keys[0].value !== "number" && !Z.isArray(keys[0].value)) {
                throw Z.refuse("INVALID_ARGUMENT", "`overshoot` needs at least two numeric keyframes with a moving last segment");
            }
            last = keys[keys.length - 1];
            previous = keys[keys.length - 2];
            settle = Math.min(TASTE.easing.overshoot.settle, (last.time - previous.time) * 0.4);
            key = {
                time: AE.snapTime(comp, last.time - settle, null, "overshoot"),
                value: overshootValue(previous.value, last.value, overshoot),
                curve: AE.curve("in-out", "easing")
            };
            if (key.time <= previous.time + 1e-6) {
                throw Z.refuse("INVALID_ARGUMENT", "The last segment is too short for an overshoot; give it at least " + Z.round(3 / comp.frameRate, 3) + " s");
            }
            keys.splice(keys.length - 1, 0, key);
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        written = AE.writeKeyframes(property, keys, {replace: replace, spatial: spatial}, ctx);
        return Z.applied("Animated " + target.path + " of \"" + layer.name + "\" with " + Z.plural(written.length, "keyframe") + " (" +
            Z.round(keys[0].time) + "-" + Z.round(keys[keys.length - 1].time) + " s, " + (holdOnly ? "hold" : defaultCurve.name) + ")" +
            (overshoot > 0 ? " with a " + Z.round(overshoot * 100, 1) + " % overshoot" : ""), {
            layer: AE.layerRef(layer),
            path: target.path,
            match_path: target.match_path,
            keyframes: written
        });
    });

    // ------------------------------------------------------------------
    // ae_add_expression

    Z.register("ae_add_expression", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var target = AE.resolveLeaf(layer, Z.required(args, "property", "any"));
        var property = target.property;
        var expression = Z.required(args, "expression", "string");
        var enabled = Z.optional(args, "enabled", "boolean", true);
        var oldExpression = property.expression;
        var oldEnabled = property.expressionEnabled;
        var error;
        var data = {layer: AE.layerRef(layer), path: target.path, match_path: target.match_path, expression: expression, enabled: expression !== "" && enabled};
        if (!property.canSetExpression) {
            throw Z.refuse("UNSUPPORTED", target.path + " cannot have an expression");
        }
        if (expression === oldExpression && (expression === "" || oldEnabled === enabled)) {
            return Z.unchanged(target.path + " of \"" + layer.name + "\" already has " + (expression === "" ? "no expression" : "this expression"), data);
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        property.expression = expression;
        if (expression === "") {
            return Z.applied("Cleared the expression on " + target.path + " of \"" + layer.name + "\"", data);
        }
        property.expressionEnabled = true;
        error = property.expressionError;
        if (error) {
            property.expression = oldExpression;
            property.expressionEnabled = oldEnabled;
            throw Z.refuse("INVALID_ARGUMENT", "After Effects rejected the expression on " + target.path + ": " + error + " (the previous expression was restored)");
        }
        if (!enabled) {
            property.expressionEnabled = false;
        }
        data.value = AE.exportValue(property.valueAtTime(comp.time, false));
        return Z.applied("Set an expression on " + target.path + " of \"" + layer.name + "\"" + (enabled ? "" : " (disabled)"), data);
    });
}(ZenviLink));
