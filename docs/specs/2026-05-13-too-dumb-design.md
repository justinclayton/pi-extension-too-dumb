# too-dumb — Pi Extension Design

**Date:** 2026-05-13
**Status:** Approved

---

## Overview

A pi extension that monitors session health signals and surfaces a single warning widget above the editor when the model's reasoning ability is likely to be compromised. The widget is completely absent during normal operation. When a threshold is crossed, a bordered block appears above the editor with a short message naming the triggered signal — educating the user while warning them.

The implied action for every warning is always `/compact or /new`. No footer or header changes are made.

---

## Target User

Normal pi users who don't want to reason about token metrics themselves. The extension should be invisible until it matters, then clear and actionable.

---

## Widget Appearance

Style: left-bordered block with subtle background tint. Two severity levels.

**Orange (warning):**
```
▏ ⚠ <message>
▏ /compact to summarize or /new to start fresh
```
Border and text: `#ff8c00`. Background: `#1a1200`.

**Red (danger):**
```
▏ ⛔ <message>
▏ /compact to summarize or /new to start fresh
```
Border and text: `#cc2200`. Background: `#1a0400`.

The widget is placed above the editor using `ctx.ui.setWidget("too-dumb", lines)`. When no signal is active, the widget is cleared with `ctx.ui.setWidget("too-dumb", undefined)`.

---

## Signals

### Signal 1 — Context Window Fill

The most direct measure of reasoning degradation. As the context window fills, the model loses access to earlier content. Pi's own footer uses these same thresholds for its warning/error coloring.

| Level | Threshold | Message |
|---|---|---|
| 🟠 Orange | `context% > 70` | `Context window at X% — model may be losing early context` |
| 🔴 Red | `context% > 90` | `Context window at X% — reasoning is severely impacted` |

**Data source:** `ctx.getContextUsage()` → `percent`. If `contextUsage` is null (no model, or immediately post-compaction before a fresh response), skip this signal.

---

### Signal 2 — Context Fill Rate

An early warning that fires *before* Signal 1, based on the rate of context growth over recent turns. Gives the user time to act before degradation sets in.

| Level | Threshold | Message |
|---|---|---|
| 🟠 Orange only | Projected to cross 70% within 4 turns, while currently < 70% | `Filling at ~X%/turn — context will likely degrade in ~N turns` |

**Computation:**
1. Requires at least 4 assistant messages in the branch.
2. Walk `ctx.sessionManager.getBranch()` to collect each assistant message's cumulative input tokens. Reconstruct context% at each turn as `cumulativeInput / contextWindow`.
3. Take the last 4 data points. Compute average percentage-point gain per turn.
4. Project: `currentPercent + (rate × 4)`. If `>= 70` and `currentPercent < 70`, fire orange.

**Post-compaction guard:** Walk the branch for a `compaction` entry after the oldest of the last 4 assistant messages. If one exists, skip Signal 2 until 4 full post-compaction turns have accumulated (rate data would be artificially low due to the context reset).

No red variant — if context% is already past 70%, Signal 1 takes over.

---

### Signal 3 — Cache Efficiency

Measures what fraction of the model's total input was served from cache. In a healthy session this should climb above 0.5 after a few turns, as the cached system prompt, tool definitions, and stable history dominate each request. A low ratio means large or volatile tool outputs are flooding the context with uncached content — degrading focus and accelerating fill rate.

| Level | Threshold | Message |
|---|---|---|
| 🟠 Orange | `R / (R + ↑) < 0.30` | `Low cache reuse (X%) — tool outputs may be flooding context` |
| 🔴 Red | `R / (R + ↑) < 0.10` | `Very low cache reuse (X%) — context flooding likely` |

**Gates (skip signal entirely if any fail):**
- Cumulative `cacheRead > 10_000` tokens (confirms caching is meaningfully active; avoids false positives on providers that don't support caching or in the first 1–2 turns before cache is populated)
- At least 5 assistant messages in the branch

**Computation:** Walk `getBranch()`, sum `cacheRead` (R) and `input` (↑) across all assistant messages. Compute `R / (R + input)`.

---

## Signal Priority

A single pure function `computeWarning(signals)` evaluates all signals and returns the highest-priority active one, or `null`. Evaluated in order:

1. 🔴 Signal 1: `context% > 90`
2. 🔴 Signal 3: `R/(R+↑) < 0.10`
3. 🟠 Signal 1: `context% > 70`
4. 🟠 Signal 2: fill rate projection
5. 🟠 Signal 3: `R/(R+↑) < 0.30`

The widget always shows exactly one message — the worst active signal.

---

## Extension Lifecycle

**`session_start`:** Clear the widget. Fresh session = fresh slate.

**`message_end`:** Recompute all signals. Call `computeWarning()`. If result changed from previous state, update widget via `setWidget`. Cache previous result to avoid unnecessary re-renders.

No other lifecycle hooks needed.

---

## File Structure

```
~/.pi/agent/extensions/too-dumb/
  index.ts
```

Or project-local:
```
.pi/extensions/too-dumb/
  index.ts
```

Single file. No dependencies beyond `@earendil-works/pi-coding-agent`.

---

## Widget Rendering

The widget is rendered using `ctx.ui.setWidget`, which accepts a string array (one string per line). Lines are plain strings with ANSI color codes applied via `theme.fg()` — but since orange (`#ff8c00`) and red (`#cc2200`) are specific hex values not in the theme palette, they are applied with raw ANSI escape sequences.

The bordered block is constructed as fixed-width text lines:

```
  ▏ ⚠ <message text>
  ▏ /compact to summarize or /new to start fresh
```

The left-border character `▏` is colored orange/red. The background tint is applied as a full-line background color using ANSI SGR codes. Lines are truncated to terminal width using `truncateToWidth` from `@earendil-works/pi-tui`.

---

## Out of Scope

- No footer changes
- No header changes
- No slash commands
- No user-configurable thresholds
- No output/input ratio signal (too noisy with cumulative data)
- No thinking level signal (user intent; too many false positives)
