// Zenvi Link: ae_import_files, plus the import helper ae_add_layer uses for
// footage given by path. Every path is checked before anything is imported,
// and files already in the project are reused.

(function (Z) {
    var AE = Z.ae;

    /** Footage items by AE.pathKey of their file. */
    AE.footageByPath = function () {
        var project = AE.requireProject();
        var map = {};
        var item;
        var i;
        for (i = 1; i <= project.numItems; i += 1) {
            item = project.item(i);
            if (item instanceof FootageItem && item.file) {
                map[AE.pathKey(item.file.fsName)] = item;
            }
        }
        return map;
    };

    /**
     * Check `paths` before importing: absolute, existing, importable as
     * footage. Returns [{path, file, key, options}]; refuses NOT_FOUND /
     * UNSUPPORTED naming every bad path.
     */
    AE.planImports = function (paths, sequence) {
        var missing = [];
        var unsupported = [];
        var planned = [];
        var file;
        var options;
        var i;
        for (i = 0; i < paths.length; i += 1) {
            AE.requireAbsolutePath(paths[i], "paths[" + i + "]");
            file = new File(paths[i]);
            if (!file.exists) {
                missing.push(paths[i]);
                continue;
            }
            options = new ImportOptions(file);
            if (sequence) {
                options.sequence = true;
            }
            if (!options.canImportAs(ImportAsType.FOOTAGE)) {
                unsupported.push(paths[i]);
                continue;
            }
            options.importAs = ImportAsType.FOOTAGE;
            planned.push({path: paths[i], file: file, key: AE.pathKey(paths[i]), options: options});
        }
        if (missing.length) {
            throw Z.refuse("NOT_FOUND", (missing.length === 1 ? "File does not exist: " : "Files do not exist: ") + missing.join(", "));
        }
        if (unsupported.length) {
            throw Z.refuse("UNSUPPORTED", "After Effects cannot import as footage: " + unsupported.join(", "));
        }
        return planned;
    };

    /**
     * Import planned files into `folderName` (created when missing). Reuses
     * items whose file is already imported when `dedupe`. Returns
     * [{path, item, reused}] in the order given.
     */
    AE.importPlanned = function (planned, folderName, dedupe) {
        var existing = dedupe ? AE.footageByPath() : {};
        var folder = null;
        var results = [];
        var item;
        var i;
        for (i = 0; i < planned.length; i += 1) {
            if (Z.has(existing, planned[i].key)) {
                results.push({path: planned[i].path, item: existing[planned[i].key], reused: true});
                continue;
            }
            if (!folder) {
                folder = AE.findOrCreateFolder(folderName);
            }
            item = app.project.importFile(planned[i].options);
            item.parentFolder = folder;
            existing[planned[i].key] = item;
            results.push({path: planned[i].path, item: item, reused: false});
        }
        return results;
    };

    Z.register("ae_import_files", function (args, ctx) {
        var paths = Z.required(args, "paths", "array");
        var folderName = Z.optional(args, "folder", "string", "Zenvi Imports");
        var sequence = Z.optional(args, "sequence", "boolean", false);
        var dedupe = Z.optional(args, "dedupe", "boolean", true);
        var planned;
        var results;
        var imported = 0;
        var existing;
        var seen = {};
        var items;
        var i;
        AE.requireProject();
        if (!paths.length || paths.length > 500) {
            throw Z.refuse("INVALID_ARGUMENT", "`paths` takes 1-500 files");
        }
        planned = AE.planImports(paths, sequence);
        existing = dedupe ? AE.footageByPath() : {};
        for (i = 0; i < planned.length; i += 1) {
            if (dedupe && (Z.has(existing, planned[i].key) || Z.has(seen, planned[i].key))) {
                continue;
            }
            seen[planned[i].key] = true;
            imported += 1;
        }
        if (imported === 0) {
            results = AE.importPlanned(planned, folderName, dedupe);
            return Z.unchanged("All " + Z.plural(results.length, "file") + " are already in the project", {
                items: Z.map(results, function (result) {
                    var summary = AE.itemSummary(result.item);
                    summary.path = result.path;
                    summary.reused = true;
                    return summary;
                })
            });
        }
        ctx.changed();
        results = AE.importPlanned(planned, folderName, dedupe);
        items = Z.map(results, function (result) {
            var summary = AE.itemSummary(result.item);
            summary.path = result.path;
            summary.reused = result.reused;
            return summary;
        });
        imported = Z.filter(results, function (result) { return !result.reused; }).length;
        return Z.applied("Imported " + Z.plural(imported, "file") + " into \"" + folderName + "\"" +
            (results.length > imported ? " (" + (results.length - imported) + " already in the project)" : ""), {
            items: items,
            folder: folderName
        });
    });
}(ZenviLink));
