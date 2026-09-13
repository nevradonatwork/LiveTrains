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

function minutesUntil(service) {
  if (service.isCancelled) return '—';

  const timeStr = /^\d{1,2}:\d{2}$/.test(service.expectedTime) ? service.expectedTime : service.scheduledTime;
  const [hours, mins] = timeStr.split(':').map(Number);

  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, mins, 0, 0);
  let diffMs = target - now;

  // Scheduled time already looks more than 6h in the past - it must be a
  // service just after midnight, so it's really tomorrow.
  if (diffMs < -6 * 60 * 60 * 1000) {
    target.setDate(target.getDate() + 1);
    diffMs = target - now;
  }

  const diffMin = Math.round(diffMs / 60000);
  if (diffMin <= 0) return 'Due';
  return `${diffMin} min`;
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

async function loadDepartures() {
  renderStations();
  setStatus('Loading…');

  try {
    const response = await fetch(`/api/departures/${from}/${to}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Unknown error');
    }

    renderBoard(data.services);

    const updated = new Date(data.generatedAt);
    lastUpdatedEl.textContent = `Last updated: ${updated.toLocaleTimeString('en-GB')}`;
    setStatus(data.services.length ? '' : 'No scheduled services found right now.');
  } catch (err) {
    setStatus(`Could not load departures: ${err.message}`, true);
  }
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
      <td>${minutesUntil(s)}</td>
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
