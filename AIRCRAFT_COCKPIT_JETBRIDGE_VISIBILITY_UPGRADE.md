# Aircraft cockpit, camera and jetbridge visibility upgrade

## Diagnosis

The previous full-detail aircraft placed transparent cockpit glazing over an **opaque procedural fuselage shell**. The passenger windows already used real cut-outs, but the cockpit windscreen did not. From the pilot eye point, the camera therefore looked into solid fuselage geometry even though transparent glass meshes were present.

The jetbridge's rigid cab also stopped approximately **1.08 m** from the aircraft door before the flexible dock crossed the remaining distance. That is visually too long for the final soft mating interface and made the bridge appear detached.

## Design research used

Research was performed with Exa before implementation.

- **Airbus Safety First — “Are You Properly Seated?”**: cockpit design is built around a defined eye reference point; the windshield, controls and displays are positioned to provide the pilot an optimum external field of view. https://safetyfirst.airbus.com/are-you-properly-seated/
- **HÜBNER Passenger Boarding Bridge Interface**: the rigid bridge stops clear of the aircraft, then a flexible sliding floor, bumper and folding canopy make the final fuselage contact. HÜBNER lists up to 400 mm of flexible-floor extension. https://www.hubner-group.com/en/products/folding-canopies/passenger-boarding-bridge-interface/
- **Microsoft Flight Simulator camera documentation**: aircraft can expose multiple cockpit/exterior camera definitions from different eyepoints. https://docs.flightsimulator.com/html/Developer_Mode/Aircraft_Editor/Tabs/The_Cameras_Tab.htm

## Implemented changes

### Cockpit visibility

- Added real cockpit windshield and side-window apertures to the procedural fuselage mesh.
- Raised and repositioned the pilot eye point to provide a clearer view above the glareshield.
- Replaced the dark near-opaque cockpit glass with low-opacity, double-sided glazing with depth writes disabled.
- Rebuilt the front glazing as four raked trapezoidal transport-aircraft panes rather than a rectangular visor.
- Added windshield brow/sill framing, a centre mullion and two wipers.
- Added pitot probes and angle-of-attack vanes to improve the full-detail nose model.

### Aircraft camera system

While occupying the pilot seat, **C** now cycles:

1. Pilot
2. Copilot
3. Chase
4. Left Wing
5. Right Wing

Mouse free-look remains active in every mode. Wing cameras open looking inward toward the aircraft, and the chase camera starts with a slight downward viewing angle. The HUD displays the active aircraft camera.

### Jetbridge mating interface

- Reduced the final flexible section from about 1.08 m to **0.39 m**.
- Extended the dock contact 0.06 m over the nominal door-sill coordinate to eliminate a visible daylight seam.
- Narrowed and aligned the folding canopy around the doorway.
- Tightened the accordion ribs and three-sided fuselage seal.
- Extended the threshold/sliding plate continuously from rigid bridge to door sill.

## Validation

- JavaScript lint: passed (57 JS/MJS files).
- Focused aircraft/cabin/jetbridge regression tests: **8 passed**.
- Pilot-eye ray test: no opaque fuselage intersection through the forward windscreen.
- Cockpit glazing opacity: **0.24**, double-sided and transparent.
- Flexible jetbridge extension: **0.39 m**; sill overlap: **0.06 m**.
- Aviation network validator: **10 aircraft**, 69 stress-run arrivals, repeated passenger round trip passed.
- Integration smoke: passed.
- Railway upgrade validator: passed.
- Rail operations validator: passed (304 blocks/signals, 12 services).
