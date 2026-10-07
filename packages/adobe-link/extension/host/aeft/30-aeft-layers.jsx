// Zenvi Link: layer tools: ae_add_layer, ae_set_layer, ae_arrange_layers.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    var KINDS = ["footage", "solid", "adjustment", "null", "shape", "camera", "light"];

    function transformOf(layer, matchName) {
        var group = layer.property("ADBE Transform Group");
        return group ? group.property(matchName) : null;
    }

    function isNumberArray(value, min, max) {
        var i;
        if (!Z.isArray(value) || value.length < min || value.length > max) {
            return false;
        }
        for (i = 0; i < value.length; i += 1) {
            if (typeof value[i] !== "number" || !isFinite(value[i])) {
                return false;
            }
        }
        return true;
    }

    /** Validated initial transform from args: {position, scale, rotation, opacity} (null = keep). */
    function transformArgs(args) {
        var out = {
            position: Z.optional(args, "position", "array", null),
            scale: Z.optional(args, "scale", "any", null),
            rotation: Z.optional(args, "rotation", "number", null),
            opacity: Z.optional(args, "opacity", "number", null)
        };
        if (out.position !== null && !isNumberArray(out.position, 2, 3)) {
            throw Z.refuse("INVALID_ARGUMENT", "`position` must be [x, y] or [x, y, z]");
        }
        if (out.scale !== null && typeof out.scale !== "number" && !isNumberArray(out.scale, 2, 3)) {
            throw Z.refuse("INVALID_ARGUMENT", "`scale` must be a number (uniform %) or [x, y(, z)]");
        }
        if (out.opacity !== null) {
            Z.inRange("opacity", out.opacity, 0, 100);
        }
        return out;
    }

    function applyTransform(layer, values, ctx) {
        var names = {position: "ADBE Position", scale: "ADBE Scale", rotation: "ADBE Rotate Z", opacity: "ADBE Opacity"};
        var keys = ["position", "scale", "rotation", "opacity"];
        var property;
        var i;
        for (i = 0; i < keys.length; i += 1) {
            if (values[keys[i]] === null) {
                continue;
            }
            property = transformOf(layer, names[keys[i]]);
            if (!property) {
                ctx.warn(AE.layerType(layer) + " layers have no " + keys[i] + "; ignored it");
                continue;
            }
            property.setValue(AE.toValue(property, values[keys[i]], keys[i]));
        }
    }

    function wouldCycle(layer, parent) {
        var node = parent;
        while (node) {
            if (node.index === layer.index) {
                return true;
            }
            node = node.parent;
        }
        return false;
    }

    // ------------------------------------------------------------------
    // ae_add_layer

    function addShape(layer, comp, options) {
        var root = function () { return layer.property("ADBE Root Vectors Group"); };
        var group = root().addProperty("ADBE Vector Group");
        var groupIndex = group.propertyIndex;
        var vectors = function () { return root().property(groupIndex).property("ADBE Vectors Group"); };
        var ellipse = options.shape === "ellipse";
        var primitive;
        var index;
        root().property(groupIndex).name = ellipse ? "Ellipse" : "Rectangle";
        primitive = vectors().addProperty(ellipse ? "ADBE Vector Shape - Ellipse" : "ADBE Vector Shape - Rect");
        index = primitive.propertyIndex;
        vectors().property(index).property(ellipse ? "ADBE Vector Ellipse Size" : "ADBE Vector Rect Size").setValue(options.size);
        if (!ellipse) {
            vectors().property(index).property("ADBE Vector Rect Roundness").setValue(options.roundness);
        }
        // Stroke above fill in the group, so the stroke draws on top (After Effects' own order).
        if (options.stroke) {
            index = vectors().addProperty("ADBE Vector Graphic - Stroke").propertyIndex;
            vectors().property(index).property("ADBE Vector Stroke Color").setValue(options.stroke);
            vectors().property(index).property("ADBE Vector Stroke Width").setValue(options.strokeWidth);
        }
        index = vectors().addProperty("ADBE Vector Graphic - Fill").propertyIndex;
        vectors().property(index).property("ADBE Vector Fill Color").setValue(options.fill);
    }

    Z.register("ae_add_layer", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var kind = Z.oneOf("kind", Z.required(args, "kind", "string"), KINDS);
        var name = Z.optional(args, "name", "string", null);
        var itemId = Z.optional(args, "item", "integer", null);
        var path = Z.optional(args, "path", "string", null);
        var start = Z.optional(args, "start", "number", null);
        var inPoint = Z.optional(args, "in_point", "number", null);
        var outPoint = Z.optional(args, "out_point", "number", null);
        var blend = Z.optional(args, "blend_mode", "string", null);
        var threeD = Z.optional(args, "three_d", "boolean", null);
        var label = Z.optional(args, "label", "integer", null);
        var color = Z.has(args, "color") && args.color !== null ? args.color : null;
        var width = Z.optional(args, "width", "integer", null);
        var height = Z.optional(args, "height", "integer", null);
        var transform = transformArgs(args);
        var scale = AE.typeScale(comp);
        var source = null;
        var planned = null;
        var parent = null;
        var blendValue = null;
        var shape = null;
        var solidColor = null;
        var lightType = null;
        var layer;
        var data;
        var stroke;
        var size;

        if (kind === "footage") {
            if ((itemId === null) === (path === null)) {
                throw Z.refuse("INVALID_ARGUMENT", "A footage layer needs exactly one of `item` (a project item id) or `path` (a file)");
            }
            if (itemId !== null) {
                source = AE.findItem(itemId);
                if (!(source instanceof CompItem) && !(source instanceof FootageItem)) {
                    throw Z.refuse("INVALID_ARGUMENT", "Item " + itemId + " (\"" + source.name + "\") is a " + AE.itemType(source) + "; layers need footage or a comp");
                }
                if (source instanceof CompItem && source.id === comp.id) {
                    throw Z.refuse("INVALID_ARGUMENT", "A comp cannot contain itself");
                }
            } else {
                planned = AE.planImports([path], false);
            }
        } else if (itemId !== null || path !== null) {
            throw Z.refuse("INVALID_ARGUMENT", "`item` and `path` are for kind \"footage\"; this is a " + kind + " layer");
        }
        if (kind === "shape") {
            size = Z.optional(args, "size", "array", [Math.round(comp.width * 0.3), Math.round(comp.height * 0.3)]);
            if (!isNumberArray(size, 2, 2) || size[0] <= 0 || size[1] <= 0) {
                throw Z.refuse("INVALID_ARGUMENT", "`size` must be [width, height] in pixels");
            }
            stroke = Z.has(args, "stroke") && args.stroke !== null ? AE.colorValue(args.stroke, "stroke") : null;
            shape = {
                shape: Z.oneOf("shape", Z.optional(args, "shape", "string", "rect"), ["rect", "ellipse"]),
                size: [size[0], size[1]],
                roundness: Z.inRange("roundness", Z.optional(args, "roundness", "number", 0), 0, 10000),
                fill: AE.colorValue(color !== null ? color : TASTE.color.palette.accent, "color"),
                stroke: stroke,
                strokeWidth: Z.inRange("stroke_width", Z.optional(args, "stroke_width", "number", Math.round(4 * scale * 10) / 10), 0, 1000)
            };
        } else if (Z.has(args, "size") || Z.has(args, "stroke") || Z.has(args, "stroke_width")) {
            ctx.warn("size, stroke and stroke_width only apply to shape layers; ignored them");
        }
        if (color !== null && kind !== "solid" && kind !== "shape") {
            ctx.warn("`color` only applies to solid and shape layers; ignored it");
        }
        if ((width !== null || height !== null) && kind !== "solid") {
            ctx.warn("`width` and `height` only apply to solids; ignored them");
        }
        if (kind === "solid") {
            // LayerCollection.addSolid takes 4-30000 pixels.
            if (width !== null) {
                Z.inRange("width", width, 4, 30000);
            }
            if (height !== null) {
                Z.inRange("height", height, 4, 30000);
            }
            solidColor = AE.color(color !== null ? color : TASTE.color.palette.ink, "color");
        }
        if (kind === "light") {
            lightType = AE.lightTypeValue(Z.optional(args, "light_type", "string", "point"));
        }
        if (blend !== null) {
            if (kind === "camera" || kind === "light") {
                throw Z.refuse("INVALID_ARGUMENT", kind + " layers have no blend mode");
            }
            blendValue = AE.blendModeValue(blend);
        }
        if (threeD !== null && (kind === "camera" || kind === "light")) {
            ctx.warn(kind + " layers are always 3D; ignored three_d");
            threeD = null;
        }
        if (Z.has(args, "parent") && args.parent !== null) {
            parent = AE.findLayer(comp, args.parent);
        }
        if (label !== null) {
            Z.inRange("label", label, 0, 16);
        }
        if (inPoint !== null && outPoint !== null && outPoint <= inPoint) {
            throw Z.refuse("INVALID_ARGUMENT", "`out_point` must be after `in_point`");
        }
        if (start !== null) {
            Z.inRange("start", start, -10800, 10800);
        }

        ctx.changed();
        if (planned) {
            source = AE.importPlanned(planned, "Zenvi Imports", true)[0].item;
        }
        switch (kind) {
        case "footage":
            layer = comp.layers.add(source, comp.duration);
            break;
        case "solid":
            layer = comp.layers.addSolid(solidColor, name || "Solid", width !== null ? width : comp.width, height !== null ? height : comp.height, comp.pixelAspect);
            break;
        case "adjustment":
            layer = comp.layers.addSolid([1, 1, 1], name || "Adjustment Layer", comp.width, comp.height, comp.pixelAspect);
            layer.adjustmentLayer = true;
            break;
        case "null":
            layer = comp.layers.addNull();
            break;
        case "shape":
            layer = comp.layers.addShape();
            addShape(layer, comp, shape);
            break;
        case "camera":
            layer = comp.layers.addCamera(name || "Camera 1", [comp.width / 2, comp.height / 2]);
            break;
        default:
            layer = comp.layers.addLight(name || "Light 1", [comp.width / 2, comp.height / 2]);
            layer.lightType = lightType;
            break;
        }
        if (name) {
            layer.name = name;
        }
        if (start !== null) {
            layer.startTime = AE.snapTime(comp, start, ctx, "start");
        }
        if (inPoint !== null) {
            layer.inPoint = AE.snapTime(comp, inPoint, ctx, "in_point");
        }
        if (outPoint !== null) {
            layer.outPoint = AE.snapTime(comp, outPoint, ctx, "out_point");
        }
        // Cameras and lights refused three_d and blend_mode above.
        if (threeD !== null) {
            /** @type {AVLayer} */ (layer).threeDLayer = threeD;
        }
        applyTransform(layer, transform, ctx);
        if (parent) {
            layer.parent = parent;
        }
        if (blendValue !== null) {
            /** @type {AVLayer} */ (layer).blendingMode = blendValue;
        }
        if (label !== null) {
            layer.label = label;
        }
        data = AE.layerRef(layer);
        data.in_point = Z.round(layer.inPoint, 4);
        data.out_point = Z.round(layer.outPoint, 4);
        if (source) {
            data.source = {id: source.id, name: source.name, type: AE.itemType(source)};
        }
        return Z.applied("Added " + kind + " layer \"" + layer.name + "\" to \"" + comp.name + "\" (index " + layer.index + ")", data);
    });

    // ------------------------------------------------------------------
    // ae_set_layer

    var SWITCHES = [
        {arg: "enabled", prop: "enabled", any: true},
        {arg: "audio_enabled", prop: "audioEnabled"},
        {arg: "solo", prop: "solo", any: true},
        {arg: "shy", prop: "shy", any: true},
        {arg: "motion_blur", prop: "motionBlur"},
        {arg: "three_d", prop: "threeDLayer"},
        {arg: "adjustment", prop: "adjustmentLayer"},
        {arg: "guide", prop: "guideLayer"},
        {arg: "collapse", prop: "collapseTransformation"}
    ];

    Z.register("ae_set_layer", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var isAV = layer instanceof AVLayer;
        // Only read where avOnly() has passed.
        var av = /** @type {AVLayer} */ (layer);
        var plan = [];
        var unlockFirst = false;
        var lockLast = false;
        var value;
        var matte;
        var matteLayer = null;
        var currentMatte;
        var matteType;
        var parent;
        var number;
        var i;
        function step(label, apply) {
            plan.push({label: label, apply: apply});
        }
        function avOnly(arg) {
            if (!isAV) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + arg + "` does not apply to " + AE.layerType(layer) + " layers");
            }
        }

        value = Z.optional(args, "locked", "boolean", null);
        if (value === false && layer.locked) {
            unlockFirst = true;
        } else if (value === true && !layer.locked) {
            lockLast = true;
        }
        value = Z.optional(args, "name", "string", null);
        if (value !== null && value !== layer.name) {
            step("name \"" + value + "\"", (function (v) { return function () { layer.name = v; }; }(value)));
        }
        value = Z.optional(args, "comment", "string", null);
        if (value !== null && value !== layer.comment) {
            step("comment", (function (v) { return function () { layer.comment = v; }; }(value)));
        }
        value = Z.optional(args, "start", "number", null);
        if (value !== null) {
            value = AE.snapTime(comp, value, ctx, "start");
            if (Math.abs(value - layer.startTime) > 1e-6) {
                step("start " + Z.round(value) + " s", (function (v) { return function () { layer.startTime = v; }; }(value)));
            }
        }
        number = Z.optional(args, "stretch", "number", null);
        if (number !== null) {
            if (number === 0) {
                throw Z.refuse("INVALID_ARGUMENT", "`stretch` cannot be 0");
            }
            if (Math.abs(number - layer.stretch) > 1e-6) {
                step("stretch " + number + " %", (function (v) { return function () { layer.stretch = v; }; }(number)));
            }
        }
        value = Z.optional(args, "in_point", "number", null);
        number = Z.optional(args, "out_point", "number", null);
        if (value !== null && number !== null && number <= value) {
            throw Z.refuse("INVALID_ARGUMENT", "`out_point` must be after `in_point`");
        }
        if (value !== null) {
            value = AE.snapTime(comp, value, ctx, "in_point");
            if (Math.abs(value - layer.inPoint) > 1e-6) {
                step("in point " + Z.round(value) + " s", (function (v) { return function () { layer.inPoint = v; }; }(value)));
            }
        }
        if (number !== null) {
            number = AE.snapTime(comp, number, ctx, "out_point");
            if (Math.abs(number - layer.outPoint) > 1e-6) {
                step("out point " + Z.round(number) + " s", (function (v) { return function () { layer.outPoint = v; }; }(number)));
            }
        }
        for (i = 0; i < SWITCHES.length; i += 1) {
            value = Z.optional(args, SWITCHES[i].arg, "boolean", null);
            if (value === null) {
                continue;
            }
            if (!SWITCHES[i].any) {
                avOnly(SWITCHES[i].arg);
            }
            if (SWITCHES[i].arg === "collapse" && !av.canSetCollapseTransformation) {
                throw Z.refuse("UNSUPPORTED", "Layer \"" + layer.name + "\" cannot collapse transformations (only precomps and vector layers can)");
            }
            if (SWITCHES[i].arg === "audio_enabled" && !av.hasAudio) {
                throw Z.refuse("INVALID_ARGUMENT", "Layer \"" + layer.name + "\" has no audio");
            }
            if (layer[SWITCHES[i].prop] !== value) {
                step(SWITCHES[i].arg.replace(/_/g, " ") + " " + (value ? "on" : "off"), (function (prop, v) {
                    return function () { layer[prop] = v; };
                }(SWITCHES[i].prop, value)));
            }
        }
        value = Z.optional(args, "blend_mode", "string", null);
        if (value !== null) {
            avOnly("blend_mode");
            number = AE.blendModeValue(value);
            if (av.blendingMode !== number) {
                step("blend mode " + value, (function (v) { return function () { av.blendingMode = v; }; }(number)));
            }
        }
        matte = Z.optional(args, "track_matte", "object", null);
        if (matte !== null) {
            avOnly("track_matte");
            matteType = AE.trackMatteValue(Z.required(matte, "type", "string"));
            if (Z.has(matte, "layer") && matte.layer !== null) {
                matteLayer = AE.findLayer(comp, matte.layer);
                if (matteLayer.index === layer.index) {
                    throw Z.refuse("INVALID_ARGUMENT", "A layer cannot be its own track matte");
                }
            }
            if (Z.hasMethod(av, "setTrackMatte")) {
                if (matte.type === "none") {
                    // setTrackMatte with NO_TRACK_MATTE is a no-op (Scripting Guide); removeTrackMatte removes it.
                    if (av.hasTrackMatte) {
                        step("no track matte", function () { av.removeTrackMatte(); });
                    }
                } else {
                    if (!matteLayer) {
                        if (layer.index === 1) {
                            throw Z.refuse("INVALID_ARGUMENT", "Layer \"" + layer.name + "\" is the top layer; pass track_matte.layer");
                        }
                        matteLayer = comp.layer(layer.index - 1);
                    }
                    currentMatte = av.hasTrackMatte ? av.trackMatteLayer : null;
                    if (!currentMatte || currentMatte.index !== matteLayer.index || av.trackMatteType !== matteType) {
                        step("track matte " + matte.type + " from \"" + matteLayer.name + "\"", function () {
                            av.setTrackMatte(/** @type {AVLayer} */ (matteLayer), matteType);
                        });
                    }
                }
            } else {
                if (matteLayer && matteLayer.index !== layer.index - 1) {
                    throw Z.refuse("UNSUPPORTED", "Before After Effects 2023 the matte must be the layer directly above; move \"" + matteLayer.name +
                        "\" above \"" + layer.name + "\" with ae_arrange_layers first");
                }
                if (matte.type !== "none" && layer.index === 1) {
                    throw Z.refuse("INVALID_ARGUMENT", "Layer \"" + layer.name + "\" is the top layer; there is no layer above to use as its matte");
                }
                if (av.trackMatteType !== matteType) {
                    step("track matte " + matte.type, function () { av.trackMatteType = matteType; });
                }
            }
        }
        if (Z.has(args, "parent")) {
            if (args.parent === null) {
                if (layer.parent) {
                    step("no parent", function () { layer.parent = null; });
                }
            } else {
                parent = AE.findLayer(comp, args.parent);
                if (parent.index === layer.index || wouldCycle(layer, parent)) {
                    throw Z.refuse("INVALID_ARGUMENT", "Parenting \"" + layer.name + "\" to \"" + parent.name + "\" would make a loop");
                }
                if (!layer.parent || layer.parent.index !== parent.index) {
                    step("parent \"" + parent.name + "\"", function () { layer.parent = parent; });
                }
            }
        }
        number = Z.optional(args, "label", "integer", null);
        if (number !== null) {
            Z.inRange("label", number, 0, 16);
            if (layer.label !== number) {
                step("label " + number, (function (v) { return function () { layer.label = v; }; }(number)));
            }
        }
        value = Z.optional(args, "quality", "string", null);
        if (value !== null) {
            avOnly("quality");
            number = AE.qualityValue(value);
            if (av.quality !== number) {
                step("quality " + value, (function (v) { return function () { av.quality = v; }; }(number)));
            }
        }

        if (!plan.length && !unlockFirst && !lockLast) {
            return Z.unchanged("Layer \"" + layer.name + "\" already has these settings", AE.layerRef(layer));
        }
        if (layer.locked && !unlockFirst && plan.length) {
            AE.requireUnlocked(layer);
        }
        ctx.changed();
        if (unlockFirst) {
            layer.locked = false;
            plan.unshift({label: "unlocked", apply: function () {}});
        }
        for (i = 0; i < plan.length; i += 1) {
            plan[i].apply();
        }
        if (lockLast) {
            layer.locked = true;
            plan.push({label: "locked", apply: function () {}});
        }
        return Z.applied("Changed layer \"" + layer.name + "\": " + Z.map(plan, function (s) { return s.label; }).join(", "), (function () {
            var data = AE.layerRef(layer);
            data.changed = Z.map(plan, function (s) { return s.label; });
            return data;
        }()));
    });

    // ------------------------------------------------------------------
    // ae_arrange_layers

    Z.register("ae_arrange_layers", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var action = Z.oneOf("action", Z.required(args, "action", "string"), ["move", "duplicate", "delete", "split"]);
        var to = Z.has(args, "to") ? args.to : null;
        var name = Z.optional(args, "name", "string", null);
        var target = null;
        var index;
        var before;
        var copy;
        var time;
        var children = [];
        var data;
        var i;

        if (action === "move") {
            if (to === null || to === undefined) {
                throw Z.refuse("INVALID_ARGUMENT", "move needs `to`: \"top\", \"bottom\", {index}, {before} or {after}");
            }
            if (to !== "top" && to !== "bottom" && !Z.isObject(to)) {
                throw Z.refuse("INVALID_ARGUMENT", "`to` must be \"top\", \"bottom\", {index}, {before} or {after}");
            }
            before = layer.index;
            if (to === "top") {
                index = 1;
            } else if (to === "bottom") {
                index = comp.numLayers;
            } else if (Z.has(to, "index")) {
                index = Z.required(to, "index", "integer");
                if (index < 1 || index > comp.numLayers) {
                    throw Z.refuse("NOT_FOUND", "Comp \"" + comp.name + "\" has " + Z.plural(comp.numLayers, "layer") + "; there is no index " + index);
                }
            } else if (Z.has(to, "before") || Z.has(to, "after")) {
                target = AE.findLayer(comp, Z.has(to, "before") ? to.before : to.after);
                if (target.index === layer.index) {
                    throw Z.refuse("INVALID_ARGUMENT", "A layer cannot move relative to itself");
                }
                index = Z.has(to, "before") ? (target.index < before ? target.index : target.index - 1) : (target.index < before ? target.index + 1 : target.index);
            } else {
                throw Z.refuse("INVALID_ARGUMENT", "`to` must be \"top\", \"bottom\", {index}, {before} or {after}");
            }
            if (index === before) {
                return Z.unchanged("Layer \"" + layer.name + "\" is already at index " + before, AE.layerRef(layer));
            }
            AE.requireUnlocked(layer);
            ctx.changed();
            if (index === 1) {
                layer.moveToBeginning();
            } else if (index === comp.numLayers) {
                layer.moveToEnd();
            } else if (index < before) {
                layer.moveBefore(comp.layer(index));
            } else {
                layer.moveAfter(comp.layer(index));
            }
            data = AE.layerRef(layer);
            data.from_index = before;
            return Z.applied("Moved layer \"" + layer.name + "\" from index " + before + " to " + layer.index, data);
        }

        if (action === "duplicate") {
            ctx.changed();
            copy = layer.duplicate();
            if (name) {
                copy.name = name;
            }
            data = AE.layerRef(copy);
            data.original = AE.layerRef(layer);
            return Z.applied("Duplicated layer \"" + layer.name + "\" as \"" + copy.name + "\" (index " + copy.index + ")", data);
        }

        if (action === "delete") {
            AE.requireUnlocked(layer);
            for (i = 1; i <= comp.numLayers; i += 1) {
                if (comp.layer(i).parent && comp.layer(i).parent.index === layer.index) {
                    children.push(comp.layer(i).name);
                }
            }
            data = AE.layerRef(layer);
            ctx.changed();
            layer.remove();
            if (children.length) {
                ctx.warn("Unparented " + children.join(", ") + " (they keep their place on screen)");
            }
            return Z.applied("Deleted layer \"" + data.name + "\" from \"" + comp.name + "\"", data);
        }

        // split
        time = AE.snapTime(comp, Z.optional(args, "time", "number", comp.time), ctx, "time");
        if (time <= layer.inPoint + 1e-6 || time >= layer.outPoint - 1e-6) {
            throw Z.refuse("INVALID_ARGUMENT", "Split time " + Z.round(time) + " s must be inside layer \"" + layer.name + "\" (" +
                Z.round(layer.inPoint) + "-" + Z.round(layer.outPoint) + " s)");
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        copy = layer.duplicate();
        layer.outPoint = time;
        copy.inPoint = time;
        if (name) {
            copy.name = name;
        }
        data = {first: AE.layerRef(layer), second: AE.layerRef(copy), time: Z.round(time, 4)};
        return Z.applied("Split layer \"" + layer.name + "\" at " + Z.round(time) + " s into indexes " + copy.index + " and " + layer.index, data);
    });
}(ZenviLink));
