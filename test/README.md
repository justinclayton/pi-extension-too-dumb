# test/ — local end-to-end signal testing (no paid tokens)

Drives the real `too-dumb` extension against a **local Ollama model** so you can
watch it produce signals without spending money. Nothing here ships with the npm
package (`package.json`'s `files` only includes `extensions/` + `README.md`).

## How it works

The context-fill signals divide **token usage** by the model's declared
**context window**. To make them fire on demand we rig those two numbers:

- `test/Modelfile` builds `too-dumb-test` from `llama3.2` with a **large real
  `num_ctx` (16384)** so Ollama never truncates the prompt or under-reports tokens.
- `test/ollama-provider.ts` registers that model with a **tiny declared
  `contextWindow` (4096)** — the denominator for context-fill %. A ~1850-word
  prompt is ~70% (orange); ~2600 words is ~99% (red).
- `test/signal-listener.ts` is a stand-in "consumer" extension. It subscribes to
  `too-dumb:change` on the shared bus and appends every payload to
  `too-dumb-events.log` (and echoes to stderr). This is the README's consumer
  example, made real — and it works in print mode where the banner is a no-op.

## Prerequisites

```bash
ollama serve                         # running on :11434
ollama create too-dumb-test -f test/Modelfile   # one-time
```

## Run

```bash
test/run.sh 1850    # ORANGE (~70%)
test/run.sh 2600    # RED (~99%)
```

You'll see the bus events the listener captured, e.g.:

```
[too-dumb-listener] ORANGE — Context window at 70% — model may be losing early context (ctx=70.2%, tokens=2878)
```

## What this proves (and what it can't)

Proves the full pipeline: `message_end → computeWarning → pi.events.emit →
external extension consumes it`. Confirms display and signal production are
decoupled (the listener receives events even in print mode with no banner).

Limits of a local model (by design — see the main chat rationale):
- **Signal 3 (cache reuse)** can't fire — local OpenAI-compatible models don't
  report `cacheRead`, so `cacheRatio` is always `null`.
- **Signal 4 (absolute 90k/120k tokens)** won't fire against a 4k window.
- **Signal 2 (fill rate)** needs 4+ clean assistant turns; print mode is single-turn.
  For that, drive an interactive session (`pi -e … --model ollama/too-dumb-test`)
  and send several messages.

## Testing the banner + `/too-dumb` toggle (interactive)

Print mode has no UI, so to see the actual banner and exercise the command:

```bash
pi --model ollama/too-dumb-test \
  -e ./extensions/index.ts -e ./test/ollama-provider.ts
```

Paste a large blob to cross 70%, watch the banner appear, then:

```
/too-dumb display off     # banner disappears; the listener would still log events
/too-dumb display on      # banner returns
/too-dumb status          # report current state + active warning
```
