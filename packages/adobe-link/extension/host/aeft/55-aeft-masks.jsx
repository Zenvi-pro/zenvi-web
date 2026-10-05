// Zenvi Link: ae_add_mask.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    // Bezier handle length for a quarter circle.
    var KAPPA = 0.5522847498;

    var ANIMATABLE = {expansion: "ADBE Mask Offset", feather: "ADBE Mask Feather", opacity: "ADBE Mask Opacity"};

    /** @returns {Property} */
    function maskProperty(mask, matchName) {
        return /** @type {Property} */ (mask.property(matchName));
    }

    /** The layer's own bounds in layer pixels (text and shapes: their content box). */
    function layerBounds(layer, time) {
        var rect;
        if (layer instanceof TextLayer || layer instanceof ShapeLayer) {
            rect = layer.sourceRectAtTime(time, false);
            return {left: rect.left, top: rect.top, width: rect.width, height: rect.height};
        }
        return {left: 0, top: 0, width: layer.width, height: layer.height};
    }

    function rectShape(b) {
        var shape = new Shape();
        shape.vertices = [[b.left, b.top], [b.left + b.width, b.top], [b.left + b.width, b.top + b.height], [b.left, b.top + b.height]];
        shape.inTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
        shape.outTangents = [[0, 0], [0, 0], [0, 0], [0, 0]];
        shape.closed = true;
        return shape;
    }

    function ellipseShape(b) {
        var cx = b.left + b.width / 2;
        var cy = b.top + b.height / 2;
        var rx = b.width / 2;
        var ry = b.height / 2;
        var shape = new Shape();
        // Clockwise from the top: top, right, bottom, left.
        shape.vertices = [[cx, cy - ry], [cx + rx, cy], [cx, cy + ry], [cx - rx, cy]];
        shape.inTangents = [[-rx * KAPPA, 0], [0, -ry * KAPPA], [rx * KAPPA, 0], [0, ry * KAPPA]];
        shape.outTangents = [[rx * KAPPA, 0], [0, ry * KAPPA], [-rx * KAPPA, 0], [0, -ry * KAPPA]];
        shape.closed = true;
        return shape;
    }

    Z.register("ae_add_mask", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var kind = Z.oneOf("shape", Z.optional(args, "shape", "string", "rect"), ["rect", "ellipse", "path"]);
        var name = Z.optional(args, "name", "string", null);
        var modeName = Z.optional(args, "mode", "string", "add");
        var mode = AE.maskModeValue(modeName);
        var inverted = Z.optional(args, "inverted", "boolean", false);
        var feather = Z.optional(args, "feather", "any", 0);
        var expansion = Z.optional(args, "expansion", "number", 0);
        var opacity = Z.inRange("opacity", Z.optional(args, "opacity", "number", 100), 0, 100);
        var animation = Z.optional(args, "animate", "object", null);
        var bounds = Z.optional(args, "bounds", "object", null);
        var masks = /** @type {PropertyGroup} */ (layer.property("ADBE Mask Parade"));
        var shape;
        var mask;
        var index;
        var animated = null;
        var plan = null;
        var targetValue;
        var start;
        var end;
        if (!masks) {
            throw Z.refuse("UNSUPPORTED", "Layer \"" + layer.name + "\" (" + AE.layerType(layer) + ") cannot have masks");
        }
        if (typeof feather === "number") {
            Z.inRange("feather", feather, 0, null);
            feather = [feather, feather];
        } else if (!Z.isArray(feather) || feather.length !== 2 || typeof feather[0] !== "number" || typeof feather[1] !== "number" || feather[0] < 0 || feather[1] < 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`feather` must be pixels >= 0 or [x, y]");
        }
        if (kind === "path") {
            if (!Z.has(args, "path") || args.path === null) {
                throw Z.refuse("INVALID_ARGUMENT", "shape \"path\" needs `path` {vertices, in_tangents?, out_tangents?, closed?}");
            }
            shape = AE.shapeValue(args.path, "path");
        } else {
            if (bounds !== null) {
                bounds = {
                    left: Z.required(bounds, "left", "number"),
                    top: Z.required(bounds, "top", "number"),
                    width: Z.inRange("bounds.width", Z.required(bounds, "width", "number"), 0.001, null),
                    height: Z.inRange("bounds.height", Z.required(bounds, "height", "number"), 0.001, null)
                };
            } else {
                bounds = layerBounds(layer, comp.time);
            }
            shape = kind === "ellipse" ? ellipseShape(bounds) : rectShape(bounds);
        }
        if (animation !== null) {
            plan = {
                property: Z.oneOf("animate.property", Z.required(animation, "property", "string"), ["expansion", "feather", "opacity"]),
                from: Z.required(animation, "from", "number"),
                curve: AE.curve(Z.optional(animation, "easing", "any", "out"), "animate.easing")
            };
            start = Z.optional(animation, "start", "number", null);
            start = start === null ? AE.snapTime(comp, Math.max(0, layer.inPoint), ctx, "animate.start") : AE.compTime(comp, start, ctx, "animate.start");
            end = AE.snapTime(comp, start + Z.inRange("animate.duration", Z.optional(animation, "duration", "number", TASTE.timing.entrance["default"]), 1 / comp.frameRate, 600),
                ctx, "animate.end");
            if (plan.property === "opacity") {
                Z.inRange("animate.from", plan.from, 0, 100);
            } else if (plan.property === "feather") {
                Z.inRange("animate.from", plan.from, 0, null);
            }
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        index = masks.addProperty("ADBE Mask Atom").propertyIndex;
        mask = /** @type {MaskPropertyGroup} */ (masks.property(index));
        if (name) {
            mask.name = name;
        }
        mask.maskMode = mode;
        mask.inverted = inverted;
        maskProperty(mask, "ADBE Mask Shape").setValue(shape);
        maskProperty(mask, "ADBE Mask Feather").setValue(feather);
        maskProperty(mask, "ADBE Mask Offset").setValue(expansion);
        maskProperty(mask, "ADBE Mask Opacity").setValue(opacity);
        if (plan) {
            targetValue = plan.property === "feather" ? feather : (plan.property === "opacity" ? opacity : expansion);
            animated = AE.writeKeyframes(maskProperty(mask, ANIMATABLE[plan.property]), [
                {time: start, value: plan.property === "feather" ? [plan.from, plan.from] : plan.from, curve: plan.curve},
                {time: end, value: targetValue, curve: plan.curve}
            ], {replace: true}, ctx);
        }
        mask = layer.property("ADBE Mask Parade").property(index);
        return Z.applied("Added " + kind + " mask \"" + mask.name + "\" (" + modeName + (inverted ? ", inverted" : "") + ") to \"" + layer.name + "\"" +
            (plan ? ", animating " + plan.property + " from " + plan.from : ""), {
            layer: AE.layerRef(layer),
            mask: {index: index, name: mask.name, mode: modeName, inverted: inverted, feather: feather, expansion: expansion, opacity: opacity,
                vertices: shape.vertices.length, path: "Masks/" + mask.name},
            animation: animated
        });
    });
}(ZenviLink));
