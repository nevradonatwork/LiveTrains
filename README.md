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
`docs/data/transportapi-usage.json`. Errors are logged with timestamps
to `docs/data/errors.txt`, viewable directly in the browser at
`https://<your-username>.github.io/LiveTrains/data/errors.txt`.

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
