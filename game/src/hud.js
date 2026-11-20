// hud.js — Coraluna's dense HUD, modelled on the leader boards: mission
// header + stage + objective + NEXT step, a named-police panel with roles and
// distances, wanted stars, money, health/armour, weapon slots, a minimap with
// route and search zone, speed + car name + condition, radio station, district
// label and a respect bar, and a dialogue box with a procedural portrait.
import { CHARACTERS } from './missions.js';
import { dist } from './util.js';

const RANK_NAMES = [
  [0, 'ROOKIE'], [150, 'HUSTLER'], [400, 'FIXER'], [800, 'SHOT CALLER'],
  [1400, 'KINGPIN'], [2200, 'LEGEND OF CORALUNA'],
];
export function rankFor(respect) {
  let r = RANK_NAMES[0];
  for (const cand of RANK_NAMES) if (respect >= cand[0]) r = cand;
  const idx = RANK_NAMES.indexOf(r);
  const next = RANK_NAMES[idx + 1];
  // At the top rank the bar is full: next equals the current value.
  return { name: r[1], cur: r[0], next: next ? next[0] : respect };
}

// Procedural portrait: a stylised face on a small canvas, distinct per
// character (skin tone, hair colour and shape, collar).
export function drawPortrait(canvas, who) {
  const c = CHARACTERS[who] || CHARACTERS.DARIO;
  const ctx = canvas.getContext('2d');
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#2a1a2e';
  ctx.fillRect(0, 0, W, H);
  // Shoulders / collar.
  ctx.fillStyle = who === 'VIDAL' ? '#3a3a3a' : '#5a2a3a';
  ctx.beginPath();
  ctx.moveTo(0, H); ctx.lineTo(W * 0.2, H * 0.72);
  ctx.lineTo(W * 0.8, H * 0.72); ctx.lineTo(W, H);
  ctx.closePath(); ctx.fill();
  // Face.
  ctx.fillStyle = c.colour;
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.46, W * 0.26, H * 0.30, 0, 0, Math.PI * 2);
  ctx.fill();
  // Hair.
  ctx.fillStyle = c.hair;
  ctx.beginPath();
  ctx.ellipse(W / 2, H * 0.22, W * 0.27, H * 0.16, 0, Math.PI, 0);
  ctx.fill();
  if (who === 'VIDAL') {
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(W * 0.28, H * 0.30, W * 0.44, H * 0.05);
  }
  // Eyes.
  ctx.fillStyle = '#141414';
  ctx.beginPath(); ctx.arc(W * 0.40, H * 0.44, W * 0.035, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(W * 0.60, H * 0.44, W * 0.035, 0, Math.PI * 2); ctx.fill();
  // Mouth.
  ctx.strokeStyle = '#5a2a1a';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(W * 0.44, H * 0.62);
  ctx.lineTo(W * 0.56, H * 0.62);
  ctx.stroke();
  // Sunglasses for Elena, scar for Dario.
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
      'dlgtext', 'banner', 'timer', 'clock', 'crew', 'minimap', 'portrait', 'hud', 'wantedlabel']) {
      this.el[id] = root.querySelector('#' + id);
    }
    this.mapCtx = this.el.minimap ? this.el.minimap.getContext('2d') : null;
    this.lastPortraitWho = null;
    this._lastWeapons = null;
    // Crew ability cards: Dario the driver, Nadia the mechanic, Tomas the
    // lookout — each with a portrait, a usable ability, its cash cost, its
    // key, and a live READY / cooldown readout. The portraits are drawn
    // onto the small canvases after the rows are laid out.
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

  setVisible(v) { if (this.el.hud) this.el.hud.style.display = v ? 'block' : 'none'; }

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
    // Wanted stars.
    const stars = '★'.repeat(game.wanted) + '☆'.repeat(Math.max(0, 5 - game.wanted));
    this.setText('stars', stars);
    this.el.stars.className = game.wanted > 0 ? 'stars hot' : 'stars';
    this.setText('wantedlabel', game.wanted > 0 ? 'WANTED' : 'CLEAN');
    this.setText('money', '$' + Math.floor(p.money).toLocaleString('en-US'));
    // Health/armour numbers sit in their own spans beside the bars — never
    // inside the coloured fill, where they were clipped by the track.
    this.setText('healthnum', Math.ceil(p.health));
    this.setText('armournum', Math.ceil(p.armour));
    const hb = this.el.health; if (hb) hb.style.width = p.health + '%';
    const ab = this.el.armour; if (ab) ab.style.width = p.armour + '%';
    // Time of day, golden hour onwards.
    this.setText('clock', 'TIME ' + game.timeOfDay());
    // Crew ability cooldowns: READY in gold, otherwise the seconds left.
    if (game.crewAbilities && this.el.crew) {
      this.el.crew.querySelectorAll('.crew-status').forEach((el) => {
        const a = game.crewAbilities.find((x) => x.who === el.dataset.who);
        if (!a) return;
        const text = a.left > 0 ? `${Math.ceil(a.left)}s` : 'READY';
        if (el.textContent !== text) el.textContent = text;
        el.style.color = a.left > 0 ? '#ff8a7a' : '#7dff8a';
      });
    }
    // Weapon slots: one box per owned weapon, name + ammo, active one lit.
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
    // Car / speed.
    const car = p.inCar;
    if (car) {
      this.setText('speed', Math.round(Math.abs(car.speed) * 3.6) + ' km/h');
      this.setText('carname', car.name);
      this.setText('carcond', `CONDITION ${Math.ceil(car.condition)}%${car.wrecked ? ' · WRECKED' : ''}`);
    } else {
      this.setText('speed', 'ON FOOT');
      this.setText('carname', '—');
      this.setText('carcond', 'WALKING');
    }
    this.setText('radio', game.radio.stationName() + ' — ' + game.radio.nowPlaying());
    this.setText('district', game.district.name);
    const rank = rankFor(game.respect);
    this.setText('rank', `RESPECT · ${rank.name} ${game.respect} / ${rank.next}`);
    const rb = this.el.respect;
    if (rb) rb.style.width = Math.min(100, ((game.respect - rank.cur) / Math.max(1, rank.next - rank.cur)) * 100) + '%';
    // Police panel.
    const units = game.policeUnits.slice().sort((a, b) =>
      a.distanceTo(game.px(), game.pz()) - b.distanceTo(game.px(), game.pz()));
    const shown = units.slice(0, 5);
    let html = `<div class="police-head">CPD RESPONSE · ${units.length} UNITS${game.heli.active ? ' · AIR UNIT DEPLOYED' : ''}</div>`;
    for (const u of shown) {
      const d = Math.round(u.distanceTo(game.px(), game.pz()));
      html += `<div class="police-row"><span>${u.callsign}</span><span>${u.role}</span><span>${d}m</span></div>`;
    }
    if (units.length > 5) html += `<div class="police-more">+${units.length - 5} more units</div>`;
    if (units.length === 0) html = '<div class="police-head">CPD RESPONSE · NO UNITS NEARBY</div>';
    if (this.el.police) this.el.police.innerHTML = html;
    // Banner: in-sight / cooling down.
    let banner = '';
    if (game.wanted > 0) {
      banner = game.inSight ? '● THEY CAN SEE YOU · BREAK LINE OF SIGHT'
        : `○ LOSING THEM · ${Math.ceil(game.cooldownLeft)}s UNTIL HEAT DROPS`;
    }
    this.setText('banner', banner);
    // Timer for timed stages.
    const s = mc.stage;
    if (s && s.type === 'ram' && game.limoDeadline) {
      const left = Math.max(0, game.limoDeadline - now);
      this.setText('timer', `PIER IN ${Math.ceil(left)}s`);
    } else if (s && s.type === 'lose') {
      this.setText('timer', `MANHUNT ${game.wanted}★`);
    } else {
      this.setText('timer', '');
    }
    // Dialogue.
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
    // Sea to the west.
    ctx.fillStyle = '#2f7fb8';
    const [sx] = toMap(-192, 0);
    if (sx > 0) ctx.fillRect(0, 0, Math.min(S, sx), S);
    // The pier deck, so the minimap reads as a pier, not open water.
    const pier = game.city.pier;
    const [pax, paz] = toMap(pier.x0, pier.z0);
    const [pbx, pbz] = toMap(pier.x1, pier.z1);
    ctx.fillStyle = '#a8824f';
    ctx.fillRect(Math.min(pax, pbx), Math.min(paz, pbz),
      Math.abs(pbx - pax), Math.abs(pbz - paz));
    // Roads.
    ctx.strokeStyle = '#8a8a96';
    ctx.lineWidth = 2;
    for (const [a, b] of game.city.graph.edges) {
      const A = game.city.graph.nodes[a], B = game.city.graph.nodes[b];
      const [ax, az] = toMap(A.x, A.z);
      const [bx, bz] = toMap(B.x, B.z);
      ctx.beginPath(); ctx.moveTo(ax, az); ctx.lineTo(bx, bz); ctx.stroke();
    }
    // Route to the objective.
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
    // Search zone while wanted.
    if (game.wanted > 0) {
      ctx.strokeStyle = 'rgba(255, 60, 60, 0.9)';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(S / 2, S / 2, 52, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = 'rgba(255, 60, 60, 0.12)';
      ctx.fill();
    }
    // Objective marker.
    const tgt = game.objectivePos;
    if (tgt) {
      const [tx, tz] = toMap(tgt.x, tgt.z);
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath(); ctx.arc(tx, tz, 6, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#141414'; ctx.lineWidth = 2; ctx.stroke();
    }
    // Police dots.
    ctx.fillStyle = '#4c9fd8';
    for (const u of game.policeUnits) {
      const [ux, uz] = toMap(u.car.x, u.car.z);
      ctx.beginPath(); ctx.arc(ux, uz, 3.5, 0, Math.PI * 2); ctx.fill();
    }
    // Player arrow.
    ctx.save();
    ctx.translate(S / 2, S / 2);
    ctx.rotate(game.playerHeading());
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.moveTo(0, -8); ctx.lineTo(5, 6); ctx.lineTo(-5, 6);
    ctx.closePath(); ctx.fill();
    ctx.restore();
    // North tick.
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 11px sans-serif';
    ctx.fillText('N', S - 14, 14);
  }
}
