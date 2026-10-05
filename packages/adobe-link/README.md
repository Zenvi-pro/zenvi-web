# @zenvi/adobe-link — Zenvi Link

Zenvi Link is a CEP extension (`pro.zenvi.link`) for After Effects and Premiere
Pro. Inside each app it runs a loopback MCP server so Zenvi (the desktop app and
`zenvi mcp`) can drive the app with `ae_*` / `premiere_*` tools. This package
holds the tool catalog (TypeScript, shared with the CLI), the ExtendScript tool
implementations, the extension itself, and a test harness that runs the
ExtendScript under Node against mock Adobe DOMs.

Contracts: `SPEC.md` §3.1–3.4 of the Zenvi handoff effort (discovery files, host
protocol, receipts, catalogs). Defaults: `src/taste.ts` (TASTE.md as data).

## Layout

```
src/catalog/        HostToolDef catalogs (zod) + shared schema blocks; JSON via gen:catalog
src/taste.ts        TASTE defaults (also injected into the host scripts as ZenviLink.TASTE)
src/host-bundle.ts  concatenates the host scripts exactly as the build does
src/testing/        loadHostScript (ES3 vm realm), createAeMock, createPremiereMock, checkEs3
extension/catalog/  generated catalog JSON (committed; a test fails when stale)
extension/host/     ExtendScript: common/* (json2, polyfills, ZenviLink runtime), aeft/*, ppro/*
```

## Adding a host tool

1. **Define it** in `src/catalog/aftereffects.ts` (or `premiere.ts`) with
   `defineHostTool({...})` and add it to `AE_TOOLS` / `PREMIERE_TOOLS`. Input is
   a `z.strictObject` with `.describe()` on every field; reuse `seconds`,
   `easing`, `color`, `layerRef`, `trackRef`, `absolutePath`, `placement` from
   `src/catalog/types.ts` and take defaults from `TASTE`. `readOnlyHint: false`
   makes dispatch wrap the call in one After Effects undo group. Set
   `returnsImage` / `timeoutMs` when needed.
2. **Regenerate** `npm run gen:catalog -w @zenvi/adobe-link` and commit
   `extension/catalog/*.json`.
3. **Implement it** in `extension/host/aeft/NN-<area>.jsx` (or `ppro/`): ES3 and
   ASCII only, `(function (Z) { Z.register("ae_x", function (args, ctx) { … }); }(ZenviLink));`.
   Title and mutating-ness come from the catalog.
4. **Inside the tool**: validate first — `Z.required` / `Z.optional(args, key,
   type, TASTE fallback)` / `Z.oneOf` / `Z.inRange`, `Z.ae.findComp` /
   `findLayer` / `findItem`, `Z.ppro.findSequence` / `findTrack` /
   `findProjectItemByNodeId` (they throw refusals). Then `ctx.changed()` right
   before the first mutation, mutate, `ctx.warn()` for snapping or fallbacks,
   and return `Z.ok(summary, data)` (read-only), `Z.applied(summary, data[,
   undoSteps])` or `Z.unchanged(summary, data)`. Refuse with
   `throw Z.refuse(code, message)`, fail with `throw Z.fail(code, message)`.
   Never call `app.beginUndoGroup` yourself. Snap times with
   `Z.ae.snapTime(comp, t, ctx, label)` / `Z.ppro.snapTime(seq, t, ctx, label)`.
   Frame captures write a PNG and return `data.image_path`.
5. **Test it** in `src/host/<area>.test.ts`: `const mock = createAeMock()`,
   `const host = loadHostScript("aeft", mock.globals)`,
   `host.dispatch("ae_x", args)`, then assert the receipt and the mock
   (`mock.state.undoGroups`, `layer.scale.key(1)`, …). Grow the mocks in
   `src/testing/*-mock.ts` with the real DOM names. Catalog parity, ES3 syntax
   and ASCII checks pick new files up automatically.
6. **Check**: `npx vitest run --project adobe-link`, `npx eslint packages/adobe-link`,
   `npm run typecheck -w @zenvi/adobe-link`.

The test realm is ECMAScript 3 like ExtendScript: `[].map`, `forEach`,
`Object.assign`, `"".startsWith` and friends do not exist there (or in the
apps). Use `Z.each` / `Z.map` / `Z.filter`, `indexOf` and `trim` (polyfilled),
and bracket access for reserved words (`TASTE.timing.audioFade["in"]`).
