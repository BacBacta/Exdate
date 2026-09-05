# Audit evidence — 2026-09-05

Evidence behind `docs/ux-audit-2026-09-05.md`. The four `.cjs` scripts reproduce it against the
live site (Chromium through the workspace proxy needs `--ssl-version-max=tls1.2`, which they set).

- `evidence.json` — per route: lab vitals, axe-core results, DOM inventory (headings, fold text,
  targets under 24 px, inputs, font sizes, landmarks), and the numbered screenshot list.
- `walkthrough.json` — the six tasks operated in a browser at 360 × 800, with timings and the
  texts met, plus keyboard-only passes. The wallet address used is a recent SGOV recipient read
  from the chain at run time and is not committed.
- `content.json` — readability (Flesch-Kincaid), jargon inventory and number samples per page,
  from the served HTML.
- `benchmarks.json` — the comparables opened the same day, with status, above-the-fold text and
  whether bot protection blocked the headless browser.
- `extra.json` — button contrast, horizontal overflow, token-page targets, wallet result text.
- `shots/` — the screenshots the report cites. The full set (154 + 14 + 17) was produced by
  `capture.cjs`, `walkthrough.cjs` and `benchmarks.cjs`; only the cited ones are committed.
