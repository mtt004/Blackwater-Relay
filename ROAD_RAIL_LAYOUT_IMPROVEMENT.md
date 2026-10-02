# UK road and grade-separated railway improvement

## Result

The simulation now enforces UK left-hand traffic across road geometry, traffic behaviour, buses, player lane selection, junctions and roundabouts. The railway no longer intersects any road at ground level.

## Road changes

- `trafficSide: "left"` is authoritative in `WorldDefinition.js`.
- `RoadGraph` builds every carriageway lane on the left side of its direction of travel and validates that invariant.
- Heading-aware nearest-lane selection prevents the player from being attached to the opposing carriageway merely because it is geometrically close.
- AI traffic and scheduled buses retain route-aware keep-left discipline, legal junction connectors and clockwise roundabout circulation.
- UK give-way markings are drawn on roundabout approaches.
- The player receives gentle lane centring and a wrong-way correction when travelling against legal traffic.

## Railway changes

- Road–rail intersections are detected from the actual curved road and railway centre lines.
- All 13 current intersections use rail-over-road bridges.
- The railway follows a continuous profiled curve with a maximum configured gradient of 3.5%.
- Minimum calculated clearance beneath every bridge is 6.48 m, above the 5.35 m policy requirement.
- Track, ballast, rails, sleepers, bridge decks and train formations follow the vertical profile.
- Old crossing barriers, lamps, road closures and player blocking logic were removed.

## Stations

Station sites are resolved against the complete road and railway geometry. A candidate is rejected when its platform would overlap a road crossing, lie on an excessive gradient or lack practical road access.

Every station now includes:

- Platforms placed beside the tracks rather than on roads.
- A ground-level entrance linked to the nearest suitable road.
- A pedestrian approach.
- Parking and marked bays.
- A roadside bus stop and shelter.
- Safe stairs to platform level.
- A footbridge and lift at elevated sites.
- Entrance-based train boarding and alighting.

## Validation

- 42 focused tests pass.
- All custom JavaScript modules pass `node --check`.
- 23 road nodes, 34 roads and 106 legal left-hand lanes.
- Every road node can route to every other road node.
- 13 grade separations; 0 level crossings.
- Minimum bridge clearance: 6.48 m.
- 8 stations, all within the configured 118 m maximum road-access distance.
- 5 HST services.
- Scene smoke test: 4,557 objects with no non-finite transforms.
