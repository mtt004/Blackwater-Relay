# Station Road Clearance and Fleet Expansion

## Root cause
The outer-platform upgrade reused `platformOffset` for two unrelated purposes: the outer edge of the footbridge/platform system and the setback of the station hall. Expanding platforms from three centres to five increased that value from 7 m to 14 m, pushing station halls seven metres towards nearby roads.

## Station placement fix
- Station hall placement is now independent of the number of platforms.
- Every complete rotated hall footprint is checked against the actual road corridors and all outer running tracks.
- The placement solver searches along the platform and prefers the road side only when the full hall remains clear.
- At constrained sites, the hall moves to the opposite side and its ground-level pedestrian approach passes beneath the elevated railway rather than crossing tracks.
- Minimum validated hall-to-road clearance: 1.15 m beyond the road safety corridor.
- All five platforms retain direct footbridge stair access.
- Cross-platform routing now stays on the footbridge between the outer platforms instead of descending across intermediate live tracks.

## Platform geometry
- Platform width was adjusted to 4.0 m, providing a realistic 1.5 m platform-edge distance from each adjacent track centreline.
- Full- and low-detail station models use the same five platform centres.

## Fleet expansion
- Fleet increased from 8 to 12 Class 43 HST services.
- Six services operate on each loop.
- Each of the four tracks carries three services in one consistent direction, avoiding opposing trains on the same running line.
- Existing train LOD remains active for distant services.

## Validation
- Dedicated station-road and fleet validation passed for all nine physical stations.
- Four-track/five-platform validation passed.
- Focused road-clearance, fleet-distribution, footbridge and station-geometry regression tests passed.
- Integration smoke testing passed with 12 trains and all major simulation systems active.
