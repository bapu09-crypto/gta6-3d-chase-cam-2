// autotest.js — Coraluna's self-test: a scripted autopilot that plays all 8
// missions end to end in accelerated simulation, the reachability gate, and
// the deterministic screenshot staging used for the 4 cover shots.
// Written fresh for this entry; the autopilot reuses the same Car.autopilot
// the AI vehicles use, with all 14 chase lessons built in.
import { checkReachability } from './city.js';
import { LOCATIONS } from './missions.js';
import { nearestNode, findPath } from './city.js';
import { makeFlameMesh } from './world.js';
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
    // Abandon a car that is nearly wrecked for a fresh ride instead of
    // nursing it until it dies mid-chase.
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
      // If no star has dropped for 45 sim-seconds, warp to a far corner:
      // the jump breaks line of sight and distance outright.
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

    // goto (and default): drive to the stage node. Watchdog: if the car
    // makes no progress toward the target for 60 sim-seconds, warp it to
    // the target node (a test-harness recovery, counted as a warp).
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
  // Police are placed relative to where the player ACTUALLY is (car or on
  // foot), not the on-foot coordinates, which go stale the moment Dario
  // gets in a car — that staleness is what put the cover's units 200 m away.
  // Offsets are [dx, dz, heading] in metres from the player; the first
  // offset is the closest unit and always gets the RAMMING role. The
  // helicopter is placed ahead and to the side of the chase camera, low
  // enough to stay inside the frame, with its spotlight on.
  function setPolice(n, offsets, heliDx, heliDz, heliY) {
    game.setWanted(n);
    game.policeUnits.forEach((u, i) => {
      const o = offsets[i % offsets.length];
      placeCar(u.car, game.px() + o[0], game.pz() + o[1], o[2]);
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
      placeCar(car, game.px() + dx, game.pz() + dz, heading);
      car.speed = 6 + i * 2;
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
    // M6: ramming the Regent on the beach boulevard, 4 stars, helicopter in
    // frame with its spotlight on, a ramming unit right behind the car.
    setMission(5, 0, 2);
    const car = playerCar('TIBURON GT-R', 0xd83a2e);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    // Chase runs west down the north boulevard (z=-192 road) toward the sea
    // and the sunset; the limo is ahead on the same road.
    placeCar(car, -60, -192, -Math.PI / 2);
    car.speed = 22;
    const limo = game.missionCars[0];
    if (limo) placeCar(limo, -112, -192, -Math.PI / 2);
    p.money = 18450; game.respect = 3900;
    p.health = 72; p.armour = 55;
    p.weaponIdx = 2; p.weaponsOwned = [true, true, true, true];
    game.clockMinutes = 16 * 60 + 47;
    // Closest unit 8 m behind the car (RAMMING), the rest 15–42 m out, all
    // on the boulevard; the helicopter hangs ahead-left in the frame.
    setPolice(4, [[7, 4, -Math.PI / 2], [-14, -6, -Math.PI / 2], [24, -5, -Math.PI / 2],
      [-30, 5, -Math.PI / 2], [42, -4, -Math.PI / 2]], -36, -16, 16);
    placeTraffic([[-28, 4, -Math.PI / 2], [-78, -4, -Math.PI / 2]]);
    game.missions.say('TOMAS', 'He\'s making for the pier! Ram the Regent before it reaches the water!', game.now);
    game.camYaw = 0;
  } else if (name === 'chase') {
    // M7: losing the 4-star manhunt on the boulevard.
    setMission(6, 0, 0);
    const car = playerCar('RUKAN PELO GT', 0xd83a2e);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    // Manhunt on the z=64 boulevard, heading west.
    placeCar(car, 32, 64, -Math.PI / 2);
    car.speed = 28;
    p.money = 86250; game.respect = 290;
    p.health = 88; p.armour = 40;
    p.weaponIdx = 1; p.weaponsOwned = [true, true, true, false];
    game.clockMinutes = 18 * 60 + 48;
    setPolice(4, [[7, 4, -Math.PI / 2], [-14, -6, -Math.PI / 2], [24, -5, -Math.PI / 2],
      [-30, 5, -Math.PI / 2], [42, -4, -Math.PI / 2]], -36, -16, 16);
    placeTraffic([[-26, 4, -Math.PI / 2], [-64, -4, -Math.PI / 2]]);
    game.missions.say('ELENA', 'The boat sails in two minutes, Dario! Shake that chopper and get to the pier!', game.now);
    game.camYaw = 0;
  } else if (name === 'escort') {
    // M5: escorting Nadia's van through Plaza Central, 2 stars.
    setMission(4, 0, 0);
    const car = playerCar('BRISA COUPE', 0x3aa84c);
    p.inCar = car; car.isPlayerCar = true; p.onFoot = false;
    // Escort runs west along the z=0 road through Plaza Central.
    placeCar(car, -24, 0, -Math.PI / 2);
    car.speed = 12;
    const van = game.missions.escortVan;
    if (van) placeCar(van, -56, 0, -Math.PI / 2);
    p.money = 5400; game.respect = 820;
    p.health = 96; p.armour = 50;
    p.weaponIdx = 0; p.weaponsOwned = [true, true, false, false];
    game.clockMinutes = 17 * 60 + 20;
    // Two stars, four units, the closest 9 m behind the car.
    setPolice(2, [[8, 4, -Math.PI / 2], [-16, -5, -Math.PI / 2],
      [26, 4, -Math.PI / 2], [-34, 6, -Math.PI / 2]]);
    placeTraffic([[-70, -4, -Math.PI / 2]]);
    game.missions.say('NADIA', 'Stay with the van. If a cop rams it, ram the cop back.', game.now);
    game.camYaw = 0;
  } else {
    // finale: M8, the pier showdown — now a busy four-star fight, not an
    // empty deck. Dario at the pier root so the minimap shows the harbour
    // streets as well as the pier; Vidal 14 m ahead of him, flanked by two
    // henchmen; the CPD storms the pier behind Dario, the helicopter hangs
    // over the deck, and a torched car burns on the boards.
    setMission(7, 1, 0);
    if (p.inCar) p.exitCar(game.city);
    const pier = city.pier;
    p.x = pier.x1 - 18; p.z = (pier.z0 + pier.z1) / 2;
    p.heading = -Math.PI / 2;
    p.mesh.position.set(p.x, 0, p.z);
    p.money = 12400; game.respect = 2100;
    p.health = 81; p.armour = 25;
    p.weaponIdx = 1; p.weaponsOwned = [true, true, true, true];
    game.clockMinutes = 18 * 60 + 52;
    // Four stars: cruisers on the deck and the approach road.
    setPolice(4, [[-6, 6, -Math.PI / 2], [10, -8, -Math.PI / 2], [-14, -10, -Math.PI / 2],
      [16, 10, -Math.PI / 2], [-26, -6, -Math.PI / 2], [26, -6, -Math.PI / 2]], -28, -14, 13);
    game.missions.say('VIDAL', 'One last man between you and freedom, Dario. Me.', game.now);
    const boss = game.enemies[0];
    if (boss) {
      boss.x = p.x - 14; boss.z = p.z;
      boss.mesh.position.set(boss.x, 0, boss.z);
    }
    // Two henchmen flank Vidal for the shot (spawnWave places them on the
    // pier; we then pin them to the flanking spots).
    const before = game.enemies.length;
    game.spawnWave(2);
    const flanks = [p.z - 7, p.z + 7];
    game.enemies.slice(before).forEach((e, i) => {
      e.x = p.x - 14; e.z = flanks[i % 2];
      e.mesh.position.set(e.x, 0, e.z);
    });
    // A burning wreck on the boards ahead of Vidal: flame cones plus a warm
    // point light so the fire reads at dusk.
    const wreck = game.traffic[0];
    if (wreck) {
      placeCar(wreck, p.x - 24, p.z + 8, -Math.PI / 2);
      wreck.wrecked = true; wreck.condition = 0;
      const flame = makeFlameMesh(game.THREE);
      flame.position.set(wreck.x, 0, wreck.z);
      game.scene.add(flame);
      const fireLight = new game.THREE.PointLight(0xff7733, 80, 40);
      fireLight.position.set(wreck.x, 4, wreck.z);
      game.scene.add(fireLight);
    }
    game.camYaw = 0;
  }
  game.updateObjective();
  game.hud.update(game, game.now);
  game.updateCamera(1);
}
