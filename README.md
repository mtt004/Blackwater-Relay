# Urban Systems — city and airport railway-loop build

This release adds a second complete railway loop serving Eastmere Airport, through services at Industrial Exchange, a functional airport station and a fixed detailed Class 43/Mark 3 interior. Existing roads, buses, traffic, pedestrians, police, aircraft, stations, walking controls, chunk streaming and performance LOD remain active.


## Railway-loop and train-interior upgrade

- The original City Loop remains a closed 3.34 km double-track railway with eight city stations.
- A separate 2.44 km Eastmere Airport Loop is closed in both directions and connects tangentially at Industrial Exchange.
- Airport services change loops without reversing; manual drivers can press **J** while stopped at Industrial Exchange.
- Eastmere Airport station has 132 m platforms, shelters, seating, lighting, safety fencing, departure displays, a footbridge, lift tower, enclosed stairs and a covered walk to the terminal.
- All 15 road/rail intersections are rail-over-road bridges. No level crossings are generated.
- Station stopping points centre the entire HST formation, keeping every passenger door inside the platform.
- Mark 3 coaches use a fixed 2+2 seating plan with 32 seats, window tables, luggage racks, vestibules, passenger information displays, transparent aligned windows and usable gangways.
- Detailed interiors render only near the player or while occupied; distant trains, stations, bridges and track use lower-detail representations.
- Passenger audio is generated procedurally after the first click: restrained rolling noise, rail noise, ventilation ambience, door-warning tone and a two-tone horn.

## New systems in this release

- Board open platform-side HST doors, walk through furnished Mark 3 coaches and gangways while moving, and alight safely at stations.
- Articulated, varied pedestrians use curved pavements, station access routes and hazard-aware movement.
- Junction aprons and connector curves are authoritative road surfaces, eliminating false off-road slowdown through junctions.
- Police respond to observed offences with routed pursuit units, blue lights, optional sirens, wanted severity and proportionate consequences.
- Eastmere Airport includes runway, taxiways, terminal, gates, stands, tower, hangars, parking and three gate-to-gate aircraft cycles.

## Run

Serve the extracted folder over HTTP:

```powershell
cd explorable-city-sim-airport-loop-realistic-hst
py -m http.server 8080
```

Open `http://localhost:8080/` and keep the terminal window open. Three.js is included in `vendor/`, so no CDN is required.

After replacing an older build, press **Ctrl+F5** once so the browser does not reuse cached JavaScript.


## Flight-simulator update (2026-10-02)

The aircraft mesh is independently generated for Blackwater Relay from public dimensional and photographic references, with a fictional unbranded livery and no imported third-party 3D model; see `ASSET_PROVENANCE.md`.

Manual aircraft now use a simplified force-based model rather than fixed per-input heading changes: bank angle drives the coordinated turn rate, rudder provides yaw/sideslip correction, engine response spools rather than snapping, and lift/drag/AoA can produce climbs, sinks and stalls. The flight deck has substantially more instrument/pedestal/overhead detail. Mainland green space now has procedural ground texture, rural fields, hedges, woodland, barns and silos, while sea/harbour surfaces carry animated wave texture/bump cues so turns are readable from the cockpit. See `FLIGHT_SIM_PHYSICS_TERRAIN_UPGRADE.md` for implementation and validation details.

## Controls

- **W** — progressive accelerator
- **S** — service brake; reverse is engaged once the car is nearly stopped
- **A / D** — rate-limited, speed-sensitive steering
- **Space** — handbrake
- **B** — show or hide all authoritative collision overlays
- **F8** — start or stop Diagnostics Mode; stopping automatically downloads a JSON session file
- **Diagnostics panel: Building & structure boundaries** — show visual object envelopes and include a static boundary catalogue in an active diagnostics export
- **C** — cycle vehicle cameras; while flying an aircraft this cycles Pilot, Copilot, Chase, Left Wing and Right Wing views
- **E** — enter/leave vehicles, board passenger trains, use open train doors, or leave a bus
- **H** — horn
- **L** — headlights
- **T** — cycle clear, overcast, rain and fog
- **N** — advance time
- **I** — create an incident and dispatch an emergency vehicle
- **G** — show or hide chunk diagnostics
- **R** — reverse a stopped player-controlled HST; while manually flying an aircraft, hold R on the ground to deploy reverse thrust
- **J** — switch a stopped HST between the City Loop and Airport Loop at Industrial Exchange
- **Mouse** — free-look while walking, travelling inside a passenger carriage, or using any aircraft camera
- **Aircraft pilot** — W nose down, S nose up, A bank/turn left, D bank/turn right, Tab throttle up, Shift throttle down, hold R for ground-only reverse thrust, Space progressive wheel brake, C camera; arrow keys are not used for aircraft movement. The pilot HUD uses kt / ft / ft·min⁻¹ and shows heading, bank, AoA, brake/reverse state, gear and flaps

## UK road layout and grade-separated railway

The complete transport layout now uses one enforced UK traffic convention and contains **no ground-level road–rail crossings**.

- `WorldDefinition.js` declares `trafficSide: "left"`; `RoadGraph` rejects any other configuration.
- Every generated lane is validated as lying on the left side of its direction of travel.
- Player lane lookup uses heading as well as distance, preventing an adjacent opposing carriageway from being selected.
- Normal traffic, scheduled buses and player lane assistance all use the same legal lane graph.
- Clockwise roundabout circulation, give-way approaches, signal stop lines, lane arrows, edge lines and centre markings follow the UK layout.
- Every detected road–rail intersection is converted into rail-over-road grade separation with a continuous vertical railway profile.
- The current map contains 15 railway bridges, zero level crossings and a minimum calculated road clearance of 6.48 metres.
- Bridge decks, edge girders, piers and abutments follow the elevated railway geometry.
- Stations are relocated along the railway when necessary so platforms cannot overlap roads or bridge crossings.
- Every station footprint is levelled into the railway profile instead of being built on a bridge ramp.
- Platforms, platform edges, fences and canopies are assembled from short curve-following modules rather than stretched straight slabs.
- Each station has a ground-level entrance, pedestrian access to a nearby road, parking, a roadside bus stop, functional stairs, a footbridge and a lift.
- Station buildings and lift towers have pedestrian blockers; stairs and platforms have authoritative walking-height surfaces.
- Train boarding and alighting use station entrances, preventing passengers from entering a train through the underside of a viaduct.
- Startup validation rejects wrong-side lanes, inadequate bridge clearance, inaccessible stations, excessive platform gradients and platform/road conflicts.

## Focused improvement: realistic UK lane discipline

The audit found that the road geometry was left-hand traffic, but the traffic behaviour did not understand lane purpose. Vehicles were spawned into arbitrary lanes, remained there for an entire road, and selected the same lane through junctions regardless of their next turn. More importantly, bus stops were generated from lane index `0`, which is the **inner/overtaking lane** in this road model—not the kerbside lane.

This build corrects the mismatch with a route-aware lane system:

- Normal traffic enters predominantly in the left/outer lane.
- Vehicles move right only to overtake slower traffic or prepare for a right turn.
- After passing, vehicles return left when a safe gap exists.
- Approaching traffic chooses lanes according to the next junction movement.
- Lane changes use a smooth spline-to-spline lateral transition instead of teleporting.
- Both source and target lanes are reserved while a vehicle is changing lanes.
- Front and rear safety gaps account for speed, closing speed, vehicle length, and driver profile.
- The player vehicle is included in AI merge-gap checks.
- Lane changes are prohibited too close to junction mouths, during bus-stop dwell, and on single-lane roads.
- Left and right indicators now flash independently during manoeuvres.
- Buses and bus stops use the actual outer kerbside lane on multi-lane roads.
- Lorries keep left except when route preparation requires another lane.
- The diagnostics panel reports active and completed lane changes.

The system retains authoritative route state, collision hitboxes, chunk streaming, bus passenger state, signal logic, and roundabout priority throughout a lane change.

## Professional vehicle hitboxes

The old collision test treated the player vehicle as a simple four-corner rectangle. That was fast but inaccurate around tapered bonnets, narrow sports-car noses, buses and articulated-looking lorries.

The new collision layer uses category-specific **convex compound footprints**:

- Cars, hatchbacks, sports cars, SUVs, taxis and vans use tapered eight-point body polygons.
- Sports cars have a narrower nose and lower, more aggressively tapered footprint.
- Buses use a long rounded-corner footprint matching the body shell.
- Lorries use two separate convex volumes: one for the cab and one for the trailer.
- Every profile has vehicle-specific width, length, height and mass.

These profiles are transformed into world space every simulation step. They rotate and move with the vehicle and remain independent from visual level of detail, so an outline-only distant vehicle still retains its authoritative physical footprint.

### Collision pipeline

1. Every vehicle produces a tight world-space axis-aligned broadphase bound.
2. A 14-metre spatial hash finds only nearby candidate pairs.
3. Candidate compound polygons are tested with the separating-axis theorem.
4. Penetrating vehicles receive mass-weighted positional correction.
5. Relative velocity along the contact normal generates a low-restitution collision impulse.
6. Tangential friction reduces unrealistic sideways sliding.
7. The player and AI vehicle speeds are projected back onto their current forward directions.
8. AI vehicles retain a decaying collision offset so they do not visually snap straight back onto their lane immediately after contact.

Building collision also uses the exact player-vehicle footprint. A separate 46-metre building spatial index prevents this more accurate test from scanning all 225 buildings every frame.

Press **B** to inspect all collision geometry. The player vehicle is cyan; traffic is amber, buses yellow and emergency vehicles red. Building footprints are light cyan, station structures green, Class 43 power cars red and Mark 3 coaches orange. Debug meshes are created lazily only when the overlay is first enabled.


### Full object-by-object recalibration

A later collision audit compared every authoritative footprint with its generated visual geometry rather than applying one global shrink factor. The road-vehicle profiles were retained because all nine categories were already smaller than their complete rendered bounds and excluded mirrors, tyres, lamps and plates. The genuine overstatements were corrected instead:

- Class 43 power cars now use a tapered local compound profile rather than a padded rectangle.
- Mark 3 coaches use the actual 14.55-metre shell length, with local side-door protrusions only where the door casings exist.
- Station walls, lintels, lifts, ticket desks, benches and vending machines use named blockers fitted 12 mm inside their rendered box faces.
- Procedural buildings retain façade-aligned oriented footprints inset 80 mm per face.
- Walking-body and camera clearance are explicit actor settings rather than hidden inflation of object geometry.

Run `npm run audit:hitboxes` to regenerate `benchmarks/hitbox-audit-final.json`.

## Exportable Diagnostics Mode

Press **F8** to start a clean diagnostics session. Recording exists only while the red `DIAGNOSTICS RECORDING` indicator is visible. Press **F8** again to stop recording and automatically download a human-readable file named `city-sim-diagnostics-<timestamp>.json`. The B-key collision overlay remains independent and does not record anything by itself. The Diagnostics-panel boundary setting is also separate: magenta lines show procedural building envelopes, yellow lines show station/landmark structures, and an enabled diagnostics session captures the static catalogue once rather than once per frame.

The export contains bounded structured events, deduplicated collision lifecycles, railway authority and infrastructure transitions, traffic/transit/pedestrian/police/airport events, sampled frame and subsystem timings, renderer counters, warnings, errors and dropped-record counts. No scene graph, textures, geometry buffers, backend upload or localStorage persistence is used.

Development helpers are exposed through `globalThis.cityDiagnostics`:

```js
cityDiagnostics.start();
cityDiagnostics.stop();
cityDiagnostics.exportCurrentSession();
cityDiagnostics.retryExport();
cityDiagnostics.getSummary();
cityDiagnostics.isEnabled();
cityDiagnostics.getSettings();
cityDiagnostics.setObjectBoundaries(true);
```

See `DIAGNOSTICS.md` and `DIAGNOSTICS_EXAMPLE.json` for the schema, limits and workflow. Run `npm run test:diagnostics` for lifecycle and serialisation tests, `npm run validate:boundaries` for a whole-world catalogue check, and `npm run benchmark:diagnostics` for the low-overhead API benchmark.

## Steering and driving response

Keyboard steering no longer jumps directly to full lock.

The new steering rack model includes:

- A physical maximum road-wheel angle rather than a direct heading change.
- A limited steering rate while a key is held.
- A separate, smooth self-centring rate when the key is released.
- Maximum steering lock that falls progressively with road speed.
- A bicycle-model yaw calculation using the vehicle wheelbase.
- A speed-dependent yaw-rate cap that suppresses unrealistic 90-degree direction changes.
- Reduced rear grip during handbrake use without giving the car instant rotation.
- Front-wheel visual animation driven by the actual road-wheel command.

At low speed, the car can still manoeuvre into parking spaces. At higher speed, the available steering angle and yaw rate reduce substantially, producing a stable motorway response. A one-frame tap now creates roughly one degree of road-wheel movement rather than full steering lock.

The diagnostics panel displays the live road-wheel angle.

## Functional bus stops

All visible buses are now scheduled transit vehicles rather than randomly spawned decorative buses.

Each bus route has a directional stop plan built from the authoritative lane graph:

- A stop is associated with a specific incoming lane and route node.
- The stopping point is placed before the junction so the bus body remains clear of the crossing.
- Buses calculate a comfortable braking-speed envelope while approaching the stop.
- The vehicle snaps only the final few centimetres to the exact target after reaching walking speed.
- Doors open while passengers board and alight.
- Dwell time depends on the larger passenger movement plus a smaller allowance for simultaneous boarding/alighting.
- Passenger load, capacity, waiting demand, arrivals and served passengers remain stateful.
- Following traffic sees a dwelling bus as a stopped lead vehicle and queues behind it.
- The bus closes its doors before departing and cannot immediately re-trigger the same stop.
- Traffic lights remain independent, so a bus may serve a stop and then stop again for a red signal.

Directional bus-stop scenery now includes a sign, shelter, bench, glass panels and a kerbside yellow bay marker aligned with the lane.

The diagnostics panel shows how many buses are currently at stops.

## Existing city and rendering systems retained

- Authoritative curved road and per-lane spline graph
- UK-style left-hand running
- Correct lane-boundary markings and category-specific road widths
- Street-aligned buildings with four-sided façades
- Zero validated road/building footprint intrusions
- Current and predicted full-detail chunks
- Temporary previous-chunk handover
- Building-only boundary halo
- Distant merged building/road outlines
- Full, low-detail and outline traffic rendering tiers
- Fixed 60 Hz player physics with lower-frequency traffic, pedestrian and environment updates
- Day/night cycle, rain, fog, incidents, emergency dispatch and persistent player position

## Architecture

- `src/vehicles/VehicleHitboxes.js` — vehicle-specific convex profiles, SAT intersection and debug geometry
- `src/systems/VehicleCollisionSystem.js` — spatial broadphase, dynamic contacts, impulses and correction
- `src/vehicles/VehicleFactory.js` — full/low vehicle models, wheel animation and bus-door animation
- `src/player/PlayerController.js` — rate-limited steering, bicycle yaw and exact building collision
- `src/systems/TransitSystem.js` — directional stops, shelters, passenger exchange and schedules
- `src/systems/TrafficSystem.js` — bus approach braking, dwell behaviour, queues and collision offsets
- `src/world/WorldDefinition.js` — authoritative UK traffic, world, road, railway, station-access and grade-separation policy
- `src/world/CityPlan.js` — deterministic road graph generated from the shared definition
- `src/road/RoadGraph.js` — enforced left-hand lane geometry, junction connectors, roundabouts, spatial lane lookup and A* routing
- `src/rail/RailPlan.js` — road–rail intersection analysis, vertical rail profile, bridge clearance and station-site resolution
- `src/rail/RailSystem.js` — grade-separated track structures, stations, HST operation and station-entry boarding
- `src/world/WorldChunkManager.js` — predictive loading, façade halo and distant outlines
- `src/ui/HUD.js` — controls, collision, steering, transit and chunk diagnostics
- `src/core/DiagnosticsManager.js` — F8 session lifecycle, bounded structured recording, safe export and automatic browser download
- `src/core/StructureBoundaryOverlay.js` — lazy batched visual envelopes and serialisable building/station boundary catalogue

## Validation

The packaged build passed syntax checks and Node-based systems integration covering:

- 89 focused regression tests, executed in deterministic ranges to avoid the monolithic Node runner timing out
- 25 road nodes, 36 roads and 112 UK left-hand directional lanes
- Full directed route connectivity between all 25 road nodes
- Two independently closed railway loops sampled in both directions at 10,404 route positions
- 15 rail-over-road grade separations, zero level crossings, 47 verified safe bridge-support pairs and 6.48 metres minimum road clearance
- Maximum measured railway gradient of 3.46%, below the configured 3.5% limit
- 9 physical road-accessible stations plus the shared airport-loop interchange stop
- 20 station-and-direction stopping checks with every passenger door inside the relevant platform
- 100 carriage boarding/alighting checks and traversal through all five Mark 3 coaches while the train was moving
- Integrated smoke construction of 36 roads, 6 HST services, 37 road vehicles, 48 pedestrians, 3 aircraft and 1 police unit
- Tapered car hitboxes, compound lorry hitboxes, building-collider spatial indexing and player-to-AI collision response

Open `tests/test-runner.html` through the same server for focused browser tests.

## Scope boundary

This remains a browser simulation rather than a full rigid-body engine. Vehicle contacts use a high-quality 2D road-plane model with category-specific compound shapes; they do not yet model rollovers, wheel-to-wheel suspension contact, deformable bodywork or articulated trailer yaw.

## Seamless neighbourhood chunk streaming

The renderer now keeps a complete local neighbourhood available instead of rendering only the player cell and one forecast cell:

- The player chunk is fully detailed.
- All four cardinal neighbours—north, south, east, and west—are fully detailed at the same time.
- Two chunks are predicted ahead using heading, speed, and reverse direction.
- The cardinal neighbours of the primary forecast chunk are prebuilt in the cache before the player arrives.
- The previous visible neighbourhood remains for 1.15 seconds during a boundary handover.
- Up to three queued chunks can be built per frame within a 6 ms streaming budget.
- A diagonal façade halo remains active close to chunk corners.
- Detailed chunks become visible only after their complete instanced group has been built, preventing partially constructed cells.
- Roads, buildings, traffic, pedestrians, hitboxes, bus stops, and incidents continue to use the same authoritative simulation state.

Press **G** to view the chunk graph. White is the current cell, green is the four-cell local neighbourhood, cyan is the primary forecast cell, and amber marks the remaining ahead corridor.

## Seamless junctions and landscaped roundabouts

The road network now uses explicit junction mouths instead of allowing every road strip and lane spline to run to a shared point at the centre of a node.

- Road carriageways, kerbs, pavements, medians, edge lines, and lane markings are trimmed to calculated junction boundaries.
- Ordinary intersections receive a shared convex asphalt surface built from the exact mouth corners of every connected road.
- AI vehicles traverse cached cubic connector splines between incoming and outgoing lane mouths, so turns no longer jump or pivot at a point.
- Four high-capacity urban junctions are strategically signal-controlled: CBDW, CBD, CBDE, and HUB.
- Signal poles are installed per incoming approach at the stop line, with additional repeaters on wider approaches.
- Minor two-road links and low-volume three-road junctions are not unnecessarily signalised.
- Five functional clockwise roundabouts are provided, including the rebuilt four-arm waterfront roundabout at NE.
- Roundabout approaches have give-way markings, approach signs, circulating AI paths, and yield behaviour for entering traffic.
- Each roundabout has a raised kerbed grass island, central shrub planting, and three-colour flower beds.
- The Waterfront Connector and Harbour Road now form a broad continuous route instead of a short self-folding corner.
- Station stairs and platforms provide physical walking-height surfaces; the player can climb from ground level to elevated platforms without phasing through the steps.
- Emergency priority changes the complete incoming signal approach rather than only one lane.
- Distant chunk outlines include the junction surfaces and roundabout rings, preventing disconnected-looking roads at lower detail levels.


## Smooth-rail and boarding revision

- The former City Central hairpin has been removed.
- The loop now has a sampled minimum curve radius above 230 metres and no self-intersections.
- City Central sits on the smooth northern transport corridor.
- Walk alongside any stopped power car or Mark 3 coach and press **E** when the prompt appears.
- AI services now accelerate more strongly, dwell for less time, and can run up to 160 km/h between stations.
- Player traction and braking have also been increased.

## Latest visual improvement

The Class 43 HST power cars have been rebuilt with a more lifelike nose profile and extra visible detail, including split windscreens, bodyside grilles, roof fans, exhausts, underframe equipment, mirror arms, wipers, light clusters, coupler detail and a more faithful InterCity-style colour break-up.
## Researched Class 43 HST fleet

The Class 43 power cars now use a multi-section aerodynamic nose, original-style paired light clusters and central grille, split windscreens, cab-side doors and handrails, roof fans, radiator grilles, underframe equipment, improved bogies, active leading/tail lights and subtle diesel exhaust. Five logo-free historical colour schemes are distributed across six HST services. See `HST_VISUAL_RESEARCH.md` for the reference review and modelling decisions.

## Riding scheduled buses

Leave the car and approach the open front doors of a bus that is stopped at a bus stop. Press **E** to board. While aboard, press **C** to change camera and **H** to request the next stop. Press **E** at a later stop to leave. The bus continues using the normal traffic, lane, signal, collision and passenger-demand systems.


## Authoritative world definition

All persistent world geography now lives in `src/world/WorldDefinition.js`. It defines the world boundary, city markers, districts, road nodes and links, railway stations and control points, scheduled bus routes, and reserved landmark zones.

The road graph, railway plan, city generator, chunk streamer, transit system and minimap consume that same data. The minimap therefore scales automatically when the world expands, and a new city or route no longer requires duplicated coordinates across unrelated modules. Startup validation stops the simulation with a readable error when an entity is outside the world, a road references a missing node or style, or a bus route cannot traverse the generated graph.
