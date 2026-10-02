# Benchmarking the optimised simulation

## Deterministic CPU benchmark

Run:

```bash
npm run benchmark
```

This benchmark uses deterministic entity counts and reports JavaScript simulation CPU timings, rail microbenchmarks, heap growth and scene structure. It is not a WebGL FPS benchmark.

## Real-browser profiling

Serve the project over HTTP and open the application with `?perf=1`, or press **P** while it is running. The overlay records rolling frame percentiles, long/severe frames, per-system times, renderer information and heap use when available.

For each representative scenario, allow the simulation to settle, clear or mark the scenario, drive it consistently, then export the summary from the developer console:

```js
cityPerformance.markScenario('dense-city-driving');
// Run the repeatable route or scenario.
cityPerformance.exportSummary();
```

Recommended scenarios:

1. Dense city centre while driving.
2. Major railway station with multiple visible trains.
3. Inside a moving HST.
4. Industrial Exchange during route transfers.
5. Airport area with aircraft active.
6. Rapid movement triggering chunk streaming.
7. Police pursuit or active road incident.

Record median FPS, 1% low FPS, median/p95/p99 frame time, maximum spike, simulation and render CPU time, renderer calls/triangles, visible objects, heap and chunk build time on the same hardware and browser settings for both builds.
