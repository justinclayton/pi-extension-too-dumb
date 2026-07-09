/**
 * TEST-ONLY extension. Registers the local Ollama instance as a pi provider.
 *
 * The declared `contextWindow` here is deliberately TINY (4096) so a modest
 * prompt pushes context fill past too-dumb's 70% / 90% thresholds and makes
 * Signal 1 fire. The underlying Ollama model (`too-dumb-test`) is built with a
 * much larger real `num_ctx` (16384, see test/Modelfile) so Ollama never
 * truncates the prompt and under-reports token usage.
 *
 * Not shipped with the package — this lives under test/ purely for local
 * end-to-end verification of signal production.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerProvider("ollama", {
    name: "Ollama (local, too-dumb test)",
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama", // Ollama ignores the key; any non-empty value works.
    api: "openai-completions",
    models: [
      {
        id: "too-dumb-test",
        name: "too-dumb test (llama3.2, 4k declared window)",
        reasoning: false,
        input: ["text"],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        // Small on purpose — this is the denominator for context-fill %.
        contextWindow: 4096,
        maxTokens: 512,
      },
    ],
  });
}
