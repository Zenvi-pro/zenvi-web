// Zenvi Link: effect tools: ae_apply_effect, ae_set_effect, ae_apply_look.

(function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    var LOOK_LAYER_MARK = "zenvi:look";
    var LOOK_EFFECT = "Zenvi Look";
    var SPLIT_TONE_EFFECT = "Zenvi Split Tone";

    /** [{param, value}] -> [{property, value, name}] for `effect`; null property = missing. */
    function resolveParams(effect, list, key) {
        var out = [];
        var property;
        var i;
        for (i = 0; i < list.length; i += 1) {
            if (!Z.isObject(list[i]) || typeof list[i].param !== "string" || !Z.has(list[i], "value") || list[i].value === null) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "[" + i + "]` must be {param, value}");
            }
            property = AE.findEffectParam(effect, list[i].param);
            if (!property) {
                throw Z.refuse("NOT_FOUND", effect.name + " has no parameter \"" + list[i].param + "\"; it has: " + AE.effectParamNames(effect));
            }
            out.push({property: property, value: AE.toValue(property, list[i].value, key + "[" + i + "].value"), name: property.name});
        }
        return out;
    }

    function resolveKeyframes(comp, effect, sets, defaultCurve, ctx) {
        var out = [];
        var property;
        var keys;
        var raw;
        var i;
        var j;
        for (i = 0; i < sets.length; i += 1) {
            if (!Z.isObject(sets[i]) || typeof sets[i].param !== "string" || !Z.isArray(sets[i].keyframes) || !sets[i].keyframes.length) {
                throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + i + "]` must be {param, keyframes: [{time, value, easing?}]}");
            }
            property = AE.findEffectParam(effect, sets[i].param);
            if (!property) {
                throw Z.refuse("NOT_FOUND", effect.name + " has no parameter \"" + sets[i].param + "\"; it has: " + AE.effectParamNames(effect));
            }
            keys = [];
            for (j = 0; j < sets[i].keyframes.length; j += 1) {
                raw = sets[i].keyframes[j];
                if (!Z.isObject(raw)) {
                    throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + i + "].keyframes[" + j + "]` must be {time, value, easing?}");
                }
                keys.push({
                    time: AE.snapTime(comp, Z.inRange("time", Z.required(raw, "time", "number"), 0, 10800), ctx, "keyframe time"),
                    value: AE.toValue(property, raw.value, "keyframes[" + i + "].keyframes[" + j + "].value"),
                    curve: Z.has(raw, "easing") && raw.easing !== null ? AE.curve(raw.easing, "easing") : defaultCurve
                });
                if (j > 0 && keys[j].time <= keys[j - 1].time + 1e-6) {
                    throw Z.refuse("INVALID_ARGUMENT", "Keyframe times for \"" + sets[i].param + "\" must increase (after snapping to frames)");
                }
            }
            out.push({property: property, keys: keys, name: property.name});
        }
        return out;
    }

    // ------------------------------------------------------------------
    // ae_apply_effect

    Z.register("ae_apply_effect", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var def = AE.findEffectDef(Z.required(args, "effect", "string"));
        var name = Z.optional(args, "name", "string", null);
        var params = Z.optional(args, "params", "array", []);
        var sets = Z.optional(args, "keyframes", "array", []);
        var defaultCurve = AE.curve(Z.optional(args, "easing", "any", TASTE.easing["default"]), "easing");
        var parade = AE.effectStack(layer);
        var effect;
        var index;
        var values;
        var animated;
        var set = [];
        var keyed = [];
        var i;
        if (!parade.canAddProperty(def.matchName)) {
            throw Z.refuse("UNSUPPORTED", def.displayName + " cannot be applied to layer \"" + layer.name + "\" (" + AE.layerType(layer) + ")");
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        effect = AE.addEffect(layer, def.matchName, name);
        index = effect.propertyIndex;
        try {
            values = resolveParams(effect, params, "params");
            animated = resolveKeyframes(comp, effect, sets, defaultCurve, ctx);
        } catch (invalid) {
            // A bad parameter: take the effect off again so the layer is as it was.
            AE.effectStack(layer).property(index).remove();
            throw invalid;
        }
        for (i = 0; i < values.length; i += 1) {
            values[i].property.setValue(values[i].value);
            set.push({param: values[i].name, value: AE.exportValue(values[i].value)});
        }
        for (i = 0; i < animated.length; i += 1) {
            keyed.push({param: animated[i].name, keyframes: AE.writeKeyframes(animated[i].property, animated[i].keys, {replace: false}, ctx)});
        }
        effect = AE.effectStack(layer).property(index);
        return Z.applied("Applied " + def.displayName + (name ? " (\"" + name + "\")" : "") + " to \"" + layer.name + "\" (effect " + index + ")" +
            (set.length ? ", set " + Z.map(set, function (s) { return s.param; }).join(", ") : "") +
            (keyed.length ? ", animated " + Z.map(keyed, function (k) { return k.param; }).join(", ") : ""), {
            layer: AE.layerRef(layer),
            effect: {index: index, name: effect.name, match_name: def.matchName, display_name: def.displayName},
            params: set,
            keyframes: keyed
        });
    });

    // ------------------------------------------------------------------
    // ae_set_effect

    Z.register("ae_set_effect", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var effect = AE.findLayerEffect(layer, Z.required(args, "effect", "any"));
        var remove = Z.optional(args, "remove", "boolean", false);
        var enabled = Z.optional(args, "enabled", "boolean", null);
        var name = Z.optional(args, "name", "string", null);
        var params = Z.optional(args, "params", "array", []);
        var ref = {index: effect.propertyIndex, name: effect.name, match_name: effect.matchName};
        var values;
        var changes = [];
        var set = [];
        var i;
        if (remove) {
            if (params.length || enabled !== null || name !== null) {
                throw Z.refuse("INVALID_ARGUMENT", "`remove` deletes the effect; do not combine it with params, enabled or name");
            }
            AE.requireUnlocked(layer);
            ctx.changed();
            effect.remove();
            return Z.applied("Removed effect \"" + ref.name + "\" from \"" + layer.name + "\"", {layer: AE.layerRef(layer), effect: ref, removed: true});
        }
        values = resolveParams(effect, params, "params");
        for (i = 0; i < values.length; i += 1) {
            if (values[i].property.numKeys > 0) {
                throw Z.refuse("INVALID_ARGUMENT", "\"" + values[i].name + "\" is keyframed; change it with ae_animate (property \"Effects/" + effect.name + "/" +
                    values[i].name + "\")");
            }
            if (JSON.stringify(AE.exportValue(values[i].property.value)) !== JSON.stringify(AE.exportValue(values[i].value))) {
                changes.push(values[i]);
            }
        }
        if (!changes.length && (enabled === null || enabled === effect.enabled) && (name === null || name === effect.name)) {
            return Z.unchanged("Effect \"" + effect.name + "\" on \"" + layer.name + "\" already has these settings", {layer: AE.layerRef(layer), effect: ref});
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        for (i = 0; i < changes.length; i += 1) {
            changes[i].property.setValue(changes[i].value);
            set.push(changes[i].name);
        }
        if (enabled !== null && enabled !== effect.enabled) {
            effect.enabled = enabled;
            set.push(enabled ? "turned on" : "turned off");
        }
        if (name !== null && name !== effect.name) {
            effect.name = name;
            set.push("renamed \"" + name + "\"");
        }
        ref.name = effect.name;
        return Z.applied("Changed effect \"" + effect.name + "\" on \"" + layer.name + "\": " + set.join(", "), {layer: AE.layerRef(layer), effect: ref, changed: set});
    });

    // ------------------------------------------------------------------
    // ae_apply_look

    // TASTE look keys -> Lumetri parameters ("Section/Name", English names) and neutral values.
    var LUMETRI = {
        contrast: {param: "Basic Correction/Contrast", neutral: 0},
        vibrance: {param: "Creative/Vibrance", neutral: 0},
        temperature: {param: "Basic Correction/Temperature", neutral: 0},
        tint: {param: "Basic Correction/Tint", neutral: 0},
        fade: {param: "Creative/Faded Film", neutral: 0},
        saturation: {param: "Basic Correction/Saturation", neutral: 100},
        exposure: {param: "Basic Correction/Exposure", neutral: 0},
        vignette: {param: "Vignette/Amount", neutral: 0}
    };

    // Color Balance (-100..100) for the teal-orange split tone at strength 1.
    var SPLIT_TONE = [
        {param: "Shadow Red Balance", match: "ADBE Color Balance 2-0001", value: -20},
        {param: "Shadow Green Balance", match: "ADBE Color Balance 2-0002", value: 6},
        {param: "Shadow Blue Balance", match: "ADBE Color Balance 2-0003", value: 20},
        {param: "Highlight Red Balance", match: "ADBE Color Balance 2-0007", value: 20},
        {param: "Highlight Green Balance", match: "ADBE Color Balance 2-0008", value: 6},
        {param: "Highlight Blue Balance", match: "ADBE Color Balance 2-0009", value: -20}
    ];

    function installed(matchName) {
        var effects = AE.installedEffects();
        var i;
        for (i = 0; i < effects.length; i += 1) {
            if (effects[i].matchName === matchName) {
                return true;
            }
        }
        return false;
    }

    function clampToProperty(property, value) {
        var out = value;
        if (property.hasMin) {
            out = Math.max(property.minValue, out);
        }
        if (property.hasMax) {
            out = Math.min(property.maxValue, out);
        }
        return out;
    }

    function findLookLayer(comp) {
        var layer;
        var i;
        for (i = 1; i <= comp.numLayers; i += 1) {
            layer = comp.layer(i);
            if (layer instanceof AVLayer && layer.adjustmentLayer && layer.comment === LOOK_LAYER_MARK) {
                return layer;
            }
        }
        return null;
    }

    Z.register("ae_apply_look", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var look = Z.oneOf("look", Z.required(args, "look", "string"), Object.keys(TASTE.color.looks));
        var strength = Z.inRange("strength", Z.optional(args, "strength", "number", TASTE.color.lookStrength), 0, 1);
        var target = Z.has(args, "layer") && args.layer !== null ? AE.findLayer(comp, args.layer) : null;
        var spec = TASTE.color.looks[look];
        var layer = target || findLookLayer(comp);
        var created = false;
        var lumetri;
        var balance;
        var values = [];
        var keys = Object.keys(spec);
        var property;
        var value;
        var i;
        if (!installed("ADBE Lumetri")) {
            throw Z.refuse("UNSUPPORTED", "Lumetri Color is not available in this After Effects");
        }
        if (look === "teal-orange" && !installed("ADBE Color Balance 2")) {
            throw Z.refuse("UNSUPPORTED", "Color Balance is not available in this After Effects (teal-orange needs it)");
        }
        if (target) {
            AE.effectStack(target);
            AE.requireUnlocked(target);
        } else if (layer) {
            AE.requireUnlocked(layer);
        }
        ctx.changed();
        if (!layer) {
            layer = comp.layers.addSolid([1, 1, 1], "Zenvi Look", comp.width, comp.height, comp.pixelAspect);
            layer.adjustmentLayer = true;
            layer.comment = LOOK_LAYER_MARK;
            layer.startTime = 0;
            layer.inPoint = 0;
            layer.outPoint = comp.duration;
            created = true;
        }
        AE.removeEffectsNamed(layer, LOOK_EFFECT);
        AE.removeEffectsNamed(layer, SPLIT_TONE_EFFECT);
        if (!target) {
            layer.name = "Zenvi Look (" + look + ")";
        }
        lumetri = AE.addEffect(layer, "ADBE Lumetri", LOOK_EFFECT);
        for (i = 0; i < keys.length; i += 1) {
            if (!Z.has(LUMETRI, keys[i])) {
                continue;
            }
            property = AE.findEffectParam(lumetri, LUMETRI[keys[i]].param) || AE.findEffectParam(lumetri, LUMETRI[keys[i]].param.split("/")[1]);
            if (!property) {
                ctx.warn("Lumetri Color has no \"" + LUMETRI[keys[i]].param + "\" here; skipped " + keys[i]);
                continue;
            }
            // bw-contrast is black and white at any strength; strength scales its contrast only.
            value = look === "bw-contrast" && keys[i] === "saturation" ? 0 : LUMETRI[keys[i]].neutral + spec[keys[i]] * strength;
            value = clampToProperty(property, Math.round(value * 1000) / 1000);
            property.setValue(value);
            values.push({param: LUMETRI[keys[i]].param, value: value});
        }
        if (look === "teal-orange") {
            balance = AE.addEffect(layer, "ADBE Color Balance 2", SPLIT_TONE_EFFECT);
            for (i = 0; i < SPLIT_TONE.length; i += 1) {
                property = AE.findEffectParam(balance, SPLIT_TONE[i].param) || AE.findEffectParam(balance, SPLIT_TONE[i].match);
                if (!property) {
                    ctx.warn("Color Balance has no \"" + SPLIT_TONE[i].param + "\" here; skipped it");
                    continue;
                }
                value = Math.round(SPLIT_TONE[i].value * strength * 100) / 100;
                property.setValue(value);
                values.push({param: SPLIT_TONE_EFFECT + "/" + SPLIT_TONE[i].param, value: value});
            }
            property = AE.findEffectParam(balance, "Preserve Luminosity");
            if (property) {
                property.setValue(1);
            }
        }
        return Z.applied("Applied the " + look + " look at " + Math.round(strength * 100) + " % to " +
            (target ? "\"" + layer.name + "\"" : (created ? "a new adjustment layer" : "the Zenvi Look adjustment layer")) + " in \"" + comp.name + "\"", {
            layer: AE.layerRef(layer),
            look: look,
            strength: strength,
            created_layer: created,
            effects: AE.effectsJson(layer),
            values: values
        });
    });
}(ZenviLink));
