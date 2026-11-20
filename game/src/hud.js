// hud.js — Coraluna's dense HUD: mission header, police panel, stars,
import { CHARACTERS, MISSIONS, LOCATIONS } from './missions.js';
import { DISTRICTS, HALF, districtAt, nodePos } from './city.js';
import { dist } from './util.js';

const PLACES = [
  { node: LOCATIONS.garage, letter: 'G', colour: '#7dff8a', label: 'GARAGE — NADIA\'S WORKSHOP' },
  { node: LOCATIONS.market, letter: 'M', colour: '#ffd23a', label: 'MARKET — PACKAGE PICKUP' },
  { node: LOCATIONS.pierGate, letter: 'P', colour: '#4c9fd8', label: 'PIER GATE — ELENA\'S BOAT' },
  { node: LOCATIONS.harbour, letter: 'H', colour: '#5ad8d8', label: 'HARBOUR — SAFE PASSAGE DROP' },
  { node: 38, letter: 'S', colour: '#ffffff', label: 'SAFEHOUSE — THE CLINIC' },
  { node: LOCATIONS.lookout, letter: 'L', colour: '#c08aff', label: 'LOOKOUT — TOMAS WATCHES FROM HERE' },
];

function missionDistrict(m) {
  for (let i = m.stages.length - 1; i >= 0; i--) {
    const s = m.stages[i];
    const node = s.node !== undefined ? s.node : s.to;
    if (node === undefined) continue;
    const p = nodePos(node);
    const d = districtAt(p.x, p.z);
    return d.name === 'THE PIER' ? 'PUERTO AZUL' : d.name;
  }
  return 'PLAZA CENTRAL';
}

function districtPct(game, d) {
  const done = game.missions.done ? MISSIONS.length : game.missions.missionIdx;
  const mine = MISSIONS.filter((m) => missionDistrict(m) === d.name);
  if (mine.length === 0) return game.visitedDistricts.has(d.name) ? 100 : 0;
  const finished = mine.filter((m) => m.id - 1 < done).length;
  return Math.round((finished / mine.length) * 100);
}

const RANK_NAMES = [
  [0, 'ROOKIE'], [150, 'HUSTLER'], [400, 'FIXER'], [800, 'SHOT CALLER'],
  [1400, 'KINGPIN'], [2200, 'LEGEND OF CORALUNA'],
];
export function rankFor(respect) {
  let r = RANK_NAMES[0];
  for (const cand of RANK_NAMES) if (respect >= cand[0]) r = cand;
  const idx = RANK_NAMES.indexOf(r);
  const next = RANK_NAMES[idx + 1];
  return { name: r[1], cur: r[0], next: next ? next[0] : respect };
}

export function drawPortrait(canvas, who) {
  const c = CHARACTERS[who] || CHARACTERS.DARIO;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#2a1a2e';
  ctx.fillRect(0, 0, W, H);
  ctx.fillStyle = who === 'VIDAL' ? '#3a3a3a' : '#5a2a3a';
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(W * 0.2, H * 0.72);
  ctx.lineTo(W * 0.8, H * 0.72); ctx.lineTo(W, H);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = c.colour;
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.46, W * 0.26, H * 0.30, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.22, W * 0.27, H * 0.16, 0, Math.PI, 0);
  ctx.fill();
  if (who === 'VIDAL') {
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(W * 0.28, H * 0.30, W * 0.44, H * 0.05);
  }
  ctx.fillStyle = '#141414';
  ctx.beginPath(); ctx.arc(W * 0.40, H * 0.44, W * 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.60, H * 0.44, W * 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#5a2a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W * 0.44, H * 0.62);
  ctx.lineTo(W * 0.56, H * 0.62);
  ctx.stroke();
  if (who === 'ELENA') {
    ctx.fillStyle = '#101418';
    ctx.fillRect(W * 0.32, H * 0.40, W * 0.16, H * 0.07);
    ctx.fillRect(W * 0.52, H * 0.40, W * 0.16, H * 0.07);
  }
  if (who === 'DARIO') {
    ctx.strokeStyle = '#7a3a2a';
    ctx.beginPath();
    ctx.moveTo(W * 0.62, H * 0.30); ctx.lineTo(W * 0.58, H * 0.42);
    ctx.stroke();
  }
}

export class Hud {
  constructor(root) {
    this.el = {};
    for (const id of ['mission', 'stage', 'objective', 'next', 'police', 'stars',
      'money', 'health', 'armour', 'healthnum', 'armournum', 'weapons', 'speed', 'carname', 'carcond',
      'radio', 'district', 'respect', 'rank', 'dialogue', 'dlgname', 'dlgrole',
      'dlgtext', 'banner', 'timer', 'clock', 'crew', 'minimap', 'portrait', 'hud', 'wantedlabel',
      'stagebar', 'stagepct',
      'pause-missions', 'pause-stats', 'pause-map', 'pause-district',
      'pause-saves', 'pause-legend', 'pause-career', 'pause-controls']) {
      this.el[id] = root.querySelector('#' + id);
    }
    this.pauseTab = 'map';
    if (root.querySelectorAll) {
      root.querySelectorAll('.pause-tab').forEach((btn) => {
        btn.addEventListener('click', () => this.setPauseTab(btn.dataset.tab));
      });
    }
    this.mapCtx = this.el.minimap ? this.el.minimap.getContext('2d') : null;
    this.lastPortraitWho = null;
    this._lastWeapons = null;
    if (this.el.crew) {
      const crew = [
        { who: 'DARIO', ability: 'BRIBE', cost: 800, key: 'Z' },
        { who: 'TOMAS', ability: 'JAMMER', cost: 1200, key: 'X' },
        { who: 'NADIA', ability: 'FIELD FIX', cost: 500, key: 'C' },
      ];
      let html = '<div class="crew-head">CREW ABILITIES · CORALUNA</div>';
      for (const m of crew) {
        const c = CHARACTERS[m.who];
        html += `<div class="crew-row"><canvas class="crew-portrait" width="36" height="36" data-who="${m.who}"></canvas>`
          + `<span class="crew-main"><b>${c.name}</b> · ${c.role}<br>${m.ability} · $${m.cost.toLocaleString('en-US')} · [${m.key}]</span>`
          + `<span class="crew-status" data-who="${m.who}">READY</span></div>`;
      }
      this.el.crew.innerHTML = html;
      this.el.crew.querySelectorAll('.crew-portrait').forEach((cv) => {
        drawPortrait(cv, cv.dataset.who);
      });
    }
  }

  setPauseTab(tab) {
    this.pauseTab = tab;
    document.querySelectorAll('.pause-tab').forEach((b) => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    document.querySelectorAll('.pause-pane').forEach((p) => {
      p.classList.toggle('active', p.dataset.pane === tab);
    });
  }

  setVisible(v) { if (this.el.hud) this.el.hud.style.display = v ? 'block' : 'none'; }

  drawPauseScreen(game) {
    const mc = game.missions;
    const doneCount = mc.done ? MISSIONS.length : mc.missionIdx;
    const rank = rankFor(game.respect);
    if (this.el['pause-missions']) {
      let html = '';
      for (const m of MISSIONS) {
        const state = m.id - 1 < doneCount ? 'DONE'
          : m.id - 1 === doneCount ? 'NEXT' : 'LOCKED';
        const cls = state === 'DONE' ? 'st-done' : state === 'NEXT' ? 'st-next' : 'st-locked';
        const mark = state === 'DONE' ? '✓ ' : state === 'NEXT' ? '▶ ' : '🔒 ';
        html += `<div class="pause-row"><span>${mark}${m.id}. ${m.title} · $${m.reward.toLocaleString('en-US')}</span>`
          + `<span class="${cls}">${state}</span></div>`;
      }
      this.el['pause-missions'].innerHTML = html;
    }
    const pct = Math.round((doneCount / MISSIONS.length) * 100);
    const km = (game.distanceDriven / 1000).toFixed(1);
    const cell = (label, value, sub) => `<div class="stat-cell"><div class="stat-label">${label}</div>`
      + `<div class="stat-value">${value}</div><div class="stat-sub">${sub}</div></div>`;
    if (this.el['pause-stats']) {
      this.el['pause-stats'].innerHTML = '<div class="pause-head">CAREER · DARIO FUENTES</div><div class="stat-grid">'
        + cell('MONEY', '$' + Math.floor(game.player.money).toLocaleString('en-US'), 'cash')
        + cell('RESPECT', game.respect, rank.name)
        + cell('STORY', pct + '%', doneCount + ' of 8 done')
        + cell('DISTRICTS', game.visitedDistricts.size + ' / 8', 'explored')
        + cell('CARS STOLEN', game.carsStolen, 'taken')
        + cell('POLICE ESCAPED', game.policeEscaped, 'escaped')
        + cell('DISTANCE DRIVEN', km + ' km', 'driven')
        + cell('HIGHEST WANTED', game.maxWanted + '★', game.wanted > 0 ? 'currently ' + game.wanted + '★' : 'now clean')
        + '</div>';
    }
    if (this.el['pause-saves']) {
      const slot1 = `MISSION ${mc.done ? 8 : mc.missionIdx + 1} · $${Math.floor(game.player.money).toLocaleString('en-US')} · ${game.timeOfDay()} · ${rank.name}`;
      this.el['pause-saves'].innerHTML = '<div class="pause-head">SAVE SLOTS</div>'
        + `<div class="save-slot"><span>SLOT 1 · CURRENT RUN</span><span class="slot-full">${slot1}</span></div>`
        + '<div class="save-slot"><span>SLOT 2</span><span class="slot-empty">EMPTY</span></div>'
        + '<div class="save-slot"><span>SLOT 3</span><span class="slot-empty">EMPTY</span></div>';
    }
    if (this.el['pause-legend']) {
      this.el['pause-legend'].innerHTML = PLACES.map((pl) =>
        `<b>${pl.letter}</b> ${pl.label}`).join('<br>')
        + `<br>8 story missions · ${doneCount} done · ${game.visitedDistricts.size} of 8 districts explored`;
    }
    if (this.el['pause-career']) {
      this.el['pause-career'].innerHTML = DISTRICTS.map((d) =>
        `${d.name} — <b>${districtPct(game, d)}%</b>`).join('<br>')
        + `<br>Overall story completion: <b>${pct}%</b> · Districts explored: <b>${game.visitedDistricts.size} / 8</b>`;
    }
    if (this.el['pause-controls']) {
      this.el['pause-controls'].innerHTML = 'W/S drive &amp; walk · A/D steer &amp; turn · SPACE brake<br>'
        + 'F enter / exit car · J or click attack · 1–4 weapons · R radio · P pause<br>'
        + 'Crew: Z bribe ($800) · X jammer ($1,200) · C field fix ($500)';
    }
    if (this.el['pause-district']) this.el['pause-district'].textContent = game.district.name + ' · ' + game.timeOfDay();
    const cv = this.el['pause-map'];
    if (cv) this.drawPauseMap(game, cv);
  }

  drawPauseMap(game, cv) {
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const S = cv.width, PAD = 14;
    const x0 = -HALF - 110, x1 = HALF + 14, z0 = -HALF - 14, z1 = HALF + 14;
    const sc = Math.min((S - 2 * PAD) / (x1 - x0), (S - 2 * PAD) / (z1 - z0));
    const ox = PAD - x0 * sc, oz = PAD - z0 * sc;
    const toMap = (x, z) => [ox + x * sc, oz + z * sc];
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(20, 26, 34, 0.95)';
    ctx.fillRect(0, 0, S, S);
    ctx.fillStyle = '#2f7fb8';
    const [seaX] = toMap(-HALF, 0);
    ctx.fillRect(0, 0, seaX, S);
    const pier = game.city.pier;
    const [pax, paz] = toMap(pier.x0, pier.z0);
    const [pbx, pbz] = toMap(pier.x1, pier.z1);
    ctx.fillStyle = '#a8824f';
    ctx.fillRect(Math.min(pax, pbx), Math.min(paz, pbz), Math.abs(pbx - pax), Math.abs(pbz - paz));
    ctx.font = 'bold 10px sans-serif';
    for (const d of DISTRICTS) {
      const r = d.region;
      const [ax, az] = toMap(r.x0, r.z0);
      const [bx, bz] = toMap(r.x1, r.z1);
      ctx.fillStyle = d.colour + '55';
      ctx.fillRect(ax, az, bx - ax, bz - az);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(d.short || d.name, ax + 5, az + 14);
    }
    ctx.strokeStyle = '#c8c8d0';
    ctx.lineWidth = 2;
    for (const [a, b] of game.city.graph.edges) {
      const A = game.city.graph.nodes[a], B = game.city.graph.nodes[b];
      const [ax, az] = toMap(A.x, A.z);
      const [bx, bz] = toMap(B.x, B.z);
      ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
    }
    ctx.fillStyle = '#e8e8e8';
    for (const n of game.city.graph.nodes) {
      const [nx, nz] = toMap(n.x, n.z);
      ctx.beginPath(); ctx.arc(nx, nz, 2.5, 0, Math.PI * 2); ctx.fill();
    }
    for (const pl of PLACES) {
      const p = nodePos(pl.node);
      const [mx, mz] = toMap(p.x, p.z);
      ctx.fillStyle = pl.colour;
      ctx.beginPath(); ctx.arc(mx, mz, 8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#141414';
      ctx.font = 'bold 10px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(pl.letter, mx, mz + 3.5);
      ctx.textAlign = 'left';
    }
    const route = game.routeNodes;
    if (route && route.length > 1) {
      ctx.strokeStyle = '#ffd23a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      route.forEach((n, i) => {
        const p = game.city.graph.nodes[n];
        const [mx, mz] = toMap(p.x, p.z);
        if (i === 0) ctx.moveTo(mx, mz); else ctx.lineTo(mx, mz);
      });
      ctx.stroke();
    }
    const tgt = game.objectivePos;
    if (tgt) {
      const [tx, tz] = toMap(tgt.x, tgt.z);
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath();
      ctx.moveTo(tx, tz - 10); ctx.lineTo(tx + 8, tz); ctx.lineTo(tx, tz + 10); ctx.lineTo(tx - 8, tz);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.fillStyle = '#4c9fd8';
    for (const u of game.policeUnits) {
      const [ux, uz] = toMap(u.car.x, u.car.z);
      ctx.beginPath(); ctx.arc(ux, uz, 4, 0, Math.PI * 2); ctx.fill();
    }
    const [px, pz] = toMap(game.px(), game.pz());
    ctx.save();
    ctx.translate(px, pz);
    ctx.rotate(game.playerHeading());
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -12); ctx.lineTo(8, 9); ctx.lineTo(-8, 9);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.stroke();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 12px sans-serif';
    ctx.fillText('N', S - 16, 16);
    const bandTop = oz + z1 * sc + 8;
    const bandBottom = S - 8;
    if (bandBottom - bandTop > 40) {
      ctx.fillStyle = 'rgba(255, 255, 255, 0.06)';
      ctx.fillRect(PAD, bandTop, S - 2 * PAD, bandBottom - bandTop);
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
      ctx.lineWidth = 1;
      ctx.strokeRect(PAD, bandTop, S - 2 * PAD, bandBottom - bandTop);
      const colW = (S - 2 * PAD) / 4;
      ctx.font = '10px sans-serif';
      DISTRICTS.forEach((d, i) => {
        const cx = PAD + 8 + (i % 4) * colW;
        const cy = bandTop + 20 + Math.floor(i / 4) * 18;
        ctx.fillStyle = d.colour;
        ctx.fillRect(cx, cy - 9, 10, 10);
        ctx.fillStyle = '#d8dce2';
        ctx.fillText(`${d.short || d.name} ${districtPct(game, d)}%`, cx + 14, cy);
      });
      const keyY = bandTop + 58;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(PAD + 13, keyY - 12); ctx.lineTo(PAD + 18, keyY - 3); ctx.lineTo(PAD + 8, keyY - 3);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d8dce2';
      ctx.fillText('YOU', PAD + 22, keyY - 3);
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath();
      ctx.moveTo(PAD + 108, keyY - 13); ctx.lineTo(PAD + 114, keyY - 7); ctx.lineTo(PAD + 108, keyY - 1); ctx.lineTo(PAD + 102, keyY - 7);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#d8dce2';
      ctx.fillText('OBJECTIVE', PAD + 118, keyY - 3);
      ctx.fillStyle = '#4c9fd8';
      ctx.beginPath(); ctx.arc(PAD + 208, keyY - 7, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#d8dce2';
      ctx.fillText('POLICE', PAD + 216, keyY - 3);
      ctx.strokeStyle = '#ffd23a'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(PAD + 288, keyY - 7); ctx.lineTo(PAD + 304, keyY - 7); ctx.stroke();
      ctx.fillStyle = '#d8dce2';
      ctx.fillText('ROUTE', PAD + 308, keyY - 3);
    }
  }

  update(game, now) {
    const p = game.player;
    const mc = game.missions;
    const m = mc.mission;
    if (m) {
      this.setText('mission', `MISSION ${m.id} / 8 · ${m.title}`);
      this.setText('stage', `STAGE ${mc.stageIdx + 1}/${mc.stageCount}`);
      this.setText('objective', mc.objectiveText());
      this.setText('next', `NEXT ${mc.nextText()}`);
    } else {
      this.setText('mission', 'CORALUNA · ALL MISSIONS COMPLETE');
      this.setText('stage', 'STORY COMPLETE');
      this.setText('objective', 'Free roam — Coraluna is yours.');
      this.setText('next', 'NEXT Enjoy the sunset');
    }
    const stars = '★'.repeat(game.wanted) + '☆'.repeat(Math.max(0, 5 - game.wanted));
    this.setText('stars', stars);
    this.el.stars.className = game.wanted > 0 ? 'stars hot' : 'stars';
    this.setText('wantedlabel', game.wanted > 0 ? 'WANTED' : 'CLEAN');
    this.setText('money', '$' + Math.floor(p.money).toLocaleString('en-US'));
    this.setText('healthnum', Math.ceil(p.health));
    this.setText('armournum', Math.ceil(p.armour));
    const hb = this.el.health; if (hb) hb.style.width = p.health + '%';
    const ab = this.el.armour; if (ab) ab.style.width = p.armour + '%';
    this.setText('clock', 'TIME ' + game.timeOfDay());
    if (game.crewAbilities && this.el.crew) {
      this.el.crew.querySelectorAll('.crew-status').forEach((el) => {
        const a = game.crewAbilities.find((x) => x.who === el.dataset.who);
        if (!a) return;
        const text = a.left > 0 ? `${Math.ceil(a.left)}s` : 'READY';
        if (el.textContent !== text) el.textContent = text;
        el.style.color = a.left > 0 ? '#ff8a7a' : '#7dff8a';
      });
    }
    const slots = [];
    const { WEAPONS } = game;
    WEAPONS.forEach((w, i) => {
      if (!p.weaponsOwned[i]) return;
      const ammo = w.ammo === Infinity ? '∞' : (p.ammo[w.id] ?? 0);
      slots.push(`<span class="wslot${i === p.weaponIdx ? ' active' : ''}">${i === p.weaponIdx ? '▶ ' : ''}${w.name} <b>${ammo}</b></span>`);
    });
    const slotsHtml = slots.join('');
    if (this._lastWeapons !== slotsHtml && this.el.weapons) {
      this.el.weapons.innerHTML = slotsHtml;
      this._lastWeapons = slotsHtml;
    }
    const car = p.inCar;
    if (car) {
      this.setText('speed', Math.round(Math.abs(car.speed) * 3.6) + ' km/h');
      this.setText('carname', car.name);
      this.setText('carcond', `CONDITION ${Math.ceil(car.condition)}%${car.wrecked ? ' · WRECKED' : ''}`);
    } else {
      this.setText('speed', 'ON FOOT');
      this.setText('carname', 'DARIO FUENTES');
      this.setText('carcond', 'WALKING · NO VEHICLE');
    }
    this.setText('radio', game.radio.stationName() + ' — ' + game.radio.nowPlaying());
    this.setText('district', game.district.name);
    const rank = rankFor(game.respect);
    this.setText('rank', `RESPECT · ${rank.name} ${game.respect} / ${rank.next}`);
    const rb = this.el.respect;
    if (rb) rb.style.width = Math.min(100, ((game.respect - rank.cur) / Math.max(1, rank.next - rank.cur)) * 100) + '%';
    const s0 = mc.stage;
    let frac = 0;
    if (s0) {
      if (s0.type === 'wreck' || s0.type === 'ram') frac = s0.count ? mc.progress / s0.count : 0;
      else if (s0.type === 'combat') frac = s0.waves ? mc.progress / s0.waves : 0;
      else if (s0.type === 'lose') frac = game.stageStartWanted > 0 ? (game.stageStartWanted - game.wanted) / game.stageStartWanted : 0;
      else if (game.objectivePos && game.stageStartDist > 0) {
        frac = 1 - dist(game.px(), game.pz(), game.objectivePos.x, game.objectivePos.z) / game.stageStartDist;
      }
    }
    frac = Math.max(0, Math.min(1, frac));
    if (this.el.stagebar) this.el.stagebar.style.width = Math.round(frac * 100) + '%';
    this.setText('stagepct', Math.round(frac * 100) + '%');
    const units = game.policeUnits.slice().sort((a, b) =>
      a.distanceTo(game.px(), game.pz()) - b.distanceTo(game.px(), game.pz()));
    const shown = units.slice(0, 5);
    let html = `<div class="police-head">CPD RESPONSE · ${units.length} UNITS${game.heli.active ? ' · AIR UNIT DEPLOYED' : ''}</div>`;
    for (const u of shown) {
      const d = Math.round(u.distanceTo(game.px(), game.pz()));
      html += `<div class="police-row"><span>${u.callsign}</span><span>${u.role}</span><span>${d}m</span></div>`;
    }
    if (units.length > shown.length) {
      const extra = units.length - shown.length;
      html += `<div class="police-more">+${extra} MORE UNIT${extra > 1 ? 'S' : ''} ON THE WAY</div>`;
    }
    if (units.length === 0) html = '<div class="police-head">CPD RESPONSE · NO UNITS NEARBY</div>';
    if (this.el.police) this.el.police.innerHTML = html;
    let banner = '';
    if (game.wanted > 0) {
      banner = game.inSight ? '● THEY CAN SEE YOU · BREAK LINE OF SIGHT'
        : `○ LOSING THEM · ${Math.ceil(game.cooldownLeft)}s UNTIL HEAT DROPS`;
    }
    this.setText('banner', banner);
    const s = mc.stage;
    if (s && s.type === 'ram' && game.limoDeadline) {
      const left = Math.max(0, game.limoDeadline - now);
      this.setText('timer', `PIER IN ${Math.ceil(left)}s`);
    } else if (s && s.type === 'lose') {
      this.setText('timer', `MANHUNT ${game.wanted}★`);
    } else {
      this.setText('timer', '');
    }
    const dlg = mc.dialogue;
    if (dlg && now < dlg.until) {
      const c = CHARACTERS[dlg.who] || CHARACTERS.DARIO;
      this.setText('dlgname', c.name);
      this.setText('dlgrole', c.role);
      this.setText('dlgtext', dlg.text);
      if (this.el.dialogue) this.el.dialogue.style.display = 'flex';
      if (this.lastPortraitWho !== dlg.who && this.el.portrait) {
        drawPortrait(this.el.portrait, dlg.who);
        this.lastPortraitWho = dlg.who;
      }
    } else if (this.el.dialogue) {
      this.el.dialogue.style.display = 'none';
    }
    this.drawMinimap(game);
  }

  setText(id, text) {
    const e = this.el[id];
    if (e && e.textContent !== text) e.textContent = text;
  }

  drawMinimap(game) {
    const ctx = this.mapCtx;
    if (!ctx) return;
    const S = 220, half = 200;
    const px = game.px(), pz = game.pz();
    ctx.clearRect(0, 0, S, S);
    ctx.fillStyle = 'rgba(20, 26, 34, 0.92)';
    ctx.fillRect(0, 0, S, S);
    const toMap = (x, z) => [S / 2 + (x - px) * (S / 2 / 110), S / 2 + (z - pz) * (S / 2 / 110)];
    ctx.fillStyle = '#2f7fb8';
    const [sx] = toMap(-192, 0);
    if (sx > 0) ctx.fillRect(0, 0, Math.min(S, sx), S);
    const pier = game.city.pier;
    const [pax, paz] = toMap(pier.x0, pier.z0);
    const [pbx, pbz] = toMap(pier.x1, pier.z1);
    ctx.fillStyle = '#a8824f';
    ctx.fillRect(Math.min(pax, pbx), Math.min(paz, pbz),
      Math.abs(pbx - pax), Math.abs(pbz - paz));
    ctx.strokeStyle = '#8a8a96';
    ctx.lineWidth = 2;
    for (const [a, b] of game.city.graph.edges) {
      const A = game.city.graph.nodes[a], B = game.city.graph.nodes[b];
      const [ax, az] = toMap(A.x, A.z);
      const [bx, bz] = toMap(B.x, B.z);
      ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
    }
    const route = game.routeNodes;
    if (route && route.length > 1) {
      ctx.strokeStyle = '#ffd23a';
      ctx.lineWidth = 3;
      ctx.beginPath();
      route.forEach((n, i) => {
        const p = game.city.graph.nodes[n];
        const [mx, mz] = toMap(p.x, p.z);
        if (i === 0) ctx.moveTo(mx, mz); else ctx.lineTo(mx, mz);
      });
      ctx.stroke();
    }
    if (game.wanted > 0) {
      ctx.strokeStyle = 'rgba(255, 60, 60, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, 52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 60, 60, 0.12)';
      ctx.fill();
    }
    const tgt = game.objectivePos;
    if (tgt) {
      const [tx, tz] = toMap(tgt.x, tgt.z);
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath(); ctx.arc(tx, tz, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.stroke();
    }
    ctx.fillStyle = '#4c9fd8';
    for (const u of game.policeUnits) {
      const [ux, uz] = toMap(u.car.x, u.car.z);
      ctx.beginPath(); ctx.arc(ux, uz, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(game.playerHeading());
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', S - 14, 14);
  }
}
