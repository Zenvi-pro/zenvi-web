// Zenvi Link: After Effects properties (ZenviLink.ae): property paths,
// values in each property's own units, eased keyframes (TASTE 2) and values
// as JSON for receipts.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    var KEY_EPSILON = 1e-4;

    // ------------------------------------------------------------------
    // Property tree.

    AE.isLeaf = function (property) {
        return property !== null && property !== undefined && property.propertyType === PropertyType.PROPERTY;
    };

    /** Child of `group` by name or match name (exact, then case-insensitive), or by index for digits. */
    function child(group, segment) {
        var found = null;
        var lower = segment.toLowerCase();
        var candidate;
        var i;
        try {
            found = group.property(segment);
        } catch (lookupError) {
            found = null;
        }
        if (found) {
            return found;
        }
        for (i = 1; i <= group.numProperties; i += 1) {
            candidate = group.property(i);
            if (candidate && (candidate.name.toLowerCase() === lower || candidate.matchName === segment)) {
                return candidate;
            }
        }
        if (/^\d+$/.test(segment)) {
            i = parseInt(segment, 10);
            if (i >= 1 && i <= group.numProperties) {
                return group.property(i);
            }
        }
        return null;
    }

    /** "Marker, Transform, Effects" (the first 30 children). */
    AE.childNames = function (group) {
        var names = [];
        var i;
        for (i = 1; i <= group.numProperties && names.length < 30; i += 1) {
            names.push(group.property(i).name);
        }
        if (group.numProperties > names.length) {
            names.push("...");
        }
        return names.join(", ");
    };

    function segmentsOf(path) {
        var raw = Z.isArray(path) ? path : String(path).split("/");
        var out = [];
        var i;
        var segment;
        for (i = 0; i < raw.length; i += 1) {
            segment = Z.trim(raw[i]);
            if (segment.length) {
                out.push(segment);
            }
        }
        if (!out.length) {
            throw Z.refuse("INVALID_ARGUMENT", "`property` must name a property, e.g. \"Transform/Position\"");
        }
        return out;
    }

    // Groups a path may skip: "Position" means "Transform/Position".
    var SHORTCUT_GROUPS = ["ADBE Transform Group", "ADBE Text Properties", "ADBE Effect Parade"];

    /**
     * The property at `path` below `layer`: {property, path, match_path}.
     * Refuses NOT_FOUND with the names that do exist at the failing level.
     */
    AE.resolveProperty = function (layer, path) {
        var segments = segmentsOf(path);
        var node = layer;
        var names = [];
        var matchNames = [];
        var next;
        var group;
        var i;
        var g;
        for (i = 0; i < segments.length; i += 1) {
            next = child(node, segments[i]);
            if (!next && i === 0) {
                for (g = 0; g < SHORTCUT_GROUPS.length && !next; g += 1) {
                    group = layer.property(SHORTCUT_GROUPS[g]);
                    next = group ? child(group, segments[i]) : null;
                    if (next) {
                        names.push(group.name);
                        matchNames.push(group.matchName);
                    }
                }
            }
            if (!next) {
                throw Z.refuse("NOT_FOUND", "Layer \"" + layer.name + "\" has no property \"" + names.concat([segments[i]]).join("/") +
                    "\"" + (node.numProperties ? "; " + (names.length ? "\"" + names.join("/") + "\"" : "the layer") + " has: " + AE.childNames(node) : ""));
            }
            if (AE.isLeaf(next) && i < segments.length - 1) {
                throw Z.refuse("NOT_FOUND", "\"" + names.concat([next.name]).join("/") + "\" is a property, not a group; it has no \"" + segments[i + 1] + "\"");
            }
            names.push(next.name);
            matchNames.push(next.matchName);
            node = next;
        }
        return {property: node, path: names.join("/"), match_path: matchNames.join("/")};
    };

    /** Like resolveProperty, but the result must be a property with a value. */
    AE.resolveLeaf = function (layer, path) {
        var target = AE.resolveProperty(layer, path);
        if (!AE.isLeaf(target.property)) {
            throw Z.refuse("INVALID_ARGUMENT", "\"" + target.path + "\" is a group; name one of its properties: " + AE.childNames(target.property));
        }
        return target;
    };

    /** Display path of a property from its layer ("Transform/Position"). */
    AE.pathOf = function (property) {
        var names = [];
        var node = property;
        while (node && node.propertyDepth > 0) {
            names.unshift(node.name);
            node = node.parentProperty;
        }
        return names.join("/");
    };

    // ------------------------------------------------------------------
    // Values.

    function valueDimensions(property) {
        var type = property.propertyValueType;
        if (type === PropertyValueType.TwoD || type === PropertyValueType.TwoD_SPATIAL) {
            return 2;
        }
        if (type === PropertyValueType.ThreeD || type === PropertyValueType.ThreeD_SPATIAL) {
            return 3;
        }
        return 1;
    }
    AE.valueDimensions = valueDimensions;

    var SCALE_MATCH_NAMES = ["ADBE Scale", "ADBE Text Scale 3D", "ADBE Vector Scale"];

    function isNumberList(value) {
        var i;
        if (!Z.isArray(value)) {
            return false;
        }
        for (i = 0; i < value.length; i += 1) {
            if (typeof value[i] !== "number" || !isFinite(value[i])) {
                return false;
            }
        }
        return true;
    }

    function rangeCheck(property, value, key, path) {
        var low = property.hasMin ? property.minValue : null;
        var high = property.hasMax ? property.maxValue : null;
        if ((low !== null && value < low) || (high !== null && value > high)) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` " + value + " is out of range for " + path + " (" +
                (low !== null ? low : "-inf") + " to " + (high !== null ? high : "inf") + ")");
        }
    }

    /** A colour value as [r, g, b, a] (0-1): "#RRGGBB", [r, g, b] or [r, g, b, a]. */
    AE.colorValue = function (raw, key) {
        var rgb;
        if (isNumberList(raw) && raw.length === 4) {
            rgb = Z.color.toRgb([raw[0], raw[1], raw[2]], key);
            if (raw[3] < 0 || raw[3] > 1) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` alpha must be 0-1");
            }
            return [rgb[0], rgb[1], rgb[2], raw[3]];
        }
        rgb = Z.color.toRgb(raw, key);
        return [rgb[0], rgb[1], rgb[2], 1];
    };

    /** "\n" and "\r\n" become After Effects' paragraph separator "\r". */
    AE.textValue = function (text) {
        return String(text).replace(/\r\n|\n/g, "\r");
    };

    /** A Shape from {vertices, in_tangents?, out_tangents?, closed?}. */
    AE.shapeValue = function (raw, key) {
        var vertices;
        var inTangents;
        var outTangents;
        var shape;
        /** @returns {any} */
        function points(list, name) {
            var out = [];
            var j;
            if (!Z.isArray(list)) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "." + name + "` must be a list of [x, y]");
            }
            for (j = 0; j < list.length; j += 1) {
                if (!isNumberList(list[j]) || list[j].length !== 2) {
                    throw Z.refuse("INVALID_ARGUMENT", "`" + key + "." + name + "[" + j + "]` must be [x, y]");
                }
                out.push([list[j][0], list[j][1]]);
            }
            return out;
        }
        function zeros(count) {
            var out = [];
            var j;
            for (j = 0; j < count; j += 1) {
                out.push([0, 0]);
            }
            return out;
        }
        if (!Z.isObject(raw) || !Z.has(raw, "vertices")) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a path {vertices, in_tangents?, out_tangents?, closed?}");
        }
        vertices = points(raw.vertices, "vertices");
        if (!vertices.length) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + ".vertices` needs at least one point");
        }
        inTangents = Z.has(raw, "in_tangents") && raw.in_tangents !== null ? points(raw.in_tangents, "in_tangents") : zeros(vertices.length);
        outTangents = Z.has(raw, "out_tangents") && raw.out_tangents !== null ? points(raw.out_tangents, "out_tangents") : zeros(vertices.length);
        if (inTangents.length !== vertices.length || outTangents.length !== vertices.length) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` needs as many tangents as vertices (" + vertices.length + ")");
        }
        shape = new Shape();
        shape.vertices = vertices;
        shape.inTangents = inTangents;
        shape.outTangents = outTangents;
        shape.closed = !(Z.has(raw, "closed") && raw.closed === false);
        return shape;
    };

    /**
     * `raw` (a tool argument) as a value `property` accepts: numbers, [x, y(, z)]
     * points, colours, text, shapes. `current` is the value used to fill a
     * missing z. Refuses INVALID_ARGUMENT / UNSUPPORTED with the property path.
     */
    AE.toValue = function (property, raw, key, current) {
        var type = property.propertyValueType;
        var path = AE.pathOf(property) || property.name;
        var dims;
        var base;
        var doc;
        if (type === PropertyValueType.NO_VALUE || type === PropertyValueType.CUSTOM_VALUE) {
            throw Z.refuse("UNSUPPORTED", path + " has no value scripts can set");
        }
        if (type === PropertyValueType.MARKER) {
            throw Z.refuse("UNSUPPORTED", path + " holds markers; use ae_add_marker");
        }
        if (type === PropertyValueType.TEXT_DOCUMENT) {
            if (typeof raw !== "string") {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be text for " + path);
            }
            doc = property.value;
            doc.text = AE.textValue(raw);
            return doc;
        }
        if (type === PropertyValueType.SHAPE) {
            return AE.shapeValue(raw, key);
        }
        if (type === PropertyValueType.COLOR) {
            return AE.colorValue(raw, key);
        }
        dims = valueDimensions(property);
        if (dims === 1) {
            if (typeof raw === "boolean") {
                return raw ? 1 : 0;
            }
            if (typeof raw !== "number" || !isFinite(raw)) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a number for " + path);
            }
            rangeCheck(property, raw, key, path);
            return raw;
        }
        if (typeof raw === "number" && Z.indexOf(SCALE_MATCH_NAMES, property.matchName) >= 0) {
            return dims === 2 ? [raw, raw] : [raw, raw, raw];
        }
        if (!isNumberList(raw) || raw.length < 2 || raw.length > dims) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be " + (dims === 2 ? "[x, y]" : "[x, y] or [x, y, z]") + " for " + path);
        }
        if (raw.length === dims) {
            return dims === 2 ? [raw[0], raw[1]] : [raw[0], raw[1], raw[2]];
        }
        base = current !== undefined && current !== null ? current : property.value;
        return [raw[0], raw[1], Z.isArray(base) && base.length > 2 ? base[2] : 0];
    };

    function textDocumentJson(doc) {
        var out = {text: String(doc.text).replace(/\r/g, "\n")};
        function read(name, fn) {
            try {
                out[name] = fn();
            } catch (readError) {
                out[name] = null;
            }
        }
        read("font", function () { return doc.font; });
        read("size", function () { return Z.round(doc.fontSize, 2); });
        read("fill", function () { return doc.applyFill ? Z.color.toHex(doc.fillColor) : null; });
        read("stroke", function () { return doc.applyStroke ? Z.color.toHex(doc.strokeColor) : null; });
        read("stroke_width", function () { return doc.applyStroke ? Z.round(doc.strokeWidth, 2) : 0; });
        read("tracking", function () { return doc.tracking; });
        read("leading", function () { return Z.round(doc.leading, 2); });
        read("justification", function () { return AE.justificationName(doc.justification); });
        read("box", function () { return doc.boxText ? {width: Z.round(doc.boxTextSize[0], 2), height: Z.round(doc.boxTextSize[1], 2)} : null; });
        return out;
    }
    AE.textDocumentJson = textDocumentJson;

    /** A property value as JSON for receipts. */
    AE.exportValue = function (value) {
        if (value === null || value === undefined) {
            return null;
        }
        if (typeof value === "number") {
            return Z.round(value, 4);
        }
        if (typeof value === "boolean" || typeof value === "string") {
            return value;
        }
        if (Z.isArray(value)) {
            return Z.map(value, function (item) { return AE.exportValue(item); });
        }
        if (value instanceof TextDocument) {
            return textDocumentJson(value);
        }
        if (value instanceof MarkerValue) {
            return {comment: value.comment, duration: Z.round(value.duration, 4), chapter: value.chapter, label: value.label};
        }
        if (value instanceof Shape) {
            return {vertices: AE.exportValue(value.vertices), closed: value.closed};
        }
        return String(value);
    };

    // ------------------------------------------------------------------
    // Keyframes.

    /** Remove every keyframe of `property`; returns how many. */
    AE.removeAllKeys = function (property) {
        var count = property.numKeys;
        while (property.numKeys > 0) {
            property.removeKey(property.numKeys);
        }
        return count;
    };

    /** Remove keyframes with start <= time <= end; returns how many. */
    AE.removeKeysBetween = function (property, start, end) {
        var removed = 0;
        var i;
        var time;
        for (i = property.numKeys; i >= 1; i -= 1) {
            time = property.keyTime(i);
            if (time >= start - KEY_EPSILON && time <= end + KEY_EPSILON) {
                property.removeKey(i);
                removed += 1;
            }
        }
        return removed;
    };

    /**
     * A TASTE easing name or {x1, y1, x2, y2} as a curve:
     * {name, type: "bezier" | "linear" | "hold", x1, y1, x2, y2}.
     */
    AE.curve = function (easing, key) {
        var points;
        if (typeof easing === "string") {
            if (easing === "hold") {
                return {name: "hold", type: "hold"};
            }
            if (!Z.has(TASTE.easing.curves, easing)) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be one of " + Object.keys(TASTE.easing.curves).join(", ") + ", hold or {x1, y1, x2, y2}; got " + easing);
            }
            points = TASTE.easing.curves[easing];
            return {name: easing, type: easing === "linear" ? "linear" : "bezier", x1: points[0], y1: points[1], x2: points[2], y2: points[3]};
        }
        if (Z.isObject(easing) && typeof easing.x1 === "number" && typeof easing.y1 === "number" && typeof easing.x2 === "number" && typeof easing.y2 === "number" &&
                easing.x1 >= 0 && easing.x1 <= 1 && easing.x2 >= 0 && easing.x2 <= 1) {
            return {name: "custom", type: "bezier", x1: easing.x1, y1: easing.y1, x2: easing.x2, y2: easing.y2};
        }
        throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a TASTE easing name or {x1, y1, x2, y2} with x1, x2 in 0-1");
    };

    function clampInfluence(percent) {
        var limits = TASTE.easing.aeInfluence;
        return Math.max(limits.min, Math.min(limits.max, percent));
    }

    function distance(a, b) {
        var sum = 0;
        var i;
        for (i = 0; i < a.length && i < b.length; i += 1) {
            sum += (b[i] - a[i]) * (b[i] - a[i]);
        }
        return Math.sqrt(sum);
    }

    /**
     * Value change per ease dimension between two keyframe values: spatial
     * properties and colours use the distance (one ease), other arrays one
     * change per dimension, numbers their difference (TASTE 2).
     */
    function changes(property, a, b) {
        var dims = valueDimensions(property);
        var out = [];
        var i;
        if (typeof a === "number" && typeof b === "number") {
            return [b - a];
        }
        if (!Z.isArray(a) || !Z.isArray(b)) {
            return [0];
        }
        if (property.isSpatial || property.propertyValueType === PropertyValueType.COLOR || dims === 1) {
            return [distance(a, b)];
        }
        for (i = 0; i < dims; i += 1) {
            out.push((b[i] || 0) - (a[i] || 0));
        }
        return out;
    }

    /** Ease dimensions After Effects expects: 2 for TwoD, 3 for ThreeD, 1 otherwise. */
    function easeDimensions(property) {
        var type = property.propertyValueType;
        if (type === PropertyValueType.TwoD) {
            return 2;
        }
        if (type === PropertyValueType.ThreeD) {
            return 3;
        }
        return 1;
    }
    AE.easeDimensions = easeDimensions;

    /** KeyframeEase arrays sized per dimension (the typings model them as tuples). @returns {any} */
    function easeList(count, speed, influence) {
        var out = [];
        var i;
        for (i = 0; i < count; i += 1) {
            out.push(new KeyframeEase(speed && speed[i] !== undefined ? speed[i] : 0, influence));
        }
        return out;
    }

    /**
     * The TASTE 2 mapping for one bezier segment with value change dv over dt:
     * outgoing ease of the first key: influence x1*100 %, speed (y1/x1)*dv/dt;
     * incoming ease of the second key: influence (1-x2)*100 %,
     * speed ((1-y2)/(1-x2))*dv/dt; speed 0 when x1 or 1-x2 is 0.
     */
    AE.segmentEase = function (curve, deltas, dt, spatial) {
        var outSpeed = [];
        var inSpeed = [];
        var rate;
        var i;
        for (i = 0; i < deltas.length; i += 1) {
            rate = dt > 0 ? deltas[i] / dt : 0;
            outSpeed.push(curve.x1 > 0 ? (curve.y1 / curve.x1) * rate : 0);
            inSpeed.push(1 - curve.x2 > 0 ? ((1 - curve.y2) / (1 - curve.x2)) * rate : 0);
            if (spatial) {
                // Spatial speed is along the path and never negative.
                outSpeed[i] = Math.max(0, outSpeed[i]);
                inSpeed[i] = Math.max(0, inSpeed[i]);
            }
        }
        return {
            outSpeed: outSpeed,
            outInfluence: clampInfluence(curve.x1 * 100),
            inSpeed: inSpeed,
            inInfluence: clampInfluence((1 - curve.x2) * 100)
        };
    };

    function interpolationType(curve) {
        if (curve.type === "hold") {
            return KeyframeInterpolationType.HOLD;
        }
        return curve.type === "linear" ? KeyframeInterpolationType.LINEAR : KeyframeInterpolationType.BEZIER;
    }

    /** @returns {any} */
    function zeroTangent(property) {
        return property.propertyValueType === PropertyValueType.TwoD_SPATIAL ? [0, 0] : [0, 0, 0];
    }

    /**
     * Write eased keyframes. `keys`: [{time, value, curve}] in time order with
     * values in the property's units; `curve` eases the segment that leaves
     * the key (AE.curve). options: {replace: remove every existing key first
     * (else only keys inside the new span), spatial: "auto-bezier" | "linear"}.
     * Returns [{index, time, value}] and warns about replaced keys.
     */
    AE.writeKeyframes = function (property, keys, options, ctx) {
        var path = AE.pathOf(property) || property.name;
        var opts = options || {};
        var removed;
        var indexes = [];
        var count = keys.length;
        var dims = easeDimensions(property);
        var inEase = [];
        var outEase = [];
        var inType = [];
        var outType = [];
        var neutral = 100 / 6;
        var segment;
        var ease;
        var deltas;
        var i;
        var index;
        if (!property.canVaryOverTime) {
            throw Z.refuse("UNSUPPORTED", path + " cannot be keyframed");
        }
        removed = opts.replace ? AE.removeAllKeys(property) : AE.removeKeysBetween(property, keys[0].time, keys[count - 1].time);
        if (removed > 0) {
            ctx.warn("Replaced " + Z.plural(removed, "existing keyframe") + " on " + path);
        }
        for (i = 0; i < count; i += 1) {
            property.setValueAtTime(keys[i].time, keys[i].value);
        }
        for (i = 0; i < count; i += 1) {
            index = property.nearestKeyIndex(keys[i].time);
            if (Math.abs(property.keyTime(index) - keys[i].time) > KEY_EPSILON) {
                throw Z.fail("HOST_ERROR", "Lost the keyframe at " + Z.round(keys[i].time) + " s on " + path);
            }
            indexes.push(index);
            inEase.push(easeList(dims, null, neutral));
            outEase.push(easeList(dims, null, neutral));
        }
        // Interpolation of each side follows the segment on that side.
        for (i = 0; i < count; i += 1) {
            outType.push(i < count - 1 ? interpolationType(keys[i].curve) : null);
            inType.push(i > 0 ? interpolationType(keys[i - 1].curve) : null);
        }
        for (i = 0; i < count; i += 1) {
            if (outType[i] === null) {
                outType[i] = inType[i] !== null ? inType[i] : KeyframeInterpolationType.BEZIER;
            }
            if (inType[i] === null) {
                inType[i] = outType[i];
            }
        }
        for (i = 0; i < count - 1; i += 1) {
            segment = keys[i].curve;
            if (segment.type !== "bezier") {
                continue;
            }
            deltas = changes(property, keys[i].value, keys[i + 1].value);
            ease = AE.segmentEase(segment, deltas, keys[i + 1].time - keys[i].time, property.isSpatial);
            outEase[i] = easeList(dims, ease.outSpeed, ease.outInfluence);
            inEase[i + 1] = easeList(dims, ease.inSpeed, ease.inInfluence);
        }
        if (!property.isInterpolationTypeValid(KeyframeInterpolationType.BEZIER)) {
            // Source Text and similar only hold.
            for (i = 0; i < count; i += 1) {
                if (property.isInterpolationTypeValid(KeyframeInterpolationType.HOLD)) {
                    property.setInterpolationTypeAtKey(indexes[i], KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                }
            }
            return Z.map(keys, function (key, i2) {
                return {index: indexes[i2], time: Z.round(key.time, 4), value: AE.exportValue(key.value), easing: i2 < count - 1 ? "hold" : null};
            });
        }
        for (i = 0; i < count; i += 1) {
            property.setInterpolationTypeAtKey(indexes[i], inType[i], outType[i]);
            property.setTemporalContinuousAtKey(indexes[i], false);
            property.setTemporalAutoBezierAtKey(indexes[i], false);
            if (inType[i] === KeyframeInterpolationType.BEZIER || outType[i] === KeyframeInterpolationType.BEZIER) {
                property.setTemporalEaseAtKey(indexes[i], inEase[i], outEase[i]);
                if (inType[i] !== outType[i]) {
                    // Setting an ease can turn a linear or hold side into Bezier, as the
                    // Keyframe Velocity dialog does; put the other side back.
                    property.setInterpolationTypeAtKey(indexes[i], inType[i], outType[i]);
                }
            }
            if (property.isSpatial) {
                if (opts.spatial === "linear") {
                    property.setSpatialAutoBezierAtKey(indexes[i], false);
                    property.setSpatialContinuousAtKey(indexes[i], false);
                    property.setSpatialTangentsAtKey(indexes[i], zeroTangent(property), zeroTangent(property));
                } else {
                    property.setSpatialAutoBezierAtKey(indexes[i], true);
                }
            }
        }
        if (property.expressionEnabled && property.expression !== "") {
            ctx.warn(path + " has an expression, which may override these keyframes");
        }
        return Z.map(keys, function (key, i2) {
            return {index: indexes[i2], time: Z.round(key.time, 4), value: AE.exportValue(key.value), easing: i2 < count - 1 ? key.curve.name : null};
        });
    };

    /** Keyframes of a property as JSON for receipts (at most `max`). */
    AE.keyframesJson = function (property, max) {
        var out = [];
        var i;
        function ease(list) {
            return Z.map(list, function (item) {
                return {speed: Z.round(item.speed, 4), influence: Z.round(item.influence, 3)};
            });
        }
        for (i = 1; i <= property.numKeys && out.length < max; i += 1) {
            out.push({
                time: Z.round(property.keyTime(i), 4),
                value: AE.exportValue(property.keyValue(i)),
                "in": {type: AE.interpolationName(property.keyInInterpolationType(i)), ease: ease(property.keyInTemporalEase(i))},
                out: {type: AE.interpolationName(property.keyOutInterpolationType(i)), ease: ease(property.keyOutTemporalEase(i))}
            });
        }
        return out;
    };
}(ZenviLink));
