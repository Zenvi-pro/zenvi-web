// Zenvi Link: After Effects host core. The helpers every ae_* tool uses
// (ZenviLink.ae), the undo-group adapter, and ae_get_state.
//
// IDs (SPEC 3.3): items by item.id; layers by layer.id (After Effects 22+)
// plus comp_id + layer_index for convenience. Times are comp seconds.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = /** @type {ZenviAe} */ ({});
    Z.ae = AE;
    Z.host = "aftereffects";

    Z.adapter = {
        // Exactly one undo group per mutating call, so one call = one undo step.
        undoStepsWhenApplied: 1,
        runMutating: function (title, fn) {
            app.beginUndoGroup("Zenvi: " + title);
            try {
                return fn();
            } finally {
                app.endUndoGroup();
            }
        },
        partialChangeWarning: function (title) {
            return "The call failed after it had started changing the project; Edit > Undo \"Zenvi: " + title +
                "\" reverts what it did.";
        },
        info: function () {
            return {app_version: String(app.version), project: AE.projectPath()};
        }
    };

    // ------------------------------------------------------------------
    // Project, items, comps.

    /** Absolute path of the saved project, or null while it is untitled. */
    AE.projectPath = function () {
        var file = app.project ? app.project.file : null;
        return file ? file.fsName : null;
    };

    AE.requireProject = function () {
        if (!app.project) {
            throw Z.refuse("NO_PROJECT", "No After Effects project is open");
        }
        return app.project;
    };

    /** The comp in the active viewer/timeline, or null. */
    AE.activeComp = function () {
        var item = app.project ? app.project.activeItem : null;
        return item && item instanceof CompItem ? item : null;
    };

    AE.requireActiveComp = function () {
        var comp = AE.activeComp();
        if (!comp) {
            throw Z.refuse("NO_ACTIVE_COMP", "No comp is active; open one in the Timeline or pass `comp` (an id from ae_list_items)");
        }
        return comp;
    };

    /** The project item with this id; refuses NOT_FOUND. */
    AE.findItem = function (id) {
        var project = AE.requireProject();
        var item = null;
        var i;
        if (typeof id !== "number" || Math.floor(id) !== id) {
            throw Z.refuse("INVALID_ARGUMENT", "Item ids are integers; got " + String(id));
        }
        if (typeof project.itemByID === "function") {
            try {
                item = project.itemByID(id);
            } catch (lookupError) {
                item = null;
            }
        } else {
            for (i = 1; i <= project.numItems; i += 1) {
                if (project.item(i).id === id) {
                    item = project.item(i);
                    break;
                }
            }
        }
        if (!item) {
            throw Z.refuse("NOT_FOUND", "No project item has id " + id + " (ae_list_items lists them)");
        }
        return item;
    };

    /**
     * A comp from a tool's `comp` argument: undefined/null = the active comp,
     * a number = item id, a string = exact comp name (refused when ambiguous).
     */
    AE.findComp = function (ref) {
        var project;
        var item;
        var matches;
        var i;
        if (ref === undefined || ref === null) {
            return AE.requireActiveComp();
        }
        if (typeof ref === "number") {
            item = AE.findItem(ref);
            if (!(item instanceof CompItem)) {
                throw Z.refuse("INVALID_ARGUMENT", "Item " + ref + " (\"" + item.name + "\") is a " + AE.itemType(item) + ", not a comp");
            }
            return item;
        }
        if (typeof ref === "string" && ref.length > 0) {
            project = AE.requireProject();
            matches = [];
            for (i = 1; i <= project.numItems; i += 1) {
                item = project.item(i);
                if (item instanceof CompItem && item.name === ref) {
                    matches.push(item);
                }
            }
            if (matches.length === 1) {
                return matches[0];
            }
            if (matches.length === 0) {
                throw Z.refuse("NOT_FOUND", "No comp is named \"" + ref + "\"");
            }
            throw Z.refuse("INVALID_ARGUMENT", matches.length + " comps are named \"" + ref + "\" (ids " +
                Z.map(matches, function (comp) { return comp.id; }).join(", ") + "); pass the comp id");
        }
        throw Z.refuse("INVALID_ARGUMENT", "`comp` must be a comp id or an exact comp name");
    };

    // ------------------------------------------------------------------
    // Layers.

    /** layer.id (After Effects 22+), else null. */
    AE.layerId = function (layer) {
        return typeof layer.id === "number" ? layer.id : null;
    };

    /**
     * A layer from a `layer` argument: a number = layer id (After Effects
     * 22+), {index: n} = 1-based index in `comp`, a string = exact name in
     * `comp` (refused when ambiguous). `comp` may be null: an id then finds
     * the layer in any comp, an index or name uses the active comp.
     */
    AE.findLayer = function (comp, ref) {
        var layer = null;
        var matches;
        var i;
        if (typeof ref === "number") {
            if (Math.floor(ref) !== ref || ref < 1) {
                throw Z.refuse("INVALID_ARGUMENT", "Layer ids are positive integers; got " + ref);
            }
            if (typeof app.project.layerByID !== "function") {
                throw Z.refuse("UNSUPPORTED", "Layer ids need After Effects 2022 (22.0) or newer; pass {\"index\": n} or the layer name");
            }
            try {
                layer = app.project.layerByID(ref);
            } catch (lookupError) {
                layer = null;
            }
            if (!layer) {
                throw Z.refuse("NOT_FOUND", "No layer has id " + ref);
            }
            if (comp && layer.containingComp.id !== comp.id) {
                throw Z.refuse("NOT_FOUND", "Layer " + ref + " is in comp \"" + layer.containingComp.name + "\" (id " +
                    layer.containingComp.id + "), not in \"" + comp.name + "\" (id " + comp.id + ")");
            }
            return layer;
        }
        if (!comp) {
            comp = AE.requireActiveComp();
        }
        if (Z.isObject(ref) && Z.has(ref, "index")) {
            if (typeof ref.index !== "number" || Math.floor(ref.index) !== ref.index || ref.index < 1 || ref.index > comp.numLayers) {
                throw Z.refuse("NOT_FOUND", "Comp \"" + comp.name + "\" has " + Z.plural(comp.numLayers, "layer") +
                    "; there is no layer index " + String(ref.index));
            }
            return comp.layer(ref.index);
        }
        if (typeof ref === "string" && ref.length > 0) {
            matches = [];
            for (i = 1; i <= comp.numLayers; i += 1) {
                if (comp.layer(i).name === ref) {
                    matches.push(comp.layer(i));
                }
            }
            if (matches.length === 1) {
                return matches[0];
            }
            if (matches.length === 0) {
                throw Z.refuse("NOT_FOUND", "Comp \"" + comp.name + "\" has no layer named \"" + ref + "\"");
            }
            throw Z.refuse("INVALID_ARGUMENT", matches.length + " layers in \"" + comp.name + "\" are named \"" + ref +
                "\" (indexes " + Z.map(matches, function (match) { return match.index; }).join(", ") + "); pass {\"index\": n} or the layer id");
        }
        throw Z.refuse("INVALID_ARGUMENT", "`layer` must be a layer id, {\"index\": n} or an exact layer name");
    };

    // ------------------------------------------------------------------
    // Descriptions shared by receipts.

    AE.itemType = function (item) {
        if (item instanceof CompItem) {
            return "comp";
        }
        if (item instanceof FolderItem) {
            return "folder";
        }
        if (item instanceof FootageItem) {
            if (item.mainSource instanceof SolidSource) {
                return "solid";
            }
            if (item.mainSource instanceof PlaceholderSource) {
                return "placeholder";
            }
            return "footage";
        }
        return "item";
    };

    AE.layerType = function (layer) {
        var source;
        if (layer instanceof TextLayer) {
            return "text";
        }
        if (layer instanceof ShapeLayer) {
            return "shape";
        }
        if (layer instanceof CameraLayer) {
            return "camera";
        }
        if (layer instanceof LightLayer) {
            return "light";
        }
        if (layer instanceof AVLayer) {
            if (layer.nullLayer) {
                return "null";
            }
            if (layer.adjustmentLayer) {
                return "adjustment";
            }
            source = layer.source;
            if (source instanceof CompItem) {
                return "precomp";
            }
            if (source && source.mainSource instanceof SolidSource) {
                return "solid";
            }
            if (source && !source.hasVideo && source.hasAudio) {
                return "audio";
            }
            return "footage";
        }
        return "layer";
    };

    /** {layer_id, comp_id, layer_index, name, type}. */
    AE.layerRef = function (layer) {
        return {
            layer_id: AE.layerId(layer),
            comp_id: layer.containingComp ? layer.containingComp.id : null,
            layer_index: layer.index,
            name: layer.name,
            type: AE.layerType(layer)
        };
    };

    AE.compSummary = function (comp) {
        return {
            comp_id: comp.id,
            name: comp.name,
            width: comp.width,
            height: comp.height,
            pixel_aspect: comp.pixelAspect,
            fps: Z.round(comp.frameRate, 3),
            duration: Z.round(comp.duration, 4),
            work_area: {start: Z.round(comp.workAreaStart, 4), duration: Z.round(comp.workAreaDuration, 4)},
            time: Z.round(comp.time, 4),
            num_layers: comp.numLayers,
            bg_color: Z.color.toHex(comp.bgColor)
        };
    };

    // ------------------------------------------------------------------
    // Time and colour.

    /** `seconds` snapped to the comp's frame grid (warns in ctx when it moved). */
    AE.snapTime = function (comp, seconds, ctx, label) {
        return Z.snapToFrame(seconds, comp.frameRate, ctx, label);
    };

    /** "#RRGGBB" or [r, g, b] -> After Effects colour array [r, g, b] (0-1). */
    AE.color = function (value, key) {
        return Z.color.toRgb(value, key);
    };

    // ------------------------------------------------------------------
    // Render queue.

    var RQ_STATUS_NAMES = ["WILL_CONTINUE", "NEEDS_OUTPUT", "UNQUEUED", "QUEUED", "RENDERING", "USER_STOPPED", "ERR_STOPPED", "DONE"];

    AE.renderStatusName = function (status) {
        var i;
        for (i = 0; i < RQ_STATUS_NAMES.length; i += 1) {
            if (RQItemStatus[RQ_STATUS_NAMES[i]] === status) {
                return RQ_STATUS_NAMES[i].toLowerCase();
            }
        }
        return String(status);
    };

    /** Output file of a render queue item's first output module, or null. */
    AE.renderOutputPath = function (rqItem) {
        var module;
        try {
            module = rqItem.numOutputModules > 0 ? rqItem.outputModule(1) : null;
            return module && module.file ? module.file.fsName : null;
        } catch (moduleError) {
            return null;
        }
    };

    // ------------------------------------------------------------------
    // ae_get_state

    Z.register("ae_get_state", function (args, ctx) {
        var project = AE.requireProject();
        var comp = AE.activeComp();
        var queue = project.renderQueue;
        var selectedItems = Z.map(project.selection || [], function (item) {
            return {id: item.id, name: item.name, type: AE.itemType(item)};
        });
        var selectedLayers = comp ? Z.map(comp.selectedLayers || [], AE.layerRef) : [];
        var queued = [];
        var parts = [];
        var rqItem;
        var i;
        for (i = 1; i <= queue.numItems && queued.length < 20; i += 1) {
            rqItem = queue.item(i);
            queued.push({
                index: i,
                comp_id: rqItem.comp ? rqItem.comp.id : null,
                comp_name: rqItem.comp ? rqItem.comp.name : null,
                status: AE.renderStatusName(rqItem.status),
                output: AE.renderOutputPath(rqItem)
            });
        }
        if (queue.numItems > queued.length) {
            ctx.warn("Render queue lists the first " + queued.length + " of " + queue.numItems + " items");
        }

        parts.push("After Effects " + app.version);
        parts.push(project.file ? "project \"" + project.file.displayName + "\"" + (project.dirty ? " (unsaved changes)" : "") : "untitled project");
        parts.push(comp ? "active comp \"" + comp.name + "\" (id " + comp.id + ", " + comp.width + "x" + comp.height + ", " +
            Z.round(comp.frameRate, 3) + " fps, " + Z.round(comp.duration, 3) + " s, " + Z.plural(comp.numLayers, "layer") + ")" : "no active comp");
        if (selectedLayers.length > 0) {
            parts.push(Z.plural(selectedLayers.length, "layer") + " selected");
        } else if (selectedItems.length > 0) {
            parts.push(Z.plural(selectedItems.length, "item") + " selected");
        }
        parts.push(queue.numItems ? "render queue: " + Z.plural(queue.numItems, "item") : "render queue empty");

        return Z.ok(parts.join(", "), {
            app: {
                name: "Adobe After Effects",
                version: String(app.version),
                build: app.buildName ? String(app.buildName) : null,
                language: app.isoLanguage ? String(app.isoLanguage) : null
            },
            project: {
                path: AE.projectPath(),
                name: project.file ? project.file.displayName : null,
                dirty: typeof project.dirty === "boolean" ? project.dirty : null,
                num_items: project.numItems,
                bits_per_channel: project.bitsPerChannel
            },
            active_comp: comp ? AE.compSummary(comp) : null,
            selection: {items: selectedItems, layers: selectedLayers},
            render_queue: {num_items: queue.numItems, rendering: queue.rendering === true, items: queued}
        });
    });
}(ZenviLink));
