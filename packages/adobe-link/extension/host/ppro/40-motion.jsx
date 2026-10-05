// Zenvi Link: Premiere Pro clip properties and keyframes.
// premiere_set_clip_properties, premiere_animate.
//
// Built-in components: Motion (AE.ADBE Motion: Position, Scale, Scale Width,
// Uniform Scale, Rotation, Anchor Point, Anti-flicker Filter), Opacity
// (AE.ADBE Opacity: Opacity, Blend Mode), audio Volume (Bypass, Level).
// Position and Anchor Point are normalised (0-1) in scripting; Level is linear
// gain with +15 dB = 1 (00-ppro-core.jsx: dbToLevel).

(function (Z) {
    var P = Z.ppro;
    var TASTE = Z.TASTE;

    function isPoint(value) {
        return Z.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number" &&
            isFinite(value[0]) && isFinite(value[1]);
    }

    function sameValue(a, b) {
        var i;
        if (Z.isArray(a) || (a && typeof a === "object" && typeof a.length === "number")) {
            if (!b || typeof b.length !== "number" || a.length !== b.length) {
                return false;
            }
            for (i = 0; i < a.length; i += 1) {
                if (Math.abs(Number(a[i]) - Number(b[i])) > 0.00001) {
                    return false;
                }
            }
            return true;
        }
        return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 0.00001 : a === b;
    }

    /**
     * The built-in property `name` of a clip: {label, component, param,
     * toDom(value), fromDom(value)}; refuses when the clip has no such property.
     */
    P.builtinProperty = function (found, name) {
        var sequence = found.sequence;
        var clip = found.clip;
        var component;
        var spec;
        var param;
        var video = {
            position: [P.motionOf, "Motion", P.MOTION_PARAMS.position],
            scale: [P.motionOf, "Motion", P.MOTION_PARAMS.scale],
            rotation: [P.motionOf, "Motion", P.MOTION_PARAMS.rotation],
            anchor: [P.motionOf, "Motion", P.MOTION_PARAMS.anchor],
            opacity: [P.opacityOf, "Opacity", P.OPACITY_PARAMS.opacity],
            blend_mode: [P.opacityOf, "Opacity", P.OPACITY_PARAMS.blend]
        };
        if (name === "volume" || name === "volume_db") {
            if (found.kind !== "audio") {
                throw Z.refuse("INVALID_ARGUMENT", "Volume applies to audio clips; \"" + clip.name + "\" is on video track " +
                    P.trackLabel(found.kind, found.trackIndex) + " (use its linked audio clip)");
            }
            component = P.volumeOf(clip);
            param = component ? P.findParam(component, ["Level"], 1) : null;
            if (!param) {
                throw Z.refuse("UNSUPPORTED", "Clip \"" + clip.name + "\" has no Volume > Level parameter");
            }
            return {
                label: "Volume > Level",
                component: component,
                param: param,
                unit: "dB",
                toDom: function (db) { return P.dbToLevel(db); },
                fromDom: function (value) { return P.levelToDb(value); }
            };
        }
        spec = video[name];
        if (!spec) {
            throw Z.refuse("INVALID_ARGUMENT", "Unknown property " + name);
        }
        if (found.kind !== "video") {
            throw Z.refuse("INVALID_ARGUMENT", name + " applies to video clips; \"" + clip.name + "\" is on audio track " +
                P.trackLabel(found.kind, found.trackIndex));
        }
        component = spec[0](clip);
        param = component ? P.findParam(component, [spec[2][0]], spec[2][1]) : null;
        if (!param) {
            throw Z.refuse("UNSUPPORTED", "Clip \"" + clip.name + "\" has no " + spec[1] + " > " + spec[2][0] + " parameter");
        }
        return {
            label: spec[1] + " > " + spec[2][0],
            component: component,
            param: param,
            unit: name === "position" ? "px" : name === "anchor" ? "fraction" : name === "rotation" ? "deg" : name === "blend_mode" ? "" : "%",
            toDom: function (value) {
                if (name === "position") {
                    return P.positionToDom(sequence, value);
                }
                if (name === "blend_mode") {
                    return P.BLEND_MODES.indexOf(value);
                }
                return value;
            },
            fromDom: function (value) {
                if (name === "position") {
                    return P.positionFromDom(sequence, value);
                }
                if (name === "anchor") {
                    return value && typeof value.length === "number" ? [Z.round(Number(value[0]), 4), Z.round(Number(value[1]), 4)] : null;
                }
                if (name === "blend_mode") {
                    return P.blendModeName(value);
                }
                return typeof value === "number" ? Z.round(value, 4) : value;
            }
        };
    };

    // ------------------------------------------------------------------
    // premiere_set_clip_properties

    var STATIC_KEYS = ["position", "scale", "rotation", "anchor", "opacity", "blend_mode", "volume_db"];

    function checkStatic(key, value) {
        switch (key) {
        case "position":
        case "anchor":
            if (!isPoint(value)) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be [x, y]");
            }
            return value;
        case "scale":
            return Z.inRange(key, value, 0, 10000);
        case "rotation":
            return Z.inRange(key, value, -36000, 36000);
        case "opacity":
            return Z.inRange(key, value, 0, 100);
        case "blend_mode":
            return Z.oneOf(key, value, P.BLEND_MODES);
        default:
            return Z.inRange(key, value, -96, 15);
        }
    }

    Z.register("premiere_set_clip_properties", function (args, ctx) {
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var clearKeys = Z.optional(args, "clear_keyframes", "boolean", false);
        var requested = [];
        var animated = [];
        var changes = [];
        var values = {};
        var before = {};
        var steps = 0;

        Z.each(STATIC_KEYS, function (key) {
            if (Z.has(args, key) && args[key] !== null && args[key] !== undefined) {
                requested.push({key: key, value: checkStatic(key, args[key])});
            }
        });
        if (requested.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "Pass at least one of " + STATIC_KEYS.join(", "));
        }
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        Z.each(requested, function (entry) {
            entry.property = P.builtinProperty(found, entry.key);
            entry.dom = entry.property.toDom(entry.value);
            if (P.isAnimated(entry.property.param)) {
                animated.push(entry.property.label);
            }
        });
        if (animated.length > 0 && !clearKeys) {
            throw Z.refuse("INVALID_ARGUMENT", animated.join(", ") + (animated.length === 1 ? " is" : " are") +
                " animated (has keyframes); change the keyframes with premiere_animate, or pass clear_keyframes: true");
        }
        Z.each(requested, function (entry) {
            var current = P.valueOf(entry.property.param);
            before[entry.key] = entry.property.fromDom(current);
            if (P.isAnimated(entry.property.param) || !sameValue(current, entry.dom)) {
                changes.push(entry);
            }
        });
        if (changes.length === 0) {
            return Z.unchanged("Clip \"" + found.clip.name + "\" already has those values", {clip: found.clip.nodeId, values: before});
        }

        ctx.changed();
        Z.each(changes, function (entry) {
            var param = entry.property.param;
            var stored;
            if (P.isAnimated(param)) {
                param.setTimeVarying(false);
                steps += 1;
            }
            param.setValue(entry.dom, true);
            steps += 1;
            stored = P.valueOf(param);
            values[entry.key] = entry.property.fromDom(stored);
            if (!sameValue(stored, entry.dom)) {
                ctx.warn("Premiere stored " + JSON.stringify(values[entry.key]) + " for " + entry.key + " (asked " + JSON.stringify(entry.value) + ")");
            }
        });
        return Z.applied("Set " + Z.map(changes, function (entry) {
            return entry.key + " " + JSON.stringify(entry.value);
        }).join(", ") + " on \"" + found.clip.name + "\"", {
            clip: found.clip.nodeId,
            values: values,
            before: before
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_animate

    /** setInterpolationTypeAtKey values (scripting guide, ComponentParam): 1-3 are the legacy ease modes. */
    P.INTERPOLATION = {linear: 0, "ease-in": 1, "ease-out": 2, "ease-in-out": 3, hold: 4, bezier: 5};

    var INTERPOLATION_NAMES = ["linear", "ease-in", "ease-out", "ease-in-out", "hold", "bezier"];

    /** A TASTE easing name or {x1, y1, x2, y2} -> "hold" or [x1, y1, x2, y2]; refuses unknown names. */
    P.easingCurve = function (value, key) {
        var curves = TASTE.easing.curves;
        if (value === "hold") {
            return "hold";
        }
        if (typeof value === "string") {
            if (!Z.has(curves, value)) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a TASTE easing (" + Object.keys(curves).join(", ") + ", hold) or {x1, y1, x2, y2}");
            }
            return curves[value];
        }
        if (Z.isObject(value) && typeof value.x1 === "number" && typeof value.y1 === "number" && typeof value.x2 === "number" &&
                typeof value.y2 === "number" && value.x1 >= 0 && value.x1 <= 1 && value.x2 >= 0 && value.x2 <= 1) {
            return [value.x1, value.y1, value.x2, value.y2];
        }
        throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a TASTE easing name or {x1, y1, x2, y2} with x in 0-1");
    };

    function isLinearCurve(curve) {
        return curve !== "hold" && Math.abs(curve[0] - curve[1]) < 0.0001 && Math.abs(curve[2] - curve[3]) < 0.0001;
    }

    /** The segment leaves its first key at rest (outgoing speed under half the average). */
    function startsAtRest(curve) {
        return curve !== "hold" && !isLinearCurve(curve) && curve[0] > 0 && curve[1] / curve[0] < 0.5;
    }

    /** The segment arrives at its second key at rest. */
    function endsAtRest(curve) {
        return curve !== "hold" && !isLinearCurve(curve) && curve[2] < 1 && (1 - curve[3]) / (1 - curve[2]) < 0.5;
    }

    /**
     * Premiere interpolation per key from the easing of the segments around it
     * (TASTE 2): hold where the outgoing segment holds, linear between linear
     * segments, ease-in where the incoming segment arrives at rest, ease-out
     * where the outgoing one leaves from rest, both for a resting key in the
     * middle, else Bezier (never linear on a key that moves non-linearly).
     */
    P.interpolationModes = function (curves) {
        var modes = [];
        var count = curves.length + 1;
        var i;
        var incoming;
        var outgoing;
        var easeIn;
        var easeOut;
        for (i = 0; i < count; i += 1) {
            incoming = i > 0 ? curves[i - 1] : null;
            outgoing = i < curves.length ? curves[i] : null;
            if (outgoing === "hold") {
                modes.push(P.INTERPOLATION.hold);
                continue;
            }
            if ((incoming === null || incoming === "hold" || isLinearCurve(incoming)) && (outgoing === null || isLinearCurve(outgoing))) {
                modes.push(P.INTERPOLATION.linear);
                continue;
            }
            easeIn = incoming !== null && endsAtRest(incoming);
            easeOut = outgoing !== null && startsAtRest(outgoing);
            modes.push(easeIn && easeOut ? P.INTERPOLATION["ease-in-out"] : easeIn ? P.INTERPOLATION["ease-in"] :
                easeOut ? P.INTERPOLATION["ease-out"] : P.INTERPOLATION.bezier);
        }
        return modes;
    };

    /** Set a key's interpolation; the legacy ease modes fall back to Bezier when Premiere rejects them. Returns the mode set. */
    function setInterpolation(param, time, mode, state) {
        var result;
        try {
            result = param.setInterpolationTypeAtKey(time, mode, true);
            if (result === false || (typeof result === "number" && result !== 0)) {
                throw new Error("returned " + String(result));
            }
            return mode;
        } catch (error) {
            if (mode === 1 || mode === 2 || mode === 3) {
                param.setInterpolationTypeAtKey(time, P.INTERPOLATION.bezier, true);
                state.fallbacks += 1;
                return P.INTERPOLATION.bezier;
            }
            throw error;
        }
    }

    /** The animated parameter: a built-in name or {effect, param}. */
    function animatedTarget(found, property) {
        var builtin;
        var components;
        /** @type {Component | null} */
        var component = null;
        var param;
        if (typeof property === "string") {
            builtin = P.builtinProperty(found, property);
            builtin.name = property;
            return builtin;
        }
        if (!Z.isObject(property) || typeof property.effect !== "string" || typeof property.param !== "string") {
            throw Z.refuse("INVALID_ARGUMENT", "`property` must be position, scale, rotation, anchor, opacity, volume or {effect, param}");
        }
        components = P.componentsOf(found.clip);
        Z.each(components, function (candidate) {
            if (!component && String(candidate.displayName).toLowerCase() === property.effect.toLowerCase()) {
                component = candidate;
            }
        });
        if (!component) {
            throw Z.refuse("NOT_FOUND", "Clip \"" + found.clip.name + "\" has no effect \"" + property.effect + "\" (it has: " +
                Z.map(components, function (c) { return String(c.displayName); }).join(", ") + "); add it with premiere_apply_effect");
        }
        param = P.findParam(component, [property.param]);
        if (!param) {
            throw Z.refuse("NOT_FOUND", "Effect \"" + component.displayName + "\" has no parameter \"" + property.param + "\" (it has: " +
                P.paramNames(component).join(", ") + ")");
        }
        return {
            name: "effect",
            label: String(component.displayName) + " > " + String(param.displayName),
            component: component,
            param: param,
            unit: "",
            toDom: function (value) { return value; },
            fromDom: function (value) { return value; }
        };
    }

    function checkKeyValue(target, value, i) {
        var key = "keyframes[" + i + "].value";
        switch (target.name) {
        case "position":
        case "anchor":
            if (!isPoint(value)) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be [x, y] for " + target.name);
            }
            return value;
        case "scale":
            return Z.inRange(key, value, 0, 10000);
        case "rotation":
            return Z.inRange(key, value, -36000, 36000);
        case "opacity":
            return Z.inRange(key, value, 0, 100);
        case "volume":
            return Z.inRange(key, value, -96, 15);
        default:
            if (typeof value === "number" && isFinite(value)) {
                return value;
            }
            if (Z.isArray(value) && value.length >= 2 && value.length <= 4) {
                Z.each(value, function (part) {
                    if (typeof part !== "number" || !isFinite(part)) {
                        throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a number or an array of 2-4 numbers");
                    }
                });
                return value;
            }
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a number or an array of 2-4 numbers");
        }
    }

    Z.register("premiere_animate", function (args, ctx) {
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var sequence = found.sequence;
        var clip = found.clip;
        var raw = Z.required(args, "keyframes", "array");
        var defaultCurve = P.easingCurve(Z.optional(args, "easing", "any", TASTE.easing["default"]), "easing");
        var replace = Z.optional(args, "replace", "boolean", true);
        var target;
        var duration = P.timeToSeconds(clip.end) - P.timeToSeconds(clip.start);
        var startSeconds = P.timeToSeconds(clip.start);
        var frame = P.frameSeconds(sequence);
        var keys = [];
        var curves = [];
        var modes;
        var param;
        var state = {fallbacks: 0};
        var steps = 0;
        var wanted = {};
        var existing;
        var i;

        if (raw.length < 2) {
            throw Z.refuse("INVALID_ARGUMENT", "`keyframes` needs at least two keyframes");
        }
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        P.requireNormalSpeed(clip, "keyframes");
        target = animatedTarget(found, Z.required(args, "property", "any"));
        param = target.param;
        if (typeof param.areKeyframesSupported === "function" && param.areKeyframesSupported() === false) {
            throw Z.refuse("UNSUPPORTED", target.label + " cannot be keyframed");
        }

        Z.each(raw, function (entry, n) {
            var time;
            var snapped;
            if (!Z.isObject(entry)) {
                throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + n + "]` must be {time, value, easing?}");
            }
            time = Z.inRange("keyframes[" + n + "].time", Z.required(entry, "time", "number"), 0, null);
            if (time > duration + frame / 2) {
                throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + n + "].time` " + Z.round(time) + " s is past the end of the clip (" +
                    Z.round(duration) + " s long); times count from the clip's first frame");
            }
            snapped = P.snapTime(sequence, startSeconds + time, ctx, "keyframes[" + n + "].time") - startSeconds;
            keys.push({
                time: Math.max(0, Z.round(snapped, 6)),
                value: checkKeyValue(target, Z.required(entry, "value", "any"), n),
                curve: Z.has(entry, "easing") && entry.easing !== null ? P.easingCurve(entry.easing, "keyframes[" + n + "].easing") : defaultCurve
            });
        });
        keys.sort(function (a, b) { return a.time - b.time; });
        for (i = 1; i < keys.length; i += 1) {
            if (Math.abs(keys[i].time - keys[i - 1].time) < frame / 2) {
                throw Z.refuse("INVALID_ARGUMENT", "Two keyframes land on the same frame (" + Z.round(keys[i].time, 4) + " s)");
            }
        }
        for (i = 0; i < keys.length - 1; i += 1) {
            curves.push(keys[i].curve);
        }
        modes = P.interpolationModes(curves);

        ctx.changed();
        if (replace && P.isAnimated(param)) {
            param.setTimeVarying(false);
            steps += 1;
        }
        if (!P.isAnimated(param)) {
            param.setTimeVarying(true);
            steps += 1;
        }
        Z.each(keys, function (key, n) {
            key.at = P.keyTime(clip, key.time);
            wanted[String(key.at.ticks)] = true;
            param.addKey(key.at);
            param.setValueAtKey(key.at, target.toDom(key.value), true);
            steps += 2;
            key.mode = modes[n];
        });
        Z.each(keys, function (key) {
            key.mode = setInterpolation(param, key.at, key.mode, state);
            steps += 1;
        });
        if (replace && typeof param.getKeys === "function") {
            // Turning animation on can leave a key at the playhead; with replace only ours remain.
            existing = param.getKeys() || [];
            for (i = 0; i < existing.length; i += 1) {
                if (existing[i] && !Z.has(wanted, String(existing[i].ticks))) {
                    param.removeKey(existing[i]);
                    steps += 1;
                }
            }
        }
        if (state.fallbacks > 0) {
            ctx.warn("Premiere rejected the ease-in/ease-out interpolation on " + Z.plural(state.fallbacks, "key") +
                "; those keys use Bezier instead");
        }
        return Z.applied("Animated " + target.label + " on \"" + clip.name + "\": " + Z.plural(keys.length, "keyframe") + " " +
            Z.round(keys[0].time, 3) + "-" + Z.round(keys[keys.length - 1].time, 3) + " s (" +
            Z.map(keys, function (key) { return INTERPOLATION_NAMES[key.mode]; }).join(", ") + ")", {
            clip: clip.nodeId,
            property: target.label,
            keyframes: Z.map(keys, function (key) {
                return {
                    time: key.time,
                    sequence_time: Z.round(startSeconds + key.time, 4),
                    value: key.value,
                    interpolation: INTERPOLATION_NAMES[key.mode]
                };
            })
        }, steps);
    });
}(ZenviLink));
