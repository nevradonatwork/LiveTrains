// Temporary diagnostic: dumps the raw LDBWS shape (no credentials) for the
// New Malden <-> Waterloo boards so the calling-point layout of circular
// (Kingston loop) services can be inspected from the Actions log.
const BASE = 'https://api1.raildata.org.uk/1010-live-departure-board-dep1_2/LDBWS/api/20220120';
const key = process.env.LDBWS_API_KEY;

async function get(endpoint, crs, to, numRows) {
  const res = await fetch(`${BASE}/${endpoint}/${crs}?filterCrs=${to}&filterType=to&numRows=${numRows}&timeOffset=0`, { headers: { 'x-apikey': key } });
  if (!res.ok) throw new Error(`${endpoint} ${crs} ${res.status}`);
  return res.json();
}

(async () => {
  for (const [from, to] of [['NEM', 'WAT'], ['WAT', 'NEM']]) {
    const board = await get('GetDepartureBoard', from, to, 20);
    console.log(`\n===== ${from}->${to} board keys:`, Object.keys(board).join(', '));
    console.log('nrccMessages:', JSON.stringify(board.nrccMessages));
    console.log('platformAvailable:', board.platformAvailable, 'areServicesAvailable:', board.areServicesAvailable);
    const s0 = (board.trainServices || [])[0];
    console.log('service keys:', s0 ? Object.keys(s0).join(', ') : 'none');
    for (const s of board.trainServices || []) {
      console.log(`  ${s.std} etd=${s.etd} plat=${s.platform ?? '-'} circ=${s.isCircularRoute} len=${s.length ?? '-'} dest=${JSON.stringify(s.destination)} origin=${JSON.stringify((s.origin || []).map((o) => o.locationName))} cancel=${s.cancelReason ?? ''} delay=${s.delayReason ?? ''} rsid=${s.rsid ?? ''}`);
    }
    const details = await get('GetDepBoardWithDetails', from, to, 9);
    console.log(`--- ${from}->${to} details (${(details.trainServices || []).length} services)`);
    for (const s of details.trainServices || []) {
      const lists = (s.subsequentCallingPoints || []).map((l) =>
        `[${l.serviceType ?? ''}${l.serviceChangeRequired ? ' change' : ''}${l.assocIsCancelled ? ' assocCancelled' : ''}] ` +
        (l.callingPoint || []).map((p) => `${p.crs}@${p.st}${p.isCancelled ? '!' : ''}`).join(' > '));
      console.log(`  ${s.std} plat=${s.platform ?? '-'} circ=${s.isCircularRoute} dest=${(s.destination || []).map((d) => `${d.locationName}${d.via ? ' ' + d.via : ''}`).join('|')} formation=${s.formation ? 'yes' : 'no'}`);
      for (const l of lists) console.log('      ', l);
    }
  }
})().catch((err) => { console.error(err.message); process.exit(1); });
