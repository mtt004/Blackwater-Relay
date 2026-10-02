# Rideable bus implementation

## Player interaction

- Scheduled buses can be boarded only while stopped at a bus stop with their doors open.
- The boarding test uses the real front-door position on the kerbside of the bus.
- Press **E** beside the open doors to board.
- Press **E** again at a later stop to leave.
- The player cannot leave while the bus is moving.
- Press **H** while aboard to request the next stop.
- Press **C** to cycle passenger cameras.

## Passenger cameras

- Window seat
- Front saloon
- Exterior chase
- Top-down

## Bus interior

The bus now contains lightweight interior geometry:

- Passenger floor and ceiling
- Fourteen passenger seats
- Grab poles and overhead rail
- Driver seat and dashboard form
- Driver partition
- Animated front passenger doors

## Simulation integration

- A boarded bus remains in full-detail rendering even when it crosses into a lower-detail chunk.
- The city streamer follows the bus while the player is aboard.
- The HUD changes to show bus line, next stop, passenger count, speed and camera mode.
- The minimap player marker follows the bus.
- Passenger boarding does not replace the existing AI route, traffic, collision, signal or bus-stop systems.
