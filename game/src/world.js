// world.js — builds the Coraluna three.js scene from the city layout:
// golden-hour sun, sea and beach to the west, roads, buildings, palms, lamps,
// the pier, billboards and props. Also factories for cars, pedestrians and the
// police helicopter. All art is procedural boxes/cylinders; no textures.
import { HALF, GRID, SPACING, ROAD_HALF } from './city.js';

const CAR_COLOURS = [0xd83a2e, 0x2e6fd8, 0xe8b64c, 0xeeeeee, 0x222226, 0x3aa84c, 0xd8704c, 0x8a5fd0];

export function buildWorld(city, THREE) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xf2a35e, 260, 900);

  // Golden-hour sky: big gradient dome + low sun.
  const skyGeo = new THREE.SphereGeometry(900, 24, 16);
  const skyMat = new THREE.MeshBasicMaterial({
    color: 0xffb36b, side: THREE.BackSide, fog: false,
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  const sun = new THREE.DirectionalLight(0xffc27a, 3.0);
  sun.position.set(-320, 150, -180);
  scene.add(sun);
  const hemi = new THREE.HemisphereLight(0xffd9a0, 0x3a4a6a, 1.15);
  scene.add(hemi);
  const sunBall = new THREE.Mesh(
    new THREE.SphereGeometry(26, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
  sunBall.position.set(-640, 120, -320);
  scene.add(sunBall);

  // Ground: bright warm sand base under the whole map.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshLambertMaterial({ color: 0xd9b57f }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.2, 0);
  scene.add(ground);

  // Sea: bright blue plane west of the city. It sits just below the pier
  // deck (top y=0) so the deck stands clear of the water.
  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 1400),
    new THREE.MeshLambertMaterial({ color: 0x2f8fd0 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-HALF - 200, -0.1, 0);
  scene.add(sea);
  // Beach strip.
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 1400),
    new THREE.MeshLambertMaterial({ color: 0xf2dda8 }));
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(-HALF - 23, 0.02, 0);
  scene.add(beach);

  // City baseplate: light warm slab.
  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 40, HALF * 2 + 40),
    new THREE.MeshLambertMaterial({ color: 0xa89478 }));
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(0, 0, 0);
  scene.add(slab);

  // Roads: light asphalt strips along every graph edge, with pale centre dashes.
  const roadMat = new THREE.MeshLambertMaterial({ color: 0x5f5f68 });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xd8d0b8 });
  for (const [a, b] of city.graph.edges) {
    const A = city.graph.nodes[a], B = city.graph.nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, ROAD_HALF * 2), roadMat);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = -Math.atan2(B.z - A.z, B.x - A.x);
    strip.position.set((A.x + B.x) / 2, 0.06, (A.z + B.z) / 2);
    scene.add(strip);
    const ndash = Math.floor(len / 12);
    for (let k = 0; k < ndash; k++) {
      const t = (k + 0.5) / ndash;
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.5), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = -Math.atan2(B.z - A.z, B.x - A.x);
      dash.position.set(A.x + (B.x - A.x) * t, 0.08, A.z + (B.z - A.z) * t);
      scene.add(dash);
    }
  }
  // Intersection pads.
  const padGeo = new THREE.PlaneGeometry(ROAD_HALF * 2 + 2, ROAD_HALF * 2 + 2);
  for (const n of city.graph.nodes) {
    const pad = new THREE.Mesh(padGeo, roadMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(n.x, 0.07, n.z);
    scene.add(pad);
  }

  // Buildings: boxes with a lighter roof cap and emissive windows at dusk.
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  for (const b of city.buildings) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const col = new THREE.Color().setHSL(b.hue, 0.52, 0.68);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, b.h, d),
      new THREE.MeshLambertMaterial({ color: col }));
    mesh.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2);
    scene.add(mesh);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6),
      new THREE.MeshLambertMaterial({ color: 0x5a4a3c }));
    roof.position.set(mesh.position.x, b.h + 0.25, mesh.position.z);
    scene.add(roof);
    // A few lit windows on the street-facing side.
    const rows = Math.min(4, Math.floor(b.h / 6));
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < Math.min(3, Math.floor(w / 6)); c++) {
        if ((r * 7 + c * 3 + Math.floor(b.x0)) % 3 !== 0) continue;
        const win = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.8), winMat);
        win.position.set(
          b.x0 + 3 + c * 6,
          3 + r * 5,
          b.z1 + 0.06);
        scene.add(win);
      }
    }
  }

  // Palm trees: trunk + 6 fronds.
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x7a5a38 });
  const frondMat = new THREE.MeshLambertMaterial({ color: 0x3f8f3a });
  function palm(x, z, s) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.35 * s, 0.55 * s, 7 * s, 6), trunkMat);
    trunk.position.y = 3.5 * s;
    g.add(trunk);
    for (let k = 0; k < 6; k++) {
      const fr = new THREE.Mesh(new THREE.ConeGeometry(0.9 * s, 4.5 * s, 4), frondMat);
      const a = (k / 6) * Math.PI * 2;
      fr.position.set(Math.cos(a) * 1.6 * s, 7.2 * s, Math.sin(a) * 1.6 * s);
      fr.rotation.z = Math.cos(a) * 1.1;
      fr.rotation.x = -Math.sin(a) * 1.1;
      g.add(fr);
    }
    g.position.set(x, 0, z);
    return g;
  }
  for (const p of city.palms) scene.add(palm(p.x, p.z, 1));
  for (const t of city.plazaTrees) scene.add(palm(t.x, t.z, 1.2));

  // Street lamps with warm glow spheres.
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0 });
  for (const l of city.lamps) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 5), poleMat);
    pole.position.set(l.x, 3, l.z);
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), glowMat);
    bulb.position.set(l.x, 6.2, l.z);
    scene.add(bulb);
  }

  // The pier: light wooden deck + posts + a small lighthouse beacon at the end.
  // The deck top sits at y=0 so cars and people staged on it stand on the
  // boards instead of sinking into the box.
  const deckMat = new THREE.MeshLambertMaterial({ color: 0xa8824f });
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(96, 1.2, 24),
    deckMat);
  deck.position.set(-HALF - 48, -0.6, -22);
  scene.add(deck);
  // Crates and barrels stacked along the pier so the deck reads as a working
  // harbour, not a flat brown plank.
  const crateMat = new THREE.MeshLambertMaterial({ color: 0xb08a4a });
  const barrelMat = new THREE.MeshLambertMaterial({ color: 0x3a6a8a });
  const crateSpots = [
    [-HALF - 14, -30, 2.2], [-HALF - 16, -30, 1.6], [-HALF - 15, -14, 1.8],
    [-HALF - 58, -30, 2.4], [-HALF - 60, -14, 1.6], [-HALF - 82, -30, 2.0],
  ];
  for (const [cx, cz, s] of crateSpots) {
    const crate = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), crateMat);
    crate.position.set(cx, s / 2, cz);
    scene.add(crate);
  }
  for (const [bx, bz] of [[-HALF - 30, -14], [-HALF - 72, -14], [-HALF - 44, -30]]) {
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2.2, 8), barrelMat);
    barrel.position.set(bx, 1.1, bz);
    scene.add(barrel);
  }
  for (let k = 0; k < 8; k++) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 6), poleMat);
    post.position.set(-HALF - 8 - k * 12, 0.4, -34);
    scene.add(post);
    const post2 = post.clone();
    post2.position.z = -10;
    scene.add(post2);
  }
  const beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(1.2, 1.8, 9, 8),
    new THREE.MeshLambertMaterial({ color: 0xe8e8e8 }));
  beacon.position.set(city.pier.endX, 4.5, city.pier.endZ);
  scene.add(beacon);
  const beaconLight = new THREE.Mesh(
    new THREE.SphereGeometry(1.4, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff5040 }));
  beaconLight.position.set(city.pier.endX, 9.4, city.pier.endZ);
  scene.add(beaconLight);

  // Billboards along the beach boulevard.
  const boardTexts = ['CORALUNA', 'PLAYA SERENA', 'SOL 98.1', 'PUERTO AZUL'];
  boardTexts.forEach((label, i) => {
    const g = new THREE.Group();
    const board = new THREE.Mesh(
      new THREE.BoxGeometry(14, 5, 0.6),
      new THREE.MeshLambertMaterial({ color: [0xd83a2e, 0x2e6fd8, 0xe8b64c, 0x3aa84c][i] }));
    board.position.y = 9;
    g.add(board);
    const leg1 = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 7, 5), poleMat);
    leg1.position.set(-5, 3.5, 0);
    g.add(leg1);
    const leg2 = leg1.clone(); leg2.position.x = 5; g.add(leg2);
    g.position.set(-HALF + 4, 0, -160 + i * 100);
    g.userData.label = label;
    scene.add(g);
  });

  return { scene, sun, palm };
}

// Car mesh factory: body + cabin + 4 wheels + headlights. Returns a Group
// whose .userData holds the wheel meshes for spin animation.
export function makeCarMesh(THREE, colour, isPolice) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: isPolice ? 0x1a2a3a : colour });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.75, 4.4), bodyMat);
  body.position.y = 0.65;
  g.add(body);
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.7, 2.2),
    new THREE.MeshLambertMaterial({ color: 0x1c2733 }));
  cabin.position.set(0, 1.35, -0.2);
  g.add(cabin);
  if (isPolice) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.25, 0.5),
      new THREE.MeshBasicMaterial({ color: 0x3040ff }));
    bar.position.set(0, 1.8, -0.2);
    g.add(bar);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.12, 0.2, 4.42),
      new THREE.MeshBasicMaterial({ color: 0xeeeeee }));
    stripe.position.y = 0.95;
    g.add(stripe);
  }
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.35, 10);
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x141414 });
  const wheels = [];
  for (const [wx, wz] of [[-1.0, 1.45], [1.0, 1.45], [-1.0, -1.45], [1.0, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.42, wz);
    g.add(w);
    wheels.push(w);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const lx of [-0.7, 0.7]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.1), lightMat);
    l.position.set(lx, 0.7, 2.22);
    g.add(l);
  }
  g.userData.wheels = wheels;
  return g;
}

export function carColourFor(i) { return CAR_COLOURS[i % CAR_COLOURS.length]; }

// Flame for a burning wreck: an outer orange cone and an inner yellow one,
// both unlit so they read at dusk. The caller adds a warm point light.
export function makeFlameMesh(THREE) {
  const g = new THREE.Group();
  const outer = new THREE.Mesh(
    new THREE.ConeGeometry(1.6, 4.2, 8),
    new THREE.MeshBasicMaterial({ color: 0xff6a1a, transparent: true, opacity: 0.9 }));
  outer.position.y = 2.6;
  g.add(outer);
  const inner = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 3.0, 8),
    new THREE.MeshBasicMaterial({ color: 0xffd23a, transparent: true, opacity: 0.95 }));
  inner.position.y = 2.2;
  g.add(inner);
  return g;
}

// Pedestrian mesh: capsule-ish body, head, legs that swing while walking.
export function makePedMesh(THREE, shirt, skin) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.7, 1.0, 0.4),
    new THREE.MeshLambertMaterial({ color: shirt }));
  body.position.y = 1.15;
  g.add(body);
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.32, 10, 8),
    new THREE.MeshLambertMaterial({ color: skin }));
  head.position.y = 1.95;
  g.add(head);
  const legGeo = new THREE.BoxGeometry(0.26, 0.7, 0.26);
  const legMat = new THREE.MeshLambertMaterial({ color: 0x2a2a33 });
  const legL = new THREE.Mesh(legGeo, legMat);
  legL.position.set(-0.18, 0.35, 0);
  const legR = new THREE.Mesh(legGeo, legMat);
  legR.position.set(0.18, 0.35, 0);
  g.add(legL); g.add(legR);
  g.userData.legs = [legL, legR];
  return g;
}

// Police helicopter: body, tail, main + tail rotors, spotlight cone.
export function makeHeliMesh(THREE) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.6, 4.6),
    new THREE.MeshLambertMaterial({ color: 0x1a2a3a }));
  g.add(body);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.5),
    new THREE.MeshLambertMaterial({ color: 0x1a2a3a }));
  tail.position.set(0, 0.3, -4.2);
  g.add(tail);
  const rotorMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
  const rotor = new THREE.Mesh(new THREE.BoxGeometry(9, 0.12, 0.5), rotorMat);
  rotor.position.y = 1.1;
  g.add(rotor);
  const tailRotor = new THREE.Mesh(new THREE.BoxGeometry(0.12, 2.2, 0.4), rotorMat);
  tailRotor.position.set(0.5, 0.4, -6.2);
  g.add(tailRotor);
  const spot = new THREE.Mesh(
    new THREE.ConeGeometry(6, 26, 12, 1, true),
    new THREE.MeshBasicMaterial({ color: 0xfff6c0, transparent: true, opacity: 0.22, side: THREE.DoubleSide }));
  spot.rotation.x = Math.PI;
  spot.position.y = -14;
  g.add(spot);
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xffffff }));
  lamp.position.set(0, -0.9, 1.5);
  g.add(lamp);
  g.userData.rotor = rotor;
  g.userData.tailRotor = tailRotor;
  g.userData.spot = spot;
  return g;
}
