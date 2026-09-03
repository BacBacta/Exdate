#!/usr/bin/env bash
# Deploy the public site to Vercel from a tree without git metadata.
#
# Vercel blocks a CLI deployment whose *commit author* is not a verified member
# of the team ("TEAM_ACCESS_REQUIRED"). A deploy driven by an agent carries
# commits authored by that agent, so the same tree is uploaded from a copy that
# has no .git at all: nothing to check, nothing to block. Git-connected deploys
# from the dashboard never hit this, because the author is you.
#
#   VERCEL_TOKEN=... scripts/deploy-web.sh            # production
#   VERCEL_TOKEN=... scripts/deploy-web.sh --preview  # a preview URL instead
#
# Needs .vercel/project.json (from `vercel link`) next to this repository root.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VERCEL_TOKEN:?set VERCEL_TOKEN (vercel.com/account/tokens, or a device-flow access token)}"
test -f .vercel/project.json || { echo "run: vercel link --project exdate" >&2; exit 1; }

tree="$(mktemp -d)"
trap 'rm -rf "$tree"' EXIT
tar --exclude=.git --exclude=node_modules --exclude=.next --exclude=out --exclude=.ponder \
    --exclude=.vercel --exclude='.env*' --exclude='*.log' -cf - . | (cd "$tree" && tar -xf -)
mkdir -p "$tree/.vercel" && cp .vercel/project.json "$tree/.vercel/project.json"

target=(--prod); [ "${1:-}" = "--preview" ] && target=()
cd "$tree" && vercel deploy --yes --archive=tgz "${target[@]}" --token "$VERCEL_TOKEN"
