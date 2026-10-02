> **Follow-up:** The XZ footprint-padding issue described here was fixed, but the elevated stair projection still blocked clear space underneath. That second issue is corrected in `STAIR_COLLISION_VOLUME_FIX.md`.

# Station Invisible Collision Fix

## Conclusion

The player was not being stopped by an oversized building mesh or a normal station `walkBlocker`. The obstruction came from the station walking-surface solver itself.

Each dog-leg staircase registered an invisible stair footprint larger than the rendered treads, and `walkSurfaceSample()` expanded that footprint a second time. `resolveWalkSurface()` then interpreted nearby floor positions as a high staircase and rejected horizontal movement with the reason `stair-side` before accepting the valid station floor beneath the player.

Because this rejection had no `walkBlocker` object, the previous B-key collision overlay did not draw it and the diagnostics collision logger did not record it. This explains why the player could be stopped by something invisible while the visible hitbox overlay appeared empty.

## Root cause

Before this fix, staircase walking extents were calculated as:

- Length: visible half-length + 0.42 m, then another +0.34 m during sampling.
- Width: visible half-width + 0.18 m, then another +0.22 m during sampling.

Therefore the effective rejection region extended approximately:

- 0.76 m beyond each visible stair end.
- 0.40 m beyond each visible stair side.

A 2.7 m-wide staircase could behave like an invisible 3.5 m-wide obstacle.

A full-world pre-fix audit sampled station floors at 0.08 m spacing and found:

- 72,741 total `stair-side` rejections.
- 22,368 rejections outside the rendered stair footprint.
- Approximately 143.16 m² of invisible blocked floor across the nine stations.

## Changes

### `src/rail/RailSystem.js`

- Stair walking footprints now match the rendered tread envelope with only a 0.02 m numerical tolerance.
- Removed the second hidden expansion in `walkSurfaceSample()`.
- Preserved valid side collision inside the visible staircase.
- Extended the B-key station collision overlay:
  - Green lines: solid station blockers.
  - Orange lines: exact stair walking-surface rejection boundaries.
- Debug lines disable depth testing so the authoritative boundary remains visible through station geometry.

### `src/player/PlayerController.js`

- Added diagnostics for walking movement rejected by a synthetic station walk surface even when no object blocker exists.
- New collision category: `walking-player-to-station-walk-surface`.
- Records station ID, stair role, rejection reason, attempted position, fitted footprint and visible footprint.
- Existing collision lifecycle deduplication prevents one record per simulation tick.

### `tests/tests.js`

- Added an all-stations regression test proving:
  - Stair rejection extents do not exceed the visible treads by more than 0.021 m.
  - Floor positions just outside the rendered stair side remain walkable.
  - Positions inside the visible staircase still produce legitimate `stair-side` rejection.

### `scripts/station-walk-collision-validation.mjs`

- Added a deterministic full-world station-floor audit.
- Checks all nine station halls at dense sampling resolution.
- Verifies the B-key overlay contains both solid blockers and stair-boundary lines.

## After-fix measurement

The full-world validator sampled 166,671 station-floor positions:

- 49,995 legitimate rejections inside visible staircase footprints.
- 0 invisible `stair-side` rejections outside rendered stair footprints.
- 0 m² measured ghost stair-blocking area.

## Validation results

- JavaScript lint: passed.
- Diagnostics unit tests: 17/17 passed.
- Existing plus new regression tests: 103/103 passed in isolated deterministic ranges.
- Integration smoke: passed.
- Four-track validation: passed.
- Railway upgrade/passenger validation: passed.
- Railway operations validation: passed.
- Station-road and fleet validation: passed.
- Complete station-stair traversal validation: passed.
- Object-boundary validation: passed.
- New full-world station collision validation: passed.

Operational state remains unchanged:

- 12 HST services.
- 304 blocks.
- 304 signals.
- 45 platforms.
- 100 boarding/alighting checks.
- All five Mark 3 coaches traversable while moving.

## Diagnostics overhead

The added rejection log is behind the existing `diagnostics.isEnabled()` guard. The latest synthetic diagnostics benchmark measured:

- Disabled estimated net overhead: 0.0089 microseconds per simulated frame.
- Enabled diagnostics API overhead: 6.95 microseconds per simulated frame.

These are Node microbenchmark figures, not browser FPS results.

## Known limitation

The automated validator covers the complete procedurally generated station set and the exact walking resolver. A final visual check on the user's WebGL-capable computer is still necessary to confirm the original route feels correct with real keyboard movement and camera perspective.
