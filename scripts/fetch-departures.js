const fs = require('fs');
const path = require('path');

const PAIRS = [
  ['NEM', 'WAT'],
  ['WAT', 'NEM'],
  ['NEM', 'RAY'],
  ['RAY', 'NEM'],
  ['NEM', 'VXH'],
  ['VXH', 'NEM'],
];

const OUT_PATH = path.join(__dirname, '..', 'docs', 'data', 'departures.json');
const LOG_PATH = path.join(__dirname, '..', 'docs', 'data', 'errors.txt');
const USAGE_PATH = path.join(__dirname, '..', 'docs', 'data', 'transportapi-usage.json');
const MAX_LOG_LINES = 200;

// TransportAPI's free plan allows only 30 requests/day. Leave a safety
// margin under that so a Huxley2 outage never risks exhausting the quota
// the user might also be using manually elsewhere.
const TRANSPORTAPI_DAILY_BUDGET = 20;

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

// Official National Rail Darwin feed via the Rail Data Marketplace
// (raildata.org.uk), "Live Departure Board" product. Requires the
// LDBWS_API_KEY repo secret, sent as the x-apikey header.
const LDBWS_BASE = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120';

async function fetchLdbwsBoard(endpoint, crs, filterType, filterCrs, numRows, attempt = 1) {
  const apiKey = process.env.LDBWS_API_KEY;
  if (!apiKey) {
    throw new Error('LDBWS_API_KEY not set');
  }

  const url = `${LDBWS_BASE}/${endpoint}/${crs}?filterCrs=${filterCrs}&filterType=${filterType}&numRows=${numRows}`;
  const res = await fetch(url, {
    headers: { 'x-apikey': apiKey },
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    if (res.status >= 500 && attempt < 3) {
      await sleep(1000 * attempt);
      return fetchLdbwsBoard(endpoint, crs, filterType, filterCrs, numRows, attempt + 1);
    }
    const detail = await res.text().catch(() => '');
    throw new Error(`LDBWS ${endpoint} error ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`);
  }

  return res.json();
}

// Finds the scheduled arrival time at `destinationCrs` among a service's
// subsequent calling points (only present on the "WithDetails" endpoints).
function findArrivalTime(service, destinationCrs) {
  for (const list of service.subsequentCallingPoints || []) {
    for (const point of list.callingPoint || []) {
      if (point.crs === destinationCrs) return point.st;
    }
  }
  return null;
}

function dedupeAndMap(trainServices, arrivalTimes) {
  const seenServiceIDs = new Set();
  const uniqueServices = trainServices.filter((s) => {
    if (!s.serviceID) return true;
    if (seenServiceIDs.has(s.serviceID)) return false;
    seenServiceIDs.add(s.serviceID);
    return true;
  });

  return uniqueServices.map((s) => {
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

async function fetchFromLdbws(from, to) {
  const data = await fetchLdbwsBoard('GetDepartureBoard', from, 'to', to, 20);
  const trainServices = data.trainServices || [];

  if (!trainServices.length && !data.generatedAt) {
    throw new Error('LDBWS returned an empty response');
  }

  // The "Live Departure Board" product doesn't route GetArrivalBoard, so
  // duration comes from GetDepBoardWithDetails instead, matched by
  // serviceID, which lists each service's subsequent calling points
  // (including the scheduled arrival time at the destination). The
  // WithDetails endpoints cap numRows below 10.
  const arrivalTimes = {};
  try {
    const detailedData = await fetchLdbwsBoard('GetDepBoardWithDetails', from, 'to', to, 9);
    const detailedServices = detailedData.trainServices || [];
    let matched = 0;

    for (const s of detailedServices) {
      if (!s.serviceID) continue;
      const arrivalTime = findArrivalTime(s, to);
      if (arrivalTime) {
        arrivalTimes[s.serviceID] = arrivalTime;
        matched += 1;
      }
    }

    console.log(`[${from}->${to}] LDBWS debug: ${detailedServices.length} detailed services, ${matched} with a matched arrival time`);
  } catch (err) {
    console.log(`[${from}->${to}] LDBWS debug: details fetch failed: ${err.message}`);
  }

  return dedupeAndMap(trainServices, arrivalTimes);
}

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

  // Huxley2 occasionally lists the same physical service twice (e.g. once
  // per coupled portion). Keep only the first occurrence of each serviceID.
  return dedupeAndMap(trainServices, arrivalTimes);
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

function loadUsage() {
  const today = new Date().toISOString().slice(0, 10);

  try {
    const usage = JSON.parse(fs.readFileSync(USAGE_PATH, 'utf8'));
    if (usage.date === today) return usage;
  } catch {
    // No previous usage file yet.
  }

  return { date: today, count: 0 };
}

function saveUsage(usage) {
  fs.mkdirSync(path.dirname(USAGE_PATH), { recursive: true });
  fs.writeFileSync(USAGE_PATH, JSON.stringify(usage, null, 2) + '\n');
}

// Official LDBWS first (reliable, no daily cap under our subscription).
// If that fails, fall back to the free Huxley2 demo, then only spend
// TransportAPI quota (capped per day) as a last resort, so a long outage
// of everything else safely falls back to keeping whatever data was last
// fetched instead of ever risking the TransportAPI quota.
async function fetchPair(from, to, log, usage) {
  try {
    const services = await fetchFromLdbws(from, to);
    console.log(`[${from}->${to}] used LDBWS, ${services.length} services`);
    return services;
  } catch (ldbwsErr) {
    try {
      const services = await fetchFromHuxley(from, to);
      console.log(`[${from}->${to}] used Huxley2, ${services.length} services`);
      return services;
    } catch (huxleyErr) {
      if (usage.count >= TRANSPORTAPI_DAILY_BUDGET) {
        const message = `[${from}->${to}] LDBWS: ${ldbwsErr.message} | Huxley2: ${huxleyErr.message} (TransportAPI daily budget used up, kept previous data)`;
        console.error(message);
        log.push(message);
        return null;
      }

      try {
        const services = await fetchFromTransportApi(from, to);
        usage.count += 1;
        console.log(`[${from}->${to}] used TransportAPI (${usage.count}/${TRANSPORTAPI_DAILY_BUDGET} today), ${services.length} services`);
        return services;
      } catch (transportErr) {
        const message = `[${from}->${to}] LDBWS: ${ldbwsErr.message} | Huxley2: ${huxleyErr.message} | TransportAPI: ${transportErr.message}`;
        console.error(message);
        log.push(message);
        return null;
      }
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
  const usage = loadUsage();
  let anySuccess = false;

  for (const [from, to] of PAIRS) {
    const services = await fetchPair(from, to, errorLog, usage);

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
  saveUsage(usage);
  console.log('Wrote', OUT_PATH, anySuccess ? '(updated)' : '(kept previous data, Huxley2 failed)');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
