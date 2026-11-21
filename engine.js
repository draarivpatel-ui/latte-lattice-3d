/*
 * LatteLattice 3D - deterministic pure-JS procedural geometry and kinematics.
 *
 * This module has NO dependency on Three.js, the DOM, or the browser. Every
 * function is a pure function of its inputs (no Math.random, no Date.now), so
 * the same seed and parameters always produce byte-identical geometry. That is
 * what makes the scene reproducible and makes this file unit-testable with
 * `node --test test.js` outside of WebGL.
 *
 * Coordinate convention: right-handed, +Y up. Angles are radians unless the
 * function name says otherwise.
 */

'use strict';

/* -------------------------------------------------------------------------- */
/* Deterministic pseudo-random numbers                                        */
/* -------------------------------------------------------------------------- */

/** Mulberry32: small, fast, fully deterministic 32-bit PRNG. */
export function makeRng(seed) {
  let a = (typeof seed === 'number' && Number.isFinite(seed))
    ? (seed >>> 0)
    : 0x9e3779b9;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic hash of a string into an unsigned 32-bit integer (FNV-1a). */
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** Clamp x into [lo, hi]. */
export function clamp(x, lo, hi) {
  return x < lo ? lo : (x > hi ? hi : x);
}

/** Linear interpolation. */
export function lerp(a, b, t) {
  return a + (b - a) * t;
}

/** Smoothstep (cubic) easing of t in [0,1]. */
export function smoothstep(t) {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
}

/* -------------------------------------------------------------------------- */
/* Constants                                                                  */
/* -------------------------------------------------------------------------- */

export const TAU = Math.PI * 2;
export const EPSILON = 1e-9;

/* -------------------------------------------------------------------------- */
/* Vector math (plain arrays [x,y,z])                                         */
/* -------------------------------------------------------------------------- */

export function vecAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vecScale(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function vecDot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vecCross(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function vecLength(a) {
  return Math.sqrt(vecDot(a, a));
}

export function vecNormalize(a) {
  const len = vecLength(a);
  if (len < EPSILON) return [0, 0, 0];
  return vecScale(a, 1 / len);
}

/** Rotate a point around the Y axis by angle (radians). */
export function rotateY(p, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c];
}

/** Rotate a point around the Z axis by angle (radians). */
export function rotateZ(p, angle) {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
}

/* -------------------------------------------------------------------------- */
/* Parametric surfaces                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Generate a UV parametric grid of positions.
 * fn(u, v) must return [x, y, z]. Returns a flat Float64Array-like object:
 *   { positions: number[][], uSegs, vSegs, index(us, vs) }
 * where vertices are stored row-major: row v, column u.
 */
export function parametricGrid(fn, uSegs, vSegs) {
  const nu = Math.max(1, Math.floor(uSegs));
  const nv = Math.max(1, Math.floor(vSegs));
  const positions = new Array((nu + 1) * (nv + 1));
  for (let j = 0; j <= nv; j++) {
    const v = j / nv;
    for (let i = 0; i <= nu; i++) {
      const u = i / nu;
      positions[j * (nu + 1) + i] = fn(u, v);
    }
  }
  return {
    positions,
    uSegs: nu,
    vSegs: nv,
    index: (i, j) => j * (nu + 1) + i,
  };
}

/** Triangle indices (flat array of triples) for a parametricGrid, CCW winding
 * seen from the dv x du side, which is the outward side for the engine's
 * surface parameterizations (torus, lathe, crystal). */
export function gridTriangles(grid) {
  const { uSegs: nu, vSegs: nv, index } = grid;
  const tris = [];
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const a = index(i, j);
      const b = index(i + 1, j);
      const c = index(i + 1, j + 1);
      const d = index(i, j + 1);
      tris.push([a, c, b], [a, d, c]);
    }
  }
  return tris;
}

/** Per-vertex normals from positions + triangles (area-weighted accumulation). */
export function computeNormals(positions, triangles) {
  const normals = positions.map(() => [0, 0, 0]);
  for (const [ia, ib, ic] of triangles) {
    const a = positions[ia], b = positions[ib], c = positions[ic];
    const n = vecCross(vecSub(b, a), vecSub(c, a));
    for (const idx of [ia, ib, ic]) {
      normals[idx][0] += n[0];
      normals[idx][1] += n[1];
      normals[idx][2] += n[2];
    }
  }
  return normals.map(vecNormalize);
}

/** Surface points for a torus centered on the Y axis. */
export function torusSurface(u, v, R, r) {
  const cu = Math.cos(u * TAU), su = Math.sin(u * TAU);
  const cv = Math.cos(v * TAU), sv = Math.sin(v * TAU);
  return [(R + r * cv) * cu, r * sv, (R + r * cv) * su];
}

/**
 * Procedural crystal geometry: a faceted, twisted prism whose radius is
 * modulated by a deterministic noise field. closed=false leaves the caps open
 * so the caller can add explicit cap fans; v in [0,1] runs base -> tip.
 */
export function crystalProfile(u, v, opts) {
  const o = Object.assign({
    sides: 7,
    height: 2.4,
    radius: 0.6,
    twist: 0.9,
    taper: 0.35,
    seed: 1337,
  }, opts || {});
  const rng = makeRng(o.seed);
  // Precompute one deterministic radial jitter per side along the height.
  const bands = 5;
  const jitter = [];
  for (let b = 0; b < bands; b++) {
    const row = [];
    for (let s = 0; s < o.sides; s++) row.push(0.82 + 0.36 * rng());
    jitter.push(row);
  }
  const seg = u * o.sides;
  const s0 = Math.floor(seg) % o.sides;
  const s1 = (s0 + 1) % o.sides;
  const f = seg - Math.floor(seg);
  const band = v * (bands - 1);
  const b0 = Math.floor(band);
  const b1 = Math.min(bands - 1, b0 + 1);
  const bf = band - b0;
  const jit = lerp(lerp(jitter[b0][s0], jitter[b0][s1], f),
                   lerp(jitter[b1][s0], jitter[b1][s1], f), bf);
  const radius = o.radius * jit * lerp(1, o.taper, v);
  const ang = u * TAU + o.twist * v;
  // Polygon edge, not a circle: faceted look.
  const edge = Math.cos(Math.PI / o.sides) / Math.cos((f - 0.5) * TAU / o.sides);
  return [radius * edge * Math.cos(ang), v * o.height, radius * edge * Math.sin(ang)];
}

/* -------------------------------------------------------------------------- */
/* Primitive mesh builders (return {positions, triangles, normals})            */
/* -------------------------------------------------------------------------- */

export function buildBox(w, h, d) {
  const x = w / 2, y = h / 2, z = d / 2;
  const positions = [
    [-x, -y, -z], [x, -y, -z], [x, y, -z], [-x, y, -z],
    [-x, -y,  z], [x, -y,  z], [x, y,  z], [-x, y,  z],
  ];
  const triangles = [
    [0, 2, 1], [0, 3, 2], // back (-z)
    [4, 5, 6], [4, 6, 7], // front (+z)
    [0, 1, 5], [0, 5, 4], // bottom (-y)
    [3, 7, 6], [3, 6, 2], // top (+y)
    [0, 4, 7], [0, 7, 3], // left (-x)
    [1, 2, 6], [1, 6, 5], // right (+x)
  ];
  return finalizeMesh(positions, triangles);
}

/**
 * Weld vertices that coincide within eps and remap triangle indices onto the
 * welded set. Periodic surfaces (torus, lathe, crystal) generate a duplicated
 * seam column at u=1 whose positions coincide with the u=0 column; welding
 * turns coincident seams into shared edges so the mesh is watertight, not
 * merely closed-looking. Lathe profiles that touch the axis (radius 0 rows)
 * collapse correctly too: degenerate triangles are dropped.
 */
export function weldVertices(positions, triangles, eps = 1e-7) {
  // Buckets are eps-sized, but a point can sit within eps of a neighbour in
  // the next bucket, so the 3x3x3 neighbourhood must be searched with a real
  // distance test. Two points closer than eps always weld; two points farther
  // than ~1.73*eps never do.
  const seen = new Map();
  const remap = new Array(positions.length);
  const out = [];
  const eps2 = eps * eps;
  for (let i = 0; i < positions.length; i++) {
    const p = positions[i];
    const bx = Math.floor(p[0] / eps), by = Math.floor(p[1] / eps), bz = Math.floor(p[2] / eps);
    let hit;
    for (let dx = -1; dx <= 1 && hit === undefined; dx++) {
      for (let dy = -1; dy <= 1 && hit === undefined; dy++) {
        for (let dz = -1; dz <= 1 && hit === undefined; dz++) {
          const bucket = seen.get((bx + dx) + ',' + (by + dy) + ',' + (bz + dz));
          if (!bucket) continue;
          for (const idx of bucket) {
            const q = out[idx];
            const d2 = (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
            if (d2 <= eps2) { hit = idx; break; }
          }
        }
      }
    }
    if (hit !== undefined) {
      remap[i] = hit;
      continue;
    }
    remap[i] = out.length;
    const key = bx + ',' + by + ',' + bz;
    if (!seen.has(key)) seen.set(key, []);
    seen.get(key).push(remap[i]);
    out.push(p);
  }
  const tris = [];
  for (const [a, b, c] of triangles) {
    const t = [remap[a], remap[b], remap[c]];
    if (t[0] !== t[1] && t[1] !== t[2] && t[0] !== t[2]) tris.push(t);
  }
  return { positions: out, triangles: tris, remap };
}

export function buildTorus(R, r, uSegs, vSegs) {
  const grid = parametricGrid((u, v) => torusSurface(u, v, R, r), uSegs, vSegs);
  const w = weldVertices(grid.positions, gridTriangles(grid));
  return finalizeMesh(w.positions, w.triangles);
}

export function buildCrystal(opts) {
  const o = Object.assign({ sides: 7, uSegs: 14, vSegs: 10, cap: true }, opts || {});
  const grid = parametricGrid((u, v) => crystalProfile(u, v, o), o.uSegs, o.vSegs);
  const w = weldVertices(grid.positions, gridTriangles(grid));
  const positions = w.positions;
  const triangles = w.triangles;
  if (o.cap) {
    // Top cap fan at the tip ring and bottom cap fan at the base ring.
    const nu = grid.uSegs;
    const topRing = [];
    const botRing = [];
    for (let i = 0; i < nu; i++) {
      topRing.push(w.remap[grid.index(i, grid.vSegs)]);
      botRing.push(w.remap[grid.index(i, 0)]);
    }
    const topCenter = positions.length;
    const tip = crystalProfile(0.5, 1, o);
    positions.push([0, tip[1], 0]);
    const botCenter = positions.length;
    positions.push([0, 0, 0]);
    for (let i = 0; i < nu; i++) {
      const j = (i + 1) % nu;
      // Winding keeps cap normals outward and traverses each shared ring
      // edge opposite to the side surface, so the capped mesh stays
      // consistently oriented and watertight.
      triangles.push([topCenter, topRing[j], topRing[i]]);
      triangles.push([botCenter, botRing[i], botRing[j]]);
    }
  }
  return finalizeMesh(positions, triangles);
}

/** Build a lathe/revolution surface from a 2D profile [radius, y]. */
export function buildLathe(profile, segments) {
  if (!Array.isArray(profile) || profile.length < 2) {
    throw new RangeError('lathe profile needs at least 2 points');
  }
  const n = Math.max(3, Math.floor(segments));
  const grid = parametricGrid((u, v) => {
    const idx = v * (profile.length - 1);
    const i0 = Math.floor(idx);
    const i1 = Math.min(profile.length - 1, i0 + 1);
    const f = idx - i0;
    const r = lerp(profile[i0][0], profile[i1][0], f);
    const y = lerp(profile[i0][1], profile[i1][1], f);
    const a = u * TAU;
    return [r * Math.cos(a), y, r * Math.sin(a)];
  }, n, profile.length - 1);
  const w = weldVertices(grid.positions, gridTriangles(grid));
  return finalizeMesh(w.positions, w.triangles);
}

/** Attach computed normals and a few useful derived quantities. */
export function finalizeMesh(positions, triangles) {
  const normals = computeNormals(positions, triangles);
  return {
    positions,
    triangles,
    normals,
    vertexCount: positions.length,
    triangleCount: triangles.length,
    bounds: boundsOf(positions),
  };
}

/** Axis-aligned bounding box {min:[x,y,z], max:[x,y,z]} of positions. */
export function boundsOf(positions) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const p of positions) {
    for (let k = 0; k < 3; k++) {
      if (p[k] < min[k]) min[k] = p[k];
      if (p[k] > max[k]) max[k] = p[k];
    }
  }
  if (!positions.length) return { min: [0, 0, 0], max: [0, 0, 0] };
  return { min, max };
}

/* -------------------------------------------------------------------------- */
/* Gear / grinder kinematics                                                  */
/* -------------------------------------------------------------------------- */

/**
 * Procedural spur-gear polygon (2D outline in the XZ plane). Alternate teeth
 * between root and tip radius, with deterministic tooth width jitter.
 */
export function gearOutline(teeth, rootR, tipR, seed) {
  const rng = makeRng(seed);
  const pts = [];
  const steps = teeth * 4;
  for (let i = 0; i < steps; i++) {
    const q = i % 4;
    const isTip = (q === 1 || q === 2);
    const r = isTip ? tipR * (0.97 + 0.06 * rng()) : rootR;
    const a = (i / steps) * TAU;
    pts.push([r * Math.cos(a), r * Math.sin(a)]);
  }
  return pts;
}

/**
 * Planetary gear train angles at time t. The sun gear drives `planets` equally
 * spaced planet gears; the ring stays fixed. Returns each body's spin angle and
 * world XZ position. All deterministic functions of t and omega.
 */
function requireToothCount(name, v) {
  if (!Number.isInteger(v) || v < 1) {
    throw new RangeError(name + ' must be an integer >= 1');
  }
}

export function planetaryState(opts) {
  const o = Object.assign({
    sunTeeth: 18,
    planetTeeth: 12,
    planets: 3,
    sunR: 0.9,
    omega: 0.6,
    t: 0,
  }, opts || {});
  requireToothCount('sunTeeth', o.sunTeeth);
  requireToothCount('planetTeeth', o.planetTeeth);
  requireToothCount('planets', o.planets);
  const sunAngle = o.omega * o.t;
  // Fixed-ring planetary kinematics (Willis equation). With the ring held at
  // rest, the carrier advances at sunTeeth / (sunTeeth + ringTeeth) of the sun
  // rate, where ringTeeth = sunTeeth + 2 * planetTeeth.
  const ratio = o.sunTeeth / o.planetTeeth;
  const ringTeeth = o.sunTeeth + 2 * o.planetTeeth;
  const carrierR = o.sunR * (1 + o.planetTeeth / o.sunTeeth);
  const carrierAngle = o.omega * o.t * o.sunTeeth / (o.sunTeeth + ringTeeth);
  const planetsArr = [];
  for (let i = 0; i < o.planets; i++) {
    const a = carrierAngle + (i / o.planets) * TAU;
    planetsArr.push({
      angle: carrierAngle - ratio * (sunAngle - carrierAngle) + (i / o.planets) * TAU,
      position: [carrierR * Math.cos(a), 0, carrierR * Math.sin(a)],
    });
  }
  return {
    sunAngle,
    ringAngle: 0,
    carrierAngle,
    planets: planetsArr,
  };
}

/* -------------------------------------------------------------------------- */
/* Steam valve / particle kinematics                                          */
/* -------------------------------------------------------------------------- */

/**
 * Deterministic steam particle state. Each particle rises, drifts with a
 * curl-like swirl, wraps at `life`. `open` controls whether emission is active;
 * particle i has a stable phase offset so no RNG is needed per frame.
 */
export function steamParticles(opts) {
  const o = Object.assign({
    count: 48,
    t: 0,
    open: true,
    rise: 0.9,
    spread: 0.35,
    life: 2.6,
    seed: 99,
    origin: [0, 0, 0],
  }, opts || {});
  const rng = makeRng(o.seed);
  const out = [];
  const phase = [];
  for (let i = 0; i < o.count; i++) phase.push(rng());
  for (let i = 0; i < o.count; i++) {
    const p = phase[i];
    const age = ((o.t * (o.open ? 1 : 0.25) + p * o.life) % o.life + o.life) % o.life;
    const k = age / o.life;
    const swirl = p * TAU * 3 + o.t * 1.7;
    const rad = o.spread * k * (0.4 + 0.6 * Math.sin(p * 12.9898));
    const alpha = o.open ? Math.sin(Math.PI * k) : 0;
    out.push({
      position: [
        o.origin[0] + Math.cos(swirl) * rad,
        o.origin[1] + k * o.rise * o.life,
        o.origin[2] + Math.sin(swirl) * rad,
      ],
      alpha: clamp(alpha, 0, 1),
      size: 0.04 + 0.10 * k,
      age,
    });
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Latte-art fluid surface field                                              */
/* -------------------------------------------------------------------------- */

/**
 * Procedural latte-art field over a unit disk. `pattern` selects the pour
 * style. Returns a height displacement h(x,z) and a color mix c in [0,1]
 * (0 = espresso crema, 1 = milk foam). Used both to displace a mesh and to
 * paint vertex colors, which is what makes the fluid "simulation" visible.
 *
 * The rosetta pattern is built from nested sine-driven ripples along the pour
 * axis; the heart pattern from a smooth radial blend. Everything is a pure
 * deterministic function, so the surface is stable and testable.
 */
export function latteField(x, z, t, pattern) {
  const r = Math.sqrt(x * x + z * z);
  const ang = Math.atan2(z, x);
  const p = pattern || 'rosetta';
  let c = 0;
  let h = 0;
  const wobble = 0.03 * Math.sin(t * 1.3 + r * 9);
  if (p === 'rosetta') {
    // Stacked leaf ripples along +z, fading toward the rim.
    const leaves = Math.sin(z * 14 - r * 5 + t * 0.6);
    const envelope = smoothstep(1 - r) * (0.6 + 0.4 * Math.cos(x * Math.PI));
    c = clamp(0.5 + 0.5 * leaves * envelope, 0, 1);
    h = (leaves * envelope) * 0.018 + wobble * (1 - r);
  } else if (p === 'heart') {
    // Two lobes: distance to a heart-like implicit curve.
    const hx = x / 1.05;
    const hz = (z - 0.12) / 1.05;
    const lobe = Math.pow(hx * hx + hz * hz - 0.32, 3) - hx * hx * hz * hz * hz;
    c = clamp(0.5 - lobe * 6, 0, 1);
    h = c * 0.02 + wobble * (1 - r);
  } else if (p === 'tulip') {
    const rings = Math.sin(r * 18 - t * 0.8);
    const env = smoothstep(1 - r);
    c = clamp(0.5 + 0.5 * rings * env, 0, 1);
    h = rings * env * 0.02 + wobble * (1 - r);
  } else {
    // 'swirl': spiral mix.
    c = clamp(0.5 + 0.5 * Math.sin(ang * 3 + r * 12 - t), 0, 1);
    h = c * 0.015 + wobble * (1 - r);
  }
  // Keep the rim flat so the liquid sits inside the cup.
  const rim = smoothstep(clamp((1 - r) / 0.12, 0, 1));
  return { height: h * rim, mix: c * rim, radius: r };
}

/** Mix two RGB colors (arrays of 3 floats in [0,1]) by t. */
export function mixColor(a, b, t) {
  const k = clamp(t, 0, 1);
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

/** Crema and milk foam brand colors. */
export const CREMA = [0.36, 0.20, 0.11];
export const FOAM = [0.96, 0.89, 0.76];

/* -------------------------------------------------------------------------- */
/* Camera orbit / WASD controller state (pure)                                */
/* -------------------------------------------------------------------------- */

/**
 * Convert spherical orbit coordinates to a Cartesian camera position.
 * yaw around Y, pitch clamped, radius distance from target.
 */
export function orbitToCartesian(yaw, pitch, radius, target) {
  const p = clamp(pitch, -1.45, 1.45);
  const cp = Math.cos(p);
  const tgt = target || [0, 0, 0];
  return [
    tgt[0] + radius * cp * Math.sin(yaw),
    tgt[1] + radius * Math.sin(p),
    tgt[2] + radius * cp * Math.cos(yaw),
  ];
}

/**
 * Advance an orbit state given a set of pressed keys and a time step dt.
 * `keys` is a plain object with optional w/a/s/d/arrow booleans and q/e for
 * radius, plus optional `dragYaw`/`dragPitch` deltas from the pointer.
 * Returns a NEW state object (pure).
 */
export function stepCamera(state, keys, dt) {
  const s = Object.assign({
    yaw: 0.6, pitch: 0.35, radius: 9, target: [0, 1.2, 0],
  }, state || {});
  const k = keys || {};
  const d = Math.max(0, dt || 0);
  const move = 2.4 * d;
  const rot = 1.5 * d;
  let yaw = s.yaw + (k.dragYaw || 0) + ((k.a ? -rot : 0) + (k.d ? rot : 0))
                  + ((k.arrowLeft ? -rot : 0) + (k.arrowRight ? rot : 0));
  let pitch = s.pitch + (k.dragPitch || 0) + ((k.w ? rot : 0) + (k.s ? -rot : 0))
                  + ((k.arrowUp ? rot : 0) + (k.arrowDown ? -rot : 0));
  pitch = clamp(pitch, -1.45, 1.45);
  let radius = s.radius + ((k.q ? -move : 0) + (k.e ? move : 0))
                  + (k.dolly || 0);
  radius = clamp(radius, 3, 22);
  // Normalize yaw only when it actually changed. A zero delta must return the
  // input yaw bit-for-bit, which keeps the controller idempotent at dt=0.
  const yawDelta = (k.dragYaw || 0) + ((k.a ? -rot : 0) + (k.d ? rot : 0))
                 + ((k.arrowLeft ? -rot : 0) + (k.arrowRight ? rot : 0));
  if (yawDelta !== 0) {
    yaw = ((yaw + Math.PI) % TAU + TAU) % TAU - Math.PI;
  }
  return { yaw, pitch, radius, target: s.target.slice() };
}

/* -------------------------------------------------------------------------- */
/* Day / night lighting interpolation                                         */
/* -------------------------------------------------------------------------- */

/** Interpolate a lighting preset. `mode` 0 = day, 1 = night. */
export function lightingPreset(mode) {
  const m = clamp(mode, 0, 1);
  const day = {
    ambient: 0.85, key: 1.15, warm: 0.35,
    sky: [0.55, 0.72, 0.92], fog: 0.012, exposure: 1.0,
    background: [0.96, 0.90, 0.80],
  };
  const night = {
    ambient: 0.30, key: 0.35, warm: 1.25,
    sky: [0.10, 0.12, 0.24], fog: 0.030, exposure: 1.15,
    background: [0.05, 0.05, 0.11],
  };
  const out = {};
  for (const key of Object.keys(day)) {
    if (Array.isArray(day[key])) {
      out[key] = [
        lerp(day[key][0], night[key][0], m),
        lerp(day[key][1], night[key][1], m),
        lerp(day[key][2], night[key][2], m),
      ];
    } else {
      out[key] = lerp(day[key], night[key], m);
    }
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Mesh export: OBJ and ASCII STL                                             */
/* -------------------------------------------------------------------------- */

/** Serialize a mesh (with optional world transform) to Wavefront OBJ text. */
export function toOBJ(mesh, options) {
  const o = Object.assign({ name: 'LatteLattice', offset: [0, 0, 0], scale: 1 }, options || {});
  const lines = [`# LatteLattice 3D OBJ export`, `o ${o.name}`];
  const s = o.scale;
  for (const p of mesh.positions) {
    lines.push(`v ${fmt(p[0] * s + o.offset[0])} ${fmt(p[1] * s + o.offset[1])} ${fmt(p[2] * s + o.offset[2])}`);
  }
  if (mesh.normals) {
    for (const n of mesh.normals) {
      lines.push(`vn ${fmt(n[0])} ${fmt(n[1])} ${fmt(n[2])}`);
    }
  }
  for (const t of mesh.triangles) {
    const a = t[0] + 1, b = t[1] + 1, c = t[2] + 1;
    lines.push(mesh.normals
      ? `f ${a}//${a} ${b}//${b} ${c}//${c}`
      : `f ${a} ${b} ${c}`);
  }
  return lines.join('\n') + '\n';
}

/** Serialize a mesh to ASCII STL text (one solid, flattened triangle soup). */
export function toSTL(mesh, options) {
  const o = Object.assign({ name: 'LatteLattice', offset: [0, 0, 0], scale: 1 }, options || {});
  const lines = [`solid ${o.name}`];
  const s = o.scale;
  const P = (idx) => [
    mesh.positions[idx][0] * s + o.offset[0],
    mesh.positions[idx][1] * s + o.offset[1],
    mesh.positions[idx][2] * s + o.offset[2],
  ];
  for (const [ia, ib, ic] of mesh.triangles) {
    const a = P(ia), b = P(ib), c = P(ic);
    const n = vecNormalize(vecCross(vecSub(b, a), vecSub(c, a)));
    lines.push(`  facet normal ${fmt(n[0])} ${fmt(n[1])} ${fmt(n[2])}`);
    lines.push('    outer loop');
    for (const v of [a, b, c]) lines.push(`      vertex ${fmt(v[0])} ${fmt(v[1])} ${fmt(v[2])}`);
    lines.push('    endloop');
    lines.push('  endfacet');
  }
  lines.push(`endsolid ${o.name}`);
  return lines.join('\n') + '\n';
}

/** Merge several meshes (each with optional offset) into one exportable mesh. */
export function mergeMeshes(parts) {
  const positions = [];
  const triangles = [];
  for (const part of parts) {
    const base = positions.length;
    const off = part.offset || [0, 0, 0];
    const s = part.scale === undefined ? 1 : part.scale;
    for (const p of part.mesh.positions) {
      positions.push([p[0] * s + off[0], p[1] * s + off[1], p[2] * s + off[2]]);
    }
    for (const t of part.mesh.triangles) {
      triangles.push([t[0] + base, t[1] + base, t[2] + base]);
    }
  }
  return finalizeMesh(positions, triangles);
}

function fmt(x) {
  // Stable, compact decimal formatting for byte-identical exports.
  if (!Number.isFinite(x)) return '0';
  const r = Math.round(x * 1e6) / 1e6;
  return String(r);
}

/* -------------------------------------------------------------------------- */
/* Scene assembly metadata (deterministic)                                    */
/* -------------------------------------------------------------------------- */

/** A deterministic description of the whole diorama, consumed by the renderer. */
export function buildScenePlan(seed) {
  const rng = makeRng(seed === undefined ? 2026 : seed);
  const crystals = [];
  const count = 7;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * TAU + rng() * 0.4;
    const dist = 2.4 + rng() * 1.6;
    crystals.push({
      position: [Math.cos(a) * dist, 0, Math.sin(a) * dist],
      height: 1.4 + rng() * 1.8,
      radius: 0.28 + rng() * 0.34,
      sides: 5 + Math.floor(rng() * 5),
      twist: 0.5 + rng() * 1.5,
      seed: Math.floor(rng() * 1e9),
      spin: 0.15 + rng() * 0.4,
      phase: rng() * TAU,
    });
  }
  return {
    crystals,
    grinder: { sunTeeth: 18, planetTeeth: 12, planets: 3, sunR: 0.9 },
    latte: { pattern: 'rosetta', radius: 1.0 },
    seed: seed === undefined ? 2026 : seed,
  };
}


/* -------------------------------------------------------------------------- */
/* Mesh measurement, telemetry and pattern signatures (pure, deterministic)    */
/* -------------------------------------------------------------------------- */

/** Exact area of one triangle from its three vertex positions. */
export function triangleArea(a, b, c) {
  return 0.5 * vecLength(vecCross(vecSub(b, a), vecSub(c, a)));
}

/** Total surface area of a triangle mesh, summed over every facet. */
export function meshSurfaceArea(mesh) {
  let area = 0;
  for (const [ia, ib, ic] of mesh.triangles) {
    area += triangleArea(mesh.positions[ia], mesh.positions[ib], mesh.positions[ic]);
  }
  return area;
}

/**
 * Signed volume of a closed triangle mesh via the divergence theorem.
 * Open meshes return a partial value; winding determines the sign.
 */
export function meshSignedVolume(mesh) {
  let vol = 0;
  for (const [ia, ib, ic] of mesh.triangles) {
    const a = mesh.positions[ia], b = mesh.positions[ib], c = mesh.positions[ic];
    // scalar triple product a . (b x c) / 6
    vol += vecDot(a, vecCross(b, c)) / 6;
  }
  return vol;
}

/** Centroid of all vertex positions (unweighted by facet area). */
export function meshCentroid(mesh) {
  if (!mesh.positions.length) return [0, 0, 0];
  const sum = [0, 0, 0];
  for (const p of mesh.positions) {
    sum[0] += p[0]; sum[1] += p[1]; sum[2] += p[2];
  }
  return vecScale(sum, 1 / mesh.positions.length);
}

/** Count degenerate triangles whose area is below a tolerance. */
export function degenerateTriangleCount(mesh, tolerance = EPSILON) {
  let n = 0;
  for (const [ia, ib, ic] of mesh.triangles) {
    if (triangleArea(mesh.positions[ia], mesh.positions[ib], mesh.positions[ic]) <= tolerance) n++;
  }
  return n;
}

/**
 * Deterministic gear train ratio summary. Returns the sun/planet tooth ratio,
 * the carrier angular velocity ratio and the relative planet spin rate.
 * All values are derived from the tooth counts, never from wall clock time.
 */
export function planetaryGearRatio(opts) {
  const o = Object.assign({ sunTeeth: 18, planetTeeth: 12, planets: 3 }, opts || {});
  requireToothCount('sunTeeth', o.sunTeeth);
  requireToothCount('planetTeeth', o.planetTeeth);
  requireToothCount('planets', o.planets);
  const ratio = o.sunTeeth / o.planetTeeth;
  const ringTeeth = o.sunTeeth + 2 * o.planetTeeth;
  // Willis equation for a fixed ring: carrier spins at
  // sunTeeth / (sunTeeth + ringTeeth) of the sun rate; each planet spins at
  // carrierRate - toothRatio * (1 - carrierRate) relative to ground.
  const carrierRate = o.sunTeeth / (o.sunTeeth + ringTeeth);
  return {
    toothRatio: ratio,
    carrierRate,
    planetSpinRate: carrierRate - ratio * (1 - carrierRate),
    ringTeeth,
    planets: o.planets,
  };
}

/**
 * Sample the latte-art field over a regular grid on the unit disk and return
 * auditable statistics: mean foam mix, height range, and the fraction of
 * sampled disk points with a mix above 0.5 (milk dominant).
 */
export function fieldSampleStats(pattern, t = 0, gridSize = 24) {
  const n = Math.max(2, Math.floor(gridSize));
  let count = 0, mixSum = 0, minH = Infinity, maxH = -Infinity, foamDominant = 0;
  for (let j = 0; j <= n; j++) {
    const z = -1 + (2 * j) / n;
    for (let i = 0; i <= n; i++) {
      const x = -1 + (2 * i) / n;
      if (x * x + z * z > 1) continue;
      const f = latteField(x, z, t, pattern);
      count++;
      mixSum += f.mix;
      if (f.height < minH) minH = f.height;
      if (f.height > maxH) maxH = f.height;
      if (f.mix > 0.5) foamDominant++;
    }
  }
  return {
    pattern,
    samples: count,
    meanMix: count ? mixSum / count : 0,
    minHeight: count ? minH : 0,
    maxHeight: count ? maxH : 0,
    foamFraction: count ? foamDominant / count : 0,
  };
}

/** Lathe profile of the espresso cup used by the renderer and the exporter. */
export const CUP_PROFILE = [
  [0.0, 0.0], [0.55, 0.0], [0.62, 0.05], [0.7, 0.9], [0.72, 0.95],
  [0.66, 0.95], [0.64, 0.1], [0.56, 0.06], [0.0, 0.06],
];

/** Crystal garden ledge footprint in world space (matches the scene shelf). */
export const LEDGE = { xMax: 3.4, zMin: -4.15, zMax: -2.65, top: 1.72 };

/**
 * World-space offset for one plan crystal, clamped inside the ledge footprint
 * so a crystal can never hang in mid-air beside or behind the shelf.
 */
export function crystalWorldOffset(c) {
  const x = clamp(c.position[0], -LEDGE.xMax, LEDGE.xMax);
  const z = clamp(-3.4 - c.position[2] * 0.35, LEDGE.zMin, LEDGE.zMax);
  return [x, LEDGE.top + 0.05, z];
}

/**
 * The exact part list merged for OBJ/STL export AND measured by telemetry.
 * Sharing one builder keeps the on-screen diagnostics honest: the numbers in
 * the panel are computed over the same triangles the user downloads.
 */
export function buildExportMeshes(seed) {
  const plan = buildScenePlan(seed);
  const parts = [
    { mesh: buildBox(7.2, 0.32, 3.4), offset: [0, 1.55, 0] },
    { mesh: buildBox(2.0, 1.5, 1.4), offset: [-1.9, 2.47, 0] },
    { mesh: buildTorus(0.19, 0.07, 24, 12), offset: [-0.88, 2.84, 0.5] },
    { mesh: buildTorus(1.32, 0.09, 48, 12), offset: [2.0, 2.14, 0] },
    { mesh: buildLathe(CUP_PROFILE, 48), offset: [0, 1.72, 1.0] },
  ];
  for (const c of plan.crystals) {
    parts.push({
      mesh: buildCrystal({
        sides: c.sides, seed: c.seed, height: c.height,
        radius: c.radius, twist: c.twist, uSegs: c.sides * 2, vSegs: 10, cap: true,
      }),
      offset: crystalWorldOffset(c),
    });
  }
  return parts;
}

/**
 * Deterministic scene telemetry snapshot. Everything is derived from the seed
 * and parameters, so two runs with identical inputs produce identical numbers.
 * `frames` and `elapsedMs` are simply echoed into the structured readout.
 */
export function computeTelemetry(opts) {
  const o = Object.assign({
    seed: 2026, valveOpen: false, pressureBar: 0, pattern: 'rosetta',
    grindSpeed: 0.6, nightBlend: 0, frameCount: 0, elapsedMs: 0,
  }, opts || {});
  const plan = buildScenePlan(o.seed);
  const gear = planetaryGearRatio(plan.grinder);
  const field = fieldSampleStats(o.pattern, 0, 20);
  const merged = mergeMeshes(buildExportMeshes(o.seed));
  const area = meshSurfaceArea(merged);
  const volume = Math.abs(meshSignedVolume(merged));
  const degenerate = degenerateTriangleCount(merged);
  return {
    seed: o.seed,
    crystalCount: plan.crystals.length,
    vertexCount: merged.vertexCount,
    triangleCount: merged.triangleCount,
    surfaceArea: Math.round(area * 1e6) / 1e6,
    volume: Math.round(volume * 1e6) / 1e6,
    degenerateTriangles: degenerate,
    bounds: merged.bounds,
    toothRatio: gear.toothRatio,
    carrierRate: Math.round(gear.carrierRate * 1e6) / 1e6,
    planetSpinRate: Math.round(gear.planetSpinRate * 1e6) / 1e6,
    ringTeeth: gear.ringTeeth,
    meanFoamMix: Math.round(field.meanMix * 1e6) / 1e6,
    foamFraction: Math.round(field.foamFraction * 1e6) / 1e6,
    steamParticleCount: steamParticles({ count: 48, t: 1, open: o.valveOpen }).length,
    activeSteam: o.valveOpen,
    pressureBar: Math.round(o.pressureBar * 1e3) / 1e3,
    grindOmega: Math.round(o.grindSpeed * 1e3) / 1e3,
    nightBlend: Math.round(o.nightBlend * 1e3) / 1e3,
    frameCount: o.frameCount,
    elapsedMs: Math.round(o.elapsedMs * 1e3) / 1e3,
    fps: o.elapsedMs > 0 ? Math.round((o.frameCount / o.elapsedMs) * 1000 * 10) / 10 : 0,
  };
}

/** Stable FNV-1a signature of a procedural surface field for regression pins. */
export function patternSignature(pattern, t = 0, gridSize = 12) {
  const n = Math.max(2, Math.floor(gridSize));
  let acc = '';
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      const x = -1 + (2 * i) / n, z = -1 + (2 * j) / n;
      if (x * x + z * z > 1) continue;
      const f = latteField(x, z, t, pattern);
      acc += `${Math.round(f.mix * 1000)},${Math.round(f.height * 10000)};`;
    }
  }
  return hashString(acc);
}
