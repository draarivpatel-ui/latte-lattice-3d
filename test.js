/*
 * LatteLattice 3D - deterministic engine unit tests.
 * Run with:  node --test test.js
 * No DOM, no WebGL, no network. Pure logic only.
 */

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from './engine.js';

const approx = (a, b, tol = 1e-6) => assert.ok(
  Math.abs(a - b) <= tol,
  `expected ${a} to be within ${tol} of ${b}`,
);

/* ---------------------------------- RNG ---------------------------------- */

test('makeRng is deterministic for the same seed', () => {
  const a = E.makeRng(42), b = E.makeRng(42);
  const seqA = [a(), a(), a(), a(), a()];
  const seqB = [b(), b(), b(), b(), b()];
  assert.deepEqual(seqA, seqB);
});

test('makeRng produces different sequences for different seeds', () => {
  const a = E.makeRng(1), b = E.makeRng(2);
  assert.notEqual(a(), b());
});

test('makeRng outputs are all within [0, 1)', () => {
  const r = E.makeRng(777);
  for (let i = 0; i < 500; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('makeRng handles non-finite seed gracefully', () => {
  const r = E.makeRng(NaN);
  assert.ok(r() >= 0 && r() < 1);
});

test('hashString is stable and returns uint32', () => {
  const h = E.hashString('latte-lattice-3d');
  assert.equal(h, E.hashString('latte-lattice-3d'));
  assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff);
  assert.notEqual(h, E.hashString('latte-lattice-3e'));
});

test('hashString of empty string equals FNV offset basis', () => {
  assert.equal(E.hashString(''), 0x811c9dc5);
});

/* ------------------------------- scalar math ------------------------------ */

test('clamp bounds values correctly', () => {
  assert.equal(E.clamp(5, 0, 1), 1);
  assert.equal(E.clamp(-5, 0, 1), 0);
  assert.equal(E.clamp(0.5, 0, 1), 0.5);
});

test('lerp interpolates endpoints and midpoint', () => {
  assert.equal(E.lerp(0, 10, 0), 0);
  assert.equal(E.lerp(0, 10, 1), 10);
  assert.equal(E.lerp(0, 10, 0.5), 5);
});

test('smoothstep is clamped and eased', () => {
  assert.equal(E.smoothstep(-1), 0);
  assert.equal(E.smoothstep(2), 1);
  assert.equal(E.smoothstep(0.5), 0.5);
});

/* ------------------------------- vector math ------------------------------ */

test('vecAdd and vecSub are inverse operations', () => {
  const a = [1, 2, 3], b = [4, -1, 0.5];
  assert.deepEqual(E.vecSub(E.vecAdd(a, b), b), a);
});

test('vecScale multiplies each component', () => {
  assert.deepEqual(E.vecScale([1, -2, 3], 2), [2, -4, 6]);
});

test('vecDot of orthogonal vectors is zero', () => {
  approx(E.vecDot([1, 0, 0], [0, 1, 0]), 0);
});

test('vecCross of X and Y gives Z', () => {
  assert.deepEqual(E.vecCross([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
});

test('vecLength of 3-4-0 vector is 5', () => {
  approx(E.vecLength([3, 4, 0]), 5);
});

test('vecNormalize returns a unit vector', () => {
  approx(E.vecLength(E.vecNormalize([3, 4, 0])), 1);
});

test('vecNormalize of zero vector is safe (returns zero)', () => {
  assert.deepEqual(E.vecNormalize([0, 0, 0]), [0, 0, 0]);
});

test('rotateY preserves length and Y component', () => {
  const p = [1, 2, 3];
  const r = E.rotateY(p, 0.7);
  approx(E.vecLength(r), E.vecLength(p));
  assert.equal(r[1], p[1]);
});

test('rotateZ by 2pi returns the original point', () => {
  const p = [1, 2, 3];
  const r = E.rotateZ(p, E.TAU);
  approx(r[0], p[0]); approx(r[1], p[1]); assert.equal(r[2], p[2]);
});

/* --------------------------- parametric surfaces -------------------------- */

test('parametricGrid has (nu+1)*(nv+1) vertices', () => {
  const g = E.parametricGrid((u, v) => [u, v, 0], 4, 3);
  assert.equal(g.positions.length, 5 * 4);
});

test('parametricGrid index maps row-major and sample corners', () => {
  const g = E.parametricGrid((u, v) => [u, v, 0], 2, 2);
  assert.deepEqual(g.positions[g.index(0, 0)], [0, 0, 0]);
  assert.deepEqual(g.positions[g.index(2, 2)], [1, 1, 0]);
});

test('gridTriangles produces 2 triangles per cell', () => {
  const g = E.parametricGrid((u, v) => [u, v, 0], 4, 3);
  assert.equal(E.gridTriangles(g).length, 4 * 3 * 2);
});

test('computeNormals on a flat XY grid all point along -Z (given winding)', () => {
  const g = E.parametricGrid((u, v) => [u, v, 0], 2, 2);
  const tris = E.gridTriangles(g);
  const n = E.computeNormals(g.positions, tris);
  for (const v of n) {
    approx(v[2], -1);
  }
});

test('torusSurface radius in XZ plane is R +/- r', () => {
  const R = 2, r = 0.5;
  // v=0 -> cv=1 -> radius R+r ; v=0.5 -> cv=-1 -> radius R-r
  const p0 = E.torusSurface(0, 0, R, r);
  const p1 = E.torusSurface(0, 0.5, R, r);
  approx(Math.hypot(p0[0], p0[2]), R + r);
  approx(Math.hypot(p1[0], p1[2]), R - r);
});

/* ------------------------------ mesh builders ----------------------------- */

test('buildBox has 8 vertices and 12 triangles', () => {
  const m = E.buildBox(1, 1, 1);
  assert.equal(m.vertexCount, 8);
  assert.equal(m.triangleCount, 12);
});

test('buildBox bounds are symmetric', () => {
  const m = E.buildBox(2, 4, 6);
  assert.deepEqual(m.bounds.min, [-1, -2, -3]);
  assert.deepEqual(m.bounds.max, [1, 2, 3]);
});

test('buildBox normals are unit length', () => {
  const m = E.buildBox(1, 1, 1);
  for (const n of m.normals) approx(E.vecLength(n), 1, 1e-6);
});

test('buildTorus respects segment counts after seam welding', () => {
  const m = E.buildTorus(2, 0.5, 8, 6);
  assert.equal(m.vertexCount, 8 * 6);
  assert.equal(m.triangleCount, 8 * 6 * 2);
});

test('buildTorus is deterministic', () => {
  const a = E.buildTorus(2, 0.5, 8, 6);
  const b = E.buildTorus(2, 0.5, 8, 6);
  assert.deepEqual(a.positions, b.positions);
});

test('buildCrystal is deterministic for a fixed seed', () => {
  const a = E.buildCrystal({ seed: 5, sides: 6, uSegs: 12, vSegs: 8 });
  const b = E.buildCrystal({ seed: 5, sides: 6, uSegs: 12, vSegs: 8 });
  assert.deepEqual(a.positions, b.positions);
});

test('buildCrystal is different for a different seed', () => {
  const a = E.buildCrystal({ seed: 5, sides: 6, uSegs: 12, vSegs: 8 });
  const b = E.buildCrystal({ seed: 6, sides: 6, uSegs: 12, vSegs: 8 });
  assert.notDeepEqual(a.positions, b.positions);
});

test('buildCrystal with caps adds two center vertices', () => {
  const withCap = E.buildCrystal({ uSegs: 12, vSegs: 8, cap: true });
  const noCap = E.buildCrystal({ uSegs: 12, vSegs: 8, cap: false });
  assert.equal(withCap.vertexCount, noCap.vertexCount + 2);
});

test('crystalProfile height increases linearly with v', () => {
  const p0 = E.crystalProfile(0.3, 0.0, { height: 3, seed: 1 });
  const p1 = E.crystalProfile(0.3, 1.0, { height: 3, seed: 1 });
  approx(p0[1], 0);
  approx(p1[1], 3);
});

test('buildLathe produces a surface of revolution (constant radius at a row)', () => {
  const profile = [[0.5, 0], [0.5, 1], [0.2, 2]];
  const m = E.buildLathe(profile, 12);
  // The duplicated u=0 / u=1 seam column is welded away: n columns per row.
  assert.equal(m.vertexCount, 12 * profile.length);
  // Middle row (v index 1) should all have radius 0.5 in XZ.
  for (let i = 0; i < 12; i++) {
    const p = m.positions[1 * 12 + i];
    approx(Math.hypot(p[0], p[2]), 0.5, 1e-6);
  }
});

test('boundsOf handles empty positions', () => {
  assert.deepEqual(E.boundsOf([]), { min: [0, 0, 0], max: [0, 0, 0] });
});

/* --------------------------- kinematics / gears --------------------------- */

test('gearOutline returns teeth*4 points', () => {
  const pts = E.gearOutline(10, 0.8, 1.0, 3);
  assert.equal(pts.length, 40);
  for (const p of pts) assert.equal(p.length, 2);
});

test('gearOutline is deterministic for the same seed', () => {
  assert.deepEqual(E.gearOutline(10, 0.8, 1, 7), E.gearOutline(10, 0.8, 1, 7));
});

test('planetaryState returns the requested number of planets', () => {
  const s = E.planetaryState({ planets: 4, t: 1.2 });
  assert.equal(s.planets.length, 4);
});

test('planetaryState at t=0 has zero sun and carrier angle', () => {
  const s = E.planetaryState({ t: 0 });
  approx(s.sunAngle, 0);
  approx(s.carrierAngle, 0);
});

test('planetaryState planets lie on a circle of equal radius', () => {
  const s = E.planetaryState({ planets: 3, t: 1, sunR: 0.9 });
  const radii = s.planets.map((p) => Math.hypot(p.position[0], p.position[2]));
  approx(radii[0], radii[1]);
  approx(radii[1], radii[2]);
});

test('planetaryState ring stays fixed', () => {
  assert.equal(E.planetaryState({ t: 5 }).ringAngle, 0);
});

test('steamParticles returns count particles with finite positions', () => {
  const ps = E.steamParticles({ count: 20, t: 1.0 });
  assert.equal(ps.length, 20);
  for (const p of ps) {
    assert.equal(p.position.length, 3);
    for (const c of p.position) assert.ok(Number.isFinite(c));
  }
});

test('steamParticles are deterministic', () => {
  assert.deepEqual(
    E.steamParticles({ count: 12, t: 2, seed: 4 }),
    E.steamParticles({ count: 12, t: 2, seed: 4 }),
  );
});

test('steamParticles closed valve yields zero alpha', () => {
  const ps = E.steamParticles({ count: 16, t: 1, open: false });
  for (const p of ps) assert.equal(p.alpha, 0);
});

test('steamParticles origin offset is applied', () => {
  const ps = E.steamParticles({ count: 1, t: 0, origin: [5, 6, 7], spread: 0 });
  approx(ps[0].position[0], 5);
  approx(ps[0].position[2], 7);
});

/* ------------------------------ latte field ------------------------------- */

test('latteField returns finite height/mix for all patterns', () => {
  for (const pat of ['rosetta', 'heart', 'tulip', 'swirl', 'unknown-fallback']) {
    for (let x = -1; x <= 1; x += 0.5) {
      for (let z = -1; z <= 1; z += 0.5) {
        const f = E.latteField(x, z, 0.5, pat);
        assert.ok(Number.isFinite(f.height));
        assert.ok(Number.isFinite(f.mix));
        assert.ok(f.mix >= 0 && f.mix <= 1);
      }
    }
  }
});

test('latteField flattens the rim (height ~ 0 outside unit disk)', () => {
  const f = E.latteField(1.5, 0, 0, 'rosetta');
  approx(f.height, 0, 1e-9);
  approx(f.mix, 0, 1e-9);
});

test('latteField is deterministic for identical inputs', () => {
  assert.deepEqual(E.latteField(0.2, -0.3, 1.1, 'heart'),
                   E.latteField(0.2, -0.3, 1.1, 'heart'));
});

test('mixColor interpolates endpoints', () => {
  assert.deepEqual(E.mixColor([0, 0, 0], [1, 1, 1], 0), [0, 0, 0]);
  assert.deepEqual(E.mixColor([0, 0, 0], [1, 1, 1], 1), [1, 1, 1]);
  assert.deepEqual(E.mixColor([0, 0, 0], [1, 1, 1], 0.5), [0.5, 0.5, 0.5]);
});

test('mixColor clamps t to [0,1]', () => {
  assert.deepEqual(E.mixColor([0, 0, 0], [1, 1, 1], 5), [1, 1, 1]);
});

/* -------------------------------- camera ---------------------------------- */

test('orbitToCartesian at radius r stays at distance r from target', () => {
  const target = [1, 2, 3];
  const p = E.orbitToCartesian(0.8, 0.3, 5, target);
  approx(E.vecLength(E.vecSub(p, target)), 5);
});

test('orbitToCartesian clamps extreme pitch', () => {
  const p = E.orbitToCartesian(0, 10, 5, [0, 0, 0]);
  assert.ok(Math.abs(p[1] / 5) <= 1);
});

test('stepCamera is pure (does not mutate input state)', () => {
  const s = { yaw: 0.6, pitch: 0.35, radius: 9, target: [0, 1.2, 0] };
  const snapshot = JSON.parse(JSON.stringify(s));
  E.stepCamera(s, { d: true, w: true }, 0.5);
  assert.deepEqual(s, snapshot);
});

test('stepCamera rotates yaw with d key and not with no keys', () => {
  const base = E.stepCamera({ yaw: 0, pitch: 0, radius: 9, target: [0, 0, 0] }, {}, 1);
  approx(base.yaw, 0);
  const moved = E.stepCamera({ yaw: 0, pitch: 0, radius: 9, target: [0, 0, 0] }, { d: true }, 1);
  assert.ok(moved.yaw > 0);
});

test('stepCamera clamps radius to [3, 22]', () => {
  const near = E.stepCamera({ yaw: 0, pitch: 0, radius: 9, target: [0, 0, 0] }, { q: true }, 100);
  assert.equal(near.radius, 3);
  const far = E.stepCamera({ yaw: 0, pitch: 0, radius: 9, target: [0, 0, 0] }, { e: true }, 100);
  assert.equal(far.radius, 22);
});

test('stepCamera keeps yaw normalized in [-PI, PI]', () => {
  let s = { yaw: 0, pitch: 0, radius: 9, target: [0, 0, 0] };
  for (let i = 0; i < 50; i++) s = E.stepCamera(s, { d: true }, 1);
  assert.ok(s.yaw >= -Math.PI && s.yaw <= Math.PI);
});

/* -------------------------------- lighting -------------------------------- */

test('lightingPreset(0) equals day values and (1) equals night values', () => {
  const day = E.lightingPreset(0), night = E.lightingPreset(1);
  assert.ok(day.ambient > night.ambient);
  assert.ok(day.warm < night.warm);
});

test('lightingPreset(mode) is clamped outside [0,1]', () => {
  assert.deepEqual(E.lightingPreset(-3), E.lightingPreset(0));
  assert.deepEqual(E.lightingPreset(9), E.lightingPreset(1));
});

test('lightingPreset midpoint interpolates background', () => {
  const mid = E.lightingPreset(0.5);
  approx(mid.background[0], (0.96 + 0.05) / 2, 1e-6);
});

/* ---------------------------- export / OBJ STL ---------------------------- */

test('toOBJ contains v, vn and f lines for a box', () => {
  const obj = E.toOBJ(E.buildBox(1, 1, 1));
  assert.ok(obj.startsWith('# LatteLattice 3D OBJ export'));
  assert.equal((obj.match(/^v /gm) || []).length, 8);
  assert.equal((obj.match(/^vn /gm) || []).length, 8);
  assert.equal((obj.match(/^f /gm) || []).length, 12);
});

test('toOBJ respects offset and scale', () => {
  // Box 2,2,2 has half-extents 1; scale 2 -> 2; offset +10 -> {8, 12}.
  const obj = E.toOBJ(E.buildBox(2, 2, 2), { offset: [10, 0, 0], scale: 2 });
  assert.ok(obj.includes('v 8 -2 -2') || obj.includes('v 12 2 2'));
  const xs = [...obj.matchAll(/^v (\S+) /gm)].map((m) => Number(m[1]));
  for (const x of xs) assert.ok(x === 8 || x === 12);
});

test('toSTL has one facet per triangle', () => {
  const stl = E.toSTL(E.buildBox(1, 1, 1));
  assert.equal((stl.match(/facet normal/g) || []).length, 12);
  assert.ok(stl.trim().startsWith('solid LatteLattice'));
  assert.ok(stl.trim().endsWith('endsolid LatteLattice'));
});

test('toSTL emits finite normals', () => {
  const stl = E.toSTL(E.buildTorus(2, 0.5, 8, 6));
  for (const m of stl.matchAll(/facet normal (\S+) (\S+) (\S+)/g)) {
    for (let i = 1; i <= 3; i++) assert.ok(Number.isFinite(Number(m[i])));
  }
});

test('export is byte-identical across calls (deterministic)', () => {
  const m = E.buildCrystal({ seed: 9 });
  assert.equal(E.toOBJ(m), E.toOBJ(m));
  assert.equal(E.toSTL(m), E.toSTL(m));
});

test('mergeMeshes concatenates vertices and offsets triangle indices', () => {
  const a = E.buildBox(1, 1, 1);
  const b = E.buildBox(1, 1, 1);
  const merged = E.mergeMeshes([
    { mesh: a, offset: [0, 0, 0] },
    { mesh: b, offset: [5, 0, 0] },
  ]);
  assert.equal(merged.vertexCount, 16);
  assert.equal(merged.triangleCount, 24);
  // second mesh first triangle should reference indices >= 8
  for (const t of merged.triangles.slice(12)) {
    for (const idx of t) assert.ok(idx >= 8 && idx < 16);
  }
});

test('mergeMeshes applies offset to positions', () => {
  const a = E.buildBox(1, 1, 1);
  const merged = E.mergeMeshes([{ mesh: a, offset: [5, 0, 0] }]);
  assert.equal(merged.positions[0][0], 4.5);
});

/* ------------------------------ scene plan -------------------------------- */

test('buildScenePlan is deterministic for a seed', () => {
  assert.deepEqual(E.buildScenePlan(123), E.buildScenePlan(123));
});

test('buildScenePlan produces 7 crystals', () => {
  assert.equal(E.buildScenePlan(1).crystals.length, 7);
});

test('buildScenePlan crystals have finite, positive parameters', () => {
  for (const c of E.buildScenePlan(8).crystals) {
    assert.ok(c.height > 0 && c.radius > 0 && c.sides >= 5);
    for (const v of c.position) assert.ok(Number.isFinite(v));
  }
});

test('buildScenePlan differs across seeds', () => {
  assert.notDeepEqual(E.buildScenePlan(1).crystals, E.buildScenePlan(2).crystals);
});

/* ------------------------------ integration ------------------------------- */

test('integration: full scene builds, merges and exports without NaN', () => {
  const plan = E.buildScenePlan(2026);
  const parts = [];
  parts.push({ mesh: E.buildBox(2, 1, 2), offset: [0, 0.5, 0] });
  for (const c of plan.crystals) {
    parts.push({
      mesh: E.buildCrystal({
        sides: c.sides, seed: c.seed, height: c.height,
        radius: c.radius, twist: c.twist, cap: true,
      }),
      offset: c.position,
    });
  }
  const merged = E.mergeMeshes(parts);
  const obj = E.toOBJ(merged);
  const stl = E.toSTL(merged);
  assert.ok(!obj.includes('NaN') && !stl.includes('NaN'));
  assert.ok(merged.vertexCount > 100);
  assert.ok(merged.triangleCount > 100);
});

test('integration: camera orbit stays finite over many steps', () => {
  let s = { yaw: 0, pitch: 0, radius: 9, target: [0, 1.2, 0] };
  for (let i = 0; i < 200; i++) {
    s = E.stepCamera(s, { d: i % 2 === 0, w: i % 3 === 0, q: i % 5 === 0 }, 0.016);
    const pos = E.orbitToCartesian(s.yaw, s.pitch, s.radius, s.target);
    for (const v of pos) assert.ok(Number.isFinite(v));
  }
});

test('integration: OBJ facet indices are all valid for merged scene', () => {
  const merged = E.mergeMeshes([
    { mesh: E.buildBox(1, 1, 1) },
    { mesh: E.buildTorus(2, 0.5, 8, 6), offset: [0, 3, 0] },
  ]);
  const obj = E.toOBJ(merged);
  const faces = [...obj.matchAll(/^f (\d+)\/\/(\d+) (\d+)\/\/(\d+) (\d+)\/\/(\d+)/gm)];
  assert.equal(faces.length, merged.triangleCount);
  for (const f of faces) {
    for (let i = 1; i <= 5; i += 2) {
      const idx = Number(f[i]);
      assert.ok(idx >= 1 && idx <= merged.vertexCount);
    }
  }
});


/* ---------------------- advanced geometry diagnostics -------------------- */

test('triangleArea is exact for a 3-4-5 right triangle', () => {
  approx(E.triangleArea([0, 0, 0], [3, 0, 0], [0, 4, 0]), 6);
});

test('triangleArea of a collinear triple is zero', () => {
  approx(E.triangleArea([0, 0, 0], [1, 1, 1], [2, 2, 2]), 0);
});

test('meshSurfaceArea of a unit box is exactly 6', () => {
  approx(E.meshSurfaceArea(E.buildBox(1, 1, 1)), 6, 1e-9);
});

test('meshSurfaceArea of a 2x3x4 box is 52', () => {
  approx(E.meshSurfaceArea(E.buildBox(2, 3, 4)), 52, 1e-9);
});

test('meshSurfaceArea scales with the square of a uniform scale', () => {
  const a = E.buildBox(1, 1, 1);
  const b = E.buildBox(3, 3, 3);
  approx(E.meshSurfaceArea(b) / E.meshSurfaceArea(a), 9, 1e-9);
});

test('meshSignedVolume of a unit box is exactly 1', () => {
  approx(Math.abs(E.meshSignedVolume(E.buildBox(1, 1, 1))), 1, 1e-9);
});

test('meshSignedVolume scales with the cube of a uniform scale', () => {
  const a = Math.abs(E.meshSignedVolume(E.buildBox(1, 1, 1)));
  const b = Math.abs(E.meshSignedVolume(E.buildBox(2, 2, 2)));
  approx(b / a, 8, 1e-9);
});

test('meshCentroid of a symmetric box is the origin', () => {
  assert.deepEqual(E.meshCentroid(E.buildBox(2, 4, 6)), [0, 0, 0]);
});

test('meshCentroid of an empty mesh is the origin', () => {
  assert.deepEqual(E.meshCentroid({ positions: [] }), [0, 0, 0]);
});

test('degenerateTriangleCount is zero for a well formed box', () => {
  assert.equal(E.degenerateTriangleCount(E.buildBox(1, 2, 3)), 0);
});

test('degenerateTriangleCount detects a collapsed mesh', () => {
  const collapsed = {
    positions: [[0, 0, 0], [1, 0, 0], [2, 0, 0]],
    triangles: [[0, 1, 2]],
  };
  assert.equal(E.degenerateTriangleCount(collapsed), 1);
});

/* ------------------------- gear ratio mathematics ------------------------ */

test('planetaryGearRatio derives the carrier rate from tooth counts', () => {
  const g = E.planetaryGearRatio({ sunTeeth: 18, planetTeeth: 12, planets: 3 });
  approx(g.toothRatio, 1.5);
  // Willis fixed-ring kinematics: carrier = sun / (sun + ring) = 18/60.
  approx(g.carrierRate, 0.3);
  // Planet spin = carrierRate - toothRatio * (1 - carrierRate).
  approx(g.planetSpinRate, -0.75);
  assert.equal(g.ringTeeth, 42);
  assert.equal(g.planets, 3);
});

test('planetaryGearRatio ring teeth equal sun plus two planets', () => {
  for (const [s, p] of [[20, 10], [24, 8], [30, 15]]) {
    const g = E.planetaryGearRatio({ sunTeeth: s, planetTeeth: p });
    assert.equal(g.ringTeeth, s + 2 * p);
  }
});

test('planetaryGearRatio agrees with planetaryState at t=1', () => {
  const g = E.planetaryGearRatio({ sunTeeth: 18, planetTeeth: 12 });
  const s = E.planetaryState({ sunTeeth: 18, planetTeeth: 12, omega: 1, t: 1 });
  approx(s.carrierAngle, g.carrierRate);
  approx(s.sunAngle, 1);
});

test('planetaryGearRatio handles a 1:1 tooth ratio', () => {
  const g = E.planetaryGearRatio({ sunTeeth: 10, planetTeeth: 10 });
  approx(g.toothRatio, 1);
  // carrier = sun / (sun + ring) = 10 / 40.
  approx(g.carrierRate, 0.25);
});

/* -------------------------- field sampling stats ------------------------- */

test('fieldSampleStats samples only points inside the unit disk', () => {
  const s = E.fieldSampleStats('rosetta', 0, 20);
  assert.equal(s.samples, 313);
  assert.ok(s.samples < 21 * 21);
  assert.equal(s.pattern, 'rosetta');
});

test('fieldSampleStats is deterministic and bounded', () => {
  const a = E.fieldSampleStats('heart', 1.25, 16);
  const b = E.fieldSampleStats('heart', 1.25, 16);
  assert.deepEqual(a, b);
  assert.ok(a.meanMix >= 0 && a.meanMix <= 1);
  assert.ok(a.foamFraction >= 0 && a.foamFraction <= 1);
  assert.ok(a.minHeight <= a.maxHeight);
});

test('fieldSampleStats differs across pour patterns', () => {
  const rosetta = E.fieldSampleStats('rosetta', 0, 16);
  const heart = E.fieldSampleStats('heart', 0, 16);
  assert.notEqual(rosetta.meanMix, heart.meanMix);
});

test('fieldSampleStats clamps grid size to at least 2', () => {
  const s = E.fieldSampleStats('swirl', 0, -5);
  assert.ok(s.samples > 0);
});

test('patternSignature is stable for identical inputs', () => {
  const a = E.patternSignature('tulip', 0.5, 10);
  const b = E.patternSignature('tulip', 0.5, 10);
  assert.equal(a, b);
  assert.ok(Number.isInteger(a) && a >= 0 && a <= 0xffffffff);
});

test('patternSignature changes with pattern and time', () => {
  assert.notEqual(E.patternSignature('rosetta', 0, 10), E.patternSignature('heart', 0, 10));
  assert.notEqual(E.patternSignature('swirl', 0, 10), E.patternSignature('swirl', 2, 10));
});

test('patternSignature for rosetta is pinned', () => {
  assert.equal(E.patternSignature('rosetta', 0, 12), 195726611);
});

/* ----------------------------- scene telemetry --------------------------- */

test('computeTelemetry is deterministic for identical inputs', () => {
  const opts = { seed: 2026, valveOpen: true, pressureBar: 1.35, pattern: 'rosetta',
                 grindSpeed: 0.6, nightBlend: 0.5, frameCount: 60, elapsedMs: 1000 };
  assert.deepEqual(E.computeTelemetry(opts), E.computeTelemetry(opts));
});

test('computeTelemetry reports exact scene counts for the default seed', () => {
  const t = E.computeTelemetry({ seed: 2026, frameCount: 60, elapsedMs: 1000 });
  assert.equal(t.seed, 2026);
  assert.equal(t.crystalCount, 7);
  assert.equal(t.vertexCount, 2310);
  assert.equal(t.triangleCount, 4580);
  assert.equal(t.degenerateTriangles, 0);
  approx(t.surfaceArea, 123.5610, 1e-4);
  approx(t.volume, 17.0681, 1e-4);
});

test('computeTelemetry echoes kinematic and fluid parameters', () => {
  const t = E.computeTelemetry({ seed: 7, valveOpen: true, pressureBar: 1.35,
    pattern: 'heart', grindSpeed: 1.25, nightBlend: 0.8, frameCount: 60, elapsedMs: 1000 });
  assert.equal(t.seed, 7);
  assert.equal(t.activeSteam, true);
  assert.equal(t.steamParticleCount, 48);
  assert.equal(t.pressureBar, 1.35);
  assert.equal(t.grindOmega, 1.25);
  assert.equal(t.nightBlend, 0.8);
  assert.equal(t.toothRatio, 1.5);
  assert.equal(t.ringTeeth, 42);
  assert.equal(t.fps, 60);
});

test('computeTelemetry fps is zero when no time has elapsed', () => {
  const t = E.computeTelemetry({ frameCount: 0, elapsedMs: 0 });
  assert.equal(t.fps, 0);
});

test('computeTelemetry changes surface area with a different seed', () => {
  const a = E.computeTelemetry({ seed: 1 });
  const b = E.computeTelemetry({ seed: 2 });
  assert.notEqual(a.surfaceArea, b.surfaceArea);
  assert.equal(a.crystalCount, b.crystalCount);
});

test('computeTelemetry geometry has valid axis aligned bounds', () => {
  const t = E.computeTelemetry({ seed: 99 });
  assert.ok(t.bounds.min[0] < t.bounds.max[0]);
  assert.ok(t.bounds.min[1] < t.bounds.max[1]);
  assert.ok(t.bounds.min[2] < t.bounds.max[2]);
  assert.ok(t.surfaceArea > 0 && t.volume >= 0);
});

/* --------------------------- deep regression pins ------------------------ */

test('regression: merged crystal mesh exports valid OBJ and STL geometry', () => {
  const plan = E.buildScenePlan(2026);
  const parts = plan.crystals.map((c) => ({
    mesh: E.buildCrystal({ sides: c.sides, seed: c.seed, height: c.height,
      radius: c.radius, twist: c.twist, uSegs: c.sides * 2, vSegs: 8, cap: true }),
    offset: c.position,
  }));
  const merged = E.mergeMeshes(parts);
  const obj = E.toOBJ(merged, { name: 'LatteLatticeRegression' });
  const stl = E.toSTL(merged, { name: 'LatteLatticeRegression' });
  assert.ok(!obj.includes('NaN') && !stl.includes('NaN'));
  assert.equal((obj.match(/^v /gm) || []).length, merged.vertexCount);
  assert.equal((stl.match(/facet normal/g) || []).length, merged.triangleCount);
  assert.equal(E.degenerateTriangleCount(merged), 0);
});

test('regression: every crystal profile height is monotone in v', () => {
  for (const u of [0, 0.17, 0.5, 0.83]) {
    let prev = -1;
    for (let j = 0; j <= 20; j++) {
      const y = E.crystalProfile(u, j / 20, { height: 2.4, seed: 3 })[1];
      assert.ok(y >= prev, `height decreased at u=${u}, v=${j / 20}`);
      prev = y;
    }
  }
});

test('regression: latteField rim stays flat for every pattern at t=0 and t=5', () => {
  for (const pat of ['rosetta', 'heart', 'tulip', 'swirl']) {
    for (const t of [0, 5]) {
      const f = E.latteField(1.5, 0, t, pat);
      assert.ok(Math.abs(f.height) < 1e-9, `${pat} rim height at t=${t}`);
      assert.ok(Math.abs(f.mix) < 1e-9, `${pat} rim mix at t=${t}`);
    }
  }
});

test('regression: stepCamera is idempotent with a zero time step', () => {
  const s = { yaw: 0.4, pitch: 0.2, radius: 8, target: [1, 2, 3] };
  assert.deepEqual(E.stepCamera(s, { d: true, w: true, q: true }, 0), s);
});

test('regression: steamParticles alpha stays in [0,1] across a full life cycle', () => {
  for (let k = 0; k <= 20; k++) {
    for (const p of E.steamParticles({ count: 8, t: k * 0.13, open: true })) {
      assert.ok(p.alpha >= 0 && p.alpha <= 1);
    }
  }
});

test('regression: lightingPreset interpolates every key monotonically', () => {
  const day = E.lightingPreset(0), night = E.lightingPreset(1), mid = E.lightingPreset(0.5);
  for (const key of Object.keys(day)) {
    if (Array.isArray(day[key])) {
      for (let i = 0; i < 3; i++) {
        approx(mid[key][i], (day[key][i] + night[key][i]) / 2, 1e-9);
      }
    } else {
      approx(mid[key], (day[key] + night[key]) / 2, 1e-9);
    }
  }
});

/* ---------------------- winding / watertightness audits ------------------- */

/** Count undirected edge usage and same-direction traversals of a mesh. */
function meshTopology(mesh) {
  const undirected = new Map();
  const directed = new Map();
  for (const [a0, b0, c0] of mesh.triangles) {
    const tri = [a0, b0, c0];
    for (let e = 0; e < 3; e++) {
      const a = tri[e], b = tri[(e + 1) % 3];
      const uk = a < b ? a + '-' + b : b + '-' + a;
      undirected.set(uk, (undirected.get(uk) || 0) + 1);
      const dk = a + '>' + b;
      directed.set(dk, (directed.get(dk) || 0) + 1);
    }
  }
  let boundary = 0, overShared = 0, misOriented = 0;
  for (const c of undirected.values()) {
    if (c === 1) boundary++;
    if (c > 2) overShared++;
  }
  for (const c of directed.values()) if (c > 1) misOriented++;
  return { boundary, overShared, misOriented };
}

test('topology: box, torus and capped crystal are fully watertight', () => {
  const meshes = {
    box: E.buildBox(1, 1, 1),
    torus: E.buildTorus(2, 0.5, 16, 8),
    crystal: E.buildCrystal({ seed: 5, sides: 6, uSegs: 12, vSegs: 8, cap: true }),
  };
  for (const [name, m] of Object.entries(meshes)) {
    const t = meshTopology(m);
    assert.equal(t.boundary, 0, `${name} has ${t.boundary} boundary edges`);
    assert.equal(t.overShared, 0, `${name} has ${t.overShared} non-manifold edges`);
    assert.equal(t.misOriented, 0, `${name} has ${t.misOriented} mis-oriented edges`);
  }
});

test('topology: uncapped crystal exposes exactly its two open rings', () => {
  const m = E.buildCrystal({ seed: 5, sides: 6, uSegs: 12, vSegs: 8, cap: false });
  const t = meshTopology(m);
  assert.equal(t.boundary, 2 * 12);
  assert.equal(t.overShared, 0);
});

test('topology: signed volume is positive for every outward mesh', () => {
  assert.ok(E.meshSignedVolume(E.buildBox(1, 1, 1)) > 0);
  assert.ok(E.meshSignedVolume(E.buildTorus(2, 0.5, 16, 8)) > 0);
  assert.ok(E.meshSignedVolume(E.buildCrystal({ seed: 9, cap: true })) > 0);
  assert.ok(E.meshSignedVolume(E.buildLathe([[0.5, 0], [0.5, 1], [0.2, 2]], 16)) > 0);
});

test('topology: torus signed volume approximates the analytic 2*pi^2*R*r^2', () => {
  const R = 2, r = 0.5;
  const analytic = 2 * Math.PI * Math.PI * R * r * r;
  const v = E.meshSignedVolume(E.buildTorus(R, r, 64, 32));
  assert.ok(Math.abs(v - analytic) / analytic < 0.02, `volume ${v} vs ${analytic}`);
});

test('topology: torus vertex normals point outward from the tube', () => {
  const m = E.buildTorus(2, 0.5, 16, 8);
  // The first grid vertex sits at the outer equator (+X); its normal must
  // have a positive radial (XZ) component, not an inward one.
  const p = m.positions[0], n = m.normals[0];
  const radial = p[0] * n[0] + p[2] * n[2];
  assert.ok(radial > 0, `outer vertex normal points inward: ${n}`);
});

test('topology: crystal cap normals point outward along +/-Y', () => {
  const m = E.buildCrystal({ seed: 5, sides: 6, uSegs: 12, vSegs: 8, cap: true });
  const topCenter = m.normals[m.positions.length - 2];
  const botCenter = m.normals[m.positions.length - 1];
  assert.ok(topCenter[1] > 0.99, `top cap normal ${topCenter}`);
  assert.ok(botCenter[1] < -0.99, `bottom cap normal ${botCenter}`);
});

test('topology: lathe cup profile collapses pole rows without boundary edges', () => {
  const cup = [[0, 0], [0.55, 0], [0.7, 0.9], [0.64, 0.1], [0, 0.06]];
  const m = E.buildLathe(cup, 24);
  const t = meshTopology(m);
  assert.equal(t.boundary, 0);
  assert.equal(t.overShared, 0);
  assert.ok(E.degenerateTriangleCount(m) === 0);
});

test('weldVertices merges coincident points and culls collapsed triangles', () => {
  const positions = [[0, 0, 0], [0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const triangles = [[0, 1, 2], [0, 2, 3]];
  const w = E.weldVertices(positions, triangles);
  assert.equal(w.positions.length, 3);
  assert.equal(w.triangles.length, 1);
  assert.deepEqual(w.triangles[0], [0, 1, 2]);
});

test('weldVertices respects the epsilon band', () => {
  const positions = [[0, 0, 0], [1e-9, 0, 0], [1, 0, 0]];
  const w = E.weldVertices(positions, [], 1e-6);
  assert.equal(w.positions.length, 2);
  const w2 = E.weldVertices(positions, [], 1e-12);
  assert.equal(w2.positions.length, 3);
});

test('buildLathe rejects a profile with fewer than 2 points', () => {
  assert.throws(() => E.buildLathe([[0.5, 0]], 12), RangeError);
  assert.throws(() => E.buildLathe([], 12), RangeError);
});

test('planetaryState agrees with planetaryGearRatio on carrier and spin rates', () => {
  const g = E.planetaryGearRatio({ sunTeeth: 18, planetTeeth: 12 });
  const s = E.planetaryState({ sunTeeth: 18, planetTeeth: 12, omega: 1, t: 2 });
  approx(s.carrierAngle, g.carrierRate * 2);
  // Planet 0 absolute spin angle equals the absolute spin rate times t.
  approx(s.planets[0].angle, g.planetSpinRate * 2);
});

test('export: box STL facet normals point along each outward axis', () => {
  const stl = E.toSTL(E.buildBox(1, 1, 1));
  for (const dir of ['0 0 -1', '0 0 1', '0 -1 0', '0 1 0', '-1 0 0', '1 0 0']) {
    assert.ok(stl.includes('facet normal ' + dir), `missing outward normal ${dir}`);
  }
});

test('export: STL vertex coordinates are all finite decimals', () => {
  const stl = E.toSTL(E.buildCrystal({ seed: 3, cap: true }));
  const verts = [...stl.matchAll(/vertex (\S+) (\S+) (\S+)/g)];
  assert.ok(verts.length > 0);
  for (const v of verts) {
    for (let i = 1; i <= 3; i++) {
      const n = Number(v[i]);
      assert.ok(Number.isFinite(n), `non-finite ${v[i]}`);
    }
  }
});

/* ------------------------------------------------------- expansion block 2 */

test('stepCamera w/s keys pitch up and down within the clamp', () => {
  const up = E.stepCamera({ yaw: 0, pitch: 0, radius: 10 }, { w: true }, 0.1);
  assert.ok(up.pitch > 0);
  const down = E.stepCamera({ yaw: 0, pitch: 0, radius: 10 }, { s: true }, 0.1);
  assert.ok(down.pitch < 0);
  const extreme = E.stepCamera({ yaw: 0, pitch: 1.44, radius: 10 }, { w: true }, 5);
  assert.ok(extreme.pitch <= 1.45 + 1e-9);
});

test('stepCamera q/e keys dolly in and out and dolly delta applies directly', () => {
  const inStep = E.stepCamera({ yaw: 0, pitch: 0, radius: 10 }, { q: true }, 0.1);
  assert.ok(inStep.radius < 10);
  const outStep = E.stepCamera({ yaw: 0, pitch: 0, radius: 10 }, { e: true }, 0.1);
  assert.ok(outStep.radius > 10);
  const dollied = E.stepCamera({ yaw: 0, pitch: 0, radius: 10 }, { dolly: -2 }, 0.1);
  assert.equal(dollied.radius, 8);
});

test('stepCamera arrow keys mirror the wasd rotation controls', () => {
  const l = E.stepCamera({ yaw: 0, pitch: 0, radius: 10 }, { arrowLeft: true }, 0.1);
  const a = E.stepCamera({ yaw: 0, pitch: 0, radius: 10 }, { a: true }, 0.1);
  assert.equal(l.yaw, a.yaw);
  const up = E.stepCamera({ yaw: 0, pitch: 0, radius: 10 }, { arrowUp: true }, 0.1);
  const w = E.stepCamera({ yaw: 0, pitch: 0, radius: 10 }, { w: true }, 0.1);
  assert.equal(up.pitch, w.pitch);
});

test('orbitToCartesian clamps pitch to +/-1.45 and honours the target offset', () => {
  const clamped = E.orbitToCartesian(0, 3.0, 10, [0, 0, 0]);
  const ref = E.orbitToCartesian(0, 1.45, 10, [0, 0, 0]);
  for (let i = 0; i < 3; i++) assert.ok(Math.abs(clamped[i] - ref[i]) < 1e-9);
  const off = E.orbitToCartesian(0, 0, 10, [1, 2, 3]);
  assert.deepEqual(off, [1, 2, 13]);
});

test('finalizeMesh computes per-vertex normals, counts and bounds', () => {
  const m = E.finalizeMesh([[0, 0, 0], [1, 0, 0], [0, 1, 0]], [[0, 1, 2]]);
  assert.equal(m.vertexCount, 3);
  assert.equal(m.triangleCount, 1);
  assert.equal(m.normals.length, 3);
  for (const n of m.normals) assert.ok(n.every(Number.isFinite));
  assert.ok(m.bounds);
});

test('weldVertices welds duplicate points, keeps distinct ones', () => {
  const pts = [[0, 0, 0], [1, 0, 0], [0, 0, 0], [0, 1, 0]];
  const w = E.weldVertices(pts, [[0, 1, 2], [2, 1, 3]]);
  assert.equal(w.positions.length, 3);
  assert.equal(w.triangles.length, 1);
  const [a, b, c] = w.triangles[0];
  assert.ok(a !== b && b !== c && a !== c);
});

test('weldVertices preserves triangles whose corners stay distinct', () => {
  const pts = [[0, 0, 0], [1, 0, 0], [0, 1, 0]];
  const w = E.weldVertices(pts, [[0, 1, 2]]);
  assert.equal(w.positions.length, 3);
  assert.equal(w.triangles.length, 1);
  assert.deepEqual(w.triangles[0], [0, 1, 2]);
});

test('toOBJ honours the object name option', () => {
  const obj = E.toOBJ(E.buildBox(1, 1, 1), { name: 'cup' });
  assert.ok(obj.includes('o cup'));
  assert.ok(obj.startsWith('#'));
});

test('toSTL frames the solid with solid/endsolid markers', () => {
  const stl = E.toSTL(E.buildBox(1, 1, 1));
  assert.ok(stl.startsWith('solid '));
  assert.ok(stl.includes('endsolid'));
});

test('buildScenePlan grinder uses an 18/12 planetary pair with 3 planets', () => {
  const plan = E.buildScenePlan(11);
  assert.equal(plan.grinder.sunTeeth, 18);
  assert.equal(plan.grinder.planetTeeth, 12);
  assert.equal(plan.grinder.planets, 3);
  assert.ok(E.PATTERNS === undefined || typeof plan.latte.pattern === 'string');
  assert.ok(plan.latte.radius > 0);
});

test('planetaryGearRatio ring teeth equal sun plus two planet gears', () => {
  const g = E.planetaryGearRatio({ sunTeeth: 18, planetTeeth: 12, planets: 3 });
  assert.equal(g.ringTeeth, 42);
  assert.ok(Math.abs(g.toothRatio - 1.5) < 1e-12);
  assert.ok(Math.abs(g.carrierRate - 0.3) < 1e-12);
  assert.ok(Math.abs(g.planetSpinRate + 0.75) < 1e-9);
});

test('planetaryGearRatio rejects toothless gears instead of emitting Infinity', () => {
  assert.throws(() => E.planetaryGearRatio({ sunTeeth: 0, planetTeeth: 12, planets: 3 }), RangeError);
  assert.throws(() => E.planetaryGearRatio({ sunTeeth: 18, planetTeeth: 0, planets: 3 }), RangeError);
  assert.throws(() => E.planetaryGearRatio({ sunTeeth: 18, planetTeeth: 12, planets: 0 }), RangeError);
});

test('planetaryState exposes sun, ring and carrier angles plus planet list', () => {
  const s = E.planetaryState({ sunTeeth: 18, planetTeeth: 12, planets: 3, time: 1 });
  assert.ok(Number.isFinite(s.sunAngle));
  assert.ok(Number.isFinite(s.carrierAngle));
  assert.equal(s.ringAngle, 0);
  assert.equal(s.planets.length, 3);
});

test('latteField returns height and mix inside [0,1] at the pour centre', () => {
  const f = E.latteField(0, 0, 1, 'rosetta');
  assert.ok(Number.isFinite(f.height));
  assert.ok(f.mix >= 0 && f.mix <= 1);
});

test('computeTelemetry gear fields mirror planetaryGearRatio for the same plan', () => {
  const tel = E.computeTelemetry({ seed: 7, time: 2 });
  const g = E.planetaryGearRatio({ sunTeeth: 18, planetTeeth: 12, planets: 3 });
  assert.equal(tel.toothRatio, g.toothRatio);
  assert.ok(Math.abs(tel.carrierRate - g.carrierRate) < 1e-12);
  assert.equal(tel.ringTeeth, g.ringTeeth);
});

test('computeTelemetry volume is positive for the default welded scene', () => {
  const tel = E.computeTelemetry({ seed: 7, time: 0 });
  assert.ok(tel.volume > 0);
  assert.ok(tel.surfaceArea > 0);
  assert.equal(tel.degenerateTriangles, 0);
});

test('torusSurface u=0,v=0 sits at the outer equator R+r from the axis', () => {
  const p = E.torusSurface(0, 0, 2, 0.5);
  assert.ok(Math.abs(Math.hypot(p[0], p[2]) - 2.5) < 1e-9);
  assert.ok(Math.abs(p[1]) < 1e-9);
});

test('crystalProfile radius stays non-negative across u and v', () => {
  for (let u = 0; u <= 1.0001; u += 0.25) {
    for (let v = 0; v <= 1.0001; v += 0.5) {
      const p = E.crystalProfile(u, v, { height: 1, radius: 0.5, sides: 5, twist: 1, seed: 9 });
      assert.ok(Math.hypot(p[0], p[2]) >= -1e-9);
    }
  }
});

test('gridTriangles on a single cell emits two triangles sharing the diagonal', () => {
  const grid = E.parametricGrid((u, v) => [u, 0, v], 1, 1);
  const tris = E.gridTriangles(grid);
  assert.equal(tris.length, 2);
  const shared = tris[0].filter((i) => tris[1].includes(i));
  assert.equal(shared.length, 2);
});

test('mergeMeshes on an empty list yields an empty mesh', () => {
  const m = E.mergeMeshes([]);
  assert.equal(m.positions.length, 0);
  assert.equal(m.triangles.length, 0);
});

test('patternSignature is a 32-bit unsigned integer', () => {
  const s = E.patternSignature('rosetta', 0, 12);
  assert.ok(Number.isInteger(s) && s >= 0 && s <= 0xffffffff);
});

test('EPSILON is small and FOAM is lighter than CREMA', () => {
  assert.ok(E.EPSILON > 0 && E.EPSILON < 1e-6);
  const lum = (c) => c[0] + c[1] + c[2];
  assert.ok(lum(E.FOAM) > lum(E.CREMA));
});

test('lightingPreset exposes the full day/night key set', () => {
  const d = E.lightingPreset(0);
  for (const k of ['ambient', 'key', 'warm', 'sky', 'fog', 'exposure', 'background']) {
    assert.ok(d[k] !== undefined, 'missing ' + k);
  }
});

test('buildLathe produces finite geometry for an open cup profile', () => {
  const profile = [[0.0, 0.0], [0.8, 0.0], [0.9, 0.1], [0.9, 0.9], [0.8, 1.0]];
  const m = E.buildLathe(profile, 32);
  assert.ok(m.vertexCount > 0);
  assert.ok(m.triangleCount > 0);
  for (const n of m.normals) assert.ok(n.every(Number.isFinite));
});

/* -------------------- adversarial pass regression tests ------------------- */

test('regression: weldVertices welds sub-eps pairs that straddle bucket edges', () => {
  // 9e-8 apart but on opposite sides of an eps bucket boundary: must still weld.
  const w = E.weldVertices([[0, 0, 0], [9e-8, 0, 0]], []);
  assert.equal(w.positions.length, 1);
  const w2 = E.weldVertices([[0, 0, 0], [1.1e-7, 0, 0]], []);
  assert.equal(w2.positions.length, 2);
});

test('regression: planetaryState rejects toothless gears instead of NaN angles', () => {
  assert.throws(() => E.planetaryState({ sunTeeth: 0, planetTeeth: 12, planets: 3, time: 1 }), RangeError);
  assert.throws(() => E.planetaryState({ sunTeeth: 18, planetTeeth: 0, planets: 3, time: 1 }), RangeError);
  assert.throws(() => E.planetaryState({ sunTeeth: 18, planetTeeth: 12, planets: 0, time: 1 }), RangeError);
});

test('regression: telemetry measures the exact exported mesh, not a subset', () => {
  const tel = E.computeTelemetry({ seed: 2026 });
  const merged = E.mergeMeshes(E.buildExportMeshes(2026));
  assert.equal(tel.triangleCount, merged.triangles.length);
  assert.equal(tel.vertexCount, merged.positions.length);
  assert.ok(Math.abs(tel.surfaceArea - E.meshSurfaceArea(merged)) < 1e-6);
  assert.ok(Math.abs(tel.volume - Math.abs(E.meshSignedVolume(merged))) < 1e-6);
});

test('regression: every seed keeps all seven crystals inside the ledge', () => {
  for (let seed = 0; seed < 60; seed++) {
    const plan = E.buildScenePlan(seed);
    for (const c of plan.crystals) {
      const [x, y, z] = E.crystalWorldOffset(c);
      assert.ok(Math.abs(x) <= E.LEDGE.xMax, `seed ${seed} x ${x}`);
      assert.ok(z >= E.LEDGE.zMin && z <= E.LEDGE.zMax, `seed ${seed} z ${z}`);
      assert.ok(y >= E.LEDGE.top, `seed ${seed} y ${y}`);
    }
  }
});

test('regression: buildExportMeshes is deterministic and includes the cup', () => {
  const a = E.buildExportMeshes(2026);
  const b = E.buildExportMeshes(2026);
  assert.equal(a.length, b.length);
  assert.equal(a.length, 12);
  const merged = E.mergeMeshes(a);
  assert.ok(E.meshSurfaceArea(merged) > 100);
  assert.ok(E.degenerateTriangleCount(merged) === 0);
});
