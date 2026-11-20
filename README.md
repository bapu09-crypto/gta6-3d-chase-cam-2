# Coraluna — A Chase-Cam Open-World Crime Game

[![Make.fun](https://make.fun/badge/gta6-01.svg)](https://make.fun/c/gta6-01)
[![Rank](https://make.fun/badge/gta6-01/bapu09-crypto/gta6-3d-chase-cam-2/rank.svg)](https://make.fun/c/gta6-01)
[![Reward](https://make.fun/badge/gta6-01/bapu09-crypto/gta6-3d-chase-cam-2/reward.svg)](https://make.fun/c/gta6-01)

An original 3D open-world crime game built for the [Make GTA 6](https://make.fun/c/gta6-01)
bounty on [make.fun](https://make.fun). No Rockstar names, characters, map or art:
everything here — the city, the people, the cars, the story and the music — is invented.

## The game

You are **Dario Fuentes**, a driver home to **Coraluna** after three years away — and
in debt to **Marcos Vidal**, the Shark of the city. Work eight story jobs across a
sun-soaked coastal city, from a homecoming drive to a showdown on the pier, and buy
your freedom back one wrecked van at a time.

Coraluna is a 7×7 lattice of streets with eight districts — Playa Serena's beach,
Puerto Azul's harbour and pier, Mercado Viejo's market, the towers of Las Torres,
Plaza Central, Colina Verde, Zona Franca and Mirador Sur — all reachable by road.
Golden-hour sun, palm trees, traffic, pedestrians, billboards and a lighthouse
beacon on the pier.

## Systems

- **Driving** — chase camera, stealable parked cars, arcade handling with
  predictive corner braking and stuck recovery; traffic that loops the city.
- **On foot** — walk the streets, enter and exit cars, melee and pistol/SMG/shotgun
  combat with auto-aim assist.
- **Wanted 1–5 stars** — the Coraluna Police Department responds with named units
  (CORAL-12, CORAL-48…) with roles and distances on the HUD: RAMMING, FLANKING,
  ROADBLOCK, FIRING, SPOTLIGHT. A helicopter with a spotlight joins at 3 stars.
  Break line of sight to cool down — hide behind buildings and the chopper loses
  you and searches elsewhere.
- **8 story missions** — Homecoming, Borrowed Wheels, The Drop, Van Breakers,
  Safe Passage, The Regent, Manhunt, High Tide — with stage counters, objectives,
  a NEXT step, and dialogue from Nadia the mechanic, Tomas the lookout, Elena the
  smuggler, and Vidal himself.
- **HUD** — mission header + stage + objective, named-police panel, wanted stars,
  money, health/armour bars with readable numbers, weapon slots with ammo,
  a circular minimap with route and search zone, speed + car name + condition, radio station, district label, a respect rank bar (Rookie → Legend of Coraluna),
  crew cards for Dario, Nadia and Tomas, and a time-of-day clock.
- **Radio** — three procedural WebAudio stations: SOL 98.1 Island Pop,
  MAREA 104.5 Reggae Marea, NOCHE 89.3 Synthwave, plus engine hum, sirens,
  gunshots and crash sounds.
- **Save** — progress, money, respect and mission state save to localStorage.

## Controls

| Key | Action |
| --- | --- |
| W / S | Drive / walk forward / back |
| A / D | Steer / turn |
| Space | Brake |
| F | Enter / exit car (walk up to a parked car to steal it) |
| J or click | Attack (fists / firearm) |
| 1–4 | Switch weapon |
| R | Change radio station |
| P / Esc | Pause |
| Drag mouse | Look around |

## Missions

1. **Homecoming** — drive to Nadia's garage.
2. **Borrowed Wheels** — steal a car, bring it back with the cops watching.
3. **The Drop** — pick up a package at the market, deliver it to the pier.
4. **Van Breakers** — wreck three courier vans by ramming them.
5. **Safe Passage** — escort Nadia's van to the harbour.
6. **The Regent** — ram Vidal's limo four times before it reaches the pier.
7. **Manhunt** — lose a 4-star manhunt, then reach Elena's boat.
8. **High Tide** — clear the pier on foot and face Vidal.

## Play it

Serve `game/` with any static server (for example `node serve.ts`) and open
`game/index.html` in desktop Chrome. No network requests: three.js is vendored
under `game/vendor/` as an ES module, all art is procedural, all sound is synthesized.

A scripted self-test plays all eight missions end to end:
open `game/index.html?autotest=1` and watch the console for the result.
`game/index.html?test=reach` runs the road-reachability gate.

## Structure

- `game/index.html` — page shell and the dense HUD layout.
- `game/src/main.js` — boot, game loop, police/wanted, mission stage logic, camera, save.
- `game/src/city.js` — road graph, districts, buildings, reachability checks.
- `game/src/world.js` — three.js scene: golden-hour sky, sea, roads, buildings, palms, pier, car/ped/helicopter meshes.
- `game/src/vehicles.js` — car physics, the chase autopilot, traffic, police, helicopter.
- `game/src/player.js` — on-foot movement, car entry, melee + ranged combat.
- `game/src/missions.js` — the 8-mission story, characters and dialogue.
- `game/src/hud.js` — HUD panels, minimap, procedural portraits.
- `game/src/audio.js` — procedural radio stations and effects (WebAudio).
- `game/src/autotest.js` — scripted 8-mission playthrough, reachability gate, screenshot staging.
- `game/src/util.js` — math and seeded-random helpers.
- `game/vendor/three.module.min.js` — vendored three.js r160 as an ES module
  (library, not our source; the UMD build is deprecated since r150 and prints
  a warning on load, so the module build is used instead).
- `main.ts` — the hand-in program: copies `game/` + `screenshots/` and writes `dossier.json`.

## License

MIT — see [LICENSE](LICENSE).
