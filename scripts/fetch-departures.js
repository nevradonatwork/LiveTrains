const fs = require('fs');
const path = require('path');

const STATIONS = { NEM: 'New Malden', WAT: 'London Waterloo' };
const PAIRS = [
  ['NEM', 'WAT'],
  ['WAT', 'NEM'],
];

const OUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'departures.json');

async function fetchFromHuxley(from, to) {
  const url = `https://huxley2.azurewebsites.net/departures/${from}/to/${to}?expand=false&numRows=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!res.ok) {
    throw new Error(`Huxley2 error ${res.status}`);
  }

  const data = await res.json();
  const trainServices = data.trainServices || [];

  if (!trainServices.length && !data.generatedAt) {
    throw new Error('Huxley2 returned an empty response');
  }

  return trainServices.map((s) => ({
    scheduledTime: s.std,
    expectedTime: s.etd,
    platform: s.platform || 'TBC',
    operator: s.operator,
    destination: (s.destination && s.destination[0] && s.destination[0].locationName) || STATIONS[to],
    isCancelled: !!s.isCancelled,
  }));
}

async function fetchFromTransportApi(from, to) {
  const appId = process.env.TRANSPORTAPI_APP_ID;
  const appKey = process.env.TRANSPORTAPI_APP_KEY;

  if (!appId || !appKey) {
    throw new Error('TRANSPORTAPI_APP_ID / TRANSPORTAPI_APP_KEY not set');
  }

  const url = `https://transportapi.com/v3/uk/train/station/${from}/live.json?app_id=${appId}&app_key=${appKey}&calling_at=${to}&train_status=passenger`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`TransportAPI error ${res.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = await res.json();
  const all = (data.departures && data.departures.all) || [];

  return all.map((s) => {
    const status = (s.status || '').toUpperCase();
    const isCancelled = status === 'CANCELLED';
    const expected = s.expected_departure_time || s.aimed_departure_time;
    const onTime = !isCancelled && expected === s.aimed_departure_time;

    return {
      scheduledTime: s.aimed_departure_time,
      expectedTime: isCancelled ? 'Cancelled' : onTime ? 'On time' : expected,
      platform: s.platform || 'TBC',
      operator: s.operator_name,
      destination: s.destination_name || STATIONS[to],
      isCancelled,
    };
  });
}

async function fetchPair(from, to) {
  try {
    return await fetchFromHuxley(from, to);
  } catch (huxleyErr) {
    try {
      return await fetchFromTransportApi(from, to);
    } catch (transportErr) {
      console.error(`[${from}->${to}] Huxley2: ${huxleyErr.message} | TransportAPI: ${transportErr.message}`);
      return null;
    }
  }
}

async function main() {
  let existing = { generatedAt: null, routes: {} };

  try {
    existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  } catch {
    // No previous file yet - start fresh.
  }

  const routes = { ...existing.routes };
  let anySuccess = false;

  for (const [from, to] of PAIRS) {
    const services = await fetchPair(from, to);

    if (services) {
      routes[`${from}-${to}`] = { services };
      anySuccess = true;
    }
  }

  const output = {
    generatedAt: anySuccess ? new Date().toISOString() : existing.generatedAt,
    routes,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log('Wrote', OUT_PATH, anySuccess ? '(updated)' : '(kept previous data, both providers failed)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
