# Flight simulator, cockpit and terrain upgrade

Date: 2026-10-02

## What changed

### Flight controls and physics
- Corrected the manual-flight left/right convention. Arrow-left now yaws/tracks left and Arrow-right yaws/tracks right. A/D roll is also visually and aerodynamically consistent: D banks and turns right; A banks and turns left.
- Replaced the old fixed bank-to-yaw constant with a speed-dependent coordinated-turn approximation based on bank angle (`g * tan(bank) / airspeed`), with the sign adjusted for Three.js' aircraft roll convention.
- Rudder now adds a smaller yaw/sideslip contribution rather than being the primary mechanism that turns an airborne aircraft.
- Added engine spool lag, rolling resistance, wheel braking, quadratic aerodynamic drag, gear/flap drag, lift varying with airspeed and angle of attack, bank-related loss of vertical lift, vertical-speed integration, and a reachable critical-AoA/stall degradation region.
- Take-off now requires sufficient ground speed plus a positive elevator command; low-speed/high-AoA flight develops sink rather than hovering.
- Added pilot-state outputs for altitude, vertical speed, heading, bank, AoA, engine power, gear, flaps and stall warning.
- Pilot HUD now uses knots, feet and feet/minute and exposes heading, altitude, V/S, bank, AoA, throttle/engine power, flap state and gear state.

### Cockpit detail
- Rebuilt the instrument panel hierarchy with dual PFD/ND pairs, upper/lower system displays, standby display and display bezels.
- Added an FCU/autopilot strip with knobs/indicators, a populated centre pedestal, radios, throttle grips, speed-brake and flap levers, trim wheels, rudder pedals, side consoles, headrests, a fire panel and a substantially populated overhead panel.
- Existing transparent cockpit glazing and free-look/camera system are preserved.

### Terrain and scenery
- Replaced the featureless mainland colour with a deterministic repeating procedural ground texture to provide motion, scale and bank/turn cues.
- Added procedural animated water texture and bump detail to the regional sea and harbour water.
- Added rural scenery only outside defined urban/airport districts: 30 textured farm fields, tramlines, 110 hedgerow segments, woodland clumps, barns and silos.
- Existing Merehaven island fields/hedges/farm tracks/livestock remain in place, so the new mainland scenery complements rather than duplicates the island system.
- New vegetation is added through the existing chunk/instancing path where practical so quality-tier streaming remains intact.

## Research used through Exa

1. FAA, *Pilot's Handbook of Aeronautical Knowledge*, Chapter 5 — lift, drag, angle of attack, stalls and the fact that banking supplies the horizontal lift component that turns an aircraft:
   https://www.faa.gov/sites/faa.gov/files/07_phak_ch5_0.pdf
2. Airbus cockpit overview — modern transport-cockpit display hierarchy/commonality reference:
   https://www.airbus.com/en/products-services/commercial-aircraft/cockpits
3. NASA Langley, *Terrain Portrayal for Head-Down Displays Flight Test* — terrain texturing and depth cues as a meaningful part of pilot terrain/situation awareness:
   https://ntrs.nasa.gov/citations/20040034179
4. Microsoft Flight Simulator 2024 terrain developer documentation — explicit differentiation of urban, low-vegetation, forest/high-vegetation, ploughed-land, water and other surface classes:
   https://docs.flightsimulator.com/msfs2024/html/2_DevMode/Menus/Debug/Terrain.htm

## Validation

- `npm run lint` — passed, 58 JavaScript files, one cache tag.
- `npm run validate:flight` — passed:
  - left/right rudder headings: about -10.6° / +10.6° in the test interval;
  - A/D banks/turns have matching directions;
  - low-speed full pull reaches about 16° AoA and develops roughly -14.5 m/s vertical speed with stall warning;
  - 30 farm fields, 6 barns, 110 hedges and 342 tree crowns present;
  - procedural mainland/water maps and water bump map present;
  - expanded cockpit detail present across the fleet.
- `npm run validate:aviation` — passed: 10 aircraft, 69 stress-run arrivals, repeated passenger round trip.
- `npm run smoke` — passed.
- `npm run validate:railway` — passed.
- `npm run validate:operations` — passed.
- `npm run benchmark` — frame p95 about 6.55 ms in the Node simulation benchmark; airport update mean about 0.086 ms. Scene complexity increased intentionally because of cockpit/scenery detail, while the benchmark remained comfortably below a 16.7 ms 60-Hz frame budget on this synthetic CPU-side run.
- The monolithic `npm test` runner exceeded the execution window, so it is not claimed as passed; targeted validators covering the modified systems and major regressions were run instead.
