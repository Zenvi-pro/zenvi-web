// Zenvi Link: Premiere Pro output and interchange. premiere_capture_frame,
// premiere_export, premiere_export_xml, premiere_import_xml.

(function (Z) {
    var P = Z.ppro;

    /** A file name without characters Windows or macOS refuse (keeps spaces and dots). */
    P.fileSafe = function (text) {
        var cleaned = String(text).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[\s.]+|[\s.]+$/g, "");
        return cleaned.length ? cleaned.slice(0, 120) : "Untitled";
    };

    /** The folder of the open project, or Documents when the project was never saved. */
    function projectFolder() {
        var path = P.projectPath();
        return path ? new File(path).parent.fsName : Folder.myDocuments.fsName;
    }

    // ------------------------------------------------------------------
    // premiere_capture_frame

    Z.register("premiere_capture_frame", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var time = Z.optional(args, "time", "number", null);
        var qeSequence;
        var timecode;
        var base;
        var expected;
        var stale;
        var size;
        time = time === null ? P.timeToSeconds(sequence.getPlayerPosition()) : Z.inRange("time", time, 0, null);
        time = P.snapTime(sequence, time, ctx, "time");
        qeSequence = P.qeSequence(sequence, ctx);
        if (typeof qeSequence.exportFramePNG !== "function") {
            throw Z.refuse("UNSUPPORTED", "This Premiere build's QE DOM has no exportFramePNG");
        }
        timecode = P.timecode(sequence, time);
        // exportFramePNG(timecode, path without extension) appends ".png" itself and cuts the
        // name at its first dot, so the name has none (premiere-pro-mcp, Premiere 25.2).
        base = P.join(P.tempFolder().fsName, P.uniqueName("zenvi-frame"));
        expected = base + ".png";
        stale = new File(expected);
        if (stale.exists) {
            stale.remove();
        }
        qeSequence.exportFramePNG(timecode, base);
        size = P.waitForFile(expected, 20000);
        if (!size) {
            throw Z.fail("HOST_ERROR", "Premiere wrote no frame to " + expected + " within 20 s (QE exportFramePNG at " + timecode + ")");
        }
        return Z.ok("Captured " + timecode + " (" + Z.round(time, 4) + " s) of \"" + sequence.name + "\" at " +
            sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical, {
            image_path: expected,
            time: Z.round(time, 4),
            timecode: timecode,
            frame: Math.round(time * P.fps(sequence)),
            width: sequence.frameSizeHorizontal,
            height: sequence.frameSizeVertical,
            sequence_id: sequence.sequenceID,
            bytes: size
        });
    });

    // ------------------------------------------------------------------
    // premiere_export

    /**
     * Named presets: Media Encoder preset file names to look for, best first,
     * and the format folder they live in (systempresets/<exporter>_<format>, the
     * format in hex: 48323634 = "H264", 4D6F6F56 = "MooV" QuickTime).
     */
    var EXPORT_PRESETS = {
        "h264-high": {
            format: "48323634",
            ext: "mp4",
            names: ["Match Source - Adaptive High Bitrate", "Match Source - High bitrate", "High Quality 1080p HD"]
        },
        "h264-social-vertical": {
            format: "48323634",
            ext: "mp4",
            vertical: true,
            names: ["Match Source - Adaptive High Bitrate", "Match Source - High bitrate"]
        },
        "prores-422": {
            format: "4d6f6f56",
            ext: "mov",
            names: ["Apple ProRes 422"],
            contains: "prores 422",
            exclude: /hq|lt|proxy|4444|xq|raw/
        }
    };

    var WORK_AREA = {entire: 0, "in-out": 1, "work-area": 2};

    function normalName(text) {
        return P.trim(String(text).toLowerCase().replace(/\.epr$/, "").replace(/[^a-z0-9]+/g, " "));
    }

    /** Folders holding export presets: Premiere's and Media Encoder's systempresets, and the user's Media Encoder presets. */
    P.exportPresetRoots = function () {
        var roots = [];
        var resources = P.appResources();
        var appFolder;
        var parent;
        var entries;
        var bundles;
        var entry;
        var versions;
        var i;
        var j;
        var user;
        if (resources) {
            roots.push(new Folder(resources.fsName + "/MediaIO/systempresets"));
        }
        if (app.path) {
            appFolder = new Folder(String(app.path).replace(/[\\\/]+$/, ""));
            parent = /\.app$/i.test(appFolder.fsName) ? appFolder.parent.parent : appFolder.parent;
            entries = parent && parent.exists ? parent.getFiles() : [];
            for (i = 0; i < entries.length; i += 1) {
                entry = entries[i];
                if (entry instanceof Folder && /^Adobe Media Encoder/i.test(decodeURI(entry.name))) {
                    bundles = entry.getFiles();
                    for (j = 0; j < bundles.length; j += 1) {
                        if (bundles[j] instanceof Folder && /\.app$/i.test(decodeURI(bundles[j].name))) {
                            roots.push(new Folder(bundles[j].fsName + "/Contents/MediaIO/systempresets"));
                        }
                    }
                    roots.push(new Folder(entry.fsName + "/MediaIO/systempresets"));
                }
            }
        }
        user = new Folder(Folder.myDocuments.fsName + "/Adobe/Adobe Media Encoder");
        versions = user.exists ? user.getFiles() : [];
        for (i = 0; i < versions.length; i += 1) {
            if (versions[i] instanceof Folder) {
                roots.push(new Folder(versions[i].fsName + "/Presets"));
            }
        }
        return Z.filter(roots, function (root) { return root.exists; });
    };

    P.exportPresets = function () {
        var presets = [];
        Z.each(P.exportPresetRoots(), function (root) {
            Z.each(P.findFiles(root, function (name) { return /\.epr$/i.test(name); }, 3, 3000), function (file) {
                presets.push({
                    file: file,
                    name: decodeURI(file.name).replace(/\.epr$/i, ""),
                    normal: normalName(decodeURI(file.name)),
                    bucket: file.parent ? decodeURI(file.parent.name).toLowerCase() : ""
                });
            });
        });
        return presets;
    };

    function bestOf(candidates, format) {
        var inFormat = Z.filter(candidates, function (preset) { return preset.bucket.indexOf(format) >= 0; });
        var pool = inFormat.length ? inFormat : candidates;
        var best = null;
        Z.each(pool, function (preset) {
            if (best === null || preset.name.length < best.name.length) {
                best = preset;
            }
        });
        return best;
    }

    /** {path, name} of the .epr for a named preset or a path; refuses NOT_FOUND listing what is installed. */
    function resolvePreset(preset) {
        var rule;
        var all;
        var found = null;
        var i;
        var examples;
        if (/^(\/|[A-Za-z]:[\\\/]|\\\\)/.test(preset)) {
            if (P.extensionOf(preset) !== "epr") {
                throw Z.refuse("INVALID_ARGUMENT", "`preset` must be h264-high, h264-social-vertical, prores-422 or an .epr file, got " + preset);
            }
            if (!P.isFile(preset)) {
                throw Z.refuse("NOT_FOUND", "No export preset at " + preset);
            }
            return {path: preset, name: P.baseName(preset).replace(/\.epr$/i, ""), rule: null};
        }
        rule = EXPORT_PRESETS[Z.oneOf("preset", preset, Object.keys(EXPORT_PRESETS))];
        all = P.exportPresets();
        for (i = 0; i < rule.names.length && !found; i += 1) {
            found = bestOf(Z.filter(all, function (candidate) { return candidate.normal === normalName(rule.names[i]); }), rule.format);
        }
        if (!found && rule.contains) {
            found = bestOf(Z.filter(all, function (candidate) {
                return candidate.normal.indexOf(rule.contains) >= 0 && !rule.exclude.test(candidate.normal);
            }), rule.format);
        }
        if (!found) {
            examples = Z.map(all.slice(0, 12), function (candidate) { return candidate.name; });
            throw Z.refuse("NOT_FOUND", "No installed export preset matches " + preset + " (looked for " + rule.names.join(", ") +
                " in Premiere and Media Encoder presets). Found " + Z.plural(all.length, "preset") +
                (examples.length ? ", e.g. " + examples.join(", ") : "") + ". Pass the path of an .epr instead");
        }
        return {path: found.file.fsName, name: found.name, rule: rule};
    }

    function outputPath(args, sequence, ext) {
        var output = Z.optional(args, "output", "string", null);
        if (output === null) {
            return P.join(P.join(projectFolder(), "Zenvi Exports"), P.fileSafe(sequence.name) + "." + ext);
        }
        return P.extensionOf(output) === "" ? output + "." + ext : output;
    }

    Z.register("premiere_export", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var presetArg = Z.optional(args, "preset", "string", "h264-high");
        var range = Z.oneOf("range", Z.optional(args, "range", "string", "entire"), Object.keys(WORK_AREA));
        var via = Z.oneOf("via", Z.optional(args, "via", "string", "media_encoder"), ["media_encoder", "direct"]);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var preset = resolvePreset(presetArg);
        var ext = "";
        var output;
        var existing;
        var status = null;
        var job;
        var result;
        var written;
        var ratio = sequence.frameSizeHorizontal / sequence.frameSizeVertical;

        if (preset.rule && preset.rule.vertical && Math.abs(ratio - 9 / 16) > 0.01) {
            throw Z.refuse("INVALID_ARGUMENT", "h264-social-vertical needs a 9:16 sequence; \"" + sequence.name + "\" is " +
                sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical + ". Run premiere_auto_reframe with aspect 9:16 and export that");
        }
        try {
            ext = String(sequence.getExportFileExtension(preset.path) || "").replace(/^\./, "");
        } catch (error) {
            ext = "";
        }
        if (!ext) {
            ext = preset.rule ? preset.rule.ext : "mp4";
        }
        output = outputPath(args, sequence, ext);
        existing = new File(output);
        if (existing.exists && !overwrite) {
            throw Z.refuse("INVALID_ARGUMENT", output + " already exists; pass overwrite: true or another `output`");
        }
        if (P.extensionOf(output) !== ext.toLowerCase()) {
            ctx.warn("The preset writes ." + ext + " files; the output is named " + P.baseName(output));
        }
        if (via === "media_encoder") {
            P.requireFeature(app.encoder && typeof app.encoder.encodeSequence === "function", "Exporting through Media Encoder (app.encoder)",
                "2022 (22.0) on macOS");
            if (typeof BridgeTalk !== "undefined" && BridgeTalk && typeof BridgeTalk.getStatus === "function") {
                status = String(BridgeTalk.getStatus("ame"));
            }
            if (status === "ISNOTINSTALLED") {
                throw Z.refuse("UNSUPPORTED", "Adobe Media Encoder is not installed; pass via: direct to render inside Premiere");
            }
        }

        ctx.changed();
        if (existing.exists) {
            existing.remove();
        }
        P.ensureParent(output);
        if (via === "media_encoder") {
            if (status === "ISNOTRUNNING") {
                app.encoder.launchEncoder();
                ctx.warn("Started Adobe Media Encoder");
            }
            job = app.encoder.encodeSequence(sequence, output, preset.path, WORK_AREA[range], 1);
            if (!job || String(job) === "0") {
                throw Z.fail("HOST_ERROR", "Media Encoder did not accept the job for \"" + sequence.name + "\"");
            }
            app.encoder.startBatch();
            return Z.applied("Queued \"" + sequence.name + "\" in Media Encoder with " + preset.name + " (job " + job + "); it renders to " + output, {
                job: {id: String(job), via: "media_encoder", status: "queued"},
                output: output,
                preset: {name: preset.name, path: preset.path},
                range: range,
                sequence_id: sequence.sequenceID
            }, 0);
        }
        result = sequence.exportAsMediaDirect(output, preset.path, WORK_AREA[range]);
        written = new File(output);
        if (!written.exists || written.length === 0) {
            throw Z.fail("HOST_ERROR", "Premiere wrote no file at " + output + (result ? " (exportAsMediaDirect returned " + String(result) + ")" : ""));
        }
        return Z.applied("Exported \"" + sequence.name + "\" to " + output + " (" + Z.round(written.length / 1048576, 1) + " MB) with " + preset.name, {
            job: {id: null, via: "direct", status: "done"},
            output: output,
            bytes: written.length,
            preset: {name: preset.name, path: preset.path},
            range: range,
            sequence_id: sequence.sequenceID
        }, 0);
    });

    // ------------------------------------------------------------------
    // premiere_export_xml

    Z.register("premiere_export_xml", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var output = Z.optional(args, "output", "string", null);
        var existing;
        var size;
        if (output === null) {
            output = P.join(P.tempFolder().fsName, P.safeName(sequence.name) + "-" + new Date().getTime() + ".xml");
        } else if (P.extensionOf(output) !== "xml") {
            throw Z.refuse("INVALID_ARGUMENT", "`output` must end in .xml, got " + output);
        }
        existing = new File(output);
        if (existing.exists && !overwrite) {
            throw Z.refuse("INVALID_ARGUMENT", output + " already exists; pass overwrite: true or another `output`");
        }
        ctx.changed();
        if (existing.exists) {
            existing.remove();
        }
        P.ensureParent(output);
        // 1 = suppress warning dialogs (PProPanel exportFCPXML).
        sequence.exportAsFinalCutProXML(output, 1);
        size = P.waitForFile(output, 10000);
        if (!size) {
            throw Z.fail("HOST_ERROR", "Premiere wrote no XML at " + output);
        }
        return Z.applied("Exported \"" + sequence.name + "\" as FCP XML to " + output, {
            path: output,
            bytes: size,
            sequence_id: sequence.sequenceID,
            name: String(sequence.name)
        }, 0);
    });

    // ------------------------------------------------------------------
    // premiere_import_xml

    function isOffline(item) {
        try {
            return typeof item.isOffline === "function" && item.isOffline() === true;
        } catch (error) {
            return false;
        }
    }

    Z.register("premiere_import_xml", function (args, ctx) {
        var path = Z.required(args, "path", "string");
        var binRef = Z.optional(args, "bin", "string", "Zenvi Imports");
        var open = Z.optional(args, "open", "boolean", true);
        var created = [];
        var bin;
        var beforeSequences;
        var beforeItems;
        var sequences = [];
        var items;
        var offline;
        var all;
        var i;
        if (P.extensionOf(path) !== "xml") {
            throw Z.refuse("INVALID_ARGUMENT", "`path` must be an .xml file (Final Cut Pro 7 XML), got " + path);
        }
        if (!P.isFile(path)) {
            throw Z.refuse("NOT_FOUND", "No file at " + path);
        }
        bin = P.findBin(binRef, true, ctx, created);
        beforeSequences = P.sequenceIds();
        beforeItems = P.itemIds();
        ctx.changed();
        app.project.importFiles([path], true, bin, false);
        all = P.sequences();
        for (i = 0; i < all.length; i += 1) {
            if (!Z.has(beforeSequences, all[i].sequenceID)) {
                sequences.push(all[i]);
            }
        }
        items = P.newItems(beforeItems);
        if (sequences.length === 0) {
            throw Z.fail("HOST_ERROR", "Premiere imported no sequence from " + P.baseName(path) +
                " (is it Final Cut Pro 7 XML, xmeml?)" + (items.length ? "; it added " + Z.plural(items.length, "item") : ""));
        }
        offline = Z.filter(items, isOffline);
        if (offline.length > 0) {
            ctx.warn(Z.plural(offline.length, "media item") + " offline (missing at the XML's paths): " +
                Z.map(offline.slice(0, 5), function (item) { return String(item.name); }).join(", "));
        }
        if (open) {
            P.openSequence(sequences[0]);
        }
        return Z.applied("Imported \"" + P.baseName(path) + "\": " + Z.map(sequences, function (sequence) {
            return "\"" + sequence.name + "\" (" + sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical + ", " +
                Z.round(P.fps(sequence), 3) + " fps, " + Z.round(P.ticksToSeconds(sequence.end), 3) + " s)";
        }).join(", ") + (open ? ", opened" : ""), {
            sequences: Z.map(sequences, P.sequenceSummary),
            items: items.length,
            offline: Z.map(offline, function (item) { return {node_id: item.nodeId, name: String(item.name)}; }),
            bin: binRef,
            created_bins: created
        }, 1 + created.length);
    });
}(ZenviLink));
