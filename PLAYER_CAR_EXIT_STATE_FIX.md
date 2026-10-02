# Player Car Exit State Fix

## Root cause

The player controller used one `position` vector for both the driven car and the walking player. After pressing **E**, walking mode updated that vector from the camera, while the frame loop continued copying the same vector back into the car mesh. The result was a parked car that followed the player on foot.

The vehicle collision system also represented the player car at the walking player's position after exit, which could create incorrect parked-car collision behaviour.

## Changes

- The car mesh is synchronised from the authoritative driving position only while `inVehicle` is true.
- Exiting uses a safe position beside the car and leaves the car at its parked transform.
- Re-entering copies the parked car transform back into the driving state before vehicle physics resumes.
- Save data records the parked car position while the player is walking.
- Parked-car collision now uses the car mesh position and rotation, not the walking-player position.
- Collision impulses cannot assign driving speed while the player is outside the car.

## Regression coverage

Added tests proving that:

- walking after exit does not move the parked car;
- walking and vehicle positions become independent;
- re-entering resumes vehicle authority at the parked car rather than teleporting it to the player.

All 75 focused tests, linting and the integrated simulation smoke test passed.
