#!/usr/bin/env bash
# Auto-export the current agent session transcript into prompts/.
#
# Wired as a Stop + SessionEnd hook in .claude/settings.json and .codex/hooks.json.
# Claude Code and Codex hand the hook a JSON payload on stdin that carries
# `transcript_path` and `session_id`; this copies that transcript to
# prompts/raw-session-<id>.jsonl.
#
# Why it's here: the take-home asks you to commit your raw AI session logs to
# prompts/ — we read them as the source of truth. This removes the manual step:
# every time the agent stops or the session ends, the latest full transcript
# is copied in, overwriting the same per-session file. Idempotent; re-running is
# safe, so prompts/ always holds the current transcript for each session.
#
# Non-fatal by design: any failure exits 0 so it can never interrupt your work.
# On tools with a different hook contract, export your transcript into prompts/
# by hand (see PROMPTS.md) — same destination.
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dest_dir="$repo_root/prompts"

payload="$(cat)"

# Read one field from the hook JSON without assuming a specific tool is present:
# prefer jq, fall back to python3, fall back to a plain regex. This runs on a
# stranger's machine, so it can't hard-depend on jq being installed.
read_field() {
  local key="$1"
  if command -v jq >/dev/null 2>&1; then
    printf '%s' "$payload" | jq -r --arg k "$key" '.[$k] // empty'
  elif command -v python3 >/dev/null 2>&1; then
    printf '%s' "$payload" | python3 -c \
      "import sys,json; print(json.load(sys.stdin).get('$key',''))" 2>/dev/null
  else
    printf '%s' "$payload" \
      | grep -o "\"$key\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
      | head -1 | sed 's/.*:[[:space:]]*"\([^"]*\)"/\1/'
  fi
}

transcript_path="$(read_field transcript_path)"
session_id="$(read_field session_id)"
[ -n "$session_id" ] || session_id="unknown"

# Nothing to copy if the harness didn't hand us a real transcript file.
[ -n "$transcript_path" ] && [ -f "$transcript_path" ] || exit 0

mkdir -p "$dest_dir"
cp "$transcript_path" "$dest_dir/raw-session-$session_id.jsonl"
