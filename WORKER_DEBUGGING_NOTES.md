# Cloudflare Worker setup: why it took so long, and how it was actually fixed

This documents the Cloudflare Worker (`worker/ldbws-proxy.js`) setup saga,
so the reasoning doesn't get lost. Not part of the published site (it lives
outside `docs/`).

## The underlying architecture question

GitHub Pages only serves static files, it never *runs* code. So the LDBWS
API key can't live in `docs/` — any JavaScript shipped to the browser is
visible to anyone who views the page source, key included. The key has to
stay on a real server we control, one that runs code on request instead of
just handing back files. That's what GitHub Actions and the Cloudflare
Worker are each for:

- **GitHub Actions** (`.github/workflows/update-departures.yml`): spins up
  a temporary machine every 5 minutes, runs `scripts/fetch-departures.js`
  with the key as a secret environment variable, writes the result to
  `docs/data/departures.json`, then shuts down. Not a live server — just a
  periodic batch job.
- **Cloudflare Worker** (`worker/ldbws-proxy.js`): an actual always-on
  server. The browser calls it directly (on page load, refresh click, and
  every 60s), it holds the key server-side, and returns live data on the
  spot — not limited by GitHub Actions' 5-minute (and sometimes delayed)
  schedule.

## Why setting the Worker's secret took so many attempts

Three different places in Cloudflare's dashboard looked like "the" place
to add `CONSUMER_KEY`, and none of them actually worked:

1. **Workers & Pages → livetrains → Deployments → build config.** This
   screen (with an "API token" field for `wrangler`'s own build
   authentication) sets variables for the *build step* only — the
   `npx wrangler deploy` process itself — not the deployed Worker's
   runtime `env`. A secret added here never reaches
   `env.CONSUMER_KEY` inside `fetch(request, env)`.
2. **The "Bindings" tab.** This is for resource bindings — D1 databases,
   KV namespaces, R2 buckets — not plain secret strings. Cloudflare's own
   example code shown there was a D1 query snippet, a clear sign it was
   the wrong tab for a simple API key.
3. **`echo "$CONSUMER_KEY" | npx wrangler secret put CONSUMER_KEY` as part
   of the dashboard's own "Deploy command" field.** This was the right
   *idea*, but Cloudflare's GitHub-connected "Workers Builds" product
   triggers a **preview** build (`wrangler versions upload`, ignoring the
   custom deploy command entirely) for every push to a non-`main` branch —
   including this project's every feature-branch push, before each PR
   merge. Checking the newest deployment in the list kept surfacing that
   preview build instead of the real production one, so it looked like
   the fix wasn't taking effect when it just hadn't actually run yet on
   `main`.

## What actually fixed it

Stopped trying to get Cloudflare's dashboard to do this at all. Moved the
Worker's deploy to its own GitHub Actions workflow
(`.github/workflows/deploy-worker.yml`), authenticating with a Cloudflare
API token, and setting the secret via the `wrangler` CLI directly:

```yaml
- name: Deploy Worker and set CONSUMER_KEY secret
  env:
    CLOUDFLARE_API_TOKEN: ${{ secrets.CLOUDFLARE_API_TOKEN }}
    CLOUDFLARE_ACCOUNT_ID: ${{ secrets.CLOUDFLARE_ACCOUNT_ID }}
  run: |
    npx wrangler deploy
    echo "${{ secrets.CONSUMER_KEY }}" | npx wrangler secret put CONSUMER_KEY
```

This reuses the same `CONSUMER_KEY` GitHub secret the LDBWS fetch workflow
already used reliably for weeks — no new dashboard navigation, no
ambiguity about which of three similar-looking screens is the real one.

One more error surfaced even here: `wrangler secret put` refused to run
the first time, `"You attempted to modify a secret, but the latest
version of your Worker isn't currently deployed."` — a side effect of all
those earlier preview builds leaving the Worker in an "uploaded but not
deployed" state. The fix was ordering: `wrangler deploy` **first** (so the
latest version becomes the actually-deployed one), *then*
`wrangler secret put`. Doing it in the opposite order is what every
earlier attempt had implicitly done.

## Confirmed working

```json
{"generatedAt":"2026-09-21T17:27:34.758Z","source":"ldbws","services":[...]}
```

`source: "ldbws"` with real `durationMinutes` values, not falling back to
Huxley2.
