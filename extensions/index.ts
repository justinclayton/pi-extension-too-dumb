/**
 * too-dumb — session health monitor
 *
 * Watches for signals that suggest the model's reasoning ability may be
 * compromised and surfaces a single warning widget above the editor.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

// ── ANSI color constants ─────────────────────────────────────────────────────

const ORANGE_FG = "\x1b[38;2;255;140;0m"; // #ff8c00
const ORANGE_BG = "\x1b[48;2;26;18;0m";   // #1a1200
const RED_FG    = "\x1b[38;2;204;34;0m";  // #cc2200
const RED_BG    = "\x1b[48;2;26;4;0m";    // #1a0400
const RESET     = "\x1b[0m";

// ── Types ────────────────────────────────────────────────────────────────────

type Severity = "orange" | "red";

interface Warning {
  severity: Severity;
  message: string;
}

// ── Widget rendering ─────────────────────────────────────────────────────────

function buildLines(warning: Warning, width: number): string[] {
  const fg   = warning.severity === "red" ? RED_FG   : ORANGE_FG;
  const bg   = warning.severity === "red" ? RED_BG   : ORANGE_BG;
  const icon = warning.severity === "red" ? "⛔"     : "⚠";

  const renderLine = (text: string): string => {
    const truncated = truncateToWidth(text, width);
    // Pad to full width so the background tint spans the whole line.
    const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
    return `${bg}${fg}${truncated}${pad}${RESET}`;
  };

  return [
    renderLine(`▏ ${icon} ${warning.message}`),
    renderLine(`▏ /compact to summarize or /new to start fresh`),
  ];
}

// ── Signal 1 — Context Window Fill ──────────────────────────────────────────

function computeSignal1(contextPercent: number | null): Warning | null {
  if (contextPercent === null) return null;

  if (contextPercent > 90) {
    return {
      severity: "red",
      message: `Context window at ${Math.round(contextPercent)}% — reasoning is severely impacted`,
    };
  }
  if (contextPercent > 70) {
    return {
      severity: "orange",
      message: `Context window at ${Math.round(contextPercent)}% — model may be losing early context`,
    };
  }
  return null;
}

// ── Signal 2 — Context Fill Rate ────────────────────────────────────────────

function computeSignal2(
  branch: any[],
  contextWindow: number,
  contextPercent: number | null,
): Warning | null {
  // Signal 1 already covers anything >= 70%.
  if (contextPercent !== null && contextPercent >= 70) return null;
  if (contextWindow <= 0) return null;

  // Collect assistant messages (valid usage only), preserving branch index.
  const points: { branchIdx: number; inputPercent: number }[] = [];

  for (let i = 0; i < branch.length; i++) {
    const e = branch[i];
    if (
      e.type === "message" &&
      e.message.role === "assistant"
    ) {
      const msg = e.message as AssistantMessage;
      if (
        msg.usage &&
        msg.stopReason !== "aborted" &&
        msg.stopReason !== "error"
      ) {
        points.push({
          branchIdx: i,
          inputPercent: ((msg.usage.input + msg.usage.cacheRead) / contextWindow) * 100,
        });
      }
    }
  }

  if (points.length < 4) return null;

  const last4 = points.slice(-4);
  const oldestBranchIdx = last4[0]!.branchIdx;

  // Post-compaction guard: skip if a compaction entry exists after the oldest
  // of the last 4 assistant messages.  This means fewer than 4 clean turns of
  // rate data exist post-compaction.
  for (let i = oldestBranchIdx + 1; i < branch.length; i++) {
    if (branch[i].type === "compaction") return null;
  }

  // Average percentage-point gain per turn over the last 4 data points.
  // (last4[3] - last4[0]) / 3  intervals
  const rate = (last4[3]!.inputPercent - last4[0]!.inputPercent) / 3;
  if (rate <= 0) return null; // Not growing — no forward risk.

  const current = last4[3]!.inputPercent;
  const projected = current + rate * 4;

  if (projected >= 70 && current < 70) {
    const turnsUntil = Math.max(1, Math.ceil((70 - current) / rate));
    return {
      severity: "orange",
      message: `Filling at ~${Math.round(rate)}%/turn — context will likely degrade in ~${turnsUntil} turns`,
    };
  }

  return null;
}

// ── Signal 3 — Cache Efficiency ──────────────────────────────────────────────

function computeSignal3(branch: any[]): Warning | null {
  let totalCacheRead = 0;
  let totalInput     = 0;
  let assistantCount = 0;

  for (const e of branch) {
    if (
      e.type === "message" &&
      e.message.role === "assistant"
    ) {
      const msg = e.message as AssistantMessage;
      if (
        msg.usage &&
        msg.stopReason !== "aborted" &&
        msg.stopReason !== "error"
      ) {
        totalCacheRead += msg.usage.cacheRead;
        totalInput     += msg.usage.input;
        assistantCount++;
      }
    }
  }

  // Gates
  if (totalCacheRead <= 10_000) return null;
  if (assistantCount < 5)       return null;

  const ratio = totalCacheRead / (totalCacheRead + totalInput);
  const pct   = Math.round(ratio * 100);

  if (ratio < 0.10) {
    return {
      severity: "red",
      message: `Very low cache reuse (${pct}%) — context flooding likely`,
    };
  }
  if (ratio < 0.30) {
    return {
      severity: "orange",
      message: `Low cache reuse (${pct}%) — tool outputs may be flooding context`,
    };
  }

  return null;
}

// ── Priority selection ───────────────────────────────────────────────────────
//
// Priority order (highest first):
//   1. 🔴 Signal 1: context% > 90
//   2. 🔴 Signal 3: cache ratio < 0.10
//   3. 🟠 Signal 1: context% > 70
//   4. 🟠 Signal 2: fill rate projection
//   5. 🟠 Signal 3: cache ratio < 0.30

function computeWarning(
  contextPercent: number | null,
  branch: any[],
  contextWindow: number,
): Warning | null {
  const s1 = computeSignal1(contextPercent);
  if (s1?.severity === "red") return s1;

  const s3 = computeSignal3(branch);
  if (s3?.severity === "red") return s3;

  if (s1?.severity === "orange") return s1;

  const s2 = computeSignal2(branch, contextWindow, contextPercent);
  if (s2) return s2;

  if (s3?.severity === "orange") return s3;

  return null;
}

// ── Extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Track the last rendered warning to avoid redundant setWidget calls.
  let lastKey: string | null | undefined ; // undefined = never computed

  function warningKey(w: Warning | null): string | null {
    return w ? `${w.severity}:${w.message}` : null;
  }

  pi.on("session_start", async (_event, ctx) => {
    lastKey = undefined;
    ctx.ui.setWidget("too-dumb", undefined);
  });

  pi.on("message_end", async (_event, ctx) => {
    const contextUsage  = ctx.getContextUsage();
    const contextPercent = contextUsage?.percent ?? null;
    const contextWindow  =
      contextUsage?.contextWindow ??
      ctx.model?.contextWindow ??
      128_000;

    const branch  = ctx.sessionManager.getBranch();
    const warning = computeWarning(contextPercent, branch, contextWindow);
    const key     = warningKey(warning);

    if (key === lastKey) return; // No change — skip re-render.
    lastKey = key;

    if (warning) {
      // Capture `warning` value for the render closure.
      const w = warning;
      ctx.ui.setWidget("too-dumb", (_tui, _theme) => ({
        render(width: number): string[] {
          return buildLines(w, width);
        },
        invalidate() {},
      }));
    } else {
      ctx.ui.setWidget("too-dumb", undefined);
    }
  });
}
