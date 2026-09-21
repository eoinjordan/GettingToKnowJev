#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
export PATH="/opt/homebrew/bin:$HOME/.local/bin:$PATH"
if ! command -v uv >/dev/null 2>&1; then
  printf 'Install uv first: https://docs.astral.sh/uv/getting-started/installation/\n' >&2
  exit 1
fi
if [[ ! -e "$ROOT/.venv" ]]; then
  uv venv --python 3.12 "$ROOT/.venv"
fi
uv pip install --python "$ROOT/.venv/bin/python" -r "$ROOT/requirements.lock"
printf '\nInstalled the pinned integration. Offline start:\n  %s/.venv/bin/python %s/walkthrough.py demo\n' "$ROOT" "$ROOT"