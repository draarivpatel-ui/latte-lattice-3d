'use strict';
/* Regression coverage for the 2026-11-24 local revamp. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { steamParticles } from './engine.js';
import { displayAtoms, reciprocalPoints, sha256hex } from './crystal.js';

test('sha256hex encodes lone surrogates like standard UTF-8', () => {
  for (const s of ['\ud800', '\udc00', 'a\ud800b']) {
    assert.equal(sha256hex(s), createHash('sha256').update(s, 'utf8').digest('hex'));
  }
});

test('steamParticles repairs hostile life values instead of emitting NaN', () => {
  for (const life of [0, -1, NaN, Infinity]) {
    const parts = steamParticles({ count: 6, t: 1.25, life });
    assert.equal(parts.length, 6);
    for (const p of parts) {
      assert.ok(Number.isFinite(p.age), 'age finite for life ' + life);
      assert.ok(p.position.every(Number.isFinite), 'position finite for life ' + life);
      assert.ok(Number.isFinite(p.alpha), 'alpha finite for life ' + life);
      assert.ok(Number.isFinite(p.size), 'size finite for life ' + life);
    }
  }
});

test('displayAtoms rejects non integral or non positive cell counts', () => {
  assert.throws(() => displayAtoms('po', { cells: 0 }), RangeError);
  assert.throws(() => displayAtoms('po', { cells: 1.5 }), RangeError);
  assert.throws(() => displayAtoms('po', { cells: NaN }), RangeError);
});

test('reciprocalPoints rejects invalid maxIndex instead of scanning garbage', () => {
  assert.throws(() => reciprocalPoints('po', { maxIndex: 0 }), RangeError);
  assert.throws(() => reciprocalPoints('po', { maxIndex: -2 }), RangeError);
  assert.throws(() => reciprocalPoints('po', { maxIndex: 1.5 }), RangeError);
  assert.throws(() => reciprocalPoints('po', { maxIndex: NaN }), RangeError);
});
