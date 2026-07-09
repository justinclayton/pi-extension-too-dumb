/**
 * too-dumb — session health monitor
 *
 * Watches for signals that suggest the model's reasoning ability may be
 * compromised.
 *
 * Architecture (one-way flow):
 *
 *   message_end
 *      │
 *      ├─ gatherBranchStats() + computeWarning()   (pure, no side effects)
 *      │
 *      ├─ pi.events.emit("too-dumb:change", …)      ALWAYS on change
 *      │     → other extensions/themes consume this to render natively
 *      │
 *      └─ if display enabled: banner widget + one-time toast
 *         else:               no widget, no toast
 *
 * Display is a downstream *consumer* of the same signal emitted on the bus.
 * Turning display off (via `/too-dumb display off`) never suppresses the bus
 * event — it only stops too-dumb from drawing its own banner and toasts.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { visibleWidth } from "@earendil-works/pi-tui";

// ── ANSI color constants ─────────────────────────────────────────────────────

const ORANGE_FG = "\x1b[38;2;255;140;0m"; // #ff8c00
const ORANGE_BG = "\x1b[48;2;26;18;0m";   // #1a1200
const RED_FG    = "\x1b[38;2;204;34;0m";  // #cc2200
const RED_BG    = "\x1b[48;2;26;4;0m";    // #1a0400
const RESET     = "\x1b[0m";

// ── Event bus contract ───────────────────────────────────────────────────────
//
// Emitted on `pi.events` whenever the computed warning changes. Consuming
// extensions can `pi.events.on(TOO_DUMB_EVENT, (payload: TooDumbChange) => …)`
// to integrate the dumbness signal into their own themes / widgets.

export const TOO_DUMB_EVENT = "too-dumb:change";

// ── Types ────────────────────────────────────────────────────────────────────

export type Severity = "orange" | "red";

export interface Warning {
  severity: Severity;
  message: string;
}

/** Raw metrics behind the warning, surfaced so consumers can render their own UI. */
export interface Metrics {
  /** Context window fill, 0–100, or null when unknown. */
  contextPercent: number | null;
  /** Absolute token count, or null when unknown. */
  tokens: number | null;
  /** Effective context window size used for the calculations. */
  contextWindow: number;
  /** cacheRead / (cacheRead + input) across the branch, or null when no data. */
  cacheRatio: number | null;
  /** Recent percentage-point context growth per turn, or null when insufficient data. */
  fillRatePerTurn: number | null;
}

export interface TooDumbChange {
  warning: Warning | null;
  metrics: Metrics;
}

// ── Widget rendering ─────────────────────────────────────────────────────────

function buildBanner(warning: Warning, width: number): string[] {
  const fg   = warning.severity === "red" ? RED_FG   : ORANGE_FG;
  const bg   = warning.severity === "red" ? RED_BG   : ORANGE_BG;
  const text = warning.severity === "red"
    ? " YOU ARE IN THE DUMB ZONE "
    : " GETTING DUMBER ";

  const textLen = visibleWidth(text);
  const fillTotal = Math.max(0, width - textLen);
  const leftFill  = Math.floor(fillTotal / 2);
  const rightFill = fillTotal - leftFill;

  const line = "=".repeat(leftFill) + text + "=".repeat(rightFill);
  return [`${bg}${fg}${line}${RESET}`];
}

// ── Branch statistics (single pass) ──────────────────────────────────────────

interface BranchStats {
  /** Per-assistant-message context fill points (only when contextWindow > 0). */
  points: { branchIdx: number; inputPercent: number }[];
  totalCacheRead: number;
  totalInput: number;
  assistantCount: number;
}

function gatherBranchStats(branch: any[], contextWindow: number): BranchStats {
  const points: BranchStats["points"] = [];
  let totalCacheRead = 0;
  let totalInput     = 0;
  let assistantCount = 0;

  for (let i = 0; i < branch.length; i++) {
    const e = branch[i];
    if (e.type !== "message" || e.message.role !== "assistant") continue;

    const msg = e.message as AssistantMessage;
    if (!msg.usage || msg.stopReason === "aborted" || msg.stopReason === "error") {
      continue;
    }

    totalCacheRead += msg.usage.cacheRead;
    totalInput     += msg.usage.input;
    assistantCount++;

    if (contextWindow > 0) {
      points.push({
        branchIdx: i,
        inputPercent: ((msg.usage.input + msg.usage.cacheRead) / contextWindow) * 100,
      });
    }
  }

  return { points, totalCacheRead, totalInput, assistantCount };
}

/** Recent fill rate over the last 4 clean turns, guarded against post-compaction noise. */
function computeFillRate(
  stats: BranchStats,
  branch: any[],
): { rate: number; current: number } | null {
  const { points } = stats;
  if (points.length < 4) return null;

  const last4 = points.slice(-4);
  const oldestBranchIdx = last4[0]!.branchIdx;

  // Post-compaction guard: if a compaction exists after the oldest of the last
  // 4 assistant messages, fewer than 4 clean post-compaction turns exist.
  for (let i = oldestBranchIdx + 1; i < branch.length; i++) {
    if (branch[i].type === "compaction") return null;
  }

  // Average percentage-point gain per turn over the last 4 points (3 intervals).
  const rate = (last4[3]!.inputPercent - last4[0]!.inputPercent) / 3;
  return { rate, current: last4[3]!.inputPercent };
}

function computeCacheRatio(stats: BranchStats): number | null {
  const denom = stats.totalCacheRead + stats.totalInput;
  return denom > 0 ? stats.totalCacheRead / denom : null;
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
  fill: { rate: number; current: number } | null,
  contextPercent: number | null,
): Warning | null {
  // Signal 1 already covers anything >= 70%.
  if (contextPercent !== null && contextPercent >= 70) return null;
  if (!fill) return null;

  const { rate, current } = fill;
  if (rate <= 0) return null; // Not growing — no forward risk.

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

// ── Signal 4 — Absolute Token Count ─────────────────────────────────────────

function computeSignal4(tokens: number | null): Warning | null {
  if (tokens === null) return null;

  if (tokens > 120_000) {
    return {
      severity: "red",
      message: `Token count at ${Math.round(tokens / 1000)}k — deep in the dumb zone`,
    };
  }
  if (tokens > 90_000) {
    return {
      severity: "orange",
      message: `Token count at ${Math.round(tokens / 1000)}k — reasoning quality declining`,
    };
  }
  return null;
}

// ── Signal 3 — Cache Efficiency ──────────────────────────────────────────────

function computeSignal3(stats: BranchStats, cacheRatio: number | null): Warning | null {
  // Gates
  if (stats.totalCacheRead <= 10_000) return null;
  if (stats.assistantCount < 5)       return null;
  if (cacheRatio === null)            return null;

  const pct = Math.round(cacheRatio * 100);

  if (cacheRatio < 0.10) {
    return {
      severity: "red",
      message: `Very low cache reuse (${pct}%) — context flooding likely`,
    };
  }
  if (cacheRatio < 0.30) {
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
//   2. 🔴 Signal 4: tokens > 120k
//   3. 🔴 Signal 3: cache ratio < 0.10
//   4. 🟠 Signal 4: tokens > 90k
//   5. 🟠 Signal 1: context% > 70
//   6. 🟠 Signal 2: fill rate projection
//   7. 🟠 Signal 3: cache ratio < 0.30

function computeWarning(
  contextPercent: number | null,
  tokens: number | null,
  stats: BranchStats,
  fill: { rate: number; current: number } | null,
  cacheRatio: number | null,
): Warning | null {
  const s1 = computeSignal1(contextPercent);
  if (s1?.severity === "red") return s1;

  const s4 = computeSignal4(tokens);
  if (s4?.severity === "red") return s4;

  const s3 = computeSignal3(stats, cacheRatio);
  if (s3?.severity === "red") return s3;

  if (s4?.severity === "orange") return s4;
  if (s1?.severity === "orange") return s1;

  const s2 = computeSignal2(fill, contextPercent);
  if (s2) return s2;

  if (s3?.severity === "orange") return s3;

  return null;
}

// ── Extension entry point ────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
  // Display toggle — per-process, controlled via `/too-dumb display on|off`.
  // Off suppresses the banner and toasts only; the bus event still fires.
  let displayEnabled = true;

  // Last rendered/emitted warning key, to avoid redundant work.
  //   undefined = never computed, null = computed-but-no-warning
  let lastKey: string | null | undefined;

  // The most recently computed warning, so the toggle can re-render on demand.
  let currentWarning: Warning | null = null;

  // Which severity levels have already shown a toast this session.
  const notifiedSeverities = new Set<Severity>();

  function warningKey(w: Warning | null): string | null {
    return w ? `${w.severity}:${w.message}` : null;
  }

  // Set or clear the banner widget based on current display state + warning.
  function renderWidget(ctx: ExtensionContext) {
    if (displayEnabled && currentWarning) {
      const w = currentWarning;
      ctx.ui.setWidget("too-dumb", (_tui, _theme) => ({
        render(width: number): string[] {
          return buildBanner(w, width);
        },
        invalidate() {},
      }));
    } else {
      ctx.ui.setWidget("too-dumb", undefined);
    }
  }

  pi.on("session_start", async (_event, ctx) => {
    lastKey = undefined;
    currentWarning = null;
    notifiedSeverities.clear();
    // NB: displayEnabled intentionally persists across sessions in-process.
    ctx.ui.setWidget("too-dumb", undefined);
  });

  pi.on("message_end", async (_event, ctx) => {
    const contextUsage   = ctx.getContextUsage();
    const contextPercent = contextUsage?.percent ?? null;
    const tokens         = contextUsage?.tokens ?? null;
    const contextWindow  =
      contextUsage?.contextWindow ??
      ctx.model?.contextWindow ??
      128_000;

    const branch    = ctx.sessionManager.getBranch();
    const stats     = gatherBranchStats(branch, contextWindow);
    const fill      = computeFillRate(stats, branch);
    const cacheRatio = computeCacheRatio(stats);

    const warning = computeWarning(contextPercent, tokens, stats, fill, cacheRatio);
    const key     = warningKey(warning);

    if (key === lastKey) return; // No change — skip emit + re-render.
    lastKey = key;
    currentWarning = warning;

    // 1. Emit on the shared bus — ALWAYS, regardless of display state.
    const payload: TooDumbChange = {
      warning,
      metrics: {
        contextPercent,
        tokens,
        contextWindow,
        cacheRatio,
        fillRatePerTurn: fill ? fill.rate : null,
      },
    };
    pi.events.emit(TOO_DUMB_EVENT, payload);

    // 2. Display — only when enabled.
    if (warning && displayEnabled && !notifiedSeverities.has(warning.severity)) {
      notifiedSeverities.add(warning.severity);
      const level = warning.severity === "red" ? "error" : "warning";
      ctx.ui.notify(
        `${warning.message} — /compact to summarize or /new to start fresh`,
        level,
      );
    }
    renderWidget(ctx);
  });

  // ── /too-dumb command — control the display ────────────────────────────────
  pi.registerCommand("too-dumb", {
    description: "Control the too-dumb banner/toasts (display on|off|status)",
    handler: async (args, ctx) => {
      const parts = args.trim().split(/\s+/).filter(Boolean);
      const [sub, value] = parts;

      const reportStatus = () => {
        const state = displayEnabled ? "on" : "off";
        const current = currentWarning
          ? `${currentWarning.severity.toUpperCase()}: ${currentWarning.message}`
          : "no active warning";
        ctx.ui.notify(`too-dumb display is ${state} — ${current}`, "info");
      };

      // `/too-dumb` or `/too-dumb status`
      if (!sub || sub === "status") {
        reportStatus();
        return;
      }

      if (sub === "display") {
        if (value === "off") {
          displayEnabled = false;
          renderWidget(ctx);
          ctx.ui.notify("too-dumb display off — signals still emit on the bus", "info");
          return;
        }
        if (value === "on") {
          displayEnabled = true;
          renderWidget(ctx);
          ctx.ui.notify("too-dumb display on", "info");
          return;
        }
      }

      ctx.ui.notify("Usage: /too-dumb display on|off  (or /too-dumb status)", "warning");
    },
  });
}
