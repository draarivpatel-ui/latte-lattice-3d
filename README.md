# LatteLattice 3D

**A kinetic cafe diorama you can measure, with a crystallography lab inside.** LatteLattice 3D is a fully offline WebGL scene with two deterministic pure JavaScript engines underneath it. Every crystal, gear tooth, latte art ripple and steam particle is generated from a seed, and every number shown in the interface is computed from that same geometry rather than typed in by hand. A second module turns the page into a solid-state physics bench: real powder X-ray diffraction, reciprocal lattices, first Brillouin zones, packing factors, theoretical densities and crystallographic file exports.

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

## Crystal Lab

Press **X** or the **Crystal Lab** button to open the lab overlay. It runs on `crystal.js`, a second pure module with no dependency on Three.js or the DOM, and renders into its own WebGL viewport.

- **Six real structures.** Polonium (simple cubic), iron (body-centred cubic), copper (face-centred cubic), silicon (diamond cubic), sodium chloride (rocksalt) and magnesium (hexagonal close-packed), each with literature lattice parameters, atomic radii and molar masses.
- **Powder XRD simulator.** Exact Bragg angles `2theta = 2 arcsin(lambda / 2 d_hkl)`, geometric structure factors `|F(hkl)|^2` with real basis scattering, systematic extinction rules per lattice (BCC `h+k+l` even, FCC `h,k,l` unmixed, diamond unmixed plus `h+k+l` a multiple of 4 when all even, HCP `(h-k)` divisible by 3 with odd `l` extinct), multiplicity and Lorentz-polarization weighting. Cu Ka, Mo Ka and Co Ka radiation are selectable.
- **Clickable spectrum.** Clicking any diffraction peak highlights the exact `(hkl)` Miller family on the 3D crystal as a translucent plane through the unit cell, with coincident families stacked in one chip.
- **Reciprocal space.** One button switches the viewport to the reciprocal lattice: `b1, b2, b3` basis arrows satisfying `a_i . b_j = 2 pi delta_ij`, the reciprocal point cloud and the first Brillouin zone polyhedron (14 faces and 24 vertices for FCC), with its exact volume `(2 pi)^3 / V_primitive` reported.
- **Packing and density.** Unit-cell volume, coordination number, atomic packing factor (SC 52.36 %, BCC 68.02 %, FCC 74.05 %, diamond 34.01 %, Mg 73.62 % from its real `c/a = 1.62` ratio) and theoretical density in g/cm^3, all derived from the cell and basis rather than stored constants.
- **Exports.** One click downloads a `.cif` file (data block, cell parameters, the H-M space-group symbol, an identity-only symmetry record and the full conventional-cell atom list, so no reader can double the atoms), a CSV peak table with per-family intensities plus the summed observed-peak intensity in a `group_I_rel` column, carrying a SHA-256 fingerprint line, and a JSON audit report embedding the same fingerprint and the observed peak count. Byte-identical for identical input.
- **Bookmarking.** The lab state (structure, wavelength, selected Miller indices and scene seed) lives in the URL hash, so `#lab=si&ka=mo&hkl=3,1,1&seed=77` restores a full view on load. Malformed hashes are ignored safely.
- **In-page self-tests.** The Run Self-Tests button executes 41 named checks live in the page: Bragg-law reconstruction, FCC, BCC and diamond extinction rules, coincident-peak summation, reciprocal orthogonality, APF goldens, CIF skeleton markers and hash round-trip.

The lab reads the garden's deterministic seed too: bookmarking captures it and restoring rewinds the cafe crystals to the same state.

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

That command expands to `node --test test.js ui.test.js crystal.test.js` and passes **333 tests, 0 failed, 0 skipped**:

| Suite | Tests | Coverage |
| --- | --- | --- |
| `test.js` | 148 | PRNG, vectors, surfaces, mesh builders, exact area and volume, gear ratios, field statistics, telemetry, camera, lighting, OBJ/STL export and deep regression pins |
| `ui.test.js` | 88 | Real HTML contract, unique ids, resolved labels, every button and readout binding, keyboard shortcuts, Crystal Lab DOM and wiring contracts, modal dialog and inert management, key blocking under the overlay, toast stacking, supercell and WebGL-failure latching contracts, deterministic readouts, content rules and engine export surface |
| `crystal.test.js` | 97 | Lattice parameters, reciprocal basis orthogonality, primitive volumes, Brillouin zone faces, edges and volume, APF goldens, coordination, density, extinction rules, coincident-peak grouping, Bragg angles against literature peaks, Lorentz-polarization intensities, CIF generation and determinism, SHA-256 vectors, CSV and JSON fingerprints, hash round-trips and the shared self-test battery |

Syntax verification:

```sh
node --check engine.js
node --check crystal.js
node --check lab.js
node --check scene.js
node --check test.js
node --check ui.test.js
node --check crystal.test.js
```

All seven files pass. The Node suite runs offline in about 0.8 seconds; the DOM tests validate the shipped markup and wiring source as text plus the real engine modules.

A separate headless Chromium audit drives the live page at 1440x900 and 390x844: it opens the lab, cycles all six presets, clicks a spectrum peak to light the Miller chip, switches wavelength, downloads the CIF, CSV and JSON exports, restores a bookmarked URL hash and runs the in-page self-test battery. 80 checks pass with zero console errors, zero uncaught page errors, zero external network requests and zero horizontal overflow.

## Honest scope

- Geometry, lighting, shaders, camera control and exports are real. The cafe room, telemetry curves and pressure gauge are a visualized simulation, not measurements of a physical espresso machine.
- The XRD pattern uses atomic numbers as scattering factors (the theta = 0 limit) with no angular form-factor falloff, thermal or absorption correction. Peak positions are exact; relative intensities are a kinematic teaching model rather than a Rietveld refinement.
- The bundled Three.js module is the only runtime dependency. No CDN, font, analytics or remote asset is loaded.
- The frame rate readout is a live local measurement. It varies by machine and is not a benchmark claim.
- OBJ, STL, CIF, CSV and JSON exports are generated locally in the page. The CIF output follows the conventional format but has not been re-opened in VESTA or Mercury during this verification run.
- The WebGL rendering path is exercised by the headless Chromium audit described above in addition to source and engine contract tests.

## Project layout

```
index.html        controls, help card, diagnostic readouts, canvas, Crystal Lab markup
style.css         the whole visual system, including the lab overlay
engine.js         pure deterministic geometry, kinematics and telemetry
crystal.js        pure crystallography: lattices, reciprocal basis, BZ, XRD, CIF, SHA-256
scene.js          Three.js renderer, shaders, animation and DOM wiring
lab.js            Crystal Lab overlay: second WebGL view, spectrum, exports, hash state
test.js           engine, regression and export tests
ui.test.js        HTML and UI contract tests
crystal.test.js   crystallography tests
package.json      test script, no dependencies
vendor/           bundled Three.js module
```

## License

MIT.
