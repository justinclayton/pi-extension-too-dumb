# pi-extension-too-dumb

A [pi coding agent](https://pi.dev) extension that monitors session health and warns when the model's reasoning ability is likely to be compromised.

Instead of displaying raw token metrics for the user to interpret, this extension stays completely silent during normal operation. When a meaningful threshold is crossed, a single warning widget appears above the editor naming the triggered signal — educating as it warns.

The implied action for every warning is always `/compact or /new`.

## Signals

| Signal | Orange | Red |
|---|---|---|
| **Context window fill** | > 70% | > 90% |
| **Context fill rate** | On pace to hit 70% in ~4 turns | — |
| **Cache efficiency** | Reuse < 30% | Reuse < 10% |

## Install

```bash
pi install git:github.com/justinclayton/pi-extension-too-dumb
```

Or project-local:

```bash
pi install -l git:github.com/justinclayton/pi-extension-too-dumb
```
