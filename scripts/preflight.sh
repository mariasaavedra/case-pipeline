#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Bun preflight"

if ! command -v bun >/dev/null 2>&1; then
  if [[ -x "$HOME/.bun/bin/bun" ]]; then
    export PATH="$HOME/.bun/bin:$PATH"
  fi
fi

if ! command -v bun >/dev/null 2>&1; then
  echo "ERROR: bun not found in PATH."
  echo "Install: https://bun.sh/docs/installation"
  echo "Hint: export PATH=\"\$HOME/.bun/bin:\$PATH\""
  exit 1
fi

echo "bun path: $(command -v bun)"
echo "bun version: $(bun --version)"

if [[ ! -d "data" ]]; then
  echo "ERROR: missing data/ directory"
  exit 1
fi

if [[ ! -w "data" ]]; then
  echo "ERROR: data/ is not writable"
  exit 1
fi

if [[ ! -w "/tmp" ]]; then
  echo "ERROR: /tmp is not writable"
  exit 1
fi

if [[ -f "bun.lock" ]]; then
  if [[ ! -d "node_modules" ]]; then
    echo "WARN: bun.lock exists but node_modules is missing. Run: bun install"
  fi
else
  echo "WARN: bun.lock is missing."
fi

echo "Preflight OK"
