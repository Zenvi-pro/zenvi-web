// Zenvi Link: text tools: ae_add_text (designed text with TASTE type scale,
// fonts, line breaks, title-safe placement, contrast shadow and an optional
// entrance) and ae_set_text.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    var PLACEMENTS = ["center", "lower-third", "top-left", "top-center", "bottom-center"];
    var JUSTIFY = ["left", "center", "right"];
    var TEXT_ANIMATIONS = ["fade-in", "slide-in", "scale-pop", "blur-in", "typewriter", "word-cascade", "line-rise"];

    /** @returns {Property} */
    function textProperty(layer) {
        return /** @type {Property} */ (layer.property("ADBE Text Properties").property("ADBE Text Document"));
    }

    function boxArg(args) {
        var box = Z.optional(args, "box", "object", null);
        if (box === null) {
            return null;
        }
        return [Z.inRange("box.width", Z.required(box, "width", "number"), 1, 30000), Z.inRange("box.height", Z.required(box, "height", "number"), 1, 30000)];
    }

    function firstLine(text) {
        return AE.clip(String(text).split(/\r\n|\r|\n/)[0], 60);
    }

    /** A stand-in for a Source Text property that reads and writes the keyframe at `time`. */
    function keyedText(property, time) {
        var target = {
            value: property.valueAtTime(time, true),
            setValue: function (value) {
                property.setValueAtTime(time, value);
                target.value = property.valueAtTime(time, true);
            }
        };
        return target;
    }

    function wordCount(text) {
        return Z.filter(String(text).split(/\s+/), function (word) { return word.length > 0; }).length;
    }

    // ------------------------------------------------------------------
    // ae_add_text

    Z.register("ae_add_text", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var text = Z.required(args, "text", "string");
        var subtitle = Z.optional(args, "subtitle", "string", null);
        var placement = Z.oneOf("placement", Z.optional(args, "placement", "string", "center"), PLACEMENTS);
        var style = Z.optional(args, "style", "string", null);
        var font = Z.optional(args, "font", "string", null);
        var size = Z.optional(args, "size", "number", null);
        var justification = Z.optional(args, "justification", "string", null);
        var tracking = Z.optional(args, "tracking", "number", null);
        var leading = Z.optional(args, "leading", "number", null);
        var autoBreak = Z.optional(args, "auto_break", "boolean", true);
        var shadow = Z.optional(args, "shadow", "boolean", null);
        var start = Z.optional(args, "start", "number", 0);
        var duration = Z.optional(args, "duration", "number", null);
        var animation = Z.optional(args, "animation", "string", null);
        var name = Z.optional(args, "name", "string", null);
        var box = boxArg(args);
        var fill = AE.color(Z.optional(args, "fill", "any", TASTE.color.palette.paper), "fill");
        var stroke = Z.has(args, "stroke") && args.stroke !== null ? AE.color(args.stroke, "stroke") : undefined;
        var scale = AE.typeScale(comp);
        var strokeWidth = Z.optional(args, "stroke_width", "number", stroke !== undefined ? Math.max(1, Math.round(2 * scale * 10) / 10) : undefined);
        var spec;
        var subSpec = null;
        var broken;
        var end;
        var safe = AE.safeArea(comp);
        var layers = [];
        var applied;
        var block;
        var shadowOn;
        var animationData = [];
        var stagger = TASTE.timing.stagger.line;
        var sub = null;
        var data;
        var hold;
        var i;

        if (!text.trim().length) {
            throw Z.refuse("INVALID_ARGUMENT", "`text` is empty");
        }
        style = style === null ? AE.defaultTextStyle(placement) : Z.oneOf("style", style, AE.TEXT_STYLES);
        if (justification === null) {
            justification = placement === "lower-third" || placement === "top-left" ? "left" : "center";
        }
        Z.oneOf("justification", justification, JUSTIFY);
        if (size !== null) {
            Z.inRange("size", size, 1, 1296);
        }
        if (leading !== null) {
            Z.inRange("leading", leading, 0.5, 5);
        }
        if (tracking !== null) {
            Z.inRange("tracking", tracking, -1000, 10000);
        }
        if (strokeWidth !== undefined) {
            Z.inRange("stroke_width", strokeWidth, 0, 1000);
        }
        if (animation !== null) {
            Z.oneOf("animation", animation, TEXT_ANIMATIONS);
        }
        start = AE.compTime(comp, start, ctx, "start");
        if (start >= comp.duration - 1e-6) {
            throw Z.refuse("INVALID_ARGUMENT", "`start` must be before the end of comp \"" + comp.name + "\" (" + Z.round(comp.duration) + " s)");
        }
        if (duration === null) {
            duration = placement === "lower-third" ? TASTE.timing.lowerThird["default"] : comp.duration - start;
        }
        Z.inRange("duration", duration, 1 / comp.frameRate, 10800);
        end = Math.min(comp.duration, AE.snapTime(comp, start + duration, ctx, "end"));
        hold = TASTE.timing.textHold.base + TASTE.timing.textHold.perWord * wordCount(text + " " + (subtitle || ""));
        if (end - start < hold - 1e-6) {
            ctx.warn("On screen " + Z.round(end - start) + " s, shorter than its reading time (" + Z.round(hold, 2) + " s for " +
                wordCount(text + " " + (subtitle || "")) + " words, TASTE 1)");
        }

        broken = autoBreak && !box ? AE.breakLines(text, TASTE.type.maxLineChars) : {text: AE.textValue(text), broke: false};
        if (broken.broke) {
            ctx.warn("Broke the text into " + broken.lines + " lines of at most " + TASTE.type.maxLineChars + " characters (auto_break: false keeps it as written)");
        }
        spec = AE.textStyle(style);
        spec = {
            text: broken.text,
            size: size !== null ? size : Math.round(spec.size * scale * 10) / 10,
            fill: fill,
            stroke: stroke,
            strokeWidth: strokeWidth,
            tracking: tracking !== null ? tracking : AE.styleTracking(style, text),
            leading: leading !== null ? leading : spec.leading,
            justification: AE.justificationValue(justification),
            fonts: AE.fontCandidates(font, spec.bold),
            requestedFont: font,
            reset: true
        };
        if (subtitle !== null) {
            if (!subtitle.trim().length) {
                throw Z.refuse("INVALID_ARGUMENT", "`subtitle` is empty");
            }
            subSpec = AE.textStyle(style === "lower-third" ? "role" : "subtitle");
            subSpec = {
                text: autoBreak ? AE.breakLines(subtitle, TASTE.type.maxLineChars).text : AE.textValue(subtitle),
                size: Math.min(Math.round(subSpec.size * scale * 10) / 10, spec.size * 0.75),
                fill: fill,
                tracking: AE.styleTracking(style === "lower-third" ? "role" : "subtitle", subtitle),
                leading: subSpec.leading,
                justification: spec.justification,
                fonts: AE.fontCandidates(null, false),
                reset: true
            };
        }

        ctx.changed();
        layers.push(box ? comp.layers.addBoxText(/** @type {[number, number]} */ (box), broken.text) : comp.layers.addText(broken.text));
        layers[0].name = name || firstLine(text);
        applied = AE.setTextDocument(textProperty(layers[0]), spec, ctx);
        if (subSpec) {
            sub = comp.layers.addText(subSpec.text);
            sub.name = (name || firstLine(text)) + " (subtitle)";
            AE.setTextDocument(textProperty(sub), subSpec, ctx);
            layers.push(sub);
        }
        for (i = 0; i < layers.length; i += 1) {
            layers[i].startTime = start;
            layers[i].inPoint = start;
            layers[i].outPoint = end;
        }
        for (i = 0; i < layers.length; i += 1) {
            if (!box) {
                AE.fitTextWidth(layers[i], textProperty(layers[i]), safe.right - safe.left, start, ctx);
            }
        }
        block = AE.placeTextBlock(comp, layers, placement, justification, textProperty(layers[0]).value.fontSize, start, ctx);
        shadowOn = shadow !== null ? shadow : AE.hasFootageBelow(comp, layers[layers.length - 1]);
        if (shadowOn) {
            for (i = 0; i < layers.length; i += 1) {
                AE.addTextShadow(comp, layers[i], ctx);
            }
        }
        if (animation !== null) {
            for (i = 0; i < layers.length; i += 1) {
                animationData.push(AE.applyMotionPreset(comp, layers[i], animation, {start: start + i * stagger}, ctx));
            }
        }

        data = AE.layerRef(layers[0]);
        data.subtitle_layer = sub ? AE.layerRef(sub) : null;
        data.text = broken.text.replace(/\r/g, "\n");
        data.style = style;
        data.font = applied.font;
        data.size = Z.round(textProperty(layers[0]).value.fontSize, 2);
        data.placement = placement;
        data.justification = justification;
        data.block = block;
        data.shadow = shadowOn;
        data.in_point = Z.round(start, 4);
        data.out_point = Z.round(end, 4);
        data.animation = animation;
        data.animations = animationData;
        return Z.applied("Added " + style + " text \"" + AE.clip(firstLine(text), 40) + "\"" + (sub ? " with a subtitle" : "") + " to \"" + comp.name + "\" at " +
            placement + " (" + applied.font + " " + data.size + " px" + (shadowOn ? ", shadow" : "") + (animation ? ", " + animation : "") + ")" +
            (block.inside_title_safe ? "" : "; outside title-safe"), data);
    });

    // ------------------------------------------------------------------
    // ae_set_text

    Z.register("ae_set_text", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var property;
        var doc;
        var spec = {};
        var changes = [];
        var time = Z.optional(args, "time", "number", null);
        var text = Z.optional(args, "text", "string", null);
        var font = Z.optional(args, "font", "string", null);
        var size = Z.optional(args, "size", "number", null);
        var tracking = Z.optional(args, "tracking", "number", null);
        var leading = Z.optional(args, "leading", "number", null);
        var justification = Z.optional(args, "justification", "string", null);
        var strokeWidth = Z.optional(args, "stroke_width", "number", null);
        var box = boxArg(args);
        var applied;
        var before;
        var data;
        if (!(layer instanceof TextLayer)) {
            throw Z.refuse("INVALID_ARGUMENT", "Layer \"" + layer.name + "\" is a " + AE.layerType(layer) + " layer, not text");
        }
        property = textProperty(layer);
        doc = property.value;
        before = AE.textDocumentJson(doc);
        if (text !== null) {
            spec.text = AE.textValue(text);
            changes.push("text");
        }
        if (size !== null) {
            spec.size = Z.inRange("size", size, 1, 1296);
            changes.push("size " + size);
        }
        if (Z.has(args, "fill") && args.fill !== null) {
            spec.fill = AE.color(args.fill, "fill");
            changes.push("fill " + Z.color.toHex(spec.fill));
        }
        if (Z.has(args, "stroke")) {
            spec.stroke = args.stroke === null ? null : AE.color(args.stroke, "stroke");
            changes.push(args.stroke === null ? "no stroke" : "stroke " + Z.color.toHex(spec.stroke));
        }
        if (strokeWidth !== null) {
            spec.strokeWidth = Z.inRange("stroke_width", strokeWidth, 0, 1000);
            changes.push("stroke width " + strokeWidth);
        }
        if (tracking !== null) {
            spec.tracking = Z.inRange("tracking", tracking, -1000, 10000);
            changes.push("tracking " + tracking);
        }
        if (leading !== null) {
            spec.leading = Z.inRange("leading", leading, 0.5, 5);
            changes.push("leading " + leading + "x");
        }
        if (justification !== null) {
            spec.justification = AE.justificationValue(justification);
            changes.push(justification + " aligned");
        }
        if (box !== null) {
            if (!doc.boxText) {
                throw Z.refuse("INVALID_ARGUMENT", "Layer \"" + layer.name + "\" is point text; `box` applies to paragraph text");
            }
            spec.box = box;
            changes.push("box " + box[0] + "x" + box[1]);
        }
        if (font !== null) {
            spec.fonts = AE.fontCandidates(font, /bold|black|heavy|semibold/i.test(font));
            spec.requestedFont = font;
            changes.push("font " + font);
        }
        if (!changes.length) {
            throw Z.refuse("INVALID_ARGUMENT", "Nothing to change: pass text, font, size, fill, stroke, stroke_width, tracking, leading, justification or box");
        }
        if (property.numKeys > 0 && time === null) {
            throw Z.refuse("INVALID_ARGUMENT", "Source Text of \"" + layer.name + "\" is keyframed; pass `time` to change the keyframe there");
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        if (time !== null && property.numKeys > 0) {
            time = AE.compTime(comp, time, ctx, "time");
            // Source Text keyframes hold: change the document in effect at `time` and key it there.
            applied = AE.setTextDocument(keyedText(property, time), spec, ctx);
        } else {
            applied = AE.setTextDocument(property, spec, ctx);
        }
        data = AE.layerRef(layer);
        data.before = before;
        data.after = AE.textDocumentJson(time !== null && property.numKeys > 0 ? property.valueAtTime(time, true) : property.value);
        data.changed = changes;
        data.font = applied.font;
        return Z.applied("Changed text \"" + layer.name + "\": " + changes.join(", "), data);
    });
}(ZenviLink));
