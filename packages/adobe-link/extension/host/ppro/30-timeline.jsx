// Zenvi Link: Premiere Pro timeline edits. premiere_place_clip,
// premiere_edit_clip, premiere_razor.
//
// DOM behaviour these rely on (Premiere 25.2, measured by the premiere-pro-mcp
// project and noted in docs/PREMIERE_PRO.md): a trim must write the timeline
// edge and the source point together (start + inPoint, end + outPoint);
// TrackItem.remove(true, ...) does not ripple, so ripple deletes move the
// later clips themselves; Premiere can replace TrackItem objects during an
// edit, so clips are looked up again by nodeId afterwards.

(function (Z) {
    var P = Z.ppro;
    var TPS = P.TICKS_PER_SECOND;

    /** nodeId -> true for every clip in the sequence. */
    P.clipIds = function (sequence) {
        var ids = {};
        var kinds = ["video", "audio"];
        var k;
        var t;
        var tracks;
        for (k = 0; k < kinds.length; k += 1) {
            tracks = P.tracksOf(sequence, kinds[k]);
            for (t = 0; t < tracks.numTracks; t += 1) {
                Z.each(P.clipsOf(tracks[t]), function (clip) {
                    ids[clip.nodeId] = true;
                });
            }
        }
        return ids;
    };

    /** End of the last clip on a track, in seconds (0 when empty). */
    P.trackEnd = function (track) {
        var end = 0;
        Z.each(P.clipsOf(track), function (clip) {
            end = Math.max(end, P.timeToSeconds(clip.end));
        });
        return end;
    };

    /** Clips on `track` overlapping [startTicks, endTicks), except nodeIds in `except`. */
    P.overlapping = function (track, startTicks, endTicks, except) {
        return Z.filter(P.clipsOf(track), function (clip) {
            return !Z.has(except || {}, clip.nodeId) && Number(clip.start.ticks) < endTicks && Number(clip.end.ticks) > startTicks;
        });
    };

    function ticksOf(time) {
        return time ? String(time.ticks) : null;
    }

    /** Set a project item's in/out marks (seconds, all media types = 4) in an order that keeps in < out. */
    P.setMarks = function (item, inSeconds, outSeconds) {
        return setMarks(item, inSeconds, outSeconds);
    };

    function setMarks(item, inSeconds, outSeconds) {
        var currentOut = ticksOf(item.getOutPoint());
        var steps = 0;
        if (inSeconds !== null && currentOut !== null && inSeconds * TPS >= Number(currentOut) && outSeconds !== null) {
            item.setOutPoint(outSeconds, 4);
            item.setInPoint(inSeconds, 4);
            return 2;
        }
        if (inSeconds !== null) {
            item.setInPoint(inSeconds, 4);
            steps += 1;
        }
        if (outSeconds !== null) {
            item.setOutPoint(outSeconds, 4);
            steps += 1;
        }
        return steps;
    }

    function linkedLabels(sequence, clips) {
        return Z.map(clips, function (clip) {
            var track = P.trackOf(sequence, clip.nodeId);
            return track ? P.trackLabel(track.kind, track.index) : "?";
        });
    }

    // ------------------------------------------------------------------
    // premiere_place_clip

    Z.register("premiere_place_clip", function (args, ctx) {
        var item = P.findProjectItemByNodeId(Z.required(args, "item", "string"));
        var sequence = P.findSequence(args.sequence);
        var ref = Z.optional(args, "track", "object", {kind: "video", index: 0});
        var track = P.findTrack(sequence, ref);
        var label = P.trackLabel(ref.kind, ref.index);
        var mode = Z.oneOf("mode", Z.optional(args, "mode", "string", "overwrite"), ["overwrite", "insert"]);
        var sourceIn = Z.optional(args, "source_in", "number", null);
        var sourceOut = Z.optional(args, "source_out", "number", null);
        var time = Z.optional(args, "time", "number", null);
        var half = Number(sequence.timebase) / 2;
        var origIn;
        var origOut;
        var effectiveIn;
        var effectiveOut;
        var before;
        var steps = 0;
        var marked = false;
        /** @type {TrackItem | null} */
        var placed = null;
        var linked;
        var detail;
        var timeTicks;

        if (P.isBin(item)) {
            throw Z.refuse("INVALID_ARGUMENT", "\"" + item.name + "\" is a bin; pass a clip, still, audio or sequence item");
        }
        if (sequence.projectItem && sequence.projectItem.nodeId === item.nodeId) {
            throw Z.refuse("INVALID_ARGUMENT", "A sequence cannot be placed inside itself");
        }
        P.requireUnlocked(track, ref.kind, ref.index);
        if (sourceIn !== null) {
            Z.inRange("source_in", sourceIn, 0, null);
        }
        if (sourceOut !== null) {
            Z.inRange("source_out", sourceOut, 0, null);
        }
        origIn = ticksOf(item.getInPoint());
        origOut = ticksOf(item.getOutPoint());
        effectiveIn = sourceIn !== null ? sourceIn : (origIn !== null ? P.ticksToSeconds(origIn) : null);
        effectiveOut = sourceOut !== null ? sourceOut : (origOut !== null ? P.ticksToSeconds(origOut) : null);
        if (effectiveIn !== null && effectiveOut !== null && effectiveOut <= effectiveIn) {
            throw Z.refuse("INVALID_ARGUMENT", "The source range is empty: out " + Z.round(effectiveOut) + " s is not after in " +
                Z.round(effectiveIn) + " s");
        }
        time = time === null ? P.trackEnd(track) : Z.inRange("time", time, 0, null);
        time = P.snapTime(sequence, time, ctx, "time");
        timeTicks = Math.round(time * TPS);

        before = P.clipIds(sequence);
        ctx.changed();
        try {
            if (sourceIn !== null || sourceOut !== null) {
                marked = true;
                steps += setMarks(item, sourceIn, sourceOut);
            }
            if (mode === "insert") {
                track.insertClip(item, time);
            } else {
                track.overwriteClip(item, time);
            }
            steps += 1;
        } finally {
            if (marked) {
                try {
                    steps += setMarks(item, origIn !== null ? P.ticksToSeconds(origIn) : null, origOut !== null ? P.ticksToSeconds(origOut) : null);
                } catch (restoreError) {
                    ctx.warn("Could not restore the in/out marks of \"" + item.name + "\": " + String(restoreError.message || restoreError));
                }
            }
        }

        Z.each(P.clipsOf(P.tracksOf(sequence, ref.kind)[ref.index]), function (clip) {
            if (Z.has(before, clip.nodeId)) {
                return;
            }
            if (!placed || Math.abs(Number(clip.start.ticks) - timeTicks) < half) {
                placed = clip;
            }
        });
        if (!placed) {
            throw Z.fail("HOST_ERROR", "Premiere did not place \"" + item.name + "\" on " + label);
        }
        detail = P.clipDetail(sequence, placed, ref.kind, ref.index, false);
        linked = P.linkedOf(placed);
        if (Math.abs(Number(placed.start.ticks) - timeTicks) >= half) {
            ctx.warn("Premiere placed the clip at " + detail.start + " s instead of " + Z.round(time, 4) + " s");
        }
        if (sourceIn !== null && sourceOut !== null && Math.abs(detail.duration - (sourceOut - sourceIn)) > 2 * half / TPS) {
            ctx.warn("The clip is " + detail.duration + " s long, not the " + Z.round(sourceOut - sourceIn, 4) +
                " s asked for (the media may be shorter)");
        }
        return Z.applied("Placed \"" + item.name + "\" on " + label + " at " + detail.start + " s (" + detail.start + "-" +
            detail.end + " s, " + mode + ")" + (linked.length ? " with linked " + linkedLabels(sequence, linked).join(", ") : ""), {
            clip: detail,
            linked: Z.map(linked, function (clip) { return P.clipSummary(sequence, clip); }),
            mode: mode
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_edit_clip

    /** The clip plus (optionally) its linked partners, each as a P.findClip-style record. */
    function withLinked(found, includeLinked) {
        var members = [found];
        if (includeLinked) {
            Z.each(P.linkedOf(found.clip), function (clip) {
                var record = P.refindClip(found.sequence, clip.nodeId);
                if (record) {
                    members.push(record);
                }
            });
        }
        return members;
    }

    function requireAllUnlocked(members) {
        Z.each(members, function (member) {
            P.requireUnlocked(member.track, member.kind, member.trackIndex);
        });
    }

    /**
     * Move clip `nodeId` by deltaTicks unless it is already there (Premiere may
     * move linked clips along with their partner). Returns true when it moved it.
     */
    function shiftClip(sequence, nodeId, originalStart, deltaTicks) {
        var record = P.refindClip(sequence, nodeId);
        var half = Number(sequence.timebase) / 2;
        var clip;
        var start;
        var end;
        if (!record) {
            return false;
        }
        clip = record.clip;
        if (Math.abs(Number(clip.start.ticks) - (originalStart + deltaTicks)) < half) {
            return false;
        }
        if (typeof clip.move === "function") {
            clip.move(deltaTicks / TPS);
        } else {
            start = Number(clip.start.ticks) + deltaTicks;
            end = Number(clip.end.ticks) + deltaTicks;
            if (deltaTicks > 0) {
                P.setTimeProperty(clip, "end", end);
                P.setTimeProperty(clip, "start", start);
            } else {
                P.setTimeProperty(clip, "start", start);
                P.setTimeProperty(clip, "end", end);
            }
        }
        return true;
    }

    function moveClip(found, args, ctx, includeLinked) {
        var sequence = found.sequence;
        var clip = found.clip;
        var to = Z.optional(args, "to", "number", null);
        var by = Z.optional(args, "by", "number", null);
        var startTicks = Number(clip.start.ticks);
        var half = Number(sequence.timebase) / 2;
        var target;
        var delta;
        var members;
        var except = {};
        var originals = [];
        var steps = 0;
        var after;
        if ((to === null) === (by === null)) {
            throw Z.refuse("INVALID_ARGUMENT", "move needs exactly one of `to` (new start, seconds) or `by` (shift, seconds)");
        }
        target = to !== null ? Z.inRange("to", to, 0, null) : P.ticksToSeconds(startTicks) + Z.inRange("by", by, null, null);
        if (target < 0) {
            throw Z.refuse("INVALID_ARGUMENT", "The clip would start at " + Z.round(target) + " s, before the start of the sequence");
        }
        target = P.snapTime(sequence, target, ctx, "new start");
        delta = Math.round(target * TPS) - startTicks;
        if (Math.abs(delta) < half) {
            return Z.unchanged("Clip \"" + clip.name + "\" already starts at " + Z.round(target, 4) + " s", {clip: P.clipSummary(sequence, clip)});
        }
        P.requireFeature(typeof clip.move === "function", "TrackItem.move", "2021 (15.4)");
        members = withLinked(found, includeLinked);
        requireAllUnlocked(members);
        Z.each(members, function (member) {
            except[member.clip.nodeId] = true;
        });
        Z.each(members, function (member) {
            var start = Number(member.clip.start.ticks) + delta;
            var end = Number(member.clip.end.ticks) + delta;
            var blocking = P.overlapping(member.track, start, end, except);
            if (start < -half) {
                throw Z.refuse("INVALID_ARGUMENT", "Linked \"" + member.clip.name + "\" on " + P.trackLabel(member.kind, member.trackIndex) +
                    " would start at " + Z.round(P.ticksToSeconds(start), 3) + " s, before the start of the sequence");
            }
            if (blocking.length > 0) {
                throw Z.refuse("INVALID_ARGUMENT", "Moving \"" + member.clip.name + "\" to " + Z.round(P.ticksToSeconds(start), 3) + " s on " +
                    P.trackLabel(member.kind, member.trackIndex) + " would overlap \"" + blocking[0].name + "\" (" +
                    P.sec(blocking[0].start) + "-" + P.sec(blocking[0].end) + " s); trim, move or delete it first");
            }
            originals.push({nodeId: member.clip.nodeId, start: Number(member.clip.start.ticks)});
        });
        ctx.changed();
        Z.each(originals, function (original) {
            if (shiftClip(sequence, original.nodeId, original.start, delta)) {
                steps += 1;
            }
        });
        after = P.refindClip(sequence, clip.nodeId);
        if (!after) {
            throw Z.fail("HOST_ERROR", "Clip \"" + clip.name + "\" is gone after the move");
        }
        Z.each(originals, function (original) {
            var now = P.refindClip(sequence, original.nodeId);
            if (now && Math.abs(Number(now.clip.start.ticks) - (original.start + delta)) >= half) {
                ctx.warn("Premiere put \"" + now.clip.name + "\" (" + P.trackLabel(now.kind, now.trackIndex) + ") at " + P.sec(now.clip.start) +
                    " s instead of " + Z.round(P.ticksToSeconds(original.start + delta), 4) + " s");
            }
        });
        return Z.applied("Moved \"" + clip.name + "\" from " + Z.round(P.ticksToSeconds(startTicks), 4) + " s to " +
            P.sec(after.clip.start) + " s" + (members.length > 1 ? " with its linked " + (members.length === 2 ? "clip" : "clips") : ""), {
            clip: P.clipDetail(sequence, after.clip, after.kind, after.trackIndex, false),
            moved: Z.map(originals, function (original) { return original.nodeId; }),
            shift: Z.round(P.ticksToSeconds(delta), 4)
        }, steps);
    }

    function trimClip(found, args, ctx, includeLinked) {
        var sequence = found.sequence;
        var clip = found.clip;
        var newStart = Z.optional(args, "start", "number", null);
        var newEnd = Z.optional(args, "end", "number", null);
        var frameTicks = Number(sequence.timebase);
        var half = frameTicks / 2;
        var startTicks = Number(clip.start.ticks);
        var endTicks = Number(clip.end.ticks);
        var headTicks;
        var tailTicks;
        var headDelta;
        var tailDelta;
        var members = [];
        var except = {};
        var steps = 0;
        var after;
        if (newStart === null && newEnd === null) {
            throw Z.refuse("INVALID_ARGUMENT", "trim needs `start` (new head) and/or `end` (new tail), in sequence seconds");
        }
        P.requireNormalSpeed(clip, "trims");
        headTicks = newStart === null ? startTicks : Math.round(P.snapTime(sequence, Z.inRange("start", newStart, 0, null), ctx, "start") * TPS);
        tailTicks = newEnd === null ? endTicks : Math.round(P.snapTime(sequence, Z.inRange("end", newEnd, 0, null), ctx, "end") * TPS);
        if (tailTicks - headTicks < frameTicks - half / 2) {
            throw Z.refuse("INVALID_ARGUMENT", "The trim would leave less than one frame (" + Z.round(P.ticksToSeconds(headTicks)) + "-" +
                Z.round(P.ticksToSeconds(tailTicks)) + " s)");
        }
        headDelta = Math.abs(headTicks - startTicks) < half ? 0 : headTicks - startTicks;
        tailDelta = Math.abs(tailTicks - endTicks) < half ? 0 : tailTicks - endTicks;
        if (headDelta === 0 && tailDelta === 0) {
            return Z.unchanged("Clip \"" + clip.name + "\" already runs " + P.sec(clip.start) + "-" + P.sec(clip.end) + " s",
                {clip: P.clipSummary(sequence, clip)});
        }
        Z.each(withLinked(found, includeLinked), function (member, i) {
            var head = headDelta !== 0 && Math.abs(Number(member.clip.start.ticks) - startTicks) < half;
            var tail = tailDelta !== 0 && Math.abs(Number(member.clip.end.ticks) - endTicks) < half;
            if (i > 0 && !head && !tail) {
                ctx.warn("Linked \"" + member.clip.name + "\" on " + P.trackLabel(member.kind, member.trackIndex) +
                    " does not share the trimmed edge; it was left as it is");
                return;
            }
            members.push({record: member, head: head, tail: tail});
            except[member.clip.nodeId] = true;
        });
        requireAllUnlocked(Z.map(members, function (member) { return member.record; }));
        Z.each(members, function (member) {
            var record = member.record;
            var newIn;
            var blocking;
            if (member.head) {
                newIn = Number(record.clip.inPoint.ticks) + headDelta;
                if (newIn < -half) {
                    throw Z.refuse("INVALID_ARGUMENT", "\"" + record.clip.name + "\" has only " + Z.round(P.ticksToSeconds(record.clip.inPoint.ticks), 3) +
                        " s of media before its in point; the head cannot move " + Z.round(P.ticksToSeconds(-headDelta), 3) + " s earlier");
                }
                blocking = headDelta < 0 ? P.overlapping(record.track, headTicks, startTicks, except) : [];
                if (blocking.length > 0) {
                    throw Z.refuse("INVALID_ARGUMENT", "Extending the head of \"" + record.clip.name + "\" to " + Z.round(P.ticksToSeconds(headTicks), 3) +
                        " s would overlap \"" + blocking[0].name + "\" on " + P.trackLabel(record.kind, record.trackIndex));
                }
            }
            if (member.tail) {
                blocking = tailDelta > 0 ? P.overlapping(record.track, endTicks, tailTicks, except) : [];
                if (blocking.length > 0) {
                    throw Z.refuse("INVALID_ARGUMENT", "Extending the tail of \"" + record.clip.name + "\" to " + Z.round(P.ticksToSeconds(tailTicks), 3) +
                        " s would overlap \"" + blocking[0].name + "\" on " + P.trackLabel(record.kind, record.trackIndex));
                }
            }
        });

        ctx.changed();
        Z.each(members, function (member) {
            var current;
            if (member.head) {
                current = P.refindClip(sequence, member.record.clip.nodeId);
                if (current) {
                    P.setTimeProperty(current.clip, "start", headTicks);
                    P.setTimeProperty(current.clip, "inPoint", Number(current.clip.inPoint.ticks) + headDelta);
                    steps += 2;
                }
            }
            if (member.tail) {
                current = P.refindClip(sequence, member.record.clip.nodeId);
                if (current) {
                    P.setTimeProperty(current.clip, "end", tailTicks);
                    P.setTimeProperty(current.clip, "outPoint", Number(current.clip.outPoint.ticks) + tailDelta);
                    steps += 2;
                }
            }
        });
        after = P.refindClip(sequence, clip.nodeId);
        if (!after) {
            throw Z.fail("HOST_ERROR", "Clip \"" + clip.name + "\" is gone after the trim");
        }
        if (Math.abs(Number(after.clip.start.ticks) - headTicks) >= half || Math.abs(Number(after.clip.end.ticks) - tailTicks) >= half) {
            ctx.warn("Premiere kept " + P.sec(after.clip.start) + "-" + P.sec(after.clip.end) + " s instead of " +
                Z.round(P.ticksToSeconds(headTicks), 4) + "-" + Z.round(P.ticksToSeconds(tailTicks), 4) + " s (the media may be shorter)");
        }
        return Z.applied("Trimmed \"" + clip.name + "\" to " + P.sec(after.clip.start) + "-" + P.sec(after.clip.end) + " s" +
            (members.length > 1 ? " with its linked " + (members.length === 2 ? "clip" : "clips") : ""), {
            clip: P.clipDetail(sequence, after.clip, after.kind, after.trackIndex, false),
            trimmed: Z.map(members, function (member) { return member.record.clip.nodeId; })
        }, steps);
    }

    function setEnabled(found, enable, ctx, includeLinked) {
        var members = withLinked(found, includeLinked);
        var changing;
        P.requireFeature(found.clip.disabled !== undefined, "TrackItem.disabled", "2021 (15.4)");
        requireAllUnlocked(members);
        changing = Z.filter(members, function (member) {
            return (member.clip.disabled === true) === enable;
        });
        if (changing.length === 0) {
            return Z.unchanged("Clip \"" + found.clip.name + "\" is already " + (enable ? "enabled" : "disabled"),
                {clip: P.clipSummary(found.sequence, found.clip)});
        }
        ctx.changed();
        Z.each(changing, function (member) {
            member.clip.disabled = !enable;
        });
        return Z.applied((enable ? "Enabled " : "Disabled ") + Z.map(changing, function (member) {
            return "\"" + member.clip.name + "\" (" + P.trackLabel(member.kind, member.trackIndex) + ")";
        }).join(", "), {
            clips: Z.map(changing, function (member) { return member.clip.nodeId; }),
            enabled: enable
        }, changing.length);
    }

    function renameClip(found, args, ctx) {
        var name = Z.required(args, "name", "string");
        var old = String(found.clip.name);
        if (name.trim().length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`name` must not be blank");
        }
        if (old === name) {
            return Z.unchanged("Clip is already named \"" + name + "\"", {clip: P.clipSummary(found.sequence, found.clip)});
        }
        ctx.changed();
        found.clip.name = name;
        return Z.applied("Renamed clip \"" + old + "\" to \"" + name + "\"", {clip: P.clipSummary(found.sequence, found.clip), previous_name: old}, 1);
    }

    function setSpeed(found, args, ctx) {
        var sequence = found.sequence;
        var clip = found.clip;
        var speed = Z.inRange("speed", Z.required(args, "speed", "number"), 0.01, 100);
        var reverse = Z.optional(args, "reverse", "boolean", false);
        var pitch = Z.optional(args, "maintain_pitch", "boolean", true);
        var ripple = Z.optional(args, "ripple", "boolean", false);
        var current = P.speedOf(clip);
        var startTicks = Number(clip.start.ticks);
        var endTicks = Number(clip.end.ticks);
        var half = Number(sequence.timebase) / 2;
        var newDuration = Math.round((endTicks - startTicks) * current.speed / speed);
        /** @type {TrackItem | null} */
        var next = null;
        var qeItem;
        var after;
        var now;
        if (Math.abs(current.speed - speed) < 0.0001 && current.reversed === reverse) {
            return Z.unchanged("Clip \"" + clip.name + "\" already plays at " + Z.round(speed * 100, 2) + "%", {clip: P.clipSummary(sequence, clip)});
        }
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        if (!ripple) {
            Z.each(P.clipsOf(found.track), function (other) {
                var start = Number(other.start.ticks);
                if (other.nodeId !== clip.nodeId && start >= endTicks - half && (next === null || start < Number(next.start.ticks))) {
                    next = other;
                }
            });
            if (next && startTicks + newDuration > Number(next.start.ticks) + half) {
                throw Z.refuse("INVALID_ARGUMENT", "At " + Z.round(speed * 100, 2) + "% the clip would run to " +
                    Z.round(P.ticksToSeconds(startTicks + newDuration), 3) + " s, into \"" + next.name + "\" at " + P.sec(next.start) +
                    " s; pass ripple: true or make room first");
            }
        }
        qeItem = P.qeItem(P.qeTrack(P.qeSequence(sequence, ctx), found.kind, found.trackIndex), clip, Number(sequence.timebase));
        if (typeof qeItem.setSpeed !== "function") {
            throw Z.refuse("UNSUPPORTED", "This Premiere build's QE DOM has no setSpeed; use Clip > Speed/Duration in Premiere");
        }
        ctx.changed();
        // QE setSpeed(multiplier, new duration in ticks, reverse, maintain pitch, ripple); the two-argument
        // forms throw "Not Enough Parameters" (Adobe_Premiere_Pro_MCP notes). Undocumented: verified below.
        try {
            qeItem.setSpeed(speed, String(newDuration), reverse, pitch, ripple);
        } catch (error) {
            qeItem.setSpeed(speed, "", reverse, pitch, ripple);
        }
        after = P.refindClip(sequence, clip.nodeId);
        if (!after) {
            throw Z.fail("HOST_ERROR", "Clip \"" + clip.name + "\" is gone after the speed change");
        }
        now = P.speedOf(after.clip);
        if (Math.abs(now.speed - speed) > 0.001 || now.reversed !== reverse) {
            throw Z.fail("HOST_ERROR", "QE setSpeed did not take: the clip plays at " + Z.round(now.speed * 100, 2) + "%" +
                (now.reversed ? " reversed" : "") + ", not " + Z.round(speed * 100, 2) + "%" + (reverse ? " reversed" : ""));
        }
        return Z.applied("Set \"" + clip.name + "\" to " + Z.round(speed * 100, 2) + "% speed" + (reverse ? ", reversed" : "") +
            " (" + P.sec(after.clip.start) + "-" + P.sec(after.clip.end) + " s)", {
            clip: P.clipDetail(sequence, after.clip, after.kind, after.trackIndex, false),
            speed: speed,
            reversed: reverse,
            maintain_pitch: pitch,
            ripple: ripple
        }, 1);
    }

    function deleteClip(found, args, ctx, includeLinked) {
        var sequence = found.sequence;
        var ripple = Z.optional(args, "ripple", "boolean", false);
        var members = withLinked(found, includeLinked);
        var removed = [];
        var steps = 0;
        var rippled = [];
        var tracksTouched = {};
        var half = Number(sequence.timebase) / 2;
        var shift;
        var uneven = false;
        var plan = [];
        requireAllUnlocked(members);
        Z.each(members, function (member) {
            removed.push({
                node_id: member.clip.nodeId,
                name: String(member.clip.name),
                track: {kind: member.kind, index: member.trackIndex},
                start: Number(member.clip.start.ticks),
                end: Number(member.clip.end.ticks)
            });
        });
        ctx.changed();
        Z.each(removed, function (entry) {
            var current = P.refindClip(sequence, entry.node_id);
            if (current) {
                // remove(ripple, alignToVideo): ripple is done below, explicitly.
                current.clip.remove(false, true);
                steps += 1;
            }
        });
        Z.each(removed, function (entry) {
            if (P.refindClip(sequence, entry.node_id)) {
                throw Z.fail("HOST_ERROR", "Premiere did not delete \"" + entry.name + "\"");
            }
        });
        if (ripple) {
            // One shift for every track, the smallest gap: linked clips with different extents (a J or L
            // cut) stay in sync, and no track's later clips can run into what is before its gap.
            shift = null;
            Z.each(removed, function (entry) {
                shift = shift === null ? entry.end - entry.start : Math.min(shift, entry.end - entry.start);
            });
            Z.each(removed, function (entry) {
                if (entry.end - entry.start - shift >= half) {
                    uneven = true;
                }
            });
            // Every touched track's later clips, with their starts, before anything moves: Premiere may
            // drag a linked partner along, and shiftClip then sees it is already in place.
            Z.each(removed, function (entry) {
                var key = entry.track.kind + entry.track.index;
                if (Z.has(tracksTouched, key)) {
                    return;
                }
                tracksTouched[key] = true;
                plan.push({
                    track: entry.track,
                    later: Z.map(Z.filter(P.clipsOf(P.tracksOf(sequence, entry.track.kind)[entry.track.index]), function (clip) {
                        return Number(clip.start.ticks) >= entry.end - half;
                    }), function (clip) {
                        return {nodeId: clip.nodeId, start: Number(clip.start.ticks)};
                    })
                });
            });
            Z.each(plan, function (entry) {
                var moved = 0;
                Z.each(entry.later, function (clip) {
                    if (shiftClip(sequence, clip.nodeId, clip.start, -shift)) {
                        moved += 1;
                        steps += 1;
                    }
                });
                rippled.push({track: entry.track, closed: Z.round(P.ticksToSeconds(shift), 4), moved: moved});
            });
            ctx.warn("Ripple closed the gap on " + Z.map(rippled, function (r) { return P.trackLabel(r.track.kind, r.track.index); }).join(", ") +
                " only; clips on other tracks did not move (Premiere's sync lock is not scriptable)");
            if (uneven) {
                ctx.warn("The linked clips had different lengths (a J or L cut); every track closed " +
                    Z.round(P.ticksToSeconds(shift), 4) + " s to keep them in sync, leaving the rest of the longer gap");
            }
        }
        Z.each(removed, function (entry) {
            entry.start = Z.round(P.ticksToSeconds(entry.start), 4);
            entry.end = Z.round(P.ticksToSeconds(entry.end), 4);
        });
        return Z.applied("Deleted \"" + found.clip.name + "\"" + (removed.length > 1 ? " and " + Z.plural(removed.length - 1, "linked clip") : "") +
            (ripple ? " and closed the gap" : ""), {
            deleted: removed,
            rippled: rippled
        }, steps);
    }

    Z.register("premiere_edit_clip", function (args, ctx) {
        var action = Z.oneOf("action", Z.required(args, "action", "string"), ["move", "trim", "enable", "disable", "rename", "speed", "delete"]);
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var includeLinked = Z.optional(args, "include_linked", "boolean", true);
        switch (action) {
        case "move":
            return moveClip(found, args, ctx, includeLinked);
        case "trim":
            return trimClip(found, args, ctx, includeLinked);
        case "enable":
            return setEnabled(found, true, ctx, includeLinked);
        case "disable":
            return setEnabled(found, false, ctx, includeLinked);
        case "rename":
            P.requireUnlocked(found.track, found.kind, found.trackIndex);
            return renameClip(found, args, ctx);
        case "speed":
            return setSpeed(found, args, ctx);
        default:
            return deleteClip(found, args, ctx, includeLinked);
        }
    });

    // ------------------------------------------------------------------
    // premiere_razor

    Z.register("premiere_razor", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var time = P.snapTime(sequence, Z.inRange("time", Z.required(args, "time", "number"), 0, null), ctx, "time");
        var ticks = Math.round(time * TPS);
        var half = Number(sequence.timebase) / 2;
        var refs = Z.optional(args, "tracks", "array", null);
        var targets = [];
        var seen = {};
        var cuts = [];
        var qeSequence;
        var timecode;
        var kinds = ["video", "audio"];
        var k;
        var t;
        var tracks;

        function clipAt(track) {
            var hit = null;
            Z.each(P.clipsOf(track), function (clip) {
                if (Number(clip.start.ticks) < ticks - half && Number(clip.end.ticks) > ticks + half) {
                    hit = clip;
                }
            });
            return hit;
        }

        if (refs !== null) {
            Z.each(refs, function (ref) {
                var track = P.findTrack(sequence, ref);
                var key = ref.kind + ref.index;
                P.requireUnlocked(track, ref.kind, ref.index);
                if (Z.has(seen, key)) {
                    return;
                }
                seen[key] = true;
                if (clipAt(track)) {
                    targets.push({kind: ref.kind, index: ref.index});
                } else {
                    ctx.warn("Nothing to cut on " + P.trackLabel(ref.kind, ref.index) + " at " + Z.round(time, 4) + " s");
                }
            });
        } else {
            for (k = 0; k < kinds.length; k += 1) {
                tracks = P.tracksOf(sequence, kinds[k]);
                for (t = 0; t < tracks.numTracks; t += 1) {
                    if (clipAt(tracks[t])) {
                        if (P.isLocked(tracks[t])) {
                            ctx.warn("Skipped locked track " + P.trackLabel(kinds[k], t));
                        } else {
                            targets.push({kind: kinds[k], index: t});
                        }
                    }
                }
            }
        }
        if (targets.length === 0) {
            return Z.unchanged("No clip spans " + Z.round(time, 4) + " s" + (refs !== null ? " on those tracks" : ""), {time: time, cuts: []});
        }

        qeSequence = P.qeSequence(sequence, ctx);
        timecode = P.timecode(sequence, time);
        ctx.changed();
        Z.each(targets, function (target) {
            var left = null;
            var right = null;
            P.qeTrack(qeSequence, target.kind, target.index).razor(timecode);
            Z.each(P.clipsOf(P.tracksOf(sequence, target.kind)[target.index]), function (clip) {
                if (Math.abs(Number(clip.start.ticks) - ticks) < half) {
                    right = clip;
                }
                if (Math.abs(Number(clip.end.ticks) - ticks) < half) {
                    left = clip;
                }
            });
            if (left && right) {
                cuts.push({
                    track: {kind: target.kind, index: target.index},
                    left: P.clipSummary(sequence, left),
                    right: P.clipSummary(sequence, right)
                });
            } else {
                ctx.warn("Premiere did not cut " + P.trackLabel(target.kind, target.index) + " at " + timecode);
            }
        });
        if (cuts.length === 0) {
            throw Z.fail("HOST_ERROR", "The QE razor made no cut at " + timecode);
        }
        return Z.applied("Cut " + Z.plural(cuts.length, "clip") + " at " + Z.round(time, 4) + " s (" +
            Z.map(cuts, function (cut) { return P.trackLabel(cut.track.kind, cut.track.index); }).join(", ") + ")", {
            time: Z.round(time, 4),
            timecode: timecode,
            cuts: cuts
        }, cuts.length);
    });
}(ZenviLink));
