# Station Building Track-Clearance Fix

## Problem confirmed

The station-building test in the previous release was not strong enough. It sampled a small grid against the railway's **central reference curve**, rather than measuring the full oriented building footprint against both actual running-track centre lines. A long straight station hall beside a curved railway could therefore pass the test while still appearing to intrude into the track corridor at one end.

The building was also placed only **0.85 m beyond the outer platform edge**. That was mathematically outside the platform, but visually far too close for a large straight building beside curved track.

## Fix implemented

- Replaced the coarse centre-curve sampling check with an exact two-dimensional clearance calculation between:
  - all four edges of the oriented station-building footprint; and
  - densely sampled segments for both actual running-track centre lines.
- Added segment-intersection detection, so any track crossing a building footprint produces a clearance of exactly zero and fails startup.
- Reduced each station hall from **13.4 m to 9.6 m wide** and from about **20.8 m to 17.74 m deep**.
- Moved the track-facing station wall to **5.4 m beyond the outer platform edge**.
- Added a separate **5.39 m platform access link** between the building and the platform. The station building no longer needs to touch the platform edge.
- Added a functional elevated doorway threshold, walkable access link and side railings.
- Updated the low-detail station model to preserve the same separated building-and-link layout at distance.
- Added authoritative configuration values:
  - `minimumBuildingPlatformSetback: 5.4`
  - `minimumBuildingTrackClearance: 9.5`
- Startup now throws an error immediately if any generated station hall is closer than the required track clearance.

## Measured result

Exact minimum distance from each station-building footprint to the nearest actual running-track centre line:

| Station | Minimum clearance |
|---|---:|
| North Gate | 12.11 m |
| Old Town | 12.13 m |
| West Suburbs | 12.13 m |
| South Parkway | 12.15 m |
| Industrial Exchange | 12.12 m |
| Commercial Central | 12.15 m |
| Waterfront | 12.15 m |
| City Central | 12.15 m |

All eight stations exceed the new **9.5 m** hard minimum by more than 2.6 m.

## Validation completed

- 72 focused tests passed in ordinal batches.
- Full station street-to-platform player traversal passed at all eight stations.
- JavaScript lint and syntax validation passed.
- Integrated simulation smoke test passed with roads, traffic, buses, five HSTs, pedestrians, police and aircraft active.
- Exact building-versus-track intersection checks passed for every station.

A graphical Chromium/WebGL screenshot could not be produced in the container because EGL could not initialise. The geometry was instead verified using exact footprint/track calculations and a two-dimensional plotted inspection of the Old Town station layout.
