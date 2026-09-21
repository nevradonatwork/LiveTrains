# LiveTrains — notes for Claude

Read `WORKER_DEBUGGING_NOTES.md` too before touching anything related to
the Cloudflare Worker or its secrets — it has the full story behind the
decisions below.

## Architecture, in one paragraph

GitHub Pages (`docs/`) is static only — it never runs code, so the LDBWS
API key can never live there or in any file shipped to the browser. Two
separate systems hold the key server-side instead:

1. **GitHub Actions** (`.github/workflows/update-departures.yml`) — cron
   `*/5 * * * *`. On each run it calls LDBWS directly (Huxley2, then
   TransportAPI, as fallbacks) and commits the result to
   `docs/data/departures.json`. GitHub's scheduler is "best effort" and
   can lag from minutes to over an hour past its configured interval —
   this is a platform limitation, not a bug in this repo's config.
2. **Cloudflare Worker** (`worker/ldbws-proxy.js`, deployed at
   `https://livetrains.nevradonatwork.workers.dev`) — an always-on
   server. `docs/assets/board.js` calls it on page load, on the refresh
   button, and every 60s automatically while the page stays open — not
   only on click. It's not limited by GitHub's schedule. Falls back to
   Huxley2 if LDBWS fails, and the page falls back to the static
   `departures.json` if the Worker itself is unreachable.

## Deploying the Worker: GitHub Actions only, never Cloudflare's dashboard

The Worker deploys via `.github/workflows/deploy-worker.yml`, triggered
on push to files under `worker/**` or `wrangler.toml`, or manually. It:

```yaml
run: |
  npx wrangler deploy
  echo "${{ secrets.CONSUMER_KEY }}" | npx wrangler secret put CONSUMER_KEY
```

**Do not** try to set `CONSUMER_KEY` (or any other Worker secret) through
Cloudflare's own dashboard — three different-looking screens there
(Deployments' build config, the Bindings tab, the dashboard's own Deploy
command field) were each tried and none reliably got the secret into the
Worker's runtime `env`. Cloudflare's GitHub-connected "Workers Builds"
product also silently runs a **different** command (`wrangler versions
upload`, ignoring any custom deploy command) for every non-`main` branch
push, which made testing genuinely confusing — a preview build kept
looking like the real one. If the Worker's GitHub connection still exists
in Cloudflare's dashboard, it's redundant with `deploy-worker.yml` and
safe to disconnect, but isn't actively harmful either.

If `wrangler secret put` ever refuses with *"You attempted to modify a
secret, but the latest version of your Worker isn't currently
deployed"* — `wrangler deploy` must run **before** `wrangler secret put`,
not after.

## Required GitHub repo secrets

- `CONSUMER_KEY` — the LDBWS API key from raildata.org.uk (sent as the
  `x-apikey` header). Used by both `update-departures.yml` and
  `deploy-worker.yml`.
- `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` — for
  `deploy-worker.yml` to authenticate `wrangler`.
- `TRANSPORTAPI_APP_ID` / `TRANSPORTAPI_APP_KEY` — optional, last-resort
  fallback only, budgeted at 20/day in `scripts/fetch-departures.js`.

## Workflow for changes in this repo

Always PR + merge to `main`, never push straight to `main`. The
designated feature branch (`claude/new-malden-waterloo-trains-2q5v0v`)
gets reset from `origin/main` before each new change, since the
automated workflows commit directly to `main` and cause drift:

```
git stash -u && git fetch origin main && \
  git checkout -B claude/new-malden-waterloo-trains-2q5v0v origin/main && \
  git stash pop
```
