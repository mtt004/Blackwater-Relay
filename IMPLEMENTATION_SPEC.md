# Vehicle collisions, bus operation and steering refinement specification

## Implementation verdict

Implement this as a systems correction, not a visual-only patch. Vehicle hitboxes must be authoritative for collision detection, buses must stop because their route plan contains a real stop target, and steering must convert input into a bounded road-wheel angle over time. Do not fake any of these behaviours with proximity animations, instant heading changes or decorative wireframes.

## Core objective

Upgrade the driving simulation so that:

- Every vehicle has a collision footprint matched to its category and visible body proportions.
- Collision volumes move and rotate with vehicles and remain active across rendering LOD tiers.
- Player/traffic contact produces stable separation and plausible speed loss rather than overlap or teleportation.
- Scheduled buses approach, stop, exchange passengers, open their doors and rejoin traffic at real lane-based stops.
- Keyboard steering is gradual, self-centring and strongly moderated by speed.
- Debugging and diagnostics make the behaviour observable without becoming part of the normal visual presentation.

## Vehicle collision requirements

### Shape representation

Use convex footprints on the road plane rather than one universal rectangle. Profiles must be deterministic and category-specific.

- Passenger cars: tapered front and rear body outline.
- Hatchbacks: fuller rear profile and short nose.
- Sports cars: wider body, narrow nose and aggressive taper.
- SUVs: broad, nearly rectangular footprint with softened corners.
- Vans and emergency vans: tall-body footprint with a tapered cab.
- Buses: long rounded-corner body footprint.
- Lorries: compound cab and trailer footprints.

The collision footprint must not be inferred from the current visual LOD mesh. A distant outline vehicle and a fully rendered vehicle must have the same physical shape.

### Broadphase

Use a spatial hash so collision cost grows approximately with local density rather than total city traffic. Insert each transformed compound footprint by its tight AABB. Deduplicate pairs that share multiple cells.

### Narrowphase

Use separating-axis tests for convex polygon pairs. Compound vehicles require testing each relevant polygon pair. Return a stable contact normal and minimum penetration depth.

### Response

For actual overlap:

- Correct penetration according to inverse mass.
- Apply a low-restitution normal impulse.
- Apply bounded tangential friction.
- Prevent AI speed from becoming an unrealistic reverse speed.
- Preserve a short-lived visual correction offset for lane-following AI.
- Avoid repeated collision notifications by applying a pair cooldown.

Do not disable collisions merely because a vehicle is using low-detail rendering. It is acceptable to omit distant outline-to-outline contacts where neither vehicle can be observed and lane following already prevents overlap.

### Static collision

Use the player vehicle’s convex footprint for buildings and landmarks. Put static colliders in a spatial index so precise polygon checks are limited to nearby structures.

### Debug mode

Provide a key-controlled overlay with different colours for the player, normal traffic, buses and emergency vehicles. The overlay must derive from the same authoritative profile used by the collision system.

## Steering requirements

Keyboard input must command a steering target, not a direct yaw rotation.

- Limit the rate at which road-wheel angle can increase.
- Use a separate self-centring rate after input release.
- Reduce maximum steering lock continuously as speed rises.
- Calculate yaw from speed, wheelbase and road-wheel angle.
- Cap yaw rate at high speed.
- Retain enough low-speed lock for parking.
- Reduce grip and adjust yaw under handbrake without allowing instant spins.
- Drive the visible front-wheel angle from the same steering state.

Acceptance behaviour:

- A single-frame key tap produces roughly one degree of road-wheel change at urban speed.
- Holding the key builds steering progressively.
- Releasing the key recentres progressively.
- At motorway speed, full key input cannot produce a near-right-angle turn.
- At walking speed, full lock still permits a realistic tight manoeuvre.

## Bus-service requirements

### Stop generation

Stops must be attached to a directed incoming lane and a route node. Place the vehicle target far enough before the node that the front of a full-length bus remains outside the junction or crossing.

### Approach

When a bus enters a lane containing its next stop:

- Calculate remaining distance to the stop target.
- Restrict target speed using a comfortable braking envelope.
- Continue normal collision avoidance and signal logic.
- Capture the final target only at low speed to prevent visible teleportation.

### Dwell

At the stop:

- Set speed to zero.
- Keep the bus in lane occupancy so traffic queues behind it.
- Open doors.
- Calculate alighting and boarding subject to passenger load and capacity.
- Calculate dwell time from passenger movement.
- Record arrival and served counts.
- Close doors before departure.
- Prevent immediate re-triggering until the bus has left the lane.

### Stop environment

Render a lane-aligned sign, shelter, bench, glass panels and road-edge bay marker. Visual stop placement must agree with the lane target used by the AI.

## Diagnostics

Expose at minimum:

- Current road-wheel angle.
- Number of active collision contacts.
- Number of buses currently dwelling at stops.
- Existing traffic, congestion, routing, simulation and chunk statistics.

## Tests

Add focused tests for:

- Hitbox profile determinism.
- Tapered passenger-car footprints.
- Compound lorry footprint construction.
- Positive and negative SAT overlap cases.
- Building AABB contact using the vehicle footprint.
- One-frame steering response limit.
- Bus stop generation for both directions.
- Bus possession of lane-specific stop targets.
- Bus approach, exact stop capture, door opening and arrival recording.
- Player/AI dynamic collision response.
- No NaN positions or speeds after repeated updates.

## Failure modes to reject

- One generic box for every vehicle.
- Wireframe hitboxes that do not drive actual collision logic.
- Collision logic based on whether a mesh is visible.
- Buses stopping only when they reach a graph node.
- Decorative bus shelters not connected to route targets.
- Cars passing through a dwelling bus because it was removed from occupancy.
- Steering implemented by directly changing heading from keyboard input.
- Full steering lock reached from a brief tap.
- High-speed yaw large enough to rotate the car tens of degrees in one frame.
- Precise static collision implemented by scanning every city building every frame.

## Quality boundary

This phase targets stable, professional road-plane vehicle interaction. Full 3D rigid-body rollovers, deformable crash structures, articulated trailer hinges and wheel-level suspension contacts remain separate future systems and must not be implied by the current implementation.

## Neighbourhood streaming contract

The active renderer must never expose only a fragment of the local road or building environment.

1. **Local coverage:** keep the current chunk and its four cardinal neighbours fully detailed.
2. **Directional coverage:** calculate a two-cell movement corridor from heading, signed speed, and chunk size.
3. **Future readiness:** prebuild the cardinal neighbourhood of the primary ahead cell while it is still off-screen or represented by outlines.
4. **Atomic activation:** a chunk remains outline-only until its complete detail group has been constructed.
5. **Handover hysteresis:** retain cells that have just left the target set for at least 1.15 seconds.
6. **Corner protection:** load a building-only diagonal halo near chunk corners to prevent large façades being sliced.
7. **Budgeted construction:** build no more than three chunks per frame and stop when the configured 6 ms build budget is exhausted.
8. **Cache protection:** do not evict active, halo, or future-preloaded chunks.
9. **Simulation continuity:** rendering state must not reset routes, passenger loads, incident state, collision state, or pedestrian destinations.
10. **Debuggability:** expose current, neighbouring, ahead, cached, and queued counts in diagnostics.

## Junction geometry and control contract

1. **Shared geometry:** no two road meshes may merely overlap at a raw graph node. Every multi-road node must own either a shared junction polygon or a roundabout annulus.
2. **Trimmed approaches:** carriageways and lane splines must terminate at calculated road mouths derived from road width, junction type, and control requirements.
3. **Lane continuity:** every legal incoming-to-outgoing movement must have a continuous connector curve whose first and last points exactly match the corresponding lane mouths.
4. **Roundabout circulation:** UK traffic must circulate clockwise, remain outside the central island, and yield before entering when circulating traffic has priority.
5. **Strategic signals:** signals are reserved for high-capacity or complex urban junctions. Degree-two road joins and minor local connections must not be signalised by default.
6. **Physical placement:** signal heads belong to incoming approaches at stop lines, face approaching traffic, and provide repeaters where carriageway width warrants them.
7. **Coherent phases:** signals use approach groups, amber intervals, all-red clearance, pedestrian clearance, and whole-approach emergency priority.
8. **Marking discipline:** centre lines, lane dividers, and edge lines stop before junction conflict areas. Stop lines, pedestrian crossings, and roundabout give-way lines are generated from lane geometry.
9. **LOD continuity:** lower-detail road outlines must preserve junction and roundabout connectivity.
10. **Validation:** tests must verify connector endpoints, island clearance, control selection, graph counts, building clearance, and visual junction registration.

## Intelligent lane-discipline contract

1. Lane index `0` is the inner lane nearest the centre line or median; the highest index is the UK kerbside/outer lane.
2. Vehicles should keep left unless overtaking, preparing for a right turn, avoiding an obstruction, or responding to an emergency.
3. Route preparation takes priority over discretionary overtaking as the vehicle approaches a junction.
4. A lane change must reserve both source and target lanes until completion.
5. A merge is legal only when the target lane has sufficient front and rear gaps, including closing-speed allowance.
6. The player must be treated as a target-lane occupant when evaluating a merge.
7. Lane changes must use continuous lateral interpolation between authoritative lane splines; no positional snap is allowed.
8. A manoeuvre must not begin unless there is enough road remaining to complete it before the junction mouth.
9. Indicators must reflect the physical direction of the lane change.
10. Scheduled buses must spawn, travel, stop, and depart in the outer kerbside lane wherever that lane exists.
11. Heavy vehicles may prepare for route movements but should not weave for marginal overtaking gains.
12. Lane-changing logic must remain independent of visual LOD and chunk state.

