// LOGISTIX Real-Time Flight Tracker (Airlabs via Vercel proxy)
// Depends on globals from ops.html: SB_URL, SB_ANON, SB_SIM, map, vehicleIcon, dotColors, bearing, gcArc

const PROXY_URL = 'https://logistix-opensky-proxy.vercel.app/api/opensky';
const COMMIT_URL = SB_URL + '/functions/v1/logistix-flight-commit';
const FLIGHT_REST = SB_URL + '/rest/v1/logistix_flights';

const AIRPORTS = {
  LAX:{lat:33.94,lon:-118.41,name:'Los Angeles (LAX)'},JFK:{lat:40.64,lon:-73.78,name:'New York (JFK)'},
  ORD:{lat:41.98,lon:-87.90,name:'Chicago (ORD)'},MIA:{lat:25.79,lon:-80.29,name:'Miami (MIA)'},
  ANC:{lat:61.17,lon:-149.99,name:'Anchorage (ANC)'},HKG:{lat:22.31,lon:113.91,name:'Hong Kong (HKG)'},
  PVG:{lat:31.14,lon:121.81,name:'Shanghai (PVG)'},NRT:{lat:35.76,lon:140.39,name:'Tokyo (NRT)'},
  FRA:{lat:50.03,lon:8.57,name:'Frankfurt (FRA)'},LHR:{lat:51.47,lon:-0.46,name:'London (LHR)'},
  DXB:{lat:25.25,lon:55.36,name:'Dubai (DXB)'},SIN:{lat:1.36,lon:103.99,name:'Singapore (SIN)'},
  ICN:{lat:37.46,lon:126.44,name:'Seoul (ICN)'},AMS:{lat:52.31,lon:4.77,name:'Amsterdam (AMS)'},
  CDG:{lat:49.01,lon:2.55,name:'Paris (CDG)'},MEM:{lat:35.04,lon:-89.98,name:'Memphis (MEM)'},
  SDF:{lat:38.17,lon:-85.74,name:'Louisville (SDF)'},DEN:{lat:39.86,lon:-104.67,name:'Denver (DEN)'},
  SFO:{lat:37.62,lon:-122.38,name:'San Francisco (SFO)'},SEA:{lat:47.45,lon:-122.31,name:'Seattle (SEA)'},
  PHX:{lat:33.44,lon:-112.01,name:'Phoenix (PHX)'},RNO:{lat:39.50,lon:-119.77,name:'Reno (RNO)'},
  SAN:{lat:32.73,lon:-117.19,name:'San Diego (SAN)'},MDW:{lat:41.79,lon:-87.75,name:'Chicago Midway (MDW)'},
  DCA:{lat:38.85,lon:-77.04,name:'Washington DC (DCA)'},PIT:{lat:40.49,lon:-80.23,name:'Pittsburgh (PIT)'},
  CLE:{lat:41.41,lon:-81.85,name:'Cleveland (CLE)'},CMH:{lat:39.99,lon:-82.89,name:'Columbus (CMH)'},
  HNL:{lat:21.32,lon:-157.92,name:'Honolulu (HNL)'},YYC:{lat:51.13,lon:-114.01,name:'Calgary (YYC)'},
  MSP:{lat:44.88,lon:-93.22,name:'Minneapolis (MSP)'},ATL:{lat:33.64,lon:-84.43,name:'Atlanta (ATL)'},
  DFW:{lat:32.90,lon:-97.04,name:'Dallas (DFW)'},IAH:{lat:29.98,lon:-95.34,name:'Houston (IAH)'},
  BOS:{lat:42.37,lon:-71.02,name:'Boston (BOS)'},DTW:{lat:42.21,lon:-83.35,name:'Detroit (DTW)'},
};

let activeFlights = [];
let pollTimer = null;
let consecutiveMisses = {};

function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function getPollIntervalMs(flight) {
  if (!flight.totalDistanceKm) return 5 * 60 * 1000;
  const estHours = flight.totalDistanceKm / 800;
  return estHours > 4 ? 45 * 60 * 1000 : 5 * 60 * 1000;
}

// ── RESTORE ACTIVE FLIGHTS ON PAGE LOAD ──
async function restoreActiveFlights() {
  try {
    const res = await fetch(`${FLIGHT_REST}?select=*&order=created_at.desc`, {
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON },
    });
    const rows = await res.json();
    if (!Array.isArray(rows)) return;

    rows.forEach(row => {
      const flight = rowToFlight(row);
      activeFlights.push(flight);
      renderFlightOnMap(flight);
    });

    if (activeFlights.some(f => f.status !== 'completed') && !pollTimer) startPollCoordinator();
    updateLiveFlightStats();
  } catch (e) { console.warn('restoreActiveFlights failed:', e); }
}

function rowToFlight(row) {
  return {
    id: row.id, flightId: row.flight_id, flightIata: row.flight_id,
    icao24: row.icao24, shipmentId: row.shipment_id, status: row.status,
    origin: { lat: row.origin_lat, lon: row.origin_lon, name: row.origin_name || 'Origin' },
    dest: { lat: row.dest_lat, lon: row.dest_lon, name: row.dest_name || 'Destination' },
    currentLat: row.current_lat, currentLon: row.current_lon,
    currentAlt: row.current_alt_m, currentHeading: row.current_heading,
    currentSpeed: row.current_speed, onGround: row.on_ground,
    checkpointsFired: row.checkpoints_fired || {},
    routePts: row.route_pts, totalDistanceKm: row.total_distance_km,
    metadata: row.metadata || {}, departedAt: row.departed_at, arrivedAt: row.arrived_at,
    lastPollAt: 0, marker: null, label: null, routeLine: null,
  };
}

// ── RENDER FLIGHT ON MAP ──
function renderFlightOnMap(flight) {
  const color = '#22d3ee';
  const lat = flight.currentLat || flight.origin.lat;
  const lon = flight.currentLon || flight.origin.lon;

  if (flight.routePts && flight.routePts.length > 1) {
    flight.routeLine = L.polyline(flight.routePts, { color: 'rgba(34,211,238,0.3)', weight: 2, dashArray: '10 8' }).addTo(map);
  }

  L.circleMarker([flight.origin.lat, flight.origin.lon], { radius: 5, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.7, weight: 1 })
    .addTo(map).bindPopup(`<div class="cp-popup"><div class="cp-popup-type" style="color:#f59e0b">ORIGIN</div><div class="cp-popup-desc">${flight.origin.name}</div></div>`);

  L.circleMarker([flight.dest.lat, flight.dest.lon], { radius: 5, color: '#34d399', fillColor: '#34d399', fillOpacity: 0.7, weight: 1 })
    .addTo(map).bindPopup(`<div class="cp-popup"><div class="cp-popup-type" style="color:#34d399">DESTINATION</div><div class="cp-popup-desc">${flight.dest.name}</div></div>`);

  if (flight.routePts && flight.routePts.length > 1) {
    const midIdx = Math.floor(flight.routePts.length / 2);
    const midPt = flight.routePts[midIdx];
    L.marker(midPt, { icon: L.divIcon({ className: '', html: '<div style="width:18px;height:18px;border-radius:3px;background:rgba(167,139,250,0.15);border:1.5px solid rgba(167,139,250,0.5);color:#a78bfa;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;cursor:pointer;">M</div>', iconSize: [18,18], iconAnchor: [9,9] })}).addTo(map)
      .bindPopup('<div class="cp-popup"><div class="cp-popup-type" style="color:#a78bfa">MIDPOINT GEOFENCE</div><div class="cp-popup-desc">On-chain anchor at 50% route</div></div>');
  }

  const hdg = flight.currentHeading || 0;
  flight.marker = L.marker([lat, lon], { icon: vehicleIcon('air', color, hdg), zIndexOffset: 2000 }).addTo(map);
  flight.marker.on('click', () => openFlightSidebar(flight));

  flight.label = L.marker([lat, lon], { icon: L.divIcon({ className: '', html: `<div style="font-size:10px;color:${color};font-family:Inter,sans-serif;font-weight:600;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,0.9);text-align:center;pointer-events:none;">${flight.flightIata}<br><span style="font-size:8px;font-weight:400;opacity:0.7">${flight.status === 'completed' ? 'ARRIVED' : 'LIVE'}</span></div>`, iconSize: [100, 28], iconAnchor: [50, -14] })}).addTo(map);

  if (flight.status === 'completed') { flight.marker.setOpacity(0.5); flight.label.setOpacity(0.5); }
}

// ── FLIGHT SIDEBAR ──
function openFlightSidebar(flight) {
  const color = '#22d3ee';
  const pct = flight.totalDistanceKm > 0 ? Math.min(100, Math.round((haversineDist(flight.origin.lat, flight.origin.lon, flight.currentLat || flight.origin.lat, flight.currentLon || flight.origin.lon) / flight.totalDistanceKm) * 100)) : 0;
  const statusLabel = flight.status === 'completed' ? 'ARRIVED' : flight.onGround === false ? 'AIRBORNE' : 'ON GROUND';
  const statusColor = flight.status === 'completed' ? '#34d399' : flight.onGround === false ? '#60a5fa' : '#f59e0b';
  const altFt = flight.currentAlt ? Math.round(flight.currentAlt * 3.28084).toLocaleString() : '—';
  const speedKts = flight.currentSpeed ? Math.round(flight.currentSpeed * 0.54) : '—';
  const pollInterval = getPollIntervalMs(flight);
  const pollLabel = pollInterval >= 45 * 60 * 1000 ? '45min (long haul)' : '5min (short haul)';

  const cpKeys = ['created', 'departure', 'midpoint', 'arrival'];
  const cpLabels = { created: 'CREATED', departure: 'DEPARTURE', midpoint: 'MIDPOINT', arrival: 'ARRIVAL' };
  const cpColors = { created: '#f59e0b', departure: '#60a5fa', midpoint: '#a78bfa', arrival: '#34d399' };
  const cpHtml = cpKeys.map(key => {
    const cp = flight.checkpointsFired[key];
    if (!cp || cp.pending) return `<div class="ops-sid-cp" style="opacity:0.3"><div class="ops-sid-cp-icon" style="background:rgba(255,255,255,0.03);color:var(--dim);border:1px solid rgba(255,255,255,0.06);">—</div><div class="ops-sid-cp-info"><div class="ops-sid-cp-type" style="color:rgba(255,255,255,0.25)">${cpLabels[key]}</div><div class="ops-sid-cp-desc">Pending</div></div></div>`;
    return `<div class="ops-sid-cp"><div class="ops-sid-cp-icon" style="background:${cpColors[key]}15;color:${cpColors[key]};border:1px solid ${cpColors[key]}33;">&#10003;</div><div class="ops-sid-cp-info"><div class="ops-sid-cp-type" style="color:${cpColors[key]}">${cpLabels[key]}</div><div class="ops-sid-cp-desc">Anchored on-chain</div>${cp.txHash ? `<div class="ops-sid-cp-tx"><a href="https://sepolia.basescan.org/tx/${cp.txHash}" target="_blank">TX: ${cp.txHash.slice(0,14)}...${cp.txHash.slice(-6)}</a></div>` : ''}</div></div>`;
  }).join('');

  document.getElementById('opsSidebarContent').innerHTML = `
    <div class="ops-sid-hero">
      <div class="ops-sid-hero-top">
        <div class="ops-sid-icon" style="background:${color}15;border:1.5px solid ${color}44;">${VEHICLE_SVGS.air.replace(/COLOR/g, color).replace(/width="\d+"/, 'width="24"').replace(/height="\d+"/, 'height="24"')}</div>
        <div class="ops-sid-hero-info">
          <div class="ops-sid-carrier">${flight.flightIata} <span style="font-size:0.55rem;color:rgba(255,255,255,0.4)">${flight.metadata?.airline || ''}</span></div>
          <div class="ops-sid-route-label">${flight.origin.name} → ${flight.dest.name}</div>
        </div>
      </div>
      <div class="ops-sid-tags">
        <span class="ops-sid-tag" style="color:#22d3ee;background:rgba(34,211,238,0.15)">LIVE AIR</span>
        <span class="ops-sid-tag" style="color:${statusColor};background:${statusColor}18">${statusLabel}</span>
        <span class="ops-sid-tag" style="color:rgba(255,255,255,0.35);background:rgba(255,255,255,0.05)">Poll: ${pollLabel}</span>
      </div>
      <div class="ops-sid-progress">
        <div class="ops-sid-bar"><div class="ops-sid-bar-fill" style="width:${pct}%;background:${color}"></div></div>
        <div class="ops-sid-bar-labels"><span>${flight.origin.name.split('(')[0].trim()}</span><span>${pct}%</span><span>${flight.dest.name.split('(')[0].trim()}</span></div>
      </div>
    </div>
    <div class="ops-sid-body">
      <div class="ops-sid-section">Live Telemetry</div>
      <div class="ops-sid-row"><span class="ops-sid-key">Altitude</span><span class="ops-sid-val">${altFt} ft</span></div>
      <div class="ops-sid-row"><span class="ops-sid-key">Speed</span><span class="ops-sid-val">${speedKts} km/h</span></div>
      <div class="ops-sid-row"><span class="ops-sid-key">Heading</span><span class="ops-sid-val">${flight.currentHeading ? Math.round(flight.currentHeading) + '°' : '—'}</span></div>
      <div class="ops-sid-row"><span class="ops-sid-key">Distance</span><span class="ops-sid-val">${flight.totalDistanceKm ? Math.round(flight.totalDistanceKm).toLocaleString() + ' km' : '—'}</span></div>
      <div class="ops-sid-divider"></div>
      <div class="ops-sid-section">On-Chain Checkpoints</div>
      ${cpHtml}
    </div>
    <div class="ops-sid-footer"><a href="./track.html?id=${encodeURIComponent(flight.shipmentId)}" target="_blank">View Full Audit Trail →</a></div>
  `;
  document.getElementById('opsSidebar').classList.add('open');
}

// ── POLL COORDINATOR ──
function startPollCoordinator() {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    const now = Date.now();
    activeFlights.forEach(flight => {
      if (flight.status === 'completed') return;
      const interval = getPollIntervalMs(flight);
      if (now - flight.lastPollAt >= interval) {
        flight.lastPollAt = now;
        pollFlight(flight);
      }
    });
  }, 30000);
}

async function pollFlight(flight) {
  try {
    const res = await fetch(`${PROXY_URL}?action=track&flight_iata=${flight.flightIata}`);
    if (!res.ok) return;
    const d = await res.json();
    if (!d.flight || d.status === 'not_found') {
      consecutiveMisses[flight.flightIata] = (consecutiveMisses[flight.flightIata] || 0) + 1;
      if (consecutiveMisses[flight.flightIata] >= 3 && !flight.checkpointsFired.arrival && flight.checkpointsFired.departure) {
        const distToDest = haversineDist(flight.currentLat, flight.currentLon, flight.dest.lat, flight.dest.lon);
        if (distToDest < 100) {
          await fireFlightCheckpoint(flight, 'arrival', 14, flight.dest.lat, flight.dest.lon, flight.dest.name + ' Arrival');
          await updateFlightStatus(flight, 'completed', { arrived_at: new Date().toISOString() });
        }
      }
      return;
    }

    consecutiveMisses[flight.flightIata] = 0;
    const f = d.flight;

    if (f.lat != null) flight.currentLat = f.lat;
    if (f.lon != null) flight.currentLon = f.lon;
    if (f.alt != null) flight.currentAlt = f.alt;
    if (f.heading != null) flight.currentHeading = f.heading;
    if (f.speed != null) flight.currentSpeed = f.speed;
    flight.onGround = f.status === 'landed' || f.alt === 0;

    if (flight.marker && flight.currentLat && flight.currentLon) {
      flight.marker.setLatLng([flight.currentLat, flight.currentLon]);
      flight.marker.setIcon(vehicleIcon('air', '#22d3ee', flight.currentHeading || 0));
      if (flight.label) flight.label.setLatLng([flight.currentLat, flight.currentLon]);
    }

    await fetch(`${FLIGHT_REST}?id=eq.${flight.id}`, {
      method: 'PATCH',
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ current_lat: flight.currentLat, current_lon: flight.currentLon, current_alt_m: flight.currentAlt, current_heading: flight.currentHeading, current_speed: flight.currentSpeed, on_ground: flight.onGround, last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
    });

    await evaluateCheckpoints(flight);
    if (typeof renderRightPanel === 'function') renderRightPanel();
  } catch (e) { console.warn('pollFlight error:', e); }
}

// ── CHECKPOINT EVALUATOR ──
async function evaluateCheckpoints(flight) {
  if (!flight.checkpointsFired.departure && !flight.onGround && flight.currentAlt > 300) {
    await fireFlightCheckpoint(flight, 'departure', 13, flight.currentLat, flight.currentLon, flight.origin.name + ' Departure');
    await updateFlightStatus(flight, 'airborne', { departed_at: new Date().toISOString() });
  }

  if (!flight.checkpointsFired.midpoint && flight.checkpointsFired.departure && flight.totalDistanceKm > 0) {
    const dist = haversineDist(flight.origin.lat, flight.origin.lon, flight.currentLat, flight.currentLon);
    if (dist >= flight.totalDistanceKm * 0.5) {
      await fireFlightCheckpoint(flight, 'midpoint', 17, flight.currentLat, flight.currentLon, 'Mid-Route Position');
      await updateFlightStatus(flight, 'midpoint_passed');
    }
  }

  if (!flight.checkpointsFired.arrival && flight.checkpointsFired.departure && (flight.onGround || flight.currentAlt < 100)) {
    const distToDest = haversineDist(flight.currentLat, flight.currentLon, flight.dest.lat, flight.dest.lon);
    if (distToDest < 80) {
      await fireFlightCheckpoint(flight, 'arrival', 14, flight.dest.lat, flight.dest.lon, flight.dest.name + ' Arrival');
      await updateFlightStatus(flight, 'completed', { arrived_at: new Date().toISOString() });
    }
  }
}

async function fireFlightCheckpoint(flight, key, eventType, lat, lon, label) {
  flight.checkpointsFired[key] = { pending: true };
  try {
    const res = await fetch(SB_SIM, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shipmentId: flight.shipmentId, eventType, location: { lat, lon, name: label }, bundle: { shipmentId: flight.shipmentId, flight: flight.flightIata, origin: flight.origin.name, dest: flight.dest.name, distance_km: flight.totalDistanceKm, event: label } }),
    });
    if (!res.ok) { delete flight.checkpointsFired[key]; return; }
    const txData = await res.json();
    flight.checkpointsFired[key] = txData;

    await fetch(`${FLIGHT_REST}?id=eq.${flight.id}`, {
      method: 'PATCH', headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ checkpoints_fired: flight.checkpointsFired }),
    });

    const feedEl = document.getElementById('opsFeed');
    if (feedEl) {
      const card = document.createElement('div');
      card.className = 'ops-feed-card new';
      card.innerHTML = `<div class="ops-feed-type" style="color:#22d3ee">LIVE · ${label}</div><div class="ops-feed-route">${flight.flightIata} · ${flight.origin.name.split('(')[0]} → ${flight.dest.name.split('(')[0]}</div><div class="ops-feed-tx"><a href="https://sepolia.basescan.org/tx/${txData.txHash}" target="_blank">TX: ${txData.txHash?.slice(0,10)}...${txData.txHash?.slice(-6)}</a></div>`;
      card.onclick = () => openFlightSidebar(flight);
      feedEl.appendChild(card);
      feedEl.scrollLeft = feedEl.scrollWidth;
    }
  } catch (e) { console.warn('checkpoint failed:', e); delete flight.checkpointsFired[key]; }
}

async function updateFlightStatus(flight, status, extra) {
  flight.status = status;
  await fetch(`${FLIGHT_REST}?id=eq.${flight.id}`, {
    method: 'PATCH', headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify({ status, updated_at: new Date().toISOString(), ...extra }),
  });
}

function updateLiveFlightStats() {
  const badge = document.getElementById('liveFlightBadge');
  if (badge) badge.textContent = activeFlights.filter(f => f.status !== 'completed').length;
}

// ── SCAN LAS UPCOMING DEPARTURES ──
async function loadCandidateFlights() {
  const tracked = new Set();
  try {
    const tRes = await fetch(`${FLIGHT_REST}?select=flight_id&status=neq.completed`, { headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON } });
    const tData = await tRes.json();
    if (Array.isArray(tData)) tData.forEach(r => tracked.add(r.flight_id));
  } catch {}

  try {
    const res = await fetch(`${PROXY_URL}?action=scan&dep_iata=LAS`);
    if (!res.ok) return [];
    const d = await res.json();
    return (d.upcoming || []).filter(f => f.flight_iata && !tracked.has(f.flight_iata));
  } catch (e) { console.warn('scan error:', e); return []; }
}

// ── COMMIT ──
async function commitFlight() {
  const select = document.getElementById('flightSelect');
  const destSelect = document.getElementById('destAirport');
  const btn = document.getElementById('commitBtn');
  if (!select || !select.value) return;

  const candidate = JSON.parse(select.value);
  const destCode = destSelect.value;
  const dest = AIRPORTS[destCode] || (candidate.arr_iata && AIRPORTS[candidate.arr_iata]);
  if (!dest) { alert('Select a destination'); return; }

  btn.disabled = true; btn.textContent = 'Committing...';

  const LAS_LAT = 36.08, LAS_LON = -115.15;
  const originLat = candidate.lat || LAS_LAT;
  const originLon = candidate.lon || LAS_LON;
  const routePts = gcArc(originLat, originLon, dest.lat, dest.lon, 80);
  const totalDist = haversineDist(originLat, originLon, dest.lat, dest.lon);

  try {
    const res = await fetch(COMMIT_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        icao24: candidate.flight_iata, callsign: candidate.flight_iata,
        originLat, originLon, originName: 'Las Vegas (LAS)',
        destLat: dest.lat, destLon: dest.lon, destName: dest.name,
        routePts, totalDistanceKm: totalDist,
        metadata: { airline: candidate.airline_iata, arr_iata: candidate.arr_iata, dep_time: candidate.dep_time, arr_time: candidate.arr_time },
      }),
    });
    const data = await res.json();
    if (!data.success) { alert('Error: ' + (data.error || 'Unknown')); return; }

    const flight = {
      id: data.id, flightId: data.flightId, flightIata: candidate.flight_iata,
      icao24: candidate.flight_iata, shipmentId: data.shipmentId, status: 'committed',
      origin: { lat: originLat, lon: originLon, name: 'Las Vegas (LAS)' },
      dest: { lat: dest.lat, lon: dest.lon, name: dest.name },
      currentLat: originLat, currentLon: originLon,
      currentAlt: 0, currentHeading: 0,
      currentSpeed: 0, onGround: true,
      checkpointsFired: data.createdTx ? { created: data.createdTx } : {},
      routePts, totalDistanceKm: totalDist, metadata: { airline: candidate.airline_iata },
      lastPollAt: 0, marker: null, label: null, routeLine: null,
    };

    activeFlights.push(flight);
    renderFlightOnMap(flight);
    if (!pollTimer) startPollCoordinator();
    updateLiveFlightStats();
    if (typeof renderRightPanel === 'function') renderRightPanel();
    map.flyTo([candidate.lat, candidate.lon], 5, { duration: 1.5 });
    document.getElementById('flightPanel').style.display = 'none';
  } catch (e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Commit to Track'; }
}

// ── SCAN UI ──
async function scanFlights() {
  const select = document.getElementById('flightSelect');
  const destSelect = document.getElementById('destAirport');
  const scanBtn = document.getElementById('scanBtn');
  select.innerHTML = '<option value="">Scanning LAS departures...</option>';
  scanBtn.disabled = true;

  const candidates = await loadCandidateFlights();
  scanBtn.disabled = false;

  if (candidates.length === 0) { select.innerHTML = '<option value="">No upcoming departures — try again shortly</option>'; return; }

  select.innerHTML = '<option value="">Select an upcoming LAS departure...</option>' +
    candidates.map(c => {
      const mins = c.minutes_until;
      const when = mins <= 0 ? 'NOW' : mins < 60 ? `${mins}min` : `${Math.floor(mins/60)}h${mins%60}m`;
      const depLocal = c.dep_time ? c.dep_time.split(' ')[1] : '';
      const gate = c.dep_gate ? ` G${c.dep_gate}` : '';
      const term = c.dep_terminal ? ` T${c.dep_terminal}` : '';
      return `<option value='${JSON.stringify(c).replace(/'/g, "&#39;")}'>${c.flight_iata} → ${c.arr_iata} · ${depLocal} (${when})${term}${gate} · ${c.airline_iata || ''}</option>`;
    }).join('');

  select.onchange = () => {
    try {
      const sel = JSON.parse(select.value);
      if (sel.arr_iata && AIRPORTS[sel.arr_iata]) destSelect.value = sel.arr_iata;
    } catch {}
  };
}
