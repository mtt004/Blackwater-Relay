# Major City Systems Upgrade — 15 July 2026

## Implementation verdict

Implemented as an additive architectural upgrade. Existing driving, buses, HST driving, walking controls, stations, functional stairs, grade-separated railway, chunk streaming and minimap systems were retained.

## Root causes addressed

- Passenger HSTs had no door lifecycle, passenger mode, carriage-local movement frame or interior collision model. Boarding therefore meant taking the cab rather than travelling inside a coach.
- Pedestrians followed straight node-to-node chords using a single capsule model, with no crowd spacing or hazard response.
- Player road detection considered the nearest lane centre but not the unified junction apron or connector path, causing legitimate junction travel to be treated as off-road.
- There was no whole-network road-quality pass for accidental non-junction intersections, abrupt sampled curvature or disconnected connector geometry.
- Police enforcement and airport operations did not exist.
- Player movement was still clamped to the old city extent, which would have made the new airport partly unreachable.

## Main changes

### Passenger railway

- Platform-side passenger doors open only while an HST is safely stopped during its dwell period and close before departure.
- Players can board through an open coach door, walk inside while the train moves, cross open gangways between adjacent Mark 3 coaches and alight through an open platform-side door.
- Passenger position is stored in the active carriage's local coordinate system, so train motion and curvature carry the player without sliding or launching.
- Mark 3 interiors include floors, ceilings, seats, aisle space, handrails, lighting, windows, vestibules and open connecting gangway doors.
- Closed exterior doors and coach walls block walking.

### Pedestrians

- Replaced single-piece figures with varied articulated models, body proportions, skin tones, hair and clothing.
- Pedestrians follow curved pavement offsets, vary walking speed, animate arms and legs, maintain crowd spacing and slow or stop for vehicles, incidents and police.
- A portion of pedestrians route to station entrances; station pedestrians continue using platforms, stairs and footbridges.

### Roads and junctions

- Added junction-aware drivable-surface detection covering lanes, junction aprons, roundabouts and curved lane connectors.
- Straight-through traffic preserves the road speed limit; progressively sharper turns receive appropriate geometric limits.
- Added automatic analysis for abrupt curvature, undefined road intersections, disconnected connectors and connector surfaces not recognised as road.
- Corrected the M6 East slip-road control points and retained clean unified junction surfaces.

### Police

- Added observed-offence enforcement for speeding, red lights, wrong-side driving, collisions, pavements, failing to stop and restricted airside access.
- Added wanted severity, warnings, fines and licence points.
- Police vehicles route through the normal road graph, use emergency lighting, can use an audible siren after user interaction, request extra units for serious offences and replace units that remain stuck.
- Pursuits end after a safe stop or a sustained loss of observation.

### Airport

- Added Eastmere Airport outside the dense centre with a runway, runway markings and lights, taxiway, apron, terminal, gates, stands, jetways, control tower, hangars, service road, public access road, car park and perimeter.
- Three aircraft execute parked, taxi-out, take-off, flight, approach, taxi-in and gate-return states using smooth paths.
- Passenger doors open at the gate and close before taxiing.
- Public terminal/access areas remain legal while the runway and apron are restricted.
- Player world bounds now include the airport and runway.

## Files changed

- `src/rail/HSTFactory.js`
- `src/rail/RailSystem.js`
- `src/systems/PedestrianSystem.js`
- `src/road/RoadGraph.js`
- `src/road/RoadQuality.js` (new)
- `src/player/PlayerController.js`
- `src/systems/PoliceSystem.js` (new)
- `src/systems/AirportSystem.js` (new)
- `src/systems/TrafficSystem.js`
- `src/world/WorldDefinition.js`
- `src/main.js`
- `src/ui/HUD.js`
- `index.html`
- `tests/tests.js`
- `scripts/lint.mjs` (new)
- `scripts/run-tests.mjs` (new)
- `scripts/integration-smoke.mjs` (new)
- `package.json`

## Validation completed

- 64 focused regression tests passed.
- Full JavaScript syntax and project lint pass: 29 files, no trailing whitespace, no `eval`, one coherent cache version.
- Integrated systems smoke test passed with 35 roads, 5 HSTs, 37 traffic vehicles, 48 pedestrians, 3 aircraft and an active routed police response.
- Road-quality and road/rail validators are now also run during startup.
- Scene-transform smoke check found no non-finite positions, rotations or scales.

## Remaining limitations

- Aircraft use procedural models and predetermined operational routes rather than a full air-traffic-control or aerodynamic simulation.
- Police detection is based on nearby junction/signal observation and police proximity, not a citywide camera database or line-of-sight renderer query.
- Pedestrian navigation is pavement-graph based rather than a general-purpose navmesh; station access and platform movement have dedicated paths.
- Train interiors use an aisle-and-vestibule collision envelope rather than arbitrary per-seat rigid-body collision.
- A graphical headless-browser pass could not be completed in this container because Chromium could not initialise EGL/WebGL. The browser-independent complete tests and integrated Three.js simulation smoke test passed.
