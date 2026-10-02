# Station stair hall visual-clearance fix

## Root cause

The earlier enclosed-hall implementation kept the stair centre line inside the building, but the upper flight ended only about 2.8 metres from an opaque platform-side wall. From the foyer this made the staircase appear embedded in the wall and provided too little visually legible upper circulation space. The prior tests sampled the stair centre line and therefore did not catch this architectural failure.

## Changes

- Widened every station stair hall from 9.6 m to 13.4 m.
- Re-pitched the internal stairs to approximately 37–39 degrees.
- Moved the stair top away from the platform facade.
- Added a 6.7 m upper concourse between the stair top and platform doorway.
- Enlarged the street and platform door openings.
- Replaced the opaque lower platform facade with collision-enabled glazing, keeping ground-level exterior access sealed while making the platform exit visible from inside.
- Added blue doorway frames and non-shadow-casting interior lights.
- Kept the only low-level entrance through the street-facing station doors.

## Validation

- Full-width stair clearance sampled at 121 positions and three lateral offsets at all eight stations.
- A real PlayerController traversed street door → foyer → stairs → upper concourse → platform at all eight stations.
- All 67 focused tests passed across filtered batches.
- Lint and integrated simulation smoke tests passed.
