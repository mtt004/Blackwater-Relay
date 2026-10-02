# Hitbox Recalibration Plan

## Objective

Tighten collision and interaction volumes to the visible solid geometry of each object without weakening railway safety, allowing clipping, or changing operational geometry.

## Audit findings before source edits

### Road vehicles

The vehicle-to-vehicle compound footprints are already narrower and shorter than the complete rendered bounds because mirrors, tyres, lamps and number plates protrude beyond the main body. They should not be blindly reduced. Each category will instead be checked against its solid body silhouette and tuned individually, with decorative protrusions excluded unless they should physically collide.

Categories to calibrate independently:

- saloon car
- hatchback
- sports car
- SUV
- taxi
- van
- emergency van
- bus
- articulated visual lorry profile (cab and trailer remain separate polygons)

### Trains

External walking collision currently uses one padded rectangle per vehicle. This overstates tapered Class 43 noses and the recessed gangway ends of Mark 3 coaches. It will be replaced with vehicle-specific compound local footprints:

- Class 43: engine-room rectangle plus progressively tapered nose sections.
- Mark 3: main coach body plus narrower vestibule/gangway end sections.
- Open platform-side door apertures remain passable only while correctly berthed and open.

Boarding distance and surface-distance calculations will use the same profiles.

### Station structures

Station walls are already split around front and rear door apertures, but every wall blocker adds an extra 35 mm and the lift blocker uses the exact outer glass-box dimensions. These will be recalibrated to the rendered solids with a small numerical tolerance rather than gameplay-scale padding.

The following will be checked individually:

- front left/right walls
- front lintel
- rear left/right walls
- rear lower glazed panel
- rear lintel
- side walls
- lift towers
- stairs, landings and platform links (walk surfaces, not solid blockers)

### Procedural buildings and landmarks

Ordinary buildings already use oriented wall footprints inset by 80 mm. They will be verified by district and retained where correct. Special landmarks will be explicit:

- landmark tower: podium footprint only
- decorative fountain: no blocker unless added deliberately
- non-solid roofs, canopies and overhangs: excluded from ground collision

### Player clearance versus object hitboxes

Object geometry and actor clearance will be separated conceptually:

- object hitboxes fit the solid object
- walking body radius remains a small explicit player clearance
- camera clearance remains separate and may be larger to prevent near-plane clipping
- vehicle collision tolerance remains a small numerical epsilon only

This avoids solving camera or character comfort by inflating every object.

## Implementation sequence

1. Add reusable local compound-hitbox helpers for point, circle and distance queries.
2. Add explicit per-object collision profiles and metadata.
3. Replace rectangular train walking collision and boarding distance with compound profiles.
4. Recalibrate station blocker dimensions to the visible meshes.
5. Review and tune each road-vehicle category independently; do not reduce profiles that are already tighter than the body.
6. Add debug rendering for building/station/train collision shapes, alongside the existing vehicle debug view.
7. Add tests comparing collision profiles with known rendered dimensions and verifying empty tapered/recessed regions are not blocked.
8. Run lint, focused collision tests, full deterministic regressions, railway passenger/door validation, station traversal, and integration smoke.

## Acceptance checks

- No collision in empty Class 43 nose-corner space.
- No collision beyond recessed Mark 3 gangway ends.
- Open passenger doors remain traversable only on the platform side.
- Closed doors and train sides remain solid.
- Station door openings remain fully traversable.
- Wall and lift blockers do not extend visibly beyond their meshes.
- Player cannot enter solid walls, train shells or building façades.
- Vehicle collisions remain stable and category-specific.
- Building, station, stairs, footbridge and passenger traversal tests continue to pass.
