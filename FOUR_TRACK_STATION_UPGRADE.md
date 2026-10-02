# Four-track railway and station upgrade

## Implemented

- Expanded both the City Loop and Eastmere Airport Loop from two running tracks to four.
- Track centre offsets are `-10.5 m`, `-3.5 m`, `3.5 m`, and `10.5 m` from each route centreline.
- Added three island platforms at every physical station, positioned between each adjacent pair of tracks.
- Added a dedicated stair flight from the station footbridge to every platform.
- Added a platform-specific route map at every platform. Each map lists the complete ordered stop sequence beginning with the current station.
- Expanded the operating fleet to eight HST formations so all four tracks are actively used across the two loops.
- Updated train door-side selection so each train opens toward its assigned accessible platform.
- Widened bridge and railway-clearance analysis to account for the complete four-track formation.
- Moved station halls farther from the widened railway footprint while retaining the existing station entrance and platform access system.
- Preserved the existing train, airport, road, vehicle, pedestrian, police, streaming and LOD systems.

## Validation

- JavaScript lint and syntax validation passed.
- Integrated smoke test passed with 36 roads, 8 trains, 37 road vehicles, 48 pedestrians, 3 aircraft and 1 police unit.
- Dedicated four-track validation passed for both loops and all 9 physical stations.
- Every station was verified to contain three walkable platforms, at least three footbridge stair runs, and three route-map objects with complete stop data.
- The operating fleet was verified to use all four track indices.

## Note

The route maps use browser-generated canvas textures. In non-browser automated tests they fall back to the standard display material while retaining the complete route-stop data used by the validation.
