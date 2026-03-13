#!/usr/bin/env bash
# Fairtrail CLI Demo — Automated recording script
# Creates a 1x2 tmux session, drives both panes through the search wizard,
# then opens --tmux view to create 2x2 layout.
#
# Usage: ./packages/cli/demo/record-demo.sh
# Prerequisites: tmux, ghostty, doppler, node

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

SESSION="fairtrail-rec"
CLI="doppler run -- node --import tsx/esm --import ./packages/cli/register.mjs packages/cli/src/index.tsx"
QUERY_LEFT="Frankfurt to Bogota December 2026"
QUERY_RIGHT="Frankfurt to Medellin December 2026"

# Timing helpers
type_slow() {
  local pane=$1 text=$2
  for (( i=0; i<${#text}; i++ )); do
    local char="${text:$i:1}"
    tmux send-keys -t "$pane" -l "$char"
    sleep 0.04
  done
}

wait_for() {
  sleep "$1"
}

echo "=== Fairtrail CLI Demo Recording ==="
echo ""

# Kill existing session
tmux kill-session -t "$SESSION" 2>/dev/null || true

# Create session with 1x2 split
tmux new-session -d -s "$SESSION" -x 240 -y 60
tmux split-window -h -t "$SESSION:0"
tmux select-layout -t "$SESSION:0" even-horizontal

# Add labels at top of each pane
tmux send-keys -t "$SESSION:0.0" "clear" Enter
tmux send-keys -t "$SESSION:0.1" "clear" Enter
wait_for 0.5

echo "Starting search wizard in both panes..."

# Launch search wizard in both panes
tmux send-keys -t "$SESSION:0.0" "$CLI --headless" Enter
tmux send-keys -t "$SESSION:0.1" "$CLI --headless" Enter
wait_for 3

echo "Typing queries..."

# Type queries in both panes (slightly staggered for visual effect)
type_slow "$SESSION:0.0" "$QUERY_LEFT"
wait_for 0.5
type_slow "$SESSION:0.1" "$QUERY_RIGHT"
wait_for 0.5

# Submit both queries
tmux send-keys -t "$SESSION:0.0" Enter
wait_for 0.3
tmux send-keys -t "$SESSION:0.1" Enter

echo "Waiting for LLM parsing..."
wait_for 8

# Confirm parsed queries (Enter selects "Search flights")
echo "Confirming parsed queries..."
tmux send-keys -t "$SESSION:0.0" Enter
wait_for 0.3
tmux send-keys -t "$SESSION:0.1" Enter

echo "Waiting for Playwright scraping..."
wait_for 60

# Select flights (Enter confirms default selection)
echo "Selecting flights..."
tmux send-keys -t "$SESSION:0.0" Enter
wait_for 0.3
tmux send-keys -t "$SESSION:0.1" Enter

echo "Waiting for tracker creation..."
wait_for 5

echo "Search complete! Trackers created."
echo ""

# Capture the query IDs from the panes
LEFT_OUTPUT=$(tmux capture-pane -t "$SESSION:0.0" -p)
RIGHT_OUTPUT=$(tmux capture-pane -t "$SESSION:0.1" -p)

LEFT_ID=$(echo "$LEFT_OUTPUT" | grep -oE 'cm[a-z0-9]+' | tail -1)
RIGHT_ID=$(echo "$RIGHT_OUTPUT" | grep -oE 'cm[a-z0-9]+' | tail -1)

echo "Left pane ID: $LEFT_ID"
echo "Right pane ID: $RIGHT_ID"

wait_for 3

if [ -n "$LEFT_ID" ] && [ -n "$RIGHT_ID" ]; then
  echo "Opening --tmux views..."

  # Clear panes and launch tmux view
  tmux send-keys -t "$SESSION:0.0" "q"
  wait_for 1
  tmux send-keys -t "$SESSION:0.0" "$CLI --headless --view $LEFT_ID --tmux" Enter

  wait_for 2

  tmux send-keys -t "$SESSION:0.1" "q"
  wait_for 1
  tmux send-keys -t "$SESSION:0.1" "$CLI --headless --view $RIGHT_ID --tmux" Enter

  echo "Tmux views opening..."
  wait_for 10
else
  echo "Could not extract query IDs. Manual step needed."
fi

echo ""
echo "=== Demo ready ==="
echo "Attach with: tmux attach -t $SESSION"
echo "Record with: Cmd+Shift+5 in macOS, select the Ghostty window"
