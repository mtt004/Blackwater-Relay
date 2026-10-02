# Building and Structure Boundary Diagnostics

## Outcome

A new **Building & structure boundaries** setting has been added to the Diagnostics panel. It is separate from the existing B-key collision-hitbox overlay.

The setting performs two linked functions:

1. It shows the known rendered envelopes of registered buildings and station structures.
2. While Diagnostics Mode is active, it records a static, serialisable boundary catalogue in the exported JSON file.

The catalogue is captured once per session or when the setting is first enabled during that session. It is not rebuilt or appended every frame.

## Reason for the change

The supplied session contained 6,593 events and collision lifecycle data for vehicle contacts and train-interior blockers, but it did not contain a world catalogue describing the visible envelopes of buildings and structures. That made it difficult to compare a collision record with the object the player could actually see.

The new schema stores visual object bounds separately from collision profiles so false positives and excessive clearance can be identified directly.

## User controls

### Diagnostics panel checkbox

**Building & structure boundaries**

- Off: no overlay geometry and no boundary catalogue capture.
- On: show object envelopes and arm boundary capture.
- On before F8: the catalogue is captured at session start.
- Turned on after F8: the catalogue is captured immediately.
- Turned off during a session: the overlay disappears; previously captured records remain in the current export.

### Existing controls

- **F8** continues to start/stop the diagnostics session and download JSON.
- **B** continues to show exact collision hitboxes only.

This separation allows direct visual comparison:

- **Magenta:** rendered procedural-building boundaries.
- **Yellow:** rendered station and landmark structure boundaries.
- **Existing B overlay:** collision geometry.

## Architecture

### `src/core/StructureBoundaryOverlay.js`

Owns all rendering and catalogue generation for visual object boundaries.

Key properties:

- Lazy construction: no line geometry is allocated until the setting is enabled.
- Two batched `THREE.LineSegments` drawables rather than hundreds of scene objects.
- Static records are cached after first generation.
- Plain serialisable records are returned to the diagnostics manager.
- Visual dimensions and collision dimensions remain separate.

### `src/core/DiagnosticsManager.js`

Schema version is now **2**.

New functionality:

- Persistent runtime setting: `objectBoundaries`.
- Bounded object-boundary record store.
- Stable-ID deduplication.
- Capture at session start or setting activation.
- Summary counts by category.
- Dropped-record accounting.
- Exported top-level `objectBoundaries` section.

The manager still owns session state and file generation. `StructureBoundaryOverlay` does not download files.

### `src/world/CityBuilder.js`

Registered procedural building colliders now retain immutable visual metadata:

- visual width/depth;
- visual height;
- rotation;
- district/type;
- boundary source.

Collision insets are unchanged.

### `src/rail/RailSystem.js`

Station blockers now retain visual dimensions separately from their fitted collision dimensions. This includes station walls, lift towers, ticket desks, benches and vending machines.

Walking and station collision behaviour is unchanged.

## Export schema

Schema-v2 exports include:

```json
{
  "schemaVersion": 2,
  "diagnostics": {
    "settings": {
      "objectBoundaries": true
    }
  },
  "summary": {
    "objectBoundaryCaptureEnabled": true,
    "objectBoundaryCount": 314,
    "objectBoundaryCountByCategory": {
      "building": 196,
      "structure": 118
    }
  },
  "objectBoundaries": {
    "captureEnabled": true,
    "count": 314,
    "records": []
  }
}
```

Each record can contain:

- stable object ID;
- category and object type;
- metadata source;
- world position and Y rotation;
- visual width, depth and height;
- minimum and maximum elevation;
- four world-space footprint vertices;
- fitted collision profile dimensions;
- district/chunk or station/structure metadata.

No Three.js mesh, geometry, material, texture or scene graph is exported.

## Full-world validation

The deterministic whole-world validator reported:

| Metric | Result |
|---|---:|
| Total registered boundaries | 314 |
| Procedural buildings | 196 |
| Structures | 118 |
| Overlay draw batches | 2 |
| Buildings with independently smaller collision bounds | 196 |
| Formatted catalogue export size | 369,122 bytes |

The validator confirms that every registered city collider and station walk blocker creates exactly one stable boundary record.

## Memory limits

A new diagnostics limit applies:

```text
Object boundaries: 15,000
```

When the limit is reached:

- additional records are not appended;
- the session continues;
- `droppedRecords.objectBoundaries` is incremented;
- already captured records remain valid.

## Performance

Synthetic diagnostics API benchmark:

- Disabled diagnostics path: approximately **0.0081 microseconds net per simulated frame**.
- Enabled diagnostics with boundary setting off: approximately **7.05 microseconds per simulated frame**.

Boundary-specific behaviour:

- Setting off: no catalogue generation, no boundary line geometry and no per-frame boundary update.
- Setting on: one static catalogue generation and two extra line draw batches.
- Recording: one static capture; no repeated frame snapshots.

These are Node measurements and structural counts, not a claim about GPU FPS on the user's computer.

## Files changed

- `index.html`
- `styles.css`
- `src/main.js`
- `src/core/DiagnosticsManager.js`
- `src/core/StructureBoundaryOverlay.js` — new
- `src/world/CityBuilder.js`
- `src/rail/RailSystem.js`
- `scripts/diagnostics-tests.mjs`
- `scripts/object-boundary-validation.mjs` — new
- `scripts/generate-diagnostics-example.mjs`
- `package.json`
- `README.md`
- `DIAGNOSTICS.md`
- `DIAGNOSTICS_EXAMPLE.json`
- `benchmarks/diagnostics-overhead.json`
- `benchmarks/object-boundary-validation.json` — new

## Tests and validation

- JavaScript lint: passed, 52 files.
- Diagnostics tests: 17/17 passed.
- Existing regression assertions: 102/102 passed in deterministic ranges.
- Integration smoke: passed.
- Four-track railway validation: passed.
- Railway geometry/passenger validation: passed.
- Railway operations validation: passed.
- Station road/fleet validation: passed.
- Complete station stair traversal: passed.
- Whole-world boundary validation: passed.

The known combined Node test-process timeout remains cumulative construction cost; timed-out ranges were not treated as passing and were rerun in smaller deterministic ranges.

## Known limitations

- The overlay represents registered building/station visual envelopes, not every decorative submesh or roof ornament.
- Non-collidable scenery is not automatically included because it has no authoritative interaction identity.
- Airport scenery will require explicit boundary registration if detailed airport-structure envelopes are needed later.
- Boundaries are static. Moving vehicles, trains and aircraft continue to use the existing dynamic hitbox visualisations and collision records.
- Lines render through objects deliberately so hidden rear and lower boundaries remain inspectable.

## Correctness confirmation

- No collision dimensions were changed by this feature.
- No road, rail, station, player, traffic or passenger logic was changed.
- Boundaries are not recorded unless Diagnostics Mode is enabled and the setting is on.
- Turning Diagnostics Mode off still automatically downloads exactly one JSON file.
- The B-key hitbox overlay remains independent.
