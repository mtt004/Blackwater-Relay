# Diagnostics Logging and Export System — Implementation Report

## 1. Architecture summary

A dedicated `DiagnosticsManager` now owns diagnostics state, collection, aggregation, serialisation and export. Gameplay systems only submit structured observations; they do not know how files are built or downloaded.

The manager has two effective runtime states: **disabled** and **enabled**. F8 starts a clean session and F8 again stops it, finalises all contact lifecycles, builds one formatted schema-v1 JSON document, starts a browser download and clears the completed record buffers after the download has been initiated successfully.

The existing B-key hitbox overlay remains independent. It can be used while recording, but enabling it neither starts nor stops a diagnostics session.

### Disabled hot path

All hot reporting APIs begin with an enabled-state guard. While disabled:

- No events, collisions, warnings, errors or performance samples are appended.
- No diagnostic snapshots or collision polygons are constructed by the guarded integration hooks.
- No diagnostics status DOM exists or updates.
- `error` and `unhandledrejection` listeners are not registered.
- Console methods are not replaced or intercepted.
- No JSON serialisation or scene traversal is performed.
- Previous completed-session record arrays are not retained.

Calls such as `beginSystem()` and `endSystem()` remain present in the main loop, but return immediately while disabled and do not allocate records.

### Enabled collection

The manager records structured state changes, collision contact lifecycles, sampled performance rows, detailed long/forced frames, warnings and errors. Runtime state observers are throttled and compare compact previous-state maps so unchanged railway, traffic and world state is not logged repeatedly.

Performance sampling is capped at 8 Hz for ordinary frames. Long frames and frames associated with collisions, chunk generation or major events can force a detailed record.

### Export and failure handling

The stopped session is converted to human-readable JSON only once, at shutdown. Export uses `Blob`, `URL.createObjectURL()` and a temporary `<a download>` element; nothing is uploaded or stored in `localStorage`.

On a successful download initiation, full session buffers are cleared and only the compact last summary remains available through `getSummary()`. If generation or download initiation fails, the pending stopped-session export is retained and `retryExport()` can attempt the same export again. Starting a replacement session is refused while an unsaved failed export is pending, preventing silent data loss.

## 2. Files changed

- `src/core/DiagnosticsManager.js` — New central session lifecycle, bounded buffers, safe serialisation, status UI, error listeners, performance sampling, collision lifecycle tracking and browser export.
- `src/main.js` — F8 lifecycle, global development helpers, subsystem timing hooks, configuration capture, observer integration and active-session startup errors.
- `src/core/Input.js` — Allows F8 to be consumed as an edge-triggered control without interfering with existing keys.
- `src/systems/VehicleCollisionSystem.js` — Deduplicated dynamic collision lifecycle records with profile, vertices, impact and resolution metadata.
- `src/player/PlayerController.js` — Player car/building, walking/building, station blocker and train-exterior collision records plus vehicle mode events.
- `src/rail/RailSystem.js` — Passenger/cab transitions, coach traversal and train-interior blocker diagnostics.
- `src/rail/RailInterlocking.js` — Route request, acceptance, rejection, entry, transfer and release events.
- `src/rail/RailDispatcher.js` — Explicit warning for stale-reservation recovery after abnormal signal waiting.
- `src/systems/TrafficSystem.js` — Spawn/despawn, route, lane-change, bus-stop and stuck-recovery events.
- `src/systems/TransitSystem.js` — Bus passenger exchange, boarding and alighting events.
- `src/systems/PoliceSystem.js` — Offence and pursuit lifecycle events.
- `src/systems/IncidentSystem.js` — Incident response and resolution events.
- `src/world/WorldChunkManager.js` — Chunk request, cancellation, generation timing and eviction events.
- `index.html` — Documents the F8 control in the in-game controls panel.
- `README.md` — Adds Diagnostics Mode usage and development API.
- `package.json` — Adds diagnostics test, benchmark and example-generation commands.
- `scripts/diagnostics-tests.mjs` — Fourteen lifecycle, deduplication, limits, serialisation, export and cleanup tests.
- `scripts/diagnostics-overhead.mjs` — Disabled/enabled synthetic API-overhead benchmark.
- `scripts/generate-diagnostics-example.mjs` — Creates a stable example file using the production manager.
- `DIAGNOSTICS.md` — User/developer documentation for lifecycle, schema, categories, limits and API.
- `DIAGNOSTICS_EXAMPLE.json` — Human-readable example schema with events, collision lifecycle, performance, warning and error records.
- `benchmarks/diagnostics-overhead.json` — Raw disabled/enabled overhead results.
- `benchmarks/diagnostics-browser-acceptance.json` — Real Chromium lifecycle/download acceptance result.

## 3. Recorded categories

### Session and configuration

- Diagnostics enabled and disabled.
- Session identity, ISO timestamps, duration and termination reason.
- Game version, user agent, viewport dimensions and device-pixel ratio.
- Initial runtime counts and serialisable game/world configuration.

### Player and gameplay modes

- Entering and exiting the player car.
- Boarding and leaving a bus.
- Boarding and leaving a train passenger carriage.
- Entering and leaving an HST cab.
- Traversing between moving Mark 3 coaches.
- Observed transitions between walking, car, bus, passenger train and cab modes.
- Weather changes, time-of-day changes and keyboard-triggered incident requests.

### Collision and hitbox diagnostics

- Vehicle-to-vehicle contacts, including police-to-vehicle classification.
- Player car to building or station structure.
- Walking player to building.
- Walking player to station blocker.
- Walking player to train exterior.
- Passenger inside a train to interior blocker.

Contacts use stable pair keys. A continuing contact does not emit a new record every simulation tick: a `collision-start` is emitted once and `collision-end` is emitted after the pair has remained absent for the configured 160 ms separation delay.

Where authoritative data exists, a collision record includes entity IDs/types, position, heading, velocity, speed, player-control flag, LOD, lane/route/station/platform/coach context, profile identifier, local/world vertices, known visual dimensions, clearance radius, contact point, normal, penetration, relative impact speed, applied correction, impulse, resolution status, door/open side, platform side and berth state. Expensive rendered bounding boxes are not calculated per frame; immutable profile and visual metadata are reused.

### Railway

- Service initialisation.
- Block entered/cleared and reservation acquired/released.
- Movement-authority signature changes.
- Signal aspect and cleared-for changes.
- Platform request/reservation, occupation, status and release.
- Train arrival, dwell start/end, doors open/closed and departure.
- Restrictive-authority waiting.
- Interlocking route request, acceptance, rejection, entry, transfer and release.
- Route-transfer completion.
- Stale-reservation recovery and detected block conflicts.

These hooks observe the existing authoritative block, signal, platform, dispatcher and interlocking state. They do not alter railway safety logic or update frequency.

### Road traffic, transit and police

- Traffic spawn/despawn and route assignment/reroute.
- Lane-change start/completion.
- Bus-stop arrival and passenger boarding/alighting totals.
- Unusually long vehicle blocking and recovery.
- Police offences and pursuit start/end.

### Pedestrians, incidents, airport and chunks

- Pedestrian spawn/removal, route/activity changes, station-path entry and abnormal blocking.
- Incident creation, response and resolution.
- Aircraft spawn and operational state transitions.
- Chunk load requests, generation start/completion, cancellation, activation changes and eviction.
- Chunk generation duration, counts and queue state.

### Performance, warnings and errors

- Frame, simulation and render CPU durations.
- Railway, dispatcher, traffic, pedestrian, collision, police, airport, player, streaming, chunk generation, HUD and minimap timings.
- Renderer calls, triangles, lines, points, active geometries and active textures.
- Visible-object count when a sample requires it.
- JavaScript heap use when supported by the browser.
- Explicit handled warnings/errors and active-session `window.error`/`unhandledrejection` events.

No global console interception is used.

## 4. Export schema

The stable top-level schema is:

```json
{
  "schemaVersion": 1,
  "diagnostics": {},
  "session": {},
  "configuration": {},
  "summary": {},
  "performance": {},
  "events": [],
  "collisions": [],
  "warnings": [],
  "errors": []
}
```

- `diagnostics` documents record limits, sample interval and collision-end delay.
- `session` contains ID, start/end, duration, reason, version, user agent and viewport.
- `configuration` is the safe plain-value snapshot supplied at session start.
- `summary` contains frame percentiles, system means/maxima, collision/warning breakdowns, counters and dropped records.
- `performance.fields` defines the stable column order for compact numeric sample rows.
- `performance.samples` contains the sampled numeric rows.
- `performance.detailedFrames` contains frames forced by collisions, chunks, errors, warnings and major transitions.
- `performance.longFrames` contains frames above 16.7 ms, including severe frames above 33.3 ms.
- Event-like records contain session-relative `timeMs` and authoritative `simulationTime`.

`DIAGNOSTICS_EXAMPLE.json` is generated through the same production manager and includes a collision start/end pair, frame records, a warning and an error.

## 5. Memory and record limits

| Category | Limit | Behaviour at limit |
|---|---:|---|
| Events | 50,000 | New records are dropped and counted. |
| Collision records | 10,000 | New lifecycle records are dropped and counted. |
| Warnings | 5,000 | New records are dropped and counted. |
| Errors | 2,000 | First serious error is retained; recent records replace older non-first records. |
| Performance samples | 18,000 | Typed-array ring buffer retains the most recent samples. |
| Detailed/long frames | 5,000 | Additional records are dropped and counted. |

The safe serialiser limits depth, array length and string length; handles circular references, undefined, non-finite values, bigint, `Error`, typed arrays, ArrayBuffers and common Three.js maths objects; labels DOM/GPU resources rather than traversing them; and reads data properties through descriptors so unexpected getters are not invoked.

## 6. Measured overhead

The raw benchmark is in `benchmarks/diagnostics-overhead.json`. It is a synthetic Node API microbenchmark, not a browser FPS result.

| State | Result |
|---|---:|
| Disabled | **0.0103 µs net per simulated frame** |
| Enabled | **7.54 µs per simulated frame** |

The enabled test used representative mock state containing 12 trains, 304 blocks, 304 signals, 45 platforms, 64 traffic vehicles, 120 pedestrians and 3 aircraft. Real overhead varies with collision/event frequency and hardware. The disabled number is near timer noise and confirms that the remaining guard calls are negligible relative to a 16.7 ms frame budget.

The complete game could not produce trustworthy FPS comparisons in the container because its Chromium build could not initialise WebGL. No FPS or GPU-overhead figure has been invented.

## 7. Tests run

### Diagnostics-specific tests — 14/14 passed

- Disabled mode creates no records.
- Starting creates a clean session; a second session does not retain prior records.
- Events record only while enabled.
- Collision pairs deduplicate and produce start/end lifecycle records.
- Railway state changes log only when values actually change.
- Performance sampling respects frequency and retains long frames.
- Collision starts force detailed frame records.
- Limits cap buffers and count dropped records.
- Circular values are safe and property getters are not invoked.
- Errors retain message/stack and Three.js vectors serialise correctly.
- Empty sessions stop into valid schema-v1 JSON.
- Temporary listeners are removed and console methods remain unchanged.
- Successful export clears completed-session buffers.
- Failed export retains data and can be retried.

### Existing regression suite — 102/102 passed

The heavy suite was executed in deterministic isolated ranges because cumulative procedural city construction can exceed the single-process timeout. Any interrupted range was rerun in smaller ranges or one test per process; no timeout was counted as a pass.

### Independent validators

- JavaScript lint: passed, 50 JavaScript files.
- Integration smoke: passed — 36 roads, 12 trains, 37 traffic vehicles, 48 pedestrians, 3 aircraft and 1 police unit.
- Railway upgrade/passenger validation: passed — 2 loops, 10,404 route samples, 13 bridges, 20 stopping checks, 100 boarding/alighting checks and all 5 moving coaches traversed.
- Railway operations: passed — 304 segments, 304 blocks, 304 signals, 45 platforms, 12 services and 10 protected transfers.
- Four-track validation: passed — 4 tracks and 5 platforms per station.
- Station-road/fleet validation: passed — 9 road-safe station halls and 12 HST services.
- Station stair validation: passed — all 9 enclosed halls have complete street-to-platform traversal.

### Browser lifecycle/download acceptance

A real Chromium process executed the production `DiagnosticsManager` and browser download APIs through Chrome DevTools Protocol:

- Initially disabled with no status indicator.
- F8 started a clean session and displayed the recording panel.
- F8 stopped the session.
- Exactly one `.json` file downloaded.
- The downloaded file parsed and reported schema version 1 and `manual-toggle` termination.
- The confirmation toast included filename and duration.
- The indicator and active recording state disappeared after shutdown.

The result is saved in `benchmarks/diagnostics-browser-acceptance.json`.

## 8. Known limitations

1. **Full manual rendered-game acceptance remains to be performed on a WebGL-capable machine.** The container Chromium build failed WebGL initialisation and could not support the requested drive/walk/train/police/chunk-streaming visual scenario. The lifecycle/download path itself was tested in Chromium.
2. **Performance rows measure CPU-side timings.** `renderer.render()` duration is browser CPU submission time, not a GPU timer query.
3. **Visible-object counting requires scene traversal.** It is performed only on throttled active-session samples, never while diagnostics are disabled.
4. **State observers are intentionally sampled.** Very short state transitions that begin and end entirely between observer ticks require an explicit event hook; critical collision, interlocking, chunk and player transitions already use direct hooks.
5. **Collision end is delayed by 160 ms.** This prevents contact jitter from generating repeated start/end pairs but means the exported end timestamp is slightly after physical separation.
6. **No console mirroring.** Explicit structured warnings/errors were preferred to invasive global console replacement.
7. **No backend or persistent recovery store.** A failed export remains only in current page memory until retry or page unload, as requested.

## 9. Required confirmations

- Turning Diagnostics Mode off after an active session automatically builds and downloads one human-readable JSON file.
- The saved toast displays the filename and session duration.
- No diagnostics records accumulate before F8 starts recording or after F8 stops recording.
- A new session starts with clean counters and buffers.
- Existing gameplay, collision, rendering, railway, traffic, pedestrian, police, airport, weather, HUD, minimap and chunk systems remain present and their regression/validation tests pass.
