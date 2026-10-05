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
