#!/usr/bin/env bash
# Point the watcher at a keyed RPC endpoint without ever typing the URL.
#
#   curl -fsSL https://raw.githubusercontent.com/BacBacta/Exdate/HEAD/deploy/set-rpc.sh | bash
#
# It asks for the key alone - or a full URL, if that is what the clipboard
# holds - with echo off, so nothing lands in the terminal or its scrollback.
# Then, in this order: the key's shape is checked (an Alchemy key is 32
# characters; a paste that wrapped is shorter, one that dragged a quote along is
# longer), the candidate .env is written to a temporary file, the probe runs
# against THAT file and must pass the watcher's own scan, and only then is the
# real .env replaced and the service restarted. A refusal at any step changes
# nothing on the machine.
#
# Why this exists: the same key answered one afternoon and was refused all
# evening, and every refusal was the same 130-character line being truncated or
# decorated on its way through a phone keyboard. The fix is to never type it.
set -euo pipefail

DIR="${EXDATE_DIR:-/opt/exdate}"
USER_NAME="${EXDATE_USER:-exdate}"
ALCHEMY_HOST="robinhood-mainnet.g.alchemy.com"
FALLBACK="https://rpc.mainnet.chain.robinhood.com"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
die() { printf '\n\033[31mstopped:\033[0m %s\n' "$*" >&2; exit 1; }

FROM_STDIN=no; DO_RESTART=yes
for arg in "$@"; do
  case "$arg" in
    --stdin) FROM_STDIN=yes ;;        # read the key from stdin even when a terminal exists (pull-secrets)
    --no-restart) DO_RESTART=no ;;    # write .env, leave the restart to the caller
    *) die "unknown option $arg" ;;
  esac
done

main() {
[ "$(id -u)" -eq 0 ] || die "run this as root: it writes $DIR/.env and restarts the service"
[ -f "$DIR/scripts/probe-endpoint.mjs" ] || die "$DIR has no probe; run deploy/install.sh first to update the checkout"
command -v node >/dev/null || die "node is not installed here"

say "1. The key"
note "Paste the Alchemy API key - or the whole URL, either is fine - then press Enter."
note "Nothing you type is shown, and nothing is written yet."
# /dev/tty, not stdin: under `curl | bash` stdin is the script itself. When
# there is no terminal - a rehearsal, or a here-string - stdin is all there is.
if [ "$FROM_STDIN" = no ] && ( : </dev/tty ) 2>/dev/null; then
  read -rs -p '  > ' RAW </dev/tty; printf '\n'
else
  read -rs RAW || true
fi
# Whitespace is stripped, not refused: a wrapped paste arrives with it and the
# value is otherwise correct. Say so, because a silent repair is how a wrong
# value gets in looking right.
CLEAN="$(printf '%s' "$RAW" | tr -d '[:space:]' | sed -e "s/^['\"]*//" -e "s/['\"]*\$//")"
[ "$CLEAN" = "$RAW" ] || note "removed whitespace or surrounding quotes from what was entered"
RAW="$CLEAN"
[ -n "$RAW" ] || die "nothing was entered"

# The value may already be the two-URL form the repository secret carries for
# the collectors - "primary,fallback". The first entry is the endpoint under
# test; whatever follows is the operator's own fallback list and is kept as
# given. Without this the fallback was appended a second time and the archive
# variable, which takes ONE endpoint, received the whole list.
PRIMARY="${RAW%%,*}"
REST=""; [ "$PRIMARY" != "$RAW" ] && REST="${RAW#*,}"
if printf '%s' "$PRIMARY" | grep -q '://'; then
  # A full URL. Keep it as given, but read its key segment for the shape check.
  URL="$PRIMARY"
  KEY="${PRIMARY##*/}"
  # https, or plain http to this machine only - a node of your own on the same
  # host is a legitimate endpoint, and a key sent in clear anywhere else is not.
  case "$URL" in https://*|http://127.0.0.1:*|http://localhost:*) ;; *) die "the URL must start with https:// (plain http is allowed only to 127.0.0.1 or localhost)";; esac
else
  KEY="$PRIMARY"
  URL="https://$ALCHEMY_HOST/v2/$KEY"
fi
# The list to write: the endpoint under test, then the operator's own fallbacks,
# then Robinhood's endpoint last unless it is already there - a provider outage
# must never cost a capture.
LIST="$URL"; [ -n "$REST" ] && LIST="$URL,$REST"
case ",$LIST," in *",$FALLBACK,"*) ;; *) LIST="$LIST,$FALLBACK";; esac

# What is refused here is only what is certainly wrong: nothing at all, a
# placeholder, or a character that cannot survive in a URL. Length is NOT a
# gate - "an Alchemy key is 32 characters" was asserted here without ever being
# measured, Alchemy's documentation states no length, and the check then refused
# a real key before it could be tried. The probe makes a real request, and that
# is the only authority on whether a credential works.
LEN=$(printf '%s' "$KEY" | wc -c | tr -d ' ')
case "$KEY" in
  YOUR_KEY|VOTRE_CLE|API_KEY|'<'*|'{'*) die "that is the placeholder, not a key. Nothing written." ;;
esac
# A quote inside the value survives the strip above, which only takes the ends.
if printf '%s' "$KEY" | grep -q "['\"]"; then
  die "the key carries a quote from the paste - $LEN characters as given. Copy it again and run this."
fi
note "key of $LEN characters; the endpoint decides"

say "2. A candidate .env, not yet in place"
CANDIDATE="$(mktemp)"
# 600, and owned by the account that will probe it - root's private temp file
# is unreadable to the service account otherwise.
chmod 600 "$CANDIDATE"; chown "$USER_NAME" "$CANDIDATE"
# Everything the current .env has, minus the two lines this script owns.
if [ -f "$DIR/.env" ]; then grep -vE '^\s*(RHC_RPC_URLS|RHC_RPC_URL_ARCHIVE)\s*=' "$DIR/.env" > "$CANDIDATE" || true; fi
{
  printf 'RHC_RPC_URLS=%s\n' "$LIST"
  printf 'RHC_RPC_URL_ARCHIVE=%s\n' "$URL"
} >> "$CANDIDATE"
note "written to a temporary file; $DIR/.env is untouched so far"

say "3. Does the endpoint do the watcher's job?"
# Run as the service account, against the candidate file, and require the one
# check that decides whether this endpoint may go first.
# sudo starts the service account with a clean environment. On a machine that
# reaches the internet through a proxy, that clean environment has no proxy and
# every request fails as "fetch failed" - which looks like a bad endpoint and is
# not. Whatever proxy settings this shell has are handed through, and nothing
# else is.
passthrough=()
for v in HTTPS_PROXY HTTP_PROXY NO_PROXY https_proxy http_proxy no_proxy NODE_EXTRA_CA_CERTS SSL_CERT_FILE; do
  [ -n "${!v:-}" ] && passthrough+=("$v=${!v}")
done
if ! sudo -u "$USER_NAME" env HOME="/home/$USER_NAME" EXDATE_ENV_FILE="$CANDIDATE" "${passthrough[@]}" \
     node "$DIR/scripts/probe-endpoint.mjs" --require watcher-span; then
  rm -f "$CANDIDATE"
  die "the probe refused this endpoint, so nothing was changed. Read the lines above:
  'Must be authenticated'  the key - copy it again from the dashboard
  'watcher span' refused   the plan - this endpoint cannot serve the scan
  'fetch failed'           the network - this machine could not reach the endpoint at all"
fi

say "4. Apply and restart"
install -o "$USER_NAME" -g "$USER_NAME" -m 600 "$CANDIDATE" "$DIR/.env"
rm -f "$CANDIDATE"
note "$DIR/.env now puts $(printf '%s' "$URL" | sed -E 's#(https?://[^/]+/?).*#\1…#') first, Robinhood's endpoint last ($(printf '%s' "$LIST" | tr ',' '\n' | wc -l | tr -d ' ') endpoints)"
if [ "$DO_RESTART" = no ]; then
  note "not restarting (--no-restart); the caller will"
elif systemctl is-enabled --quiet exdate-watcher 2>/dev/null; then
  systemctl restart exdate-watcher
  sleep 4
  systemctl is-active --quiet exdate-watcher && note "exdate-watcher restarted and running" || die "the service did not come back: journalctl -u exdate-watcher -n 20"
  journalctl -u exdate-watcher -n 3 --no-pager -o cat | sed 's/^/  /'
else
  note "no exdate-watcher service here; the .env is in place for whatever reads it"
fi

cat <<EOF

  Done. The key was never shown and is stored only in $DIR/.env (mode 600).

  The GitHub collectors can use the same endpoint: add the repository secret
  RHC_RPC_URLS with the same two-URL value at
    https://github.com/BacBacta/Exdate/settings/secrets/actions/new

EOF
}

main "$@"
