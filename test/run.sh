#!/usr/bin/env bash
# End-to-end signal test against a local Ollama model — no paid tokens.
#
# Generates a filler prompt of a target word count, runs pi in print mode with:
#   - the real too-dumb extension
#   - the test Ollama provider (declared 4k context window)
#   - the signal listener (logs every too-dumb:change)
# then prints the captured bus events.
#
# Usage:
#   test/run.sh [WORDS]     # default 2600 (~orange). Try 3400 for red.
set -euo pipefail

cd "$(dirname "$0")/.."
WORDS="${1:-2600}"
LOG="test/too-dumb-events.log"
: > "$LOG"   # truncate

# Build a filler prompt of ~WORDS words. Content is irrelevant — we only care
# about token volume driving context-fill %.
PROMPT="$(python3 - "$WORDS" <<'PY'
import sys, random
n = int(sys.argv[1])
vocab = ("alpha bravo charlie delta echo foxtrot golf hotel india juliet "
         "kilo lima mike november oscar papa quebec romeo sierra tango").split()
print("Summarize the following log in one short sentence:\n")
print(" ".join(random.choice(vocab) for _ in range(n)))
PY
)"

echo ">>> prompt words: $WORDS"
echo ">>> running pi (print mode, local model)…"
pi -p "$PROMPT" \
  --model ollama/too-dumb-test \
  -e ./extensions/index.ts \
  -e ./test/ollama-provider.ts \
  -e ./test/signal-listener.ts \
  >/dev/null 2>test/pi-stderr.log || {
    echo "pi exited non-zero; stderr tail:"; tail -20 test/pi-stderr.log; exit 1;
  }

echo
echo ">>> listener stderr:"
grep '\[too-dumb-listener\]' test/pi-stderr.log || echo "(none)"
echo
echo ">>> too-dumb:change events ($LOG):"
if [ -s "$LOG" ]; then
  python3 -c 'import sys,json;[print(json.dumps(json.loads(l),indent=2)) for l in open("'"$LOG"'")]'
else
  echo "(no events emitted)"
fi
