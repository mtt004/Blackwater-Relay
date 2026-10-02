# 2× Train Speed Upgrade

## Summary

The railway now uses a configurable **2× operating-speed profile** across all twelve HST services.

The implementation does not simply move train meshes twice as far after the signalling calculation. Speed limits, service limits, acceleration, braking envelopes, train protection and junction limits are scaled together so the authoritative railway systems continue to control movement.

## Configuration

```js
CONFIG.trainSpeedMultiplier = 2;
```

This single setting controls the railway-wide multiplier.

## Systems updated

- Service maximum speeds
- City and airport line-speed limits
- Curve and gradient block limits
- Train initial speeds
- AI acceleration and braking
- Station stopping-speed envelopes
- Movement-authority braking envelopes
- Train-ahead separation envelopes
- Manual cab acceleration and braking
- Emergency and train-protection braking
- Industrial Exchange junction speed
- Dispatcher stopping-distance priority
- Diagnostics configuration and build version

## Safety scaling

Doubling velocity without changing braking would quadruple stopping distance. To prevent that, the acceleration and braking terms used by the simulation are scaled by the square of the speed multiplier:

```text
speed multiplier:       2×
acceleration multiplier: 4×
braking multiplier:      4×
```

This keeps station stopping, signal protection and train separation operating over approximately the same track distances as before.

## Measured deterministic comparison

The same 300-second fleet simulation was run before and after the change.

| Measurement | Before | 2× build | Change |
|---|---:|---:|---:|
| Average service peak | 69.32 km/h | 140.57 km/h | 2.03× |
| Highest observed speed | 88.58 km/h | 177.15 km/h | 2.00× |
| City stopping line limit | 160 km/h | 320 km/h | 2.00× |
| City limited/express limit | 120 km/h | 240 km/h | 2.00× |
| Airport line limit | 100 km/h | 200 km/h | 2.00× |
| Deadlock recoveries | 0 | 0 | unchanged |

Observed speeds remain below theoretical line limits where station spacing, curves, movement authority or traffic ahead require braking.

## Validation

- JavaScript lint passed.
- 109/109 regression tests passed in isolated deterministic ranges.
- 17/17 diagnostics tests passed.
- Integration smoke passed.
- Four-track validation passed.
- Railway operations validation passed.
- Railway geometry/passenger validation passed.
- 12 HST services retained.
- 304 blocks and 304 signals retained.
- 45 platforms retained.
- 13 protected city/airport transfers completed in the operational run.
- Zero block conflicts.
- Zero routine deadlock recoveries.
- All five moving Mark 3 coaches remained traversable.
- Dual-platform doors and chosen-side alighting remained functional.
- Station and stair collision validators passed.

## Files changed

- `src/config.js`
- `src/main.js`
- `src/rail/TrainService.js`
- `src/rail/RailNetwork.js`
- `src/rail/RailDispatcher.js`
- `src/rail/RailSystem.js`
- `tests/tests.js`
- `scripts/validate-rail-operations.mjs`
- `scripts/validate-railway-upgrade.mjs`
- Module cache tags across JavaScript entry points
- `index.html`
