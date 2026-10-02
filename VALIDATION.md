# Validation results

## Static validation

- Every JavaScript module under `src/` and `tests/` passes `node --check`.
- The project remains a self-contained browser ES-module application with Three.js under `vendor/`.
- The resolved railway plan uses schema version 4, preventing an older cached station planner from being mixed with the rebuilt station renderer.

## Focused regression suite

The packaged test suite passes all **47** checks, including:

- UK left-hand lane placement for every generated lane.
- Heading-aware legal-carriageway lookup.
- Kerbside bus stops and route-aware traffic lane selection.
- Clockwise roundabout connectors, including the rebuilt four-arm waterfront roundabout.
- A monotonic Waterfront Connector with well-separated approach angles.
- Shared world-definition integrity.
- Grade separation at every road–rail intersection.
- Zero remaining level crossings.
- Minimum bridge-clearance enforcement.
- Safe, road-accessible stations with platforms clear of road intersections.
- Level station footprints rather than platforms built on rail gradients.
- Curve-following platform, platform-edge and canopy modules bounded to short lengths.
- Safe platform-to-track and footbridge-to-train clearances.
- Complete station entrances, car parks and roadside bus stops outside the railway corridor.
- Functional station stair-height surfaces and a complete simulated player climb.
- Physical pedestrian blockers for station buildings and lift towers.

## Full integration smoke test

A direct systems run instantiated the complete road graph, city builder, chunk manager, profiled railway, bridge structures, all rebuilt stations and the HST fleet.

Results:

- 23 road nodes
- 34 roads
- 106 directional lanes, all left-hand
- Complete directed route connectivity between every pair of road nodes
- 13 rail-over-road grade separations
- 0 ground-level crossings
- 6.48 m minimum calculated road clearance
- 8 level, road-accessible, curve-following stations
- 478 authoritative station walking surfaces
- 16 station-structure walking blockers
- 5 HST formations
- 4,651 scene objects
- 0 viaduct-support clearance violations
- 0 non-finite object transforms
- 0 world-definition or road–rail layout-validation errors

## Visual-test boundary

The sandbox did not provide a reliable interactive GPU-backed Chromium session, so browser-frame inspection could not be treated as authoritative. The supplied screenshots were used to identify the failure modes, while geometry, navigation, layout, scene construction and interactions were exercised directly through the packaged tests and integration smoke run. A normal desktop browser should still be used for final subjective visual inspection.
