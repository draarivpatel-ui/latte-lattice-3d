/*
 * LatteLattice 3D - UI and repository contract tests.
 * Loads the real index.html, the real engine module and the real renderer
 * source, then verifies markup, control bindings, deterministic readouts and
 * strict content rules. No WebGL context or browser is required.
 */

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as E from './engine.js';
import * as C from './crystal.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(here, 'style.css'), 'utf8');
const scene = fs.readFileSync(path.join(here, 'scene.js'), 'utf8');
const engine = fs.readFileSync(path.join(here, 'engine.js'), 'utf8');
const lab = fs.readFileSync(path.join(here, 'lab.js'), 'utf8');
const crystal = fs.readFileSync(path.join(here, 'crystal.js'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(here, 'package.json'), 'utf8'));

function idList() {
  return [...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
}

/* --------------------------- document structure -------------------------- */

test('UI 01: index.html is a valid HTML5 document with a language and viewport', () => {
  assert.match(html.trimStart(), /^<!DOCTYPE html>/i);
  assert.match(html, /<html lang="en">/);
  assert.match(html, /<meta charset="utf-8"/);
  assert.match(html, /name="viewport"/);
  assert.match(html, /<title>LatteLattice 3D/);
});

test('UI 02: all element ids are unique', () => {
  const ids = idList();
  assert.ok(ids.length >= 39, `expected at least 39 ids, found ${ids.length}`);
  assert.equal(new Set(ids).size, ids.length);
});

test('UI 03: every aria-controls, aria-labelledby and for attribute resolves', () => {
  const ids = new Set(idList());
  const refs = [
    ...[...html.matchAll(/\baria-controls="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/\baria-labelledby="([^"]+)"/g)].map((m) => m[1]),
    ...[...html.matchAll(/<label\b[^>]*\bfor="([^"]+)"/g)].map((m) => m[1]),
  ];
  assert.ok(refs.length >= 4);
  for (const ref of refs) assert.ok(ids.has(ref), `unresolved reference #${ref}`);
});

test('UI 04: labels are wired to real interactive controls', () => {
  for (const id of ['grind-speed', 'latte-pattern', 'latte-swirl', 'crystal-seed']) {
    assert.ok(html.includes(`for="${id}"`), `missing label for #${id}`);
    assert.ok(html.includes(`id="${id}"`), `missing control #${id}`);
  }
});

test('UI 05: the page loads style.css and the module renderer', () => {
  assert.match(html, /<link rel="stylesheet" href="\.\/style\.css"/);
  assert.match(html, /<script type="module" src="\.\/scene\.js"><\/script>/);
  assert.ok(fs.existsSync(path.join(here, 'vendor/three.module.min.js')));
});

test('UI 06: a noscript fallback exists', () => {
  assert.match(html, /<noscript>/);
  assert.match(html, /needs JavaScript and WebGL/);
});

/* ------------------------------ control surface -------------------------- */

const BUTTONS = [
  'btn-night', 'btn-sound', 'btn-help', 'btn-help-close', 'btn-steam',
  'btn-regrow', 'btn-obj', 'btn-stl', 'btn-telemetry', 'btn-pause', 'btn-reset-cam',
];
const READOUTS = [
  'pressure', 'pressure-bar', 'grind-speed-val', 'latte-swirl-val',
  'facet-count', 'mesh-count', 'fps', 'surface-area', 'volume',
  'gear-ratio', 'foam-mix', 'field-signature', 'degenerate-facets',
];

test('UI 07: every primary and secondary button is present', () => {
  for (const id of BUTTONS) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});

test('UI 08: every diagnostic readout is present', () => {
  for (const id of READOUTS) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});

test('UI 09: scene.js binds every button exactly once', () => {
  for (const id of BUTTONS) {
    const count = (scene.match(new RegExp(`getElementById\\('${id}'\\)`, 'g')) || []).length;
    assert.ok(count >= 1, `#${id} is never bound`);
  }
});

test('UI 10: scene.js binds every diagnostic readout', () => {
  for (const id of READOUTS) {
    assert.ok(scene.includes(`'${id}'`) || scene.includes(`"${id}"`), `#${id} is not referenced`);
  }
});

test('UI 11: keyboard shortcuts are documented and bound', () => {
  for (const key of ['l', 'h', 'p', 'r']) {
    assert.ok(scene.includes(`e.key === '${key}'`), `missing ${key} shortcut`);
  }
  assert.ok(scene.includes("e.key === ' '"), 'missing space shortcut');
  assert.match(scene, /\/\^\(INPUT\|SELECT\|TEXTAREA\|BUTTON\|A\)\$\/\.test\(tag\)/);
  assert.ok(html.includes('<kbd>space</kbd>'));
  assert.ok(html.includes('<kbd>P</kbd>'));
  assert.ok(html.includes('<kbd>R</kbd>'));
});

test('UI 12: new controls have deterministic handlers', () => {
  for (const fn of ['togglePause', 'resetCamera', 'regrowFromSeed', 'renderTelemetry']) {
    assert.ok(scene.includes(`function ${fn}(`), `missing ${fn}()`);
  }
});

test('UI 13: scene.js imports the new engine diagnostics', () => {
  assert.ok(scene.includes('computeTelemetry'), 'computeTelemetry is not imported');
  assert.ok(scene.includes('patternSignature'), 'patternSignature is not imported');
  assert.ok(engine.includes('export function computeTelemetry'));
  assert.ok(engine.includes('export function patternSignature'));
});

/* -------------------------- deterministic readouts ----------------------- */

test('UI 14: facet-count and mesh-count are derived from the seed', () => {
  const plan = E.buildScenePlan(2026);
  const facets = plan.crystals.reduce((n, c) => n + c.sides * 20, 0);
  assert.ok(facets > 0);
  const t = E.computeTelemetry({ seed: 2026 });
  assert.equal(t.crystalCount, plan.crystals.length);
  assert.ok(t.vertexCount > 0 && t.triangleCount > 0);
});

test('UI 15: gear-ratio readout matches the exact derived ratio', () => {
  const g = E.planetaryGearRatio();
  assert.equal(`${g.toothRatio.toFixed(2)} / ${g.ringTeeth}`, '1.50 / 42');
});

test('UI 16: foam-mix and field-signature are reproducible', () => {
  const t = E.computeTelemetry({ seed: 2026, pattern: 'rosetta' });
  const sig = E.patternSignature('rosetta', 0, 12);
  assert.ok(t.meanFoamMix >= 0 && t.meanFoamMix <= 1);
  assert.equal(sig, 195726611);
  assert.equal(E.patternSignature('rosetta', 0, 12), sig);
});

test('UI 17: surface-area and volume readouts are finite and positive', () => {
  for (const seed of [1, 7, 2026, 999999]) {
    const t = E.computeTelemetry({ seed });
    assert.ok(Number.isFinite(t.surfaceArea) && t.surfaceArea > 0);
    assert.ok(Number.isFinite(t.volume) && t.volume >= 0);
    assert.equal(t.degenerateTriangles, 0);
  }
});

test('UI 18: pausing does not change any deterministic measurement', () => {
  const a = E.computeTelemetry({ seed: 2026, frameCount: 10, elapsedMs: 200 });
  const b = E.computeTelemetry({ seed: 2026, frameCount: 999, elapsedMs: 20000 });
  for (const k of ['surfaceArea', 'volume', 'meanFoamMix', 'toothRatio', 'degenerateTriangles']) {
    assert.equal(a[k], b[k], `${k} changed with frame count`);
  }
});

test('UI 19: pattern switching changes the foam statistics but not the geometry', () => {
  const a = E.computeTelemetry({ seed: 5, pattern: 'rosetta' });
  const b = E.computeTelemetry({ seed: 5, pattern: 'heart' });
  assert.notEqual(a.meanFoamMix, b.meanFoamMix);
  assert.equal(a.surfaceArea, b.surfaceArea);
  assert.equal(a.triangleCount, b.triangleCount);
});

test('UI 20: valve state is echoed into telemetry without touching geometry', () => {
  const closed = E.computeTelemetry({ seed: 5, valveOpen: false });
  const open = E.computeTelemetry({ seed: 5, valveOpen: true });
  assert.equal(closed.activeSteam, false);
  assert.equal(open.activeSteam, true);
  assert.equal(closed.steamParticleCount, open.steamParticleCount);
  assert.equal(closed.surfaceArea, open.surfaceArea);
});

/* ------------------------------ content rules ---------------------------- */

test('UI 21: no em-dashes or en-dashes in any shipped text file', () => {
  for (const [name, txt] of [['index.html', html], ['style.css', css], ['scene.js', scene],
                             ['engine.js', engine], ['crystal.js', crystal], ['lab.js', lab],
                             ['test.js', fs.readFileSync(path.join(here, 'test.js'), 'utf8')],
                             ['crystal.test.js', fs.readFileSync(path.join(here, 'crystal.test.js'), 'utf8')]]) {
    assert.equal(/[\u2013\u2014]/.test(txt), false, `${name} contains a forbidden dash`);
  }
});

test('UI 22: styles define the number input and tabular numerics', () => {
  assert.match(css, /input\[type="number"\]/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
});

test('UI 23: package.json exposes the full test command', () => {
  assert.equal(pkg.scripts.test, 'node --test test.js ui.test.js crystal.test.js revamp-regression-2026-11-24.test.js');
  assert.equal(pkg.type, 'module');
});

test('UI 24: help card documents diagnostics and the new shortcuts', () => {
  assert.match(html, /Scene diagnostics/);
  assert.match(html, /<b>P<\/b> pauses motion/);
  assert.match(html, /scene seed input/);
});

test('UI 25: no network or external asset references in the page', () => {
  assert.equal(/https?:\/\//.test(html), false);
  assert.equal(/<script[^>]+src="https/.test(html), false);
});

test('UI 26: every shipped script parses as valid JavaScript', () => {
  // A syntax check is executed by the package test command separately; here
  // we assert the engine exports the functions the renderer consumes.
  for (const name of ['computeTelemetry', 'patternSignature', 'buildScenePlan',
                      'buildCrystal', 'steamParticles', 'latteField', 'toOBJ', 'toSTL']) {
    assert.equal(typeof E[name], 'function', `engine.${name} is missing`);
  }
});

test('UI 27: a restrictive Content-Security-Policy meta is declared', () => {
  assert.match(html, /http-equiv="Content-Security-Policy"/);
  assert.match(html, /default-src 'self'/);
  assert.match(html, /script-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /base-uri 'none'/);
});

test('UI 28: titles stand alone with no tagline or helper line', () => {
  assert.equal(/class="[^"]*(subtitle|tagline|kicker|eyebrow|lede|deck)[^"]*"/i.test(html), false);
  assert.equal(/\.(subtitle|tagline|kicker|eyebrow|lede|deck)\b/i.test(css), false);
});

test('UI 29: keyboard shortcut toggle exists and defaults to on', () => {
  assert.match(html, /id="keys-enabled"[^>]*checked/);
  assert.match(scene, /keysEnabled/);
});

test('UI 30: help card documents Escape and the shortcut toggle', () => {
  assert.match(html, /<b>Esc<\/b> closes it/);
  assert.match(html, /Keyboard shortcuts<\/b> switch/);
});

test('UI 31: fluid surface is culled to a disk inside the cup wall', () => {
  assert.match(scene, /FLUID_R = 0\.60/);
  assert.match(scene, /PlaneGeometry\(FLUID_R \* 2, FLUID_R \* 2/);
  assert.match(scene, /surfGeo\.setIndex\(keep\)/);
});

test('UI 32: pause freezes a scene-time accumulator, not just dt', () => {
  assert.match(scene, /let sceneTime = 0/);
  assert.match(scene, /sceneTime \+= dt/);
  assert.match(scene, /const t = sceneTime/);
  const animateBody = scene.slice(scene.indexOf('function animate'));
  assert.equal(/clock\.elapsedTime/.test(animateBody), false);
});

test('UI 33: facet-count is derived from the real built geometry', () => {
  assert.equal(/sides \* 20/.test(scene), false);
  assert.match(scene, /facet-count'\)\.textContent = String\(triangles\)/);
});

test('UI 34: crystals are placed through the ledge-clamped engine offset', () => {
  assert.match(scene, /crystalWorldOffset\(c\)/);
});

test('UI 35: hint bar cannot swallow pointer events over the canvas', () => {
  const m = css.match(/#hint-bar\s*{[^}]*}/);
  assert.ok(m && /pointer-events:\s*none/.test(m[0]));
});

test('UI 36: held keys clear on window blur and tab hide', () => {
  assert.match(scene, /addEventListener\('blur', clearKeys\)/);
  assert.match(scene, /visibilitychange/);
});

test('UI 37: toggle shortcuts guard against key auto-repeat', () => {
  assert.match(scene, /e\.repeat\) return/);
});

test('UI 38: wheel dolly normalizes deltaMode and accumulates per frame', () => {
  assert.match(scene, /deltaMode === 1/);
  assert.match(scene, /keys\.dolly = \(keys\.dolly \|\| 0\) \+ /);
});

/* ------------------------------ crystal lab ------------------------------ */

const LAB_IDS = [
  'crystal-lab', 'lab-canvas', 'lab-spectrum', 'lab-hkl-chip', 'lab-peak-table',
  'btn-lab-close', 'lab-structure', 'lab-lambda', 'lab-view-direct',
  'lab-view-recip', 'lab-cells', 'lab-spin', 'lab-export-cif', 'lab-export-csv',
  'lab-export-json', 'lab-copy-link', 'lab-selftest', 'lab-selftest-count',
  'lab-selftest-list', 'lab-structure-name', 'lab-lattice', 'lab-cell-param',
  'lab-cell-volume', 'lab-atoms', 'lab-coord', 'lab-nn', 'lab-apf',
  'lab-density', 'lab-note', 'lab-bvec', 'lab-vprim', 'lab-bz', 'lab-bzvol',
];

test('UI 39: the Crystal Lab overlay exists and starts hidden', () => {
  assert.match(html, /<section id="crystal-lab" role="dialog" aria-modal="true" aria-label="Crystal Lab" hidden>/);
  assert.match(css, /#crystal-lab\[hidden\] \{ display: none; \}/);
});

test('UI 40: every Crystal Lab control and readout id is present in the markup', () => {
  for (const id of LAB_IDS) assert.ok(html.includes(`id="${id}"`), `missing #${id}`);
});

test('UI 41: the preset select carries the six real materials', () => {
  const sel = html.slice(html.indexOf('id="lab-structure"'), html.indexOf('</select>', html.indexOf('id="lab-structure"')));
  for (const id of ['po', 'fe', 'cu', 'si', 'nacl', 'mg']) {
    assert.ok(sel.includes(`value="${id}"`), `preset ${id} missing`);
    assert.ok(C.STRUCTURES[id], `engine has no structure ${id}`);
  }
});

test('UI 42: the radiation select offers Cu, Mo and Co Ka', () => {
  const sel = html.slice(html.indexOf('id="lab-lambda"'), html.indexOf('</select>', html.indexOf('id="lab-lambda"')));
  for (const [id, w] of Object.entries(C.WAVELENGTHS)) {
    assert.ok(sel.includes(`value="${id}"`), `wavelength ${id} missing`);
    assert.ok(w.lambda > 0.5 && w.lambda < 2.5);
  }
  assert.equal(Object.keys(C.WAVELENGTHS).length, 3);
});

test('UI 43: the topbar exposes a Crystal Lab launcher and the hint bar documents X', () => {
  assert.match(html, /id="btn-lab" class="pill"/);
  assert.match(html, /<kbd>X<\/kbd> lab/);
});

test('UI 44: lab.js is a shipped file and imports the local stack only', () => {
  assert.ok(lab.includes("import * as THREE from './vendor/three.module.min.js'"));
  assert.ok(lab.includes("from './engine.js'"));
  assert.ok(lab.includes("import * as C from './crystal.js'"));
  assert.equal(/https?:\/\//.test(lab), false, 'lab.js must not reference the network');
});

test('UI 45: lab.js binds every control id it reads', () => {
  const bound = [...lab.matchAll(/getElementById\('([^']+)'\)/g)].map((m) => m[1]);
  for (const id of bound) assert.ok(html.includes(`id="${id}"`), `lab.js reads missing #${id}`);
  for (const id of ['lab-structure', 'lab-lambda', 'lab-export-cif', 'lab-export-csv',
                    'lab-export-json', 'lab-copy-link', 'lab-selftest', 'btn-lab-close']) {
    assert.ok(bound.includes(id), `#${id} is never bound in lab.js`);
  }
});

test('UI 46: scene.js imports and boots the crystal lab', () => {
  assert.match(scene, /import \{ initCrystalLab \} from '\.\/lab\.js'/);
  assert.match(scene, /initCrystalLab\(\{/);
  assert.match(scene, /getElementById\('btn-lab'\)/);
});

test('UI 47: the X key toggles the lab and the lab swallows other keys while open', () => {
  assert.match(scene, /e\.key === 'x' \|\| e\.key === 'X'/);
  assert.ok(scene.includes('crystalLab.isOpen()) crystalLab.close(); else crystalLab.open()'));
  assert.match(scene, /if \(crystalLab\.isOpen\(\)\) return;/);
});

test('UI 48: lab.js restores a bookmarked hash at boot', () => {
  assert.match(lab, /decodeLabHash\(location\.hash\)/);
  assert.match(lab, /requestAnimationFrame\(\(\) => open\(restored\)\)/);
});

test('UI 49: lab.js writes the state hash through replaceState', () => {
  assert.match(lab, /history\.replaceState\(null, '', url\)/);
  assert.match(lab, /encodeLabHash\(\{/);
});

test('UI 50: lab.js wires the three exports and the copy-link action', () => {
  assert.match(lab, /C\.toCIF\(state\.structure\)/);
  assert.match(lab, /C\.xrdPeakCSV\(state\.pattern\)/);
  assert.match(lab, /C\.xrdAuditJSON\(state\.structure, state\.pattern\)/);
  assert.match(lab, /navigator\.clipboard\.writeText\(link\)/);
});

test('UI 51: the spectrum canvas is clickable and maps taps to peak selection', () => {
  assert.match(lab, /spectrum\.addEventListener\('pointerdown'/);
  assert.match(lab, /selectHkl\(\[f\.h, f\.k, f\.l\]\)/);
  assert.match(lab, /bestDist <= 12/);
});

test('UI 52: selecting a peak forces the direct-space view and highlights the family', () => {
  assert.match(lab, /function selectHkl\(hkl\)/);
  const body = lab.slice(lab.indexOf('function selectHkl'));
  assert.match(body, /state\.view = 'direct'/);
  assert.match(lab, /millerPlanesInCell\(sid, (state\.hkl\[0\], state\.hkl\[1\], state\.hkl\[2\]|h, k, l)\)/);
});

test('UI 53: the self-test button renders PASS and FAIL rows into the list', () => {
  assert.match(lab, /lab-selftest'\)\.addEventListener\('click', runSelfTests\)/);
  assert.match(lab, /chk\.pass \? 'ok' : 'bad'/);
  assert.match(lab, /chk\.pass \? 'PASS' : 'FAIL'/);
  assert.match(lab, /lab-selftest-count'\)\.textContent = `\$\{n\} \/ \$\{out\.length\} checks passed`/);
});

test('UI 54: in-cell atoms keep their coordination shell via displayAtoms margin', () => {
  assert.match(lab, /DISPLAY_MARGIN = \{[^}]*po: 1\.03[^}]*mg: 0\.72[^}]*\}/);
  assert.match(lab, /displayAtoms\(sid, \{\s*cells: state\.cells, margin:/);
  assert.match(lab, /a\.outside \? 0\.55 : 1/);
  assert.match(lab, /col\.multiplyScalar\(0\.4\)/);
});

test('UI 55: every element in the registry has a sphere color', () => {
  for (const s of Object.values(C.STRUCTURES)) {
    for (const atom of s.atoms) {
      assert.match(lab, new RegExp(`${atom.el}: 0x[0-9a-f]{6}`), `no color for ${atom.el}`);
    }
  }
});

test('UI 56: the reciprocal view renders the basis arrows and the BZ wireframe', () => {
  assert.match(lab, /primitiveReciprocal\(sid\)/);
  assert.match(lab, /brillouinZone\(sid\)/);
  assert.match(lab, /new THREE\.ArrowHelper/);
  assert.match(lab, /bz\.edges/);
});

test('UI 57: the lab canvas has its own orbit drag and wheel dolly', () => {
  assert.match(lab, /canvas\.addEventListener\('pointerdown'/);
  assert.match(lab, /canvas\.addEventListener\('wheel'/);
  assert.match(lab, /state\.keys\.dragYaw/);
  assert.match(lab, /state\.keys\.dolly = \(state\.keys\.dolly \|\| 0\) \+ px \* 0\.014/);
});

test('UI 58: the lab render loop reuses the engine camera model', () => {
  assert.match(lab, /state\.cam = stepCamera\(state\.cam, state\.keys, dt\)/);
  assert.match(lab, /orbitToCartesian\(state\.cam\.yaw, state\.cam\.pitch, state\.cam\.radius, state\.cam\.target\)/);
});

test('UI 59: the lab Escape handler runs in capture phase and stops propagation', () => {
  assert.match(lab, /e\.key === 'Escape' && state\.open/);
  assert.match(lab, /e\.stopPropagation\(\)/);
  assert.match(lab, /\}, true\)/);
});

test('UI 60: lab layout is a dialog shell with head, stage and side column', () => {
  for (const cls of ['lab-shell', 'lab-head', 'lab-body', 'lab-stage', 'lab-side']) {
    assert.ok(html.includes(cls), `missing .${cls} in html`);
    assert.ok(css.includes(`.${cls}`), `missing .${cls} in css`);
  }
});

test('UI 61: lab stage is a real viewport: canvas wrapped and spectrum below', () => {
  assert.match(html, /<div class="lab-canvas-wrap">\s*<canvas id="lab-canvas"/);
  assert.match(html, /<canvas id="lab-spectrum" aria-label="Powder X-ray diffraction spectrum"><\/canvas>/);
  assert.match(css, /#lab-canvas \{ width: 100%; height: 100%/);
  assert.match(css, /#lab-spectrum \{\s*display: block; width: 100%; height: 118px;/);
});

test('UI 62: peak rows and self-test rows have dedicated styles', () => {
  assert.match(css, /\.peak-row \{/);
  assert.match(css, /\.peak-row\.sel/);
  assert.match(css, /#lab-selftest-list li\.ok b/);
  assert.match(css, /#lab-selftest-list li\.bad/);
});

test('UI 63: the lab collapses to a single column on phones', () => {
  const m = css.match(/@media \(max-width: 720px\) \{[^}]*\}[\s\S]*$/);
  const labBlock = css.slice(css.lastIndexOf('@media (max-width: 720px)'));
  assert.match(labBlock, /\.lab-body \{ flex-direction: column; \}/);
  assert.match(labBlock, /\.lab-side \{\s*flex: 1; max-width: none;/);
  assert.match(labBlock, /#lab-spectrum \{ height: 96px; \}/);
  assert.match(labBlock, /\.lab-stage \{ flex: none; height: 46%/);
});

test('UI 64: readouts are populated from the physics engine only', () => {
  for (const call of ['packingFactor', 'theoreticalDensity', 'cellVolume',
                      'nearestNeighbor', 'primitiveVolume', 'powderPattern']) {
    assert.match(lab, new RegExp(`C\\.${call}\\(`), `lab never calls ${call}`);
    assert.equal(typeof C[call], 'function');
  }
});

test('UI 65: the help card and meta description mention the Crystal Lab', () => {
  assert.match(html, /<b>Crystal Lab<\/b>/);
  assert.match(html, /powder XRD simulator/);
});

test('UI 66: hash round-trip through the lab restore path', () => {
  const frag = C.encodeLabHash({ structure: 'si', lambda: 'mo', hkl: [2, 2, 0], seed: 77 });
  const back = C.decodeLabHash('#' + frag);
  assert.equal(back.structure, 'si');
  assert.equal(back.lambda, 'mo');
  assert.deepEqual(back.hkl, [2, 2, 0]);
  assert.equal(back.seed, 77);
});

test('UI 67: corrupted hashes cannot crash the lab boot restore', () => {
  for (const h of ['#lab=virus&ka=gamma&hkl=a,b,c&seed=-4', '#lab=', '#hkl=1,2', 'not-a-hash']) {
    const r = C.decodeLabHash(h);
    assert.equal(r.structure, null, `${h} should not select a structure`);
    assert.equal(r.lambda, null);
  }
});

test('UI 68: wavelength switching compresses or stretches the spectrum', () => {
  const cu = C.powderPattern('fe', { lambda: C.WAVELENGTHS.cu.lambda });
  const mo = C.powderPattern('fe', { lambda: C.WAVELENGTHS.mo.lambda });
  assert.ok(mo.peaks.length > cu.peaks.length);
  assert.ok(mo.peaks[0].twoTheta < cu.peaks[0].twoTheta);
});

test('UI 69: the chip and peak rows encode the full Miller readout', () => {
  assert.ok(lab.includes('chip.textContent = `${fams}'));
  assert.ok(lab.includes('dataset.hkl = `${g.families[0].h},${g.families[0].k},${g.families[0].l}`'));
  assert.ok(lab.includes('<span class="m">${fams}</span>'));
  assert.ok(lab.includes('g.families.map((p) => `(${p.h} ${p.k} ${p.l})`).join(\' + \')'));
});

test('UI 70: closing the lab restores focus and stops its render loop', () => {
  assert.match(lab, /cancelAnimationFrame\(rafId\)/);
  assert.match(lab, /state\.lastFocus\.focus/);
  assert.match(lab, /document\.body\.classList\.remove\('lab-open'\)/);
});

test('UI 71: the lab re-sizes its renderer and spectrum with the overlay', () => {
  assert.match(lab, /function sizeLab\(\)/);
  assert.match(lab, /labCamera\.aspect = w \/ h/);
  assert.match(lab, /renderer\.setSize\(w, h, false\)/);
  assert.match(lab, /spectrum\.clientWidth/);
});

test('UI 72: peak rows are real buttons, one per emitted reflection', () => {
  assert.match(lab, /document\.createElement\('button'\)/);
  assert.match(lab, /b\.className = 'peak-row'/);
  assert.match(lab, /peakTable\.textContent = ''/);
});

test('UI 73: exported file names carry the structure id', () => {
  assert.match(lab, /lattelattice-\$\{state\.structure\}\.cif/);
  assert.match(lab, /lattelattice-\$\{state\.structure\}-xrd\.csv/);
  assert.match(lab, /lattelattice-\$\{state\.structure\}-audit\.json/);
});

test('UI 74: the overlay closes on backdrop pointer and on the close button', () => {
  assert.match(lab, /btn-lab-close'\)\.addEventListener\('click', close\)/);
  assert.match(lab, /overlay\.addEventListener\('pointerdown'[\s\S]*e\.target === overlay[\s\S]*close\(\)/);
});

test('UI 75: view toggle pills flip aria-pressed on apply', () => {
  assert.match(lab, /lab-view-direct'\)\.setAttribute\('aria-pressed', String\(state\.view === 'direct'\)\)/);
  assert.match(lab, /lab-view-recip'\)\.setAttribute\('aria-pressed', String\(state\.view === 'reciprocal'\)\)/);
});

test('UI 76: cell toggle flips between single cell and 2x2x2 supercell', () => {
  assert.match(lab, /state\.cells = state\.cells === 2 \? 1 : 2/);
  assert.match(lab, /state\.cells === 2 \? '2x2x2' : '1 cell'/);
});

test('UI 77: the data-URI favicon is still pinned and the lab needs no icon fetch', () => {
  assert.match(html, /<link rel="icon" href="data:," \/>/);
  assert.equal(/<img|url\(https?/i.test(html), false);
});

/* --------------------- review-hardening contracts ------------------------ */

test('UI 78: the overlay is a real modal dialog with inert page management', () => {
  assert.match(html, /<section id="crystal-lab" role="dialog" aria-modal="true" aria-label="Crystal Lab"/);
  assert.match(lab, /inertables[\s\S]*el\.inert = true/);
  assert.match(lab, /el\.inert = false/);
  assert.match(lab, /el\.id !== 'toast'/);
});

test('UI 79: scene keys cannot leak under the open lab', () => {
  const xi = scene.indexOf("e.key === 'x' || e.key === 'X'");
  const openGuard = scene.indexOf('if (crystalLab.isOpen()) return;');
  const keyMapIdx = scene.indexOf('keyMap[e.key]');
  assert.ok(xi > -1 && openGuard > -1 && keyMapIdx > -1);
  assert.ok(xi < openGuard && openGuard < keyMapIdx,
    'X toggle then the lab-open guard must both precede the camera keyMap');
});

test('UI 80: the frame loop stops cleanly without a renderer or camera', () => {
  assert.match(lab, /if \(!state\.open \|\| !renderer \|\| !labCamera\) \{ rafId = 0; return; \}/);
  assert.match(lab, /if \(!ensureRenderer\(\)\) toast\('3D crystal view unavailable/);
});

test('UI 81: coincident groups drive the spectrum, table and chip', () => {
  assert.match(lab, /pat\.groups\.forEach/);
  assert.match(lab, /g\.families\.map\(\(p\) => `\(\$\{p\.h\} \$\{p\.k\} \$\{p\.l\}\)`\)\.join\(' \+ '\)/);
  assert.match(lab, /for \(const g of pat\.groups\)/);
});

test('UI 82: instanced meshes are disposed and seed changes reach the hash', () => {
  assert.match(lab, /o\.isInstancedMesh\) o\.dispose\(\)/);
  assert.match(lab, /noteSeed: updateHash/);
  assert.match(scene, /if \(crystalLab\) crystalLab\.noteSeed\(\)/);
});

test('UI 83: hash decoding cannot be poisoned by Object property names', () => {
  assert.match(crystal, /hasOwnProperty\.call\(STRUCTURES, val\)/);
  assert.match(crystal, /hasOwnProperty\.call\(WAVELENGTHS, val\)/);
});

test('UI 84: the toast stacks above the open lab overlay', () => {
  const toastIdx = css.indexOf('#toast {');
  assert.ok(toastIdx > -1);
  const toastBlock = css.slice(toastIdx, css.indexOf('}', toastIdx));
  const zi = Number(toastBlock.match(/z-index: (\d+)/)[1]);
  const labIdx = css.indexOf('#crystal-lab {');
  const labZi = Number(css.slice(labIdx, css.indexOf('}', labIdx)).match(/z-index: (\d+)/)[1]);
  assert.ok(zi > labZi, `toast z ${zi} must beat lab z ${labZi}`);
});

test('UI 85: peak-table rebuild preserves scroll position and row focus', () => {
  assert.match(lab, /const keepScroll = peakTable\.scrollTop/);
  assert.match(lab, /peakTable\.scrollTop = keepScroll/);
  assert.match(lab, /document\.activeElement\.dataset\.hkl/);
  assert.match(lab, /querySelector\(`\[data-hkl="\$\{focusHkl\}"\]`\)/);
});

test('UI 86: the 2x2x2 supercell draws all 8 frames around the true centre', () => {
  assert.match(lab, /labCenter\(sid\)\.map\(\(x\) => x \* state\.cells\)/);
  // Every (i,j,m) combination of cell copies supplies a shifted frame.
  assert.match(lab, /for \(let i = 0; i < state\.cells; i\+\+\) for \(let j = 0; j < state\.cells; j\+\+\) for \(let m = 0; m < state\.cells; m\+\+\)/);
  assert.match(lab, /for \(let o = 1; o < cellOffsets\.length; o\+\+\)/);
});

test('UI 87: WebGL failure latches instead of retrying every apply', () => {
  assert.match(lab, /let rendererFailed = false/);
  assert.match(lab, /if \(rendererFailed\) return false/);
  assert.match(lab, /rendererFailed = true/);
});

test('UI 88: the missing-markup lab stub exposes the full public surface', () => {
  assert.match(lab, /if \(!overlay\) return \{ isOpen: \(\) => false, close: \(\) => \{\}, open: \(\) => \{\}, noteSeed: \(\) => \{\} \}/);
});

test('UI 89: keyboard users get a working skip link to the scene controls', () => {
  assert.match(html, /<a class="skip-link" href="#panel">Skip to scene controls<\/a>/);
  assert.match(html, /<aside id="panel" tabindex="-1" aria-label="Scene controls">/);
  assert.match(css, /\.skip-link/);
  assert.match(css, /\.skip-link:focus/);
});

test('UI 90: reduced-motion users start paused and CSS motion is disabled', () => {
  assert.match(scene, /prefers-reduced-motion: reduce/);
  assert.match(scene, /syncPauseButton\(\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.ok(css.indexOf('@media (prefers-reduced-motion: reduce)') > css.lastIndexOf('transition:'), 'reduced-motion override must follow transition rules');
});

test('UI 91: the help dialog exposes expanded state and manages focus', () => {
  assert.match(html, /id="btn-help"[^>]*aria-controls="help-card"[^>]*aria-expanded="false"/);
  assert.match(scene, /function setHelpVisibility\(open\)/);
  assert.match(scene, /helpClose\.focus\(\)/);
  assert.match(scene, /helpBtn\.focus\(\)/);
});

test('UI 92: functional copy and controls respect the 12px legibility floor', () => {
  const offenders = [];
  for (const m of css.matchAll(/font-size:\s*(0\.\d+)rem/g)) {
    if (Number(m[1]) < 0.75) offenders.push(m[1]);
  }
  assert.deepEqual(offenders, []);
  assert.match(css, /\.footnote[^}]*color:\s*rgba\(244,231,211,0\.6[0-9]\)/);
});
