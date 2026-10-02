# Aircraft queue, jetbridge and cockpit upgrade

## Ground aircraft separation
- Replaced the old proximity-only taxi conflict behaviour with a predictive queue speed limiter.
- Uses aircraft length, wingspan/lateral envelope, a nose-to-tail safety gap, current speed and braking distance.
- Followers match/slacken relative to aircraft ahead instead of continuing into their model.
- Added a last-resort ground separation correction to prevent numerical overlap.
- Manual/player-controlled aircraft are included as obstacles for AI ground traffic.

## Passenger boarding bridge
- Smoothed the bridge approach geometry and reduced sharp changes in direction/height near the stand.
- Extended the flexible docking section so it visually reads as a proper telescoping/flexible PBB connection rather than a tiny jagged gap filler.
- Widened the final dock, bellows, fuselage seal and threshold plate for a cleaner aircraft-door interface.

## Player-controlled cockpit
- Added a walkable/open flight deck with pilot seats, instrument displays, glareshield, centre pedestal, thrust levers, yokes and overhead panel.
- Walk forward into the cockpit and press E to take the pilot seat.
- W/S: throttle up/down.
- A/D: ground steering and roll.
- Down/Up arrows: pull up / pitch down.
- Left/Right arrows: rudder/yaw.
- Space: wheel braking on the ground.
- HUD shows PILOT and current throttle while flying.
- AI routing is suspended for the aircraft while under manual control.

## Validation
- Forced same-taxiway queue test: minimum aircraft-centre separation 19.29 m.
- Manual-control test: player-controlled aircraft accelerated to 58.6 m/s and climbed to ~29.9 m.
- Aviation network validation passed: 10 aircraft and 69 stress-run arrivals.
- Integration smoke passed.
- Railway upgrade validation passed.
- Rail operations validation passed.
- Lint passed.
