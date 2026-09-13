const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Huxley2 is a free, open-source proxy in front of National Rail's live
// departure board feed, it does not require an API key for basic lookups.
const HUXLEY_BASE = 'https://huxley2.azurewebsites.net';

const STATIONS = {
  NEM: 'New Malden',
  WAT: 'London Waterloo',
};

app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/departures/:from/:to', async (req, res) => {
  const from = String(req.params.from || '').toUpperCase();
  const to = String(req.params.to || '').toUpperCase();

  if (!STATIONS[from] || !STATIONS[to]) {
    return res.status(400).json({ error: 'Unknown station code.' });
  }

  const url = `${HUXLEY_BASE}/departures/${from}/to/${to}?expand=false&numRows=10`;

  try {
    const upstream = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!upstream.ok) {
      const detail = await upstream.text().catch(() => '');
      return res.status(502).json({ error: `Upstream error (${upstream.status}).${detail ? ` ${detail}` : ''}` });
    }

    const data = await upstream.json();

    const services = (data.trainServices || []).map((s) => ({
      scheduledTime: s.std,
      expectedTime: s.etd,
      platform: s.platform || 'TBC',
      operator: s.operator,
      destination: (s.destination && s.destination[0] && s.destination[0].locationName) || STATIONS[to],
      isCancelled: !!s.isCancelled,
    }));

    res.json({
      from: { crs: from, name: STATIONS[from] },
      to: { crs: to, name: STATIONS[to] },
      generatedAt: data.generatedAt || new Date().toISOString(),
      services,
    });
  } catch (err) {
    res.status(504).json({ error: 'Could not reach the live departure board service.' });
  }
});

app.listen(PORT, () => {
  console.log(`LiveTrains running on http://localhost:${PORT}`);
});
