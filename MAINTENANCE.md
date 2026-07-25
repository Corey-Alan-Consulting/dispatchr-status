# Maintenance notes (read before editing workflows)

This repo was generated from the [Upptime](https://upptime.js.org) template and
then **customized**. The Upptime self-regeneration has been intentionally
disabled so these customizations survive:

- `update-template.yml` → renamed to `update-template.yml.disabled`
- the "Update template" step was removed from `setup.yml`

If you re-enable either, the next run will overwrite the two changes below.

## Auth — GitHub App (no long-lived PAT)

Every workflow mints a short-lived, repo-scoped token at runtime via
`actions/create-github-app-token` instead of a personal `GH_PAT`. This is the
keyless-consistent choice (bot identity, 1-hour tokens, not tied to a user, and
App tokens *can* trigger the downstream workflows that `GITHUB_TOKEN` cannot).

Create a **GitHub App** (org: `Corey-Alan-Consulting`), install it on this repo,
and set two repo secrets:

| Secret | From |
| --- | --- |
| `UPPTIME_APP_ID` | the App's ID |
| `UPPTIME_APP_PRIVATE_KEY` | the App's generated private key (.pem contents) |

Required App **repository permissions**: Contents: Read/Write, Issues:
Read/Write, Actions: Read/Write (to trigger workflows), Metadata: Read.

## Deploy — Cloudflare Pages (not GitHub Pages)

`site.yml` and `setup.yml` deploy the built status site
(`site/status-page/__sapper__/export/`) to the Cloudflare Pages project
`dispatchr-status` via
`cloudflare/wrangler-action`. Set two more repo secrets:

| Secret | From |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | token with Account → Cloudflare Pages: Edit |
| `CLOUDFLARE_ACCOUNT_ID` | the Cloudflare account ID |

## Updating Upptime later

Re-applying an upstream Upptime version means manually re-doing the App-token
step and the Cloudflare deploy step in the regenerated workflows. Diff against
this repo's current workflows first.
