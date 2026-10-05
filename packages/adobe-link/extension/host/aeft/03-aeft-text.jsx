// Zenvi Link: After Effects text helpers (ZenviLink.ae): TASTE type styles,
// font fallback, balanced line breaks, title-safe layout and the contrast
// shadow (TASTE 3 and 4).

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;
    var TYPE = TASTE.type;

    // ------------------------------------------------------------------
    // Styles.

    AE.TEXT_STYLES = ["headline", "title", "subtitle", "lower-third", "caption"];

    /** TASTE 4 role -> {size (at 1080), bold, leading (x size), tracking (1/1000 em)}. */
    AE.textStyle = function (style) {
        var headlineTracking = Math.round(TYPE.tracking.headline * 1000);
        switch (style) {
        case "headline":
            return {size: TYPE.sizes.headline, bold: true, leading: TYPE.leading.headline, tracking: headlineTracking};
        case "title":
            // The gentle end of the headline range: titles are a step smaller.
            return {size: TYPE.sizes.title, bold: true, leading: TYPE.leading.headline, tracking: Math.round(TYPE.tracking.headlineRange[1] * 1000)};
        case "lower-third":
            return {size: TYPE.sizes.lowerThirdName, bold: true, leading: TYPE.leading.headline, tracking: 0};
        case "role":
            return {size: TYPE.sizes.lowerThirdRole, bold: false, leading: TYPE.leading.body, tracking: 0};
        case "caption":
            return {size: TYPE.sizes.caption, bold: false, leading: TYPE.leading.body, tracking: 0};
        default:
            return {size: TYPE.sizes.subtitle, bold: false, leading: TYPE.leading.body, tracking: 0};
        }
    };

    /** The style a placement implies when none is given. */
    AE.defaultTextStyle = function (placement) {
        if (placement === "lower-third") {
            return "lower-third";
        }
        if (placement === "bottom-center") {
            return "caption";
        }
        if (placement === "top-left" || placement === "top-center") {
            return "subtitle";
        }
        return "title";
    };

    /** ALL CAPS text with at least two letters. */
    AE.isAllCaps = function (text) {
        var letters = String(text).replace(/[^A-Za-z]/g, "");
        return letters.length >= 2 && letters === letters.toUpperCase();
    };

    /**
     * Tracking for `style` and `text` (1/1000 em): TASTE headline tracking,
     * caps tracking for ALL CAPS labels; display sizes in caps stay neutral.
     */
    AE.styleTracking = function (style, text) {
        if (AE.isAllCaps(text)) {
            return style === "headline" || style === "title" ? 0 : Math.round(TYPE.tracking.caps * 1000);
        }
        return AE.textStyle(style).tracking;
    };

    // ------------------------------------------------------------------
    // Fonts.

    /**
     * true / false when After Effects 24+ can say whether a font with this
     * PostScript name is installed (app.fonts), null when it cannot.
     */
    AE.fontAvailable = function (postscriptName) {
        var fonts = app.fonts;
        var found;
        var i;
        if (!fonts || typeof fonts.getFontsByPostScriptName !== "function") {
            return null;
        }
        try {
            found = fonts.getFontsByPostScriptName(postscriptName);
        } catch (lookupError) {
            return null;
        }
        if (!found) {
            return false;
        }
        for (i = 0; i < found.length; i += 1) {
            if (!found[i].isSubstitute) {
                return true;
            }
        }
        return false;
    };

    /** `requested` first, then the TASTE families for the weight. */
    AE.fontCandidates = function (requested, bold) {
        var list = bold ? TYPE.postscript.headline : TYPE.postscript.body;
        var out = requested ? [requested] : [];
        var i;
        for (i = 0; i < list.length; i += 1) {
            if (out.indexOf(list[i]) < 0) {
                out.push(list[i]);
            }
        }
        return out;
    };

    /**
     * Apply `spec` to a Source Text property and set it: {text, size, fill
     * ([r, g, b]), stroke ([r, g, b] | null = none), strokeWidth, tracking,
     * leading (x size), justification (enum), box ([w, h]), fonts (candidate
     * PostScript names, first available wins), requestedFont}. Returns the
     * applied {font, size}.
     */
    AE.setTextDocument = function (textProperty, spec, ctx) {
        var doc = textProperty.value;
        var size;
        var chosen = null;
        var skipped = [];
        var available;
        var i;
        if (spec.text !== undefined) {
            doc.text = spec.text;
        }
        if (spec.size !== undefined) {
            doc.fontSize = spec.size;
        }
        size = spec.size !== undefined ? spec.size : doc.fontSize;
        if (spec.fill !== undefined) {
            doc.applyFill = true;
            doc.fillColor = spec.fill;
        }
        if (spec.stroke === null) {
            doc.applyStroke = false;
        } else if (spec.stroke !== undefined) {
            doc.applyStroke = true;
            doc.strokeColor = spec.stroke;
            doc.strokeOverFill = false;
            doc.strokeWidth = spec.strokeWidth !== undefined ? spec.strokeWidth : Math.max(1, Math.round(2 * size / 54));
        } else if (spec.strokeWidth !== undefined && doc.applyStroke) {
            doc.strokeWidth = spec.strokeWidth;
        }
        if (spec.tracking !== undefined) {
            doc.tracking = spec.tracking;
        }
        if (spec.leading !== undefined) {
            if (typeof doc.autoLeading === "boolean") {
                doc.autoLeading = false;
            }
            doc.leading = Math.round(size * spec.leading * 100) / 100;
        }
        if (spec.justification !== undefined) {
            doc.justification = spec.justification;
        }
        if (spec.box !== undefined && doc.boxText) {
            doc.boxTextSize = spec.box;
        }
        if (!spec.fonts) {
            textProperty.setValue(doc);
            return {font: textProperty.value.font, size: size};
        }
        for (i = 0; i < spec.fonts.length && chosen === null; i += 1) {
            available = AE.fontAvailable(spec.fonts[i]);
            if (available === false) {
                skipped.push(spec.fonts[i]);
                continue;
            }
            doc.font = spec.fonts[i];
            textProperty.setValue(doc);
            doc = textProperty.value;
            // Before After Effects 24 there is no font list: a missing font simply does not take.
            if (doc.font === spec.fonts[i]) {
                chosen = spec.fonts[i];
            } else {
                skipped.push(spec.fonts[i]);
            }
        }
        if (chosen === null) {
            textProperty.setValue(doc);
            chosen = textProperty.value.font;
            ctx.warn("None of " + spec.fonts.join(", ") + " is installed; the text uses " + chosen);
        } else if (spec.requestedFont && chosen !== spec.requestedFont) {
            ctx.warn("Font " + spec.requestedFont + " is not installed; used " + chosen);
        }
        return {font: chosen, size: size};
    };

    // ------------------------------------------------------------------
    // Line breaks (TASTE 4: at most 32 characters, phrase boundaries, no orphans).

    function lineLength(words, from, to) {
        var length = 0;
        var i;
        for (i = from; i < to; i += 1) {
            length += words[i].length + (i > from ? 1 : 0);
        }
        return length;
    }

    /** Break `words` into `count` lines minimising the longest line. Returns line start indexes. */
    function balance(words, count) {
        var n = words.length;
        /** @type {number[][]} */
        var best = [];
        /** @type {number[][]} */
        var from = [];
        var i;
        var k;
        var j;
        var cost;
        for (k = 0; k <= count; k += 1) {
            best.push([]);
            from.push([]);
            for (i = 0; i <= n; i += 1) {
                best[k].push(Infinity);
                from[k].push(-1);
            }
        }
        best[0][0] = 0;
        for (k = 1; k <= count; k += 1) {
            for (i = 1; i <= n; i += 1) {
                for (j = k - 1; j < i; j += 1) {
                    if (best[k - 1][j] === Infinity) {
                        continue;
                    }
                    cost = Math.max(best[k - 1][j], lineLength(words, j, i));
                    if (cost < best[k][i]) {
                        best[k][i] = cost;
                        from[k][i] = j;
                    }
                }
            }
        }
        var starts = [];
        i = n;
        for (k = count; k >= 1; k -= 1) {
            starts.unshift(from[k][i]);
            i = from[k][i];
        }
        return {starts: starts, longest: best[count][n]};
    }

    /**
     * `text` with lines of at most `maxChars` characters, broken at balanced
     * word boundaries (After Effects' "\r" separates lines). Text that already
     * has line breaks is left as written. Returns {text, lines, broke}.
     */
    AE.breakLines = function (text, maxChars) {
        var normalized = AE.textValue(text);
        var words;
        var count;
        var result;
        var lines;
        var i;
        if (!maxChars || normalized.indexOf("\r") >= 0 || normalized.length <= maxChars) {
            return {text: normalized, lines: normalized.split("\r").length, broke: false};
        }
        words = Z.filter(normalized.split(/\s+/), function (word) { return word.length > 0; });
        if (words.length < 2) {
            return {text: normalized, lines: 1, broke: false};
        }
        count = Math.ceil(normalized.length / maxChars);
        for (; count <= words.length; count += 1) {
            result = balance(words, Math.min(count, words.length));
            if (result.longest <= maxChars) {
                break;
            }
        }
        lines = [];
        for (i = 0; i < result.starts.length; i += 1) {
            lines.push(words.slice(result.starts[i], i + 1 < result.starts.length ? result.starts[i + 1] : words.length).join(" "));
        }
        // Never leave a single orphan word on the last line when the line above can spare one.
        if (lines.length >= 2 && lines[lines.length - 1].indexOf(" ") < 0) {
            var above = lines[lines.length - 2].split(" ");
            if (above.length >= 3) {
                var moved = above.pop();
                var last = moved + " " + lines[lines.length - 1];
                if (last.length <= maxChars) {
                    lines[lines.length - 2] = above.join(" ");
                    lines[lines.length - 1] = last;
                }
            }
        }
        return {text: lines.join("\r"), lines: lines.length, broke: true};
    };

    // ------------------------------------------------------------------
    // Layout.

    /** @returns {Property} */
    function transformProperty(layer, matchName) {
        return /** @type {Property} */ (layer.property("ADBE Transform Group").property(matchName));
    }

    /** [x, y] -> the property's own [x, y(, z)], keeping z. */
    function setPoint(property, x, y) {
        property.setValue(AE.toValue(property, [x, y], "position"));
    }
    AE.setPoint = setPoint;

    function measure(layer, time) {
        return layer.sourceRectAtTime(time, false);
    }

    /**
     * Shrink a text layer's font until its box fits `maxWidth` (at most to
     * half size). Returns the final size.
     */
    AE.fitTextWidth = function (layer, textProperty, maxWidth, time, ctx) {
        var rect = measure(layer, time);
        var doc = textProperty.value;
        var size = doc.fontSize;
        var target;
        if (rect.width <= maxWidth || rect.width <= 0) {
            return size;
        }
        target = Math.max(size * 0.5, Math.floor(size * (maxWidth / rect.width) * 0.98));
        if (doc.leading && !(typeof doc.autoLeading === "boolean" && doc.autoLeading)) {
            doc.leading = Math.round(doc.leading * (target / size) * 100) / 100;
        }
        doc.fontSize = target;
        textProperty.setValue(doc);
        ctx.warn("\"" + AE.clip(layer.name, 40) + "\" was wider than title-safe; reduced its size from " + Z.round(size, 1) + " to " +
            Z.round(target, 1) + " px");
        return target;
    };

    /**
     * Place text layers as one stacked block (main first) inside title-safe
     * (TASTE 3). placement: center | lower-third | top-left | top-center |
     * bottom-center; align: left | center | right. The gap between layers is
     * 0.25 x the first layer's size. Anchors sit at each line's alignment edge
     * and vertical middle, so scale animations grow from there.
     * Returns {left, top, width, height, inside_title_safe}.
     */
    AE.placeTextBlock = function (comp, layers, placement, align, firstSize, time, ctx) {
        var safe = AE.safeArea(comp);
        var rects = [];
        var width = 0;
        var height = 0;
        var gap = layers.length > 1 ? firstSize * TASTE.layout.lowerThird.gapOfNameSize : 0;
        var refX;
        var left;
        var top;
        var baseline;
        var y;
        var anchorX;
        var rect;
        var inside;
        var i;
        for (i = 0; i < layers.length; i += 1) {
            rect = measure(layers[i], time);
            rects.push(rect);
            width = Math.max(width, rect.width);
            height += rect.height + (i > 0 ? gap : 0);
        }
        if (placement === "lower-third" || placement === "top-left") {
            left = safe.left;
        } else {
            left = comp.width / 2 - width / 2;
        }
        refX = align === "left" ? left : (align === "right" ? left + width : left + width / 2);
        if (placement === "center") {
            top = (safe.top + safe.bottom) / 2 - height / 2;
        } else if (placement === "top-left" || placement === "top-center") {
            top = safe.top;
        } else if (placement === "bottom-center") {
            top = safe.bottom - height;
        } else {
            baseline = comp.height * (safe.vertical ? TASTE.layout.lowerThird.baselineVertical : TASTE.layout.lowerThird.baselineLandscape);
            top = baseline + rects[0].top;
            if (top + height > safe.bottom) {
                top = safe.bottom - height;
                ctx.warn("Raised the lower third so it ends inside title-safe (" + Z.round(safe.bottom) + " px)");
            }
        }
        y = top;
        for (i = 0; i < layers.length; i += 1) {
            rect = rects[i];
            anchorX = align === "left" ? rect.left : (align === "right" ? rect.left + rect.width : rect.left + rect.width / 2);
            setPoint(transformProperty(layers[i], "ADBE Anchor Point"), anchorX, rect.top + rect.height / 2);
            setPoint(transformProperty(layers[i], "ADBE Position"), refX, y + rect.height / 2);
            y += rect.height + gap;
        }
        inside = left >= safe.left - 0.5 && left + width <= safe.right + 0.5 && top >= safe.top - 0.5 && top + height <= safe.bottom + 0.5;
        if (!inside) {
            ctx.warn("The text block (" + Math.round(width) + "x" + Math.round(height) + " px) does not fit inside title-safe; shorten it or use a smaller size");
        }
        return {
            left: Z.round(left, 2),
            top: Z.round(top, 2),
            width: Z.round(width, 2),
            height: Z.round(height, 2),
            inside_title_safe: inside,
            title_safe: {left: Z.round(safe.left, 2), top: Z.round(safe.top, 2), right: Z.round(safe.right, 2), bottom: Z.round(safe.bottom, 2)}
        };
    };

    /** True when a footage or precomp layer (video under the text) is in the comp. */
    AE.hasFootageBelow = function (comp, textLayer) {
        var layer;
        var source;
        var i;
        for (i = textLayer.index + 1; i <= comp.numLayers; i += 1) {
            layer = comp.layer(i);
            if (!(layer instanceof AVLayer)) {
                continue;
            }
            source = layer.source;
            if (source && layer.enabled && !layer.adjustmentLayer && (source instanceof CompItem ||
                    (source instanceof FootageItem && !(source.mainSource instanceof SolidSource) && source.hasVideo))) {
                return true;
            }
        }
        return false;
    };

    /**
     * TASTE 4 contrast: a soft drop shadow (distance 0, softness 16 px at
     * 1080p, 40 % black) named "Zenvi Shadow". Replaces an earlier one.
     */
    AE.addTextShadow = function (comp, layer, ctx) {
        var parade = /** @type {PropertyGroup} */ (layer.property("ADBE Effect Parade"));
        var shadow = TYPE.shadow;
        var effect;
        var index;
        var opacity;
        var i;
        if (!parade || !parade.canAddProperty("ADBE Drop Shadow")) {
            ctx.warn("Drop Shadow is not available; added no shadow");
            return null;
        }
        for (i = parade.numProperties; i >= 1; i -= 1) {
            if (parade.property(i).name === "Zenvi Shadow") {
                parade.property(i).remove();
            }
        }
        index = parade.addProperty("ADBE Drop Shadow").propertyIndex;
        effect = AE.effectStack(layer).property(index);
        effect.name = "Zenvi Shadow";
        effect = /** @type {PropertyGroup} */ (AE.effectStack(layer).property(index));
        AE.effectParam(effect, "ADBE Drop Shadow-0001", "Shadow Color").setValue([0, 0, 0, 1]);
        opacity = AE.effectParam(effect, "ADBE Drop Shadow-0002", "Opacity");
        // Drop Shadow's opacity is 0-255 internally; use the property's own maximum.
        opacity.setValue(shadow.opacity * (opacity.hasMax ? opacity.maxValue : 100));
        AE.effectParam(effect, "ADBE Drop Shadow-0004", "Distance").setValue(shadow.distance);
        AE.effectParam(effect, "ADBE Drop Shadow-0005", "Softness").setValue(Math.round(shadow.softness * AE.typeScale(comp) * 10) / 10);
        return effect;
    };
}(ZenviLink));
