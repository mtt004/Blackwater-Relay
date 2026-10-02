# Station Stair Collision-Volume Fix

## Problem confirmed from the supplied screenshot

The orange B-key outline around the platform-footbridge stairs formed a tall prism from the inclined stair surface down to platform level. This exposed two related defects:

1. The debug overlay represented the stair as a floor-height box rather than the thin visible stair structure.
2. The walking resolver used the staircase's complete XZ projection as a blocker whenever the stair surface was too high to step onto. It did not test whether the player's body actually reached the underside of the elevated stairs.

As a result, clear space beneath the upper part of a staircase behaved like an invisible wall.

## Correct collision model

Each stair surface now stores the dimensions of the visible structural envelope:

- visible tread width and run;
- 0.32 m structural depth for the tread/slab envelope;
- 0.04 m head-clearance tolerance;
- only 0.02 m numerical tolerance around the visible XZ footprint.

Walking resolution now distinguishes three cases:

1. **Reachable tread:** when the stair top is within the normal 0.58 m step-up range, the player moves onto the stair surface.
2. **Solid stair intersection:** when the stair is too high to step onto and the player's body intersects its underside, movement is rejected with `stair-underside`.
3. **Clear space beneath stairs:** when the player's head is below the visible underside with the 0.04 m clearance margin, the stair is ignored and the underlying platform/floor remains walkable.

The resolver no longer treats the staircase as a solid column extending to the ground.

## Debug visualisation

The orange B-key overlay now draws a thin sloped collision volume:

- top perimeter at the walkable stair surface;
- bottom perimeter 0.32 m beneath it;
- short vertical edges joining those surfaces.

It no longer draws 5 m vertical edges down to platform level. Depth testing remains disabled so the authoritative volume remains visible through the rendered structure.

## Diagnostics

A blocked stair contact now records:

- reason: `stair-underside`;
- stair top height at the contact;
- underside height;
- player's body-top height;
- stair structural depth;
- head-clearance tolerance;
- visible and collision footprint dimensions.

This makes it possible to distinguish a real underside intersection from a false floor-level obstruction.

## Measurements

The analytical audit covers all 45 platform-footbridge staircases across the nine stations.

| Metric | Previous behaviour | Fixed behaviour | Change |
|---|---:|---:|---:|
| Projected floor-level blocked area | 1,026.45 m² | 346.77 m² | **-66.2%** |
| Clear projected space restored | — | 679.68 m² | **+679.68 m²** |
| Tallest debug vertical edge | 5.02 m | 0.32 m | **-93.6%** |
| Headroom probes incorrectly blocked | 4,050 | 0 | **eliminated** |

The remaining 346.77 m² is the low section where a 1.72 m player body genuinely intersects the visible stair slab/treads. The stair footprint width and ends remain limited to the visible geometry plus 0.02 m numerical tolerance.

## Files changed

- `src/rail/RailSystem.js`
- `src/player/PlayerController.js`
- `tests/tests.js`
- `scripts/station-walk-collision-validation.mjs`
- `scripts/stair-collision-volume-audit.mjs`
- `package.json`
- release-wide browser module cache tag

## Validation

- JavaScript lint passed.
- 103/103 regression assertions passed in isolated deterministic ranges.
- 17/17 diagnostics tests passed.
- Whole-world stair-volume validator passed:
  - 45 stairs;
  - 6,885 detailed probes;
  - 4,050 valid under-stair headroom points;
  - 2,025 genuine structure-intersection points;
  - zero false headroom blocks;
  - zero missing solid intersections;
  - zero outside-footprint stair blocks.
- Complete station stair traversal passed for all nine stations.
- Integration smoke passed.
- Railway geometry/passenger validation passed.
- Railway operations validation passed.
- Four-track validation passed.
- Station-road and fleet validation passed.

## Preserved behaviour

The change does not alter station geometry, train operations, platforms, routes, railway occupancy, signalling, doors, passenger attachment, traffic, collisions outside station stairs, or entity counts. It changes only how the walking solver tests a player's vertical body envelope against an elevated stair structure.
