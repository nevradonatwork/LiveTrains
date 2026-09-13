const fs = require('fs');
const path = require('path');

const PAIRS = [
  ['NEM', 'WAT'],
  ['WAT', 'NEM'],
];

const OUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'departures.json');
const LOG_PATH = path.join(__dirname, '..', 'docs', 'data', 'errors.txt');
const MAX_LOG_LINES = 200;

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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The Huxley2 demo is documented as having "zero guarantees of uptime" and
// regularly returns transient 5xx errors, so a failed request gets a
// couple of quick retries before giving up.
async function fetchHuxleyBoard(kind, crs, filterType, filterCrs, attempt = 1) {
  const url = `https://huxley2.azurewebsites.net/${kind}/${crs}/${filterType}/${filterCrs}?numRows=20`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!res.ok) {
    if (res.status >= 500 && attempt < 3) {
      await sleep(1000 * attempt);
      return fetchHuxleyBoard(kind, crs, filterType, filterCrs, attempt + 1);
    }
    throw new Error(`Huxley2 ${kind} error ${res.status}`);
  }

  return res.json();
}

async function fetchFromHuxley(from, to) {
  const data = await fetchHuxleyBoard('departures', from, 'to', to);
  const trainServices = data.trainServices || [];

  if (!trainServices.length && !data.generatedAt) {
    throw new Error('Huxley2 returned an empty response');
  }

  // A second call to the destination's arrival board gives the scheduled
  // arrival time (sta) for each service, matched by serviceID, so we can
  // compute journey duration without needing calling-point details.
  const arrivalTimes = {};
  try {
    const arrivalsData = await fetchHuxleyBoard('arrivals', to, 'from', from);
    const arrivalServices = arrivalsData.trainServices || [];

    for (const s of arrivalServices) {
      if (s.serviceID) arrivalTimes[s.serviceID] = s.sta;
    }

    console.log(
      `[${from}->${to}] debug: ${trainServices.length} departures (sample serviceID=${trainServices[0]?.serviceID}), ` +
        `${arrivalServices.length} arrivals (sample serviceID=${arrivalServices[0]?.serviceID}, sample sta=${arrivalServices[0]?.sta})`
    );
  } catch (err) {
    console.log(`[${from}->${to}] debug: arrivals fetch failed: ${err.message}`);
  }

  return trainServices.map((s) => {
    const arrivalTime = s.serviceID ? arrivalTimes[s.serviceID] : null;

    return {
      scheduledTime: s.std,
      expectedTime: s.etd,
      platform: s.platform || 'TBC',
      operator: s.operator,
      durationMinutes: arrivalTime ? journeyMinutes(s.std, arrivalTime) : null,
      isCancelled: !!s.isCancelled,
    };
  });
}

// No fallback provider here on purpose: this script runs unattended every
// 5 minutes, and TransportAPI's free plan caps out at just 30 requests a
// day - a single Huxley2 outage windowed across a whole day of automated
// runs would blow through that budget almost immediately. If Huxley2
// fails, this pair just keeps whatever data it last had.
async function fetchPair(from, to, log) {
  try {
    const services = await fetchFromHuxley(from, to);
    console.log(`[${from}->${to}] used Huxley2, ${services.length} services`);
    return services;
  } catch (err) {
    const message = `[${from}->${to}] Huxley2: ${err.message}`;
    console.error(message);
    log.push(message);
    return null;
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
  console.log('Wrote', OUT_PATH, anySuccess ? '(updated)' : '(kept previous data, Huxley2 failed)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
