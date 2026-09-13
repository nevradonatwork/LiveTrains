const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const STATIONS = {
  NEM: 'New Malden',
  WAT: 'London Waterloo',
};

app.use(express.static(path.join(__dirname, 'public')));

// Huxley2 is a free, open-source proxy in front of National Rail's live
// departure board feed - no API key needed, but it's a community demo
// with no uptime guarantee, so TransportAPI's sandbox key is a fallback.
async function fetchFromHuxley(from, to) {
  const url = `https://huxley2.azurewebsites.net/departures/${from}/to/${to}?expand=false&numRows=10`;
  const upstream = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(10000),
  });

  if (!upstream.ok) {
    const detail = await upstream.text().catch(() => '');
    throw new Error(`Huxley2 error ${upstream.status}${detail ? `: ${detail}` : ''}`);
  }

  const data = await upstream.json();
  const trainServices = data.trainServices || [];

  if (!trainServices.length && !data.generatedAt) {
    throw new Error('Huxley2 returned an empty response');
  }

  return {
    generatedAt: data.generatedAt || new Date().toISOString(),
    services: trainServices.map((s) => ({
      scheduledTime: s.std,
      expectedTime: s.etd,
      platform: s.platform || 'TBC',
      operator: s.operator,
      destination: (s.destination && s.destination[0] && s.destination[0].locationName) || STATIONS[to],
      isCancelled: !!s.isCancelled,
    })),
  };
}

async function fetchFromTransportApi(from, to) {
  const url = `https://transportapi.com/v3/uk/train/station/${from}/live.json?app_id=test&app_key=test&calling_at=${to}&train_status=passenger`;
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
        destination: s.destination_name || STATIONS[to],
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
