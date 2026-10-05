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
