# Outer Platform Access Fix

## Problem
At four-track stations, the outermost track on the approach side had no platform on the outside edge, so the player had to cross a live track at rail level to reach the rest of the station.

## Root cause
The four-track upgrade generated only three platform centre lines (`-7, 0, 7`). That covered the inner boarding faces but left the two outer edges of the railway corridor without side platforms.

## Fix
- Expanded station platform centre lines to `-14, -7, 0, 7, 14`.
- Extended full-detail station geometry to build the two additional outer side platforms.
- Extended low-detail station geometry to match.
- Extended the station footbridge stairs/landings so every platform has direct stair access.
- Increased the effective outer platform span used by station entrances and footbridges.
- Updated outer-track train door-side selection so outer tracks now serve the new outer platforms.

## Files changed
- `src/rail/RailPlan.js`
- `src/rail/RailSystem.js`

## Checks run
- `node --check src/rail/RailPlan.js`
- `node --check src/rail/RailSystem.js`

## Remaining note
This fix is targeted to the missing outer platform access problem shown in the screenshot. No unrelated gameplay systems were intentionally changed.
