# LatteLattice 3D

**A kinetic cafe diorama you can measure.** LatteLattice 3D is a fully offline WebGL scene with a deterministic pure JavaScript geometry engine underneath it. Every crystal, gear tooth, latte art ripple and steam particle is generated from a seed, and every number shown in the interface is computed from that same geometry rather than typed in by hand.

Serve the folder with any static file server and open `index.html`. The page uses native ES modules, which browsers do not load over `file://`, so one local command is needed, for example `python3 -m http.server 8080` then `http://localhost:8080/`. There is no build step, no package install, no network request and no account. The only local asset is a bundled copy of Three.js.

**Live demo:** [https://aariv.me/latte-lattice-3d/](https://aariv.me/latte-lattice-3d/)

## Try it in five seconds

| Control | What it does |
| --- | --- |
| **Drag** or **W A S D** | Orbits the camera around the counter. **Q / E** and the scroll wheel dolly. |
| **Open steam valve** | Releases 48 deterministic steam particles and drives the pressure gauge and espresso drips. |
| **Planetary grinder** | Changes the sun gear angular velocity of a real tooth-count gear train. |
| **Pour style** | Swaps the latte art field between rosetta, heart, tulip and swirl. |
| **Regrow crystals** or **Scene seed** | Rebuilds all seven crystals deterministically from an integer seed. |
| **Night mode** | Eases every light, fog and background value between two documented presets. |
| **Export .OBJ / .STL** | Downloads the actual generated diorama as a 3D mesh, not a screenshot. |

Sound stays strictly off until the explicit Sound button is pressed. No audio context is created before that click.

## What the engine computes

All math lives in `engine.js`, which has no dependency on Three.js, the DOM or the browser. It is pure, seedable and testable with Node.

- **Deterministic randomness.** Mulberry32 PRNG and FNV-1a string hashing. The same seed produces byte-identical geometry and byte-identical exports.
- **Procedural geometry.** UV parametric grids, torus surfaces, faceted twisted crystals with capped fans, lathed cup profiles, boxes and extruded gear outlines.
- **Exact mesh measurement.** Per-facet triangle area from the cross product, total surface area, signed volume from the scalar triple product, vertex centroid, degenerate facet counting and axis-aligned bounds.
- **Kinematics.** Pure-rolling planetary gear state and a closed-form gear ratio summary (tooth ratio, carrier rate, planet spin rate, ring tooth count). Steam particle ages, positions and alpha values.
- **Latte art field.** Four deterministic height and foam-mix functions over the unit disk, with a flat rim. Grid sampling statistics and a stable field signature support regression pinning.
- **Camera and lighting.** Spherical orbit state, pure keyboard and drag stepping with pitch and radius clamps, and day/night lighting interpolation.
- **Scene telemetry.** A single deterministic snapshot with crystal, vertex, triangle, area, volume, gear, fluid and frame counters.
- **Mesh export.** Wavefront OBJ and ASCII STL serialization, plus mesh merging with offset triangle indices.

The renderer in `scene.js` turns those pure results into Three.js buffer geometries, a custom crystal shader, a displaced and vertex-colored fluid surface, and all DOM controls. It reads the diagnostics from the engine; it does not invent them.

## Scene diagnostics

The Scene diagnostics panel reports values that are recomputed from the current seed twice per second:

| Readout | Source |
| --- | --- |
| Frame rate | Measured frame count over elapsed milliseconds |
| Surface area | Sum of every triangle area in the merged scene mesh |
| Enclosed volume | Absolute signed volume of that mesh |
| Gear ratio / ring teeth | Sun and planet tooth counts |
| Mean foam mix | Average milk fraction over sampled disk points |
| Field signature | FNV-1a hash of the sampled pour field |
| Degenerate facets | Triangles with area at or below the engine epsilon |

**Copy diagnostics JSON** places the full structured snapshot on the clipboard. For the default seed 2026 the engine reports 7 crystals, 2,310 vertices, 4,580 triangles, a surface area of 123.560991, an enclosed volume of 17.068150, zero degenerate facets and a gear ratio of 1.50 with 42 ring teeth. These are deterministic geometry measurements computed over the exact mesh the export button downloads, not rendered performance benchmarks.

## Interactive controls

- **Pause motion** (or **P**) freezes the animation clock while diagnostics continue to update.
- **Reset camera** (or **R**) restores the default orbit.
- **Scene seed** accepts any integer from 0 to 999,999 and rebuilds the garden from that exact value.
- **Space** toggles steam, **L** toggles lighting, **H** opens help.
- The help card documents every shortcut, and the hint bar repeats the primary ones.

## Verification

Node.js 18 or newer is sufficient. No install is needed.

```sh
npm test
```

That command expands to `node --test test.js ui.test.js` and passes **186 tests, 0 failed, 0 skipped**:

| Suite | Tests | Coverage |
| --- | --- | --- |
| `test.js` | 148 | PRNG, vectors, surfaces, mesh builders, exact area and volume, gear ratios, field statistics, telemetry, camera, lighting, OBJ/STL export and deep regression pins |
| `ui.test.js` | 38 | Real HTML contract, unique ids, resolved labels, every button and readout binding, keyboard shortcuts, deterministic readouts, content rules and engine export surface |

Syntax verification:

```sh
node --check engine.js
node --check scene.js
node --check test.js
node --check ui.test.js
```

All four files pass. The test suite runs offline in about 0.1 seconds. No browser, WebGL context or screenshot is used by the automated checks; the DOM tests validate the shipped markup and wiring source as text plus the real engine module.

## Honest scope

- Geometry, lighting, shaders, camera control and exports are real. The cafe room, telemetry curves and pressure gauge are a visualized simulation, not measurements of a physical espresso machine.
- The bundled Three.js module is the only runtime dependency. No CDN, font, analytics or remote asset is loaded.
- The frame rate readout is a live local measurement. It varies by machine and is not a benchmark claim.
- OBJ and STL exports are generated from the merged procedural meshes. They have not been opened in an external CAD or slicer during this verification run.
- The WebGL rendering path is exercised by source and engine contract tests, not by an automated headless GPU capture.

## Project layout

```
index.html        controls, help card, diagnostic readouts, canvas
style.css         the whole visual system
engine.js         pure deterministic geometry, kinematics and telemetry
scene.js          Three.js renderer, shaders, animation and DOM wiring
test.js           engine, regression and export tests
ui.test.js        HTML and UI contract tests
package.json      test script, no dependencies
vendor/           bundled Three.js module
```

## License

MIT.
