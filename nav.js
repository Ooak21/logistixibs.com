// LOGISTIX Shared Navigation — inject into any page via <script src="./nav.js"></script>
// Requires a <div id="nav-mount"></div> as the first child of <body>

(function() {
  const pages = [
    { href: './hq.html', label: 'HQ', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>' },
    { href: './ops.html', label: 'OPS MAP', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 0 0-8 8c0 5.4 7 12 8 12s8-6.6 8-12a8 8 0 0 0-8-8z"/></svg>' },
    { href: './dashboard.html', label: 'SIMULATOR', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20V10"/><path d="M18 20V4"/><path d="M6 20v-4"/></svg>' },
    { href: './driver.html', label: 'DRIVER', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8h4a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2h-1"/><circle cx="7" cy="18" r="2"/><circle cx="17" cy="18" r="2"/></svg>' },
    { href: './track.html', label: 'TRACK', icon: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 12h-4l-3 9L9 3l-3 9H2"/></svg>' },
  ];

  const path = window.location.pathname;
  const current = path.split('/').pop() || 'index.html';

  const mount = document.getElementById('nav-mount');
  if (!mount) return;

  const tabs = pages.map(p => {
    const file = p.href.replace('./', '');
    const active = current === file;
    return `<a href="${p.href}" class="lnav-tab${active ? ' active' : ''}">${p.icon}<span>${p.label}</span></a>`;
  }).join('');

  mount.innerHTML = `
    <div class="lnav">
      <div class="lnav-brand">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2"><path d="M21 8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16Z"/><path d="m3.3 7 8.7 5 8.7-5"/><path d="M12 22V12"/></svg>
        <span class="lnav-name">LOGISTIX</span>
        <span class="lnav-by">by CORTEX</span>
      </div>
      <div class="lnav-tabs">${tabs}</div>
      <div class="lnav-right">
        <div class="lnav-chain"><span class="lnav-dot"></span>Base Sepolia</div>
      </div>
    </div>
  `;

  // Inject styles if not already present
  if (!document.getElementById('lnav-styles')) {
    const style = document.createElement('style');
    style.id = 'lnav-styles';
    style.textContent = `
      .lnav { display:flex; align-items:center; justify-content:space-between; padding:0 1.25rem; height:44px; background:rgba(8,8,20,0.97); border-bottom:1px solid rgba(255,255,255,0.06); position:sticky; top:0; z-index:100; backdrop-filter:blur(12px); }
      .lnav-brand { display:flex; align-items:center; gap:0.5rem; }
      .lnav-name { font-size:0.85rem; font-weight:700; letter-spacing:0.06em; color:#fff; }
      .lnav-by { font-size:0.4rem; color:rgba(245,158,11,0.6); border:1px solid rgba(245,158,11,0.2); padding:0.1rem 0.35rem; border-radius:9999px; font-weight:700; letter-spacing:0.12em; text-transform:uppercase; }
      .lnav-tabs { display:flex; align-items:center; gap:0.15rem; }
      .lnav-tab { display:flex; align-items:center; gap:0.35rem; padding:0.35rem 0.65rem; font-size:0.5rem; font-weight:600; letter-spacing:0.1em; text-transform:uppercase; color:rgba(255,255,255,0.3); text-decoration:none; border-radius:4px; transition:all 0.2s; }
      .lnav-tab:hover { color:rgba(255,255,255,0.6); background:rgba(255,255,255,0.03); }
      .lnav-tab.active { color:#f59e0b; background:rgba(245,158,11,0.08); }
      .lnav-tab svg { opacity:0.6; }
      .lnav-tab.active svg { opacity:1; stroke:#f59e0b; }
      .lnav-right { display:flex; align-items:center; gap:0.8rem; }
      .lnav-chain { display:flex; align-items:center; gap:0.3rem; font-size:0.5rem; color:rgba(255,255,255,0.35); }
      .lnav-dot { width:5px; height:5px; border-radius:50%; background:#34d399; animation:lnavPulse 2s infinite; }
      @keyframes lnavPulse { 0%,100%{opacity:1} 50%{opacity:0.3} }
      @media(max-width:768px) { .lnav-tab span { display:none; } .lnav-tab { padding:0.35rem; } }
    `;
    document.head.appendChild(style);
  }
})();
