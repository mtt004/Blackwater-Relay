# Train Network, Airport Connection, and HST Interior Upgrade

## Implementation verdict

The railway has been rebuilt as two operational closed loops rather than one loop plus a decorative airport spur:

- **City Loop:** approximately 3.34 km, eight city stations.
- **Eastmere Airport Loop:** approximately 2.44 km, a shared interchange at Industrial Exchange and a dedicated airport station.
- **Through operation:** airport services transfer between the loops at a tangent-aligned shared throat without reversing.
- **Grade separation:** all detected road–rail intersections are rail-over-road bridges; the generated network contains no level crossings.

The existing road, bus, traffic, pedestrian, police, aircraft, player, chunk-streaming and LOD systems remain active.

## Route architecture

### Main City Loop

The existing city railway remains a continuously closed route. Its station sequence is:

1. North Gate
2. Old Town
3. West Suburbs
4. South Parkway
5. Industrial Exchange
6. Commercial Central
7. Waterfront
8. City Central

The route is sampled as a continuous profiled curve. Stations are levelled locally, while bridge approaches use bounded gradual gradients. Automated geometry checks reject self-intersections, insufficient curve radius, level crossings, station/road conflicts and excessive gradients.

### Eastmere Airport Loop

The airport route is an independent closed composite Bézier loop. It joins the City Loop at Industrial Exchange through a shared, tangent-aligned railway throat, serves Eastmere Airport, then returns to the interchange without becoming a dead end.

The first proposed shape was rejected during implementation because its far side entered the active runway area. The final loop is validated against the runway, taxiway, apron, terminal and car-park operating footprints. It has no self-intersection, a measured minimum horizontal curve radius of approximately **92.9 m**, and a straight **132 m** airport platform section.

## Railway bridges and road clearance

Both routes use the same authoritative road–rail intersection analysis. Each crossing is converted into an elevated railway structure with:

- a continuous profiled bridge approach;
- deck and rail support structure;
- edge girders and safety barriers;
- bridge piers or support pairs placed outside protected carriageway and pedestrian envelopes;
- abutments and retaining treatment;
- ballast or rail-deck detail near the player;
- lower-detail bridge geometry at distance.

Validation covered:

- **15 rail-over-road bridges**;
- **zero level crossings**;
- **47 safe support pairs**;
- **6.48 m minimum calculated road clearance**;
- **3.46% maximum measured railway gradient**, below the configured 3.5% limit.

## Eastmere Airport station

The airport station is integrated with the terminal transport area rather than placed beside the airport as an isolated platform. It includes:

- two correctly aligned 132 m platforms;
- shelters and platform canopies;
- seating and restrained lighting;
- departure-information displays and station signs;
- fencing and platform-edge safety barriers;
- an enclosed stair route;
- a functional footbridge;
- a lift tower and upper link;
- a covered, walkable connection to the terminal;
- accurate platform-side train stopping and door operation.

The player can travel from the city, alight at Eastmere Airport, follow the covered pedestrian connection to the terminal area, return to the station and board a city service.

## Train operation

Six Class 43 HST formations operate across the two-loop network. Four are City Loop services and two are airport through services.

Airport services alternate between the City Loop and Airport Loop at Industrial Exchange. Transfer logic preserves train direction and places the formation onto the matching track of the target route. A player-controlled train can switch routes while stopped at Industrial Exchange using **J**.

Station stopping uses the centre of the complete formation rather than the power-car nose. This keeps all passenger doors of the five Mark 3 coaches inside the platform in either direction.

Doors:

- remain closed while the train is moving;
- open only when the formation is correctly stopped;
- open only on the side facing the platform;
- act as physical blockers while closed;
- allow passenger boarding and alighting while open.

## Fixed Class 43 and Mark 3 interior

No customisation or random interior generator was added. Every Mark 3 coach uses one deterministic passenger layout inspired by real HST/Mark 3 reference material:

- fixed **2+2 seating**;
- **32 passenger seats** per coach;
- window-aligned table bays;
- consistent seat spacing and central aisle;
- transparent windows aligned with the exterior window positions;
- vestibules at both ends;
- exterior and interior door alignment;
- luggage racks;
- ceiling lighting;
- passenger-information displays;
- floor, wall and ceiling panels;
- usable carriage gangways;
- seat and table collision volumes.

The Class 43 power cars include a fixed cab environment with a driving seat, desk, controls, instrument panel and clear forward windows. The procedural model is reference-inspired rather than a certified dimensional CAD reproduction.

Reference basis:

- National Railway Museum archive and image-catalogue material relating to the prototype HST and Mark III interiors.
- ScotRail's official Inter7City descriptions, including table/window alignment, powered doors and refurbished passenger accommodation.
- ScotRail rolling-stock information for the Inter7City HST fleet.

## Passenger movement and detachment

While inside a passenger coach, the player's local position is transformed with the moving carriage. The player can:

- walk while the train is stationary or moving;
- look around with the mouse;
- pass through open gangways between all five coaches;
- collide with walls, closed doors, seats and tables;
- remain supported by the carriage floor;
- alight through an open platform-side door.

Alighting clears the occupied-train state, passenger carriage reference and local attachment coordinates before restoring ordinary walking authority. The player's world position is then placed on the matching platform surface. Subsequent train movement cannot carry or move the player.

## Audio and atmosphere

Low-cost procedural Web Audio is activated after the first user interaction and only becomes audible while the player occupies a train. It provides:

- speed-responsive rolling noise;
- rail noise;
- subdued ventilation ambience;
- a door-warning tone;
- a two-tone horn.

The implementation uses synthesis rather than licensed recordings. Effects are intentionally restrained to avoid excessive CPU usage or an artificial interior.

## Performance design

The heavy-optimisation systems remain in place:

- full train geometry only inside the four-chunk neighbourhood or at close range;
- low-detail instanced HST formations outside that range;
- outline-only representation at extreme distance;
- interiors rendered only while occupied or within 72 m;
- full/low/hidden station tiers;
- chunked track, ballast, sleeper, bridge and support detail;
- lightweight distant railway lines;
- reduced distant animation and update rates;
- shared materials and reusable geometry;
- invisible interior groups disabled when not required.

## Files changed

- `src/world/WorldDefinition.js` — two-loop geography, airport approach, airport station and operating-area exclusions.
- `src/rail/RailPlan.js` — route-aware curve construction, vertical profiles, station resolution, junction and bridge validation.
- `src/rail/RailSystem.js` — multi-route train operation, airport station, route transfer, stopping, doors, passenger movement, LOD and audio.
- `src/rail/HSTFactory.js` — fixed Mark 3 passenger interior and improved Class 43 cab environment.
- `src/config.js` — interior visibility range.
- `src/main.js` — loading state and audio activation.
- `index.html` — updated railway controls.
- `tests/tests.js` — route, station, bridge, interior, door, traversal and detachment regressions.
- `scripts/validate-railway-upgrade.mjs` — dedicated whole-network operational validator.

## Validation

The final dedicated railway validator covers:

- both closed routes in both directions;
- **10,404 sampled route positions**;
- all **15 bridges** and **47 support pairs**;
- all route junctions and the Industrial Exchange transfer;
- **20 station-and-direction stopping checks**;
- **100 coach boarding/alighting checks**;
- moving traversal through all **five Mark 3 coaches**;
- maximum route gradient.

The project also contains **89 focused regression tests** and an integrated smoke test that constructs 36 roads, six HST services, 37 road vehicles, 48 pedestrians, three aircraft and one police unit.

## Honest limitations

- The train and station models are procedural, reference-informed approximations, not manufacturer CAD assets.
- Automated tests validate geometry, route continuity, clearance, stopping, collision and state transitions, but cannot prove how every camera angle will look on every GPU.
- Audio is procedurally synthesised rather than sampled from a real Class 43/Mark 3 set.
- The browser simulation does not model full rail-wheel dynamics, suspension, coupler forces or signalling-block interlocking at railway-simulator fidelity.
