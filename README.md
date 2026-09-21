# LiveTrains

A live UK train departure board for three routes:

- New Malden ⇄ London Waterloo (main page)
- New Malden ⇄ Raynes Park (`/RaynesPark`)
- New Malden ⇄ Vauxhall (`/Vauxhall`)

Each page opens showing departures in one direction. A circular swap
button flips the view to the other direction, with platform, expected
status, and journey duration shown for each train. The board
auto-refreshes every 60 seconds.

## Running locally

```bash
npm install
npm start
```

Then open `http://localhost:3000` in your browser.

## Publishing on GitHub Pages

The `docs/` folder contains a fully static copy of the site, no backend
required. To publish it from GitHub's web interface:

1. Go to this repository's page on GitHub.
2. **Settings** &rarr; **Pages** in the left sidebar.
3. Under **Build and deployment**, set **Source** to **Deploy from a
   branch**.
4. Set **Branch** to `main` and the folder to `/docs`, then **Save**.
5. Within a few minutes the site is live at
   `https://<your-username>.github.io/LiveTrains/` (also shown at the
   top of the Pages settings screen).

## How the live data is updated

GitHub Pages only serves static files, so the page itself never calls
any live API directly. Instead, a **GitHub Actions** workflow
(`.github/workflows/update-departures.yml`) runs every 5 minutes, fetches
fresh data, and updates `docs/data/departures.json`; the page just reads
that file.

Data source priority:

1. **LDBWS**, via the [Rail Data Marketplace](https://raildata.org.uk)
   "Live Departure Board" product, National Rail's official, authenticated
   real-time Darwin feed. This is the primary, reliable source.
2. **[Huxley2](https://huxley2.azurewebsites.net)**, a free, keyless demo
   proxy in front of the same underlying Darwin feed, tried if LDBWS
   fails.
3. **TransportAPI**, tried as a last resort if both of the above fail,
   capped at a daily budget (max ~20 requests/day, safely under its
   30/day free-tier limit) so automation never risks exhausting the
   quota; if the budget is spent, the previously fetched data is kept.

This means short outages still get live data, while a long outage of
everything falls back to stale data rather than nothing. The
TransportAPI usage counter is tracked in
`docs/data/transportapi-usage.json`. Errors are logged to the workflow
run's own console output (visible under the repo's **Actions** tab)
rather than to a file in `docs/`, since that would otherwise be public
on the site along with anything an upstream API echoes back in an
error message.

### Journey duration

The subscribed "Live Departure Board" product only routes
departure-board endpoints, not a separate arrival board. Duration is
instead computed from `GetDepBoardWithDetails`, which lists each
service's subsequent calling points (including the scheduled arrival
time at the destination), matched back to the main departures list by
service ID. That endpoint caps `numRows` below 10 per call, so two
calls are chained together, the second starting right where the first
one's last train departs, to cover as much of the 20-row departures
list as possible without leaving a gap.

### Required secrets

This workflow needs a `CONSUMER_KEY` repository secret (see **Settings
→ Secrets and variables → Actions**), the API key issued by
raildata.org.uk for your LDBWS subscription, sent as the `x-apikey`
header. `TRANSPORTAPI_APP_ID` / `TRANSPORTAPI_APP_KEY` are optional,
only needed for the last-resort fallback. `server.js` (the local
`npm start` version) uses the same environment variables, but without
a daily budget cap, since local/manual use doesn't hit 30 requests a
day.

## Optional: truly live data via a Cloudflare Worker

GitHub Actions' `schedule` trigger is best-effort and can lag well past
its configured interval, so `docs/data/departures.json` can go stale.
`worker/ldbws-proxy.js` is a small Cloudflare Worker that holds the
LDBWS key server-side and proxies a live request straight from the
browser, so the page (initial load, the refresh button, and the
60-second auto-refresh) isn't limited by GitHub's schedule at all. It's
optional: if unset, the page just reads the static JSON file as usual.

The Worker is deployed by its own GitHub Actions workflow
(`.github/workflows/deploy-worker.yml`), not by connecting the repo to
Cloudflare's own "Workers Builds" GitHub integration — that route was
tried first, but Cloudflare's dashboard has multiple, confusingly
similar-looking places to set a "variable" (a build-config screen
under Deployments, a Bindings tab for resource bindings like D1/KV),
and none of them reliably made the secret reach the deployed Worker's
`env` at runtime. Setting it via `wrangler secret put` from GitHub
Actions instead reuses the same `CONSUMER_KEY` secret the LDBWS fetch
workflow already uses reliably.

To set it up:

1. Create a free account at [dash.cloudflare.com](https://dash.cloudflare.com)
   if you don't already have one.
2. **Workers & Pages** → **Create** → **Create Worker** (a blank one is
   fine, the workflow below overwrites it), give it a name matching
   `wrangler.toml`'s `name` field (`livetrains`), **Deploy**.
3. Get your **Account ID** (right sidebar of the Workers & Pages
   overview page).
4. Create an API token: **My Profile** → **API Tokens** → **Create
   Token** → the "Edit Cloudflare Workers" template (or a custom token
   with `Account.Workers Scripts: Edit` permission) → **Continue to
   summary** → **Create Token** → copy it (shown once).
5. In this GitHub repo: **Settings** → **Secrets and variables** →
   **Actions**, add two repository secrets: `CLOUDFLARE_ACCOUNT_ID`
   (from step 3) and `CLOUDFLARE_API_TOKEN` (from step 4). The
   `CONSUMER_KEY` secret from the LDBWS setup above is reused as-is,
   nothing new needed there.
6. Push (or manually run) the **Deploy Cloudflare Worker** workflow
   from the **Actions** tab.
7. Copy the Worker's URL (shown at the top of its page on Cloudflare,
   something like `https://livetrains.<your-subdomain>.workers.dev`).
8. In `docs/assets/board.js`, set `WORKER_URL` to that URL.
9. If the site isn't served from `https://<your-username>.github.io`,
   update `ALLOWED_ORIGINS` in `worker/ldbws-proxy.js` (and push) to
   match, otherwise the browser's CORS check will block it.

The Worker only proxies `GetDepartureBoard`/`GetDepBoardWithDetails`
(falling back to Huxley2 if LDBWS fails); it doesn't fall back to
TransportAPI, since that fallback's daily budget tracking needs
persistent storage that a stateless Worker request doesn't have. The
GitHub Actions workflow and static JSON file keep running regardless,
as the fallback path when the Worker itself is unreachable.
