// Zenvi Link: Premiere Pro effects, transitions and looks.
// premiere_apply_effect, premiere_add_transition, premiere_apply_look.
//
// Effects and transitions are added through the QE DOM (Adobe has no DOM call
// for either): qe.project.getVideoEffectByName / getAudioEffectByName and
// QE track item addVideoEffect / addAudioEffect; getVideoTransitionByName /
// getAudioTransitionByName and addTransition. Parameters are then set through
// the documented component API.

(function (Z) {
    var P = Z.ppro;
    var TASTE = Z.TASTE;

    /** Names from a QE list (getVideoEffectList etc.): entries are strings or objects with .name. */
    function qeNames(list) {
        var names = [];
        var count;
        var i;
        var entry;
        if (!list) {
            return names;
        }
        count = typeof list.numItems === "number" ? list.numItems : list.length;
        for (i = 0; i < count; i += 1) {
            entry = list[i];
            if (typeof entry === "string") {
                names.push(entry);
            } else if (entry && entry.name) {
                names.push(String(entry.name));
            }
        }
        return names;
    }

    /** Up to five catalogue names that contain the query (or a word of it), for refusals. */
    function suggestions(names, query) {
        var lower = query.toLowerCase();
        var words = Z.filter(lower.split(/\s+/), function (word) { return word.length > 2; });
        var hits = Z.filter(names, function (name) {
            var candidate = name.toLowerCase();
            var i;
            if (candidate.indexOf(lower) >= 0 || lower.indexOf(candidate) >= 0) {
                return true;
            }
            for (i = 0; i < words.length; i += 1) {
                if (candidate.indexOf(words[i]) >= 0) {
                    return true;
                }
            }
            return false;
        });
        return hits.slice(0, 5);
    }

    /** A QE effect or transition object by name; refuses NOT_FOUND with close names when Premiere lists them. */
    function qeByName(kind, what, name) {
        var project = P.qe().project;
        var getter = (kind === "video" ? "getVideo" : "getAudio") + (what === "effect" ? "EffectByName" : "TransitionByName");
        var lister = (kind === "video" ? "getVideo" : "getAudio") + (what === "effect" ? "EffectList" : "TransitionList");
        var found = null;
        var names = [];
        var close;
        try {
            found = project[getter](name);
        } catch (error) {
            found = null;
        }
        if (found) {
            return found;
        }
        try {
            names = typeof project[lister] === "function" ? qeNames(project[lister]()) : [];
        } catch (error2) {
            names = [];
        }
        close = suggestions(names, name);
        throw Z.refuse("NOT_FOUND", "No " + kind + " " + what + " named \"" + name + "\" in Premiere's Effects panel" +
            (close.length ? " (did you mean " + close.join(", ") + "?)" : "") +
            "; names are as Premiere shows them in its own language");
    }

    function qeItemFor(found, ctx) {
        var sequence = found.sequence;
        return P.qeItem(P.qeTrack(P.qeSequence(sequence, ctx), found.kind, found.trackIndex), found.clip, Number(sequence.timebase));
    }

    /** Add a QE effect to a clip; returns the new component (the last one) or fails. */
    P.addEffect = function (found, effect, effectName, ctx, resolvedItem) {
        var qeItem = resolvedItem || qeItemFor(found, ctx);
        var before = P.componentsOf(found.clip).length;
        var again;
        var components;
        ctx.changed();
        if (found.kind === "video") {
            qeItem.addVideoEffect(effect);
        } else {
            qeItem.addAudioEffect(effect);
        }
        again = P.refindClip(found.sequence, found.clip.nodeId) || found;
        components = P.componentsOf(again.clip);
        if (components.length <= before) {
            throw Z.fail("HOST_ERROR", "Premiere did not add \"" + effectName + "\" to \"" + found.clip.name + "\"");
        }
        return {component: components[components.length - 1], index: components.length - 1, clip: again.clip};
    };

    // ------------------------------------------------------------------
    // premiere_apply_effect

    function checkParamValue(value, i) {
        var key = "params[" + i + "].value";
        if (typeof value === "boolean" || (typeof value === "number" && isFinite(value))) {
            return value;
        }
        if (Z.isArray(value) && value.length >= 2 && value.length <= 4) {
            Z.each(value, function (part) {
                if (typeof part !== "number" || !isFinite(part)) {
                    throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must hold numbers");
                }
            });
            return value;
        }
        throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a number, true/false or an array of 2-4 numbers");
    }

    Z.register("premiere_apply_effect", function (args, ctx) {
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var name = Z.required(args, "effect", "string").trim();
        var params = Z.optional(args, "params", "array", []);
        var effect;
        var added;
        var set = [];
        var missing = [];
        var steps = 1;
        if (name.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`effect` must not be blank");
        }
        Z.each(params, function (entry, i) {
            if (!Z.isObject(entry) || typeof entry.name !== "string" || entry.name.length === 0) {
                throw Z.refuse("INVALID_ARGUMENT", "`params[" + i + "]` must be {name, value}");
            }
            checkParamValue(entry.value, i);
        });
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        effect = qeByName(found.kind, "effect", name);
        added = P.addEffect(found, effect, name, ctx);
        Z.each(params, function (entry) {
            var param = P.findParam(added.component, [entry.name]);
            var stored;
            if (!param) {
                missing.push(entry.name);
                return;
            }
            param.setValue(entry.value, true);
            steps += 1;
            stored = P.valueOf(param);
            set.push({name: String(param.displayName), value: stored});
            if (typeof entry.value === "number" && typeof stored === "number" && Math.abs(stored - entry.value) > 0.0001) {
                ctx.warn("Premiere stored " + stored + " for " + param.displayName + " (asked " + entry.value + ")");
            }
        });
        if (missing.length > 0) {
            ctx.warn("\"" + added.component.displayName + "\" has no parameter " + missing.join(", ") + "; it has: " +
                P.paramNames(added.component).join(", "));
        }
        return Z.applied("Applied " + added.component.displayName + " to \"" + found.clip.name + "\"" +
            (set.length ? " (" + Z.map(set, function (p) { return p.name + " " + JSON.stringify(p.value); }).join(", ") + ")" : ""), {
            clip: found.clip.nodeId,
            effect: {
                index: added.index,
                name: String(added.component.displayName),
                match_name: String(added.component.matchName),
                params: P.paramNames(added.component)
            },
            set: set,
            missing: missing
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_add_transition

    var DEFAULT_TRANSITION = {video: "Cross Dissolve", audio: "Constant Power"};

    /** The transitions of a track: [{name, start, end (ticks), key}]. */
    function transitionsOf(track) {
        var list = track.transitions;
        var out = [];
        var i;
        for (i = 0; list && i < list.numItems; i += 1) {
            out.push({
                name: String(list[i].name || ""),
                start: Number(list[i].start.ticks),
                end: Number(list[i].end.ticks),
                key: String(list[i].name || "") + "@" + String(list[i].start.ticks) + "-" + String(list[i].end.ticks)
            });
        }
        return out;
    }

    /**
     * QE addTransition. The signature used on Premiere 25-26 (premiere-pro-mcp
     * and Adobe_Premiere_Pro_MCP, both live-tested): (transition, atStart,
     * duration timecode, offset, alignment 0.5 = centred on the cut,
     * singleSided, alignToVideo). Older builds take fewer arguments; each
     * fallback is reported.
     */
    function addTransitionAt(qeItem, transition, atStart, durationTimecode, ctx) {
        var errors = [];
        var attempts = [
            {count: 7, run: function () { return qeItem.addTransition(transition, atStart, durationTimecode, "0", 0.5, false, true); }},
            {count: 3, run: function () { return qeItem.addTransition(transition, atStart, durationTimecode); }},
            {count: 2, run: function () { return qeItem.addTransition(transition, atStart); }}
        ];
        var i;
        for (i = 0; i < attempts.length; i += 1) {
            try {
                attempts[i].run();
                if (i > 0) {
                    ctx.warn("QE addTransition took " + attempts[i].count + " arguments on this Premiere build" +
                        (attempts[i].count < 3 ? "; the duration is Premiere's default" : ""));
                }
                return;
            } catch (error) {
                errors.push(String(error && error.message ? error.message : error));
            }
        }
        throw Z.fail("HOST_ERROR", "QE addTransition failed: " + errors.join("; "));
    }

    Z.register("premiere_add_transition", function (args, ctx) {
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var sequence = found.sequence;
        var clip = found.clip;
        var at = Z.oneOf("at", Z.optional(args, "at", "string", "end"), ["end", "start", "both"]);
        var name = Z.optional(args, "transition", "string", DEFAULT_TRANSITION[found.kind]);
        var duration = Z.inRange("duration", Z.optional(args, "duration", "number", TASTE.timing.crossDissolve["default"]), 0, 30);
        var fps = P.fps(sequence);
        var frames = Math.max(1, Math.round(duration * fps));
        var snapped = frames / fps;
        var clipLength = P.timeToSeconds(clip.end) - P.timeToSeconds(clip.start);
        var edges = at === "both" ? ["start", "end"] : [at];
        var transition;
        var qeItem;
        var before = {};
        var added = [];
        var missing = [];
        var replaced = 0;
        var list;
        var half = Number(sequence.timebase) / 2;

        if (duration <= 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`duration` must be more than 0 s");
        }
        if (Math.abs(snapped - duration) >= 0.0005) {
            ctx.warn("Snapped the duration " + Z.round(duration) + " s to " + frames + " frames (" + Z.round(snapped) + " s)");
        }
        if (snapped * edges.length > clipLength + 0.0005) {
            throw Z.refuse("INVALID_ARGUMENT", "A " + Z.round(snapped, 3) + " s transition at " + (edges.length === 2 ? "both ends" : "the " + at) +
                " is longer than clip \"" + clip.name + "\" (" + Z.round(clipLength, 3) + " s)");
        }
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        transition = qeByName(found.kind, "transition", name);
        qeItem = qeItemFor(found, ctx);
        Z.each(transitionsOf(found.track), function (entry) {
            before[entry.key] = true;
        });
        ctx.changed();
        Z.each(edges, function (edge) {
            addTransitionAt(qeItem, transition, edge === "start", P.timecode(sequence, snapped), ctx);
        });
        // Each requested edge must now be covered by a transition with that name (an unnamed one counts): a
        // transition replaced at the same span is found too, and one left over from before with another
        // name is not mistaken for ours.
        list = transitionsOf(P.tracksOf(sequence, found.kind)[found.trackIndex]);
        Z.each(edges, function (edge) {
            var at = Number(edge === "start" ? clip.start.ticks : clip.end.ticks);
            /** @type {{name: string, start: number, end: number, key: string} | null} */
            var match = null;
            Z.each(list, function (entry) {
                if (!match && entry.start - half <= at && entry.end + half >= at && (!entry.name || entry.name.toLowerCase() === name.toLowerCase())) {
                    match = entry;
                }
            });
            if (!match) {
                missing.push(edge);
                return;
            }
            if (Z.has(before, match.key)) {
                replaced += 1;
            }
            added.push({
                edge: edge,
                name: match.name || name,
                start: Z.round(P.ticksToSeconds(match.start), 4),
                end: Z.round(P.ticksToSeconds(match.end), 4),
                duration: Z.round(P.ticksToSeconds(match.end - match.start), 4)
            });
        });
        if (added.length === 0) {
            throw Z.fail("HOST_ERROR", "Premiere did not add the " + name + " transition (QE addTransition returned without one)");
        }
        if (missing.length > 0) {
            ctx.warn("Premiere added no transition at the " + missing.join(" and ") + " of \"" + clip.name + "\"");
        }
        if (replaced > 0) {
            ctx.warn("A " + name + " of that length was already there; Premiere replaced it or left it as it was");
        }
        Z.each(added, function (entry) {
            if (Math.abs(entry.duration - snapped) * P.TICKS_PER_SECOND > half) {
                ctx.warn("Premiere made the transition at " + entry.start + " s " + entry.duration + " s long, not " + Z.round(snapped, 3) +
                    " s (the clips' media handles limit it)");
            }
        });
        return Z.applied("Added " + Z.plural(added.length, "transition") + " (" + name + ", " + Z.round(snapped, 3) + " s) at the " +
            (at === "both" ? "start and end" : at) + " of \"" + clip.name + "\"", {
            clip: clip.nodeId,
            transition: name,
            requested_duration: Z.round(snapped, 4),
            transitions: added
        }, edges.length);
    });

    // ------------------------------------------------------------------
    // premiere_apply_look

    /** Lumetri Color section headers, in panel order; parameters are found inside their section. */
    var LUMETRI_SECTIONS = ["Basic Correction", "Creative", "Curves", "Color Wheels & Match", "HSL Secondary", "Vignette"];

    /** Tint wheel targets for teal-orange, 0-255 RGB. */
    var TINTS = {teal: [0, 128, 128], orange: [255, 140, 0]};

    /** Share of the way a tint wheel moves from neutral toward its colour at strength 1. */
    var TINT_REACH = 0.35;

    /** The Lumetri parameters a look sets, scaled by strength (TASTE 5 values are deltas from neutral). */
    P.lookSettings = function (look, strength) {
        var values = TASTE.color.looks[look];
        var list = [];
        if (values.exposure !== undefined) {
            list.push({section: "Basic Correction", param: "Exposure", value: Z.round(values.exposure * strength, 4)});
        }
        if (values.temperature !== undefined) {
            list.push({section: "Basic Correction", param: "Temperature", value: Z.round(values.temperature * strength, 4)});
        }
        if (values.tint !== undefined) {
            list.push({section: "Basic Correction", param: "Tint", value: Z.round(values.tint * strength, 4)});
        }
        if (values.contrast !== undefined) {
            list.push({section: "Basic Correction", param: "Contrast", value: Z.round(values.contrast * strength, 4)});
        }
        if (values.saturation !== undefined) {
            list.push({section: "Basic Correction", param: "Saturation", value: Z.round(100 + values.saturation * strength, 4)});
        }
        if (values.fade !== undefined) {
            list.push({section: "Creative", param: "Faded Film", value: Z.round(values.fade * strength, 4)});
        }
        if (values.vibrance !== undefined) {
            list.push({section: "Creative", param: "Vibrance", value: Z.round(values.vibrance * strength, 4)});
        }
        if (values.shadowTint !== undefined) {
            list.push({section: "Creative", param: "Shadow Tint", tint: TINTS[values.shadowTint], reach: TINT_REACH * strength});
        }
        if (values.highlightTint !== undefined) {
            list.push({section: "Creative", param: "Highlight Tint", tint: TINTS[values.highlightTint], reach: TINT_REACH * strength});
        }
        if (values.vignette !== undefined) {
            list.push({section: "Vignette", param: "Amount", value: Z.round(values.vignette * strength, 4)});
        }
        return list;
    };

    /** A Lumetri parameter by display name inside its section (names repeat across sections); else the first match. */
    function lumetriParam(component, section, name) {
        var params = P.paramsOf(component);
        var start = -1;
        var end = params.length;
        var i;
        var label;
        for (i = 0; i < params.length; i += 1) {
            label = String(params[i].displayName);
            if (start < 0 && label === section) {
                start = i;
            } else if (start >= 0 && LUMETRI_SECTIONS.indexOf(label) >= 0) {
                end = i;
                break;
            }
        }
        for (i = start < 0 ? 0 : start + 1; i < (start < 0 ? params.length : end); i += 1) {
            if (String(params[i].displayName) === name) {
                return params[i];
            }
        }
        return null;
    }

    function lookTargets(args, ctx) {
        var ids = Z.optional(args, "clips", "array", null);
        var trackRef = Z.optional(args, "track", "object", null);
        var sequence;
        var targets = [];
        var selection;
        if (ids !== null) {
            Z.each(ids, function (id, i) {
                var found;
                if (typeof id !== "string") {
                    throw Z.refuse("INVALID_ARGUMENT", "`clips[" + i + "]` must be a clip nodeId");
                }
                found = P.findClip(id, args.sequence);
                if (found.kind !== "video") {
                    throw Z.refuse("INVALID_ARGUMENT", "Clip \"" + found.clip.name + "\" is audio; looks grade video clips");
                }
                targets.push(found);
            });
            return targets;
        }
        sequence = P.findSequence(args.sequence);
        if (trackRef !== null) {
            if (trackRef.kind !== "video") {
                throw Z.refuse("INVALID_ARGUMENT", "`track` must be a video track for a look");
            }
            P.findTrack(sequence, trackRef);
            Z.each(P.clipsOf(P.tracksOf(sequence, "video")[trackRef.index]), function (clip) {
                targets.push(P.refindClip(sequence, clip.nodeId));
            });
            if (targets.length === 0) {
                throw Z.refuse("INVALID_ARGUMENT", "Track " + P.trackLabel("video", trackRef.index) + " has no clips to grade");
            }
            return targets;
        }
        selection = typeof sequence.getSelection === "function" ? sequence.getSelection() || [] : [];
        Z.each(selection, function (clip) {
            var found = P.refindClip(sequence, clip.nodeId);
            if (found && found.kind === "video") {
                targets.push(found);
            }
        });
        if (targets.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "No video clips are selected; pass `clips` (nodeIds) or `track`");
        }
        ctx.warn("Graded the " + Z.plural(targets.length, "selected video clip"));
        return targets;
    }

    Z.register("premiere_apply_look", function (args, ctx) {
        var look = Z.oneOf("look", Z.required(args, "look", "string"), Object.keys(TASTE.color.looks));
        var strength = Z.inRange("strength", Z.optional(args, "strength", "number", TASTE.color.lookStrength), 0, 1);
        var targets = lookTargets(args, ctx);
        var settings = P.lookSettings(look, strength);
        var hasTints = Z.filter(settings, function (setting) { return Boolean(setting.tint); }).length > 0;
        var graded = [];
        var steps = 0;
        var lumetriEffect = null;
        var anySet = false;
        var plans;

        // Everything that can refuse happens before the first change: locks, the Lumetri effect, QE items.
        plans = Z.map(targets, function (found) {
            var lumetri = P.findComponent(found.clip, ["AE.ADBE Lumetri"], ["Lumetri Color"]);
            P.requireUnlocked(found.track, found.kind, found.trackIndex);
            if (lumetri) {
                return {found: found, lumetri: lumetri, qeItem: null};
            }
            if (lumetriEffect === null) {
                lumetriEffect = qeByName("video", "effect", "Lumetri Color");
            }
            return {found: found, lumetri: null, qeItem: qeItemFor(found, ctx)};
        });

        Z.each(plans, function (plan) {
            var found = plan.found;
            var lumetri = plan.lumetri;
            var set = {};
            var missing = [];
            if (!lumetri) {
                lumetri = P.addEffect(found, lumetriEffect, "Lumetri Color", ctx, plan.qeItem).component;
                steps += 1;
            } else if (hasTints) {
                ctx.warn("Lumetri was already on \"" + found.clip.name + "\": its tint wheels moved from their current colours, so re-applying " +
                    look + " strengthens the tint");
            }
            Z.each(settings, function (setting) {
                var param = lumetriParam(lumetri, setting.section, setting.param);
                var color;
                var mixed;
                if (!param) {
                    missing.push(setting.param);
                    return;
                }
                ctx.changed();
                if (setting.tint) {
                    color = param.getColorValue();
                    mixed = [];
                    mixed[0] = Math.round(Number(color[1]) + (setting.tint[0] - Number(color[1])) * setting.reach);
                    mixed[1] = Math.round(Number(color[2]) + (setting.tint[1] - Number(color[2])) * setting.reach);
                    mixed[2] = Math.round(Number(color[3]) + (setting.tint[2] - Number(color[3])) * setting.reach);
                    param.setColorValue(Number(color[0]), mixed[0], mixed[1], mixed[2], true);
                    set[setting.param] = mixed;
                } else {
                    param.setValue(setting.value, true);
                    set[setting.param] = setting.value;
                }
                anySet = true;
                steps += 1;
            });
            if (!anySet) {
                // Lumetri's names are the same on every clip: stop at the first one instead of adding Lumetri everywhere.
                throw Z.fail("UNSUPPORTED", "None of the Lumetri parameters (" + Z.map(settings, function (s) { return s.param; }).join(", ") +
                    ") were found by their English names on \"" + found.clip.name + "\"; Premiere may be running in another language");
            }
            if (missing.length > 0) {
                ctx.warn("Lumetri on \"" + found.clip.name + "\" has no " + missing.join(", ") + " (Lumetri names are English; another UI language?)");
            }
            graded.push({node_id: found.clip.nodeId, name: String(found.clip.name), added_lumetri: !plan.lumetri, set: set});
        });
        return Z.applied("Applied the " + look + " look at " + Math.round(strength * 100) + "% to " + Z.plural(graded.length, "clip"), {
            look: look,
            strength: strength,
            clips: graded
        }, steps);
    });
}(ZenviLink));
