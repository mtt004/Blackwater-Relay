# Heavy Performance Optimization Report

## Objective

Reduce CPU and GPU load while preserving the complete simulation, with particular emphasis on trains, railway infrastructure, stations and surrounding buildings.

## Root causes found

1. Full HST formations were still updated every fixed simulation step even when their detailed meshes were hidden.
2. Railway visibility checks ran at 60 Hz and repeatedly scanned every track, viaduct and station chunk.
3. Full station geometry could remain active in neighbouring chunks rather than becoming simplified until the player approached.
4. Full building geometry was drawn throughout the detailed road neighbourhood, even though only the current local buildings need façade details, windows and roofs.
5. Rendering resolution and shadow cost were fixed even when frame rate was already low.
6. HUD DOM updates occurred every rendered frame.
7. Pedestrian hazard detection compared every pedestrian with every visible traffic vehicle.
8. Many static instanced objects still participated in automatic transform updates.

## Implemented changes

### Train LOD and update throttling

- HST quality now follows the world chunk neighbourhood.
- A train within the current chunk plus the four cardinal chunks can use full quality.
- Once outside that neighbourhood, it immediately changes to the low-detail instanced formation.
- At extreme distance, it becomes a lightweight outline.
- Low-detail train transforms update at 12 Hz.
- Outline transforms update at 6 Hz.
- Full coach geometry, wheels, lighting, door meshes and exhaust are updated only for full-quality trains.
- Train physics, schedules, station stops and door state remain authoritative at the normal simulation rate.
- Low-detail train meshes now support frustum culling and use one shared material.

### Railway and station LOD

- Detailed ballast, sleepers, rails, embankments and viaduct structures are limited to the current four-chunk neighbourhood.
- Outside that area, track falls back to simplified line geometry.
- Railway and station visibility decisions are refreshed at 5 Hz instead of 60 Hz.
- Stations are full quality only when very close or when approached inside the current chunk.
- Other visible stations use simplified platforms, canopies, access links and station halls.
- Station pedestrians are active only at full-quality nearby stations and update at 15 Hz.

### Building LOD

- Only the current chunk and the small boundary halo use full building façades, windows, roofs, doors and details.
- Surrounding road chunks now use one shadow-free `InstancedMesh` of simplified building volumes.
- More distant buildings use line outlines, which are hidden beyond the useful viewing distance.
- Roads remain detailed throughout the driving neighbourhood, so vehicle navigation and road appearance are preserved.

### Adaptive rendering

- Added adaptive internal render resolution.
- Resolution gradually falls when sustained FPS is below 43.
- Resolution gradually recovers when sustained FPS is above 56.
- The allowed range is 0.62–1.0 device-independent pixel ratio.
- The shadow map was reduced to 512×512.
- Shadow refresh changed from every 8 frames to every 12 frames.
- The HUD is now updated at 10 Hz rather than every render frame.
- Returning from a hidden browser tab resets frame timing to prevent a simulation catch-up spike.

### CPU-side improvements

- Pedestrian traffic checks now use a 12-metre spatial grid rather than scanning every traffic vehicle for every pedestrian.
- Static instanced city and railway meshes have automatic matrix updates disabled.
- Detailed traffic target was reduced from 72 to 64 and pedestrian target from 95 to 72 to avoid excessive CPU load on lower-end systems.
- Chunk construction is limited to two chunks and 4.5 ms of build work per frame.

## Files with functional changes

- `src/config.js`
- `src/main.js`
- `src/world/WorldChunkManager.js`
- `src/world/CityBuilder.js`
- `src/rail/RailSystem.js`
- `src/systems/PedestrianSystem.js`
- `tests/tests.js`

Other JavaScript and HTML files only received the synchronized module cache tag required by the repository lint rule.

## Validation

- 77 focused tests passed in six disjoint batches.
- New regression coverage verifies:
  - surrounding buildings use low-quality instanced geometry;
  - trains become low quality immediately outside the four-chunk neighbourhood.
- JavaScript linting passed across 30 files.
- Integration smoke testing passed with:
  - 35 roads;
  - 5 trains;
  - 37 traffic vehicles;
  - 48 pedestrians;
  - 3 aircraft;
  - 1 active police unit.
- ZIP integrity was checked after packaging.

## Initial LOD snapshot

At the default starting location, the optimized build selected:

- 1 full-quality building chunk;
- 5 low-quality building chunks;
- 6 detailed road/infrastructure chunks;
- 2 detailed railway chunks and 18 low railway chunks;
- 0 full stations and 8 low stations;
- 5 low-detail trains.

This snapshot varies as the player moves and looks around.

## Remaining limitation

A reliable FPS gain cannot be expressed as a universal number because the result depends on GPU, CPU, browser, resolution and camera direction. The implementation removes known unnecessary draw, transform, DOM and proximity-check work, but the real improvement should be measured on the target machine using the same route and camera view before and after the change.
