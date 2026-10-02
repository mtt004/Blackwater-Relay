# Aircraft Asset Provenance

## Scope

This document records the provenance and independent creation process for the revised Blackwater Relay narrow-body aircraft asset introduced in the October 2026 aircraft-control/model revision.

The aircraft is an **independently authored, fictional, unbranded narrow-body airliner inspired by public A320-family dimensional and visual references**. It is not an imported Airbus asset and is not intended to reproduce any airline livery.

## Third-party model exclusion

During research, an open-source repository containing an A320 GLB was identified. After the user explicitly prohibited use of that model, it was treated **only as evidence that a third-party A320 model exists**.

No binary model file was downloaded. No GLB/GLTF/OBJ/FBX/Blend asset was imported, opened, converted, traced, optimised or inspected for geometry. No topology, UV layout, material setup, textures, animation clips, LOD structure, mesh proportions or distinctive modelling decisions from that model were used.

The repository contains no third-party aircraft mesh asset. A file-system audit performed during the revision found no `.glb`, `.gltf`, `.fbx`, `.obj` or `.blend` files in the project.

## Independent factual and visual references

The following sources were used only for factual dimensions, system/layout facts, or ordinary visual reference. No source image was copied into the game and no photograph was used as a texture.

### Primary / manufacturer references

1. Airbus — **A320neo product page**  
   https://www.aircraft.airbus.com/en/aircraft/a320-family/a320neo  
   Used for public overall dimensions: 37.57 m overall length, 35.80 m geometric wingspan and 11.76 m overall height.

2. Airbus — **A320 Aircraft Characteristics: Airport and Maintenance Planning**, July 2026  
   https://mediaassets.airbus.com/pm_38_916_916266-iujedqawwy.pdf?fileName=aca32001-jul-2026-2.pdf  
   Used as a dimensional/arrangement reference for general aircraft geometry, landing gear, ground clearances, engine/nacelle placement, doors, probes and ramp-interface proportions.

3. Airbus — **Cockpits**  
   https://www.airbus.com/en/products-services/commercial-aircraft/cockpits  
   Used as a general visual/layout reference for the A320-family flight deck.

4. Airbus flight-deck briefing material surfaced through public web search — **A319/A320/A321 Flight Deck and Systems Briefing for Pilots**  
   https://ads-b.ca/a320/A319-320-321_Flight_Deck_and_Systems_Briefing_for_Pilots.pdf  
   Used to confirm characteristic flight-deck layout facts: captain/first-officer sidesticks on lateral consoles, six display units, PFD/ND pairs, two central ECAM displays, FCU and MCDUs.

5. Safran Nacelles — **Airbus A320neo nacelles**  
   https://www.safran-group.com/products-services/airbus-a320neo-nacelles  
   Used for public LEAP-1A nacelle scale cues (5.1 m length and 2.7 m diameter) and general nacelle component arrangement.

### Independent photographic references

6. Wikimedia Commons — **Airbus A320neo** category  
   https://commons.wikimedia.org/wiki/Airbus_A320neo  
   Used only for multi-angle visual reference of nose shape, cockpit glazing, wing/body proportions, sharklets, nacelles and stance.

7. Wikimedia Commons — **F-WWIQ Airbus A320 sharklet ILA 2012 07.jpg**  
   https://commons.wikimedia.org/wiki/File:F-WWIQ_Airbus_A320_sharklet_ILA_2012_07.jpg  
   Used only as a visual reference for wingtip/sharklet silhouette and wing sweep.

8. Wikimedia Commons — **Lufthansa Airbus A320neo.jpg**  
   https://commons.wikimedia.org/wiki/File:Lufthansa_Airbus_A320neo.jpg  
   Used only as a side/three-quarter photographic reference for overall stance, engine position and nose/tail proportions. Airline paint and markings were not reproduced.

9. Wikimedia Commons — **A320-main-landing-gear.jpg**  
   https://commons.wikimedia.org/wiki/File:A320-main-landing-gear.jpg  
   Used only as a mechanical visual reference for twin-wheel main gear, strut, drag-brace and torque-link cues.

## Independent creation process

### Geometry and topology

- All aircraft geometry is generated at runtime in `src/systems/AirportSystem.js` from Three.js primitives plus newly authored `ShapeGeometry` and `BufferGeometry` definitions.
- The fuselage is generated from a newly authored longitudinal radius profile and 64 procedural radial segments.
- Cockpit, passenger-window and forward-door openings are omitted directly from the generated fuselage topology; they are not decals over an opaque shell.
- Wings, horizontal stabilisers and vertical fin use newly authored 2D planforms converted into game geometry.
- Engine nacelles, pylons, fan discs/blades, spinner, exhaust cone, landing-gear components, control surfaces and cockpit objects are independently placed and sized for Blackwater Relay.
- No third-party mesh vertices, indices or topology were used.

### Scale decisions

Blackwater Relay has a compressed world and a walkable aircraft interior. Therefore the model is not a uniform 1:1 scale copy of an A320.

- Game aircraft length remains 15.1 world units to preserve gates, passenger boarding, taxi paths and runway gameplay.
- Model wingspan is derived from the public A320neo span:length ratio: `15.1 × (35.80 / 37.57)` ≈ 14.39 world units.
- The fuselage cross-section remains intentionally wider than strict uniform scale so the existing walkable cabin and cockpit remain usable.
- Gear, engines, tail and wing planform were re-authored to visually converge toward the public references while respecting the existing airport envelope.

### UVs and textures

- Fuselage UV coordinates are generated mathematically from radial angle and longitudinal fuselage position.
- The aircraft livery is a newly generated 64×64 Three.js `DataTexture` created entirely in code at runtime.
- The fictional scheme uses off-white upper fuselage, dark blue-grey belly, turquoise belt/tail accents and a narrow gold accent.
- There are no airline names, logos, registrations copied from photographs, or source-image textures.
- No UV map or texture from any third-party 3D model was used.

### Materials

All aircraft materials are newly instantiated in Blackwater Relay from project code. Materials use simple physically based values for painted skin, glass, metal, tyres, screens, lights and cockpit surfaces. No third-party material graph or texture set was imported.

### Cockpit

The revised flight deck is independently assembled from simple game geometry. Public layout facts informed the arrangement, but no cockpit asset was copied. Notable changes include:

- lateral sidesticks instead of the earlier generic central yokes;
- captain and first-officer PFD/ND pairs;
- upper/lower centre system displays;
- FCU controls on the glareshield;
- centre pedestal with twin thrust levers, speed-brake/flap levers, radios and two simplified MCDUs;
- paired rudder pedals, gear lever/indicators, overhead switch groups, fire controls, armrests and sun visors.

### Animation and LODs

- Landing gear, flap/slat deployment and aircraft lighting remain code-driven Blackwater Relay systems; no imported animation clips are present.
- Full, medium, low and far aircraft representations are generated procedurally from the newly authored model functions.
- No LOD mesh from a third-party aircraft model was used.

## Fictional identity

The aircraft is deliberately unbranded. Its colour treatment is a Blackwater Relay fictional scheme and does not attempt to reproduce Airbus house colours or any airline livery.
