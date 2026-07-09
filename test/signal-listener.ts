/**
 * TEST-ONLY extension. Subscribes to the too-dumb signal bus and records every
 * change to test/too-dumb-events.log (JSON lines), and echoes to stderr.
 *
 * This is the "other extension" from the README's consumer example — it proves
 * too-dumb produces signals on the bus that anyone can consume, and it works in
 * print mode (`-p`) where the banner/toast UI are no-ops.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync } from "node:fs";
import { join } from "node:path";

const LOG = join(import.meta.dirname ?? __dirname, "too-dumb-events.log");

export default function (pi: ExtensionAPI) {
  pi.events.on("too-dumb:change", (data) => {
    const payload = data as {
      warning: { severity: "orange" | "red"; message: string } | null;
      metrics: {
        contextPercent: number | null;
        tokens: number | null;
        contextWindow: number;
        cacheRatio: number | null;
        fillRatePerTurn: number | null;
      };
    };

    appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...payload }) + "\n");

    const w = payload.warning;
    const status = w
      ? `${w.severity.toUpperCase()} — ${w.message}`
      : "clear";
    process.stderr.write(
      `[too-dumb-listener] ${status} ` +
        `(ctx=${payload.metrics.contextPercent}%, tokens=${payload.metrics.tokens})\n`,
    );
  });
}
