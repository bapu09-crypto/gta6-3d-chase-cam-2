// vehicles.js — car physics, the chase autopilot, traffic, police and helicopter.
// The autopilot is built from the start around the 14 chase lessons:
//  live targets are pursued by live position (1), targets never brake for
//  traffic or the player and target-vs-traffic contact is a damage-free nudge
//  (2), building damage is throttled to once per 0.5 s per vehicle (3),
//  off-road cars recover to the nearest road, never diagonally (4), no
//  closing-speed cap while following a live target (5), corner speed caps are
//  applied predictively before the corner (6), chase cornering is aggressive
//  (7), lookahead is short and off-road cars steer to the road first (8),
//  stuck detection runs BEFORE any car-ahead wait (9), follow targets have a
//  zero arrive radius (10), the ram threshold is low (11), close-range pursuit
//  steers directly at the live target (12), and the reverse branch is disabled
//  while following a live moving target (13). Lesson 14 (mission-3 southern
//  road traffic cluster) is handled by keeping police spawns off that road.
import { clamp, angleDiff, dist, closestOnSeg } from './util.js';
import { findPath as bfsPath, ROAD_HALF, distanceToRoad, nearestNode } from './city.js';

export const CAR_NAMES = [
  'VELOZ COMET', 'RUKAN PELO GT', 'MAREA SEDAN', 'BRISA COUPE',
  'TIBURON GT-R', 'PALMA PICKUP', 'CORAL WAGON', 'SOLSTICE S',
];
export const VAN_NAMES = ['CORREOS VAN', 'MERCADO VAN', 'PUERTO VAN'];

const RAM_SPEED = 3.0;      // lesson 11: light contact still counts as a ram
const HEAT_SPEED = 8.0;     // only harder impacts raise police heat
const BUILDING_HIT_GAP = 0.5; // lesson 3: building damage at most twice a second
const LOOKAHEAD = 5;        // lesson 8: short lookahead, metres
const CLOSE_RANGE = 42;     // lesson 12: direct pursuit inside this range
const STUCK_TIME = 2.5;     // lesson 9: seconds of throttle with no movement

export class Car {
  constructor(opts) {
    this.x = opts.x; this.z = opts.z;
    this.heading = opts.heading || 0;
    this.speed = 0;
    this.steer = 0;
    this.name = opts.name || 'VELOZ COMET';
    this.colour = opts.colour || 0xd83a2e;
    this.isPolice = !!opts.isPolice;
    this.isTarget = !!opts.isTarget;   // a mission target vehicle
    this.isPlayerCar = false;
    this.condition = 100;
    this.wrecked = false;
    this.maxSpeed = opts.maxSpeed || 36;
    this.accel = opts.accel || 14;
    this.mesh = opts.mesh || null;
    this.radius = 2.3;
    this.lastBuildingHit = -9;
    this.stuckTimer = 0;
    this.recoverPhase = 0;      // 0 none, 1 reversing arc, 2 forward arc
    this.recoverTimer = 0;
    this.recoverCount = 0;
    this.warpCount = 0;
    this.path = null;           // node list
    this.pathIdx = 0;
    this.replanTimer = 0;
    this.followTarget = null;   // live Car being pursued, or null
    this.goalNode = -1;
    this.waitTimer = 0;
    this.rammedBy = null;       // { car, relSpeed } of the last ram this frame
    this.cruise = opts.cruise || 0; // target cruise speed for AI traffic/targets
  }

  // --- physics step -------------------------------------------------------
  // throttle in [-1,1] (negative = brake/reverse), steerTarget in [-1,1].
  step(dt, throttle, steerTarget, city, cars, now) {
    if (this.wrecked) { this.speed *= Math.max(0, 1 - dt * 2); return; }
    const steerRate = 3.2;
    this.steer += clamp(steerTarget - this.steer, -steerRate * dt, steerRate * dt);
    const speedFactor = clamp(Math.abs(this.speed) / 8, 0, 1);
    const turnRate = this.steer * 1.9 * speedFactor * (this.speed >= 0 ? 1 : -1);
    this.heading += turnRate * dt;
    if (throttle > 0) this.speed += this.accel * throttle * dt;
    else if (throttle < 0) {
      if (this.speed > 0.5) this.speed += 30 * throttle * dt; // braking
      else this.speed += 9 * throttle * dt;                    // reversing
    } else {
      this.speed -= Math.sign(this.speed) * Math.min(Math.abs(this.speed), 6 * dt);
    }
    const maxFwd = this.maxSpeed, maxRev = 10;
    this.speed = clamp(this.speed, -maxRev, maxFwd);
    const nx = this.x + Math.sin(this.heading) * this.speed * dt;
    const nz = this.z + Math.cos(this.heading) * this.speed * dt;
    this.x = nx; this.z = nz;
    this.collideBuildings(city, now);
    this.collideCars(cars, now);
  }

  collideBuildings(city, now) {
    for (const b of city.buildings) {
      const cx = clamp(this.x, b.x0, b.x1);
      const cz = clamp(this.z, b.z0, b.z1);
      const dx = this.x - cx, dz = this.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < this.radius * this.radius) {
        const d = Math.sqrt(d2) || 0.001;
        const push = this.radius - d;
        this.x += (dx / d) * push;
        this.z += (dz / d) * push;
        // Lesson 3: building-hit damage throttled, not every frame.
        if (now - this.lastBuildingHit > BUILDING_HIT_GAP) {
          this.lastBuildingHit = now;
          const impact = Math.abs(this.speed);
          if (impact > 4) {
            this.damage(impact * 0.9, null);
            this.speed *= 0.45;
          } else {
            this.speed *= 0.7;
          }
        } else {
          this.speed *= 0.85;
        }
      }
    }
  }

  collideCars(cars, now) {
    for (const other of cars) {
      if (other === this || other.wrecked) continue;
      const dx = other.x - this.x, dz = other.z - this.z;
      const d = Math.hypot(dx, dz);
      const minD = this.radius + other.radius - 0.4;
      if (d < minD && d > 0.001) {
        const push = (minD - d) / 2;
        const ux = dx / d, uz = dz / d;
        this.x -= ux * push; this.z -= uz * push;
        other.x += ux * push; other.z += uz * push;
        const rel = Math.abs(this.speed - other.speed);
        // Lesson 2: target-vs-traffic contact is a damage-free nudge.
        const involvesPlayerOrPolice =
          this.isPlayerCar || other.isPlayerCar || this.isPolice || other.isPolice;
        if (rel > RAM_SPEED && involvesPlayerOrPolice) {
          const dmg = rel * 1.4;
          other.damage(dmg, this);
          this.damage(dmg * 0.6, other);
          this.rammedBy = { car: other, relSpeed: rel };
          other.rammedBy = { car: this, relSpeed: rel };
        } else if (rel > 1) {
          // Nudge: both lose a little speed, no damage.
          this.speed *= 0.92; other.speed *= 0.92;
        }
      }
    }
  }

  damage(amount, from) {
    if (this.wrecked) return;
    this.condition -= amount;
    if (this.condition <= 0) {
      this.condition = 0;
      this.wrecked = true;
      this.speed = 0;
    }
  }

  // --- autopilot ----------------------------------------------------------
  // Drive toward a goal node, or follow a live target car. Returns the
  // throttle/steer actually applied (for stuck detection by the caller).
  // opts: { city, cars, now, dt, cruise, isChase }
  autopilot(dt, opts) {
    const { city, cars, now } = opts;
    const graph = city.graph;
    if (this.wrecked) return { throttle: 0, steer: 0 };

    const following = !!this.followTarget && !this.followTarget.wrecked;
    const targetPos = following
      ? { x: this.followTarget.x, z: this.followTarget.z }
      : null;
    const targetMoving = following && Math.abs(this.followTarget.speed) > 2;

    // Lesson 9: stuck detection FIRST, before any car-ahead early return.
    const moving = Math.abs(this.speed) > 1.2;
    if (!moving && this.recoverPhase === 0) {
      this.stuckTimer += dt;
    } else if (moving) {
      this.stuckTimer = 0;
    }
    if (this.stuckTimer > STUCK_TIME) {
      this.stuckTimer = 0;
      this.recoverPhase = 1;
      this.recoverTimer = 0;
      this.recoverCount++;
    }

    // Stuck recovery: reverse arc, then forward arc, then (autotest) warp.
    // Lesson 13: the reverse branch is DISABLED while following a live
    // moving target — a moving target is always followed forward.
    if (this.recoverPhase !== 0) {
      if (following && targetMoving) {
        this.recoverPhase = 0; // never reverse at a moving target
      } else {
        this.recoverTimer += dt;
        if (this.recoverPhase === 1) {
          this.step(dt, -0.8, 0.8, city, cars, now);
          if (this.recoverTimer > 1.1) { this.recoverPhase = 2; this.recoverTimer = 0; }
          return { throttle: -0.8, steer: 0.8 };
        }
        this.step(dt, 0.8, -0.7, city, cars, now);
        if (this.recoverTimer > 1.1) { this.recoverPhase = 0; this.recoverTimer = 0; }
        return { throttle: 0.8, steer: -0.7 };
      }
    }

    // Lesson 4: off-road recovery — drive to the nearest road point first,
    // never diagonally through blocks. (Distance to a road centreline.)
    const offRoad = distanceToRoad(graph, this.x, this.z) > ROAD_HALF + 3;
    let goalNode = this.goalNode;
    if (following) goalNode = nearestNode(graph, targetPos.x, targetPos.z);
    if (offRoad) goalNode = nearestNode(graph, this.x, this.z);

    // Replan the road path periodically or when the goal node moved.
    this.replanTimer -= dt;
    const myNode = nearestNode(graph, this.x, this.z);
    if (!this.path || this.replanTimer <= 0 || goalNode !== this.goalNode) {
      this.goalNode = goalNode;
      this.path = bfsPath(graph, myNode, goalNode) || [myNode];
      this.replanTimer = 0.6;
    }

    // Pure pursuit on the path polyline: find the closest point on the
    // polyline to the car, then steer at a point LOOKAHEAD metres further
    // along it. This never targets a node the car already passed (the bug
    // that made a car U-turn forever between two nodes when a replan reset
    // its progress), because the closest point is always ahead of it.
    let steerX, steerZ;
    let closestSeg = 0;
    if (following && dist(this.x, this.z, targetPos.x, targetPos.z) < CLOSE_RANGE) {
      // Lesson 12: within close range of a live target, steer DIRECTLY at
      // its live position, not at path nodes.
      steerX = targetPos.x; steerZ = targetPos.z;
    } else if (offRoad) {
      // Lesson 8: while off-road, steer back to the road, not the target.
      const n = graph.nodes[this.path[0]];
      steerX = n.x; steerZ = n.z;
    } else {
      const pts = this.path.map(n => graph.nodes[n]);
      let bestD = Infinity, bestX = pts[0].x, bestZ = pts[0].z, bestT = 0;
      for (let k = 0; k < pts.length - 1; k++) {
        const c = closestOnSeg(this.x, this.z, pts[k].x, pts[k].z, pts[k + 1].x, pts[k + 1].z);
        const d = dist(this.x, this.z, c.x, c.z);
        if (d < bestD) { bestD = d; bestX = c.x; bestZ = c.z; bestT = c.t; closestSeg = k; }
      }
      // Walk LOOKAHEAD metres along the polyline from the closest point.
      let remain = LOOKAHEAD;
      let px = bestX, pz = bestZ;
      let k = closestSeg;
      let t = bestT;
      steerX = pts[pts.length - 1].x;
      steerZ = pts[pts.length - 1].z;
      while (k < pts.length - 1) {
        const a = k === closestSeg ? { x: px, z: pz } : pts[k];
        const b = pts[k + 1];
        const segLen = dist(a.x, a.z, b.x, b.z);
        if (remain <= segLen) {
          const f = segLen === 0 ? 0 : remain / segLen;
          steerX = a.x + (b.x - a.x) * f;
          steerZ = a.z + (b.z - a.z) * f;
          remain = 0;
          break;
        }
        remain -= segLen;
        k++;
      }
    }

    const desired = Math.atan2(steerX - this.x, steerZ - this.z);
    const diff = angleDiff(this.heading, desired);
    const steer = clamp(diff * 1.6, -1, 1);

    // Speed control.
    let cruise = opts.cruise || 16;
    // Match the prey's speed — but only for a chaser that is meant to catch
    // its target (the player ramming a van or a limo). Police never match
    // the player's speed, or a manhunt could never be lost.
    if (following && opts.matchSpeed !== false) {
      cruise = Math.max(cruise, Math.abs(this.followTarget.speed) + 4);
    }
    // Lesson 6: predictive corner braking — look at the NEXT turn on the
    // path (including the last node before the target) and cap speed now.
    let cornerCap = Infinity;
    if (!following || dist(this.x, this.z, targetPos.x, targetPos.z) > CLOSE_RANGE) {
      for (let k = closestSeg; k < Math.min(this.path.length - 1, closestSeg + 2); k++) {
        const a = graph.nodes[this.path[k]];
        const b = graph.nodes[this.path[k + 1]];
        const dirNow = Math.atan2(b.x - a.x, b.z - a.z);
        const turn = Math.abs(angleDiff(this.heading, dirNow));
        if (turn > 0.5) cornerCap = Math.min(cornerCap, opts.isChase ? 17 : 11);
        else if (turn > 0.2) cornerCap = Math.min(cornerCap, opts.isChase ? 24 : 16);
      }
    }
    // Lesson 5: no closing-speed cap while following a live target.
    let targetSpeed = Math.min(cruise, cornerCap);
    if (following && opts.matchSpeed !== false) {
      targetSpeed = Math.max(targetSpeed, Math.abs(this.followTarget.speed) + 3);
    }
    // Lesson 10: zero arrive radius on live targets — drive through them.
    const arrived = !following && this.path &&
      dist(this.x, this.z,
        graph.nodes[this.path[this.path.length - 1]].x,
        graph.nodes[this.path[this.path.length - 1]].z) < 6;
    let throttle = 0;
    if (arrived) {
      throttle = this.speed > 1 ? -1 : 0;
    } else if (this.speed < targetSpeed) {
      throttle = 1;
    } else if (this.speed > targetSpeed + 1.5) {
      throttle = -0.7;
    }

    // Car-ahead check (only AFTER stuck detection, lesson 9): slow for a
    // stopped car directly ahead, but never for a live follow target.
    if (!following) {
      for (const other of cars) {
        if (other === this || other.wrecked) continue;
        const dx = other.x - this.x, dz = other.z - this.z;
        const d = Math.hypot(dx, dz);
        if (d < 9 && d > 0.1) {
          const ahead = Math.sin(this.heading) * dx + Math.cos(this.heading) * dz;
          const side = Math.cos(this.heading) * dx - Math.sin(this.heading) * dz;
          if (ahead > 0 && Math.abs(side) < 3 && Math.abs(other.speed) < 2) {
            throttle = Math.min(throttle, 0);
            if (this.speed > 2) throttle = -0.8;
            break;
          }
        }
      }
    }

    this.step(dt, throttle, steer, city, cars, now);
    return { throttle, steer };
  }

  // Warp to the nearest road node (autotest recovery of last resort).
  warpToRoad(city) {
    const n = nearestNode(city.graph, this.x, this.z);
    const p = city.graph.nodes[n];
    this.x = p.x; this.z = p.z;
    this.speed = 0;
    this.heading = 0;
    this.stuckTimer = 0;
    this.recoverPhase = 0;
    this.path = null;
    this.warpCount++;
  }

  syncMesh() {
    if (!this.mesh) return;
    this.mesh.position.set(this.x, 0, this.z);
    this.mesh.rotation.y = this.heading;
    const spin = this.speed * 0.12;
    for (const w of this.mesh.userData.wheels || []) w.rotation.x += spin;
  }
}

// --- traffic --------------------------------------------------------------
// A traffic car loops a small route of road nodes at a modest cruise speed.
export function makeTrafficCar(city, rng, index, THREE, makeCarMesh, carColourFor) {
  const nodes = city.graph.nodes;
  const n = Math.floor(rng() * nodes.length);
  const p = nodes[n];
  const car = new Car({
    x: p.x + (rng() - 0.5) * 4, z: p.z + (rng() - 0.5) * 4,
    heading: rng() * Math.PI * 2,
    name: CAR_NAMES[index % CAR_NAMES.length],
    colour: carColourFor(index),
    cruise: 9 + rng() * 5,
    maxSpeed: 20,
  });
  car.mesh = makeCarMesh(THREE, car.colour, false);
  // A loop of 4-6 random nodes.
  car.loop = [];
  for (let k = 0; k < 5; k++) car.loop.push(Math.floor(rng() * nodes.length));
  car.loopIdx = 0;
  car.goalNode = car.loop[0];
  return car;
}

export function updateTraffic(car, dt, city, cars, now) {
  if (car.wrecked) return;
  const goal = city.graph.nodes[car.goalNode];
  if (dist(car.x, car.z, goal.x, goal.z) < 10) {
    car.loopIdx = (car.loopIdx + 1) % car.loop.length;
    car.goalNode = car.loop[car.loopIdx];
    car.path = null;
  }
  car.autopilot(dt, { city, cars, now, cruise: car.cruise, isChase: false });
}

// --- police ----------------------------------------------------------------
export const POLICE_CALLSIGNS = [
  'CORAL-12', 'CORAL-27', 'CORAL-48', 'CORAL-85', 'CORAL-43', 'CORAL-19',
  'CORAL-61', 'CORAL-33', 'CORAL-07', 'CORAL-58', 'CORAL-91', 'CORAL-24',
];
export const POLICE_ROLES = ['RAMMING', 'FLANKING', 'ROADBLOCK', 'PURSIT', 'SPOTLIGHT', 'FIRING'];

export class PoliceUnit {
  constructor(car, callsign, role) {
    this.car = car;
    this.callsign = callsign;
    this.role = role;
    this.lastSeen = 0;
  }
  distanceTo(px, pz) { return dist(this.car.x, this.car.z, px, pz); }
}

export class Helicopter {
  constructor(mesh) {
    this.mesh = mesh;
    this.x = 0; this.z = 0; this.y = 42;
    this.angle = 0;
    this.active = false;
    this.searching = false;
    this.searchX = 0; this.searchZ = 0;
  }
  update(dt, px, pz, now) {
    if (!this.active) { this.mesh.visible = false; return; }
    this.mesh.visible = true;
    this.angle += dt * 0.35;
    // Searching: circle a distant search point instead of the player.
    const cx = this.searching ? this.searchX : px;
    const cz = this.searching ? this.searchZ : pz;
    const tx = cx + Math.sin(this.angle) * 26;
    const tz = cz + Math.cos(this.angle) * 26;
    this.x += (tx - this.x) * Math.min(1, dt * 1.2);
    this.z += (tz - this.z) * Math.min(1, dt * 1.2);
    this.y += (38 + Math.sin(now * 0.5) * 3 - this.y) * Math.min(1, dt);
    this.mesh.position.set(this.x, this.y, this.z);
    this.mesh.rotation.y = Math.atan2(px - this.x, pz - this.z);
    this.mesh.userData.rotor.rotation.y += dt * 22;
    this.mesh.userData.tailRotor.rotation.x += dt * 18;
    // Spotlight cone points at the player.
    this.mesh.userData.spot.lookAt(px - this.x, -this.y, pz - this.z);
  }
}
