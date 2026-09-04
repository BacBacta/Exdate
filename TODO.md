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

## 2. Run the capture watcher on a machine — running; two settings left

**Done on 2026-09-04.** `scripts/watch-effective-prices.mjs` runs as `exdate-watcher.service` on a
Hetzner box (`ubuntu-4gb-fsn1-1`, Falkenstein, Ubuntu), started 20:14:39 UTC. The preflight passed
8/8 — node, the checkout, push access proved with a dry run, the chain, a live AAPL quote, and the
clock 0.5 s from the issuer's own — and its first heartbeat is committed, so the record itself is
the evidence that something is watching.

The day it went up supplied the measurement that justifies it. **UPS declared a dividend on
2026-09-04**: announced on chain at 15:00:41 UTC, effective at 15:10:26, a lead of 9 min 45 s.
GitHub's schedule did not fire inside it — the first quote it took was at **15:16:15, 350 seconds
after the instant**, far outside the two-minute tolerance, and the first sample also carried
`isTradingHalt: true`, which is a last price rather than a market. That step is recorded as
`givenUp`, with its reason, and its haircut cannot be computed from a quote: the issuer publishes
no price history, so the instant is gone. A 30-second tick would have had three samples inside it.

Two things left, both on GitHub rather than on the machine:

- set the repository *variable* `EXDATE_CAPTURE_MODE` to `watchdog` at
  <https://github.com/BacBacta/Exdate/settings/variables/actions/new>, so the scheduled job stops
  capturing on its own and starts checking this machine's heartbeat instead, alerting when it goes
  quiet. Until that is set, both are capturing; they share one file and merge by key, so nothing is
  lost either way — it is simply twice the work and no alarm if the machine dies;
- put an alert sink in `/opt/exdate/.env` (item 1 above) and `systemctl restart exdate-watcher`, so
  the nine-minute lead reaches someone instead of only the file.

### Rebuilding it, or adding a second machine

Any small Debian or Ubuntu VPS; 1 GB is plenty (the watcher measures 78 MB RSS). As root:

```bash
curl -fsSL https://raw.githubusercontent.com/BacBacta/Exdate/HEAD/deploy/install.sh | bash
```

It runs **twice on purpose**. The first pass installs what is missing, creates a service account and
generates a deploy key, then stops and prints the public half between two copy markers. Add that to
<https://github.com/BacBacta/Exdate/settings/keys/new> with **write access ticked** — the watcher
commits what it captures. The private half is generated on the machine and never leaves it, which
is why no key is handed to you from anywhere else. Run the same command again and it clones,
installs the service, runs the preflight and starts.

On Hetzner Cloud specifically, four choices matter and one of them costs money if you get it wrong:

| Choice | Take | Why |
|---|---|---|
| Public IP | **IPv4 on**, IPv6 optional | Verified over DNS: `github.com`, `ssh.github.com` and `api.robinhood.com` publish **no AAAA record**. An IPv6-only server cannot push, and cannot read the quote it exists to capture. Hetzner bills the IPv4 separately, and it is not optional here. |
| Image | Ubuntu 24.04 or newer | What `deploy/install.sh` expects and was exercised on. |
| Type | the smallest shared-vCPU | The watcher measures 78 MB. Prefer x86 (CX/CPX) over ARM (CAX) only if this box will later also run the API and Postgres from item 4. |
| Firewall | inbound 22 only; leave outbound alone | Hetzner's default firewall allows all outbound. If you add rules, the watcher needs outbound 443 and 22 (or 443 to `ssh.github.com`, which the installer falls back to). |

Add your SSH key in the creation form rather than taking a root password by email — and note that
**Hetzner's SSH keys are per project**, so a key registered in another project does not appear in
this one's form. If the server was created without one, rebuild it with a cloud-init `#cloud-config`
carrying `users:` / `ssh_authorized_keys:`; a password set by email will not work, because the image
disables password authentication.

`node scripts/check-watcher.mjs` answers "could this machine do the job" on demand: node, the
checkout, push access proved with a dry run, the chain, a real issuer quote, and the clock against
the issuer's own — the watcher wakes on that clock, so minutes of drift means missing windows.
Add `--send-test-alert` to prove delivery. `EXDATE_WATCH_PUSH=false` runs it without committing.

## 3. Optional: an archive endpoint you control

Two public third-party endpoints serve this chain's history and the project now uses one for the
wallet page and for `scripts/verify-multiplier-history.mjs`
(`data/rpc-endpoints.observed.json`). They cost nothing and carry no service commitment, which is
fine for history, since anything read from them can be re-read. Nothing is blocked on this.

Worth paying for only when you decide to index transfers, and the number to check first is not the
node: 7–13 M transfers a day is roughly 75 GB of database a month. Both QuickNode and Chainstack
list this chain; a keyless tier on the endpoint in use allows 300 requests a minute per IP.

## 4. Host the API and the status page

`docker compose up -d` at the repository root brings up Postgres and the indexer, serving
`/v1` on port 42069 (`Dockerfile`, `docker-compose.yml`, and *Hosting* in the README). Needs
a server and a TLS proxy that forwards the client address in `X-Forwarded-For`, so anonymous
quotas count per visitor rather than per proxy. `EXDATE_API_KEYS` turns on keys and quotas.

Until this exists there is no public instance — the reference says so — and the signed
webhook outbox has still never delivered anything.

## 5. Choose a domain — done: exdate.me

**Bought and live on 2026-09-04.** `exdate.me` resolves to Vercel and 308-redirects to
`https://www.exdate.me/`, which serves the site. `www` is therefore the canonical host and is what
`metadataBase` names; `NEXT_PUBLIC_EXDATE_SITE_URL` overrides it if that ever changes.

`exdate.xyz` from the 2026-09-02 naming decision belongs to an unrelated site and is now referenced
nowhere in the product.

Not deducing it from the platform was deliberate, and measured: `VERCEL_PROJECT_PRODUCTION_URL` is
documented as the project's production domain, and on the live build Vercel filled it with the
claimed `*.vercel.app` alias rather than the custom domain — so the share cards named the alias.
The canonical host is a fact, so it is written down.

Two subdomains are reserved by this choice and are not live yet: `api.exdate.me` and
`status.exdate.me`, both waiting on item 4.

## 6. Publish the packages

Both are prepared: `publishConfig` swaps `main`, `types` and `exports` to a `dist/` that
`tsconfig.build.json` emits at publish time, checked with `pnpm pack`; the workspace keeps
consuming TypeScript source. With an npm account:

```bash
pnpm --filter @exdate/core publish
pnpm --filter @exdate/sdk publish   # pnpm rewrites the workspace: range
```

`packages/sdk/README.md` currently states that they are not published; update it after.

## 7. Have counsel read the issuer's terms

Robinhood's developer-documentation terms (RHDA, LLC, 2026-08-24) grant a personal,
revocable licence and forbid distributing "Robinhood Materials" to third parties or building
a competing product. The on-chain record is public and unaffected. Whether the archived
`/rhj` rows this repository redistributes — `data/corporate-actions.archive.json`,
`data/robinhood-assets.snapshot.json` — are such material is a question for counsel before
any of it is sold or licensed. The README states the question and does not answer it.
