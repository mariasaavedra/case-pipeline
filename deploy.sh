#!/usr/bin/env bash
# =============================================================================
# deploy.sh — one-step production deploy (run ON the server)
# =============================================================================
# The server never builds. GitHub Actions builds the API + web images and
# pushes them to GHCR on every push to main (.github/workflows/build-push.yml).
# This script fetches the latest code + images, restarts the stack, and proves
# the new build is the one answering.
#
# Usage (on the server):
#   cd ~/case-pipeline-new && ./deploy.sh
#
# Safe to re-run. Data in ./data (live.db, users.db) is a bind mount and is
# never touched by a deploy. No sudo: the deploy user is in the docker group.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")"

# Two deploys at once leave the api half-recreated ("removal of container … is
# already in progress", 2026-10-23). Hold a lock for the whole run.
exec 9>/tmp/case-pipeline-deploy.lock
if ! flock -n 9; then
  echo "✗ Another deploy is running. Wait for it to finish, then re-run."
  exit 1
fi

echo "▶ Pulling latest code…"
git pull -q origin main
want="$(git rev-parse HEAD)"
echo "  main is at ${want:0:7}"

echo "▶ Pulling prebuilt images from GHCR…"
docker compose pull -q

# Health = the api answering /health from inside its own container.
api_version() {
  docker compose exec -T api node -e \
    "fetch('http://127.0.0.1:3000/health').then(r=>r.json()).then(j=>console.log(j.version)).catch(()=>process.exit(1))" \
    2>/dev/null
}
both_running() {
  local running
  running="$(docker compose ps --status running --services 2>/dev/null)"
  grep -qx api <<<"$running" && grep -qx web <<<"$running"
}

# web waits for the api to be healthy; the api can take ~2 min after a restart
# (longer with a migration). If compose gives up on web anyway, a second up -d
# starts it once the api is healthy — the manual fix every deploy needed before
# the healthcheck got its longer start_period.
echo "▶ Restarting stack…"
for attempt in 1 2 3; do
  docker compose up -d || echo "  up -d attempt $attempt did not finish cleanly"
  for _ in $(seq 1 60); do # up to 5 min
    if both_running && api_version >/dev/null; then break 2; fi
    sleep 5
  done
  echo "  not healthy yet, retrying up -d…"
done

if ! both_running; then
  echo "✗ Stack is not fully up:"
  docker compose ps
  docker compose logs --tail=40 api
  exit 1
fi

live="$(api_version || true)"
if [ "$live" != "$want" ]; then
  echo "⚠ The api reports ${live:0:7}, but main is at ${want:0:7}."
  echo "  The image for ${want:0:7} is probably still building: check the"
  echo "  'Build & Push Images' run on GitHub, then re-run ./deploy.sh."
  exit 1
fi
echo "✓ Live: ${live:0:7}"

# Each deploy leaves the previous images' layers dangling (~1.45 GB). A full
# disk caused the July 2026 corruption, so reclaim and report every time.
echo "▶ Reclaiming old image layers…"
docker image prune -f | tail -1

used="$(df --output=pcent / | tail -1 | tr -dc '0-9')"
if [ "$used" -ge 80 ]; then
  echo "⚠ Disk ${used}% full — look at data/backups and docker images before the next deploy."
else
  echo "  Disk ${used}% full"
fi

docker compose ps --format 'table {{.Name}}\t{{.Status}}'
echo "✓ Deploy complete."
