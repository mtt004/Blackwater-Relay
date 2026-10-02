# Hitbox Recalibration Report

## Outcome

The collision pass was planned and measured before editing. It did not apply a global shrink factor. Every authoritative collision category was compared with the generated object that it represents, and only genuine overstatement was reduced.

The largest corrections were the old padded rectangular HST footprints and station-structure blockers. Road-vehicle footprints were deliberately retained after measurement showed that they were already smaller than their complete rendered objects.

## Method

The audit used the same procedural factories as the simulation:

- each road-vehicle category was generated with `VehicleFactory`;
- Class 43 and Mark 3 vehicles were generated with `HSTFactory`;
- all nine stations and their blockers were generated through `CityBuilder` and `RailSystem`;
- procedural building colliders were read from the authoritative city output;
- rendered bounds excluded collision-debug geometry;
- compound polygon areas and extents were calculated directly from the profiles.

The reproducible command is:

```bash
npm run audit:hitboxes
```

It writes the raw measurements to `benchmarks/hitbox-audit-final.json`.

## Object-by-object decisions

### Road vehicles

All road-vehicle profiles were retained. The negative deltas below mean the hitbox is already smaller than the complete rendered object, which includes mirrors, tyres, lamps and number plates.

| Object | Rendered width | Hitbox width | Rendered length | Hitbox length | Decision |
|---|---:|---:|---:|---:|---|
| Saloon car | 2.088 m | 1.860 m | 4.820 m | 4.620 m | Retained |
| Hatchback | 2.049 m | 1.820 m | 4.350 m | 4.150 m | Retained |
| Sports car | 2.166 m | 1.940 m | 4.680 m | 4.480 m | Retained |
| SUV | 2.186 m | 1.960 m | 5.020 m | 4.820 m | Retained |
| Taxi | 2.088 m | 1.860 m | 4.860 m | 4.660 m | Retained |
| Van | 2.274 m | 2.050 m | 5.496 m | 5.340 m | Retained |
| Emergency van | 2.303 m | 2.080 m | 5.578 m | 5.420 m | Retained |
| Bus | 2.735 m | 2.520 m | 11.061 m | 10.800 m | Retained |
| Lorry | 2.735 m | 2.520 m | 12.929 m | 12.582 m | Retained |

Shrinking these profiles further would permit visible body overlap. Their tapered or compound shapes already exclude non-structural protrusions.

### HST vehicles

The old walking collision used one rectangle per vehicle with 0.10 m added to each side and end.

| Object | Old padded rectangle | New profile bounds | Old area | New area | Reduction |
|---|---|---|---:|---:|---:|
| Class 43 power car | 2.94 × 14.10 m | 2.81 × 13.61 m, tapered nose | 41.454 m² | 35.917 m² | **13.36%** |
| Mark 3 coach | 2.94 × 15.30 m | 2.86 × 14.55 m, local door casings | 44.982 m² | 40.326 m² | **10.35%** |

The Class 43 profile follows the engine-room body and changing nose width, while preserving the solid front light band and coupler region. Empty outer nose corners are no longer blocked.

The Mark 3 profile ends at the rendered 14.55 m lower shell. Its additional width exists only beside the four passenger-door casings, rather than along the entire coach.

The same profiles now drive walking collision and distance-to-vehicle interaction calculations.

### Station structures

Previously, many station wall blockers added 35 mm beyond the rendered wall face. All named blocker types now sit 12 mm inside every rendered box face, giving 24 mm total dimensional clearance.

| Object type | Rendered cross-section | Final hitbox cross-section |
|---|---:|---:|
| Front/rear wall section | 3.750 × 0.300 m | 3.726 × 0.276 m |
| Front/rear lintel | 3.300 × 0.300 m | 3.276 × 0.276 m |
| Side wall | 0.300 m thick | 0.276 m thick |
| Ticket desk | 2.450 × 0.920 m | 2.426 × 0.896 m |
| Interior bench | 2.150 × 0.550 m | 2.126 × 0.526 m |
| Vending machine | 0.920 × 0.820 m | 0.896 × 0.796 m |
| Lift tower | 3.200 × 3.200 m | 3.176 × 3.176 m |

Furniture blockers also begin at their actual 0.04 m rendered base height. The bench now has an explicit blocker; it was visible but previously omitted from the station collision set.

### Buildings and landmarks

The 196 procedural building colliders were retained because they already use façade-aligned oriented boxes inset by 0.08 m per face. Their larger world-axis bounds remain broad-phase search envelopes only and do not block the player.

The landmark tower remains matched to its visible 46 m podium with a 45.84 m collision footprint.

### Player and camera clearance

Object dimensions are now separated from actor comfort margins:

| Clearance | Before | After |
|---|---:|---:|
| Walking body radius | 0.30 m | 0.20 m |
| Third-person camera clearance | 0.60 m | 0.38 m |
| Vehicle/building numerical padding | 0.035 m | 0.035 m |
| Train-profile numerical padding | n/a; object rectangle inflated by 0.10 m | 0.035 m explicit clearance |

This prevents camera or player comfort from being implemented by enlarging every object hitbox.

## Implementation details

- Added `LocalCollisionProfile.js` for reusable local compound-polygon point and distance queries.
- Added immutable Class 43 and Mark 3 collision profiles to `HSTFactory`.
- Replaced rectangular train walking collision and rectangular boarding-distance calculations in `RailSystem`.
- Named and recalibrated every station wall, lintel, lift and furniture blocker.
- Added one combined station debug mesh and one combined building debug mesh.
- Extended the B-key overlay to show road vehicles, buildings, stations and trains together.
- Debug geometry is created lazily on first use and shared between matching train types.
- Added a reproducible audit script and raw JSON evidence.

## Files changed

- `src/collision/LocalCollisionProfile.js` — new local compound-profile query and shared debug helpers.
- `src/rail/HSTFactory.js` — immutable Class 43 and Mark 3 profiles.
- `src/rail/RailSystem.js` — profile-based train collision, fitted station blockers and unified debug rendering.
- `src/player/PlayerController.js` — explicit walking/camera clearance and building-collider debug.
- `src/systems/VehicleCollisionSystem.js` — lazily-created vehicle debug geometry.
- `src/main.js` — unified B-key collision overlay.
- `tests/tests.js` — profile and station-fit regressions.
- `scripts/audit-hitboxes.mjs` and `package.json` — reproducible object audit.
- `benchmarks/hitbox-audit-final.json` — raw final measurements.
- `README.md`, `CHANGELOG.md`, `HITBOX_RECALIBRATION_PLAN.md` and this report — controls, plan and implementation record.

## Correctness validation

- JavaScript lint: **passed**.
- Regression tests: **102/102 passed**, using isolated deterministic processes where cumulative procedural construction exceeded the runner limit.
- Integration smoke: **passed** with 36 roads, 12 trains, 37 traffic vehicles, 48 pedestrians, 3 aircraft and 1 police unit.
- Four-track validation: **passed**.
- Railway geometry/passenger validation: **passed** with 10,404 route samples, 100 boarding/alighting checks and traversal through all five moving coaches.
- Railway operations validation: **passed** with 304 blocks, 304 signals, 45 platforms and 12 services.
- Station-road/fleet validation: **passed** for all nine station halls.
- Complete station stair traversal: **passed** for all nine enclosed dog-leg halls.

Specific new assertions verify:

- the empty outer Class 43 nose corner is not blocked;
- the Class 43 light band remains solid;
- the Mark 3 profile does not extend beyond the rendered coach end;
- Mark 3 door-casing width applies only at door positions;
- station walls, lifts and benches do not exceed rendered dimensions.

## Preserved behaviour

The changes do not alter train formations, route curves, blocks, signalling, dispatcher authority, platform reservations, interlocking, door-side logic, railway occupancy, road lanes, traffic routing or visual LOD state.

Passenger boarding, alighting, moving-train attachment, five-coach traversal, station stairs, footbridges, car entry/exit, road collisions, bus operation and police operation remain functional in the automated validations.

## Known limitations

- Road-vehicle collision remains an intentional ground-plane compound footprint rather than full 3D mesh collision.
- Train profiles are height-bounded 2.5D volumes; they do not model crawlable gaps under bogies or couplers.
- Aircraft, most street furniture and decorative props do not currently own physical hitboxes, so there was no oversized collision volume to recalibrate for those objects.
- A real-browser visual pass with the B-key overlay is still recommended on the target machine because the available headless environment does not provide reliable WebGL rendering.
