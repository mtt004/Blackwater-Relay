# Aircraft, Graphics Quality and Performance Optimisation Report

## Scope

This change implements the aircraft-speed, aircraft-smoothing and graphics-quality work requested for the current ten-aircraft Blackwater Relay build without reducing simulation populations, shortening the Eastmere–Merehaven route, or changing railway/runway/stand authority logic.

Research was performed against current official Three.js documentation for `LOD` hysteresis, `InstancedMesh`, static matrix updates and `WebGLRenderer`/manual shadow updates. The vendored Three.js build is r180 and already supports the required features, so no new runtime dependency was added.

## Aircraft movement

- `CONFIG.aircraftSpeedMultiplier = 1.75`.
- The multiplier is applied after state-specific base/override speed resolution, so parked/turnaround/boarding/hold states remain zero-speed.
- En-route base speed remains 88 world units/s; resolved cruise is 154 world units/s.
- The fixed 60 Hz simulation remains authoritative.
- Each aircraft stores previous/current simulation positions and quaternions.
- Each display frame interpolates position and uses quaternion slerp for orientation.
- Bank is exponentially damped in a frame-rate-independent form.
- Ground conflicts use logical simulation positions, never interpolated render positions.
- Passenger camera/world position is kept coherent for simulation queries and is then recomputed from the interpolated aircraft mesh before WebGL rendering.
- The old ~0.12 s distant-aircraft transform throttle has been removed, eliminating the ~8.3 Hz visual stepping that would otherwise be amplified by the higher speed.

The aviation validator's repeated passenger round trip fell from 541.0 s on the untouched ten-aircraft build to 322.0 s after the change (about 1.68x faster end-to-end). Boarding and turnaround timers were not shortened.

## Graphics quality manager

Persistence key: `blackwater-relay-quality`. Unknown/missing values normalize to `medium`. Preset changes persist immediately and are event-driven rather than polled.

| Setting | Low | Medium (default) | High | Ultra |
| --- | --- | --- | --- | --- |
| Render scale min/max/start | 0.50 / 0.70 / 0.65 | 0.62 / 1.00 / 1.00 | 0.75 / 1.25 / 1.00 | 1.00 / 1.50 / 1.15 |
| Sun shadows | off | on | on | on |
| Shadow map | 256 | 512 | 1024 | 2048 |
| Shadow refresh | 24 frames | 12 frames | 8 frames | 4 frames |
| Aircraft Full / Medium / Low / Far distance | 180 / 650 / 1700 / 4200 | 320 / 1000 / 2500 / 6500 | 520 / 1500 / 3600 / 8200 | 760 / 2200 / 4800 / 9800 |
| Aircraft LOD hysteresis | 0.12 | 0.10 | 0.09 | 0.08 |
| Aircraft dynamic-light range | 110 | 320 | 520 | 760 |
| Aircraft shadow / detailed-shadow range | 180 / 90 | 520 / 260 | 820 / 420 | 1200 / 650 |
| Building halo | 38 | 58 | 76 | 92 |
| Ahead chunks | 1 | 2 | 2 | 3 |
| Detailed-chunk cache | 12 | 18 | 22 | 26 |
| Full vehicle range | 64 | 88 | 116 | 145 |
| Building outline range | 820 | 1050 | 1250 | 1450 |
| Road outline range | 1200 | 1500 | 1700 | 1850 |
| Chunk transition grace | 0.90 s | 1.15 s | 1.30 s | 1.45 s |
| Train full / interior / low range | 260 / 64 / 900 | 360 / 72 / 1120 | 460 / 92 / 1380 | 620 / 120 / 1680 |
| Train low / outline update step | 1/8 / 1/4 s | 1/12 / 1/6 s | 1/15 / 1/8 s | 1/18 / 1/10 s |
| Rail visibility refresh | 1/4 s | 1/5 s | 1/6 s | 1/8 s |
| Station full / low / pedestrian range | 190 / 680 / 165 | 250 / 900 / 230 | 330 / 1080 / 300 | 430 / 1320 / 390 |
| Traffic shadow range | 92 | 140 | 185 | 235 |
| Distant pedestrian animation stride | 2 | 1 | 1 | 1 |
| Minor airport detail | off | on | on | on |

Render scale is still capped by actual device pixel ratio. Adaptive resolution remains active inside each preset's min/max range. Changing quality resets the adaptive sample window and safely disposes/reallocates the sun shadow render target only when shadow-map size changes.

## Aircraft rendering optimisation

- Added Full, Medium, Low and Far aircraft representations with hysteresis.
- Player-occupied aircraft are forced to Full detail.
- Full interiors remain available for boarding, sitting, walking and window viewing.
- Repeated seat cushions, backs, headrests, trays, armrests, legs and belts now use `InstancedMesh`; seat interaction metadata remains separate.
- Common primitive geometry and major wing/tail/engine geometry are reused.
- Dynamic aircraft PointLights are range/preset gated while visible emissive/light geometry remains.
- Detailed aircraft shadows are limited by tier/range; medium/low proxies can supply cheaper shadow casters.
- Transparent full passenger glazing is retained close-up and omitted in cheaper proxies.
- Static airport minor-detail groups are toggled as groups on quality changes rather than being touched every frame.

A focused Node scene traversal with the camera at Eastmere measured the aircraft scene before/after Medium LOD application as:

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Visible objects | 6,898 | 1,869 | -72.9% |
| Drawable meshes/instances | 6,845 | 1,816 | -73.5% |
| Visible triangles | 222,846 | 74,154 | -66.7% |

The resulting Medium snapshot had 2 Full, 1 Medium, 1 Low, 2 Far and 4 Hidden aircraft, with only 2 aircraft dynamic-light sets active. This is a Node scene-structure measurement, not a WebGL draw-call measurement.

## Built-in benchmark

The historical `benchmarks/performance-final.json` was not used as the baseline because it represents only three aircraft. A fresh baseline was generated from an untouched copy of this supplied ten-aircraft archive. The benchmark uses a temporary local Node shim pointing at the project's own vendored Three.js r180; this shim is not included in the project and `package.json` remains unchanged.

Three runs were taken before and after; CPU timing below is the median of those runs. Scene structure is deterministic.

| Metric | Before | After | Change |
| --- | ---: | ---: | ---: |
| Entities: aircraft | 10 | 10 | unchanged |
| Scene objects | 29,909 | 27,681 | -7.4% |
| Visible objects | 8,610 | 6,172 | -28.3% |
| Drawable meshes/instances | 8,227 | 5,777 | -29.8% |
| Unique geometries | 3,400 | 2,883 | -15.2% |
| Unique materials | 2,267 | 2,009 | -11.4% |
| Geometry bytes | 4,360,584 | 3,759,004 | -13.8% |
| Median heap delta | 93,950,200 B | 88,298,640 B | -6.0% |
| Frame mean | 2.275 ms | 2.408 ms | +5.9% |
| Frame median | 1.545 ms | 1.724 ms | +11.6% |
| Frame p95 | 6.858 ms | 6.527 ms | -4.8% |
| Frame p99 | 9.682 ms | 10.383 ms | +7.2% |
| Airport update mean | 0.044 ms | 0.077 ms | +72.4% |

The CPU timing is intentionally reported without claiming an FPS gain. The airport fixed-tick cost increased by only a few hundredths of a millisecond because all aircraft now maintain authoritative previous/current transforms every fixed tick instead of allowing distant visuals to update only every ~0.12 s. That extra CPU work is what enables smooth display-frame interpolation. The render-structure reductions are much larger and target the actual GPU/draw-call problem.

A headless Chromium `?perf=1` run was attempted, but the full game did not reach/export a stable renderer summary in the execution window. Therefore no WebGL draw-call/FPS improvement is claimed.

## Validation

Passed on the modified project (using the temporary vendored-Three Node shim where the existing Node scripts require bare-package `three`):

- `npm run lint`: passed; 57 JavaScript files; one synchronized cache tag `20261001-aircraft-quality`.
- Targeted quality/aircraft tests: 11 passed, covering default/fallback persistence, all four presets, 1.75 speed multiplier, ten-aircraft invariant, far LOD, forced Full occupied-aircraft LOD, quality-state invariance, boarding/cabin/windows/seats/headroom.
- `npm run smoke`: passed with 36 roads, 12 trains, 37 traffic vehicles, 48 pedestrians, 10 aircraft and a police unit.
- `npm run validate:railway`: passed (2 loops, 10,404 route samples, 13 bridges, station/direction/boarding checks).
- `npm run validate:operations`: passed in a separate run (304 blocks/signals, 45 platforms, 12 services, protected transfers, no operational regression).
- `npm run validate:station-collisions`: passed (6,885 probes, zero false blocks).
- `npm run validate:aviation`: passed (10 aircraft, 19 stress-run arrivals, minimum service 1/1, repeated passenger round-trip 322.0 s).

The monolithic `npm test` / `npm run check` wrapper did not complete inside a single execution timeout; the untouched supplied build also times out under the same test-runner constraint. The relevant targeted tests and dedicated validators above were therefore run independently rather than treating the timeout as success.

## Important files

Substantive changes are concentrated in:

- `src/core/QualityManager.js` (new)
- `src/config.js`
- `src/main.js`
- `src/core/PerformanceMonitor.js`
- `src/systems/AirportSystem.js`
- `src/world/WorldChunkManager.js`
- `src/rail/RailSystem.js`
- `src/systems/TrafficSystem.js`
- `src/systems/PedestrianSystem.js`
- `src/ui/HUD.js` (cache-tag synchronization only)
- `index.html`
- `styles.css`
- `tests/tests.js`

Other JavaScript files only received the synchronized cache-busting tag required by the repository's lint convention.
