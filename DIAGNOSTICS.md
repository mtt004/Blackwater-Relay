# Diagnostics Mode

## Lifecycle

Diagnostics Mode is owned by `src/core/DiagnosticsManager.js` and has only two recording states: disabled and enabled.

- Press **F8** while disabled to create a new clean session.
- Press **F8** while enabled to finalise the session, generate formatted JSON, start one browser download, display the saved filename and clear the completed record buffers.
- Pressing **B** only controls exact collision-hitbox visualisation. It never starts or stops diagnostics recording.
- The **Building & structure boundaries** checkbox in the Diagnostics panel controls a separate visual overlay and arms static boundary capture for an active or subsequent diagnostics session.
- Diagnostics data is never uploaded, written to `localStorage` or sent to a backend.

When disabled, reporting methods return before building records or serialising values. Runtime observers, performance sampling, collision snapshots, error listeners and the recording-status DOM are inactive.

## Building and structure boundary setting

The Diagnostics panel contains **Building & structure boundaries**.

When the setting is off:

- No boundary line geometry exists.
- No boundary catalogue is captured.
- The diagnostics manager does not query the boundary provider.
- Ordinary collision hitboxes remain independently controlled by **B**.

When the setting is on:

- Magenta wire prisms show the known visual footprints of procedural buildings.
- Yellow wire prisms show station structures such as walls, lifts, desks, benches and vending machines.
- The overlay is created lazily in two line-segment batches rather than one object per structure.
- If Diagnostics Mode is active, the immutable catalogue is captured once and stored in `objectBoundaries.records`.
- If Diagnostics Mode starts while the setting is already on, capture occurs at session start.
- Turning the setting on during an active session immediately captures the catalogue and logs the setting change.
- Turning it off hides the overlay and stops later capture attempts; records already captured in that session remain in the export.

The boundary overlay represents the **rendered object envelope**, while the B-key overlay represents the **actual collision geometry**. The distinction is intentional: comparing the two helps identify collision profiles that protrude beyond or sit too far inside a visible structure.

## Development API

The browser exposes the same production-safe lifecycle through:

```js
globalThis.cityDiagnostics.start();
globalThis.cityDiagnostics.stop();
globalThis.cityDiagnostics.exportCurrentSession();
globalThis.cityDiagnostics.retryExport();
globalThis.cityDiagnostics.getSummary();
globalThis.cityDiagnostics.isEnabled();
globalThis.cityDiagnostics.getSettings();
globalThis.cityDiagnostics.setObjectBoundaries(true);
```

`setObjectBoundaries(false)` hides the visual overlay and disables future boundary capture. `exportCurrentSession()` creates an explicitly incomplete snapshot without stopping an active session. `retryExport()` retries a failed stopped-session download without silently discarding retained data.

## Export schema

The file name is `city-sim-diagnostics-YYYY-MM-DDTHH-MM-SS-sssZ.json`.

```text
schemaVersion              Integer schema identifier; currently 2.
diagnostics                Export metadata: memory limits, sample interval,
                           collision delay and diagnostic settings.
session                    Identity, timestamps, duration, reason, game version,
                           user agent and viewport.
configuration              Plain serialisable game configuration captured at start.
summary                    Frame percentiles, subsystem means/maxima, counts,
                           boundary/collision/warning breakdowns and dropped records.
objectBoundaries            Static visual-boundary catalogue and capture state.
performance.fields         Stable column names for compact numeric samples.
performance.samples        Numeric rows matching performance.fields.
performance.detailedFrames Records forced by collisions, chunks, warnings, errors
                           and other major state transitions.
performance.longFrames     Detailed records for frames above 16.7 ms.
events                     Structured state-change records.
collisions                 Deduplicated collision-start and collision-end records.
warnings                   Explicit handled system warnings.
errors                     Explicit errors plus active-session window error and
                           unhandled-rejection records.
```

### `objectBoundaries` structure

```json
{
  "captureEnabled": true,
  "count": 314,
  "records": [
    {
      "id": "bld-0042",
      "category": "building",
      "objectType": "cbd-building",
      "source": "procedural-city",
      "position": { "x": 104, "y": 0, "z": -68 },
      "rotationY": 0.14,
      "dimensions": {
        "width": 18,
        "depth": 12,
        "height": 31,
        "minimumY": 0,
        "maximumY": 31
      },
      "footprintVertices": [
        { "x": 95.93, "z": -75.2 },
        { "x": 113.75, "z": -72.69 },
        { "x": 112.07, "z": -60.8 },
        { "x": 94.25, "z": -63.31 }
      ],
      "collisionProfile": {
        "halfWidth": 8.92,
        "halfDepth": 5.92,
        "rotation": 0.14
      },
      "district": "cbd",
      "chunkKey": "0:-1"
    }
  ]
}
```

The catalogue stores plain numbers and strings only. It does not contain meshes, geometries, materials, textures, scene nodes or GPU resources.

Every event contains a session-relative `timeMs`, authoritative `simulationTime`, `category`, `type`, optional entity metadata and safely serialised structured data. See `DIAGNOSTICS_EXAMPLE.json` for a schema-v2 file generated by the production manager.

## Recorded categories

### Player and modes

Car entry/exit, bus boarding/leaving, passenger-train boarding/alighting, cab entry/exit, movement between Mark 3 coaches and observed game-mode transitions.

### Collisions, hitboxes and object boundaries

Collision lifecycle records use stable pair keys and record a start once, then an end after separation. Supported records include vehicle-to-vehicle, police-to-vehicle, player car to static structures, walking player to buildings, station blockers and train exteriors, and passenger movement against train-interior boundaries.

Where available, collision records include entity IDs/types, positions, headings, velocities, speeds, LOD, lane/route/station/platform/coach context, profile names, dimensions, local/world vertices, clearance, contact/normal, penetration, correction, impulse, door side/open state, platform side and berth state.

The optional object-boundary catalogue adds immutable rendered envelopes for registered city buildings and station structures. It is captured once rather than repeated in each collision record or frame.

### Railway

Service initialisation, block occupancy/reservation changes, movement-authority changes, signal aspects, platform reservation/occupation/release, arrival/departure, dwell and doors, restrictive-authority waiting, interlocking requests/acceptance/rejection/release, route-transfer start/completion, stale reservation recovery and inconsistencies.

The recorder observes authoritative railway state and does not alter blocks, signals, movement authority, platform allocation or interlocking.

### Road, transit and police

Vehicle spawn/despawn, route assignment and rerouting, lane changes, stuck/recovery conditions, bus stop arrivals and passenger exchange, police offences and pursuit start/end.

### Pedestrians, incidents and airport

Pedestrian spawn/removal, routes, activity/crossing state, station access and unusually long blocking; incident creation, response arrival and resolution; aircraft spawn and operational state transitions; restricted-area offences through police events.

### World and performance

Chunk requests, generation start/completion/cancellation, active-chunk changes and eviction; weather and time changes; sampled frame/system timings, Three.js render counters, visible-object count and JavaScript heap where supported.

## Performance sampling

Performance samples are capped at eight per second during ordinary frames. Detailed frames are retained when frame time exceeds 16.7 ms, exceeds 33.3 ms, or chunk generation/another forced diagnostic condition occurs.

The compact numeric fields are:

```text
timeMs, frameMs, simulationMs, renderMs, railwayMs, dispatcherMs,
trafficMs, pedestriansMs, collisionsMs, policeMs, airportMs, playerMs,
streamingMs, chunkGenerationMs, hudMs, minimapMs, drawCalls, triangles,
lines, points, geometries, textures, visibleObjects, heapBytes
```

## Memory limits

```text
Events:                50,000
Collision records:     10,000
Warnings:               5,000
Errors:                 2,000
Performance samples:   18,000
Detailed long frames:   5,000
Object boundaries:     15,000
```

Performance samples use a typed-array ring buffer. Bounded categories count dropped records; the final summary reports every dropped count. Boundary records are deduplicated by stable ID. Error overflow keeps the first error and the most recent records. One malformed value cannot prevent the remaining session from exporting.

## Safe serialisation

The serialiser handles undefined, non-finite numbers, bigint, errors/stacks, circular references, nested depth, array/string limits, typed arrays, ArrayBuffers and Three.js vectors, quaternions, Euler angles and matrices. DOM nodes and GPU resources become labels rather than object graphs. Property getters are not invoked.

## Measured overhead

`benchmarks/diagnostics-overhead.json` records a synthetic Node API benchmark, not a browser FPS claim.

- Diagnostics disabled: approximately **0.0081 microseconds net per simulated frame** for the standard reporting-call sequence.
- Diagnostics enabled, boundary setting off: approximately **7.05 microseconds per simulated frame** with representative mock state.
- Boundary overlay disabled: no boundary geometry, catalogue construction or per-frame update.
- Boundary overlay enabled: two additional line draw batches; static catalogue generation happens once.

`benchmarks/object-boundary-validation.json` records the full procedural-world validation. In the current deterministic world it found 314 registered boundaries: 196 buildings and 118 structures. The formatted catalogue export was approximately 369 KB.

## Validation commands

```bash
npm run lint
npm run test:diagnostics
npm run benchmark:diagnostics
npm run validate:boundaries
npm run smoke
npm run validate:railway
npm run validate:operations
```

The heavyweight regression suite can be run in deterministic `TEST_RANGE` slices when a single Node process exceeds the cumulative construction timeout.
