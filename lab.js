/*
 * LatteLattice 3D - Crystal lab overlay.
 *
 * The solid-state physics bench: a real powder XRD simulator with clickable
 * peaks that highlight the matching Miller plane on the 3D crystal, a
 * reciprocal-lattice and first-Brillouin-zone view, packing and density
 * readouts, CIF and fingerprinted XRD exports, URL-hash bookmarking and an
 * in-page self-test battery. All physics comes from crystal.js (pure,
 * deterministic); this file only wires DOM and a second WebGL viewport.
 */

import * as THREE from './vendor/three.module.min.js';
import { TAU, orbitToCartesian, stepCamera, clamp } from './engine.js';
import * as C from './crystal.js';

const ELEMENT_COLORS = {
  Po: 0xa86228, Fe: 0x8a93a3, Cu: 0xc87f3d, Si: 0xd9b356,
  Cl: 0x4f9e57, Na: 0x8a5cc8, Mg: 0x7fae6b,
};
const ATOM_SCALE = 0.42;
const ION_SCALE = 0.45;
const PLANE_COLOR = 0xe8a23b;
const BZ_COLOR = 0xd9a13b;

/* Fractional margin per structure so every in-cell atom keeps its full
 * nearest-neighbour shell on screen (Po needs a whole neighbour shell). */
const DISPLAY_MARGIN = { po: 1.03, fe: 0.53, cu: 0.53, si: 0.28, nacl: 0.55, mg: 0.72 };

export function initCrystalLab(deps) {
  const toast = deps && deps.toast ? deps.toast : () => {};
  const getSeed = deps && deps.getSeed ? deps.getSeed : () => 2026;
  const onSeed = deps && deps.onSeed ? deps.onSeed : () => {};

  const overlay = document.getElementById('crystal-lab');
  if (!overlay) return { isOpen: () => false, close: () => {}, open: () => {}, noteSeed: () => {} };

  const canvas = document.getElementById('lab-canvas');
  const spectrum = document.getElementById('lab-spectrum');
  const chip = document.getElementById('lab-hkl-chip');
  const peakTable = document.getElementById('lab-peak-table');

  const state = {
    open: false,
    structure: 'cu',
    lambda: 'cu',
    view: 'direct',
    cells: 1,
    hkl: null,
    spin: true,
    pattern: null,
    lastFocus: null,
    cam: { yaw: 0.7, pitch: 0.42, radius: 12, target: [0, 0, 0] },
    keys: {},
    dragging: false,
    lastX: 0,
    lastY: 0,
  };

  /* ----------------------------- 3D lab viewport -------------------------- */

  let renderer = null;
  let rendererFailed = false;
  let labScene = null;
  let labCamera = null;
  const content = new THREE.Group();

  function ensureRenderer() {
    if (renderer) return true;
    if (rendererFailed) return false;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    } catch (err) {
      rendererFailed = true;
      console.error('[LatteLattice] lab WebGL init failed', err);
      return false;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    labScene = new THREE.Scene();
    labScene.background = new THREE.Color(0x171310);
    labCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 400);
    labScene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xfff1dc, 1.6);
    key.position.set(6, 10, 8);
    labScene.add(key);
    const rim = new THREE.DirectionalLight(0x9fc0ff, 0.7);
    rim.position.set(-8, -4, -6);
    labScene.add(rim);
    labScene.add(content);
    return true;
  }

  function disposeGroup(g) {
    g.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose());
        else o.material.dispose();
      }
    });
    while (g.children.length) g.remove(g.children[0]);
  }

  function labCenter(sid) {
    const [a1, a2, a3] = C.cellVectors(sid);
    return [
      (a1[0] + a2[0] + a3[0]) / 2,
      (a1[1] + a2[1] + a3[1]) / 2,
      (a1[2] + a2[2] + a3[2]) / 2,
    ];
  }

  function cellEdgeSegments(sid) {
    const [a1, a2, a3] = C.cellVectors(sid);
    const cart = (u, v, w) => new THREE.Vector3(
      u * a1[0] + v * a2[0] + w * a3[0],
      u * a1[1] + v * a2[1] + w * a3[1],
      u * a1[2] + v * a2[2] + w * a3[2],
    );
    // Edges are vertex pairs that differ in exactly one fractional
    // coordinate, which is correct for oblique cells too (hexagonal).
    const uvw = [];
    for (const u of [0, 1]) for (const v of [0, 1]) for (const w of [0, 1]) uvw.push([u, v, w]);
    const pts = [];
    for (let i = 0; i < 8; i++) for (let j = i + 1; j < 8; j++) {
      const diff = uvw[i].map((x, n) => Math.abs(x - uvw[j][n]));
      if (diff[0] + diff[1] + diff[2] === 1) {
        pts.push(cart(...uvw[i]), cart(...uvw[j]));
      }
    }
    return new THREE.BufferGeometry().setFromPoints(pts);
  }

  let atomMeshes = [];
  let planeGroup = null;

  function buildDirectView() {
    disposeGroup(content);
    atomMeshes = [];
    const sid = state.structure;
    const s = C.STRUCTURES[sid];
    const atoms = C.displayAtoms(sid, {
      cells: state.cells, margin: state.cells === 1 ? (DISPLAY_MARGIN[sid] || 0) : 0,
    });
    const [a1, a2, a3] = C.cellVectors(sid);
    // A cells x cells x cells block spans 0..cells in each direction, so its
    // middle is cells times the single-cell centre.
    const center = labCenter(sid).map((x) => x * state.cells);
    const shift = (p) => [p[0] - center[0], p[1] - center[1], p[2] - center[2]];
    // Cartesian origin of every cell copy in the block (index 0 is the base).
    const cellOffsets = [];
    for (let i = 0; i < state.cells; i++) for (let j = 0; j < state.cells; j++) for (let m = 0; m < state.cells; m++) {
      cellOffsets.push([
        a1[0] * i + a2[0] * j + a3[0] * m,
        a1[1] * i + a2[1] * j + a3[1] * m,
        a1[2] * i + a2[2] * j + a3[2] * m,
      ]);
    }

    // Cell frames: the base cell plus every shifted copy in the block.
    const cellGeo = cellEdgeSegments(sid);
    cellGeo.translate(-center[0], -center[1], -center[2]);
    content.add(new THREE.LineSegments(cellGeo,
      new THREE.LineBasicMaterial({ color: 0xc9963f, transparent: true, opacity: 0.85 })));
    if (state.cells === 2) {
      const base = cellGeo.attributes.position.array.slice();
      const extra = [];
      for (let o = 1; o < cellOffsets.length; o++) {
        const v = cellOffsets[o];
        for (let i = 0; i < base.length; i += 3) {
          extra.push(base[i] + v[0], base[i + 1] + v[1], base[i + 2] + v[2]);
        }
      }
      const g2 = new THREE.BufferGeometry();
      g2.setAttribute('position', new THREE.BufferAttribute(new Float32Array(extra), 3));
      content.add(new THREE.LineSegments(g2,
        new THREE.LineBasicMaterial({ color: 0xc9963f, transparent: true, opacity: 0.28 })));
    }

    // Atoms: one InstancedMesh per element so colors stay flat and fast.
    const byEl = new Map();
    atoms.forEach((a, idx) => {
      if (!byEl.has(a.el)) byEl.set(a.el, []);
      byEl.get(a.el).push({ a, idx });
    });
    const nn = C.nearestNeighbor(sid);
    const sphere = new THREE.SphereGeometry(1, 20, 14);
    const onPlaneIdx = new Set();
    if (state.hkl) {
      const [h, k, l] = state.hkl;
      // Plane indices drawn across the whole block: each cell copy shifts the
      // family by an integer h*i + k*j + l*m, so atoms light up in every cell.
      const litM = new Set();
      for (const plane of C.millerPlanesInCell(sid, h, k, l)) {
        for (let i = 0; i < state.cells; i++) for (let j = 0; j < state.cells; j++) for (let m = 0; m < state.cells; m++) {
          litM.add(plane.m + h * i + k * j + l * m);
        }
      }
      for (const it of atoms) {
        const phi = h * it.frac[0] + k * it.frac[1] + l * it.frac[2];
        const mi = Math.round(phi);
        if (Math.abs(phi - mi) < 1e-6 && litM.has(mi)) onPlaneIdx.add(it);
      }
    }
    for (const [el, list] of byEl) {
      const mat = new THREE.MeshStandardMaterial({
        color: ELEMENT_COLORS[el] || 0xcccccc, roughness: 0.42, metalness: 0.25,
      });
      const inst = new THREE.InstancedMesh(sphere, mat, list.length);
      const r0 = s.id === 'nacl' ? null : (nn / 2) * ATOM_SCALE;
      const m4 = new THREE.Matrix4();
      const col = new THREE.Color();
      list.forEach(({ a, idx }, n) => {
        const r = (s.id === 'nacl' ? a.radius * ION_SCALE : r0) * (a.outside ? 0.55 : 1);
        const p = shift(a.pos);
        m4.makeScale(r, r, r).setPosition(p[0], p[1], p[2]);
        inst.setMatrixAt(n, m4);
        col.setHex(onPlaneIdx.has(a) ? 0xffd57a : (ELEMENT_COLORS[el] || 0xcccccc));
        if (a.outside) col.multiplyScalar(0.4);
        inst.setColorAt(n, col);
      });
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.userData.idxs = list.map((x) => x.idx);
      content.add(inst);
      atomMeshes.push(inst);
    }

    // Bonds between nearest neighbours (ball-and-stick readability).
    const pairs = C.bondPairs(sid, atoms);
    if (pairs.length) {
      const cyl = new THREE.CylinderGeometry(1, 1, 1, 10, 1);
      const bmat = new THREE.MeshStandardMaterial({ color: 0x9a8f80, roughness: 0.55, metalness: 0.35 });
      const binst = new THREE.InstancedMesh(cyl, bmat, pairs.length);
      const m4 = new THREE.Matrix4();
      const up = new THREE.Vector3(0, 1, 0);
      const dir = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const mid = new THREE.Vector3();
      const bondR = Math.max(0.05, (nn / 2) * ATOM_SCALE * 0.32);
      pairs.forEach(([i, j, d], n) => {
        const p = new THREE.Vector3(...shift(atoms[i].pos));
        const q = new THREE.Vector3(...shift(atoms[j].pos));
        dir.subVectors(q, p);
        const len = dir.length();
        dir.normalize();
        quat.setFromUnitVectors(up, dir);
        mid.addVectors(p, q).multiplyScalar(0.5);
        m4.compose(mid, quat, new THREE.Vector3(bondR, len, bondR));
        binst.setMatrixAt(n, m4);
      });
      binst.instanceMatrix.needsUpdate = true;
      content.add(binst);
    }

    // Highlighted Miller plane family, tiled into every cell of the block.
    // The same family is periodic, so each cell draws the same polygons
    // shifted by its origin; shared-face copies coincide exactly.
    if (state.hkl) {
      const [h, k, l] = state.hkl;
      const planes = C.millerPlanesInCell(sid, h, k, l);
      planeGroup = new THREE.Group();
      for (const off of cellOffsets) {
        for (const plane of planes) {
          const poly = plane.polygon;
          const geo = new THREE.BufferGeometry();
          const pos = [];
          const c0 = poly[0];
          for (let i = 1; i + 1 < poly.length; i++) {
            for (const p of [c0, poly[i], poly[i + 1]]) {
              const s3 = shift([p[0] + off[0], p[1] + off[1], p[2] + off[2]]);
              pos.push(s3[0], s3[1], s3[2]);
            }
          }
          geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
          geo.computeVertexNormals();
          const mat = new THREE.MeshBasicMaterial({
            color: PLANE_COLOR, transparent: true, opacity: 0.30,
            side: THREE.DoubleSide, depthWrite: false,
          });
          planeGroup.add(new THREE.Mesh(geo, mat));
          const loopPts = poly.map((p) => new THREE.Vector3(...shift([p[0] + off[0], p[1] + off[1], p[2] + off[2]])));
          loopPts.push(loopPts[0].clone());
          planeGroup.add(new THREE.Line(
            new THREE.BufferGeometry().setFromPoints(loopPts),
            new THREE.LineBasicMaterial({ color: PLANE_COLOR, transparent: true, opacity: 0.95 }),
          ));
        }
      }
      content.add(planeGroup);
    }
  }

  function buildReciprocalView() {
    disposeGroup(content);
    const sid = state.structure;
    const all = C.reciprocalPoints(sid, { maxIndex: 6 });
    const gMin = all.length ? all[0].len : 1;
    const shown = all.filter((p) => p.len <= 2.2 * gMin + 1e-9);

    // Reciprocal lattice points as small glowing spheres.
    const sphere = new THREE.SphereGeometry(1, 12, 8);
    const mat = new THREE.MeshStandardMaterial({
      color: 0x7fd0d8, roughness: 0.35, metalness: 0.1,
      emissive: 0x1c4a52, emissiveIntensity: 0.8,
    });
    const inst = new THREE.InstancedMesh(sphere, mat, Math.max(1, shown.length));
    const m4 = new THREE.Matrix4();
    const r = 0.055 * gMin;
    shown.forEach((p, i) => {
      m4.makeScale(r, r, r).setPosition(p.g[0], p.g[1], p.g[2]);
      inst.setMatrixAt(i, m4);
    });
    inst.instanceMatrix.needsUpdate = true;
    content.add(inst);

    // Reciprocal basis arrows.
    const B = C.primitiveReciprocal(sid);
    const cols = [0xe05a4e, 0x63c46b, 0x5a8ae0];
    B.forEach((b, i) => {
      const v = new THREE.Vector3(b[0], b[1], b[2]);
      const len = v.length();
      const arrow = new THREE.ArrowHelper(v.clone().normalize(), new THREE.Vector3(0, 0, 0),
        len * 1.15, cols[i], len * 0.14, len * 0.08);
      content.add(arrow);
    });

    // First Brillouin zone wireframe.
    const bz = C.brillouinZone(sid);
    const epos = [];
    for (const [a, b] of bz.edges) {
      epos.push(...bz.vertices[a], ...bz.vertices[b]);
    }
    const egeo = new THREE.BufferGeometry();
    egeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(epos), 3));
    content.add(new THREE.LineSegments(egeo,
      new THREE.LineBasicMaterial({ color: BZ_COLOR, transparent: true, opacity: 0.95 })));

    // Translucent BZ faces for depth.
    const fpos = [];
    for (const f of bz.faces) {
      const vs = f.verts.map((i) => bz.vertices[i]);
      for (let t = 1; t + 1 < vs.length; t++) fpos.push(...vs[0], ...vs[t], ...vs[t + 1]);
    }
    const fgeo = new THREE.BufferGeometry();
    fgeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(fpos), 3));
    content.add(new THREE.Mesh(fgeo, new THREE.MeshBasicMaterial({
      color: 0x4a3a20, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false,
    })));

    return bz;
  }

  /* ------------------------------ readouts -------------------------------- */

  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };

  function renderStructureCard() {
    const s = C.STRUCTURES[state.structure];
    const c = s.cell;
    set('lab-structure-name', s.name);
    set('lab-lattice', s.lattice + '  ' + s.spaceGroup);
    if (s.system === 'hexagonal') {
      set('lab-cell-param', `a ${c.a.toFixed(4)} \u00c5   c ${c.c.toFixed(4)} \u00c5`);
    } else {
      set('lab-cell-param', `a ${c.a.toFixed(4)} \u00c5`);
    }
    set('lab-cell-volume', C.cellVolume(state.structure).toFixed(4) + ' \u00c5\u00b3');
    set('lab-atoms', String(s.atoms.length));
    set('lab-coord', String(s.coordination));
    set('lab-nn', C.nearestNeighbor(state.structure).toFixed(4) + ' \u00c5');
    set('lab-apf', (C.packingFactor(state.structure) * 100).toFixed(2) + ' %');
    set('lab-density', C.theoreticalDensity(state.structure).toFixed(4) + ' g/cm\u00b3');
    set('lab-note', s.note);
  }

  function renderReciprocalCard(bz) {
    const B = C.primitiveReciprocal(state.structure);
    set('lab-bvec', B.map((b) => '(' + b.map((x) => x.toFixed(3)).join(', ') + ')').join(' '));
    set('lab-vprim', C.primitiveVolume(state.structure).toFixed(4) + ' \u00c5\u00b3');
    if (!bzCache) bzCache = bz || C.brillouinZone(state.structure);
    set('lab-bz', `${bzCache.faces.length} faces / ${bzCache.vertices.length} verts / ${bzCache.edges.length} edges`);
    set('lab-bzvol', bzCache.volume.toFixed(4) + ' \u00c5\u207b\u00b3');
  }

  /* ------------------------------- spectrum ------------------------------- */

  function drawSpectrum() {
    const pat = state.pattern;
    const ctx = spectrum.getContext('2d');
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = spectrum.clientWidth, h = spectrum.clientHeight;
    if (!w || !h) return;
    if (spectrum.width !== Math.round(w * dpr)) spectrum.width = Math.round(w * dpr);
    if (spectrum.height !== Math.round(h * dpr)) spectrum.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#15110d';
    ctx.fillRect(0, 0, w, h);
    const padL = 34, padR = 8, padT = 12, padB = 26;
    const x0 = padL, x1 = w - padR, y0 = padT, y1 = h - padB;
    const tMin = pat.twoThetaMin, tMax = pat.twoThetaMax;
    const xOf = (tt) => x0 + ((tt - tMin) / (tMax - tMin)) * (x1 - x0);
    const yOf = (I) => y1 - (I / 100) * (y1 - y0);
    ctx.strokeStyle = '#6b5a43';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, y1); ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.fillStyle = '#8d7c62';
    ctx.font = '10px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textAlign = 'center';
    for (let t = Math.ceil(tMin / 10) * 10; t <= tMax; t += 10) {
      const x = xOf(t);
      ctx.beginPath(); ctx.moveTo(x, y1); ctx.lineTo(x, y1 + 4); ctx.stroke();
      ctx.fillText(String(t), x, y1 + 15);
    }
    ctx.fillText('2theta (deg)', (x0 + x1) / 2, h - 4);
    ctx.save();
    ctx.translate(9, (y0 + y1) / 2); ctx.rotate(-Math.PI / 2);
    ctx.fillText('I rel', 0, 0);
    ctx.restore();
    // Sticks: one observed peak per coincident group.
    const groupSel = (g) => state.hkl && g.families.some(
      (p) => p.h === state.hkl[0] && p.k === state.hkl[1] && p.l === state.hkl[2]);
    pat.groups.forEach((g) => {
      const x = xOf(g.twoTheta), y = yOf(g.intensity);
      const sel = groupSel(g);
      ctx.strokeStyle = sel ? '#ffd57a' : '#d9a13b';
      ctx.lineWidth = sel ? 3 : 2;
      ctx.beginPath();
      ctx.moveTo(x, y1); ctx.lineTo(x, y);
      ctx.stroke();
      if (g.intensity >= 8 || sel) {
        ctx.beginPath();
        ctx.arc(x, y, sel ? 4 : 2.6, 0, TAU);
        ctx.fillStyle = sel ? '#ffd57a' : '#e8b85c';
        ctx.fill();
      }
    });
    spectrum.setAttribute('aria-label',
      `X-ray diffraction spectrum, ${pat.groups.length} peaks between ${tMin} and ${tMax} degrees two theta`);
  }

  function renderPeakTable() {
    const pat = state.pattern;
    // The rebuild would drop the focused row and reset the scroll box, so
    // both are captured now and restored after the new rows land.
    const keepScroll = peakTable.scrollTop;
    const focusHkl = peakTable.contains(document.activeElement)
      ? document.activeElement.dataset.hkl : null;
    peakTable.textContent = '';
    const frag = document.createDocumentFragment();
    pat.groups.forEach((g) => {
      const sel = state.hkl && g.families.some(
        (p) => p.h === state.hkl[0] && p.k === state.hkl[1] && p.l === state.hkl[2]);
      const fams = g.families.map((p) => `(${p.h} ${p.k} ${p.l})`).join(' + ');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'peak-row' + (sel ? ' sel' : '');
      b.dataset.hkl = `${g.families[0].h},${g.families[0].k},${g.families[0].l}`;
      b.innerHTML = `<span class="m">${fams}</span>` +
        `<span>${g.twoTheta.toFixed(2)}</span><span>${g.d.toFixed(3)}</span><span>${g.intensity.toFixed(1)}</span>`;
      b.addEventListener('click', () => selectHkl([g.families[0].h, g.families[0].k, g.families[0].l]));
      frag.appendChild(b);
    });
    peakTable.appendChild(frag);
    peakTable.scrollTop = keepScroll;
    if (focusHkl) {
      const back = peakTable.querySelector(`[data-hkl="${focusHkl}"]`);
      if (back) back.focus();
    }
  }

  function renderChip() {
    if (!state.hkl) {
      chip.textContent = 'Click a peak to highlight its Miller plane';
      chip.classList.remove('lit');
      return;
    }
    const g = state.pattern.groups.find((x) => x.families.some(
      (p) => p.h === state.hkl[0] && p.k === state.hkl[1] && p.l === state.hkl[2]));
    if (g) {
      const fams = g.families.map((p) => `(${p.h} ${p.k} ${p.l})`).join(' + ');
      chip.textContent = `${fams}   2\u03b8 ${g.twoTheta.toFixed(2)}\u00b0   d ${g.d.toFixed(4)} \u00c5   I ${g.intensity.toFixed(1)}   mult ${g.multiplicity}`;
      chip.classList.add('lit');
    }
  }

  /* ------------------------------ state apply ----------------------------- */

  let bzCache = null;

  function apply() {
    const s = C.STRUCTURES[state.structure];
    state.pattern = C.powderPattern(state.structure, {
      lambda: C.WAVELENGTHS[state.lambda].lambda, twoThetaMin: 5, twoThetaMax: 90,
    });
    if (state.hkl) {
      const [h, k, l] = state.hkl;
      const found = state.pattern.peaks.some((p) => p.h === h && p.k === k && p.l === l);
      if (!found) state.hkl = null;
    }
    bzCache = null;
    if (ensureRenderer()) {
      if (state.view === 'reciprocal') bzCache = buildReciprocalView();
      else buildDirectView();
    }
    renderStructureCard();
    renderReciprocalCard(bzCache);
    drawSpectrum();
    renderPeakTable();
    renderChip();
    updateHash();
    document.getElementById('lab-view-direct').setAttribute('aria-pressed', String(state.view === 'direct'));
    document.getElementById('lab-view-recip').setAttribute('aria-pressed', String(state.view === 'reciprocal'));
    document.getElementById('lab-cells').textContent = state.cells === 2 ? '2x2x2' : '1 cell';
    document.getElementById('lab-spin').setAttribute('aria-pressed', String(state.spin));
  }

  function selectHkl(hkl) {
    state.hkl = hkl;
    if (state.view !== 'direct') state.view = 'direct';
    apply();
    const p = state.pattern.peaks.find((x) => x.h === hkl[0] && x.k === hkl[1] && x.l === hkl[2]);
    if (p) toast(`Miller plane (${hkl.join(' ')}) highlighted on the crystal`);
  }

  function updateHash() {
    const frag = C.encodeLabHash({
      structure: state.open ? state.structure : null,
      lambda: state.open ? state.lambda : null,
      hkl: state.open ? state.hkl : null,
      seed: getSeed(),
    });
    const url = location.pathname + location.search + (frag ? '#' + frag : '');
    try { history.replaceState(null, '', url); } catch (_) { /* sandboxed iframe */ }
  }

  /* ------------------------------- exports -------------------------------- */

  function download(name, text, type) {
    const blob = new Blob([text], { type: type || 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1500);
  }

  function exportCif() {
    download(`lattelattice-${state.structure}.cif`, C.toCIF(state.structure), 'chemical/x-cif');
    toast('CIF exported (full conventional cell, standard format)');
  }
  function exportCsv() {
    download(`lattelattice-${state.structure}-xrd.csv`, C.xrdPeakCSV(state.pattern), 'text/csv');
    toast('Peak table CSV exported with SHA-256 fingerprint');
  }
  function exportJson() {
    download(`lattelattice-${state.structure}-audit.json`, C.xrdAuditJSON(state.structure, state.pattern), 'application/json');
    toast('XRD audit JSON exported');
  }
  async function copyLink() {
    const frag = C.encodeLabHash({ structure: state.structure, lambda: state.lambda, hkl: state.hkl, seed: getSeed() });
    const link = location.origin + location.pathname + location.search + '#' + frag;
    try {
      await navigator.clipboard.writeText(link);
      toast('Bookmark link copied');
    } catch (_) {
      toast('Link: ' + link);
    }
  }

  function runSelfTests() {
    const list = document.getElementById('lab-selftest-list');
    const out = C.runCrystalSelfTests();
    list.textContent = '';
    const frag = document.createDocumentFragment();
    for (const chk of out) {
      const li = document.createElement('li');
      li.className = chk.pass ? 'ok' : 'bad';
      li.innerHTML = `<b>${chk.pass ? 'PASS' : 'FAIL'}</b> ${chk.name}${chk.detail ? '  <i>' + chk.detail + '</i>' : ''}`;
      frag.appendChild(li);
    }
    list.appendChild(frag);
    const n = out.filter((x) => x.pass).length;
    document.getElementById('lab-selftest-count').textContent = `${n} / ${out.length} checks passed`;
    toast(n === out.length ? 'All self-tests passed' : `${out.length - n} self-test(s) failed`);
  }

  /* ------------------------------ open / close ---------------------------- */

  // Every sibling outside the dialog goes inert while it is open, which keeps
  // Tab order and pointer events inside the lab without a manual trap.
  const inertables = [...overlay.parentElement.children].filter(
    (el) => el !== overlay && el.id !== 'toast' && el.tagName !== 'SCRIPT');

  let rafId = 0;
  let lastT = 0;

  function frame(t) {
    if (!state.open || !renderer || !labCamera) { rafId = 0; return; }
    rafId = requestAnimationFrame(frame);
    const dt = clamp((t - lastT) / 1000 || 0, 0, 0.06);
    lastT = t;
    if (!state.dragging && state.spin) state.keys.dragYaw = 0.22 * dt;
    state.cam = stepCamera(state.cam, state.keys, dt);
    state.keys.dragYaw = 0; state.keys.dragPitch = 0; state.keys.dolly = 0;
    const p = orbitToCartesian(state.cam.yaw, state.cam.pitch, state.cam.radius, state.cam.target);
    labCamera.position.set(p[0], p[1], p[2]);
    labCamera.lookAt(state.cam.target[0], state.cam.target[1], state.cam.target[2]);
    if (renderer && labScene) renderer.render(labScene, labCamera);
  }

  function sizeLab() {
    if (!renderer || !labCamera) return;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    labCamera.aspect = w / h;
    labCamera.updateProjectionMatrix();
    renderer.setSize(w, h, false);
    drawSpectrum();
  }

  function open(preselect) {
    if (state.open) return;
    state.open = true;
    state.lastFocus = document.activeElement;
    overlay.hidden = false;
    document.body.classList.add('lab-open');
    inertables.forEach((el) => { el.inert = true; });
    if (preselect) {
      if (preselect.structure) state.structure = preselect.structure;
      if (preselect.lambda) state.lambda = preselect.lambda;
      if (preselect.hkl) state.hkl = preselect.hkl;
    }
    const sel = document.getElementById('lab-structure');
    if (sel) sel.value = state.structure;
    const wl = document.getElementById('lab-lambda');
    if (wl) wl.value = state.lambda;
    if (!ensureRenderer()) toast('3D crystal view unavailable in this browser');
    apply();
    requestAnimationFrame(() => { if (!state.open) return; sizeLab(); lastT = performance.now(); rafId = requestAnimationFrame(frame); });
    const closeBtn = document.getElementById('btn-lab-close');
    if (closeBtn) closeBtn.focus();
    updateHash();
  }

  function close() {
    if (!state.open) return;
    state.open = false;
    overlay.hidden = true;
    document.body.classList.remove('lab-open');
    inertables.forEach((el) => { el.inert = false; });
    cancelAnimationFrame(rafId);
    updateHash();
    if (state.lastFocus && state.lastFocus.focus) state.lastFocus.focus();
  }

  /* -------------------------------- events -------------------------------- */

  document.getElementById('btn-lab-close').addEventListener('click', close);
  overlay.addEventListener('pointerdown', (e) => {
    if (e.target === overlay) close();
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.open) {
      close();
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  document.getElementById('lab-structure').addEventListener('change', (e) => {
    state.structure = e.target.value;
    state.hkl = null;
    apply();
    toast('Crystal: ' + C.STRUCTURES[state.structure].name);
  });
  document.getElementById('lab-lambda').addEventListener('change', (e) => {
    state.lambda = e.target.value;
    apply();
    toast('Radiation: ' + C.WAVELENGTHS[state.lambda].label);
  });
  document.getElementById('lab-view-direct').addEventListener('click', () => {
    state.view = 'direct'; apply();
  });
  document.getElementById('lab-view-recip').addEventListener('click', () => {
    state.view = 'reciprocal'; apply();
    toast('Reciprocal lattice and first Brillouin zone');
  });
  document.getElementById('lab-cells').addEventListener('click', () => {
    state.cells = state.cells === 2 ? 1 : 2;
    apply();
  });
  document.getElementById('lab-spin').addEventListener('click', () => {
    state.spin = !state.spin;
    document.getElementById('lab-spin').setAttribute('aria-pressed', String(state.spin));
  });
  document.getElementById('lab-export-cif').addEventListener('click', exportCif);
  document.getElementById('lab-export-csv').addEventListener('click', exportCsv);
  document.getElementById('lab-export-json').addEventListener('click', exportJson);
  document.getElementById('lab-copy-link').addEventListener('click', copyLink);
  document.getElementById('lab-selftest').addEventListener('click', runSelfTests);

  // Spectrum click -> nearest stick within tolerance -> Miller plane highlight.
  spectrum.addEventListener('pointerdown', (e) => {
    const rect = spectrum.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const w = rect.width;
    const pat = state.pattern;
    const padL = 34, padR = 8;
    const tMin = pat.twoThetaMin, tMax = pat.twoThetaMax;
    let best = null, bestDist = Infinity;
    for (const g of pat.groups) {
      const px = padL + ((g.twoTheta - tMin) / (tMax - tMin)) * (w - padL - padR);
      const d = Math.abs(px - x);
      if (d < bestDist) { bestDist = d; best = g; }
    }
    if (best && bestDist <= 12) {
      const f = best.families[0];
      selectHkl([f.h, f.k, f.l]);
    } else { state.hkl = null; apply(); }
  });

  // Lab viewport orbit: drag rotates, wheel dollies.
  canvas.addEventListener('pointerdown', (e) => {
    state.dragging = true;
    state.lastX = e.clientX; state.lastY = e.clientY;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* released */ }
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!state.dragging) return;
    state.keys.dragYaw = -(e.clientX - state.lastX) * 0.006;
    state.keys.dragPitch = -(e.clientY - state.lastY) * 0.006;
    state.lastX = e.clientX; state.lastY = e.clientY;
  });
  const endLabDrag = () => { state.dragging = false; };
  canvas.addEventListener('pointerup', endLabDrag);
  canvas.addEventListener('pointercancel', endLabDrag);
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    state.keys.dolly = (state.keys.dolly || 0) + px * 0.014;
  }, { passive: false });
  window.addEventListener('resize', () => { if (state.open) sizeLab(); });

  /* ------------------------------ boot restore ---------------------------- */

  const restored = C.decodeLabHash(location.hash);
  if (restored.seed !== null && restored.seed !== undefined) onSeed(restored.seed);
  if (restored.structure) {
    requestAnimationFrame(() => open(restored));
  }

  return {
    open: (p) => open(p || {}),
    close,
    isOpen: () => state.open,
    selectHkl,
    noteSeed: updateHash,
    state,
    apply,
  };
}
