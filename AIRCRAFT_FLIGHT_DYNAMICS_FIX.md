# Aircraft flight-dynamics / runway-conflict fix

## Root cause

The aircraft controller used a single `groundConflict()` rule for taxiing, take-off and landing roll, and resolved a conflict by assigning `speed = 0`. Separately, an arrival that reached the end of `descent` while the runway was owned by another aircraft was pinned at `progress = .995` with `speed = 0`. Because that position is still airborne, the visual result was an aircraft hovering in mid-air while waiting for the runway.

The controller also assigned a new target speed directly on every state change and directly derived pitch/yaw from the current spline tangent. State boundaries and sharp changes in spline tangent therefore produced instantaneous velocity and attitude changes.

## Fixes

- Added a continuous arrival holding pattern and runway-arrival priority.
- Aircraft without landing clearance remain moving in the holding pattern instead of freezing in the air.
- Added a continuous go-around path as a fail-safe if an arrival cannot retain runway clearance.
- Removed take-off and landing roll from proximity-based stop logic. Exclusive runway ownership now separates those phases.
- Taxi conflicts are handled only on low-speed taxi states, with priority for aircraft vacating the runway.
- Replaced instantaneous speed assignment with acceleration/deceleration rate limiting.
- Added rate-limited yaw, pitch and bank tracking plus a deterministic angle-of-attack/flare schedule.
- Kept airspeed positive throughout climb, cruise, hold, descent and approach.
- Fixed aircraft-local heading calculations to use the authoritative simulated heading rather than an ambiguous Euler decomposition of the mesh quaternion.

## Aircraft / jetbridge visual improvements

- Added wing slats, spoiler panels and animated flaps.
- Added engine spinners, more fan blades and exhaust cones.
- Added retractable landing gear with simple gear doors and phase-dependent deployment.
- Extended landing-light use to approach/landing phases.
- Improved the jetbridge soft dock with accordion ribs, rubber bumpers and a threshold plate.
- The soft dock is now extended/walkable only while the aircraft door is actually open; it retracts for departure preparation.

## Validation performed

- `node scripts/lint.mjs` — passed.
- `TEST_FILTER='aircraft|boarding bridge|aviation' node scripts/run-tests.mjs` — 12 targeted tests passed.
- `node scripts/validate-aviation-network.mjs` — passed; 10 aircraft, 70 stress-run arrivals, minimum service 1/1, max 0.25 s position step 38.5, repeated passenger round trip 378.8 s.
- `node scripts/integration-smoke.mjs` — passed.
- Railway upgrade, rail operations and station stair-volume validators — passed.
- Forced runway-contention probe confirmed the affected aircraft entered a moving holding pattern rather than stopping airborne.

The full unfiltered test runner is unusually long in this repository and did not complete inside the execution window; the aviation-specific suite and the independent integration/rail validators above all passed.
