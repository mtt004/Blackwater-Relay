# Tight Oriented Building Hitboxes

## Root cause

Generated buildings are rotated to follow nearby roads, but their collision used the world-axis bounding rectangle of the rotated footprint. That broad rectangle contains large empty triangular corners, so the player and vehicles could collide with invisible space outside the visible walls.

## Changes

- Building layout reservations remain unchanged, preserving spacing and road clearance.
- Each building now has a separate oriented collision footprint aligned to its visible façade.
- Collision footprints are inset by 0.08 metres from the nominal wall dimensions to avoid snagging on rendering tolerances.
- The spatial grid still uses a compact axis-aligned broad-phase envelope, followed by an exact oriented-box narrow-phase test.
- Walking, player vehicles, camera collision and railway support/station clearance checks now use the oriented collider.
- The landmark tower collider was also reduced to match its visible podium more closely.

## Validation

- JavaScript lint and syntax validation passed.
- The complete focused suite passed in filtered batches, including new rotated-building collision tests.
- Integration smoke test passed with roads, trains, traffic, pedestrians, aircraft and police active.
