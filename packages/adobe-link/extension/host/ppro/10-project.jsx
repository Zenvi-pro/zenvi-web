// Zenvi Link: Premiere Pro project tools. premiere_list_items,
// premiere_import_files, premiere_save_project.

(function (Z) {
    var P = Z.ppro;

    /** Seconds of a project item's in or out mark ("" when Premiere has none). */
    function markSeconds(item, getter) {
        var time;
        try {
            time = typeof item[getter] === "function" ? item[getter]() : null;
        } catch (error) {
            time = null;
        }
        return time ? P.sec(time) : null;
    }

    function isOffline(item) {
        try {
            return typeof item.isOffline === "function" && item.isOffline() === true;
        } catch (error) {
            return false;
        }
    }

    /** sequence project item nodeId -> Sequence. */
    function sequencesByItem() {
        var map = {};
        Z.each(P.sequences(), function (sequence) {
            if (sequence.projectItem) {
                map[sequence.projectItem.nodeId] = sequence;
            }
        });
        return map;
    }

    /** bin, sequence, media (has a file) or clip (synthetic: titles, bars, nests that are not sequences). */
    function kindOf(item, sequenceMap) {
        if (item.type === P.itemType("ROOT")) {
            return "root";
        }
        if (item.type === P.itemType("BIN")) {
            return "bin";
        }
        if (Z.has(sequenceMap, item.nodeId)) {
            return "sequence";
        }
        return P.mediaPath(item) ? "media" : "clip";
    }

    /** One project item for receipts. */
    P.itemSummary = function (item, binPath, sequenceMap) {
        var kind = kindOf(item, sequenceMap || sequencesByItem());
        var data = {node_id: item.nodeId, name: String(item.name), kind: kind, bin: binPath || "/"};
        var inPoint;
        var outPoint;
        var sequence;
        if (kind === "media" || kind === "clip") {
            inPoint = markSeconds(item, "getInPoint");
            outPoint = markSeconds(item, "getOutPoint");
            data.media_path = P.mediaPath(item) || null;
            data.in_point = inPoint;
            data.out_point = outPoint;
            data.duration = inPoint !== null && outPoint !== null ? Z.round(outPoint - inPoint, 4) : null;
            data.offline = isOffline(item);
        } else if (kind === "sequence") {
            sequence = (sequenceMap || sequencesByItem())[item.nodeId];
            data.sequence_id = sequence.sequenceID;
            data.duration = Z.round(P.ticksToSeconds(sequence.end), 4);
        }
        return data;
    };

    // ------------------------------------------------------------------
    // premiere_list_items

    Z.register("premiere_list_items", function (args, ctx) {
        var project = P.requireProject();
        var kind = Z.oneOf("kind", Z.optional(args, "kind", "string", "any"), ["any", "media", "sequence", "bin"]);
        var needle = Z.optional(args, "name_contains", "string", null);
        var recursive = Z.optional(args, "recursive", "boolean", true);
        var limit = Z.inRange("limit", Z.optional(args, "limit", "integer", 200), 1, 2000);
        var binRef = Z.optional(args, "bin", "string", null);
        var start = binRef === null ? project.rootItem : P.findBin(binRef, false);
        var startPath = "";
        var sequenceMap = sequencesByItem();
        var items = [];
        var matched = 0;
        var counts = {bin: 0, sequence: 0, media: 0, clip: 0};
        if (binRef !== null && start.nodeId !== project.rootItem.nodeId) {
            startPath = String(start.treePath || start.name).replace(/\\/g, "/").replace(/^\/+[^\/]*\/?/, "");
            if (!startPath) {
                startPath = String(start.name);
            }
        }
        if (needle !== null) {
            needle = needle.toLowerCase();
        }

        P.walkItems(start, function (item, depth, path) {
            var itemKind;
            if (!recursive && depth > 0) {
                return true;
            }
            itemKind = kindOf(item, sequenceMap);
            if (kind !== "any" && itemKind !== kind) {
                return true;
            }
            if (needle !== null && String(item.name).toLowerCase().indexOf(needle) < 0) {
                return true;
            }
            matched += 1;
            if (Z.has(counts, itemKind)) {
                counts[itemKind] += 1;
            }
            if (items.length < limit) {
                items.push(P.itemSummary(item, startPath ? (path ? startPath + "/" + path : startPath) : path, sequenceMap));
            }
            return true;
        });

        if (matched > items.length) {
            ctx.warn("Listed the first " + items.length + " of " + matched + " matching items; raise `limit` or filter by `kind`, `name_contains` or `bin`");
        }
        return Z.ok("Listed " + items.length + (matched > items.length ? " of " + matched : "") + " project items (" +
            Z.plural(counts.bin, "bin") + ", " + Z.plural(counts.sequence, "sequence") + ", " + counts.media + " media, " +
            Z.plural(counts.clip, "other clip") + ")", {
            items: items,
            total: matched,
            truncated: matched > items.length
        });
    });

    // ------------------------------------------------------------------
    // premiere_import_files

    Z.register("premiere_import_files", function (args, ctx) {
        var paths = Z.required(args, "paths", "array");
        var binRef = Z.optional(args, "bin", "string", "Zenvi Imports");
        var dedupe = Z.optional(args, "dedupe", "boolean", true);
        var stills = Z.optional(args, "image_sequence", "boolean", false);
        var missing = [];
        var unique = [];
        var seen = {};
        var existingIndex;
        var results = [];
        var toImport = [];
        var created = [];
        var bin;
        var before;
        var added;
        var addedByPath = {};
        var imported = 0;
        var reused = 0;
        var failed = [];
        var binPath;
        var accepted;

        P.requireProject();
        if (paths.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`paths` needs at least one file");
        }
        Z.each(paths, function (path, i) {
            if (typeof path !== "string" || path.length === 0) {
                throw Z.refuse("INVALID_ARGUMENT", "`paths[" + i + "]` must be an absolute file path");
            }
            if (!Z.has(seen, P.normalPath(path))) {
                seen[P.normalPath(path)] = true;
                unique.push(path);
            }
            if (!P.isFile(path)) {
                missing.push(path);
            }
        });
        if (missing.length > 0) {
            throw Z.refuse("NOT_FOUND", Z.plural(missing.length, "file") + " not found, nothing imported: " +
                missing.slice(0, 5).join(", ") + (missing.length > 5 ? ", ..." : ""));
        }

        existingIndex = dedupe ? P.mediaIndex() : {};
        Z.each(unique, function (path) {
            var item = existingIndex[P.normalPath(path)];
            if (item) {
                results.push({path: path, status: "existing", node_id: item.nodeId, name: String(item.name)});
                reused += 1;
            } else {
                results.push({path: path, status: "pending"});
                toImport.push(path);
            }
        });
        if (toImport.length === 0) {
            return Z.unchanged("All " + Z.plural(unique.length, "file is", "files are") + " already in the project", {
                items: results,
                bin: null
            });
        }

        bin = P.findBin(binRef, true, ctx, created);
        binPath = P.isBin(bin) && bin.nodeId === app.project.rootItem.nodeId ? "/" : binRef;
        before = P.itemIds();
        ctx.changed();
        accepted = app.project.importFiles(toImport, true, bin, stills);
        added = P.newItems(before);
        Z.each(added, function (item) {
            var path = P.mediaPath(item);
            if (path && !Z.has(addedByPath, P.normalPath(path))) {
                addedByPath[P.normalPath(path)] = item;
            }
        });
        Z.each(results, function (entry) {
            var item;
            if (entry.status !== "pending") {
                return;
            }
            item = addedByPath[P.normalPath(entry.path)];
            if (item) {
                entry.status = "imported";
                entry.node_id = item.nodeId;
                entry.name = String(item.name);
                imported += 1;
            } else {
                entry.status = "failed";
                failed.push(entry.path);
            }
        });
        if (imported === 0 && added.length === 0) {
            throw Z.fail("HOST_ERROR", "Premiere imported none of " + Z.plural(toImport.length, "file") +
                (accepted === false ? " (importFiles returned false)" : "") + ": " + toImport.slice(0, 3).join(", "));
        }
        if (failed.length > 0) {
            ctx.warn("Premiere did not import " + failed.slice(0, 5).join(", ") + (failed.length > 5 ? ", ..." : "") +
                " (unsupported format or a dialog was suppressed)");
        }
        return Z.applied("Imported " + Z.plural(imported, "file") + " into bin \"" + binPath + "\"" +
            (reused > 0 ? ", " + reused + " already in the project" : "") +
            (created.length > 0 ? " (created bin " + created.join(", ") + ")" : ""), {
            items: results,
            bin: {node_id: bin.nodeId, path: binPath},
            created_bins: created
        }, created.length + 1);
    });

    // ------------------------------------------------------------------
    // premiere_save_project

    Z.register("premiere_save_project", function (args, ctx) {
        var project = P.requireProject();
        var path = Z.optional(args, "path", "string", null);
        var previous = P.projectPath();
        var saved;
        if (path === null || (previous && P.normalPath(path) === P.normalPath(previous))) {
            ctx.changed();
            project.save();
            return Z.applied("Saved project \"" + project.name + "\"", {path: P.projectPath(), saved_as: false}, 0);
        }
        if (P.extensionOf(path) !== "prproj") {
            throw Z.refuse("INVALID_ARGUMENT", "`path` must end in .prproj, got " + path);
        }
        if (new File(path).exists) {
            throw Z.refuse("INVALID_ARGUMENT", path + " already exists; Save As will not replace another project");
        }
        P.ensureParent(path);
        ctx.changed();
        project.saveAs(path);
        if (!new File(path).exists) {
            throw Z.fail("HOST_ERROR", "Premiere did not write " + path);
        }
        saved = P.projectPath() || path;
        return Z.applied("Saved the project as " + path + "; Premiere now has that copy open", {
            path: saved,
            previous_path: previous,
            saved_as: true
        }, 0);
    });
}(ZenviLink));
