// Zenvi Link: Premiere Pro's assisted edits. premiere_auto_reframe,
// premiere_scene_detect.

(function (Z) {
    var P = Z.ppro;

    // ------------------------------------------------------------------
    // premiere_auto_reframe

    var ASPECTS = {"9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "16:9": [16, 9]};

    function even(value) {
        return Math.round(value / 2) * 2;
    }

    /** The reframed frame size: keep the source's short side (1080p -> 1080x1920 for 9:16). */
    P.reframeSize = function (sequence, ratio) {
        var shortSide = Math.min(sequence.frameSizeHorizontal, sequence.frameSizeVertical);
        if (ratio[0] <= ratio[1]) {
            return {width: shortSide, height: even(shortSide * ratio[1] / ratio[0])};
        }
        return {width: even(shortSide * ratio[0] / ratio[1]), height: shortSide};
    };

    Z.register("premiere_auto_reframe", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var aspect = Z.oneOf("aspect", Z.optional(args, "aspect", "string", "9:16"), Object.keys(ASPECTS));
        var motion = Z.oneOf("motion", Z.optional(args, "motion", "string", "default"), ["default", "slower", "faster"]);
        var nest = Z.optional(args, "nest", "boolean", false);
        var open = Z.optional(args, "open", "boolean", true);
        var name = Z.optional(args, "name", "string", sequence.name + " " + aspect.replace(":", "x"));
        var ratio = ASPECTS[aspect];
        var size = P.reframeSize(sequence, ratio);
        var before;
        var created;
        var steps = 1;
        P.requireFeature(typeof sequence.autoReframeSequence === "function", "Auto Reframe (Sequence.autoReframeSequence)", "2020 (14.0)");
        if (typeof sequence.isDoneAnalyzingForVideoEffects === "function" && sequence.isDoneAnalyzingForVideoEffects() === false) {
            throw Z.refuse("BUSY", "Premiere is still analysing \"" + sequence.name + "\" for video effects; try again in a moment");
        }
        before = P.sequenceIds();
        ctx.changed();
        created = sequence.autoReframeSequence(ratio[0], ratio[1], motion, name, nest);
        if (!created || !created.sequenceID) {
            created = P.newSequence(before);
        }
        if (!created) {
            throw Z.fail("HOST_ERROR", "Premiere did not create the reframed sequence");
        }
        // Auto Reframe keeps the source height (9:16 of 1080p gives 608x1080); setting the frame size
        // afterwards is honoured and Premiere refits the reframe (premiere-pro-mcp, Premiere 25.2).
        if (created.frameSizeHorizontal !== size.width || created.frameSizeVertical !== size.height) {
            steps += P.applyFrame(created, {width: size.width, height: size.height, fps: 0}, ctx);
        }
        if (open) {
            P.openSequence(created);
        }
        return Z.applied("Auto-reframed \"" + sequence.name + "\" to " + aspect + " as \"" + created.name + "\" (" +
            created.frameSizeHorizontal + "x" + created.frameSizeVertical + ")" + (open ? " and opened it" : ""), {
            sequence: P.sequenceSummary(created),
            source_sequence_id: sequence.sequenceID,
            aspect: aspect,
            motion: motion
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_scene_detect

    var SENSITIVITY = {low: "LowSensitivity", medium: "MediumSensitivity", high: "HighSensitivity"};

    function selectedIds(sequence) {
        var ids = [];
        var selection = typeof sequence.getSelection === "function" ? sequence.getSelection() || [] : [];
        var i;
        for (i = 0; i < selection.length; i += 1) {
            ids.push(selection[i].nodeId);
        }
        return ids;
    }

    /** Select exactly the clips with these nodeIds (deselecting every other clip). */
    function selectOnly(sequence, ids) {
        var kinds = ["video", "audio"];
        var k;
        var t;
        var tracks;
        for (k = 0; k < kinds.length; k += 1) {
            tracks = P.tracksOf(sequence, kinds[k]);
            for (t = 0; t < tracks.numTracks; t += 1) {
                Z.each(P.clipsOf(tracks[t]), function (clip) {
                    var want = ids.indexOf(clip.nodeId) >= 0;
                    if (clip.isSelected() !== want) {
                        clip.setSelected(want, true);
                    }
                });
            }
        }
    }

    function markerCount(item) {
        try {
            return item && typeof item.getMarkers === "function" ? Number(item.getMarkers().numMarkers) : 0;
        } catch (error) {
            return 0;
        }
    }

    Z.register("premiere_scene_detect", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var ref = Z.optional(args, "track", "object", {kind: "video", index: 0});
        var ids = Z.optional(args, "clips", "array", null);
        var action = Z.oneOf("action", Z.optional(args, "action", "string", "cuts"), ["cuts", "markers"]);
        var sensitivity = Z.oneOf("sensitivity", Z.optional(args, "sensitivity", "string", "medium"), Object.keys(SENSITIVITY));
        var linkedAudio = Z.optional(args, "include_linked_audio", "boolean", true);
        var track;
        var detect = null;
        var targets = [];
        var previous;
        var beforeClips;
        var beforeMarkers = [];
        var newClips = 0;
        var newMarkers = 0;
        var afterClips;

        if (ref.kind !== "video") {
            throw Z.refuse("INVALID_ARGUMENT", "Scene Edit Detection runs on video tracks; `track` must be {kind: \"video\", index}");
        }
        track = P.findTrack(sequence, ref);
        P.requireUnlocked(track, ref.kind, ref.index);
        if (typeof sequence.performSceneEditDetectionOnSelection === "function") {
            detect = "performSceneEditDetectionOnSelection";
        } else if (typeof sequence.performCutDetectionOnSelection === "function") {
            // types-for-adobe names it this way; the scripting guide and PProPanel use the name above.
            detect = "performCutDetectionOnSelection";
        }
        P.requireFeature(detect !== null, "Scene Edit Detection (Sequence.performSceneEditDetectionOnSelection)", "2020 (14.0)");
        if (ids !== null) {
            Z.each(ids, function (id, i) {
                var found = P.refindClip(sequence, id);
                if (typeof id !== "string" || !found) {
                    throw Z.refuse("NOT_FOUND", "`clips[" + i + "]` is not a clip of sequence \"" + sequence.name + "\"");
                }
                if (found.kind !== ref.kind || found.trackIndex !== ref.index) {
                    throw Z.refuse("INVALID_ARGUMENT", "Clip \"" + found.clip.name + "\" is on " + P.trackLabel(found.kind, found.trackIndex) +
                        ", not " + P.trackLabel(ref.kind, ref.index));
                }
                targets.push(found.clip);
            });
        } else {
            targets = P.clipsOf(track);
        }
        if (targets.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "Track " + P.trackLabel(ref.kind, ref.index) + " has no clips to analyse");
        }

        previous = selectedIds(sequence);
        beforeClips = P.clipIds(sequence);
        Z.each(targets, function (clip) {
            beforeMarkers.push({item: clip.projectItem, count: markerCount(clip.projectItem)});
        });
        ctx.changed();
        try {
            selectOnly(sequence, Z.map(targets, function (clip) { return clip.nodeId; }));
            if (detect === "performSceneEditDetectionOnSelection") {
                sequence.performSceneEditDetectionOnSelection(action === "cuts" ? "ApplyCuts" : "CreateMarkers", linkedAudio, SENSITIVITY[sensitivity]);
            } else {
                sequence.performCutDetectionOnSelection(action === "cuts" ? "ApplyCuts" : "CreateMarkers", linkedAudio, SENSITIVITY[sensitivity]);
            }
        } finally {
            try {
                selectOnly(sequence, Z.filter(previous, function (id) { return P.refindClip(sequence, id) !== null; }));
            } catch (restoreError) {
                ctx.warn("Could not restore the previous clip selection");
            }
        }
        afterClips = P.clipIds(sequence);
        Z.each(Object.keys(afterClips), function (id) {
            if (!Z.has(beforeClips, id)) {
                newClips += 1;
            }
        });
        Z.each(beforeMarkers, function (entry) {
            newMarkers += Math.max(0, markerCount(entry.item) - entry.count);
        });
        if (action === "markers") {
            ctx.warn("Premiere puts Scene Edit Detection markers on the source items (clip markers), and adds them again on every run");
        }
        return Z.applied("Scene Edit Detection on " + Z.plural(targets.length, "clip") + " of " + P.trackLabel(ref.kind, ref.index) + ": " +
            (action === "cuts" ? Z.plural(newClips, "new clip") + " from the cuts" : Z.plural(newMarkers, "marker")), {
            track: {kind: ref.kind, index: ref.index},
            analysed: Z.map(targets, function (clip) { return clip.nodeId; }),
            action: action,
            sensitivity: sensitivity,
            new_clips: newClips,
            new_markers: newMarkers
        }, action === "cuts" ? newClips : newMarkers);
    });
}(ZenviLink));
