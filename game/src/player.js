// player.js — Dario Fuentes on foot: walking, entering and stealing cars,
import { clamp, angleDiff, dist } from './util.js';
import { nearestRoadPoint } from './city.js';

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
    this.inCar = null;
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
      const fx = Math.sin(this.heading), fz = Math.cos(this.heading);
      const rx = Math.cos(this.heading), rz = -Math.sin(this.heading);
      const vx = fx * mz + rx * mx;
      const vz = fz * mz + rz * mx;
      const nx = this.x + vx * sprint * dt;
      const nz = this.z + vz * sprint * dt;
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

  exitCar(city) {
    if (!this.inCar) return;
    const c = this.inCar;
    this.x = c.x + Math.cos(c.heading) * 3.5;
    this.z = c.z - Math.sin(c.heading) * 3.5;
    this.heading = c.heading;
    c.isPlayerCar = false;
    this.inCar = null;
    this.onFoot = true;
    this.stealCooldown = 0.5;
    if (city && hitsBuilding(this.x, this.z, city)) {
      const rp = nearestRoadPoint(city.graph, this.x, this.z);
      if (rp) { this.x = rp.x; this.z = rp.z; }
    }
    if (this.mesh) {
      this.mesh.visible = true;
      this.mesh.position.set(this.x, 0, this.z);
    }
  }

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
