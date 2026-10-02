# Station Stair Hall and Passenger Alighting Fix

## Root causes

1. The station entrance used one approximately 8-metre-high straight stair flight over a short horizontal run. It was technically walkable, but visually resembled an industrial ramp and dominated the entire hall.
2. Passenger-carriage alighting used the train doorway's vertical position plus a fixed camera offset. At elevated stations this placed the player's feet below the platform walk surface. The walking resolver then rejected every movement as an unreachable step up, leaving the player permanently frozen.

## Implementation

- Replaced every station's single straight staircase with an enclosed dog-leg arrangement:
  - two parallel 30-degree flights;
  - a full-width turning landing;
  - an upper concourse to the platform door;
  - guard rails, brighter interior wall linings and three ceiling lights;
  - fixtures moved away from the walking route.
- Added an authoritative street-to-platform waypoint route for each station.
- Added `PlayerController.releaseToWalking()` to reset train/bus/vehicle state, camera position, walking orientation and a short collision grace period in one operation.
- Added platform-aware passenger alighting:
  - finds the closest platform walk surface;
  - clamps the exit point inside its safe bounds;
  - sets the player's feet exactly to platform height;
  - verifies immediate walking movement after exit.

## Validation

- 73 focused tests passed in disjoint batches.
- Targeted dog-leg, doorway, station-interior and passenger-alighting tests passed after the final cache-version update.
- All eight station halls passed real PlayerController street-to-platform traversal.
- Integration smoke test passed with roads, traffic, buses, five HSTs, passengers, pedestrians, police and aircraft active.
- JavaScript lint and syntax validation passed for 30 files.
