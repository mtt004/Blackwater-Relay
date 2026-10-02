# Focused improvement report

## Selected issue

The highest-value weakness was not another graphics detail. It was the mismatch between the road model and traffic behaviour.

The city already represented UK left-hand carriageways with multiple lane splines, but ordinary vehicles did not use those lanes intelligently. They generally remained in whichever lane they spawned in. This created several realism and flow problems:

- Long queues formed behind one slow vehicle while an adjacent lane remained empty.
- Vehicles did not move into the correct lane before turning.
- Cars could remain in the inner/overtaking lane indefinitely.
- Lane selection after a junction was largely inherited from the previous lane index rather than the route ahead.
- Bus stops were attached to lane index `0`. In this graph, index `0` is nearest the centre line/median, so multi-lane buses were stopping in the wrong lane and the shelter offset could point into the carriageway rather than towards the kerb.

This issue affected visual realism, congestion behaviour, bus operation, and the credibility of the authoritative lane graph, so it was more valuable to fix than adding another decorative asset.

## Implemented system

### Lane meaning

The graph now exposes explicit helpers for:

- Lanes belonging to one road and direction
- Adjacent-lane lookup
- Outermost/kerbside lane lookup
- Turn classification from incoming and outgoing tangents
- Preferred UK approach lane for a turn

### Lane-change decisions

A vehicle may request a lane change for three reasons:

1. **Route preparation:** move towards the correct lane for the next junction.
2. **Overtaking:** move right when constrained by a materially slower lead vehicle.
3. **Keep-left recovery:** return to the outer lane after passing when the route does not require the inner lane.

Buses and emergency vehicles do not perform discretionary weaving. Lorries may make route-required changes but do not overtake for small speed gains.

### Safety model

Before a manoeuvre begins, the system checks:

- Target lane exists and is open
- Same road and direction
- Enough distance remains before the junction
- Front gap in the target lane
- Rear gap in the target lane
- Rear vehicle closing speed
- Vehicle dimensions
- Driver-specific safety multiplier
- Player position and speed if the player occupies the target lane

Once approved, the vehicle is registered in both lane occupancy sets. That prevents a second vehicle in the same simulation update from accepting the same gap.

### Motion model

The car does not switch lane IDs and jump sideways. It follows a smoothstep blend between matching points on the source and target lane splines over roughly 2.8–4.7 seconds, depending on speed and vehicle type. Heading is blended from both lane tangents, and steering animation uses a steer/counter-steer profile through the manoeuvre.

The target lane becomes authoritative only when the transition completes.

### Indicators

Left and right indicator lamps now have separate materials. AI lane changes illuminate only the correct side rather than flashing all four indicators together.

### Bus correction

Every directional bus stop now selects the highest lane index—the actual UK outer/kerbside lane. Scheduled buses also spawn and choose outgoing lanes consistently with that stop plan.

## Validation

Focused regression tests: **26 passed, 0 failed**.

The tests cover:

- Stable road and lane counts
- Road/building clearance
- Chunk streaming
- Hitbox overlap and separation
- Strategic signals and roundabouts
- Kerbside lane identification
- Left/right turn classification
- Smooth lane interpolation
- Unsafe rear-gap rejection
- Dynamic overtaking
- Kerbside bus stops and bus spawning

A separate 45-second, 76-vehicle simulation produced:

- 23 nodes
- 34 roads
- 106 directional lanes
- 225 buildings
- 72 ordinary vehicles and 4 scheduled buses
- 20 directional bus stops
- 40 pedestrians
- 39 completed lane changes
- 3 lane changes active at the final sampled frame
- 62 rejected unsafe lane-change attempts
- 0 road/building clearance violations
- Approximately 0.51 ms average traffic update time in the Node integration environment
- Approximately 4.60 ms maximum sampled traffic update time

The container cannot provide a representative hardware-accelerated WebGL FPS measurement. The simulation and geometry systems were tested without a GPU renderer, and every JavaScript source file passed syntax validation.
