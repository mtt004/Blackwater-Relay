# Railway Operations, Signalling, Interlocking and Timetable Upgrade

## Result

The existing four-track city loop and airport loop now operate through a separate railway-operations layer. The physical railway curves, stations, bridges, HST interiors, passenger systems and distance LOD remain the visual and movement foundation; the new layer provides graph-based movement authority, block occupation, route locking, platform allocation, deterministic services and live platform information.

## Root causes identified

The previous railway was visually detailed but operationally centralised inside `RailSystem`:

- trains mainly followed route curves and local train-ahead distance;
- fleet starts were spaced procedurally rather than produced by explicit services;
- station stopping, doors, routing and rendering shared state in one large class;
- platforms were physical geometry but were not authoritative reserved resources;
- airport transfers did not have a locked conflicting-route model;
- route maps used route-wide static stop lists rather than the next allocated service;
- there was no persistent concept of blocks, signals, movement authority or protected junction routes.

During long-run validation, an additional transfer hazard was found: an airport service could be inserted into the target loop with insufficient full-formation separation from another train. The transfer check now validates the complete train footprint and route-local gap before movement authority is granted.

A separate passenger regression was also found: a carriage doorway could overlap a footbridge-stair walk surface. Alighting now selects a clear platform-only landing point instead of resolving onto stairs.

## Architecture introduced

### `RailNetwork.js`

Creates an authoritative operational graph that references the existing Three.js route curves rather than replacing them.

Each operational section contains:

- stable route, segment, block and node IDs;
- route ID and track index;
- progress interval on the existing curve;
- direction restrictions;
- length, gradient, line speed and curve-speed limits;
- connected next sections;
- station, platform, bridge and junction associations.

The finished network contains:

- 304 operational segments;
- 304 signalling blocks;
- 304 signals;
- 45 station platforms;
- two continuous four-track loops.

Blocks are deliberately shorter around stations and the Industrial Exchange airport junction and longer on open railway.

### `RailBlockSystem.js`

Maintains safety-critical occupation and reservation state using the complete train body, not only the locomotive centre.

It provides:

- occupied and reserved blocks;
- direction-sensitive reservations;
- movement-authority distance;
- next-signal state;
- red, yellow, double-yellow and green aspects;
- conflict detection;
- reservation release after the full formation clears.

A signal clears only for the train holding the corresponding authority, preventing a following train from inheriting another service's route.

### `RailInterlocking.js`

Protects the city-loop/airport-loop junction.

The interlocking:

1. receives a route request;
2. verifies the required blocks;
3. checks conflicting routes;
4. sets and locks the route;
5. holds conflicting signals at red;
6. keeps the points locked while any part of the formation remains in the junction;
7. releases the route only after the complete train has travelled clear.

Points cannot move underneath a train, and conflicting city-to-airport and airport-to-city routes cannot clear simultaneously.

### `TrainService.js`

Defines a deterministic repeating simulation timetable instead of arbitrary fleet spacing.

The 12 services include:

- clockwise city stopping services;
- anticlockwise city stopping services;
- limited-stop city services;
- airport express services;
- airport stopping services.

Each service defines its identity, display name, route sequence, direction, stopping pattern, preferred tracks and platforms, scheduled offset/headway, dwell time, maximum speed and priority.

### `StationOperations.js`

Turns platforms into authoritative operational resources.

It handles:

- compatible track/platform faces;
- approach reservations;
- occupation and release;
- train-length and stopping-area checks;
- prevention of double booking;
- door-side confirmation;
- live next-train information;
- delay and service-status display data.

Doors can open only when the train is stopped, correctly aligned and occupying its confirmed allocated platform.

### `RailDispatcher.js`

Coordinates trains at approximately 8 Hz independently of visual LOD.

It:

- rebuilds movement reservations;
- sorts trains by operational priority;
- allocates platforms before station entry;
- protects junction routes;
- calculates movement authority;
- prevents insertion conflicts during airport transfers;
- regulates blocked and late-running trains;
- applies anti-starvation waiting priority;
- detects abnormal waiting and can release stale reservations without teleporting trains.

Priority considers trains already inside a junction, trains too close to stop safely, airport services, timetable state, lateness and accumulated waiting time.

### `RailSignalRenderer.js`

Adds shared, instanced signal geometry with low draw-call cost:

- signal posts and heads;
- red, yellow, double-yellow and green lamps;
- identification-plate meshes;
- lightweight point-blade representations;
- junction route indicators;
- optional block/reservation debug rendering.

Press `V` to toggle railway operations debug mode. Debug rendering is disabled by default.

### `RailSystem.js`

`RailSystem` remains the coordinator and owner of physical train/station rendering, but operational decisions are delegated to the new modules. Existing curves, train formations, station meshes, passenger interiors and LOD models are reused.

## Operational behaviour

### Movement authority and braking

AI target speed is now constrained by:

- service maximum speed;
- line speed;
- curve-speed limit;
- gradient limit;
- temporary restrictions;
- signal aspect;
- distance to the end of authority;
- station stopping point;
- allocated-platform readiness;
- junction speed;
- route-local train-ahead separation.

A continuous braking calculation replaces abrupt signal stopping. Trains are held outside station blocks when no compatible platform is available.

### Four-track use and overtaking

Stopping services prefer the outer lines, while limited-stop and airport services prefer the inner lines. This permits faster services to pass slower services through parallel four-track operation without teleporting between offsets.

No fictitious instant track switching was added. Physical route transfer occurs only through the existing Industrial Exchange connection.

### Airport operation

Airport services retain a genuine city → airport → city route sequence without reversing. A transfer is authorised only when:

- the interlocking route is locked;
- required blocks are available;
- the target track can accept the complete formation;
- safe front and rear separation exists on the target loop.

### Platform displays

Existing lightweight canvas boards are updated in place rather than recreated. They now show the actual predicted or allocated next service:

- platform number;
- destination;
- service type;
- service identity;
- calling points in order;
- current status;
- estimated departure;
- delay.

Changing an allocation updates texture data without rebuilding station geometry.

### Player-driven trains

Player trains remain subject to the same blocks and interlocking. Cab state now exposes:

- current signal aspect;
- permitted speed;
- distance to next signal;
- allocated platform;
- route-set state;
- signal-passed-at-danger warning.

Normal driving is not forcibly controlled. Predictable emergency protection intervenes only when the player is about to pass a red signal, enter an occupied block or enter an unlocked conflicting junction route.

## Diagnostics

The HUD now reports:

- occupied blocks;
- reserved blocks;
- trains waiting at signals;
- active junction routes;
- occupied and reserved platforms;
- average delay;
- most delayed service;
- dispatcher update time;
- deadlock recovery count.

Railway debug mode visualises block boundaries and colours occupation/reservation state. Debug metadata also exposes block IDs, active junction routes and platform allocations.

## Performance

Operational state remains global and independent of train/station visual LOD.

Update rates are separated:

- train transform interpolation: rendered frames;
- block occupation and safety state: fixed railway step;
- dispatcher and authority decisions: 0.125 seconds (~8 Hz);
- platform information: 1 second;
- distant visual updates: existing reduced LOD rates.

Route-local sorted train groups replace broad per-frame train/segment scans. Platform compatibility, station order and block relationships are cached. Signals use instanced shared meshes.

In the deterministic full-fleet validator, the final measured dispatcher update was approximately **0.112 ms**. This is a Node validation measurement, not a guaranteed browser-frame cost on every computer.

## Files changed

### New operational modules

- `src/rail/RailNetwork.js`
- `src/rail/RailBlockSystem.js`
- `src/rail/RailInterlocking.js`
- `src/rail/RailDispatcher.js`
- `src/rail/TrainService.js`
- `src/rail/StationOperations.js`
- `src/rail/RailSignalRenderer.js`
- `scripts/validate-rail-operations.mjs`

### Operational integration and UI

- `src/rail/RailSystem.js`
- `src/ui/HUD.js`
- `index.html`
- `package.json`
- `tests/tests.js`
- `scripts/validate-railway-upgrade.mjs`

Other JavaScript module files received only the synchronized browser cache-version tag required by the project's lint rule.

## Validation performed

### Focused regression suite

All **100 tests passed** in deterministic ranges. The project’s monolithic Node test process remains too slow for the execution timeout, so the exact same 100 tests were executed in non-overlapping batches and single-test ranges where required.

Coverage includes:

- network continuity and no dead ends;
- all service routes and stopping patterns;
- platform reachability by stairs;
- block reservation conflicts;
- red-signal braking;
- interlocking conflict rejection;
- point locking and full-formation route release;
- platform double-booking prevention;
- allocated-platform door operation;
- live route-map calling points;
- player cab indications;
- passenger alighting and detachment;
- road, vehicle, bus, pedestrian, police, airport and LOD regressions.

### Railway geometry and passenger validator

Passed with:

- two closed loops;
- 10,404 bidirectional route samples;
- 13 bridges;
- 33 safe support pairs;
- 20 station/direction stop checks;
- 100 carriage boarding and alighting checks;
- all five passenger coaches traversed while moving;
- maximum railway gradient of 3.46%.

### Full railway-operations validator

A deterministic 600-second, 12-train run passed with:

- 304 segments, blocks and signals;
- 45 platforms;
- 12 explicit services;
- zero block conflicts;
- zero platform double bookings;
- no train accelerating into an enforced red authority;
- 10 protected city/airport transfers;
- maximum two trains waiting at signals;
- maximum one active conflicting-junction route;
- zero deadlock recoveries during normal operation;
- complete movement-authority and cab-state data for every train.

### Whole-game integration

Passed with:

- 36 roads;
- 12 trains;
- 37 traffic vehicles;
- 48 pedestrians;
- three aircraft;
- one police unit.

JavaScript linting, syntax validation and the single synchronized cache tag also passed.

## Remaining limitations

- The timetable is a deterministic repeating simulation timetable, not a real-world clock-perfect working timetable.
- Parallel-track overtaking is supported through service track allocation. Additional physical crossovers were not invented because the request required preserving existing visible geometry; dynamic track changes are therefore limited to infrastructure that physically exists.
- Signal identification plates use lightweight instanced plate meshes with stable IDs stored in renderer metadata rather than expensive per-signal 3D text.
- Point blades are performance-conscious visual representations; the operational point lock and route state are authoritative, but the blades are not a manufacturer-level animated switch mechanism.
- Automated geometry and operational tests cannot replace a human visual drive-through on the user's specific browser, resolution and GPU.
