// LOGISTIX Real-Time Air Cargo Flight Tracker
// Depends on globals from ops.html: SB_URL, SB_ANON, SB_SIM, map, getOSToken, CARGO_PREFIXES, vehicleIcon, dotColors, bearing, gcArc, addFeedCard, openSidebar, getCpType

const COMMIT_URL = SB_URL + '/functions/v1/logistix-flight-commit';
const FLIGHT_REST = SB_URL + '/rest/v1/logistix_flights';

const AIRPORTS = {
  LAX:{lat:33.94,lon:-118.41,name:'Los Angeles (LAX)'},JFK:{lat:40.64,lon:-73.78,name:'New York JFK'},
  ORD:{lat:41.98,lon:-87.90,name:'Chicago O\'Hare (ORD)'},MIA:{lat:25.79,lon:-80.29,name:'Miami (MIA)'},
  ANC:{lat:61.17,lon:-149.99,name:'Anchorage (ANC)'},HKG:{lat:22.31,lon:113.91,name:'Hong Kong (HKG)'},
  PVG:{lat:31.14,lon:121.81,name:'Shanghai Pudong (PVG)'},NRT:{lat:35.76,lon:140.39,name:'Tokyo Narita (NRT)'},
  FRA:{lat:50.03,lon:8.57,name:'Frankfurt (FRA)'},LHR:{lat:51.47,lon:-0.46,name:'London Heathrow (LHR)'},
  DXB:{lat:25.25,lon:55.36,name:'Dubai (DXB)'},SIN:{lat:1.36,lon:103.99,name:'Singapore (SIN)'},
  ICN:{lat:37.46,lon:126.44,name:'Seoul Incheon (ICN)'},AMS:{lat:52.31,lon:4.77,name:'Amsterdam (AMS)'},
  CDG:{lat:49.01,lon:2.55,name:'Paris CDG'},MEM:{lat:35.04,lon:-89.98,name:'Memphis (MEM)'},
  SDF:{lat:38.17,lon:-85.74,name:'Louisville (SDF)'},LEJ:{lat:51.42,lon:12.24,name:'Leipzig (LEJ)'},
  CVG:{lat:39.05,lon:-84.66,name:'Cincinnati (CVG)'},GRU:{lat:-23.43,lon:-46.47,name:'São Paulo (GRU)'},
};

let activeFlights = [];
let pollQueue = [];
let pollTimer = null;
let consecutiveMisses = {};

function haversineDist(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const toR = d => d * Math.PI / 180;
  const dLat = toR(lat2 - lat1), dLon = toR(lon2 - lon1);
  const a = Math.sin(dLat/2)**2 + Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
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
      if (row.status !== 'completed') {
        pollQueue.push(flight);
      }
    });

    if (pollQueue.length > 0 && !pollTimer) {
      startPollCoordinator();
    }

    updateLiveFlightStats();
  } catch (e) { console.warn('restoreActiveFlights failed:', e); }
}

function rowToFlight(row) {
  return {
    id: row.id,
    flightId: row.flight_id,
    icao24: row.icao24,
    shipmentId: row.shipment_id,
    status: row.status,
    origin: { lat: row.origin_lat, lon: row.origin_lon, name: row.origin_name || 'Origin' },
    dest: { lat: row.dest_lat, lon: row.dest_lon, name: row.dest_name || 'Destination' },
    currentLat: row.current_lat,
    currentLon: row.current_lon,
    currentAlt: row.current_alt_m,
    currentHeading: row.current_heading,
    currentSpeed: row.current_speed,
    onGround: row.on_ground,
    checkpointsFired: row.checkpoints_fired || {},
    routePts: row.route_pts,
    totalDistanceKm: row.total_distance_km,
    metadata: row.metadata || {},
    departedAt: row.departed_at,
    arrivedAt: row.arrived_at,
    marker: null,
    label: null,
    routeLine: null,
  };
}

// ── RENDER A FLIGHT ON THE MAP ──
function renderFlightOnMap(flight) {
  const color = dotColors.air || '#60a5fa';
  const lat = flight.currentLat || flight.origin.lat;
  const lon = flight.currentLon || flight.origin.lon;

  if (flight.routePts && flight.routePts.length > 1) {
    flight.routeLine = L.polyline(flight.routePts, { color: 'rgba(96,165,250,0.3)', weight: 2, dashArray: '10 8' }).addTo(map);
  }

  // Origin marker
  L.circleMarker([flight.origin.lat, flight.origin.lon], { radius: 5, color: '#f59e0b', fillColor: '#f59e0b', fillOpacity: 0.7, weight: 1 })
    .addTo(map).bindPopup(`<div class="cp-popup"><div class="cp-popup-type" style="color:#f59e0b">ORIGIN</div><div class="cp-popup-desc">${flight.origin.name}</div></div>`);

  // Dest marker
  L.circleMarker([flight.dest.lat, flight.dest.lon], { radius: 5, color: '#34d399', fillColor: '#34d399', fillOpacity: 0.7, weight: 1 })
    .addTo(map).bindPopup(`<div class="cp-popup"><div class="cp-popup-type" style="color:#34d399">DESTINATION</div><div class="cp-popup-desc">${flight.dest.name}</div></div>`);

  // Midpoint geofence
  if (flight.routePts && flight.routePts.length > 1) {
    const midIdx = Math.floor(flight.routePts.length / 2);
    const midPt = flight.routePts[midIdx];
    L.marker(midPt, { icon: L.divIcon({
      className: '',
      html: '<div style="width:18px;height:18px;border-radius:3px;background:rgba(167,139,250,0.15);border:1.5px solid rgba(167,139,250,0.5);color:#a78bfa;font-size:8px;font-weight:800;display:flex;align-items:center;justify-content:center;cursor:pointer;">M</div>',
      iconSize: [18,18], iconAnchor: [9,9],
    })}).addTo(map).bindPopup('<div class="cp-popup"><div class="cp-popup-type" style="color:#a78bfa">MIDPOINT GEOFENCE</div><div class="cp-popup-desc">On-chain anchor fires at 50% route completion</div></div>');
  }

  const hdg = flight.currentHeading || 0;
  flight.marker = L.marker([lat, lon], { icon: vehicleIcon('air', color, hdg), zIndexOffset: 2000 }).addTo(map);
  flight.marker.on('click', () => openFlightSidebar(flight));

  flight.label = L.marker([lat, lon], { icon: L.divIcon({
    className: '',
    html: `<div style="font-size:10px;color:${color};font-family:Inter,sans-serif;font-weight:600;white-space:nowrap;text-shadow:0 1px 4px rgba(0,0,0,0.9);text-align:center;pointer-events:none;">${flight.flightId}<br><span style="font-size:8px;font-weight:400;opacity:0.7">LIVE TRACKING</span></div>`,
    iconSize: [100, 28], iconAnchor: [50, -14],
  })}).addTo(map);

  if (flight.status === 'completed') {
    flight.marker.setOpacity(0.5);
    flight.label.setOpacity(0.5);
  }
}

// ── FLIGHT SIDEBAR (RICH DETAIL) ──
function openFlightSidebar(flight) {
  const color = '#60a5fa';
  const pct = flight.totalDistanceKm > 0
    ? Math.round((haversineDist(flight.origin.lat, flight.origin.lon, flight.currentLat || flight.origin.lat, flight.currentLon || flight.origin.lon) / flight.totalDistanceKm) * 100)
    : 0;
  const clampPct = Math.min(pct, 100);
  const statusLabel = flight.status === 'completed' ? 'ARRIVED' : flight.onGround === false ? 'AIRBORNE' : 'ON GROUND';
  const statusColor = flight.status === 'completed' ? '#34d399' : flight.onGround === false ? '#60a5fa' : '#f59e0b';
  const altFt = flight.currentAlt ? Math.round(flight.currentAlt * 3.28084).toLocaleString() : '—';
  const speedKts = flight.currentSpeed ? Math.round(flight.currentSpeed * 1.944) : '—';

  const cpKeys = ['created', 'departure', 'midpoint', 'arrival'];
  const cpLabels = { created: 'CREATED', departure: 'DEPARTURE', midpoint: 'MIDPOINT', arrival: 'ARRIVAL' };
  const cpColors = { created: '#f59e0b', departure: '#60a5fa', midpoint: '#a78bfa', arrival: '#34d399' };
  let cpHtml = cpKeys.map(key => {
    const cp = flight.checkpointsFired[key];
    if (!cp) return `<div class="ops-sid-cp" style="opacity:0.3"><div class="ops-sid-cp-icon" style="background:rgba(255,255,255,0.03);color:var(--dim);border:1px solid rgba(255,255,255,0.06);">—</div><div class="ops-sid-cp-info"><div class="ops-sid-cp-type" style="color:var(--dim)">${cpLabels[key]}</div><div class="ops-sid-cp-desc">Pending</div></div></div>`;
    return `<div class="ops-sid-cp"><div class="ops-sid-cp-icon" style="background:${cpColors[key]}15;color:${cpColors[key]};border:1px solid ${cpColors[key]}33;">&#10003;</div><div class="ops-sid-cp-info"><div class="ops-sid-cp-type" style="color:${cpColors[key]}">${cpLabels[key]}</div><div class="ops-sid-cp-desc">Anchored on-chain</div>${cp.txHash ? `<div class="ops-sid-cp-tx"><a href="https://sepolia.basescan.org/tx/${cp.txHash}" target="_blank">TX: ${cp.txHash.slice(0,14)}...${cp.txHash.slice(-6)}</a></div>` : ''}</div></div>`;
  }).join('');

  document.getElementById('opsSidebarContent').innerHTML = `
    <div class="ops-sid-hero">
      <div class="ops-sid-hero-top">
        <div class="ops-sid-icon" style="background:${color}15;border:1.5px solid ${color}44;">
          ${VEHICLE_SVGS.air.replace(/COLOR/g, color).replace(/width="\d+"/, 'width="24"').replace(/height="\d+"/, 'height="24"')}
        </div>
        <div class="ops-sid-hero-info">
          <div class="ops-sid-carrier">${flight.flightId}</div>
          <div class="ops-sid-route-label">${flight.origin.name} → ${flight.dest.name}</div>
        </div>
      </div>
      <div class="ops-sid-tags">
        <span class="ops-sid-tag" style="color:#60a5fa;background:rgba(96,165,250,0.15)">LIVE AIR</span>
        <span class="ops-sid-tag" style="color:${statusColor};background:${statusColor}18">${statusLabel}</span>
      </div>
      <div class="ops-sid-progress">
        <div class="ops-sid-bar"><div class="ops-sid-bar-fill" style="width:${clampPct}%;background:${color}"></div></div>
        <div class="ops-sid-bar-labels"><span>${flight.origin.name.split('(')[0].trim()}</span><span>${clampPct}%</span><span>${flight.dest.name.split('(')[0].trim()}</span></div>
      </div>
    </div>
    <div class="ops-sid-body">
      <div class="ops-sid-section">Live Telemetry</div>
      <div class="ops-sid-row"><span class="ops-sid-key">Altitude</span><span class="ops-sid-val">${altFt} ft</span></div>
      <div class="ops-sid-row"><span class="ops-sid-key">Speed</span><span class="ops-sid-val">${speedKts} kts</span></div>
      <div class="ops-sid-row"><span class="ops-sid-key">Heading</span><span class="ops-sid-val">${flight.currentHeading ? Math.round(flight.currentHeading) + '°' : '—'}</span></div>
      <div class="ops-sid-row"><span class="ops-sid-key">Distance</span><span class="ops-sid-val">${flight.totalDistanceKm ? Math.round(flight.totalDistanceKm).toLocaleString() + ' km' : '—'}</span></div>
      <div class="ops-sid-row"><span class="ops-sid-key">ICAO24</span><span class="ops-sid-val" style="font-family:monospace">${flight.icao24}</span></div>
      <div class="ops-sid-divider"></div>
      <div class="ops-sid-section">On-Chain Checkpoints</div>
      ${cpHtml}
    </div>
    <div class="ops-sid-footer"><a href="./track.html?id=${encodeURIComponent(flight.shipmentId)}" target="_blank">View Full Audit Trail →</a></div>
  `;
  document.getElementById('opsSidebar').classList.add('open');
}

// ── POLL COORDINATOR (single interval, rotates through flights) ──
let pollIndex = 0;
function startPollCoordinator() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    if (pollQueue.length === 0) return;
    pollIndex = pollIndex % pollQueue.length;
    const flight = pollQueue[pollIndex];
    pollIndex++;
    await pollFlight(flight);
  }, 15000);
}

async function pollFlight(flight) {
  const token = await getOSToken();
  if (!token) return;

  try {
    const res = await fetch(`https://opensky-network.org/api/states/all?icao24=${flight.icao24}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return;
    const d = await res.json();
    const sv = d.states?.[0];

    if (!sv) {
      consecutiveMisses[flight.icao24] = (consecutiveMisses[flight.icao24] || 0) + 1;
      if (consecutiveMisses[flight.icao24] >= 5 && !flight.checkpointsFired.arrival) {
        const distToDest = haversineDist(flight.currentLat, flight.currentLon, flight.dest.lat, flight.dest.lon);
        if (distToDest < 200) {
          await fireFlightCheckpoint(flight, 'arrival', 13, flight.dest.lat, flight.dest.lon, flight.dest.name + ' (signal lost near destination)');
          await updateFlightStatus(flight, 'completed', { arrived_at: new Date().toISOString() });
          pollQueue = pollQueue.filter(f => f.id !== flight.id);
        }
      }
      return;
    }

    consecutiveMisses[flight.icao24] = 0;

    const lon = sv[5], lat = sv[6], alt = sv[7], onGround = sv[8], speed = sv[9], heading = sv[10];

    flight.currentLat = lat;
    flight.currentLon = lon;
    flight.currentAlt = alt;
    flight.currentHeading = heading;
    flight.currentSpeed = speed;
    flight.onGround = onGround;

    // Update map marker
    if (flight.marker && lat && lon) {
      flight.marker.setLatLng([lat, lon]);
      flight.marker.setIcon(vehicleIcon('air', '#60a5fa', heading || 0));
      if (flight.label) flight.label.setLatLng([lat, lon]);
    }

    // Persist position to Supabase
    await fetch(`${FLIGHT_REST}?id=eq.${flight.id}`, {
      method: 'PATCH',
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({
        current_lat: lat, current_lon: lon, current_alt_m: alt,
        current_heading: heading, current_speed: speed, on_ground: onGround,
        last_seen_at: new Date().toISOString(), updated_at: new Date().toISOString(),
      }),
    });

    // Evaluate checkpoints
    await evaluateCheckpoints(flight);

  } catch (e) { console.warn('pollFlight error:', e); }
}

// ── CHECKPOINT EVALUATOR ──
async function evaluateCheckpoints(flight) {
  // DEPARTURE: airborne + altitude > 1000m
  if (!flight.checkpointsFired.departure && flight.onGround === false && flight.currentAlt > 1000) {
    await fireFlightCheckpoint(flight, 'departure', 13, flight.currentLat, flight.currentLon, flight.origin.name + ' Departure');
    await updateFlightStatus(flight, 'airborne', { departed_at: new Date().toISOString() });
  }

  // MIDPOINT: 50% of great-circle distance
  if (!flight.checkpointsFired.midpoint && flight.checkpointsFired.departure && flight.totalDistanceKm > 0) {
    const distFromOrigin = haversineDist(flight.origin.lat, flight.origin.lon, flight.currentLat, flight.currentLon);
    if (distFromOrigin >= flight.totalDistanceKm * 0.5) {
      await fireFlightCheckpoint(flight, 'midpoint', 17, flight.currentLat, flight.currentLon, 'Mid-Route Position Report');
      await updateFlightStatus(flight, 'midpoint_passed');
    }
  }

  // ARRIVAL: on ground + within 50km of destination
  if (!flight.checkpointsFired.arrival && flight.checkpointsFired.departure && flight.onGround === true) {
    const distToDest = haversineDist(flight.currentLat, flight.currentLon, flight.dest.lat, flight.dest.lon);
    if (distToDest < 50) {
      await fireFlightCheckpoint(flight, 'arrival', 14, flight.dest.lat, flight.dest.lon, flight.dest.name + ' Arrival');
      await updateFlightStatus(flight, 'completed', { arrived_at: new Date().toISOString() });
      pollQueue = pollQueue.filter(f => f.id !== flight.id);
    }
  }
}

async function fireFlightCheckpoint(flight, key, eventType, lat, lon, label) {
  flight.checkpointsFired[key] = { pending: true };

  try {
    const res = await fetch(SB_SIM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        shipmentId: flight.shipmentId,
        eventType,
        location: { lat, lon, name: label },
        bundle: { shipmentId: flight.shipmentId, callsign: flight.flightId, icao24: flight.icao24, originName: flight.origin.name, destName: flight.dest.name, totalDistanceKm: flight.totalDistanceKm, event: label },
      }),
    });
    if (!res.ok) { delete flight.checkpointsFired[key]; return; }
    const txData = await res.json();
    flight.checkpointsFired[key] = txData;

    await fetch(`${FLIGHT_REST}?id=eq.${flight.id}`, {
      method: 'PATCH',
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
      body: JSON.stringify({ checkpoints_fired: flight.checkpointsFired }),
    });

    // Add feed card
    const feedEl = document.getElementById('opsFeed');
    if (feedEl) {
      const card = document.createElement('div');
      card.className = 'ops-feed-card new';
      card.innerHTML = `<div class="ops-feed-type" style="color:#22d3ee">LIVE · ${label}</div><div class="ops-feed-route">${flight.flightId} · ${flight.origin.name.split('(')[0]} → ${flight.dest.name.split('(')[0]}</div><div class="ops-feed-tx"><a href="https://sepolia.basescan.org/tx/${txData.txHash}" target="_blank">TX: ${txData.txHash?.slice(0,10)}...${txData.txHash?.slice(-6)}</a></div>`;
      card.onclick = () => openFlightSidebar(flight);
      feedEl.appendChild(card);
      feedEl.scrollLeft = feedEl.scrollWidth;
    }
  } catch (e) {
    console.warn('fireFlightCheckpoint failed:', e);
    delete flight.checkpointsFired[key];
  }
}

async function updateFlightStatus(flight, status, extra) {
  flight.status = status;
  const patch = { status, updated_at: new Date().toISOString(), ...extra };
  await fetch(`${FLIGHT_REST}?id=eq.${flight.id}`, {
    method: 'PATCH',
    headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON, 'Content-Type': 'application/json', 'Prefer': 'return=minimal' },
    body: JSON.stringify(patch),
  });
}

function updateLiveFlightStats() {
  const liveCount = activeFlights.filter(f => f.status !== 'completed').length;
  const badge = document.getElementById('liveFlightBadge');
  if (badge) badge.textContent = liveCount;
}

// ── CANDIDATE DISCOVERY ──
async function loadCandidateFlights() {
  const token = await getOSToken();
  if (!token) return [];

  const tracked = new Set();
  try {
    const tRes = await fetch(`${FLIGHT_REST}?select=icao24&status=neq.completed`, {
      headers: { 'apikey': SB_ANON, 'Authorization': 'Bearer ' + SB_ANON },
    });
    const tData = await tRes.json();
    if (Array.isArray(tData)) tData.forEach(r => tracked.add(r.icao24));
  } catch {}

  try {
    const res = await fetch('https://opensky-network.org/api/states/all', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!res.ok) return [];
    const d = await res.json();
    if (!d.states) return [];

    return d.states.filter(s => {
      const cs = (s[1] || '').trim().toUpperCase();
      return CARGO_PREFIXES.some(p => cs.startsWith(p))
        && s[6] && s[5]
        && s[8] === false
        && s[7] > 500
        && s[9] > 50
        && !tracked.has(s[0]);
    }).slice(0, 30).map(s => ({
      icao24: s[0],
      callsign: (s[1] || '').trim(),
      lat: s[6],
      lon: s[5],
      alt: s[7],
      heading: s[10],
      speed: s[9],
      country: s[2],
    }));
  } catch (e) { console.warn('loadCandidateFlights error:', e); return []; }
}

// ── COMMIT A FLIGHT ──
async function commitFlight() {
  const select = document.getElementById('flightSelect');
  const destSelect = document.getElementById('destAirport');
  const btn = document.getElementById('commitBtn');
  if (!select || !select.value) return;

  const candidate = JSON.parse(select.value);
  const destCode = destSelect.value;
  const dest = AIRPORTS[destCode];
  if (!dest) { alert('Select a destination'); return; }

  btn.disabled = true;
  btn.textContent = 'Committing...';

  const routePts = gcArc(candidate.lat, candidate.lon, dest.lat, dest.lon, 80);
  const totalDist = haversineDist(candidate.lat, candidate.lon, dest.lat, dest.lon);

  try {
    const res = await fetch(COMMIT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        icao24: candidate.icao24,
        callsign: candidate.callsign,
        originLat: candidate.lat,
        originLon: candidate.lon,
        originName: `${candidate.callsign} Origin (${candidate.country})`,
        destLat: dest.lat,
        destLon: dest.lon,
        destName: dest.name,
        routePts,
        totalDistanceKm: totalDist,
        metadata: { country: candidate.country, altAtCommit: candidate.alt, speedAtCommit: candidate.speed },
      }),
    });
    const data = await res.json();
    if (!data.success) { alert('Error: ' + (data.error || 'Unknown')); return; }

    const flight = {
      id: data.id, flightId: data.flightId, icao24: candidate.icao24,
      shipmentId: data.shipmentId, status: 'committed',
      origin: { lat: candidate.lat, lon: candidate.lon, name: `${candidate.callsign} Origin` },
      dest: { lat: dest.lat, lon: dest.lon, name: dest.name },
      currentLat: candidate.lat, currentLon: candidate.lon,
      currentAlt: candidate.alt, currentHeading: candidate.heading,
      currentSpeed: candidate.speed, onGround: false,
      checkpointsFired: data.createdTx ? { created: data.createdTx } : {},
      routePts, totalDistanceKm: totalDist, metadata: {},
      marker: null, label: null, routeLine: null,
    };

    activeFlights.push(flight);
    renderFlightOnMap(flight);
    pollQueue.push(flight);
    if (!pollTimer) startPollCoordinator();
    updateLiveFlightStats();

    map.flyTo([candidate.lat, candidate.lon], 5, { duration: 1.5 });

    document.getElementById('flightPanel').style.display = 'none';
  } catch (e) { alert('Error: ' + e.message); }
  finally { btn.disabled = false; btn.textContent = 'Commit to Track'; }
}

// ── SCAN UI ──
async function scanFlights() {
  const select = document.getElementById('flightSelect');
  const scanBtn = document.getElementById('scanBtn');
  select.innerHTML = '<option value="">Scanning...</option>';
  scanBtn.disabled = true;

  const candidates = await loadCandidateFlights();
  scanBtn.disabled = false;

  if (candidates.length === 0) {
    select.innerHTML = '<option value="">No cargo flights found</option>';
    return;
  }

  select.innerHTML = '<option value="">Select a cargo flight...</option>' +
    candidates.map(c => {
      const altKft = Math.round(c.alt * 3.28084 / 1000);
      const spdKts = Math.round(c.speed * 1.944);
      return `<option value='${JSON.stringify(c).replace(/'/g, "&#39;")}'>${c.callsign} · ${altKft}kft · ${spdKts}kts · ${c.country}</option>`;
    }).join('');
}
