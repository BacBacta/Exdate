#!/usr/bin/env bash
# Bring the hosted API and status page up to the branch, if the branch moved.
#
#   deploy/update-api.sh            # what the systemd timer runs
#   deploy/update-api.sh --force    # rebuild even if nothing relevant changed
#
# Installed by deploy/install-api.sh as exdate-api-update.timer. It exists
# because the API compiles the generated registry INTO its image: the corroboration
# of every token -> feed pairing, and the multiplier steps the poller seeds from,
# are code as far as the container is concerned. So an API deployed on Tuesday goes
# on serving Tuesday's registry however often the collectors commit, and nobody
# notices - measured on 2026-09-05, when the hosted API served a registry three days
# old and published `feedCorroboratedBy: []` for pairings every other surface called
# corroborated (data audit, F03 and F09).
#
# It does NOT rebuild on every commit. The collectors push up to two dozen times a
# day, and a rebuild recreates the indexer container, which costs Ponder a
# reconnect and a resync each time. Only a commit that changes what the image
# contains counts, and `data/` is deliberately not in that set: it is copied into
# the image for `docker compose exec` convenience, and nothing the container runs
# reads it - the registry the indexer seeds from is generated INTO
# packages/core/src/generated/, which is inside the filter. Verified rather than
# assumed: no readFile of data/ exists in packages/indexer/src or packages/api/src.
set -euo pipefail

BRANCH="${EXDATE_BRANCH:-claude/lance-en5q6j}"
DIR="${EXDATE_DIR:-/opt/exdate-api}"
WATCHER_DIR="${EXDATE_WATCHER_DIR:-/opt/exdate}"

# Paths whose contents end up in one of the two images.
IMAGE_INPUTS='^(packages/|apps/status/|Dockerfile$|deploy/status.Dockerfile$|deploy/Caddyfile$|docker-compose.yml$|package.json$|pnpm-lock.yaml$|pnpm-workspace.yaml$|tsconfig.base.json$)'

log() { printf '%s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
die() { log "stopped: $*" >&2; exit 1; }

[ "$DIR" != "$WATCHER_DIR" ] || die "EXDATE_DIR must not be the watcher's checkout ($WATCHER_DIR)"
[ -d "$DIR/.git" ] || die "$DIR is not a checkout; run deploy/install-api.sh first"
cd "$DIR"

git fetch --quiet origin "$BRANCH" </dev/null || die "could not fetch origin/$BRANCH"
before="$(git rev-parse HEAD)"
after="$(git rev-parse "origin/$BRANCH")"

if [ "$before" = "$after" ] && [ "${1:-}" != "--force" ]; then
  log "already at ${after:0:7}"
  exit 0
fi

changed="$(git diff --name-only "$before" "$after" || true)"
if [ "${1:-}" != "--force" ] && [ -n "$changed" ] && ! printf '%s\n' "$changed" | grep -qE "$IMAGE_INPUTS"; then
  # Move the checkout forward anyway, so the next comparison is against the tip
  # rather than replaying the same skipped commits for ever.
  git reset --quiet --hard "$after" </dev/null
  log "${before:0:7} -> ${after:0:7}: nothing the image contains changed, not rebuilding"
  exit 0
fi

git reset --quiet --hard "$after" </dev/null
log "${before:0:7} -> ${after:0:7}: rebuilding"
docker compose --profile public up -d --build </dev/null

# Assert the shape, not that a command returned zero: "containers up" was true of
# the install run that started a duplicate watcher and no proxy at all.
running="$(docker compose --profile public ps --services --filter status=running 2>/dev/null | sort | tr '\n' ' ')"
for want in db indexer status caddy; do
  case " $running " in *" $want "*) ;; *) die "$want is not running after the rebuild; got: ${running:-none}";; esac
done
case " $running " in
  *" watcher "*) die "the watcher came up here; this machine runs it under systemd and two would race on one committed file";;
esac

ok=no
for _ in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:42069/v1/health >/dev/null 2>&1; then ok=yes; break; fi
  sleep 4
done
[ "$ok" = yes ] || die "the API did not answer on 127.0.0.1:42069 within two minutes: docker compose logs indexer"

log "up at ${after:0:7}: $(curl -fsS --max-time 5 http://127.0.0.1:42069/v1/health)"
