# What needs the owner

Everything here is blocked on a decision, an account or a payment, not on code. The code
side of each is already in the repository and named below. Delete an entry when it is done.

## 1. Arm the alerts

`.github/workflows/capture-effective-prices.yml` runs every five minutes and calls
`scripts/notify.mjs`, which today does nothing because no sink is configured. exdate knows
about a multiplier change about nine minutes before it happens, and nobody is being told.

Add repository secrets under **Settings → Secrets and variables → Actions**, either:

- `EXDATE_ALERT_WEBHOOK_URL` — a Discord or Slack incoming webhook, or any endpoint that
  accepts `{ content, text }`; or
- `EXDATE_TELEGRAM_BOT_TOKEN` **and** `EXDATE_TELEGRAM_CHAT_ID`.

Optionally set the repository *variable* `EXDATE_SITE_URL` so the notices link to the right
host. Nothing else changes: delivery is recorded in `data/effective-prices.observed.json`.

## 2. Let the site deploy itself

The Vercel project is **not connected to this repository**: it only updates when someone
deploys by hand. Seven collectors now commit data on their own schedules, so from here
every one of those commits makes the published pages staler than the record in git —
and "every number traces to a committed observation" stops being true once the two
disagree.

`.github/workflows/deploy-site.yml` fixes it and is already written. It needs three
things, none of which I can create:

- secret `VERCEL_TOKEN` — a durable token from <https://vercel.com/account/tokens>. The
  one used interactively expires after eight hours; an account token does not.
- variable `VERCEL_ORG_ID` = `team_yvcPXxh5OyD9bGT9ogPgtNEw`
- variable `VERCEL_PROJECT_ID` = `prj_k3kFLnvN5qsU47DHRGhowCN9Ev2n`

Secrets and variables live under **Settings → Secrets and variables → Actions**, on the
*Secrets* and *Variables* tabs respectively. Until they exist the workflow runs, says
what is missing, and exits without failing.

The alternative is to connect the project to GitHub from the Vercel dashboard, which
removes the need for the workflow entirely. It was recorded on 2026-09-03 that
git-connected deploys do not hit the `TEAM_ACCESS_REQUIRED` block that stops CLI
deploys here; that has not been tested since the collectors began committing under bot
names, so try one deploy before relying on it.

## 3. Host the API and the status page

`docker compose up -d` at the repository root brings up Postgres and the indexer, serving
`/v1` on port 42069 (`Dockerfile`, `docker-compose.yml`, and *Hosting* in the README). Needs
a server and a TLS proxy that forwards the client address in `X-Forwarded-For`, so anonymous
quotas count per visitor rather than per proxy. `EXDATE_API_KEYS` turns on keys and quotas.

Until this exists there is no public instance — the reference says so — and the signed
webhook outbox has still never delivered anything.

## 4. Choose a domain

`exdate.xyz` belongs to an unrelated site. The name stands; the domain does not.
`metadataBase` in `apps/web/app/layout.tsx` still names it and must change with the choice,
as must `packages/sdk/README.md` and any `api.` subdomain.

## 5. Publish the packages

Both are prepared: `publishConfig` swaps `main`, `types` and `exports` to a `dist/` that
`tsconfig.build.json` emits at publish time, checked with `pnpm pack`; the workspace keeps
consuming TypeScript source. With an npm account:

```bash
pnpm --filter @exdate/core publish
pnpm --filter @exdate/sdk publish   # pnpm rewrites the workspace: range
```

`packages/sdk/README.md` currently states that they are not published; update it after.

## 6. Have counsel read the issuer's terms

Robinhood's developer-documentation terms (RHDA, LLC, 2026-08-24) grant a personal,
revocable licence and forbid distributing "Robinhood Materials" to third parties or building
a competing product. The on-chain record is public and unaffected. Whether the archived
`/rhj` rows this repository redistributes — `data/corporate-actions.archive.json`,
`data/robinhood-assets.snapshot.json` — are such material is a question for counsel before
any of it is sold or licensed. The README states the question and does not answer it.
