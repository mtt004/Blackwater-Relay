
## 2026-10-02 — Aircraft controls + independent model revision

- Replaced aircraft manual control mapping with W/S pitch, A/D combined bank+turn, Tab/Shift throttle and inert arrow keys.
- Made left/right semantics explicit in the flight model and added aircraft-relative regression tests.
- Re-authored the aircraft exterior procedurally from public dimensional/photographic reference; no third-party model asset is included.
- Added newly generated fuselage UVs and a fictional unbranded runtime DataTexture livery.
- Revised wings, tail, neo-style nacelles, landing gear and full/medium/low/far LODs.
- Replaced generic cockpit yokes with lateral sidesticks and expanded flight-deck detail.
- Added `ASSET_PROVENANCE.md`.
## 2026-10-02 — Cockpit visibility, aircraft cameras and jetbridge seal

- Cut real cockpit windshield/side-window apertures into the aircraft fuselage so the pilot can see outside.
- Reworked glazing, framing, wipers, pilot eye position, pitot probes and AoA vanes for a more convincing nose/cockpit model.
- Added Pilot, Copilot, Chase, Left Wing and Right Wing aircraft cameras, cycled with C, with mouse free-look in every view.
- Shortened and tightened the jetbridge soft-dock interface to a 0.39 m flexible section with sill overlap, bellows, bumpers and continuous threshold plate.
- Added regression coverage for cockpit sightlines, aircraft camera cycling/free-look and jetbridge mating geometry.

## 2026-10-02 — Aircraft runway-conflict and flight-dynamics realism

- Eliminated airborne waiting/hovering by adding holding and go-around behavior for runway conflicts.
- Added rate-limited speed and attitude dynamics, deterministic flare/AoA behavior, and taxi-only conflict braking.
- Improved aircraft exterior detail, retractable gear/control surfaces, and the jetbridge soft-dock connection.
- Updated the browser module cache tag to `20261002-cockpit-visibility`.

## 2026-07-21 — building and structure boundary diagnostics

- Added a Diagnostics-panel setting for visual building and structure envelopes.
- Kept the boundary overlay independent from the B-key exact collision-hitbox overlay.
- Added lazy two-batch rendering for 196 procedural buildings and 118 registered structures in the deterministic world.
- Added schema-v2 static boundary catalogues with visual dimensions, world footprints and fitted collision-profile metadata.
- Added stable-ID deduplication, a 15,000-record limit and dropped-boundary accounting.
- Added whole-world boundary validation and diagnostics tests without changing collision behaviour.

## 2026-07-20 — object-by-object hitbox recalibration

- Added a written calibration plan and a reproducible hitbox-audit script before changing collision dimensions.
- Replaced padded rectangular HST walking collision with local Class 43 and Mark 3 compound profiles.
- Reduced the Class 43 collision footprint area by 13.36% and the Mark 3 footprint area by 10.35% relative to the old padded rectangles.
- Recalibrated every station wall, lintel, lift and interior-furniture blocker to sit 12 mm inside its rendered mesh.
- Reduced walking-body clearance from 0.30 m to 0.20 m and camera clearance from 0.60 m to 0.38 m without changing object geometry.
- Kept all nine road-vehicle profiles unchanged after measurement showed they were already tighter than the rendered accessories.
- Added unified, lazily-created collision overlays for vehicles, trains, stations and procedural buildings.
- Added regression tests for tapered Class 43 nose corners, Mark 3 shell ends, local door protrusions and station blocker dimensions.

# Changelog

## 2026-07-20 - Railway operations, signalling and timetable

- Added an authoritative operational railway graph with 304 segments, blocks and signals across both four-track loops.
- Added block occupation/reservation, four-aspect signalling, braking authorities and route-local train separation.
- Added protected Industrial Exchange interlocking with locked points and full-formation route release.
- Replaced arbitrary fleet spacing with 12 deterministic stopping, limited-stop, airport express and airport stopping services.
- Added dispatcher-controlled platform allocation, live service-specific platform displays and door-side safety.
- Added player cab signal/platform indications and predictable train-protection intervention.
- Added instanced signal visuals, junction indicators and optional railway operations debug mode.
- Added a 600-second deterministic full-fleet validator and nine focused operations regression tests.
- Fixed target-loop insertion clearance during airport transfers and platform-only alighting near stair overlaps.

## 2026-07-20 - Road-safe station halls and 12-train fleet

- Decoupled station-hall placement from outer platform span.
- Added exact oriented road-corridor clearance and road-safe hall placement search.
- Added under-viaduct pedestrian access at constrained stations.
- Corrected five-platform footbridge routing.
- Increased the HST fleet from 8 to 12 services.
- Reduced platform width to 4.0 m for correct track-centre clearance.

# 2026-07-18 — City loop, airport loop and fixed HST interior upgrade

- Added a separate closed 2.44 km Eastmere Airport railway loop while preserving the 3.34 km City Loop.
- Added a 160 m tangent-aligned shared junction throat at Industrial Exchange and route-changing airport services that never reverse.
- Added a complete elevated airport station with 132 m platforms, covered terminal link, displays, shelters, seating, fencing, footbridge, enclosed stairs and lift tower.
- Extended grade-separation generation and validation across both routes: 15 rail-over-road bridges, zero level crossings and no support-clearance violations.
- Centred complete HST formations at station stops so every passenger door remains within the platform in both directions.
- Rebuilt Mark 3 interiors as a fixed 32-seat 2+2 layout with aligned transparent windows, vestibules, tables, luggage racks, lighting, displays and open gangways.
- Added close-range interior culling and retained full/low/outline train, station, bridge and track LOD.
- Added reliable coach-to-coach movement at normal frame rates, shared-interchange alighting and complete detachment after exit.
- Added procedural rolling, track, ventilation, door-warning and two-tone horn audio while aboard.
- Added a dedicated full-network validator covering both directions, every bridge, 20 station-direction stops, 100 coach boarding/alighting operations and all five moving passenger coaches.

# 2026-07-16 — Railway placement and distance LOD

- Reoriented station halls using track-local coordinates so buildings cannot rotate into the running lines.
- Added authoritative minimum station spacing and platform-gap validation.
- Moved station targets to evenly distributed loop positions.
- Split track and viaduct geometry into streamed railway chunks.
- Added full/low/hidden station tiers and full/low/outline HST tiers.
- Added regression tests for station spacing, station-building rail clearance and railway LOD.

# 2026-07-15 — Station stair hall visual-clearance rebuild

- Widened all enclosed station stair halls and corrected stair pitch.
- Added long upper concourses so stairs no longer visually terminate inside a wall.
- Added glazed platform facades, larger door openings, doorway frames and interior lighting.
- Added real player traversal and full-width stair-clearance validation for all eight stations.

## 2026-07-15 — Enclosed station stair halls

- Rebuilt every ground-to-platform entrance as one coherent enclosed stair hall.
- Removed the old offset building layout that allowed walls to cut through outdoor stair flights.
- Added separate street-level and platform-level door openings with height-aware collision.
- Enclosed the full functional staircase behind continuous side walls so it is accessible only through the station interior.
- Added walkable foyer and upper-concourse surfaces and moved interior furniture clear of the stair aisle.
- Changed train alighting to a safe platform position outside the upper station door.
- Added full street-to-platform player traversal and station-shell containment validation for all eight stations.

## Station doorway collision fix

- Fixed invisible collision walls across visually open station entrances.
- Added minimum and maximum vertical ranges to station walking blockers.
- Door lintels now collide only above the doorway instead of extending to ground level.
- Added full doorway-path validation across all eight stations.
# Curve-following station geometry rebuild

- Rebuilt all eight stations rather than applying a one-off repair to the visibly broken site.
- Identified three root causes: long straight platform/canopy boxes on curved track, stations resolved on railway gradients, and full-height stair boxes that formed giant concrete wedges.
- Added a station-level railway profile so every complete platform footprint is effectively level while road-bridge clearance is preserved.
- Replaced each platform with short track-aligned modules no longer than 4.21 metres, following both horizontal curvature and railway elevation.
- Replaced stretched canopy slabs with short bounded canopy bays, correctly spaced posts, platform furniture and outer fencing.
- Rebuilt station stairs as thin structural flights with shallow treads, handrails and stringers instead of stacked full-height prisms.
- Added realistic footbridges, platform stairs, lifts and ground entrances in a consistent local station coordinate frame.
- Added physical walking blockers for station buildings and lift towers so they cannot be walked through.
- Added footprint searches for station car parks and bus shelters, rejecting positions that overlap roads, buildings or the railway corridor.
- Added per-station geometry diagnostics and startup validation for platform gradient, curvature, module size, track clearance and access facilities.
- Advanced the resolved rail-plan schema to version 4 so older cached station geometry cannot be mixed with this release.
- Expanded the focused regression suite to 47 passing tests.

# Waterfront roundabout and functional station stairs

- Rebuilt the malformed Waterfront Connector so it no longer doubles back or overlaps nearby roads.
- Moved the secondary waterfront junction away from the north-east corner.
- Converted `NE` from a generic junction apron into a genuine four-arm clockwise UK roundabout.
- Re-spaced Dock Diagonal, Ring East Link, Northeast Ring and Waterfront Connector approaches.
- Added authoritative walkable platform and staircase surfaces.
- Made walking mode climb and descend station stairs instead of resetting to ground level.
- Corrected the visible stair rise and added handrails.
- Added waterfront-geometry, stair-surface and full player-climb regression tests.
- Expanded the focused suite to 45 passing tests.

# Factory Road and southeast interchange connection fix

- Replaced the single four-road convergence beside Factory Road with two connected junctions.
- Added a 21 metre local industrial roundabout at `SE` and a separate 28 metre motorway-terminal roundabout at `M6E`.
- Moved the M6 and M6 East Slip off the local industrial junction and connected them through a dedicated access road.
- Rerouted the slip road and Industrial Arc so each approach enters from a clearly separated direction.
- Added continuous flared asphalt throats, aligned kerbs and short splitter islands at all roundabouts.
- Preserved left-hand traffic and full directed graph reachability across 23 nodes, 34 roads and 106 lanes.
- Added regression coverage for the split topology, approach setback and two-way lane connections.
- Updated the cache token across the release so old road modules cannot be mixed with the corrected geometry.
# UK traffic and grade-separated railway layout

- Made `trafficSide: "left"` an authoritative, validated world rule.
- Enforced legal left-hand lane placement across all 104 generated lanes.
- Added heading-aware player lane selection and gentle wrong-way correction.
- Retained route-aware keep-left behaviour for AI traffic and scheduled buses.
- Added UK roundabout give-way markings.
- Detected every curved road–rail intersection and replaced all ground-level crossings with 13 rail-over-road bridges.
- Added a continuous vertical railway profile, bridge decks, girders, piers and abutments.
- Removed obsolete barriers, warning lamps, road closures and crossing collision logic.
- Repositioned station platforms away from roads and bridge crossings.
- Added road-linked station entrances, pedestrian approaches, parking, bus stops, shelters, stairs, footbridges and lifts.
- Added station-entrance train boarding/alighting.
- Added startup layout validation and expanded the focused suite to 41 passing tests.

# Researched Class 43 fleet and rideable buses

- Reviewed National Railway Museum, 125 Group and multi-angle photographic references for the Class 43 HST.
- Rebuilt the power-car nose as a multi-section loft with a more faithful aerodynamic taper and roof crown.
- Added split windscreens, central pillar, wipers, side cab windows, mirrors, access doors and handrails.
- Added original-style paired front light clusters, central grille, number panel, tail lamps and coupling detail.
- Added larger radiator panels, individual grille slats, roof fans, exhaust outlets, underframe equipment and more detailed bogies.
- Added subtle dynamic diesel exhaust haze and leading/trailing light logic.
- Added five logo-free, historically grounded HST colour schemes across the five services.
- Added complete bus passenger interiors with seats, rails, driver partition and dashboard forms.
- Added bus boarding and alighting at open doors, passenger cameras, stop requests and HUD integration.
- Made occupied buses remain at full render detail and made chunk streaming follow the ridden bus.

# Class 43 power-car visual refinement

- Rebuilt the Class 43 HST power-car mesh with a more lifelike bodyshell profile and nose geometry.
- Added split windscreens, cab-side windows, wipers, mirrors, bodyside doors, radiator grilles and lower grilles.
- Added roof fans, exhaust stacks, underframe tanks and battery boxes.
- Added a more faithful InterCity-style colour separation: grey bodyside, dark window band, red cantrail stripe, blue lower bodyside and yellow nose.
- Added central high-intensity headlight, lower marker lights, tail lights, buffer beam, plough and coupler pocket.
- Added simple cab interior hints and improved bogie sideframes and axle detail.


# Smooth HST route, reliable boarding, and faster services

- Removed the sharp City Central hairpin and all rail self-intersections.
- Rebuilt the loop using broad, ordered perimeter control points and centripetal interpolation.
- Added minimum-radius and self-intersection rail validation.
- Moved City Central onto the northern transport corridor.
- Made stopped HSTs boardable from beside any vehicle in the formation.
- Added a visible train-entry prompt and a wait-for-stop prompt.
- Raised AI line speed and acceleration and shortened dwell times.
- Rebalanced manual HST traction, drag, service braking, and emergency braking.
- Kept reversing trains on the same physical track.

# Intelligent lane discipline and kerbside transit

- Added route-aware, UK-style lane selection.
- Added smooth multi-second lane changes between parallel lane splines.
- Added front-gap, rear-gap, closing-speed, vehicle-length, and player-aware merge checks.
- Added same-frame target-lane reservations to prevent simultaneous unsafe merges.
- Added keep-left behaviour after overtaking.
- Added turn-aware approach lanes: right turns use the inner lane; left/straight movements normally keep left.
- Added direction-specific indicator materials and lane-change signalling.
- Added lane-change cooldowns and driver-profile aggressiveness.
- Added multi-lane route preparation with shorter cooldowns for consecutive necessary changes.
- Corrected bus stops and scheduled buses from lane index 0 to the actual outer kerbside lane.
- Added lane-change diagnostics to the HUD.
- Added six focused regression tests and a 45-second full-traffic integration test.

# Loading and startup repair

- Fixed the missing `junction-controls` HUD element.
- Added a staged asynchronous boot and visible progress reporting.
- Added an error boundary and reload control for startup failures.
- Split initial chunk construction across animation frames.
- Deferred secondary preloads, full traffic density, full pedestrian density and validation until after first render.
- Made HUD diagnostics resilient to optional missing fields.

# Seamless junction and roundabout refinement

- Trimmed all road surfaces and lane splines to calculated junction mouths.
- Replaced centre-point road overlaps with 19 shared convex junction surfaces.
- Added cached cubic lane-to-lane connector splines for ordinary turns.
- Added clockwise circulating connector paths and entry-yield logic for roundabouts.
- Added two landscaped roundabouts at SOUTH and INDW, with raised kerbs, grass, shrubs, flower beds, give-way markings, and approach signs.
- Reduced signal control to four strategic high-capacity junctions: CBDW, CBD, CBDE, and HUB.
- Rebuilt traffic-light visuals as approach-specific primary and repeater heads positioned at stop lines.
- Added approach-based signal phases, pedestrian clearance, and whole-approach emergency pre-emption.
- Added stop lines and correctly positioned zebra crossings only at signalised approaches.
- Added roundabout and shared-junction outlines to distant chunk LOD.
- Updated the minimap and diagnostics with junction-control information.
- Added regression tests for control strategy, lane-mouth trimming, connector continuity, roundabout island clearance, and chunk registration.

# Neighbourhood streaming refinement

- Replaced the two-chunk visible set with the current chunk plus four cardinal neighbours.
- Added a two-chunk movement corridor based on signed vehicle speed and heading.
- Prebuilds the next chunk's cardinal neighbourhood before the player crosses the boundary.
- Added multi-chunk handover hysteresis instead of preserving only one previous chunk.
- Increased detailed-chunk cache capacity from 8 to 18.
- Added a three-build-per-frame, 6 ms streaming construction budget.
- Preserved diagonal façade halo loading near corners.
- Added atomic visibility: no detailed chunk is shown before its complete group is built.
- Expanded chunk diagnostics and debug-grid colours.
- Added regression tests for five-cell local coverage, two-cell ahead prediction, and atomic initial loading.

# Dynamic vehicle interaction and transit update

## Vehicle hitboxes

- Replaced the player’s four-corner rectangular collision approximation with category-specific convex footprints.
- Added tapered eight-point profiles for cars, hatchbacks, sports cars, SUVs, taxis and vans.
- Added a rounded long-body bus profile.
- Added a compound cab-and-trailer lorry profile.
- Added vehicle-specific collision mass.
- Added exact world-space hitbox transformation every fixed simulation step.
- Added a 14-metre spatial-hash broadphase.
- Added separating-axis narrowphase tests.
- Added mass-weighted penetration correction, normal impulses, low restitution and tangential friction.
- Added persistent, decaying AI collision offsets to prevent immediate visual snapping after an impact.
- Added a cyan/amber/yellow/red debug overlay toggled with **B**.
- Added a 46-metre building-collider spatial index.
- Changed building contact to use the player vehicle’s actual convex footprint.

## Steering

- Replaced fast exponential steering-to-full-lock behaviour with a rate-limited steering rack.
- Added separate steering-input and steering-return rates.
- Added speed-dependent maximum road-wheel angle.
- Added speed-dependent yaw-rate limiting.
- Retained bicycle-model wheelbase geometry while reducing handbrake rotation amplification.
- Added live steering-angle diagnostics.
- Verified that a one-frame test input creates approximately 1.06 degrees of road-wheel change rather than full lock.

## Bus operation

- Removed randomly spawned unscheduled buses from general traffic.
- Added four scheduled buses across two routes.
- Added 20 directional lane-bound bus stops.
- Added lane-aligned signs, shelters, benches, glass panels and bay markings.
- Added approach-speed calculation using a comfortable braking envelope.
- Added exact stop-target capture before junctions.
- Added stateful passenger waiting, boarding, alighting, capacity and served totals.
- Added demand-dependent dwell time.
- Added animated bus doors.
- Kept stopped buses in lane occupancy so following traffic forms a queue.
- Added stop cooldown logic to prevent repeated servicing of the same stop.
- Added a live buses-at-stops diagnostic.

## Controls and diagnostics

- Expanded the controls panel with accelerator, service brake/reverse, progressive steering, handbrake, hitbox overlay, horn and headlights.
- Added collision-contact count.
- Added road-wheel-angle readout.
- Added buses-at-stops count.

## Validation

- All JavaScript modules passed `node --check`.
- 225 generated buildings retained zero road-clearance violations.
- Full system test retained 35 chunks, 76 traffic/transit vehicles and 40 pedestrians.
- 20 directional stops were generated.
- Bus approach, stopping, doors and passenger service passed.
- Vehicle overlap and separation tests passed.
- Player/AI collision response passed.
- Maximum observed collision-system step in the Node integration test: 2.527 ms.

# Authoritative world definition

- Added `src/world/WorldDefinition.js` as the single source of truth for world bounds, city markers, districts, road nodes, road links, road styles, railway stations, railway control points, bus routes and reserved landmark zones.
- Refactored `CityPlan`, `RailPlan`, `CityBuilder`, `TransitSystem`, `WorldChunkManager`, `HUD` and startup bootstrapping to consume the shared definition.
- Replaced the minimap's fixed scale with automatic fitting against the declared world bounds.
- Added city labels sourced from the same world data used by generation and validation.
- Made chunk-grid generation and chunk preloading respect the declared world boundary.
- Added startup validation for duplicate IDs, out-of-bounds coordinates, missing road endpoints, missing road styles, unreachable bus route segments and resolved station positions.
- Added regression coverage confirming the generated road graph and scheduled bus routes cannot silently diverge from the world definition.

# Road, viaduct and station geometry correction

- Added permanent junction aprons so carriageways remain continuous across chunk boundaries.
- Added clean road-end caps and independent trimming for asphalt, kerbs, pavements and medians.
- Prevented duplicate streamed junction geometry.
- Replaced obstruction-blind viaduct piers with road-, building-, station- and crossing-aware support placement.
- Removed solid crossing abutment walls from road corridors.
- Added continuous elevated decks and ground-supported embankments on low approaches.
- Changed station validation from centre-line distance to full-platform-footprint clearance.
- Enforced at least eight metres between platform edges and road edges.
- Improved elevated platform supports, parking orientation and road-access placement.
- Updated release cache keys to `20260715-1410-road-rail-visual-fix`.
- Added regression tests for permanent junction surfaces, station clearance and support obstruction checks.

## 2026-07-15 — Camera-relative walking controls correction

- Corrected walking-only strafing so `A` moves left on screen and `D` moves right on screen.
- Kept car, bus and train controls unchanged.
- Replaced the world-perpendicular strafe vector with a camera-relative screen-left vector.
- Updated the walking controls regression test and verified the corrected movement directly at yaw 0 (`A` => +X screen-left, `D` => -X screen-right for this camera convention).

## 2026-07-15 — Passenger trains, pedestrians, junction quality, police and airport

- Added station-side HST passenger-door timing, furnished walkable Mark 3 interiors and carriage-local passenger movement.
- Added passenger boarding/alighting and open gangway transitions between adjacent coaches.
- Rebuilt pedestrian presentation and movement around articulated varied models, curved pavements, crowd spacing, station targets and hazard reactions.
- Added junction-aware road-surface detection and whole-network road-quality validation.
- Added proportionate, observation-based police enforcement with routed pursuits, blue lights, optional sirens, consequences and stuck-unit recovery.
- Added Eastmere Airport and three complete gate-to-gate aircraft operating cycles.
- Expanded player movement bounds to include the airport.
- Added project linting, 64 focused tests and an integrated multi-system smoke test.

## 2026-07-16 — tighter object hitboxes

- Replaced loose axis-aligned collision around rotated buildings with oriented façade-aligned footprints.
- Separated full building layout reservations from tighter runtime collision dimensions.
- Updated walking, vehicle, camera and rail-clearance collision queries to use the same precise collider representation.
- Added regression coverage for empty AABB corners and generated rotated buildings.

## 2026-07-16 — Dog-leg station halls and safe passenger alighting

- Rebuilt all station entrance halls with two realistic stair flights and a turning landing.
- Added brighter internal finishes, guard rails and improved lighting.
- Added a central player-state transition for returning to walking mode.
- Snapped passenger-carriage exit positions to the actual platform walk surface.
- Fixed the permanent movement lock that could occur after leaving an elevated train carriage.

## Player car exit-state fix

- Decoupled the parked player car from the walking player position.
- Pressing E now leaves the car parked while the player walks independently.
- Re-entering restores vehicle physics at the parked car's actual transform.
- Corrected parked-car collision and save-state behaviour.

## 2026-07-21 — Station stair collision-volume correction

- Replaced floor-height projected stair blocking with a thin 3D inclined structure test.
- Players can now pass beneath elevated stairs wherever the visible underside provides sufficient headroom.
- Preserved collision against the low stair section and normal walking onto reachable treads.
- Rebuilt the orange B-key stair overlay to match the 0.32 m structural envelope rather than dropping to platform level.
- Added `stair-underside` diagnostics with surface, underside and player body-top heights.
- Added full-world stair collision-volume audit and regression coverage.

## 2026-10-02 — aircraft queue, jetbridge and cockpit follow-up
- Added predictive aircraft ground queuing and collision envelopes so aircraft wait behind traffic rather than intersecting it while lining up/taxiing.
- Increased lateral aircraft separation to account for the full aircraft footprint and added a numerical overlap guard.
- Reworked the final passenger boarding bridge approach, flexible bellows, sill and fuselage seal for a cleaner dock.
- Added a usable cockpit and player flight controls with manual throttle, pitch, roll, yaw, braking and takeoff/flight movement.
- Added pilot HUD state and control documentation.

## 2026-10-02 — flight-sim physics, cockpit and terrain pass
- Corrected manual-flight left/right conventions so rudder and banked turns track in the visually expected direction.
- Replaced arbitrary airborne yaw coupling with a speed-dependent coordinated-turn model and added lift, drag, AoA, stall, vertical-speed and engine-spool behaviour.
- Expanded the pilot HUD with aviation units and live heading/altitude/VSI/bank/AoA/gear/flap information.
- Greatly expanded cockpit geometry with PFD/ND/system displays, FCU controls, pedestal/radios, pedals, side consoles and overhead controls.
- Added deterministic ground texturing, animated/bump-mapped water, rural field tramlines, hedges, woodland clumps, barns and silos outside built-up districts.
- Added `validate:flight` regression coverage for control direction, coordinated turning, stall response, cockpit detail and scenery presence.
