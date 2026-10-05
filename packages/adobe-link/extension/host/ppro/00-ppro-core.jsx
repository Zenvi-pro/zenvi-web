// Zenvi Link: Premiere Pro host core. The helpers every premiere_* tool uses
// (ZenviLink.ppro), the adapter, and premiere_get_state.
//
// IDs (SPEC 3.3): project items and track items by nodeId, sequences by
// sequenceID, tracks by {kind: "video" | "audio", index} (0-based like the
// DOM). Times are sequence seconds; the DOM counts in ticks.
//
// Undo: Premiere's ExtendScript DOM has no undo grouping; every DOM change is
// its own undo step. Mutating tools pass the number of changes they made to
// ZenviLink.applied(summary, data, undoSteps) when they know it.

(function (Z) {
    var P = {};
    Z.ppro = P;
    Z.host = "premiere";

    Z.adapter = {
        undoStepsWhenApplied: null,
        runMutating: function (title, fn) {
            return fn();
        },
        partialChangeWarning: function (title) {
            return "The call failed after it had started changing the project (" + title +
                "); Premiere records each change as its own undo step.";
        },
        info: function () {
            return {app_version: String(app.version), project: P.projectPath()};
        }
    };

    /** Premiere's time unit: 254016000000 ticks per second. */
    P.TICKS_PER_SECOND = 254016000000;

    var qeEnabled = false;

    /** The QE DOM (undocumented, used for razor, effects, transitions, speed). Enabled once. */
    P.qe = function () {
        if (!qeEnabled) {
            app.enableQE();
            qeEnabled = true;
        }
        return qe;
    };

    // ------------------------------------------------------------------
    // Project.

    P.projectPath = function () {
        return app.project && app.project.path ? String(app.project.path) : null;
    };

    P.requireProject = function () {
        if (!app.project || !app.project.rootItem || (typeof app.isDocumentOpen === "function" && !app.isDocumentOpen())) {
            throw Z.refuse("NO_PROJECT", "No Premiere Pro project is open");
        }
        return app.project;
    };

    /** The project item with this nodeId (searched through every bin); refuses NOT_FOUND. */
    P.findProjectItemByNodeId = function (nodeId) {
        var project = P.requireProject();
        var found = null;
        function walk(item) {
            var i;
            if (found) {
                return;
            }
            if (item.nodeId === nodeId) {
                found = item;
                return;
            }
            if (item.children) {
                for (i = 0; i < item.children.numItems; i += 1) {
                    walk(item.children[i]);
                }
            }
        }
        walk(project.rootItem);
        if (!found) {
            throw Z.refuse("NOT_FOUND", "No project item has nodeId " + String(nodeId) + " (premiere_list_items lists them)");
        }
        return found;
    };

    // ------------------------------------------------------------------
    // Sequences.

    P.activeSequence = function () {
        return app.project ? app.project.activeSequence || null : null;
    };

    P.requireActiveSequence = function () {
        var sequence;
        P.requireProject();
        sequence = P.activeSequence();
        if (!sequence) {
            throw Z.refuse("NO_ACTIVE_SEQUENCE", "No sequence is active; open one or pass `sequence` (an id from premiere_get_state)");
        }
        return sequence;
    };

    /** Every sequence in the project, as an array. */
    P.sequences = function () {
        var list = [];
        var all = P.requireProject().sequences;
        var i;
        for (i = 0; i < all.numSequences; i += 1) {
            list.push(all[i]);
        }
        return list;
    };

    /**
     * A sequence from a tool's `sequence` argument: undefined/null = the active
     * sequence, a string = sequenceID, else exact name (refused when ambiguous).
     */
    P.findSequence = function (ref) {
        var all;
        var matches;
        var i;
        if (ref === undefined || ref === null) {
            return P.requireActiveSequence();
        }
        if (typeof ref !== "string" || ref.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`sequence` must be a sequence id or an exact sequence name");
        }
        all = P.sequences();
        for (i = 0; i < all.length; i += 1) {
            if (all[i].sequenceID === ref) {
                return all[i];
            }
        }
        matches = Z.filter(all, function (sequence) { return sequence.name === ref; });
        if (matches.length === 1) {
            return matches[0];
        }
        if (matches.length === 0) {
            throw Z.refuse("NOT_FOUND", "No sequence has id or name \"" + ref + "\"");
        }
        throw Z.refuse("INVALID_ARGUMENT", matches.length + " sequences are named \"" + ref + "\"; pass the sequence id");
    };

    /** Frames per second of a sequence (from its timebase, ticks per frame). */
    P.fps = function (sequence) {
        return P.TICKS_PER_SECOND / Number(sequence.timebase);
    };

    // ------------------------------------------------------------------
    // Time.

    P.ticksToSeconds = function (ticks) {
        return Number(ticks) / P.TICKS_PER_SECOND;
    };

    /** Whole ticks as the string the DOM expects. */
    P.secondsToTicks = function (seconds) {
        return String(Math.round(seconds * P.TICKS_PER_SECOND));
    };

    /** A Time object (ticks are exact; seconds is a float view). */
    P.timeFromSeconds = function (seconds) {
        var time = new Time();
        time.ticks = P.secondsToTicks(seconds);
        return time;
    };

    P.timeToSeconds = function (time) {
        return time ? P.ticksToSeconds(time.ticks) : null;
    };

    /** `seconds` snapped to the sequence frame grid (warns in ctx when it moved). */
    P.snapTime = function (sequence, seconds, ctx, label) {
        return Z.snapToFrame(seconds, P.fps(sequence), ctx, label);
    };

    // ------------------------------------------------------------------
    // Tracks and clips.

    /** A track from {kind: "video" | "audio", index} (0-based); refuses NOT_FOUND. */
    P.findTrack = function (sequence, ref) {
        var tracks;
        if (!Z.isObject(ref) || (ref.kind !== "video" && ref.kind !== "audio") ||
                typeof ref.index !== "number" || Math.floor(ref.index) !== ref.index || ref.index < 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`track` must be {kind: \"video\" | \"audio\", index: 0-based integer}");
        }
        tracks = ref.kind === "video" ? sequence.videoTracks : sequence.audioTracks;
        if (ref.index >= tracks.numTracks) {
            throw Z.refuse("NOT_FOUND", "Sequence \"" + sequence.name + "\" has " + Z.plural(tracks.numTracks, ref.kind + " track") +
                "; there is no index " + ref.index + " (" + (ref.kind === "video" ? "V" : "A") + (ref.index + 1) + ")");
        }
        return tracks[ref.index];
    };

    /** {kind, index} of the track holding the track item with this nodeId, or null. */
    P.trackOf = function (sequence, nodeId) {
        var kinds = ["video", "audio"];
        var k;
        var t;
        var c;
        var tracks;
        var clips;
        for (k = 0; k < kinds.length; k += 1) {
            tracks = kinds[k] === "video" ? sequence.videoTracks : sequence.audioTracks;
            for (t = 0; t < tracks.numTracks; t += 1) {
                clips = tracks[t].clips;
                for (c = 0; c < clips.numItems; c += 1) {
                    if (clips[c].nodeId === nodeId) {
                        return {kind: kinds[k], index: t};
                    }
                }
            }
        }
        return null;
    };

    P.sequenceSummary = function (sequence) {
        return {
            sequence_id: sequence.sequenceID,
            name: sequence.name,
            node_id: sequence.projectItem ? sequence.projectItem.nodeId : null,
            duration: Z.round(P.ticksToSeconds(sequence.end), 4),
            width: sequence.frameSizeHorizontal,
            height: sequence.frameSizeVertical,
            fps: Z.round(P.fps(sequence), 3),
            video_tracks: sequence.videoTracks.numTracks,
            audio_tracks: sequence.audioTracks.numTracks
        };
    };

    P.clipSummary = function (sequence, clip) {
        return {
            node_id: clip.nodeId,
            name: clip.name,
            track: P.trackOf(sequence, clip.nodeId),
            start: Z.round(P.timeToSeconds(clip.start), 4),
            end: Z.round(P.timeToSeconds(clip.end), 4)
        };
    };

    // ------------------------------------------------------------------
    // premiere_get_state

    Z.register("premiere_get_state", function (args, ctx) {
        var project = P.requireProject();
        var sequences = P.sequences();
        var active = P.activeSequence();
        var listed = Z.map(sequences.slice(0, 100), P.sequenceSummary);
        var activeData = null;
        var parts = [];
        var selection;
        if (sequences.length > listed.length) {
            ctx.warn("Listed the first " + listed.length + " of " + sequences.length + " sequences");
        }
        if (active) {
            selection = typeof active.getSelection === "function" ? active.getSelection() || [] : [];
            activeData = P.sequenceSummary(active);
            activeData.playhead = Z.round(P.timeToSeconds(active.getPlayerPosition()), 4);
            activeData.in_point = typeof active.getInPointAsTime === "function" ? Z.round(P.timeToSeconds(active.getInPointAsTime()), 4) : null;
            activeData.out_point = typeof active.getOutPointAsTime === "function" ? Z.round(P.timeToSeconds(active.getOutPointAsTime()), 4) : null;
            activeData.selection = Z.map(selection, function (clip) {
                return P.clipSummary(active, clip);
            });
        }

        parts.push("Premiere Pro " + app.version);
        parts.push(project.path ? "project \"" + project.name + "\"" : "unsaved project");
        parts.push(Z.plural(sequences.length, "sequence"));
        parts.push(active ? "active sequence \"" + active.name + "\" (" + activeData.width + "x" + activeData.height + ", " +
            activeData.fps + " fps, " + Z.round(activeData.duration, 3) + " s, playhead " + Z.round(activeData.playhead, 3) + " s)" : "no active sequence");
        if (activeData && activeData.selection.length > 0) {
            parts.push(Z.plural(activeData.selection.length, "clip") + " selected");
        }

        return Z.ok(parts.join(", "), {
            app: {name: "Adobe Premiere Pro", version: String(app.version), build: app.build ? String(app.build) : null},
            project: {path: P.projectPath(), name: project.name ? String(project.name) : null},
            sequences: listed,
            active_sequence: activeData
        });
    });
}(ZenviLink));
