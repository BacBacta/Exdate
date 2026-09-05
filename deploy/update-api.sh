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

# The schema, user and database are fixed in docker-compose.yml (DATABASE_SCHEMA,
# POSTGRES_USER, POSTGRES_DB), not substituted from the environment.
DB_SCHEMA=exdate
DB_USER=exdate
DB_NAME=exdate

api_healthy() {
  for _ in $(seq 1 "${1:-30}"); do
    curl -fsS --max-time 5 http://127.0.0.1:42069/v1/health >/dev/null 2>&1 && return 0
    sleep 4
  done
  return 1
}

# Ponder refuses to reuse a schema written by a different build of the app, and the
# indexer then crashloops with "Schema ... was previously used by a different Ponder
# app" while Caddy answers 502 - which is what the 2026-09-05 redeploy did, and the
# only reason this recovery exists.
#
# Ponder's build id is sha256(version + config + schema + indexing), and each of the
# three covers less than "everything that changed" - read out of
# ponder/dist/esm/build/index.js, and corrected there after claiming otherwise:
#
#   config     superjson of {ordering, contracts, accounts, blocks} only, so the
#              token address list and the chain config - not the whole registry
#   schema     the contents of ponder.schema.ts
#   indexing   the contents of the indexing files themselves, src/** minus api and
#              tests. Ponder's own comment: "we are only hashing the file contents,
#              not the exports" - so a module they IMPORT does not count, and the
#              generated registry is one of those.
#
# So the schema is invalidated by a code deploy - the schema, an indexing file, or
# the set of contracts - and NOT by a rebuild that merely carries a new record.
# Measured on 2026-09-05: the 21:23 deploy changed ponder.schema.ts and three
# indexing files and Ponder refused; the timer's 21:38 run carried a registry
# change and it did not.
#
# Recovery is dropping the schema, and it is driven by Ponder's own refusal rather
# than by guessing which commits change a hash: the log line is the trigger, so it
# never fires when Ponder is content. What that costs is the derived tables, and
# they are derived: the poller rewrites token states, reconciliations and the
# multiplier events it seeds from the committed registry within one poll interval,
# feed_rounds is an observation log whose prices are re-readable from the
# aggregator with getRoundData, and the webhook outbox holds deliveries already
# made. The self-service subscriptions are NOT in Postgres - they are a file on a
# volume - so they survive.
recover_ponder_schema() {
  docker compose logs --tail=80 indexer 2>/dev/null | grep -q 'previously used by a different Ponder app' || return 1
  log "Ponder refuses the existing schema: its build id changed. Dropping \"$DB_SCHEMA\" and letting it rebuild."
  docker compose exec -T db psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" \
    -c "DROP SCHEMA IF EXISTS \"$DB_SCHEMA\" CASCADE" >/dev/null </dev/null || return 1
  docker compose up -d --force-recreate indexer </dev/null
  return 0
}

# Everything below runs inside main(), called at the end.
#
# Not style: this script rewrites its own file. `git reset --hard` a few lines down
# replaces deploy/update-api.sh with the branch's version while bash is executing
# it, and bash reads a script lazily by byte offset - so a file that changes length
# underneath it resumes at the wrong place and runs whatever happens to be there.
# Defining the body as a function first makes bash parse the whole thing before a
# single line of it runs. deploy/install.sh carries the same shape for the cousin of
# this trap, where `curl | bash` made the script bash's own stdin.
main() {

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

  if ! api_healthy 30; then
    if recover_ponder_schema; then
      api_healthy 30 || die "the API still does not answer after dropping the schema: docker compose logs indexer"
      log "recovered: the schema was rebuilt from scratch, and the poller refills it within one interval"
    else
      die "the API did not answer on 127.0.0.1:42069 within two minutes, and it is not the Ponder schema: docker compose logs indexer"
    fi
  fi

  log "up at ${after:0:7}: $(curl -fsS --max-time 5 http://127.0.0.1:42069/v1/health)"

}

main "$@" </dev/null
