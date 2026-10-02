# HST Passenger Window, Doorway and Free-Look Fix

## Scope

This change fixes three connected passenger-carriage problems:

1. Scenery could not be seen through the Mark 3 passenger windows.
2. An opened passenger door still appeared to contain a black panel and did not reveal the saloon.
3. A passenger could not freely turn and look around inside the moving carriage.

No railway signalling, train movement, collision, door-safety, platform-allocation or passenger-attachment rules were changed.

## Root causes

### Opaque bodywork behind the windows

The original coach used a complete opaque lofted side shell and an additional solid window-band box. Transparent glass meshes were placed just outside those surfaces. The glass was transparent, but the body directly behind it was not, so the result behaved like dark glass painted over a wall rather than a real window.

The passenger camera eye height was also 2.70 m while the old glazing ended at 2.63 m, placing a level view slightly above the usable window opening.

### Permanent black doorway panel

Each passenger doorway contained a dark `BoxGeometry` named as the aperture. The sliding leaves moved correctly, but the aperture box remained across the opening after the doors opened.

### Pointer lock deliberately disabled in trains

`main.js` released pointer lock for every train mode and allowed a scene click to request pointer lock only while walking. `RailSystem` already contained passenger yaw and pitch code, but it received no mouse movement because pointer lock had been removed.

At low frame rates, the fallback input delta could also be consumed by more than one fixed simulation update in the same rendered frame.

### Interior LOD measured from the locomotive

Interior visibility was decided from the train head. A player standing beside a rear coach could therefore be close to an open doorway while that coach's saloon remained hidden.

## Implementation

### Real coach apertures

The Mark 3 loft now omits its two vertical side faces. Three instanced side-panel batches rebuild the lower body, body side and window surround around explicit rectangular openings.

The openings are authoritative visual geometry:

- Eight windows on each side.
- Two passenger doorways on each side.
- Window opening: 1.80 m to 2.80 m above the vehicle origin.
- Passenger eye height: 2.66 m.
- Glazing: transparent, double-sided, depth-write disabled.

The exterior remains a complete coach body around the apertures; only the areas occupied by glass or open doors are omitted.

### Clear open doors

The solid aperture box was replaced with three narrow pieces:

- left jamb;
- right jamb;
- top lintel.

The threshold remains. When both sliding leaves are open, the centre of the doorway contains no opaque geometry.

### Exterior-to-interior visibility

Each carriage now decides interior visibility from its own world position. A nearby rear or middle coach keeps its saloon visible even when it is far from the leading power car. An occupied formation still keeps all required interiors visible.

### Passenger free-look

Passenger mode now explicitly requests pointer lock:

- Boarding with `E` requests it immediately.
- Clicking the scene while inside a passenger carriage requests it again after `Esc` or focus loss.
- Driver-cab and bus modes continue to release it.

Mouse movement controls unrestricted horizontal yaw and clamped vertical pitch. Buffered movement is consumed exactly once, including when a low-FPS rendered frame performs several fixed simulation steps.

## Files with functional changes

- `src/rail/HSTFactory.js`
- `src/rail/RailSystem.js`
- `src/main.js`
- `tests/tests.js`
- `scripts/train-interior-visibility-validation.mjs`
- `benchmarks/train-interior-visibility-validation.json`

Module cache tags were updated throughout the source, tests and entry page so browsers do not reuse the previous coach modules.

## Validation results

### Dedicated visibility validation

- Five Mark 3 coaches tested.
- 80 passenger-window sight lines tested.
- 0 opaque window obstructions.
- 20 fully opened passenger doorways tested.
- 0 blocked doorway centres.
- Passenger yaw change: -0.28 radians from the test movement.
- Passenger pitch change: 0.081 radians.
- Repeated movement across the next fixed step: 0 radians.
- Rear-coach interior remained visible when the player was beside it.

### Regression and integration

- JavaScript lint: passed, 55 files.
- Core regression assertions: 107/107 passed in deterministic isolated ranges.
- Diagnostics tests: 17/17 passed.
- Integration smoke: passed.
- Railway upgrade and passenger validation: passed.
  - 12 operational trains retained.
  - 100 boarding/alighting checks passed.
  - all five moving Mark 3 coaches traversed.
- Railway operations: passed.
  - 304 blocks and 304 signals retained.
  - 45 platforms retained.
- Four-track validation: passed.
- Station-road and fleet validation: passed.
- Complete station-stair traversal: passed.
- Station stair-volume collision validation: passed.

## Browser rendering limitation

The container's Chromium build could not initialise EGL/ANGLE, including its software rendering path, so a trustworthy WebGL screenshot could not be produced here. The geometry was instead verified with Three.js ray intersections through every window and open doorway, plus the normal simulation and passenger tests. A final visual check on a WebGL-capable computer remains appropriate.

## Passenger controls

- `E`: board or leave through an operational passenger doorway.
- Mouse: look freely around the carriage.
- `W`, `A`, `S`, `D`: walk relative to the current view direction.
- `Esc`: release pointer lock.
- Click the scene: resume mouse-look.
