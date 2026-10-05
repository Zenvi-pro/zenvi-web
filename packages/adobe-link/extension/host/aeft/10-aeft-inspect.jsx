// Zenvi Link: After Effects read-only tools: ae_list_items, ae_get_comp,
// ae_get_layer, ae_list_effects.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;

    var MAX_WALK = 3000;

    // ------------------------------------------------------------------
    // Summaries shared by receipts.

    function folderRef(item) {
        var folder = item.parentFolder;
        var root = app.project.rootFolder;
        if (!folder || folder.id === root.id) {
            return null;
        }
        return {id: folder.id, name: folder.name};
    }

    /** One project item as JSON. */
    AE.itemSummary = function (item) {
        var out = {id: item.id, name: item.name, type: AE.itemType(item), parent_folder: folderRef(item), label: item.label};
        var source;
        if (item instanceof FolderItem) {
            out.num_items = item.numItems;
            return out;
        }
        out.width = item.width;
        out.height = item.height;
        out.pixel_aspect = Z.round(item.pixelAspect, 4);
        out.duration = Z.round(item.duration, 4);
        out.fps = Z.round(item.frameRate, 3);
        out.has_video = item.hasVideo;
        out.has_audio = item.hasAudio;
        if (item instanceof CompItem) {
            out.num_layers = item.numLayers;
            out.bg_color = Z.color.toHex(item.bgColor);
        } else if (item instanceof FootageItem) {
            source = item.mainSource;
            out.file = item.file ? item.file.fsName : null;
            out.missing = item.footageMissing === true;
            out.is_still = source ? source.isStill === true : false;
            out.has_alpha = source ? source.hasAlpha === true : false;
            if (source instanceof SolidSource) {
                out.color = Z.color.toHex(source.color);
            }
        }
        return out;
    };

    /**
     * Visit every property under `group` (depth-first, display paths):
     * fn(property, path). Stops after MAX_WALK properties.
     */
    function walkProperties(group, prefix, fn, state) {
        var property;
        var path;
        var i;
        for (i = 1; i <= group.numProperties && state.seen < MAX_WALK; i += 1) {
            property = group.property(i);
            if (!property) {
                continue;
            }
            state.seen += 1;
            path = prefix ? prefix + "/" + property.name : property.name;
            if (property.propertyType === PropertyType.PROPERTY) {
                fn(property, path);
            } else {
                walkProperties(property, path, fn, state);
            }
        }
    }
    AE.walkProperties = function (layer, fn) {
        walkProperties(layer, "", fn, {seen: 0});
    };

    function hasExpression(property) {
        try {
            return property.canSetExpression && property.expressionEnabled && property.expression !== "";
        } catch (readError) {
            return false;
        }
    }

    /** Paths of keyframed properties and of properties with expressions. */
    AE.animatedPaths = function (layer) {
        var keyed = [];
        var expressions = [];
        AE.walkProperties(layer, function (property, path) {
            if (property.propertyValueType === PropertyValueType.NO_VALUE || property.matchName === "ADBE Marker") {
                return;
            }
            if (property.numKeys > 0) {
                keyed.push(path);
            }
            if (hasExpression(property)) {
                expressions.push(path);
            }
        });
        return {keyed: keyed, expressions: expressions};
    };

    function layerBrief(layer) {
        return layer ? {layer_id: AE.layerId(layer), index: layer.index, name: layer.name} : null;
    }

    function trackMatte(layer) {
        var matte = null;
        if (!(layer instanceof AVLayer) || !layer.hasTrackMatte) {
            return null;
        }
        if (Z.hasMethod(layer, "setTrackMatte")) {
            matte = layer.trackMatteLayer;
        } else if (layer.index > 1) {
            matte = layer.containingComp.layer(layer.index - 1);
        }
        return {type: AE.trackMatteName(layer.trackMatteType), layer: layerBrief(matte)};
    }

    /** One layer as JSON: identity, timing, switches, blend, matte, effects, animated paths. */
    AE.layerSummary = function (layer) {
        var out = AE.layerRef(layer);
        var animated = AE.animatedPaths(layer);
        var source = layer instanceof AVLayer ? layer.source : null;
        out.source = source ? {id: source.id, name: source.name, type: AE.itemType(source)} : null;
        out.start_time = Z.round(layer.startTime, 4);
        out.in_point = Z.round(layer.inPoint, 4);
        out.out_point = Z.round(layer.outPoint, 4);
        out.stretch = Z.round(layer.stretch, 3);
        out.parent = layerBrief(layer.parent);
        out.enabled = layer.enabled;
        out.solo = layer.solo;
        out.locked = layer.locked;
        out.shy = layer.shy;
        out.label = layer.label;
        if (layer instanceof AVLayer) {
            out.three_d = layer.threeDLayer;
            out.adjustment = layer.adjustmentLayer;
            out.motion_blur = layer.motionBlur;
            out.collapse = layer.collapseTransformation;
            out.guide = layer.guideLayer === true;
            out.audio_enabled = layer.hasAudio ? layer.audioEnabled : null;
            out.blend_mode = AE.blendModeName(layer.blendingMode);
            out.track_matte = trackMatte(layer);
            out.quality = AE.qualityName(layer.quality);
        }
        out.effects = AE.effectsJson(layer);
        out.animated = animated.keyed;
        out.expressions = animated.expressions;
        return out;
    };

    AE.compSettings = function (comp) {
        var out = AE.compSummary(comp);
        out.display_start_time = Z.round(comp.displayStartTime, 4);
        out.motion_blur = comp.motionBlur;
        out.shutter_angle = comp.shutterAngle;
        out.shutter_phase = comp.shutterPhase;
        out.frame_blending = comp.frameBlending;
        out.resolution_factor = [comp.resolutionFactor[0], comp.resolutionFactor[1]];
        out.hide_shy_layers = comp.hideShyLayers;
        out.parent_folder = folderRef(comp);
        return out;
    };

    function markersJson(property) {
        var out = [];
        var value;
        var i;
        for (i = 1; i <= property.numKeys; i += 1) {
            value = property.keyValue(i);
            out.push({
                time: Z.round(property.keyTime(i), 4),
                comment: value.comment,
                duration: Z.round(value.duration, 4),
                chapter: value.chapter || null,
                label: value.label
            });
        }
        return out;
    }
    AE.markersJson = markersJson;

    // ------------------------------------------------------------------
    // ae_list_items

    var ITEM_TYPES = ["comp", "footage", "solid", "placeholder", "folder"];

    Z.register("ae_list_items", function (args, ctx) {
        var project = AE.requireProject();
        var type = Z.optional(args, "type", "string", null);
        var needle = Z.optional(args, "name_contains", "string", null);
        var limit = Z.optional(args, "limit", "integer", 200);
        var items = [];
        var total = 0;
        var counts = {};
        var item;
        var itemType;
        var i;
        if (type !== null) {
            Z.oneOf("type", type, ITEM_TYPES);
        }
        Z.inRange("limit", limit, 1, 2000);
        for (i = 1; i <= project.numItems; i += 1) {
            item = project.item(i);
            itemType = AE.itemType(item);
            if ((type !== null && itemType !== type) || (needle !== null && item.name.toLowerCase().indexOf(needle.toLowerCase()) < 0)) {
                continue;
            }
            total += 1;
            counts[itemType] = (counts[itemType] || 0) + 1;
            if (items.length < limit) {
                items.push(AE.itemSummary(item));
            }
        }
        if (total > items.length) {
            ctx.warn("Listed the first " + items.length + " of " + total + " matching items; raise `limit` or filter");
        }
        return Z.ok(total ? Z.plural(total, "item") + " (" + Z.map(Object.keys(counts), function (key) { return counts[key] + " " + key; }).join(", ") + ")" :
            "No matching items", {items: items, total: total, truncated: total > items.length});
    });

    // ------------------------------------------------------------------
    // ae_get_comp

    Z.register("ae_get_comp", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var max = Z.optional(args, "max_layers", "integer", 200);
        var layers = [];
        var i;
        Z.inRange("max_layers", max, 1, 1000);
        for (i = 1; i <= comp.numLayers && layers.length < max; i += 1) {
            layers.push(AE.layerSummary(comp.layer(i)));
        }
        if (comp.numLayers > layers.length) {
            ctx.warn("Listed the top " + layers.length + " of " + comp.numLayers + " layers");
        }
        return Z.ok("Comp \"" + comp.name + "\" (id " + comp.id + "): " + comp.width + "x" + comp.height + ", " + Z.round(comp.frameRate, 3) +
            " fps, " + Z.round(comp.duration, 3) + " s, " + Z.plural(comp.numLayers, "layer"), {
            comp: AE.compSettings(comp),
            markers: markersJson(comp.markerProperty),
            layers: layers
        });
    });

    // ------------------------------------------------------------------
    // ae_get_layer

    function effectJson(effect, time) {
        var params = [];
        var i;
        var property;
        for (i = 1; i <= effect.numProperties; i += 1) {
            property = effect.property(i);
            if (!AE.isLeaf(property) || property.propertyValueType === PropertyValueType.NO_VALUE) {
                continue;
            }
            params.push({
                name: property.name,
                match_name: property.matchName,
                value: readValue(property, time),
                keyframes: property.numKeys,
                expression: hasExpression(property) ? property.expression : null
            });
        }
        return {index: effect.propertyIndex, name: effect.name, match_name: effect.matchName, enabled: effect.enabled, params: params};
    }

    function readValue(property, time) {
        try {
            return AE.exportValue(property.valueAtTime(time, false));
        } catch (readError) {
            return null;
        }
    }

    /** @param {Property} property */
    function valueOf(property) {
        return AE.exportValue(property.value);
    }

    function masksJson(layer) {
        var parade = /** @type {PropertyGroup} */ (layer.property("ADBE Mask Parade"));
        var out = [];
        var mask;
        var shape;
        var i;
        if (!parade) {
            return out;
        }
        for (i = 1; i <= parade.numProperties; i += 1) {
            mask = /** @type {MaskPropertyGroup} */ (parade.property(i));
            shape = /** @type {Shape} */ (/** @type {Property} */ (mask.property("ADBE Mask Shape")).value);
            out.push({
                index: i,
                name: mask.name,
                mode: AE.maskModeName(mask.maskMode),
                inverted: mask.inverted,
                feather: valueOf(/** @type {Property} */ (mask.property("ADBE Mask Feather"))),
                opacity: valueOf(/** @type {Property} */ (mask.property("ADBE Mask Opacity"))),
                expansion: valueOf(/** @type {Property} */ (mask.property("ADBE Mask Offset"))),
                vertices: shape.vertices.length,
                closed: shape.closed
            });
        }
        return out;
    }

    Z.register("ae_get_layer", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var time = Z.optional(args, "time", "number", comp.time);
        var maxKeys = Z.optional(args, "max_keys", "integer", 100);
        var transform = {};
        var keyframes = [];
        var expressions = [];
        var effects = [];
        var parade;
        /** @type {any} */
        var data;
        var truncated = 0;
        var i;
        Z.inRange("time", time, 0, null);
        Z.inRange("max_keys", maxKeys, 0, 1000);
        AE.walkProperties(/** @type {PropertyGroup} */ (layer.property("ADBE Transform Group")), function (property) {
            if (property.propertyValueType !== PropertyValueType.NO_VALUE) {
                transform[property.name] = readValue(property, time);
            }
        });
        AE.walkProperties(layer, function (property, path) {
            if (property.propertyValueType === PropertyValueType.NO_VALUE || property.matchName === "ADBE Marker") {
                return;
            }
            if (property.numKeys > 0) {
                keyframes.push({path: path, match_name: property.matchName, num_keys: property.numKeys, keys: AE.keyframesJson(property, maxKeys)});
                if (property.numKeys > maxKeys) {
                    truncated += 1;
                }
            }
            if (hasExpression(property)) {
                expressions.push({path: path, expression: property.expression, enabled: property.expressionEnabled, error: property.expressionError || null});
            }
        });
        if (truncated) {
            ctx.warn(Z.plural(truncated, "property", "properties") + " had more than " + maxKeys + " keyframes; raise `max_keys` to see them all");
        }
        parade = /** @type {PropertyGroup} */ (layer.property("ADBE Effect Parade"));
        for (i = 1; parade && i <= parade.numProperties; i += 1) {
            effects.push(effectJson(parade.property(i), time));
        }
        data = AE.layerSummary(layer);
        data.time = Z.round(time, 4);
        data.transform = transform;
        data.keyframes = keyframes;
        data.expressions = expressions;
        data.effects = effects;
        data.masks = masksJson(layer);
        data.markers = markersJson(layer.property("ADBE Marker"));
        data.text = layer instanceof TextLayer ?
            AE.textDocumentJson(/** @type {Property} */ (layer.property("ADBE Text Properties").property("ADBE Text Document")).valueAtTime(time, false)) : null;
        return Z.ok("Layer \"" + layer.name + "\" (" + AE.layerType(layer) + ", index " + layer.index + " in \"" + comp.name + "\"): " +
            Z.plural(keyframes.length, "animated property", "animated properties") + ", " + Z.plural(effects.length, "effect") + ", " +
            Z.plural(data.masks.length, "mask"), data);
    });

    // ------------------------------------------------------------------
    // ae_list_effects

    Z.register("ae_list_effects", function (args, ctx) {
        var search = Z.optional(args, "search", "string", null);
        var category = Z.optional(args, "category", "string", null);
        var limit = Z.optional(args, "limit", "integer", 100);
        var effects = AE.installedEffects();
        var out = [];
        var total = 0;
        var needle = search !== null ? search.toLowerCase() : null;
        var fx;
        var i;
        Z.inRange("limit", limit, 1, 2000);
        for (i = 0; i < effects.length; i += 1) {
            fx = effects[i];
            if (category !== null && String(fx.category).toLowerCase() !== category.toLowerCase()) {
                continue;
            }
            if (needle !== null && (fx.displayName + " " + fx.matchName + " " + fx.category).toLowerCase().indexOf(needle) < 0) {
                continue;
            }
            total += 1;
            if (out.length < limit) {
                out.push({display_name: fx.displayName, match_name: fx.matchName, category: fx.category, version: fx.version});
            }
        }
        if (total > out.length) {
            ctx.warn("Listed " + out.length + " of " + total + " matching effects; narrow `search` or raise `limit`");
        }
        return Z.ok(total ? Z.plural(total, "effect") + (search !== null ? " matching \"" + search + "\"" : " installed") : "No matching effects",
            {effects: out, total: total, truncated: total > out.length});
    });
}(ZenviLink));
