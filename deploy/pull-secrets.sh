#!/usr/bin/env bash
# Apply the secrets delivered to this machine (deploy/secrets/*.age) to its .env.
#
# Run by deploy/install.sh on every pass, or by hand as root:
#
#   bash /opt/exdate/deploy/pull-secrets.sh
#
# Each file is decrypted with this machine's own deploy key, as the service
# account. One that was not encrypted to this machine simply fails to decrypt
# and is skipped with a note. An RPC endpoint goes through deploy/set-rpc.sh,
# which probes it against the watcher's own scan before writing anything;
# everything else is written straight into .env, other lines preserved.
set -euo pipefail

DIR="${EXDATE_DIR:-/opt/exdate}"
USER_NAME="${EXDATE_USER:-exdate}"
KEY="${EXDATE_KEY:-/home/$USER_NAME/.ssh/id_ed25519}"
RESTART="${1:-}"   # pass --restart to restart the service after applying

note() { printf '  %s\n' "$*"; }
die() { printf '\n\033[31mstopped:\033[0m %s\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run as root"
[ -f "$KEY" ] || die "no deploy key at $KEY; run deploy/install.sh first"
shopt -s nullglob
files=("$DIR"/deploy/secrets/*.age)
if [ ${#files[@]} -eq 0 ]; then note "nothing delivered yet (deploy/secrets is empty)"; exit 0; fi
command -v age >/dev/null || { note "installing age"; apt-get update -qq && apt-get install -y -qq age >/dev/null; }

ENV="$DIR/.env"
touch "$ENV"; chown "$USER_NAME:$USER_NAME" "$ENV"; chmod 600 "$ENV"
set_env() {
  local tmp; tmp="$(mktemp)"
  grep -vE "^\s*$1\s*=" "$ENV" > "$tmp" || true
  printf '%s=%s\n' "$1" "$2" >> "$tmp"
  install -o "$USER_NAME" -g "$USER_NAME" -m 600 "$tmp" "$ENV"; rm -f "$tmp"
}

applied=0; skipped=0; refused=0
for f in "${files[@]}"; do
  name="$(basename "$f" .age)"
  if ! value="$(sudo -u "$USER_NAME" age -d -i "$KEY" "$f" 2>/dev/null)"; then
    note "$name: not encrypted to this machine, skipped"; skipped=$((skipped+1)); continue
  fi
  [ -n "$value" ] || { note "$name: empty, skipped"; skipped=$((skipped+1)); continue; }
  case "$name" in
    RHC_RPC_URLS)
      # The gate: probe first, write only on success, no restart here.
      if EXDATE_DIR="$DIR" EXDATE_USER="$USER_NAME" bash "$DIR/deploy/set-rpc.sh" --stdin --no-restart <<< "$value"; then
        applied=$((applied+1))
      else
        note "$name: refused by the probe, not applied"; refused=$((refused+1))
      fi
      ;;
    EXDATE_ALERT_WEBHOOK_URL|EXDATE_TELEGRAM_BOT_TOKEN|EXDATE_TELEGRAM_CHAT_ID)
      set_env "$name" "$value"; note "$name: applied (${#value} characters)"; applied=$((applied+1))
      ;;
    *)
      note "$name: not a name this machine takes, skipped"; skipped=$((skipped+1))
      ;;
  esac
done
note "$applied applied, $skipped skipped, $refused refused"
if [ "$RESTART" = "--restart" ] && [ "$applied" -gt 0 ] && systemctl is-enabled --quiet exdate-watcher 2>/dev/null; then
  systemctl restart exdate-watcher && note "exdate-watcher restarted"
fi
[ "$refused" -eq 0 ]
