// Zenvi Link 1.0.0: host script for After Effects. Built from extension/host/{common,aeft}/*.jsx; do not edit.
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
ZenviLink.CATALOG = {"ae_get_state":{"title":"After Effects state","mutating":false},"ae_list_items":{"title":"List project items","mutating":false},"ae_get_comp":{"title":"Inspect comp","mutating":false},"ae_get_layer":{"title":"Inspect layer","mutating":false},"ae_capture_frame":{"title":"Capture comp frame","mutating":false},"ae_create_comp":{"title":"Create comp","mutating":true},"ae_set_comp":{"title":"Change comp settings","mutating":true},"ae_import_files":{"title":"Import files","mutating":true},"ae_add_layer":{"title":"Add layer","mutating":true},"ae_add_text":{"title":"Add text","mutating":true},"ae_set_text":{"title":"Change text","mutating":true},"ae_set_layer":{"title":"Change layer","mutating":true},"ae_arrange_layers":{"title":"Arrange layers","mutating":true},"ae_set_property":{"title":"Set property","mutating":true},"ae_animate":{"title":"Animate property","mutating":true},"ae_apply_motion_preset":{"title":"Apply motion preset","mutating":true},"ae_add_expression":{"title":"Set expression","mutating":true},"ae_apply_effect":{"title":"Apply effect","mutating":true},"ae_set_effect":{"title":"Change effect","mutating":true},"ae_list_effects":{"title":"List installed effects","mutating":false},"ae_apply_look":{"title":"Apply colour look","mutating":true},"ae_add_mask":{"title":"Add mask","mutating":true},"ae_precompose":{"title":"Precompose layers","mutating":true},"ae_add_marker":{"title":"Add marker","mutating":true},"ae_render":{"title":"Render comp","mutating":true},"ae_save_project":{"title":"Save project","mutating":true},"ae_undo":{"title":"Undo Zenvi steps","mutating":true},"ae_run_jsx_file":{"title":"Run JSX file","mutating":true},"ae_run_script":{"title":"Run ExtendScript","mutating":true},"ae_render_for_zenvi":{"title":"Render for Zenvi","mutating":true}};
// ---- aeft/00-aeft-core.jsx ----
// Zenvi Link: After Effects host core. The helpers every ae_* tool uses
// (ZenviLink.ae), the undo-group adapter, and ae_get_state.
//
// IDs (SPEC 3.3): items by item.id; layers by layer.id (After Effects 22+)
// plus comp_id + layer_index for convenience. Times are comp seconds.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = /** @type {ZenviAe} */ ({});
    Z.ae = AE;
    Z.host = "aftereffects";

    Z.adapter = {
        // Exactly one undo group per mutating call, so one call = one undo step.
        undoStepsWhenApplied: 1,
        runMutating: function (title, fn) {
            app.beginUndoGroup("Zenvi: " + title);
            try {
                return fn();
            } finally {
                app.endUndoGroup();
            }
        },
        partialChangeWarning: function (title) {
            return "The call failed after it had started changing the project; Edit > Undo \"Zenvi: " + title +
                "\" reverts what it did.";
        },
        info: function () {
            return {app_version: String(app.version), project: AE.projectPath()};
        }
    };

    // ------------------------------------------------------------------
    // Project, items, comps.

    /** Absolute path of the saved project, or null while it is untitled. */
    AE.projectPath = function () {
        var file = app.project ? app.project.file : null;
        return file ? file.fsName : null;
    };

    AE.requireProject = function () {
        if (!app.project) {
            throw Z.refuse("NO_PROJECT", "No After Effects project is open");
        }
        return app.project;
    };

    /** The comp in the active viewer/timeline, or null. */
    AE.activeComp = function () {
        var item = app.project ? app.project.activeItem : null;
        return item && item instanceof CompItem ? item : null;
    };

    AE.requireActiveComp = function () {
        var comp = AE.activeComp();
        if (!comp) {
            throw Z.refuse("NO_ACTIVE_COMP", "No comp is active; open one in the Timeline or pass `comp` (an id from ae_list_items)");
        }
        return comp;
    };

    /** The project item with this id; refuses NOT_FOUND. */
    AE.findItem = function (id) {
        var project = AE.requireProject();
        var item = null;
        var i;
        if (typeof id !== "number" || Math.floor(id) !== id) {
            throw Z.refuse("INVALID_ARGUMENT", "Item ids are integers; got " + String(id));
        }
        if (Z.hasMethod(project, "itemByID")) {
            try {
                item = project.itemByID(id);
            } catch (lookupError) {
                item = null;
            }
        } else {
            for (i = 1; i <= project.numItems; i += 1) {
                if (project.item(i).id === id) {
                    item = project.item(i);
                    break;
                }
            }
        }
        if (!item) {
            throw Z.refuse("NOT_FOUND", "No project item has id " + id + " (ae_list_items lists them)");
        }
        return item;
    };

    /**
     * A comp from a tool's `comp` argument: undefined/null = the active comp,
     * a number = item id, a string = exact comp name (refused when ambiguous).
     */
    AE.findComp = function (ref) {
        var project;
        var item;
        var matches;
        var i;
        if (ref === undefined || ref === null) {
            return AE.requireActiveComp();
        }
        if (typeof ref === "number") {
            item = AE.findItem(ref);
            if (!(item instanceof CompItem)) {
                throw Z.refuse("INVALID_ARGUMENT", "Item " + ref + " (\"" + item.name + "\") is a " + AE.itemType(item) + ", not a comp");
            }
            return item;
        }
        if (typeof ref === "string" && ref.length > 0) {
            project = AE.requireProject();
            matches = [];
            for (i = 1; i <= project.numItems; i += 1) {
                item = project.item(i);
                if (item instanceof CompItem && item.name === ref) {
                    matches.push(item);
                }
            }
            if (matches.length === 1) {
                return matches[0];
            }
            if (matches.length === 0) {
                throw Z.refuse("NOT_FOUND", "No comp is named \"" + ref + "\"");
            }
            throw Z.refuse("INVALID_ARGUMENT", matches.length + " comps are named \"" + ref + "\" (ids " +
                Z.map(matches, function (comp) { return comp.id; }).join(", ") + "); pass the comp id");
        }
        throw Z.refuse("INVALID_ARGUMENT", "`comp` must be a comp id or an exact comp name");
    };

    // ------------------------------------------------------------------
    // Layers.

    /** layer.id (After Effects 22+), else null. */
    AE.layerId = function (layer) {
        return typeof layer.id === "number" ? layer.id : null;
    };

    /**
     * A layer from a `layer` argument: a number = layer id (After Effects
     * 22+), {index: n} = 1-based index in `comp`, a string = exact name in
     * `comp` (refused when ambiguous). `comp` may be null: an id then finds
     * the layer in any comp, an index or name uses the active comp.
     */
    AE.findLayer = function (comp, ref) {
        var layer = null;
        var matches;
        var i;
        if (typeof ref === "number") {
            if (Math.floor(ref) !== ref || ref < 1) {
                throw Z.refuse("INVALID_ARGUMENT", "Layer ids are positive integers; got " + ref);
            }
            if (!Z.hasMethod(app.project, "layerByID")) {
                throw Z.refuse("UNSUPPORTED", "Layer ids need After Effects 2022 (22.0) or newer; pass {\"index\": n} or the layer name");
            }
            try {
                layer = app.project.layerByID(ref);
            } catch (lookupError) {
                layer = null;
            }
            if (!layer) {
                throw Z.refuse("NOT_FOUND", "No layer has id " + ref);
            }
            if (comp && layer.containingComp.id !== comp.id) {
                throw Z.refuse("NOT_FOUND", "Layer " + ref + " is in comp \"" + layer.containingComp.name + "\" (id " +
                    layer.containingComp.id + "), not in \"" + comp.name + "\" (id " + comp.id + ")");
            }
            return layer;
        }
        if (!comp) {
            comp = AE.requireActiveComp();
        }
        if (Z.isObject(ref) && Z.has(ref, "index")) {
            if (typeof ref.index !== "number" || Math.floor(ref.index) !== ref.index || ref.index < 1 || ref.index > comp.numLayers) {
                throw Z.refuse("NOT_FOUND", "Comp \"" + comp.name + "\" has " + Z.plural(comp.numLayers, "layer") +
                    "; there is no layer index " + String(ref.index));
            }
            return comp.layer(ref.index);
        }
        if (typeof ref === "string" && ref.length > 0) {
            matches = [];
            for (i = 1; i <= comp.numLayers; i += 1) {
                if (comp.layer(i).name === ref) {
                    matches.push(comp.layer(i));
                }
            }
            if (matches.length === 1) {
                return matches[0];
            }
            if (matches.length === 0) {
                throw Z.refuse("NOT_FOUND", "Comp \"" + comp.name + "\" has no layer named \"" + ref + "\"");
            }
            throw Z.refuse("INVALID_ARGUMENT", matches.length + " layers in \"" + comp.name + "\" are named \"" + ref +
                "\" (indexes " + Z.map(matches, function (match) { return match.index; }).join(", ") + "); pass {\"index\": n} or the layer id");
        }
        throw Z.refuse("INVALID_ARGUMENT", "`layer` must be a layer id, {\"index\": n} or an exact layer name");
    };

    // ------------------------------------------------------------------
    // Descriptions shared by receipts.

    AE.itemType = function (item) {
        if (item instanceof CompItem) {
            return "comp";
        }
        if (item instanceof FolderItem) {
            return "folder";
        }
        if (item instanceof FootageItem) {
            if (item.mainSource instanceof SolidSource) {
                return "solid";
            }
            if (item.mainSource instanceof PlaceholderSource) {
                return "placeholder";
            }
            return "footage";
        }
        return "item";
    };

    AE.layerType = function (layer) {
        var source;
        if (layer instanceof TextLayer) {
            return "text";
        }
        if (layer instanceof ShapeLayer) {
            return "shape";
        }
        if (layer instanceof CameraLayer) {
            return "camera";
        }
        if (layer instanceof LightLayer) {
            return "light";
        }
        if (layer instanceof AVLayer) {
            if (layer.nullLayer) {
                return "null";
            }
            if (layer.adjustmentLayer) {
                return "adjustment";
            }
            source = layer.source;
            if (source instanceof CompItem) {
                return "precomp";
            }
            if (source && source.mainSource instanceof SolidSource) {
                return "solid";
            }
            if (source && !source.hasVideo && source.hasAudio) {
                return "audio";
            }
            return "footage";
        }
        return "layer";
    };

    /** {layer_id, comp_id, layer_index, name, type}. */
    AE.layerRef = function (layer) {
        return {
            layer_id: AE.layerId(layer),
            comp_id: layer.containingComp ? layer.containingComp.id : null,
            layer_index: layer.index,
            name: layer.name,
            type: AE.layerType(layer)
        };
    };

    AE.compSummary = function (comp) {
        return {
            comp_id: comp.id,
            name: comp.name,
            width: comp.width,
            height: comp.height,
            pixel_aspect: comp.pixelAspect,
            fps: Z.round(comp.frameRate, 3),
            duration: Z.round(comp.duration, 4),
            work_area: {start: Z.round(comp.workAreaStart, 4), duration: Z.round(comp.workAreaDuration, 4)},
            time: Z.round(comp.time, 4),
            num_layers: comp.numLayers,
            bg_color: Z.color.toHex(comp.bgColor)
        };
    };

    // ------------------------------------------------------------------
    // Time and colour.

    /** `seconds` snapped to the comp's frame grid (warns in ctx when it moved). */
    AE.snapTime = function (comp, seconds, ctx, label) {
        return Z.snapToFrame(seconds, comp.frameRate, ctx, label);
    };

    /** "#RRGGBB" or [r, g, b] -> After Effects colour array [r, g, b] (0-1). */
    AE.color = function (value, key) {
        return Z.color.toRgb(value, key);
    };

    // ------------------------------------------------------------------
    // Render queue.

    var RQ_STATUS_NAMES = ["WILL_CONTINUE", "NEEDS_OUTPUT", "UNQUEUED", "QUEUED", "RENDERING", "USER_STOPPED", "ERR_STOPPED", "DONE"];

    AE.renderStatusName = function (status) {
        var i;
        for (i = 0; i < RQ_STATUS_NAMES.length; i += 1) {
            if (RQItemStatus[RQ_STATUS_NAMES[i]] === status) {
                return RQ_STATUS_NAMES[i].toLowerCase();
            }
        }
        return String(status);
    };

    /** Output file of a render queue item's first output module, or null. */
    AE.renderOutputPath = function (rqItem) {
        var module;
        try {
            module = rqItem.numOutputModules > 0 ? rqItem.outputModule(1) : null;
            return module && module.file ? module.file.fsName : null;
        } catch (moduleError) {
            return null;
        }
    };

    // ------------------------------------------------------------------
    // ae_get_state

    Z.register("ae_get_state", function (args, ctx) {
        var project = AE.requireProject();
        var comp = AE.activeComp();
        var queue = project.renderQueue;
        var selectedItems = Z.map(project.selection || [], function (item) {
            return {id: item.id, name: item.name, type: AE.itemType(item)};
        });
        var selectedLayers = comp ? Z.map(comp.selectedLayers || [], AE.layerRef) : [];
        var queued = [];
        var parts = [];
        var rqItem;
        var i;
        for (i = 1; i <= queue.numItems && queued.length < 20; i += 1) {
            rqItem = queue.item(i);
            queued.push({
                index: i,
                comp_id: rqItem.comp ? rqItem.comp.id : null,
                comp_name: rqItem.comp ? rqItem.comp.name : null,
                status: AE.renderStatusName(rqItem.status),
                output: AE.renderOutputPath(rqItem)
            });
        }
        if (queue.numItems > queued.length) {
            ctx.warn("Render queue lists the first " + queued.length + " of " + queue.numItems + " items");
        }

        parts.push("After Effects " + app.version);
        parts.push(project.file ? "project \"" + project.file.displayName + "\"" + (project.dirty ? " (unsaved changes)" : "") : "untitled project");
        parts.push(comp ? "active comp \"" + comp.name + "\" (id " + comp.id + ", " + comp.width + "x" + comp.height + ", " +
            Z.round(comp.frameRate, 3) + " fps, " + Z.round(comp.duration, 3) + " s, " + Z.plural(comp.numLayers, "layer") + ")" : "no active comp");
        if (selectedLayers.length > 0) {
            parts.push(Z.plural(selectedLayers.length, "layer") + " selected");
        } else if (selectedItems.length > 0) {
            parts.push(Z.plural(selectedItems.length, "item") + " selected");
        }
        parts.push(queue.numItems ? "render queue: " + Z.plural(queue.numItems, "item") : "render queue empty");

        return Z.ok(parts.join(", "), {
            app: {
                name: "Adobe After Effects",
                version: String(app.version),
                build: app.buildName ? String(app.buildName) : null,
                language: app.isoLanguage ? String(app.isoLanguage) : null
            },
            project: {
                path: AE.projectPath(),
                name: project.file ? project.file.displayName : null,
                dirty: typeof project.dirty === "boolean" ? project.dirty : null,
                num_items: project.numItems,
                bits_per_channel: project.bitsPerChannel
            },
            active_comp: comp ? AE.compSummary(comp) : null,
            selection: {items: selectedItems, layers: selectedLayers},
            render_queue: {num_items: queue.numItems, rendering: queue.rendering === true, items: queued}
        });
    });
}(ZenviLink));
// ---- aeft/01-aeft-util.jsx ----
// Zenvi Link: After Effects shared helpers (ZenviLink.ae): enums by name,
// TASTE lookups, safe areas, folders, files and time formatting.
//
// DOM objects are compared by id or index, never with ===: After Effects
// hands out a new wrapper object each time a script asks for one.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    // ------------------------------------------------------------------
    // State that must outlive the host script being evaluated again (the
    // panel opening does that): ae_undo's journal and the output module
    // template list. ZenviLink.state survives; ZenviLink.ae does not.

    if (!Z.state.ae) {
        Z.state.ae = {journal: [], outputTemplates: null};
    }
    AE.state = Z.state.ae;

    /**
     * Run fn inside one undo group "Zenvi: <title>", for the tools registered
     * without dispatch's group because part of their work (Undo, a render,
     * Media Encoder) must not run inside one. With `summary` the step goes in
     * ae_undo's journal (AE.remember, 70-aeft-project.jsx).
     */
    AE.inUndoGroup = function (title, fn, summary) {
        var result;
        app.beginUndoGroup("Zenvi: " + title);
        try {
            result = fn();
        } finally {
            app.endUndoGroup();
        }
        if (summary && AE.remember) {
            AE.remember(title, summary);
        }
        return result;
    };

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

    /**
     * A folder inside Zenvi Link's temp folder (ZenviLink.tempDir(): the
     * server's choice, else <temp>/zenvi-link), created when missing. Renders
     * for Zenvi go to "renders". Paths are joined on fullName, which always
     * uses "/".
     */
    AE.tempFolder = function (name) {
        var folder = new Folder(new Folder(Z.tempDir()).fullName + "/" + name);
        if (!folder.exists && !folder.create()) {
            throw Z.fail("HOST_ERROR", "Could not create folder " + folder.fsName);
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
// ---- aeft/02-aeft-props.jsx ----
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

    /** True for a property whose dimensions are separated (Position with X/Y/Z Position in use). */
    AE.isSeparated = function (property) {
        try {
            return property.isSeparationLeader === true && property.dimensionsSeparated === true;
        } catch (notSeparable) {
            return false;
        }
    };

    /**
     * Like resolveProperty, but the result must be a property with a value
     * that can be set: not a group, not a leader whose dimensions are separated.
     */
    AE.resolveLeaf = function (layer, path) {
        var target = AE.resolveProperty(layer, path);
        if (!AE.isLeaf(target.property)) {
            throw Z.refuse("INVALID_ARGUMENT", "\"" + target.path + "\" is a group; name one of its properties: " + AE.childNames(target.property));
        }
        if (AE.isSeparated(target.property)) {
            throw Z.refuse("INVALID_ARGUMENT", target.path + " of \"" + layer.name + "\" has separated dimensions; set \"Transform/X Position\" and " +
                "\"Transform/Y Position\" (and \"Transform/Z Position\") instead");
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
            // Keep the style of the document in effect where the text goes (a keyframe's, when given).
            doc = current instanceof TextDocument ? current : property.value;
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

    var PATH_SAMPLES = 24;

    /**
     * Length of the motion path between two keys, sampled along the curve
     * After Effects draws (auto-Bezier paths bend through neighbouring keys).
     */
    function pathLength(property, t0, t1) {
        var length = 0;
        var previous = property.valueAtTime(t0, true);
        var current;
        var k;
        for (k = 1; k <= PATH_SAMPLES; k += 1) {
            current = property.valueAtTime(t0 + (t1 - t0) * k / PATH_SAMPLES, true);
            length += distance(previous, current);
            previous = current;
        }
        return length;
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
        if (AE.isSeparated(property)) {
            throw Z.refuse("INVALID_ARGUMENT", path + " has separated dimensions; animate X Position and Y Position instead");
        }
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
        // Interpolation and spatial paths first: a spatial ease's speed is along the path they make.
        for (i = 0; i < count; i += 1) {
            property.setInterpolationTypeAtKey(indexes[i], inType[i], outType[i]);
            property.setTemporalContinuousAtKey(indexes[i], false);
            property.setTemporalAutoBezierAtKey(indexes[i], false);
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
        for (i = 0; i < count - 1; i += 1) {
            segment = keys[i].curve;
            if (segment.type !== "bezier") {
                continue;
            }
            deltas = property.isSpatial ? [pathLength(property, keys[i].time, keys[i + 1].time)] : changes(property, keys[i].value, keys[i + 1].value);
            ease = AE.segmentEase(segment, deltas, keys[i + 1].time - keys[i].time, property.isSpatial);
            outEase[i] = easeList(dims, ease.outSpeed, ease.outInfluence);
            inEase[i + 1] = easeList(dims, ease.inSpeed, ease.inInfluence);
        }
        for (i = 0; i < count; i += 1) {
            if (inType[i] === KeyframeInterpolationType.BEZIER || outType[i] === KeyframeInterpolationType.BEZIER) {
                property.setTemporalEaseAtKey(indexes[i], inEase[i], outEase[i]);
                if (inType[i] !== outType[i]) {
                    // Setting an ease can turn a linear or hold side into Bezier, as the
                    // Keyframe Velocity dialog does; put the other side back.
                    property.setInterpolationTypeAtKey(indexes[i], inType[i], outType[i]);
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
// ---- aeft/03-aeft-text.jsx ----
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
        if (!Z.hasMethod(fonts, "getFontsByPostScriptName")) {
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
            if (Z.indexOf(out, list[i]) < 0) {
                out.push(list[i]);
            }
        }
        return out;
    };

    /**
     * Apply `spec` to a Source Text property and set it: {text, size, fill
     * ([r, g, b]), stroke ([r, g, b] | null = none), strokeWidth, tracking,
     * leading (x size), justification (enum), box ([w, h]), fonts (candidate
     * PostScript names, first available wins), requestedFont, reset (start
     * from default character and paragraph styles, so nothing left in the
     * user's Character panel, such as faux bold or baseline shift, leaks
     * in)}. Returns the applied {font, size}.
     */
    AE.setTextDocument = function (textProperty, spec, ctx) {
        var doc = textProperty.value;
        var size;
        var chosen = null;
        var skipped = [];
        var available;
        var i;
        if (spec.reset) {
            doc.resetCharStyle();
            doc.resetParagraphStyle();
        }
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
     * word boundaries (After Effects' "\r" separates lines). A word longer
     * than that (a URL) sets the limit instead, so it gets a line of its own
     * and the rest still shares lines. Text that already has line breaks is
     * left as written. Returns {text, lines, broke, longest}.
     */
    AE.breakLines = function (text, maxChars) {
        var normalized = AE.textValue(text);
        var words;
        var count;
        var result;
        var lines;
        var limit;
        var i;
        if (!maxChars || normalized.indexOf("\r") >= 0 || normalized.length <= maxChars) {
            return {text: normalized, lines: normalized.split("\r").length, broke: false};
        }
        words = Z.filter(normalized.split(/\s+/), function (word) { return word.length > 0; });
        if (words.length < 2) {
            return {text: normalized, lines: 1, broke: false};
        }
        limit = maxChars;
        for (i = 0; i < words.length; i += 1) {
            limit = Math.max(limit, words[i].length);
        }
        count = Math.min(Math.ceil(normalized.length / limit), words.length);
        for (; count <= words.length; count += 1) {
            result = balance(words, count);
            if (result.longest <= limit) {
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
                if (last.length <= limit) {
                    lines[lines.length - 2] = above.join(" ");
                    lines[lines.length - 1] = last;
                }
            }
        }
        return {text: lines.join("\r"), lines: lines.length, broke: true, longest: result.longest};
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
// ---- aeft/04-aeft-fx.jsx ----
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
// ---- aeft/10-aeft-inspect.jsx ----
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
// ---- aeft/15-aeft-capture.jsx ----
// Zenvi Link: ae_capture_frame, the agent's eyes.
//
// CompItem.saveFrameToPng returns before the PNG is on disk (the file first
// appears empty), so the tool waits until the PNG ends with its IEND chunk.
// It renders at the comp's resolution factor: wide comps are captured at
// half, third... resolution and the user's factor is restored afterwards,
// inside one undo group of its own in case After Effects records the change.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;

    var CAPTURE_TIMEOUT_MS = 20000;
    var POLL_MS = 50;

    function u32(bytes, offset) {
        return bytes.charCodeAt(offset) * 16777216 + bytes.charCodeAt(offset + 1) * 65536 + bytes.charCodeAt(offset + 2) * 256 + bytes.charCodeAt(offset + 3);
    }

    /** {valid, width, height, complete, size} of a PNG file, read in binary mode; null when unreadable. */
    AE.readPngInfo = function (file) {
        var head = "";
        var tail = "";
        var size;
        file.encoding = "BINARY";
        if (!file.open("r")) {
            return null;
        }
        try {
            size = file.length;
            head = file.read(24);
            if (size > 12) {
                file.seek(size - 12, 0);
                tail = file.read(12);
            }
        } finally {
            file.close();
        }
        if (head.length < 24 || head.charCodeAt(0) !== 0x89 || head.substr(1, 3) !== "PNG") {
            return {valid: false, size: size, complete: false};
        }
        return {valid: true, width: u32(head, 16), height: u32(head, 20), complete: tail.indexOf("IEND") >= 0, size: size};
    };

    /**
     * Wait until `file` is a complete PNG (IEND written). If it cannot be read
     * as a PNG, a non-empty size that stays the same for three polls counts.
     */
    AE.waitForPng = function (file, timeoutMs) {
        var waited = 0;
        var lastSize = -1;
        var stable = 0;
        var info;
        for (;;) {
            if (file.exists && file.length > 0) {
                info = AE.readPngInfo(file);
                if (info && info.valid && info.complete) {
                    return info;
                }
                stable = file.length === lastSize ? stable + 1 : 0;
                lastSize = file.length;
                if (stable >= 3 && !(info && info.valid)) {
                    return {valid: false, size: lastSize, complete: true};
                }
            }
            if (waited >= timeoutMs) {
                throw Z.fail("TIMEOUT", "After Effects did not finish writing the frame within " + Math.round(timeoutMs / 1000) + " s (" + file.fsName + ")");
            }
            $.sleep(POLL_MS);
            waited += POLL_MS;
        }
    };

    function capture(comp, time, file) {
        comp.saveFrameToPng(time, file);
        return AE.waitForPng(file, CAPTURE_TIMEOUT_MS);
    }

    Z.register("ae_capture_frame", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var time = Z.optional(args, "time", "number", null);
        var maxWidth = Z.optional(args, "max_width", "integer", 1280);
        var frameDuration = 1 / comp.frameRate;
        var lastFrameTime = Math.max(0, Math.round((comp.duration - frameDuration) * comp.frameRate) / comp.frameRate);
        var factor;
        var previous;
        var changedFactor = false;
        var file;
        var info;
        var frame;
        var width;
        var height;
        Z.inRange("max_width", maxWidth, 64, 4096);
        if (time === null) {
            time = comp.time;
        } else {
            Z.inRange("time", time, 0, null);
        }
        time = AE.snapTime(comp, time, ctx, "time");
        if (time > comp.duration + 1e-6) {
            throw Z.refuse("INVALID_ARGUMENT", "`time` " + Z.round(time) + " s is after the end of comp \"" + comp.name + "\" (" + Z.round(comp.duration) + " s)");
        }
        if (time > lastFrameTime) {
            ctx.warn("Captured the comp's last frame (" + Z.round(lastFrameTime) + " s); " + Z.round(time) + " s is its end, not a frame");
            time = lastFrameTime;
        }
        frame = Math.round(time * comp.frameRate);
        // After Effects takes resolution factors 1-99.
        factor = Math.min(99, Math.max(1, Math.ceil(comp.width / maxWidth - 1e-9)));
        // Only into Zenvi Link's temp folder: the server deletes a capture there once it has sent it.
        file = new File(Z.tempFile("capture-" + comp.id + "-" + frame, "png"));
        previous = comp.resolutionFactor;
        changedFactor = previous[0] !== factor || previous[1] !== factor;
        if (changedFactor) {
            // A read-only tool, but After Effects may record resolution changes as undo steps:
            // keep the change and its restore in one step (no step at all if it records nothing).
            info = AE.inUndoGroup(Z.CATALOG.ae_capture_frame ? Z.CATALOG.ae_capture_frame.title : "Capture comp frame", function () {
                comp.resolutionFactor = [factor, factor];
                try {
                    return capture(comp, time, file);
                } finally {
                    comp.resolutionFactor = [previous[0], previous[1]];
                }
            });
        } else {
            info = capture(comp, time, file);
        }
        width = info.valid ? info.width : Math.round(comp.width / factor);
        height = info.valid ? info.height : Math.round(comp.height / factor);
        if (width > maxWidth) {
            ctx.warn("After Effects saved the frame at " + width + "x" + height + ", wider than max_width " + maxWidth);
        }
        return Z.ok("Captured frame " + frame + " (" + Z.round(time) + " s) of \"" + comp.name + "\" at " + width + "x" + height, {
            image_path: file.fsName,
            width: width,
            height: height,
            time: Z.round(time, 4),
            frame: frame,
            comp_id: comp.id,
            comp_name: comp.name,
            comp_width: comp.width,
            comp_height: comp.height,
            resolution_factor: factor
        });
    });
}(ZenviLink));
// ---- aeft/20-aeft-comps.jsx ----
// Zenvi Link: comp tools: ae_create_comp, ae_set_comp, ae_precompose,
// ae_add_marker.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    var COMP_PRESETS = {
        "1080p": [1920, 1080],
        "4k": [3840, 2160],
        "vertical": [1080, 1920],
        "square": [1080, 1080],
        "720p": [1280, 720]
    };
    var PRESET_NAMES = ["1080p", "4k", "vertical", "square", "720p"];

    function sameColor(a, b) {
        return Math.abs(a[0] - b[0]) < 1e-4 && Math.abs(a[1] - b[1]) < 1e-4 && Math.abs(a[2] - b[2]) < 1e-4;
    }

    // ------------------------------------------------------------------
    // ae_create_comp

    Z.register("ae_create_comp", function (args, ctx) {
        var project = AE.requireProject();
        var name = Z.optional(args, "name", "string", "Zenvi Comp");
        var preset = Z.optional(args, "preset", "string", null);
        var width = Z.optional(args, "width", "integer", null);
        var height = Z.optional(args, "height", "integer", null);
        var fps = Z.optional(args, "fps", "number", 30);
        var duration = Z.optional(args, "duration", "number", 10);
        var pixelAspect = Z.optional(args, "pixel_aspect", "number", 1);
        var background = AE.color(Z.optional(args, "background", "any", TASTE.color.palette.ink), "background");
        var folderName = Z.optional(args, "folder", "string", null);
        var open = Z.optional(args, "open", "boolean", true);
        var size;
        var folder;
        var comp;
        var data;
        if (preset !== null) {
            Z.oneOf("preset", preset, PRESET_NAMES);
        }
        if ((width === null) !== (height === null)) {
            throw Z.refuse("INVALID_ARGUMENT", "Pass both `width` and `height`, or a `preset`");
        }
        if (width !== null) {
            Z.inRange("width", width, 4, 30000);
            Z.inRange("height", height, 4, 30000);
            if (preset !== null) {
                ctx.warn("width and height override preset " + preset);
            }
            size = [width, height];
        } else {
            size = COMP_PRESETS[preset !== null ? preset : "1080p"];
        }
        Z.inRange("fps", fps, 1, 999);
        Z.inRange("duration", duration, 1 / fps, 10800);
        Z.inRange("pixel_aspect", pixelAspect, 0.01, 100);
        if (name.length > 255) {
            throw Z.refuse("INVALID_ARGUMENT", "`name` is longer than 255 characters");
        }
        ctx.changed();
        folder = folderName !== null ? AE.findOrCreateFolder(folderName) : null;
        comp = (folder ? folder.items : project.items).addComp(AE.uniqueCompName(name, ctx), size[0], size[1], pixelAspect, duration, fps);
        comp.bgColor = background;
        if (open) {
            comp.openInViewer();
        }
        data = AE.compSummary(comp);
        data.folder = folder ? {id: folder.id, name: folder.name} : null;
        data.opened = open;
        return Z.applied("Created comp \"" + comp.name + "\" (id " + comp.id + "): " + comp.width + "x" + comp.height + ", " + Z.round(fps, 3) + " fps, " +
            Z.round(duration, 3) + " s" + (open ? "; opened it" : ""), data);
    });

    // ------------------------------------------------------------------
    // ae_set_comp

    Z.register("ae_set_comp", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var changes = [];
        var plan = [];
        var name = Z.optional(args, "name", "string", null);
        var duration = Z.optional(args, "duration", "number", null);
        var fps = Z.optional(args, "fps", "number", null);
        var width = Z.optional(args, "width", "integer", null);
        var height = Z.optional(args, "height", "integer", null);
        var background = Z.optional(args, "background", "any", null);
        var workArea = Z.optional(args, "work_area", "object", null);
        var motionBlur = Z.optional(args, "motion_blur", "boolean", null);
        var shutterAngle = Z.optional(args, "shutter_angle", "number", null);
        var shutterPhase = Z.optional(args, "shutter_phase", "number", null);
        var frameBlending = Z.optional(args, "frame_blending", "boolean", null);
        var open = Z.optional(args, "open", "boolean", null);
        var newDuration;
        var start;
        var end;
        var rgb;
        var i;
        function plan1(label, current, wanted, apply) {
            if (wanted === null || current === wanted) {
                return;
            }
            plan.push({label: label, apply: apply});
        }
        if (duration !== null) {
            Z.inRange("duration", duration, 1 / comp.frameRate, 10800);
        }
        if (fps !== null) {
            Z.inRange("fps", fps, 1, 999);
        }
        if (width !== null) {
            Z.inRange("width", width, 4, 30000);
        }
        if (height !== null) {
            Z.inRange("height", height, 4, 30000);
        }
        if (shutterAngle !== null) {
            Z.inRange("shutter_angle", shutterAngle, 0, 720);
        }
        if (shutterPhase !== null) {
            Z.inRange("shutter_phase", shutterPhase, -360, 360);
        }
        newDuration = duration !== null ? duration : comp.duration;
        if (workArea !== null) {
            start = Z.required(workArea, "start", "number");
            end = Z.required(workArea, "end", "number");
            Z.inRange("work_area.start", start, 0, null);
            if (end <= start || end > newDuration + 1e-6) {
                throw Z.refuse("INVALID_ARGUMENT", "`work_area` must end after it starts and within the comp (0-" + Z.round(newDuration) + " s)");
            }
            start = AE.snapTime(comp, start, ctx, "work_area.start");
            end = AE.snapTime(comp, end, ctx, "work_area.end");
        }
        if (name !== null && name.length > 255) {
            throw Z.refuse("INVALID_ARGUMENT", "`name` is longer than 255 characters");
        }
        rgb = background !== null ? AE.color(background, "background") : null;

        plan1("name \"" + name + "\"", comp.name, name, function () { comp.name = name; });
        plan1("duration " + duration + " s", Z.round(comp.duration, 6), duration === null ? null : Z.round(duration, 6), function () { comp.duration = duration; });
        plan1("fps " + fps, Z.round(comp.frameRate, 6), fps === null ? null : Z.round(fps, 6), function () { comp.frameRate = fps; });
        plan1("width " + width, comp.width, width, function () { comp.width = width; });
        plan1("height " + height, comp.height, height, function () { comp.height = height; });
        if (rgb !== null && !sameColor(comp.bgColor, rgb)) {
            plan.push({label: "background " + Z.color.toHex(rgb), apply: function () { comp.bgColor = rgb; }});
        }
        if (workArea !== null && (Math.abs(comp.workAreaStart - start) > 1e-6 || Math.abs(comp.workAreaStart + comp.workAreaDuration - end) > 1e-6)) {
            plan.push({label: "work area " + Z.round(start) + "-" + Z.round(end) + " s", apply: function () {
                comp.workAreaStart = start;
                comp.workAreaDuration = end - start;
            }});
        }
        plan1("motion blur " + (motionBlur ? "on" : "off"), comp.motionBlur, motionBlur, function () { comp.motionBlur = motionBlur; });
        plan1("shutter angle " + shutterAngle, comp.shutterAngle, shutterAngle, function () { comp.shutterAngle = shutterAngle; });
        plan1("shutter phase " + shutterPhase, comp.shutterPhase, shutterPhase, function () { comp.shutterPhase = shutterPhase; });
        plan1("frame blending " + (frameBlending ? "on" : "off"), comp.frameBlending, frameBlending, function () { comp.frameBlending = frameBlending; });

        if (!plan.length && open !== true) {
            return Z.unchanged("Comp \"" + comp.name + "\" already has these settings", AE.compSummary(comp));
        }
        if (plan.length) {
            ctx.changed();
        }
        for (i = 0; i < plan.length; i += 1) {
            plan[i].apply();
            changes.push(plan[i].label);
        }
        if (open === true) {
            comp.openInViewer();
            changes.push("opened in the viewer");
        }
        if (!plan.length) {
            return Z.applied("Opened comp \"" + comp.name + "\"", AE.compSummary(comp), 0);
        }
        return Z.applied("Changed comp \"" + comp.name + "\": " + changes.join(", "), (function () {
            var data = AE.compSummary(comp);
            data.changed = changes;
            return data;
        }()));
    });

    // ------------------------------------------------------------------
    // ae_precompose

    Z.register("ae_precompose", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var refs = Z.required(args, "layers", "array");
        var moveAll = Z.optional(args, "move_all_attributes", "boolean", true);
        var open = Z.optional(args, "open", "boolean", false);
        var indexes = [];
        var layers = [];
        var layer;
        var name;
        var top;
        var precomp;
        var precompLayer = null;
        var i;
        if (!refs.length) {
            throw Z.refuse("INVALID_ARGUMENT", "`layers` needs at least one layer");
        }
        for (i = 0; i < refs.length; i += 1) {
            layer = AE.findLayer(comp, refs[i]);
            if (Z.indexOf(indexes, layer.index) < 0) {
                indexes.push(layer.index);
                layers.push(layer);
            }
        }
        indexes.sort(function (a, b) { return a - b; });
        if (!moveAll && indexes.length !== 1) {
            throw Z.refuse("INVALID_ARGUMENT", "move_all_attributes: false works on exactly one layer (After Effects' rule)");
        }
        top = comp.layer(indexes[0]);
        name = Z.optional(args, "name", "string", top.name + " Comp");
        ctx.changed();
        precomp = comp.layers.precompose(indexes, AE.uniqueCompName(name, ctx), moveAll);
        for (i = 1; i <= comp.numLayers; i += 1) {
            layer = comp.layer(i);
            if (layer instanceof AVLayer && layer.source && layer.source.id === precomp.id) {
                precompLayer = layer;
                break;
            }
        }
        if (open) {
            precomp.openInViewer();
        }
        return Z.applied("Precomposed " + Z.plural(indexes.length, "layer") + " of \"" + comp.name + "\" into \"" + precomp.name + "\" (id " + precomp.id + ")", {
            comp_id: precomp.id,
            comp_name: precomp.name,
            moved_layers: indexes.length,
            precomp_layer: precompLayer ? AE.layerRef(precompLayer) : null,
            parent_comp_id: comp.id
        });
    });

    // ------------------------------------------------------------------
    // ae_add_marker

    Z.register("ae_add_marker", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = Z.has(args, "layer") && args.layer !== null ? AE.findLayer(comp, args.layer) : null;
        var time = Z.optional(args, "time", "number", comp.time);
        var comment = Z.optional(args, "comment", "string", "");
        var duration = Z.optional(args, "duration", "number", 0);
        var chapter = Z.optional(args, "chapter", "string", null);
        var url = Z.optional(args, "url", "string", null);
        var label = Z.optional(args, "label", "integer", null);
        var protectedRegion = Z.optional(args, "protected_region", "boolean", null);
        var target;
        var marker;
        var replaced;
        var data;
        time = AE.compTime(comp, time, ctx, "time");
        Z.inRange("duration", duration, 0, 10800);
        if (label !== null) {
            Z.inRange("label", label, 0, 16);
        }
        if (protectedRegion !== null && layer) {
            throw Z.refuse("INVALID_ARGUMENT", "`protected_region` applies to comp markers only");
        }
        if (layer) {
            AE.requireUnlocked(layer);
        }
        target = layer ? /** @type {Property} */ (layer.property("ADBE Marker")) : comp.markerProperty;
        replaced = target.numKeys > 0 && Math.abs(target.keyTime(target.nearestKeyIndex(time)) - time) < 1e-4;
        marker = new MarkerValue(comment);
        marker.duration = duration;
        if (chapter !== null) {
            marker.chapter = chapter;
        }
        if (url !== null) {
            marker.url = url;
        }
        if (label !== null) {
            marker.label = label;
        }
        if (protectedRegion !== null) {
            marker.protectedRegion = protectedRegion;
        }
        ctx.changed();
        target.setValueAtTime(time, marker);
        if (replaced) {
            ctx.warn("Replaced the marker that was at " + Z.round(time) + " s");
        }
        data = {time: Z.round(time, 4), comment: comment, duration: Z.round(duration, 4), comp_id: comp.id, layer: layer ? AE.layerRef(layer) : null};
        return Z.applied("Added a " + (layer ? "layer marker to \"" + layer.name + "\"" : "comp marker to \"" + comp.name + "\"") + " at " + Z.round(time) + " s" +
            (comment ? ": " + AE.clip(comment, 60) : ""), data);
    });
}(ZenviLink));
// ---- aeft/25-aeft-import.jsx ----
// Zenvi Link: ae_import_files, plus the import helper ae_add_layer uses for
// footage given by path. Every path is checked before anything is imported,
// and files already in the project are reused.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;

    /** Footage items by AE.pathKey of their file. */
    AE.footageByPath = function () {
        var project = AE.requireProject();
        /** @type {Object<string, FootageItem>} */
        var map = {};
        var item;
        var i;
        for (i = 1; i <= project.numItems; i += 1) {
            item = project.item(i);
            if (item instanceof FootageItem && item.file) {
                map[AE.pathKey(item.file.fsName)] = item;
            }
        }
        return map;
    };

    /**
     * Check `paths` before importing: absolute, existing, importable as
     * footage. Returns [{path, file, key, options}]; refuses NOT_FOUND /
     * UNSUPPORTED naming every bad path.
     */
    AE.planImports = function (paths, sequence) {
        var missing = [];
        var unsupported = [];
        var planned = [];
        var file;
        var options;
        var i;
        for (i = 0; i < paths.length; i += 1) {
            AE.requireAbsolutePath(paths[i], "paths[" + i + "]");
            file = new File(paths[i]);
            if (!file.exists) {
                missing.push(paths[i]);
                continue;
            }
            options = new ImportOptions(file);
            if (sequence) {
                options.sequence = true;
            }
            if (!options.canImportAs(ImportAsType.FOOTAGE)) {
                unsupported.push(paths[i]);
                continue;
            }
            options.importAs = ImportAsType.FOOTAGE;
            planned.push({path: paths[i], file: file, key: AE.pathKey(paths[i]), options: options});
        }
        if (missing.length) {
            throw Z.refuse("NOT_FOUND", (missing.length === 1 ? "File does not exist: " : "Files do not exist: ") + missing.join(", "));
        }
        if (unsupported.length) {
            throw Z.refuse("UNSUPPORTED", "After Effects cannot import as footage: " + unsupported.join(", "));
        }
        return planned;
    };

    /**
     * Import planned files into `folderName` (created when missing). Reuses
     * items whose file is already imported when `dedupe`. Returns
     * [{path, item, reused}] in the order given.
     */
    AE.importPlanned = function (planned, folderName, dedupe) {
        var existing = dedupe ? AE.footageByPath() : {};
        var folder = null;
        var results = [];
        var item;
        var i;
        for (i = 0; i < planned.length; i += 1) {
            if (Z.has(existing, planned[i].key)) {
                results.push({path: planned[i].path, item: existing[planned[i].key], reused: true});
                continue;
            }
            if (!folder) {
                folder = AE.findOrCreateFolder(folderName);
            }
            item = /** @type {FootageItem} */ (app.project.importFile(planned[i].options));
            item.parentFolder = folder;
            existing[planned[i].key] = item;
            results.push({path: planned[i].path, item: item, reused: false});
        }
        return results;
    };

    Z.register("ae_import_files", function (args, ctx) {
        var paths = Z.required(args, "paths", "array");
        var folderName = Z.optional(args, "folder", "string", "Zenvi Imports");
        var sequence = Z.optional(args, "sequence", "boolean", false);
        var dedupe = Z.optional(args, "dedupe", "boolean", true);
        var planned;
        var results;
        var imported = 0;
        var existing;
        var seen = {};
        var items;
        var i;
        AE.requireProject();
        if (!paths.length || paths.length > 500) {
            throw Z.refuse("INVALID_ARGUMENT", "`paths` takes 1-500 files");
        }
        planned = AE.planImports(paths, sequence);
        existing = dedupe ? AE.footageByPath() : {};
        for (i = 0; i < planned.length; i += 1) {
            if (dedupe && (Z.has(existing, planned[i].key) || Z.has(seen, planned[i].key))) {
                continue;
            }
            seen[planned[i].key] = true;
            imported += 1;
        }
        if (imported === 0) {
            results = AE.importPlanned(planned, folderName, dedupe);
            return Z.unchanged("All " + Z.plural(results.length, "file") + " are already in the project", {
                items: Z.map(results, function (result) {
                    var summary = AE.itemSummary(result.item);
                    summary.path = result.path;
                    summary.reused = true;
                    return summary;
                })
            });
        }
        ctx.changed();
        results = AE.importPlanned(planned, folderName, dedupe);
        items = Z.map(results, function (result) {
            var summary = AE.itemSummary(result.item);
            summary.path = result.path;
            summary.reused = result.reused;
            return summary;
        });
        imported = Z.filter(results, function (result) { return !result.reused; }).length;
        return Z.applied("Imported " + Z.plural(imported, "file") + " into \"" + folderName + "\"" +
            (results.length > imported ? " (" + (results.length - imported) + " already in the project)" : ""), {
            items: items,
            folder: folderName
        });
    });
}(ZenviLink));
// ---- aeft/30-aeft-layers.jsx ----
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
// ---- aeft/35-aeft-text.jsx ----
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

        if (!Z.trim(text).length) {
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
            ctx.warn("Broke the text into " + broken.lines + " lines of at most " + TASTE.type.maxLineChars + " characters" +
                (broken.longest > TASTE.type.maxLineChars ? " (one word is " + broken.longest + " characters, so it has a line of its own)" : "") +
                " (auto_break: false keeps it as written)");
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
            if (!Z.trim(subtitle).length) {
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
        if (time !== null) {
            time = AE.compTime(comp, time, ctx, "time");
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        if (time !== null && property.numKeys > 0) {
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
// ---- aeft/40-aeft-properties.jsx ----
// Zenvi Link: property tools: ae_set_property, ae_animate, ae_add_expression.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;

    // Properties where TASTE allows linear easing (opacity crossfades).
    var LINEAR_OK = ["ADBE Opacity", "ADBE Text Opacity", "ADBE Vector Fill Opacity", "ADBE Vector Stroke Opacity", "ADBE Mask Opacity"];

    function sameJson(a, b) {
        return JSON.stringify(a) === JSON.stringify(b);
    }

    function lerpValue(a, b, t) {
        var out;
        var i;
        if (typeof a === "number" && typeof b === "number") {
            return a + (b - a) * t;
        }
        out = [];
        for (i = 0; i < a.length; i += 1) {
            out.push(a[i] + ((b[i] !== undefined ? b[i] : a[i]) - a[i]) * t);
        }
        return out;
    }

    function overshootValue(a, b, amount) {
        return lerpValue(a, b, 1 + amount);
    }

    // ------------------------------------------------------------------
    // ae_set_property

    Z.register("ae_set_property", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var target = AE.resolveLeaf(layer, Z.required(args, "property", "any"));
        var property = target.property;
        var time = Z.optional(args, "time", "number", null);
        var value;
        var before;
        var after;
        var data;
        if (!Z.has(args, "value") || args.value === null) {
            throw Z.refuse("INVALID_ARGUMENT", "`value` is required");
        }
        if (time !== null) {
            time = AE.compTime(comp, time, ctx, "time");
            if (!property.canVaryOverTime) {
                throw Z.refuse("UNSUPPORTED", target.path + " cannot be keyframed; set it without `time`");
            }
        } else if (property.numKeys > 0) {
            throw Z.refuse("INVALID_ARGUMENT", target.path + " has " + Z.plural(property.numKeys, "keyframe") +
                "; pass `time` to set a keyframe, or replace them with ae_animate (replace: true)");
        }
        value = AE.toValue(property, args.value, "value", time !== null ? property.valueAtTime(time, true) : property.value);
        before = AE.exportValue(time !== null ? property.valueAtTime(time, true) : property.value);
        after = AE.exportValue(value);
        data = {layer: AE.layerRef(layer), path: target.path, match_path: target.match_path, before: before, value: after, time: time !== null ? Z.round(time, 4) : null, keyframe: null};
        if (time === null && sameJson(before, after)) {
            return Z.unchanged(target.path + " of \"" + layer.name + "\" is already " + JSON.stringify(after), data);
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        if (time === null) {
            property.setValue(value);
        } else {
            property.setValueAtTime(time, value);
            data.keyframe = property.nearestKeyIndex(time);
        }
        if (property.expressionEnabled && property.expression !== "") {
            ctx.warn(target.path + " has an expression, which may override this value");
        }
        return Z.applied("Set " + target.path + " of \"" + layer.name + "\" to " + AE.clip(JSON.stringify(after), 80) +
            (time !== null ? " at " + Z.round(time) + " s" : ""), data);
    });

    // ------------------------------------------------------------------
    // ae_animate

    Z.register("ae_animate", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var target = AE.resolveLeaf(layer, Z.required(args, "property", "any"));
        var property = target.property;
        var raw = Z.required(args, "keyframes", "array");
        var defaultCurve = AE.curve(Z.optional(args, "easing", "any", TASTE.easing["default"]), "easing");
        var replace = Z.optional(args, "replace", "boolean", false);
        var spatial = Z.oneOf("spatial", Z.optional(args, "spatial", "string", "auto-bezier"), ["auto-bezier", "linear"]);
        var overshoot = Z.optional(args, "overshoot", "number", 0);
        var holdOnly = !property.isInterpolationTypeValid(KeyframeInterpolationType.BEZIER);
        var keys = [];
        var written;
        var key;
        var last;
        var settle;
        var previous;
        var linearWarned = false;
        var i;
        if (!raw.length || raw.length > 500) {
            throw Z.refuse("INVALID_ARGUMENT", "`keyframes` takes 1-500 keyframes");
        }
        Z.inRange("overshoot", overshoot, 0, TASTE.easing.overshoot.max);
        if (!property.canVaryOverTime) {
            throw Z.refuse("UNSUPPORTED", target.path + " cannot be keyframed");
        }
        for (i = 0; i < raw.length; i += 1) {
            if (!Z.isObject(raw[i])) {
                throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + i + "]` must be {time, value, easing?}");
            }
            key = {
                time: AE.snapTime(comp, Z.inRange("keyframes[" + i + "].time", Z.required(raw[i], "time", "number"), 0, 10800), ctx, "keyframes[" + i + "].time"),
                value: null,
                curve: Z.has(raw[i], "easing") && raw[i].easing !== null ? AE.curve(raw[i].easing, "keyframes[" + i + "].easing") : defaultCurve
            };
            if (!Z.has(raw[i], "value") || raw[i].value === null) {
                throw Z.refuse("INVALID_ARGUMENT", "`keyframes[" + i + "].value` is required");
            }
            key.value = AE.toValue(property, raw[i].value, "keyframes[" + i + "].value",
                property.propertyValueType === PropertyValueType.TEXT_DOCUMENT ? property.valueAtTime(key.time, true) : previous);
            if (keys.length && key.time <= keys[keys.length - 1].time + 1e-6) {
                throw Z.refuse("INVALID_ARGUMENT", "Keyframe times must increase; keyframes[" + i + "] (" + Z.round(key.time) + " s) is not after the one before" +
                    " (snapped to frames)");
            }
            if (holdOnly) {
                key.curve = AE.curve("hold", "easing");
            }
            if (key.time > comp.duration + 1e-6) {
                ctx.warn("Keyframe at " + Z.round(key.time) + " s is after the end of the comp (" + Z.round(comp.duration) + " s)");
            }
            previous = Z.isArray(key.value) ? key.value : previous;
            keys.push(key);
        }
        for (i = 0; i < keys.length - 1 && !linearWarned; i += 1) {
            if (keys[i].curve.type === "linear" && Z.indexOf(LINEAR_OK, property.matchName) < 0) {
                ctx.warn("Linear easing on " + target.path + ": TASTE keeps linear for opacity crossfades, loops and tickers; moves should ease (smooth, out, in, in-out)");
                linearWarned = true;
            }
        }
        if (overshoot > 0) {
            if (keys.length < 2 || keys[keys.length - 2].curve.type === "hold" || typeof keys[0].value !== "number" && !Z.isArray(keys[0].value)) {
                throw Z.refuse("INVALID_ARGUMENT", "`overshoot` needs at least two numeric keyframes with a moving last segment");
            }
            last = keys[keys.length - 1];
            previous = keys[keys.length - 2];
            settle = Math.min(TASTE.easing.overshoot.settle, (last.time - previous.time) * 0.4);
            key = {
                time: AE.snapTime(comp, last.time - settle, null, "overshoot"),
                value: overshootValue(previous.value, last.value, overshoot),
                curve: AE.curve("in-out", "easing")
            };
            if (key.time <= previous.time + 1e-6 || key.time >= last.time - 1e-6) {
                throw Z.refuse("INVALID_ARGUMENT", "The last segment is too short for an overshoot; give it at least " + Z.round(3 / comp.frameRate, 3) + " s");
            }
            keys.splice(keys.length - 1, 0, key);
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        written = AE.writeKeyframes(property, keys, {replace: replace, spatial: spatial}, ctx);
        return Z.applied("Animated " + target.path + " of \"" + layer.name + "\" with " + Z.plural(written.length, "keyframe") + " (" +
            Z.round(keys[0].time) + "-" + Z.round(keys[keys.length - 1].time) + " s, " + (holdOnly ? "hold" : defaultCurve.name) + ")" +
            (overshoot > 0 ? " with a " + Z.round(overshoot * 100, 1) + " % overshoot" : ""), {
            layer: AE.layerRef(layer),
            path: target.path,
            match_path: target.match_path,
            keyframes: written
        });
    });

    // ------------------------------------------------------------------
    // ae_add_expression

    Z.register("ae_add_expression", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var target = AE.resolveLeaf(layer, Z.required(args, "property", "any"));
        var property = target.property;
        var expression = Z.required(args, "expression", "string");
        var enabled = Z.optional(args, "enabled", "boolean", true);
        var oldExpression = property.expression;
        var oldEnabled = property.expressionEnabled;
        var error;
        var data = {layer: AE.layerRef(layer), path: target.path, match_path: target.match_path, expression: expression, enabled: expression !== "" && enabled};
        if (!property.canSetExpression) {
            throw Z.refuse("UNSUPPORTED", target.path + " cannot have an expression");
        }
        if (expression === oldExpression && (expression === "" || oldEnabled === enabled)) {
            return Z.unchanged(target.path + " of \"" + layer.name + "\" already has " + (expression === "" ? "no expression" : "this expression"), data);
        }
        AE.requireUnlocked(layer);
        ctx.changed();
        property.expression = expression;
        if (expression === "") {
            return Z.applied("Cleared the expression on " + target.path + " of \"" + layer.name + "\"", data);
        }
        // After Effects evaluates an expression when it is set (a valid one enables itself);
        // enabling an invalid one throws, so read the error before touching expressionEnabled.
        error = property.expressionError;
        if (error) {
            property.expression = oldExpression;
            if (oldExpression !== "" && property.expressionEnabled !== oldEnabled) {
                try {
                    property.expressionEnabled = oldEnabled;
                } catch (restoreError) {
                    ctx.warn("Restored the previous expression but could not set its switch back");
                }
            }
            throw Z.refuse("INVALID_ARGUMENT", "After Effects rejected the expression on " + target.path + ": " + error + " (the previous expression was restored)");
        }
        if (property.expressionEnabled !== enabled) {
            property.expressionEnabled = enabled;
        }
        data.value = AE.exportValue(property.valueAtTime(comp.time, false));
        return Z.applied("Set an expression on " + target.path + " of \"" + layer.name + "\"" + (enabled ? "" : " (disabled)"), data);
    });
}(ZenviLink));
// ---- aeft/45-aeft-motion.jsx ----
// Zenvi Link: ae_apply_motion_preset and AE.applyMotionPreset (also used by
// ae_add_text). TASTE 1-3 defaults; everything is editable keyframes or text
// animators, except drift, which is procedural by nature (an expression).
//
// Text cascades use one Range Selector (Shape: Ramp Up, Offset swept from -W
// to 100 %): each unit (word or line) takes `duration` to arrive and units
// start `stagger` apart. The window W = 100 * duration / (units * stagger),
// capped at 100 %; with too few units for that stagger, the stagger widens to
// duration / units and the receipt says so.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;
    var TASTE = Z.TASTE;
    var TIMING = TASTE.timing;
    var LAYOUT = TASTE.layout;

    var DRIFT_MARK = "// Zenvi drift";

    // Ranges for presets TASTE gives one number for (documented in docs/AFTER_EFFECTS.md).
    var POP_SHRINK = {"default": 1 - LAYOUT.scale.entranceFrom, range: [0.04, 0.15]};
    var BLUR = {"default": 0.03, range: [0.015, 0.06]};
    var WHIP = {"default": 0.25, range: [0.15, 0.5]};
    var DRIFT = {"default": 0.005, range: [0.0025, 0.01]};
    var PUSH = {"default": LAYOUT.scale.holdPushTo - 1, range: LAYOUT.kenBurns.range};

    var PRESETS = {
        "fade-in": {kind: "entrance", duration: TIMING.entrance["default"]},
        "fade-out": {kind: "exit", duration: TIMING.exit["default"]},
        "slide-in": {kind: "entrance", duration: TIMING.entrance["default"], direction: "up"},
        "slide-out": {kind: "exit", duration: TIMING.exit["default"], direction: "down"},
        "scale-pop": {kind: "entrance", duration: TIMING.micro["default"]},
        "blur-in": {kind: "entrance", duration: TIMING.entrance["default"]},
        "whip-in": {kind: "entrance", duration: TIMING.micro.range[1], direction: "right"},
        "typewriter": {kind: "entrance", text: true, stagger: TIMING.stagger.range[0]},
        "word-cascade": {kind: "entrance", text: true, duration: TIMING.entrance["default"], stagger: TIMING.stagger.word},
        "line-rise": {kind: "entrance", text: true, duration: TIMING.entrance["default"], stagger: TIMING.stagger.line},
        "ken-burns": {kind: "hold", direction: "left"},
        "push-in": {kind: "hold"},
        "drift": {kind: "procedural"}
    };
    AE.MOTION_PRESETS = ["fade-in", "fade-out", "slide-in", "slide-out", "scale-pop", "blur-in", "typewriter", "word-cascade", "line-rise",
        "ken-burns", "push-in", "drift", "whip-in"];

    var DIRECTIONS = {left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1]};

    // ------------------------------------------------------------------
    // Helpers.

    function transform(layer, matchName) {
        return layer.property("ADBE Transform Group").property(matchName);
    }

    /**
     * The value the layer rests at. Entrance: the value at the window's end;
     * when a segment runs from inside the window to a key after it (an earlier,
     * longer preset being re-applied shorter), that key's value. Exit,
     * mirrored: the value at the window's start, or the key before it whose
     * segment ends inside the window. Keys outside the window are kept.
     */
    function restValue(property, start, end, entering) {
        var count = property.numKeys;
        var i;
        if (entering) {
            for (i = 1; i <= count; i += 1) {
                if (property.keyTime(i) > end + 1e-4) {
                    if (i > 1 && property.keyTime(i - 1) >= start - 1e-4) {
                        return property.keyValue(i);
                    }
                    break;
                }
            }
            return property.valueAtTime(end, true);
        }
        for (i = count; i >= 1; i -= 1) {
            if (property.keyTime(i) < start - 1e-4) {
                if (i < count && property.keyTime(i + 1) <= end + 1e-4) {
                    return property.keyValue(i);
                }
                break;
            }
        }
        return property.valueAtTime(start, true);
    }

    function animate(property, start, end, from, to, easing, ctx) {
        var curve = AE.curve(easing, "easing");
        return AE.writeKeyframes(property, [
            {time: start, value: from, curve: curve},
            {time: end, value: to, curve: curve}
        ], {replace: false, spatial: "auto-bezier"}, ctx);
    }

    function opacityRest(property, start, end, entering, ctx) {
        var rest = restValue(property, start, end, entering);
        if (rest < 1) {
            ctx.warn("Opacity rests at " + Z.round(rest, 2) + " %; animated to 100 % instead");
            return 100;
        }
        return rest;
    }

    function fadeOpacity(layer, start, end, entering, easing, ctx, paths) {
        var property = transform(layer, "ADBE Opacity");
        var rest = opacityRest(property, start, end, entering, ctx);
        animate(property, start, end, entering ? 0 : rest, entering ? rest : 0, easing, ctx);
        paths.push("Transform/Opacity");
    }

    /** Position targets: Position, or X/Y Position when the dimensions are separated. */
    function positionTargets(layer) {
        var position = transform(layer, "ADBE Position");
        if (position.dimensionsSeparated) {
            return [
                {property: transform(layer, "ADBE Position_0"), axis: 0, path: "Transform/X Position"},
                {property: transform(layer, "ADBE Position_1"), axis: 1, path: "Transform/Y Position"}
            ];
        }
        return [{property: position, axis: -1, path: "Transform/Position"}];
    }

    /** Move between the rest position and rest + offset ([dx, dy]). */
    function move(layer, start, end, offset, entering, easing, ctx, paths) {
        var targets = positionTargets(layer);
        var rest;
        var away;
        var i;
        for (i = 0; i < targets.length; i += 1) {
            if (targets[i].axis >= 0 && offset[targets[i].axis] === 0) {
                continue;
            }
            rest = restValue(targets[i].property, start, end, entering);
            if (targets[i].axis >= 0) {
                away = rest + offset[targets[i].axis];
            } else {
                away = rest.length > 2 ? [rest[0] + offset[0], rest[1] + offset[1], rest[2]] : [rest[0] + offset[0], rest[1] + offset[1]];
            }
            animate(targets[i].property, start, end, entering ? away : rest, entering ? rest : away, easing, ctx);
            paths.push(targets[i].path);
        }
    }

    function scaleBy(layer, start, end, factorFrom, factorTo, easing, ctx, paths, entering) {
        var property = transform(layer, "ADBE Scale");
        var rest = restValue(property, start, end, entering);
        function times(factor) {
            return rest.length > 2 ? [rest[0] * factor, rest[1] * factor, rest[2]] : [rest[0] * factor, rest[1] * factor];
        }
        animate(property, start, end, times(factorFrom), times(factorTo), easing, ctx);
        paths.push("Transform/Scale");
    }

    function offsetFor(direction, distance) {
        return [DIRECTIONS[direction][0] * distance, DIRECTIONS[direction][1] * distance];
    }

    function units(layer, basedOn, ctx) {
        var doc = layer.property("ADBE Text Properties").property("ADBE Text Document").value;
        var text = String(doc.text);
        if (basedOn === "characters") {
            return text.replace(/\s+/g, "").length;
        }
        if (basedOn === "words") {
            return Z.filter(text.split(/\s+/), function (word) { return word.length > 0; }).length;
        }
        if (doc.boxText && typeof doc.composedLineCount === "number" && doc.composedLineCount > 0) {
            return doc.composedLineCount;
        }
        if (doc.boxText) {
            ctx.warn("Counted explicit line breaks only; this After Effects does not report wrapped lines of paragraph text");
        }
        return text.split(/\r\n|\r|\n/).length;
    }

    /** A fresh text animator named `title` (an earlier one with that name is replaced); returns an accessor. */
    function textAnimator(layer, title) {
        var animators = function () { return layer.property("ADBE Text Properties").property("ADBE Text Animators"); };
        var index;
        var i;
        for (i = animators().numProperties; i >= 1; i -= 1) {
            if (animators().property(i).name === title) {
                animators().property(i).remove();
            }
        }
        index = animators().addProperty("ADBE Text Animator").propertyIndex;
        animators().property(index).name = title;
        return function () { return animators().property(index); };
    }

    /** Add a Range Selector and the animator properties; returns accessors. */
    function animatorParts(animator, propertyMatchNames) {
        var i;
        if (animator().property("ADBE Text Selectors").numProperties === 0) {
            animator().property("ADBE Text Selectors").addProperty("ADBE Text Selector");
        }
        for (i = 0; i < propertyMatchNames.length; i += 1) {
            animator().property("ADBE Text Animator Properties").addProperty(propertyMatchNames[i]);
        }
        return {
            selector: function () { return animator().property("ADBE Text Selectors").property(1); },
            advanced: function () { return animator().property("ADBE Text Selectors").property(1).property("ADBE Text Range Advanced"); },
            property: function (matchName) { return animator().property("ADBE Text Animator Properties").property(matchName); }
        };
    }

    // Range Selector menu values (After Effects' dropdowns are 1-based).
    var UNITS_PERCENTAGE = 1;
    var BASED_ON = {characters: 1, charactersExcludingSpaces: 2, words: 3, lines: 4};
    var SHAPE = {square: 1, rampUp: 2};

    // ------------------------------------------------------------------
    // Presets.

    var RUN = {};

    RUN["fade-in"] = function (comp, layer, p, ctx) {
        fadeOpacity(layer, p.start, p.end, true, "out", ctx, p.paths);
    };

    RUN["fade-out"] = function (comp, layer, p, ctx) {
        fadeOpacity(layer, p.start, p.end, false, "in", ctx, p.paths);
    };

    RUN["slide-in"] = function (comp, layer, p, ctx) {
        var distance = AE.ranged(LAYOUT.slide, p.intensity) * comp.width;
        p.data.distance = Z.round(distance, 2);
        move(layer, p.start, p.end, offsetFor(p.direction, -distance), true, "out", ctx, p.paths);
        fadeOpacity(layer, p.start, p.end, true, "out", ctx, p.paths);
    };

    RUN["slide-out"] = function (comp, layer, p, ctx) {
        var distance = AE.ranged(LAYOUT.slide, p.intensity) * comp.width;
        p.data.distance = Z.round(distance, 2);
        move(layer, p.start, p.end, offsetFor(p.direction, distance), false, "in", ctx, p.paths);
        fadeOpacity(layer, p.start, p.end, false, "in", ctx, p.paths);
    };

    RUN["scale-pop"] = function (comp, layer, p, ctx) {
        var from = 1 - AE.ranged(POP_SHRINK, p.intensity);
        p.data.scale_from = Z.round(from * 100, 2);
        scaleBy(layer, p.start, p.end, from, 1, "snap", ctx, p.paths, true);
        fadeOpacity(layer, p.start, p.end, true, "out", ctx, p.paths);
    };

    RUN["blur-in"] = function (comp, layer, p, ctx) {
        var amount = Math.round(AE.ranged(BLUR, p.intensity) * Math.min(comp.width, comp.height) * 10) / 10;
        var effect;
        AE.removeEffectsNamed(layer, "Zenvi Blur In");
        effect = AE.addEffect(layer, "ADBE Gaussian Blur 2", "Zenvi Blur In");
        AE.effectParam(effect, "ADBE Gaussian Blur 2-0003", "Repeat Edge Pixels").setValue(1);
        animate(AE.effectParam(effect, "ADBE Gaussian Blur 2-0001", "Blurriness"), p.start, p.end, amount, 0, "out", ctx);
        p.paths.push("Effects/Zenvi Blur In/Blurriness");
        p.data.effect = "Zenvi Blur In";
        p.data.blur = amount;
        fadeOpacity(layer, p.start, p.end, true, "out", ctx, p.paths);
    };

    RUN["whip-in"] = function (comp, layer, p, ctx) {
        var distance = AE.ranged(WHIP, p.intensity) * comp.width;
        var fadeEnd = AE.snapTime(comp, p.start + (p.end - p.start) * 0.4, null, "fade");
        p.data.distance = Z.round(distance, 2);
        move(layer, p.start, p.end, offsetFor(p.direction, -distance), true, "snap", ctx, p.paths);
        fadeOpacity(layer, p.start, Math.max(fadeEnd, p.start + 1 / comp.frameRate), true, "out", ctx, p.paths);
        layer.motionBlur = true;
        if (!comp.motionBlur) {
            comp.motionBlur = true;
            ctx.warn("Turned on motion blur for comp \"" + comp.name + "\" so the whip blurs");
        }
        p.data.motion_blur = true;
    };

    RUN["ken-burns"] = function (comp, layer, p, ctx) {
        var amount = AE.ranged(LAYOUT.kenBurns, p.intensity);
        // Pan less than the extra width the scale adds, so no edge shows.
        var pan = amount * comp.width * 0.4;
        p.data.scale_to = Z.round((1 + amount) * 100, 2);
        p.data.pan = Z.round(pan, 2);
        scaleBy(layer, p.start, p.end, 1, 1 + amount, "in-out", ctx, p.paths, false);
        move(layer, p.start, p.end, offsetFor(p.direction, pan), false, "in-out", ctx, p.paths);
    };

    RUN["push-in"] = function (comp, layer, p, ctx) {
        var amount = AE.ranged(PUSH, p.intensity);
        p.data.scale_to = Z.round((1 + amount) * 100, 2);
        scaleBy(layer, p.start, p.end, 1, 1 + amount, "in-out", ctx, p.paths, false);
    };

    RUN["drift"] = function (comp, layer, p, ctx) {
        var amplitude = Math.round(AE.ranged(DRIFT, p.intensity) * comp.width * 10) / 10;
        var targets = positionTargets(layer);
        var head = DRIFT_MARK + ": a slow procedural float. a = amplitude in px, f = cycles per second.\n" +
            "var a = " + amplitude + ";\nvar f = 0.12;\nvar t = time - " + Z.round(p.start, 4) + ";\n" +
            "var w = t <= 0 ? 0 : Math.min(1, t / " + TIMING.bigMove["default"] + ");\n";
        var x = "Math.sin(t * f * 2 * Math.PI) * a * w";
        var y = "Math.sin(t * f * 1.37 * 2 * Math.PI + 1.3) * a * 0.6 * w";
        var i;
        for (i = 0; i < targets.length; i += 1) {
            targets[i].property.expression = head + (targets[i].axis < 0 ? "add(value, [" + x + ", " + y + "]);" : "value + " + (targets[i].axis === 0 ? x : y) + ";");
            targets[i].property.expressionEnabled = true;
            if (targets[i].property.expressionError) {
                throw Z.fail("HOST_ERROR", "After Effects rejected the drift expression: " + targets[i].property.expressionError);
            }
            p.paths.push(targets[i].path);
        }
        p.data.expression = true;
        p.data.amplitude = amplitude;
    };

    function cascade(comp, layer, p, ctx, basedOn, title) {
        var count = units(layer, basedOn, ctx);
        var distance = AE.ranged(LAYOUT.slide, p.intensity) * comp.width;
        var animator = textAnimator(layer, title);
        var parts = animatorParts(animator, ["ADBE Text Opacity", "ADBE Text Position 3D"]);
        var per = p.end - p.start;
        var stagger = p.stagger;
        var window;
        var total;
        p.data.animator = title;
        p.data.units = count;
        p.data.distance = Z.round(distance, 2);
        if (count <= 1) {
            // One word or line: animate the animator's own values; the selector covers everything.
            animate(parts.property("ADBE Text Opacity"), p.start, p.end, 0, 100, "out", ctx);
            animate(parts.property("ADBE Text Position 3D"), p.start, p.end, [0, distance, 0], [0, 0, 0], "out", ctx);
            p.paths.push("Text/Animators/" + title);
            p.data.stagger = 0;
            return;
        }
        parts.property("ADBE Text Opacity").setValue(0);
        parts.property("ADBE Text Position 3D").setValue([0, distance, 0]);
        parts.advanced().property("ADBE Text Range Units").setValue(UNITS_PERCENTAGE);
        parts.advanced().property("ADBE Text Range Type2").setValue(basedOn === "words" ? BASED_ON.words : BASED_ON.lines);
        parts.advanced().property("ADBE Text Range Shape").setValue(SHAPE.rampUp);
        // Each unit leaves its offset state gently and settles slowly (TASTE: enter fast, settle slow).
        parts.advanced().property("ADBE Text Levels Max Ease").setValue(50);
        parts.advanced().property("ADBE Text Levels Min Ease").setValue(100);
        window = Math.min(100, 100 * per / (count * stagger));
        total = per * (100 + window) / window;
        if (window >= 100 - 1e-9 && per / count > stagger + 1e-6) {
            ctx.warn(Z.plural(count, basedOn === "words" ? "word" : "line") + " are too few for a " + stagger + " s stagger with one Range Selector; " +
                "they start " + Z.round(per / count, 3) + " s apart");
            stagger = per / count;
        }
        parts.selector().property("ADBE Text Percent Start").setValue(0);
        parts.selector().property("ADBE Text Percent End").setValue(Math.round(window * 100) / 100);
        p.end = AE.snapTime(comp, p.start + total, null, "end");
        animate(parts.selector().property("ADBE Text Percent Offset"), p.start, p.end, -Math.round(window * 100) / 100, 100, "linear", ctx);
        p.paths.push("Text/Animators/" + title);
        p.data.stagger = Z.round(stagger, 4);
        p.data.window = Z.round(window, 2);
    }

    RUN["word-cascade"] = function (comp, layer, p, ctx) {
        cascade(comp, layer, p, ctx, "words", "Zenvi Word Cascade");
    };

    RUN["line-rise"] = function (comp, layer, p, ctx) {
        cascade(comp, layer, p, ctx, "lines", "Zenvi Line Rise");
    };

    RUN.typewriter = function (comp, layer, p, ctx) {
        var animator = textAnimator(layer, "Zenvi Typewriter");
        var parts = animatorParts(animator, ["ADBE Text Opacity"]);
        p.data.animator = "Zenvi Typewriter";
        p.data.units = units(layer, "characters", ctx);
        parts.property("ADBE Text Opacity").setValue(0);
        parts.advanced().property("ADBE Text Range Units").setValue(UNITS_PERCENTAGE);
        parts.advanced().property("ADBE Text Range Type2").setValue(BASED_ON.charactersExcludingSpaces);
        parts.advanced().property("ADBE Text Range Shape").setValue(SHAPE.square);
        parts.advanced().property("ADBE Text Selector Smoothness").setValue(0);
        // A ticker: one character at a time at an even pace (TASTE allows linear here).
        animate(parts.selector().property("ADBE Text Percent Start"), p.start, p.end, 0, 100, "linear", ctx);
        p.paths.push("Text/Animators/Zenvi Typewriter");
        p.data.stagger = Z.round((p.end - p.start) / Math.max(1, p.data.units), 4);
    };

    // ------------------------------------------------------------------
    // Entry point.

    /**
     * Apply preset `name` to `layer`. options: {start, duration, intensity,
     * direction, stagger} (null/undefined = TASTE default). Validates first,
     * then changes the layer. Returns the receipt data.
     */
    AE.applyMotionPreset = function (comp, layer, name, options, ctx) {
        var opts = options || {};
        var spec;
        var p;
        var count;
        var duration;
        var position;
        var visibleEnd;
        Z.oneOf("preset", name, AE.MOTION_PRESETS);
        spec = PRESETS[name];
        if (!(layer instanceof AVLayer)) {
            throw Z.refuse("INVALID_ARGUMENT", "Motion presets need a footage, text, shape, solid or precomp layer; \"" + layer.name + "\" is a " + AE.layerType(layer) + " layer");
        }
        if (spec.text && !(layer instanceof TextLayer)) {
            throw Z.refuse("INVALID_ARGUMENT", name + " animates text; \"" + layer.name + "\" is a " + AE.layerType(layer) + " layer (try slide-in or fade-in)");
        }
        AE.requireUnlocked(layer);
        p = {
            intensity: opts.intensity !== undefined && opts.intensity !== null ? Z.inRange("intensity", opts.intensity, 0, 1) : 0.5,
            direction: opts.direction !== undefined && opts.direction !== null ? Z.oneOf("direction", opts.direction, ["left", "right", "up", "down"]) : (spec.direction || "up"),
            stagger: opts.stagger !== undefined && opts.stagger !== null ? Z.inRange("stagger", opts.stagger, 0.01, 2) : spec.stagger,
            start: 0,
            end: 0,
            /** @type {string[]} */
            paths: [],
            /** @type {Object<string, any>} */
            data: {}
        };
        duration = opts.duration !== undefined && opts.duration !== null ? Z.inRange("duration", opts.duration, 1 / comp.frameRate, 600) : spec.duration;
        if (name === "typewriter" && (opts.duration === undefined || opts.duration === null)) {
            count = units(layer, "characters", ctx);
            duration = Math.max(1 / comp.frameRate, count * p.stagger);
        }
        if ((spec.kind === "hold" || spec.kind === "procedural") && (opts.duration === undefined || opts.duration === null)) {
            duration = null;
        }
        // A layer may run past the comp's end; what is visible ends with the comp.
        visibleEnd = Math.min(layer.outPoint, comp.duration);
        if (opts.start !== undefined && opts.start !== null) {
            p.start = AE.compTime(comp, Z.inRange("start", opts.start, 0, null), ctx, "start");
        } else if (spec.kind === "exit") {
            p.start = AE.snapTime(comp, Math.max(layer.inPoint, visibleEnd - duration), ctx, "start");
        } else {
            p.start = AE.snapTime(comp, Math.max(0, layer.inPoint), ctx, "start");
        }
        if (duration === null) {
            duration = visibleEnd - p.start;
            if (duration <= 0) {
                throw Z.refuse("INVALID_ARGUMENT", name + " starts at " + Z.round(p.start) + " s, after layer \"" + layer.name + "\" ends; pass `duration`");
            }
        }
        p.end = AE.snapTime(comp, p.start + duration, null, "end");
        if (p.end <= p.start) {
            p.end = p.start + 1 / comp.frameRate;
        }
        if (name === "drift") {
            position = positionTargets(layer);
            if (position[0].property.expression !== "" && position[0].property.expression.indexOf(DRIFT_MARK) !== 0) {
                throw Z.refuse("INVALID_ARGUMENT", position[0].path + " of \"" + layer.name + "\" already has an expression; clear it with ae_add_expression first");
            }
        }
        if (spec.kind === "entrance" && p.start < layer.inPoint - 1e-6) {
            ctx.warn(name + " starts before layer \"" + layer.name + "\" appears (" + Z.round(layer.inPoint) + " s)");
        }

        ctx.changed();
        RUN[name](comp, layer, p, ctx);
        if (spec.kind !== "procedural" && p.end > layer.outPoint + 1e-6) {
            ctx.warn(name + " runs past the layer's out point (" + Z.round(layer.outPoint) + " s)");
        }
        p.data.preset = name;
        p.data.layer = AE.layerRef(layer);
        p.data.start = Z.round(p.start, 4);
        p.data.end = Z.round(p.end, 4);
        p.data.duration = Z.round(p.end - p.start, 4);
        p.data.intensity = p.intensity;
        if (DIRECTIONS[p.direction] && (name === "slide-in" || name === "slide-out" || name === "whip-in" || name === "ken-burns")) {
            p.data.direction = p.direction;
        }
        p.data.properties = p.paths;
        return p.data;
    };

    Z.register("ae_apply_motion_preset", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var layer = AE.findLayer(comp, Z.required(args, "layer", "any"));
        var preset = Z.required(args, "preset", "string");
        var data = AE.applyMotionPreset(comp, layer, preset, {
            start: Z.optional(args, "start", "number", null),
            duration: Z.optional(args, "duration", "number", null),
            intensity: Z.optional(args, "intensity", "number", null),
            direction: Z.optional(args, "direction", "string", null),
            stagger: Z.optional(args, "stagger", "number", null)
        }, ctx);
        return Z.applied("Applied " + preset + " to \"" + layer.name + "\" (" + data.start + "-" + data.end + " s" +
            (data.direction ? ", " + data.direction : "") + ")", data);
    });
}(ZenviLink));
// ---- aeft/50-aeft-effects.jsx ----
// Zenvi Link: effect tools: ae_apply_effect, ae_set_effect, ae_apply_look.

(/** @param {ZenviLinkApi} Z */ function (Z) {
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
        var found;
        var adjustment;
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
            adjustment = comp.layers.addSolid([1, 1, 1], "Zenvi Look", comp.width, comp.height, comp.pixelAspect);
            adjustment.adjustmentLayer = true;
            adjustment.comment = LOOK_LAYER_MARK;
            adjustment.startTime = 0;
            adjustment.inPoint = 0;
            adjustment.outPoint = comp.duration;
            layer = adjustment;
            created = true;
        }
        AE.removeEffectsNamed(layer, LOOK_EFFECT);
        AE.removeEffectsNamed(layer, SPLIT_TONE_EFFECT);
        if (!target) {
            layer.name = "Zenvi Look (" + look + ")";
        }
        lumetri = AE.addEffect(layer, "ADBE Lumetri", LOOK_EFFECT);
        found = 0;
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
            found += 1;
        }
        if (!found) {
            // Lumetri's parameters are found by their English names; take the look off again.
            AE.removeEffectsNamed(layer, LOOK_EFFECT);
            if (created) {
                layer.remove();
            }
            throw Z.refuse("UNSUPPORTED", "Found none of Lumetri Color's parameters by their English names (a non-English After Effects?); " +
                "set them with ae_apply_effect and match names instead");
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
// ---- aeft/55-aeft-masks.jsx ----
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
// ---- aeft/60-aeft-render.jsx ----
// Zenvi Link: render tools: ae_render and ae_render_for_zenvi (AE -> Zenvi).
//
// Output module template names differ by version: After Effects 2022+ ships
// "High Quality" (ProRes 422 HQ) and "High Quality with Alpha" (ProRes
// 4444), 2023+ adds "H.264 - Match Render Settings - 5/15/40 Mbps", and
// older versions have "Lossless" / "Lossless with Alpha" (QuickTime
// Animation). Templates are matched by name with fallbacks, and a render only
// renders its own queue item (others are unchecked and restored).
// ae_render_for_zenvi falls back only to codecs Zenvi links: H.264, ProRes
// 4444 and QuickTime Animation (qtrle).

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;

    var CHAINS = {
        "h264": [
            {pattern: /^H\.264.*\b40\s?Mbps/i, codec: "h264", ext: "mp4"},
            {pattern: /^H\.264.*\b15\s?Mbps/i, codec: "h264", ext: "mp4"},
            {pattern: /^H\.264/i, codec: "h264", ext: "mp4"}
        ],
        "prores-422": [
            {exact: "High Quality", codec: "prores422", ext: "mov"},
            {pattern: /ProRes 422/i, codec: "prores422", ext: "mov"}
        ],
        "prores-4444": [
            {exact: "High Quality with Alpha", codec: "prores4444", ext: "mov"},
            {pattern: /4444/, codec: "prores4444", ext: "mov"}
        ],
        "lossless": [{exact: "Lossless", codec: "qtrle", ext: "mov"}],
        "lossless-alpha": [{exact: "Lossless with Alpha", codec: "qtrle", ext: "mov"}]
    };
    var FALLBACK = {"h264": "prores-422", "prores-422": "lossless", "prores-4444": "lossless-alpha"};
    var PRESETS = ["h264", "prores-422", "prores-4444", "lossless", "lossless-alpha"];

    function templateList(module) {
        var list = module.templates;
        var out = [];
        var i;
        for (i = 0; i < list.length; i += 1) {
            out.push(String(list[i]));
        }
        return out;
    }

    function firstMatch(templates, candidate) {
        var i;
        for (i = 0; i < templates.length; i += 1) {
            if (candidate.exact ? templates[i] === candidate.exact : candidate.pattern.test(templates[i])) {
                return templates[i];
            }
        }
        return null;
    }

    /** Codec and extension for a template chosen by name. */
    function describeTemplate(name) {
        if (/H\.264/i.test(name)) {
            return {codec: "h264", ext: "mp4"};
        }
        if (/4444|High Quality with Alpha/i.test(name)) {
            return {codec: "prores4444", ext: "mov"};
        }
        if (/ProRes|High Quality/i.test(name)) {
            return {codec: "prores422", ext: "mov"};
        }
        if (/Lossless/i.test(name)) {
            return {codec: "qtrle", ext: "mov"};
        }
        return {codec: "other", ext: null};
    }

    /**
     * The template for `preset` from the module's list, falling back along
     * h264 -> prores-422 -> lossless and prores-4444 -> lossless-alpha (with a
     * warning). Returns {template, codec, ext, preset}.
     */
    AE.pickTemplate = function (templates, preset, ctx) {
        var current = preset;
        var found;
        var i;
        while (current) {
            for (i = 0; i < CHAINS[current].length; i += 1) {
                found = firstMatch(templates, CHAINS[current][i]);
                if (found) {
                    if (current !== preset) {
                        ctx.warn("This After Effects has no " + preset + " output template; rendered " + current + " (\"" + found + "\")");
                    }
                    return {template: found, codec: CHAINS[current][i].codec, ext: CHAINS[current][i].ext, preset: current};
                }
            }
            current = FALLBACK[current] || null;
        }
        throw Z.refuse("UNSUPPORTED", "No output module template for " + preset + "; this After Effects has: " + templates.join(", "));
    };

    /** `path` with the extension the format writes (warns when it changed). */
    function withExtension(path, ext, ctx) {
        var slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
        var dot = path.lastIndexOf(".");
        var base = dot > slash ? path.slice(0, dot) : path;
        var given = dot > slash ? path.slice(dot + 1).toLowerCase() : "";
        if (!ext || given === ext) {
            return path;
        }
        if (given) {
            ctx.warn("Changed the output extension from ." + given + " to ." + ext + " to match the format");
        }
        return base + "." + ext;
    }

    function ensureFolder(folder) {
        if (!folder.exists && !folder.create()) {
            throw Z.fail("HOST_ERROR", "Could not create folder " + folder.fsName);
        }
    }

    function requireIdleQueue() {
        if (app.project.renderQueue.rendering) {
            throw Z.refuse("BUSY", "The render queue is already rendering; wait for it to finish");
        }
    }

    /** Uncheck the queued items other than `index`, so only it renders. Returns their indexes. */
    function uncheckOthers(queue, index) {
        var others = [];
        var item;
        var i;
        for (i = 1; i <= queue.numItems; i += 1) {
            item = queue.item(i);
            if (i !== index && item.render && item.status === RQItemStatus.QUEUED) {
                item.render = false;
                others.push(i);
            }
        }
        return others;
    }

    /** Set up a new queue item: render settings, time span, output template and file. */
    function configureItem(item, comp, plan, workAreaOnly, renderSettings, ctx) {
        var module;
        if (renderSettings) {
            if (Z.filter(item.templates, function (name) { return String(name) === renderSettings; }).length) {
                item.applyTemplate(renderSettings);
            } else {
                ctx.warn("No render settings template \"" + renderSettings + "\"; kept the default");
            }
        }
        item.timeSpanStart = workAreaOnly ? comp.workAreaStart : 0;
        item.timeSpanDuration = workAreaOnly ? comp.workAreaDuration : comp.duration;
        module = item.outputModule(1);
        module.applyTemplate(plan.choice.template);
        module.file = plan.writeTo;
    }

    /** Render the queue (only item `index` is checked). Returns the seconds it took. */
    function renderNow(index) {
        var queue = app.project.renderQueue;
        var item;
        var started = new Date().getTime();
        queue.render();
        item = queue.item(index);
        if (item.status !== RQItemStatus.DONE) {
            throw Z.fail("HOST_ERROR", "The render did not finish (status " + AE.renderStatusName(item.status) + "); see the Render Queue panel");
        }
        return (new Date().getTime() - started) / 1000;
    }

    function chooseTemplate(templates, templateName, preset, ctx) {
        var described;
        if (templateName) {
            if (Z.indexOf(templates, templateName) < 0) {
                throw Z.refuse("NOT_FOUND", "No output module template \"" + templateName + "\"; this After Effects has: " + templates.join(", "));
            }
            described = describeTemplate(templateName);
            return {template: templateName, codec: described.codec, ext: described.ext, preset: null};
        }
        return AE.pickTemplate(templates, preset, ctx);
    }

    // Output module templates are the same for every output module: read
    // from a queued item, else remembered across host-script reloads
    // (AE.state), else read from the new queue item itself (queueForRender).

    /** The output module template names when known without changing anything, else null. */
    function knownTemplates(templateName) {
        var queue = app.project.renderQueue;
        var remembered = AE.state.outputTemplates;
        if (queue.numItems > 0 && queue.item(1).numOutputModules > 0) {
            return templateList(queue.item(1).outputModule(1));
        }
        if (remembered === null || (templateName && Z.indexOf(remembered, templateName) < 0)) {
            // Never read, or a template saved since.
            return null;
        }
        return remembered;
    }

    // Zenvi links only these codecs (SPEC 3.6; the desktop refuses others), so
    // ae_render_for_zenvi never falls back to ProRes 422.
    var ZENVI_CODECS = ["h264", "prores4444", "qtrle"];
    var ZENVI_CHAINS = {
        alpha: ["prores-4444", "lossless-alpha"],
        opaque: ["h264", "prores-4444", "lossless", "lossless-alpha"]
    };

    /** The first available template along `presets`; warns when it is not the first choice. */
    function zenviTemplate(templates, alpha, ctx) {
        var presets = alpha ? ZENVI_CHAINS.alpha : ZENVI_CHAINS.opaque;
        var found;
        var i;
        var j;
        for (i = 0; i < presets.length; i += 1) {
            for (j = 0; j < CHAINS[presets[i]].length; j += 1) {
                found = firstMatch(templates, CHAINS[presets[i]][j]);
                if (!found) {
                    continue;
                }
                if (i > 0) {
                    ctx.warn("This After Effects has no " + presets[0] + " output template; rendered " + presets[i] + " (\"" + found + "\")" +
                        (!alpha && CHAINS[presets[i]][j].codec !== "h264" ? "; transparent areas of the comp stay transparent in Zenvi" : ""));
                }
                return {template: found, codec: CHAINS[presets[i]][j].codec, ext: CHAINS[presets[i]][j].ext, preset: presets[i]};
            }
        }
        throw Z.refuse("UNSUPPORTED", "No output module template renders a codec Zenvi can link (" + ZENVI_CODECS.join(", ") + "); this After Effects has: " +
            templates.join(", ") + "; pass `template`");
    }

    function fileSize(path) {
        var file = new File(path);
        return file.exists ? file.length : null;
    }

    function splitName(file) {
        var name = File.decode(file.name);
        var dot = name.lastIndexOf(".");
        return dot > 0 ? {base: name.slice(0, dot), ext: name.slice(dot)} : {base: name, ext: ""};
    }

    /**
     * A render that replaces an existing file goes to a staging file next to
     * it and replaces it only once complete, so a failed render never costs
     * the old file; a render to a new file deletes what it wrote when it fails.
     */
    function stagingFile(target) {
        var parts = splitName(target);
        return new File(target.parent.fullName + "/" + parts.base + ".zenvi-partial-" + new Date().getTime() + parts.ext);
    }

    /** Move a finished staging render into place (replacing an old file there). */
    function install(staging, target) {
        installed(staging);
        if (target.exists && !target.remove()) {
            throw Z.fail("HOST_ERROR", "Could not replace " + target.fsName + "; the render is at " + staging.fsName);
        }
        if (!staging.rename(File.decode(target.name))) {
            throw Z.fail("HOST_ERROR", "Could not move the render to " + target.fsName + "; it is at " + staging.fsName);
        }
        return new File(target.fsName);
    }

    /** The rendered file, which must exist. */
    function installed(file) {
        var parts;
        if (!file.exists) {
            parts = splitName(file);
            throw Z.fail("HOST_ERROR", "After Effects finished but " + file.fsName + " is not there (look for " + parts.base + ".* in " +
                file.parent.fsName + "; the template may write another format)");
        }
        return file;
    }

    function discard(file) {
        if (file.exists) {
            file.remove();
        }
    }

    function renderTitle(name) {
        return Z.CATALOG[name] ? Z.CATALOG[name].title : name;
    }

    /** folder/base.ext, or base-2.ext, base-3.ext ... when that is taken. */
    function uniqueFile(folder, base, ext) {
        var file = new File(folder.fullName + "/" + base + "." + ext);
        var n;
        for (n = 2; file.exists && n < 1000; n += 1) {
            file = new File(folder.fullName + "/" + base + "-" + n + "." + ext);
        }
        return file;
    }

    // ------------------------------------------------------------------
    // Queueing. The render tools are registered without dispatch's undo
    // group, because After Effects must not render (or hand over to Adobe
    // Media Encoder) inside one. Every render queue change still happens in
    // an undo group "Zenvi: <title>": one to queue, and one to tidy up after
    // the render when there is anything to tidy.

    /**
     * Queue `comp` in one undo group. `plan(templates)` chooses the template
     * and output and refuses when it cannot: {choice, file, writeTo}. It runs
     * before anything changes when the templates are known, else on the new
     * queue item, which is removed again (same undo group) when plan refuses.
     * With `alone`, the other queued items are unchecked so only this one
     * renders. Returns {index, plan, others}.
     */
    function queueForRender(title, summary, comp, templateName, plan, alone, settings, ctx) {
        var queue = app.project.renderQueue;
        var templates = knownTemplates(templateName);
        var planned = templates ? plan(templates) : null;
        return AE.inUndoGroup(title, function () {
            var item = queue.items.add(comp);
            var index = queue.numItems;
            try {
                if (!planned) {
                    AE.state.outputTemplates = templateList(item.outputModule(1));
                    planned = plan(AE.state.outputTemplates);
                }
                ensureFolder(planned.file.parent);
            } catch (refused) {
                item.remove();
                throw refused;
            }
            ctx.changed();
            configureItem(queue.item(index), comp, planned, settings.workAreaOnly, settings.renderSettings, ctx);
            return {index: index, plan: planned, others: alone ? uncheckOthers(queue, index) : []};
        }, summary);
    }

    /**
     * After the render: check the other queued items again and, with
     * `removeIndex`, remove that item, in one undo group. Returns the undo
     * steps it added (0 or 1).
     */
    function tidyQueue(title, comp, others, removeIndex) {
        var queue = app.project.renderQueue;
        var parts = [];
        var summary;
        if (removeIndex) {
            parts.push("removed the finished render queue item for \"" + comp.name + "\"");
        }
        if (others.length) {
            parts.push("checked " + Z.plural(others.length, "other render queue item") + " again");
        }
        if (!parts.length) {
            return 0;
        }
        summary = parts.join("; ");
        AE.inUndoGroup(title, function () {
            var i;
            for (i = 0; i < others.length; i += 1) {
                queue.item(others[i]).render = true;
            }
            if (removeIndex) {
                queue.item(removeIndex).remove();
            }
        }, summary.charAt(0).toUpperCase() + summary.slice(1));
        return 1;
    }

    /**
     * A call that fails after queueing says what it left in the undo history
     * (dispatch reports undoSteps null for tools outside its undo group).
     */
    function warnSteps(ctx, title, comp, steps) {
        ctx.warn(steps > 1 ?
            "This call made 2 undo steps (\"Zenvi: " + title + "\" twice): queueing \"" + comp.name + "\" and tidying the render queue after" :
            "This call made 1 undo step: Edit > Undo \"Zenvi: " + title + "\" takes \"" + comp.name + "\" off the render queue again");
    }

    // ------------------------------------------------------------------
    // ae_render

    Z.register("ae_render", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var project = AE.requireProject();
        var queue = project.renderQueue;
        var preset = Z.oneOf("preset", Z.optional(args, "preset", "string", "h264"), PRESETS);
        var templateName = Z.optional(args, "template", "string", null);
        var renderSettings = Z.optional(args, "render_settings", "string", "Best Settings");
        var workAreaOnly = Z.optional(args, "work_area_only", "boolean", false);
        var mode = Z.oneOf("mode", Z.optional(args, "mode", "string", "render_now"), ["render_now", "queue_only", "media_encoder"]);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var output = Z.optional(args, "output", "string", null);
        var title = renderTitle("ae_render");
        var queued;
        var choice;
        var file;
        var steps = 1;
        var finished = false;
        var seconds = null;
        var summary;
        if (output !== null) {
            AE.requireAbsolutePath(output, "output");
        } else if (!project.file) {
            throw Z.refuse("INVALID_ARGUMENT", "The project is unsaved; pass `output` (an absolute file path)");
        }
        if (mode === "media_encoder" && !Z.hasMethod(queue, "queueInAME")) {
            throw Z.refuse("UNSUPPORTED", "This After Effects cannot queue renders in Adobe Media Encoder; use mode render_now");
        }
        if (workAreaOnly && comp.workAreaDuration <= 0) {
            throw Z.refuse("INVALID_ARGUMENT", "Comp \"" + comp.name + "\" has an empty work area");
        }
        requireIdleQueue();
        queued = queueForRender(title, "Queued \"" + comp.name + "\" for rendering", comp, templateName, function (templates) {
            var picked = chooseTemplate(templates, templateName, preset, ctx);
            var target = new File(withExtension(output !== null ? output :
                project.file.parent.fullName + "/Renders/" + AE.safeFileName(comp.name) + "." + (picked.ext || "mov"), picked.ext, ctx));
            if (target.exists && !overwrite) {
                throw Z.refuse("INVALID_ARGUMENT", target.fsName + " already exists; pass overwrite: true or another `output`");
            }
            if (target.exists && mode !== "render_now") {
                ctx.warn(target.fsName + " already exists; the render will replace it when it runs");
            }
            // A render that replaces a file goes to a staging file first, so a failed render keeps the old one.
            return {choice: picked, file: target, writeTo: target.exists && mode === "render_now" ? stagingFile(target) : target};
        }, mode !== "queue_only", {workAreaOnly: workAreaOnly, renderSettings: renderSettings}, ctx);
        choice = queued.plan.choice;
        file = queued.plan.file;
        try {
            if (mode === "render_now") {
                try {
                    seconds = renderNow(queued.index);
                } catch (failedRender) {
                    discard(queued.plan.writeTo);
                    throw failedRender;
                }
            } else if (mode === "media_encoder") {
                // canQueueInAME says whether there is anything queued to send; ours is now.
                if (!queue.canQueueInAME) {
                    throw Z.fail("UNSUPPORTED", "After Effects reports nothing it can send to Adobe Media Encoder (is it installed?); \"" +
                        comp.name + "\" stays in the render queue as item " + queued.index);
                }
                queue.queueInAME(false);
            }
            finished = true;
        } finally {
            steps += tidyQueue(title, comp, queued.others, 0);
            if (!finished) {
                warnSteps(ctx, title, comp, steps);
            }
        }
        if (mode === "render_now") {
            try {
                file = queued.plan.writeTo !== file ? install(queued.plan.writeTo, file) : installed(file);
            } catch (notInstalled) {
                warnSteps(ctx, title, comp, steps);
                throw notInstalled;
            }
            summary = "Rendered \"" + comp.name + "\" to " + file.fsName + " in " + Z.round(seconds, 1) + " s";
        } else if (mode === "media_encoder") {
            summary = "Queued \"" + comp.name + "\" in Adobe Media Encoder (" + choice.template + "); start its queue there";
        } else {
            summary = "Added \"" + comp.name + "\" to the render queue as item " + queued.index + " (" + choice.template + ")";
        }
        return Z.applied(summary, {
            comp_id: comp.id,
            comp_name: comp.name,
            output: file.fsName,
            template: choice.template,
            codec: choice.codec,
            mode: mode,
            render_queue_index: queued.index,
            status: AE.renderStatusName(queue.item(queued.index).status),
            render_seconds: seconds !== null ? Z.round(seconds, 2) : null,
            size_bytes: mode === "render_now" ? fileSize(file.fsName) : null,
            work_area_only: workAreaOnly
        }, steps);
    }, {mutating: false});

    // ------------------------------------------------------------------
    // ae_render_for_zenvi

    Z.register("ae_render_for_zenvi", function (args, ctx) {
        var comp = AE.findComp(args.comp);
        var project = AE.requireProject();
        var alpha = Z.optional(args, "alpha", "boolean", false);
        var output = Z.optional(args, "output", "string", null);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var workAreaOnly = Z.optional(args, "work_area_only", "boolean", false);
        var templateName = Z.optional(args, "template", "string", null);
        var title = renderTitle("ae_render_for_zenvi");
        var now = new Date();
        var queued;
        var choice;
        var file;
        var seconds;
        var steps;
        var finished = false;
        var duration = workAreaOnly ? comp.workAreaDuration : comp.duration;
        var fps = AE.fpsRational(comp.frameRate);
        var frames = Math.round(duration * comp.frameRate);
        var renderedAt;
        var aep = AE.projectPath();
        var data;
        if (output !== null) {
            AE.requireAbsolutePath(output, "output");
        }
        if (workAreaOnly && comp.workAreaDuration <= 0) {
            throw Z.refuse("INVALID_ARGUMENT", "Comp \"" + comp.name + "\" has an empty work area");
        }
        requireIdleQueue();
        queued = queueForRender(title, "Queued \"" + comp.name + "\" for Zenvi", comp, templateName, function (templates) {
            var picked;
            var target;
            if (templateName) {
                picked = chooseTemplate(templates, templateName, null, ctx);
                if (Z.indexOf(ZENVI_CODECS, picked.codec) < 0) {
                    throw Z.refuse("INVALID_ARGUMENT", "Template \"" + templateName + "\" renders " + picked.codec + "; Zenvi links only " + ZENVI_CODECS.join(", ") +
                        " (an H.264, ProRes 4444 or QuickTime Animation template)");
                }
                if (alpha && picked.codec === "h264") {
                    ctx.warn("alpha: true asked for transparency, but H.264 template \"" + templateName + "\" has none");
                }
            } else {
                picked = zenviTemplate(templates, alpha, ctx);
            }
            if (output === null) {
                // Zenvi's own renders folder: a new name per render, never another file.
                target = uniqueFile(AE.tempFolder("renders"), AE.safeFileName(comp.name) + "-" + comp.id + "-" + AE.fileStamp(now), picked.ext || "mov");
            } else {
                target = new File(withExtension(output, picked.ext, ctx));
            }
            if (target.exists && !overwrite) {
                throw Z.refuse("INVALID_ARGUMENT", target.fsName + " already exists; pass overwrite: true or another `output`");
            }
            return {choice: picked, file: target, writeTo: target.exists ? stagingFile(target) : target};
        }, true, {workAreaOnly: workAreaOnly, renderSettings: "Best Settings"}, ctx);
        choice = queued.plan.choice;
        file = queued.plan.file;
        if (!aep) {
            ctx.warn("The project is unsaved, so Zenvi cannot re-render this clip later; save it (ae_save_project) and send again");
        }
        try {
            seconds = renderNow(queued.index);
            finished = true;
        } catch (failedRender) {
            discard(queued.plan.writeTo);
            throw failedRender;
        } finally {
            // A failed render stays in the queue for inspection; a finished one is removed.
            steps = 1 + tidyQueue(title, comp, queued.others, finished ? queued.index : 0);
            if (!finished) {
                warnSteps(ctx, title, comp, steps);
            }
        }
        try {
            file = queued.plan.writeTo !== file ? install(queued.plan.writeTo, file) : installed(file);
        } catch (notInstalled) {
            warnSteps(ctx, title, comp, steps);
            throw notInstalled;
        }
        renderedAt = AE.isoTime(new Date());
        data = {
            path: file.fsName,
            comp_id: comp.id,
            comp_name: comp.name,
            project: aep,
            width: comp.width,
            height: comp.height,
            fps: Z.round(comp.frameRate, 6),
            fps_rational: fps,
            duration: Z.round(duration, 6),
            duration_frames: frames,
            codec: choice.codec,
            template: choice.template,
            alpha: alpha,
            work_area_only: workAreaOnly,
            render_seconds: Z.round(seconds, 2),
            size_bytes: fileSize(file.fsName),
            rendered_at: renderedAt,
            link: {
                version: 1,
                kind: "aftereffects",
                source: {project_dir: null, entry: null, composition: comp.name, composition_key: comp.id, file: null, line: null, aep: aep},
                props: {},
                render: {
                    codec: choice.codec,
                    width: comp.width,
                    height: comp.height,
                    fps: fps,
                    duration_frames: frames,
                    output: file.fsName,
                    rendered_at: renderedAt,
                    fingerprint: null
                },
                state: "fresh",
                error: null
            }
        };
        return Z.applied("Rendered \"" + comp.name + "\" for Zenvi (" + choice.codec + ", " + comp.width + "x" + comp.height + ", " + frames + " frames) to " +
            file.fsName, data, steps);
    }, {mutating: false});
}(ZenviLink));
// ---- aeft/70-aeft-project.jsx ----
// Zenvi Link: project, history and script tools: ae_save_project, ae_undo,
// ae_run_jsx_file, ae_run_script.

(/** @param {ZenviLinkApi} Z */ function (Z) {
    var AE = Z.ae;

    var UNDO_COMMAND_ID = 16;
    var JOURNAL_SIZE = 100;

    // ------------------------------------------------------------------
    // Journal of applied Zenvi steps, so ae_undo can say what it undid. After
    // Effects has no API to read its undo history. It lives in AE.state, so it
    // survives the panel re-evaluating the host script.

    function remember(title, summary) {
        var journal = AE.state.journal;
        journal.push({title: "Zenvi: " + title, summary: summary, at: AE.isoTime(new Date())});
        if (journal.length > JOURNAL_SIZE) {
            journal.shift();
        }
    }
    AE.remember = remember;

    var runMutating = Z.adapter.runMutating;

    Z.adapter.runMutating = function (title, fn) {
        var outcome = runMutating(title, fn);
        if (outcome && outcome.zenviResult === true && outcome.status === "applied" && outcome.undoSteps !== 0) {
            remember(title, outcome.summary);
        }
        return outcome;
    };

    // ------------------------------------------------------------------
    // ae_save_project (registered without dispatch's undo group: saving is not an undo step)

    Z.register("ae_save_project", function (args, ctx) {
        var project = AE.requireProject();
        var path = Z.optional(args, "path", "string", null);
        var overwrite = Z.optional(args, "overwrite", "boolean", false);
        var file = null;
        var current = AE.projectPath();
        if (path === null && !current) {
            throw Z.refuse("INVALID_ARGUMENT", "The project is untitled; pass `path` (an absolute .aep path)");
        }
        if (path !== null) {
            AE.requireAbsolutePath(path, "path");
            if (!/\.aepx?$/i.test(path)) {
                throw Z.refuse("INVALID_ARGUMENT", "`path` must end in .aep or .aepx");
            }
            file = new File(path);
            if (!file.parent.exists) {
                throw Z.refuse("NOT_FOUND", "Folder " + file.parent.fsName + " does not exist");
            }
            if (file.exists && !overwrite && (!current || AE.pathKey(file.fsName) !== AE.pathKey(current))) {
                throw Z.refuse("INVALID_ARGUMENT", file.fsName + " already exists; pass overwrite: true or another path");
            }
        }
        ctx.changed();
        // Project.save returns nothing; a failed save throws.
        if (file) {
            project.save(file);
        } else {
            project.save();
        }
        return Z.applied("Saved the project to " + AE.projectPath(), {path: AE.projectPath(), previous_path: current, dirty: project.dirty === true}, 0);
    }, {mutating: false});

    // ------------------------------------------------------------------
    // ae_undo

    Z.register("ae_undo", function (args, ctx) {
        var steps = Z.optional(args, "steps", "integer", 1);
        var command = 0;
        var undone = [];
        var i;
        Z.inRange("steps", steps, 1, 50);
        AE.requireProject();
        try {
            command = app.findMenuCommandId("Undo");
        } catch (lookupError) {
            command = 0;
        }
        // The Undo item is renamed after the last action ("Undo Add Text"), so the lookup often misses.
        if (!command) {
            command = UNDO_COMMAND_ID;
        }
        for (i = 0; i < steps && AE.state.journal.length; i += 1) {
            undone.push(AE.state.journal.pop());
        }
        if (undone.length < steps) {
            ctx.warn((undone.length ? "Only " + Z.plural(undone.length, "Zenvi step") + " recorded" : "No Zenvi steps recorded") +
                " in this session; the other " + Z.plural(steps - undone.length, "step") + " undo whatever came before");
        }
        ctx.warn("If the project was changed by hand after the last Zenvi call, After Effects undid that change first");
        ctx.changed();
        // Registered without dispatch's undo group: Edit > Undo must not run inside one.
        for (i = 0; i < steps; i += 1) {
            app.executeCommand(command);
        }
        return Z.applied("Undid " + Z.plural(steps, "step") + (undone.length ? ": " + Z.map(undone, function (entry) { return entry.title; }).join(", ") : ""), {
            steps: steps,
            undone: Z.map(undone, function (entry) { return {title: entry.title, summary: entry.summary, at: entry.at}; }),
            command_id: command
        }, 0);
    }, {mutating: false});

    // ------------------------------------------------------------------
    // ae_run_jsx_file

    Z.register("ae_run_jsx_file", function (args, ctx) {
        var path = AE.requireAbsolutePath(Z.required(args, "path", "string"), "path");
        var file = new File(path);
        var result;
        var text;
        if (!/\.(jsx|jsxbin|js)$/i.test(path)) {
            throw Z.refuse("INVALID_ARGUMENT", "`path` must be a .jsx, .jsxbin or .js file");
        }
        if (!file.exists) {
            throw Z.refuse("NOT_FOUND", "File does not exist: " + path);
        }
        ctx.changed();
        try {
            result = $.evalFile(file);
        } catch (error) {
            throw Z.fail("HOST_ERROR", file.displayName + " failed: " + (error && error.message ? error.message : String(error)) +
                (error && typeof error.line === "number" ? " (line " + error.line + " of " + file.displayName + ")" : ""));
        }
        text = result === undefined || result === null ? "" : String(result);
        return Z.applied("Ran " + file.displayName + (text ? ": " + AE.clip(text, 300) : ""), {path: file.fsName, result: text});
    });

    // ------------------------------------------------------------------
    // ae_run_script

    function evaluate(code) {
        return eval(code);
    }

    Z.register("ae_run_script", function (args, ctx) {
        var code = Z.required(args, "code", "string");
        var value;
        var json;
        var result;
        if (!Z.trim(code).length) {
            throw Z.refuse("INVALID_ARGUMENT", "`code` is empty");
        }
        ctx.changed();
        try {
            value = evaluate(code);
        } catch (error) {
            throw Z.fail("HOST_ERROR", "The script failed: " + (error && error.message ? error.message : String(error)) +
                (error && typeof error.line === "number" ? " (line " + error.line + " of the snippet)" : ""));
        }
        try {
            json = value === undefined ? undefined : JSON.stringify(value);
        } catch (stringifyError) {
            json = undefined;
        }
        result = json === undefined ? (value === undefined ? null : String(value)) : JSON.parse(json);
        return Z.applied("Ran the script" + (value === undefined ? "" : "; it returned " + AE.clip(json === undefined ? String(value) : json, 200)), {
            result: result,
            type: value === null ? "null" : typeof value
        });
    });
}(ZenviLink));
