# Factory Road and southeast interchange fix

The screenshot showed four roads converging into one uncontrolled-looking area near Factory Road. The main defect was topological: the M6 motorway, its east slip road, the local industrial arc and the city link all shared the same `SE` node, with two high-speed approaches arriving almost parallel. A larger surface patch could hide gaps but could not make that layout realistic.

Changes:

- Split the interchange into two connected junctions.
- `SE` is now a 21 metre local industrial roundabout serving Industrial Arc, Southeast Link and Industrial Motorway Access.
- Added `M6E`, a separate 28 metre motorway-terminal roundabout serving the M6, M6 East Slip and the new access road.
- Rerouted Industrial Arc so it approaches `SE` from the east instead of looping into the motorway arms.
- Rerouted M6 East Slip to approach `M6E` from the southeast, separating it clearly from the westbound motorway approach.
- Added flared asphalt throats, aligned kerbs and splitter islands at every roundabout approach.
- Preserved UK left-hand traffic and full bidirectional route connectivity.
- Added regression checks that the local junction no longer contains either motorway arm.
