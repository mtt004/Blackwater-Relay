
> **Superseded layout note:** Ground-level crossing behaviour in this historical report has been replaced by the 13 rail-over-road grade separations and road-accessible station design documented in `ROAD_RAIL_LAYOUT_IMPROVEMENT.md`.


# Revision notice

The route geometry, boarding system, and operating speeds described in the original report were superseded by `RAIL_FIX_REPORT.md`. The revised route has no self-intersection, a sampled minimum radius of 235.63 metres, reliable coach-side boarding, nine recalculated level crossings, and a 160 km/h AI line speed.

# Class 43 HST rail-network implementation report

## Objective

Add a city-wide passenger railway that links the major urban districts, runs continuously with at least five trains, protects every detected road crossing, and allows the player to leave the car and drive a train.

## Vehicle selected

All services use a city-scaled British Rail Class 43 High Speed Train formation:

- A streamlined Class 43 power car at each end.
- Five Mark 3 passenger coaches between the power cars.
- Classic blue, grey, red and yellow InterCity-inspired exterior treatment.
- Wedge-shaped power-car noses, cab glazing, side ventilation grilles, bogies, rotating wheels and paired headlights.
- A stored real-world design speed of 125 mph / approximately 200 km/h.
- A lower automatic urban line speed so AI services can stop safely within the compressed city map.

The rendered formation is deliberately shortened relative to a full-size main-line HST so that it can negotiate the simulation's city-scale curves and fit the station platforms. It retains the correct two-power-car/fixed-coach visual structure.

## Rail alignment

The route is a smooth closed double-track loop. It serves:

1. North Gate
2. Old Town
3. West Suburbs
4. South Parkway
5. Industrial Exchange
6. Commercial Central
7. Waterfront
8. City Central

The alignment uses a closed Catmull-Rom centreline with deliberately sparse control points. It bends only to connect the major centres and avoids random short-radius zigzags. Each running line is offset from the common route centreline, producing two independent tracks for clockwise and counter-clockwise services.

## Track construction

The physical railway includes:

- Separate ballast beds for each track.
- Standard-gauge rail spacing represented at 1.435 metres.
- Four visible steel running rails across the double-track route.
- Regular timber sleepers.
- Eight station pairs with raised platforms, tactile/contrasting edges, canopies, support columns, station buildings and signs.
- Instanced track geometry to keep the draw-call cost low.
- Distance-aware station and crossing visibility integrated with the existing chunk manager.

The city generator now reserves the rail corridor before placing buildings. The final generated city contains 202 building footprints and reports zero road or rail corridor intrusions.

## Continuous services

Five HST sets are created at startup. They are distributed around the loop and split between the two directions.

Each automatic service has:

- Progressive diesel-electric-style acceleration.
- Route speed limits.
- Predictive station braking.
- Platform dwell time.
- Automatic selection of the next station in the correct direction.
- Same-track train separation and braking protection.
- Continuous looping after completing a circuit.
- Full-detail rendering in nearby chunks and a lightweight outline at distance.

A five-minute simulation produced repeated station stops across the fleet without route loss or derailment from the track spline.

## Level crossings

Road/rail intersections are discovered from the authoritative road curves and rail curve rather than manually guessed positions. The current plan produces 11 controlled crossings.

Each crossing includes:

- Two roadside barrier posts.
- Two animated barrier arms.
- Alternating red warning lamps.
- Per-lane stopping points for road AI.
- Train approach detection using distance along the railway, not only straight-line distance.
- Tail-clearance logic so barriers remain closed until the complete HST has passed.
- Comfortable predictive braking for AI road vehicles.
- A physical movement block for the player car while the barriers are down.
- An escape rule that allows a vehicle already inside the crossing to move away rather than becoming trapped.

## Player train driving

The player can:

1. Stop and leave the car using **E**.
2. Walk to either cab of a stopped HST.
3. Press **E** to enter the cab.
4. Use **W** for power.
5. Use **S** for the service brake.
6. Use **Space** for the emergency brake.
7. Use **R** to reverse the train's direction while stationary.
8. Use **C** to cycle cab, chase, side and top-down cameras.
9. Use **H** for the Class 43 horn state.
10. Stop and press **E** to leave the train.

The player-driven train retains automatic train-separation protection to prevent an easy rear-end collision with another HST on the same line.

## Diagnostics and map

The HUD now reports:

- Five active Class 43 HST services.
- Average rail-fleet speed.
- Active and total level crossings.
- Player train identity.
- Next station.
- Cab camera mode.
- 200 km/h Class 43 design limit.

The minimap shows the complete rail loop, station positions and live train positions.

## Validation

- 30 focused browser-module tests passed.
- 8 stations created.
- 5 complete HST formations created.
- 2 Class 43 power cars and 5 Mark 3 coaches per formation.
- 11 controlled road/rail crossings detected.
- 202 generated buildings.
- 0 road/rail building-clearance violations.
- 21 station dwell events observed during a five-minute fleet simulation.
- All JavaScript files passed syntax validation.

A real GPU-rendered browser frame could not be completed in the container because local browser navigation is administratively blocked. The simulation modules, geometry generation, train operation, station logic, crossing logic and tests were executed directly under Node using the vendored Three.js modules.
