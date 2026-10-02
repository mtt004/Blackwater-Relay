# Aircraft Controls and Independent Model Upgrade

## Control changes

Aircraft manual controls are now deliberately simple and unambiguous:

- `W` — nose down
- `S` — nose up
- `A` — bank and turn left
- `D` — bank and turn right
- `Tab` — increase throttle
- `Shift` — decrease throttle
- `Space` — wheel brake on the ground
- `C` — cycle aircraft cameras
- Mouse — free look
- Arrow keys — no aircraft movement function

A/D are a single lateral-control path. They command roll/bank and the resulting coordinated turn in the same direction. There is no separate player rudder key path competing with the turn direction.

## Independent aircraft model

The full-detail model was re-authored procedurally around public A320-family dimensions and independent visual references. It now has a more swept/tapered wing, wider span consistent with the public span:length ratio, larger neo-style nacelles, revised tailplane/fin, improved landing gear, a runtime-generated fictional livery and a substantially more A320-like sidestick flight deck.

See `ASSET_PROVENANCE.md` for the complete source and creation record.

## Validation performed

Completed successfully:

- `npm run lint`
- `npm run validate:flight`
  - A: left turn, heading -16.3° in the deterministic test
  - D: right turn, heading +16.3°
  - A/D visual bank signs verified with transformed wing-height checks
  - W: nose-down command verified
  - S: nose-up command verified
  - Tab: throttle increased from 0.55 to 0.85 in the test interval
  - Shift: throttle decrease verified
  - ArrowLeft/ArrowRight/ArrowUp/ArrowDown: verified inert for aircraft movement
  - generated fuselage UVs, runtime DataTexture, sidesticks and all four LOD groups verified
- `npm run validate:aviation` — 10 aircraft, 68 stress-run arrivals, repeated passenger round trip passed
- `npm run smoke`
- `npm run validate:railway`
- `npm run validate:operations`

The monolithic `npm test` runner was also attempted twice, including a 90-second standalone run. It did not report a failure; it exceeded the execution window before completing, so it is not claimed as passed.
