# pi-extension-too-dumb

A [pi coding agent](https://pi.dev) extension that warns when the model's reasoning ability is likely to be compromised.

AKA when it's getting too dumb, and you should bail.

It does this mainly by displaying a banner that says "YOU ARE IN THE DUMB ZONE". 

When you get this banner, it's probably time to `/compact` or `/new`.

## Signals

| Signal | Orange | Red |
|---|---|---|
| **Context window fill** | > 70% | > 90% |
| **Context fill rate** | On pace to hit 70% in ~4 turns | — |
| **Cache efficiency** | Reuse < 30% | Reuse < 10% |
| **1M context window reasoning threshold** | 90k | 120k |

## Controlling the display

The banner and toasts can be toggled per session with the `/too-dumb` command:

```
/too-dumb display off   # hide banner + toasts (signals still emit on the bus)
/too-dumb display on    # show them again
/too-dumb               # or: /too-dumb status — report current state + warning
```

Turning the display off never stops signal production — it only stops too-dumb
from drawing its own UI. This is what you want if another extension or theme is
rendering the dumbness signal natively.

## Consuming the signal from another extension

too-dumb broadcasts its signal on pi's shared event bus so other extensions and
themes can react to it and render it however they like. This happens
**independently of the banner** — the event fires even when the banner is turned
off with `/too-dumb display off`.

**The event is called `too-dumb:change`.**

To consume it, call `pi.events.on("too-dumb:change", handler)` in your own
extension. Your handler receives one argument — the payload described below:

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  // "too-dumb:change" is the event name. The handler runs every time the
  // warning changes (including when it clears).
  pi.events.on("too-dumb:change", (data) => {
    const { warning, metrics } = data as TooDumbChange;

    if (warning === null) {
      // All clear — hide whatever you were showing.
      return;
    }

    // warning.severity is "orange" or "red"; warning.message is human-readable.
    // Render it in your own status bar / widget / theme however you want:
    myStatusBar.set(`⚠ ${warning.message}`, warning.severity);

    // metrics carries the raw numbers if you'd rather build your own UI:
    //   metrics.contextPercent, metrics.tokens, metrics.cacheRatio, …
  });
}

// The payload shape emitted on "too-dumb:change":
type TooDumbChange = {
  warning:
    | { severity: "orange" | "red"; message: string }
    | null; // null = no active warning ("all clear")
  metrics: {
    contextPercent: number | null;   // 0..100 context-window fill
    tokens: number | null;           // absolute token count
    contextWindow: number;           // window size used for the math
    cacheRatio: number | null;       // 0..1 cache reuse, or null when no data
    fillRatePerTurn: number | null;  // %-points/turn growth, or null
  };
};
```

If you have too-dumb installed as a dependency you can import the name constant
and types instead of hand-writing them:

```typescript
import { TOO_DUMB_EVENT, type TooDumbChange } from "pi-extension-too-dumb";
// TOO_DUMB_EVENT === "too-dumb:change"
pi.events.on(TOO_DUMB_EVENT, (data) => {
  const payload = data as TooDumbChange;
  // …
});
```

### Reference

- **Event name:** `too-dumb:change` (exported as the constant `TOO_DUMB_EVENT`).
- **Subscribe with:** `pi.events.on("too-dumb:change", (data) => …)`.
- **Payload:** `TooDumbChange` — `{ warning, metrics }` (shape above).
- **When it fires:** only when the warning changes, including transitions back to
  `null`. Treat it as edge-triggered — no event means no change.
- **Always emitted:** fires regardless of the `/too-dumb display` setting, so
  consumers work even when too-dumb's own banner is hidden.

## Install

```bash
pi install npm:pi-extension-too-dumb
```

Or project-local:

```bash
pi install -l npm:pi-extension-too-dumb
```
