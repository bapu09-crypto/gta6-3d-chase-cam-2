// autotest.js — Coraluna's self-test: a scripted autopilot that plays all 8
// missions end to end in accelerated simulation, plus the reachability gate
// and the deterministic screenshot staging used for the 4 cover shots.
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

// --- autopilot driver ---------------------------------------------------------
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

  // Walk directly toward a point.
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
    // Returns true when the player is in a driveable car.
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
    // Walk to the car; if wedged for 4 sim-seconds, step to the nearest road node.
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
    // Stuck recovery of last resort: warp to the nearest road node.
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
    // Log mission/stage transitions.
    if (mc.missionIdx !== ctrl.lastMission || mc.stageIdx !== ctrl.lastStage) {
      ctrl.lastMission = mc.missionIdx;
      ctrl.lastStage = mc.stageIdx;
      ctrl.missionsDone = Math.max(ctrl.missionsDone, mc.missionIdx);
      ctrl._gotoD = undefined; ctrl._gotoTimer = 0;
      note(`Mission ${mc.mission.id} ${mc.mission.title} — stage ${mc.stageIdx + 1}/${mc.stageCount}: ${s.title}`);
    }
    // Timeout guard.
    if (ctrl.simSeconds > 3600 && !ctrl.failed) {
      ctrl.finished = true;
      ctrl.failed = true;
      note('TIMEOUT: playthrough did not finish in 3600 sim-seconds');
      return;
    }
    if (ctrl.finished) return;
    // Respawn after death: the game handles it; just keep driving.
    if (p.dead) return;

    if (s.type === 'combat') {
      // On foot on the pier: walk at the nearest live enemy and shoot.
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
      // Get out of the owned car, walk to a parked car that is not Dario's
      // own, take it.
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
        // Shadow the van at a polite distance.
        const car = p.inCar;
        car.followTarget = van;
        car.autopilot(dt, { city: game.city, cars: game.cars, now: game.now, cruise: 14, isChase: false });
      }
      return;
    }

    if (s.type === 'lose') {
      if (!ensureCar(dt)) return;
      // If no star has dropped for 45 sim-seconds, warp to a far corner.
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
      // Keep moving between far corner nodes.
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

    // goto: drive to the stage node; warp to it after 60 s without progress.
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

// --- screenshot staging -------------------------------------------------------
// Deterministic staged scenes: fixed positions, wanted level, dialogue.
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
  // Round 5 slab fix: the white-and-black slab was the closest police
  // car between the chase camera and the hero car; offsets landing in
  // that corridor (3-14 m behind, within 7 m of the axis) are pushed out.
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
  // Police are placed relative to where the player ACTUALLY is; the
  // first offset is the closest unit and gets the RAMMING role.
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
  // Park a few traffic cars near the player so the street reads as busy.
  function placeTraffic(spots) {
    game.traffic.slice(0, spots.length).forEach((car, i) => {
      const [dx, dz, heading] = spots[i];
      const [sx, sz] = clearCameraCorridor(dx, dz);
      placeCar(car, game.px() + sx, game.pz() + sz, heading);
      car.speed = 6 + i * 2;
      car._staged = true;
    });
  }
  // Move any un-staged car within 30 m of the player far away, so a
  // random spawn cannot pile into the staged hero car on the first tick.
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
  // Stage pedestrians onto the pavements near the player, so the street
  // reads as busy at a glance in every shot.
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
    // Recolour the body mesh (the first child) so the car matches its name.
    if (car.mesh && car.mesh.children[0] && car.mesh.children[0].material) {
      car.mesh.children[0].material.color.setHex(colour);
    }
    return car;
  }

  if (name === 'cover') {
    // Round 5 cover: M3 THE DROP, stage 2 — south down the x=-128 road
    // with the sea on the right, three stars, helicopter. $7,400, 86 km/h.
    game.setNight(false);
    setMission(2, 1, 0);
    const car = playerCar('TIBURON GT-R', 0xd83a2e);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    placeCar(car, -128, -64, 0);
    car.speed = 23.8;   // 86 km/h: fast, but not rank 1's 111
    p.money = 7400; game.respect = 210;
    p.health = 92; p.armour = 60;
    p.weaponIdx = 1; p.weaponsOwned = [true, true, true, false];
    game.clockMinutes = 17 * 60 + 12;
    // Police ahead and to the sides of the southbound run; the closest
    // unit is 21 m ahead-right, never in the camera corridor behind.
    setPolice(3, [[6, 21, 0], [-6, 32, 0], [8, 46, 0],
      [-9, -22, 0], [11, 60, 0], [-7, 74, 0]], -18, 30, 13);
    placeTraffic([[2, 28, 0], [-3, 44, 0], [3, 62, 0],
      [-2, 82, Math.PI], [5, 100, 0], [-4, -30, 0]]);
    placePeds([[10, 14], [-11, 30], [10, 44], [-11, 58], [10, 72], [-11, 86]]);
    game.missions.say('ELENA', 'Package is in the boot, Dario. Pier gate, no detours — the CPD is already circling.', game.now);
    game.camYaw = 0;
  } else if (name === 'chase') {
    // Round 5 chase: M6 THE REGENT at night in Mirador Sur — a different
    // district, car and night grade. Respect 980 (SHOT CALLER).
    game.setNight(true);
    setMission(5, 0, 2);
    const car = playerCar('VELOZ COMET', 0x2e6fd8);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    placeCar(car, 128, 64, Math.PI);
    car.speed = 27.2;   // 98 km/h
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
    // Round 5 pause shot: M7 MANHUNT is current — missions 1-6 DONE,
    // 7 NEXT, 8 LOCKED, $24,750, respect 1150 (SHOT CALLER).
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
    // Round 5 finale: M8 HIGH TIDE, stage 2, moved off the pier into a
    // populated street in Mercado Viejo — Dario on foot, Vidal ahead with
    // two henchmen, pedestrians, traffic, three stars. Respect 2350, LEGEND.
    game.setNight(false);
    setMission(7, 1, 0);
    if (p.inCar) p.exitCar(game.city);
    p.x = -128; p.z = 128;
    p.heading = Math.PI;
    p.mesh.visible = true;
    p.mesh.position.set(p.x, 0, p.z);
    p.money = 31200; game.respect = 2350;
    p.health = 78; p.armour = 60;
    p.weaponIdx = 2; p.weaponsOwned = [true, true, true, true];
    game.clockMinutes = 18 * 60 + 37;
    // Three stars on foot: cruisers on the street ahead and behind, the
    // helicopter hanging over the market roofs.
    setPolice(3, [[-6, -18, Math.PI], [7, -28, Math.PI], [-9, -40, Math.PI],
      [12, 20, Math.PI], [-12, 28, Math.PI], [8, -56, Math.PI]], -24, -30, 15);
    placeTraffic([[8, -20, Math.PI], [-8, -34, 0], [8, -48, Math.PI], [-8, 26, Math.PI]]);
    placePeds([[10, -10], [-10, -18], [10, -26], [-10, -34], [10, -42], [-10, -50],
      [10, -58], [-10, -66], [10, -6], [-10, -72]]);
    game.missions.say('VIDAL', 'You walked into my street, Dario. My men are already here.', game.now);
    // The combat stage spawned Vidal's men on the pier; move them onto
    // the street instead — Vidal ahead, two henchmen flanking him.
    const boss = game.enemies[0];
    if (boss) {
      boss.x = p.x; boss.z = p.z - 10;
      boss.mesh.position.set(boss.x, 0, boss.z);
    }
    const before = game.enemies.length;
    game.spawnWave(2);
    const flanks = [[-6, -13], [6, -13]];
    game.enemies.slice(before).forEach((e, i) => {
      e.x = p.x + flanks[i % 2][0]; e.z = p.z + flanks[i % 2][1];
      e.mesh.position.set(e.x, 0, e.z);
    });
    game._finaleTarget = { x: p.x, z: p.z - 10 };
    game.camYaw = 0;
  }
  clearNearby();
  game.updateObjective();
  game.hud.update(game, game.now);
  game.updateCamera(1);
  // The staged street finale fights on the street, not the pier: point
  // the minimap objective at Vidal instead of the pier end.
  if (name === 'finale' && game._finaleTarget) {
    game.objectivePos = { x: game._finaleTarget.x, z: game._finaleTarget.z, node: -1 };
    game.routeNodes = null;
    game.hud.update(game, game.now);
  }
}

