// missions.js — Coraluna's story: 8 missions for Dario Fuentes, a driver
// home after three years away, working off a debt to loan shark Marcos Vidal.
// Every target is a road node (or the pier walkway), so every objective is
// reachable by road. Stages carry the objective text and the NEXT step the
// HUD shows, matching the leader boards' density.
import { dist } from './util.js';
import { nearestNode } from './city.js';

export const CHARACTERS = {
  DARIO:  { name: 'DARIO',   role: 'DRIVER',    colour: '#c98a4a', hair: '#2a1a10' },
  NADIA:  { name: 'NADIA',   role: 'MECHANIC',  colour: '#8a5a3a', hair: '#101010' },
  TOMAS:  { name: 'TOMAS',   role: 'LOOKOUT',   colour: '#a07050', hair: '#5a3a1a' },
  ELENA:  { name: 'ELENA',   role: 'SMUGGLER',  colour: '#b08060', hair: '#3a1a1a' },
  VIDAL:  { name: 'VIDAL',   role: 'THE SHARK', colour: '#c0a080', hair: '#e8e8e8' },
};

// Node helpers: node (i, j) with i east, j south; index = j*7 + i.
const N = (i, j) => j * 7 + i;

export const LOCATIONS = {
  spawn: N(3, 3),        // Plaza Central
  garage: N(2, 4),       // Nadia's garage, Mercado Viejo edge
  market: N(1, 5),       // Mercado Viejo pickup
  pierGate: N(0, 1),     // Puerto Azul, road end by the pier
  harbour: N(0, 2),      // Puerto Azul harbour
  eastGate: N(6, 6),     // Zona Franca south-east, where the limo starts (long cross-town route)
  southPlaza: N(3, 6),   // Mirador Sur
  lookout: N(5, 3),      // Zona Franca lookout
};

// Stage types: goto | steal | wreck | escort | ram | lose | combat
export const MISSIONS = [
  {
    id: 1, title: 'HOMECOMING', reward: 500, respect: 120,
    intro: { who: 'NADIA', text: 'Dario! Three years and you come home broke? Get to my garage. I have work for you.' },
    stages: [
      { type: 'goto', node: LOCATIONS.garage, title: 'DRIVE TO THE GARAGE',
        objective: 'Drive to Nadia\'s garage in Mercado Viejo',
        next: 'Meet Nadia', who: 'NADIA', text: 'The garage is on the south road. Don\'t scratch the paint on the way in.' },
    ],
  },
  {
    id: 2, title: 'BORROWED WHEELS', reward: 800, respect: 150,
    intro: { who: 'NADIA', text: 'Vidal owns your debt now, Dario. First job: borrow a car. Any car. Bring it back here.' },
    stages: [
      { type: 'steal', title: 'STEAL A CAR',
        objective: 'Walk up to a parked car and take it',
        next: 'Drive it to the garage', who: 'TOMAS', text: 'Any ride on the street will do. The cops notice, so keep it quick.' },
      { type: 'goto', node: LOCATIONS.garage, title: 'DELIVER THE CAR', wanted: 1,
        objective: 'Drive the stolen car to Nadia\'s garage',
        next: 'Park inside the marker', who: 'NADIA', text: 'One star on you already? Good. You still drive like you mean it.' },
    ],
  },
  {
    id: 3, title: 'THE DROP', reward: 1200, respect: 200,
    intro: { who: 'ELENA', text: 'A package waits at the market. Take it to the pier, no questions. The cops are jumpy tonight.' },
    stages: [
      { type: 'goto', node: LOCATIONS.market, title: 'PICK UP THE PACKAGE',
        objective: 'Drive to the market stall in Mercado Viejo',
        next: 'Collect the package', who: 'TOMAS', text: 'Eyes out. The market is crowded — watch the pedestrians.' },
      { type: 'goto', node: LOCATIONS.pierGate, title: 'DELIVER TO THE PIER', wanted: 2,
        objective: 'Deliver the package to the pier gate in Puerto Azul',
        next: 'Hand it to Elena\'s man', who: 'ELENA', text: 'Two stars and counting. Lose them after the drop, not before.' },
    ],
  },
  {
    id: 4, title: 'VAN BREAKERS', reward: 1500, respect: 250,
    intro: { who: 'VIDAL', text: 'My rivals move cash in courier vans. Wreck three of them. Make it look like traffic.' },
    stages: [
      { type: 'wreck', count: 3, title: 'WRECK THE COURIER VANS',
        objective: 'Ram 3 courier vans until they are wrecked (0/3)',
        next: 'Vans wrecked: 0/3', who: 'VIDAL', text: 'Three vans, Dario. Ram them hard — a love tap is not a wreck.' },
    ],
  },
  {
    id: 5, title: 'SAFE PASSAGE', reward: 1800, respect: 300,
    intro: { who: 'NADIA', text: 'My van carries parts Vidal wants. Escort it to the harbour. If it gets wrecked, we both pay.' },
    stages: [
      { type: 'escort', from: LOCATIONS.garage, to: LOCATIONS.harbour, title: 'ESCORT NADIA\'S VAN',
        objective: 'Stay close to Nadia\'s van until it reaches the harbour',
        next: 'Van en route to the harbour', who: 'NADIA', text: 'Stay with the van. If a cop rams it, ram the cop back.' },
    ],
  },
  {
    id: 6, title: 'THE REGENT', reward: 2500, respect: 400,
    intro: { who: 'TOMAS', text: 'Vidal\'s limo, the Regent, is crossing town to the pier. Ram it four times before it gets there!' },
    stages: [
      { type: 'ram', count: 4, title: 'WRECK THE REGENT',
        objective: 'Ram Vidal\'s limo 4 times before it reaches the pier (0/4)',
        next: 'Limo hits: 0/4', who: 'TOMAS', text: 'He\'s making for the pier! Ram the Regent before it reaches the water!' },
    ],
  },
  {
    id: 7, title: 'MANHUNT', reward: 3000, respect: 450,
    intro: { who: 'ELENA', text: 'Four stars, Dario. The whole department is on you. Break line of sight, then get to my boat at the pier.' },
    stages: [
      { type: 'lose', title: 'LOSE THE MANHUNT', wanted: 4,
        objective: 'Break line of sight and lose the 4-star manhunt',
        next: 'Then reach the boat', who: 'ELENA', text: 'They can see you — break line of sight! The boat sails in two minutes!' },
      { type: 'goto', node: LOCATIONS.pierGate, title: 'REACH THE BOAT',
        objective: 'Reach the boat at the pier',
        next: 'Board Elena\'s boat', who: 'ELENA', text: 'Almost there. The pier is clear — run for the boat!' },
    ],
  },
  {
    id: 8, title: 'HIGH TIDE', reward: 5000, respect: 600,
    intro: { who: 'VIDAL', text: 'You think you can walk away from me, Dario? My men are on the pier. Come and collect your debt.' },
    stages: [
      { type: 'combat', waves: 3, title: 'CLEAR THE PIER',
        objective: 'Defeat Vidal\'s men on the pier (wave 1/3)',
        next: 'Waves remaining: 3', who: 'DARIO', text: 'On foot now. Vesper out — nobody walks off this pier but me.' },
      { type: 'combat', waves: 1, title: 'FACE VIDAL',
        objective: 'Confront Marcos Vidal at the end of the pier',
        next: 'End this', who: 'VIDAL', text: 'One last man between you and freedom, Dario. Me.' },
    ],
  },
];

export class MissionController {
  constructor() {
    this.missionIdx = 0;
    this.stageIdx = 0;
    this.progress = 0;        // wrecks / rams / kills in the current stage
    this.done = false;        // all 8 missions complete
    this.dialogue = null;     // { who, text, until }
    this.stageStartTime = 0;
    this.escortVan = null;
    this.failed = false;
  }

  get mission() { return MISSIONS[this.missionIdx]; }
  get stage() { return this.mission ? this.mission.stages[this.stageIdx] : null; }
  get stageCount() { return this.mission ? this.mission.stages.length : 0; }

  startMission(now) {
    this.stageIdx = 0;
    this.progress = 0;
    this.stageStartTime = now;
    const m = this.mission;
    if (m) this.say(m.intro.who, m.intro.text, now);
    const s = this.stage;
    if (s && s.who) this.say(s.who, s.text, now);
  }

  say(who, text, now) {
    this.dialogue = { who, text, until: now + 7 };
  }

  // Advance a stage; returns 'mission' when the mission completes.
  advance(now, game) {
    this.stageIdx++;
    this.progress = 0;
    if (this.stageIdx >= this.mission.stages.length) {
      const m = this.mission;
      game.player.money += m.reward;
      game.respect += m.respect;
      game.log(`MISSION ${m.id} COMPLETE: ${m.title} +$${m.reward}`);
      this.missionIdx++;
      if (this.missionIdx >= MISSIONS.length) {
        this.done = true;
        this.say('DARIO', 'It is over. Coraluna is mine again — and Vidal is finished.', now);
        return 'done';
      }
      this.startMission(now);
      return 'mission';
    }
    const s = this.stage;
    if (s.who) this.say(s.who, s.text, now);
    this.stageStartTime = now;
    return 'stage';
  }

  // Objective text with live progress substituted.
  objectiveText() {
    const s = this.stage;
    if (!s) return 'All missions complete';
    let t = s.objective;
    if (s.type === 'wreck' || s.type === 'ram') {
      t = t.replace(/\(\d+\/\d+\)/, `(${this.progress}/${s.count})`);
    }
    if (s.type === 'combat') {
      t = t.replace(/wave \d+\/\d+/, `wave ${this.progress + 1}/${s.waves}`);
    }
    return t;
  }

  nextText() {
    const s = this.stage;
    if (!s) return '';
    let t = s.next;
    if (s.type === 'wreck') t = `Vans wrecked: ${this.progress}/${s.count}`;
    if (s.type === 'ram') t = `Limo hits: ${this.progress}/${s.count}`;
    if (s.type === 'combat') t = `Waves remaining: ${Math.max(0, s.waves - this.progress)}`;
    return t;
  }
}

// Distance from the player (car or on foot) to the current stage target node.
export function stageTargetPos(game) {
  const mc = game.missions;
  const s = mc.stage;
  if (!s) return null;
  if (s.type === 'goto' || s.type === 'escort') {
    const node = s.type === 'escort' ? s.to : s.node;
    const p = game.city.graph.nodes[node];
    return { x: p.x, z: p.z, node };
  }
  if (s.type === 'lose') {
    const p = game.city.graph.nodes[LOCATIONS.pierGate];
    return { x: p.x, z: p.z, node: LOCATIONS.pierGate };
  }
  // Ram/wreck stages chase a live mission vehicle: point the minimap and
  // the route at the nearest one so the player always sees where to go.
  if (s.type === 'ram' || s.type === 'wreck') {
    let best = null, bestD = Infinity;
    for (const c of game.missionCars) {
      if (c.wrecked) continue;
      const d = dist(game.px(), game.pz(), c.x, c.z);
      if (d < bestD) { bestD = d; best = c; }
    }
    if (best) {
      const node = nearestNode(game.city.graph, best.x, best.z);
      return { x: best.x, z: best.z, node };
    }
  }
  if (s.type === 'combat') {
    return { x: game.city.pier.endX, z: game.city.pier.endZ, node: -1 };
  }
  return null;
}
