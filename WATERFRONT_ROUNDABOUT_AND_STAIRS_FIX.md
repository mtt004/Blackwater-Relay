# Waterfront roundabout and functional station stairs

## Root causes

1. `Waterfront Connector` joined `NE` to `WATER` over a very short straight-line distance while its single control point sent the Catmull–Rom curve in the opposite direction. The resulting spline doubled back and produced overlapping asphalt, kerbs and markings.
2. `NE` was rendered as a generic circular junction apron even though four major approaches met there. Two pairs of approaches arrived at poor angles, so their independently generated road strips overlapped.
3. Station stairs were visual meshes only. Walking mode reset the camera to `y = 1.72` every frame, so no mesh could change player elevation.
4. The stair-box centres used half the required cumulative rise, causing the visible staircase to reach only about half the platform height.

## Implemented repair

- Moved the secondary `WATER` node well clear of the north-east junction.
- Rebuilt `Waterfront Connector`, `Harbour Road`, `Dock Diagonal` and `Ring East Link` with broad, monotonic curves.
- Converted `NE` into a genuine four-arm, clockwise UK roundabout with a 24 metre outer radius.
- Separated adjacent roundabout approaches by at least 74.5 degrees.
- Moved the Waterfront station target along the rail corridor so platform placement remains clear of the rebuilt junction.
- Added authoritative station walking surfaces for every platform and staircase.
- Added continuous stair-height sampling, maximum step-up/down checks, platform-edge protection and side-entry blocking.
- Connected walking mode to the railway surface resolver so the player camera physically rises and descends.
- Corrected stair mesh construction and added continuous handrails.

## Validation

- `Waterfront Connector` path/direct-distance ratio: 1.047 (no hairpin or doubling back).
- Minimum separation between the four NE approach directions: 74.5 degrees.
- All 23 nodes, 34 roads and 106 directional lanes remain connected.
- All road and station layout validators pass.
- A simulated player walked the complete elevated staircase, rising 7.25 metres and arriving on the platform landing.
- All 45 focused tests pass.
