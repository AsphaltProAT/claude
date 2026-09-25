/* ============================================================================
   VELOCITY HORIZON — interface
   Title screen, pause/settings/controls, garage & tuning shop, world map,
   results, ending, HUD (gauge, event bar, skill chain, toasts, prompts).
   game.js hands in an `api` object; everything here is DOM + canvas.
   ========================================================================== */
(function () {
'use strict';
window.VH = window.VH || {};

const $ = (id) => document.getElementById(id);
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const hex = (c) => '#' + ('000000' + c.toString(16)).slice(-6);
const starStr = (n) => '★'.repeat(n) + '☆'.repeat(3 - n);

VH.createUI = function (api) {
  const body = document.body;
  let current = null;             // visible overlay screen element
  let screenStack = [];           // for "back" from sub-screens
  let state = 'boot';

  /* ------------------------------------------------------------ screens -- */
  function show(id, push) {
    if (current && push) screenStack.push(current.id);
    else if (!push) screenStack = [];
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('open'));
    current = id ? $(id) : null;
    $('overlay').classList.toggle('open', !!current && current.id !== 'screen-title-main');
    if (current) {
      current.classList.add('open');
      focusFirst();
    }
  }
  function subBack() {
    if (!screenStack.length) return false;
    const prev = screenStack.pop();
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('open'));
    current = $(prev);
    current.classList.add('open');
    $('overlay').classList.toggle('open', current.id !== 'screen-title-main');
    focusFirst();
    api.sfx('back');
    return true;
  }
  function focusables() {
    if (!current) return [];
    return Array.from(current.querySelectorAll('.btn:not([disabled]), .seg button, input[type=range], .vitem'))
      .filter(e => e.offsetParent !== null);
  }
  function focusFirst() {
    const f = focusables();
    const pref = current && current.querySelector('.btn.primary:not([disabled])');
    (pref || f[0] || { focus() {} }).focus();
  }
  function menuMove(d, horizontal) {
    const f = focusables();
    if (!f.length) return;
    const i = f.indexOf(document.activeElement);
    if (horizontal && document.activeElement && document.activeElement.type === 'range') {
      const r = document.activeElement;
      r.value = +r.value + d * (+r.step || 1) * 5;
      r.dispatchEvent(new Event('input'));
      return;
    }
    const n = f[(i + d + f.length) % f.length];
    n.focus();
    api.sfx('hover');
  }
  function menuConfirm() {
    const a = document.activeElement;
    if (a && current && current.contains(a) && a.click) a.click();
    else focusFirst();
  }
  addEventListener('keydown', (e) => {
    if (!current || state === 'play') return;
    if (e.code === 'ArrowDown' || (e.code === 'Tab' && !e.shiftKey && state !== 'map')) { e.preventDefault(); menuMove(1); }
    else if (e.code === 'ArrowUp') { e.preventDefault(); menuMove(-1); }
    else if (e.code === 'ArrowLeft' || e.code === 'ArrowRight') {
      const a = document.activeElement;
      if (a && a.type === 'range') return;          // native slider handling
      if (a && a.parentElement && a.parentElement.classList.contains('seg')) {
        const sibs = Array.from(a.parentElement.children);
        const n = sibs[(sibs.indexOf(a) + (e.code === 'ArrowRight' ? 1 : -1) + sibs.length) % sibs.length];
        n.focus(); n.click(); e.preventDefault();
      }
    } else if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const a = document.activeElement;
      if (a && current.contains(a) && a.tagName !== 'BUTTON') { e.preventDefault(); a.click(); }
      else if (!a || !current.contains(a)) { e.preventDefault(); focusFirst(); }
    }
  });
  document.addEventListener('mouseover', (e) => {
    const b = e.target.closest && e.target.closest('.btn, .vitem, .seg button');
    if (b && !b.disabled && b !== lastHover) { lastHover = b; api.sfx('hover'); }
  });
  let lastHover = null;
  document.addEventListener('click', (e) => {
    const b = e.target.closest && e.target.closest('.btn, .seg button');
    if (b && !b.disabled && !b.dataset.silent) api.sfx('click');
  }, true);

  function btn(label, onClick, cls) {
    const b = el('button', 'btn' + (cls ? ' ' + cls : ''), label);
    b.addEventListener('click', onClick);
    return b;
  }

  /* -------------------------------------------------------------- title -- */
  function showTitle(hasSave) {
    const menu = $('title-menu');
    menu.innerHTML = '';
    if (hasSave) {
      const p = api.profile;
      const c = btn(`Continue <small>Level ${p.level} · ${fmt(p.credits)} CR · ${api.totalStars()} ★</small>`, () => api.continueGame(), 'primary');
      menu.appendChild(c);
    }
    menu.appendChild(btn('New Game', () => {
      if (hasSave) confirmBox('Start a new career?', 'Your saved progress will be erased.', 'Start over', () => api.newGame(), 'screen-title-main');
      else api.newGame();
    }, hasSave ? '' : 'primary'));
    menu.appendChild(btn('Settings', () => openSettings(true)));
    menu.appendChild(btn('Controls', () => { show('screen-controls', true); }));
    menu.appendChild(btn('Credits', () => { show('screen-credits', true); }));
    $('title').classList.add('open');
    show('screen-title-main');
  }
  function hideTitle() { $('title').classList.remove('open'); show(null); }

  function confirmBox(title, text, okLabel, onOk, returnTo) {
    $('confirm-title').textContent = title;
    $('confirm-text').textContent = text;
    const row = $('confirm-btns');
    row.innerHTML = '';
    row.appendChild(btn(okLabel, () => { onOk(); }, 'danger'));
    row.appendChild(btn('Cancel', () => subBack(), 'primary'));
    show('screen-confirm', true);
    void returnTo;
  }

  /* -------------------------------------------------------------- pause -- */
  function openPause(inEvent) {
    const m = $('pause-menu');
    m.innerHTML = '';
    m.appendChild(btn('Resume', () => api.resume(), 'primary'));
    if (inEvent) {
      m.appendChild(btn('Restart Event', () => api.restartEvent()));
      m.appendChild(btn('Quit Event', () => api.quitEvent()));
    } else {
      m.appendChild(btn('Garage', () => api.openGarage()));
      m.appendChild(btn('World Map', () => api.openMap()));
    }
    m.appendChild(btn('Settings', () => openSettings(true)));
    m.appendChild(btn('Controls', () => show('screen-controls', true)));
    m.appendChild(btn('Save &amp; Quit to Title', () => api.quitToTitle()));
    const p = api.profile, s = p.stats;
    $('pause-stats').innerHTML = `
      <div><b>${p.level}</b><span>Level</span></div>
      <div><b>${fmt(p.credits)}</b><span>Credits</span></div>
      <div><b>${api.totalStars()} / ${api.maxStars()}</b><span>Stars</span></div>
      <div><b>${p.tokens.length} / 30</b><span>Tokens</span></div>
      <div><b>${(s.distance / 1000).toFixed(1)} km</b><span>Driven</span></div>
      <div><b>${s.racesWon}</b><span>Wins</span></div>`;
    show('screen-pause');
  }
  function closePanels() { show(null); $('help').classList.remove('open'); }

  /* ----------------------------------------------------------- settings -- */
  function openSettings(push) {
    const s = api.settings;
    const box = $('settings-rows');
    box.innerHTML = '';
    const seg = (label, key, opts) => {
      const row = el('div', 'srow');
      row.appendChild(el('label', '', label));
      const g = el('div', 'seg');
      for (const [v, t] of opts) {
        const b = el('button', s[key] === v ? 'on' : '', t);
        b.addEventListener('click', () => {
          api.applySettings({ [key]: v });
          g.querySelectorAll('button').forEach(x => x.classList.remove('on'));
          b.classList.add('on');
        });
        g.appendChild(b);
      }
      row.appendChild(g);
      box.appendChild(row);
    };
    const slider = (label, key, min, max, step, show) => {
      const row = el('div', 'srow');
      row.appendChild(el('label', '', label));
      const wrap = el('div', 'slider');
      const r = el('input'); r.type = 'range'; r.min = min; r.max = max; r.step = step; r.value = s[key];
      const v = el('span', 'val', show(s[key]));
      r.addEventListener('input', () => { api.applySettings({ [key]: +r.value }); v.textContent = show(+r.value); });
      wrap.appendChild(r); wrap.appendChild(v);
      row.appendChild(wrap);
      box.appendChild(row);
    };
    const pct = (x) => Math.round(x * 100) + '%';
    box.appendChild(el('h4', '', 'Graphics'));
    seg('Quality', 'quality', [['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['ultra', 'Ultra']]);
    slider('Field of view', 'fov', 50, 80, 1, x => x + '°');
    seg('Camera shake', 'shake', [[true, 'On'], [false, 'Off']]);
    box.appendChild(el('h4', '', 'Audio'));
    slider('Master volume', 'master', 0, 1, 0.05, pct);
    slider('Music', 'music', 0, 1, 0.05, pct);
    slider('Effects', 'sfx', 0, 1, 0.05, pct);
    box.appendChild(el('h4', '', 'Gameplay'));
    seg('Speed units', 'units', [['kmh', 'km/h'], ['mph', 'mph']]);
    seg('Rival difficulty', 'difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard']]);
    seg('Traffic', 'traffic', [[true, 'On'], [false, 'Off']]);
    seg('Dynamic weather', 'weather', [[true, 'On'], [false, 'Off']]);
    seg('Flight pitch', 'invertPitch', [[false, 'Normal'], [true, 'Inverted']]);
    show('screen-settings', push);
  }

  /* ------------------------------------------------------------- garage -- */
  let garageSel = null;
  function openGarage() {
    garageSel = api.currentVehicle();
    renderGarage();
    show('screen-garage');
  }
  function statRow(label, base, now, max) {
    const b = Math.min(100, base / max * 100), n = Math.min(100, now / max * 100);
    return `<div class="gstat"><span>${label}</span><span class="gbar"><i style="width:${b}%"></i><em style="left:${b}%;width:${Math.max(0, n - b)}%"></em></span></div>`;
  }
  function renderGarage() {
    const p = api.profile;
    $('garage-credits').innerHTML = `${fmt(p.credits)} <small>CR</small> &nbsp;·&nbsp; Level ${p.level}`;
    const list = $('garage-list');
    list.innerHTML = '';
    for (const v of api.vehicles) {
      const owned = p.owned.includes(v.id);
      const locked = !owned && p.level < v.level;
      const item = el('div', 'vitem' + (v.id === garageSel ? ' sel' : '') + (v.id === api.currentVehicle() ? ' current' : ''));
      item.tabIndex = 0;
      item.innerHTML = `<div class="vk">${v.key}</div>
        <div class="vn">${v.name}<small>${v.cls}</small></div>
        <div class="vp">${owned ? (v.id === api.currentVehicle() ? '<b class="drv">DRIVING</b>' : '<b class="own">OWNED</b>') : locked ? '🔒 Lv ' + v.level : fmt(v.price) + ' CR'}</div>`;
      item.style.setProperty('--paint', hex(api.vehicleStats(v).color));
      item.addEventListener('click', () => { garageSel = v.id; renderGarage(); api.sfx('click'); });
      list.appendChild(item);
    }
    const v = api.vehicleById(garageSel);
    const st = api.vehicleStats(v);
    const owned = p.owned.includes(v.id);
    const det = $('garage-detail');
    const plane = v.kind === 'plane';
    det.innerHTML = `
      <div class="gtitle"><h3>${v.name}</h3><span class="tp">${v.cls}</span></div>
      <p class="blurb">${v.blurb}</p>
      <div class="gstats">
        ${statRow('Top speed', v.maxSpeed, st.maxSpeed, 145)}
        ${statRow('Acceleration', v.accel, st.accel, 36)}
        ${statRow(plane ? 'Turn rate' : 'Handling', v.turn * (plane ? 1.6 : 1), st.turn * (plane ? 1.6 : 1), 3.6)}
        ${plane ? '' : statRow('Off-road', v.offroad * 100, st.offroad * 100, 100)}
      </div>
      <div class="gspeed">${api.speedText(st.maxSpeed)} top speed</div>`;
    const actions = el('div', 'gactions');
    if (!owned) {
      if (p.level < v.level) actions.appendChild(el('div', 'lockmsg', `🔒 Reach level ${v.level} to buy`));
      else {
        const b = btn(`Buy for ${fmt(v.price)} CR`, () => {
          const r = api.buyVehicle(v.id);
          if (!r.ok) { api.sfx('error'); flash(r.msg); }
          renderGarage();
        }, 'primary');
        if (p.credits < v.price) { b.disabled = true; b.title = 'Not enough credits'; }
        actions.appendChild(b);
      }
    } else if (v.id !== api.currentVehicle()) {
      actions.appendChild(btn('Drive this', () => { api.selectVehicle(v.id); renderGarage(); }, 'primary'));
    }
    det.appendChild(actions);
    if (owned) {
      const up = api.upgradesOf(v.id);
      const U = api.content.UPGRADES;
      const ups = el('div', 'gups');
      ups.appendChild(el('h4', '', 'Upgrades'));
      for (const slot of ['engine', 'handling', 'nitro']) {
        if (plane && slot === 'nitro') continue;
        const def = U[slot];
        const stage = up[slot];
        const row = el('div', 'uprow');
        const name = plane && def.planeName ? def.planeName : def.name;
        const desc = plane && def.planeDesc ? def.planeDesc : def.desc;
        row.innerHTML = `<div class="un">${name}<small>${desc}</small></div>
          <div class="pips">${[0, 1, 2].map(i => `<i class="${i < stage ? 'on' : ''}"></i>`).join('')}</div>`;
        if (stage < 3) {
          const cost = api.content.upgradeCost(v, slot, stage);
          const b = btn(`${fmt(cost)} CR`, () => {
            const r = api.buyUpgrade(v.id, slot);
            if (!r.ok) { api.sfx('error'); flash(r.msg); }
            renderGarage();
          }, 'small');
          if (p.credits < cost) b.disabled = true;
          row.appendChild(b);
        } else row.appendChild(el('span', 'maxed', 'MAX'));
        ups.appendChild(row);
      }
      det.appendChild(ups);
      if (!v.glbPlane) {
        const paints = el('div', 'gpaint');
        paints.appendChild(el('h4', '', 'Paint'));
        const sw = el('div', 'swatches');
        for (const c of [v.color].concat(api.content.PAINTS.filter(x => x !== v.color))) {
          const s = el('button', 'sw' + (st.color === c ? ' on' : ''));
          s.style.background = hex(c);
          s.title = hex(c);
          s.dataset.silent = '1';
          s.addEventListener('click', () => { api.setPaint(v.id, c); renderGarage(); });
          sw.appendChild(s);
        }
        paints.appendChild(sw);
        det.appendChild(paints);
      }
    }
  }
  function flash(text) { message(text, 1300); }

  /* ---------------------------------------------------------------- map -- */
  const mapEl = $('worldmap');
  const mctx = mapEl.getContext('2d');
  let mapInfo = null, mapHover = null, mapSel = null, mapScale = 1, mapOff = { x: 0, y: 0 };
  function openMap() {
    mapSel = null;
    mapInfo = api.mapInfo();
    sizeMap();
    renderMapSide();
    show('screen-map');
  }
  function sizeMap() {
    const wrap = $('map-wrap');
    const w = wrap.clientWidth || 600, h = wrap.clientHeight || 600;
    const s = Math.max(200, Math.min(w, h));
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    mapEl.width = s * dpr; mapEl.height = s * dpr;
    mapEl.style.width = s + 'px'; mapEl.style.height = s + 'px';
    mapScale = s * dpr / mapInfo.world;
    mapOff = { x: mapInfo.world / 2, y: mapInfo.world / 2 };
  }
  const w2m = (x, z) => [(x + mapOff.x) * mapScale, (z + mapOff.y) * mapScale];
  function drawMap() {
    if (!mapInfo || !current || current.id !== 'screen-map') return;
    mapInfo = api.mapInfo();
    const g = mctx, S = mapEl.width, dpr = S / parseFloat(mapEl.style.width);
    g.clearRect(0, 0, S, S);
    g.drawImage(mapInfo.canvas, 0, 0, S, S);
    g.fillStyle = 'rgba(4,8,20,0.18)'; g.fillRect(0, 0, S, S);
    // stunts
    const icon = (x, z, color, shape, r) => {
      const [mx, my] = w2m(x, z);
      g.fillStyle = color; g.strokeStyle = 'rgba(0,0,0,0.6)'; g.lineWidth = 1.5 * dpr;
      g.beginPath();
      if (shape === 'sq') g.rect(mx - r, my - r, r * 2, r * 2);
      else if (shape === 'tri') { g.moveTo(mx, my - r); g.lineTo(mx + r, my + r * 0.8); g.lineTo(mx - r, my + r * 0.8); g.closePath(); }
      else g.arc(mx, my, r, 0, Math.PI * 2);
      g.fill(); g.stroke();
      return [mx, my];
    };
    const r5 = 5 * dpr;
    for (const t of mapInfo.traps) icon(t.x, t.z, '#3be8ff', 'sq', r5);
    for (const d of mapInfo.drifts) icon(d.x, d.z, '#b45cff', 'sq', r5);
    for (const j of mapInfo.jumps) icon(j.x, j.z, '#f2b41c', 'tri', r5 * 1.2);
    // tokens: found ones everywhere, unfound ones only when close
    for (const t of mapInfo.tokens) {
      const near = Math.hypot(t.x - mapInfo.player.x, t.z - mapInfo.player.z) < 450;
      if (!t.found && !near) continue;
      const [mx, my] = w2m(t.x, t.z);
      g.fillStyle = t.found ? 'rgba(45,224,255,0.35)' : '#2de0ff';
      g.beginPath(); g.moveTo(mx, my - 5 * dpr); g.lineTo(mx + 4 * dpr, my); g.lineTo(mx, my + 5 * dpr); g.lineTo(mx - 4 * dpr, my); g.fill();
    }
    // events
    for (const e of mapInfo.events) {
      const [mx, my] = w2m(e.x, e.z);
      const hov = mapHover === e.id || mapSel === e.id;
      const r = (hov ? 13 : 10) * dpr;
      g.fillStyle = e.lock ? '#586074' : hex(e.color);
      g.strokeStyle = hov ? '#fff' : 'rgba(0,0,0,0.65)'; g.lineWidth = (hov ? 3 : 2) * dpr;
      g.beginPath(); g.arc(mx, my, r, 0, Math.PI * 2); g.fill(); g.stroke();
      g.fillStyle = '#fff'; g.font = `bold ${11 * dpr}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(e.lock ? '🔒' : e.icon, mx, my + 0.5 * dpr);
      if (e.stars) {
        g.fillStyle = '#ffd75e'; g.font = `bold ${9 * dpr}px sans-serif`;
        g.fillText('★'.repeat(e.stars), mx, my + r + 8 * dpr);
      }
      if (hov) {
        g.font = `bold ${12 * dpr}px Segoe UI, sans-serif`;
        const tw = g.measureText(e.name).width + 16 * dpr;
        g.fillStyle = 'rgba(8,12,26,0.9)';
        g.fillRect(mx - tw / 2, my - r - 26 * dpr, tw, 20 * dpr);
        g.fillStyle = '#fff'; g.fillText(e.name, mx, my - r - 16 * dpr);
      }
    }
    // player
    const [px, py] = w2m(mapInfo.player.x, mapInfo.player.z);
    g.save(); g.translate(px, py);
    g.rotate(Math.atan2(Math.cos(mapInfo.player.yaw), Math.sin(mapInfo.player.yaw)) + Math.PI / 2);
    g.fillStyle = '#59d1ff'; g.strokeStyle = '#06101f'; g.lineWidth = 2 * dpr;
    g.beginPath(); g.moveTo(0, -11 * dpr); g.lineTo(8 * dpr, 8 * dpr); g.lineTo(0, 4 * dpr); g.lineTo(-8 * dpr, 8 * dpr); g.closePath();
    g.fill(); g.stroke();
    g.restore();
    const pulse = (performance.now() % 1400) / 1400;
    g.strokeStyle = `rgba(89,209,255,${1 - pulse})`; g.lineWidth = 2 * dpr;
    g.beginPath(); g.arc(px, py, (8 + pulse * 22) * dpr, 0, Math.PI * 2); g.stroke();
  }
  function mapPick(e) {
    const r = mapEl.getBoundingClientRect();
    const dpr = mapEl.width / r.width;
    const x = (e.clientX - r.left) * dpr, y = (e.clientY - r.top) * dpr;
    let best = null, bd = 18 * dpr;
    for (const ev of mapInfo.events) {
      const [mx, my] = w2m(ev.x, ev.z);
      const d = Math.hypot(mx - x, my - y);
      if (d < bd) { bd = d; best = ev.id; }
    }
    return best;
  }
  mapEl.addEventListener('mousemove', (e) => {
    const id = mapPick(e);
    if (id !== mapHover) { mapHover = id; mapEl.style.cursor = id ? 'pointer' : 'default'; if (id) api.sfx('hover'); }
  });
  mapEl.addEventListener('click', (e) => {
    const id = mapPick(e);
    mapSel = id;
    api.sfx('click');
    renderMapSide();
  });
  function renderMapSide() {
    const side = $('map-side');
    side.innerHTML = '';
    const info = mapInfo;
    if (mapSel) {
      const e = info.events.find(x => x.id === mapSel);
      side.appendChild(eventCardEl(e, true));
      const row = el('div', 'row');
      const ft = btn('Fast travel', () => { if (!api.fastTravel(e.id)) { api.sfx('error'); } }, 'primary');
      if (info.inEvent) { ft.disabled = true; ft.title = 'Not during events'; }
      row.appendChild(ft);
      row.appendChild(btn('Back', () => { mapSel = null; renderMapSide(); }));
      side.appendChild(row);
      focusFirst();
      return;
    }
    side.appendChild(el('h3', '', 'Island of Velocity'));
    side.appendChild(el('div', 'mstat', `<b>${info.stars}</b> / ${info.maxStars} stars &nbsp;·&nbsp; <b>${info.tokens.filter(t => t.found).length}</b> / ${info.tokens.length} tokens`));
    const list = el('div', 'mlist');
    for (const e of info.events) {
      const it = el('button', 'btn mitem', `<i style="background:${e.lock ? '#586074' : hex(e.color)}">${e.lock ? '🔒' : e.icon}</i><span>${e.name}<small>${e.type}${e.lock ? ' · ' + e.lock : ''}</small></span><b>${e.stars ? starStr(e.stars) : ''}</b>`);
      it.addEventListener('click', () => { mapSel = e.id; renderMapSide(); });
      it.addEventListener('mouseenter', () => { mapHover = e.id; });
      list.appendChild(it);
    }
    side.appendChild(list);
    const stunts = el('div', 'mstunts');
    const block = (title, color, items) => {
      stunts.appendChild(el('h4', '', `<i style="background:${color}"></i>${title}`));
      for (const s of items) stunts.appendChild(el('div', 'srec', `<span>${s.name}</span><b>${s.rec ? starStr(s.rec.stars) + ' ' + s.fmt(s.rec.best) : '—'}</b>`));
    };
    block('Speed traps', '#3be8ff', info.traps);
    block('Drift zones', '#b45cff', info.drifts);
    block('Danger jumps', '#f2b41c', info.jumps);
    side.appendChild(stunts);
    side.appendChild(el('p', 'mhint', 'Click an event to fast travel. Unfound tokens show up on the map when you are near.'));
  }
  addEventListener('resize', () => { if (current && current.id === 'screen-map') { sizeMap(); } });

  /* --------------------------------------------------------- event card -- */
  function eventCardEl(c, full) {
    const d = el('div', 'ecard');
    d.style.setProperty('--ec', hex(c.color));
    const req = c.lock ? `<div class="req bad">🔒 ${c.lock}</div>`
      : !c.vehicleOK ? `<div class="req bad">Requires ${c.allow} — switch vehicle (V)</div>`
      : `<div class="req">${c.allow}</div>`;
    d.innerHTML = `<div class="etype">${c.type}</div>
      <div class="ename">${c.name}</div>
      ${full ? `<div class="edesc">${c.desc}</div>` : ''}
      <div class="edetail">${c.detail}</div>
      <div class="erow"><span class="estars">${starStr(c.stars)}</span>${c.best ? `<span>Best ${api.fmtTime(c.best)}</span>` : ''}
      <span class="ereward">${fmt(c.reward.credits)} CR · ${fmt(c.reward.xp)} XP${c.done ? ' <small>(repeat 60%)</small>' : ''}</span></div>
      ${req}`;
    return d;
  }
  let promptId = null, promptKey = '';
  function prompt(card) {
    const p = $('prompt');
    if (!card) { p.classList.remove('open'); promptId = null; return; }
    const key = card.id + card.vehicleOK + card.lock + card.stars;
    if (key !== promptKey) {
      promptKey = key;
      p.innerHTML = '';
      p.appendChild(eventCardEl(card, true));
      const go = el('div', 'go', card.lock || !card.vehicleOK ? '' : '<kbd>ENTER</kbd> / <kbd>Ⓐ</kbd> start event');
      p.appendChild(go);
    }
    if (promptId !== card.id) api.sfx('hover');
    promptId = card.id;
    p.classList.add('open');
  }

  /* ------------------------------------------------------------ results -- */
  let resultsChamp = false;
  function showResults(r) {
    resultsChamp = r.champion;
    const box = $('results-body');
    const ord = (n) => n + (n === 1 ? 'st' : n === 2 ? 'nd' : n === 3 ? 'rd' : 'th');
    const head = r.field
      ? `<div class="rpos p${r.position}">${ord(r.position)}<small> / ${r.field}</small></div>`
      : `<div class="rpos trial">${r.stars ? 'COMPLETE' : 'FINISHED'}</div>`;
    box.innerHTML = `
      <div class="rtype" style="color:${hex(r.color)}">${r.type}</div>
      <h2>${r.name}</h2>
      ${head}
      <div class="rstars">${[0, 1, 2].map(i => `<span class="${i < r.stars ? 'on' : ''}" style="animation-delay:${0.4 + i * 0.25}s">★</span>`).join('')}</div>
      <div class="rgrid">
        <div><span>Time</span><b>${r.timeText}${r.newBest ? ' <em>NEW BEST</em>' : ''}</b></div>
        ${r.bestLap ? `<div><span>Best lap</span><b>${r.bestLap}</b></div>` : ''}
        ${r.targets ? `<div><span>Star times</span><b class="tg">★ ${r.targets[0]} &nbsp; ★★ ${r.targets[1]} &nbsp; ★★★ ${r.targets[2]}</b></div>` : ''}
      </div>
      <div class="rrew">
        <div><span>Credits</span><b id="rw-cr">0</b></div>
        <div><span>XP</span><b id="rw-xp">0</b></div>
      </div>
      ${r.first ? '' : '<p class="rnote">Repeat run — rewards at 60%</p>'}
      ${r.champion ? '<p class="rchamp">🏆 FESTIVAL CHAMPION 🏆</p>' : ''}`;
    const row = $('results-btns');
    row.innerHTML = '';
    row.appendChild(btn('Continue <kbd>Enter</kbd>', () => api.resultsContinue(), 'primary'));
    row.appendChild(btn('Restart <kbd>R</kbd>', () => api.resultsRestart()));
    countUp($('rw-cr'), r.credits, 900);
    countUp($('rw-xp'), r.xp, 900);
    show('screen-results');
  }
  function countUp(node, target, delay) {
    const t0 = performance.now() + delay;
    const tick = () => {
      const t = clamp01((performance.now() - t0) / 1100);
      node.textContent = '+' + fmt(target * (1 - Math.pow(1 - t, 3)));
      if (t < 1) requestAnimationFrame(tick);
    };
    tick();
  }
  const clamp01 = (x) => x < 0 ? 0 : x > 1 ? 1 : x;
  function hideResults() { show(null); }

  function showEnding(stats) {
    $('ending-stats').innerHTML = stats.map(([k, v]) => `<div><span>${k}</span><b>${v}</b></div>`).join('');
    const row = $('ending-btns');
    row.innerHTML = '';
    row.appendChild(btn('Keep driving', () => { hideEnding(); api.resume(); }, 'primary'));
    show('screen-ending');
  }
  function hideEnding() { show(null); }

  /* ------------------------------------------------------------- HUD ------ */
  const gauge = $('gauge'), gctx = gauge.getContext('2d');
  const G_CSS = 230;
  (function sizeGauge() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    gauge.width = gauge.height = G_CSS * dpr;
    gauge.style.width = gauge.style.height = G_CSS + 'px';
    gctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  })();
  function drawGauge(h) {
    const g = gctx, S = G_CSS, c = S / 2, R = S / 2 - 16;
    g.clearRect(0, 0, S, S);
    const a0 = Math.PI * 0.75, sweep = Math.PI * 1.5;
    // dial face
    const face = g.createRadialGradient(c, c, 10, c, c, R + 12);
    face.addColorStop(0, 'rgba(14,22,46,0.82)'); face.addColorStop(1, 'rgba(6,10,24,0.9)');
    g.fillStyle = face; g.beginPath(); g.arc(c, c, R + 12, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(130,170,255,0.25)'; g.lineWidth = 1.5; g.stroke();
    const plane = h.kind === 'plane';
    const val = plane ? h.throttle : h.rpm;
    // ticks
    for (let i = 0; i <= 40; i++) {
      const a = a0 + sweep * i / 40, major = i % 5 === 0;
      const red = !plane && i >= 34;
      g.strokeStyle = red ? 'rgba(255,80,90,0.9)' : major ? 'rgba(220,232,255,0.8)' : 'rgba(160,180,220,0.35)';
      g.lineWidth = major ? 2.2 : 1.2;
      const r1 = R - (major ? 12 : 7);
      g.beginPath(); g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1); g.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R); g.stroke();
    }
    // rpm / throttle arc
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 7;
    g.beginPath(); g.arc(c, c, R - 20, a0, a0 + sweep); g.stroke();
    const grad = g.createLinearGradient(0, S, S, 0);
    grad.addColorStop(0, '#3be8ff'); grad.addColorStop(0.55, '#8f7bff'); grad.addColorStop(1, '#ff4f7b');
    g.strokeStyle = grad; g.lineWidth = 7;
    g.beginPath(); g.arc(c, c, R - 20, a0, a0 + sweep * Math.max(0.005, Math.min(1, val))); g.stroke();
    // nitro ring (outer)
    if (!plane) {
      g.strokeStyle = 'rgba(255,255,255,0.07)'; g.lineWidth = 4;
      g.beginPath(); g.arc(c, c, R + 6, a0, a0 + sweep); g.stroke();
      g.strokeStyle = h.nitroOn ? '#ffb13b' : '#3be8ff'; g.lineWidth = 4;
      g.beginPath(); g.arc(c, c, R + 6, a0, a0 + sweep * h.nitro / 100); g.stroke();
    }
    g.lineCap = 'butt';
    // needle
    const na = a0 + sweep * Math.min(1.02, val);
    g.strokeStyle = '#ff4f7b'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(c + Math.cos(na) * 22, c + Math.sin(na) * 22); g.lineTo(c + Math.cos(na) * (R - 4), c + Math.sin(na) * (R - 4)); g.stroke();
    // readout
    const mph = h.units === 'mph';
    const spd = Math.round(h.speed * (mph ? 2.237 : 3.6));
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#fff'; g.font = '800 50px Segoe UI, system-ui, sans-serif';
    g.fillText(spd, c, c + 4);
    g.fillStyle = '#7ec8ff'; g.font = '600 12px Segoe UI, sans-serif';
    g.fillText(mph ? 'MPH' : 'KM/H', c, c + 36);
    if (plane) {
      g.fillStyle = '#ffd75e'; g.font = '700 14px Segoe UI, sans-serif';
      g.fillText(Math.round(h.alt) + ' m', c, c + 64);
      g.fillStyle = '#93a4c8'; g.font = '600 10px Segoe UI, sans-serif';
      g.fillText('ALT · THR ' + Math.round(h.throttle * 100) + '%', c, c + 80);
    } else {
      const gear = h.gear === 0 ? 'R' : h.speed < 0.5 && h.gear === 1 ? 'N' : String(h.gear);
      g.fillStyle = h.rpm > 0.88 ? '#ff4f7b' : '#ffd75e';
      g.font = '800 24px Segoe UI, sans-serif';
      g.fillText(gear, c, c + 66);
      g.fillStyle = '#93a4c8'; g.font = '600 9px Segoe UI, sans-serif';
      g.fillText('NITRO', c - 62, c + 80);
    }
  }
  let lastCredits = null;
  function hud(h) {
    drawGauge(h);
    // profile strip
    $('lv-num').textContent = h.level;
    $('xp-fill').style.width = Math.min(100, h.xp / h.xpNext * 100) + '%';
    if (lastCredits !== h.credits) { $('cr-val').textContent = fmt(h.credits); lastCredits = h.credits; }
    // event bar
    const eb = $('hud-event');
    if (h.event) {
      const e = h.event;
      eb.classList.add('racing');
      let main, sub;
      if (e.phase === 'countdown' || e.phase === 'intro') {
        main = e.name.toUpperCase(); sub = 'GET READY';
      } else if (e.ai) {
        main = `<span class="pos">${e.pos}<small>/${e.field}</small></span> <span class="sep"></span> LAP ${e.lap}/${e.laps} <span class="sep"></span> ${e.time}`;
        sub = `Checkpoint ${e.cp}/${e.cps} · ${e.dist} m to next gate${e.bestLap ? ' · best lap ' + e.bestLap : ''}`;
      } else {
        main = `${e.time} <span class="sep"></span> <span class="st">${e.starsNow ? starStr(e.starsNow) : '☆☆☆'}</span>`;
        sub = `${e.type === 'air' ? 'Ring' : 'Checkpoint'} ${e.cp + 1}/${e.cps} · ${e.dist} m${e.nextStar ? ' · keep ' + starStr(e.starsNow) + ' under ' + e.nextStar : ''}`;
      }
      $('ev-main').innerHTML = main; $('ev-sub').textContent = sub;
    } else {
      eb.classList.remove('racing');
      $('ev-main').innerHTML = h.driftZone !== null ? `DRIFT ZONE <span class="sep"></span> ${fmt(h.driftZone)} pts` : 'FREE ROAM';
      $('ev-sub').innerHTML = h.driftZone !== null ? 'Drift to the purple gate!' :
        '<kbd>M</kbd> map · <kbd>V</kbd> garage · <kbd>Esc</kbd> menu · <kbd>H</kbd> help';
    }
    // skill chain
    const ch = $('hud-chain');
    if (h.chain) {
      ch.classList.add('open');
      $('chain-total').textContent = fmt(h.chain.chain + (h.chain.cur ? h.chain.curPts * h.chain.mult : 0));
      $('chain-mult').textContent = 'x' + h.chain.mult;
      $('chain-cur').textContent = h.chain.cur ? `${h.chain.cur}  +${fmt(h.chain.curPts)}` : 'keep it going…';
      $('chain-bar').style.width = Math.max(0, Math.min(1, h.chain.timer)) * 100 + '%';
    } else ch.classList.remove('open');
  }
  function skillPop(name, pts) {
    const p = el('div', 'spop', `${name} <b>+${fmt(pts)}</b>`);
    $('skill-pops').appendChild(p);
    setTimeout(() => p.remove(), 1600);
  }
  function chainBanked(pts, cr, xp) {
    const p = el('div', 'spop bank', `BANKED ${fmt(pts)}<small>+${fmt(cr)} CR · +${fmt(xp)} XP</small>`);
    $('skill-pops').appendChild(p);
    setTimeout(() => p.remove(), 2200);
  }
  function chainBroken() {
    const p = el('div', 'spop broken', 'CHAIN BROKEN');
    $('skill-pops').appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }
  function creditsPop(n) {
    const p = el('span', 'crpop', '+' + fmt(n));
    $('cr-pops').appendChild(p);
    setTimeout(() => p.remove(), 1500);
  }
  function toast(title, sub, kind) {
    const t = el('div', 'toast ' + (kind || 'info'), `<b>${title}</b>${sub ? `<span>${sub}</span>` : ''}`);
    const box = $('toasts');
    box.appendChild(t);
    while (box.children.length > 4) box.firstChild.remove();
    setTimeout(() => t.classList.add('out'), kind === 'tip' ? 8500 : 4200);
    setTimeout(() => t.remove(), kind === 'tip' ? 9000 : 4700);
  }
  let msgTimer = null;
  function message(text, ms) {
    const m = $('msg');
    m.textContent = text;
    m.classList.remove('show'); void m.offsetWidth;
    m.classList.add('show');
    if (msgTimer) clearTimeout(msgTimer);
    msgTimer = setTimeout(() => m.classList.remove('show'), ms || 1400);
  }
  function setVehicleInfo(cfg) {
    $('veh-name').textContent = cfg.name;
    $('veh-class').textContent = cfg.cls;
    $('veh-hint').innerHTML = cfg.hint;
  }
  function refreshProfile() { lastCredits = null; }
  function fade(on) { $('fade').classList.toggle('on', on); }
  function setState(s) {
    state = s;
    body.className = body.className.replace(/\bst-\S+/g, '').trim() + ' st-' + s;
    if (s === 'play') { prompt(null); promptKey = ''; }
  }
  function toggleHelp() { $('help').classList.toggle('open'); }

  // static screens
  (function buildStatic() {
    $('settings-back').addEventListener('click', () => { if (!subBack()) api.resume(); });
    $('controls-back').addEventListener('click', () => { if (!subBack()) api.resume(); });
    $('credits-back').addEventListener('click', () => subBack());
    $('garage-close').addEventListener('click', () => api.closePanel());
    $('map-close').addEventListener('click', () => api.closePanel());
  })();

  return {
    showTitle, hideTitle, openPause, closePanels, openGarage, openMap, drawMap,
    showResults, hideResults, resultsChampion: () => resultsChamp, showEnding, hideEnding,
    hud, skillPop, chainBanked, chainBroken, creditsPop, toast, message, prompt,
    setVehicleInfo, refreshProfile, fade, setState, toggleHelp,
    menuMove, menuConfirm, subBack,
  };
};
})();
