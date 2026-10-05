// Zenvi Link: Premiere Pro titles and captions. premiere_add_text,
// premiere_add_captions.
//
// Premiere's ExtendScript cannot create text, and the title templates that ship
// with Premiere are Premiere-authored: their clips expose no MGT component, so
// their text cannot be set by script (premiere-pro-mcp, verified on 25.2).
// premiere_add_text therefore places either a transparent PNG title (`image`)
// or an After Effects-authored .mogrt (`mogrt`) whose text control is set
// through TrackItem.getMGTComponent().

(function (Z) {
    var P = Z.ppro;
    var TASTE = Z.TASTE;

    var STYLE_SIZES = {headline: "headline", title: "title", subtitle: "subtitle", "lower-third": "lowerThirdName", caption: "caption"};

    function words(text) {
        return Z.filter(String(text).split(/\s+/), function (word) { return word.length > 0; }).length;
    }

    /** TASTE reading time: 1.5 s + 0.3 s per word. */
    P.readingTime = function (text) {
        return TASTE.timing.textHold.base + TASTE.timing.textHold.perWord * words(text);
    };

    /** Default title duration by style: reading time, at least a title card (3 s) or a lower third (5 s). */
    P.titleDuration = function (text, style) {
        var reading = P.readingTime(text);
        if (style === "lower-third") {
            return Math.max(reading, TASTE.timing.lowerThird["default"]);
        }
        if (style === "caption") {
            return reading;
        }
        return Math.max(reading, TASTE.timing.titleCard["default"]);
    };

    /** The lowest unlocked video track from `from` up that is empty over [start, end); -1 when none. */
    P.freeVideoTrack = function (sequence, startTicks, endTicks, from) {
        var tracks = sequence.videoTracks;
        var i;
        for (i = from; i < tracks.numTracks; i += 1) {
            if (!P.isLocked(tracks[i]) && P.overlapping(tracks[i], startTicks, endTicks, {}).length === 0) {
                return i;
            }
        }
        return -1;
    };

    function octet(text, index) {
        return text.charCodeAt(index) & 255;
    }

    /** Width and height of a PNG from its IHDR chunk, or null. */
    P.pngSize = function (path) {
        var file = new File(path);
        var header;
        file.encoding = "BINARY";
        if (!file.open("r")) {
            return null;
        }
        header = file.read(24);
        file.close();
        if (header.length < 24 || octet(header, 1) !== 80 || octet(header, 2) !== 78 || octet(header, 3) !== 71) {
            return null;
        }
        return {
            width: ((octet(header, 16) * 256 + octet(header, 17)) * 256 + octet(header, 18)) * 256 + octet(header, 19),
            height: ((octet(header, 20) * 256 + octet(header, 21)) * 256 + octet(header, 22)) * 256 + octet(header, 23)
        };
    };

    /** The project item for a file: the existing one (same media path), else imported into "Zenvi Imports". */
    P.itemForFile = function (path, ctx) {
        var item = P.mediaIndex()[P.normalPath(path)];
        var bin;
        var before;
        var added;
        var i;
        if (item) {
            return {item: item, imported: false};
        }
        bin = P.findBin("Zenvi Imports", true, ctx, []);
        before = P.itemIds();
        ctx.changed();
        app.project.importFiles([path], true, bin, false);
        added = P.newItems(before);
        for (i = 0; i < added.length; i += 1) {
            if (P.normalPath(P.mediaPath(added[i])) === P.normalPath(path)) {
                return {item: added[i], imported: true};
            }
        }
        if (added.length === 1) {
            return {item: added[0], imported: true};
        }
        throw Z.fail("HOST_ERROR", "Premiere did not import " + path);
    };

    /** Set the text of an AE-authored MOGRT text control: JSON (textEditValue) on 2020+, a plain string before. */
    function setMogrtText(param, text) {
        var value = P.valueOf(param);
        var parsed = null;
        if (typeof value === "string" && value.charAt(0) === "{") {
            try {
                parsed = JSON.parse(value);
            } catch (error) {
                parsed = null;
            }
        }
        if (parsed && Z.isObject(parsed)) {
            parsed.textEditValue = text;
            parsed.fontTextRunLength = [text.length];
            param.setValue(JSON.stringify(parsed), true);
        } else {
            param.setValue(text, true);
        }
    }

    function textParamOf(component) {
        var params = P.paramsOf(component);
        var i;
        var value;
        for (i = 0; i < params.length; i += 1) {
            // A string control named like text ("Source Text", "Name Text"), not "Text Size" or "Text Color".
            if (/text/i.test(String(params[i].displayName)) && typeof P.valueOf(params[i]) === "string") {
                return params[i];
            }
        }
        for (i = 0; i < params.length; i += 1) {
            value = P.valueOf(params[i]);
            if (typeof value === "string" && (value.indexOf("textEditValue") >= 0 || value.charAt(0) !== "{")) {
                return params[i];
            }
        }
        return null;
    }

    /** "nodeId:start-end" of the clips on a track (except nodeIds in `except`), to detect collateral edits. */
    function trackSnapshot(track, except) {
        return Z.map(Z.filter(P.clipsOf(track), function (clip) {
            return !Z.has(except, clip.nodeId);
        }), function (clip) {
            return clip.nodeId + ":" + clip.start.ticks + "-" + clip.end.ticks;
        }).join(",");
    }

    /** Fail loudly when placing the title changed any clip that was already on the track. */
    function requireNeighboursUntouched(sequence, trackIndex, before, beforeIds) {
        var after = trackSnapshot(sequence.videoTracks[trackIndex], P.newIds(sequence, beforeIds));
        if (after !== before) {
            throw Z.fail("HOST_ERROR", "Placing the title changed other clips on V" + (trackIndex + 1) + "; undo the call's steps in Premiere");
        }
    }

    /** nodeIds in the sequence that were not in `beforeIds`, as a map. */
    P.newIds = function (sequence, beforeIds) {
        var ids = {};
        Z.each(Object.keys(P.clipIds(sequence)), function (id) {
            if (!Z.has(beforeIds, id)) {
                ids[id] = true;
            }
        });
        return ids;
    };

    function placeMogrt(sequence, path, trackIndex, startTicks, endTicks, text, size, rgb, ctx, result) {
        var clip;
        var mgt;
        var textParam;
        var sizeParam;
        var colorParam = null;
        var params;
        var i;
        var beforeIds = P.clipIds(sequence);
        var before = trackSnapshot(sequence.videoTracks[trackIndex], {});
        P.requireFeature(typeof sequence.importMGT === "function", "Sequence.importMGT", "2019 (13.0)");
        ctx.changed();
        clip = sequence.importMGT(path, String(startTicks), trackIndex, 0);
        if (!clip) {
            throw Z.fail("HOST_ERROR", "Premiere did not insert the template " + path);
        }
        result.steps += 1;
        requireNeighboursUntouched(sequence, trackIndex, before, beforeIds);
        mgt = typeof clip.getMGTComponent === "function" ? clip.getMGTComponent() : null;
        textParam = mgt ? textParamOf(mgt) : null;
        if (!textParam) {
            clip.remove(false, true);
            result.steps += 1;
            throw Z.refuse("UNSUPPORTED", "The template " + P.baseName(path) + " has no scriptable text (Premiere-authored templates " +
                "expose none); it was removed again. Use an After Effects-authored .mogrt, or pass `image`");
        }
        setMogrtText(textParam, text);
        result.steps += 1;
        params = P.paramsOf(mgt);
        for (i = 0; i < params.length; i += 1) {
            if (!sizeParam && /size/i.test(String(params[i].displayName)) && typeof P.valueOf(params[i]) === "number") {
                sizeParam = params[i];
            }
            if (!colorParam && /colou?r/i.test(String(params[i].displayName)) && typeof params[i].setColorValue === "function") {
                colorParam = params[i];
            }
        }
        if (sizeParam) {
            sizeParam.setValue(size, true);
            result.steps += 1;
        } else {
            ctx.warn("The template exposes no size control; it keeps its own type size");
        }
        if (colorParam) {
            colorParam.setColorValue(255, Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255), true);
            result.steps += 1;
        } else {
            ctx.warn("The template exposes no colour control; it keeps its own colour");
        }
        clip = (P.refindClip(sequence, clip.nodeId) || {clip: clip}).clip;
        P.setTimeProperty(clip, "end", endTicks);
        result.steps += 1;
        return clip;
    }

    /**
     * The title-safe box of a frame (TASTE 3): a 10 % inset, or for 9:16 the
     * vertical safe area (top 12 %, bottom 20 %, 10 % at the sides).
     */
    P.titleSafe = function (width, height) {
        var layout = TASTE.layout;
        var vertical = height > width && Math.abs(width / height - 9 / 16) < 0.02;
        return {
            left: width * layout.titleSafe,
            right: width * (1 - layout.titleSafe),
            top: height * (vertical ? layout.verticalTop : layout.titleSafe),
            bottom: height * (1 - (vertical ? layout.verticalBottom : layout.titleSafe)),
            vertical: vertical
        };
    };

    /**
     * Centre (sequence pixels) for a graphic of w x h at a TASTE placement: inside
     * title-safe, lower thirds left-aligned with their bottom at 80 % of the frame
     * height (70 % on vertical).
     */
    P.placementCenter = function (placement, width, height, w, h) {
        var safe = P.titleSafe(width, height);
        var lowerThird = TASTE.layout.lowerThird;
        switch (placement) {
        case "lower-third":
            return [safe.left + w / 2, height * (safe.vertical ? lowerThird.baselineVertical : lowerThird.baselineLandscape) - h / 2];
        case "top-left":
            return [safe.left + w / 2, safe.top + h / 2];
        case "top-center":
            return [width / 2, safe.top + h / 2];
        case "bottom-center":
            return [width / 2, safe.bottom - h / 2];
        default:
            return [width / 2, height / 2];
        }
    };

    function motionParam(clip, name, index) {
        var motion = P.motionOf(clip);
        return motion ? P.findParam(motion, [name], index) : null;
    }

    /**
     * A full-frame title image (the frame's aspect ratio) fills the frame; a
     * smaller graphic keeps its pixel size (scaled down to fit title-safe when
     * larger) and sits at `placement`.
     */
    function layoutImage(sequence, clip, size, placement, ctx, result) {
        var width = sequence.frameSizeHorizontal;
        var height = sequence.frameSizeVertical;
        var safe = P.titleSafe(width, height);
        var scaleParam = motionParam(clip, "Scale", P.MOTION_PARAMS.scale[1]);
        var positionParam = motionParam(clip, "Position", P.MOTION_PARAMS.position[1]);
        var scale;
        var center;
        if (!size || size.width <= 0 || size.height <= 0 || !scaleParam || !positionParam) {
            ctx.warn("Could not read the image size; it is placed as Premiere scales it");
            return {scale: null, position: null};
        }
        if (Math.abs(size.width / size.height - width / height) < 0.01) {
            scale = width / size.width;
            center = [width / 2, height / 2];
        } else {
            scale = Math.min(1, (safe.right - safe.left) / size.width, (safe.bottom - safe.top) / size.height);
            center = P.placementCenter(placement, width, height, size.width * scale, size.height * scale);
        }
        if (Math.abs(scale - 1) > 0.0001) {
            scaleParam.setValue(Z.round(scale * 100, 4), true);
            result.steps += 1;
            ctx.warn("Scaled the " + size.width + "x" + size.height + " image to " + Z.round(scale * 100, 2) + "%");
        }
        if (Math.abs(center[0] - width / 2) > 0.01 || Math.abs(center[1] - height / 2) > 0.01) {
            positionParam.setValue(P.positionToDom(sequence, center), true);
            result.steps += 1;
        }
        return {scale: Z.round(scale * 100, 4), position: [Z.round(center[0], 2), Z.round(center[1], 2)]};
    }

    function placeImage(sequence, path, trackIndex, startTicks, endTicks, placement, ctx, result) {
        var file = P.itemForFile(path, ctx);
        var track = sequence.videoTracks[trackIndex];
        var before = P.clipIds(sequence);
        var neighbours = trackSnapshot(track, {});
        var origIn = String(file.item.getInPoint().ticks);
        var origOut = String(file.item.getOutPoint().ticks);
        /** @type {TrackItem | null} */
        var clip = null;
        var half = Number(sequence.timebase) / 2;
        if (file.imported) {
            result.steps += 1;
        }
        ctx.changed();
        // A still lays down its marked range (by default Premiere's still duration), so mark exactly the
        // title's length first: overwriting more would cut into the next clip on the track.
        result.steps += P.setMarks(file.item, 0, P.ticksToSeconds(endTicks - startTicks));
        try {
            track.overwriteClip(file.item, P.ticksToSeconds(startTicks));
            result.steps += 1;
        } finally {
            try {
                result.steps += P.setMarks(file.item, P.ticksToSeconds(origIn), P.ticksToSeconds(origOut));
            } catch (restoreError) {
                ctx.warn("Could not restore the in/out marks of " + P.baseName(path));
            }
        }
        requireNeighboursUntouched(sequence, trackIndex, neighbours, before);
        Z.each(P.clipsOf(sequence.videoTracks[trackIndex]), function (candidate) {
            if (!Z.has(before, candidate.nodeId) && Math.abs(Number(candidate.start.ticks) - startTicks) < half) {
                clip = candidate;
            }
        });
        if (!clip) {
            throw Z.fail("HOST_ERROR", "Premiere did not place " + P.baseName(path));
        }
        P.setTimeProperty(clip, "end", endTicks);
        result.steps += 1;
        clip = (P.refindClip(sequence, clip.nodeId) || {clip: clip}).clip;
        result.layout = layoutImage(sequence, clip, P.pngSize(path), placement, ctx, result);
        result.imported = file.imported;
        return clip;
    }

    Z.register("premiere_add_text", function (args, ctx) {
        var text = Z.required(args, "text", "string");
        var sequence = P.findSequence(args.sequence);
        var style = Z.oneOf("style", Z.optional(args, "style", "string", "title"), Object.keys(STYLE_SIZES));
        var scale = Math.min(sequence.frameSizeHorizontal, sequence.frameSizeVertical) / TASTE.type.referenceShortSide;
        var size = Z.optional(args, "font_size", "number", null);
        var rgb = Z.color.toRgb(Z.optional(args, "color", "any", TASTE.color.palette.paper), "color");
        var placement = Z.optional(args, "placement", "string", style === "lower-third" ? "lower-third" : style === "caption" ? "bottom-center" : "center");
        var mogrt = Z.optional(args, "mogrt", "string", null);
        var image = Z.optional(args, "image", "string", null);
        var duration = Z.optional(args, "duration", "number", null);
        var time = Z.optional(args, "time", "number", null);
        var trackIndex = Z.optional(args, "track", "integer", null);
        var reading = P.readingTime(text);
        var startTicks;
        var endTicks;
        var result = {steps: 0, imported: false, layout: null};
        var clip;
        var longLines;
        var start;
        var freeUntil;
        var actual;

        if (P.trim(text).length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`text` must not be blank");
        }
        Z.oneOf("placement", placement, ["center", "lower-third", "top-left", "top-center", "bottom-center"]);
        size = size === null ? Math.round(TASTE.type.sizes[STYLE_SIZES[style]] * scale) : Z.inRange("font_size", size, 6, 1000);
        if (mogrt !== null && image !== null) {
            throw Z.refuse("INVALID_ARGUMENT", "Pass `mogrt` or `image`, not both");
        }
        if (mogrt === null && image === null) {
            throw Z.refuse("UNSUPPORTED", "Premiere's scripting API cannot type text into its own title templates. Pass `image` " +
                "(a transparent PNG title at the sequence size, " + sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical +
                ", e.g. rendered by Zenvi) or `mogrt` (an After Effects-authored .mogrt with a text control)");
        }
        if (mogrt !== null && (P.extensionOf(mogrt) !== "mogrt" || !P.isFile(mogrt))) {
            throw Z.refuse(P.isFile(mogrt) ? "INVALID_ARGUMENT" : "NOT_FOUND", "`mogrt` must be an existing .mogrt file: " + mogrt);
        }
        if (image !== null && (P.extensionOf(image) !== "png" || !P.isFile(image))) {
            throw Z.refuse(P.isFile(image) ? "INVALID_ARGUMENT" : "NOT_FOUND", "`image` must be an existing .png file: " + image);
        }
        duration = duration === null ? P.titleDuration(text, style) : Z.inRange("duration", duration, 0.04, 3600);
        if (duration < reading - 0.0005) {
            ctx.warn("On screen for " + Z.round(duration, 3) + " s, under the " + Z.round(reading, 2) + " s reading time for " +
                Z.plural(words(text), "word") + " (TASTE: 1.5 s + 0.3 s per word)");
        }
        start = time === null ? P.timeToSeconds(sequence.getPlayerPosition()) : Z.inRange("time", time, 0, null);
        start = P.snapTime(sequence, start, ctx, "time");
        startTicks = Math.round(start * P.TICKS_PER_SECOND);
        endTicks = Math.round(P.snapTime(sequence, start + duration, null) * P.TICKS_PER_SECOND);
        longLines = Z.filter(text.split(/\r?\n/), function (line) { return line.length > TASTE.type.maxLineChars; });
        if (longLines.length > 0) {
            ctx.warn(Z.plural(longLines.length, "line") + " longer than " + TASTE.type.maxLineChars + " characters; break on phrases (TASTE 4)");
        }

        // A template is laid down at its own length before it is trimmed, so its track must be free
        // from the title's start onward; an image is marked to the title's length first.
        freeUntil = mogrt !== null ? Infinity : endTicks;
        if (trackIndex === null) {
            trackIndex = P.freeVideoTrack(sequence, startTicks, freeUntil, 1);
            if (trackIndex < 0) {
                throw Z.refuse("INVALID_ARGUMENT", "No video track above V1 is free from " + Z.round(start, 3) + " " +
                    (mogrt !== null ? "onward (a template needs room for its own length)" : "to " + Z.round(P.ticksToSeconds(endTicks), 3) + " s") +
                    "; add a track in Premiere or pass `track`");
            }
        } else {
            P.findTrack(sequence, {kind: "video", index: trackIndex});
            P.requireUnlocked(sequence.videoTracks[trackIndex], "video", trackIndex);
            if (P.overlapping(sequence.videoTracks[trackIndex], startTicks, freeUntil, {}).length > 0) {
                throw Z.refuse("INVALID_ARGUMENT", "Track V" + (trackIndex + 1) + " already has a clip " +
                    (mogrt !== null ? "after " + Z.round(start, 3) + " s (a template needs room for its own length)" :
                        "between " + Z.round(start, 3) + " and " + Z.round(P.ticksToSeconds(endTicks), 3) + " s") +
                    "; pick a free track (or omit `track`)");
            }
        }

        if (mogrt !== null) {
            clip = placeMogrt(sequence, mogrt, trackIndex, startTicks, endTicks, text, size, rgb, ctx, result);
        } else {
            clip = placeImage(sequence, image, trackIndex, startTicks, endTicks, placement, ctx, result);
        }
        actual = P.timeToSeconds(clip.end) - P.timeToSeconds(clip.start);
        if (Math.abs(actual * P.TICKS_PER_SECOND - (endTicks - startTicks)) >= Number(sequence.timebase) / 2) {
            ctx.warn("The title runs " + Z.round(actual, 3) + " s, not " + Z.round(P.ticksToSeconds(endTicks - startTicks), 3) +
                " s (the " + (mogrt !== null ? "template" : "image") + " is shorter)");
        }
        return Z.applied("Added the title \"" + (text.length > 40 ? text.slice(0, 37) + "..." : text) + "\" on V" + (trackIndex + 1) + " at " +
            Z.round(start, 3) + " s for " + Z.round(actual, 3) + " s (" + (mogrt !== null ? "template" : "image") + ")", {
            clip: P.clipDetail(sequence, clip, "video", trackIndex, false),
            source: mogrt !== null ? "mogrt" : "image",
            text: text,
            style: style,
            font_size: size,
            color: Z.color.toHex(rgb),
            placement: mogrt !== null ? "template" : placement,
            layout: result.layout,
            reading_time: Z.round(reading, 2),
            imported: result.imported
        }, result.steps);
    });

    // ------------------------------------------------------------------
    // premiere_add_captions

    /** Sequence.CAPTION_FORMAT_* constant names (scripting guide, Sequence.createCaptionTrack). */
    var CAPTION_FORMATS = {
        subtitle: "CAPTION_FORMAT_SUBTITLE",
        "cea-608": "CAPTION_FORMAT_608",
        "cea-708": "CAPTION_FORMAT_708",
        teletext: "CAPTION_FORMAT_TELETEXT",
        ebu: "CAPTION_FORMAT_OPEN_EBU",
        op42: "CAPTION_FORMAT_OP42",
        op47: "CAPTION_FORMAT_OP47"
    };

    Z.register("premiere_add_captions", function (args, ctx) {
        var srt = Z.required(args, "srt", "string");
        var sequence = P.findSequence(args.sequence);
        var format = Z.oneOf("format", Z.optional(args, "format", "string", "subtitle"), Object.keys(CAPTION_FORMATS));
        var time = P.snapTime(sequence, Z.inRange("time", Z.optional(args, "time", "number", 0), 0, null), ctx, "time");
        var constant = null;
        var file;
        var created;
        var steps = 1;
        if (P.extensionOf(srt) !== "srt") {
            throw Z.refuse("INVALID_ARGUMENT", "`srt` must be a .srt file, got " + srt);
        }
        if (!P.isFile(srt)) {
            throw Z.refuse("NOT_FOUND", "No file at " + srt);
        }
        P.requireFeature(typeof sequence.createCaptionTrack === "function", "Sequence.createCaptionTrack", "2021 (15.0)");
        if (typeof Sequence !== "undefined" && Sequence && typeof Sequence[CAPTION_FORMATS[format]] === "number") {
            constant = Sequence[CAPTION_FORMATS[format]];
        } else if (format !== "subtitle") {
            throw Z.refuse("UNSUPPORTED", "This Premiere build does not expose Sequence." + CAPTION_FORMATS[format]);
        }
        file = P.itemForFile(srt, ctx);
        if (file.imported) {
            steps += 1;
        }
        ctx.changed();
        created = constant === null ? sequence.createCaptionTrack(file.item, time) : sequence.createCaptionTrack(file.item, time, constant);
        if (created === false || created === 0) {
            throw Z.fail("HOST_ERROR", "Premiere did not create a caption track from " + P.baseName(srt));
        }
        return Z.applied("Added a " + format + " caption track from \"" + P.baseName(srt) + "\" at " + Z.round(time, 3) + " s to \"" +
            sequence.name + "\"", {
            srt: srt,
            item: {node_id: file.item.nodeId, name: String(file.item.name)},
            imported: file.imported,
            time: Z.round(time, 4),
            format: format,
            sequence_id: sequence.sequenceID
        }, steps);
    });
}(ZenviLink));
