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

## Install

```bash
pi install npm:pi-extension-too-dumb
```

Or project-local:

```bash
pi install -l npm:pi-extension-too-dumb
```
