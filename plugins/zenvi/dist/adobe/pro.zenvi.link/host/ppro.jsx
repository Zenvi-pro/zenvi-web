// Zenvi Link 1.0.0: host script for Premiere Pro. Built from extension/host/{common,ppro}/*.jsx; do not edit.
// ---- common/00-json2.jsx ----
//  json2.js
//  2017-06-12
//  Public Domain.
//  NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.
//
//  Douglas Crockford's json2.js (https://github.com/douglascrockford/JSON-js).
//  ExtendScript is ECMAScript 3 and has no JSON object; this file creates one
//  only if it is missing.
//
//  Zenvi Link change: json2 adds toJSON to Date, Boolean, Number and String
//  prototypes. ES3 cannot make those non-enumerable, and every script in the
//  app's ExtendScript engine would then see them in for-in loops. Here str()
//  converts Dates (ISO 8601 with milliseconds, like ES5) and boxed primitives
//  itself instead; the prototypes are left alone.

/*jslint
    eval, for, this
*/

/*property
    JSON, apply, call, charCodeAt, getUTCDate, getUTCFullYear, getUTCHours,
    getUTCMinutes, getUTCMonth, getUTCSeconds, hasOwnProperty, join,
    lastIndex, length, parse, prototype, push, replace, slice, stringify,
    test, toJSON, toString, valueOf
*/


// Create a JSON object only if one does not already exist. We create the
// methods in a closure to avoid creating global variables.

if (typeof JSON !== "object") {
    JSON = {};
}

(function () {
    "use strict";

    var rx_one = /^[\],:{}\s]*$/;
    var rx_two = /\\(?:["\\\/bfnrt]|u[0-9a-fA-F]{4})/g;
    var rx_three = /"[^"\\\n\r]*"|true|false|null|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?/g;
    var rx_four = /(?:^|:|,)(?:\s*\[)+/g;
    var rx_escapable = /[\\"\u0000-\u001f\u007f-\u009f\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;
    var rx_dangerous = /[\u0000\u00ad\u0600-\u0604\u070f\u17b4\u17b5\u200c-\u200f\u2028-\u202f\u2060-\u206f\ufeff\ufff0-\uffff]/g;

    function f(n) {
        // Format integers to have at least two digits.
        return (n < 10)
            ? "0" + n
            : n;
    }

    function dateJSON(date) {
        var ms = date.getUTCMilliseconds();
        return isFinite(date.valueOf())
            ? (
                date.getUTCFullYear()
                + "-"
                + f(date.getUTCMonth() + 1)
                + "-"
                + f(date.getUTCDate())
                + "T"
                + f(date.getUTCHours())
                + ":"
                + f(date.getUTCMinutes())
                + ":"
                + f(date.getUTCSeconds())
                + "."
                + (ms < 10 ? "00" : (ms < 100 ? "0" : ""))
                + ms
                + "Z"
            )
            : null;
    }

    var gap;
    var indent;
    var meta;
    var rep;


    function quote(string) {

// If the string contains no control characters, no quote characters, and no
// backslash characters, then we can safely slap some quotes around it.
// Otherwise we must also replace the offending characters with safe escape
// sequences.

        rx_escapable.lastIndex = 0;
        return rx_escapable.test(string)
            ? "\"" + string.replace(rx_escapable, function (a) {
                var c = meta[a];
                return typeof c === "string"
                    ? c
                    : "\\u" + ("0000" + a.charCodeAt(0).toString(16)).slice(-4);
            }) + "\""
            : "\"" + string + "\"";
    }


    function str(key, holder) {

// Produce a string from holder[key].

        var i;          // The loop counter.
        var k;          // The member key.
        var v;          // The member value.
        var length;
        var mind = gap;
        var partial;
        var value = holder[key];

// If the value has a toJSON method, call it to obtain a replacement value.

        if (
            value
            && typeof value === "object"
            && typeof value.toJSON === "function"
        ) {
            value = value.toJSON(key);
        } else if (value instanceof Date) {
            value = dateJSON(value);
        } else if (
            value instanceof Boolean
            || value instanceof Number
            || value instanceof String
        ) {
            value = value.valueOf();
        }

// If we were called with a replacer function, then call the replacer to
// obtain a replacement value.

        if (typeof rep === "function") {
            value = rep.call(holder, key, value);
        }

// What happens next depends on the value's type.

        switch (typeof value) {
        case "string":
            return quote(value);

        case "number":

// JSON numbers must be finite. Encode non-finite numbers as null.

            return (isFinite(value))
                ? String(value)
                : "null";

        case "boolean":
        case "null":

// If the value is a boolean or null, convert it to a string. Note:
// typeof null does not produce "null". The case is included here in
// the remote chance that this gets fixed someday.

            return String(value);

// If the type is "object", we might be dealing with an object or an array or
// null.

        case "object":

// Due to a specification blunder in ECMAScript, typeof null is "object",
// so watch out for that case.

            if (!value) {
                return "null";
            }

// Make an array to hold the partial results of stringifying this object value.

            gap += indent;
            partial = [];

// Is the value an array?

            if (Object.prototype.toString.apply(value) === "[object Array]") {

// The value is an array. Stringify every element. Use null as a placeholder
// for non-JSON values.

                length = value.length;
                for (i = 0; i < length; i += 1) {
                    partial[i] = str(i, value) || "null";
                }

// Join all of the elements together, separated with commas, and wrap them in
// brackets.

                v = partial.length === 0
                    ? "[]"
                    : gap
                        ? (
                            "[\n"
                            + gap
                            + partial.join(",\n" + gap)
                            + "\n"
                            + mind
                            + "]"
                        )
                        : "[" + partial.join(",") + "]";
                gap = mind;
                return v;
            }

// If the replacer is an array, use it to select the members to be stringified.

            if (rep && typeof rep === "object") {
                length = rep.length;
                for (i = 0; i < length; i += 1) {
                    if (typeof rep[i] === "string") {
                        k = rep[i];
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (
                                (gap)
                                    ? ": "
                                    : ":"
                            ) + v);
                        }
                    }
                }
            } else {

// Otherwise, iterate through all of the keys in the object.

                for (k in value) {
                    if (Object.prototype.hasOwnProperty.call(value, k)) {
                        v = str(k, value);
                        if (v) {
                            partial.push(quote(k) + (
                                (gap)
                                    ? ": "
                                    : ":"
                            ) + v);
                        }
                    }
                }
            }

// Join all of the member texts together, separated with commas,
// and wrap them in braces.

            v = partial.length === 0
                ? "{}"
                : gap
                    ? "{\n" + gap + partial.join(",\n" + gap) + "\n" + mind + "}"
                    : "{" + partial.join(",") + "}";
            gap = mind;
            return v;
        }
    }

// If the JSON object does not yet have a stringify method, give it one.

    if (typeof JSON.stringify !== "function") {
        meta = {    // table of character substitutions
            "\b": "\\b",
            "\t": "\\t",
            "\n": "\\n",
            "\f": "\\f",
            "\r": "\\r",
            "\"": "\\\"",
            "\\": "\\\\"
        };
        JSON.stringify = function (value, replacer, space) {

// The stringify method takes a value and an optional replacer, and an optional
// space parameter, and returns a JSON text. The replacer can be a function
// that can replace values, or an array of strings that will select the keys.
// A default replacer method can be provided. Use of the space parameter can
// produce text that is more easily readable.

            var i;
            gap = "";
            indent = "";

// If the space parameter is a number, make an indent string containing that
// many spaces.

            if (typeof space === "number") {
                for (i = 0; i < space; i += 1) {
                    indent += " ";
                }

// If the space parameter is a string, it will be used as the indent string.

            } else if (typeof space === "string") {
                indent = space;
            }

// If there is a replacer, it must be a function or an array.
// Otherwise, throw an error.

            rep = replacer;
            if (replacer && typeof replacer !== "function" && (
                typeof replacer !== "object"
                || typeof replacer.length !== "number"
            )) {
                throw new Error("JSON.stringify");
            }

// Make a fake root object containing our value under the key of "".
// Return the result of stringifying the value.

            return str("", {"": value});
        };
    }


// If the JSON object does not yet have a parse method, give it one.

    if (typeof JSON.parse !== "function") {
        JSON.parse = function (text, reviver) {

// The parse method takes a text and an optional reviver function, and returns
// a JavaScript value if the text is a valid JSON text.

            var j;

            function walk(holder, key) {

// The walk method is used to recursively walk the resulting structure so
// that modifications can be made.

                var k;
                var v;
                var value = holder[key];
                if (value && typeof value === "object") {
                    for (k in value) {
                        if (Object.prototype.hasOwnProperty.call(value, k)) {
                            v = walk(value, k);
                            if (v !== undefined) {
                                value[k] = v;
                            } else {
                                delete value[k];
                            }
                        }
                    }
                }
                return reviver.call(holder, key, value);
            }


// Parsing happens in four stages. In the first stage, we replace certain
// Unicode characters with escape sequences. JavaScript handles many characters
// incorrectly, either silently deleting them, or treating them as line endings.

            text = String(text);
            rx_dangerous.lastIndex = 0;
            if (rx_dangerous.test(text)) {
                text = text.replace(rx_dangerous, function (a) {
                    return (
                        "\\u"
                        + ("0000" + a.charCodeAt(0).toString(16)).slice(-4)
                    );
                });
            }

// In the second stage, we run the text against regular expressions that look
// for non-JSON patterns. We are especially concerned with "()" and "new"
// because they can cause invocation, and "=" because it can cause mutation.
// But just to be safe, we want to reject all unexpected forms.

// We split the second stage into 4 regexp operations in order to work around
// crippling inefficiencies in IE's and Safari's regexp engines. First we
// replace the JSON backslash pairs with "@" (a non-JSON character). Second, we
// replace all simple value tokens with "]" characters. Third, we delete all
// open brackets that follow a colon or comma or that begin the text. Finally,
// we look to see that the remaining characters are only whitespace or "]" or
// "," or ":" or "{" or "}". If that is so, then the text is safe for eval.

            if (
                rx_one.test(
                    text
                        .replace(rx_two, "@")
                        .replace(rx_three, "]")
                        .replace(rx_four, "")
                )
            ) {

// In the third stage we use the eval function to compile the text into a
// JavaScript structure. The "{" operator is subject to a syntactic ambiguity
// in JavaScript: it can begin a block or an object literal. We wrap the text
// in parens to eliminate the ambiguity.

                j = eval("(" + text + ")");

// In the optional fourth stage, we recursively walk the new structure, passing
// each name/value pair to a reviver function for possible transformation.

                return (typeof reviver === "function")
                    ? walk({"": j}, "")
                    : j;
            }

// If the text is not JSON parseable, then a SyntaxError is thrown.

            throw new SyntaxError("JSON.parse");
        };
    }
}());
// ---- common/01-polyfills.jsx ----
// Zenvi Link: ES5 statics ExtendScript (ECMAScript 3) lacks and the host
// scripts use. Each is defined only when missing.
//
// Nothing here touches a prototype. Every CEP extension in the app shares one
// ExtendScript engine, ES3 cannot make a property non-enumerable, and a new
// member on Array.prototype or String.prototype would show up in every other
// script's for-in loops (`for (i in comp.selectedLayers)`). Use
// ZenviLink.indexOf / trim / each / map / filter instead of
// [].indexOf, "".trim(), forEach, map and filter.

if (!Array.isArray) {
    Array.isArray = function (value) {
        return Object.prototype.toString.call(value) === "[object Array]";
    };
}

if (!Object.keys) {
    Object.keys = function (object) {
        var keys = [];
        var key;
        if (object === null || (typeof object !== "object" && typeof object !== "function")) {
            throw new TypeError("Object.keys called on a non-object");
        }
        for (key in object) {
            if (Object.prototype.hasOwnProperty.call(object, key)) {
                keys.push(key);
            }
        }
        return keys;
    };
}

if (!Date.now) {
    Date.now = function () {
        return new Date().getTime();
    };
}
// ---- common/10-zenvi.jsx ----
// Zenvi Link host runtime (ExtendScript, ECMAScript 3), shared by After
// Effects and Premiere Pro.
//
// The extension's server calls ZenviLink.dispatch(name, argsJson) through CEP
// evalScript. dispatch runs the registered tool and always returns a
// contract-3 host receipt (SPEC 3.3) as a JSON string: refusals and script
// errors become receipts too, never uncaught exceptions.
//
// A tool, end to end (see packages/adobe-link/README.md, "Adding a host tool"):
//
//   ZenviLink.register("ae_rename_comp", function (args, ctx) {
//       var comp = ZenviLink.ae.findComp(args.comp);           // refuses NOT_FOUND / NO_ACTIVE_COMP
//       var name = ZenviLink.required(args, "name", "string");  // refuses INVALID_ARGUMENT
//       if (comp.name === name) {
//           return ZenviLink.unchanged("Comp is already named \"" + name + "\"", {comp_id: comp.id});
//       }
//       ctx.changed();                                          // the first mutation follows
//       comp.name = name;
//       return ZenviLink.applied("Renamed comp " + comp.id + " to \"" + name + "\"", {comp_id: comp.id});
//   });
//
// Title and mutating-ness come from the catalog (ZenviLink.CATALOG, injected
// by the build); mutating tools run inside one undo group in After Effects.
//
// ES3 only: no let/const, arrow functions, template strings, trailing commas,
// getters/setters, or reserved words as property names (write obj["in"]).
// Sources stay ASCII: use \u escapes for other characters in strings.
// No prototype polyfills (the engine is shared with other extensions): use
// ZenviLink.indexOf(list, value) and ZenviLink.trim(text), not [].indexOf
// or "".trim().

// State that must survive the bundle being evaluated again: CEP evaluates the
// manifest's ScriptPath again when the panel opens, which rebuilds ZenviLink
// (fresh registry, same tools). Long-lived data (render jobs, the configured
// temp folder) lives on ZenviLink.state, which is this global. Re-declaring a
// global var does not reset it.
var ZenviLinkState;
if (!ZenviLinkState || typeof ZenviLinkState !== "object") {
    ZenviLinkState = {};
}

var ZenviLink = (function () {
    var Z = {};
    var registry = {};
    var names = [];

    /** Survives re-evaluation of the host script; keep long-lived registries here. */
    Z.state = ZenviLinkState;
    Z.state.loads = (Z.state.loads || 0) + 1;
    if (!Z.state.config) {
        Z.state.config = {};
    }

    // Set by the build's generated block (src/host-bundle.ts).
    Z.version = "0.0.0-dev";
    Z.TASTE = {};
    Z.CATALOG = {};

    Z.protocol = 1;
    Z.contract = 3;

    // Set by the app core script (aeft/00-aeft-core.jsx, ppro/00-ppro-core.jsx).
    Z.host = null;
    Z.adapter = {
        // undoSteps reported for an applied mutating call that does not say; null = unknown.
        undoStepsWhenApplied: null,
        runMutating: function (title, fn) {
            return fn();
        },
        partialChangeWarning: function (title) {
            return "The call failed after it had started changing the project (" + title + ").";
        },
        info: function () {
            return {};
        }
    };

    Z.ERROR_CODES = [
        "INVALID_ARGUMENT", "NOT_FOUND", "NO_PROJECT", "NO_ACTIVE_COMP", "NO_ACTIVE_SEQUENCE",
        "UNSUPPORTED", "HOST_ERROR", "TIMEOUT", "BUSY"
    ];

    // ------------------------------------------------------------------
    // Small utilities (ES3 has no indexOf/trim/forEach/map/filter on the
    // prototypes, and Zenvi Link adds none; see 01-polyfills.jsx).

    function has(object, key) {
        return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key);
    }
    Z.has = has;

    Z.isArray = function (value) {
        return Object.prototype.toString.call(value) === "[object Array]";
    };

    /**
     * True when a DOM object has member `name`: feature detection that works for
     * host methods, which ExtendScript may report as typeof "object", so never
     * test typeof === "function" on DOM members. Reading the member must not throw.
     */
    Z.hasMethod = function (object, name) {
        try {
            return object !== null && object !== undefined && object[name] !== undefined && object[name] !== null;
        } catch (error) {
            return false;
        }
    };

    Z.isObject = function (value) {
        return value !== null && typeof value === "object" && !Z.isArray(value);
    };

    /** Index of `value` in an array (===), or -1. */
    Z.indexOf = function (list, value) {
        var i;
        for (i = 0; i < list.length; i += 1) {
            if (list[i] === value) {
                return i;
            }
        }
        return -1;
    };

    /** `text` without leading and trailing whitespace. */
    Z.trim = function (text) {
        return String(text).replace(/^[\s\u00a0\ufeff]+|[\s\u00a0\ufeff]+$/g, "");
    };

    Z.each = function (list, fn) {
        var i;
        for (i = 0; i < list.length; i += 1) {
            fn(list[i], i);
        }
    };

    Z.map = function (list, fn) {
        var out = [];
        var i;
        for (i = 0; i < list.length; i += 1) {
            out.push(fn(list[i], i));
        }
        return out;
    };

    Z.filter = function (list, fn) {
        var out = [];
        var i;
        for (i = 0; i < list.length; i += 1) {
            if (fn(list[i], i)) {
                out.push(list[i]);
            }
        }
        return out;
    };

    /** Round to `digits` decimals (default 3) for receipts and summaries. */
    Z.round = function (value, digits) {
        var factor = Math.pow(10, digits === undefined ? 3 : digits);
        return Math.round(value * factor) / factor;
    };

    /** "3 layers", "1 layer". */
    Z.plural = function (count, word, pluralWord) {
        return count + " " + (count === 1 ? word : (pluralWord || word + "s"));
    };

    // ------------------------------------------------------------------
    // Failures. `throw ZenviLink.refuse(code, message)` for bad arguments and
    // unmet preconditions; `throw ZenviLink.fail(code, message)` for host
    // failures. Any other exception becomes HOST_ERROR.

    function failure(status, code, message) {
        var error = new Error(String(message));
        error.zenviStatus = status;
        error.zenviCode = code;
        return error;
    }

    Z.refuse = function (code, message) {
        return failure("refused", code, message);
    };

    Z.fail = function (code, message) {
        return failure("error", code, message);
    };

    // ------------------------------------------------------------------
    // Results. Tools return exactly one of these; dispatch adds contract,
    // tool, host, warnings and undoSteps.

    function result(status, summary, data, undoSteps) {
        return {
            zenviResult: true,
            status: status,
            summary: String(summary),
            data: data === undefined || data === null ? {} : data,
            undoSteps: undoSteps
        };
    }

    /** Read-only tools. */
    Z.ok = function (summary, data) {
        return result("ok", summary, data, 0);
    };

    /** Mutating tools that changed something. undoSteps defaults per host (After Effects: 1). */
    Z.applied = function (summary, data, undoSteps) {
        return result("applied", summary, data, undoSteps);
    };

    /** Mutating tools that found nothing to change (no undo step). */
    Z.unchanged = function (summary, data) {
        return result("unchanged", summary, data, 0);
    };

    // ------------------------------------------------------------------
    // Arguments. The host server already validated them against the catalog
    // schema and filled schema defaults; these helpers read them with the
    // right type and refuse INVALID_ARGUMENT otherwise (for direct callers
    // such as scripts and tests, and for domain checks the schema cannot say).

    function typeName(value) {
        if (value === null) {
            return "null";
        }
        return Z.isArray(value) ? "array" : typeof value;
    }

    function matchesType(value, type) {
        switch (type) {
        case "any":
            return true;
        case "integer":
            return typeof value === "number" && isFinite(value) && Math.floor(value) === value;
        case "number":
            return typeof value === "number" && isFinite(value);
        case "array":
            return Z.isArray(value);
        case "object":
            return Z.isObject(value);
        default:
            return typeof value === type;
        }
    }

    function checked(key, value, type) {
        if (!matchesType(value, type || "any")) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be " + (type === "integer" || type === "array" || type === "object" ? "an " : "a ") + type + ", got " + typeName(value));
        }
        return value;
    }

    function absent(args, key) {
        return !has(args, key) || args[key] === null || args[key] === undefined;
    }

    /** args[key], which must be present and of `type` (string, number, integer, boolean, object, array, any). */
    Z.required = function (args, key, type) {
        if (absent(args, key)) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` is required");
        }
        return checked(key, args[key], type);
    };

    /** args[key] when present (null counts as absent), else `fallback`. */
    Z.optional = function (args, key, type, fallback) {
        if (absent(args, key)) {
            return fallback;
        }
        return checked(key, args[key], type);
    };

    /** `value` when it is one of `allowed`. */
    Z.oneOf = function (key, value, allowed) {
        if (Z.indexOf(allowed, value) < 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be one of " + allowed.join(", ") + "; got " + String(value));
        }
        return value;
    };

    /** `value` when it is a finite number in [min, max] (null/undefined bound = open). */
    Z.inRange = function (key, value, min, max) {
        var lowOk = min === null || min === undefined || value >= min;
        var highOk = max === null || max === undefined || value <= max;
        if (typeof value !== "number" || !isFinite(value) || !lowOk || !highOk) {
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a number" +
                (min !== null && min !== undefined ? " >= " + min : "") +
                (max !== null && max !== undefined ? (min !== null && min !== undefined ? " and" : "") + " <= " + max : "") +
                "; got " + String(value));
        }
        return value;
    };

    // ------------------------------------------------------------------
    // Time and colour, shared by both hosts.

    /**
     * Snap `seconds` to the frame grid of `fps`. Adds a warning to ctx when the
     * value moved by half a millisecond or more (TASTE 1: frame-exact times).
     */
    Z.snapToFrame = function (seconds, fps, ctx, label) {
        var frame = Math.round(seconds * fps);
        var snapped = frame / fps;
        if (ctx && Math.abs(snapped - seconds) >= 0.0005) {
            ctx.warn("Snapped " + (label || "time") + " " + Z.round(seconds) + " s to the frame grid: " +
                Z.round(snapped) + " s (frame " + frame + " at " + Z.round(fps) + " fps)");
        }
        return snapped;
    };

    Z.color = {
        /** "#RRGGBB" or [r, g, b] (0-1) -> [r, g, b] (0-1). */
        toRgb: function (value, key) {
            var match;
            if (typeof value === "string") {
                match = /^#([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})([0-9A-Fa-f]{2})$/.exec(value);
                if (match) {
                    return [parseInt(match[1], 16) / 255, parseInt(match[2], 16) / 255, parseInt(match[3], 16) / 255];
                }
            } else if (Z.isArray(value) && value.length === 3 &&
                    matchesType(value[0], "number") && matchesType(value[1], "number") && matchesType(value[2], "number") &&
                    value[0] >= 0 && value[0] <= 1 && value[1] >= 0 && value[1] <= 1 && value[2] >= 0 && value[2] <= 1) {
                return [value[0], value[1], value[2]];
            }
            throw Z.refuse("INVALID_ARGUMENT", "`" + (key || "color") + "` must be \"#RRGGBB\" or [r, g, b] with channels 0-1");
        },
        /** [r, g, b] (0-1) -> "#RRGGBB". */
        toHex: function (rgb) {
            var out = "#";
            var i;
            var channel;
            for (i = 0; i < 3; i += 1) {
                channel = Math.max(0, Math.min(255, Math.round(rgb[i] * 255))).toString(16).toUpperCase();
                out += channel.length === 1 ? "0" + channel : channel;
            }
            return out;
        }
    };

    // ------------------------------------------------------------------
    // Settings from the server, and the temp folder.

    /**
     * Settings the server passes once the host script is loaded, as a JSON
     * string: {temp_dir}. Kept on ZenviLink.state (they survive the script
     * being evaluated again). Returns the settings as a JSON string.
     */
    Z.configure = function (json) {
        var settings = typeof json === "string" ? JSON.parse(json) : json;
        var key;
        for (key in settings) {
            if (has(settings, key)) {
                Z.state.config[key] = settings[key];
            }
        }
        return stringify({ok: true, config: Z.state.config});
    };

    /**
     * Zenvi Link's temp folder (the server's choice, else <Folder.temp>/zenvi-link),
     * created if missing. Frame captures go here: the server deletes a capture
     * once it has sent it, and deletes nothing outside this folder.
     */
    Z.tempDir = function () {
        var folder = new Folder(Z.state.config.temp_dir || (Folder.temp.fsName + "/zenvi-link"));
        if (!folder.exists) {
            folder.create();
        }
        return folder.fsName;
    };

    /** A new file path in the temp folder: <prefix>-<time>-<random>.<extension>. */
    Z.tempFile = function (prefix, extension) {
        return Z.tempDir() + "/" + (prefix || "zenvi") + "-" + new Date().getTime() + "-" +
            Math.floor(Math.random() * 1000000000) + "." + (extension || "tmp");
    };

    // ------------------------------------------------------------------
    // Registry and dispatch.

    /**
     * Register the implementation of catalog tool `name`. options (rarely
     * needed): {mutating, undoTitle} override the catalog's readOnlyHint and
     * title. {mutating: false} keeps a tool that changes the project out of the
     * dispatch undo group, for tools that must not run inside one (After
     * Effects: undo itself, saving, rendering); such a tool reports its own
     * undoSteps (null when it does not say).
     */
    Z.register = function (name, fn, options) {
        var meta;
        var opts = options || {};
        if (typeof name !== "string" || !/^(ae|premiere)_[a-z0-9_]+$/.test(name)) {
            throw new Error("ZenviLink.register: bad tool name " + name);
        }
        if (typeof fn !== "function") {
            throw new Error("ZenviLink.register: " + name + " needs a function");
        }
        if (has(registry, name)) {
            throw new Error("ZenviLink.register: " + name + " is registered twice");
        }
        meta = has(Z.CATALOG, name) ? Z.CATALOG[name] : {};
        registry[name] = {
            name: name,
            fn: fn,
            mutating: has(opts, "mutating") ? opts.mutating === true : meta.mutating === true,
            title: opts.undoTitle || meta.title || name
        };
        names.push(name);
    };

    function failureOutcome(status, code, message) {
        return {
            status: status,
            code: Z.indexOf(Z.ERROR_CODES, code) >= 0 ? code : "HOST_ERROR",
            message: String(message)
        };
    }

    function outcomeFor(error) {
        var outcome;
        if (error && error.zenviStatus) {
            return failureOutcome(error.zenviStatus, error.zenviCode, error.message);
        }
        outcome = failureOutcome("error", "HOST_ERROR", error && error.message ? error.message : String(error));
        // ExtendScript errors carry the line of the concatenated host script.
        if (error && typeof error.line === "number") {
            outcome.message += " (host script line " + error.line + ")";
            outcome.line = error.line;
        }
        return outcome;
    }

    function toAscii(text) {
        return text.replace(/[\u0080-\uffff]/g, function (c) {
            return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
        });
    }

    // JSON text with every non-ASCII character escaped, so evalScript's string
    // transport cannot mangle it.
    function stringify(value) {
        try {
            return toAscii(JSON.stringify(value));
        } catch (error) {
            return toAscii(JSON.stringify({
                contract: Z.contract,
                status: "error",
                tool: value && value.tool ? String(value.tool) : null,
                host: Z.host,
                summary: "Error: the result could not be serialized: " + String(error && error.message ? error.message : error),
                data: {},
                warnings: [],
                undoSteps: 0,
                error: {code: "HOST_ERROR", message: "the result could not be serialized"}
            }));
        }
    }
    Z.stringify = stringify;

    function newContext(name) {
        // undoSteps: a tool that knows how many undo steps it left (also when it
        // fails, e.g. render tools outside the undo group) sets ctx.undoSteps = n.
        var ctx = {tool: name, warnings: [], didChange: false, undoSteps: undefined};
        /** Add a warning to the receipt (snapping, fallbacks, partial results). */
        ctx.warn = function (message) {
            ctx.warnings.push(String(message));
        };
        /** Call right before the first change, so a later failure reports it honestly. */
        ctx.changed = function () {
            ctx.didChange = true;
        };
        return ctx;
    }

    /** ctx.undoSteps when the tool set a number (or null for unknown), else undefined. */
    function reportedUndoSteps(ctx) {
        var value = ctx.undoSteps;
        return value === null || (typeof value === "number" && isFinite(value)) ? value : undefined;
    }

    function finish(ctx, entry, outcome) {
        var failed = outcome.status === "refused" || outcome.status === "error";
        var reported = reportedUndoSteps(ctx);
        var message;
        var receipt = {
            contract: Z.contract,
            status: outcome.status,
            tool: ctx.tool,
            host: Z.host,
            summary: outcome.summary,
            data: failed ? {} : outcome.data,
            warnings: ctx.warnings,
            undoSteps: 0
        };
        if (failed) {
            message = outcome.message;
            receipt.summary = /^Error: /.test(message) ? message : "Error: " + message;
            receipt.error = {code: outcome.code, message: message.replace(/^Error: /, "")};
            if (outcome.line !== undefined) {
                receipt.error.line = outcome.line;
            }
            if (ctx.didChange) {
                if (entry && entry.mutating) {
                    receipt.undoSteps = Z.adapter.undoStepsWhenApplied;
                    receipt.warnings.push(Z.adapter.partialChangeWarning(entry.title));
                } else {
                    receipt.undoSteps = null;
                    receipt.warnings.push("The call failed after it had started changing the project; each change it made is its own undo step.");
                }
            }
            if (reported !== undefined) {
                receipt.undoSteps = reported;
            }
        } else if (outcome.status === "applied") {
            // Without an undo group (read-only tools, {mutating: false}) the count is the tool's to say.
            if (outcome.undoSteps !== undefined) {
                receipt.undoSteps = outcome.undoSteps;
            } else if (reported !== undefined) {
                receipt.undoSteps = reported;
            } else {
                receipt.undoSteps = entry && entry.mutating ? Z.adapter.undoStepsWhenApplied : null;
            }
        }
        return stringify(receipt);
    }

    function parseArgs(argsJson) {
        var args;
        if (argsJson === undefined || argsJson === null || argsJson === "") {
            return {};
        }
        try {
            args = JSON.parse(String(argsJson));
        } catch (error) {
            throw Z.refuse("INVALID_ARGUMENT", "Arguments are not valid JSON");
        }
        if (!Z.isObject(args)) {
            throw Z.refuse("INVALID_ARGUMENT", "Arguments must be a JSON object");
        }
        return args;
    }

    /**
     * Run tool `name` with `argsJson` (a JSON object as a string). Returns the
     * receipt as a JSON string, whatever happens.
     */
    Z.dispatch = function (name, argsJson) {
        var ctx = newContext(String(name));
        var entry = has(registry, name) ? registry[name] : null;
        var args;
        var outcome;
        if (!entry) {
            return finish(ctx, null, failureOutcome("refused", "NOT_FOUND",
                "Unknown tool " + name + "; this host has " + (names.length ? names.join(", ") : "no tools")));
        }
        try {
            args = parseArgs(argsJson);
            if (entry.mutating) {
                outcome = Z.adapter.runMutating(entry.title, function () {
                    return entry.fn(args, ctx);
                });
            } else {
                outcome = entry.fn(args, ctx);
            }
        } catch (error) {
            return finish(ctx, entry, outcomeFor(error));
        }
        if (!outcome || outcome.zenviResult !== true) {
            return finish(ctx, entry, failureOutcome("error", "HOST_ERROR",
                name + " returned no receipt (tools return ZenviLink.ok, applied or unchanged)"));
        }
        return finish(ctx, entry, outcome);
    };

    /** Registered tools as a JSON string: [{name, title, mutating}]. */
    Z.listTools = function () {
        return stringify(Z.map(names, function (name) {
            return {name: name, title: registry[name].title, mutating: registry[name].mutating};
        }));
    };

    /** What the server puts in the discovery file, as a JSON string. */
    Z.hostInfo = function () {
        var info;
        try {
            info = Z.adapter.info();
        } catch (error) {
            info = {error: String(error && error.message ? error.message : error)};
        }
        info.host = Z.host;
        info.version = Z.version;
        info.protocol = Z.protocol;
        info.tools = names.length;
        info.loads = Z.state.loads;
        return stringify(info);
    };

    return Z;
}());
// ---- (generated) ----
// Generated by the Zenvi Link build from src/version.ts, src/taste.ts and src/catalog. Do not edit.
ZenviLink.version = "1.0.0";
ZenviLink.TASTE = {"timing":{"micro":{"default":0.27,"range":[0.2,0.35]},"entrance":{"default":0.6,"range":[0.5,0.8]},"exit":{"default":0.4,"range":[0.35,0.5]},"bigMove":{"default":1,"range":[0.8,1.2]},"stagger":{"word":0.06,"line":0.12,"range":[0.04,0.08]},"textHold":{"base":1.5,"perWord":0.3},"lowerThird":{"default":5,"range":[4,6]},"titleCard":{"default":3,"range":[2.5,4]},"crossDissolve":{"default":0.5,"sceneChange":1,"range":[0.5,1]},"dip":{"default":0.8,"range":[0.6,1.2]},"audioFade":{"in":0.25,"out":1,"outRange":[0.5,1.5],"musicEnd":1.5},"jlLead":{"default":0.5,"range":[0.25,0.75]}},"easing":{"default":"smooth","curves":{"smooth":[0.33,0,0.2,1],"out":[0.16,1,0.3,1],"entrance":[0.16,1,0.3,1],"in":[0.7,0,0.84,0],"exit":[0.7,0,0.84,0],"in-out":[0.65,0,0.35,1],"snap":[0.2,0,0,1],"linear":[0,0,1,1]},"overshoot":{"max":0.06,"settle":0.25},"aeInfluence":{"min":0.1,"max":100}},"layout":{"actionSafe":0.05,"titleSafe":0.1,"verticalTop":0.12,"verticalBottom":0.2,"gridColumns":12,"lowerThird":{"baselineLandscape":0.8,"baselineVertical":0.7,"gapOfNameSize":0.25},"slide":{"default":0.04,"range":[0.03,0.06]},"scale":{"entranceFrom":0.92,"holdPushTo":1.04},"kenBurns":{"default":0.04,"range":[0.03,0.06]}},"type":{"families":["Inter","SF Pro Display","Helvetica Neue","Arial"],"postscript":{"headline":["Inter-Bold","SFProDisplay-Bold","HelveticaNeue-Bold","Arial-BoldMT"],"body":["Inter-Regular","SFProDisplay-Regular","HelveticaNeue","ArialMT"]},"weights":{"headline":[700,800],"body":[400,500]},"referenceShortSide":1080,"sizes":{"headline":96,"title":72,"subtitle":44,"lowerThirdName":54,"lowerThirdRole":34,"caption":42},"tracking":{"headline":-0.015,"headlineRange":[-0.02,-0.01],"caps":0.08,"capsRange":[0.06,0.1]},"leading":{"headline":1.1,"body":1.3},"maxLineChars":32,"scrim":{"default":0.45,"range":[0.35,0.55]},"shadow":{"distance":0,"softness":16,"softnessRange":[12,20],"opacity":0.4},"minContrast":4.5},"color":{"palette":{"ink":"#0B0B0F","paper":"#F7F7F5","accent":"#FF5A36","secondary":"#2F6BFF"},"looks":{"clean":{"contrast":5,"vibrance":5},"warm-film":{"temperature":8,"tint":2,"fade":8,"saturation":-6},"teal-orange":{"shadowTint":"teal","highlightTint":"orange","saturation":6},"moody":{"exposure":-0.3,"contrast":12,"saturation":-15,"vignette":-0.8},"bw-contrast":{"saturation":-100,"contrast":25}},"lookStrength":0.6},"editing":{"shotLength":{"talkingHead":[4,8],"broll":[1.5,3],"socialHook":[0.8,1.5]},"endHold":{"default":0.75,"range":[0.5,1]}},"audio":{"dialoguePeakDb":[-12,-6],"lufs":{"social":-16,"broadcast":-23},"musicUnderDialogueDb":[-24,-18],"duck":{"db":8,"dbRange":[6,10],"attack":0.3,"release":0.6}}};
ZenviLink.CATALOG = {"premiere_get_state":{"title":"Premiere Pro state","mutating":false},"premiere_list_items":{"title":"List project items","mutating":false},"premiere_get_sequence":{"title":"Read a sequence","mutating":false},"premiere_capture_frame":{"title":"Capture a frame","mutating":false},"premiere_import_files":{"title":"Import media","mutating":true},"premiere_create_sequence":{"title":"Create a sequence","mutating":true},"premiere_open_sequence":{"title":"Open a sequence","mutating":true},"premiere_place_clip":{"title":"Place a clip","mutating":true},"premiere_edit_clip":{"title":"Edit a clip","mutating":true},"premiere_razor":{"title":"Razor cut","mutating":true},"premiere_set_clip_properties":{"title":"Set clip properties","mutating":true},"premiere_animate":{"title":"Animate a property","mutating":true},"premiere_apply_effect":{"title":"Apply an effect","mutating":true},"premiere_add_transition":{"title":"Add a transition","mutating":true},"premiere_apply_look":{"title":"Apply a colour look","mutating":true},"premiere_add_text":{"title":"Add a title","mutating":true},"premiere_add_marker":{"title":"Add a marker","mutating":true},"premiere_add_captions":{"title":"Add captions from SRT","mutating":true},"premiere_auto_reframe":{"title":"Auto Reframe","mutating":true},"premiere_scene_detect":{"title":"Scene edit detection","mutating":true},"premiere_export":{"title":"Export a sequence","mutating":true},"premiere_export_xml":{"title":"Export FCP XML","mutating":true},"premiere_import_xml":{"title":"Import FCP XML","mutating":true},"premiere_save_project":{"title":"Save the project","mutating":true},"premiere_run_script":{"title":"Run ExtendScript","mutating":true}};
// ---- ppro/00-ppro-core.jsx ----
// Zenvi Link: Premiere Pro host core. The helpers every premiere_* tool uses
// (ZenviLink.ppro), the adapter, and premiere_get_state.
//
// IDs (SPEC 3.3): project items and track items by nodeId, sequences by
// sequenceID, tracks by {kind: "video" | "audio", index} (0-based like the
// DOM). Times are sequence seconds; the DOM counts in ticks.
//
// Undo: Premiere's ExtendScript DOM has no undo grouping; every DOM change is
// its own undo step. The adapter measures how far Premiere's undo stack moved
// during a mutating call (QE qe.project.undoStackIndex(), when this build has
// it) and reports that as undoSteps; otherwise a tool passes the number of
// changes it made to ZenviLink.applied(summary, data, undoSteps).
//
// References for DOM details used here: the Premiere Pro Scripting Guide
// (ppro-scripting.docsforadobe.dev), Adobe's PProPanel sample
// (Adobe-CEP/Samples, PProPanel/jsx/PPRO/Premiere.jsx) and types-for-adobe
// Premiere/24.0. QE DOM details are not documented by Adobe; each use says
// what it relies on (docs/PREMIERE_PRO.md lists them).

(function (Z) {
    var P = {};
    Z.ppro = P;
    Z.host = "premiere";

    /** Premiere's time unit: 254016000000 ticks per second. */
    P.TICKS_PER_SECOND = 254016000000;

    var qeEnabled = false;

    // ------------------------------------------------------------------
    // QE DOM (undocumented; used for razor, effects, transitions, speed,
    // frame export, sequence presets and the undo stack position).

    /** The QE DOM, enabled once. Refuses UNSUPPORTED when this build has none. */
    P.qe = function () {
        if (!qeEnabled) {
            if (!Z.hasMethod(app, "enableQE")) {
                throw Z.refuse("UNSUPPORTED", "This Premiere Pro build has no QE DOM (app.enableQE)");
            }
            app.enableQE();
            qeEnabled = true;
        }
        if (typeof qe === "undefined" || !qe || !qe.project) {
            throw Z.fail("UNSUPPORTED", "The QE DOM did not load (qe.project is missing)");
        }
        return qe;
    };

    /**
     * Premiere's undo stack position (qe.project.undoStackIndex(), which moves
     * by one per undoable step), or null when this build does not report it.
     */
    P.undoIndex = function () {
        var value;
        try {
            if (!Z.hasMethod(app, "enableQE")) {
                return null;
            }
            if (!qeEnabled) {
                app.enableQE();
                qeEnabled = true;
            }
            if (typeof qe === "undefined" || !qe || !qe.project || !Z.hasMethod(qe.project, "undoStackIndex")) {
                return null;
            }
            value = Number(qe.project.undoStackIndex());
        } catch (error) {
            return null;
        }
        return isFinite(value) ? value : null;
    };

    function undoDelta(before) {
        var after;
        if (before === null) {
            return null;
        }
        after = P.undoIndex();
        return after !== null && after > before ? after - before : null;
    }

    Z.adapter = {
        undoStepsWhenApplied: null,
        runMutating: function (title, fn) {
            var before = P.undoIndex();
            var outcome;
            var measured;
            Z.adapter.undoStepsWhenApplied = null;
            try {
                outcome = fn();
            } catch (error) {
                // A failure after a change: report what the undo stack says, else unknown.
                Z.adapter.undoStepsWhenApplied = undoDelta(before);
                throw error;
            }
            if (outcome && outcome.zenviResult === true && outcome.status === "applied") {
                measured = undoDelta(before);
                if (measured !== null) {
                    outcome.undoSteps = measured;
                }
            }
            return outcome;
        },
        partialChangeWarning: function (title) {
            return "The call failed after it had started changing the project (" + title +
                "); Premiere records each change as its own undo step.";
        },
        info: function () {
            return {app_version: String(app.version), project: P.projectPath()};
        }
    };

    // ------------------------------------------------------------------
    // Versions and platform.

    /** Major version of Premiere Pro ("25.2.1" -> 25; 0 when unknown). */
    P.majorVersion = function () {
        var match = /^(\d+)/.exec(String(app.version));
        return match ? parseInt(match[1], 10) : 0;
    };

    /** Refuses UNSUPPORTED naming the feature and the first version that has it. */
    P.requireFeature = function (available, feature, minimum) {
        if (!available) {
            throw Z.refuse("UNSUPPORTED", feature + " is not available in Premiere Pro " + String(app.version) +
                " (it needs Premiere Pro " + minimum + " or later)");
        }
    };

    P.isWindows = function () {
        return String($.os).indexOf("Windows") >= 0 || Folder.fs === "Windows";
    };

    // ------------------------------------------------------------------
    // Project.

    P.projectPath = function () {
        try {
            return app.project && app.project.path ? String(app.project.path) : null;
        } catch (error) {
            // macOS can throw while Premiere shuts down (types-for-adobe Project.path note).
            return null;
        }
    };

    P.requireProject = function () {
        if (!app.project || !app.project.rootItem || (Z.hasMethod(app, "isDocumentOpen") && !app.isDocumentOpen())) {
            throw Z.refuse("NO_PROJECT", "No Premiere Pro project is open");
        }
        return app.project;
    };

    /** ProjectItemType.BIN etc. (numbers; PProPanel compares item.type === 2 for bins). */
    P.itemType = function (name) {
        var fallback = {CLIP: 1, BIN: 2, ROOT: 3, FILE: 4};
        if (typeof ProjectItemType !== "undefined" && ProjectItemType && typeof ProjectItemType[name] === "number") {
            return ProjectItemType[name];
        }
        return fallback[name];
    };

    P.isBin = function (item) {
        return item.type === P.itemType("BIN") || item.type === P.itemType("ROOT");
    };

    /** Children of a bin as an array. */
    P.children = function (item) {
        var list = [];
        var i;
        if (!item || !item.children) {
            return list;
        }
        for (i = 0; i < item.children.numItems; i += 1) {
            list.push(item.children[i]);
        }
        return list;
    };

    /**
     * Depth-first walk from `root` in project panel order. visit(item, depth,
     * binPath) returns false to stop the walk.
     */
    P.walkItems = function (root, visit) {
        var stopped = false;
        function walk(item, depth, path) {
            var kids;
            var i;
            if (stopped) {
                return;
            }
            kids = P.children(item);
            for (i = 0; i < kids.length && !stopped; i += 1) {
                if (visit(kids[i], depth, path) === false) {
                    stopped = true;
                    return;
                }
                if (P.isBin(kids[i])) {
                    walk(kids[i], depth + 1, path ? path + "/" + kids[i].name : String(kids[i].name));
                }
            }
        }
        walk(root, 0, "");
    };

    /** The project item with this nodeId (searched through every bin); refuses NOT_FOUND. */
    P.findProjectItemByNodeId = function (nodeId) {
        var project = P.requireProject();
        var found = null;
        if (project.rootItem.nodeId === nodeId) {
            return project.rootItem;
        }
        P.walkItems(project.rootItem, function (item) {
            if (item.nodeId === nodeId) {
                found = item;
                return false;
            }
            return true;
        });
        if (!found) {
            throw Z.refuse("NOT_FOUND", "No project item has nodeId " + String(nodeId) + " (premiere_list_items lists them)");
        }
        return found;
    };

    /** Bin path segments from "A/B", "\\A\\B" or "/" (root). */
    function binSegments(path) {
        return Z.filter(String(path).replace(/\\/g, "/").split("/"), function (part) {
            return Z.trim(part).length > 0;
        });
    }

    /**
     * A bin by nodeId or by path from the project root ("Footage/Day 1", "/" =
     * root). With `create`, missing bins are created (ctx.changed() first) and
     * counted in `created`. Refuses NOT_FOUND otherwise.
     */
    P.findBin = function (ref, create, ctx, created) {
        var project = P.requireProject();
        var segments;
        var current = project.rootItem;
        var i;
        var j;
        var kids;
        var next;
        var byId = null;
        if (ref === undefined || ref === null || binSegments(ref).length === 0) {
            return current;
        }
        P.walkItems(project.rootItem, function (item) {
            if (item.nodeId === ref && P.isBin(item)) {
                byId = item;
                return false;
            }
            return true;
        });
        if (byId) {
            return byId;
        }
        segments = binSegments(ref);
        for (i = 0; i < segments.length; i += 1) {
            kids = P.children(current);
            next = null;
            for (j = 0; j < kids.length; j += 1) {
                if (P.isBin(kids[j]) && kids[j].name === segments[i]) {
                    next = kids[j];
                    break;
                }
            }
            if (!next) {
                if (!create) {
                    throw Z.refuse("NOT_FOUND", "No bin \"" + segments.slice(0, i + 1).join("/") + "\" in the project");
                }
                if (ctx) {
                    ctx.changed();
                }
                next = current.createBin(segments[i]);
                if (!next) {
                    throw Z.fail("HOST_ERROR", "Premiere did not create the bin \"" + segments[i] + "\"");
                }
                if (created) {
                    created.push(segments.slice(0, i + 1).join("/"));
                }
            }
            current = next;
        }
        return current;
    };

    /** A media path normalised for comparisons (slashes, case). */
    P.normalPath = function (path) {
        return String(path).replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
    };

    /** Media path of an item, or "" (synthetic items and bins have none). */
    P.mediaPath = function (item) {
        try {
            return Z.hasMethod(item, "getMediaPath") ? String(item.getMediaPath() || "") : "";
        } catch (error) {
            return "";
        }
    };

    /** Every project item that has media, keyed by normalised media path. */
    P.mediaIndex = function () {
        var index = {};
        P.walkItems(P.requireProject().rootItem, function (item) {
            var path;
            if (!P.isBin(item)) {
                path = P.mediaPath(item);
                if (path && !Z.has(index, P.normalPath(path))) {
                    index[P.normalPath(path)] = item;
                }
            }
            return true;
        });
        return index;
    };

    /** nodeIds of every project item (to find what an import added). */
    P.itemIds = function () {
        var ids = {};
        P.walkItems(P.requireProject().rootItem, function (item) {
            ids[item.nodeId] = true;
            return true;
        });
        return ids;
    };

    /** Items whose nodeId is not in `before`, in project order. */
    P.newItems = function (before) {
        var added = [];
        P.walkItems(P.requireProject().rootItem, function (item) {
            if (!Z.has(before, item.nodeId)) {
                added.push(item);
            }
            return true;
        });
        return added;
    };

    // ------------------------------------------------------------------
    // Sequences.

    P.activeSequence = function () {
        return app.project ? app.project.activeSequence || null : null;
    };

    P.requireActiveSequence = function () {
        var sequence;
        P.requireProject();
        sequence = P.activeSequence();
        if (!sequence) {
            throw Z.refuse("NO_ACTIVE_SEQUENCE", "No sequence is active; open one or pass `sequence` (an id from premiere_get_state)");
        }
        return sequence;
    };

    /** Every sequence in the project, as an array. */
    P.sequences = function () {
        var list = [];
        var all = P.requireProject().sequences;
        var i;
        for (i = 0; i < all.numSequences; i += 1) {
            list.push(all[i]);
        }
        return list;
    };

    /** sequenceID -> true for every sequence (to find what an import or reframe added). */
    P.sequenceIds = function () {
        var ids = {};
        Z.each(P.sequences(), function (sequence) {
            ids[sequence.sequenceID] = true;
        });
        return ids;
    };

    /**
     * A sequence from a tool's `sequence` argument: undefined/null = the active
     * sequence, a string = sequenceID, else exact name (refused when ambiguous).
     */
    P.findSequence = function (ref) {
        var all;
        var matches;
        var i;
        if (ref === undefined || ref === null) {
            return P.requireActiveSequence();
        }
        if (typeof ref !== "string" || ref.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`sequence` must be a sequence id or an exact sequence name");
        }
        all = P.sequences();
        for (i = 0; i < all.length; i += 1) {
            if (all[i].sequenceID === ref) {
                return all[i];
            }
        }
        matches = Z.filter(all, function (sequence) { return sequence.name === ref; });
        if (matches.length === 1) {
            return matches[0];
        }
        if (matches.length === 0) {
            throw Z.refuse("NOT_FOUND", "No sequence has id or name \"" + ref + "\"");
        }
        throw Z.refuse("INVALID_ARGUMENT", matches.length + " sequences are named \"" + ref + "\"; pass the sequence id");
    };

    /** Make `sequence` the active one (UI state; not an undo step). Returns true when it changed. */
    P.openSequence = function (sequence) {
        var active = P.activeSequence();
        if (active && active.sequenceID === sequence.sequenceID) {
            return false;
        }
        app.project.openSequence(sequence.sequenceID);
        return true;
    };

    /** Frames per second of a sequence (from its timebase, ticks per frame). */
    P.fps = function (sequence) {
        return P.TICKS_PER_SECOND / Number(sequence.timebase);
    };

    /** Seconds per frame. */
    P.frameSeconds = function (sequence) {
        return Number(sequence.timebase) / P.TICKS_PER_SECOND;
    };

    // ------------------------------------------------------------------
    // Time.

    P.ticksToSeconds = function (ticks) {
        return Number(ticks) / P.TICKS_PER_SECOND;
    };

    /** Whole ticks as the string the DOM expects. */
    P.secondsToTicks = function (seconds) {
        return String(Math.round(seconds * P.TICKS_PER_SECOND));
    };

    /** A Time object (ticks are exact; seconds is a float view). */
    P.timeFromSeconds = function (seconds) {
        var time = new Time();
        time.ticks = P.secondsToTicks(seconds);
        return time;
    };

    P.timeFromTicks = function (ticks) {
        var time = new Time();
        time.ticks = String(Math.round(Number(ticks)));
        return time;
    };

    P.timeToSeconds = function (time) {
        return time ? P.ticksToSeconds(time.ticks) : null;
    };

    /** Seconds rounded for receipts (4 decimals). */
    P.sec = function (time) {
        var value = P.timeToSeconds(time);
        return value === null || !isFinite(value) ? null : Z.round(value, 4);
    };

    /** `seconds` snapped to the sequence frame grid (warns in ctx when it moved). */
    P.snapTime = function (sequence, seconds, ctx, label) {
        return Z.snapToFrame(seconds, P.fps(sequence), ctx, label);
    };

    function pad2(value) {
        return value < 10 ? "0" + value : String(value);
    }

    /**
     * Timecode of a sequence time as Premiere formats it (Time.getFormatted with
     * the sequence frame duration and display format; drop-frame uses ";").
     * QE methods (razor, exportFramePNG, addTransition durations) take timecodes.
     */
    P.timecode = function (sequence, seconds) {
        var frameTicks = Number(sequence.timebase);
        var frame = Math.round(seconds * P.TICKS_PER_SECOND / frameTicks);
        var time = new Time();
        var rate = new Time();
        var format = null;
        var nominal;
        time.ticks = String(frame * frameTicks);
        rate.ticks = String(frameTicks);
        try {
            format = sequence.getSettings().videoDisplayFormat;
        } catch (error) {
            format = null;
        }
        if (Z.hasMethod(time, "getFormatted") && typeof format === "number") {
            try {
                return String(time.getFormatted(rate, format));
            } catch (error2) {
                // Fall through to the nominal non-drop timecode.
            }
        }
        nominal = Math.round(P.TICKS_PER_SECOND / frameTicks);
        return pad2(Math.floor(frame / (nominal * 3600))) + ":" + pad2(Math.floor(frame / (nominal * 60)) % 60) + ":" +
            pad2(Math.floor(frame / nominal) % 60) + ":" + pad2(frame % nominal);
    };

    // ------------------------------------------------------------------
    // Tracks and clips.

    P.tracksOf = function (sequence, kind) {
        return kind === "video" ? sequence.videoTracks : sequence.audioTracks;
    };

    /** "V1", "A2". */
    P.trackLabel = function (kind, index) {
        return (kind === "video" ? "V" : "A") + (index + 1);
    };

    /** A track from {kind: "video" | "audio", index} (0-based); refuses NOT_FOUND. */
    P.findTrack = function (sequence, ref) {
        var tracks;
        if (!Z.isObject(ref) || (ref.kind !== "video" && ref.kind !== "audio") ||
                typeof ref.index !== "number" || Math.floor(ref.index) !== ref.index || ref.index < 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`track` must be {kind: \"video\" | \"audio\", index: 0-based integer}");
        }
        tracks = P.tracksOf(sequence, ref.kind);
        if (ref.index >= tracks.numTracks) {
            throw Z.refuse("NOT_FOUND", "Sequence \"" + sequence.name + "\" has " + Z.plural(tracks.numTracks, ref.kind + " track") +
                "; there is no index " + ref.index + " (" + P.trackLabel(ref.kind, ref.index) + ")");
        }
        return tracks[ref.index];
    };

    P.isLocked = function (track) {
        try {
            return Z.hasMethod(track, "isLocked") && track.isLocked() === true;
        } catch (error) {
            return false;
        }
    };

    /** Refuses when the track is locked (Premiere ignores or rejects edits there). */
    P.requireUnlocked = function (track, kind, index) {
        if (P.isLocked(track)) {
            throw Z.refuse("INVALID_ARGUMENT", "Track " + P.trackLabel(kind, index) + " is locked; unlock it in Premiere first");
        }
    };

    /** The clips of a track, as an array, in time order. */
    P.clipsOf = function (track) {
        var list = [];
        var i;
        for (i = 0; i < track.clips.numItems; i += 1) {
            list.push(track.clips[i]);
        }
        return list;
    };

    function findClipIn(sequence, nodeId) {
        var kinds = ["video", "audio"];
        var k;
        var t;
        var c;
        var tracks;
        var clips;
        for (k = 0; k < kinds.length; k += 1) {
            tracks = P.tracksOf(sequence, kinds[k]);
            for (t = 0; t < tracks.numTracks; t += 1) {
                clips = tracks[t].clips;
                for (c = 0; c < clips.numItems; c += 1) {
                    if (clips[c].nodeId === nodeId) {
                        return {sequence: sequence, clip: clips[c], kind: kinds[k], trackIndex: t, track: tracks[t], clipIndex: c};
                    }
                }
            }
        }
        return null;
    }

    /**
     * The clip (track item) with this nodeId: {sequence, clip, kind, trackIndex,
     * track, clipIndex}. Looks in the `sequence` argument when given, else the
     * active sequence first and then every sequence. Refuses NOT_FOUND.
     */
    P.findClip = function (nodeId, sequenceRef) {
        var found = null;
        var all;
        var active;
        var i;
        if (typeof nodeId !== "string" || nodeId.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`clip` must be a clip nodeId (premiere_get_sequence lists them)");
        }
        if (sequenceRef !== undefined && sequenceRef !== null) {
            found = findClipIn(P.findSequence(sequenceRef), nodeId);
        } else {
            P.requireProject();
            active = P.activeSequence();
            found = active ? findClipIn(active, nodeId) : null;
            all = P.sequences();
            for (i = 0; !found && i < all.length; i += 1) {
                found = findClipIn(all[i], nodeId);
            }
        }
        if (!found) {
            throw Z.refuse("NOT_FOUND", "No clip has nodeId " + nodeId + (sequenceRef ? " in sequence \"" + sequenceRef + "\"" : "") +
                " (premiere_get_sequence lists clips)");
        }
        return found;
    };

    /** Re-read a clip after an edit (Premiere can replace DOM objects during edits); null when gone. */
    P.refindClip = function (sequence, nodeId) {
        return findClipIn(sequence, nodeId);
    };

    /** {kind, index} of the track holding the track item with this nodeId, or null. */
    P.trackOf = function (sequence, nodeId) {
        var found = findClipIn(sequence, nodeId);
        return found ? {kind: found.kind, index: found.trackIndex} : null;
    };

    function sourceId(clip) {
        try {
            return clip.projectItem ? clip.projectItem.nodeId : null;
        } catch (error) {
            return null;
        }
    }

    /**
     * The clips linked to `clip` (its audio/video partners), as an array; []
     * when none. getLinkedItems() returns null for an unlinked clip on Premiere
     * 25.2 (premiere-pro-mcp), while PProPanel describes it as every clip from
     * the same source, so only same-source clips overlapping this one count.
     */
    P.linkedOf = function (clip) {
        var linked;
        var list = [];
        var own = sourceId(clip);
        var start = Number(clip.start.ticks);
        var end = Number(clip.end.ticks);
        var other;
        var i;
        try {
            linked = Z.hasMethod(clip, "getLinkedItems") ? clip.getLinkedItems() : null;
        } catch (error) {
            linked = null;
        }
        if (!linked) {
            return list;
        }
        for (i = 0; i < linked.numItems; i += 1) {
            other = linked[i];
            if (!other || other.nodeId === clip.nodeId) {
                continue;
            }
            if (own !== null && sourceId(other) !== null && sourceId(other) !== own) {
                continue;
            }
            if (Number(other.start.ticks) < end && Number(other.end.ticks) > start) {
                list.push(other);
            }
        }
        return list;
    };

    /** Clip speed multiplier (1 = normal) and whether it plays backwards. */
    P.speedOf = function (clip) {
        var speed = 1;
        var reversed = false;
        try {
            if (Z.hasMethod(clip, "getSpeed")) {
                speed = Number(clip.getSpeed());
            }
            if (Z.hasMethod(clip, "isSpeedReversed")) {
                reversed = Number(clip.isSpeedReversed()) === 1 || clip.isSpeedReversed() === true;
            }
        } catch (error) {
            speed = 1;
        }
        return {speed: isFinite(speed) && speed > 0 ? speed : 1, reversed: reversed};
    };

    /** Refuses UNSUPPORTED for retimed clips (keyframe and marker times would land in the wrong place). */
    P.requireNormalSpeed = function (clip, what) {
        var speed = P.speedOf(clip);
        if (Math.abs(speed.speed - 1) > 0.0001 || speed.reversed) {
            throw Z.refuse("UNSUPPORTED", "Clip \"" + clip.name + "\" plays at " + Z.round(speed.speed * 100, 1) + "%" +
                (speed.reversed ? " reversed" : "") + "; " + what + " on retimed clips cannot be placed reliably by script");
        }
    };

    P.sequenceSummary = function (sequence) {
        return {
            sequence_id: sequence.sequenceID,
            name: sequence.name,
            node_id: sequence.projectItem ? sequence.projectItem.nodeId : null,
            duration: Z.round(P.ticksToSeconds(sequence.end), 4),
            width: sequence.frameSizeHorizontal,
            height: sequence.frameSizeVertical,
            fps: Z.round(P.fps(sequence), 3),
            video_tracks: sequence.videoTracks.numTracks,
            audio_tracks: sequence.audioTracks.numTracks
        };
    };

    P.clipSummary = function (sequence, clip) {
        return {
            node_id: clip.nodeId,
            name: clip.name,
            track: P.trackOf(sequence, clip.nodeId),
            start: Z.round(P.timeToSeconds(clip.start), 4),
            end: Z.round(P.timeToSeconds(clip.end), 4)
        };
    };

    /** Write a Time property (start, end, inPoint, outPoint) from ticks: a Time object, else a ticks string. */
    P.setTimeProperty = function (object, key, ticks) {
        var whole = String(Math.round(Number(ticks)));
        try {
            object[key] = P.timeFromTicks(whole);
        } catch (error) {
            object[key] = whole;
        }
    };

    // ------------------------------------------------------------------
    // Components (Motion, Opacity, Volume, effects) and their parameters.

    /** Match names of the built-in video components (pymiere reflection of a live Premiere; PProPanel). */
    P.MOTION = "AE.ADBE Motion";
    P.OPACITY = "AE.ADBE Opacity";

    P.componentsOf = function (clip) {
        var list = [];
        var components = clip.components;
        var i;
        if (!components) {
            return list;
        }
        for (i = 0; i < components.numItems; i += 1) {
            list.push(components[i]);
        }
        return list;
    };

    /** The first component whose matchName is in `matchNames` or displayName in `displayNames`; null if none. */
    P.findComponent = function (clip, matchNames, displayNames) {
        var components = P.componentsOf(clip);
        var i;
        for (i = 0; i < components.length; i += 1) {
            if (Z.indexOf(matchNames, String(components[i].matchName)) >= 0) {
                return components[i];
            }
        }
        for (i = 0; i < components.length; i += 1) {
            if (Z.indexOf(displayNames, String(components[i].displayName)) >= 0) {
                return components[i];
            }
        }
        return null;
    };

    P.motionOf = function (clip) {
        return P.findComponent(clip, [P.MOTION], ["Motion"]);
    };

    P.opacityOf = function (clip) {
        return P.findComponent(clip, [P.OPACITY], ["Opacity"]);
    };

    /** The audio clip's Volume component (not Channel Volume). */
    P.volumeOf = function (clip) {
        var components = P.componentsOf(clip);
        var i;
        var name;
        var match;
        for (i = 0; i < components.length; i += 1) {
            name = String(components[i].displayName);
            match = String(components[i].matchName);
            if (name === "Volume" || (/volume/i.test(match) && !/channel/i.test(match) && !/channel/i.test(name))) {
                return components[i];
            }
        }
        return null;
    };

    /** Built-in components every clip carries (not user effects). */
    P.isIntrinsic = function (component) {
        var match = String(component.matchName);
        var name = String(component.displayName);
        return match === P.MOTION || match === P.OPACITY || /time remap/i.test(name) || /time remap/i.test(match) ||
            name === "Volume" || name === "Channel Volume" || name === "Panner" || /^Internal /.test(match);
    };

    /** The parameters of a component, as an array. */
    P.paramsOf = function (component) {
        var list = [];
        var i;
        for (i = 0; i < component.properties.numItems; i += 1) {
            list.push(component.properties[i]);
        }
        return list;
    };

    /**
     * A parameter by display name (English names; Premiere localises them),
     * case-insensitive, else at `fallbackIndex` (the documented position of a
     * built-in parameter, for localised UIs). null when neither works.
     */
    P.findParam = function (component, names, fallbackIndex) {
        var params = P.paramsOf(component);
        var wanted = Z.map(names, function (name) { return String(name).toLowerCase(); });
        var i;
        for (i = 0; i < params.length; i += 1) {
            if (Z.indexOf(wanted, String(params[i].displayName).toLowerCase()) >= 0) {
                return params[i];
            }
        }
        if (typeof fallbackIndex === "number" && fallbackIndex < params.length) {
            return params[fallbackIndex];
        }
        return null;
    };

    /** Display names of a component's parameters (for error messages). */
    P.paramNames = function (component) {
        return Z.filter(Z.map(P.paramsOf(component), function (param) {
            return String(param.displayName);
        }), function (name) {
            return Z.trim(name).length > 0;
        });
    };

    P.isAnimated = function (param) {
        try {
            return Z.hasMethod(param, "isTimeVarying") && param.isTimeVarying() === true;
        } catch (error) {
            return false;
        }
    };

    /** getValue(), or null when Premiere cannot read it. */
    P.valueOf = function (param) {
        try {
            return param.getValue();
        } catch (error) {
            return null;
        }
    };

    // Motion parameter positions (pymiere reflection of a live Premiere: Position,
    // Scale, Scale Width, Uniform Scale, Rotation, Anchor Point, Anti-flicker
    // Filter) and Opacity (Opacity, Blend Mode); Volume (Bypass, Level).
    P.MOTION_PARAMS = {position: ["Position", 0], scale: ["Scale", 1], rotation: ["Rotation", 4], anchor: ["Anchor Point", 5]};
    P.OPACITY_PARAMS = {opacity: ["Opacity", 0], blend: ["Blend Mode", 1]};

    /**
     * Opacity > Blend Mode values by index: the modes in alphabetical order,
     * then Subtract and Divide (added later); Normal is 18. Mapped on Premiere
     * 25.2.3 by rendering each index over a known background (premiere-pro-mcp,
     * CHANGELOG #683). Catalog: PREMIERE_BLEND_MODES, same order.
     */
    P.BLEND_MODES = [
        "color", "color-burn", "color-dodge", "darken", "darker-color", "difference", "dissolve", "exclusion", "hard-light",
        "hard-mix", "hue", "lighten", "lighter-color", "linear-burn", "linear-dodge", "linear-light", "luminosity", "multiply",
        "normal", "overlay", "pin-light", "saturation", "screen", "soft-light", "vivid-light", "subtract", "divide"
    ];

    P.blendModeName = function (value) {
        var index = Number(value);
        return isFinite(index) && index >= 0 && index < P.BLEND_MODES.length && Math.floor(index) === index ? P.BLEND_MODES[index] : null;
    };

    /**
     * Audio Level <-> dB. Premiere stores Volume > Level as linear gain
     * normalised so that +15 dB (the slider's maximum) is 1, i.e. 0 dB =
     * 10^(-15/20) = 0.1778. Measured on Premiere 25.2 by the premiere-pro-mcp
     * project (CHANGELOG #693/#701); -96 dB and below are silence.
     */
    P.dbToLevel = function (db) {
        return db <= -96 ? 0 : Math.pow(10, (db - 15) / 20);
    };

    P.levelToDb = function (level) {
        var value = Number(level);
        if (!isFinite(value) || value <= 0) {
            return -96;
        }
        return Math.max(-96, Z.round(20 * Math.log(value) / Math.LN10 + 15, 2));
    };

    /** Motion > Position is normalised to the sequence frame in scripting ([0.5, 0.5] = centre). */
    P.positionToDom = function (sequence, px) {
        return [px[0] / sequence.frameSizeHorizontal, px[1] / sequence.frameSizeVertical];
    };

    P.positionFromDom = function (sequence, value) {
        if (!Z.isArray(value) && !(value && typeof value.length === "number")) {
            return null;
        }
        return [Z.round(Number(value[0]) * sequence.frameSizeHorizontal, 2), Z.round(Number(value[1]) * sequence.frameSizeVertical, 2)];
    };

    /**
     * The Time of a keyframe `offset` seconds after the clip's first frame.
     * Component keyframe times count from the start of the source media, so the
     * clip's in point is added (premiere-pro-mcp CHANGELOG #683/#693).
     */
    P.keyTime = function (clip, offset) {
        return P.timeFromTicks(Number(clip.inPoint.ticks) + Math.round(offset * P.TICKS_PER_SECOND));
    };

    // ------------------------------------------------------------------
    // QE sequences and track items.

    function qeMatches(candidate, sequence) {
        if (!candidate) {
            return false;
        }
        if (candidate.guid !== undefined && candidate.guid !== null && String(candidate.guid) !== "") {
            return String(candidate.guid) === String(sequence.sequenceID);
        }
        return String(candidate.name) === String(sequence.name);
    }

    /**
     * The QE sequence for a DOM sequence (QE `guid` is the DOM sequenceID). A
     * sequence QE cannot reach is opened first (warning in ctx).
     */
    P.qeSequence = function (sequence, ctx) {
        var project = P.qe().project;
        var candidate = project.getActiveSequence();
        var active = P.activeSequence();
        var count;
        var i;
        // QE's active sequence is the DOM's active one, whatever its guid says.
        if (candidate && (qeMatches(candidate, sequence) || (active && active.sequenceID === sequence.sequenceID))) {
            return candidate;
        }
        try {
            count = Number(project.numSequences);
            for (i = 0; i < count; i += 1) {
                try {
                    candidate = project.getSequenceAt(i);
                } catch (error) {
                    candidate = null;
                }
                if (qeMatches(candidate, sequence)) {
                    return candidate;
                }
            }
        } catch (error2) {
            // Some builds throw for getSequenceAt; opening the sequence below still works.
        }
        if (P.openSequence(sequence) && ctx) {
            ctx.warn("Opened sequence \"" + sequence.name + "\" so the QE DOM can reach it");
        }
        candidate = P.qe().project.getActiveSequence();
        active = P.activeSequence();
        if (candidate && (qeMatches(candidate, sequence) || (active && active.sequenceID === sequence.sequenceID))) {
            return candidate;
        }
        throw Z.fail("HOST_ERROR", "The QE DOM cannot reach sequence \"" + sequence.name + "\"");
    };

    P.qeTrack = function (qeSequence, kind, index) {
        var track = kind === "video" ? qeSequence.getVideoTrackAt(index) : qeSequence.getAudioTrackAt(index);
        if (!track) {
            throw Z.fail("HOST_ERROR", "The QE DOM has no " + P.trackLabel(kind, index) + " track");
        }
        return track;
    };

    /**
     * The QE item for a DOM clip. QE track items include gaps (and transitions),
     * so the DOM clip index does not address them: match on the start time.
     */
    P.qeItem = function (qeTrack, clip, frameTicks) {
        var wanted = Number(clip.start.ticks);
        var best = null;
        var bestDelta = null;
        var item;
        var delta;
        var i;
        var count = Number(qeTrack.numItems);
        for (i = 0; i < count; i += 1) {
            item = qeTrack.getItemAt(i);
            if (!item || String(item.type) !== "Clip") {
                continue;
            }
            delta = Math.abs(Number(item.start.ticks) - wanted);
            if (delta === 0) {
                return item;
            }
            if (best === null || delta < bestDelta) {
                best = item;
                bestDelta = delta;
            }
        }
        if (best !== null && bestDelta < frameTicks / 2) {
            return best;
        }
        throw Z.fail("HOST_ERROR", "The QE DOM has no clip at " + Z.round(P.ticksToSeconds(wanted), 3) + " s on that track");
    };

    // ------------------------------------------------------------------
    // Files.

    /** True when `path` is an existing file (not a folder). */
    P.isFile = function (path) {
        var file = new File(path);
        return file.exists && !(File(path) instanceof Folder);
    };

    /** Extension of a path, lower case, without the dot ("" when none). */
    P.extensionOf = function (path) {
        var match = /\.([A-Za-z0-9]+)$/.exec(String(path));
        return match ? match[1].toLowerCase() : "";
    };

    P.baseName = function (path) {
        var parts = String(path).replace(/\\/g, "/").split("/");
        return parts[parts.length - 1];
    };

    /** A file name made only of letters, digits, dashes and underscores (QE cuts names at the first dot). */
    P.safeName = function (text) {
        var cleaned = String(text).replace(/[^A-Za-z0-9_\-]+/g, "-").replace(/^-+|-+$/g, "");
        return cleaned.length ? cleaned.slice(0, 80) : "untitled";
    };

    /** A unique, dot-free name: prefix-time-random. */
    P.uniqueName = function (prefix) {
        return prefix + "-" + new Date().getTime() + "-" + Math.floor(Math.random() * 1000000);
    };

    /** The platform's path separator. */
    P.sep = function () {
        return Folder.fs === "Windows" ? "\\" : "/";
    };

    /** `folder` + separator + `name` (folder as an fsName string). */
    P.join = function (folder, name) {
        return String(folder).replace(/[\\\/]+$/, "") + P.sep() + name;
    };

    /**
     * Zenvi Link's temp folder: ZenviLink.tempDir(), the folder the server
     * configured (created if missing). The server deletes a frame capture it
     * has sent only from inside this folder.
     */
    P.tempFolder = function () {
        return new Folder(Z.tempDir());
    };

    /** Create the parent folder of a file path when missing. */
    P.ensureParent = function (path) {
        var parent = new File(path).parent;
        if (parent && !parent.exists) {
            parent.create();
        }
    };

    /**
     * Wait until a file exists with a non-zero size that stops changing (QE
     * exports return before the file is complete) and, when given,
     * `isComplete(path, size)` accepts it. Polls every 100 ms, at most maxMs.
     * Returns the size, or 0 when the file never settled.
     */
    P.waitForFile = function (path, maxMs, isComplete) {
        var polls = Math.ceil(maxMs / 100);
        var last = -1;
        var file;
        var size;
        var i;
        for (i = 0; i < polls; i += 1) {
            file = new File(path);
            size = file.exists ? file.length : 0;
            if (size > 0 && size === last && (!isComplete || isComplete(path, size))) {
                return size;
            }
            last = size;
            $.sleep(100);
        }
        return 0;
    };

    var PNG_SIGNATURE = "\u0089PNG\r\n\u001a\n";
    // Every complete PNG ends with the IEND chunk: length 0, "IEND", CRC AE 42 60 82.
    var PNG_TRAILER = "\u0000\u0000\u0000\u0000IEND\u00aeB`\u0082";

    /**
     * True when the file at `path`, `size` bytes long, starts with the PNG
     * signature and ends with the IEND chunk. Reads 20 bytes; false while
     * another process still holds the file so that it cannot be opened.
     */
    P.isCompletePng = function (path, size) {
        var file = new File(path);
        var head = "";
        var tail = "";
        if (size < PNG_SIGNATURE.length + PNG_TRAILER.length) {
            return false;
        }
        file.encoding = "BINARY";
        if (!file.open("r")) {
            return false;
        }
        try {
            head = file.read(PNG_SIGNATURE.length);
            file.seek(size - PNG_TRAILER.length, 0);
            tail = file.read(PNG_TRAILER.length);
        } finally {
            file.close();
        }
        return head === PNG_SIGNATURE && tail === PNG_TRAILER;
    };

    /**
     * Premiere's resource folder: app.path is the app bundle on macOS
     * (".../Adobe Premiere Pro 2025.app/") and the install folder on Windows;
     * presets live under Contents/ in the bundle.
     */
    P.appResources = function () {
        var root = String(app.path || "").replace(/[\\\/]+$/, "");
        var contents;
        if (!root) {
            return null;
        }
        contents = new Folder(root + "/Contents");
        return contents.exists ? contents : new Folder(root);
    };

    /**
     * Files under `folder` (recursively, at most `maxDepth` levels and `limit`
     * files) whose name passes `test`.
     */
    P.findFiles = function (folder, test, maxDepth, limit) {
        var found = [];
        function scan(dir, depth) {
            var entries;
            var i;
            if (!dir || !dir.exists || depth > maxDepth || found.length >= limit) {
                return;
            }
            try {
                entries = dir.getFiles();
            } catch (error) {
                return;
            }
            for (i = 0; entries && i < entries.length && found.length < limit; i += 1) {
                if (entries[i] instanceof Folder) {
                    scan(entries[i], depth + 1);
                } else if (test(decodeURI(entries[i].name))) {
                    found.push(entries[i]);
                }
            }
        }
        scan(folder, 0);
        return found;
    };

    // ------------------------------------------------------------------
    // premiere_get_state

    Z.register("premiere_get_state", function (args, ctx) {
        var project = P.requireProject();
        var sequences = P.sequences();
        var active = P.activeSequence();
        var listed = Z.map(sequences.slice(0, 100), P.sequenceSummary);
        var activeData = null;
        var parts = [];
        var selection;
        if (sequences.length > listed.length) {
            ctx.warn("Listed the first " + listed.length + " of " + sequences.length + " sequences");
        }
        if (active) {
            selection = Z.hasMethod(active, "getSelection") ? active.getSelection() || [] : [];
            activeData = P.sequenceSummary(active);
            activeData.playhead = Z.round(P.timeToSeconds(active.getPlayerPosition()), 4);
            activeData.in_point = Z.hasMethod(active, "getInPointAsTime") ? Z.round(P.timeToSeconds(active.getInPointAsTime()), 4) : null;
            activeData.out_point = Z.hasMethod(active, "getOutPointAsTime") ? Z.round(P.timeToSeconds(active.getOutPointAsTime()), 4) : null;
            activeData.selection = Z.map(selection, function (clip) {
                return P.clipSummary(active, clip);
            });
        }

        parts.push("Premiere Pro " + app.version);
        parts.push(project.path ? "project \"" + project.name + "\"" : "unsaved project");
        parts.push(Z.plural(sequences.length, "sequence"));
        parts.push(active ? "active sequence \"" + active.name + "\" (" + activeData.width + "x" + activeData.height + ", " +
            activeData.fps + " fps, " + Z.round(activeData.duration, 3) + " s, playhead " + Z.round(activeData.playhead, 3) + " s)" : "no active sequence");
        if (activeData && activeData.selection.length > 0) {
            parts.push(Z.plural(activeData.selection.length, "clip") + " selected");
        }

        return Z.ok(parts.join(", "), {
            app: {name: "Adobe Premiere Pro", version: String(app.version), build: app.build ? String(app.build) : null},
            project: {path: P.projectPath(), name: project.name ? String(project.name) : null},
            sequences: listed,
            active_sequence: activeData
        });
    });
}(ZenviLink));
// ---- ppro/10-project.jsx ----
// Zenvi Link: Premiere Pro project tools. premiere_list_items,
// premiere_import_files, premiere_save_project.

(function (Z) {
    var P = Z.ppro;

    /** Seconds of a project item's in or out mark ("" when Premiere has none). */
    function markSeconds(item, getter) {
        var time;
        try {
            time = Z.hasMethod(item, getter) ? item[getter]() : null;
        } catch (error) {
            time = null;
        }
        return time ? P.sec(time) : null;
    }

    function isOffline(item) {
        try {
            return Z.hasMethod(item, "isOffline") && item.isOffline() === true;
        } catch (error) {
            return false;
        }
    }

    /** sequence project item nodeId -> Sequence. */
    function sequencesByItem() {
        var map = {};
        Z.each(P.sequences(), function (sequence) {
            if (sequence.projectItem) {
                map[sequence.projectItem.nodeId] = sequence;
            }
        });
        return map;
    }

    /** bin, sequence, media (has a file) or clip (synthetic: titles, bars, nests that are not sequences). */
    function kindOf(item, sequenceMap) {
        if (item.type === P.itemType("ROOT")) {
            return "root";
        }
        if (item.type === P.itemType("BIN")) {
            return "bin";
        }
        if (Z.has(sequenceMap, item.nodeId)) {
            return "sequence";
        }
        return P.mediaPath(item) ? "media" : "clip";
    }

    /** One project item for receipts. */
    P.itemSummary = function (item, binPath, sequenceMap) {
        var kind = kindOf(item, sequenceMap || sequencesByItem());
        var data = {node_id: item.nodeId, name: String(item.name), kind: kind, bin: binPath || "/"};
        var inPoint;
        var outPoint;
        var sequence;
        if (kind === "media" || kind === "clip") {
            inPoint = markSeconds(item, "getInPoint");
            outPoint = markSeconds(item, "getOutPoint");
            data.media_path = P.mediaPath(item) || null;
            data.in_point = inPoint;
            data.out_point = outPoint;
            data.duration = inPoint !== null && outPoint !== null ? Z.round(outPoint - inPoint, 4) : null;
            data.offline = isOffline(item);
        } else if (kind === "sequence") {
            sequence = (sequenceMap || sequencesByItem())[item.nodeId];
            data.sequence_id = sequence.sequenceID;
            data.duration = Z.round(P.ticksToSeconds(sequence.end), 4);
        }
        return data;
    };

    // ------------------------------------------------------------------
    // premiere_list_items

    Z.register("premiere_list_items", function (args, ctx) {
        var project = P.requireProject();
        var kind = Z.oneOf("kind", Z.optional(args, "kind", "string", "any"), ["any", "media", "sequence", "bin"]);
        var needle = Z.optional(args, "name_contains", "string", null);
        var recursive = Z.optional(args, "recursive", "boolean", true);
        var limit = Z.inRange("limit", Z.optional(args, "limit", "integer", 200), 1, 2000);
        var binRef = Z.optional(args, "bin", "string", null);
        var start = binRef === null ? project.rootItem : P.findBin(binRef, false);
        var startPath = "";
        var sequenceMap = sequencesByItem();
        var items = [];
        var matched = 0;
        var counts = {bin: 0, sequence: 0, media: 0, clip: 0};
        if (binRef !== null && start.nodeId !== project.rootItem.nodeId) {
            startPath = String(start.treePath || start.name).replace(/\\/g, "/").replace(/^\/+[^\/]*\/?/, "");
            if (!startPath) {
                startPath = String(start.name);
            }
        }
        if (needle !== null) {
            needle = needle.toLowerCase();
        }

        P.walkItems(start, function (item, depth, path) {
            var itemKind;
            if (!recursive && depth > 0) {
                return true;
            }
            itemKind = kindOf(item, sequenceMap);
            if (kind !== "any" && itemKind !== kind) {
                return true;
            }
            if (needle !== null && String(item.name).toLowerCase().indexOf(needle) < 0) {
                return true;
            }
            matched += 1;
            if (Z.has(counts, itemKind)) {
                counts[itemKind] += 1;
            }
            if (items.length < limit) {
                items.push(P.itemSummary(item, startPath ? (path ? startPath + "/" + path : startPath) : path, sequenceMap));
            }
            return true;
        });

        if (matched > items.length) {
            ctx.warn("Listed the first " + items.length + " of " + matched + " matching items; raise `limit` or filter by `kind`, `name_contains` or `bin`");
        }
        return Z.ok("Listed " + items.length + (matched > items.length ? " of " + matched : "") + " project items (" +
            Z.plural(counts.bin, "bin") + ", " + Z.plural(counts.sequence, "sequence") + ", " + counts.media + " media, " +
            Z.plural(counts.clip, "other clip") + ")", {
            items: items,
            total: matched,
            truncated: matched > items.length
        });
    });

    // ------------------------------------------------------------------
    // premiere_import_files

    Z.register("premiere_import_files", function (args, ctx) {
        var paths = Z.required(args, "paths", "array");
        var binRef = Z.optional(args, "bin", "string", "Zenvi Imports");
        var dedupe = Z.optional(args, "dedupe", "boolean", true);
        var stills = Z.optional(args, "image_sequence", "boolean", false);
        var missing = [];
        var unique = [];
        var seen = {};
        var existingIndex;
        var results = [];
        var toImport = [];
        var created = [];
        var bin;
        var before;
        var added;
        var addedByPath = {};
        var imported = 0;
        var reused = 0;
        var failed = [];
        var binPath;
        var accepted;

        P.requireProject();
        if (paths.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`paths` needs at least one file");
        }
        Z.each(paths, function (path, i) {
            if (typeof path !== "string" || path.length === 0) {
                throw Z.refuse("INVALID_ARGUMENT", "`paths[" + i + "]` must be an absolute file path");
            }
            if (!Z.has(seen, P.normalPath(path))) {
                seen[P.normalPath(path)] = true;
                unique.push(path);
            }
            if (!P.isFile(path)) {
                missing.push(path);
            }
        });
        if (missing.length > 0) {
            throw Z.refuse("NOT_FOUND", Z.plural(missing.length, "file") + " not found, nothing imported: " +
                missing.slice(0, 5).join(", ") + (missing.length > 5 ? ", ..." : ""));
        }

        existingIndex = dedupe ? P.mediaIndex() : {};
        Z.each(unique, function (path) {
            var item = existingIndex[P.normalPath(path)];
            if (item) {
                results.push({path: path, status: "existing", node_id: item.nodeId, name: String(item.name)});
                reused += 1;
            } else {
                results.push({path: path, status: "pending"});
                toImport.push(path);
            }
        });
        if (toImport.length === 0) {
            return Z.unchanged("All " + Z.plural(unique.length, "file is", "files are") + " already in the project", {
                items: results,
                bin: null
            });
        }

        bin = P.findBin(binRef, true, ctx, created);
        binPath = P.isBin(bin) && bin.nodeId === app.project.rootItem.nodeId ? "/" : binRef;
        before = P.itemIds();
        ctx.changed();
        accepted = app.project.importFiles(toImport, true, bin, stills);
        added = P.newItems(before);
        Z.each(added, function (item) {
            var path = P.mediaPath(item);
            if (path && !Z.has(addedByPath, P.normalPath(path))) {
                addedByPath[P.normalPath(path)] = item;
            }
        });
        Z.each(results, function (entry) {
            var item;
            if (entry.status !== "pending") {
                return;
            }
            item = addedByPath[P.normalPath(entry.path)];
            if (item) {
                entry.status = "imported";
                entry.node_id = item.nodeId;
                entry.name = String(item.name);
                imported += 1;
            } else {
                entry.status = "failed";
                failed.push(entry.path);
            }
        });
        if (imported === 0 && added.length === 0) {
            throw Z.fail("HOST_ERROR", "Premiere imported none of " + Z.plural(toImport.length, "file") +
                (accepted === false ? " (importFiles returned false)" : "") + ": " + toImport.slice(0, 3).join(", "));
        }
        if (failed.length > 0) {
            ctx.warn("Premiere did not import " + failed.slice(0, 5).join(", ") + (failed.length > 5 ? ", ..." : "") +
                " (unsupported format or a dialog was suppressed)");
        }
        return Z.applied("Imported " + Z.plural(imported, "file") + " into bin \"" + binPath + "\"" +
            (reused > 0 ? ", " + reused + " already in the project" : "") +
            (created.length > 0 ? " (created bin " + created.join(", ") + ")" : ""), {
            items: results,
            bin: {node_id: bin.nodeId, path: binPath},
            created_bins: created
        }, created.length + 1);
    });

    // ------------------------------------------------------------------
    // premiere_save_project

    Z.register("premiere_save_project", function (args, ctx) {
        var project = P.requireProject();
        var path = Z.optional(args, "path", "string", null);
        var previous = P.projectPath();
        var saved;
        if (path === null || (previous && P.normalPath(path) === P.normalPath(previous))) {
            ctx.changed();
            project.save();
            return Z.applied("Saved project \"" + project.name + "\"", {path: P.projectPath(), saved_as: false}, 0);
        }
        if (P.extensionOf(path) !== "prproj") {
            throw Z.refuse("INVALID_ARGUMENT", "`path` must end in .prproj, got " + path);
        }
        if (new File(path).exists) {
            throw Z.refuse("INVALID_ARGUMENT", path + " already exists; Save As will not replace another project");
        }
        P.ensureParent(path);
        ctx.changed();
        project.saveAs(path);
        if (!new File(path).exists) {
            throw Z.fail("HOST_ERROR", "Premiere did not write " + path);
        }
        saved = P.projectPath() || path;
        return Z.applied("Saved the project as " + path + "; Premiere now has that copy open", {
            path: saved,
            previous_path: previous,
            saved_as: true
        }, 0);
    });
}(ZenviLink));
// ---- ppro/20-sequence.jsx ----
// Zenvi Link: Premiere Pro sequence tools. premiere_get_sequence,
// premiere_create_sequence, premiere_open_sequence, premiere_add_marker.

(function (Z) {
    var P = Z.ppro;

    // ------------------------------------------------------------------
    // premiere_get_sequence

    function safe(fn, fallback) {
        try {
            return fn();
        } catch (error) {
            return fallback;
        }
    }

    /** One clip in detail; with `withProps` its effects, built-in values and animated properties. */
    P.clipDetail = function (sequence, clip, kind, trackIndex, withProps) {
        var speed = P.speedOf(clip);
        var item = safe(function () { return clip.projectItem; }, null);
        var start = P.sec(clip.start);
        var end = P.sec(clip.end);
        var data = {
            node_id: clip.nodeId,
            name: String(clip.name),
            track: {kind: kind, index: trackIndex},
            start: start,
            end: end,
            duration: start !== null && end !== null ? Z.round(end - start, 4) : null,
            in_point: P.sec(clip.inPoint),
            out_point: P.sec(clip.outPoint),
            media_path: item ? P.mediaPath(item) || null : null,
            item_id: item ? item.nodeId : null,
            enabled: clip.disabled !== true,
            speed: Z.round(speed.speed, 4),
            reversed: speed.reversed,
            selected: safe(function () { return clip.isSelected() === true; }, false)
        };
        var animated = [];
        var motion;
        var opacity;
        var volume;
        var param;
        if (!withProps) {
            return data;
        }
        data.effects = [];
        Z.each(P.componentsOf(clip), function (component) {
            if (!P.isIntrinsic(component)) {
                data.effects.push(String(component.displayName));
            }
            Z.each(P.paramsOf(component), function (p) {
                if (animated.length < 20 && P.isAnimated(p)) {
                    animated.push(String(component.displayName) + " > " + String(p.displayName));
                }
            });
        });
        data.animated = animated;
        if (kind === "video") {
            motion = P.motionOf(clip);
            opacity = P.opacityOf(clip);
            if (motion) {
                param = P.findParam(motion, ["Position"], P.MOTION_PARAMS.position[1]);
                data.position = param ? P.positionFromDom(sequence, P.valueOf(param)) : null;
                param = P.findParam(motion, ["Scale"], P.MOTION_PARAMS.scale[1]);
                data.scale = param ? Z.round(Number(P.valueOf(param)), 3) : null;
                param = P.findParam(motion, ["Rotation"], P.MOTION_PARAMS.rotation[1]);
                data.rotation = param ? Z.round(Number(P.valueOf(param)), 3) : null;
            }
            if (opacity) {
                param = P.findParam(opacity, ["Opacity"], P.OPACITY_PARAMS.opacity[1]);
                data.opacity = param ? Z.round(Number(P.valueOf(param)), 2) : null;
                param = P.findParam(opacity, ["Blend Mode"], P.OPACITY_PARAMS.blend[1]);
                data.blend_mode = param ? P.blendModeName(P.valueOf(param)) : null;
            }
        } else {
            volume = P.volumeOf(clip);
            param = volume ? P.findParam(volume, ["Level"], 1) : null;
            data.volume_db = param ? P.levelToDb(P.valueOf(param)) : null;
        }
        return data;
    };

    function markerColorName(marker) {
        var index = safe(function () {
            return Z.hasMethod(marker, "getColorByIndex") ? Number(marker.getColorByIndex()) : null;
        }, null);
        return index !== null && index >= 0 && index < P.MARKER_COLORS.length ? P.MARKER_COLORS[index] : null;
    }

    /** Markers of a MarkerCollection, in time order (at most `limit`). */
    P.markersOf = function (markers, limit) {
        var list = [];
        var marker;
        if (!markers || !markers.numMarkers) {
            return list;
        }
        marker = markers.getFirstMarker();
        while (marker && list.length < limit) {
            list.push({
                guid: marker.guid ? String(marker.guid) : null,
                start: P.sec(marker.start),
                end: P.sec(marker.end),
                name: String(marker.name || ""),
                comment: String(marker.comments || ""),
                type: String(marker.type || "Comment"),
                color: markerColorName(marker)
            });
            marker = markers.getNextMarker(marker);
        }
        return list;
    };

    Z.register("premiere_get_sequence", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var withProps = Z.optional(args, "include_properties", "boolean", true);
        var maxClips = Z.inRange("max_clips", Z.optional(args, "max_clips", "integer", 500), 1, 5000);
        var data = P.sequenceSummary(sequence);
        var tracks = [];
        var listed = 0;
        var total = 0;
        var kinds = ["video", "audio"];
        var k;
        var t;
        var group;
        var track;
        var entry;
        var transitions;
        var i;

        data.playhead = Z.round(P.timeToSeconds(sequence.getPlayerPosition()), 4);
        data.in_point = Z.round(P.timeToSeconds(sequence.getInPointAsTime()), 4);
        data.out_point = Z.round(P.timeToSeconds(sequence.getOutPointAsTime()), 4);
        data.active = P.activeSequence() !== null && P.activeSequence().sequenceID === sequence.sequenceID;

        for (k = 0; k < kinds.length; k += 1) {
            group = P.tracksOf(sequence, kinds[k]);
            for (t = 0; t < group.numTracks; t += 1) {
                track = group[t];
                entry = {
                    kind: kinds[k],
                    index: t,
                    label: P.trackLabel(kinds[k], t),
                    name: String(track.name),
                    muted: safe(function () { return track.isMuted() === true; }, false),
                    locked: P.isLocked(track),
                    targeted: safe(function () { return Z.hasMethod(track, "isTargeted") ? track.isTargeted() === true : null; }, null),
                    clips: [],
                    transitions: []
                };
                Z.each(P.clipsOf(track), function (clip) {
                    total += 1;
                    if (listed < maxClips) {
                        entry.clips.push(P.clipDetail(sequence, clip, entry.kind, entry.index, withProps));
                        listed += 1;
                    }
                });
                transitions = track.transitions;
                for (i = 0; transitions && i < transitions.numItems; i += 1) {
                    entry.transitions.push({
                        name: String(transitions[i].name || ""),
                        start: P.sec(transitions[i].start),
                        end: P.sec(transitions[i].end)
                    });
                }
                tracks.push(entry);
            }
        }
        data.tracks = tracks;
        data.markers = P.markersOf(sequence.markers, 500);
        data.clip_count = total;
        if (total > listed) {
            ctx.warn("Listed " + listed + " of " + total + " clips; raise `max_clips` to see the rest");
        }
        return Z.ok("Sequence \"" + sequence.name + "\": " + data.width + "x" + data.height + ", " + data.fps + " fps, " +
            Z.round(data.duration, 3) + " s, " + Z.plural(sequence.videoTracks.numTracks, "video track") + ", " +
            Z.plural(sequence.audioTracks.numTracks, "audio track") + ", " + Z.plural(total, "clip") + ", " +
            Z.plural(data.markers.length, "marker"), data);
    });

    // ------------------------------------------------------------------
    // premiere_create_sequence

    /** Frame size and rate per preset (catalog: PREMIERE_SEQUENCE_PRESETS). */
    P.SEQUENCE_PRESETS = {
        "1080p30": {width: 1920, height: 1080, fps: 30},
        "1080p25": {width: 1920, height: 1080, fps: 25},
        "1080p24": {width: 1920, height: 1080, fps: 24},
        "4k30": {width: 3840, height: 2160, fps: 30},
        "vertical": {width: 1080, height: 1920, fps: 30},
        "square": {width: 1080, height: 1080, fps: 30}
    };

    /** Sequence.videoDisplayFormat for whole frame rates (TIME_FORMAT: 24/25/30 Timecode). */
    var DISPLAY_FORMAT = {24: 100, 25: 101, 30: 104, 50: 105, 60: 108};

    /** Premiere's installed sequence presets (Settings/SequencePresets under the app). */
    P.sequencePresetFiles = function () {
        var resources = P.appResources();
        if (!resources) {
            return [];
        }
        return P.findFiles(new Folder(resources.fsName + "/Settings/SequencePresets"), function (name) {
            return /\.sqpreset$/i.test(name);
        }, 4, 1000);
    };

    /** How well a preset file name fits a target size and rate (higher is better). */
    function presetScore(name, target) {
        var lower = name.toLowerCase().replace(/\.sqpreset$/, "");
        var score = 0;
        var rate = new RegExp("(^|[^0-9.])" + target.fps + "(p|\\s*fps|[^0-9.]|$)");
        var big = target.width >= 3840 || target.height >= 3840;
        if (big ? /2160|4k|uhd/.test(lower) : /1080/.test(lower)) {
            score += 4;
        }
        if (rate.test(lower)) {
            score += 3;
        }
        if (/1080p|2160p|\bp\d|progressive/.test(lower)) {
            score += 1;
        }
        if (/1080i|2160i|interlaced|\bvr\b|anamorphic|\bdv\b|stereo/.test(lower)) {
            score -= 6;
        }
        return score;
    }

    /** The installed preset closest to `target`, or null when Premiere has none. */
    P.basePreset = function (target) {
        var files = P.sequencePresetFiles();
        var best = null;
        var bestScore = null;
        Z.each(files, function (file) {
            var score = presetScore(decodeURI(file.name), target);
            if (best === null || score > bestScore || (score === bestScore && file.fsName.length < best.fsName.length)) {
                best = file;
                bestScore = score;
            }
        });
        return best;
    };

    /** The sequence in `after` that is not in `before` (sequenceID maps); null when none. */
    P.newSequence = function (before) {
        var all = P.sequences();
        var i;
        for (i = all.length - 1; i >= 0; i -= 1) {
            if (!Z.has(before, all[i].sequenceID)) {
                return all[i];
            }
        }
        return null;
    };

    /**
     * Set a sequence's frame size (and rate, when target.fps is set) through its
     * settings, as PProPanel does (videoFrameRate is a Time of one frame).
     * Warns when Premiere keeps other values. Returns the number of changes.
     */
    P.applyFrame = function (sequence, target, ctx) {
        var settings = sequence.getSettings();
        var frameTicks = target.fps ? String(Math.round(P.TICKS_PER_SECOND / target.fps)) : null;
        var changed = false;
        if (settings.videoFrameWidth !== target.width || settings.videoFrameHeight !== target.height) {
            settings.videoFrameWidth = target.width;
            settings.videoFrameHeight = target.height;
            changed = true;
        }
        if (frameTicks !== null && String(settings.videoFrameRate.ticks) !== frameTicks) {
            settings.videoFrameRate.ticks = frameTicks;
            if (Z.has(DISPLAY_FORMAT, String(target.fps))) {
                settings.videoDisplayFormat = DISPLAY_FORMAT[target.fps];
            }
            changed = true;
        }
        if (!changed) {
            return 0;
        }
        sequence.setSettings(settings);
        if (sequence.frameSizeHorizontal !== target.width || sequence.frameSizeVertical !== target.height ||
                (frameTicks !== null && String(sequence.timebase) !== frameTicks)) {
            ctx.warn("Premiere kept " + sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical + " at " +
                Z.round(P.fps(sequence), 3) + " fps instead of " + target.width + "x" + target.height +
                (frameTicks !== null ? " at " + target.fps + " fps" : ""));
        }
        return 1;
    };

    Z.register("premiere_create_sequence", function (args, ctx) {
        var name = Z.optional(args, "name", "string", "Zenvi Sequence");
        var presetName = Z.oneOf("preset", Z.optional(args, "preset", "string", "1080p30"), Object.keys(P.SEQUENCE_PRESETS));
        var fromClips = Z.optional(args, "from_clips", "array", null);
        var binRef = Z.optional(args, "bin", "string", null);
        var open = Z.optional(args, "open", "boolean", true);
        var target = P.SEQUENCE_PRESETS[presetName];
        var created = [];
        var before;
        var sequence;
        var items;
        var bin;
        var preset = null;
        var steps = 0;
        var how;
        var previous = P.activeSequence();
        var active;

        P.requireProject();
        if (fromClips !== null) {
            P.requireFeature(Z.hasMethod(app.project, "createNewSequenceFromClips"), "Project.createNewSequenceFromClips", "2020 (14.0)");
            items = Z.map(fromClips, function (id, i) {
                var item;
                if (typeof id !== "string") {
                    throw Z.refuse("INVALID_ARGUMENT", "`from_clips[" + i + "]` must be a project item nodeId");
                }
                item = P.findProjectItemByNodeId(id);
                if (P.isBin(item)) {
                    throw Z.refuse("INVALID_ARGUMENT", "`from_clips[" + i + "]` (" + item.name + ") is a bin, not a clip");
                }
                return item;
            });
        } else {
            if (!Z.hasMethod(app, "enableQE") && !Z.hasMethod(app.project, "newSequence")) {
                throw Z.refuse("UNSUPPORTED", "This Premiere build cannot create a sequence from a preset by script (no QE DOM); pass `from_clips`");
            }
            preset = P.basePreset(target);
            if (!preset) {
                throw Z.refuse("UNSUPPORTED", "No sequence presets (.sqpreset) found under Premiere's Settings/SequencePresets" +
                    (app.path ? " in " + app.path : "") + "; pass `from_clips` instead");
            }
        }

        bin = binRef !== null ? P.findBin(binRef, true, ctx, created) : null;
        before = P.sequenceIds();
        ctx.changed();
        if (items) {
            sequence = app.project.createNewSequenceFromClips(name, items, bin || app.project.rootItem) || null;
            if (!sequence || !sequence.sequenceID) {
                sequence = P.newSequence(before);
            }
            how = "from " + Z.plural(items.length, "clip");
        } else {
            // Never app.project.createNewSequence: it opens the modal New Sequence dialog
            // (PProPanel uses qe.project.newSequence(name, presetPath) for presets).
            if (Z.hasMethod(app, "enableQE")) {
                P.qe().project.newSequence(name, preset.fsName);
            } else {
                app.project.newSequence(name, preset.fsName);
            }
            sequence = P.newSequence(before);
            how = "from preset " + decodeURI(preset.name).replace(/\.sqpreset$/i, "");
        }
        if (!sequence) {
            throw Z.fail("HOST_ERROR", "Premiere did not create sequence \"" + name + "\"");
        }
        steps += 1 + created.length;
        if (!items) {
            steps += P.applyFrame(sequence, target, ctx);
        }
        if (bin && !items && sequence.projectItem && Z.hasMethod(sequence.projectItem, "moveBin")) {
            sequence.projectItem.moveBin(bin);
            steps += 1;
        }
        if (open) {
            P.openSequence(sequence);
        } else if (previous && P.activeSequence() && P.activeSequence().sequenceID === sequence.sequenceID) {
            // Creating a sequence opens it; open: false puts the previous one back.
            P.openSequence(previous);
        }
        active = P.activeSequence() !== null && P.activeSequence().sequenceID === sequence.sequenceID;
        return Z.applied("Created sequence \"" + sequence.name + "\" (" + sequence.frameSizeHorizontal + "x" +
            sequence.frameSizeVertical + ", " + Z.round(P.fps(sequence), 3) + " fps) " + how +
            (active ? ", now the active sequence" : ""), {
            sequence: P.sequenceSummary(sequence),
            preset: items ? null : presetName,
            base_preset: preset ? preset.fsName : null,
            created_bins: created,
            active: active
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_open_sequence

    Z.register("premiere_open_sequence", function (args, ctx) {
        var sequence = P.findSequence(Z.required(args, "sequence", "string"));
        var active = P.activeSequence();
        if (active && active.sequenceID === sequence.sequenceID) {
            return Z.unchanged("Sequence \"" + sequence.name + "\" is already active", P.sequenceSummary(sequence));
        }
        ctx.changed();
        app.project.openSequence(sequence.sequenceID);
        active = P.activeSequence();
        if (!active || active.sequenceID !== sequence.sequenceID) {
            throw Z.fail("HOST_ERROR", "Premiere did not open sequence \"" + sequence.name + "\"");
        }
        return Z.applied("Opened sequence \"" + sequence.name + "\"", P.sequenceSummary(sequence), 0);
    });

    // ------------------------------------------------------------------
    // premiere_add_marker

    /** Marker colours by Premiere's colour index (Marker.setColorByIndex; scripting guide). */
    P.MARKER_COLORS = ["green", "red", "purple", "orange", "yellow", "white", "blue", "cyan"];

    Z.register("premiere_add_marker", function (args, ctx) {
        var name = Z.optional(args, "name", "string", "");
        var comment = Z.optional(args, "comment", "string", "");
        var duration = Z.inRange("duration", Z.optional(args, "duration", "number", 0), 0, 86400);
        var color = Z.optional(args, "color", "string", null);
        var type = Z.oneOf("type", Z.optional(args, "type", "string", "comment"), ["comment", "chapter", "segmentation"]);
        var clipRef = Z.optional(args, "clip", "string", null);
        var found = null;
        var sequence;
        var time;
        var at;
        var markers;
        var marker;
        var clipStart;
        var clipEnd;
        var where;
        var steps = 1;

        if (color !== null) {
            Z.oneOf("color", color, P.MARKER_COLORS);
        }
        if (clipRef !== null) {
            found = P.findClip(clipRef, args.sequence);
            sequence = found.sequence;
        } else {
            sequence = P.findSequence(args.sequence);
        }
        time = Z.optional(args, "time", "number", null);
        time = time === null ? P.timeToSeconds(sequence.getPlayerPosition()) : Z.inRange("time", time, 0, null);
        time = P.snapTime(sequence, time, ctx, "time");
        at = time;
        if (found) {
            clipStart = P.timeToSeconds(found.clip.start);
            clipEnd = P.timeToSeconds(found.clip.end);
            if (time < clipStart - 0.0005 || time >= clipEnd) {
                throw Z.refuse("INVALID_ARGUMENT", "Time " + Z.round(time) + " s is outside clip \"" + found.clip.name + "\" (" +
                    Z.round(clipStart) + "-" + Z.round(clipEnd) + " s)");
            }
            if (!found.clip.projectItem || !Z.hasMethod(found.clip.projectItem, "getMarkers")) {
                throw Z.refuse("UNSUPPORTED", "Clip \"" + found.clip.name + "\" has no source item to hold markers");
            }
            if (Math.abs(P.speedOf(found.clip).speed - 1) > 0.0001 || P.speedOf(found.clip).reversed) {
                ctx.warn("The clip is retimed; the marker lands at the source time of an unretimed clip");
            }
            at = P.timeToSeconds(found.clip.inPoint) + (time - clipStart);
            markers = found.clip.projectItem.getMarkers();
            where = "clip \"" + found.clip.name + "\"";
        } else {
            markers = sequence.markers;
            where = "sequence \"" + sequence.name + "\"";
        }

        ctx.changed();
        marker = markers.createMarker(at);
        if (!marker) {
            throw Z.fail("HOST_ERROR", "Premiere did not create the marker");
        }
        if (name) {
            marker.name = name;
        }
        if (comment) {
            marker.comments = comment;
        }
        if (duration > 0) {
            // Marker.end takes seconds, not a Time (scripting guide, Marker.end).
            /** @type {any} */ (marker).end = at + duration;
        }
        if (type === "chapter") {
            marker.setTypeAsChapter();
        } else if (type === "segmentation") {
            marker.setTypeAsSegmentation();
        }
        if (color !== null) {
            if (Z.hasMethod(marker, "setColorByIndex")) {
                marker.setColorByIndex(Z.indexOf(P.MARKER_COLORS, color));
            } else {
                ctx.warn("This Premiere build cannot colour markers by script (Marker.setColorByIndex); the marker kept its default colour");
            }
        }
        return Z.applied("Added " + (type === "comment" ? "a" : "a " + type) + " marker" + (name ? " \"" + name + "\"" : "") +
            " at " + Z.round(time, 3) + " s" + (duration > 0 ? " for " + Z.round(duration, 3) + " s" : "") + " on " + where, {
            marker: {
                guid: marker.guid ? String(marker.guid) : null,
                time: Z.round(time, 4),
                source_time: found ? Z.round(at, 4) : null,
                duration: Z.round(duration, 4),
                name: name,
                comment: comment,
                type: type,
                color: color
            },
            target: found ? "clip" : "sequence",
            clip: found ? found.clip.nodeId : null,
            sequence_id: sequence.sequenceID
        }, steps);
    });
}(ZenviLink));
// ---- ppro/30-timeline.jsx ----
// Zenvi Link: Premiere Pro timeline edits. premiere_place_clip,
// premiere_edit_clip, premiere_razor.
//
// DOM behaviour these rely on (Premiere 25.2, measured by the premiere-pro-mcp
// project and noted in docs/PREMIERE_PRO.md): a trim must write the timeline
// edge and the source point together (start + inPoint, end + outPoint);
// TrackItem.remove(true, ...) does not ripple, so ripple deletes move the
// later clips themselves; Premiere can replace TrackItem objects during an
// edit, so clips are looked up again by nodeId afterwards.

(function (Z) {
    var P = Z.ppro;
    var TPS = P.TICKS_PER_SECOND;

    /** nodeId -> true for every clip in the sequence. */
    P.clipIds = function (sequence) {
        var ids = {};
        var kinds = ["video", "audio"];
        var k;
        var t;
        var tracks;
        for (k = 0; k < kinds.length; k += 1) {
            tracks = P.tracksOf(sequence, kinds[k]);
            for (t = 0; t < tracks.numTracks; t += 1) {
                Z.each(P.clipsOf(tracks[t]), function (clip) {
                    ids[clip.nodeId] = true;
                });
            }
        }
        return ids;
    };

    /** End of the last clip on a track, in seconds (0 when empty). */
    P.trackEnd = function (track) {
        var end = 0;
        Z.each(P.clipsOf(track), function (clip) {
            end = Math.max(end, P.timeToSeconds(clip.end));
        });
        return end;
    };

    /** Clips on `track` overlapping [startTicks, endTicks), except nodeIds in `except`. */
    P.overlapping = function (track, startTicks, endTicks, except) {
        return Z.filter(P.clipsOf(track), function (clip) {
            return !Z.has(except || {}, clip.nodeId) && Number(clip.start.ticks) < endTicks && Number(clip.end.ticks) > startTicks;
        });
    };

    function ticksOf(time) {
        return time ? String(time.ticks) : null;
    }

    /** Set a project item's in/out marks (seconds, all media types = 4) in an order that keeps in < out. */
    P.setMarks = function (item, inSeconds, outSeconds) {
        return setMarks(item, inSeconds, outSeconds);
    };

    function setMarks(item, inSeconds, outSeconds) {
        var currentOut = ticksOf(item.getOutPoint());
        var steps = 0;
        if (inSeconds !== null && currentOut !== null && inSeconds * TPS >= Number(currentOut) && outSeconds !== null) {
            item.setOutPoint(outSeconds, 4);
            item.setInPoint(inSeconds, 4);
            return 2;
        }
        if (inSeconds !== null) {
            item.setInPoint(inSeconds, 4);
            steps += 1;
        }
        if (outSeconds !== null) {
            item.setOutPoint(outSeconds, 4);
            steps += 1;
        }
        return steps;
    }

    function linkedLabels(sequence, clips) {
        return Z.map(clips, function (clip) {
            var track = P.trackOf(sequence, clip.nodeId);
            return track ? P.trackLabel(track.kind, track.index) : "?";
        });
    }

    // ------------------------------------------------------------------
    // premiere_place_clip

    Z.register("premiere_place_clip", function (args, ctx) {
        var item = P.findProjectItemByNodeId(Z.required(args, "item", "string"));
        var sequence = P.findSequence(args.sequence);
        var ref = Z.optional(args, "track", "object", {kind: "video", index: 0});
        var track = P.findTrack(sequence, ref);
        var label = P.trackLabel(ref.kind, ref.index);
        var mode = Z.oneOf("mode", Z.optional(args, "mode", "string", "overwrite"), ["overwrite", "insert"]);
        var sourceIn = Z.optional(args, "source_in", "number", null);
        var sourceOut = Z.optional(args, "source_out", "number", null);
        var time = Z.optional(args, "time", "number", null);
        var half = Number(sequence.timebase) / 2;
        var origIn;
        var origOut;
        var effectiveIn;
        var effectiveOut;
        var before;
        var steps = 0;
        var marked = false;
        /** @type {TrackItem | null} */
        var placed = null;
        var linked;
        var detail;
        var timeTicks;

        if (P.isBin(item)) {
            throw Z.refuse("INVALID_ARGUMENT", "\"" + item.name + "\" is a bin; pass a clip, still, audio or sequence item");
        }
        if (sequence.projectItem && sequence.projectItem.nodeId === item.nodeId) {
            throw Z.refuse("INVALID_ARGUMENT", "A sequence cannot be placed inside itself");
        }
        P.requireUnlocked(track, ref.kind, ref.index);
        if (sourceIn !== null) {
            Z.inRange("source_in", sourceIn, 0, null);
        }
        if (sourceOut !== null) {
            Z.inRange("source_out", sourceOut, 0, null);
        }
        origIn = ticksOf(item.getInPoint());
        origOut = ticksOf(item.getOutPoint());
        effectiveIn = sourceIn !== null ? sourceIn : (origIn !== null ? P.ticksToSeconds(origIn) : null);
        effectiveOut = sourceOut !== null ? sourceOut : (origOut !== null ? P.ticksToSeconds(origOut) : null);
        if (effectiveIn !== null && effectiveOut !== null && effectiveOut <= effectiveIn) {
            throw Z.refuse("INVALID_ARGUMENT", "The source range is empty: out " + Z.round(effectiveOut) + " s is not after in " +
                Z.round(effectiveIn) + " s");
        }
        time = time === null ? P.trackEnd(track) : Z.inRange("time", time, 0, null);
        time = P.snapTime(sequence, time, ctx, "time");
        timeTicks = Math.round(time * TPS);

        before = P.clipIds(sequence);
        ctx.changed();
        try {
            if (sourceIn !== null || sourceOut !== null) {
                marked = true;
                steps += setMarks(item, sourceIn, sourceOut);
            }
            if (mode === "insert") {
                track.insertClip(item, time);
            } else {
                track.overwriteClip(item, time);
            }
            steps += 1;
        } finally {
            if (marked) {
                try {
                    steps += setMarks(item, origIn !== null ? P.ticksToSeconds(origIn) : null, origOut !== null ? P.ticksToSeconds(origOut) : null);
                } catch (restoreError) {
                    ctx.warn("Could not restore the in/out marks of \"" + item.name + "\": " + String(restoreError.message || restoreError));
                }
            }
        }

        Z.each(P.clipsOf(P.tracksOf(sequence, ref.kind)[ref.index]), function (clip) {
            if (Z.has(before, clip.nodeId)) {
                return;
            }
            if (!placed || Math.abs(Number(clip.start.ticks) - timeTicks) < half) {
                placed = clip;
            }
        });
        if (!placed) {
            throw Z.fail("HOST_ERROR", "Premiere did not place \"" + item.name + "\" on " + label);
        }
        detail = P.clipDetail(sequence, placed, ref.kind, ref.index, false);
        linked = P.linkedOf(placed);
        if (Math.abs(Number(placed.start.ticks) - timeTicks) >= half) {
            ctx.warn("Premiere placed the clip at " + detail.start + " s instead of " + Z.round(time, 4) + " s");
        }
        if (sourceIn !== null && sourceOut !== null && Math.abs(detail.duration - (sourceOut - sourceIn)) > 2 * half / TPS) {
            ctx.warn("The clip is " + detail.duration + " s long, not the " + Z.round(sourceOut - sourceIn, 4) +
                " s asked for (the media may be shorter)");
        }
        return Z.applied("Placed \"" + item.name + "\" on " + label + " at " + detail.start + " s (" + detail.start + "-" +
            detail.end + " s, " + mode + ")" + (linked.length ? " with linked " + linkedLabels(sequence, linked).join(", ") : ""), {
            clip: detail,
            linked: Z.map(linked, function (clip) { return P.clipSummary(sequence, clip); }),
            mode: mode
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_edit_clip

    /** The clip plus (optionally) its linked partners, each as a P.findClip-style record. */
    function withLinked(found, includeLinked) {
        var members = [found];
        if (includeLinked) {
            Z.each(P.linkedOf(found.clip), function (clip) {
                var record = P.refindClip(found.sequence, clip.nodeId);
                if (record) {
                    members.push(record);
                }
            });
        }
        return members;
    }

    function requireAllUnlocked(members) {
        Z.each(members, function (member) {
            P.requireUnlocked(member.track, member.kind, member.trackIndex);
        });
    }

    /**
     * Move clip `nodeId` by deltaTicks unless it is already there (Premiere may
     * move linked clips along with their partner). Returns true when it moved it.
     */
    function shiftClip(sequence, nodeId, originalStart, deltaTicks) {
        var record = P.refindClip(sequence, nodeId);
        var half = Number(sequence.timebase) / 2;
        var clip;
        var start;
        var end;
        if (!record) {
            return false;
        }
        clip = record.clip;
        if (Math.abs(Number(clip.start.ticks) - (originalStart + deltaTicks)) < half) {
            return false;
        }
        if (Z.hasMethod(clip, "move")) {
            clip.move(deltaTicks / TPS);
        } else {
            start = Number(clip.start.ticks) + deltaTicks;
            end = Number(clip.end.ticks) + deltaTicks;
            if (deltaTicks > 0) {
                P.setTimeProperty(clip, "end", end);
                P.setTimeProperty(clip, "start", start);
            } else {
                P.setTimeProperty(clip, "start", start);
                P.setTimeProperty(clip, "end", end);
            }
        }
        return true;
    }

    function moveClip(found, args, ctx, includeLinked) {
        var sequence = found.sequence;
        var clip = found.clip;
        var to = Z.optional(args, "to", "number", null);
        var by = Z.optional(args, "by", "number", null);
        var startTicks = Number(clip.start.ticks);
        var half = Number(sequence.timebase) / 2;
        var target;
        var delta;
        var members;
        var except = {};
        var originals = [];
        var steps = 0;
        var after;
        if ((to === null) === (by === null)) {
            throw Z.refuse("INVALID_ARGUMENT", "move needs exactly one of `to` (new start, seconds) or `by` (shift, seconds)");
        }
        target = to !== null ? Z.inRange("to", to, 0, null) : P.ticksToSeconds(startTicks) + Z.inRange("by", by, null, null);
        if (target < 0) {
            throw Z.refuse("INVALID_ARGUMENT", "The clip would start at " + Z.round(target) + " s, before the start of the sequence");
        }
        target = P.snapTime(sequence, target, ctx, "new start");
        delta = Math.round(target * TPS) - startTicks;
        if (Math.abs(delta) < half) {
            return Z.unchanged("Clip \"" + clip.name + "\" already starts at " + Z.round(target, 4) + " s", {clip: P.clipSummary(sequence, clip)});
        }
        P.requireFeature(Z.hasMethod(clip, "move"), "TrackItem.move", "2021 (15.4)");
        members = withLinked(found, includeLinked);
        requireAllUnlocked(members);
        Z.each(members, function (member) {
            except[member.clip.nodeId] = true;
        });
        Z.each(members, function (member) {
            var start = Number(member.clip.start.ticks) + delta;
            var end = Number(member.clip.end.ticks) + delta;
            var blocking = P.overlapping(member.track, start, end, except);
            if (start < -half) {
                throw Z.refuse("INVALID_ARGUMENT", "Linked \"" + member.clip.name + "\" on " + P.trackLabel(member.kind, member.trackIndex) +
                    " would start at " + Z.round(P.ticksToSeconds(start), 3) + " s, before the start of the sequence");
            }
            if (blocking.length > 0) {
                throw Z.refuse("INVALID_ARGUMENT", "Moving \"" + member.clip.name + "\" to " + Z.round(P.ticksToSeconds(start), 3) + " s on " +
                    P.trackLabel(member.kind, member.trackIndex) + " would overlap \"" + blocking[0].name + "\" (" +
                    P.sec(blocking[0].start) + "-" + P.sec(blocking[0].end) + " s); trim, move or delete it first");
            }
            originals.push({nodeId: member.clip.nodeId, start: Number(member.clip.start.ticks)});
        });
        ctx.changed();
        Z.each(originals, function (original) {
            if (shiftClip(sequence, original.nodeId, original.start, delta)) {
                steps += 1;
            }
        });
        after = P.refindClip(sequence, clip.nodeId);
        if (!after) {
            throw Z.fail("HOST_ERROR", "Clip \"" + clip.name + "\" is gone after the move");
        }
        Z.each(originals, function (original) {
            var now = P.refindClip(sequence, original.nodeId);
            if (now && Math.abs(Number(now.clip.start.ticks) - (original.start + delta)) >= half) {
                ctx.warn("Premiere put \"" + now.clip.name + "\" (" + P.trackLabel(now.kind, now.trackIndex) + ") at " + P.sec(now.clip.start) +
                    " s instead of " + Z.round(P.ticksToSeconds(original.start + delta), 4) + " s");
            }
        });
        return Z.applied("Moved \"" + clip.name + "\" from " + Z.round(P.ticksToSeconds(startTicks), 4) + " s to " +
            P.sec(after.clip.start) + " s" + (members.length > 1 ? " with its linked " + (members.length === 2 ? "clip" : "clips") : ""), {
            clip: P.clipDetail(sequence, after.clip, after.kind, after.trackIndex, false),
            moved: Z.map(originals, function (original) { return original.nodeId; }),
            shift: Z.round(P.ticksToSeconds(delta), 4)
        }, steps);
    }

    function trimClip(found, args, ctx, includeLinked) {
        var sequence = found.sequence;
        var clip = found.clip;
        var newStart = Z.optional(args, "start", "number", null);
        var newEnd = Z.optional(args, "end", "number", null);
        var frameTicks = Number(sequence.timebase);
        var half = frameTicks / 2;
        var startTicks = Number(clip.start.ticks);
        var endTicks = Number(clip.end.ticks);
        var headTicks;
        var tailTicks;
        var headDelta;
        var tailDelta;
        var members = [];
        var except = {};
        var steps = 0;
        var after;
        if (newStart === null && newEnd === null) {
            throw Z.refuse("INVALID_ARGUMENT", "trim needs `start` (new head) and/or `end` (new tail), in sequence seconds");
        }
        P.requireNormalSpeed(clip, "trims");
        headTicks = newStart === null ? startTicks : Math.round(P.snapTime(sequence, Z.inRange("start", newStart, 0, null), ctx, "start") * TPS);
        tailTicks = newEnd === null ? endTicks : Math.round(P.snapTime(sequence, Z.inRange("end", newEnd, 0, null), ctx, "end") * TPS);
        if (tailTicks - headTicks < frameTicks - half / 2) {
            throw Z.refuse("INVALID_ARGUMENT", "The trim would leave less than one frame (" + Z.round(P.ticksToSeconds(headTicks)) + "-" +
                Z.round(P.ticksToSeconds(tailTicks)) + " s)");
        }
        headDelta = Math.abs(headTicks - startTicks) < half ? 0 : headTicks - startTicks;
        tailDelta = Math.abs(tailTicks - endTicks) < half ? 0 : tailTicks - endTicks;
        if (headDelta === 0 && tailDelta === 0) {
            return Z.unchanged("Clip \"" + clip.name + "\" already runs " + P.sec(clip.start) + "-" + P.sec(clip.end) + " s",
                {clip: P.clipSummary(sequence, clip)});
        }
        Z.each(withLinked(found, includeLinked), function (member, i) {
            var head = headDelta !== 0 && Math.abs(Number(member.clip.start.ticks) - startTicks) < half;
            var tail = tailDelta !== 0 && Math.abs(Number(member.clip.end.ticks) - endTicks) < half;
            if (i > 0 && !head && !tail) {
                ctx.warn("Linked \"" + member.clip.name + "\" on " + P.trackLabel(member.kind, member.trackIndex) +
                    " does not share the trimmed edge; it was left as it is");
                return;
            }
            members.push({record: member, head: head, tail: tail});
            except[member.clip.nodeId] = true;
        });
        requireAllUnlocked(Z.map(members, function (member) { return member.record; }));
        Z.each(members, function (member) {
            var record = member.record;
            var newIn;
            var blocking;
            if (member.head) {
                newIn = Number(record.clip.inPoint.ticks) + headDelta;
                if (newIn < -half) {
                    throw Z.refuse("INVALID_ARGUMENT", "\"" + record.clip.name + "\" has only " + Z.round(P.ticksToSeconds(record.clip.inPoint.ticks), 3) +
                        " s of media before its in point; the head cannot move " + Z.round(P.ticksToSeconds(-headDelta), 3) + " s earlier");
                }
                blocking = headDelta < 0 ? P.overlapping(record.track, headTicks, startTicks, except) : [];
                if (blocking.length > 0) {
                    throw Z.refuse("INVALID_ARGUMENT", "Extending the head of \"" + record.clip.name + "\" to " + Z.round(P.ticksToSeconds(headTicks), 3) +
                        " s would overlap \"" + blocking[0].name + "\" on " + P.trackLabel(record.kind, record.trackIndex));
                }
            }
            if (member.tail) {
                blocking = tailDelta > 0 ? P.overlapping(record.track, endTicks, tailTicks, except) : [];
                if (blocking.length > 0) {
                    throw Z.refuse("INVALID_ARGUMENT", "Extending the tail of \"" + record.clip.name + "\" to " + Z.round(P.ticksToSeconds(tailTicks), 3) +
                        " s would overlap \"" + blocking[0].name + "\" on " + P.trackLabel(record.kind, record.trackIndex));
                }
            }
        });

        ctx.changed();
        Z.each(members, function (member) {
            var current;
            if (member.head) {
                current = P.refindClip(sequence, member.record.clip.nodeId);
                if (current) {
                    P.setTimeProperty(current.clip, "start", headTicks);
                    P.setTimeProperty(current.clip, "inPoint", Number(current.clip.inPoint.ticks) + headDelta);
                    steps += 2;
                }
            }
            if (member.tail) {
                current = P.refindClip(sequence, member.record.clip.nodeId);
                if (current) {
                    P.setTimeProperty(current.clip, "end", tailTicks);
                    P.setTimeProperty(current.clip, "outPoint", Number(current.clip.outPoint.ticks) + tailDelta);
                    steps += 2;
                }
            }
        });
        after = P.refindClip(sequence, clip.nodeId);
        if (!after) {
            throw Z.fail("HOST_ERROR", "Clip \"" + clip.name + "\" is gone after the trim");
        }
        if (Math.abs(Number(after.clip.start.ticks) - headTicks) >= half || Math.abs(Number(after.clip.end.ticks) - tailTicks) >= half) {
            ctx.warn("Premiere kept " + P.sec(after.clip.start) + "-" + P.sec(after.clip.end) + " s instead of " +
                Z.round(P.ticksToSeconds(headTicks), 4) + "-" + Z.round(P.ticksToSeconds(tailTicks), 4) + " s (the media may be shorter)");
        }
        return Z.applied("Trimmed \"" + clip.name + "\" to " + P.sec(after.clip.start) + "-" + P.sec(after.clip.end) + " s" +
            (members.length > 1 ? " with its linked " + (members.length === 2 ? "clip" : "clips") : ""), {
            clip: P.clipDetail(sequence, after.clip, after.kind, after.trackIndex, false),
            trimmed: Z.map(members, function (member) { return member.record.clip.nodeId; })
        }, steps);
    }

    function setEnabled(found, enable, ctx, includeLinked) {
        var members = withLinked(found, includeLinked);
        var changing;
        P.requireFeature(found.clip.disabled !== undefined, "TrackItem.disabled", "2021 (15.4)");
        requireAllUnlocked(members);
        changing = Z.filter(members, function (member) {
            return (member.clip.disabled === true) === enable;
        });
        if (changing.length === 0) {
            return Z.unchanged("Clip \"" + found.clip.name + "\" is already " + (enable ? "enabled" : "disabled"),
                {clip: P.clipSummary(found.sequence, found.clip)});
        }
        ctx.changed();
        Z.each(changing, function (member) {
            member.clip.disabled = !enable;
        });
        return Z.applied((enable ? "Enabled " : "Disabled ") + Z.map(changing, function (member) {
            return "\"" + member.clip.name + "\" (" + P.trackLabel(member.kind, member.trackIndex) + ")";
        }).join(", "), {
            clips: Z.map(changing, function (member) { return member.clip.nodeId; }),
            enabled: enable
        }, changing.length);
    }

    function renameClip(found, args, ctx) {
        var name = Z.required(args, "name", "string");
        var old = String(found.clip.name);
        if (Z.trim(name).length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`name` must not be blank");
        }
        if (old === name) {
            return Z.unchanged("Clip is already named \"" + name + "\"", {clip: P.clipSummary(found.sequence, found.clip)});
        }
        ctx.changed();
        found.clip.name = name;
        return Z.applied("Renamed clip \"" + old + "\" to \"" + name + "\"", {clip: P.clipSummary(found.sequence, found.clip), previous_name: old}, 1);
    }

    function setSpeed(found, args, ctx) {
        var sequence = found.sequence;
        var clip = found.clip;
        var speed = Z.inRange("speed", Z.required(args, "speed", "number"), 0.01, 100);
        var reverse = Z.optional(args, "reverse", "boolean", false);
        var pitch = Z.optional(args, "maintain_pitch", "boolean", true);
        var ripple = Z.optional(args, "ripple", "boolean", false);
        var current = P.speedOf(clip);
        var startTicks = Number(clip.start.ticks);
        var endTicks = Number(clip.end.ticks);
        var half = Number(sequence.timebase) / 2;
        var newDuration = Math.round((endTicks - startTicks) * current.speed / speed);
        /** @type {TrackItem | null} */
        var next = null;
        var qeItem;
        var after;
        var now;
        if (Math.abs(current.speed - speed) < 0.0001 && current.reversed === reverse) {
            return Z.unchanged("Clip \"" + clip.name + "\" already plays at " + Z.round(speed * 100, 2) + "%", {clip: P.clipSummary(sequence, clip)});
        }
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        if (!ripple) {
            Z.each(P.clipsOf(found.track), function (other) {
                var start = Number(other.start.ticks);
                if (other.nodeId !== clip.nodeId && start >= endTicks - half && (next === null || start < Number(next.start.ticks))) {
                    next = other;
                }
            });
            if (next && startTicks + newDuration > Number(next.start.ticks) + half) {
                throw Z.refuse("INVALID_ARGUMENT", "At " + Z.round(speed * 100, 2) + "% the clip would run to " +
                    Z.round(P.ticksToSeconds(startTicks + newDuration), 3) + " s, into \"" + next.name + "\" at " + P.sec(next.start) +
                    " s; pass ripple: true or make room first");
            }
        }
        qeItem = P.qeItem(P.qeTrack(P.qeSequence(sequence, ctx), found.kind, found.trackIndex), clip, Number(sequence.timebase));
        if (!Z.hasMethod(qeItem, "setSpeed")) {
            throw Z.refuse("UNSUPPORTED", "This Premiere build's QE DOM has no setSpeed; use Clip > Speed/Duration in Premiere");
        }
        ctx.changed();
        // QE setSpeed(multiplier, new duration in ticks, reverse, maintain pitch, ripple); the two-argument
        // forms throw "Not Enough Parameters" (Adobe_Premiere_Pro_MCP notes). Undocumented: verified below.
        try {
            qeItem.setSpeed(speed, String(newDuration), reverse, pitch, ripple);
        } catch (error) {
            qeItem.setSpeed(speed, "", reverse, pitch, ripple);
        }
        after = P.refindClip(sequence, clip.nodeId);
        if (!after) {
            throw Z.fail("HOST_ERROR", "Clip \"" + clip.name + "\" is gone after the speed change");
        }
        now = P.speedOf(after.clip);
        if (Math.abs(now.speed - speed) > 0.001 || now.reversed !== reverse) {
            throw Z.fail("HOST_ERROR", "QE setSpeed did not take: the clip plays at " + Z.round(now.speed * 100, 2) + "%" +
                (now.reversed ? " reversed" : "") + ", not " + Z.round(speed * 100, 2) + "%" + (reverse ? " reversed" : ""));
        }
        return Z.applied("Set \"" + clip.name + "\" to " + Z.round(speed * 100, 2) + "% speed" + (reverse ? ", reversed" : "") +
            " (" + P.sec(after.clip.start) + "-" + P.sec(after.clip.end) + " s)", {
            clip: P.clipDetail(sequence, after.clip, after.kind, after.trackIndex, false),
            speed: speed,
            reversed: reverse,
            maintain_pitch: pitch,
            ripple: ripple
        }, 1);
    }

    function deleteClip(found, args, ctx, includeLinked) {
        var sequence = found.sequence;
        var ripple = Z.optional(args, "ripple", "boolean", false);
        var members = withLinked(found, includeLinked);
        var removed = [];
        var steps = 0;
        var rippled = [];
        var tracksTouched = {};
        var half = Number(sequence.timebase) / 2;
        var shift;
        var uneven = false;
        var plan = [];
        requireAllUnlocked(members);
        Z.each(members, function (member) {
            removed.push({
                node_id: member.clip.nodeId,
                name: String(member.clip.name),
                track: {kind: member.kind, index: member.trackIndex},
                start: Number(member.clip.start.ticks),
                end: Number(member.clip.end.ticks)
            });
        });
        ctx.changed();
        Z.each(removed, function (entry) {
            var current = P.refindClip(sequence, entry.node_id);
            if (current) {
                // remove(ripple, alignToVideo): ripple is done below, explicitly.
                current.clip.remove(false, true);
                steps += 1;
            }
        });
        Z.each(removed, function (entry) {
            if (P.refindClip(sequence, entry.node_id)) {
                throw Z.fail("HOST_ERROR", "Premiere did not delete \"" + entry.name + "\"");
            }
        });
        if (ripple) {
            // One shift for every track, the smallest gap: linked clips with different extents (a J or L
            // cut) stay in sync, and no track's later clips can run into what is before its gap.
            shift = null;
            Z.each(removed, function (entry) {
                shift = shift === null ? entry.end - entry.start : Math.min(shift, entry.end - entry.start);
            });
            Z.each(removed, function (entry) {
                if (entry.end - entry.start - shift >= half) {
                    uneven = true;
                }
            });
            // Every touched track's later clips, with their starts, before anything moves: Premiere may
            // drag a linked partner along, and shiftClip then sees it is already in place.
            Z.each(removed, function (entry) {
                var key = entry.track.kind + entry.track.index;
                if (Z.has(tracksTouched, key)) {
                    return;
                }
                tracksTouched[key] = true;
                plan.push({
                    track: entry.track,
                    later: Z.map(Z.filter(P.clipsOf(P.tracksOf(sequence, entry.track.kind)[entry.track.index]), function (clip) {
                        return Number(clip.start.ticks) >= entry.end - half;
                    }), function (clip) {
                        return {nodeId: clip.nodeId, start: Number(clip.start.ticks)};
                    })
                });
            });
            Z.each(plan, function (entry) {
                var moved = 0;
                Z.each(entry.later, function (clip) {
                    if (shiftClip(sequence, clip.nodeId, clip.start, -shift)) {
                        moved += 1;
                        steps += 1;
                    }
                });
                rippled.push({track: entry.track, closed: Z.round(P.ticksToSeconds(shift), 4), moved: moved});
            });
            ctx.warn("Ripple closed the gap on " + Z.map(rippled, function (r) { return P.trackLabel(r.track.kind, r.track.index); }).join(", ") +
                " only; clips on other tracks did not move (Premiere's sync lock is not scriptable)");
            if (uneven) {
                ctx.warn("The linked clips had different lengths (a J or L cut); every track closed " +
                    Z.round(P.ticksToSeconds(shift), 4) + " s to keep them in sync, leaving the rest of the longer gap");
            }
        }
        Z.each(removed, function (entry) {
            entry.start = Z.round(P.ticksToSeconds(entry.start), 4);
            entry.end = Z.round(P.ticksToSeconds(entry.end), 4);
        });
        return Z.applied("Deleted \"" + found.clip.name + "\"" + (removed.length > 1 ? " and " + Z.plural(removed.length - 1, "linked clip") : "") +
            (ripple ? " and closed the gap" : ""), {
            deleted: removed,
            rippled: rippled
        }, steps);
    }

    Z.register("premiere_edit_clip", function (args, ctx) {
        var action = Z.oneOf("action", Z.required(args, "action", "string"), ["move", "trim", "enable", "disable", "rename", "speed", "delete"]);
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var includeLinked = Z.optional(args, "include_linked", "boolean", true);
        switch (action) {
        case "move":
            return moveClip(found, args, ctx, includeLinked);
        case "trim":
            return trimClip(found, args, ctx, includeLinked);
        case "enable":
            return setEnabled(found, true, ctx, includeLinked);
        case "disable":
            return setEnabled(found, false, ctx, includeLinked);
        case "rename":
            P.requireUnlocked(found.track, found.kind, found.trackIndex);
            return renameClip(found, args, ctx);
        case "speed":
            return setSpeed(found, args, ctx);
        default:
            return deleteClip(found, args, ctx, includeLinked);
        }
    });

    // ------------------------------------------------------------------
    // premiere_razor

    Z.register("premiere_razor", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var time = P.snapTime(sequence, Z.inRange("time", Z.required(args, "time", "number"), 0, null), ctx, "time");
        var ticks = Math.round(time * TPS);
        var half = Number(sequence.timebase) / 2;
        var refs = Z.optional(args, "tracks", "array", null);
        var targets = [];
        var seen = {};
        var cuts = [];
        var qeSequence;
        var timecode;
        var kinds = ["video", "audio"];
        var k;
        var t;
        var tracks;

        function clipAt(track) {
            var hit = null;
            Z.each(P.clipsOf(track), function (clip) {
                if (Number(clip.start.ticks) < ticks - half && Number(clip.end.ticks) > ticks + half) {
                    hit = clip;
                }
            });
            return hit;
        }

        if (refs !== null) {
            Z.each(refs, function (ref) {
                var track = P.findTrack(sequence, ref);
                var key = ref.kind + ref.index;
                P.requireUnlocked(track, ref.kind, ref.index);
                if (Z.has(seen, key)) {
                    return;
                }
                seen[key] = true;
                if (clipAt(track)) {
                    targets.push({kind: ref.kind, index: ref.index});
                } else {
                    ctx.warn("Nothing to cut on " + P.trackLabel(ref.kind, ref.index) + " at " + Z.round(time, 4) + " s");
                }
            });
        } else {
            for (k = 0; k < kinds.length; k += 1) {
                tracks = P.tracksOf(sequence, kinds[k]);
                for (t = 0; t < tracks.numTracks; t += 1) {
                    if (clipAt(tracks[t])) {
                        if (P.isLocked(tracks[t])) {
                            ctx.warn("Skipped locked track " + P.trackLabel(kinds[k], t));
                        } else {
                            targets.push({kind: kinds[k], index: t});
                        }
                    }
                }
            }
        }
        if (targets.length === 0) {
            return Z.unchanged("No clip spans " + Z.round(time, 4) + " s" + (refs !== null ? " on those tracks" : ""), {time: time, cuts: []});
        }

        qeSequence = P.qeSequence(sequence, ctx);
        timecode = P.timecode(sequence, time);
        ctx.changed();
        Z.each(targets, function (target) {
            var left = null;
            var right = null;
            P.qeTrack(qeSequence, target.kind, target.index).razor(timecode);
            Z.each(P.clipsOf(P.tracksOf(sequence, target.kind)[target.index]), function (clip) {
                if (Math.abs(Number(clip.start.ticks) - ticks) < half) {
                    right = clip;
                }
                if (Math.abs(Number(clip.end.ticks) - ticks) < half) {
                    left = clip;
                }
            });
            if (left && right) {
                cuts.push({
                    track: {kind: target.kind, index: target.index},
                    left: P.clipSummary(sequence, left),
                    right: P.clipSummary(sequence, right)
                });
            } else {
                ctx.warn("Premiere did not cut " + P.trackLabel(target.kind, target.index) + " at " + timecode);
            }
        });
        if (cuts.length === 0) {
            throw Z.fail("HOST_ERROR", "The QE razor made no cut at " + timecode);
        }
        return Z.applied("Cut " + Z.plural(cuts.length, "clip") + " at " + Z.round(time, 4) + " s (" +
            Z.map(cuts, function (cut) { return P.trackLabel(cut.track.kind, cut.track.index); }).join(", ") + ")", {
            time: Z.round(time, 4),
            timecode: timecode,
            cuts: cuts
        }, cuts.length);
    });
}(ZenviLink));
// ---- ppro/40-motion.jsx ----
// Zenvi Link: Premiere Pro clip properties and keyframes.
// premiere_set_clip_properties, premiere_animate.
//
// Built-in components: Motion (AE.ADBE Motion: Position, Scale, Scale Width,
// Uniform Scale, Rotation, Anchor Point, Anti-flicker Filter), Opacity
// (AE.ADBE Opacity: Opacity, Blend Mode), audio Volume (Bypass, Level).
// Position and Anchor Point are normalised (0-1) in scripting; Level is linear
// gain with +15 dB = 1 (00-ppro-core.jsx: dbToLevel).

(function (Z) {
    var P = Z.ppro;
    var TASTE = Z.TASTE;

    function isPoint(value) {
        return Z.isArray(value) && value.length === 2 && typeof value[0] === "number" && typeof value[1] === "number" &&
            isFinite(value[0]) && isFinite(value[1]);
    }

    function sameValue(a, b) {
        var i;
        if (Z.isArray(a) || (a && typeof a === "object" && typeof a.length === "number")) {
            if (!b || typeof b.length !== "number" || a.length !== b.length) {
                return false;
            }
            for (i = 0; i < a.length; i += 1) {
                if (Math.abs(Number(a[i]) - Number(b[i])) > 0.00001) {
                    return false;
                }
            }
            return true;
        }
        return typeof a === "number" && typeof b === "number" ? Math.abs(a - b) <= 0.00001 : a === b;
    }

    /**
     * The built-in property `name` of a clip: {label, component, param,
     * toDom(value), fromDom(value)}; refuses when the clip has no such property.
     */
    P.builtinProperty = function (found, name) {
        var sequence = found.sequence;
        var clip = found.clip;
        var component;
        var spec;
        var param;
        var video = {
            position: [P.motionOf, "Motion", P.MOTION_PARAMS.position],
            scale: [P.motionOf, "Motion", P.MOTION_PARAMS.scale],
            rotation: [P.motionOf, "Motion", P.MOTION_PARAMS.rotation],
            anchor: [P.motionOf, "Motion", P.MOTION_PARAMS.anchor],
            opacity: [P.opacityOf, "Opacity", P.OPACITY_PARAMS.opacity],
            blend_mode: [P.opacityOf, "Opacity", P.OPACITY_PARAMS.blend]
        };
        if (name === "volume" || name === "volume_db") {
            if (found.kind !== "audio") {
                throw Z.refuse("INVALID_ARGUMENT", "Volume applies to audio clips; \"" + clip.name + "\" is on video track " +
                    P.trackLabel(found.kind, found.trackIndex) + " (use its linked audio clip)");
            }
            component = P.volumeOf(clip);
            param = component ? P.findParam(component, ["Level"], 1) : null;
            if (!param) {
                throw Z.refuse("UNSUPPORTED", "Clip \"" + clip.name + "\" has no Volume > Level parameter");
            }
            return {
                label: "Volume > Level",
                component: component,
                param: param,
                unit: "dB",
                toDom: function (db) { return P.dbToLevel(db); },
                fromDom: function (value) { return P.levelToDb(value); }
            };
        }
        spec = video[name];
        if (!spec) {
            throw Z.refuse("INVALID_ARGUMENT", "Unknown property " + name);
        }
        if (found.kind !== "video") {
            throw Z.refuse("INVALID_ARGUMENT", name + " applies to video clips; \"" + clip.name + "\" is on audio track " +
                P.trackLabel(found.kind, found.trackIndex));
        }
        component = spec[0](clip);
        param = component ? P.findParam(component, [spec[2][0]], spec[2][1]) : null;
        if (!param) {
            throw Z.refuse("UNSUPPORTED", "Clip \"" + clip.name + "\" has no " + spec[1] + " > " + spec[2][0] + " parameter");
        }
        return {
            label: spec[1] + " > " + spec[2][0],
            component: component,
            param: param,
            unit: name === "position" ? "px" : name === "anchor" ? "fraction" : name === "rotation" ? "deg" : name === "blend_mode" ? "" : "%",
            toDom: function (value) {
                if (name === "position") {
                    return P.positionToDom(sequence, value);
                }
                if (name === "blend_mode") {
                    return Z.indexOf(P.BLEND_MODES, value);
                }
                return value;
            },
            fromDom: function (value) {
                if (name === "position") {
                    return P.positionFromDom(sequence, value);
                }
                if (name === "anchor") {
                    return value && typeof value.length === "number" ? [Z.round(Number(value[0]), 4), Z.round(Number(value[1]), 4)] : null;
                }
                if (name === "blend_mode") {
                    return P.blendModeName(value);
                }
                return typeof value === "number" ? Z.round(value, 4) : value;
            }
        };
    };

    // ------------------------------------------------------------------
    // premiere_set_clip_properties

    var STATIC_KEYS = ["position", "scale", "rotation", "anchor", "opacity", "blend_mode", "volume_db"];

    function checkStatic(key, value) {
        switch (key) {
        case "position":
        case "anchor":
            if (!isPoint(value)) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be [x, y]");
            }
            return value;
        case "scale":
            return Z.inRange(key, value, 0, 10000);
        case "rotation":
            return Z.inRange(key, value, -36000, 36000);
        case "opacity":
            return Z.inRange(key, value, 0, 100);
        case "blend_mode":
            return Z.oneOf(key, value, P.BLEND_MODES);
        default:
            return Z.inRange(key, value, -96, 15);
        }
    }

    Z.register("premiere_set_clip_properties", function (args, ctx) {
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var clearKeys = Z.optional(args, "clear_keyframes", "boolean", false);
        var requested = [];
        var animated = [];
        var changes = [];
        var values = {};
        var before = {};
        var steps = 0;

        Z.each(STATIC_KEYS, function (key) {
            if (Z.has(args, key) && args[key] !== null && args[key] !== undefined) {
                requested.push({key: key, value: checkStatic(key, args[key])});
            }
        });
        if (requested.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "Pass at least one of " + STATIC_KEYS.join(", "));
        }
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        Z.each(requested, function (entry) {
            entry.property = P.builtinProperty(found, entry.key);
            entry.dom = entry.property.toDom(entry.value);
            if (P.isAnimated(entry.property.param)) {
                animated.push(entry.property.label);
            }
        });
        if (animated.length > 0 && !clearKeys) {
            throw Z.refuse("INVALID_ARGUMENT", animated.join(", ") + (animated.length === 1 ? " is" : " are") +
                " animated (has keyframes); change the keyframes with premiere_animate, or pass clear_keyframes: true");
        }
        Z.each(requested, function (entry) {
            var current = P.valueOf(entry.property.param);
            before[entry.key] = entry.property.fromDom(current);
            if (P.isAnimated(entry.property.param) || !sameValue(current, entry.dom)) {
                changes.push(entry);
            }
        });
        if (changes.length === 0) {
            return Z.unchanged("Clip \"" + found.clip.name + "\" already has those values", {clip: found.clip.nodeId, values: before});
        }

        ctx.changed();
        Z.each(changes, function (entry) {
            var param = entry.property.param;
            var stored;
            if (P.isAnimated(param)) {
                param.setTimeVarying(false);
                steps += 1;
            }
            param.setValue(entry.dom, true);
            steps += 1;
            stored = P.valueOf(param);
            values[entry.key] = entry.property.fromDom(stored);
            if (!sameValue(stored, entry.dom)) {
                ctx.warn("Premiere stored " + JSON.stringify(values[entry.key]) + " for " + entry.key + " (asked " + JSON.stringify(entry.value) + ")");
            }
        });
        return Z.applied("Set " + Z.map(changes, function (entry) {
            return entry.key + " " + JSON.stringify(entry.value);
        }).join(", ") + " on \"" + found.clip.name + "\"", {
            clip: found.clip.nodeId,
            values: values,
            before: before
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_animate

    /** setInterpolationTypeAtKey values (scripting guide, ComponentParam): 1-3 are the legacy ease modes. */
    P.INTERPOLATION = {linear: 0, "ease-in": 1, "ease-out": 2, "ease-in-out": 3, hold: 4, bezier: 5};

    var INTERPOLATION_NAMES = ["linear", "ease-in", "ease-out", "ease-in-out", "hold", "bezier"];

    /** A TASTE easing name or {x1, y1, x2, y2} -> "hold" or [x1, y1, x2, y2]; refuses unknown names. */
    P.easingCurve = function (value, key) {
        var curves = TASTE.easing.curves;
        if (value === "hold") {
            return "hold";
        }
        if (typeof value === "string") {
            if (!Z.has(curves, value)) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a TASTE easing (" + Object.keys(curves).join(", ") + ", hold) or {x1, y1, x2, y2}");
            }
            return curves[value];
        }
        if (Z.isObject(value) && typeof value.x1 === "number" && typeof value.y1 === "number" && typeof value.x2 === "number" &&
                typeof value.y2 === "number" && value.x1 >= 0 && value.x1 <= 1 && value.x2 >= 0 && value.x2 <= 1) {
            return [value.x1, value.y1, value.x2, value.y2];
        }
        throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a TASTE easing name or {x1, y1, x2, y2} with x in 0-1");
    };

    function isLinearCurve(curve) {
        return curve !== "hold" && Math.abs(curve[0] - curve[1]) < 0.0001 && Math.abs(curve[2] - curve[3]) < 0.0001;
    }

    /** The segment leaves its first key at rest (outgoing speed under half the average). */
    function startsAtRest(curve) {
        return curve !== "hold" && !isLinearCurve(curve) && curve[0] > 0 && curve[1] / curve[0] < 0.5;
    }

    /** The segment arrives at its second key at rest. */
    function endsAtRest(curve) {
        return curve !== "hold" && !isLinearCurve(curve) && curve[2] < 1 && (1 - curve[3]) / (1 - curve[2]) < 0.5;
    }

    /**
     * Premiere interpolation per key from the easing of the segments around it
     * (TASTE 2): hold where the outgoing segment holds, linear between linear
     * segments, ease-in where the incoming segment arrives at rest, ease-out
     * where the outgoing one leaves from rest, both for a resting key in the
     * middle, else Bezier (never linear on a key that moves non-linearly).
     */
    P.interpolationModes = function (curves) {
        var modes = [];
        var count = curves.length + 1;
        var i;
        var incoming;
        var outgoing;
        var easeIn;
        var easeOut;
        for (i = 0; i < count; i += 1) {
            incoming = i > 0 ? curves[i - 1] : null;
            outgoing = i < curves.length ? curves[i] : null;
            if (outgoing === "hold") {
                modes.push(P.INTERPOLATION.hold);
                continue;
            }
            if ((incoming === null || incoming === "hold" || isLinearCurve(incoming)) && (outgoing === null || isLinearCurve(outgoing))) {
                modes.push(P.INTERPOLATION.linear);
                continue;
            }
            easeIn = incoming !== null && endsAtRest(incoming);
            easeOut = outgoing !== null && startsAtRest(outgoing);
            modes.push(easeIn && easeOut ? P.INTERPOLATION["ease-in-out"] : easeIn ? P.INTERPOLATION["ease-in"] :
                easeOut ? P.INTERPOLATION["ease-out"] : P.INTERPOLATION.bezier);
        }
        return modes;
    };

    /** Set a key's interpolation; the legacy ease modes fall back to Bezier when Premiere rejects them. Returns the mode set. */
    function setInterpolation(param, time, mode, state) {
        var result;
        try {
            result = param.setInterpolationTypeAtKey(time, mode, true);
            if (result === false || (typeof result === "number" && result !== 0)) {
                throw new Error("returned " + String(result));
            }
            return mode;
        } catch (error) {
            if (mode === 1 || mode === 2 || mode === 3) {
                param.setInterpolationTypeAtKey(time, P.INTERPOLATION.bezier, true);
                state.fallbacks += 1;
                return P.INTERPOLATION.bezier;
            }
            throw error;
        }
    }

    function isWanted(wanted, ticks, tolerance) {
        var i;
        for (i = 0; i < wanted.length; i += 1) {
            if (Math.abs(wanted[i] - ticks) < tolerance) {
                return true;
            }
        }
        return false;
    }

    /** The animated parameter: a built-in name or {effect, param}. */
    function animatedTarget(found, property) {
        var builtin;
        var components;
        /** @type {Component | null} */
        var component = null;
        var param;
        if (typeof property === "string") {
            builtin = P.builtinProperty(found, property);
            builtin.name = property;
            return builtin;
        }
        if (!Z.isObject(property) || typeof property.effect !== "string" || typeof property.param !== "string") {
            throw Z.refuse("INVALID_ARGUMENT", "`property` must be position, scale, rotation, anchor, opacity, volume or {effect, param}");
        }
        components = P.componentsOf(found.clip);
        Z.each(components, function (candidate) {
            if (!component && String(candidate.displayName).toLowerCase() === property.effect.toLowerCase()) {
                component = candidate;
            }
        });
        if (!component) {
            throw Z.refuse("NOT_FOUND", "Clip \"" + found.clip.name + "\" has no effect \"" + property.effect + "\" (it has: " +
                Z.map(components, function (c) { return String(c.displayName); }).join(", ") + "); add it with premiere_apply_effect");
        }
        param = P.findParam(component, [property.param]);
        if (!param) {
            throw Z.refuse("NOT_FOUND", "Effect \"" + component.displayName + "\" has no parameter \"" + property.param + "\" (it has: " +
                P.paramNames(component).join(", ") + ")");
        }
        return {
            name: "effect",
            label: String(component.displayName) + " > " + String(param.displayName),
            component: component,
            param: param,
            unit: "",
            toDom: function (value) { return value; },
            fromDom: function (value) { return value; }
        };
    }

    function checkKeyValue(target, value, i) {
        var key = "keyframes[" + i + "].value";
        switch (target.name) {
        case "position":
        case "anchor":
            if (!isPoint(value)) {
                throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be [x, y] for " + target.name);
            }
            return value;
        case "scale":
            return Z.inRange(key, value, 0, 10000);
        case "rotation":
            return Z.inRange(key, value, -36000, 36000);
        case "opacity":
            return Z.inRange(key, value, 0, 100);
        case "volume":
            return Z.inRange(key, value, -96, 15);
        default:
            if (typeof value === "number" && isFinite(value)) {
                return value;
            }
            if (Z.isArray(value) && value.length >= 2 && value.length <= 4) {
                Z.each(value, function (part) {
                    if (typeof part !== "number" || !isFinite(part)) {
                        throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a number or an array of 2-4 numbers");
                    }
                });
                return value;
            }
            throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a number or an array of 2-4 numbers");
        }
    }

    Z.register("premiere_animate", function (args, ctx) {
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var sequence = found.sequence;
        var clip = found.clip;
        var raw = Z.required(args, "keyframes", "array");
        var defaultCurve = P.easingCurve(Z.optional(args, "easing", "any", TASTE.easing["default"]), "easing");
        var replace = Z.optional(args, "replace", "boolean", true);
        var target;
        var duration = P.timeToSeconds(clip.end) - P.timeToSeconds(clip.start);
        var startSeconds = P.timeToSeconds(clip.start);
        var frame = P.frameSeconds(sequence);
        var keys = [];
        var curves = [];
        var modes;
        var param;
        var state = {fallbacks: 0};
        var steps = 0;
        var wanted = [];
        var turnedOn = false;
        var existing;
        var i;

        if (raw.length < 2) {
            throw Z.refuse("INVALID_ARGUMENT", "`keyframes` needs at least two keyframes");
        }
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        P.requireNormalSpeed(clip, "keyframes");
        target = animatedTarget(found, Z.required(args, "property", "any"));
        param = target.param;
        if (Z.hasMethod(param, "areKeyframesSupported") && param.areKeyframesSupported() === false) {
            throw Z.refuse("UNSUPPORTED", target.label + " cannot be keyframed");
        }

        Z.each(raw, function (entry, n) {
            var time;
            var snapped;
            if (!Z.isObject(entry)) {
                throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + n + "]` must be {time, value, easing?}");
            }
            time = Z.inRange("keyframes[" + n + "].time", Z.required(entry, "time", "number"), 0, null);
            if (time > duration + frame / 2) {
                throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + n + "].time` " + Z.round(time) + " s is past the end of the clip (" +
                    Z.round(duration) + " s long); times count from the clip's first frame");
            }
            snapped = P.snapTime(sequence, startSeconds + time, ctx, "keyframes[" + n + "].time") - startSeconds;
            keys.push({
                time: Math.max(0, Z.round(snapped, 6)),
                value: checkKeyValue(target, Z.required(entry, "value", "any"), n),
                curve: Z.has(entry, "easing") && entry.easing !== null ? P.easingCurve(entry.easing, "keyframes[" + n + "].easing") : defaultCurve
            });
        });
        keys.sort(function (a, b) { return a.time - b.time; });
        for (i = 1; i < keys.length; i += 1) {
            if (Math.abs(keys[i].time - keys[i - 1].time) < frame / 2) {
                throw Z.refuse("INVALID_ARGUMENT", "Two keyframes land on the same frame (" + Z.round(keys[i].time, 4) + " s)");
            }
        }
        for (i = 0; i < keys.length - 1; i += 1) {
            curves.push(keys[i].curve);
        }
        modes = P.interpolationModes(curves);

        ctx.changed();
        if (replace && P.isAnimated(param)) {
            param.setTimeVarying(false);
            steps += 1;
        }
        if (!P.isAnimated(param)) {
            param.setTimeVarying(true);
            turnedOn = true;
            steps += 1;
        }
        Z.each(keys, function (key, n) {
            key.at = P.keyTime(clip, key.time);
            wanted.push(Number(key.at.ticks));
            param.addKey(key.at);
            param.setValueAtKey(key.at, target.toDom(key.value), true);
            steps += 2;
            key.mode = modes[n];
        });
        Z.each(keys, function (key) {
            key.mode = setInterpolation(param, key.at, key.mode, state);
            steps += 1;
        });
        if ((replace || turnedOn) && Z.hasMethod(param, "getKeys")) {
            // Turning animation on can leave a key at the playhead: when this call turned it on (or
            // replaces), only its own keys remain (within half a frame, in case Premiere moved a key onto
            // its own grid).
            existing = param.getKeys() || [];
            for (i = 0; i < existing.length; i += 1) {
                if (existing[i] && !isWanted(wanted, Number(existing[i].ticks), Number(sequence.timebase) / 2)) {
                    param.removeKey(existing[i]);
                    steps += 1;
                }
            }
        }
        if (state.fallbacks > 0) {
            ctx.warn("Premiere rejected the ease-in/ease-out interpolation on " + Z.plural(state.fallbacks, "key") +
                "; those keys use Bezier instead");
        }
        return Z.applied("Animated " + target.label + " on \"" + clip.name + "\": " + Z.plural(keys.length, "keyframe") + " " +
            Z.round(keys[0].time, 3) + "-" + Z.round(keys[keys.length - 1].time, 3) + " s (" +
            Z.map(keys, function (key) { return INTERPOLATION_NAMES[key.mode]; }).join(", ") + ")", {
            clip: clip.nodeId,
            property: target.label,
            keyframes: Z.map(keys, function (key) {
                return {
                    time: key.time,
                    sequence_time: Z.round(startSeconds + key.time, 4),
                    value: key.value,
                    interpolation: INTERPOLATION_NAMES[key.mode]
                };
            })
        }, steps);
    });
}(ZenviLink));
// ---- ppro/50-effects.jsx ----
// Zenvi Link: Premiere Pro effects, transitions and looks.
// premiere_apply_effect, premiere_add_transition, premiere_apply_look.
//
// Effects and transitions are added through the QE DOM (Adobe has no DOM call
// for either): qe.project.getVideoEffectByName / getAudioEffectByName and
// QE track item addVideoEffect / addAudioEffect; getVideoTransitionByName /
// getAudioTransitionByName and addTransition. Parameters are then set through
// the documented component API.

(function (Z) {
    var P = Z.ppro;
    var TASTE = Z.TASTE;

    /** Names from a QE list (getVideoEffectList etc.): entries are strings or objects with .name. */
    function qeNames(list) {
        var names = [];
        var count;
        var i;
        var entry;
        if (!list) {
            return names;
        }
        count = typeof list.numItems === "number" ? list.numItems : list.length;
        for (i = 0; i < count; i += 1) {
            entry = list[i];
            if (typeof entry === "string") {
                names.push(entry);
            } else if (entry && entry.name) {
                names.push(String(entry.name));
            }
        }
        return names;
    }

    /** Up to five catalogue names that contain the query (or a word of it), for refusals. */
    function suggestions(names, query) {
        var lower = query.toLowerCase();
        var words = Z.filter(lower.split(/\s+/), function (word) { return word.length > 2; });
        var hits = Z.filter(names, function (name) {
            var candidate = name.toLowerCase();
            var i;
            if (candidate.indexOf(lower) >= 0 || lower.indexOf(candidate) >= 0) {
                return true;
            }
            for (i = 0; i < words.length; i += 1) {
                if (candidate.indexOf(words[i]) >= 0) {
                    return true;
                }
            }
            return false;
        });
        return hits.slice(0, 5);
    }

    /** A QE effect or transition object by name; refuses NOT_FOUND with close names when Premiere lists them. */
    function qeByName(kind, what, name) {
        var project = P.qe().project;
        var getter = (kind === "video" ? "getVideo" : "getAudio") + (what === "effect" ? "EffectByName" : "TransitionByName");
        var lister = (kind === "video" ? "getVideo" : "getAudio") + (what === "effect" ? "EffectList" : "TransitionList");
        var found = null;
        var names = [];
        var close;
        try {
            found = project[getter](name);
        } catch (error) {
            found = null;
        }
        if (found) {
            return found;
        }
        try {
            names = Z.hasMethod(project, lister) ? qeNames(project[lister]()) : [];
        } catch (error2) {
            names = [];
        }
        close = suggestions(names, name);
        throw Z.refuse("NOT_FOUND", "No " + kind + " " + what + " named \"" + name + "\" in Premiere's Effects panel" +
            (close.length ? " (did you mean " + close.join(", ") + "?)" : "") +
            "; names are as Premiere shows them in its own language");
    }

    function qeItemFor(found, ctx) {
        var sequence = found.sequence;
        return P.qeItem(P.qeTrack(P.qeSequence(sequence, ctx), found.kind, found.trackIndex), found.clip, Number(sequence.timebase));
    }

    /** Add a QE effect to a clip; returns the new component (the last one) or fails. */
    P.addEffect = function (found, effect, effectName, ctx, resolvedItem) {
        var qeItem = resolvedItem || qeItemFor(found, ctx);
        var before = P.componentsOf(found.clip).length;
        var again;
        var components;
        ctx.changed();
        if (found.kind === "video") {
            qeItem.addVideoEffect(effect);
        } else {
            qeItem.addAudioEffect(effect);
        }
        again = P.refindClip(found.sequence, found.clip.nodeId) || found;
        components = P.componentsOf(again.clip);
        if (components.length <= before) {
            throw Z.fail("HOST_ERROR", "Premiere did not add \"" + effectName + "\" to \"" + found.clip.name + "\"");
        }
        return {component: components[components.length - 1], index: components.length - 1, clip: again.clip};
    };

    // ------------------------------------------------------------------
    // premiere_apply_effect

    function checkParamValue(value, i) {
        var key = "params[" + i + "].value";
        if (typeof value === "boolean" || (typeof value === "number" && isFinite(value))) {
            return value;
        }
        if (Z.isArray(value) && value.length >= 2 && value.length <= 4) {
            Z.each(value, function (part) {
                if (typeof part !== "number" || !isFinite(part)) {
                    throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must hold numbers");
                }
            });
            return value;
        }
        throw Z.refuse("INVALID_ARGUMENT", "`" + key + "` must be a number, true/false or an array of 2-4 numbers");
    }

    Z.register("premiere_apply_effect", function (args, ctx) {
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var name = Z.trim(Z.required(args, "effect", "string"));
        var params = Z.optional(args, "params", "array", []);
        var effect;
        var added;
        var set = [];
        var missing = [];
        var steps = 1;
        if (name.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`effect` must not be blank");
        }
        Z.each(params, function (entry, i) {
            if (!Z.isObject(entry) || typeof entry.name !== "string" || entry.name.length === 0) {
                throw Z.refuse("INVALID_ARGUMENT", "`params[" + i + "]` must be {name, value}");
            }
            checkParamValue(entry.value, i);
        });
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        effect = qeByName(found.kind, "effect", name);
        added = P.addEffect(found, effect, name, ctx);
        Z.each(params, function (entry) {
            var param = P.findParam(added.component, [entry.name]);
            var stored;
            if (!param) {
                missing.push(entry.name);
                return;
            }
            param.setValue(entry.value, true);
            steps += 1;
            stored = P.valueOf(param);
            set.push({name: String(param.displayName), value: stored});
            if (typeof entry.value === "number" && typeof stored === "number" && Math.abs(stored - entry.value) > 0.0001) {
                ctx.warn("Premiere stored " + stored + " for " + param.displayName + " (asked " + entry.value + ")");
            }
        });
        if (missing.length > 0) {
            ctx.warn("\"" + added.component.displayName + "\" has no parameter " + missing.join(", ") + "; it has: " +
                P.paramNames(added.component).join(", "));
        }
        return Z.applied("Applied " + added.component.displayName + " to \"" + found.clip.name + "\"" +
            (set.length ? " (" + Z.map(set, function (p) { return p.name + " " + JSON.stringify(p.value); }).join(", ") + ")" : ""), {
            clip: found.clip.nodeId,
            effect: {
                index: added.index,
                name: String(added.component.displayName),
                match_name: String(added.component.matchName),
                params: P.paramNames(added.component)
            },
            set: set,
            missing: missing
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_add_transition

    var DEFAULT_TRANSITION = {video: "Cross Dissolve", audio: "Constant Power"};

    /** The transitions of a track: [{name, start, end (ticks), key}]. */
    function transitionsOf(track) {
        var list = track.transitions;
        var out = [];
        var i;
        for (i = 0; list && i < list.numItems; i += 1) {
            out.push({
                name: String(list[i].name || ""),
                start: Number(list[i].start.ticks),
                end: Number(list[i].end.ticks),
                key: String(list[i].name || "") + "@" + String(list[i].start.ticks) + "-" + String(list[i].end.ticks)
            });
        }
        return out;
    }

    /**
     * QE addTransition. The signature used on Premiere 25-26 (premiere-pro-mcp
     * and Adobe_Premiere_Pro_MCP, both live-tested): (transition, atStart,
     * duration timecode, offset, alignment 0.5 = centred on the cut,
     * singleSided, alignToVideo). Older builds take fewer arguments; each
     * fallback is reported.
     */
    function addTransitionAt(qeItem, transition, atStart, durationTimecode, ctx) {
        var errors = [];
        var attempts = [
            {count: 7, run: function () { return qeItem.addTransition(transition, atStart, durationTimecode, "0", 0.5, false, true); }},
            {count: 3, run: function () { return qeItem.addTransition(transition, atStart, durationTimecode); }},
            {count: 2, run: function () { return qeItem.addTransition(transition, atStart); }}
        ];
        var i;
        for (i = 0; i < attempts.length; i += 1) {
            try {
                attempts[i].run();
                if (i > 0) {
                    ctx.warn("QE addTransition took " + attempts[i].count + " arguments on this Premiere build" +
                        (attempts[i].count < 3 ? "; the duration is Premiere's default" : ""));
                }
                return;
            } catch (error) {
                errors.push(String(error && error.message ? error.message : error));
            }
        }
        throw Z.fail("HOST_ERROR", "QE addTransition failed: " + errors.join("; "));
    }

    Z.register("premiere_add_transition", function (args, ctx) {
        var found = P.findClip(Z.required(args, "clip", "string"), args.sequence);
        var sequence = found.sequence;
        var clip = found.clip;
        var at = Z.oneOf("at", Z.optional(args, "at", "string", "end"), ["end", "start", "both"]);
        var name = Z.optional(args, "transition", "string", DEFAULT_TRANSITION[found.kind]);
        var duration = Z.inRange("duration", Z.optional(args, "duration", "number", TASTE.timing.crossDissolve["default"]), 0, 30);
        var fps = P.fps(sequence);
        var frames = Math.max(1, Math.round(duration * fps));
        var snapped = frames / fps;
        var clipLength = P.timeToSeconds(clip.end) - P.timeToSeconds(clip.start);
        var edges = at === "both" ? ["start", "end"] : [at];
        var transition;
        var qeItem;
        var before = {};
        var added = [];
        var missing = [];
        var replaced = 0;
        var list;
        var half = Number(sequence.timebase) / 2;

        if (duration <= 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`duration` must be more than 0 s");
        }
        if (Math.abs(snapped - duration) >= 0.0005) {
            ctx.warn("Snapped the duration " + Z.round(duration) + " s to " + frames + " frames (" + Z.round(snapped) + " s)");
        }
        if (snapped * edges.length > clipLength + 0.0005) {
            throw Z.refuse("INVALID_ARGUMENT", "A " + Z.round(snapped, 3) + " s transition at " + (edges.length === 2 ? "both ends" : "the " + at) +
                " is longer than clip \"" + clip.name + "\" (" + Z.round(clipLength, 3) + " s)");
        }
        P.requireUnlocked(found.track, found.kind, found.trackIndex);
        transition = qeByName(found.kind, "transition", name);
        qeItem = qeItemFor(found, ctx);
        Z.each(transitionsOf(found.track), function (entry) {
            before[entry.key] = true;
        });
        ctx.changed();
        Z.each(edges, function (edge) {
            addTransitionAt(qeItem, transition, edge === "start", P.timecode(sequence, snapped), ctx);
        });
        // Each requested edge must now be covered by a transition with that name (an unnamed one counts): a
        // transition replaced at the same span is found too, and one left over from before with another
        // name is not mistaken for ours.
        list = transitionsOf(P.tracksOf(sequence, found.kind)[found.trackIndex]);
        Z.each(edges, function (edge) {
            var at = Number(edge === "start" ? clip.start.ticks : clip.end.ticks);
            /** @type {{name: string, start: number, end: number, key: string} | null} */
            var match = null;
            Z.each(list, function (entry) {
                if (!match && entry.start - half <= at && entry.end + half >= at && (!entry.name || entry.name.toLowerCase() === name.toLowerCase())) {
                    match = entry;
                }
            });
            if (!match) {
                missing.push(edge);
                return;
            }
            if (Z.has(before, match.key)) {
                replaced += 1;
            }
            added.push({
                edge: edge,
                name: match.name || name,
                start: Z.round(P.ticksToSeconds(match.start), 4),
                end: Z.round(P.ticksToSeconds(match.end), 4),
                duration: Z.round(P.ticksToSeconds(match.end - match.start), 4)
            });
        });
        if (added.length === 0) {
            throw Z.fail("HOST_ERROR", "Premiere did not add the " + name + " transition (QE addTransition returned without one)");
        }
        if (missing.length > 0) {
            ctx.warn("Premiere added no transition at the " + missing.join(" and ") + " of \"" + clip.name + "\"");
        }
        if (replaced > 0) {
            ctx.warn("A " + name + " of that length was already there; Premiere replaced it or left it as it was");
        }
        Z.each(added, function (entry) {
            if (Math.abs(entry.duration - snapped) * P.TICKS_PER_SECOND > half) {
                ctx.warn("Premiere made the transition at " + entry.start + " s " + entry.duration + " s long, not " + Z.round(snapped, 3) +
                    " s (the clips' media handles limit it)");
            }
        });
        return Z.applied("Added " + Z.plural(added.length, "transition") + " (" + name + ", " + Z.round(snapped, 3) + " s) at the " +
            (at === "both" ? "start and end" : at) + " of \"" + clip.name + "\"", {
            clip: clip.nodeId,
            transition: name,
            requested_duration: Z.round(snapped, 4),
            transitions: added
        }, edges.length);
    });

    // ------------------------------------------------------------------
    // premiere_apply_look

    /** Lumetri Color section headers, in panel order; parameters are found inside their section. */
    var LUMETRI_SECTIONS = ["Basic Correction", "Creative", "Curves", "Color Wheels & Match", "HSL Secondary", "Vignette"];

    /** Tint wheel targets for teal-orange, 0-255 RGB. */
    var TINTS = {teal: [0, 128, 128], orange: [255, 140, 0]};

    /** Share of the way a tint wheel moves from neutral toward its colour at strength 1. */
    var TINT_REACH = 0.35;

    /** The Lumetri parameters a look sets, scaled by strength (TASTE 5 values are deltas from neutral). */
    P.lookSettings = function (look, strength) {
        var values = TASTE.color.looks[look];
        var list = [];
        if (values.exposure !== undefined) {
            list.push({section: "Basic Correction", param: "Exposure", value: Z.round(values.exposure * strength, 4)});
        }
        if (values.temperature !== undefined) {
            list.push({section: "Basic Correction", param: "Temperature", value: Z.round(values.temperature * strength, 4)});
        }
        if (values.tint !== undefined) {
            list.push({section: "Basic Correction", param: "Tint", value: Z.round(values.tint * strength, 4)});
        }
        if (values.contrast !== undefined) {
            list.push({section: "Basic Correction", param: "Contrast", value: Z.round(values.contrast * strength, 4)});
        }
        if (values.saturation !== undefined) {
            list.push({section: "Basic Correction", param: "Saturation", value: Z.round(100 + values.saturation * strength, 4)});
        }
        if (values.fade !== undefined) {
            list.push({section: "Creative", param: "Faded Film", value: Z.round(values.fade * strength, 4)});
        }
        if (values.vibrance !== undefined) {
            list.push({section: "Creative", param: "Vibrance", value: Z.round(values.vibrance * strength, 4)});
        }
        if (values.shadowTint !== undefined) {
            list.push({section: "Creative", param: "Shadow Tint", tint: TINTS[values.shadowTint], reach: TINT_REACH * strength});
        }
        if (values.highlightTint !== undefined) {
            list.push({section: "Creative", param: "Highlight Tint", tint: TINTS[values.highlightTint], reach: TINT_REACH * strength});
        }
        if (values.vignette !== undefined) {
            list.push({section: "Vignette", param: "Amount", value: Z.round(values.vignette * strength, 4)});
        }
        return list;
    };

    /** A Lumetri parameter by display name inside its section (names repeat across sections); else the first match. */
    function lumetriParam(component, section, name) {
        var params = P.paramsOf(component);
        var start = -1;
        var end = params.length;
        var i;
        var label;
        for (i = 0; i < params.length; i += 1) {
            label = String(params[i].displayName);
            if (start < 0 && label === section) {
                start = i;
            } else if (start >= 0 && Z.indexOf(LUMETRI_SECTIONS, label) >= 0) {
                end = i;
                break;
            }
        }
        for (i = start < 0 ? 0 : start + 1; i < (start < 0 ? params.length : end); i += 1) {
            if (String(params[i].displayName) === name) {
                return params[i];
            }
        }
        return null;
    }

    function lookTargets(args, ctx) {
        var ids = Z.optional(args, "clips", "array", null);
        var trackRef = Z.optional(args, "track", "object", null);
        var sequence;
        var targets = [];
        var selection;
        if (ids !== null) {
            Z.each(ids, function (id, i) {
                var found;
                if (typeof id !== "string") {
                    throw Z.refuse("INVALID_ARGUMENT", "`clips[" + i + "]` must be a clip nodeId");
                }
                found = P.findClip(id, args.sequence);
                if (found.kind !== "video") {
                    throw Z.refuse("INVALID_ARGUMENT", "Clip \"" + found.clip.name + "\" is audio; looks grade video clips");
                }
                targets.push(found);
            });
            return targets;
        }
        sequence = P.findSequence(args.sequence);
        if (trackRef !== null) {
            if (trackRef.kind !== "video") {
                throw Z.refuse("INVALID_ARGUMENT", "`track` must be a video track for a look");
            }
            P.findTrack(sequence, trackRef);
            Z.each(P.clipsOf(P.tracksOf(sequence, "video")[trackRef.index]), function (clip) {
                targets.push(P.refindClip(sequence, clip.nodeId));
            });
            if (targets.length === 0) {
                throw Z.refuse("INVALID_ARGUMENT", "Track " + P.trackLabel("video", trackRef.index) + " has no clips to grade");
            }
            return targets;
        }
        selection = Z.hasMethod(sequence, "getSelection") ? sequence.getSelection() || [] : [];
        Z.each(selection, function (clip) {
            var found = P.refindClip(sequence, clip.nodeId);
            if (found && found.kind === "video") {
                targets.push(found);
            }
        });
        if (targets.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "No video clips are selected; pass `clips` (nodeIds) or `track`");
        }
        ctx.warn("Graded the " + Z.plural(targets.length, "selected video clip"));
        return targets;
    }

    Z.register("premiere_apply_look", function (args, ctx) {
        var look = Z.oneOf("look", Z.required(args, "look", "string"), Object.keys(TASTE.color.looks));
        var strength = Z.inRange("strength", Z.optional(args, "strength", "number", TASTE.color.lookStrength), 0, 1);
        var targets = lookTargets(args, ctx);
        var settings = P.lookSettings(look, strength);
        var hasTints = Z.filter(settings, function (setting) { return Boolean(setting.tint); }).length > 0;
        var graded = [];
        var steps = 0;
        var lumetriEffect = null;
        var anySet = false;
        var plans;

        // Everything that can refuse happens before the first change: locks, the Lumetri effect, QE items.
        plans = Z.map(targets, function (found) {
            var lumetri = P.findComponent(found.clip, ["AE.ADBE Lumetri"], ["Lumetri Color"]);
            P.requireUnlocked(found.track, found.kind, found.trackIndex);
            if (lumetri) {
                return {found: found, lumetri: lumetri, qeItem: null};
            }
            if (lumetriEffect === null) {
                lumetriEffect = qeByName("video", "effect", "Lumetri Color");
            }
            return {found: found, lumetri: null, qeItem: qeItemFor(found, ctx)};
        });

        Z.each(plans, function (plan) {
            var found = plan.found;
            var lumetri = plan.lumetri;
            var set = {};
            var missing = [];
            if (!lumetri) {
                lumetri = P.addEffect(found, lumetriEffect, "Lumetri Color", ctx, plan.qeItem).component;
                steps += 1;
            } else if (hasTints) {
                ctx.warn("Lumetri was already on \"" + found.clip.name + "\": its tint wheels moved from their current colours, so re-applying " +
                    look + " strengthens the tint");
            }
            Z.each(settings, function (setting) {
                var param = lumetriParam(lumetri, setting.section, setting.param);
                var color;
                var mixed;
                if (!param) {
                    missing.push(setting.param);
                    return;
                }
                ctx.changed();
                if (setting.tint) {
                    color = param.getColorValue();
                    mixed = [];
                    mixed[0] = Math.round(Number(color[1]) + (setting.tint[0] - Number(color[1])) * setting.reach);
                    mixed[1] = Math.round(Number(color[2]) + (setting.tint[1] - Number(color[2])) * setting.reach);
                    mixed[2] = Math.round(Number(color[3]) + (setting.tint[2] - Number(color[3])) * setting.reach);
                    param.setColorValue(Number(color[0]), mixed[0], mixed[1], mixed[2], true);
                    set[setting.param] = mixed;
                } else {
                    param.setValue(setting.value, true);
                    set[setting.param] = setting.value;
                }
                anySet = true;
                steps += 1;
            });
            if (!anySet) {
                // Lumetri's names are the same on every clip: stop at the first one instead of adding Lumetri everywhere.
                throw Z.fail("UNSUPPORTED", "None of the Lumetri parameters (" + Z.map(settings, function (s) { return s.param; }).join(", ") +
                    ") were found by their English names on \"" + found.clip.name + "\"; Premiere may be running in another language");
            }
            if (missing.length > 0) {
                ctx.warn("Lumetri on \"" + found.clip.name + "\" has no " + missing.join(", ") + " (Lumetri names are English; another UI language?)");
            }
            graded.push({node_id: found.clip.nodeId, name: String(found.clip.name), added_lumetri: !plan.lumetri, set: set});
        });
        return Z.applied("Applied the " + look + " look at " + Math.round(strength * 100) + "% to " + Z.plural(graded.length, "clip"), {
            look: look,
            strength: strength,
            clips: graded
        }, steps);
    });
}(ZenviLink));
// ---- ppro/60-graphics.jsx ----
// Zenvi Link: Premiere Pro titles and captions. premiere_add_text,
// premiere_add_captions.
//
// Premiere's ExtendScript cannot create text, and the title templates that ship
// with Premiere are Premiere-authored: their clips expose no MGT component, so
// their text cannot be set by script (premiere-pro-mcp, verified on 25.2).
// premiere_add_text therefore places either a transparent PNG title (`image`)
// or an After Effects-authored .mogrt (`mogrt`) whose text control is set
// through TrackItem.getMGTComponent().

(function (Z) {
    var P = Z.ppro;
    var TASTE = Z.TASTE;

    var STYLE_SIZES = {headline: "headline", title: "title", subtitle: "subtitle", "lower-third": "lowerThirdName", caption: "caption"};

    function words(text) {
        return Z.filter(String(text).split(/\s+/), function (word) { return word.length > 0; }).length;
    }

    /** TASTE reading time: 1.5 s + 0.3 s per word. */
    P.readingTime = function (text) {
        return TASTE.timing.textHold.base + TASTE.timing.textHold.perWord * words(text);
    };

    /** Default title duration by style: reading time, at least a title card (3 s) or a lower third (5 s). */
    P.titleDuration = function (text, style) {
        var reading = P.readingTime(text);
        if (style === "lower-third") {
            return Math.max(reading, TASTE.timing.lowerThird["default"]);
        }
        if (style === "caption") {
            return reading;
        }
        return Math.max(reading, TASTE.timing.titleCard["default"]);
    };

    /** The lowest unlocked video track from `from` up that is empty over [start, end); -1 when none. */
    P.freeVideoTrack = function (sequence, startTicks, endTicks, from) {
        var tracks = sequence.videoTracks;
        var i;
        for (i = from; i < tracks.numTracks; i += 1) {
            if (!P.isLocked(tracks[i]) && P.overlapping(tracks[i], startTicks, endTicks, {}).length === 0) {
                return i;
            }
        }
        return -1;
    };

    function octet(text, index) {
        return text.charCodeAt(index) & 255;
    }

    /** Width and height of a PNG from its IHDR chunk, or null. */
    P.pngSize = function (path) {
        var file = new File(path);
        var header;
        file.encoding = "BINARY";
        if (!file.open("r")) {
            return null;
        }
        header = file.read(24);
        file.close();
        if (header.length < 24 || octet(header, 1) !== 80 || octet(header, 2) !== 78 || octet(header, 3) !== 71) {
            return null;
        }
        return {
            width: ((octet(header, 16) * 256 + octet(header, 17)) * 256 + octet(header, 18)) * 256 + octet(header, 19),
            height: ((octet(header, 20) * 256 + octet(header, 21)) * 256 + octet(header, 22)) * 256 + octet(header, 23)
        };
    };

    /** The project item for a file: the existing one (same media path), else imported into "Zenvi Imports". */
    P.itemForFile = function (path, ctx) {
        var item = P.mediaIndex()[P.normalPath(path)];
        var bin;
        var before;
        var added;
        var i;
        if (item) {
            return {item: item, imported: false};
        }
        bin = P.findBin("Zenvi Imports", true, ctx, []);
        before = P.itemIds();
        ctx.changed();
        app.project.importFiles([path], true, bin, false);
        added = P.newItems(before);
        for (i = 0; i < added.length; i += 1) {
            if (P.normalPath(P.mediaPath(added[i])) === P.normalPath(path)) {
                return {item: added[i], imported: true};
            }
        }
        if (added.length === 1) {
            return {item: added[0], imported: true};
        }
        throw Z.fail("HOST_ERROR", "Premiere did not import " + path);
    };

    /** Set the text of an AE-authored MOGRT text control: JSON (textEditValue) on 2020+, a plain string before. */
    function setMogrtText(param, text) {
        var value = P.valueOf(param);
        var parsed = null;
        if (typeof value === "string" && value.charAt(0) === "{") {
            try {
                parsed = JSON.parse(value);
            } catch (error) {
                parsed = null;
            }
        }
        if (parsed && Z.isObject(parsed)) {
            parsed.textEditValue = text;
            parsed.fontTextRunLength = [text.length];
            param.setValue(JSON.stringify(parsed), true);
        } else {
            param.setValue(text, true);
        }
    }

    function textParamOf(component) {
        var params = P.paramsOf(component);
        var i;
        var value;
        for (i = 0; i < params.length; i += 1) {
            // A string control named like text ("Source Text", "Name Text"), not "Text Size" or "Text Color".
            if (/text/i.test(String(params[i].displayName)) && typeof P.valueOf(params[i]) === "string") {
                return params[i];
            }
        }
        for (i = 0; i < params.length; i += 1) {
            value = P.valueOf(params[i]);
            if (typeof value === "string" && (value.indexOf("textEditValue") >= 0 || value.charAt(0) !== "{")) {
                return params[i];
            }
        }
        return null;
    }

    /** "nodeId:start-end" of the clips on a track (except nodeIds in `except`), to detect collateral edits. */
    function trackSnapshot(track, except) {
        return Z.map(Z.filter(P.clipsOf(track), function (clip) {
            return !Z.has(except, clip.nodeId);
        }), function (clip) {
            return clip.nodeId + ":" + clip.start.ticks + "-" + clip.end.ticks;
        }).join(",");
    }

    /** Fail loudly when placing the title changed any clip that was already on the track. */
    function requireNeighboursUntouched(sequence, trackIndex, before, beforeIds) {
        var after = trackSnapshot(sequence.videoTracks[trackIndex], P.newIds(sequence, beforeIds));
        if (after !== before) {
            throw Z.fail("HOST_ERROR", "Placing the title changed other clips on V" + (trackIndex + 1) + "; undo the call's steps in Premiere");
        }
    }

    /** nodeIds in the sequence that were not in `beforeIds`, as a map. */
    P.newIds = function (sequence, beforeIds) {
        var ids = {};
        Z.each(Object.keys(P.clipIds(sequence)), function (id) {
            if (!Z.has(beforeIds, id)) {
                ids[id] = true;
            }
        });
        return ids;
    };

    function placeMogrt(sequence, path, trackIndex, startTicks, endTicks, text, size, rgb, ctx, result) {
        var clip;
        var mgt;
        var textParam;
        var sizeParam;
        var colorParam = null;
        var params;
        var i;
        var beforeIds = P.clipIds(sequence);
        var before = trackSnapshot(sequence.videoTracks[trackIndex], {});
        P.requireFeature(Z.hasMethod(sequence, "importMGT"), "Sequence.importMGT", "2019 (13.0)");
        ctx.changed();
        clip = sequence.importMGT(path, String(startTicks), trackIndex, 0);
        if (!clip) {
            throw Z.fail("HOST_ERROR", "Premiere did not insert the template " + path);
        }
        result.steps += 1;
        requireNeighboursUntouched(sequence, trackIndex, before, beforeIds);
        mgt = Z.hasMethod(clip, "getMGTComponent") ? clip.getMGTComponent() : null;
        textParam = mgt ? textParamOf(mgt) : null;
        if (!textParam) {
            clip.remove(false, true);
            result.steps += 1;
            throw Z.refuse("UNSUPPORTED", "The template " + P.baseName(path) + " has no scriptable text (Premiere-authored templates " +
                "expose none); it was removed again. Use an After Effects-authored .mogrt, or pass `image`");
        }
        setMogrtText(textParam, text);
        result.steps += 1;
        params = P.paramsOf(mgt);
        for (i = 0; i < params.length; i += 1) {
            if (!sizeParam && /size/i.test(String(params[i].displayName)) && typeof P.valueOf(params[i]) === "number") {
                sizeParam = params[i];
            }
            if (!colorParam && /colou?r/i.test(String(params[i].displayName)) && Z.hasMethod(params[i], "setColorValue")) {
                colorParam = params[i];
            }
        }
        if (sizeParam) {
            sizeParam.setValue(size, true);
            result.steps += 1;
        } else {
            ctx.warn("The template exposes no size control; it keeps its own type size");
        }
        if (colorParam) {
            colorParam.setColorValue(255, Math.round(rgb[0] * 255), Math.round(rgb[1] * 255), Math.round(rgb[2] * 255), true);
            result.steps += 1;
        } else {
            ctx.warn("The template exposes no colour control; it keeps its own colour");
        }
        clip = (P.refindClip(sequence, clip.nodeId) || {clip: clip}).clip;
        P.setTimeProperty(clip, "end", endTicks);
        result.steps += 1;
        return clip;
    }

    /**
     * The title-safe box of a frame (TASTE 3): a 10 % inset, or for 9:16 the
     * vertical safe area (top 12 %, bottom 20 %, 10 % at the sides).
     */
    P.titleSafe = function (width, height) {
        var layout = TASTE.layout;
        var vertical = height > width && Math.abs(width / height - 9 / 16) < 0.02;
        return {
            left: width * layout.titleSafe,
            right: width * (1 - layout.titleSafe),
            top: height * (vertical ? layout.verticalTop : layout.titleSafe),
            bottom: height * (1 - (vertical ? layout.verticalBottom : layout.titleSafe)),
            vertical: vertical
        };
    };

    /**
     * Centre (sequence pixels) for a graphic of w x h at a TASTE placement: inside
     * title-safe, lower thirds left-aligned with their bottom at 80 % of the frame
     * height (70 % on vertical).
     */
    P.placementCenter = function (placement, width, height, w, h) {
        var safe = P.titleSafe(width, height);
        var lowerThird = TASTE.layout.lowerThird;
        switch (placement) {
        case "lower-third":
            return [safe.left + w / 2, height * (safe.vertical ? lowerThird.baselineVertical : lowerThird.baselineLandscape) - h / 2];
        case "top-left":
            return [safe.left + w / 2, safe.top + h / 2];
        case "top-center":
            return [width / 2, safe.top + h / 2];
        case "bottom-center":
            return [width / 2, safe.bottom - h / 2];
        default:
            return [width / 2, height / 2];
        }
    };

    function motionParam(clip, name, index) {
        var motion = P.motionOf(clip);
        return motion ? P.findParam(motion, [name], index) : null;
    }

    /**
     * A full-frame title image (the frame's aspect ratio) fills the frame; a
     * smaller graphic keeps its pixel size (scaled down to fit title-safe when
     * larger) and sits at `placement`.
     */
    function layoutImage(sequence, clip, size, placement, ctx, result) {
        var width = sequence.frameSizeHorizontal;
        var height = sequence.frameSizeVertical;
        var safe = P.titleSafe(width, height);
        var scaleParam = motionParam(clip, "Scale", P.MOTION_PARAMS.scale[1]);
        var positionParam = motionParam(clip, "Position", P.MOTION_PARAMS.position[1]);
        var scale;
        var center;
        if (!size || size.width <= 0 || size.height <= 0 || !scaleParam || !positionParam) {
            ctx.warn("Could not read the image size; it is placed as Premiere scales it");
            return {scale: null, position: null};
        }
        if (Math.abs(size.width / size.height - width / height) < 0.01) {
            scale = width / size.width;
            center = [width / 2, height / 2];
        } else {
            scale = Math.min(1, (safe.right - safe.left) / size.width, (safe.bottom - safe.top) / size.height);
            center = P.placementCenter(placement, width, height, size.width * scale, size.height * scale);
        }
        if (Math.abs(scale - 1) > 0.0001) {
            scaleParam.setValue(Z.round(scale * 100, 4), true);
            result.steps += 1;
            ctx.warn("Scaled the " + size.width + "x" + size.height + " image to " + Z.round(scale * 100, 2) + "%");
        }
        if (Math.abs(center[0] - width / 2) > 0.01 || Math.abs(center[1] - height / 2) > 0.01) {
            positionParam.setValue(P.positionToDom(sequence, center), true);
            result.steps += 1;
        }
        return {scale: Z.round(scale * 100, 4), position: [Z.round(center[0], 2), Z.round(center[1], 2)]};
    }

    function placeImage(sequence, path, trackIndex, startTicks, endTicks, placement, ctx, result) {
        var file = P.itemForFile(path, ctx);
        var track = sequence.videoTracks[trackIndex];
        var before = P.clipIds(sequence);
        var neighbours = trackSnapshot(track, {});
        var origIn = String(file.item.getInPoint().ticks);
        var origOut = String(file.item.getOutPoint().ticks);
        /** @type {TrackItem | null} */
        var clip = null;
        var half = Number(sequence.timebase) / 2;
        if (file.imported) {
            result.steps += 1;
        }
        ctx.changed();
        // A still lays down its marked range (by default Premiere's still duration), so mark exactly the
        // title's length first: overwriting more would cut into the next clip on the track.
        result.steps += P.setMarks(file.item, 0, P.ticksToSeconds(endTicks - startTicks));
        try {
            track.overwriteClip(file.item, P.ticksToSeconds(startTicks));
            result.steps += 1;
        } finally {
            try {
                result.steps += P.setMarks(file.item, P.ticksToSeconds(origIn), P.ticksToSeconds(origOut));
            } catch (restoreError) {
                ctx.warn("Could not restore the in/out marks of " + P.baseName(path));
            }
        }
        requireNeighboursUntouched(sequence, trackIndex, neighbours, before);
        Z.each(P.clipsOf(sequence.videoTracks[trackIndex]), function (candidate) {
            if (!Z.has(before, candidate.nodeId) && Math.abs(Number(candidate.start.ticks) - startTicks) < half) {
                clip = candidate;
            }
        });
        if (!clip) {
            throw Z.fail("HOST_ERROR", "Premiere did not place " + P.baseName(path));
        }
        P.setTimeProperty(clip, "end", endTicks);
        result.steps += 1;
        clip = (P.refindClip(sequence, clip.nodeId) || {clip: clip}).clip;
        result.layout = layoutImage(sequence, clip, P.pngSize(path), placement, ctx, result);
        result.imported = file.imported;
        return clip;
    }

    /**
     * What the Zenvi Link server needs to render a title image for
     * premiere_add_text without `image` or `mogrt` (extension/server/titles.js):
     * the target sequence's frame size and id, the project path (titles are
     * saved next to it), and the TASTE numbers of the layout. A JSON string;
     * {ok: false} without a project or sequence, so the tool call itself
     * refuses with the reason.
     */
    P.titleFrame = function (argsJson) {
        var args;
        var sequence;
        try {
            args = argsJson ? JSON.parse(argsJson) : {};
            sequence = P.findSequence(args.sequence === null ? undefined : args.sequence);
        } catch (error) {
            return Z.stringify({ok: false});
        }
        return Z.stringify({
            ok: true,
            width: sequence.frameSizeHorizontal,
            height: sequence.frameSizeVertical,
            sequence_id: sequence.sequenceID,
            project: P.projectPath(),
            taste: {type: TASTE.type, layout: TASTE.layout, color: {palette: TASTE.color.palette}}
        });
    };

    Z.register("premiere_add_text", function (args, ctx) {
        var text = Z.required(args, "text", "string");
        var sequence = P.findSequence(args.sequence);
        var style = Z.oneOf("style", Z.optional(args, "style", "string", "title"), Object.keys(STYLE_SIZES));
        var scale = Math.min(sequence.frameSizeHorizontal, sequence.frameSizeVertical) / TASTE.type.referenceShortSide;
        var size = Z.optional(args, "font_size", "number", null);
        var rgb = Z.color.toRgb(Z.optional(args, "color", "any", TASTE.color.palette.paper), "color");
        var placement = Z.optional(args, "placement", "string", style === "lower-third" ? "lower-third" : style === "caption" ? "bottom-center" : "center");
        var mogrt = Z.optional(args, "mogrt", "string", null);
        var image = Z.optional(args, "image", "string", null);
        var duration = Z.optional(args, "duration", "number", null);
        var time = Z.optional(args, "time", "number", null);
        var trackIndex = Z.optional(args, "track", "integer", null);
        var reading = P.readingTime(text);
        var startTicks;
        var endTicks;
        var result = {steps: 0, imported: false, layout: null};
        var clip;
        var longLines;
        var start;
        var freeUntil;
        var actual;

        if (Z.trim(text).length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`text` must not be blank");
        }
        Z.oneOf("placement", placement, ["center", "lower-third", "top-left", "top-center", "bottom-center"]);
        size = size === null ? Math.round(TASTE.type.sizes[STYLE_SIZES[style]] * scale) : Z.inRange("font_size", size, 6, 1000);
        if (mogrt !== null && image !== null) {
            throw Z.refuse("INVALID_ARGUMENT", "Pass `mogrt` or `image`, not both");
        }
        if (mogrt === null && image === null) {
            throw Z.refuse("UNSUPPORTED", "Premiere's scripting API cannot type text into its own title templates. Pass `image` " +
                "(a transparent PNG title at the sequence size, " + sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical +
                ", e.g. rendered by Zenvi) or `mogrt` (an After Effects-authored .mogrt with a text control)");
        }
        if (mogrt !== null && (P.extensionOf(mogrt) !== "mogrt" || !P.isFile(mogrt))) {
            throw Z.refuse(P.isFile(mogrt) ? "INVALID_ARGUMENT" : "NOT_FOUND", "`mogrt` must be an existing .mogrt file: " + mogrt);
        }
        if (image !== null && (P.extensionOf(image) !== "png" || !P.isFile(image))) {
            throw Z.refuse(P.isFile(image) ? "INVALID_ARGUMENT" : "NOT_FOUND", "`image` must be an existing .png file: " + image);
        }
        duration = duration === null ? P.titleDuration(text, style) : Z.inRange("duration", duration, 0.04, 3600);
        if (duration < reading - 0.0005) {
            ctx.warn("On screen for " + Z.round(duration, 3) + " s, under the " + Z.round(reading, 2) + " s reading time for " +
                Z.plural(words(text), "word") + " (TASTE: 1.5 s + 0.3 s per word)");
        }
        start = time === null ? P.timeToSeconds(sequence.getPlayerPosition()) : Z.inRange("time", time, 0, null);
        start = P.snapTime(sequence, start, ctx, "time");
        startTicks = Math.round(start * P.TICKS_PER_SECOND);
        endTicks = Math.round(P.snapTime(sequence, start + duration, null) * P.TICKS_PER_SECOND);
        longLines = Z.filter(text.split(/\r?\n/), function (line) { return line.length > TASTE.type.maxLineChars; });
        if (longLines.length > 0) {
            ctx.warn(Z.plural(longLines.length, "line") + " longer than " + TASTE.type.maxLineChars + " characters; break on phrases (TASTE 4)");
        }

        // A template is laid down at its own length before it is trimmed, so its track must be free
        // from the title's start onward; an image is marked to the title's length first.
        freeUntil = mogrt !== null ? Infinity : endTicks;
        if (trackIndex === null) {
            trackIndex = P.freeVideoTrack(sequence, startTicks, freeUntil, 1);
            if (trackIndex < 0) {
                throw Z.refuse("INVALID_ARGUMENT", "No video track above V1 is free from " + Z.round(start, 3) + " " +
                    (mogrt !== null ? "onward (a template needs room for its own length)" : "to " + Z.round(P.ticksToSeconds(endTicks), 3) + " s") +
                    "; add a track in Premiere or pass `track`");
            }
        } else {
            P.findTrack(sequence, {kind: "video", index: trackIndex});
            P.requireUnlocked(sequence.videoTracks[trackIndex], "video", trackIndex);
            if (P.overlapping(sequence.videoTracks[trackIndex], startTicks, freeUntil, {}).length > 0) {
                throw Z.refuse("INVALID_ARGUMENT", "Track V" + (trackIndex + 1) + " already has a clip " +
                    (mogrt !== null ? "after " + Z.round(start, 3) + " s (a template needs room for its own length)" :
                        "between " + Z.round(start, 3) + " and " + Z.round(P.ticksToSeconds(endTicks), 3) + " s") +
                    "; pick a free track (or omit `track`)");
            }
        }

        if (mogrt !== null) {
            clip = placeMogrt(sequence, mogrt, trackIndex, startTicks, endTicks, text, size, rgb, ctx, result);
        } else {
            clip = placeImage(sequence, image, trackIndex, startTicks, endTicks, placement, ctx, result);
        }
        actual = P.timeToSeconds(clip.end) - P.timeToSeconds(clip.start);
        if (Math.abs(actual * P.TICKS_PER_SECOND - (endTicks - startTicks)) >= Number(sequence.timebase) / 2) {
            ctx.warn("The title runs " + Z.round(actual, 3) + " s, not " + Z.round(P.ticksToSeconds(endTicks - startTicks), 3) +
                " s (the " + (mogrt !== null ? "template" : "image") + " is shorter)");
        }
        return Z.applied("Added the title \"" + (text.length > 40 ? text.slice(0, 37) + "..." : text) + "\" on V" + (trackIndex + 1) + " at " +
            Z.round(start, 3) + " s for " + Z.round(actual, 3) + " s (" + (mogrt !== null ? "template" : "image") + ")", {
            clip: P.clipDetail(sequence, clip, "video", trackIndex, false),
            source: mogrt !== null ? "mogrt" : "image",
            text: text,
            style: style,
            font_size: size,
            color: Z.color.toHex(rgb),
            placement: mogrt !== null ? "template" : placement,
            layout: result.layout,
            reading_time: Z.round(reading, 2),
            imported: result.imported
        }, result.steps);
    });

    // ------------------------------------------------------------------
    // premiere_add_captions

    /** Sequence.CAPTION_FORMAT_* constant names (scripting guide, Sequence.createCaptionTrack). */
    var CAPTION_FORMATS = {
        subtitle: "CAPTION_FORMAT_SUBTITLE",
        "cea-608": "CAPTION_FORMAT_608",
        "cea-708": "CAPTION_FORMAT_708",
        teletext: "CAPTION_FORMAT_TELETEXT",
        ebu: "CAPTION_FORMAT_OPEN_EBU",
        op42: "CAPTION_FORMAT_OP42",
        op47: "CAPTION_FORMAT_OP47"
    };

    Z.register("premiere_add_captions", function (args, ctx) {
        var srt = Z.required(args, "srt", "string");
        var sequence = P.findSequence(args.sequence);
        var format = Z.oneOf("format", Z.optional(args, "format", "string", "subtitle"), Object.keys(CAPTION_FORMATS));
        var time = P.snapTime(sequence, Z.inRange("time", Z.optional(args, "time", "number", 0), 0, null), ctx, "time");
        var constant = null;
        var file;
        var created;
        var steps = 1;
        if (P.extensionOf(srt) !== "srt") {
            throw Z.refuse("INVALID_ARGUMENT", "`srt` must be a .srt file, got " + srt);
        }
        if (!P.isFile(srt)) {
            throw Z.refuse("NOT_FOUND", "No file at " + srt);
        }
        P.requireFeature(Z.hasMethod(sequence, "createCaptionTrack"), "Sequence.createCaptionTrack", "2021 (15.0)");
        if (typeof Sequence !== "undefined" && Sequence && typeof Sequence[CAPTION_FORMATS[format]] === "number") {
            constant = Sequence[CAPTION_FORMATS[format]];
        } else if (format !== "subtitle") {
            throw Z.refuse("UNSUPPORTED", "This Premiere build does not expose Sequence." + CAPTION_FORMATS[format]);
        }
        file = P.itemForFile(srt, ctx);
        if (file.imported) {
            steps += 1;
        }
        ctx.changed();
        created = constant === null ? sequence.createCaptionTrack(file.item, time) : sequence.createCaptionTrack(file.item, time, constant);
        if (created === false || created === 0) {
            throw Z.fail("HOST_ERROR", "Premiere did not create a caption track from " + P.baseName(srt));
        }
        return Z.applied("Added a " + format + " caption track from \"" + P.baseName(srt) + "\" at " + Z.round(time, 3) + " s to \"" +
            sequence.name + "\"", {
            srt: srt,
            item: {node_id: file.item.nodeId, name: String(file.item.name)},
            imported: file.imported,
            time: Z.round(time, 4),
            format: format,
            sequence_id: sequence.sequenceID
        }, steps);
    });
}(ZenviLink));
// ---- ppro/70-assist.jsx ----
// Zenvi Link: Premiere Pro's assisted edits. premiere_auto_reframe,
// premiere_scene_detect.

(function (Z) {
    var P = Z.ppro;

    // ------------------------------------------------------------------
    // premiere_auto_reframe

    var ASPECTS = {"9:16": [9, 16], "1:1": [1, 1], "4:5": [4, 5], "16:9": [16, 9]};

    function even(value) {
        return Math.round(value / 2) * 2;
    }

    /** The reframed frame size: keep the source's short side (1080p -> 1080x1920 for 9:16). */
    P.reframeSize = function (sequence, ratio) {
        var shortSide = Math.min(sequence.frameSizeHorizontal, sequence.frameSizeVertical);
        if (ratio[0] <= ratio[1]) {
            return {width: shortSide, height: even(shortSide * ratio[1] / ratio[0])};
        }
        return {width: even(shortSide * ratio[0] / ratio[1]), height: shortSide};
    };

    Z.register("premiere_auto_reframe", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var aspect = Z.oneOf("aspect", Z.optional(args, "aspect", "string", "9:16"), Object.keys(ASPECTS));
        var motion = Z.oneOf("motion", Z.optional(args, "motion", "string", "default"), ["default", "slower", "faster"]);
        var nest = Z.optional(args, "nest", "boolean", false);
        var open = Z.optional(args, "open", "boolean", true);
        var name = Z.optional(args, "name", "string", sequence.name + " " + aspect.replace(":", "x"));
        var ratio = ASPECTS[aspect];
        var size = P.reframeSize(sequence, ratio);
        var before;
        var created;
        var steps = 1;
        P.requireFeature(Z.hasMethod(sequence, "autoReframeSequence"), "Auto Reframe (Sequence.autoReframeSequence)", "2020 (14.0)");
        if (Z.hasMethod(sequence, "isDoneAnalyzingForVideoEffects") && sequence.isDoneAnalyzingForVideoEffects() === false) {
            throw Z.refuse("BUSY", "Premiere is still analysing \"" + sequence.name + "\" for video effects; try again in a moment");
        }
        before = P.sequenceIds();
        ctx.changed();
        created = sequence.autoReframeSequence(ratio[0], ratio[1], motion, name, nest);
        if (!created || !created.sequenceID) {
            created = P.newSequence(before);
        }
        if (!created) {
            throw Z.fail("HOST_ERROR", "Premiere did not create the reframed sequence");
        }
        // Auto Reframe keeps the source height (9:16 of 1080p gives 608x1080); setting the frame size
        // afterwards is honoured and Premiere refits the reframe (premiere-pro-mcp, Premiere 25.2).
        if (created.frameSizeHorizontal !== size.width || created.frameSizeVertical !== size.height) {
            steps += P.applyFrame(created, {width: size.width, height: size.height, fps: 0}, ctx);
        }
        if (open) {
            P.openSequence(created);
        }
        return Z.applied("Auto-reframed \"" + sequence.name + "\" to " + aspect + " as \"" + created.name + "\" (" +
            created.frameSizeHorizontal + "x" + created.frameSizeVertical + ")" + (open ? " and opened it" : ""), {
            sequence: P.sequenceSummary(created),
            source_sequence_id: sequence.sequenceID,
            aspect: aspect,
            motion: motion
        }, steps);
    });

    // ------------------------------------------------------------------
    // premiere_scene_detect

    var SENSITIVITY = {low: "LowSensitivity", medium: "MediumSensitivity", high: "HighSensitivity"};

    function selectedIds(sequence) {
        var ids = [];
        var selection = Z.hasMethod(sequence, "getSelection") ? sequence.getSelection() || [] : [];
        var i;
        for (i = 0; i < selection.length; i += 1) {
            ids.push(selection[i].nodeId);
        }
        return ids;
    }

    /** Select exactly the clips with these nodeIds (deselecting every other clip). */
    function selectOnly(sequence, ids) {
        var kinds = ["video", "audio"];
        var k;
        var t;
        var tracks;
        for (k = 0; k < kinds.length; k += 1) {
            tracks = P.tracksOf(sequence, kinds[k]);
            for (t = 0; t < tracks.numTracks; t += 1) {
                Z.each(P.clipsOf(tracks[t]), function (clip) {
                    var want = Z.indexOf(ids, clip.nodeId) >= 0;
                    if (clip.isSelected() !== want) {
                        clip.setSelected(want, true);
                    }
                });
            }
        }
    }

    function markerCount(item) {
        try {
            return item && Z.hasMethod(item, "getMarkers") ? Number(item.getMarkers().numMarkers) : 0;
        } catch (error) {
            return 0;
        }
    }

    Z.register("premiere_scene_detect", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var ref = Z.optional(args, "track", "object", {kind: "video", index: 0});
        var ids = Z.optional(args, "clips", "array", null);
        var action = Z.oneOf("action", Z.optional(args, "action", "string", "cuts"), ["cuts", "markers"]);
        var sensitivity = Z.oneOf("sensitivity", Z.optional(args, "sensitivity", "string", "medium"), Object.keys(SENSITIVITY));
        var linkedAudio = Z.optional(args, "include_linked_audio", "boolean", true);
        var track;
        var detect = null;
        var targets = [];
        var previous;
        var beforeClips;
        var beforeMarkers = [];
        var seenItems = {};
        var newClips = 0;
        var newMarkers = 0;
        var afterClips;

        if (ref.kind !== "video") {
            throw Z.refuse("INVALID_ARGUMENT", "Scene Edit Detection runs on video tracks; `track` must be {kind: \"video\", index}");
        }
        track = P.findTrack(sequence, ref);
        P.requireUnlocked(track, ref.kind, ref.index);
        if (Z.hasMethod(sequence, "performSceneEditDetectionOnSelection")) {
            detect = "performSceneEditDetectionOnSelection";
        } else if (Z.hasMethod(sequence, "performCutDetectionOnSelection")) {
            // types-for-adobe names it this way; the scripting guide and PProPanel use the name above.
            detect = "performCutDetectionOnSelection";
        }
        P.requireFeature(detect !== null, "Scene Edit Detection (Sequence.performSceneEditDetectionOnSelection)", "2020 (14.0)");
        if (ids !== null) {
            Z.each(ids, function (id, i) {
                var found = P.refindClip(sequence, id);
                if (typeof id !== "string" || !found) {
                    throw Z.refuse("NOT_FOUND", "`clips[" + i + "]` is not a clip of sequence \"" + sequence.name + "\"");
                }
                if (found.kind !== ref.kind || found.trackIndex !== ref.index) {
                    throw Z.refuse("INVALID_ARGUMENT", "Clip \"" + found.clip.name + "\" is on " + P.trackLabel(found.kind, found.trackIndex) +
                        ", not " + P.trackLabel(ref.kind, ref.index));
                }
                targets.push(found.clip);
            });
        } else {
            targets = P.clipsOf(track);
        }
        if (targets.length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "Track " + P.trackLabel(ref.kind, ref.index) + " has no clips to analyse");
        }

        previous = selectedIds(sequence);
        beforeClips = P.clipIds(sequence);
        // Clips can share a source item (both halves after a razor): count each item's markers once.
        Z.each(targets, function (clip) {
            if (clip.projectItem && !Z.has(seenItems, clip.projectItem.nodeId)) {
                seenItems[clip.projectItem.nodeId] = true;
                beforeMarkers.push({item: clip.projectItem, count: markerCount(clip.projectItem)});
            }
        });
        ctx.changed();
        try {
            selectOnly(sequence, Z.map(targets, function (clip) { return clip.nodeId; }));
            if (detect === "performSceneEditDetectionOnSelection") {
                sequence.performSceneEditDetectionOnSelection(action === "cuts" ? "ApplyCuts" : "CreateMarkers", linkedAudio, SENSITIVITY[sensitivity]);
            } else {
                sequence.performCutDetectionOnSelection(action === "cuts" ? "ApplyCuts" : "CreateMarkers", linkedAudio, SENSITIVITY[sensitivity]);
            }
        } finally {
            try {
                selectOnly(sequence, Z.filter(previous, function (id) { return P.refindClip(sequence, id) !== null; }));
            } catch (restoreError) {
                ctx.warn("Could not restore the previous clip selection");
            }
        }
        afterClips = P.clipIds(sequence);
        Z.each(Object.keys(afterClips), function (id) {
            if (!Z.has(beforeClips, id)) {
                newClips += 1;
            }
        });
        Z.each(beforeMarkers, function (entry) {
            newMarkers += Math.max(0, markerCount(entry.item) - entry.count);
        });
        if (action === "markers") {
            ctx.warn("Premiere puts Scene Edit Detection markers on the source items (clip markers), and adds them again on every run");
        }
        return Z.applied("Scene Edit Detection on " + Z.plural(targets.length, "clip") + " of " + P.trackLabel(ref.kind, ref.index) + ": " +
            (action === "cuts" ? Z.plural(newClips, "new clip") + " from the cuts" : Z.plural(newMarkers, "marker")), {
            track: {kind: ref.kind, index: ref.index},
            analysed: Z.map(targets, function (clip) { return clip.nodeId; }),
            action: action,
            sensitivity: sensitivity,
            new_clips: newClips,
            new_markers: newMarkers
        }, action === "cuts" ? newClips : newMarkers);
    });
}(ZenviLink));
// ---- ppro/80-output.jsx ----
// Zenvi Link: Premiere Pro output and interchange. premiere_capture_frame,
// premiere_export, premiere_export_xml, premiere_import_xml.

(function (Z) {
    var P = Z.ppro;

    /** A file name without characters Windows or macOS refuse (keeps spaces and dots). */
    P.fileSafe = function (text) {
        var cleaned = String(text).replace(/[\\\/:*?"<>|\u0000-\u001f]+/g, "-").replace(/^[\s.]+|[\s.]+$/g, "");
        return cleaned.length ? cleaned.slice(0, 120) : "Untitled";
    };

    /** The folder of the open project, or Documents when the project was never saved. */
    function projectFolder() {
        var path = P.projectPath();
        return path ? new File(path).parent.fsName : Folder.myDocuments.fsName;
    }

    // ------------------------------------------------------------------
    // premiere_capture_frame

    Z.register("premiere_capture_frame", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var time = Z.optional(args, "time", "number", null);
        var qeSequence;
        var timecode;
        var base;
        var expected;
        var stale;
        var size;
        time = time === null ? P.timeToSeconds(sequence.getPlayerPosition()) : Z.inRange("time", time, 0, null);
        time = P.snapTime(sequence, time, ctx, "time");
        qeSequence = P.qeSequence(sequence, ctx);
        if (!Z.hasMethod(qeSequence, "exportFramePNG")) {
            throw Z.refuse("UNSUPPORTED", "This Premiere build's QE DOM has no exportFramePNG");
        }
        timecode = P.timecode(sequence, time);
        // exportFramePNG(timecode, path without extension) appends ".png" itself and cuts the
        // name at its first dot, so the name has none (premiere-pro-mcp, Premiere 25.2).
        base = P.join(P.tempFolder().fsName, P.uniqueName("zenvi-frame"));
        expected = base + ".png";
        stale = new File(expected);
        if (stale.exists) {
            stale.remove();
        }
        qeSequence.exportFramePNG(timecode, base);
        // QE writes the PNG in the background: wait (up to 20 s) for a whole one, so the server
        // never reads a half-written image.
        size = P.waitForFile(expected, 20000, P.isCompletePng);
        if (!size) {
            stale = new File(expected);
            if (stale.exists && !stale.remove()) {
                ctx.warn("Could not remove the incomplete " + expected);
            }
            throw Z.fail("HOST_ERROR", "Premiere wrote no complete PNG to " + expected + " within 20 s (QE exportFramePNG at " + timecode + ")");
        }
        return Z.ok("Captured " + timecode + " (" + Z.round(time, 4) + " s) of \"" + sequence.name + "\" at " +
            sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical, {
            image_path: expected,
            time: Z.round(time, 4),
            timecode: timecode,
            frame: Math.round(time * P.fps(sequence)),
            width: sequence.frameSizeHorizontal,
            height: sequence.frameSizeVertical,
            sequence_id: sequence.sequenceID,
            bytes: size
        });
    });

    // ------------------------------------------------------------------
    // premiere_export

    /**
     * Named presets: Media Encoder preset file names to look for, best first,
     * and the format folder they live in (systempresets/<exporter>_<format>, the
     * format in hex: 48323634 = "H264", 4D6F6F56 = "MooV" QuickTime).
     */
    var EXPORT_PRESETS = {
        "h264-high": {
            format: "48323634",
            ext: "mp4",
            names: ["Match Source - Adaptive High Bitrate", "Match Source - High bitrate", "High Quality 1080p HD"]
        },
        "h264-social-vertical": {
            format: "48323634",
            ext: "mp4",
            vertical: true,
            names: ["Match Source - Adaptive High Bitrate", "Match Source - High bitrate"]
        },
        "prores-422": {
            format: "4d6f6f56",
            ext: "mov",
            names: ["Apple ProRes 422"],
            contains: "prores 422",
            exclude: /hq|lt|proxy|4444|xq|raw/
        }
    };

    var WORK_AREA = {entire: 0, "in-out": 1, "work-area": 2};

    function normalName(text) {
        return Z.trim(String(text).toLowerCase().replace(/\.epr$/, "").replace(/[^a-z0-9]+/g, " "));
    }

    /** Folders holding export presets: Premiere's and Media Encoder's systempresets, and the user's Media Encoder presets. */
    P.exportPresetRoots = function () {
        var roots = [];
        var resources = P.appResources();
        var appFolder;
        var parent;
        var entries;
        var bundles;
        var entry;
        var versions;
        var i;
        var j;
        var user;
        if (resources) {
            roots.push(new Folder(resources.fsName + "/MediaIO/systempresets"));
        }
        if (app.path) {
            appFolder = new Folder(String(app.path).replace(/[\\\/]+$/, ""));
            parent = /\.app$/i.test(appFolder.fsName) ? appFolder.parent.parent : appFolder.parent;
            entries = parent && parent.exists ? parent.getFiles() : [];
            for (i = 0; i < entries.length; i += 1) {
                entry = entries[i];
                if (entry instanceof Folder && /^Adobe Media Encoder/i.test(decodeURI(entry.name))) {
                    bundles = entry.getFiles();
                    for (j = 0; j < bundles.length; j += 1) {
                        if (bundles[j] instanceof Folder && /\.app$/i.test(decodeURI(bundles[j].name))) {
                            roots.push(new Folder(bundles[j].fsName + "/Contents/MediaIO/systempresets"));
                        }
                    }
                    roots.push(new Folder(entry.fsName + "/MediaIO/systempresets"));
                }
            }
        }
        user = new Folder(Folder.myDocuments.fsName + "/Adobe/Adobe Media Encoder");
        versions = user.exists ? user.getFiles() : [];
        for (i = 0; i < versions.length; i += 1) {
            if (versions[i] instanceof Folder) {
                roots.push(new Folder(versions[i].fsName + "/Presets"));
            }
        }
        return Z.filter(roots, function (root) { return root.exists; });
    };

    P.exportPresets = function () {
        var presets = [];
        Z.each(P.exportPresetRoots(), function (root) {
            Z.each(P.findFiles(root, function (name) { return /\.epr$/i.test(name); }, 3, 3000), function (file) {
                presets.push({
                    file: file,
                    name: decodeURI(file.name).replace(/\.epr$/i, ""),
                    normal: normalName(decodeURI(file.name)),
                    bucket: file.parent ? decodeURI(file.parent.name).toLowerCase() : ""
                });
            });
        });
        return presets;
    };

    function bestOf(candidates, format) {
        var inFormat = Z.filter(candidates, function (preset) { return preset.bucket.indexOf(format) >= 0; });
        var pool = inFormat.length ? inFormat : candidates;
        var best = null;
        Z.each(pool, function (preset) {
            if (best === null || preset.name.length < best.name.length) {
                best = preset;
            }
        });
        return best;
    }

    /** {path, name} of the .epr for a named preset or a path; refuses NOT_FOUND listing what is installed. */
    function resolvePreset(preset) {
        var rule;
        var all;
        var found = null;
        var i;
        var examples;
        if (/^(\/|[A-Za-z]:[\\\/]|\\\\)/.test(preset)) {
            if (P.extensionOf(preset) !== "epr") {
                throw Z.refuse("INVALID_ARGUMENT", "`preset` must be h264-high, h264-social-vertical, prores-422 or an .epr file, got " + preset);
            }
            if (!P.isFile(preset)) {
                throw Z.refuse("NOT_FOUND", "No export preset at " + preset);
            }
            return {path: preset, name: P.baseName(preset).replace(/\.epr$/i, ""), rule: null};
        }
        rule = EXPORT_PRESETS[Z.oneOf("preset", preset, Object.keys(EXPORT_PRESETS))];
        all = P.exportPresets();
        for (i = 0; i < rule.names.length && !found; i += 1) {
            found = bestOf(Z.filter(all, function (candidate) { return candidate.normal === normalName(rule.names[i]); }), rule.format);
        }
        if (!found && rule.contains) {
            found = bestOf(Z.filter(all, function (candidate) {
                return candidate.normal.indexOf(rule.contains) >= 0 && !rule.exclude.test(candidate.normal);
            }), rule.format);
        }
        if (!found) {
            examples = Z.map(all.slice(0, 12), function (candidate) { return candidate.name; });
            throw Z.refuse("NOT_FOUND", "No installed export preset matches " + preset + " (looked for " + rule.names.join(", ") +
                " in Premiere and Media Encoder presets). Found " + Z.plural(all.length, "preset") +
                (examples.length ? ", e.g. " + examples.join(", ") : "") + ". Pass the path of an .epr instead");
        }
        return {path: found.file.fsName, name: found.name, rule: rule};
    }

    function outputPath(args, sequence, ext) {
        var output = Z.optional(args, "output", "string", null);
        if (output === null) {
            return P.join(P.join(projectFolder(), "Zenvi Exports"), P.fileSafe(sequence.name) + "." + ext);
        }
        return P.extensionOf(output) === "" ? output + "." + ext : output;
    }

    Z.register("premiere_export", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var presetArg = Z.optional(args, "preset", "string", "h264-high");
        var range = Z.oneOf("range", Z.optional(args, "range", "string", "entire"), Object.keys(WORK_AREA));
        var via = Z.oneOf("via", Z.optional(args, "via", "string", "media_encoder"), ["media_encoder", "direct"]);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var preset = resolvePreset(presetArg);
        var ext = "";
        var output;
        var existing;
        var status = null;
        var job;
        var result;
        var written;
        var ratio = sequence.frameSizeHorizontal / sequence.frameSizeVertical;

        if (preset.rule && preset.rule.vertical && Math.abs(ratio - 9 / 16) > 0.01) {
            throw Z.refuse("INVALID_ARGUMENT", "h264-social-vertical needs a 9:16 sequence; \"" + sequence.name + "\" is " +
                sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical + ". Run premiere_auto_reframe with aspect 9:16 and export that");
        }
        try {
            ext = String(sequence.getExportFileExtension(preset.path) || "").replace(/^\./, "");
        } catch (error) {
            ext = "";
        }
        if (!ext) {
            ext = preset.rule ? preset.rule.ext : "mp4";
        }
        output = outputPath(args, sequence, ext);
        existing = new File(output);
        if (existing.exists && !overwrite) {
            throw Z.refuse("INVALID_ARGUMENT", output + " already exists; pass overwrite: true or another `output`");
        }
        if (P.extensionOf(output) !== ext.toLowerCase()) {
            ctx.warn("The preset writes ." + ext + " files; the output is named " + P.baseName(output));
        }
        if (via === "media_encoder") {
            P.requireFeature(app.encoder && Z.hasMethod(app.encoder, "encodeSequence"), "Exporting through Media Encoder (app.encoder)",
                "2022 (22.0) on macOS");
            if (typeof BridgeTalk !== "undefined" && BridgeTalk && Z.hasMethod(BridgeTalk, "getStatus")) {
                status = String(BridgeTalk.getStatus("ame"));
            }
            if (status === "ISNOTINSTALLED") {
                throw Z.refuse("UNSUPPORTED", "Adobe Media Encoder is not installed; pass via: direct to render inside Premiere");
            }
        }

        ctx.changed();
        if (existing.exists) {
            existing.remove();
        }
        P.ensureParent(output);
        if (via === "media_encoder") {
            if (status === "ISNOTRUNNING") {
                app.encoder.launchEncoder();
                ctx.warn("Started Adobe Media Encoder");
            }
            job = app.encoder.encodeSequence(sequence, output, preset.path, WORK_AREA[range], 1);
            if (!job || String(job) === "0") {
                throw Z.fail("HOST_ERROR", "Media Encoder did not accept the job for \"" + sequence.name + "\"");
            }
            app.encoder.startBatch();
            return Z.applied("Queued \"" + sequence.name + "\" in Media Encoder with " + preset.name + " (job " + job + "); it renders to " + output, {
                job: {id: String(job), via: "media_encoder", status: "queued"},
                output: output,
                preset: {name: preset.name, path: preset.path},
                range: range,
                sequence_id: sequence.sequenceID
            }, 0);
        }
        result = sequence.exportAsMediaDirect(output, preset.path, WORK_AREA[range]);
        written = new File(output);
        if (!written.exists || written.length === 0) {
            throw Z.fail("HOST_ERROR", "Premiere wrote no file at " + output + (result ? " (exportAsMediaDirect returned " + String(result) + ")" : ""));
        }
        return Z.applied("Exported \"" + sequence.name + "\" to " + output + " (" + Z.round(written.length / 1048576, 1) + " MB) with " + preset.name, {
            job: {id: null, via: "direct", status: "done"},
            output: output,
            bytes: written.length,
            preset: {name: preset.name, path: preset.path},
            range: range,
            sequence_id: sequence.sequenceID
        }, 0);
    });

    // ------------------------------------------------------------------
    // premiere_export_xml

    Z.register("premiere_export_xml", function (args, ctx) {
        var sequence = P.findSequence(args.sequence);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var output = Z.optional(args, "output", "string", null);
        var existing;
        var size;
        if (output === null) {
            output = P.join(P.tempFolder().fsName, P.safeName(sequence.name) + "-" + new Date().getTime() + ".xml");
        } else if (P.extensionOf(output) !== "xml") {
            throw Z.refuse("INVALID_ARGUMENT", "`output` must end in .xml, got " + output);
        }
        existing = new File(output);
        if (existing.exists && !overwrite) {
            throw Z.refuse("INVALID_ARGUMENT", output + " already exists; pass overwrite: true or another `output`");
        }
        ctx.changed();
        if (existing.exists) {
            existing.remove();
        }
        P.ensureParent(output);
        // 1 = suppress warning dialogs (PProPanel exportFCPXML).
        sequence.exportAsFinalCutProXML(output, 1);
        size = P.waitForFile(output, 10000);
        if (!size) {
            throw Z.fail("HOST_ERROR", "Premiere wrote no XML at " + output);
        }
        return Z.applied("Exported \"" + sequence.name + "\" as FCP XML to " + output, {
            path: output,
            bytes: size,
            sequence_id: sequence.sequenceID,
            name: String(sequence.name)
        }, 0);
    });

    // ------------------------------------------------------------------
    // premiere_import_xml

    function isOffline(item) {
        try {
            return Z.hasMethod(item, "isOffline") && item.isOffline() === true;
        } catch (error) {
            return false;
        }
    }

    Z.register("premiere_import_xml", function (args, ctx) {
        var path = Z.required(args, "path", "string");
        var binRef = Z.optional(args, "bin", "string", "Zenvi Imports");
        var open = Z.optional(args, "open", "boolean", true);
        var created = [];
        var bin;
        var beforeSequences;
        var beforeItems;
        var sequences = [];
        var items;
        var offline;
        var all;
        var i;
        if (P.extensionOf(path) !== "xml") {
            throw Z.refuse("INVALID_ARGUMENT", "`path` must be an .xml file (Final Cut Pro 7 XML), got " + path);
        }
        if (!P.isFile(path)) {
            throw Z.refuse("NOT_FOUND", "No file at " + path);
        }
        bin = P.findBin(binRef, true, ctx, created);
        beforeSequences = P.sequenceIds();
        beforeItems = P.itemIds();
        ctx.changed();
        app.project.importFiles([path], true, bin, false);
        all = P.sequences();
        for (i = 0; i < all.length; i += 1) {
            if (!Z.has(beforeSequences, all[i].sequenceID)) {
                sequences.push(all[i]);
            }
        }
        items = P.newItems(beforeItems);
        if (sequences.length === 0) {
            throw Z.fail("HOST_ERROR", "Premiere imported no sequence from " + P.baseName(path) +
                " (is it Final Cut Pro 7 XML, xmeml?)" + (items.length ? "; it added " + Z.plural(items.length, "item") : ""));
        }
        offline = Z.filter(items, isOffline);
        if (offline.length > 0) {
            ctx.warn(Z.plural(offline.length, "media item") + " offline (missing at the XML's paths): " +
                Z.map(offline.slice(0, 5), function (item) { return String(item.name); }).join(", "));
        }
        if (open) {
            P.openSequence(sequences[0]);
        }
        return Z.applied("Imported \"" + P.baseName(path) + "\": " + Z.map(sequences, function (sequence) {
            return "\"" + sequence.name + "\" (" + sequence.frameSizeHorizontal + "x" + sequence.frameSizeVertical + ", " +
                Z.round(P.fps(sequence), 3) + " fps, " + Z.round(P.ticksToSeconds(sequence.end), 3) + " s)";
        }).join(", ") + (open ? ", opened" : ""), {
            sequences: Z.map(sequences, P.sequenceSummary),
            items: items.length,
            offline: Z.map(offline, function (item) { return {node_id: item.nodeId, name: String(item.name)}; }),
            bin: binRef,
            created_bins: created
        }, 1 + created.length);
    });
}(ZenviLink));
// ---- ppro/90-script.jsx ----
// Zenvi Link: premiere_run_script, the ExtendScript escape hatch.

(function (Z) {
    var P = Z.ppro;

    /** Run `source` in its own function scope; its completion value is returned. */
    function evaluate(source) {
        return eval(source);
    }

    /** A JSON-safe copy of a script result (host objects become their string form). */
    function jsonValue(value) {
        var text;
        if (value === undefined) {
            return null;
        }
        if (typeof value === "function") {
            return String(value);
        }
        try {
            text = JSON.stringify(value);
        } catch (error) {
            text = undefined;
        }
        if (text === undefined) {
            return String(value);
        }
        return JSON.parse(text);
    }

    Z.register("premiere_run_script", function (args, ctx) {
        var source = Z.required(args, "script", "string");
        var value;
        var line;
        if (Z.trim(source).length === 0) {
            throw Z.refuse("INVALID_ARGUMENT", "`script` must not be blank");
        }
        try {
            P.qe();
        } catch (qeError) {
            ctx.warn("The QE DOM is not available: " + String(qeError.message || qeError));
        }
        ctx.changed();
        try {
            value = evaluate(source);
        } catch (error) {
            line = error && typeof error.line === "number" ? " (line " + error.line + ")" : "";
            throw Z.fail("HOST_ERROR", "The script failed: " + String(error && error.message ? error.message : error) + line);
        }
        return Z.applied("Ran the script; it returned " + (value === undefined ? "nothing" : (value === null ? "null" : (typeof value === "object" ? "an object" : "a " + typeof value))), {
            result: jsonValue(value),
            type: value === null ? "null" : typeof value
        });
    });
}(ZenviLink));
