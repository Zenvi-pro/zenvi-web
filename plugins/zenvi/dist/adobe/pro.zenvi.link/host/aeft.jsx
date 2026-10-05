// Zenvi Link 1.0.0: host script for After Effects. Built from extension/host/{common,aeft}/*.jsx; do not edit.
// ---- common/00-json2.jsx ----
//  json2.js
//  2017-06-12
//  Public Domain.
//  NO WARRANTY EXPRESSED OR IMPLIED. USE AT YOUR OWN RISK.
//
//  Douglas Crockford's json2.js (https://github.com/douglascrockford/JSON-js),
//  unmodified apart from these header lines. ExtendScript is ECMAScript 3 and
//  has no JSON object; this file creates one only if it is missing.

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

    function this_value() {
        return this.valueOf();
    }

    if (typeof Date.prototype.toJSON !== "function") {

        Date.prototype.toJSON = function () {

            return isFinite(this.valueOf())
                ? (
                    this.getUTCFullYear()
                    + "-"
                    + f(this.getUTCMonth() + 1)
                    + "-"
                    + f(this.getUTCDate())
                    + "T"
                    + f(this.getUTCHours())
                    + ":"
                    + f(this.getUTCMinutes())
                    + ":"
                    + f(this.getUTCSeconds())
                    + "Z"
                )
                : null;
        };

        Boolean.prototype.toJSON = this_value;
        Number.prototype.toJSON = this_value;
        String.prototype.toJSON = this_value;
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
// Zenvi Link: the few ES5 built-ins ExtendScript (ECMAScript 3) lacks and the
// host scripts use. Each is defined only when missing.
//
// Only Array.prototype.indexOf and String.prototype.trim touch a prototype.
// Every CEP extension in the app shares one ExtendScript engine, and extra
// enumerable members on Array.prototype show up in other scripts' for-in
// loops, so iteration helpers live on ZenviLink (each/map/filter) instead of
// Array.prototype.forEach/map/filter.

if (!Array.prototype.indexOf) {
    Array.prototype.indexOf = function (search, fromIndex) {
        var length = this.length >>> 0;
        var i = fromIndex ? Number(fromIndex) : 0;
        if (i !== i) {
            i = 0;
        }
        if (i < 0) {
            i = Math.max(length + i, 0);
        }
        for (; i < length; i += 1) {
            if (i in this && this[i] === search) {
                return i;
            }
        }
        return -1;
    };
}

if (!String.prototype.trim) {
    String.prototype.trim = function () {
        return String(this).replace(/^[\s\u00a0\ufeff]+|[\s\u00a0\ufeff]+$/g, "");
    };
}

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

var ZenviLink = (function () {
    var Z = {};
    var registry = {};
    var names = [];

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
    // Small utilities (ES3 has no forEach/map/filter; see 01-polyfills.jsx).

    function has(object, key) {
        return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key);
    }
    Z.has = has;

    Z.isArray = function (value) {
        return Object.prototype.toString.call(value) === "[object Array]";
    };

    Z.isObject = function (value) {
        return value !== null && typeof value === "object" && !Z.isArray(value);
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
        if (allowed.indexOf(value) < 0) {
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
    // Registry and dispatch.

    /**
     * Register the implementation of catalog tool `name`. options (rarely
     * needed): {mutating, undoTitle} override the catalog's readOnlyHint and
     * title.
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
            code: Z.ERROR_CODES.indexOf(code) >= 0 ? code : "HOST_ERROR",
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
        var ctx = {tool: name, warnings: [], didChange: false};
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

    function finish(ctx, entry, outcome) {
        var failed = outcome.status === "refused" || outcome.status === "error";
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
                receipt.undoSteps = Z.adapter.undoStepsWhenApplied;
                receipt.warnings.push(Z.adapter.partialChangeWarning(entry ? entry.title : ctx.tool));
            }
        } else if (outcome.status === "applied") {
            receipt.undoSteps = outcome.undoSteps !== undefined ? outcome.undoSteps : Z.adapter.undoStepsWhenApplied;
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
        return stringify(info);
    };

    return Z;
}());
// ---- (generated) ----
// Generated by the Zenvi Link build from src/version.ts, src/taste.ts and src/catalog. Do not edit.
ZenviLink.version = "1.0.0";
ZenviLink.TASTE = {"timing":{"micro":{"default":0.27,"range":[0.2,0.35]},"entrance":{"default":0.6,"range":[0.5,0.8]},"exit":{"default":0.4,"range":[0.35,0.5]},"bigMove":{"default":1,"range":[0.8,1.2]},"stagger":{"word":0.06,"line":0.12,"range":[0.04,0.08]},"textHold":{"base":1.5,"perWord":0.3},"lowerThird":{"default":5,"range":[4,6]},"titleCard":{"default":3,"range":[2.5,4]},"crossDissolve":{"default":0.5,"sceneChange":1,"range":[0.5,1]},"dip":{"default":0.8,"range":[0.6,1.2]},"audioFade":{"in":0.25,"out":1,"outRange":[0.5,1.5],"musicEnd":1.5},"jlLead":{"default":0.5,"range":[0.25,0.75]}},"easing":{"default":"smooth","curves":{"smooth":[0.33,0,0.2,1],"out":[0.16,1,0.3,1],"entrance":[0.16,1,0.3,1],"in":[0.7,0,0.84,0],"exit":[0.7,0,0.84,0],"in-out":[0.65,0,0.35,1],"snap":[0.2,0,0,1],"linear":[0,0,1,1]},"overshoot":{"max":0.06,"settle":0.25},"aeInfluence":{"min":0.1,"max":100}},"layout":{"actionSafe":0.05,"titleSafe":0.1,"verticalTop":0.12,"verticalBottom":0.2,"gridColumns":12,"lowerThird":{"baselineLandscape":0.8,"baselineVertical":0.7,"gapOfNameSize":0.25},"slide":{"default":0.04,"range":[0.03,0.06]},"scale":{"entranceFrom":0.92,"holdPushTo":1.04},"kenBurns":{"default":0.04,"range":[0.03,0.06]}},"type":{"families":["Inter","SF Pro Display","Helvetica Neue","Arial"],"postscript":{"headline":["Inter-Bold","SFProDisplay-Bold","HelveticaNeue-Bold","Arial-BoldMT"],"body":["Inter-Regular","SFProDisplay-Regular","HelveticaNeue","ArialMT"]},"weights":{"headline":[700,800],"body":[400,500]},"referenceShortSide":1080,"sizes":{"headline":96,"title":72,"subtitle":44,"lowerThirdName":54,"lowerThirdRole":34,"caption":42},"tracking":{"headline":-0.015,"headlineRange":[-0.02,-0.01],"caps":0.08,"capsRange":[0.06,0.1]},"leading":{"headline":1.1,"body":1.3},"maxLineChars":32,"scrim":{"default":0.45,"range":[0.35,0.55]},"shadow":{"distance":0,"softness":16,"softnessRange":[12,20],"opacity":0.4},"minContrast":4.5},"color":{"palette":{"ink":"#0B0B0F","paper":"#F7F7F5","accent":"#FF5A36","secondary":"#2F6BFF"},"looks":{"clean":{"contrast":5,"vibrance":5},"warm-film":{"temperature":8,"tint":2,"fade":8,"saturation":-6},"teal-orange":{"shadowTint":"teal","highlightTint":"orange","saturation":6},"moody":{"exposure":-0.3,"contrast":12,"saturation":-15,"vignette":-0.8},"bw-contrast":{"saturation":-100,"contrast":25}},"lookStrength":0.6},"editing":{"shotLength":{"talkingHead":[4,8],"broll":[1.5,3],"socialHook":[0.8,1.5]},"endHold":{"default":0.75,"range":[0.5,1]}},"audio":{"dialoguePeakDb":[-12,-6],"lufs":{"social":-16,"broadcast":-23},"musicUnderDialogueDb":[-24,-18],"duck":{"db":8,"dbRange":[6,10],"attack":0.3,"release":0.6}}};
ZenviLink.CATALOG = {"ae_get_state":{"title":"After Effects state","mutating":false}};
// ---- aeft/00-aeft-core.jsx ----
// Zenvi Link: After Effects host core. The helpers every ae_* tool uses
// (ZenviLink.ae), the undo-group adapter, and ae_get_state.
//
// IDs (SPEC 3.3): items by item.id; layers by layer.id (After Effects 22+)
// plus comp_id + layer_index for convenience. Times are comp seconds.

(function (Z) {
    var AE = {};
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
        if (typeof project.itemByID === "function") {
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
            if (typeof app.project.layerByID !== "function") {
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
