#!/usr/bin/env bash
# Put the exdate API and status page on a Debian or Ubuntu machine, under real
# names with TLS.
#
#   curl -fsSL https://raw.githubusercontent.com/BacBacta/Exdate/HEAD/deploy/install-api.sh | bash
#
# Point two names at this machine first - by default api.exdate.me and
# status.exdate.me - because the script checks that they resolve here before it
# lets Caddy ask Let's Encrypt for anything. Asking for a certificate on a name
# that points elsewhere fails, and failing repeatedly is how an account gets
# rate-limited for a week.
#
# Idempotent: re-running it is how you upgrade. It never deletes anything it did
# not create, and it refuses rather than guessing.
#
# Everything is inside main(), called at the end with stdin detached: under
# `curl | bash` the script IS bash's stdin, so a child that reads stdin eats the
# rest of the source and bash stops there with status 0. See deploy/install.sh,
# where that cost two silent failures.
set -euo pipefail

REPO_HTTPS="${EXDATE_REPO_HTTPS:-https://github.com/BacBacta/Exdate.git}"
BRANCH="${EXDATE_BRANCH:-claude/lance-en5q6j}"
DIR="${EXDATE_DIR:-/opt/exdate}"
API_HOST="${EXDATE_API_HOST:-api.exdate.me}"
STATUS_HOST="${EXDATE_STATUS_HOST:-status.exdate.me}"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
warn() { printf '  \033[33m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mstopped:\033[0m %s\n' "$*" >&2; exit 1; }

main() {

if [ -n "${TERMUX_VERSION:-}" ] || case "${PREFIX:-}" in *com.termux*) true;; *) false;; esac; then
  die "this is Termux on Android, not the server.
  Connect to the machine first: ssh root@YOUR.SERVER.IP"
fi
command -v apt-get >/dev/null || die "this expects Debian or Ubuntu; elsewhere run docker-compose.yml by hand"
[ "$(id -u)" -eq 0 ] || die "run this as root: it installs Docker and opens 80 and 443."

say "1. Docker"
if ! command -v docker >/dev/null; then
  note "installing Docker from get.docker.com"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
docker compose version >/dev/null 2>&1 || die "docker is installed but the compose plugin is not; install docker-compose-plugin"
command -v git >/dev/null || apt-get install -y -qq git
note "$(docker --version), compose $(docker compose version --short)"

say "2. Names"
# The check that matters. Caddy will ask Let's Encrypt for a certificate for
# each name over the HTTP-01 challenge, which only answers if the name resolves
# to this machine and 80 is reachable. Getting this wrong is not a slow failure:
# repeated ACME failures are rate-limited per domain.
mine="$(ip -4 -o addr show scope global 2>/dev/null | awk '{split($4,a,"/"); print a[1]}')"
[ -n "$mine" ] || warn "cannot read this machine's addresses; the name check below is advisory only"
for host in "$API_HOST" "$STATUS_HOST"; do
  resolved="$(getent ahostsv4 "$host" 2>/dev/null | awk '{print $1}' | sort -u | tr '\n' ' ')"
  if [ -z "$resolved" ]; then
    die "$host does not resolve at all. Add an A record pointing it at this machine, wait for it to propagate, then run this again."
  fi
  hit=no
  for ip in $resolved; do for own in $mine; do [ "$ip" = "$own" ] && hit=yes; done; done
  if [ "$hit" = yes ]; then
    note "$host -> $resolved (this machine)"
  elif [ -z "$mine" ]; then
    warn "$host -> $resolved; could not confirm it is this machine"
  else
    die "$host resolves to $resolved, which is not an address on this machine ($mine).
  Caddy would ask Let's Encrypt for a certificate it cannot prove, and repeated failures are rate-limited.
  Fix the A record, or set EXDATE_API_HOST / EXDATE_STATUS_HOST to the names you actually pointed here."
  fi
done

# 80 and 443 must be free: the ACME challenge answers on 80, and anything else
# already bound there wins and Caddy simply fails to start.
for port in 80 443; do
  if ss -ltn "( sport = :$port )" 2>/dev/null | grep -q LISTEN; then
    # Our own Caddy from a previous run is not a conflict.
    if ! docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | grep -q ":$port->"; then
      die "something is already listening on $port. Caddy needs 80 for the ACME challenge and 443 to serve; stop the other service first."
    fi
  fi
done

say "3. Repository at $DIR"
if [ -d "$DIR/.git" ]; then
  # This may be the watcher's own working copy, which it commits and pushes
  # from. Fetching and checking out is safe; resetting it is not, so it is not
  # done here - the watcher owns that clone's state.
  owner="$(stat -c '%U' "$DIR")"
  note "reusing the checkout at $DIR (owner $owner)"
  sudo -u "$owner" git -C "$DIR" fetch --quiet origin "$BRANCH" </dev/null || warn "could not fetch; building from what is on disk"
  note "at $(git -C "$DIR" rev-parse --short HEAD)"
else
  git clone --quiet --branch "$BRANCH" "$REPO_HTTPS" "$DIR" </dev/null
  note "cloned $BRANCH over https (read-only; the API never pushes)"
fi

say "4. Settings"
ENV="$DIR/.env"
touch "$ENV"; chmod 600 "$ENV"
set_env() {
  # Rewrites the key in place if present, appends it otherwise. The watcher's
  # own alert settings live in this same file and must survive.
  if grep -q "^$1=" "$ENV"; then
    sed -i "s#^$1=.*#$1=$2#" "$ENV"
  else
    printf '%s=%s\n' "$1" "$2" >> "$ENV"
  fi
}
if ! grep -q '^POSTGRES_PASSWORD=' "$ENV"; then
  # Generated here and never printed: it is only ever read from this file, by
  # containers on this machine.
  set_env POSTGRES_PASSWORD "$(head -c 24 /dev/urandom | base64 | tr -d '/+=' | head -c 32)"
  note "generated a Postgres password into $ENV"
fi
set_env EXDATE_API_HOST "$API_HOST"
set_env EXDATE_STATUS_HOST "$STATUS_HOST"
note "$ENV: api $API_HOST, status $STATUS_HOST"

say "5. Build and start"
cd "$DIR"
docker compose --profile public up -d --build </dev/null
note "containers up"

say "6. Does it answer?"
# Locally first: a failure here is the indexer, not TLS. Then publicly, which is
# the only proof that the certificate was issued and the proxy is wired.
ok=no
for attempt in $(seq 1 30); do
  if curl -fsS --max-time 5 http://127.0.0.1:42069/v1/health >/dev/null 2>&1; then ok=yes; break; fi
  sleep 4
done
[ "$ok" = yes ] || die "the API did not answer on 127.0.0.1:42069 within two minutes: docker compose logs indexer"
note "API answers locally: $(curl -fsS --max-time 5 http://127.0.0.1:42069/v1/health)"

# A certificate takes a few seconds on a first run. Not fatal: the containers
# are up and Caddy retries on its own, so this reports rather than rolls back.
pub=no
for attempt in $(seq 1 20); do
  if curl -fsS --max-time 8 "https://$API_HOST/v1/health" >/dev/null 2>&1; then pub=yes; break; fi
  sleep 6
done
if [ "$pub" = yes ]; then
  note "https://$API_HOST/v1/health answers with a valid certificate"
  curl -fsS --max-time 8 "https://$STATUS_HOST/" >/dev/null 2>&1 \
    && note "https://$STATUS_HOST/ answers" \
    || warn "https://$STATUS_HOST/ did not answer yet; docker compose logs status caddy"
else
  warn "https://$API_HOST/v1/health did not answer within two minutes."
  warn "The containers are up and Caddy keeps retrying. Watch it: docker compose logs -f caddy"
fi

cat <<EOF

  Done.

    docker compose logs -f indexer     what it is indexing
    docker compose logs -f caddy       certificates and requests
    docker compose --profile public up -d --build    after a git pull

  The capture watcher is NOT started here: on this machine it runs under systemd
  (deploy/install.sh), and two watchers would sample the same instants twice and
  race on one file. Its compose service exists behind --profile watcher for a
  machine that has no systemd unit.

EOF

}

main "$@" </dev/null
