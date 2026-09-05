#!/usr/bin/env bash
# Encrypt each configured secret to every machine key. Run by deliver-secrets.yml
# on a GitHub runner, where the secrets exist as environment variables and the
# private keys do not exist at all.
#
# The list is the closed set of things a machine's .env may carry. A name that is
# set but empty is skipped, so an unset secret never produces an empty file that
# would then blank the machine's value.
set -euo pipefail
cd "$(dirname "$0")/.."
NAMES=(RHC_RPC_URLS EXDATE_ALERT_WEBHOOK_URL EXDATE_TELEGRAM_BOT_TOKEN EXDATE_TELEGRAM_CHAT_ID)

shopt -s nullglob
keys=(deploy/keys/*.pub)
[ ${#keys[@]} -gt 0 ] || { echo "no machine key in deploy/keys; nothing to encrypt to"; exit 0; }
recipients="$(mktemp)"; cat "${keys[@]}" > "$recipients"
echo "recipients: ${keys[*]}"

delivered=0
for name in "${NAMES[@]}"; do
  value="${!name:-}"
  if [ -z "$value" ]; then echo "  $name: not set, skipped"; continue; fi
  printf '%s' "$value" | age -R "$recipients" -o "deploy/secrets/$name.age"
  echo "  $name: encrypted (${#value} characters)"
  delivered=$((delivered+1))
done
rm -f "$recipients"
echo "$delivered secret(s) written to deploy/secrets/"
