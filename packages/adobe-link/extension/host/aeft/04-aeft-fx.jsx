// Zenvi Link: After Effects effect helpers (ZenviLink.ae): installed effects,
// effect parameters by name, adding and finding effects on a layer.
//
// Adding a property can invalidate references to its siblings in After
// Effects, so the helpers re-fetch an effect by index after adding it.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;

    function lower(text) {
        return String(text).toLowerCase();
    }

    /** app.effects as [{displayName, matchName, category, version}] without nameless entries. */
    AE.installedEffects = function () {
        var list = app.effects;
        var out = [];
        var i;
        for (i = 0; i < list.length; i += 1) {
            if (list[i].displayName) {
                out.push(list[i]);
            }
        }
        return out;
    };

    /**
     * An installed effect by match name, exact display name (any case), or a
     * unique display-name prefix / substring. Refuses NOT_FOUND with the
     * closest names, or INVALID_ARGUMENT when the fuzzy match is ambiguous.
     */
    AE.findEffectDef = function (name) {
        var effects = AE.installedEffects();
        var wanted = lower(name);
        var prefix = [];
        var contains = [];
        var i;
        var display;
        for (i = 0; i < effects.length; i += 1) {
            if (effects[i].matchName === name) {
                return effects[i];
            }
        }
        for (i = 0; i < effects.length; i += 1) {
            display = lower(effects[i].displayName);
            if (display === wanted) {
                return effects[i];
            }
            if (display.indexOf(wanted) === 0) {
                prefix.push(effects[i]);
            } else if (display.indexOf(wanted) > 0 || lower(effects[i].matchName).indexOf(wanted) >= 0) {
                contains.push(effects[i]);
            }
        }
        if (prefix.length === 1) {
            return prefix[0];
        }
        if (prefix.length === 0 && contains.length === 1) {
            return contains[0];
        }
        if (prefix.length > 1 || contains.length > 1) {
            throw Z.refuse("INVALID_ARGUMENT", "\"" + name + "\" matches several effects: " +
                Z.map(prefix.concat(contains).slice(0, 8), function (fx) { return fx.displayName + " (" + fx.matchName + ")"; }).join(", ") +
                "; pass the exact display name or match name");
        }
        throw Z.refuse("NOT_FOUND", "No installed effect is called \"" + name + "\"; search with ae_list_effects");
    };

    function isValueParam(property) {
        return AE.isLeaf(property) && property.propertyValueType !== PropertyValueType.NO_VALUE;
    }

    /** Visit an effect's parameters in order (nested groups too): fn(property) returns true to stop. */
    function walk(group, fn) {
        var property;
        var i;
        for (i = 1; i <= group.numProperties; i += 1) {
            property = group.property(i);
            if (fn(property)) {
                return true;
            }
            if (property.propertyType !== PropertyType.PROPERTY && walk(property, fn)) {
                return true;
            }
        }
        return false;
    }

    /**
     * A parameter of `effect` by display name (any case) or match name; for
     * names that repeat (Lumetri's two Saturations) "Section/Name" picks the
     * first one after the section's group marker. null when missing.
     */
    AE.findEffectParam = function (effect, key) {
        var wanted = lower(key);
        var found = null;
        var slash = key.lastIndexOf("/");
        var section;
        var name;
        var inSection = false;
        walk(effect, function (property) {
            if (isValueParam(property) && (lower(property.name) === wanted || property.matchName === key)) {
                found = property;
                return true;
            }
            return false;
        });
        if (found || slash <= 0) {
            return found;
        }
        section = lower(key.slice(0, slash));
        name = lower(key.slice(slash + 1));
        walk(effect, function (property) {
            if (lower(property.name) === section && !isValueParam(property)) {
                inSection = true;
            } else if (inSection && isValueParam(property) && lower(property.name) === name) {
                found = property;
                return true;
            }
            return false;
        });
        return found;
    };

    /** "Blurriness, Blur Dimensions, ..." for refusals. */
    AE.effectParamNames = function (effect) {
        var names = [];
        walk(effect, function (property) {
            if (isValueParam(property)) {
                names.push(property.name);
            }
            return names.length >= 40;
        });
        return names.join(", ");
    };

    /** A parameter this extension relies on, by match name with the English display name as fallback. */
    AE.effectParam = function (effect, matchName, displayName) {
        var param = AE.findEffectParam(effect, matchName) || AE.findEffectParam(effect, displayName);
        if (!param) {
            throw Z.fail("HOST_ERROR", effect.name + " has no parameter \"" + displayName + "\" (" + matchName + ") in this After Effects");
        }
        return param;
    };

    /** The layer's effect stack, or a refusal for layers without one (cameras, lights). */
    AE.effectStack = function (layer) {
        var parade = /** @type {PropertyGroup} */ (layer.property("ADBE Effect Parade"));
        if (!parade) {
            throw Z.refuse("UNSUPPORTED", "Layer \"" + layer.name + "\" (" + AE.layerType(layer) + ") cannot have effects");
        }
        return parade;
    };

    /** Add an effect by match name, name it, and return a fresh reference. */
    AE.addEffect = function (layer, matchName, name) {
        var effect = AE.effectStack(layer).addProperty(matchName);
        var index = effect.propertyIndex;
        if (name) {
            AE.effectStack(layer).property(index).name = name;
        }
        return /** @type {PropertyGroup} */ (AE.effectStack(layer).property(index));
    };

    /** Remove effects with this instance name; returns how many. */
    AE.removeEffectsNamed = function (layer, name) {
        var parade = AE.effectStack(layer);
        var removed = 0;
        var i;
        for (i = parade.numProperties; i >= 1; i -= 1) {
            if (parade.property(i).name === name) {
                parade.property(i).remove();
                removed += 1;
            }
        }
        return removed;
    };

    /** An effect on a layer by 1-based index, instance name (any case) or match name. */
    AE.findLayerEffect = function (layer, ref) {
        var parade = AE.effectStack(layer);
        var wanted;
        var effect;
        var i;
        if (typeof ref === "number") {
            if (Math.floor(ref) !== ref || ref < 1 || ref > parade.numProperties) {
                throw Z.refuse("NOT_FOUND", "Layer \"" + layer.name + "\" has " + Z.plural(parade.numProperties, "effect") + "; there is no effect " + ref);
            }
            return /** @type {PropertyGroup} */ (parade.property(ref));
        }
        if (typeof ref !== "string" || !ref.length) {
            throw Z.refuse("INVALID_ARGUMENT", "`effect` must be an index, an instance name or a match name");
        }
        wanted = lower(ref);
        for (i = 1; i <= parade.numProperties; i += 1) {
            effect = /** @type {PropertyGroup} */ (parade.property(i));
            if (lower(effect.name) === wanted || effect.matchName === ref) {
                return effect;
            }
        }
        throw Z.refuse("NOT_FOUND", "Layer \"" + layer.name + "\" has no effect \"" + ref + "\"" +
            (parade.numProperties ? "; it has: " + AE.childNames(parade) : ""));
    };

    /** [{index, name, match_name, enabled}] for receipts. */
    AE.effectsJson = function (layer) {
        var parade = /** @type {PropertyGroup} */ (layer.property("ADBE Effect Parade"));
        var out = [];
        var effect;
        var i;
        if (!parade) {
            return out;
        }
        for (i = 1; i <= parade.numProperties; i += 1) {
            effect = parade.property(i);
            out.push({index: i, name: effect.name, match_name: effect.matchName, enabled: effect.enabled});
        }
        return out;
    };
}(ZenviLink));
