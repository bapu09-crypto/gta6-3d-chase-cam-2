// player.js — Dario Fuentes on foot: walking, entering and stealing cars,
// melee and pistol combat, health and armour. The player is a circle of
// radius 0.7 m; on foot he moves on the road graph like any pedestrian.
import { clamp, angleDiff, dist } from './util.js';
import { nearestNode } from './city.js';

export const WEAPONS = [
  { id: 'FISTS', name: 'FISTS', ammo: Infinity, damage: 12, range: 2.2, rate: 0.45 },
  { id: 'PISTOL', name: 'VESPER 9', ammo: 60, damage: 34, range: 30, rate: 0.32 },
  { id: 'SMG', name: 'MAKO SMG', ammo: 90, damage: 16, range: 26, rate: 0.09 },
  { id: 'SHOTGUN', name: 'BREAKER 12G', ammo: 18, damage: 55, range: 14, rate: 0.9 },
];

export class Player {
  constructor(x, z) {
    this.x = x; this.z = z;
    this.heading = 0;
    this.speed = 0;
    this.health = 100;
    this.armour = 50;
    this.money = 1250;
    this.weaponIdx = 0;
    this.weaponsOwned = [true, true, false, false];
    this.ammo = { PISTOL: 60, SMG: 90, SHOTGUN: 18 };
    this.inCar = null;          // Car the player is driving, or null
    this.onFoot = true;
    this.attackCooldown = 0;
    this.dead = false;
    this.mesh = null;
    this.walkPhase = 0;
    this.stealCooldown = 0;
  }

  get weapon() { return WEAPONS[this.weaponIdx]; }

  damage(amount) {
    if (this.dead) return;
    let left = amount;
    if (this.armour > 0) {
      const absorbed = Math.min(this.armour, left * 0.6);
      this.armour -= absorbed;
      left -= absorbed;
    }
    this.health -= left;
    if (this.health <= 0) { this.health = 0; this.dead = true; }
  }

  heal(amount) { this.health = clamp(this.health + amount, 0, 100); }

  // On-foot step. input: {forward, back, left, right, sprint}.
  // Returns nothing; moves on the ground plane, sliding around buildings.
  stepOnFoot(dt, input, city) {
    if (this.inCar || this.dead) return;
    const sprint = input.sprint ? 7.5 : 4.6;
    let mx = 0, mz = 0;
    if (input.forward) mz += 1;
    if (input.back) mz -= 1;
    if (input.left) mx -= 1;
    if (input.right) mx += 1;
    const len = Math.hypot(mx, mz);
    if (len > 0) {
      mx /= len; mz /= len;
      // Movement is camera-relative: forward is away from the chase camera,
      // which sits behind the player's heading.
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
      const vx = fx * mz + rx * mx;
      const vz = fz * mz + rz * mx;
      const nx = this.x + vx * sprint * dt;
      const nz = this.z + vz * sprint * dt;
      // Slide around building AABBs.
      if (!hitsBuilding(nx, this.z, city)) this.x = nx;
      if (!hitsBuilding(this.x, nz, city)) this.z = nz;
      this.walkPhase += dt * sprint * 1.6;
      this.speed = sprint;
    } else {
      this.speed = 0;
    }
    if (this.mesh) {
      this.mesh.position.set(this.x, 0, this.z);
      this.mesh.rotation.y = this.heading;
      const swing = this.speed > 0 ? Math.sin(this.walkPhase) * 0.5 : 0;
      const legs = this.mesh.userData.legs || [];
      if (legs[0]) legs[0].rotation.x = swing;
      if (legs[1]) legs[1].rotation.x = -swing;
    }
  }

  // Try to enter the nearest car within 4 m. Returns the car or null.
  tryEnterCar(cars) {
    if (this.inCar || this.stealCooldown > 0) return null;
    let best = null, bestD = 4;
    for (const c of cars) {
      if (c.wrecked) continue;
      const d = dist(this.x, this.z, c.x, c.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) {
      this.inCar = best;
      best.isPlayerCar = true;
      best.stolen = !best.owned;
      this.onFoot = false;
      this.stealCooldown = 0.5;
      if (this.mesh) this.mesh.visible = false;
    }
    return best;
  }

  exitCar() {
    if (!this.inCar) return;
    const c = this.inCar;
    this.x = c.x + Math.cos(c.heading) * 3.5;
    this.z = c.z - Math.sin(c.heading) * 3.5;
    this.heading = c.heading;
    c.isPlayerCar = false;
    this.inCar = null;
    this.onFoot = true;
    this.stealCooldown = 0.5;
    if (this.mesh) {
      this.mesh.visible = true;
      this.mesh.position.set(this.x, 0, this.z);
    }
  }

  // Melee / ranged attack. `enemies` is a list of {x, z, health, damage()}.
  // Returns the enemy hit, or null.
  attack(enemies, now) {
    if (this.attackCooldown > 0 || this.dead) return null;
    const w = this.weapon;
    this.attackCooldown = w.rate;
    if (w.id === 'FISTS') {
      for (const e of enemies) {
        if (e.health <= 0) continue;
        if (dist(this.x, this.z, e.x, e.z) < w.range) {
          e.damage(w.damage);
          return e;
        }
      }
      return null;
    }
    if (this.ammo[w.id] !== undefined && this.ammo[w.id] <= 0) return null;
    if (this.ammo[w.id] !== undefined) this.ammo[w.id]--;
    // Hitscan: nearest enemy within range and within a 35-degree cone.
    let best = null, bestD = w.range;
    for (const e of enemies) {
      if (e.health <= 0) continue;
      const d = dist(this.x, this.z, e.x, e.z);
      if (d > w.range) continue;
      const ang = Math.atan2(e.x - this.x, e.z - this.z);
      if (Math.abs(angleDiff(this.heading, ang)) < 0.6 && d < bestD) {
        bestD = d; best = e;
      }
    }
    if (best) best.damage(w.damage);
    return best;
  }

  // Autotest on-foot driver: walk along the road graph toward a node,
  // shooting the nearest enemy in range. Returns true when arrived.
  autoWalk(dt, city, targetNode, enemies) {
    if (this.inCar || this.dead) return false;
    const goal = city.graph.nodes[targetNode];
    if (dist(this.x, this.z, goal.x, goal.z) < 5) return true;
    const myNode = nearestNode(city.graph, this.x, this.z);
    const path = this._walkPath || null;
    if (!path || path.length === 0 || this._walkGoal !== targetNode) {
      // Lazy import to avoid a cycle: missions own the path helper.
      this._walkPath = null;
      this._walkGoal = targetNode;
    }
    // Simple steering: head for the next node on the BFS path, recomputed
    // cheaply each frame from the nearest node.
    const next = nextNodeToward(city, myNode, targetNode);
    const p = city.graph.nodes[next];
    const desired = Math.atan2(p.x - this.x, p.z - this.z);
    this.heading += clamp(angleDiff(this.heading, desired), -3 * dt, 3 * dt);
    this.stepOnFoot(dt, { forward: true }, city);
    // Auto-fire at the nearest live enemy in range.
    if (enemies) {
      let best = null, bestD = 26;
      for (const e of enemies) {
        if (e.health <= 0) continue;
        const d = dist(this.x, this.z, e.x, e.z);
        if (d < bestD) { bestD = d; best = e; }
      }
      if (best) {
        this.heading = Math.atan2(best.x - this.x, best.z - this.z);
        this.attack(enemies, 0);
      }
    }
    return false;
  }

  update(dt) {
    this.attackCooldown = Math.max(0, this.attackCooldown - dt);
    this.stealCooldown = Math.max(0, this.stealCooldown - dt);
  }
}

export function hitsBuilding(x, z, city) {
  for (const b of city.buildings) {
    if (x > b.x0 - 0.7 && x < b.x1 + 0.7 && z > b.z0 - 0.7 && z < b.z1 + 0.7) return true;
  }
  return false;
}

// One BFS step: the neighbour of `from` that lies on a shortest path to `to`.
import { findPath } from './city.js';
export function nextNodeToward(city, from, to) {
  if (from === to) return to;
  const path = findPath(city.graph, from, to);
  return path && path.length > 1 ? path[1] : to;
}
