const fs = require('fs');
const path = require('path');

const PAIRS = [
  ['NEM', 'WAT'],
  ['WAT', 'NEM'],
];

const OUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'departures.json');
const LOG_PATH = path.join(__dirname, '..', 'docs', 'data', 'errors.txt');
const MAX_LOG_LINES = 200;

// Finds the calling point matching `crs` among a service's subsequent
// calling points (only present when the request used expand=true).
function findCallingPoint(service, crs) {
  const lists = service.subsequentCallingPoints || [];

  for (const list of lists) {
    const match = (list.callingPoint || []).find((p) => p.crs === crs);
    if (match) return match;
  }

  return null;
}

function toMinutesOfDay(time) {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function journeyMinutes(departureTime, arrivalTime) {
  if (!departureTime || !arrivalTime) return null;

  let diff = toMinutesOfDay(arrivalTime) - toMinutesOfDay(departureTime);
  if (diff < 0) diff += 24 * 60; // overnight service

  return diff;
}

async function fetchFromHuxley(from, to) {
  const url = `https://huxley2.azurewebsites.net/departures/${from}/to/${to}?expand=true&numRows=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!res.ok) {
    throw new Error(`Huxley2 error ${res.status}`);
  }

  const data = await res.json();
  const trainServices = data.trainServices || [];

  if (!trainServices.length && !data.generatedAt) {
    throw new Error('Huxley2 returned an empty response');
  }

  return trainServices.map((s) => {
    const arrival = findCallingPoint(s, to);

    return {
      scheduledTime: s.std,
      expectedTime: s.etd,
      platform: s.platform || 'TBC',
      operator: s.operator,
      durationMinutes: arrival ? journeyMinutes(s.std, arrival.st) : null,
      isCancelled: !!s.isCancelled,
    };
  });
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
      durationMinutes: null, // TransportAPI's live board doesn't expose calling-point arrival times
      isCancelled,
    };
  });
}

async function fetchPair(from, to, log) {
  try {
    return await fetchFromHuxley(from, to);
  } catch (huxleyErr) {
    try {
      return await fetchFromTransportApi(from, to);
    } catch (transportErr) {
      const message = `[${from}->${to}] Huxley2: ${huxleyErr.message} | TransportAPI: ${transportErr.message}`;
      console.error(message);
      log.push(message);
      return null;
    }
  }
}

function appendToLog(lines) {
  if (!lines.length) return;

  let existingLines = [];
  try {
    existingLines = fs.readFileSync(LOG_PATH, 'utf8').split('\n').filter(Boolean);
  } catch {
    // No previous log file yet.
  }

  const timestamp = new Date().toISOString();
  const newLines = lines.map((line) => `${timestamp} ${line}`);
  const combined = [...existingLines, ...newLines].slice(-MAX_LOG_LINES);

  fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
  fs.writeFileSync(LOG_PATH, combined.join('\n') + '\n');
}

async function main() {
  let existing = { generatedAt: null, routes: {} };

  try {
    existing = JSON.parse(fs.readFileSync(OUT_PATH, 'utf8'));
  } catch {
    // No previous file yet - start fresh.
  }

  const routes = { ...existing.routes };
  const errorLog = [];
  let anySuccess = false;

  for (const [from, to] of PAIRS) {
    const services = await fetchPair(from, to, errorLog);

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
  appendToLog(errorLog);
  console.log('Wrote', OUT_PATH, anySuccess ? '(updated)' : '(kept previous data, both providers failed)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
