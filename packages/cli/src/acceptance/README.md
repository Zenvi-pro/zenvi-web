# MCP acceptance gate

Drives Zenvi only through MCP, the way agents do, and reports a tool-call success rate.

```
npm run acceptance                                  # every scenario on zenvi mcp (stdio)
npm run acceptance -- --scenario basic              # one scenario (the CI gate: < 60 s, offline)
npm run acceptance -- --runner all                  # also the headless desktop, when one is advertised
npm run acceptance -- --out /tmp/acc                # report.json, report.md, media/ (exports, sheets)
npm run acceptance -- replay                        # re-run the Zenvi calls in ~/zenvi-motion/bench/runs/*/*/transcript.jsonl
npm run acceptance -- replay --only fullcircle --skip-tools ''   # one benchmark, renders included
```

The basic scenario also runs in `npm test` (`acceptance.test.ts`).

## Runners

- **portable**: `zenvi mcp` from source through tsx (or `--bundle plugins/zenvi/dist/zenvi.mjs`). It gets a temp HOME and a temp working folder. The real cache folder is kept, so Chrome, Blender scene caches and matte models are found.
- **desktop**: the server that zenvi-core's `src/launch.py --headless` advertises in `~/.openshot_qt/headless_mcp.json` (bearer token from its `token_file`). When none is running, every scenario is skipped with that reason. Start it signed in, from a zenvi-core checkout:
  `ZENVI_DEPS=~/zenvi-deps-1.0 PYTHONPATH=~/zenvi-deps-1.0/python QT_QPA_PLATFORM=offscreen .venv/bin/python src/launch.py --headless`

## Scenarios (`scenarios/*.json`, validated by `scenario.ts`)

Each step calls one tool and asserts its receipt. `expect.status` defaults to `applied`. `expect.receipt` maps paths to `{min,max}`, `{length:{…}}`, `{matches}`, `{equals}` or `{exists}`. `expect.image` asks for an image. Checks then look at the result:

- `tool`: a read tool's answer.
- `media`: an export's duration, streams, integrated loudness, and a frame that is not black.
- `image`: the returned image is not black.

Arguments reference earlier results: `${fixtures.a}`, `${work}`, `${import.data.fileIds[0]}`, `${import.ids[0]}` (ids named in the summary).

A step is **skipped**, not failed, when any of these holds:
- the host does not list its tool;
- its refusal matches `skipWhen` (the host lacks Chrome, Blender, a sign-in…);
- it needs a step (`${ref}` or `after`) that did not succeed.

`on.desktop` swaps in the desktop's tool names and arguments. Fixtures are generated with ffmpeg lavfi sources, or the OS voice (`say`) for speech.

## Replay

Ids are paired between the original receipts and the replay's. Network tools are skipped. `import_stock_media_tool` imports the file the session downloaded. Calls that need an id the replay never produced are skipped as dependent. Failures are grouped by their generalised message, with proposals (`PROPOSALS` in `replay.ts`). `--from replay.json` ranks them again without replaying.
