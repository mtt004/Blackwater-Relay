# Blackwater Relay — Regional Aviation Network Implementation

## What changed

Blackwater Relay now has a data-driven two-airport aviation network instead of the original single-airport local flight loop.

- **Eastmere Airport (EAS)** remains the main urban hub and keeps the existing terminal, jetway and aircraft-cabin gameplay. Its terminal has been extended with an arrivals annex and route information for the new service.
- **Merehaven Island Airport (MHA)** is a separate small regional airport on an agricultural island across open water. It has a paved runway, taxiways, apron stands, ground-level terminal, passenger stairs, airport support buildings, access road, parking, fencing, windsock and rural surroundings.
- The island contains irregular fields, hedges, farm tracks, farm buildings, machinery, livestock markers, coastline/beach/rock variation, terrain relief and lightweight environmental details rather than another city grid.
- The full world now contains real sea between the mainland and island. Main-city terrain is no longer stretched across the expanded world bounds.

## Aviation architecture

`WorldDefinition` now exposes reusable airport definitions and aviation configuration. `AirportSystem` accepts the full world definition and treats airports as explicit origin/destination entities rather than assuming `AirportSystem == Eastmere`.

There are **exactly 10 persistent operational aircraft**. Each has a unique runtime identity and registration, and tracks its current airport, origin, destination, stand, route, flight phase and turnaround state. Initial conditions deliberately distribute aircraft between parked/boarding and airborne phases in both directions.

The normal network flight sequence is:

`parked/turnaround -> boarding -> prepare -> taxiOut -> holdShort -> takeoff -> climb -> enroute -> descent -> approach -> landingRoll -> runwayExit -> taxiIn -> parked/turnaround`

Aircraft alternate **Eastmere -> Merehaven -> Eastmere** indefinitely. They physically move along continuous point-to-point routes; the destination is not implemented through teleporting, despawning/replacing the aircraft, or moving scenery around it.

A lightweight operations coordinator reserves stands and runways, holds departures/arrivals when needed, prevents duplicate stand use, spaces ground aircraft, and keeps a minimum service reserve so neither airport is normally left without a usable or imminent aircraft.

## Passenger loop

The existing cabin, seating, walkable interior, camera attachment and aircraft interaction model were preserved. The same aircraft carrying the player now remains the transport entity for the entire flight.

At Merehaven, arriving aircraft taxi onto apron stands. Fixed passenger stairs become walkable only when the relevant aircraft is present, allowing the player to leave the actual aircraft, walk down to the apron/terminal, explore the island, later board a return service and fly physically back to Eastmere. The journey can be repeated without resetting the game.

## World, streaming and map integration

The authoritative world bounds now cover the city, sea corridor and Merehaven Island. Player movement uses those bounds rather than road-node extents. Existing chunk streaming follows the player/aircraft transport focus throughout a flight, with island detail groups changing visibility by distance.

The HUD minimap is adaptive: it keeps a useful local city view near Eastmere, a local island view near Merehaven, and switches to a broader route view while the player is aboard an aircraft. Aircraft passenger HUD information shows aircraft identity, flight phase and route (`EAS -> MHA` or reverse).

## Research basis

The island-airport treatment was informed by official material for small UK island/regional airports, particularly St Mary's Airport (ground-level terminal accessibility, modest terminal facilities, narrow regional runway proportions, simple aircraft parking and airfield infrastructure), and by UK CAA descriptions of apron-management functions such as stand allocation, marshalling and ground-handling coordination. The result remains a fictional Blackwater Relay location rather than a replica of a real airport.

## Validation performed

- Existing test suite: **all 119 existing tests passed when executed in batches**. The all-in-one Node test process exceeds the available execution ceiling in this environment, so the suite was split into ranges to obtain definitive results for every test.
- Integration smoke: passed with the expanded world and **10 aircraft**, while existing trains, traffic, pedestrians and police systems remained active.
- Railway-upgrade validation: passed.
- Rail-operations validation: passed.
- Dedicated aviation stress validation: passed a 25-minute simulated fleet run with all 10 aircraft cycling, no invalid transforms/duplicate stand occupancy, **23 arrivals**, and minimum usable-or-imminent service of **1 aircraft at each airport**.
- Continuous-movement guard: maximum sampled aircraft displacement was about **22 world units per 0.25 s**, below the validator's discontinuity threshold; no route teleport was detected.
- Scripted passenger round trip: the player attached to an Eastmere aircraft, remained aboard across the physical sea crossing, arrived and disembarked via Merehaven stairs, re-boarded, and physically returned on the same persistent aircraft to Eastmere. The sampled complete repeated trip took about **541 simulated seconds**, with the first destination arrival at about **235 s**.
- Island streaming was initialized and exercised directly at Merehaven without a world-bound/streaming failure.
- Lint/syntax validation passed.
- Headless performance benchmark remained low-cost for the aviation update path (airport-system p95 about **0.062 ms** in the sampled run). These are headless simulation/update timings, not claimed rendered GPU frame rates.

## Useful commands

```text
npm run lint
npm run smoke
npm run validate:aviation
npm run validate:railway
npm run validate:operations
npm run benchmark
```

The repository intentionally continues to use its vendored Three.js files. `node_modules` is not included in the delivered source bundle.
