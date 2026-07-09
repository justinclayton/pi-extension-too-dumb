# AGENTS.md

Orientation for agents working on **pi-extension-too-dumb**. Read this first to
avoid reverse-engineering the codebase.

## What this is

A single [pi coding agent](https://pi.dev) extension that watches a session for
signs the model's reasoning is degrading (context bloat, poor cache reuse) and:

1. **Emits a signal** on pi's shared event bus (`too-dumb:change`) — always, for
   other extensions/themes to consume.
2. **Optionally draws a banner + toasts** ("GETTING DUMBER" / "YOU ARE IN THE
   DUMB ZONE") — toggleable per session.

Distributed as an npm pi-package. Installed with `pi install npm:pi-extension-too-dumb`.

## Layout

```
extensions/index.ts   ← the entire extension (one file, no build step)
package.json          ← pi-package manifest; peerDeps on pi runtime packages
README.md             ← user-facing docs (install, signals, command, event API)
Makefile              ← release helpers (npm version + publish); no build/test
test/                 ← local end-to-end harness (Ollama; not published)
```

There is **no build, no bundler, no test suite, and no `node_modules`**. pi loads
the `.ts` directly via [jiti](https://github.com/unjs/jiti), so TypeScript runs
uncompiled. The `@earendil-works/*` imports are peer dependencies resolved by the
pi runtime at load time — they are not installed locally.

## Core architecture: compute → emit → render (one-way flow)

Everything hangs off the `message_end` event handler in `index.ts`. The critical
design rule: **signal computation is decoupled from display.**

```
message_end
   │
   ├─ gatherBranchStats(branch, contextWindow)   single pass over branch entries
   │     → { points[], totalCacheRead, totalInput, assistantCount }
   ├─ computeFillRate(stats, branch)             → { rate, current } | null
   ├─ computeCacheRatio(stats)                   → 0..1 | null
   │
   ├─ computeWarning(...)                        pure; picks highest-priority signal
   │
   ├─ if warning key changed:
   │     ├─ pi.events.emit("too-dumb:change", { warning, metrics })   ALWAYS
   │     └─ if displayEnabled: setWidget(banner) + one-time notify(toast)
   │        else:              setWidget(undefined)
```

`displayEnabled` gates **only** the banner and toasts. The bus event fires
regardless — that is the whole point of the architecture (let other extensions
render the signal in their own themes). Do not add display checks around the
`emit` call.

### Change-detection

`lastKey` holds a string key of the last warning (`severity:message`), or `null`
(computed, no warning), or `undefined` (never computed). If the new key equals
`lastKey`, the handler returns early — so the bus event is **edge-triggered**
(fires only on change, including transitions back to `null`).

## Signals (in `index.ts`)

Four detectors, each returning `Warning | null` with severity `"orange"|"red"`.
Priority is resolved in `computeWarning` (reds first, then oranges):

| Fn | Signal | Orange | Red |
|---|---|---|---|
| `computeSignal1` | Context window fill % | > 70 | > 90 |
| `computeSignal2` | Fill rate projection (hits 70% in ~4 turns) | yes | — |
| `computeSignal3` | Cache reuse ratio | < 0.30 | < 0.10 |
| `computeSignal4` | Absolute token count | > 90k | > 120k |

Signal 2 & 3 both derive from `gatherBranchStats` output (assistant messages with
valid usage — `stopReason` not `aborted`/`error`). Signal 2 has a
**post-compaction guard**: it ignores fill-rate data if a `compaction` entry
exists after the oldest of the last 4 assistant messages (fewer than 4 clean
post-compaction turns).

Priority order (highest first) is documented in the comment above
`computeWarning` — keep it in sync if you change the ordering.

## Public contract (do not break casually)

These are exported from `index.ts` and consumed by other extensions:

- `TOO_DUMB_EVENT` = `"too-dumb:change"` — the bus channel.
- `TooDumbChange` = `{ warning: Warning | null, metrics: Metrics }` — payload.
- `Warning`, `Severity`, `Metrics` types.

`Metrics` = `{ contextPercent, tokens, contextWindow, cacheRatio, fillRatePerTurn }`
(each nullable except `contextWindow`). Adding fields is safe; renaming/removing
is a breaking change for consumers.

## The `/too-dumb` command

Registered via `pi.registerCommand("too-dumb", …)`. Subcommands:

- `/too-dumb display off` → `displayEnabled = false`, clears widget.
- `/too-dumb display on`  → `displayEnabled = true`, re-renders current warning.
- `/too-dumb` or `/too-dumb status` → notifies current state + active warning.

`displayEnabled` is **per-process, in-memory**, defaults `true`, and intentionally
**persists across sessions** (`session_start` resets warning state but not the
toggle). There is no config file or CLI flag — slash command only, by design.

## State (module-scoped in the extension factory)

| Var | Purpose | Reset on |
|---|---|---|
| `displayEnabled` | banner/toast toggle | never (process lifetime) |
| `lastKey` | change detection | `session_start` (→ undefined) |
| `currentWarning` | last computed warning, for re-render on toggle | `session_start` (→ null) |
| `notifiedSeverities` | which severities have toasted (one-shot) | `session_start` |

## Conventions & gotchas

- `branch` entries are typed `any[]` (session entry shape is not re-modeled here).
  Guard with `e.type === "message" && e.message.role === "assistant"` and check
  `msg.usage` + `stopReason` before trusting usage numbers.
- Banner rendering uses raw ANSI truecolor escapes (constants at top of file) and
  `visibleWidth` from `@earendil-works/pi-tui` for correct centering.
- `renderWidget(ctx)` is the single place that sets/clears the widget — reuse it
  rather than calling `ctx.ui.setWidget` ad hoc, so toggle + message_end stay
  consistent.
- Keep signal detectors **pure** (no `ctx`/UI access). Side effects live only in
  the `message_end` handler and the command handler.

## Verifying changes (no unit-test suite)

There's a local **end-to-end harness** under `test/` that runs the real
extension against a free local Ollama model — no paid tokens. See
`test/README.md`. Quick version:

```bash
ollama serve
ollama create too-dumb-test -f test/Modelfile   # one-time
test/run.sh 1850     # ORANGE (~70%)
test/run.sh 2600     # RED   (~99%)
```

It rigs a tiny declared `contextWindow` (4096, in `test/ollama-provider.ts`)
over a large real `num_ctx` (16384, in `test/Modelfile`) so context-fill signals
fire on a modest prompt. `test/signal-listener.ts` subscribes to
`too-dumb:change` and logs every payload — proving signal production is
decoupled from display (it fires even in print mode with no banner).

Local-model limits: Signal 3 (cache) and Signal 4 (90k+ tokens) can't fire
(no `cacheRead`; small window), and Signal 2 (fill rate) needs an interactive
multi-turn session. See `test/README.md` for the interactive banner + `/too-dumb`
toggle recipe.

Type-check the shipped extension against installed pi types (paths point at the
globally installed pi package; adjust the version dir):

```bash
PIROOT=$(dirname $(dirname $(readlink -f $(which pi))))/lib/node_modules
pi -e ./extensions/index.ts   # or just load it and exercise manually
```

## Release

`make patch` / `make minor` / `make major` bump the version, push tags, and
`npm publish --access public`. `make dry-run` previews the published tarball
(only `extensions/` and `README.md` ship — see `files` in `package.json`).
