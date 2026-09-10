# Dispatchr Status

The status page for [dispatchr.social](https://dispatchr.social), served at
**https://status.dispatchr.social** by a Cloudflare Worker (`worker/`).

A Workers cron probes each monitored endpoint **every minute** from the edge,
stores per-day aggregates in KV, and the same Worker renders the page and a
JSON API (`/api/status`). No CI runners are involved in monitoring.

## Monitored endpoints

| Site | URL |
|---|---|
| Website | https://dispatchr.social |
| API (DB-backed health) | https://dispatchr.social/api/health |

Edit the `SITES` list in `worker/src/index.mjs` to add or change monitors —
a push to `master` redeploys.

## Deployment

`.github/workflows/deploy-status.yml` deploys with wrangler on pushes that
touch `worker/`. Repo secrets `CLOUDFLARE_API_TOKEN` and
`CLOUDFLARE_ACCOUNT_ID` authenticate; the KV namespace
(`dispatchr-status-HISTORY`) is created automatically on first deploy.

### One-time cutover (from the old GitHub Pages site)

1. Delete the `status` DNS record for `dispatchr.social` that points at
   GitHub Pages — the Worker's `custom_domain` route cannot be provisioned
   while it exists.
2. Merge / run the deploy workflow. Wrangler creates the custom domain
   (DNS + certificate) automatically.
3. The page shows live state immediately; the 90-day uptime bars fill in as
   history accrues.

## History

This repo previously ran [Upptime](https://upptime.js.org) (seeded from the
capturly-status setup): GitHub Actions crons burning ~2.5k billed CI
minutes/month, committing results to `history/`, `graphs/`, and `api/`.
Those directories are kept as an archive of pre-cutover data; the workflows
and `.upptimerc.yml` were removed when the Worker took over (2026-09), the
same cutover capturly-status made. Uptime alerting is handled by Sentry
uptime monitors, not by this page.
