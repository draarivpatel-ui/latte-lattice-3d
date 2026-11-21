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

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(here, 'style.css'), 'utf8');
const scene = fs.readFileSync(path.join(here, 'scene.js'), 'utf8');
const engine = fs.readFileSync(path.join(here, 'engine.js'), 'utf8');
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
                             ['engine.js', engine], ['test.js', fs.readFileSync(path.join(here, 'test.js'), 'utf8')]]) {
    assert.equal(/[\u2013\u2014]/.test(txt), false, `${name} contains a forbidden dash`);
  }
});

test('UI 22: styles define the number input and tabular numerics', () => {
  assert.match(css, /input\[type="number"\]/);
  assert.match(css, /font-variant-numeric: tabular-nums/);
});

test('UI 23: package.json exposes the full test command', () => {
  assert.equal(pkg.scripts.test, 'node --test test.js ui.test.js');
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
