# Class 43 HST rail correction report

> **Superseded layout note:** Ground-level crossing behaviour in this historical report has been replaced by the 13 rail-over-road grade separations and road-accessible station design documented in `ROAD_RAIL_LAYOUT_IMPROVEMENT.md`.


## Faults found

### 1. Hairpin geometry
The former closed Catmull–Rom route placed **City Central** deep inside the perimeter immediately before reconnecting to **North Gate**. That forced the spline to reverse direction in a very short distance. The result was the track knot visible in the supplied top-down screenshot: multiple coaches appeared to fold around a road and station structure.

The old spline also used the uniform `catmullrom` parameterisation. Uniform Catmull–Rom curves can overshoot unevenly spaced control points, making a sharp control-point sequence even worse.

### 2. Train boarding was too restrictive
Boarding checked only the centre points of the two power cars and required the camera to be within eight metres. A player standing beside the middle of a Mark 3 coach could be physically next to the train but still be tens of metres from either cab centre, so pressing **E** did nothing.

### 3. Low effective speed
The nominal route limit was high, but the AI acceleration was only `0.50 m/s²`, dwell times reached 12 seconds, and the manual traction model had more drag than available power at moderate speed. Consequently the diagnostic average remained around 31 km/h.

## Implemented corrections

- Replaced the inward-dipping route with a broad non-self-intersecting perimeter loop.
- Switched the spline to **centripetal Catmull–Rom**, eliminating control-point overshoot.
- Raised the sampled minimum centre-line radius to more than 230 metres.
- Relocated City Central onto the smooth northern transport corridor rather than creating a spur-like indentation.
- Added automatic geometry analysis for minimum radius and self-intersections.
- Boarding now measures distance to the actual oriented footprint of every power car and coach.
- A stopped train can be boarded from anywhere alongside the formation; the player is placed in the active cab.
- Added an on-screen **E — Enter HST cab** prompt and a wait-for-stop message.
- Increased AI line speed to 160 km/h, acceleration to `0.74 m/s²`, and service braking to `1.16 m/s²`.
- Reduced station dwell time to approximately 5–8 seconds.
- Rebalanced player traction, drag, service braking, and emergency braking.
- Reversing a player train no longer jumps it to the opposite track.
