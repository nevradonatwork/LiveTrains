const ROUTES = {
  toWaterloo: { from: 'NEM', to: 'WAT', title: 'New Malden &rarr; London Waterloo', label: 'Show Waterloo &rarr; New Malden trains' },
  toNewMalden: { from: 'WAT', to: 'NEM', title: 'London Waterloo &rarr; New Malden', label: 'Show New Malden &rarr; Waterloo trains' },
};

let currentRoute = 'toWaterloo';
let refreshTimer = null;

const boardBody = document.getElementById('board-body');
const routeTitle = document.getElementById('route-title');
const statusEl = document.getElementById('status');
const lastUpdatedEl = document.getElementById('last-updated');
const toggleBtn = document.getElementById('toggle-btn');
const refreshBtn = document.getElementById('refresh-btn');

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

async function loadDepartures() {
  const route = ROUTES[currentRoute];
  routeTitle.innerHTML = route.title;
  toggleBtn.innerHTML = route.label;
  setStatus('Loading…');

  try {
    const response = await fetch(`/api/departures/${route.from}/${route.to}`);
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
      <td>${s.operator || ''}</td>
    `;

    boardBody.appendChild(row);
  });
}

function scheduleAutoRefresh() {
  clearInterval(refreshTimer);
  refreshTimer = setInterval(loadDepartures, 30000);
}

toggleBtn.addEventListener('click', () => {
  currentRoute = currentRoute === 'toWaterloo' ? 'toNewMalden' : 'toWaterloo';
  loadDepartures();
});

refreshBtn.addEventListener('click', loadDepartures);

loadDepartures();
scheduleAutoRefresh();
