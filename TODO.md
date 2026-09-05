# What needs the owner

Everything here is blocked on a decision, an account or a payment, not on code. The code
side of each is already in the repository and named below. Delete an entry when it is done.

## 1. Arm the alerts — one paste, and the machine dying is already covered

Two different notices, and only one of them still needs you.

**A dead watcher now raises an alarm with no configuration at all.** The scheduled job runs in
watchdog mode by default and, if it finds the heartbeat stale and no sink took the notice, it
**fails on purpose** — after committing whatever it captured in the watcher's place, so nothing is
lost. GitHub emails the repository owner when a scheduled workflow fails, which is a channel that
needs no setup. Exercised through all four states: no watchdog block, watcher alive, watcher silent
with nobody told (fails), watcher silent with a notice delivered (does not fail).

**The nine-minute lead still reaches nobody.** exdate learns of a multiplier change about nine
minutes before it takes effect, and that is the perishable one. Add repository secrets under
**Settings → Secrets and variables → Actions** - and that is the only place: since 2026-09-05 the
machine gets them from there, encrypted to its own deploy key by `deliver-secrets.yml` and applied
by the installer (`deploy/keys/README.md`). Nothing is typed into the machine. Either:

- `EXDATE_ALERT_WEBHOOK_URL` — a Discord or Slack incoming webhook, or any endpoint that
  accepts `{ content, text }`; or
- `EXDATE_TELEGRAM_BOT_TOKEN` **and** `EXDATE_TELEGRAM_CHAT_ID`.

Then **Actions → deliver-secrets → Run workflow**, and on the machine
`curl … install.sh | bash` once more: it decrypts what was delivered, writes `.env` and restarts.
`node scripts/check-watcher.mjs --send-test-alert` proves delivery rather than assuming it.

Optionally set the repository *variable* `EXDATE_SITE_URL` so the notices link to the right
host. Delivery is recorded in `data/effective-prices.observed.json`.

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

**`EXDATE_CAPTURE_MODE` no longer needs setting.** The workflow defaults to `watchdog` since
2026-09-04, because a watcher exists and the default should describe reality rather than the state
the repository was in before it did. The repository variable still wins if it is ever set, so
`EXDATE_CAPTURE_MODE=capture` turns the scheduled job back into the capturer if this machine is
retired.

One thing left: put an alert sink in `/opt/exdate/.env` (item 1 above) and `systemctl restart
exdate-watcher`, so the nine-minute lead reaches someone instead of only the file.

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

**Never run `git` as root in `/opt/exdate`.** The checkout belongs to the `exdate` service account,
which pushes from it; one root-run `git pull` leaves root-owned files under `.git/objects` and every
later fetch dies with *insufficient permission for adding an object to repository database*. The
installer now detects and repairs that before fetching, so re-running it is the fix — but the way to
update this checkout is the installer, not git by hand.

`node scripts/check-watcher.mjs` answers "could this machine do the job" on demand: node, the
checkout, push access proved with a dry run, the chain, a real issuer quote, and the clock against
the issuer's own — the watcher wakes on that clock, so minutes of drift means missing windows.
Add `--send-test-alert` to prove delivery. `EXDATE_WATCH_PUSH=false` runs it without committing.

## 3. An RPC provider with a commitment — the code already puts a third party first

**Done in code on 2026-09-04, for a terms reason** (`docs/terms-review.md` §2): Robinhood's public
RPC is a "Service" bound to "testing, experimentation, evaluation, and development" and "not
intended for production-grade" use, while the chain itself is expressly outside the Terms. So every
production read now goes to a measured third-party endpoint first — `robinhood.api.pocket.network`,
which serves state at any height, reaches the oldest step and takes the same 2 000 000-block
`eth_getLogs` as Robinhood's — and touches Robinhood's endpoint only when that one fails. The order
lives in `scripts/phase0/rpc.mjs` (the watcher, the collectors, every script) and in the indexer's
`failoverHttp` (`packages/core/src/transport.ts`, viem `fallback` over the throttled transport);
`RHC_RPC_URLS` overrides it. Verified: the helper answered `chainId 4663` from pocket in 714 ms, and
Ponder came up on the composed transport, 194/194 tokens polled, zero errors in its log.

**Sizing, measured on 2026-09-04 against Alchemy's published free tier (30 M compute units a month,
25 requests a second)**: the watcher is 6.0 M CU (20 %), every GitHub collector together 1.5 M
(5 %), and the indexer 102.6 M (342 %). So a free key covers the watcher and the collectors — the
reads that cannot be re-done — with room to spare, and only the indexer would need paying for,
about $29 a month at $0.40/M beyond the free tier. Check any keyed URL with
`node scripts/probe-endpoint.mjs` before wiring it: it prints where that endpoint can go and never
prints the URL, so its output is safe to paste anywhere.

**Left to you: Alchemy's Pay As You Go, about $3 a month.** Measured against a real key on
2026-09-04 with `scripts/probe-endpoint.mjs`, and the deciding number is one Alchemy publishes
itself: on **Robinhood Mainnet** their `eth_getLogs` block range is **10 on the free tier and
unlimited on Pay As You Go**. Ten blocks is not a small cap, it is a different product — the
watcher's own scan of the blocks since its last tick is about 200, so `getLogsPaged` would split it
into roughly 63 calls, and the watcher alone would cost **327 M compute units a month against a
30 M free allowance**. On Pay As You Go the same scan is one call: **6.0 M CU for the watcher,
1.5 M for every GitHub collector, so 7.5 M in total — about $3 a month at $0.40/M**, and the
throughput needed is 4 requests a second against 300 CU/s.

The rest of the free-tier probe was good: it answers `eth_call` at the oldest multiplier step in
49 ms, which beats the third-party archive endpoints, and it has no wildcard CORS, which is right
for a keyed URL and costs nothing here because only servers use it.

**Applying the key - the URL is never typed into a terminal.** Three attempts at that on a phone
produced three different corruptions (20 characters where 32 belong, a quote riding along, half the
line echoed as a command) and every one answered 401 like a bad key. So the key goes into a browser
form once, and the machine fetches it:

1. Repository secret `RHC_RPC_URLS` =
   `https://robinhood-mainnet.g.alchemy.com/v2/YOUR_KEY,https://rpc.mainnet.chain.robinhood.com`
   at <https://github.com/BacBacta/Exdate/settings/secrets/actions/new>.
2. On the machine, `curl … install.sh | bash` - it publishes the machine's public key to
   `deploy/keys/`, which triggers `deliver-secrets.yml` to encrypt the secret to it and commit the
   ciphertext.
3. About a minute later, the same command again: it decrypts, **probes the endpoint against the
   watcher's own scan**, writes both `RHC_RPC_URLS` and `RHC_RPC_URL_ARCHIVE` only if that passes,
   and restarts. A refused value leaves `.env` untouched and says why.

The same secret feeds the GitHub collectors directly. Robinhood's endpoint stays last in the list
so a provider outage cannot lose a capture. `deploy/set-rpc.sh` remains for a machine without the
channel: it asks for the key with echo off and applies the same gate.

The GitHub collectors read the chain too — about 1.5 M compute units a month between them — and
every workflow that touches it now passes the **repository secret `RHC_RPC_URLS`**. Set it to the
same comma-separated pair at
<https://github.com/BacBacta/Exdate/settings/secrets/actions/new>. With the secret unset the
workflows keep the built-in order, verified: an empty value falls through to
`pocket.network → Robinhood`, so wiring it changed nothing until there is something to wire.

The indexer is the one deliberate exception, at 102.6 M CU a month (~$41). It stays on the public
failover in `/opt/exdate-api/.env` unless that is worth paying for; the same two lines move it.

The indexer would add 102.6 M CU a month, about $41 — leave it on the public failover unless that
is worth paying for.

The other providers on <https://docs.robinhood.com/chain/run-a-full-node> — Quicknode, Chainstack,
dRPC, Blockdaemon, Validation Cloud, GlobalStake — were not probed with a key. `probe-endpoint.mjs`
answers the same question for any of them without printing the URL.

Not worth doing: a node of your own. Robinhood's page asks for 64 GB RAM, several terabytes of NVMe
and an Ethereum L1 endpoint, and says "if you just need an RPC endpoint, use the public endpoints or
a provider".

Transfer indexing is a separate question with a separate cost — roughly 75 GB of database a month —
and nothing here changes it.

## 4. Host the API and the status page — done, live

Everything between "the containers run" and "someone can call it" now exists and was exercised here
with a real Docker daemon, not read:

- `deploy/Caddyfile` terminates TLS for `api.exdate.me` and `status.exdate.me` and proxies to the
  compose network. Validated against `caddy:2-alpine`: *Valid configuration*.
- `deploy/status.Dockerfile` builds the status page as a Next standalone server that reads
  `http://indexer:42069` over the compose network, so the API's address never reaches a browser.
- Two compose profiles: `public` adds Caddy and the status page; `watcher` gates the watcher, which
  used to start with everything else and must not, since this machine runs it under systemd.
- The indexer's port moved to `127.0.0.1:42069`. It was published on every interface.

**Rehearsed end to end here**: both images build, Postgres + the indexer come up, `/v1/health`
answers, `/v1/chains` and `/v1/robinhood/tokens` serve 194 polled tokens with the three
`X-RateLimit-*` headers and CORS, an unknown path is a JSON 404, the reconcile pass produces **51
reconciliations** (2 matched, 5 anomaly, 38 pending, 6 unmatched) and the status page renders them
against the live API. Two real defects were found by doing it rather than by reading: both
Dockerfiles were missing `tsconfig.base.json` from their build context, and the reconciliation row
was dropping `feedCorroboratedBy` at the database (see the decision log for 2026-09-04).

**What is left is one DNS record and one command.** Point both names at the machine:

```
api.exdate.me     A    2.28.43.138
status.exdate.me  A    2.28.43.138
```

then, as root on that machine:

```bash
curl -fsSL https://raw.githubusercontent.com/BacBacta/Exdate/HEAD/deploy/install-api.sh | bash
```

It installs Docker, **refuses if either name does not resolve to this machine** — asking Let's
Encrypt for a certificate it cannot prove is rate-limited per domain, so that check is the one worth
having — refuses if anything already holds 80 or 443, generates the Postgres password into `.env`
without printing it, and proves the result by calling `/v1/health` locally and then over https.

It uses **its own checkout at `/opt/exdate-api`**, not the watcher's at `/opt/exdate`, and resets it
to the branch tip on every run. The first version shared the watcher's, fetched without updating the
working tree, and so built a `docker-compose.yml` that predated the public profile: Caddy and the
status page never started, and the watcher — ungated in that older file — came up a second time
beside the systemd one. The script now refuses `EXDATE_DIR` pointing at the watcher's directory,
stops anything still running out of it, and **asserts what came up**: `db`, `indexer`, `status` and
`caddy` running, `watcher` not. "Containers up" was true of the run that got it wrong.

**Re-running that one command is the upgrade**, and since 2026-09-05 it is also the last one you
have to run: the installer registers `exdate-api-update.timer`, which every quarter of an hour asks
whether the branch moved and rebuilds when a commit changed what the image contains. That filter is
the point — the API compiles the generated registry INTO its image, so the corroboration of every
token → feed pairing is code as far as the container is concerned, and an API deployed on Tuesday
serves Tuesday's corroboration for as long as it runs. The data audit measured exactly that: a
registry three days old and `feedCorroboratedBy: []` on rows every other surface called
corroborated. A rebuild on *every* commit would be the other failure — the collectors push up to two
dozen times a day and each rebuild costs the indexer a reconnect — so `data/`-only commits are
skipped, which is safe because nothing the container runs reads `data/` (checked, not assumed).

```bash
journalctl -u exdate-api-update -f      # what the timer is doing
/opt/exdate-api/deploy/update-api.sh --force   # rebuild now
```

`deploy/update-api.sh` was rehearsed against a real git repository with `docker` and `curl` stubbed:
nothing new → says so and exits; a `data/`-only commit → moves the checkout forward without
rebuilding; a commit touching `packages/` → rebuilds; and it dies rather than reporting success when
a service is missing, when the watcher comes up beside the systemd one, when the API never answers,
when `EXDATE_DIR` points at the watcher's checkout, and when there is no checkout at all.

**Live since 2026-09-04**: `https://api.exdate.me` and `https://status.exdate.me`, on the same
Hetzner machine as the watcher, which is untouched and still under systemd. Verified from outside:
`/v1/health` 200 over HTTP/2, CORS open, the three `X-RateLimit-*` headers present, plain HTTP 308s
to HTTPS, the status page 200. The certificate was validated by the machine's own `curl` — a check
from this workspace only sees its egress proxy's certificate, so that is stated rather than claimed.

The quotas now matter. `EXDATE_ANON_RPM` is the anonymous rate per client address read from
`X-Forwarded-For`, which Caddy sets; `EXDATE_API_KEYS` (`key:label:rpm`, comma separated) turns on
keys. It is one small machine with no availability commitment, and the README, the reference and the
SDK README all say so rather than implying a service.

Still not delivered by anything: the signed webhook outbox. It needs a receiver in
`EXDATE_WEBHOOK_ENDPOINTS`, which is a consumer, not a deployment.

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

## 6. Publish the packages — one workflow run, and one thing to create first

`.github/workflows/publish-packages.yml` publishes both packages from CI, so the npm token stays a
repository secret and never reaches a terminal — the same reason the RPC key travels encrypted
rather than being typed on the machine. It is **dispatched by hand and dry-run by default**, because
a published version cannot be republished.

**Before the first run, two things only you can do:**

1. **Create the `exdate` organisation on npm** — <https://www.npmjs.com/org/create>, free for public
   packages. A scoped name like `@exdate/core` needs either an org of that name or an account
   *named* `exdate`; checked on 2026-09-05, `@exdate/core` and `@exdate/sdk` are both free, and the
   unscoped `exdate` is taken by an unrelated date library, which is why the scope exists.
2. **Repository secret `NPM_TOKEN`** — read from npm's own documentation on 2026-09-05, because
   the obvious answer is out of date: **classic and Automation tokens were removed in November
   2025**; only *granular access tokens* exist now. Create one at Access Tokens → Generate New
   Token → Granular, with:

   | Field | Value | Why |
   |---|---|---|
   | Permissions | **Read and write** | read-only cannot publish |
   | Packages and scopes | **the `@exdate` scope**, not a package | the packages do not exist yet, so there is nothing to select by name; a scope covers what it will contain |
   | Organizations | leave empty | npm is explicit: organization access *"does not give the token the right to publish packages managed by the organization"* — a real trap, since granting the org looks like the generous choice and grants nothing here |
   | Bypass 2FA | **on**, if your account has 2FA | off by default, and a CI publish has nobody to answer the prompt |
   | Expiration | as short as you will tolerate | it is deletable the moment the first publish succeeds — see below |

   Add it at <https://github.com/BacBacta/Exdate/settings/secrets/actions/new>. Deliberately *not*
   in `deliver-secrets.yml`: the watcher machine publishes nothing and must never hold it.

   **Then delete it.** Once each package exists, npm supports *trusted publishing*: OIDC from
   GitHub Actions, no long-lived token at all, configured per package under its settings on
   npmjs.com (Organization / Repository / Workflow filename). npm's own guidance is to prefer it
   over a bypass-2FA token for CI. It cannot be set up before the first publish — the package
   settings page does not exist yet — which is the only reason a token is needed at all. Note for
   that day: `pnpm publish` documents `--provenance` but not OIDC, so the workflow will likely need
   `npm publish` for the trusted-publishing path.

**Then:** Actions → publish-packages → Run workflow, `dry_run` **ticked**. It typechecks, tests,
builds, packs, prints every file that would leave and the rewritten manifest, and fails if a tarball
carries uncompiled sources or an unresolved `workspace:` range. Read that output, then re-run with
`dry_run` unticked.

Order is not a preference: `@exdate/sdk` depends on `@exdate/core`, and pnpm rewrites `workspace:*`
to the exact version at pack time, so core must reach the registry first. The workflow does that.

Verified locally on 2026-09-05: core packs to 116 KB and sdk to 16 KB, `dist/` and `README.md` and
`LICENSE` only, no `.ts` sources, and the sdk's manifest correctly asks for `@exdate/core@0.1.0`.
Both carry a description, keywords, homepage, author, repository and licence, and `--provenance`
ties each tarball to the workflow run that built it.

After the first publish, `packages/sdk/README.md` still says "Until the package is on npm, add it
from the workspace" — delete that sentence.

## 7. Have counsel read the issuer's terms — the reading is done, the questions are written

`docs/terms-review.md` reads the Robinhood Chain Terms of Service (RHDA, LLC, *Last Updated:
August 24, 2026*) against an inventory of what exdate actually does, taken from the code. It is not
legal advice; it is what makes counsel's hour count. The short version:

- **The chain itself is expressly outside the Terms** (§2.1). Every on-chain measurement is public
  state. What is a Service is the **Public RPC** — "not intended for production-grade" use — and the
  **`/rhj` API**, whose output is, on the conservative reading, "Robinhood Materials".
- **§2.4(a) binds every Service to "testing, experimentation, evaluation, and development"**, which a
  public product is not. On the chain side that is cured by reading through a node exdate runs or a
  third-party endpoint (item 3 above stops being optional). On the `/rhj` side there is no substitute.
- **§5.2 is contractual and non-sublicensable**: the exposure is revocation, blocking and the
  indemnity, personal to exdate — not a claim over facts. And exdate cannot license on the issuer's
  fields it republishes, so any data licence must carve them out by column.
- **§5.7(j) forbids "tokenized stocks / equities"** as a description of Stock Tokens. The site's
  title is *see what your tokenized stock actually paid you*. Owner's call: change the words or
  accept the risk knowingly. **§5.7(b)(ii) requires a not-affiliated disclaimer**, which is absent.
- **No `LICENSE` file exists** while three packages claim MIT; the data has no licence at all.
- **EU database right** (Directive 96/9/EC) is a separate question the US Terms do not address.
- **Arbitration opt-out closes on 2026-10-31** (§12.13, sixty days from first access, by post only).

Cheap and lawyer-free, in the order Appendix A of the review gives them — **done on 2026-09-04
unless marked**: production reads moved off Robinhood's RPC in code (item 3); the disclaimer; the
wording ("Stock Tokens" everywhere Robinhood's product is described); the `LICENSE` file (MIT, as the
packages already claimed); the issuer's files withheld from the site's `/data/` mirror; a data
licence with a `source` carve-out (`DATA-LICENSE.md`). **Still yours**: the email in Appendix B, the
arbitration notice in Appendix C before 2026-10-31, and a provider account (item 3). For counsel, in order: is `/rhj` a Service; does §2.4 permit a
production product; the republication as it stands; the EU right; what can be licensed; the
opt-out; Chainlink's terms, which render in JavaScript and were not readable from the workspace.
And one option that changes the whole picture: §5.11 gives `robinhoodchain@robinhood.com` — a
written permission turns most of this into a document.

