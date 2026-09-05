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
#   EXDATE_DEPLOY_ALLOW_BEHIND=1 ...                  # deploy anyway (see below)
#
# Needs .vercel/project.json (from `vercel link`) next to this repository root.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${VERCEL_TOKEN:?set VERCEL_TOKEN (vercel.com/account/tokens, or a device-flow access token)}"
test -f .vercel/project.json || { echo "run: vercel link --project exdate" >&2; exit 1; }

# What gets uploaded is this working copy, not the branch. Seven collectors commit
# on their own schedules, so a checkout that was current when the work started is
# routinely a commit or two behind by the time it deploys - and the site then
# publishes figures older than the record it claims to read. Measured on
# 2026-09-05: the live pages showed 74.1 % off-hours over 60 samples while data/
# already held 74.3 % over 61 (audit F11). So: fetch, and refuse to publish a
# checkout that is behind its own branch.
if [ -d .git ] && [ "${EXDATE_DEPLOY_ALLOW_BEHIND:-}" != "1" ]; then
  branch="$(git rev-parse --abbrev-ref HEAD)"
  if git fetch --quiet origin "$branch" 2>/dev/null; then
    behind="$(git rev-list --count "HEAD..origin/$branch")"
    if [ "$behind" != "0" ]; then
      echo "refusing to deploy: $behind commit(s) behind origin/$branch" >&2
      git --no-pager log --oneline "HEAD..origin/$branch" | sed 's/^/  /' >&2
      echo "run: git pull --rebase origin $branch   (or EXDATE_DEPLOY_ALLOW_BEHIND=1 to publish this tree anyway)" >&2
      exit 1
    fi
  else
    echo "warning: could not fetch origin/$branch; deploying this tree as it stands" >&2
  fi
fi

tree="$(mktemp -d)"
trap 'rm -rf "$tree"' EXIT
tar --exclude=.git --exclude=node_modules --exclude=.next --exclude=out --exclude=.ponder \
    --exclude=.vercel --exclude='.env*' --exclude='*.log' -cf - . | (cd "$tree" && tar -xf -)
mkdir -p "$tree/.vercel" && cp .vercel/project.json "$tree/.vercel/project.json"

target=(--prod); [ "${1:-}" = "--preview" ] && target=()
cd "$tree" && vercel deploy --yes --archive=tgz "${target[@]}" --token "$VERCEL_TOKEN"
