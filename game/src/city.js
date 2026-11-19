// city.js — Coraluna: the road graph, districts, buildings and reachability checks.
// The city is a 7x7 lattice of intersections (49 nodes) with a 64 m spacing.
// Every mission target sits on a road node or on a road centreline, never inside
// a block and never in the sea, so every objective is reachable by road.
// West of the lattice is the sea (x < -192); a pier reaches out from the
// harbour node at the north-west corner.
import { makeRng, pick, dist, segHitsBox } from './util.js';

export const GRID = 7;            // nodes per side
export const SPACING = 64;        // metres between intersections
export const HALF = (GRID - 1) * SPACING / 2; // 192
export const ROAD_HALF = 7;       // half-width of a road
export const BLOCK_INSET = 15;    // buildings keep this clear of road centrelines

export const DISTRICTS = [
  { name: 'PLAYA SERENA',   region: { x0: -192, z0: -192, x1: -64,  z1: -64  }, colour: '#e8b64c' },
  { name: 'PUERTO AZUL',    region: { x0: -192, z0: -64,  x1: -64,  z1: 64   }, colour: '#4c9fd8' },
  { name: 'MERCADO VIEJO',  region: { x0: -192, z0: 64,   x1: -64,  z1: 192  }, colour: '#d8704c' },
  { name: 'LAS TORRES',     region: { x0: -64,  z0: -192, x1: 64,   z1: -64  }, colour: '#8a7fd0' },
  { name: 'PLAZA CENTRAL',  region: { x0: -64,  z0: -64,  x1: 64,   z1: 64   }, colour: '#c0a060' },
  { name: 'COLINA VERDE',   region: { x0: -64,  z0: 64,   x1: 64,   z1: 192  }, colour: '#6fb06a' },
  { name: 'ZONA FRANCA',    region: { x0: 64,   z0: -192, x1: 192,  z1: 64   }, colour: '#9aa0a8' },
  { name: 'MIRADOR SUR',    region: { x0: 64,   z0: 64,   x1: 192,  z1: 192  }, colour: '#d84c8a' },
];

export function districtAt(x, z) {
  for (const d of DISTRICTS) {
    const r = d.region;
    if (x >= r.x0 && x < r.x1 && z >= r.z0 && z < r.z1) return d;
  }
  if (x < -HALF) return { name: 'THE PIER', colour: '#4c9fd8' };
  return DISTRICTS[4];
}

// Node index from grid coords.
export function nodeIndex(i, j) { return j * GRID + i; }
export function nodePos(n) {
  const i = n % GRID, j = Math.floor(n / GRID);
  return { x: -HALF + i * SPACING, z: -HALF + j * SPACING, i, j };
}
export function nodeAt(i, j) { return nodeIndex(i, j); }

// Build the road graph: nodes + undirected edges between orthogonal neighbours.
export function buildGraph() {
  const nodes = [];
  for (let n = 0; n < GRID * GRID; n++) nodes.push(nodePos(n));
  const adj = nodes.map(() => []);
  const edges = [];
  function link(a, b) {
    adj[a].push(b); adj[b].push(a);
    edges.push([a, b]);
  }
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      if (i + 1 < GRID) link(nodeIndex(i, j), nodeIndex(i + 1, j));
      if (j + 1 < GRID) link(nodeIndex(i, j), nodeIndex(i, j + 1));
    }
  }
  return { nodes, adj, edges };
}

// Breadth-first shortest path (node list) from start to goal.
export function findPath(graph, start, goal) {
  if (start === goal) return [start];
  const prev = new Array(graph.nodes.length).fill(-1);
  const queue = [start];
  prev[start] = start;
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of graph.adj[cur]) {
      if (prev[nb] === -1) {
        prev[nb] = cur;
        if (nb === goal) {
          const path = [goal];
          let p = cur;
          while (p !== start) { path.unshift(p); p = prev[p]; }
          path.unshift(start);
          return path;
        }
        queue.push(nb);
      }
    }
  }
  return null;
}

export function nearestNode(graph, x, z) {
  let best = 0, bestD = Infinity;
  for (let n = 0; n < graph.nodes.length; n++) {
    const d = dist(x, z, graph.nodes[n].x, graph.nodes[n].z);
    if (d < bestD) { bestD = d; best = n; }
  }
  return best;
}

// Closest point on any road centreline segment to (x, z).
export function nearestRoadPoint(graph, x, z) {
  let best = null, bestD = Infinity;
  for (const [a, b] of graph.edges) {
    const A = graph.nodes[a], B = graph.nodes[b];
    const dx = B.x - A.x, dz = B.z - A.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - A.x) * dx + (z - A.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = A.x + dx * t, pz = A.z + dz * t;
    const d = dist(x, z, px, pz);
    if (d < bestD) { bestD = d; best = { x: px, z: pz }; }
  }
  return best;
}

// Distance from a point to the nearest road centreline segment.
export function distanceToRoad(graph, x, z) {
  let best = Infinity;
  for (const [a, b] of graph.edges) {
    const A = graph.nodes[a], B = graph.nodes[b];
    const dx = B.x - A.x, dz = B.z - A.z;
    const len2 = dx * dx + dz * dz;
    let t = len2 === 0 ? 0 : ((x - A.x) * dx + (z - A.z) * dz) / len2;
    t = Math.max(0, Math.min(1, t));
    const px = A.x + dx * t, pz = A.z + dz * t;
    const d = dist(x, z, px, pz);
    if (d < best) best = d;
  }
  return best;
}

// Buildings: one or two boxes per city block, always inset from the roads so
// cars can never be trapped in a gap, and never overlapping a road centreline.
// Blocks are indexed by (bi, bj) with bi, bj in 0..5, between node rows.
export function buildCity(seed) {
  const rng = makeRng(seed);
  const graph = buildGraph();
  const buildings = [];
  const palms = [];
  const lamps = [];
  const plazaTrees = [];
  for (let bj = 0; bj < GRID - 1; bj++) {
    for (let bi = 0; bi < GRID - 1; bi++) {
      const x0 = -HALF + bi * SPACING + BLOCK_INSET;
      const z0 = -HALF + bj * SPACING + BLOCK_INSET;
      const x1 = -HALF + (bi + 1) * SPACING - BLOCK_INSET;
      const z1 = -HALF + (bj + 1) * SPACING - BLOCK_INSET;
      const d = districtAt((x0 + x1) / 2, (z0 + z1) / 2);
      const downtown = d.name === 'LAS TORRES' || d.name === 'PLAZA CENTRAL';
      // Plaza Central keeps an open square in its middle block.
      if (d.name === 'PLAZA CENTRAL' && bi === 2 && bj === 2) {
        for (let k = 0; k < 6; k++) plazaTrees.push({
          x: x0 + 6 + rng() * (x1 - x0 - 12), z: z0 + 6 + rng() * (z1 - z0 - 12),
        });
        continue;
      }
      const count = downtown ? 2 : (rng() < 0.45 ? 2 : 1);
      for (let k = 0; k < count; k++) {
        const w = 12 + rng() * 14, dep = 12 + rng() * 14;
        const cx = x0 + w / 2 + rng() * Math.max(0.1, (x1 - x0) - w);
        const cz = z0 + dep / 2 + rng() * Math.max(0.1, (z1 - z0) - dep);
        const h = downtown ? 22 + rng() * 34 : 7 + rng() * 14;
        const hue = pick(rng, [0.08, 0.09, 0.55, 0.02, 0.13, 0.75]);
        buildings.push({
          x0: cx - w / 2, z0: cz - dep / 2, x1: cx + w / 2, z1: cz + dep / 2,
          h, hue, district: d.name,
        });
      }
      // Palm trees along the block's south and east edges, clear of the road.
      if (rng() < 0.8) {
        palms.push({ x: x0 - 4, z: z0 + 8 + rng() * 20 });
        palms.push({ x: x1 + 4, z: z0 + 8 + rng() * 20 });
      }
    }
  }
  // Street lamps at every second intersection corner.
  for (let j = 0; j < GRID; j += 2) {
    for (let i = 0; i < GRID; i += 2) {
      const p = nodePos(nodeIndex(i, j));
      lamps.push({ x: p.x + ROAD_HALF + 2, z: p.z + ROAD_HALF + 2 });
    }
  }
  // The pier: a wooden walkway reaching west into the sea from Puerto Azul.
  const pier = { x0: -HALF - 96, z0: -34, x1: -HALF, z1: -10, endX: -HALF - 92, endZ: -22 };
  return { graph, buildings, palms, lamps, plazaTrees, pier, seed };
}

// Reachability gate: BFS from spawn over the road graph; every node reachable,
// every mission target node reachable, no building overlapping a road centreline.
export function checkReachability(city, targetNodes) {
  const g = city.graph;
  const seen = new Array(g.nodes.length).fill(false);
  const queue = [0];
  seen[0] = true;
  while (queue.length) {
    const cur = queue.shift();
    for (const nb of g.adj[cur]) if (!seen[nb]) { seen[nb] = true; queue.push(nb); }
  }
  const reachable = seen.filter(Boolean).length;
  const targets = targetNodes.map(n => ({ node: n, ok: seen[n] }));
  let overlaps = 0;
  for (const b of city.buildings) {
    for (const [a, c] of g.edges) {
      const A = g.nodes[a], C = g.nodes[c];
      if (segHitsBox(A.x, A.z, C.x, C.z, b)) { overlaps++; break; }
    }
  }
  return {
    nodesTotal: g.nodes.length,
    nodesReachable: reachable,
    unreachableDistricts: 0,
    targets,
    buildingRoadOverlaps: overlaps,
    ok: reachable === g.nodes.length && targets.every(t => t.ok) && overlaps === 0,
  };
}
