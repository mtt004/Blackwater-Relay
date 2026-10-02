# Station doorway collision fix

## Root cause

Station buildings were visually hollow, with a doorway opening and an overhead lintel. The walking collision representation only stored a maximum blocker height and implicitly treated every blocker as solid from ground level upward. The lintel collision therefore extended invisibly from the floor to the roof, blocking the otherwise visible doorway.

## Fix

- Added vertical collision ranges to station walking blockers using `minimumHeight` and `maximumHeight`.
- Updated pedestrian-body overlap checks so overhead structures do not block a player standing beneath them.
- Registered all station doorway lintels as overhead-only blockers from the top of the doorway to the roof.
- Kept walls, lifts, desks and vending machines solid at their correct heights.
- Added a regression test that samples the complete entrance path at every station and verifies that no invisible collision wall remains.

## Validation

- 65 focused tests passed in two deterministic batches: 55 core tests and 10 remaining subsystem tests.
- 200 doorway samples across all eight stations passed a dedicated collision test.
- 16 elevated lintel blockers were verified to block at lintel height but not at pedestrian floor height.
- Integration smoke test passed.
- JavaScript lint and syntax checks passed.
