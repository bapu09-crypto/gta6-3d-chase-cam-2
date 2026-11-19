// main.js — Coraluna: a 3D chase-cam open-world crime game.
// Boots the city, the player, traffic, police and the 8-mission story, and
// runs the game loop. All game code is written fresh for this entry.
import { buildCity, districtAt, nearestNode, findPath } from './city.js';
import { buildWorld, makeCarMesh, makePedMesh, makeHeliMesh, carColourFor } from './world.js';
import { Car, makeTrafficCar, updateTraffic, PoliceUnit, Helicopter, POLICE_CALLSIGNS, POLICE_ROLES, CAR_NAMES, VAN_NAMES } from './vehicles.js';
import { Player, WEAPONS, hitsBuilding } from './player.js';
import { MissionController, MISSIONS, LOCATIONS, CHARACTERS, stageTargetPos } from './missions.js';
import { Hud } from './hud.js';
import { Radio } from './audio.js';
import { clamp, angleDiff, dist, makeRng, pick } from './util.js';
import { runAutotest, stageShot, runReachability } from './autotest.js';

const SAVE_KEY = 'coraluna-save-v1';
const params = new URLSearchParams(location.search);
export const IS_AUTOTEST = params.has('autotest');
export const IS_SHOT = params.has('shot');
export const IS_REACH = params.has('test') && params.get('test') === 'reach';

export class Game {
  constructor() {
    this.seed = 20261119;
    this.rng = makeRng(this.seed);
    this.city = buildCity(this.seed);
    this.THREE = window.THREE;
    const { scene } = buildWorld(this.city, this.THREE);
    this.scene = scene;
    this.camera = new this.THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 2000);
    this.renderer = new this.THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1));
    document.getElementById('game').appendChild(this.renderer.domElement);

    this.player = new Player(0, 0);
    this.player.mesh = makePedMesh(this.THREE, 0xc98a4a, 0xc98a4a);
    this.scene.add(this.player.mesh);
    this.missions = new MissionController();
    this.radio = new Radio();
    this.hud = new Hud(document);
    this.WEAPONS = WEAPONS;

    this.cars = [];          // every car: traffic, parked, police, mission
    this.traffic = [];
    this.parked = [];
    this.policeUnits = [];
    this.missionCars = [];   // vans / limo / escort van of the current stage
    this.peds = [];
    this.enemies = [];
    this.heli = new Helicopter(makeHeliMesh(this.THREE));
    this.scene.add(this.heli.mesh);

    this.wanted = 0;
    this.inSight = false;
    this.cooldownLeft = 0;
    this.respect = 0;
    this.district = districtAt(0, 0);
    this.now = 0;
    this.elapsed = 0;
    this.started = false;
    this.paused = false;
    this.over = false;
    this.routeNodes = null;
    this.objectivePos = null;
    this.limoDeadline = 0;
    this.ramCooldown = 0;
    this.escortFailTimer = 0;
    this.saveTimer = 0;
    this.camYaw = 0;         // orbit offset around the player
    this.logLines = [];
    this.autotest = null;
    this.reachResult = null;
    this.deathTimer = 0;

    this.keys = {};
    this.setupInput();
    this.spawnWorld();
    this.loadSave();
    this.missions.startMission(0);
    this.enterStage();
    this.updateObjective();
  }

  // --- setup ---------------------------------------------------------------
  setupInput() {
    addEventListener('keydown', (e) => {
      this.keys[e.code] = true;
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
      if (e.code === 'Enter' && !this.started) this.startGame();
      if (e.code === 'KeyF') this.toggleCar();
      if (e.code === 'KeyR') { this.radio.nextStation(); }
      if (e.code === 'KeyP' || e.code === 'Escape') this.togglePause();
      if (e.code.startsWith('Digit')) {
        const n = parseInt(e.code.slice(5), 10) - 1;
        if (n >= 0 && n < WEAPONS.length && this.player.weaponsOwned[n]) this.player.weaponIdx = n;
      }
      this.radio.ensure();
    });
    addEventListener('keyup', (e) => { this.keys[e.code] = false; });
    let dragging = false, lastX = 0;
    addEventListener('pointerdown', (e) => { dragging = true; lastX = e.clientX; this.keys.Mouse0 = true; });
    addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.camYaw += (e.clientX - lastX) * 0.005;
      lastX = e.clientX;
    });
    addEventListener('pointerup', () => { dragging = false; this.keys.Mouse0 = false; });
    document.getElementById('start-btn').addEventListener('click', () => this.startGame());
    document.getElementById('resume-btn').addEventListener('click', () => this.togglePause());
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
  }

  startGame() {
    if (this.started) return;
    this.started = true;
    this.radio.ensure();
    document.getElementById('start-screen').style.display = 'none';
    this.hud.setVisible(true);
    this.log('Welcome to Coraluna. Mission 1: Homecoming.');
  }

  togglePause() {
    if (!this.started || this.over) return;
    this.paused = !this.paused;
    document.getElementById('pause-screen').style.display = this.paused ? 'flex' : 'none';
  }

  log(msg) {
    this.logLines.push(`[${this.elapsed.toFixed(1)}s] ${msg}`);
    console.log('[Coraluna]', msg);
  }

  px() { return this.player.inCar ? this.player.inCar.x : this.player.x; }
  pz() { return this.player.inCar ? this.player.inCar.z : this.player.z; }
  playerHeading() { return this.player.inCar ? this.player.inCar.heading : this.player.heading; }

  // --- world population -----------------------------------------------------
  spawnWorld() {
    const p = this.city.graph.nodes[LOCATIONS.spawn];
    // The player's own car, parked at spawn.
    const own = new Car({
      x: p.x + 6, z: p.z + 4, heading: 0,
      name: 'BRISA COUPE', colour: 0x3aa84c, maxSpeed: 34,
    });
    own.mesh = makeCarMesh(this.THREE, own.colour, false);
    own.owned = true; own.stealable = false; own.parked = true;
    this.scene.add(own.mesh);
    this.cars.push(own); this.parked.push(own);
    this.player.x = p.x; this.player.z = p.z;
    this.player.heading = 0;
    this.player.inCar = own; own.isPlayerCar = true; this.player.onFoot = false;
    // Parked stealable cars around the city.
    const spots = [[1, 1], [5, 1], [1, 3], [5, 5], [3, 1], [6, 4], [2, 6], [4, 2]];
    spots.forEach(([i, j], k) => {
      const n = this.city.graph.nodes[j * 7 + i];
      const car = new Car({
        x: n.x + 10, z: n.z + 9, heading: this.rng() * Math.PI * 2,
        name: CAR_NAMES[(k + 2) % CAR_NAMES.length],
        colour: carColourFor(k + 2), maxSpeed: 32 + this.rng() * 5,
      });
      car.mesh = makeCarMesh(this.THREE, car.colour, false);
      car.parked = true; car.stealable = true;
      this.scene.add(car.mesh);
      this.cars.push(car); this.parked.push(car);
    });
    // Traffic.
    for (let k = 0; k < 10; k++) {
      const car = makeTrafficCar(this.city, this.rng, k, this.THREE, makeCarMesh, carColourFor);
      this.scene.add(car.mesh);
      this.cars.push(car); this.traffic.push(car);
    }
    // Pedestrians.
    for (let k = 0; k < 22; k++) this.spawnPed();
  }

  spawnPed() {
    const nodes = this.city.graph.nodes;
    const n = Math.floor(this.rng() * nodes.length);
    const shirt = pick(this.rng, [0xd83a2e, 0x2e6fd8, 0xe8b64c, 0xeeeeee, 0x3aa84c, 0xd8704c]);
    const skin = pick(this.rng, [0xc98a4a, 0x8a5a3a, 0xe8b88a, 0x6a4a2a]);
    const mesh = makePedMesh(this.THREE, shirt, skin);
    this.scene.add(mesh);
    const ped = {
      x: nodes[n].x, z: nodes[n].z, node: n, next: n,
      speed: 1.2 + this.rng() * 0.6, mesh, phase: this.rng() * 6,
      down: false, downTimer: 0, respawnTimer: 0,
    };
    ped.next = this.city.graph.adj[n][Math.floor(this.rng() * this.city.graph.adj[n].length)];
    this.peds.push(ped);
    return ped;
  }

  // --- police / wanted ------------------------------------------------------
  setWanted(n) {
    n = clamp(n, 0, 5);
    if (n === this.wanted) return;
    this.wanted = n;
    this.cooldownLeft = 3 + n * 1.5;
    this.syncPolice();
    this.radio.setSiren(n);
    if (n > 0) this.log(`Wanted level ${n} star${n > 1 ? 's' : ''}.`);
  }

  syncPolice() {
    const want = this.wanted === 0 ? 0 : Math.min(2 + this.wanted, 6);
    while (this.policeUnits.length < want) this.spawnPoliceUnit();
    while (this.policeUnits.length > want) {
      const u = this.policeUnits.pop();
      this.removeCar(u.car);
    }
    this.heli.active = this.wanted >= 3;
  }

  spawnPoliceUnit() {
    const idx = this.policeUnits.length;
    // Spawn at a road node 60-110 m from the player, off the southern
    // market road used by mission 3 (lesson 14).
    let best = null, bestScore = -1;
    for (let tries = 0; tries < 12; tries++) {
      const n = Math.floor(this.rng() * this.city.graph.nodes.length);
      const p = this.city.graph.nodes[n];
      const d = dist(p.x, p.z, this.px(), this.pz());
      const onSouthRoad = p.z > 120 && Math.abs(p.x) < 130;
      const score = (d > 60 && d < 120 ? 2 : 0) + (onSouthRoad ? -1 : 0.5) + this.rng();
      if (score > bestScore) { bestScore = score; best = n; }
    }
    const p = this.city.graph.nodes[best];
    const car = new Car({
      x: p.x, z: p.z, heading: this.rng() * Math.PI * 2,
      name: 'CPD INTERCEPTOR', colour: 0x1a2a3a,
      isPolice: true, maxSpeed: 38, accel: 16,
    });
    car.mesh = makeCarMesh(this.THREE, car.colour, true);
    this.scene.add(car.mesh);
    this.cars.push(car);
    const role = POLICE_ROLES[idx % POLICE_ROLES.length];
    const unit = new PoliceUnit(car, POLICE_CALLSIGNS[idx % POLICE_CALLSIGNS.length], role);
    this.policeUnits.push(unit);
    return unit;
  }

  removeCar(car) {
    if (car.mesh) this.scene.remove(car.mesh);
    this.cars = this.cars.filter(c => c !== car);
    this.traffic = this.traffic.filter(c => c !== car);
    this.parked = this.parked.filter(c => c !== car);
    this.missionCars = this.missionCars.filter(c => c !== car);
  }

  // Line of sight from a police unit to the player (distance + buildings).
  unitSees(unit) {
    const d = unit.distanceTo(this.px(), this.pz());
    if (d > 110) return false;
    for (let t = 0.125; t < 1; t += 0.125) {
      const x = unit.car.x + (this.px() - unit.car.x) * t;
      const z = unit.car.z + (this.pz() - unit.car.z) * t;
      if (hitsBuilding(x, z, this.city)) return false;
    }
    return true;
  }

  updateWanted(dt) {
    if (this.wanted === 0) { this.inSight = false; this.losTimer = 0; return; }
    const groundSight = this.policeUnits.some(u => this.unitSees(u));
    // The helicopter loses the player if no ground unit has seen them for
    // 6 seconds: it breaks off to search elsewhere instead of hovering
    // forever, which is what makes a 4-star manhunt loseable.
    if (!groundSight) this.losTimer = (this.losTimer || 0) + dt;
    else this.losTimer = 0;
    if (this.losTimer > 6) {
      if (!this.heli.searching) {
        this.heli.searching = true;
        const n = this.city.graph.nodes[Math.floor(this.rng() * this.city.graph.nodes.length)];
        this.heli.searchX = n.x; this.heli.searchZ = n.z;
        this.log('The helicopter lost you — it is searching elsewhere.');
      }
    } else if (groundSight) {
      this.heli.searching = false;
    }
    const heliSight = this.heli.active && !this.heli.searching &&
      dist(this.heli.x, this.heli.z, this.px(), this.pz()) < 90;
    this.inSight = groundSight || heliSight;
    if (this.inSight) {
      this.cooldownLeft = 3 + this.wanted * 1.5;
    } else {
      this.cooldownLeft -= dt;
      if (this.cooldownLeft <= 0) {
        this.setWanted(this.wanted - 1);
        this.log(`Heat dropping: ${this.wanted} stars.`);
      }
    }
  }

  // --- missions --------------------------------------------------------------
  enterStage() {
    const s = this.missions.stage;
    if (!s) return;
    // Clear previous stage vehicles.
    for (const c of [...this.missionCars]) this.removeCar(c);
    this.missionCars = [];
    this.enemies = [];
    if (s.wanted !== undefined) this.setWanted(s.wanted);
    if (s.type === 'wreck') this.spawnVans();
    if (s.type === 'escort') this.spawnEscortVan();
    if (s.type === 'ram') this.spawnLimo();
    if (s.type === 'combat') this.startCombatStage();
    this.updateObjective();
  }

  spawnVans() {
    const loops = [
      [N_(1, 1), N_(5, 1), N_(5, 5), N_(1, 5)],
      [N_(6, 2), N_(6, 6), N_(2, 6), N_(2, 2)],
      [N_(0, 4), N_(3, 0), N_(6, 3), N_(3, 6)],
    ];
    loops.forEach((loop, k) => {
      const p = this.city.graph.nodes[loop[0]];
      const van = new Car({
        x: p.x, z: p.z, heading: 0,
        name: VAN_NAMES[k], colour: 0xe8e8e8,
        isTarget: true, cruise: 13 + k, maxSpeed: 24,
      });
      van.mesh = makeCarMesh(this.THREE, 0xe8e8e8, false);
      van.loop = loop; van.loopIdx = 1; van.goalNode = loop[1];
      this.scene.add(van.mesh);
      this.cars.push(van); this.missionCars.push(van);
    });
    function N_(i, j) { return j * 7 + i; }
    this.log('Three courier vans are on the streets. Wreck them all.');
  }

  spawnEscortVan() {
    const p = this.city.graph.nodes[LOCATIONS.garage];
    const van = new Car({
      x: p.x - 8, z: p.z, heading: Math.PI,
      name: 'NADIA\'S VAN', colour: 0x3aa84c,
      isTarget: true, cruise: 12, maxSpeed: 22,
    });
    van.mesh = makeCarMesh(this.THREE, 0x3aa84c, false);
    van.goalNode = LOCATIONS.harbour;
    this.scene.add(van.mesh);
    this.cars.push(van); this.missionCars.push(van);
    this.missions.escortVan = van;
    this.log('Nadia\'s van is rolling. Stay close to it.');
  }

  spawnLimo() {
    const p = this.city.graph.nodes[LOCATIONS.eastGate];
    const limo = new Car({
      x: p.x, z: p.z, heading: Math.PI,
      name: 'THE REGENT', colour: 0x14141a,
      isTarget: true, cruise: 15, maxSpeed: 30,
    });
    limo.mesh = makeCarMesh(this.THREE, 0x14141a, false);
    limo.goalNode = LOCATIONS.pierGate;
    this.scene.add(limo.mesh);
    this.cars.push(limo); this.missionCars.push(limo);
    this.limoDeadline = this.now + 150;
    this.log('The Regent is crossing town to the pier. Ram it 4 times!');
  }

  startCombatStage() {
    // Dario goes to the pier on foot for the finale.
    const pier = this.city.pier;
    if (this.player.inCar) this.player.exitCar();
    this.player.x = pier.x1 - 6;
    this.player.z = (pier.z0 + pier.z1) / 2;
    this.player.heading = -Math.PI / 2;
    this.player.weaponIdx = 1;
    this.player.weaponsOwned[2] = true;
    this.player.weaponsOwned[3] = true;
    this.setWanted(0);
    this.spawnWave(this.missions.stageIdx === 0 ? 3 : 1);
    this.log('Vidal\'s men are on the pier. Clear them out.');
  }

  spawnWave(n) {
    const pier = this.city.pier;
    for (let k = 0; k < n; k++) {
      const x = pier.endX + 20 + this.rng() * 55;
      const z = pier.z0 + 4 + this.rng() * (pier.z1 - pier.z0 - 8);
      const boss = n === 1 && this.missions.stageIdx === 1;
      const mesh = makePedMesh(this.THREE, boss ? 0x14141a : 0x8a1a1a, 0xc98a4a);
      this.scene.add(mesh);
      const enemy = {
        x, z, health: boss ? 220 : 60, mesh, shootTimer: 1 + this.rng(),
        meleeTimer: 0, speed: boss ? 3.4 : 2.6, boss,
      };
      enemy.damage = (amt) => { enemy.health -= amt; };
      this.enemies.push(enemy);
    }
  }

  updateObjective() {
    const pos = stageTargetPos(this);
    this.objectivePos = pos;
    if (pos && pos.node >= 0) {
      const myNode = nearestNode(this.city.graph, this.px(), this.pz());
      this.routeNodes = findPath(this.city.graph, myNode, pos.node);
    } else {
      this.routeNodes = null;
    }
    this.district = districtAt(this.px(), this.pz());
  }

  checkMission(dt) {
    const mc = this.missions;
    const s = mc.stage;
    if (!s || mc.done) return;
    const p = this.player;
    const px = this.px(), pz = this.pz();

    if (s.type === 'goto') {
      const t = this.city.graph.nodes[s.node];
      if (dist(px, pz, t.x, t.z) < 12) {
        this.log(`Reached: ${s.title}.`);
        this.radio.chime();
        this.advanceStage();
      }
    } else if (s.type === 'steal') {
      if (p.inCar && p.inCar.stolen) {
        this.setWanted(Math.max(this.wanted, 1));
        this.log('Car stolen. The CPD noticed.');
        this.advanceStage();
      }
    } else if (s.type === 'wreck') {
      for (const v of [...this.missionCars]) {
        if (v.wrecked && !v.counted) {
          v.counted = true;
          mc.progress++;
          this.log(`Van wrecked! (${mc.progress}/${s.count})`);
          this.radio.chime();
          if (mc.progress >= s.count) this.advanceStage();
        }
      }
    } else if (s.type === 'escort') {
      const van = mc.escortVan;
      if (van) {
        if (van.wrecked) {
          this.escortFailTimer += dt;
          if (this.escortFailTimer > 2) {
            this.log('The van was wrecked! Nadia sends another — escort restarts.');
            this.escortFailTimer = 0;
            this.enterStage();
          }
        } else {
          const t = this.city.graph.nodes[s.to];
          if (dist(van.x, van.z, t.x, t.z) < 12) {
            this.log('Van delivered to the harbour.');
            this.radio.chime();
            this.advanceStage();
          }
        }
      }
    } else if (s.type === 'ram') {
      const limo = this.missionCars[0];
      if (limo) {
        this.ramCooldown = Math.max(0, this.ramCooldown - dt);
        if (limo.rammedBy && limo.rammedBy.car === p.inCar && this.ramCooldown <= 0) {
          mc.progress++;
          this.ramCooldown = 1.5;
          this.log(`Limo hit! (${mc.progress}/${s.count})`);
          this.radio.chime();
          limo.rammedBy = null;
          if (mc.progress >= s.count) {
            limo.damage(999, p.inCar);
            this.advanceStage();
          }
        }
        const t = this.city.graph.nodes[LOCATIONS.pierGate];
        if (dist(limo.x, limo.z, t.x, t.z) < 14 && mc.progress < s.count) {
          this.log('The Regent reached the pier! The stage restarts.');
          this.enterStage();
        }
      }
    } else if (s.type === 'lose') {
      if (this.wanted === 0) {
        this.log('Manhunt lost. Now reach the boat.');
        this.advanceStage();
      }
    } else if (s.type === 'combat') {
      const alive = this.enemies.filter(e => e.health > 0);
      if (alive.length === 0 && this.enemies.length > 0) {
        mc.progress++;
        this.log(`Wave cleared (${mc.progress}/${s.waves}).`);
        this.radio.chime();
        for (const e of [...this.enemies]) this.scene.remove(e.mesh);
        this.enemies = [];
        if (mc.progress >= s.waves) {
          this.advanceStage();
        } else {
          this.spawnWave(2 + mc.progress);
        }
      }
    }
  }

  advanceStage() {
    const r = this.missions.advance(this.now, this);
    if (r === 'done') {
      this.over = true;
      this.log('STORY COMPLETE — Coraluna is yours, Dario.');
      this.saveGame();
    } else {
      this.enterStage();
      this.saveGame();
    }
  }

  // --- per-frame update ------------------------------------------------------
  toggleCar() {
    if (!this.started || this.paused || this.player.dead) return;
    if (this.player.inCar) {
      this.player.exitCar();
    } else {
      const car = this.player.tryEnterCar(this.cars.filter(c => c.stealable || c.owned));
      if (car) {
        if (car.stolen) this.setWanted(Math.max(this.wanted, 1));
        this.radio.setEngine(0, true);
      }
    }
  }

  update(dt) {
    this.now += dt;
    this.elapsed += dt;
    const p = this.player;
    p.update(dt);
    this.ramCooldown = Math.max(0, this.ramCooldown - dt);

    // --- player input / autotest driver ---
    if (this.autotest) {
      this.autotest.drive(dt);
    } else if (this.started && !this.paused && !p.dead) {
      const k = this.keys;
      if (p.inCar) {
        const car = p.inCar;
        const throttle = (k.KeyW || k.ArrowUp ? 1 : 0) + (k.KeyS || k.ArrowDown ? -0.9 : 0);
        const steer = (k.KeyA || k.ArrowLeft ? 1 : 0) - (k.KeyD || k.ArrowRight ? 1 : 0);
        const braking = k.Space ? -1 : throttle;
        car.step(dt, braking, steer, this.city, this.cars, this.now);
        if (Math.abs(car.speed) > 3) this.radio.setEngine(Math.abs(car.speed) * 3.6, true);
        if (car.wrecked) {
          this.log('Your car is wrecked. Continue on foot.');
          p.exitCar();
        }
      } else {
        const input = {
          forward: !!(k.KeyW || k.ArrowUp),
          back: !!(k.KeyS || k.ArrowDown),
          left: !!(k.KeyA || k.ArrowLeft),
          right: !!(k.KeyD || k.ArrowRight),
          sprint: !!k.ShiftLeft,
        };
        // A/D turn the player on foot.
        if (input.left) p.heading += 2.4 * dt;
        if (input.right) p.heading -= 2.4 * dt;
        p.stepOnFoot(dt, input, this.city);
        if ((k.KeyJ || k.Mouse0) && this.enemies.length) {
          const hit = p.attack(this.enemies, this.now);
          if (hit) this.radio.gunshot();
        }
      }
    }

    // --- cars ---
    for (const car of [...this.cars]) {
      if (car === p.inCar) continue;
      if (this.traffic.includes(car)) {
        updateTraffic(car, dt, this.city, this.cars, this.now);
      } else if (this.missionCars.includes(car)) {
        this.updateMissionCar(car, dt);
      } else if (car.parked) {
        // Parked cars sit still.
      }
      car.syncMesh();
    }
    if (p.inCar) p.inCar.syncMesh();

    // --- police ---
    for (const u of this.policeUnits) {
      const car = u.car;
      const d = u.distanceTo(this.px(), this.pz());
      // Units that fall far behind respawn closer — except during the
      // manhunt-lose stage, where falling behind is the whole point.
      const losing = this.missions.stage && this.missions.stage.type === 'lose';
      if (d > 320 && !losing) {
        const n = nearestNode(this.city.graph, this.px(), this.pz());
        const p2 = this.city.graph.nodes[n];
        car.x = p2.x + 110; car.z = p2.z + 110;
        car.speed = 0; car.path = null;
      }
      car.followTarget = this.player.inCar || null;
      if (this.player.inCar) {
        // 1 star: pursue without ramming (standoff); 2+: ram.
        const cruise = this.wanted >= 2 ? 34 : (d < 14 ? 6 : 26);
        car.autopilot(dt, { city: this.city, cars: this.cars, now: this.now, cruise, isChase: true });
      } else {
        // On foot: drive up and stop near the player.
        car.followTarget = null;
        car.goalNode = nearestNode(this.city.graph, this.px(), this.pz());
        car.autopilot(dt, { city: this.city, cars: this.cars, now: this.now, cruise: 20, isChase: false });
        if (d < 3 && Math.abs(car.speed) > 3) {
          p.damage(12 * dt * 3);
          this.log('A cruiser clipped you on foot!');
        }
      }
      car.syncMesh();
    }
    this.heli.update(dt, this.px(), this.pz(), this.now);
    this.updateWanted(dt);

    // --- pedestrians ---
    this.updatePeds(dt);

    // --- enemies ---
    this.updateEnemies(dt);

    // --- missions, objective, HUD ---
    this.checkMission(dt);
    if (Math.floor(this.elapsed * 2) !== Math.floor((this.elapsed - dt) * 2)) {
      this.updateObjective();
    }
    this.radio.update(this.now);
    if (p.inCar) this.radio.setEngine(Math.abs(p.inCar.speed) * 3.6, true);
    else this.radio.setEngine(0, false);

    // --- death / respawn ---
    if (p.dead) {
      this.deathTimer += dt;
      if (this.deathTimer > 2.5) {
        this.deathTimer = 0;
        p.dead = false;
        p.health = 100;
        p.money = Math.max(0, p.money - 200);
        this.setWanted(0);
        const h = this.city.graph.nodes[N_(3, 5)];
        p.x = h.x; p.z = h.z;
        if (p.inCar) { p.inCar.isPlayerCar = false; p.inCar = null; p.onFoot = true; }
        if (p.mesh) p.mesh.visible = true;
        this.missions.progress = 0;
        this.enterStage();
        this.log('WASTED — you wake up at the clinic, $200 lighter.');
      }
    }

    // --- save ---
    this.saveTimer += dt;
    if (this.saveTimer > 30) { this.saveTimer = 0; this.saveGame(); }

    // --- camera + render ---
    this.updateCamera(dt);
    this.hud.update(this, this.now);
  }

  updateMissionCar(car, dt) {
    const s = this.missions.stage;
    if (!s) return;
    if (car.wrecked) return;
    if (s.type === 'wreck') {
      // Courier vans loop their route and never brake for traffic (lesson 2).
      const goal = this.city.graph.nodes[car.goalNode];
      if (dist(car.x, car.z, goal.x, goal.z) < 10) {
        car.loopIdx = (car.loopIdx + 1) % car.loop.length;
        car.goalNode = car.loop[car.loopIdx];
        car.path = null;
      }
      car.autopilot(dt, { city: this.city, cars: this.cars, now: this.now, cruise: car.cruise, isChase: false });
    } else if (s.type === 'escort') {
      const goal = this.city.graph.nodes[car.goalNode];
      if (dist(car.x, car.z, goal.x, goal.z) > 10) {
        car.autopilot(dt, { city: this.city, cars: this.cars, now: this.now, cruise: car.cruise, isChase: false });
      }
    } else if (s.type === 'ram') {
      const goal = this.city.graph.nodes[car.goalNode];
      car.autopilot(dt, { city: this.city, cars: this.cars, now: this.now, cruise: car.cruise, isChase: false });
    }
  }

  updatePeds(dt) {
    for (const ped of this.peds) {
      if (ped.down) {
        ped.downTimer -= dt;
        if (ped.downTimer <= 0) {
          ped.respawnTimer -= dt;
          if (ped.respawnTimer <= 0) {
            this.scene.remove(ped.mesh);
            const i = this.peds.indexOf(ped);
            this.peds.splice(i, 1);
            this.spawnPed();
          }
        }
        continue;
      }
      const target = this.city.graph.nodes[ped.next];
      const d = dist(ped.x, ped.z, target.x, target.z);
      if (d < 3) {
        ped.node = ped.next;
        const opts = this.city.graph.adj[ped.node];
        ped.next = opts[Math.floor(this.rng() * opts.length)];
      } else {
        const ang = Math.atan2(target.x - ped.x, target.z - ped.z);
        ped.x += Math.sin(ang) * ped.speed * dt;
        ped.z += Math.cos(ang) * ped.speed * dt;
        ped.mesh.position.set(ped.x, 0, ped.z);
        ped.mesh.rotation.y = ang;
        ped.phase += dt * ped.speed * 4;
        const legs = ped.mesh.userData.legs || [];
        if (legs[0]) legs[0].rotation.x = Math.sin(ped.phase) * 0.5;
        if (legs[1]) legs[1].rotation.x = -Math.sin(ped.phase) * 0.5;
      }
      // Cars hitting pedestrians: they go down, heat rises.
      for (const car of this.cars) {
        if (car.wrecked || Math.abs(car.speed) < 3) continue;
        if (dist(car.x, car.z, ped.x, ped.z) < 2.4) {
          ped.down = true;
          ped.downTimer = 4;
          ped.respawnTimer = 10;
          ped.mesh.rotation.x = Math.PI / 2;
          ped.mesh.position.y = 0.4;
          if (car.isPlayerCar) {
            this.setWanted(Math.min(5, this.wanted + 1));
            this.log('You hit a pedestrian! The CPD is on you.');
          }
          break;
        }
      }
    }
  }

  updateEnemies(dt) {
    const p = this.player;
    for (const e of this.enemies) {
      if (e.health <= 0) continue;
      const d = dist(e.x, e.z, p.x, p.z);
      if (d > 2.2) {
        const ang = Math.atan2(p.x - e.x, p.z - e.z);
        e.x += Math.sin(ang) * e.speed * dt;
        e.z += Math.cos(ang) * e.speed * dt;
        e.mesh.position.set(e.x, 0, e.z);
        e.mesh.rotation.y = ang;
      }
      e.shootTimer -= dt;
      if (d < 26 && e.shootTimer <= 0) {
        e.shootTimer = e.boss ? 1.2 : 1.8;
        if (this.rng() < 0.35) {
          p.damage(e.boss ? 10 : 6);
          this.radio.gunshot();
        }
      }
      if (d < 2.2) {
        e.meleeTimer -= dt;
        if (e.meleeTimer <= 0) {
          e.meleeTimer = 1;
          p.damage(10);
        }
      }
      if (e.health <= 0) {
        e.mesh.rotation.x = Math.PI / 2;
        e.mesh.position.y = 0.4;
      }
    }
  }

  updateCamera(dt) {
    const p = this.player;
    const heading = this.playerHeading() + this.camYaw;
    const px = this.px(), pz = this.pz();
    const back = p.inCar ? 12 : 8;
    const height = p.inCar ? 4.6 : 3.4;
    const tx = px - Math.sin(heading) * back;
    const tz = pz - Math.cos(heading) * back;
    const k = Math.min(1, dt * 4);
    this.camera.position.x += (tx - this.camera.position.x) * k;
    this.camera.position.y += (height - this.camera.position.y) * k;
    this.camera.position.z += (tz - this.camera.position.z) * k;
    this.camera.lookAt(px + Math.sin(heading) * 6, 1.6, pz + Math.cos(heading) * 6);
  }

  // --- save / load ------------------------------------------------------------
  saveGame() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({
        money: Math.floor(this.player.money),
        respect: this.respect,
        missionIdx: this.missions.missionIdx,
        health: this.player.health,
      }));
    } catch (e) { /* storage may be unavailable */ }
  }

  loadSave() {
    if (IS_AUTOTEST || IS_SHOT || IS_REACH) return;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.money === 'number') this.player.money = s.money;
      if (typeof s.respect === 'number') this.respect = s.respect;
      if (typeof s.missionIdx === 'number' && s.missionIdx >= 0 && s.missionIdx < MISSIONS.length) {
        this.missions.missionIdx = s.missionIdx;
      }
      if (typeof s.health === 'number') this.player.health = s.health;
      this.log('Save loaded — welcome back to Coraluna.');
    } catch (e) { /* corrupt save: start fresh */ }
  }

  // --- main loop ----------------------------------------------------------------
  run() {
    let last = performance.now();
    let frame = 0;
    const tick = (t) => {
      const dt = Math.min(0.05, (t - last) / 1000);
      last = t;
      frame++;
      if (this.autotest) {
        // Accelerated simulation: several fixed steps per frame.
        const steps = 10;
        for (let i = 0; i < steps; i++) this.update(1 / 30);
        if (frame % 12 === 0) this.renderer.render(this.scene, this.camera);
        if (this.autotest.finished) {
          this.autotest.report();
          return; // stop the loop: no further frame is scheduled
        }
      } else if (!this.paused) {
        this.update(dt);
        this.renderer.render(this.scene, this.camera);
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }
}

function N_(i, j) { return j * 7 + i; }

// --- boot ----------------------------------------------------------------------
const game = new Game();
window.__game = game;
if (IS_REACH) {
  game.reachResult = runReachability(game);
  document.title = `REACH:${game.reachResult.nodesReachable}/${game.reachResult.nodesTotal}`;
  game.startGame();
  game.run();
} else if (IS_AUTOTEST) {
  game.startGame();
  game.autotest = runAutotest(game);
  game.run();
} else if (IS_SHOT) {
  stageShot(game, params.get('shot') || 'cover');
  game.startGame();
  game.update(0.05);
  game.renderer.render(game.scene, game.camera);
  document.title = 'SHOT-READY';
} else {
  game.run();
}
