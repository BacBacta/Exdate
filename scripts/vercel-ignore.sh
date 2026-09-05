#!/usr/bin/env bash
# Vercel's "ignored build step" for the public site: exit 0 to SKIP the build,
# exit 1 to run it. Wired through `ignoreCommand` in vercel.json.
#
# Why it exists. The site deploys from git, and the collectors commit to the
# same branch: on 2026-09-05 the branch received 125 commits in 24 hours, 67 of
# them from collectors (the off-hours sampler and the gap sweep hourly, the
# capture and the watcher's heartbeat several times a day). Vercel's Hobby plan
# allows 100 deployments a day, and at 12:49 UTC it answered
#   "Deployment rate limited - retry in 24 hours."
# to a commit that fixed a severity-4 defect. The data pipeline had spent the
# site's deploy quota, and a fix could not ship for a day.
#
# The rule. A commit by a person or the agent always builds. A collector commit
# builds only if it is the FIRST collector commit of its UTC hour: when the
# commit before it is also a collector's and falls in the same clock hour, this
# one is skipped. Stateless - it needs nothing but `git log -2`, which Vercel's
# checkout provides (its own documented example diffs HEAD^ against HEAD) - and
# it bounds collector deployments at 24 a day however many collectors there are,
# while the pages stay within an hour of the record: every build reads all of
# data/ at that moment, so what a skipped commit added ships with the next
# hour's build.
#
# What it does not do: batch by wall clock. "Skip if the previous commit was
# less than N minutes ago" was the obvious rule and it is wrong - with commits
# arriving every ten to twenty minutes, every one has a recent predecessor and
# nothing ever builds again. Comparing hours has a floor: the first commit in a
# new hour always has a predecessor from the old one.
#
# Rehearse against real history: scripts/vercel-ignore.sh --explain <sha>...
set -euo pipefail

is_collector() { case "$1" in exdate-*) return 0 ;; *) return 1 ;; esac }

decide() {
  # $1 = commit to decide for (default HEAD). Prints BUILD or SKIP with the reason.
  local ref="${1:-HEAD}"
  local author hour prev_author prev_hour
  author="$(git log -1 --format=%an "$ref")"
  hour="$(git log -1 --format=%cd --date=format:%Y-%m-%dT%H "$ref")"
  if ! is_collector "$author"; then
    echo "BUILD: authored by $author, not a collector"
    return 1
  fi
  if ! prev_author="$(git log -1 --format=%an "$ref^" 2>/dev/null)"; then
    echo "BUILD: $author, and no parent commit to compare with"
    return 1
  fi
  prev_hour="$(git log -1 --format=%cd --date=format:%Y-%m-%dT%H "$ref^")"
  if is_collector "$prev_author" && [ "$prev_hour" = "$hour" ]; then
    echo "SKIP: $author at ${hour}h, after $prev_author in the same hour - this hour already builds"
    return 0
  fi
  echo "BUILD: $author, first collector commit of ${hour}h (previous: $prev_author at ${prev_hour}h)"
  return 1
}

if [ "${1:-}" = "--explain" ]; then
  shift
  for sha in "$@"; do
    printf '%s  ' "$(git log -1 --format='%h %an %cd' --date=format:%H:%M "$sha")"
    decide "$sha" || true
  done
  exit 0
fi

decide HEAD
