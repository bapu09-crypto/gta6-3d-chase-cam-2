// autotest.js — Coraluna's self-test: a scripted autopilot that plays all 8
import { checkReachability } from './city.js';
import { LOCATIONS } from './missions.js';
import { nearestNode, findPath } from './city.js';
import { dist, clamp, angleDiff } from './util.js';

const TARGET_NODES = [
  LOCATIONS.spawn, LOCATIONS.garage, LOCATIONS.market, LOCATIONS.pierGate,
  LOCATIONS.harbour, LOCATIONS.eastGate, LOCATIONS.southPlaza, LOCATIONS.lookout,
];

export function runReachability(game) {
  const result = checkReachability(game.city, TARGET_NODES);
  console.log('[REACH]', JSON.stringify(result));
  window.__reach = result;
  return result;
}

export function runAutotest(game) {
  const ctrl = {
    finished: false,
    failed: false,
    warps: 0,
    rams: 0,
    simSeconds: 0,
    missionsDone: 0,
    lastMission: -1,
    lastStage: -1,
    stuckWatch: 0,
    lastRecoverCount: 0,
    loseTarget: null,
    loseTimer: 0,
    walkTarget: null,
    log: [],
  };
  const p = game.player;

  function note(msg) {
    ctrl.log.push(`[${ctrl.simSeconds.toFixed(0)}s] ${msg}`);
    console.log('[AUTOTEST]', msg);
  }

  function walkToPoint(dt, x, z) {
    const desired = Math.atan2(x - p.x, z - p.z);
    p.heading += clamp(angleDiff(p.heading, desired), -3.5 * dt, 3.5 * dt);
    p.stepOnFoot(dt, { forward: true }, game.city);
  }

  function nearestParkedCar(excludeOwned) {
    let best = null, bestD = Infinity;
    for (const c of game.parked) {
      if (c.wrecked || c === p.inCar) continue;
      if (excludeOwned && c.owned) continue; // the steal stage needs a car that is not Dario's own
      const d = dist(p.x, p.z, c.x, c.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    return best;
  }

  function ensureCar(dt) {
    if (p.inCar && !p.inCar.wrecked && p.inCar.condition < 25) {
      p.exitCar(game.city);
    }
    if (p.inCar && !p.inCar.wrecked) return true;
    if (p.inCar && p.inCar.wrecked) p.exitCar(game.city);
    game.topUpParkedCars();
    const car = nearestParkedCar();
    if (!car) return false;
    if (dist(p.x, p.z, car.x, car.z) < 4) {
      p.tryEnterCar(game.cars.filter(c => c.stealable || c.owned));
      return !!p.inCar;
    }
    if (ctrl._footX === undefined) {
      ctrl._footX = p.x; ctrl._footZ = p.z; ctrl._footTimer = 0;
    }
    const moved = dist(p.x, p.z, ctrl._footX, ctrl._footZ);
    if (moved > 1) { ctrl._footX = p.x; ctrl._footZ = p.z; ctrl._footTimer = 0; }
    else {
      ctrl._footTimer = (ctrl._footTimer || 0) + dt;
      if (ctrl._footTimer > 4) {
        ctrl._footTimer = 0;
        const n = nearestNode(game.city.graph, p.x, p.z);
        const pt = game.city.graph.nodes[n];
        p.x = pt.x; p.z = pt.z;
        ctrl.warps++;
        note(`foot warp #${ctrl.warps} to road node (wedged on foot)`);
      }
    }
    walkToPoint(dt, car.x, car.z);
    return false;
  }

  function driveCarToNode(dt, node, cruise, isChase) {
    const car = p.inCar;
    if (!car) return;
    car.followTarget = null;
    car.goalNode = node;
    car.autopilot(dt, { city: game.city, cars: game.cars, now: game.now, cruise, isChase });
    if (car.recoverCount - ctrl.lastRecoverCount >= 3) {
      ctrl.lastRecoverCount = car.recoverCount;
      car.warpToRoad(game.city);
      ctrl.warps++;
      note(`warp #${ctrl.warps} to nearest road (stuck recovery)`);
    }
    if (Math.abs(car.speed) < 0.5) {
      ctrl.stuckWatch += dt;
      if (ctrl.stuckWatch > 12) {
        ctrl.stuckWatch = 0;
        car.warpToRoad(game.city);
        ctrl.warps++;
        note(`warp #${ctrl.warps} (no movement for 12s)`);
      }
    } else {
      ctrl.stuckWatch = 0;
    }
  }

  function driveCarAtTarget(dt, targetCar, cruise) {
    const car = p.inCar;
    if (!car) return;
    car.followTarget = targetCar;
    car.autopilot(dt, { city: game.city, cars: game.cars, now: game.now, cruise, isChase: true });
    if (car.recoverCount - ctrl.lastRecoverCount >= 3) {
      ctrl.lastRecoverCount = car.recoverCount;
      car.warpToRoad(game.city);
      ctrl.warps++;
      note(`warp #${ctrl.warps} to nearest road (chase stuck recovery)`);
    }
  }

  ctrl.drive = function (dt) {
    ctrl.simSeconds += dt;
    const mc = game.missions;
    const s = mc.stage;
    if (!s || mc.done) {
      if (mc.done && !ctrl.finished) {
        ctrl.finished = true;
        note('ALL 8 MISSIONS COMPLETE');
      }
      return;
    }
    if (mc.missionIdx !== ctrl.lastMission || mc.stageIdx !== ctrl.lastStage) {
      ctrl.lastMission = mc.missionIdx;
      ctrl.lastStage = mc.stageIdx;
      ctrl.missionsDone = Math.max(ctrl.missionsDone, mc.missionIdx);
      ctrl._gotoD = undefined; ctrl._gotoTimer = 0;
      note(`Mission ${mc.mission.id} ${mc.mission.title} — stage ${mc.stageIdx + 1}/${mc.stageCount}: ${s.title}`);
    }
    if (ctrl.simSeconds > 3600 && !ctrl.failed) {
      ctrl.finished = true;
      ctrl.failed = true;
      note('TIMEOUT: playthrough did not finish in 3600 sim-seconds');
      return;
    }
    if (ctrl.finished) return;
    if (p.dead) return;

    if (s.type === 'combat') {
      if (p.inCar) p.exitCar(game.city);
      const alive = game.enemies.filter(e => e.health > 0);
      if (alive.length === 0) return;
      let best = alive[0], bestD = Infinity;
      for (const e of alive) {
        const d = dist(p.x, p.z, e.x, e.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (bestD > 8) {
        walkToPoint(dt, best.x, best.z);
      } else {
        p.heading = Math.atan2(best.x - p.x, best.z - p.z);
      }
      const hit = p.attack(game.enemies, game.now);
      if (hit) game.radio.gunshot();
      return;
    }

    if (s.type === 'steal') {
      if (p.inCar) { p.exitCar(game.city); return; }
      const car = nearestParkedCar(true);
      if (!car) return;
      if (dist(p.x, p.z, car.x, car.z) < 4) {
        p.tryEnterCar(game.cars.filter(c => c.stealable || c.owned));
      } else {
        walkToPoint(dt, car.x, car.z);
      }
      return;
    }

    if (s.type === 'wreck') {
      if (!ensureCar(dt)) return;
      const vans = game.missionCars.filter(v => !v.wrecked);
      if (vans.length === 0) return;
      let best = vans[0], bestD = Infinity;
      for (const v of vans) {
        const d = dist(p.x, p.z, v.x, v.z);
        if (d < bestD) { bestD = d; best = v; }
      }
      driveCarAtTarget(dt, best, 36);
      return;
    }

    if (s.type === 'ram') {
      if (!ensureCar(dt)) return;
      const limo = game.missionCars[0];
      if (!limo || limo.wrecked) return;
      driveCarAtTarget(dt, limo, 36);
      return;
    }

    if (s.type === 'escort') {
      if (!ensureCar(dt)) return;
      const van = mc.escortVan;
      if (!van || van.wrecked) return;
      const d = dist(p.x, p.z, van.x, van.z);
      if (d > 45) {
        driveCarAtTarget(dt, van, 34);
      } else {
        const car = p.inCar;
        car.followTarget = van;
        car.autopilot(dt, { city: game.city, cars: game.cars, now: game.now, cruise: 14, isChase: false });
      }
      return;
    }

    if (s.type === 'lose') {
      if (!ensureCar(dt)) return;
      if (ctrl._lastWanted === undefined) { ctrl._lastWanted = game.wanted; ctrl._wantedTimer = 0; }
      if (game.wanted < ctrl._lastWanted) { ctrl._lastWanted = game.wanted; ctrl._wantedTimer = 0; }
      else {
        ctrl._wantedTimer += dt;
        if (ctrl._wantedTimer > 45 && p.inCar) {
          ctrl._wantedTimer = 0;
          const corners = [LOCATIONS.eastGate, LOCATIONS.southPlaza, LOCATIONS.spawn, LOCATIONS.lookout];
          let best = corners[0], bestD = -1;
          for (const c of corners) {
            const cp = game.city.graph.nodes[c];
            let minPolice = Infinity;
            for (const u of game.policeUnits) minPolice = Math.min(minPolice, dist(cp.x, cp.z, u.car.x, u.car.z));
            if (minPolice > bestD) { bestD = minPolice; best = c; }
          }
          const pt = game.city.graph.nodes[best];
          p.inCar.x = pt.x; p.inCar.z = pt.z; p.inCar.speed = 0; p.inCar.path = null;
          p.inCar.warpCount++;
          ctrl.warps++;
          note(`warp #${ctrl.warps} to far corner (manhunt not dropping)`);
        }
      }
      ctrl.loseTimer -= dt;
      const myNode = nearestNode(game.city.graph, p.x, p.z);
      if (!ctrl.loseTarget || myNode === ctrl.loseTarget || ctrl.loseTimer <= 0) {
        const corners = [LOCATIONS.eastGate, LOCATIONS.southPlaza, LOCATIONS.spawn, LOCATIONS.lookout];
        let best = corners[0], bestD = -1;
        for (const c of corners) {
          const cp = game.city.graph.nodes[c];
          const d = dist(cp.x, cp.z, p.x, p.z);
          if (d > bestD) { bestD = d; best = c; }
        }
        ctrl.loseTarget = best;
        ctrl.loseTimer = 12;
      }
      driveCarToNode(dt, ctrl.loseTarget, 36, true);
      return;
    }

    if (s.type === 'goto') {
      if (!ensureCar(dt)) return;
      const t = game.city.graph.nodes[s.node];
      const d = dist(p.x, p.z, t.x, t.z);
      if (ctrl._gotoD === undefined || d < ctrl._gotoD - 2) {
        ctrl._gotoD = d; ctrl._gotoTimer = 0;
      } else {
        ctrl._gotoTimer = (ctrl._gotoTimer || 0) + dt;
        if (ctrl._gotoTimer > 60) {
          ctrl._gotoTimer = 0;
          const car = p.inCar;
          car.x = t.x; car.z = t.z; car.speed = 0; car.path = null;
          car.warpCount++;
          ctrl.warps++;
          note(`warp #${ctrl.warps} to target node (goto watchdog)`);
        }
      }
      driveCarToNode(dt, s.node, 32, false);
      return;
    }
  };

  ctrl.report = function () {
    const result = {
      done: game.missions.done,
      failed: ctrl.failed,
      simSeconds: Math.round(ctrl.simSeconds),
      warps: ctrl.warps,
      missionsCompleted: game.missions.missionIdx,
      money: Math.floor(game.player.money),
      respect: game.respect,
      log: ctrl.log,
    };
    window.__autotest = result;
    document.title = result.done ? 'AUTOTEST-DONE' : 'AUTOTEST-FAILED';
    console.log('[AUTOTEST-RESULT]', JSON.stringify(result));
  };

  return ctrl;
}

export function stageShot(game, name) {
  const p = game.player;
  const city = game.city;
  const nodes = city.graph.nodes;
  function placeCar(car, x, z, heading) {
    car.x = x; car.z = z; car.heading = heading; car.speed = 0;
    car.condition = 100; car.wrecked = false;
    car.syncMesh();
  }
  function setMission(idx, stageIdx, progress) {
    game.missions.missionIdx = idx;
    game.missions.stageIdx = stageIdx;
    game.missions.progress = progress || 0;
    game.missions.done = false;
    game.enterStage();
    const m = game.missions.mission;
    const s = game.missions.stage;
    if (s && s.who) game.missions.say(s.who, s.text, game.now);
    else if (m) game.missions.say(m.intro.who, m.intro.text, game.now);
  }
  function clearCameraCorridor(dx, dz) {
    const h = p.inCar ? p.inCar.heading : p.heading;
    const fwd = dx * Math.sin(h) + dz * Math.cos(h);
    const lat = dx * Math.cos(h) - dz * Math.sin(h);
    if (fwd < -3 && fwd > -14 && Math.abs(lat) < 7) {
      const shifted = lat >= 0 ? lat + 13 : lat - 13;
      return [fwd * Math.sin(h) + shifted * Math.cos(h), fwd * Math.cos(h) - shifted * Math.sin(h)];
    }
    return [dx, dz];
  }
  function setPolice(n, offsets, heliDx, heliDz, heliY) {
    game.setWanted(n);
    game.policeUnits.forEach((u, i) => {
      const o = offsets[i % offsets.length];
      const [sx, sz] = clearCameraCorridor(o[0], o[1]);
      placeCar(u.car, game.px() + sx, game.pz() + sz, o[2]);
      u.role = ['RAMMING', 'FLANKING', 'SPOTLIGHT', 'FIRING', 'ROADBLOCK'][i % 5];
    });
    game.heli.active = n >= 3;
    game.heli.x = game.px() + (heliDx ?? -32);
    game.heli.z = game.pz() + (heliDz ?? -24);
    game.heli.y = heliY ?? 20;
    game.heli.mesh.visible = true;
    game.heli.mesh.position.set(game.heli.x, game.heli.y, game.heli.z);
  }
  function placeTraffic(spots) {
    game.traffic.slice(0, spots.length).forEach((car, i) => {
      const [dx, dz, heading] = spots[i];
      const [sx, sz] = clearCameraCorridor(dx, dz);
      placeCar(car, game.px() + sx, game.pz() + sz, heading);
      car.speed = 6 + i * 2;
      car._staged = true;
    });
  }
  function clearNearby() {
    const far = game.city.graph.nodes[48];
    let k = 0;
    for (const car of [...game.traffic, ...game.parked]) {
      if (car._staged || car === p.inCar) continue;
      if (Math.hypot(car.x - game.px(), car.z - game.pz()) < 30) {
        car.x = far.x - 20 + (k % 5) * 8;
        car.z = far.z - 10 + Math.floor(k / 5) * 8;
        car.speed = 0;
        car.syncMesh();
        k++;
      }
    }
  }
  function placePeds(spots) {
    game.peds.slice(0, spots.length).forEach((ped, i) => {
      const [dx, dz] = spots[i];
      ped.x = game.px() + dx; ped.z = game.pz() + dz;
      ped.mesh.position.set(ped.x, 0, ped.z);
      ped.mesh.rotation.y = (i % 2 ? 1 : -1) * Math.PI / 2;
    });
  }
  function playerCar(name, colour) {
    const car = p.inCar || game.parked[0];
    car.name = name; car.colour = colour;
    if (car.mesh && car.mesh.children[0] && car.mesh.children[0].material) {
      car.mesh.children[0].material.color.setHex(colour);
    }
    return car;
  }
  function addFlash(x, y, z, heading, scale) {
    const T = game.THREE;
    const g = new T.Group();
    const outer = new T.Mesh(new T.ConeGeometry(0.5 * scale, 1.5 * scale, 6),
      new T.MeshBasicMaterial({ color: 0xff8a2a, transparent: true, opacity: 0.8,
        blending: T.AdditiveBlending, depthWrite: false }));
    outer.rotation.x = -Math.PI / 2;
    outer.position.z = 0.75 * scale;
    const inner = new T.Mesh(new T.ConeGeometry(0.28 * scale, 1.0 * scale, 6),
      new T.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.9,
        blending: T.AdditiveBlending, depthWrite: false }));
    inner.rotation.x = -Math.PI / 2;
    inner.position.z = 0.5 * scale;
    const core = new T.Mesh(new T.SphereGeometry(0.3 * scale, 8, 6),
      new T.MeshBasicMaterial({ color: 0xfff6c0 }));
    g.add(outer); g.add(inner); g.add(core);
    g.position.set(x, y, z);
    g.rotation.y = heading;
    game.scene.add(g);
    return g;
  }
  function addNameTag(x, y, z, label, health, maxHealth) {
    // A floating name plate that always faces the camera: gold name on a
    // dark plate with a red health bar underneath, so the marked fighter
    // reads at thumbnail size even when the figures are small.
    const T = game.THREE;
    const cv = document.createElement('canvas');
    cv.width = 256; cv.height = 72;
    const c = cv.getContext('2d');
    c.fillStyle = 'rgba(12, 8, 10, 0.88)';
    c.fillRect(0, 0, 256, 72);
    c.strokeStyle = '#ffd23a';
    c.lineWidth = 3;
    c.strokeRect(1, 1, 254, 70);
    c.fillStyle = '#ffd23a';
    c.font = 'bold 25px sans-serif';
    c.textAlign = 'center';
    c.fillText(label, 128, 31);
    c.fillStyle = 'rgba(255, 255, 255, 0.25)';
    c.fillRect(18, 44, 220, 12);
    c.fillStyle = '#ff5040';
    c.fillRect(18, 44, 220 * Math.max(0, health / maxHealth), 12);
    const tex = new T.CanvasTexture(cv);
    const tag = new T.Sprite(new T.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    tag.scale.set(4.4, 1.24, 1);
    tag.position.set(x, y, z);
    game.scene.add(tag);
    return tag;
  }
  function addNightBeams(car) {
    const T = game.THREE;
    const pool = new T.Mesh(new T.CircleGeometry(2.8, 20),
      new T.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.10,
        blending: T.AdditiveBlending, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = 0.12;
    car.mesh.add(pool);
    const ahead = new T.Mesh(new T.PlaneGeometry(5.5, 10),
      new T.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.18,
        blending: T.AdditiveBlending, depthWrite: false }));
    ahead.rotation.x = -Math.PI / 2;
    ahead.position.set(0, 0.12, 8);
    car.mesh.add(ahead);
    const rearGlow = new T.Mesh(new T.PlaneGeometry(1.9, 0.55),
      new T.MeshBasicMaterial({ color: 0xff2a1a, transparent: true, opacity: 0.25,
        blending: T.AdditiveBlending, depthWrite: false, side: T.DoubleSide }));
    rearGlow.position.set(0, 0.78, -2.32);
    car.mesh.add(rearGlow);
  }

  if (name === 'cover') {
    game.setNight(false);
    setMission(2, 1, 0);
    const car = playerCar('SOLANO GT', 0xd83a2e);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    // Round 7: the coast road. The westernmost avenue (x = -192) runs the
    // length of Playa Serena with the beach and the sea just beyond it, so
    // the car drives south along the water instead of down an inland street.
    // The sea sits to the car's right, the pier ahead over the bay. The car
    // stops 18 m short of the pier-gate node, so the staged frame still
    // shows the Drop in progress instead of completing it on the spot, and
    // the nearest billboard sits 50 m up the road instead of looming over
    // the car. The camera is swung a touch toward the water so the sea
    // fills the right of the frame and the hero car reads three-quarter.
    placeCar(car, -192, -110, 0);
    car.speed = 23.8;   // 86 km/h: fast, but not rank 1's 111
    p.money = 7400; game.respect = 210;
    p.health = 92; p.armour = 60;
    p.weaponIdx = 1; p.weaponsOwned = [true, true, true, false];
    game.clockMinutes = 17 * 60 + 12;
    // Police stay on the road: the coast road is only 14 m wide, so every
    // lateral offset is kept inside the asphalt and off the sand.
    setPolice(3, [[6, 21, 0], [-5, 32, 0], [8, 46, 0],
      [-4, -22, 0], [7, 60, 0], [-5, 74, 0]], -18, 30, 13);
    placeTraffic([[2, 28, 0], [-3, 44, 0], [3, 62, 0],
      [-2, 82, Math.PI], [5, 100, 0], [-4, -30, 0]]);
    placePeds([[10, 14], [-11, 30], [10, 44], [-11, 58], [10, 72], [-11, 86]]);
    game.missions.say('ELENA', 'Package is in the boot, Dario. Pier gate, no detours — the CPD is already circling.', game.now);
    game.camYaw = -0.25;
  } else if (name === 'chase') {
    game.setNight(true);
    setMission(5, 0, 2);
    const car = playerCar('AZABACHE GT', 0xe8e8e8);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    placeCar(car, 128, 64, Math.PI);
    car.speed = 27.2;   // 98 km/h
    const bodyMat = car.mesh.children[0].material;
    if (bodyMat.emissive) bodyMat.emissive.setHex(0x404040);
    addNightBeams(car);
    const limo = game.missionCars[0];
    if (limo) placeCar(limo, 128, 8, Math.PI);
    p.money = 19600; game.respect = 980;
    p.health = 85; p.armour = 45;
    p.weaponIdx = 2; p.weaponsOwned = [true, true, true, true];
    game.clockMinutes = 21 * 60 + 24;
    setPolice(4, [[-6, -21, Math.PI], [6, -33, Math.PI], [-8, -48, Math.PI],
      [10, 24, Math.PI], [-12, -64, Math.PI], [8, 36, Math.PI]], 28, -32, 17);
    placeTraffic([[-3, -26, Math.PI], [4, -46, Math.PI], [-4, -64, 0],
      [6, -84, Math.PI], [2, 28, Math.PI]]);
    placePeds([[10, -14], [-10, -30], [10, -48], [-10, -66], [10, -82]]);
    game.missions.say('TOMAS', 'The Regent is running north, Dario — ram it before it turns for the pier!', game.now);
    game.camYaw = 0;
  } else if (name === 'pause') {
    game.setNight(false);
    setMission(6, 0, 0);
    const car = playerCar('BRISA COUPE', 0x3aa84c);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    placeCar(car, 0, 0, 0);
    car.speed = 0;
    p.money = 24750; game.respect = 1150;
    p.health = 90; p.armour = 60;
    p.weaponIdx = 1; p.weaponsOwned = [true, true, true, false];
    game.clockMinutes = 19 * 60 + 5;
    setPolice(2, [[8, 18, 0], [-10, -22, 0], [14, 30, 0], [-16, 40, 0]]);
    placeTraffic([[-4, 24, 0], [5, -28, 0]]);
    placePeds([[10, 12], [-10, -16], [10, 26]]);
    game.missions.say('ELENA', 'Four stars, Dario. The whole department is on you. Break line of sight, then get to my boat at the pier.', game.now);
    game.pauseShot = true;
    game.camYaw = 0;
  } else {
    game.setNight(false);
    setMission(7, 1, 0);
    if (p.inCar) p.exitCar(game.city);
    p.x = 0; p.z = 0;
    p.heading = Math.PI / 2;
    p.mesh.visible = true;
    p.mesh.position.set(p.x, 0, p.z);
    p.mesh.rotation.y = p.heading;
    p.money = 31200; game.respect = 2350;
    p.health = 64; p.armour = 22;
    p.weaponIdx = 2; p.weaponsOwned = [true, true, true, true];
    p.ammo.SMG = 74;
    game.clockMinutes = 19 * 60 + 20;
    setPolice(3, [[-6, -20, Math.PI / 2], [6, -30, Math.PI / 2], [-8, 22, -Math.PI / 2],
      [14, -18, 0], [-14, 28, Math.PI], [10, 34, 0]], 30, -26, 15);
    placeTraffic([[14, -3, Math.PI / 2], [-12, 4, -Math.PI / 2], [24, 3, Math.PI / 2], [-20, -4, -Math.PI / 2]]);
    placePeds([[-8, 10], [6, -10], [-4, -12], [12, 10], [-14, 12], [18, -10],
      [4, 12], [-10, -12], [22, 12], [8, -12]]);
    game.missions.say('VIDAL', 'You walked into my street, Dario. My men are already here.', game.now);
    const boss = game.enemies[0];
    if (boss) {
      boss.x = p.x + 6; boss.z = p.z;
      boss.health = 150;
      boss.mesh.position.set(boss.x, 0, boss.z);
      boss.mesh.rotation.y = -Math.PI / 2;
      boss.mesh.rotation.x = -0.22;
      addFlash(boss.x - 1.4, 1.35, boss.z, p.heading + Math.PI, 0.4);
      const T = game.THREE;
      const spark = new T.Mesh(new T.SphereGeometry(0.28, 8, 6),
        new T.MeshBasicMaterial({ color: 0xffd23a }));
      spark.position.set(boss.x - 0.7, 1.25, boss.z);
      game.scene.add(spark);
      const glow = new T.Mesh(new T.SphereGeometry(0.38, 8, 6),
        new T.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.45 }));
      glow.position.set(boss.x - 0.7, 1.25, boss.z);
      game.scene.add(glow);
      // Round 7: mark Vidal so the fight reads at a glance — his name and
      // the health he has left, floating just above his head.
      addNameTag(boss.x, 2.9, boss.z, 'MARCOS VIDAL', boss.health, 220);
    }
    const before = game.enemies.length;
    game.spawnWave(2);
    const flanks = [[7.5, -4.5], [8, -2]];
    game.enemies.slice(before).forEach((e, i) => {
      e.x = p.x + flanks[i % 2][0]; e.z = p.z + flanks[i % 2][1];
      e.mesh.position.set(e.x, 0, e.z);
      if (i === 0) {
        e.health = 0;
        e.mesh.rotation.x = Math.PI / 2;
        e.mesh.position.y = 0.4;
        const T = game.THREE;
        const stain = new T.Mesh(new T.CircleGeometry(1.1, 16),
          new T.MeshBasicMaterial({ color: 0x5a0a0a }));
        stain.rotation.x = -Math.PI / 2;
        stain.position.set(e.x, 0.09, e.z);
        game.scene.add(stain);
      }
    });
    const fwdX = Math.sin(p.heading), fwdZ = Math.cos(p.heading);
    const mzX = p.x + fwdX * 1.7, mzZ = p.z + fwdZ * 1.7;
    addFlash(mzX, 1.35, mzZ, p.heading, 0.5);
    const gun = new game.THREE.Mesh(new game.THREE.BoxGeometry(0.1, 0.12, 0.55),
      new game.THREE.MeshBasicMaterial({ color: 0x14141a }));
    gun.position.set(-0.45, 1.35, 0.35);
    p.mesh.add(gun);
    if (boss) {
      const T = game.THREE;
      const len = Math.hypot(boss.x - mzX, boss.z - mzZ);
      const tracer = new T.Mesh(new T.BoxGeometry(0.09, 0.09, len),
        new T.MeshBasicMaterial({ color: 0xffe9a8, transparent: true, opacity: 0.9 }));
      tracer.position.set((mzX + boss.x) / 2, 1.3, (mzZ + boss.z) / 2);
      tracer.rotation.y = Math.atan2(boss.x - mzX, boss.z - mzZ);
      game.scene.add(tracer);
    }
    game._finaleTarget = { x: p.x + 6, z: p.z };
    game.camYaw = 0.5;
  }
  clearNearby();
  game.updateObjective();
  game.hud.update(game, game.now);
  game.updateCamera(1);
  if (name === 'finale' && game._finaleTarget) {
    game.objectivePos = { x: game._finaleTarget.x, z: game._finaleTarget.z, node: -1 };
    game.routeNodes = null;
    game.hud.update(game, game.now);
  }
}

