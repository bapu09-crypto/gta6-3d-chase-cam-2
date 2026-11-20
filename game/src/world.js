// world.js — builds the Coraluna three.js scene from the city layout:
import { HALF, GRID, SPACING, ROAD_HALF } from './city.js';

const CAR_COLOURS = [0xd83a2e, 0x2e6fd8, 0xe8b64c, 0xeeeeee, 0x222226, 0x3aa84c, 0xd8704c, 0x8a5fd0];

function makeWindowAtlas(THREE) {
  const S = 128, cols = 4, rows = 6;
  const facade = document.createElement('canvas');
  facade.width = S; facade.height = S;
  const f = facade.getContext('2d');
  f.fillStyle = '#cfc8bc'; f.fillRect(0, 0, S, S);
  const glow = document.createElement('canvas');
  glow.width = S; glow.height = S;
  const g = glow.getContext('2d');
  g.fillStyle = '#000000'; g.fillRect(0, 0, S, S);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = 8 + c * 30, y = 8 + r * 20;
      const lit = (c * 3 + r * 5) % 4 === 0;
      f.fillStyle = lit ? '#ffd98a' : '#2a3242';
      f.fillRect(x, y, 18, 13);
      if (lit) { g.fillStyle = '#ffcf6a'; g.fillRect(x, y, 18, 13); }
    }
  }
  const map = new THREE.CanvasTexture(facade);
  const emissiveMap = new THREE.CanvasTexture(glow);
  map.wrapS = map.wrapT = THREE.RepeatWrapping;
  emissiveMap.wrapS = emissiveMap.wrapT = THREE.RepeatWrapping;
  return { map, emissiveMap };
}

function makePoolTexture(THREE) {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(S / 2, S / 2, 4, S / 2, S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255, 190, 90, 0.85)');
  grad.addColorStop(0.55, 'rgba(255, 170, 70, 0.30)');
  grad.addColorStop(1, 'rgba(255, 160, 60, 0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, S, S);
  return new THREE.CanvasTexture(cv);
}

export function buildWorld(city, THREE) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xff9a55, 260, 900);

  const skyGeo = new THREE.SphereGeometry(900, 24, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, fog: false, depthWrite: false,
    uniforms: {
      sunDir: { value: new THREE.Vector3(-0.82, 0.28, -0.46).normalize() },
      nightMix: { value: 0 },
    },
    vertexShader: 'varying vec3 vDir; void main() { vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: [
      'varying vec3 vDir; uniform vec3 sunDir; uniform float nightMix;',
      'void main() {',
      '  vec3 d = normalize(vDir);',
      '  vec3 horizon = vec3(1.0, 0.55, 0.22);',
      '  vec3 mid = vec3(0.98, 0.45, 0.28);',
      '  vec3 zenith = vec3(0.16, 0.28, 0.48);',
      '  vec3 col = mix(horizon, mid, clamp(d.y * 2.2, 0.0, 1.0));',
      '  col = mix(col, zenith, clamp(d.y * 1.6 - 0.15, 0.0, 1.0));',
      '  float glow = pow(max(dot(d, sunDir), 0.0), 18.0);',
      '  col += vec3(1.0, 0.75, 0.35) * glow * 0.9;',
      '  vec3 nightHorizon = vec3(0.10, 0.08, 0.22);',
      '  vec3 nightZenith = vec3(0.02, 0.03, 0.10);',
      '  vec3 night = mix(nightHorizon, nightZenith, clamp(d.y * 1.8, 0.0, 1.0));',
      '  night += vec3(0.9, 0.45, 0.15) * glow * 0.12;',
      '  col = mix(col, night, nightMix);',
      '  gl_FragColor = vec4(col, 1.0);',
      '}',
    ].join('\n'),
  });
  scene.add(new THREE.Mesh(skyGeo, skyMat));
  const clouds = [];
  const cloudMat = new THREE.MeshBasicMaterial({ color: 0xffd9b0, transparent: true, opacity: 0.55, fog: false });
  const cloudMat2 = new THREE.MeshBasicMaterial({ color: 0xffc090, transparent: true, opacity: 0.45, fog: false });
  for (let k = 0; k < 12; k++) {
    const g = new THREE.Group();
    const puffs = 2 + (k % 3);
    for (let j = 0; j < puffs; j++) {
      const puff = new THREE.Mesh(new THREE.SphereGeometry(16 + (k % 4) * 4, 10, 8), k % 2 ? cloudMat : cloudMat2);
      puff.scale.y = 0.32;
      puff.position.set(j * 18 - puffs * 9, (j % 2) * 3, (j % 3) * 8 - 8);
      g.add(puff);
    }
    g.position.set(-380 + k * 68, 130 + (k % 4) * 22, -320 + (k * 137) % 640);
    scene.add(g);
    clouds.push(g);
  }
  const sun = new THREE.DirectionalLight(0xffa04a, 3.4);
  sun.position.set(-320, 150, -180);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -280; sun.shadow.camera.right = 280;
  sun.shadow.camera.top = 280; sun.shadow.camera.bottom = -280;
  sun.shadow.camera.near = 10; sun.shadow.camera.far = 1000;
  sun.shadow.bias = -0.0004;
  scene.add(sun);
  scene.add(sun.target);
  const hemi = new THREE.HemisphereLight(0xffd9a0, 0x4a3a5a, 1.25);
  scene.add(hemi);
  const sunBall = new THREE.Mesh(
    new THREE.SphereGeometry(26, 16, 12),
    new THREE.MeshBasicMaterial({ color: 0xffe9a8, fog: false }));
  sunBall.position.set(-640, 120, -320);
  scene.add(sunBall);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshLambertMaterial({ color: 0xd9a86a }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -0.2, 0);
  ground.receiveShadow = true;
  scene.add(ground);

  const sea = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 1400),
    new THREE.MeshLambertMaterial({ color: 0x2f8fd0 }));
  sea.rotation.x = -Math.PI / 2;
  sea.position.set(-HALF - 200, -0.1, 0);
  scene.add(sea);
  const beach = new THREE.Mesh(
    new THREE.PlaneGeometry(46, 1400),
    new THREE.MeshLambertMaterial({ color: 0xf2dda8 }));
  beach.rotation.x = -Math.PI / 2;
  beach.position.set(-HALF - 23, 0.02, 0);
  scene.add(beach);

  const slab = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2 + 40, HALF * 2 + 40),
    new THREE.MeshLambertMaterial({ color: 0xa89478 }));
  slab.rotation.x = -Math.PI / 2;
  slab.position.set(0, 0, 0);
  slab.receiveShadow = true;
  scene.add(slab);

  const roadMat = new THREE.ShaderMaterial({
    uniforms: {},
    vertexShader: [
      'varying vec2 vUv;',
      'void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    ].join('\n'),
    fragmentShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vec3 base = vec3(0.055, 0.055, 0.075);',
      '  float across = 1.0 - abs(vUv.y - 0.5) * 2.0;',
      '  float lane = pow(max(across, 0.0), 5.0);',
      '  float shimmer = 0.45 + 0.55 * pow(0.5 + 0.5 * sin(vUv.x * 6.0 + vUv.y * 2.0), 2.0);',
      '  vec3 streak = vec3(1.0, 0.58, 0.22) * lane * shimmer * 0.7;',
      '  float puddle = pow(max(0.0, sin(vUv.x * 22.0) * sin(vUv.y * 15.0 + 1.3)), 6.0);',
      '  vec3 shine = vec3(1.0, 0.72, 0.42) * puddle * 0.35;',
      '  vec3 sheen = vec3(0.14, 0.09, 0.05) * (0.4 + 0.6 * across);',
      '  gl_FragColor = vec4(base + streak + shine + sheen, 1.0);',
      '}',
    ].join('\n'),
  });
  const dashMat = new THREE.MeshBasicMaterial({ color: 0xe8c84c });
  const edgeMat = new THREE.MeshBasicMaterial({ color: 0xd8d0b8 });
  for (const [a, b] of city.graph.edges) {
    const A = city.graph.nodes[a], B = city.graph.nodes[b];
    const len = Math.hypot(B.x - A.x, B.z - A.z);
    const ang = -Math.atan2(B.z - A.z, B.x - A.x);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(len, ROAD_HALF * 2), roadMat);
    strip.rotation.x = -Math.PI / 2;
    strip.rotation.z = ang;
    strip.position.set((A.x + B.x) / 2, 0.06, (A.z + B.z) / 2);
    scene.add(strip);
    for (const off of [-ROAD_HALF + 0.7, ROAD_HALF - 0.7]) {
      const edge = new THREE.Mesh(new THREE.PlaneGeometry(len, 0.35), edgeMat);
      edge.rotation.x = -Math.PI / 2;
      edge.rotation.z = ang;
      const nx = -Math.sin(ang), nz = Math.cos(ang);
      edge.position.set((A.x + B.x) / 2 + nx * off, 0.075, (A.z + B.z) / 2 + nz * off);
      scene.add(edge);
    }
    const ndash = Math.floor(len / 12);
    for (let k = 0; k < ndash; k++) {
      const t = (k + 0.5) / ndash;
      const dash = new THREE.Mesh(new THREE.PlaneGeometry(5, 0.5), dashMat);
      dash.rotation.x = -Math.PI / 2;
      dash.rotation.z = ang;
      dash.position.set(A.x + (B.x - A.x) * t, 0.08, A.z + (B.z - A.z) * t);
      scene.add(dash);
    }
  }
  const padGeo = new THREE.PlaneGeometry(ROAD_HALF * 2 + 2, ROAD_HALF * 2 + 2);
  const padMat = roadMat;
  for (const n of city.graph.nodes) {
    const pad = new THREE.Mesh(padGeo, padMat);
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(n.x, 0.07, n.z);
    scene.add(pad);
  }

  const atlas = makeWindowAtlas(THREE);
  const winMat = new THREE.MeshBasicMaterial({ color: 0xffd98a });
  for (const b of city.buildings) {
    const w = b.x1 - b.x0, d = b.z1 - b.z0;
    const col = new THREE.Color().setHSL(b.hue, 0.55, 0.66);
    const map = atlas.map.clone();
    map.needsUpdate = true;
    map.repeat.set(Math.max(1, Math.round(w / 11)), Math.max(1, Math.round(b.h / 11)));
    const glow = atlas.emissiveMap.clone();
    glow.needsUpdate = true;
    glow.repeat.copy(map.repeat);
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(w, b.h, d),
      new THREE.MeshLambertMaterial({
        color: col, map, emissive: 0xffb050, emissiveMap: glow, emissiveIntensity: 0.7,
      }));
    mesh.position.set((b.x0 + b.x1) / 2, b.h / 2, (b.z0 + b.z1) / 2);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    scene.add(mesh);
    const roof = new THREE.Mesh(
      new THREE.BoxGeometry(w + 0.6, 0.5, d + 0.6),
      new THREE.MeshLambertMaterial({ color: 0x5a4a3c }));
    roof.position.set(mesh.position.x, b.h + 0.25, mesh.position.z);
    scene.add(roof);
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

  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2a2a2e });
  const glowMat = new THREE.MeshBasicMaterial({ color: 0xffe2a0 });
  const poolTex = makePoolTexture(THREE);
  const poolGeo = new THREE.PlaneGeometry(15, 15);
  for (const l of city.lamps) {
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 6, 5), poleMat);
    pole.position.set(l.x, 3, l.z);
    scene.add(pole);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.5, 8, 6), glowMat);
    bulb.position.set(l.x, 6.2, l.z);
    scene.add(bulb);
    const pool = new THREE.Mesh(poolGeo, new THREE.MeshBasicMaterial({
      map: poolTex, transparent: true, opacity: 0.6, depthWrite: false,
      blending: THREE.AdditiveBlending,
    }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(l.x, 0.1, l.z);
    scene.add(pool);
  }

  const particleCount = 260;
  const pPos = new Float32Array(particleCount * 3);
  for (let k = 0; k < particleCount; k++) {
    pPos[k * 3] = -280 + ((k * 37) % 560);
    pPos[k * 3 + 1] = 0.5 + ((k * 13) % 80) / 10;
    pPos[k * 3 + 2] = -280 + ((k * 53) % 560);
  }
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({
    color: 0xffcf90, size: 0.9, transparent: true, opacity: 0.55, depthWrite: false,
  }));
  scene.add(particles);

  const deckMat = new THREE.MeshLambertMaterial({ color: 0xa8824f });
  const deck = new THREE.Mesh(
    new THREE.BoxGeometry(96, 1.2, 24),
    deckMat);
  deck.position.set(-HALF - 48, -0.6, -22);
  scene.add(deck);
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

  return { scene, sun, hemi, sunBall, skyMat, palm, clouds, particles };
}

export function makeCarMesh(THREE, colour, isPolice) {
  const g = new THREE.Group();
  const bodyMat = isPolice
    ? new THREE.MeshLambertMaterial({ color: 0x1a2a3a })
    : new THREE.MeshPhysicalMaterial({
      color: colour, metalness: 0.25, roughness: 0.3,
      clearcoat: 1.0, clearcoatRoughness: 0.1, envMapIntensity: 1.2,
    });
  const body = new THREE.Mesh(new THREE.BoxGeometry(2.05, 0.55, 4.5), bodyMat);
  body.position.y = 0.55;
  g.add(body);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.32, 1.1), bodyMat);
  nose.position.set(0, 0.78, 1.95);
  nose.rotation.x = 0.28;
  g.add(nose);
  const tailDeck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.28, 0.9), bodyMat);
  tailDeck.position.set(0, 0.82, -1.95);
  tailDeck.rotation.x = -0.18;
  g.add(tailDeck);
  if (!isPolice) {
    const sheen = new THREE.Mesh(
      new THREE.BoxGeometry(1.7, 0.08, 3.6),
      new THREE.MeshPhysicalMaterial({
        color: 0xffffff, metalness: 0.9, roughness: 0.08,
        clearcoat: 1.0, clearcoatRoughness: 0.05, transparent: true, opacity: 0.28,
      }));
    sheen.position.y = 1.04;
    g.add(sheen);
    const trim = new THREE.Mesh(new THREE.BoxGeometry(2.14, 0.1, 4.42),
      new THREE.MeshStandardMaterial({ color: 0xd8d8e0, metalness: 1.0, roughness: 0.15 }));
    trim.position.y = 0.42;
    g.add(trim);
  }
  const cabin = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.55, 1.9),
    new THREE.MeshPhysicalMaterial({ color: 0x5a7a9a, metalness: 0.25, roughness: 0.08, clearcoat: 1.0 }));
  cabin.position.set(0, 1.12, -0.3);
  g.add(cabin);
  const windscreen = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.06, 0.9),
    new THREE.MeshPhysicalMaterial({ color: 0x2a3a4a, metalness: 0.4, roughness: 0.05, clearcoat: 1.0 }));
  windscreen.position.set(0, 1.22, 0.72);
  windscreen.rotation.x = 0.5;
  g.add(windscreen);
  const rearGlass = new THREE.Mesh(
    new THREE.BoxGeometry(1.6, 0.06, 0.7),
    new THREE.MeshPhysicalMaterial({ color: 0x2a3a4a, metalness: 0.4, roughness: 0.05, clearcoat: 1.0 }));
  rearGlass.position.set(0, 1.22, -1.28);
  rearGlass.rotation.x = -0.45;
  g.add(rearGlass);
  if (!isPolice) {
    const wing = new THREE.Mesh(new THREE.BoxGeometry(1.85, 0.07, 0.45), bodyMat);
    wing.position.set(0, 1.18, -2.15);
    g.add(wing);
    for (const sx of [-0.6, 0.6]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.3, 0.08),
        new THREE.MeshLambertMaterial({ color: 0x141414 }));
      strut.position.set(sx, 1.0, -2.15);
      g.add(strut);
    }
  }
  const grille = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.22, 0.08),
    new THREE.MeshLambertMaterial({ color: 0x14141a }));
  grille.position.set(0, 0.55, 2.27);
  g.add(grille);
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
  const hubMat = new THREE.MeshLambertMaterial({ color: 0xc8c8d0 });
  const wheels = [];
  for (const [wx, wz] of [[-1.0, 1.45], [1.0, 1.45], [-1.0, -1.45], [1.0, -1.45]]) {
    const w = new THREE.Mesh(wheelGeo, wheelMat);
    w.rotation.z = Math.PI / 2;
    w.position.set(wx, 0.42, wz);
    g.add(w);
    wheels.push(w);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.38, 8), hubMat);
    hub.rotation.z = Math.PI / 2;
    hub.position.set(wx, 0.42, wz);
    g.add(hub);
  }
  const lightMat = new THREE.MeshBasicMaterial({ color: 0xfff2b0 });
  for (const lx of [-0.7, 0.7]) {
    const l = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.25, 0.1), lightMat);
    l.position.set(lx, 0.7, 2.22);
    g.add(l);
    const ind = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, 0.1),
      new THREE.MeshBasicMaterial({ color: 0xff9a2a }));
    ind.position.set(lx + (lx < 0 ? -0.32 : 0.32), 0.7, 2.22);
    g.add(ind);
  }
  const tailLight = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.32, 0.12),
    new THREE.MeshBasicMaterial({ color: 0xff2a1a }));
  tailLight.position.set(0, 0.78, -2.27);
  g.add(tailLight);
  g.userData.wheels = wheels;
  g.traverse((o) => { if (o.isMesh) o.castShadow = true; });
  return g;
}

export function carColourFor(i) { return CAR_COLOURS[i % CAR_COLOURS.length]; }

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

export function makeHeliMesh(THREE) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.BoxGeometry(2.2, 1.6, 4.6),
    new THREE.MeshLambertMaterial({ color: 0x2e4a66 }));
  g.add(body);
  const tail = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.7, 4.5),
    new THREE.MeshLambertMaterial({ color: 0x2e4a66 }));
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
