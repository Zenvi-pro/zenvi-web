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
        if (P.trim(source).length === 0) {
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
