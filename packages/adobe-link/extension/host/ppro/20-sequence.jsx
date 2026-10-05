// Zenvi Link: Premiere Pro sequence tools. premiere_get_sequence,
// premiere_create_sequence, premiere_open_sequence, premiere_add_marker.

(function (Z) {
    var P = Z.ppro;

    // ------------------------------------------------------------------
    // premiere_get_sequence

    function safe(fn, fallback) {
        try {
            return fn();
        } catch (error) {
            return fallback;
        }
    }

    /** One clip in detail; with `withProps` its effects, built-in values and animated properties. */
    P.clipDetail = function (sequence, clip, kind, trackIndex, withProps) {
        var speed = P.speedOf(clip);
        var item = safe(function () { return clip.projectItem; }, null);
        var start = P.sec(clip.start);
        var end = P.sec(clip.end);
        var data = {
            node_id: clip.nodeId,
            name: String(clip.name),
            track: {kind: kind, index: trackIndex},
            start: start,
            end: end,
            duration: start !== null && end !== null ? Z.round(end - start, 4) : null,
            in_point: P.sec(clip.inPoint),
            out_point: P.sec(clip.outPoint),
            media_path: item ? P.mediaPath(item) || null : null,
            item_id: item ? item.nodeId : null,
            enabled: clip.disabled !== true,
            speed: Z.round(speed.speed, 4),
            reversed: speed.reversed,
            selected: safe(function () { return clip.isSelected() === true; }, false)
        };
        var animated = [];
        var motion;
        var opacity;
        var volume;
        var param;
        if (!withProps) {
            return data;
        }
        data.effects = [];
        Z.each(P.componentsOf(clip), function (component) {
            if (!P.isIntrinsic(component)) {
                data.effects.push(String(component.displayName));
            }
            Z.each(P.paramsOf(component), function (p) {
                if (animated.length < 20 && P.isAnimated(p)) {
                    animated.push(String(component.displayName) + " > " + String(p.displayName));
                }
            });
        });
        data.animated = animated;
        if (kind === "video") {
            motion = P.motionOf(clip);
            opacity = P.opacityOf(clip);
            if (motion) {
                param = P.findParam(motion, ["Position"], P.MOTION_PARAMS.position[1]);
                data.position = param ? P.positionFromDom(sequence, P.valueOf(param)) : null;
                param = P.findParam(motion, ["Scale"], P.MOTION_PARAMS.scale[1]);
                data.scale = param ? Z.round(Number(P.valueOf(param)), 3) : null;
                param = P.findParam(motion, ["Rotation"], P.MOTION_PARAMS.rotation[1]);
                data.rotation = param ? Z.round(Number(P.valueOf(param)), 3) : null;
            }
            if (opacity) {
                param = P.findParam(opacity, ["Opacity"], P.OPACITY_PARAMS.opacity[1]);
                data.opacity = param ? Z.round(Number(P.valueOf(param)), 2) : null;
                param = P.findParam(opacity, ["Blend Mode"], P.OPACITY_PARAMS.blend[1]);
                data.blend_mode = param ? P.blendModeName(P.valueOf(param)) : null;
            }
        } else {
            volume = P.volumeOf(clip);
            param = volume ? P.findParam(volume, ["Level"], 1) : null;
            data.volume_db = param ? P.levelToDb(P.valueOf(param)) : null;
        }
        return data;
    };

    function markerColorName(marker) {
        var index = safe(function () {
            return typeof marker.getColorByIndex === "function" ? Number(marker.getColorByIndex()) : null;
        }, null);
        return index !== null && index >= 0 && index < P.MARKER_COLORS.length ? P.MARKER_COLORS[index] : null;
    }

    /** Markers of a MarkerCollection, in time order (at most `limit`). */
    P.markersOf = function (markers, limit) {
        var list = [];
        var marker;
        if (!markers || !markers.numMarkers) {
            return list;
        }
        marker = markers.getFirstMarker();
        while (marker && list.length < limit) {
            list.push({
                guid: marker.guid ? String(marker.guid) : null,
                start: P.sec(marker.start),
                end: P.sec(marker.end),
                name: String(marker.name || ""),
                comment: String(marker.comments || ""),
                type: String(marker.type || "Comment"),
                color: markerColorName(marker)
            });
            marker = markers.getNextMarker(marker);
        }
        return list;
    };

    Z.register("premiere_get_sequence", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var withProps = Z.optional(args, "include_properties", "boolean", true);
        var maxClips = Z.inRange("max_clips", Z.optional(args, "max_clips", "integer", 500), 1, 5000);
        var data = P.sequenceSummary(sequence);
        var tracks = [];
        var listed = 0;
        var total = 0;
        var kinds = ["video", "audio"];
        var k;
        var t;
        var group;
        var track;
        var entry;
        var transitions;
        var i;

        data.playhead = Z.round(P.timeToSeconds(sequence.getPlayerPosition()), 4);
        data.in_point = Z.round(P.timeToSeconds(sequence.getInPointAsTime()), 4);
        data.out_point = Z.round(P.timeToSeconds(sequence.getOutPointAsTime()), 4);
        data.active = P.activeSequence() !== null && P.activeSequence().sequenceID === sequence.sequenceID;

        for (k = 0; k < kinds.length; k += 1) {
            group = P.tracksOf(sequence, kinds[k]);
            for (t = 0; t < group.numTracks; t += 1) {
                track = group[t];
                entry = {
                    kind: kinds[k],
                    index: t,
                    label: P.trackLabel(kinds[k], t),
                    name: String(track.name),
                    muted: safe(function () { return track.isMuted() === true; }, false),
                    locked: P.isLocked(track),
                    targeted: safe(function () { return typeof track.isTargeted === "function" ? track.isTargeted() === true : null; }, null),
                    clips: [],
                    transitions: []
                };
                Z.each(P.clipsOf(track), function (clip) {
                    total += 1;
                    if (listed < maxClips) {
                        entry.clips.push(P.clipDetail(sequence, clip, entry.kind, entry.index, withProps));
                        listed += 1;
                    }
                });
                transitions = track.transitions;
                for (i = 0; transitions && i < transitions.numItems; i += 1) {
                    entry.transitions.push({
                        name: String(transitions[i].name || ""),
                        start: P.sec(transitions[i].start),
                        end: P.sec(transitions[i].end)
                    });
                }
                tracks.push(entry);
            }
        }
        data.tracks = tracks;
        data.markers = P.markersOf(sequence.markers, 500);
        data.clip_count = total;
        if (total > listed) {
            ctx.warn("Listed " + listed + " of " + total + " clips; raise `max_clips` to see the rest");
        }
        return Z.ok("Sequence \"" + sequence.name + "\": " + data.width + "x" + data.height + ", " + data.fps + " fps, " +
            Z.round(data.duration, 3) + " s, " + Z.plural(sequence.videoTracks.numTracks, "video track") + ", " +
            Z.plural(sequence.audioTracks.numTracks, "audio track") + ", " + Z.plural(total, "clip") + ", " +
            Z.plural(data.markers.length, "marker"), data);
    });

    // ------------------------------------------------------------------
    // premiere_create_sequence

    /** Frame size and rate per preset (catalog: PREMIERE_SEQUENCE_PRESETS). */
    P.SEQUENCE_PRESETS = {
        "1080p30": {width: 1920, height: 1080, fps: 30},
        "1080p25": {width: 1920, height: 1080, fps: 25},
        "1080p24": {width: 1920, height: 1080, fps: 24},
        "4k30": {width: 3840, height: 2160, fps: 30},
        "vertical": {width: 1080, height: 1920, fps: 30},
        "square": {width: 1080, height: 1080, fps: 30}
    };

    /** Sequence.videoDisplayFormat for whole frame rates (TIME_FORMAT: 24/25/30 Timecode). */
    var DISPLAY_FORMAT = {24: 100, 25: 101, 30: 104, 50: 105, 60: 108};

    /** Premiere's installed sequence presets (Settings/SequencePresets under the app). */
    P.sequencePresetFiles = function () {
        var resources = P.appResources();
        if (!resources) {
            return [];
        }
        return P.findFiles(new Folder(resources.fsName + "/Settings/SequencePresets"), function (name) {
            return /\.sqpreset$/i.test(name);
        }, 4, 1000);
    };

    /** How well a preset file name fits a target size and rate (higher is better). */
    function presetScore(name, target) {
        var lower = name.toLowerCase().replace(/\.sqpreset$/, "");
        var score = 0;
        var rate = new RegExp("(^|[^0-9.])" + target.fps + "(p|\\s*fps|[^0-9.]|$)");
        var big = target.width >= 3840 || target.height >= 3840;
        if (big ? /2160|4k|uhd/.test(lower) : /1080/.test(lower)) {
            score += 4;
        }
        if (rate.test(lower)) {
            score += 3;
        }
        if (/1080p|2160p|\bp\d|progressive/.test(lower)) {
            score += 1;
        }
        if (/1080i|2160i|interlaced|\bvr\b|anamorphic|\bdv\b|stereo/.test(lower)) {
            score -= 6;
        }
        return score;
    }

    /** The installed preset closest to `target`, or null when Premiere has none. */
    P.basePreset = function (target) {
        var files = P.sequencePresetFiles();
        var best = null;
        var bestScore = null;
        Z.each(files, function (file) {
            var score = presetScore(decodeURI(file.name), target);
            if (best === null || score > bestScore || (score === bestScore && file.fsName.length < best.fsName.length)) {
                best = file;
                bestScore = score;
            }
        });
        return best;
    };

    /** The sequence in `after` that is not in `before` (sequenceID maps); null when none. */
    P.newSequence = function (before) {
        var all = P.sequences();
        var i;
        for (i = all.length - 1; i >= 0; i -= 1) {
            if (!Z.has(before, all[i].sequenceID)) {
                return all[i];
            }
        }
        return null;
    };

    /**
     * Set a sequence's frame size (and rate, when target.fps is set) through its
     * settings, as PProPanel does (videoFrameRate is a Time of one frame).
     * Warns when Premiere keeps other values. Returns the number of changes.
     */
    P.applyFrame = function (sequence, target, ctx) {
        var settings = sequence.getSettings();
        var frameTicks = target.fps ? String(Math.round(P.TICKS_PER_SECOND / target.fps)) : null;
        var changed = false;
        if (settings.videoFrameWidth !== target.width || settings.videoFrameHeight !== target.height) {
            settings.videoFrameWidth = target.width;
            settings.videoFrameHeight = target.height;
            changed = true;
        }
        if (frameTicks !== null && String(settings.videoFrameRate.ticks) !== frameTicks) {
            settings.videoFrameRate.ticks = frameTicks;
            if (Z.has(DISPLAY_FORMAT, String(target.fps))) {
                settings.videoDisplayFormat = DISPLAY_FORMAT[target.fps];
            }
            changed = true;
        }
        if (!changed) {
            return 0;
        }
        sequence.setSettings(settings);
        if (sequence.frameSizeHorizontal !== target.width || sequence.frameSizeVertical !== target.height ||
                (frameTicks !== null && String(sequence.timebase) !== frameTicks)) {
            ctx.warn("Premiere kept " + sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical + " at " +
                Z.round(P.fps(sequence), 3) + " fps instead of " + target.width + "x" + target.height +
                (frameTicks !== null ? " at " + target.fps + " fps" : ""));
        }
        return 1;
    };

    Z.register("premiere_create_sequence", function (args, ctx) {
        var name = Z.optional(args, "name", "string", "Zenvi Sequence");
        var presetName = Z.oneOf("preset", Z.optional(args, "preset", "string", "1080p30"), Object.keys(P.SEQUENCE_PRESETS));
        var fromClips = Z.optional(args, "from_clips", "array", null);
        var binRef = Z.optional(args, "bin", "string", null);
        var open = Z.optional(args, "open", "boolean", true);
        var target = P.SEQUENCE_PRESETS[presetName];
        var created = [];
        var before;
        var sequence;
        var items;
        var bin;
        var preset = null;
        var steps = 0;
        var how;
        var previous = P.activeSequence();
        var active;

        P.requireProject();
        if (fromClips !== null) {
            P.requireFeature(typeof app.project.createNewSequenceFromClips === "function", "Project.createNewSequenceFromClips", "2020 (14.0)");
            items = Z.map(fromClips, function (id, i) {
                var item;
                if (typeof id !== "string") {
                    throw Z.refuse("INVALID_ARGUMENT", "`from_clips[" + i + "]` must be a project item nodeId");
                }
                item = P.findProjectItemByNodeId(id);
                if (P.isBin(item)) {
                    throw Z.refuse("INVALID_ARGUMENT", "`from_clips[" + i + "]` (" + item.name + ") is a bin, not a clip");
                }
                return item;
            });
        } else {
            if (typeof app.enableQE !== "function" && typeof app.project.newSequence !== "function") {
                throw Z.refuse("UNSUPPORTED", "This Premiere build cannot create a sequence from a preset by script (no QE DOM); pass `from_clips`");
            }
            preset = P.basePreset(target);
            if (!preset) {
                throw Z.refuse("UNSUPPORTED", "No sequence presets (.sqpreset) found under Premiere's Settings/SequencePresets" +
                    (app.path ? " in " + app.path : "") + "; pass `from_clips` instead");
            }
        }

        bin = binRef !== null ? P.findBin(binRef, true, ctx, created) : null;
        before = P.sequenceIds();
        ctx.changed();
        if (items) {
            sequence = app.project.createNewSequenceFromClips(name, items, bin || app.project.rootItem) || null;
            if (!sequence || !sequence.sequenceID) {
                sequence = P.newSequence(before);
            }
            how = "from " + Z.plural(items.length, "clip");
        } else {
            // Never app.project.createNewSequence: it opens the modal New Sequence dialog
            // (PProPanel uses qe.project.newSequence(name, presetPath) for presets).
            if (typeof app.enableQE === "function") {
                P.qe().project.newSequence(name, preset.fsName);
            } else {
                app.project.newSequence(name, preset.fsName);
            }
            sequence = P.newSequence(before);
            how = "from preset " + decodeURI(preset.name).replace(/\.sqpreset$/i, "");
        }
        if (!sequence) {
            throw Z.fail("HOST_ERROR", "Premiere did not create sequence \"" + name + "\"");
        }
        steps += 1 + created.length;
        if (!items) {
            steps += P.applyFrame(sequence, target, ctx);
        }
        if (bin && !items && sequence.projectItem && typeof sequence.projectItem.moveBin === "function") {
            sequence.projectItem.moveBin(bin);
            steps += 1;
        }
        if (open) {
            P.openSequence(sequence);
        } else if (previous && P.activeSequence() && P.activeSequence().sequenceID === sequence.sequenceID) {
            // Creating a sequence opens it; open: false puts the previous one back.
            P.openSequence(previous);
        }
        active = P.activeSequence() !== null && P.activeSequence().sequenceID === sequence.sequenceID;
        return Z.applied("Created sequence \"" + sequence.name + "\" (" + sequence.frameSizeHorizontal + "x" +
            sequence.frameSizeVertical + ", " + Z.round(P.fps(sequence), 3) + " fps) " + how +
            (active ? ", now the active sequence" : ""), {
            sequence: P.sequenceSummary(sequence),
            preset: items ? null : presetName,
            base_preset: preset ? preset.fsName : null,
            created_bins: created,
            active: active
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_open_sequence

    Z.register("premiere_open_sequence", function (args, ctx) {
        var sequence = P.findSequence(Z.required(args, "sequence", "string"));
        var active = P.activeSequence();
        if (active && active.sequenceID === sequence.sequenceID) {
            return Z.unchanged("Sequence \"" + sequence.name + "\" is already active", P.sequenceSummary(sequence));
        }
        ctx.changed();
        app.project.openSequence(sequence.sequenceID);
        active = P.activeSequence();
        if (!active || active.sequenceID !== sequence.sequenceID) {
            throw Z.fail("HOST_ERROR", "Premiere did not open sequence \"" + sequence.name + "\"");
        }
        return Z.applied("Opened sequence \"" + sequence.name + "\"", P.sequenceSummary(sequence), 0);
    });

    // ------------------------------------------------------------------
    // premiere_add_marker

    /** Marker colours by Premiere's colour index (Marker.setColorByIndex; scripting guide). */
    P.MARKER_COLORS = ["green", "red", "purple", "orange", "yellow", "white", "blue", "cyan"];

    Z.register("premiere_add_marker", function (args, ctx) {
        var name = Z.optional(args, "name", "string", "");
        var comment = Z.optional(args, "comment", "string", "");
        var duration = Z.inRange("duration", Z.optional(args, "duration", "number", 0), 0, 86400);
        var color = Z.optional(args, "color", "string", null);
        var type = Z.oneOf("type", Z.optional(args, "type", "string", "comment"), ["comment", "chapter", "segmentation"]);
        var clipRef = Z.optional(args, "clip", "string", null);
        var found = null;
        var sequence;
        var time;
        var at;
        var markers;
        var marker;
        var clipStart;
        var clipEnd;
        var where;
        var steps = 1;

        if (color !== null) {
            Z.oneOf("color", color, P.MARKER_COLORS);
        }
        if (clipRef !== null) {
            found = P.findClip(clipRef, args.sequence);
            sequence = found.sequence;
        } else {
            sequence = P.findSequence(args.sequence);
        }
        time = Z.optional(args, "time", "number", null);
        time = time === null ? P.timeToSeconds(sequence.getPlayerPosition()) : Z.inRange("time", time, 0, null);
        time = P.snapTime(sequence, time, ctx, "time");
        at = time;
        if (found) {
            clipStart = P.timeToSeconds(found.clip.start);
            clipEnd = P.timeToSeconds(found.clip.end);
            if (time < clipStart - 0.0005 || time >= clipEnd) {
                throw Z.refuse("INVALID_ARGUMENT", "Time " + Z.round(time) + " s is outside clip \"" + found.clip.name + "\" (" +
                    Z.round(clipStart) + "-" + Z.round(clipEnd) + " s)");
            }
            if (!found.clip.projectItem || typeof found.clip.projectItem.getMarkers !== "function") {
                throw Z.refuse("UNSUPPORTED", "Clip \"" + found.clip.name + "\" has no source item to hold markers");
            }
            if (Math.abs(P.speedOf(found.clip).speed - 1) > 0.0001 || P.speedOf(found.clip).reversed) {
                ctx.warn("The clip is retimed; the marker lands at the source time of an unretimed clip");
            }
            at = P.timeToSeconds(found.clip.inPoint) + (time - clipStart);
            markers = found.clip.projectItem.getMarkers();
            where = "clip \"" + found.clip.name + "\"";
        } else {
            markers = sequence.markers;
            where = "sequence \"" + sequence.name + "\"";
        }

        ctx.changed();
        marker = markers.createMarker(at);
        if (!marker) {
            throw Z.fail("HOST_ERROR", "Premiere did not create the marker");
        }
        if (name) {
            marker.name = name;
        }
        if (comment) {
            marker.comments = comment;
        }
        if (duration > 0) {
            // Marker.end takes seconds, not a Time (scripting guide, Marker.end).
            /** @type {any} */ (marker).end = at + duration;
        }
        if (type === "chapter") {
            marker.setTypeAsChapter();
        } else if (type === "segmentation") {
            marker.setTypeAsSegmentation();
        }
        if (color !== null) {
            if (typeof marker.setColorByIndex === "function") {
                marker.setColorByIndex(P.MARKER_COLORS.indexOf(color));
            } else {
                ctx.warn("This Premiere build cannot colour markers by script (Marker.setColorByIndex); the marker kept its default colour");
            }
        }
        return Z.applied("Added " + (type === "comment" ? "a" : "a " + type) + " marker" + (name ? " \"" + name + "\"" : "") +
            " at " + Z.round(time, 3) + " s" + (duration > 0 ? " for " + Z.round(duration, 3) + " s" : "") + " on " + where, {
            marker: {
                guid: marker.guid ? String(marker.guid) : null,
                time: Z.round(time, 4),
                source_time: found ? Z.round(at, 4) : null,
                duration: Z.round(duration, 4),
                name: name,
                comment: comment,
                type: type,
                color: color
            },
            target: found ? "clip" : "sequence",
            clip: found ? found.clip.nodeId : null,
            sequence_id: sequence.sequenceID
        }, steps);
    });
}(ZenviLink));
