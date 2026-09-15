// Generic departure-board logic shared by every route page. Each page sets
// `window.BOARD_CONFIG` (stations, default direction, data file path) in a
// small inline script before loading this file.
const ICONS = {
  home: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10.5 12 4l8 6.5"/><path d="M6 9.5V20h12V9.5"/></svg>',
  briefcase: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="7.5" width="18" height="12" rx="2"/><path d="M8 7.5V6a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v1.5"/><path d="M3 13h18"/></svg>',
  pin: '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 21s7-6.5 7-11.5a7 7 0 1 0-14 0C5 14.5 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/></svg>',
};

// URL of the Cloudflare Worker proxy (see worker/ldbws-proxy.js). Leave
// empty to always use the static JSON file GitHub Actions updates.
const WORKER_URL = '';

const { stations: STATIONS, defaultFrom, defaultTo, dataPath } = window.BOARD_CONFIG;

// from -> to. Swapping the button flips these two codes.
let from = defaultFrom;
let to = defaultTo;
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

function formatDuration(service) {
  if (service.isCancelled || service.durationMinutes == null) return '—';
  return `${service.durationMinutes}m`;
}

// The backing data file only refreshes every few minutes (and can lag
// further if GitHub's scheduler is delayed), so a train can still be
// listed after it has actually left. Hide anything whose scheduled
// time is more than a minute in the past by the viewer's own clock,
// so the board only ever shows upcoming/due trains regardless of how
// stale the underlying fetch is.
function isUpcoming(service) {
  const [hours, mins] = service.scheduledTime.split(':').map(Number);
  const now = new Date();
  const scheduled = new Date(now);
  scheduled.setHours(hours, mins, 0, 0);

  // A train scheduled many hours "in the past" is actually an
  // upcoming one just after midnight (e.g. it's 23:58 and the next
  // train is 00:05) rather than one that already left.
  if (scheduled.getTime() - now.getTime() < -12 * 60 * 60 * 1000) {
    scheduled.setDate(scheduled.getDate() + 1);
  }

  return scheduled.getTime() > now.getTime() - 60000;
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

// The page never holds a live-API key itself, so it can't call LDBWS
// directly. WORKER_URL (set below) points at a small Cloudflare Worker
// that holds the key server-side and proxies a live request on every
// load/refresh, so the board isn't limited by how often GitHub Actions'
// own (occasionally delayed) schedule last ran. If the Worker is unset
// or unreachable, this falls back to the static JSON file that workflow
// keeps updated, so the site still works without it.
async function loadLive() {
  const res = await fetch(`${WORKER_URL}?from=${from}&to=${to}`, { cache: 'no-store' });

  if (!res.ok) {
    throw new Error(`Live proxy error (${res.status})`);
  }

  const data = await res.json();
  return { generatedAt: data.generatedAt, services: data.services || [] };
}

async function loadFromStaticFile() {
  const res = await fetch(`${dataPath}?_=${Date.now()}`);

  if (!res.ok) {
    throw new Error(`Could not load data file (${res.status})`);
  }

  const data = await res.json();
  const route = data.routes && data.routes[`${from}-${to}`];
  return { generatedAt: data.generatedAt, services: (route && route.services) || [] };
}

async function loadDepartures() {
  renderStations();
  setStatus('Loading…');

  try {
    const { generatedAt, services: rawServices } = WORKER_URL ? await loadLive().catch(loadFromStaticFile) : await loadFromStaticFile();
    const services = rawServices.filter(isUpcoming);

    renderBoard(services);

    lastUpdatedEl.textContent = generatedAt
      ? `Last updated: ${new Date(generatedAt).toLocaleTimeString('en-GB')}`
      : 'Waiting for the first data update…';
    setStatus(services.length ? '' : 'No scheduled services found right now.');
  } catch (err) {
    setStatus(`Could not load departures: ${err.message}`, true);
  }
}

function renderBoard(services) {
  boardBody.innerHTML = '';

  services.forEach((s) => {
    const row = document.createElement('tr');
    row.classList.toggle('cancelled-row', !!s.isCancelled);

    row.innerHTML = `
      <td>${s.scheduledTime}</td>
      <td class="${etdClass(s.isCancelled ? 'Cancelled' : s.expectedTime)}">${s.isCancelled ? 'Cancelled' : s.expectedTime}</td>
      <td class="platform">${s.platform}</td>
      <td>${formatDuration(s)}</td>
      <td>${s.operator || ''}</td>
    `;

    boardBody.appendChild(row);
  });
}

function scheduleAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadDepartures, 60000);
}

swapBtn.addEventListener('click', () => {
  [from, to] = [to, from];
  loadDepartures();
});

refreshBtn.addEventListener('click', loadDepartures);

loadDepartures();
scheduleAutoRefresh();
