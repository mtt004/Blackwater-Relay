# Railway, Station Placement and LOD Fix

## Root causes

1. Station buildings were aligned from a road-access point directly toward a platform point. On curved track this diagonal axis could rotate the station hall across the railway corridor.
2. Stations were independently resolved from approximate coordinates, without a minimum spacing invariant. Several valid but unrealistic sites were therefore selected only 137–209 metres apart.
3. The entire railway, viaduct, station geometry and every HST formation could remain detailed across the map. Track geometry was not partitioned by the same chunks used for roads.

## Changes

- Station halls now use the station's local track frame. The hall runs outward from the platform and its inner wall is fixed beyond the outer platform edge.
- Added an oriented station-building railway-clearance diagnostic. All station halls remain approximately 10 metres or more from the railway centreline.
- Added desired loop-progress values for all eight stations.
- Added minimum station centre spacing and minimum clear platform gap rules to the authoritative world definition and rail-layout validation.
- Rail track detail is split into world chunks. Nearby chunks render ballast, sleepers and rails; distant chunks use lightweight line geometry.
- Viaduct and embankment detail is also split by chunk and hidden outside the detailed railway corridor.
- Stations now have full and simplified representations. Interiors, lights, furniture, stairs and detailed canopies are rendered only nearby.
- HSTs now have full, low and outline tiers. Distant trains use a single dynamic instanced low-detail formation rather than all carriage interior meshes.

## Validation

- 72 focused tests passed in six disjoint ranges.
- JavaScript syntax validation passed for all project source and test files.
- Closest resolved station spacing: approximately 276.5 metres.
- Eight station buildings passed railway-corridor clearance checks.
- Smoke validation produced 20 railway chunks, 20 grade-separation chunks, eight simplified station groups and three HST render tiers.
