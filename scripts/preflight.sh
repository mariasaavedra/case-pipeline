#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

echo "==> Node.js preflight"

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: node not found in PATH."
  echo "Install Node.js 22+: https://nodejs.org/en/download"
  exit 1
fi

NODE_MAJOR=$(node --version | sed 's/v//' | cut -d. -f1)
if [[ "$NODE_MAJOR" -lt 22 ]]; then
  echo "ERROR: Node.js 22+ required, found $(node --version)"
  exit 1
fi

echo "node path: $(command -v node)"
echo "node version: $(node --version)"

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm not found in PATH."
  exit 1
fi

echo "npm version: $(npm --version)"

# data/ is gitignored and created on demand by the sync/seed scripts
# (fs.mkdirSync(..., { recursive: true })). Create it here too so a fresh
# checkout — including CI — passes, then verify it is writable.
mkdir -p data

if [[ ! -w "data" ]]; then
  echo "ERROR: data/ is not writable"
  exit 1
fi

if [[ ! -w "/tmp" ]]; then
  echo "ERROR: /tmp is not writable"
  exit 1
fi

if [[ -f "package-lock.json" ]]; then
  if [[ ! -d "node_modules" ]]; then
    echo "WARN: package-lock.json exists but node_modules is missing. Run: npm install"
  fi
else
  echo "WARN: package-lock.json is missing."
fi

echo "Preflight OK"
