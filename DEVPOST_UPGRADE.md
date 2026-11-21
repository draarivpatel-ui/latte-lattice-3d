# LatteLattice 3D submission upgrade

## Inspiration

A beautiful 3D demo is easy to fake with a few hand placed objects. We wanted a diorama whose geometry, motion and readouts could be inspected and reproduced exactly. LatteLattice 3D turns a single integer seed into a complete cafe scene, then measures that scene with the same pure engine that built it.

## What it does

Open the page and a WebGL cafe appears: a chrome espresso machine with a clickable steam valve, a tooth-count planetary grinder, a latte cup with a displaced and vertex-colored fluid surface, and a garden of seven faceted crystals driven by a custom shader. Drag, keyboard and scroll controls orbit the camera. Day and night presets ease every light and fog value. The whole generated diorama exports as a real OBJ or STL mesh.

The upgraded Scene diagnostics panel reports exact surface area, enclosed volume, gear ratios, foam statistics, a stable field signature, degenerate facet count and live frame rate. A copy button exports the structured snapshot. Pause, camera reset and an editable scene seed make the deterministic behavior easy to demonstrate.

## How we built it

`engine.js` is a pure module with no Three.js, DOM or browser dependency. Mulberry32 and FNV-1a supply deterministic randomness. Parametric grids become tori, faceted twisted crystals, lathed cups and gear outlines. Area comes from the cross product of each facet, volume from the scalar triple product, and the fluid field from four closed-form functions over the unit disk. `scene.js` converts those results into buffer geometries, a custom crystal shader and all DOM controls. The renderer reads diagnostics from the engine rather than hard coding them.

## Challenges

The original camera step normalized yaw through two modulo operations even when no key was pressed, so a zero time step was not idempotent. The upgrade only normalizes when the yaw actually changes, which pinned the drift with a regression test. We also added a typed scene seed input so rebuilding the garden no longer depended on an opaque internal counter, and moved all diagnostic state ahead of the first crystal build to avoid a temporal dead zone read.

Telemetry needed to be honest. Surface area and volume are computed over the actual merged mesh, not estimated from bounding boxes. The fluid signature is a hash of sampled field values, which makes pattern changes detectable without pretending the field is a physical fluid solve. Frame rate is labeled as a local measurement and stays separate from the deterministic geometry numbers.

## Accomplishments

- Exact per-facet area, signed volume, centroid and degenerate facet detection for every exported mesh.
- Closed-form planetary gear ratio analytics cross-checked against the time-stepped gear state.
- Deterministic scene telemetry that is identical for identical seeds regardless of frame count.
- A stable pour field signature and disk sampling statistics for four latte art patterns.
- Pause, camera reset, seed entry, keyboard shortcuts and a copyable diagnostics JSON snapshot.
- Byte-identical OBJ and STL exports verified across repeated calls.
- 186 automated tests covering the engine, regressions, exports and the real HTML contract.

## Verification numbers

Verified on Node v26.8.1 with:

```sh
npm test
```

**186 passed, 0 failed, 0 skipped, 0 cancelled.** The command expands to `node --test test.js ui.test.js`.

| Check | Verified result |
| --- | --- |
| Engine, regression and export tests | 148 passed |
| UI and repository contract tests | 38 passed |
| JavaScript files passing `node --check` | 4 |
| Default seed 2026 crystal count | 7 |
| Merged scene vertices / triangles | 2,310 / 4,580 |
| Merged surface area | 123.560991 |
| Absolute enclosed volume | 17.068150 |
| Degenerate facets | 0 |
| Sun to planet tooth ratio | 1.50 |
| Ring teeth | 42 |
| Rosetta field signature at grid 12 | 195726611 |
| Unit box surface area / volume | 6 / 1, exact |

Surface area and volume scale checks pass at the square and cube of uniform scale. Rim flatness is pinned for all four patterns at two time values. Steam alpha stays within [0, 1] across a full life cycle. All 6 lighting channels interpolate linearly at the midpoint.

## Devpost description

**LatteLattice 3D: a kinetic cafe diorama you can measure.** A single integer seed generates every crystal, gear tooth, latte ripple and steam particle in an offline WebGL scene. The same pure engine that builds the geometry also computes exact surface area, enclosed volume, gear ratios and foam statistics, so every readout is reproducible rather than decorative. Orbit the camera, open the steam valve, switch pour styles, enter a new scene seed, pause motion and export the whole diorama as OBJ or STL. Zero network requests, one bundled local asset, 132 passing tests.

## What's next

Add a WebGL capture regression, validate OBJ and STL imports in external modeling tools, extend the fluid field with a real shallow-water solve and expose per-crystal shape editing. Current diagnostics describe generated geometry, not a measured physical machine, and the automated suite does not open a headless GPU context.
