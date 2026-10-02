# Startup failure report and fix

## Findings

The project had one confirmed runtime defect and one startup-design weakness.

1. **Confirmed HUD exception:** `HUD.update()` wrote to an element named `junction-controls`, but the supplied `index.html` did not contain that element. This generated `TypeError: Cannot set properties of null (setting 'textContent')` every animation frame. The mismatch was introduced by the seamless-junction diagnostics update.
2. **Blocking startup path:** the previous `main.js` performed road generation, city planning, surrounding-chunk construction, 72 traffic vehicles, 95 pedestrians, transit setup, collision setup and validation synchronously before dismissing the loading overlay. On slower hardware, the browser could not repaint the loading screen during this work, making a slow boot appear frozen.
3. **No startup error boundary:** any exception before the loading-overlay dismissal left the animated loading screen visible indefinitely, with the real fault visible only in DevTools.
4. **Excess synchronous preloading:** the chunk manager constructed the visible neighbourhood, ahead corridor, diagonal façade halo and future-preload neighbourhood immediately during boot. Future cells did not need to block the first playable frame.

## Fixes

- Added the missing `junction-controls` diagnostic element.
- Made HUD field updates tolerant of an absent optional diagnostic element.
- Replaced the monolithic top-level startup with an asynchronous staged boot sequence.
- Added real progress stages and per-chunk progress text.
- The first playable load now builds the current chunk, four cardinal neighbours and primary ahead chunk over separate animation frames.
- Secondary ahead and future-neighbour chunks remain queued for the normal streaming budget rather than blocking boot.
- Starts with 28 ordinary traffic vehicles and 36 pedestrians, then fills to the configured 72/95 targets during idle time.
- Moved expensive road/building validation to idle time after the game is visible.
- Added a startup error boundary. A genuine failure now shows the exception and a reload button instead of an endless loading animation.

## Verification

The boot sequence was executed in an instrumented browser harness with WebGL rendering mocked so all application initialization could be tested in the container. The loading overlay completed and was removed, the HUD ran without exceptions, the chunk neighbourhood was prepared incrementally, and the remaining agents populated in the background.
