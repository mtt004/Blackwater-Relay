# Enclosed station stair hall fix

## Root cause

The low-level access staircase and the station building were generated independently. The stair ran from the ground approach to the elevated platform, while the small station building was offset sideways from the bottom landing. Once the building became hollow, the staircase was still partly outside its shell and one side wall cut through the flight.

## Implementation

- Derive the station-building axis and footprint from the actual ground-to-platform stair route.
- Enclose the complete staircase, lower foyer and upper landing within a taller stair-hall shell.
- Add a ground-level street doorway and a separate platform-height doorway.
- Keep the rear wall solid below platform level, preventing outside access beneath the elevated door.
- Use continuous side walls so the flight can only be entered through the station interior.
- Reuse the existing functional stair walking surface for the enclosed flight.
- Add walkable lower and upper concourse surfaces and keep interior fixtures out of the stair aisle.
- Move train alighting to the platform outside the upper station door and preserve road-side station entry at the street door.

## Validation

- All eight station stairs fit fully within their station shell.
- Both street and elevated platform doorways are passable at the correct heights.
- A simulated player can walk from the street, through the foyer, up the stairs and out onto the platform at all eight stations.
- Direct access through either exterior side wall remains blocked.
- Project lint and the integrated multi-system smoke test pass.
