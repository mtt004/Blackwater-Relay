# Cache-safe station access fix

The previous release could fail at startup when a browser reused ES modules from an older ZIP served from the same `localhost:8080` URL. In that mixed-build state, the current world validator received station objects produced by the older rail planner, which did not include the new `roadAccess` field.

This release:

- applies one build identifier to every local ES-module import and module entrypoint;
- versions the Three.js import-map target;
- marks the resolved rail plan with schema version 2;
- detects an incompatible mixed-build rail plan explicitly;
- retains the strict station-access validation rather than bypassing it.

The cache-busting query is part of the module URL, so the browser must request the matching set of files even when the simulation is served again from the same local address.
