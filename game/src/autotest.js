// autotest.js — Coraluna's self-test: a scripted autopilot that plays all 8
// missions end to end in accelerated simulation, the reachability gate, and
// the deterministic screenshot staging used for the 4 cover shots.
// Written fresh for this entry; the autopilot reuses the same Car.autopilot
// the AI vehicles use, with all 14 chase lessons built in.
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

  // Walk directly toward a point (used to reach parked cars and the pier).
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
    if (p.inCar && !p.inCar.wrecked) return true;
    if (p.inCar && p.inCar.wrecked) p.exitCar(game.city);
    const car = nearestParkedCar();
    if (!car) return false;
    if (dist(p.x, p.z, car.x, car.z) < 4) {
      p.tryEnterCar(game.cars.filter(c => c.stealable || c.owned));
      return !!p.inCar;
    }
    // Walk to the car; if the player is wedged and makes no progress for
    // 4 sim-seconds, step them to the nearest road node (always clear).
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
      note(`Mission ${mc.mission.id} ${mc.mission.title} — stage ${mc.stageIdx + 1}/${mc.stageCount}: ${s.title}`);
    }
    // Timeout guard.
    if (ctrl.simSeconds > 2400 && !ctrl.failed) {
      ctrl.finished = true;
      ctrl.failed = true;
      note('TIMEOUT: playthrough did not finish in 2400 sim-seconds');
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
      // Keep moving between far corner nodes so ground units keep losing
      // line of sight; warps (in driveCarToNode) break it outright.
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

    // goto (and default): drive to the stage node.
    if (s.type === 'goto') {
      if (!ensureCar(dt)) return;
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
// Deterministic staged scenes: fixed positions, fixed wanted level, fixed
// dialogue, golden-hour light. Each shows several systems at once.
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
  function setPolice(n, offsets) {
    game.setWanted(n);
    game.policeUnits.forEach((u, i) => {
      const o = offsets[i % offsets.length];
      placeCar(u.car, p.x + o[0], p.z + o[1], o[2]);
      u.role = ['RAMMING', 'FLANKING', 'SPOTLIGHT', 'FIRING', 'ROADBLOCK'][i % 5];
    });
    game.heli.active = n >= 3;
    game.heli.x = p.x + 20; game.heli.z = p.z - 30; game.heli.y = 42;
    game.heli.mesh.visible = true;
    game.heli.mesh.position.set(game.heli.x, game.heli.y, game.heli.z);
  }
  function playerCar(name, colour) {
    const car = p.inCar || game.parked[0];
    car.name = name; car.colour = colour;
    car.mesh = car.mesh; // keep mesh
    return car;
  }

  if (name === 'cover') {
    // M6: ramming the Regent on the beach boulevard, 4 stars, heli overhead.
    setMission(5, 0, 2);
    const car = playerCar('TIBURON GT-R', 0xd83a2e);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    // Chase runs west down the beach boulevard toward the sea and the sunset.
    placeCar(car, -60, -160, -Math.PI / 2);
    car.speed = 22;
    const limo = game.missionCars[0];
    if (limo) placeCar(limo, -112, -160, -Math.PI / 2);
    p.money = 18450; game.respect = 3900;
    p.health = 72; p.armour = 55;
    p.weaponIdx = 2; p.weaponsOwned = [true, true, true, true];
    setPolice(4, [[-30, 18, 0], [24, -14, 2.4], [-8, -34, 3.1], [44, 22, 1.2], [-52, -6, 0.5]]);
    game.missions.say('TOMAS', 'He\'s making for the pier! Ram the Regent before it reaches the water!', game.now);
    game.camYaw = 0;
  } else if (name === 'chase') {
    // M7: losing the 4-star manhunt on the boulevard.
    setMission(6, 0, 0);
    const car = playerCar('VELOZ COMET RS', 0xd83a2e);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    placeCar(car, 32, 96, -Math.PI / 2);
    car.speed = 28;
    p.money = 86250; game.respect = 290;
    p.health = 88; p.armour = 40;
    p.weaponIdx = 1; p.weaponsOwned = [true, true, true, false];
    setPolice(4, [[-26, 12, 0.4], [30, -18, 2.8], [-12, -30, 3.4], [48, 16, 1.0], [-44, -10, 0.8]]);
    game.missions.say('ELENA', 'The boat sails in two minutes, Dario! Shake that chopper and get to the pier!', game.now);
    game.camYaw = 0;
  } else if (name === 'escort') {
    // M5: escorting Nadia's van through Plaza Central, 2 stars.
    setMission(4, 0, 0);
    const car = playerCar('BRISA COUPE', 0x3aa84c);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    // Escort runs west toward the harbour.
    placeCar(car, -24, 24, -Math.PI / 2);
    car.speed = 12;
    const van = game.missions.escortVan;
    if (van) placeCar(van, -56, 24, -Math.PI / 2);
    p.money = 5400; game.respect = 820;
    p.health = 96; p.armour = 50;
    p.weaponIdx = 0; p.weaponsOwned = [true, true, false, false];
    setPolice(2, [[-34, 30, 0.2], [38, -22, 2.6]]);
    game.missions.say('NADIA', 'Stay with the van. If a cop rams it, ram the cop back.', game.now);
    game.camYaw = 0;
  } else {
    // finale: M8, on foot at the pier facing Vidal.
    setMission(7, 1, 0);
    if (p.inCar) p.exitCar(game.city);
    const pier = city.pier;
    p.x = pier.endX + 52; p.z = (pier.z0 + pier.z1) / 2;
    p.heading = -Math.PI / 2;
    p.mesh.position.set(p.x, 0, p.z);
    p.money = 12400; game.respect = 2100;
    p.health = 81; p.armour = 25;
    p.weaponIdx = 1; p.weaponsOwned = [true, true, true, true];
    game.setWanted(0);
    game.missions.say('VIDAL', 'One last man between you and freedom, Dario. Me.', game.now);
    game.camYaw = 0;
  }
  game.updateObjective();
  game.hud.update(game, game.now);
  game.updateCamera(1);
}
