# Aircraft reverse thrust, inertia and manual-speed fix

## What changed

- Manual flight now reaches the same resolved cruise-speed envelope as AI traffic much sooner instead of lingering around ~150 kt for a long period.
- The pilot HUD shows both knots groundspeed and the equivalent km/h so the manual and AI speed displays can be compared directly.
- Holding `R` while manually controlling an aircraft on the ground commands reverse thrust. Forward thrust must spool close to idle before reverse deploys.
- Reverse thrust is strongest during high-speed landing rollout and fades toward idle effectiveness at low speed. It cannot drive the aircraft backwards.
- `Space` wheel braking now builds and releases brake pressure progressively instead of applying an immediate 8.5 m/s² speed reduction.
- Touchdown speed is no longer clamped immediately to the powered ground-speed limit; landing momentum is preserved and must be dissipated by drag, braking and/or reverse thrust.
- AI aircraft now deploy reverse thrust during the high-speed part of landing rollout and use a less abrupt deceleration profile.
- Full-detail engine nacelles have a small translating reverser-sleeve animation so reverse deployment is visible.
- Taxi/stand endpoints target a near-stop before state transitions, reducing final speed snaps.

## Controls

- `R` (hold, aircraft on ground): reverse thrust
- `Space` (hold): progressive wheel braking
- `Tab`: increase forward throttle
- `Shift`: decrease forward throttle

## Validation highlights

- Manual full-throttle flight from 60 m/s reaches approximately 502 km/h after 25 s and 549 km/h / 297 kt after 30 s, against the shared 554 km/h AI cruise target.
- A 65 m/s (~126 kt) manual rollout with maximum wheel braking and reverse takes roughly 10.2 s and 302 m to fall below 1 m/s in the deterministic validation setup.
- Reverse thrust is rejected while airborne.
- Touchdown momentum remains above 64.8 m/s after the first 1/60 s ground frame from a 65 m/s touchdown state; it is no longer hard-clamped to 45 m/s.
- The dedicated manual-flight/ground-services validator, aviation network validator, integration smoke test and lint all pass.

## Research basis

The reverse-thrust behaviour follows the broad operational pattern documented for Airbus-family transport aircraft: forward thrust is reduced to idle for landing, reverse is selected after touchdown, reverse contributes most usefully at higher rollout speeds, and wheel brakes remain a primary stopping mechanism. The simulation remains intentionally simplified because Blackwater Relay does not model full engine FADEC, tyre/anti-skid dynamics, runway contamination, atmospheric density or individual wheel forces.
