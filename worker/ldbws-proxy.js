// Cloudflare Worker: a tiny secure proxy in front of the LDBWS API.
//
// The site itself (GitHub Pages) is static and can't hold the LDBWS API
// key without exposing it to every visitor. This Worker holds the key as
// an encrypted secret instead, and the page calls this Worker directly
// whenever the viewer wants truly live data (initial load, the refresh
// button, and the periodic auto-refresh), instead of waiting on GitHub
// Actions' own (occasionally delayed) schedule.
//
// Deploy: paste this file into a Cloudflare Worker (dashboard "Quick
// edit", or `wrangler deploy`), then set a CONSUMER_KEY secret on the
// Worker (Settings -> Variables -> encrypted). Update ALLOWED_ORIGINS
// below to match where the site is actually hosted.

const ALLOWED_ORIGINS = [
  'https://nevradonatwork.github.io',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
];

const LDBWS_BASE = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120';
const HUXLEY_BASE = 'https://huxley2.azurewebsites.net';

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Vary': 'Origin',
  };
}

function toMinutesOfDay(time) {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

function journeyMinutes(departureTime, arrivalTime) {
  if (!departureTime || !arrivalTime) return null;
  let diff = toMinutesOfDay(arrivalTime) - toMinutesOfDay(departureTime);
  if (diff < 0) diff += 24 * 60;
  return diff;
}

async function fetchWithTimeout(url, options, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLdbwsBoard(apiKey, endpoint, crs, filterType, filterCrs, numRows, timeOffset = 0, attempt = 1) {
  const url = `${LDBWS_BASE}/${endpoint}/${crs}?filterCrs=${filterCrs}&filterType=${filterType}&numRows=${numRows}&timeOffset=${timeOffset}`;
  const res = await fetchWithTimeout(url, { headers: { 'x-apikey': apiKey } }, 8000);

  if (!res.ok) {
    if (res.status >= 500 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
      return fetchLdbwsBoard(apiKey, endpoint, crs, filterType, filterCrs, numRows, timeOffset, attempt + 1);
    }
    throw new Error(`LDBWS ${endpoint} error ${res.status}`);
  }

  return res.json();
}

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

async function fetchFromLdbws(apiKey, from, to) {
  const data = await fetchLdbwsBoard(apiKey, 'GetDepartureBoard', from, 'to', to, 20);
  const trainServices = data.trainServices || [];

  if (!trainServices.length && !data.generatedAt) {
    throw new Error('LDBWS returned an empty response');
  }

  const arrivalTimes = {};
  let timeOffset = 0;

  for (let batch = 0; batch < 2; batch++) {
    let detailedServices;
    try {
      const detailedData = await fetchLdbwsBoard(apiKey, 'GetDepBoardWithDetails', from, 'to', to, 9, timeOffset);
      detailedServices = detailedData.trainServices || [];
    } catch {
      break;
    }

    for (const s of detailedServices) {
      if (!s.serviceID) continue;
      const arrivalTime = findArrivalTime(s, to);
      if (arrivalTime) arrivalTimes[s.serviceID] = arrivalTime;
    }

    if (!detailedServices.length) break;

    const first = detailedServices[0].std;
    const last = detailedServices[detailedServices.length - 1].std;
    timeOffset += journeyMinutes(first, last) + 1;
  }

  return dedupeAndMap(trainServices, arrivalTimes);
}

async function fetchHuxleyBoard(kind, crs, filterType, filterCrs, attempt = 1) {
  const url = `${HUXLEY_BASE}/${kind}/${crs}/${filterType}/${filterCrs}?numRows=20`;
  const res = await fetchWithTimeout(url, {}, 8000);

  if (!res.ok) {
    if (res.status >= 500 && attempt < 3) {
      await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
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

  const arrivalTimes = {};
  try {
    const arrivalsData = await fetchHuxleyBoard('arrivals', to, 'from', from);
    for (const s of arrivalsData.trainServices || []) {
      if (s.serviceID) arrivalTimes[s.serviceID] = s.sta;
    }
  } catch {
    // Duration just won't be available this round - not fatal.
  }

  return dedupeAndMap(trainServices, arrivalTimes);
}

const VALID_CRS = new Set(['NEM', 'WAT', 'RAY', 'VXH']);

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const headers = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers });
    }

    const url = new URL(request.url);
    const from = (url.searchParams.get('from') || '').toUpperCase();
    const to = (url.searchParams.get('to') || '').toUpperCase();

    if (!VALID_CRS.has(from) || !VALID_CRS.has(to) || from === to) {
      return new Response(JSON.stringify({ error: 'Invalid or missing from/to station codes.' }), {
        status: 400,
        headers: { ...headers, 'Content-Type': 'application/json' },
      });
    }

    let services;
    let source;

    try {
      services = await fetchFromLdbws(env.CONSUMER_KEY, from, to);
      source = 'ldbws';
    } catch (ldbwsErr) {
      try {
        services = await fetchFromHuxley(from, to);
        source = 'huxley2';
      } catch (huxleyErr) {
        return new Response(
          JSON.stringify({ error: `LDBWS: ${ldbwsErr.message} | Huxley2: ${huxleyErr.message}` }),
          { status: 502, headers: { ...headers, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response(JSON.stringify({ generatedAt: new Date().toISOString(), source, services }), {
      headers: { ...headers, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  },
};
