/*
 * LatteLattice 3D - crystal physics unit tests.
 * Run with:  node --test crystal.test.js
 * No DOM, no WebGL, no network. Pure solid-state physics only.
 */

'use strict';

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as C from './crystal.js';
import { TAU, vecDot, vecLength } from './engine.js';

const approx = (a, b, tol = 1e-6) => assert.ok(
  Math.abs(a - b) <= tol,
  `expected ${a} to be within ${tol} of ${b}`,
);

const IDS = ['po', 'fe', 'cu', 'si', 'nacl', 'mg'];

/* ----------------------------- structure registry ------------------------ */

test('registry exposes exactly the six documented materials', () => {
  assert.deepEqual(Object.keys(C.STRUCTURES).sort(), IDS.slice().sort());
});

test('every structure carries a complete, sane record', () => {
  for (const id of IDS) {
    const s = C.STRUCTURES[id];
    assert.equal(s.id, id);
    assert.ok(s.name && s.formula && s.lattice && s.spaceGroup);
    assert.ok(Number.isInteger(s.spaceGroupNumber) && s.spaceGroupNumber > 0);
    assert.ok(s.coordination >= 1 && s.coordination <= 12);
    assert.ok(s.atoms.length >= 1);
    for (const atom of s.atoms) {
      assert.ok(atom.z > 0 && atom.radius > 0);
      for (const f of atom.frac) assert.ok(f >= 0 && f < 1);
      assert.ok(s.molar[atom.el] > 0);
    }
  }
});

test('wavelength table holds the three tube targets', () => {
  approx(C.WAVELENGTHS.cu.lambda, 1.5406);
  approx(C.WAVELENGTHS.mo.lambda, 0.7107);
  approx(C.WAVELENGTHS.co.lambda, 1.7902);
});

/* ------------------------------ cell geometry ---------------------------- */

test('cubic cell volumes equal a cubed', () => {
  for (const id of ['po', 'fe', 'cu', 'si', 'nacl']) {
    const a = C.STRUCTURES[id].cell.a;
    approx(C.cellVolume(id), a * a * a, 1e-9);
  }
});

test('hexagonal cell volume equals (sqrt3/2) a^2 c', () => {
  const { a, c } = C.STRUCTURES.mg.cell;
  approx(C.cellVolume('mg'), (Math.sqrt(3) / 2) * a * a * c, 1e-9);
});

test('primitive volumes are the lattice-point volumes', () => {
  const a = (id) => C.STRUCTURES[id].cell.a;
  approx(C.primitiveVolume('po'), a('po') ** 3, 1e-9);
  approx(C.primitiveVolume('fe'), a('fe') ** 3 / 2, 1e-9);
  approx(C.primitiveVolume('cu'), a('cu') ** 3 / 4, 1e-9);
  approx(C.primitiveVolume('si'), a('si') ** 3 / 4, 1e-9);
  approx(C.primitiveVolume('nacl'), a('nacl') ** 3 / 4, 1e-9);
  const { a: am, c } = C.STRUCTURES.mg.cell;
  approx(C.primitiveVolume('mg'), (Math.sqrt(3) / 2) * am * am * c, 1e-9);
});

test('reciprocal basis satisfies a_i . b_j = 2pi delta_ij for all structures', () => {
  for (const id of IDS) {
    const A = C.cellVectors(id);
    const B = C.reciprocalBasis(id);
    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        approx(vecDot(A[i], B[j]), i === j ? TAU : 0, 1e-9);
      }
    }
  }
});

test('reciprocal cell volume times direct volume equals (2pi)^3', () => {
  for (const id of IDS) {
    const B = C.reciprocalBasis(id);
    const vstar = Math.abs(vecDot(B[0], [B[1][1] * B[2][2] - B[1][2] * B[2][1],
      B[1][2] * B[2][0] - B[1][0] * B[2][2], B[1][0] * B[2][1] - B[1][1] * B[2][0]]));
    approx(vstar * C.cellVolume(id), Math.pow(TAU, 3), 1e-6);
  }
});

test('cubic reciprocal vectors have magnitude 2pi/a', () => {
  const B = C.reciprocalBasis('cu');
  for (const b of B) approx(vecLength(b), TAU / 3.6149, 1e-9);
});

test('hexagonal reciprocal is rotated 90 degrees out of the basal axes', () => {
  const [a1, a2] = C.cellVectors('mg');
  const [b1, b2] = C.reciprocalBasis('mg');
  approx(vecDot(a1, b2), 0, 1e-9);
  approx(vecDot(a2, b1), 0, 1e-9);
  approx(vecLength(b1), (TAU / C.STRUCTURES.mg.cell.a) * (2 / Math.sqrt(3)), 1e-9);
});

/* --------------------------- centering selection ------------------------- */

test('centering P allows every index', () => {
  for (const hkl of [[1, 0, 0], [0, 1, 0], [1, 1, 1], [2, 1, 0], [0, 0, 3]]) {
    assert.ok(C.centeringAllows('P', ...hkl));
  }
});

test('centering I requires h+k+l even', () => {
  assert.ok(C.centeringAllows('I', 1, 1, 0));
  assert.ok(C.centeringAllows('I', 2, 0, 0));
  assert.ok(!C.centeringAllows('I', 1, 0, 0));
  assert.ok(!C.centeringAllows('I', 1, 1, 1));
  assert.ok(!C.centeringAllows('I', 2, 1, 0));
  assert.ok(C.centeringAllows('I', 2, 2, 0));
});

test('centering F requires unmixed indices', () => {
  assert.ok(C.centeringAllows('F', 1, 1, 1));
  assert.ok(C.centeringAllows('F', 2, 0, 0));
  assert.ok(C.centeringAllows('F', 3, 1, 1));
  assert.ok(!C.centeringAllows('F', 1, 0, 0));
  assert.ok(!C.centeringAllows('F', 2, 1, 0));
  assert.ok(!C.centeringAllows('F', 1, 2, 2));
});

/* --------------------------- documented rules ---------------------------- */

test('simple cubic rule allows every reflection', () => {
  for (const hkl of [[1, 0, 0], [1, 1, 0], [1, 1, 1], [2, 1, 0], [3, 2, 1], [0, 0, 4]]) {
    assert.ok(C.allowedReflection('po', ...hkl));
  }
});

test('bcc rule: only h+k+l even survives', () => {
  const allowed = [[1, 1, 0], [2, 0, 0], [2, 1, 1], [2, 2, 0], [3, 1, 0], [2, 2, 2]];
  const extinct = [[1, 0, 0], [1, 1, 1], [2, 1, 0], [3, 0, 0], [3, 1, 1], [3, 2, 0]];
  for (const hkl of allowed) assert.ok(C.allowedReflection('fe', ...hkl), `should allow ${hkl}`);
  for (const hkl of extinct) assert.ok(!C.allowedReflection('fe', ...hkl), `should extinct ${hkl}`);
});

test('fcc rule: only unmixed indices survive', () => {
  const allowed = [[1, 1, 1], [2, 0, 0], [2, 2, 0], [3, 1, 1], [2, 2, 2], [4, 0, 0]];
  const extinct = [[1, 0, 0], [1, 1, 0], [2, 1, 0], [2, 1, 1], [3, 0, 0], [3, 2, 1]];
  for (const hkl of allowed) assert.ok(C.allowedReflection('cu', ...hkl), `should allow ${hkl}`);
  for (const hkl of extinct) assert.ok(!C.allowedReflection('cu', ...hkl), `should extinct ${hkl}`);
});

test('diamond rule adds the 4n condition on all-even families', () => {
  const allowed = [[1, 1, 1], [2, 2, 0], [3, 1, 1], [4, 0, 0], [3, 3, 1], [4, 4, 0]];
  const extinct = [[1, 0, 0], [1, 1, 0], [2, 0, 0], [2, 2, 2], [3, 0, 0], [4, 2, 0], [3, 2, 1]];
  for (const hkl of allowed) assert.ok(C.allowedReflection('si', ...hkl), `should allow ${hkl}`);
  for (const hkl of extinct) assert.ok(!C.allowedReflection('si', ...hkl), `should extinct ${hkl}`);
});

test('rock salt rule matches the fcc lattice pattern', () => {
  for (const hkl of [[1, 1, 1], [2, 0, 0], [2, 2, 0], [3, 1, 1], [4, 0, 0]]) {
    assert.ok(C.allowedReflection('nacl', ...hkl));
  }
  for (const hkl of [[1, 0, 0], [1, 1, 0], [2, 1, 0], [3, 0, 0]]) {
    assert.ok(!C.allowedReflection('nacl', ...hkl));
  }
});

test('hcp rule extincts (h-k)=3n with odd l', () => {
  assert.ok(!C.allowedReflection('mg', 0, 0, 1));
  assert.ok(!C.allowedReflection('mg', 0, 0, 3));
  assert.ok(!C.allowedReflection('mg', 3, 0, 1));
  assert.ok(C.allowedReflection('mg', 0, 0, 2));
  assert.ok(C.allowedReflection('mg', 0, 0, 4));
  assert.ok(C.allowedReflection('mg', 1, 0, 0));
  assert.ok(C.allowedReflection('mg', 1, 0, 1));
  assert.ok(C.allowedReflection('mg', 2, 0, 1));
  assert.ok(C.allowedReflection('mg', 3, 0, 2));
});

/* ------------------- numeric structure factor vs rules -------------------- */

test('structureFactor agrees with documented rules over a 4x4x4 index grid', () => {
  for (const id of IDS) {
    for (let h = 0; h <= 3; h++) {
      for (let k = 0; k <= 3; k++) {
        for (let l = 0; l <= 3; l++) {
          if (!h && !k && !l) continue;
          const numeric = !C.structureFactor(id, h, k, l).extinct;
          assert.equal(C.allowedReflection(id, h, k, l), numeric,
            `${id} (${h}${k}${l}) rule/numeric mismatch`);
        }
      }
    }
  }
});

test('F squared magnitudes hit the analytic values', () => {
  approx(C.structureFactor('po', 1, 0, 0).f2, 84 * 84, 1e-6);
  approx(C.structureFactor('fe', 1, 1, 0).f2, 4 * 26 * 26, 1e-4);
  approx(C.structureFactor('cu', 2, 0, 0).f2, 16 * 29 * 29, 1e-4);
  approx(C.structureFactor('si', 2, 2, 0).f2, 64 * 14 * 14, 1e-4);
  approx(C.structureFactor('si', 1, 1, 1).f2, 32 * 14 * 14, 1e-4);
  approx(C.structureFactor('nacl', 2, 0, 0).f2, 16 * (17 + 11) ** 2, 1e-4);
  approx(C.structureFactor('nacl', 1, 1, 1).f2, 16 * (17 - 11) ** 2, 1e-4);
  approx(C.structureFactor('mg', 1, 0, 0).f2, 4 * 12 * 12 * Math.cos(Math.PI / 3) ** 2, 1e-4);
});

test('exact extinctions return zero, not noise', () => {
  assert.equal(C.structureFactor('fe', 1, 0, 0).f2, 0);
  assert.equal(C.structureFactor('cu', 1, 0, 0).f2, 0);
  assert.equal(C.structureFactor('si', 2, 0, 0).f2, 0);
  assert.equal(C.structureFactor('si', 2, 2, 2).f2, 0);
  assert.equal(C.structureFactor('nacl', 2, 1, 0).f2, 0);
  assert.equal(C.structureFactor('mg', 0, 0, 1).f2, 0);
});

test('structure factor is unitary in the imaginary residual', () => {
  for (const id of ['po', 'fe', 'cu', 'si', 'nacl']) {
    const F = C.structureFactor(id, 2, 0, 0);
    approx(F.im, 0, 1e-7);
  }
});

/* -------------------------------- d-spacing ------------------------------- */

test('cubic d-spacing equals a/sqrt(h^2+k^2+l^2)', () => {
  const a = C.STRUCTURES.cu.cell.a;
  approx(C.dSpacing('cu', 1, 0, 0), a, 1e-9);
  approx(C.dSpacing('cu', 1, 1, 0), a / Math.SQRT2, 1e-9);
  approx(C.dSpacing('cu', 1, 1, 1), a / Math.sqrt(3), 1e-9);
  approx(C.dSpacing('cu', 2, 0, 0), a / 2, 1e-9);
});

test('hexagonal d-spacing follows the 4/3 basal plus l^2/c^2 formula', () => {
  const { a, c } = C.STRUCTURES.mg.cell;
  approx(C.dSpacing('mg', 1, 0, 0), (Math.sqrt(3) / 2) * a, 1e-9);
  approx(C.dSpacing('mg', 0, 0, 1), c, 1e-9);
  approx(C.dSpacing('mg', 1, 1, 0), a / 2, 1e-9);
  approx(C.dSpacing('mg', 0, 0, 2), c / 2, 1e-9);
  const d101 = 1 / Math.sqrt((4 / 3) / (a * a) + 1 / (c * c));
  approx(C.dSpacing('mg', 1, 0, 1), d101, 1e-9);
});

test('dSpacing of the null index is Infinity', () => {
  assert.equal(C.dSpacing('cu', 0, 0, 0), Infinity);
  assert.equal(C.dSpacing('mg', 0, 0, 0), Infinity);
});

/* ------------------------------- multiplicity ----------------------------- */

test('cubic multiplicities match the textbook table', () => {
  const table = [
    [[1, 0, 0], 6], [[1, 1, 0], 12], [[1, 1, 1], 8],
    [[2, 0, 0], 6], [[2, 1, 0], 24], [[2, 1, 1], 24],
    [[2, 2, 0], 12], [[3, 0, 0], 6], [[2, 2, 1], 24],
    [[3, 1, 0], 24], [[3, 1, 1], 24], [[2, 2, 2], 8],
    [[3, 2, 0], 24], [[3, 2, 1], 48], [[4, 0, 0], 6],
    [[3, 2, 2], 24], [[3, 3, 0], 12], [[4, 1, 0], 24],
    [[4, 1, 1], 24], [[3, 3, 1], 24], [[4, 2, 0], 24],
    [[4, 2, 2], 24], [[4, 3, 0], 24], [[4, 4, 0], 12],
  ];
  for (const [[h, k, l], want] of table) {
    assert.equal(C.multiplicity('cubic', h, k, l), want, `cubic {${h}${k}${l}}`);
  }
});

test('hexagonal multiplicities match basal orbits times l sign', () => {
  const table = [
    [[0, 0, 1], 2], [[1, 0, 0], 6], [[1, 0, 1], 12],
    [[1, 0, 2], 12], [[1, 1, 0], 6], [[1, 1, 1], 12],
    [[2, 0, 0], 6], [[2, 0, 1], 12], [[1, 0, 3], 12],
    [[2, 1, 0], 12], [[2, 1, 1], 24], [[0, 0, 3], 2],
  ];
  for (const [[h, k, l], want] of table) {
    assert.equal(C.multiplicity('hexagonal', h, k, l), want, `hex {${h}${k}${l}}`);
  }
});

test('multiplicity is invariant under sign and permutation of indices', () => {
  assert.equal(C.multiplicity('cubic', 2, 1, 0), C.multiplicity('cubic', -2, 0, 1));
  assert.equal(C.multiplicity('cubic', 3, 2, 1), C.multiplicity('cubic', 1, 3, 2));
});

/* ------------------------------- LP factor -------------------------------- */

test('lorentzPolarization matches the closed form', () => {
  const th = Math.PI / 4;
  approx(C.lorentzPolarization(th), 1 / (0.5 * Math.SQRT1_2), 1e-9);
});

test('lorentzPolarization is positive and diverges at grazing angle', () => {
  for (const th of [0.1, 0.4, 0.7, 1.0, 1.3]) {
    assert.ok(C.lorentzPolarization(th) > 0);
    assert.ok(Number.isFinite(C.lorentzPolarization(th)));
  }
  assert.ok(C.lorentzPolarization(0.05) > C.lorentzPolarization(0.8));
});

/* ---------------------------- Miller plane geometry ----------------------- */

test('millerPlanesInCell returns the two faces for (100)', () => {
  const planes = C.millerPlanesInCell('po', 1, 0, 0);
  assert.equal(planes.length, 2);
  for (const pl of planes) assert.equal(pl.polygon.length, 4);
  assert.ok(planes[0].atomsOn.includes(0));
  assert.equal(planes[1].atomsOn.length, 0);
});

test('millerPlanesInCell (110) cuts a single rectangle', () => {
  const planes = C.millerPlanesInCell('cu', 1, 1, 0);
  assert.equal(planes.length, 1);
  assert.equal(planes[0].polygon.length, 4);
  assert.equal(planes[0].m, 1);
});

test('millerPlanesInCell (111) cuts two corner triangles', () => {
  const planes = C.millerPlanesInCell('po', 1, 1, 1);
  assert.equal(planes.length, 2);
  for (const pl of planes) assert.equal(pl.polygon.length, 3);
});

test('every reported polygon is coplanar with the family normal', () => {
  for (const [id, hkl] of [['po', [2, 0, 0]], ['cu', [2, 2, 0]], ['si', [1, 1, 1]], ['mg', [1, 0, 1]]]) {
    const [h, k, l] = hkl;
    for (const pl of C.millerPlanesInCell(id, h, k, l)) {
      approx(vecLength(pl.normal), 1, 1e-9);
      const p0 = pl.polygon[0];
      for (const p of pl.polygon) {
        const d = vecDot(pl.normal, [p[0] - p0[0], p[1] - p0[1], p[2] - p0[2]]);
        approx(d, 0, 1e-7);
      }
    }
  }
});

test('silicon (111) family has the three atoms it should', () => {
  const planes = C.millerPlanesInCell('si', 1, 1, 1);
  const m1 = planes.find((p) => p.m === 1);
  assert.equal(m1.atomsOn.length, 3);
});

test('plane families in a hexagonal cell stay inside the basal range', () => {
  const planes = C.millerPlanesInCell('mg', 0, 0, 1);
  assert.equal(planes.length, 2);
  for (const pl of planes) assert.equal(pl.polygon.length, 4);
});

/* ------------------------------ powder pattern ---------------------------- */

test('powderPattern peak counts at Cu Ka to 90 degrees', () => {
  assert.equal(C.powderPattern('po', { lambda: 1.5406 }).peaks.length, 9);
  assert.equal(C.powderPattern('fe', { lambda: 1.5406 }).peaks.length, 3);
  assert.equal(C.powderPattern('cu', { lambda: 1.5406 }).peaks.length, 4);
  assert.equal(C.powderPattern('si', { lambda: 1.5406 }).peaks.length, 6);
  assert.equal(C.powderPattern('nacl', { lambda: 1.5406 }).peaks.length, 9);
  assert.equal(C.powderPattern('mg', { lambda: 1.5406 }).peaks.length, 12);
});

test('first peaks land on the literature 2theta positions', () => {
  const first = (id) => C.powderPattern(id, { lambda: 1.5406 }).peaks[0];
  approx(first('po').twoTheta, 26.63, 0.05);
  assert.deepEqual([first('po').h, first('po').k, first('po').l], [1, 0, 0]);
  approx(first('fe').twoTheta, 44.67, 0.05);
  assert.deepEqual([first('fe').h, first('fe').k, first('fe').l], [1, 1, 0]);
  approx(first('cu').twoTheta, 43.32, 0.05);
  assert.deepEqual([first('cu').h, first('cu').k, first('cu').l], [1, 1, 1]);
  approx(first('si').twoTheta, 28.44, 0.05);
  assert.deepEqual([first('si').h, first('si').k, first('si').l], [1, 1, 1]);
  approx(first('nacl').twoTheta, 27.37, 0.05);
  assert.deepEqual([first('nacl').h, first('nacl').k, first('nacl').l], [1, 1, 1]);
  approx(first('mg').twoTheta, 32.18, 0.05);
  assert.deepEqual([first('mg').h, first('mg').k, first('mg').l], [1, 0, 0]);
});

test('peaks are sorted, normalized to 100 and inside the window', () => {
  for (const id of IDS) {
    const pat = C.powderPattern(id, { lambda: 1.5406 });
    let prev = -Infinity;
    let maxI = 0;
    for (const p of pat.peaks) {
      assert.ok(p.twoTheta >= prev, `${id} out of order`);
      prev = p.twoTheta;
      assert.ok(p.twoTheta >= pat.twoThetaMin && p.twoTheta <= pat.twoThetaMax);
      assert.ok(p.intensity > 0 && p.intensity <= 100);
      assert.ok(p.multiplicity >= 1 && p.lp > 0 && p.f2 > 0);
      maxI = Math.max(maxI, p.intensity);
    }
    assert.equal(maxI, 100, `${id} not normalized`);
  }
});

test('every emitted peak satisfies Bragg lambda < 2d', () => {
  for (const id of IDS) {
    for (const wl of ['cu', 'mo', 'co']) {
      const pat = C.powderPattern(id, { lambda: C.WAVELENGTHS[wl].lambda });
      for (const p of pat.peaks) assert.ok(C.WAVELENGTHS[wl].lambda < 2 * p.d);
    }
  }
});

test('shorter wavelengths compress the pattern to lower angles', () => {
  const cu = C.powderPattern('fe', { lambda: 1.5406 });
  const mo = C.powderPattern('fe', { lambda: 0.7107 });
  const p110 = (pat) => pat.peaks.find((p) => p.h === 1 && p.k === 1 && p.l === 0);
  assert.ok(p110(mo).twoTheta < p110(cu).twoTheta);
  assert.ok(mo.peaks.length > cu.peaks.length, 'Mo Ka resolves more peaks in range');
});

test('strongest line is the physics-textbook principal peak', () => {
  const top = (id, wl) => {
    const pat = C.powderPattern(id, { lambda: wl });
    return pat.peaks.find((p) => p.intensity === 100);
  };
  assert.deepEqual([top('fe', 1.5406)].map((p) => [p.h, p.k, p.l])[0], [1, 1, 0]);
  assert.deepEqual([top('cu', 1.5406)].map((p) => [p.h, p.k, p.l])[0], [1, 1, 1]);
  assert.deepEqual([top('nacl', 1.5406)].map((p) => [p.h, p.k, p.l])[0], [2, 0, 0]);
});

test('NaCl odd-unmixed peaks are weak but present', () => {
  const pat = C.powderPattern('nacl', { lambda: 1.5406 });
  const p111 = pat.peaks.find((p) => p.h === 1 && p.k === 1 && p.l === 1);
  const p200 = pat.peaks.find((p) => p.h === 2 && p.k === 0 && p.l === 0);
  assert.ok(p111 && p200);
  assert.ok(p111.intensity < 15, `111 too strong: ${p111.intensity}`);
  assert.equal(p200.intensity, 100);
});

test('powderPattern is deterministic to the JSON byte', () => {
  const a = C.powderPattern('mg', { lambda: 0.7107 });
  const b = C.powderPattern('mg', { lambda: 0.7107 });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
});

test('powderPattern rejects an unknown structure id', () => {
  assert.throws(() => C.powderPattern('unobtainium'), RangeError);
});

test('twoThetaMin and twoThetaMax clip the reported window', () => {
  const pat = C.powderPattern('po', { lambda: 1.5406, twoThetaMin: 30, twoThetaMax: 50 });
  assert.ok(pat.peaks.every((p) => p.twoTheta >= 30 && p.twoTheta <= 50));
  assert.ok(pat.peaks.length > 0);
});

/* --------------------------- reciprocal points ---------------------------- */

test('reciprocalPoints keeps only centering-allowed lattice points', () => {
  for (const p of C.reciprocalPoints('fe', { maxIndex: 3 })) {
    assert.equal(((p.h + p.k + p.l) % 2 + 2) % 2, 0, `bcc kept mixed ${p.h}${p.k}${p.l}`);
  }
  for (const p of C.reciprocalPoints('cu', { maxIndex: 3 })) {
    const parity = (n) => ((n % 2) + 2) % 2;
    assert.ok(parity(p.h) === parity(p.k) && parity(p.k) === parity(p.l));
  }
});

test('reciprocalPoints returns sorted, finite G vectors', () => {
  const pts = C.reciprocalPoints('po', { maxIndex: 2 });
  let prev = -Infinity;
  for (const p of pts) {
    assert.ok(p.len > 0 && Number.isFinite(p.len));
    assert.ok(p.len >= prev);
    prev = p.len;
  }
});

test('reciprocal point magnitudes squared are integer multiples for sc', () => {
  const pts = C.reciprocalPoints('po', { maxIndex: 2 });
  const unit = TAU / 3.345;
  for (const p of pts) {
    const q2 = (p.len / unit) ** 2;
    approx(q2, Math.round(q2), 1e-9);
    assert.equal(Math.round(q2), p.h * p.h + p.k * p.k + p.l * p.l);
  }
});

test('gMax option truncates the point list', () => {
  const all = C.reciprocalPoints('po', { maxIndex: 4 });
  const cut = C.reciprocalPoints('po', { maxIndex: 4, gMax: all[0].len * 1.01 });
  assert.ok(cut.length < all.length);
  assert.ok(cut.every((p) => p.len <= all[0].len * 1.02));
});

/* ---------------------------- Brillouin zone ------------------------------ */

test('BZ volume equals (2pi)^3 / primitive volume for all structures', () => {
  for (const id of IDS) {
    const bz = C.brillouinZone(id);
    const want = Math.pow(TAU, 3) / C.primitiveVolume(id);
    approx(bz.volume, want, want * 0.005);
  }
});

test('BZ face and vertex counts match the canonical polyhedra', () => {
  const expect = {
    po: { faces: 6, verts: 8 },
    fe: { faces: 12, verts: 14 },
    cu: { faces: 14, verts: 24 },
    si: { faces: 14, verts: 24 },
    nacl: { faces: 14, verts: 24 },
    mg: { faces: 8, verts: 12 },
  };
  for (const id of IDS) {
    const bz = C.brillouinZone(id);
    assert.equal(bz.faces.length, expect[id].faces, `${id} faces`);
    assert.equal(bz.vertices.length, expect[id].verts, `${id} verts`);
  }
});

test('every BZ vertex satisfies all bisector half-spaces', () => {
  for (const id of ['po', 'fe', 'cu', 'mg']) {
    const pts = C.reciprocalPoints(id, { maxIndex: 6 });
    const bz = C.brillouinZone(id);
    for (const v of bz.vertices) {
      for (const p of pts) {
        assert.ok(vecDot(p.g, v) <= (p.len * p.len) / 2 + 1e-6,
          `${id} vertex outside half-space of ${p.h}${p.k}${p.l}`);
      }
    }
  }
});

test('BZ edges reference valid, ordered vertices', () => {
  const bz = C.brillouinZone('cu');
  assert.ok(bz.edges.length > 0);
  for (const [a, b] of bz.edges) {
    assert.ok(a >= 0 && b >= 0 && a !== b);
    assert.ok(a < bz.vertices.length && b < bz.vertices.length);
  }
});

test('BZ face polygons each have at least 3 ordered vertices', () => {
  for (const id of IDS) {
    const bz = C.brillouinZone(id);
    for (const f of bz.faces) {
      assert.ok(f.verts.length >= 3, `${id} face with ${f.verts.length} verts`);
      assert.ok(f.area > 0);
      assert.ok(f.distance > 0);
    }
  }
});

test('sc BZ is a cube of edge 2pi/a', () => {
  const bz = C.brillouinZone('po');
  const want = Math.pow(TAU / 3.345, 3);
  approx(bz.volume, want, want * 0.005);
});

/* --------------------- packing, coordination, density --------------------- */

test('nearest-neighbour distances match the geometry', () => {
  approx(C.nearestNeighbor('po'), 3.345, 1e-6);
  approx(C.nearestNeighbor('fe'), (2.8664 * Math.sqrt(3)) / 2, 1e-6);
  approx(C.nearestNeighbor('cu'), (3.6149 * Math.SQRT2) / 2, 1e-6);
  approx(C.nearestNeighbor('si'), (5.431 * Math.sqrt(3)) / 4, 1e-6);
  approx(C.nearestNeighbor('nacl'), 5.6402 / 2, 1e-6);
  approx(C.nearestNeighbor('mg'), 3.1970, 1e-3);
});

test('packing factors hit the textbook goldens', () => {
  approx(C.packingFactor('po'), Math.PI / 6, 1e-9);
  approx(C.packingFactor('fe'), (Math.PI * Math.sqrt(3)) / 8, 1e-9);
  approx(C.packingFactor('cu'), (Math.PI * Math.SQRT2) / 6, 1e-9);
  approx(C.packingFactor('si'), (Math.PI * Math.sqrt(3)) / 16, 1e-9);
  approx(C.packingFactor('nacl'), 0.6528, 0.005);
  assert.ok(Math.abs(C.packingFactor('mg') - (Math.PI * Math.SQRT2) / 6) < 0.01);
});

test('theoretical densities match the measured literature values', () => {
  approx(C.theoreticalDensity('po'), 9.27, 0.1);
  approx(C.theoreticalDensity('fe'), 7.87, 0.05);
  approx(C.theoreticalDensity('cu'), 8.94, 0.05);
  approx(C.theoreticalDensity('si'), 2.33, 0.02);
  approx(C.theoreticalDensity('nacl'), 2.16, 0.02);
  approx(C.theoreticalDensity('mg'), 1.74, 0.02);
});

test('coordination numbers are the textbook values', () => {
  assert.equal(C.STRUCTURES.po.coordination, 6);
  assert.equal(C.STRUCTURES.fe.coordination, 8);
  assert.equal(C.STRUCTURES.cu.coordination, 12);
  assert.equal(C.STRUCTURES.si.coordination, 4);
  assert.equal(C.STRUCTURES.nacl.coordination, 6);
  assert.equal(C.STRUCTURES.mg.coordination, 12);
});

test('atoms-per-cell counts are the crystallographic values', () => {
  assert.equal(C.atomsInCell('po'), 1);
  assert.equal(C.atomsInCell('fe'), 2);
  assert.equal(C.atomsInCell('cu'), 4);
  assert.equal(C.atomsInCell('si'), 8);
  assert.equal(C.atomsInCell('nacl'), 8);
  assert.equal(C.atomsInCell('mg'), 2);
});

/* ------------------------------ display atoms ----------------------------- */

test('displayAtoms completes the shared corners and faces', () => {
  assert.equal(C.displayAtoms('po').length, 8);         // 8 corners
  assert.equal(C.displayAtoms('fe').length, 9);         // +1 body centre
  assert.equal(C.displayAtoms('cu').length, 14);        // 8 corners + 6 face centres
  assert.equal(C.displayAtoms('si').length, 18);        // fcc 14 + 4 interior
  assert.equal(C.displayAtoms('mg').length, 2);
});

test('displayAtoms positions match fractional-to-cartesian mapping', () => {
  const a = C.STRUCTURES.cu.cell.a;
  for (const atom of C.displayAtoms('cu')) {
    const want = atom.frac.map((x) => x * a);
    for (let i = 0; i < 3; i++) approx(atom.pos[i], want[i], 1e-9);
  }
});

test('displayAtoms 2x2x2 supercell tiles without duplicates', () => {
  const atoms = C.displayAtoms('po', { cells: 2 });
  assert.equal(atoms.length, 27);
  const keys = new Set(atoms.map((x) => x.frac.join(',')));
  assert.equal(keys.size, atoms.length);
});

test('displayAtoms marks boundary and primary copies', () => {
  const atoms = C.displayAtoms('fe');
  assert.equal(atoms.filter((x) => x.primary).length, 2);
  assert.ok(atoms.filter((x) => x.boundary).length >= 8);
});

/* --------------------------------- bonds ---------------------------------- */

test('bondPairs finds nearest-neighbour distances only', () => {
  const atoms = C.displayAtoms('si');
  const pairs = C.bondPairs('si', atoms);
  assert.ok(pairs.length > 0);
  const nn = C.nearestNeighbor('si');
  for (const [, , d] of pairs) approx(d, nn, nn * 0.04 + 1e-9);
});

test('diamond atoms reach fourfold coordination inside the cell', () => {
  // The margin shell supplies the periodic neighbours of atoms on the faces,
  // so every atom drawn in the cell must show all four sp3 bonds.
  const atoms = C.displayAtoms('si', { margin: 0.3 });
  const pairs = C.bondPairs('si', atoms);
  const deg = new Map();
  for (const [i, j] of pairs) {
    deg.set(i, (deg.get(i) || 0) + 1);
    deg.set(j, (deg.get(j) || 0) + 1);
  }
  const inside = atoms.map((a, i) => ({ a, i })).filter((x) => !x.a.outside);
  assert.ok(inside.length >= 8);
  for (const x of inside) assert.equal(deg.get(x.i), 4, `atom ${x.i} not fourfold`);
});

/* --------------------------------- CIF ------------------------------------ */

test('toCIF emits a valid crystallographic information frame', () => {
  const cif = C.toCIF('cu');
  assert.ok(cif.startsWith('data_LatteLattice_Cu'));
  assert.ok(/_symmetry_space_group_name_H-M\s+'Fm-3m'/.test(cif));
  assert.ok(/_symmetry_Int_Tables_number\s+225/.test(cif));
  assert.ok(/_cell_length_a\s+3\.6149/.test(cif));
  assert.ok(/_cell_angle_gamma\s+90/.test(cif));
  assert.ok(/^loop_$/m.test(cif));
  assert.ok(/_atom_site_fract_x/.test(cif));
  assert.ok(/Cu1 Cu 0\.000000 0\.000000 0\.000000 1\.0/.test(cif));
});

test('CIF declares an identity-only symmetry record', () => {
  // The conventional basis is listed in full, so the only permitted
  // equivalent position is x,y,z; a viewer applying it can never double atoms.
  const cif = C.toCIF('si');
  assert.ok(/_symmetry_equiv_pos_as_xyz\nx,y,z\n/.test(cif));
  assert.equal(cif.split('_symmetry_equiv_pos_as_xyz').length, 2);
});

test('CIF atom loops carry the whole conventional basis', () => {
  const counts = { po: 1, fe: 2, cu: 4, si: 8, nacl: 8, mg: 2 };
  for (const id of IDS) {
    const cif = C.toCIF(id);
    const atomLines = cif.split('\n').filter((l) => /^\w+\d+ \w+ [\d.-]+ [\d.-]+ [\d.-]+ 1\.0$/.test(l));
    assert.equal(atomLines.length, counts[id], `${id} atom rows`);
  }
});

test('NaCl CIF lists both species and Mg carries the 120 degree gamma', () => {
  const cif = C.toCIF('nacl');
  assert.ok(/Na1 Na /.test(cif) && /Cl1 Cl /.test(cif));
  const mg = C.toCIF('mg');
  assert.ok(/_cell_angle_gamma\s+120/.test(mg));
  assert.ok(/P63\/mmc/.test(mg));
});

test('toCIF is byte-identical across calls', () => {
  assert.equal(C.toCIF('si'), C.toCIF('si'));
});

/* --------------------------------- SHA-256 -------------------------------- */

test('sha256hex matches the three classic FIPS vectors', () => {
  assert.equal(C.sha256hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  assert.equal(C.sha256hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(
    C.sha256hex('The quick brown fox jumps over the lazy dog'),
    'd7a8fbb307d7809469ca9abcb0082e4f8d5651e46d3cdb762d02d0bf37c9e592',
  );
});

test('sha256hex agrees with node:crypto on long, unicode and binary input', () => {
  const samples = [
    'x'.repeat(1000),
    'LatteLattice 3D \u00c5 \u00b0 \u03b8 \u00b3',
    'emoji surrogate pair \ud83d\ude00\ud83e\udd14',
    '\x00\x01\x02 binary-ish \x7f\x80\xff',
    JSON.stringify({ a: 1, b: [1, 2, 3] }),
    'a'.repeat(63) + 'b' + 'c'.repeat(70),
  ];
  for (const s of samples) {
    const want = crypto.createHash('sha256').update(s, 'utf8').digest('hex');
    assert.equal(C.sha256hex(s), want, `mismatch on ${s.slice(0, 24)}`);
  }
});

test('sha256hex returns 64 lowercase hex chars and is deterministic', () => {
  const h = C.sha256hex('latte');
  assert.match(h, /^[0-9a-f]{64}$/);
  assert.equal(h, C.sha256hex('latte'));
  assert.notEqual(h, C.sha256hex('latte '));
});

/* ------------------------------- XRD exports ------------------------------ */

test('xrdPeakCSV emits a row per peak plus a sha256 fingerprint', () => {
  const pat = C.powderPattern('cu', { lambda: 1.5406 });
  const csv = C.xrdPeakCSV(pat);
  const lines = csv.trimEnd().split('\n');
  assert.equal(lines[0], 'h,k,l,d_angstrom,two_theta_deg,F_squared,multiplicity,lorentz_polarization,I_rel,group_I_rel');
  const dataRows = lines.slice(1, lines.length - 1);
  assert.equal(dataRows.length, pat.peaks.length);
  const nCols = lines[0].split(',').length;
  assert.equal(nCols, 10);
  for (const row of dataRows) assert.equal(row.split(',').length, nCols);
  const fp = lines[lines.length - 1];
  assert.match(fp, /^# sha256 [0-9a-f]{64}$/);
  const body = lines.slice(0, lines.length - 1).join('\n') + '\n';
  assert.equal(fp.slice(9), C.sha256hex(body));
});

test('xrdPeakCSV is deterministic', () => {
  const pat = C.powderPattern('fe', { lambda: 0.7107 });
  assert.equal(C.xrdPeakCSV(pat), C.xrdPeakCSV(pat));
});

test('CSV group_I_rel matches the summed observed group intensity', () => {
  // Coincident families share one observed peak; the export must show the same
  // summed intensity the on-screen table uses, not a mismatched per-family scale.
  const pat = C.powderPattern('po', { lambda: 1.5406, twoThetaMin: 5, twoThetaMax: 90 });
  const group = pat.groups.find((g) => g.families.length > 1);
  assert.ok(group, 'expected a coincident group for Po with Cu Ka');
  const rows = C.xrdPeakCSV(pat).split('\n').slice(1);
  for (const fam of group.families) {
    const row = rows.find((r) => r.startsWith(`${fam.h},${fam.k},${fam.l},`));
    assert.ok(row, `row for ${fam.h}${fam.k}${fam.l}`);
    const fields = row.split(',');
    assert.equal(fields.length, 10);
    assert.equal(Number(fields[9]), Number(group.intensity.toFixed(3)));
  }
  const solo = pat.groups.find((g) => g.families.length === 1);
  if (solo) {
    const fam = solo.families[0];
    const row = rows.find((r) => r.startsWith(`${fam.h},${fam.k},${fam.l},`));
    assert.equal(Number(row.split(',')[9]), Number(solo.intensity.toFixed(3)));
  }
});

test('audit JSON reports observedPeakCount and per-peak group intensity', () => {
  const pat = C.powderPattern('po', { lambda: 1.5406, twoThetaMin: 5, twoThetaMax: 90 });
  const report = JSON.parse(C.xrdAuditJSON('po', pat));
  assert.equal(report.observedPeakCount, pat.groups.length);
  assert.ok(report.observedPeakCount < report.peakCount);
  const byFam = new Map();
  for (const g of pat.groups) for (const f of g.families) byFam.set(`${f.h},${f.k},${f.l}`, g.intensity);
  for (const p of report.peaks) approx(p.groupIntensity, byFam.get(`${p.h},${p.k},${p.l}`), 1e-3);
});

test('xrdAuditJSON parses and embeds a consistent fingerprint', () => {
  const pat = C.powderPattern('si', { lambda: 1.5406 });
  const report = JSON.parse(C.xrdAuditJSON('si', pat));
  assert.equal(report.structure, 'si');
  assert.equal(report.spaceGroup, 'Fd-3m');
  assert.equal(report.peakCount, pat.peaks.length);
  assert.equal(report.peaks.length, pat.peaks.length);
  assert.match(report.sha256.csv, /^[0-9a-f]{64}$/);
  const csv = C.xrdPeakCSV(pat);
  assert.equal(report.sha256.csv, C.sha256hex(csv));
  approx(report.packingFactor, Math.PI * Math.sqrt(3) / 16, 1e-6);
  approx(report.density, 2.329, 0.01);
});

test('audit JSON is deterministic given the same pattern', () => {
  const pat = C.powderPattern('nacl', { lambda: 1.7902 });
  assert.equal(C.xrdAuditJSON('nacl', pat), C.xrdAuditJSON('nacl', pat));
});

/* ------------------------------ URL hashing ------------------------------- */

test('encodeLabHash serializes the lab state compactly', () => {
  assert.equal(
    C.encodeLabHash({ structure: 'fe', lambda: 'mo', hkl: [1, 1, 0], seed: 42 }),
    'lab=fe&ka=mo&hkl=1,1,0&seed=42',
  );
});

test('decodeLabHash round-trips the encoded state', () => {
  const frag = C.encodeLabHash({ structure: 'nacl', lambda: 'co', hkl: [2, 0, 0], seed: 7 });
  const d = C.decodeLabHash('#' + frag);
  assert.equal(d.structure, 'nacl');
  assert.equal(d.lambda, 'co');
  assert.deepEqual(d.hkl, [2, 0, 0]);
  assert.equal(d.seed, 7);
});

test('decodeLabHash tolerates garbage and unknown values', () => {
  assert.deepEqual(C.decodeLabHash(''), { structure: null, lambda: null, hkl: null, seed: null });
  assert.deepEqual(C.decodeLabHash('#lab=plutonium&ka=xx&hkl=1,2&seed=abc'),
    { structure: null, lambda: null, hkl: null, seed: null });
  const d = C.decodeLabHash('#lab=si&ka=cu&hkl=-1,0,2');
  assert.equal(d.structure, 'si');
  assert.deepEqual(d.hkl, [-1, 0, 2]);
});

test('decodeLabHash rejects inherited Object property names', () => {
  // Plain object lookup would accept constructor, __proto__ and toString as
  // "known" ids; only own properties may pass.
  for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
    const d = C.decodeLabHash(`#lab=${bad}&ka=${bad}`);
    assert.equal(d.structure, null, `lab=${bad} accepted`);
    assert.equal(d.lambda, null, `ka=${bad} accepted`);
  }
});

/* ---------------------------- self-test battery --------------------------- */

test('runCrystalSelfTests returns a named, all-passing battery', () => {
  const out = C.runCrystalSelfTests();
  assert.ok(out.length >= 20, `battery too small: ${out.length}`);
  for (const chk of out) {
    assert.ok(typeof chk.name === 'string' && chk.name.length > 3);
    assert.equal(chk.pass, true, `self-test failed: ${chk.name}`);
  }
});

test('runCrystalSelfTests is deterministic across calls', () => {
  const a = C.runCrystalSelfTests().map((x) => x.name);
  const b = C.runCrystalSelfTests().map((x) => x.name);
  assert.deepEqual(a, b);
});

/* ------------------------- deep physical consistency ---------------------- */

test('coincident families share 2theta because their d-spacings are identical', () => {
  // Families like cubic {300} and {221} have the same d and so overlap in a
  // real powder pattern; the simulator must not merge or move them.
  const a3 = C.STRUCTURES.mg.cell.a, c3 = C.STRUCTURES.mg.cell.c;
  const metric = (id, p) => id === 'mg'
    ? (p.h * p.h + p.h * p.k + p.k * p.k) + 0.75 * p.l * p.l * (a3 * a3) / (c3 * c3)
    : p.h * p.h + p.k * p.k + p.l * p.l;
  for (const id of IDS) {
    const pat = C.powderPattern(id, { lambda: 0.7107 });
    const byAngle = new Map();
    for (const p of pat.peaks) {
      const key = p.twoTheta.toFixed(6);
      if (!byAngle.has(key)) byAngle.set(key, []);
      byAngle.get(key).push(p);
    }
    for (const g of byAngle.values()) {
      if (g.length > 1) {
        approx(g[0].d, g[1].d, 1e-9, `${id} coincident peaks with different d`);
        for (const p of g) approx(metric(id, p), metric(id, g[0]), 1e-9);
      }
    }
    // Po, with every family allowed, must contain at least one coincidence.
    if (id === 'po') {
      const coincidences = [...byAngle.values()].filter((g) => g.length > 1);
      assert.ok(coincidences.length > 0, 'po should exhibit {300}/{221}-type overlaps');
    }
  }
});

test('d-spacing ordering is monotone decreasing in the pattern', () => {
  const pat = C.powderPattern('cu', { lambda: 1.5406 });
  for (let i = 1; i < pat.peaks.length; i++) {
    assert.ok(pat.peaks[i].d < pat.peaks[i - 1].d, 'd not decreasing with 2theta');
  }
});

test('powderPattern groups coincident families into summed observed peaks', () => {
  const pat = C.powderPattern('po', { lambda: 1.5406, twoThetaMin: 5, twoThetaMax: 90 });
  // Po overlaps {221} and {300}: identical d-spacing merges to one group.
  const coincident = pat.groups.filter((g) => g.families.length > 1);
  assert.ok(coincident.length >= 1, 'expected at least one coincident group for po');
  for (const g of coincident) {
    const hkls = g.families.map((p) => `${p.h}${p.k}${p.l}`).sort().join(',');
    const rawSum = g.families.reduce((a, p) => a + p.raw, 0);
    approx(g.raw, rawSum, 1e-9, `group ${hkls} raw is not the family sum`);
    const multSum = g.families.reduce((a, p) => a + p.multiplicity, 0);
    assert.equal(g.multiplicity, multSum, `group ${hkls} multiplicity not summed`);
    for (const p of g.families) {
      approx(p.twoTheta, g.twoTheta, 1e-9);
      approx(p.d, g.d, 1e-9);
    }
  }
});

test('powderPattern groups are sorted, normalized and cover every peak', () => {
  for (const id of IDS) {
    const pat = C.powderPattern(id, { lambda: 0.7107 });
    assert.ok(pat.groups.length >= 1 && pat.groups.length <= pat.peaks.length);
    const count = pat.groups.reduce((a, g) => a + g.families.length, 0);
    assert.equal(count, pat.peaks.length, `${id}: groups must cover every family`);
    const maxI = Math.max(...pat.groups.map((g) => g.intensity));
    approx(maxI, 100, 1e-9, `${id}: group normalization`);
    for (let i = 1; i < pat.groups.length; i++) {
      assert.ok(pat.groups[i].twoTheta > pat.groups[i - 1].twoTheta, `${id}: groups unsorted`);
    }
  }
});

test('millerToCartesian produces the documented reciprocal geometry', () => {
  const g = C.millerToCartesian(1, 1, 1, 'cu');
  approx(vecLength(g), TAU * Math.sqrt(3) / 3.6149, 1e-9);
  const gh = C.millerToCartesian(1, 0, 0, 'mg');
  approx(vecLength(gh), (TAU / C.STRUCTURES.mg.cell.a) * (2 / Math.sqrt(3)), 1e-9);
});

test('primitive and conventional reciprocal bases agree on the lattice', () => {
  // For SC the conventional cell IS primitive, so both bases coincide.
  const Bc = C.reciprocalBasis('po');
  const Bp = C.primitiveReciprocal('po');
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) approx(Bc[i][j], Bp[i][j], 1e-12);
  }
});

test('bcc reciprocal points lie on an fcc lattice', () => {
  // The smallest allowed vectors of the bcc reciprocal are the fcc {110}
  // family: twelve points at distance 2pi*sqrt(2)/a.
  const pts = C.reciprocalPoints('fe', { maxIndex: 2 });
  const gMin = pts[0].len;
  const shell = pts.filter((p) => Math.abs(p.len - gMin) < 1e-9);
  assert.equal(shell.length, 12);
  approx(gMin, TAU * Math.SQRT2 / 2.8664, 1e-9);
});

test('fcc reciprocal points lie on a bcc lattice', () => {
  // Smallest allowed vectors are the bcc {111} family: eight points.
  const pts = C.reciprocalPoints('cu', { maxIndex: 2 });
  const gMin = pts[0].len;
  const shell = pts.filter((p) => Math.abs(p.len - gMin) < 1e-9);
  assert.equal(shell.length, 8);
  approx(gMin, TAU * Math.sqrt(3) / 3.6149, 1e-9);
});

test('hcp reciprocal lattice is hexagonal too', () => {
  const pts = C.reciprocalPoints('mg', { maxIndex: 2 });
  // The basal shell has six points at (2pi/a)(2/sqrt(3)).
  const basal = pts.filter((p) => Math.abs(p.g[2]) < 1e-9);
  const gMin = Math.min(...basal.map((p) => p.len));
  const shell = basal.filter((p) => Math.abs(p.len - gMin) < 1e-9);
  assert.equal(shell.length, 6);
  approx(gMin, TAU * (2 / Math.sqrt(3)) / 3.2094, 1e-9);
  // The axial pair sits at 2pi/c, shorter than the basal shell for Mg.
  const axial = pts.filter((p) => p.h === 0 && p.k === 0);
  const gAxial = Math.min(...axial.map((p) => p.len));
  approx(gAxial, TAU / 5.2105, 1e-9);
  assert.ok(gAxial < gMin);
});
