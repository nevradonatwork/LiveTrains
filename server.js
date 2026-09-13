const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const STATIONS = {
  NEM: 'New Malden',
  WAT: 'London Waterloo',
  RAY: 'Raynes Park',
};

app.use(express.static(path.join(__dirname, 'public')));

// Huxley2 is a free, open-source proxy in front of National Rail's live
// departure board feed - no API key needed, but it's a community demo
// with no uptime guarantee, so a TransportAPI account is a fallback (set
// TRANSPORTAPI_APP_ID / TRANSPORTAPI_APP_KEY in the environment, e.g. a
// local untracked .env file, to enable it).
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
  const upstream = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  if (!upstream.ok) {
    if (upstream.status >= 500 && attempt < 3) {
      await sleep(1000 * attempt);
      return fetchHuxleyBoard(kind, crs, filterType, filterCrs, attempt + 1);
    }
    const detail = await upstream.text().catch(() => '');
    throw new Error(`Huxley2 ${kind} error ${upstream.status}${detail ? `: ${detail}` : ''}`);
  }

  return upstream.json();
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
    for (const s of arrivalsData.trainServices || []) {
      if (s.serviceID) arrivalTimes[s.serviceID] = s.sta;
    }
  } catch {
    // Duration just won't be available this round - not fatal.
  }

  return {
    generatedAt: data.generatedAt || new Date().toISOString(),
    services: trainServices.map((s) => {
      const arrivalTime = s.serviceID ? arrivalTimes[s.serviceID] : null;

      return {
        scheduledTime: s.std,
        expectedTime: s.etd,
        platform: s.platform || 'TBC',
        operator: s.operator,
        durationMinutes: arrivalTime ? journeyMinutes(s.std, arrivalTime) : null,
        isCancelled: !!s.isCancelled,
      };
    }),
  };
}

async function fetchFromTransportApi(from, to) {
  const appId = process.env.TRANSPORTAPI_APP_ID;
  const appKey = process.env.TRANSPORTAPI_APP_KEY;

  if (!appId || !appKey) {
    throw new Error('TRANSPORTAPI_APP_ID / TRANSPORTAPI_APP_KEY not set');
  }

  const url = `https://transportapi.com/v3/uk/train/station/${from}/live.json?app_id=${appId}&app_key=${appKey}&calling_at=${to}&train_status=passenger`;
  const upstream = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!upstream.ok) {
    throw new Error(`TransportAPI error ${upstream.status}`);
  }

  const data = await upstream.json();
  const all = (data.departures && data.departures.all) || [];

  return {
    generatedAt: new Date().toISOString(),
    services: all.map((s) => {
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
    }),
  };
}

app.get('/api/departures/:from/:to', async (req, res) => {
  const from = String(req.params.from || '').toUpperCase();
  const to = String(req.params.to || '').toUpperCase();

  if (!STATIONS[from] || !STATIONS[to]) {
    return res.status(400).json({ error: 'Unknown station code.' });
  }

  const errors = [];

  for (const provider of [fetchFromHuxley, fetchFromTransportApi]) {
    try {
      const { generatedAt, services } = await provider(from, to);
      return res.json({
        from: { crs: from, name: STATIONS[from] },
        to: { crs: to, name: STATIONS[to] },
        generatedAt,
        services,
      });
    } catch (err) {
      errors.push(err.message);
    }
  }

  res.status(502).json({ error: `Could not reach a live departure board service: ${errors.join(' / ')}` });
});

app.listen(PORT, () => {
  console.log(`LiveTrains running on http://localhost:${PORT}`);
});
