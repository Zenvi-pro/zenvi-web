// Zenvi Link: After Effects shared helpers (ZenviLink.ae): enums by name,
// TASTE lookups, safe areas, folders, files and time formatting.
//
// DOM objects are compared by id or index, never with ===: After Effects
// hands out a new wrapper object each time a script asks for one.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    // ------------------------------------------------------------------
    // Enums by name. Members missing in this After Effects refuse UNSUPPORTED.

    function enumValue(enumObject, key, name, what) {
        var value = enumObject ? enumObject[key] : undefined;
        if (value === undefined || value === null) {
            throw Z.refuse("UNSUPPORTED", what + " \"" + name + "\" is not available in After Effects " + app.version);
        }
        return value;
    }

    function enumName(enumObject, names, keyOf, value) {
        var i;
        for (i = 0; i < names.length; i += 1) {
            if (enumObject[keyOf(names[i])] === value) {
                return names[i];
            }
        }
        return null;
    }

    function upperKey(name) {
        return name.toUpperCase().replace(/-/g, "_");
    }

    AE.BLEND_MODES = [
        "normal", "dissolve", "dancing-dissolve", "darken", "multiply", "color-burn", "classic-color-burn", "linear-burn",
        "darker-color", "add", "lighten", "screen", "color-dodge", "classic-color-dodge", "linear-dodge", "lighter-color",
        "overlay", "soft-light", "hard-light", "linear-light", "vivid-light", "pin-light", "hard-mix", "difference",
        "classic-difference", "exclusion", "subtract", "divide", "hue", "saturation", "color", "luminosity", "stencil-alpha",
        "stencil-luma", "silhouette-alpha", "silhouette-luma", "alpha-add", "luminescent-premul"
    ];

    // After Effects spells this member SILHOUETE_ALPHA.
    function blendKey(name) {
        return name === "silhouette-alpha" ? "SILHOUETE_ALPHA" : upperKey(name);
    }

    AE.blendModeValue = function (name) {
        Z.oneOf("blend_mode", name, AE.BLEND_MODES);
        return enumValue(BlendingMode, blendKey(name), name, "Blend mode");
    };

    AE.blendModeName = function (value) {
        return enumName(BlendingMode, AE.BLEND_MODES, blendKey, value);
    };

    var TRACK_MATTES = {"alpha": "ALPHA", "alpha-inverted": "ALPHA_INVERTED", "luma": "LUMA", "luma-inverted": "LUMA_INVERTED", "none": "NO_TRACK_MATTE"};
    var TRACK_MATTE_NAMES = ["alpha", "alpha-inverted", "luma", "luma-inverted", "none"];

    AE.trackMatteValue = function (name) {
        Z.oneOf("track_matte.type", name, TRACK_MATTE_NAMES);
        return enumValue(TrackMatteType, TRACK_MATTES[name], name, "Track matte");
    };

    AE.trackMatteName = function (value) {
        return enumName(TrackMatteType, TRACK_MATTE_NAMES, function (name) { return TRACK_MATTES[name]; }, value);
    };

    var QUALITIES = ["best", "draft", "wireframe"];

    AE.qualityValue = function (name) {
        Z.oneOf("quality", name, QUALITIES);
        return enumValue(LayerQuality, upperKey(name), name, "Layer quality");
    };

    AE.qualityName = function (value) {
        return enumName(LayerQuality, QUALITIES, upperKey, value);
    };

    var MASK_MODES = ["add", "subtract", "intersect", "lighten", "darken", "difference", "none"];

    AE.maskModeValue = function (name) {
        Z.oneOf("mode", name, MASK_MODES);
        return enumValue(MaskMode, upperKey(name), name, "Mask mode");
    };

    AE.maskModeName = function (value) {
        return enumName(MaskMode, MASK_MODES, upperKey, value);
    };

    var LIGHT_TYPES = ["parallel", "spot", "point", "ambient"];

    AE.lightTypeValue = function (name) {
        Z.oneOf("light_type", name, LIGHT_TYPES);
        return enumValue(LightType, upperKey(name), name, "Light type");
    };

    var JUSTIFICATIONS = {"left": "LEFT_JUSTIFY", "center": "CENTER_JUSTIFY", "right": "RIGHT_JUSTIFY"};
    var JUSTIFICATION_NAMES = ["left", "center", "right"];

    AE.justificationValue = function (name) {
        Z.oneOf("justification", name, JUSTIFICATION_NAMES);
        return enumValue(ParagraphJustification, JUSTIFICATIONS[name], name, "Justification");
    };

    AE.justificationName = function (value) {
        return enumName(ParagraphJustification, JUSTIFICATION_NAMES, function (name) { return JUSTIFICATIONS[name]; }, value) || "other";
    };

    var INTERPOLATIONS = ["linear", "bezier", "hold"];

    AE.interpolationName = function (value) {
        return enumName(KeyframeInterpolationType, INTERPOLATIONS, upperKey, value);
    };

    // ------------------------------------------------------------------
    // TASTE lookups.

    /**
     * A TASTE {default, range: [lo, hi]} at `intensity` 0-1: 0.5 is the
     * default, 0 and 1 the ends of the range (piecewise linear).
     */
    AE.ranged = function (spec, intensity) {
        var lo = spec.range[0];
        var hi = spec.range[1];
        var mid = spec["default"];
        if (intensity === undefined || intensity === null) {
            return mid;
        }
        if (intensity <= 0.5) {
            return lo + (mid - lo) * (intensity / 0.5);
        }
        return mid + (hi - mid) * ((intensity - 0.5) / 0.5);
    };

    /** TASTE type sizes are for a 1080-pixel short side. */
    AE.typeScale = function (comp) {
        return Math.min(comp.width, comp.height) / TASTE.type.referenceShortSide;
    };

    /** Tall frames (9:16, 2:3) get the social UI insets of TASTE 3. */
    AE.isVertical = function (comp) {
        return comp.height >= comp.width * 1.5;
    };

    /** Title-safe rectangle in comp pixels (TASTE 3). */
    AE.safeArea = function (comp) {
        var w = comp.width;
        var h = comp.height;
        var inset = TASTE.layout.titleSafe;
        var top = h * inset;
        var bottom = h * (1 - inset);
        var vertical = AE.isVertical(comp);
        if (vertical) {
            top = Math.max(top, h * TASTE.layout.verticalTop);
            bottom = Math.min(bottom, h * (1 - TASTE.layout.verticalBottom));
        }
        return {left: w * inset, right: w * (1 - inset), top: top, bottom: bottom, vertical: vertical};
    };

    // ------------------------------------------------------------------
    // Project helpers.

    function sameFolder(a, b) {
        return a && b && a.id === b.id;
    }

    /** A folder at the root of the Project panel with this exact name, or null. */
    AE.findRootFolder = function (name) {
        var project = AE.requireProject();
        var root = project.rootFolder;
        var item;
        var i;
        for (i = 1; i <= project.numItems; i += 1) {
            item = project.item(i);
            if (item instanceof FolderItem && item.name === name && sameFolder(item.parentFolder, root)) {
                return item;
            }
        }
        return null;
    };

    AE.findOrCreateFolder = function (name) {
        return AE.findRootFolder(name) || AE.requireProject().items.addFolder(name);
    };

    /** `name`, or `name 2`, `name 3`... when a comp already has it. */
    AE.uniqueCompName = function (name, ctx) {
        var project = AE.requireProject();
        var taken = {};
        var candidate = name;
        var n = 2;
        var i;
        var item;
        for (i = 1; i <= project.numItems; i += 1) {
            item = project.item(i);
            if (item instanceof CompItem) {
                taken[item.name] = true;
            }
        }
        while (Z.has(taken, candidate)) {
            candidate = name + " " + n;
            n += 1;
        }
        if (candidate !== name && ctx) {
            ctx.warn("A comp is already named \"" + name + "\"; named this one \"" + candidate + "\"");
        }
        return candidate;
    };

    /** Refuse changes to a locked layer (After Effects throws on most of them). */
    AE.requireUnlocked = function (layer) {
        if (layer.locked) {
            throw Z.refuse("INVALID_ARGUMENT", "Layer \"" + layer.name + "\" is locked; unlock it first (ae_set_layer with locked: false)");
        }
    };

    /** Snap a comp time and refuse times past the comp's end. */
    AE.compTime = function (comp, seconds, ctx, label) {
        var snapped;
        if (typeof seconds !== "number" || !isFinite(seconds) || seconds < 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + label + "` must be a time in seconds >= 0");
        }
        snapped = AE.snapTime(comp, seconds, ctx, label);
        if (snapped > comp.duration + 1e-6) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + label + "` " + Z.round(seconds) + " s is after the end of comp \"" + comp.name +
                "\" (" + Z.round(comp.duration) + " s)");
        }
        return snapped;
    };

    // ------------------------------------------------------------------
    // Files.

    AE.ABSOLUTE_PATH = /^(\/|[A-Za-z]:[\\\/]|\\\\[^\\]+\\)/;

    AE.requireAbsolutePath = function (path, key) {
        if (typeof path !== "string" || !AE.ABSOLUTE_PATH.test(path)) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be an absolute path; got " + String(path));
        }
        return path;
    };

    /** Mac and Windows file systems are case-insensitive by default. */
    AE.pathKey = function (path) {
        var key = new File(path).fsName;
        return /^(Macintosh|Windows)/.test(File.fs) ? key.toLowerCase() : key;
    };

    /** A folder under the system temp folder (created when missing). */
    AE.tempFolder = function (name) {
        var base = new Folder(Folder.temp.fsName + "/zenvi-link");
        var folder = new Folder(base.fsName + "/" + name);
        if (!base.exists) {
            base.create();
        }
        if (!folder.exists) {
            folder.create();
        }
        return folder;
    };

    /** A name safe for any file system. */
    AE.safeFileName = function (name) {
        var safe = String(name).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[\s.]+|[\s.]+$/g, "");
        return safe.length ? safe.slice(0, 120) : "untitled";
    };

    function two(n) {
        return (n < 10 ? "0" : "") + n;
    }

    /** "2026-10-04T21:00:00.000Z" (ExtendScript has no toISOString). */
    AE.isoTime = function (date) {
        var ms = date.getUTCMilliseconds();
        return date.getUTCFullYear() + "-" + two(date.getUTCMonth() + 1) + "-" + two(date.getUTCDate()) + "T" +
            two(date.getUTCHours()) + ":" + two(date.getUTCMinutes()) + ":" + two(date.getUTCSeconds()) + "." +
            (ms < 10 ? "00" : (ms < 100 ? "0" : "")) + ms + "Z";
    };

    /** "20261004-210000" in local time, for file names. */
    AE.fileStamp = function (date) {
        return date.getFullYear() + two(date.getMonth() + 1) + two(date.getDate()) + "-" + two(date.getHours()) +
            two(date.getMinutes()) + two(date.getSeconds());
    };

    var NTSC_RATES = [[24000, 1001], [30000, 1001], [48000, 1001], [60000, 1001], [120000, 1001]];

    /** Frame rate as {num, den}: 30 -> 30/1, 29.97 -> 30000/1001. */
    AE.fpsRational = function (fps) {
        var i;
        if (Math.abs(fps - Math.round(fps)) < 0.0005) {
            return {num: Math.round(fps), den: 1};
        }
        for (i = 0; i < NTSC_RATES.length; i += 1) {
            if (Math.abs(fps - NTSC_RATES[i][0] / NTSC_RATES[i][1]) < 0.0005) {
                return {num: NTSC_RATES[i][0], den: NTSC_RATES[i][1]};
            }
        }
        return {num: Math.round(fps * 1000), den: 1000};
    };

    /** The first `max` characters of `text` plus an ellipsis. */
    AE.clip = function (text, max) {
        var value = String(text);
        return value.length > max ? value.slice(0, max - 1) + "\u2026" : value;
    };
}(ZenviLink));
