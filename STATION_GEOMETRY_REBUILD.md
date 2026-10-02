# Station geometry rebuild

## Defects visible in the supplied screenshots

The damaged station was not the result of a single misplaced object. Several independent geometric assumptions failed at once:

1. **Straight station meshes on curved track.** A complete platform and canopy were represented by long straight boxes aligned only at the station midpoint. At the most curved station, the railway changes heading by about 19 degrees across the platform and departs by more than five metres from its midpoint chord. The straight slabs therefore cut across the rails and one another.
2. **Stations on railway ramps.** The grade-separation profile raised the railway over roads, but station selection did not require the full platform footprint to be level. Platform components sampled at different positions consequently received incompatible heights and pitches.
3. **Unbounded stair geometry.** Each stair tread was a box extending from ground level to the tread top. On an elevated station, those boxes became a repeated row of large triangular-looking concrete wedges.
4. **Mixed placement frames.** Some access components followed the nearest road direction while others followed only the station-centre tangent. On a curved site this allowed stairs, buildings and platform structures to cross one another.
5. **No complete forecourt clearance test.** Parking and bus-stop placement checked too little of each footprint, allowing visually plausible centre points to hide rail- or building-edge conflicts.

## Implemented design

Every station is now generated from the railway's local coordinate frame at the exact longitudinal position of each component.

- Platforms are assembled from short modules of at most 4.21 metres.
- Platform edges, outer fencing and walking surfaces follow the same sampled curve.
- Canopies use short bays with bounded posts rather than a single stretched roof.
- The railway profile is flattened over the complete platform footprint and blended back into the bridge profile under a maximum-gradient policy.
- Ground stairs use one thin inclined slab, shallow horizontal treads, handrails and side stringers.
- Footbridges, platform stairs and lifts use a shared station-local frame and maintain train clearance.
- Station buildings and lift towers are physical walking blockers.
- Car parks and bus shelters are placed only after testing their complete footprint against roads, buildings, station structures and the railway corridor.

## Acceptance metrics

The final generated layout contains eight rebuilt stations. For every station:

- platform gradient is zero within numerical precision;
- the longest platform module is between 4.13 and 4.21 metres;
- each pair of platforms contains at least 48 curve-following modules;
- each pair of canopies contains at least 20 bounded modules;
- the platform edge remains more than 1.3 metres beyond the outer running rail;
- footbridge underside clearance above the train envelope exceeds 1.45 metres;
- the ground access stair rises more than 6 metres over a run exceeding 17 metres;
- a road-accessible entrance, car park and bus stop are present;
- station buildings and lifts block pedestrian movement;
- no station component produces a non-finite scene transform.

The packaged focused suite passes 47 tests. A full scene-construction smoke test reports no world-definition errors, no road–rail layout errors, no support-clearance violations and no invalid transforms.
