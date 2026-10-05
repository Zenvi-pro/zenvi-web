// Zenvi Link: Premiere Pro host core. The helpers every premiere_* tool uses
// (ZenviLink.ppro), the adapter, and premiere_get_state.
//
// IDs (SPEC 3.3): project items and track items by nodeId, sequences by
// sequenceID, tracks by {kind: "video" | "audio", index} (0-based like the
// DOM). Times are sequence seconds; the DOM counts in ticks.
//
// Undo: Premiere's ExtendScript DOM has no undo grouping; every DOM change is
// its own undo step. The adapter measures how far Premiere's undo stack moved
// during a mutating call (QE qe.project.undoStackIndex(), when this build has
// it) and reports that as undoSteps; otherwise a tool passes the number of
// changes it made to ZenviLink.applied(summary, data, undoSteps).
//
// References for DOM details used here: the Premiere Pro Scripting Guide
// (ppro-scripting.docsforadobe.dev), Adobe's PProPanel sample
// (Adobe-CEP/Samples, PProPanel/jsx/PPRO/Premiere.jsx) and types-for-adobe
// Premiere/24.0. QE DOM details are not documented by Adobe; each use says
// what it relies on (docs/PREMIERE_PRO.md lists them).

(function (Z) {
    var P = {};
    Z.ppro = P;
    Z.host = "premiere";

    /** Premiere's time unit: 254016000000 ticks per second. */
    P.TICKS_PER_SECOND = 254016000000;

    var qeEnabled = false;

    // ------------------------------------------------------------------
    // QE DOM (undocumented; used for razor, effects, transitions, speed,
    // frame export, sequence presets and the undo stack position).

    /** The QE DOM, enabled once. Refuses UNSUPPORTED when this build has none. */
    P.qe = function () {
        if (!qeEnabled) {
            if (!Z.hasMethod(app, "enableQE")) {
                throw Z.refuse("UNSUPPORTED", "This Premiere Pro build has no QE DOM (app.enableQE)");
            }
            app.enableQE();
            qeEnabled = true;
        }
        if (typeof qe === "undefined" || !qe || !qe.project) {
            throw Z.fail("UNSUPPORTED", "The QE DOM did not load (qe.project is missing)");
        }
        return qe;
    };

    /**
     * Premiere's undo stack position (qe.project.undoStackIndex(), which moves
     * by one per undoable step), or null when this build does not report it.
     */
    P.undoIndex = function () {
        var value;
        try {
            if (!Z.hasMethod(app, "enableQE")) {
                return null;
            }
            if (!qeEnabled) {
                app.enableQE();
                qeEnabled = true;
            }
            if (typeof qe === "undefined" || !qe || !qe.project || !Z.hasMethod(qe.project, "undoStackIndex")) {
                return null;
            }
            value = Number(qe.project.undoStackIndex());
        } catch (error) {
            return null;
        }
        return isFinite(value) ? value : null;
    };

    function undoDelta(before) {
        var after;
        if (before === null) {
            return null;
        }
        after = P.undoIndex();
        return after !== null && after > before ? after - before : null;
    }

    Z.adapter = {
        undoStepsWhenApplied: null,
        runMutating: function (title, fn) {
            var before = P.undoIndex();
            var outcome;
            var measured;
            Z.adapter.undoStepsWhenApplied = null;
            try {
                outcome = fn();
            } catch (error) {
                // A failure after a change: report what the undo stack says, else unknown.
                Z.adapter.undoStepsWhenApplied = undoDelta(before);
                throw error;
            }
            if (outcome && outcome.zenviResult === true && outcome.status === "applied") {
                measured = undoDelta(before);
                if (measured !== null) {
                    outcome.undoSteps = measured;
                }
            }
            return outcome;
        },
        partialChangeWarning: function (title) {
            return "The call failed after it had started changing the project (" + title +
                "); Premiere records each change as its own undo step.";
        },
        info: function () {
            return {app_version: String(app.version), project: P.projectPath()};
        }
    };

    // ------------------------------------------------------------------
    // Versions and platform.

    /** Major version of Premiere Pro ("25.2.1" -> 25; 0 when unknown). */
    P.majorVersion = function () {
        var match = /^(\d+)/.exec(String(app.version));
        return match ? parseInt(match[1], 10) : 0;
    };

    /** Refuses UNSUPPORTED naming the feature and the first version that has it. */
    P.requireFeature = function (available, feature, minimum) {
        if (!available) {
            throw Z.refuse("UNSUPPORTED", feature + " is not available in Premiere Pro " + String(app.version) +
                " (it needs Premiere Pro " + minimum + " or later)");
        }
    };

    P.isWindows = function () {
        return String($.os).indexOf("Windows") >= 0 || Folder.fs === "Windows";
    };

    // ------------------------------------------------------------------
    // Project.

    P.projectPath = function () {
        try {
            return app.project && app.project.path ? String(app.project.path) : null;
        } catch (error) {
            // macOS can throw while Premiere shuts down (types-for-adobe Project.path note).
            return null;
        }
    };

    P.requireProject = function () {
        if (!app.project || !app.project.rootItem || (Z.hasMethod(app, "isDocumentOpen") && !app.isDocumentOpen())) {
            throw Z.refuse("NO_PROJECT", "No Premiere Pro project is open");
        }
        return app.project;
    };

    /** ProjectItemType.BIN etc. (numbers; PProPanel compares item.type === 2 for bins). */
    P.itemType = function (name) {
        var fallback = {CLIP: 1, BIN: 2, ROOT: 3, FILE: 4};
        if (typeof ProjectItemType !== "undefined" && ProjectItemType && typeof ProjectItemType[name] === "number") {
            return ProjectItemType[name];
        }
        return fallback[name];
    };

    P.isBin = function (item) {
        return item.type === P.itemType("BIN") || item.type === P.itemType("ROOT");
    };

    /** Children of a bin as an array. */
    P.children = function (item) {
        var list = [];
        var i;
        if (!item || !item.children) {
            return list;
        }
        for (i = 0; i < item.children.numItems; i += 1) {
            list.push(item.children[i]);
        }
        return list;
    };

    /**
     * Depth-first walk from `root` in project panel order. visit(item, depth,
     * binPath) returns false to stop the walk.
     */
    P.walkItems = function (root, visit) {
        var stopped = false;
        function walk(item, depth, path) {
            var kids;
            var i;
            if (stopped) {
                return;
            }
            kids = P.children(item);
            for (i = 0; i < kids.length && !stopped; i += 1) {
                if (visit(kids[i], depth, path) === false) {
                    stopped = true;
                    return;
                }
                if (P.isBin(kids[i])) {
                    walk(kids[i], depth + 1, path ? path + "/" + kids[i].name : String(kids[i].name));
                }
            }
        }
        walk(root, 0, "");
    };

    /** The project item with this nodeId (searched through every bin); refuses NOT_FOUND. */
    P.findProjectItemByNodeId = function (nodeId) {
        var project = P.requireProject();
        var found = null;
        if (project.rootItem.nodeId === nodeId) {
            return project.rootItem;
        }
        P.walkItems(project.rootItem, function (item) {
            if (item.nodeId === nodeId) {
                found = item;
                return false;
            }
            return true;
        });
        if (!found) {
            throw Z.refuse("NOT_FOUND", "No project item has nodeId " + String(nodeId) + " (premiere_list_items lists them)");
        }
        return found;
    };

    /** Bin path segments from "A/B", "\\A\\B" or "/" (root). */
    function binSegments(path) {
        return Z.filter(String(path).replace(/\\/g, "/").split("/"), function (part) {
            return Z.trim(part).length > 0;
        });
    }

    /**
     * A bin by nodeId or by path from the project root ("Footage/Day 1", "/" =
     * root). With `create`, missing bins are created (ctx.changed() first) and
     * counted in `created`. Refuses NOT_FOUND otherwise.
     */
    P.findBin = function (ref, create, ctx, created) {
        var project = P.requireProject();
        var segments;
        var current = project.rootItem;
        var i;
        var j;
        var kids;
        var next;
        var byId = null;
        if (ref === undefined || ref === null || binSegments(ref).length === 0) {
            return current;
        }
        P.walkItems(project.rootItem, function (item) {
            if (item.nodeId === ref && P.isBin(item)) {
                byId = item;
                return false;
            }
            return true;
        });
        if (byId) {
            return byId;
        }
        segments = binSegments(ref);
        for (i = 0; i < segments.length; i += 1) {
            kids = P.children(current);
            next = null;
            for (j = 0; j < kids.length; j += 1) {
                if (P.isBin(kids[j]) && kids[j].name === segments[i]) {
                    next = kids[j];
                    break;
                }
            }
            if (!next) {
                if (!create) {
                    throw Z.refuse("NOT_FOUND", "No bin \"" + segments.slice(0, i + 1).join("/") + "\" in the project");
                }
                if (ctx) {
                    ctx.changed();
                }
                next = current.createBin(segments[i]);
                if (!next) {
                    throw Z.fail("HOST_ERROR", "Premiere did not create the bin \"" + segments[i] + "\"");
                }
                if (created) {
                    created.push(segments.slice(0, i + 1).join("/"));
                }
            }
            current = next;
        }
        return current;
    };

    /** A media path normalised for comparisons (slashes, case). */
    P.normalPath = function (path) {
        return String(path).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    };

    /** Media path of an item, or "" (synthetic items and bins have none). */
    P.mediaPath = function (item) {
        try {
            return Z.hasMethod(item, "getMediaPath") ? String(item.getMediaPath() || "") : "";
        } catch (error) {
            return "";
        }
    };

    /** Every project item that has media, keyed by normalised media path. */
    P.mediaIndex = function () {
        var index = {};
        P.walkItems(P.requireProject().rootItem, function (item) {
            var path;
            if (!P.isBin(item)) {
                path = P.mediaPath(item);
                if (path && !Z.has(index, P.normalPath(path))) {
                    index[P.normalPath(path)] = item;
                }
            }
            return true;
        });
        return index;
    };

    /** nodeIds of every project item (to find what an import added). */
    P.itemIds = function () {
        var ids = {};
        P.walkItems(P.requireProject().rootItem, function (item) {
            ids[item.nodeId] = true;
            return true;
        });
        return ids;
    };

    /** Items whose nodeId is not in `before`, in project order. */
    P.newItems = function (before) {
        var added = [];
        P.walkItems(P.requireProject().rootItem, function (item) {
            if (!Z.has(before, item.nodeId)) {
                added.push(item);
            }
            return true;
        });
        return added;
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

    /** sequenceID -> true for every sequence (to find what an import or reframe added). */
    P.sequenceIds = function () {
        var ids = {};
        Z.each(P.sequences(), function (sequence) {
            ids[sequence.sequenceID] = true;
        });
        return ids;
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

    /** Make `sequence` the active one (UI state; not an undo step). Returns true when it changed. */
    P.openSequence = function (sequence) {
        var active = P.activeSequence();
        if (active && active.sequenceID === sequence.sequenceID) {
            return false;
        }
        app.project.openSequence(sequence.sequenceID);
        return true;
    };

    /** Frames per second of a sequence (from its timebase, ticks per frame). */
    P.fps = function (sequence) {
        return P.TICKS_PER_SECOND / Number(sequence.timebase);
    };

    /** Seconds per frame. */
    P.frameSeconds = function (sequence) {
        return Number(sequence.timebase) / P.TICKS_PER_SECOND;
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

    P.timeFromTicks = function (ticks) {
        var time = new Time();
        time.ticks = String(Math.round(Number(ticks)));
        return time;
    };

    P.timeToSeconds = function (time) {
        return time ? P.ticksToSeconds(time.ticks) : null;
    };

    /** Seconds rounded for receipts (4 decimals). */
    P.sec = function (time) {
        var value = P.timeToSeconds(time);
        return value === null || !isFinite(value) ? null : Z.round(value, 4);
    };

    /** `seconds` snapped to the sequence frame grid (warns in ctx when it moved). */
    P.snapTime = function (sequence, seconds, ctx, label) {
        return Z.snapToFrame(seconds, P.fps(sequence), ctx, label);
    };

    function pad2(value) {
        return value < 10 ? "0" + value : String(value);
    }

    /**
     * Timecode of a sequence time as Premiere formats it (Time.getFormatted with
     * the sequence frame duration and display format; drop-frame uses ";").
     * QE methods (razor, exportFramePNG, addTransition durations) take timecodes.
     */
    P.timecode = function (sequence, seconds) {
        var frameTicks = Number(sequence.timebase);
        var frame = Math.round(seconds * P.TICKS_PER_SECOND / frameTicks);
        var time = new Time();
        var rate = new Time();
        var format = null;
        var nominal;
        time.ticks = String(frame * frameTicks);
        rate.ticks = String(frameTicks);
        try {
            format = sequence.getSettings().videoDisplayFormat;
        } catch (error) {
            format = null;
        }
        if (Z.hasMethod(time, "getFormatted") && typeof format === "number") {
            try {
                return String(time.getFormatted(rate, format));
            } catch (error2) {
                // Fall through to the nominal non-drop timecode.
            }
        }
        nominal = Math.round(P.TICKS_PER_SECOND / frameTicks);
        return pad2(Math.floor(frame / (nominal * 3600))) + ":" + pad2(Math.floor(frame / (nominal * 60)) % 60) + ":" +
            pad2(Math.floor(frame / nominal) % 60) + ":" + pad2(frame % nominal);
    };

    // ------------------------------------------------------------------
    // Tracks and clips.

    P.tracksOf = function (sequence, kind) {
        return kind === "video" ? sequence.videoTracks : sequence.audioTracks;
    };

    /** "V1", "A2". */
    P.trackLabel = function (kind, index) {
        return (kind === "video" ? "V" : "A") + (index + 1);
    };

    /** A track from {kind: "video" | "audio", index} (0-based); refuses NOT_FOUND. */
    P.findTrack = function (sequence, ref) {
        var tracks;
        if (!Z.isObject(ref) || (ref.kind !== "video" && ref.kind !== "audio") ||
                typeof ref.index !== "number" || Math.floor(ref.index) !== ref.index || ref.index < 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`track` must be {kind: \"video\" | \"audio\", index: 0-based integer}");
        }
        tracks = P.tracksOf(sequence, ref.kind);
        if (ref.index >= tracks.numTracks) {
            throw Z.refuse("NOT_FOUND", "Sequence \"" + sequence.name + "\" has " + Z.plural(tracks.numTracks, ref.kind + " track") +
                "; there is no index " + ref.index + " (" + P.trackLabel(ref.kind, ref.index) + ")");
        }
        return tracks[ref.index];
    };

    P.isLocked = function (track) {
        try {
            return Z.hasMethod(track, "isLocked") && track.isLocked() === true;
        } catch (error) {
            return false;
        }
    };

    /** Refuses when the track is locked (Premiere ignores or rejects edits there). */
    P.requireUnlocked = function (track, kind, index) {
        if (P.isLocked(track)) {
            throw Z.refuse("INVALID_ARGUMENT", "Track " + P.trackLabel(kind, index) + " is locked; unlock it in Premiere first");
        }
    };

    /** The clips of a track, as an array, in time order. */
    P.clipsOf = function (track) {
        var list = [];
        var i;
        for (i = 0; i < track.clips.numItems; i += 1) {
            list.push(track.clips[i]);
        }
        return list;
    };

    function findClipIn(sequence, nodeId) {
        var kinds = ["video", "audio"];
        var k;
        var t;
        var c;
        var tracks;
        var clips;
        for (k = 0; k < kinds.length; k += 1) {
            tracks = P.tracksOf(sequence, kinds[k]);
            for (t = 0; t < tracks.numTracks; t += 1) {
                clips = tracks[t].clips;
                for (c = 0; c < clips.numItems; c += 1) {
                    if (clips[c].nodeId === nodeId) {
                        return {sequence: sequence, clip: clips[c], kind: kinds[k], trackIndex: t, track: tracks[t], clipIndex: c};
                    }
                }
            }
        }
        return null;
    }

    /**
     * The clip (track item) with this nodeId: {sequence, clip, kind, trackIndex,
     * track, clipIndex}. Looks in the `sequence` argument when given, else the
     * active sequence first and then every sequence. Refuses NOT_FOUND.
     */
    P.findClip = function (nodeId, sequenceRef) {
        var found = null;
        var all;
        var active;
        var i;
        if (typeof nodeId !== "string" || nodeId.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`clip` must be a clip nodeId (premiere_get_sequence lists them)");
        }
        if (sequenceRef !== undefined && sequenceRef !== null) {
            found = findClipIn(P.findSequence(sequenceRef), nodeId);
        } else {
            P.requireProject();
            active = P.activeSequence();
            found = active ? findClipIn(active, nodeId) : null;
            all = P.sequences();
            for (i = 0; !found && i < all.length; i += 1) {
                found = findClipIn(all[i], nodeId);
            }
        }
        if (!found) {
            throw Z.refuse("NOT_FOUND", "No clip has nodeId " + nodeId + (sequenceRef ? " in sequence \"" + sequenceRef + "\"" : "") +
                " (premiere_get_sequence lists clips)");
        }
        return found;
    };

    /** Re-read a clip after an edit (Premiere can replace DOM objects during edits); null when gone. */
    P.refindClip = function (sequence, nodeId) {
        return findClipIn(sequence, nodeId);
    };

    /** {kind, index} of the track holding the track item with this nodeId, or null. */
    P.trackOf = function (sequence, nodeId) {
        var found = findClipIn(sequence, nodeId);
        return found ? {kind: found.kind, index: found.trackIndex} : null;
    };

    function sourceId(clip) {
        try {
            return clip.projectItem ? clip.projectItem.nodeId : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * The clips linked to `clip` (its audio/video partners), as an array; []
     * when none. getLinkedItems() returns null for an unlinked clip on Premiere
     * 25.2 (premiere-pro-mcp), while PProPanel describes it as every clip from
     * the same source, so only same-source clips overlapping this one count.
     */
    P.linkedOf = function (clip) {
        var linked;
        var list = [];
        var own = sourceId(clip);
        var start = Number(clip.start.ticks);
        var end = Number(clip.end.ticks);
        var other;
        var i;
        try {
            linked = Z.hasMethod(clip, "getLinkedItems") ? clip.getLinkedItems() : null;
        } catch (error) {
            linked = null;
        }
        if (!linked) {
            return list;
        }
        for (i = 0; i < linked.numItems; i += 1) {
            other = linked[i];
            if (!other || other.nodeId === clip.nodeId) {
                continue;
            }
            if (own !== null && sourceId(other) !== null && sourceId(other) !== own) {
                continue;
            }
            if (Number(other.start.ticks) < end && Number(other.end.ticks) > start) {
                list.push(other);
            }
        }
        return list;
    };

    /** Clip speed multiplier (1 = normal) and whether it plays backwards. */
    P.speedOf = function (clip) {
        var speed = 1;
        var reversed = false;
        try {
            if (Z.hasMethod(clip, "getSpeed")) {
                speed = Number(clip.getSpeed());
            }
            if (Z.hasMethod(clip, "isSpeedReversed")) {
                reversed = Number(clip.isSpeedReversed()) === 1 || clip.isSpeedReversed() === true;
            }
        } catch (error) {
            speed = 1;
        }
        return {speed: isFinite(speed) && speed > 0 ? speed : 1, reversed: reversed};
    };

    /** Refuses UNSUPPORTED for retimed clips (keyframe and marker times would land in the wrong place). */
    P.requireNormalSpeed = function (clip, what) {
        var speed = P.speedOf(clip);
        if (Math.abs(speed.speed - 1) > 0.0001 || speed.reversed) {
            throw Z.refuse("UNSUPPORTED", "Clip \"" + clip.name + "\" plays at " + Z.round(speed.speed * 100, 1) + "%" +
                (speed.reversed ? " reversed" : "") + "; " + what + " on retimed clips cannot be placed reliably by script");
        }
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

    /** Write a Time property (start, end, inPoint, outPoint) from ticks: a Time object, else a ticks string. */
    P.setTimeProperty = function (object, key, ticks) {
        var whole = String(Math.round(Number(ticks)));
        try {
            object[key] = P.timeFromTicks(whole);
        } catch (error) {
            object[key] = whole;
        }
    };

    // ------------------------------------------------------------------
    // Components (Motion, Opacity, Volume, effects) and their parameters.

    /** Match names of the built-in video components (pymiere reflection of a live Premiere; PProPanel). */
    P.MOTION = "AE.ADBE Motion";
    P.OPACITY = "AE.ADBE Opacity";

    P.componentsOf = function (clip) {
        var list = [];
        var components = clip.components;
        var i;
        if (!components) {
            return list;
        }
        for (i = 0; i < components.numItems; i += 1) {
            list.push(components[i]);
        }
        return list;
    };

    /** The first component whose matchName is in `matchNames` or displayName in `displayNames`; null if none. */
    P.findComponent = function (clip, matchNames, displayNames) {
        var components = P.componentsOf(clip);
        var i;
        for (i = 0; i < components.length; i += 1) {
            if (Z.indexOf(matchNames, String(components[i].matchName)) >= 0) {
                return components[i];
            }
        }
        for (i = 0; i < components.length; i += 1) {
            if (Z.indexOf(displayNames, String(components[i].displayName)) >= 0) {
                return components[i];
            }
        }
        return null;
    };

    P.motionOf = function (clip) {
        return P.findComponent(clip, [P.MOTION], ["Motion"]);
    };

    P.opacityOf = function (clip) {
        return P.findComponent(clip, [P.OPACITY], ["Opacity"]);
    };

    /** The audio clip's Volume component (not Channel Volume). */
    P.volumeOf = function (clip) {
        var components = P.componentsOf(clip);
        var i;
        var name;
        var match;
        for (i = 0; i < components.length; i += 1) {
            name = String(components[i].displayName);
            match = String(components[i].matchName);
            if (name === "Volume" || (/volume/i.test(match) && !/channel/i.test(match) && !/channel/i.test(name))) {
                return components[i];
            }
        }
        return null;
    };

    /** Built-in components every clip carries (not user effects). */
    P.isIntrinsic = function (component) {
        var match = String(component.matchName);
        var name = String(component.displayName);
        return match === P.MOTION || match === P.OPACITY || /time remap/i.test(name) || /time remap/i.test(match) ||
            name === "Volume" || name === "Channel Volume" || name === "Panner" || /^Internal /.test(match);
    };

    /** The parameters of a component, as an array. */
    P.paramsOf = function (component) {
        var list = [];
        var i;
        for (i = 0; i < component.properties.numItems; i += 1) {
            list.push(component.properties[i]);
        }
        return list;
    };

    /**
     * A parameter by display name (English names; Premiere localises them),
     * case-insensitive, else at `fallbackIndex` (the documented position of a
     * built-in parameter, for localised UIs). null when neither works.
     */
    P.findParam = function (component, names, fallbackIndex) {
        var params = P.paramsOf(component);
        var wanted = Z.map(names, function (name) { return String(name).toLowerCase(); });
        var i;
        for (i = 0; i < params.length; i += 1) {
            if (Z.indexOf(wanted, String(params[i].displayName).toLowerCase()) >= 0) {
                return params[i];
            }
        }
        if (typeof fallbackIndex === "number" && fallbackIndex < params.length) {
            return params[fallbackIndex];
        }
        return null;
    };

    /** Display names of a component's parameters (for error messages). */
    P.paramNames = function (component) {
        return Z.filter(Z.map(P.paramsOf(component), function (param) {
            return String(param.displayName);
        }), function (name) {
            return Z.trim(name).length > 0;
        });
    };

    P.isAnimated = function (param) {
        try {
            return Z.hasMethod(param, "isTimeVarying") && param.isTimeVarying() === true;
        } catch (error) {
            return false;
        }
    };

    /** getValue(), or null when Premiere cannot read it. */
    P.valueOf = function (param) {
        try {
            return param.getValue();
        } catch (error) {
            return null;
        }
    };

    // Motion parameter positions (pymiere reflection of a live Premiere: Position,
    // Scale, Scale Width, Uniform Scale, Rotation, Anchor Point, Anti-flicker
    // Filter) and Opacity (Opacity, Blend Mode); Volume (Bypass, Level).
    P.MOTION_PARAMS = {position: ["Position", 0], scale: ["Scale", 1], rotation: ["Rotation", 4], anchor: ["Anchor Point", 5]};
    P.OPACITY_PARAMS = {opacity: ["Opacity", 0], blend: ["Blend Mode", 1]};

    /**
     * Opacity > Blend Mode values by index: the modes in alphabetical order,
     * then Subtract and Divide (added later); Normal is 18. Mapped on Premiere
     * 25.2.3 by rendering each index over a known background (premiere-pro-mcp,
     * CHANGELOG #683). Catalog: PREMIERE_BLEND_MODES, same order.
     */
    P.BLEND_MODES = [
        "color", "color-burn", "color-dodge", "darken", "darker-color", "difference", "dissolve", "exclusion", "hard-light",
        "hard-mix", "hue", "lighten", "lighter-color", "linear-burn", "linear-dodge", "linear-light", "luminosity", "multiply",
        "normal", "overlay", "pin-light", "saturation", "screen", "soft-light", "vivid-light", "subtract", "divide"
    ];

    P.blendModeName = function (value) {
        var index = Number(value);
        return isFinite(index) && index >= 0 && index < P.BLEND_MODES.length && Math.floor(index) === index ? P.BLEND_MODES[index] : null;
    };

    /**
     * Audio Level <-> dB. Premiere stores Volume > Level as linear gain
     * normalised so that +15 dB (the slider's maximum) is 1, i.e. 0 dB =
     * 10^(-15/20) = 0.1778. Measured on Premiere 25.2 by the premiere-pro-mcp
     * project (CHANGELOG #693/#701); -96 dB and below are silence.
     */
    P.dbToLevel = function (db) {
        return db <= -96 ? 0 : Math.pow(10, (db - 15) / 20);
    };

    P.levelToDb = function (level) {
        var value = Number(level);
        if (!isFinite(value) || value <= 0) {
            return -96;
        }
        return Math.max(-96, Z.round(20 * Math.log(value) / Math.LN10 + 15, 2));
    };

    /** Motion > Position is normalised to the sequence frame in scripting ([0.5, 0.5] = centre). */
    P.positionToDom = function (sequence, px) {
        return [px[0] / sequence.frameSizeHorizontal, px[1] / sequence.frameSizeVertical];
    };

    P.positionFromDom = function (sequence, value) {
        if (!Z.isArray(value) && !(value && typeof value.length === "number")) {
            return null;
        }
        return [Z.round(Number(value[0]) * sequence.frameSizeHorizontal, 2), Z.round(Number(value[1]) * sequence.frameSizeVertical, 2)];
    };

    /**
     * The Time of a keyframe `offset` seconds after the clip's first frame.
     * Component keyframe times count from the start of the source media, so the
     * clip's in point is added (premiere-pro-mcp CHANGELOG #683/#693).
     */
    P.keyTime = function (clip, offset) {
        return P.timeFromTicks(Number(clip.inPoint.ticks) + Math.round(offset * P.TICKS_PER_SECOND));
    };

    // ------------------------------------------------------------------
    // QE sequences and track items.

    function qeMatches(candidate, sequence) {
        if (!candidate) {
            return false;
        }
        if (candidate.guid !== undefined && candidate.guid !== null && String(candidate.guid) !== "") {
            return String(candidate.guid) === String(sequence.sequenceID);
        }
        return String(candidate.name) === String(sequence.name);
    }

    /**
     * The QE sequence for a DOM sequence (QE `guid` is the DOM sequenceID). A
     * sequence QE cannot reach is opened first (warning in ctx).
     */
    P.qeSequence = function (sequence, ctx) {
        var project = P.qe().project;
        var candidate = project.getActiveSequence();
        var active = P.activeSequence();
        var count;
        var i;
        // QE's active sequence is the DOM's active one, whatever its guid says.
        if (candidate && (qeMatches(candidate, sequence) || (active && active.sequenceID === sequence.sequenceID))) {
            return candidate;
        }
        try {
            count = Number(project.numSequences);
            for (i = 0; i < count; i += 1) {
                try {
                    candidate = project.getSequenceAt(i);
                } catch (error) {
                    candidate = null;
                }
                if (qeMatches(candidate, sequence)) {
                    return candidate;
                }
            }
        } catch (error2) {
            // Some builds throw for getSequenceAt; opening the sequence below still works.
        }
        if (P.openSequence(sequence) && ctx) {
            ctx.warn("Opened sequence \"" + sequence.name + "\" so the QE DOM can reach it");
        }
        candidate = P.qe().project.getActiveSequence();
        active = P.activeSequence();
        if (candidate && (qeMatches(candidate, sequence) || (active && active.sequenceID === sequence.sequenceID))) {
            return candidate;
        }
        throw Z.fail("HOST_ERROR", "The QE DOM cannot reach sequence \"" + sequence.name + "\"");
    };

    P.qeTrack = function (qeSequence, kind, index) {
        var track = kind === "video" ? qeSequence.getVideoTrackAt(index) : qeSequence.getAudioTrackAt(index);
        if (!track) {
            throw Z.fail("HOST_ERROR", "The QE DOM has no " + P.trackLabel(kind, index) + " track");
        }
        return track;
    };

    /**
     * The QE item for a DOM clip. QE track items include gaps (and transitions),
     * so the DOM clip index does not address them: match on the start time.
     */
    P.qeItem = function (qeTrack, clip, frameTicks) {
        var wanted = Number(clip.start.ticks);
        var best = null;
        var bestDelta = null;
        var item;
        var delta;
        var i;
        var count = Number(qeTrack.numItems);
        for (i = 0; i < count; i += 1) {
            item = qeTrack.getItemAt(i);
            if (!item || String(item.type) !== "Clip") {
                continue;
            }
            delta = Math.abs(Number(item.start.ticks) - wanted);
            if (delta === 0) {
                return item;
            }
            if (best === null || delta < bestDelta) {
                best = item;
                bestDelta = delta;
            }
        }
        if (best !== null && bestDelta < frameTicks / 2) {
            return best;
        }
        throw Z.fail("HOST_ERROR", "The QE DOM has no clip at " + Z.round(P.ticksToSeconds(wanted), 3) + " s on that track");
    };

    // ------------------------------------------------------------------
    // Files.

    /** True when `path` is an existing file (not a folder). */
    P.isFile = function (path) {
        var file = new File(path);
        return file.exists && !(File(path) instanceof Folder);
    };

    /** Extension of a path, lower case, without the dot ("" when none). */
    P.extensionOf = function (path) {
        var match = /\.([A-Za-z0-9]+)$/.exec(String(path));
        return match ? match[1].toLowerCase() : "";
    };

    P.baseName = function (path) {
        var parts = String(path).replace(/\\/g, "/").split("/");
        return parts[parts.length - 1];
    };

    /** A file name made only of letters, digits, dashes and underscores (QE cuts names at the first dot). */
    P.safeName = function (text) {
        var cleaned = String(text).replace(/[^A-Za-z0-9_\-]+/g, "-").replace(/^-+|-+$/g, "");
        return cleaned.length ? cleaned.slice(0, 80) : "untitled";
    };

    /** A unique, dot-free name: prefix-time-random. */
    P.uniqueName = function (prefix) {
        return prefix + "-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000000);
    };

    /** The platform's path separator. */
    P.sep = function () {
        return Folder.fs === "Windows" ? "\\" : "/";
    };

    /** `folder` + separator + `name` (folder as an fsName string). */
    P.join = function (folder, name) {
        return String(folder).replace(/[\\\/]+$/, "") + P.sep() + name;
    };

    /**
     * Zenvi Link's temp folder: ZenviLink.tempDir(), the folder the server
     * configured (created if missing). The server deletes a frame capture it
     * has sent only from inside this folder.
     */
    P.tempFolder = function () {
        return new Folder(Z.tempDir());
    };

    /** Create the parent folder of a file path when missing. */
    P.ensureParent = function (path) {
        var parent = new File(path).parent;
        if (parent && !parent.exists) {
            parent.create();
        }
    };

    /**
     * Wait until a file exists with a non-zero size that stops changing (QE
     * exports return before the file is complete) and, when given,
     * `isComplete(path, size)` accepts it. Polls every 100 ms, at most maxMs.
     * Returns the size, or 0 when the file never settled.
     */
    P.waitForFile = function (path, maxMs, isComplete) {
        var polls = Math.ceil(maxMs / 100);
        var last = -1;
        var file;
        var size;
        var i;
        for (i = 0; i < polls; i += 1) {
            file = new File(path);
            size = file.exists ? file.length : 0;
            if (size > 0 && size === last && (!isComplete || isComplete(path, size))) {
                return size;
            }
            last = size;
            $.sleep(100);
        }
        return 0;
    };

    var PNG_SIGNATURE = "\u0089PNG\r\n\u001a\n";
    // Every complete PNG ends with the IEND chunk: length 0, "IEND", CRC AE 42 60 82.
    var PNG_TRAILER = "\u0000\u0000\u0000\u0000IEND\u00aeB`\u0082";

    /**
     * True when the file at `path`, `size` bytes long, starts with the PNG
     * signature and ends with the IEND chunk. Reads 20 bytes; false while
     * another process still holds the file so that it cannot be opened.
     */
    P.isCompletePng = function (path, size) {
        var file = new File(path);
        var head = "";
        var tail = "";
        if (size < PNG_SIGNATURE.length + PNG_TRAILER.length) {
            return false;
        }
        file.encoding = "BINARY";
        if (!file.open("r")) {
            return false;
        }
        try {
            head = file.read(PNG_SIGNATURE.length);
            file.seek(size - PNG_TRAILER.length, 0);
            tail = file.read(PNG_TRAILER.length);
        } finally {
            file.close();
        }
        return head === PNG_SIGNATURE && tail === PNG_TRAILER;
    };

    /**
     * Premiere's resource folder: app.path is the app bundle on macOS
     * (".../Adobe Premiere Pro 2025.app/") and the install folder on Windows;
     * presets live under Contents/ in the bundle.
     */
    P.appResources = function () {
        var root = String(app.path || "").replace(/[\\\/]+$/, "");
        var contents;
        if (!root) {
            return null;
        }
        contents = new Folder(root + "/Contents");
        return contents.exists ? contents : new Folder(root);
    };

    /**
     * Files under `folder` (recursively, at most `maxDepth` levels and `limit`
     * files) whose name passes `test`.
     */
    P.findFiles = function (folder, test, maxDepth, limit) {
        var found = [];
        function scan(dir, depth) {
            var entries;
            var i;
            if (!dir || !dir.exists || depth > maxDepth || found.length >= limit) {
                return;
            }
            try {
                entries = dir.getFiles();
            } catch (error) {
                return;
            }
            for (i = 0; entries && i < entries.length && found.length < limit; i += 1) {
                if (entries[i] instanceof Folder) {
                    scan(entries[i], depth + 1);
                } else if (test(decodeURI(entries[i].name))) {
                    found.push(entries[i]);
                }
            }
        }
        scan(folder, 0);
        return found;
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
            selection = Z.hasMethod(active, "getSelection") ? active.getSelection() || [] : [];
            activeData = P.sequenceSummary(active);
            activeData.playhead = Z.round(P.timeToSeconds(active.getPlayerPosition()), 4);
            activeData.in_point = Z.hasMethod(active, "getInPointAsTime") ? Z.round(P.timeToSeconds(active.getInPointAsTime()), 4) : null;
            activeData.out_point = Z.hasMethod(active, "getOutPointAsTime") ? Z.round(P.timeToSeconds(active.getOutPointAsTime()), 4) : null;
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
