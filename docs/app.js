const ICONS = {
  home: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.5V20h12V9.5"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M8 7.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5"/><path d="M3 13h18"/></svg>',
};

const STATIONS = {
  NEM: { name: 'New Malden', icon: 'home' },
  WAT: { name: 'London Waterloo', icon: 'briefcase' },
};

// from -> to. Swapping the button flips these two codes.
let from = 'NEM';
let to = 'WAT';
let refreshTimer = null;

const boardBody = document.getElementById('board-body');
const routeTitle = document.getElementById('route-title');
const statusEl = document.getElementById('status');
const lastUpdatedEl = document.getElementById('last-updated');
const swapBtn = document.getElementById('swap-btn');
const refreshBtn = document.getElementById('refresh-btn');
const fromRow = document.getElementById('station-from');
const toRow = document.getElementById('station-to');

function setStatus(message, isError) {
  statusEl.textContent = message || '';
  statusEl.classList.toggle('error', !!isError);
}

function etdClass(etd) {
  if (!etd) return '';
  const value = etd.toLowerCase();
  if (value.includes('cancel')) return 'cancelled';
  if (value.includes('on time')) return 'on-time';
  if (value.includes('delay')) return 'delayed';
  return '';
}

function renderStations() {
  const fromStation = STATIONS[from];
  const toStation = STATIONS[to];

  fromRow.querySelector('.station-icon').innerHTML = ICONS[fromStation.icon];
  fromRow.querySelector('.station-name').textContent = fromStation.name;

  toRow.querySelector('.station-icon').innerHTML = ICONS[toStation.icon];
  toRow.querySelector('.station-name').textContent = toStation.name;

  routeTitle.textContent = `Showing trains from ${fromStation.name} to ${toStation.name}`;
}

async function fetchJson(url) {
  let response;

  try {
    response = await fetch(url, { headers: { Accept: 'application/json' } });
  } catch (err) {
    throw new Error('request failed (offline, DNS, or blocked)');
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`server error ${response.status}${detail ? `: ${detail}` : ''}`);
  }

  return response.json();
}

// Provider 1: Huxley2, a free CORS-enabled proxy for National Rail's live
// departure boards. No API key needed, but it's a community demo with no
// uptime guarantee.
async function fetchFromHuxley(fromCode, toCode) {
  const url = `https://huxley2.azurewebsites.net/departures/${fromCode}/to/${toCode}?expand=false&numRows=10`;
  const data = await fetchJson(url);
  const trainServices = data.trainServices || [];

  if (!trainServices.length && !data.generatedAt) {
    // An empty/near-empty body with no timestamp usually means the demo
    // instance itself is down rather than "no trains right now".
    throw new Error('empty response');
  }

  return {
    generatedAt: data.generatedAt || Date.now(),
    services: trainServices.map((s) => ({
      scheduledTime: s.std,
      expectedTime: s.etd,
      platform: s.platform || 'TBC',
      operator: s.operator,
      destination: (s.destination && s.destination[0] && s.destination[0].locationName) || STATIONS[toCode].name,
      isCancelled: !!s.isCancelled,
    })),
  };
}

// Provider 2 (fallback): TransportAPI's public sandbox credentials
// (shared, rate-limited, but keyless to set up). Used only if Huxley2
// fails or is unreachable.
async function fetchFromTransportApi(fromCode, toCode) {
  const url = `https://transportapi.com/v3/uk/train/station/${fromCode}/live.json?app_id=test&app_key=test&calling_at=${toCode}&train_status=passenger`;
  const data = await fetchJson(url);
  const all = (data.departures && data.departures.all) || [];

  return {
    generatedAt: Date.now(),
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
        destination: s.destination_name || STATIONS[toCode].name,
        isCancelled,
      };
    }),
  };
}

async function loadDepartures() {
  renderStations();
  setStatus('Loading…');

  const errors = [];

  for (const provider of [fetchFromHuxley, fetchFromTransportApi]) {
    try {
      const { generatedAt, services } = await provider(from, to);

      renderBoard(services);
      lastUpdatedEl.textContent = `Last updated: ${new Date(generatedAt).toLocaleTimeString('en-GB')}`;
      setStatus(services.length ? '' : 'No scheduled services found right now.');
      return;
    } catch (err) {
      errors.push(err.message);
    }
  }

  setStatus(`Could not load departures: ${errors.join(' / ')}`, true);
}

function renderBoard(services) {
  boardBody.innerHTML = '';

  services.forEach((s) => {
    const row = document.createElement('tr');

    row.innerHTML = `
      <td>${s.scheduledTime}</td>
      <td class="${etdClass(s.isCancelled ? 'Cancelled' : s.expectedTime)}">${s.isCancelled ? 'Cancelled' : s.expectedTime}</td>
      <td class="platform">${s.platform}</td>
      <td>${s.destination}</td>
      <td>${s.operator || ''}</td>
    `;

    boardBody.appendChild(row);
  });
}

function scheduleAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadDepartures, 30000);
}

swapBtn.addEventListener('click', () => {
  [from, to] = [to, from];
  loadDepartures();
});

refreshBtn.addEventListener('click', loadDepartures);

loadDepartures();
scheduleAutoRefresh();
