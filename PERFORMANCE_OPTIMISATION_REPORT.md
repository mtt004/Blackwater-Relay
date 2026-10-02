# Performance Optimisation Report

## Executive summary

This pass optimises the existing Three.js city and railway simulation without reducing entity counts, train formations, operational railway safety, or close-range detail. The largest measured improvements came from replacing repeated railway curve evaluation with immutable lookup tables, indexing block lookups and ownership, sharing immutable geometry/material resources, and instancing repeated HST and airport detail.

The deterministic CPU benchmark improved median simulation frame time by **24.5%**, railway median time by **55.0%**, detailed train formation placement by **87.5%**, and retained heap growth by **60.4%**. Dense-station drawable count fell by **44.7%** while triangle count and entity counts remained unchanged.

The overall 95th-percentile CPU frame-time target was not met: it improved by **6.7%**, not the requested 30%. Maximum CPU frame time also worsened in this run because of isolated collision/player/chunk outliers. These results are reported as measured rather than normalised or omitted.

## Measurement scope and limitations

- Baseline and final measurements use the same deterministic Node-based simulation harness: 12 trains, 68 road vehicles including buses, 72 pedestrians, 3 aircraft, 304 blocks, 304 signals and 45 platforms.
- The harness measures JavaScript simulation CPU time and scene structure. It does **not** create a real WebGL renderer, so median browser FPS, 1% low FPS, GPU render CPU submission time, and actual renderer draw calls could not be measured reliably in this environment.
- Headless Chromium was tested, but the environment could not initialise WebGL and imposed a local-site policy. No FPS number is inferred from Node timings.
- The in-game profiler added by this pass records real-browser render time, renderer calls, triangles, lines, points, geometry/texture counts, visible objects, heap use, frame percentiles and per-system timings. Launch with `?perf=1` or press **P** and use `globalThis.cityPerformance.exportSummary()` after each representative scenario.

## Original bottlenecks

1. Railway block lookup used repeated linear searches, and occupancy/reservation maintenance scanned the complete 304-block array for each train.
2. Train heads, coach positions, distant formations, platform checks and outline rendering repeatedly called spline point/tangent evaluation on static railway geometry.
3. Detailed HST interiors created individual meshes and largely duplicated geometry/material resources for seats, tables, luggage racks, wheels and vehicle components.
4. Traffic, pedestrians, collision queries, police tracking, player collision and station walking created temporary vectors, arrays, object literals and callback closures in hot paths.
5. Distant traffic, pedestrians and aircraft retained unnecessarily frequent behavioural or animation work despite already using visual LOD.
6. Airport lights, fence posts and aircraft windows produced many repeated scene nodes and drawables.
7. The minimap redrew static world geometry and HUD values even when the underlying value had not changed.
8. Chunk generation lacked detailed timing and could retain stale queued jobs after the player changed direction.

## Files changed

- `package.json`
- `scripts/performance-benchmark.mjs`
- `scripts/four-track-validation.mjs`
- `src/core/PerformanceMonitor.js (new)`
- `src/main.js`
- `src/player/PlayerController.js`
- `src/rail/HSTFactory.js`
- `src/rail/RailBlockSystem.js`
- `src/rail/RailCurveLookup.js (new)`
- `src/rail/RailNetwork.js`
- `src/rail/RailPlan.js`
- `src/rail/RailSystem.js`
- `src/systems/AirportSystem.js`
- `src/systems/PedestrianSystem.js`
- `src/systems/TrafficSystem.js`
- `src/systems/VehicleCollisionSystem.js`
- `src/ui/HUD.js`
- `src/vehicles/VehicleFactory.js`
- `src/vehicles/VehicleHitboxes.js`
- `src/world/WorldChunkManager.js`
- `benchmarks/performance-baseline.json (new)`
- `benchmarks/performance-final.json (new)`
- `BENCHMARKING.md (new)`
- `PERFORMANCE_OPTIMISATION_REPORT.md (new)`

## Implemented optimisations

### 1. Development performance instrumentation

- Added allocation-conscious rolling frame samples and per-system timers.
- Tracks simulation, renderer, railway, dispatcher, traffic, pedestrian, collision, police, airport, player, streaming/chunk generation, HUD and minimap time.
- Tracks median, p95, p99, long frames above 16.7 ms and severe frames above 33.3 ms.
- Captures renderer calls, triangles, lines, points, geometry/texture counts, visible-object count and browser heap when available.
- Instrumentation is off in normal operation unless explicitly enabled.
- Adaptive pixel ratio now distinguishes render pressure from simulation pressure instead of automatically reducing resolution for a CPU bottleneck.

### 2. Railway lookup and hot-path allocation removal

- Added 0.75-metre immutable typed-array lookup tables for position, tangent, normal, gradient and curvature on each resolved operational track.
- Replaced hot spline calls for train heads, coach placement, low-detail formations, outlines and platform-side sampling with in-place interpolation.
- Kept direct curve evaluation available for infrequent validation paths.
- Added reusable train/station scratch vectors and scalar outline updates.
- Added typed block-progress boundaries and binary block lookup.

### 3. Incremental block ownership and reservations

- Replaced repeated full-array block clearing/rebuilding with train-owned occupied/reserved block sets.
- Updates only changed ownership while retaining full-formation sampling, rear clearance, exclusive reservation ownership and signal protection.
- Dispatcher consistency passes remain; the railway is not made dependent solely on events that could be missed.

### 4. HST resource sharing and instancing

- Added shared immutable geometry/material caches for power cars, Mark 3 coaches, bogies, wheels, underframe and common details.
- Converted repeated detailed saloon seats, tables and luggage racks into static instanced batches.
- Preserved all 32-seat layouts, door animation, collision metadata, windows, detailed nearby interiors, traversable gangways and cab driving.
- Existing full/low/outline train tiers remain independent from operational train state.

### 5. Vehicle and static resource sharing

- Shared immutable body, wheel, tapered and low-LOD geometry/material resources across road vehicles.
- Froze static local child transforms while leaving wheels, pivots and doors mutable.
- Restricted dynamic shadow casting to full-detail nearby vehicle representations.
- Instanced runway lights, airport fence posts and aircraft windows; shared airport box geometry and froze static airport transforms.

### 6. Simulation relevance tiers

- Staggered distant non-critical traffic leader/lane behaviour while keeping nearby, junction, bus, emergency and lane-change-critical vehicles at full detail.
- Reduced distant pedestrian avoidance, traffic checks and limb animation while retaining crossing, station, incident and police behaviour near the player.
- Distant aircraft advance operational state analytically and reduce visual transform frequency; smooth full updates resume nearby.
- Train safety, occupancy, movement authority, service progress and dispatcher accuracy are not reduced by visual distance.

### 7. Spatial indexing and collision/player queries

- Reused traffic lane/junction/roundabout buckets and neighbour result structures.
- Reused vehicle collision polygon/AABB buffers and spatial-hash bucket storage.
- Indexed station walk surfaces and blockers, querying only nearby station geometry.
- Added reusable building/player collision scratch values and scoped train/station interior checks.
- Fixed a stale pooled collision-bucket defect found during benchmarking before accepting the pooling change.

### 8. HUD, minimap and chunk streaming

- Cached DOM references and updates HUD text only when displayed values change.
- Renders roads, railway, stations and static world data once to a minimap background canvas; normal updates draw only dynamic markers.
- Records queue/build timing, cancels stale chunk jobs and keeps the existing strict construction budget and low-detail coverage.
- Shared resources are not disposed by an individual chunk.

## Baseline versus final measurements

### CPU simulation timings

| Metric | Baseline | Final | Change |
|---|---:|---:|---:|
| Median simulation frame | 1.326 ms | 1.001 ms | -24.5% |
| Mean simulation frame | 1.750 ms | 1.511 ms | -13.7% |
| 95th-percentile simulation frame | 4.808 ms | 4.487 ms | -6.7% |
| 99th-percentile simulation frame | 5.833 ms | 5.853 ms | +0.3% |
| Maximum simulation frame | 8.861 ms | 12.053 ms | +36.0% |
| Railway median | 0.292 ms | 0.131 ms | -55.0% |
| Railway p95 | 4.249 ms | 3.552 ms | -16.4% |
| Traffic median | 0.542 ms | 0.452 ms | -16.7% |
| Traffic p95 | 0.970 ms | 0.875 ms | -9.7% |
| Pedestrian median | 0.400 ms | 0.309 ms | -22.8% |
| Pedestrian p95 | 0.563 ms | 0.508 ms | -9.9% |
| Collision median | 0.086 ms | 0.081 ms | -6.1% |
| Collision p95 | 0.188 ms | 0.194 ms | +3.5% |
| Police median | 0.004 ms | 0.003 ms | -22.3% |
| Airport median | 0.009 ms | 0.004 ms | -47.9% |
| Streaming median | 0.115 ms | 0.114 ms | -0.9% |
| Streaming p95 | 0.268 ms | 0.354 ms | +32.2% |
| Player median | 0.114 ms | 0.120 ms | +5.0% |

The final p99 remained effectively flat/slightly worse (+0.3%), and the maximum frame spike increased from 8.861 ms to 12.053 ms in this deterministic run. Collision, player and chunk-streaming outliers remain targets for follow-up.

### Focused railway benchmarks

| Metric | Baseline | Final | Change |
|---|---:|---:|---:|
| 200,000 block lookups | 97.064 ms | 18.140 ms | -81.3% |
| 120,000 train-head placements | 274.128 ms | 18.947 ms | -93.1% |
| 12,000 full-formation placements | 201.804 ms | 25.197 ms | -87.5% |
| Rail operations median | 0.175 ms | 0.077 ms | -55.9% |
| Rail operations p95 | 0.433 ms | 0.152 ms | -65.0% |
| Single dispatcher sample | 0.119 ms | 0.057 ms | -52.2% |
| Single occupancy sample | 0.073 ms | 0.013 ms | -82.4% |

### Scene structure and memory

| Metric | Baseline | Final | Change |
|---|---:|---:|---:|
| Retained heap growth | 177.5 MiB | 70.2 MiB | -60.4% |
| Operational scene objects | 40,846 | 21,957 | -46.2% |
| Operational visible objects | 1,974 | 1,805 | -8.6% |
| Operational drawables | 1,633 | 1,464 | -10.3% |
| Unique geometries | 35,509 | 2,286 | -93.6% |
| Unique materials | 4,433 | 1,657 | -62.6% |
| Estimated geometry bytes | 39.0 MiB | 2.9 MiB | -92.7% |
| Dense-station visible objects | 10,649 | 5,800 | -45.5% |
| Dense-station drawables | 9,442 | 5,223 | -44.7% |
| Operational triangles | 257,464 | 257,464 | +0.0% |
| Dense-station triangles | 415,396 | 415,396 | +0.0% |

Triangle counts are unchanged, which is deliberate: the draw-call and memory gains came from batching and resource sharing rather than deleting close-range detail.

The scene `drawables` figures are a deterministic structural proxy for potential draw calls. Actual WebGL renderer calls depend on frustum, material sorting, shadow passes and the current camera; use the in-browser profiler for final hardware-specific calls.

### FPS and render measurements

| Required metric | Result |
|---|---|
| Median FPS | Not measured: no functioning WebGL context in the execution environment |
| 1% low FPS | Not measured: no functioning WebGL context in the execution environment |
| Render CPU time | Instrumented in browser, but not available from the Node harness |
| Actual renderer draw calls | Instrumented in browser; structural dense-station drawable proxy improved 44.7% |
| Active textures | Instrumented in browser; no reliable Node renderer value |

## Acceptance criteria outcome

- **Median CPU frame time:** 24.5% lower. This narrowly misses the 25% target by 0.5 percentage points.
- **95th-percentile CPU frame time:** 6.7% lower. The 30% target was not met overall, although rail-operations p95 improved 65.0%.
- **Dense-area drawables:** 44.7% lower, exceeding the 30% structural draw-call target.
- **Short-lived/resource pressure:** retained heap growth 60.4% lower, unique geometries 93.6% lower and estimated geometry bytes 92.7% lower.
- **Chunk construction:** maximum observed optimised chunk build was 3.219 ms, below the existing 4.5 ms budget; streaming p95 nevertheless worsened and remains a consistency issue.
- **Entity counts:** unchanged in the deterministic benchmark.
- **Close-range detail:** triangle counts unchanged; detailed interiors, doors, stations and nearby entities retained.
- **Gameplay and railway safety:** all explicit validators and 100 regression assertions passed.

## Tests run

- JavaScript lint: **passed**, 44 JavaScript files.
- Core regression suite: **100/100 assertions passed**. Heavy tests were run in isolated deterministic ranges/individual processes after the monolithic process exceeded its cumulative timeout. No timeout was counted as a pass.
- Integration smoke: **passed** — 36 roads, 12 trains, 37 traffic vehicles, 48 pedestrians, 3 aircraft and 1 police unit.
- Railway upgrade geometry/passenger validator: **passed** — 2 loops, 10,404 route samples, 13 bridges, 20 stop checks, 100 boarding/alighting checks, all 5 coaches traversed while moving, maximum gradient 3.46%.
- Four-track validation: **passed** — 2 loops, 9 stations, 12 trains, 4 tracks and 5 platforms per station.
- Station-road/fleet validation: **passed** — 9 road-safe station halls, 1.15 m minimum clearance, 3 underpass halls and 12 HST services.
- Station stair traversal: **passed** — all 9 station halls with both flights, landing and complete street-to-platform traversal.
- Rail operations: **passed** — 304 segments/blocks/signals, 45 platforms, 12 services, 10 protected transfers, maximum 2 waiting trains, maximum 1 active junction route and no routine recovery/teleportation.

The four-track validator contained an incomplete canvas mock that classified an idle `No train` platform display as a missing route map. The harness was corrected to initialise station information and distinguish idle from incomplete live service data; operational platform rules were not weakened.

## Optimisations considered but rejected or deferred

- **Full event-only dispatcher rewrite:** rejected for this pass. Indexed/incremental occupancy delivered the largest safe gain while retaining a periodic consistency pass; making safety solely event-dependent would increase missed-event risk.
- **Web Worker chunk construction:** deferred. The measured maximum final build was already below the 4.5 ms budget, while converting procedural geometry into transferable worker jobs would be a broad architectural change. Streaming-tail variance still justifies a focused future worker experiment.
- **Broad static world geometry merging:** limited to high-value repeated assets. Aggressive global merging would complicate chunk visibility, eviction, collision ownership, LOD and interaction boundaries.
- **Removing HST interiors or entity counts:** rejected. Instancing and shared resources achieve reductions without deleting gameplay detail.
- **A separate fully duplicated medium HST graph:** not added. Existing detailed, low and outline tiers plus interior visibility already separate operational and visual state; an additional duplicated hierarchy could increase memory without a proven bottleneck benefit.
- **Lowering railway safety update rates adaptively:** rejected. Block occupancy, authority, station and interlocking correctness remain independent of quality adaptation.

## Remaining bottlenecks and risks

- Chunk-streaming p95 increased by 32.2% in the deterministic movement scenario even though median and maximum build budget remained controlled. Job scheduling and scene attachment remain likely tail-latency sources.
- Collision mean/p95 and maximum outlier did not improve consistently; the spatial hash is cheaper at the median, but rare dense-cell pairs still cause spikes.
- The player system produced a 5.733 ms isolated outlier in the final benchmark. Station/walk collision cache invalidation should be profiled in a real browser trace.
- Overall frame p99 did not improve. Railway gains are substantial, but non-rail tail spikes now dominate.
- The in-game visible-object counter traverses the scene only while instrumentation is enabled; it intentionally remains disabled in production.
- Shared resource ownership is now more important. Future disposal code must continue to distinguish immutable shared resources from unique chunk/entity resources.
- Real GPU limits, shadow-pass draw calls, transparency overdraw and hardware-specific FPS must still be captured on representative target hardware using the supplied profiler.

## Preserved functionality confirmation

The implementation retains both four-track loops, all twelve operational HST services, blocks, signalling, dispatcher, movement authority, Industrial Exchange interlocking, exclusive platforms, full-formation occupancy, correct platform-side doors, HST interiors, boarding/alighting, moving-train attachment, five-coach traversal, cab driving, stations and access paths, bridges and road clearance, UK left-hand traffic, buses and passengers, pedestrians, police and offences, collisions, airport/aircraft, incidents, walking/driving, weather, HUD/minimap, chunk streaming and all existing visual LOD tiers.
