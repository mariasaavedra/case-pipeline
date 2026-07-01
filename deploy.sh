#!/usr/bin/env bash
# =============================================================================
# deploy.sh — one-step production deploy (run ON the server)
# =============================================================================
# The server never builds. GitHub Actions builds the API + web images and
# pushes them to GHCR on every push to main (.github/workflows/build-push.yml).
# This script just fetches the latest code + images and restarts the stack.
#
# Usage (on the server):
#   cd ~/case-pipeline-new && ./deploy.sh
#
# Safe to re-run. Data in ./data (live.db, users.db) is a bind mount and is
# never touched by a deploy.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

echo "▶ Pulling latest code…"
git pull origin main

echo "▶ Pulling prebuilt images from GHCR…"
sudo docker compose pull

echo "▶ Restarting stack…"
sudo docker compose up -d

echo "▶ Waiting for API to report healthy…"
for i in $(seq 1 30); do
  status="$(sudo docker compose ps --format '{{.Name}} {{.Status}}' | grep api-1 || true)"
  if echo "$status" | grep -qi healthy; then
    echo "✓ API healthy: $status"
    break
  fi
  sleep 2
  if [ "$i" -eq 30 ]; then
    echo "⚠ API did not report healthy in 60s. Recent logs:"
    sudo docker compose logs --tail=30 api
    exit 1
  fi
done

echo "▶ Current status:"
sudo docker compose ps --format 'table {{.Name}}\t{{.Status}}'

echo "✓ Deploy complete."
