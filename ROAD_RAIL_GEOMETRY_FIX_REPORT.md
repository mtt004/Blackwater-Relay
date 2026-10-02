# Road and rail geometry correction

## Reported defects

The supplied screenshots exposed three integration problems:

1. Road surfaces and kerbs stopped independently at junction boundaries, leaving visible gaps and blunt, disconnected ends.
2. Repeated viaduct supports were placed without checking the complete road and building footprint, allowing columns and large abutments to occupy carriageways or structures.
3. Station platforms were selected from centre-line clearance alone, so their full width could extend over nearby roads at an unrealistically low height.

## Corrections

### Road continuity

- Added permanent junction aprons shared across chunk boundaries.
- Separated asphalt, pavement, kerb and median trimming so the carriageway reaches the junction while roadside geometry stops cleanly.
- Added proper terminal caps for dead-end roads.
- Prevented streamed chunks from creating duplicate junction surfaces.

### Viaduct structure placement

- Added physical road-corridor and building-collider rejection for support locations.
- Added a local search that moves pier pairs away from obstructions instead of accepting the first sampled position.
- Removed the solid crossing walls that could block roads.
- Used continuous bridge decks over crossings and earth embankments on low approaches.
- Added validation data for every generated support pair.

### Stations

- Station placement now checks the complete platform footprint, including both lateral edges, rather than only the railway centre line.
- Enforced a minimum eight-metre platform-to-road-edge clearance.
- Expanded the station-position search and rejected low elevated placements.
- Added clear structural support beneath elevated platforms while keeping columns outside roads and buildings.
- Reoriented parking and access geometry relative to the selected access road.

## Validation results

- 42 focused tests pass.
- 13 road–rail crossing zones remain fully grade-separated.
- 26 viaduct support pairs generated with zero recorded road/building clearance violations.
- Every station has at least 8.09 metres of platform-to-road-edge clearance.
- No sampled road–rail overlap falls below the configured bridge clearance.
- All project JavaScript files pass `node --check`.
