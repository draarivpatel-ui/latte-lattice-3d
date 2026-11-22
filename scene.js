/*
 * LatteLattice 3D - WebGL renderer and interaction layer.
 *
 * All geometry math, kinematics, the latte-art field, camera state and the
 * OBJ/STL exporters live in engine.js (pure, deterministic, unit-tested).
 * This file wires those modules into a Three.js scene and the DOM controls.
 *
 * Rules honored here:
 *  - No audio is created, loaded or played until the user clicks the explicit
 *    "Sound" button. Zero autoplay. Default state is strictly muted.
 *  - All 3D geometry, lighting, camera controls and shaders are real.
 */

import * as THREE from './vendor/three.module.min.js';
import {
  TAU, buildBox, buildTorus, buildCrystal, buildLathe, buildScenePlan,
  gearOutline, planetaryState, steamParticles, latteField, mixColor,
  CREMA, FOAM, orbitToCartesian, stepCamera, lightingPreset,
  mergeMeshes, toOBJ, toSTL, makeRng, vecNormalize,
  computeTelemetry, patternSignature,
  CUP_PROFILE, crystalWorldOffset, buildExportMeshes,
} from './engine.js';
import { initCrystalLab } from './lab.js';

/* -------------------------------------------------------------------------- */
/* Boot                                                                       */
/* -------------------------------------------------------------------------- */

const canvas = document.getElementById('scene');
const loadingEl = document.getElementById('loading');

let renderer;
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false, powerPreference: 'high-performance' });
} catch (err) {
  failGracefully(err);
  throw err;
}
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.setSize(window.innerWidth, window.innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0.94, 0.88, 0.78);
scene.fog = new THREE.FogExp2(0xefe0c8, 0.012);

const camera = new THREE.PerspectiveCamera(48, window.innerWidth / window.innerHeight, 0.1, 200);

const clock = new THREE.Clock();
const root = new THREE.Group();
scene.add(root);

function failGracefully(err) {
  if (loadingEl) {
    loadingEl.innerHTML = '<p>WebGL is unavailable in this browser.</p>';
  }
  console.error('[LatteLattice] init failed', err);
}

/* -------------------------------------------------------------------------- */
/* Helpers to turn engine meshes into Three.js BufferGeometry                  */
/* -------------------------------------------------------------------------- */

function engineMeshToGeometry(mesh, { vertexColors } = {}) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array(mesh.vertexCount * 3);
  const nor = new Float32Array(mesh.vertexCount * 3);
  for (let i = 0; i < mesh.vertexCount; i++) {
    const p = mesh.positions[i], n = mesh.normals[i];
    pos[i * 3] = p[0]; pos[i * 3 + 1] = p[1]; pos[i * 3 + 2] = p[2];
    nor[i * 3] = n[0]; nor[i * 3 + 1] = n[1]; nor[i * 3 + 2] = n[2];
  }
  const idx = [];
  for (const t of mesh.triangles) idx.push(t[0], t[1], t[2]);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial(Object.assign({
    color, roughness: 0.65, metalness: 0.05,
  }, opts));
}

/* -------------------------------------------------------------------------- */
/* Lighting (day / night driven by engine.lightingPreset)                     */
/* -------------------------------------------------------------------------- */

const ambient = new THREE.AmbientLight(0xffffff, 0.85);
scene.add(ambient);
const hemi = new THREE.HemisphereLight(0xcfe0ff, 0x503422, 0.5);
scene.add(hemi);

const keyLight = new THREE.DirectionalLight(0xfff1dc, 1.15);
keyLight.position.set(6, 10, 7);
keyLight.castShadow = true;
keyLight.shadow.mapSize.set(2048, 2048);
keyLight.shadow.camera.left = -12; keyLight.shadow.camera.right = 12;
keyLight.shadow.camera.top = 12; keyLight.shadow.camera.bottom = -12;
keyLight.shadow.camera.near = 0.5; keyLight.shadow.camera.far = 40;
keyLight.shadow.bias = -0.0004;
scene.add(keyLight);

const warmLight = new THREE.PointLight(0xff9a3c, 0.35, 30, 2);
warmLight.position.set(-3.5, 3.2, -2.5);
scene.add(warmLight);

const lampGlowMats = [];
const lampLights = [];
function registerLampGlow(material) { lampGlowMats.push(material); }

function applyLighting(mode) {
  const p = lightingPreset(mode);
  ambient.intensity = p.ambient;
  hemi.intensity = 0.25 + p.ambient * 0.4;
  keyLight.intensity = p.key;
  warmLight.intensity = p.warm;
  renderer.toneMappingExposure = p.exposure;
  const bg = new THREE.Color(p.background[0], p.background[1], p.background[2]);
  scene.background = bg;
  scene.fog.color = bg;
  scene.fog.density = p.fog;
  const sky = new THREE.Color(p.sky[0], p.sky[1], p.sky[2]);
  hemi.color = sky;
  for (const m of lampGlowMats) {
    m.emissiveIntensity = lerpLocal(0.25, 2.2, mode);
  }
}
function lerpLocal(a, b, t) { return a + (b - a) * t; }

/* -------------------------------------------------------------------------- */
/* Cafe room: floor, back wall, shelves, hanging lamps, plants                */
/* -------------------------------------------------------------------------- */

const room = new THREE.Group();
root.add(room);

// Floor
const floorGeo = new THREE.PlaneGeometry(60, 60);
const floorMat = mat(0x6b4a32, { roughness: 0.9, metalness: 0.0 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
floor.receiveShadow = true;
room.add(floor);

// Floor tile grid (thin lines for a cozy tiled cafe)
const tileMat = new THREE.LineBasicMaterial({ color: 0x3a2517, transparent: true, opacity: 0.28 });
const tilePts = [];
for (let i = -12; i <= 12; i += 2) {
  tilePts.push(new THREE.Vector3(i, 0.012, -12), new THREE.Vector3(i, 0.012, 12));
  tilePts.push(new THREE.Vector3(-12, 0.012, i), new THREE.Vector3(12, 0.012, i));
}
const tileGeo = new THREE.BufferGeometry().setFromPoints(tilePts);
room.add(new THREE.LineSegments(tileGeo, tileMat));

// Back wall
const wallMat = mat(0x8a6a4c, { roughness: 0.95 });
const wall = new THREE.Mesh(new THREE.PlaneGeometry(40, 16), wallMat);
wall.position.set(0, 8, -9);
wall.receiveShadow = true;
room.add(wall);

// Wainscoting band
const band = new THREE.Mesh(new THREE.BoxGeometry(40, 0.5, 0.2), mat(0x4f2a0e, { roughness: 0.8 }));
band.position.set(0, 1.4, -8.85);
room.add(band);

// Shelves with cups
const shelfMat = mat(0x4a2f1c, { roughness: 0.8 });
const cupColors = [0xe8d5b7, 0xc98a5a, 0x9fb7a4, 0xd7a1a1, 0xe8d5b7, 0xb9753f];
for (let s = 0; s < 2; s++) {
  const y = 3.4 + s * 2.4;
  const shelf = new THREE.Mesh(new THREE.BoxGeometry(11, 0.18, 1.1), shelfMat);
  shelf.position.set(-4.6, y, -8.3);
  shelf.castShadow = true;
  room.add(shelf);
  for (let c = 0; c < 6; c++) {
    const cupGeo = new THREE.CylinderGeometry(0.22, 0.17, 0.42, 16, 1, true);
    const cup = new THREE.Mesh(cupGeo, mat(cupColors[(c + s) % cupColors.length], { side: THREE.DoubleSide, roughness: 0.6 }));
    cup.position.set(-9.2 + c * 1.85, y + 0.3, -8.25);
    cup.castShadow = true;
    room.add(cup);
    const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.05, 16), mat(0xf0e2cc));
    saucer.position.set(cup.position.x, y + 0.11, -8.25);
    room.add(saucer);
  }
}

// Hanging pendant lamps (warm glow at night)
const lampShadeMat = mat(0x2e2018, { roughness: 0.5, metalness: 0.35 });
const lampBulbMat = new THREE.MeshStandardMaterial({
  color: 0xffb45c, emissive: 0xff8a2b, emissiveIntensity: 0.25, roughness: 0.4,
});
registerLampGlow(lampBulbMat);
const lampPositions = [[-3.5, 5.2, -1.5], [3.5, 5.2, -1.5], [0, 5.6, 3.2]];
for (const lp of lampPositions) {
  const cord = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 2.2, 8), mat(0x1a1410));
  cord.position.set(lp[0], lp[1] + 1.1, lp[2]);
  room.add(cord);
  const shade = new THREE.Mesh(new THREE.ConeGeometry(0.62, 0.6, 24, 1, true), lampShadeMat);
  shade.position.set(lp[0], lp[1], lp[2]);
  shade.material.side = THREE.DoubleSide;
  room.add(shade);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), lampBulbMat);
  bulb.position.set(lp[0], lp[1] - 0.22, lp[2]);
  room.add(bulb);
  const pl = new THREE.PointLight(0xffa14a, 0.0, 9, 2);
  pl.position.set(lp[0], lp[1] - 0.3, lp[2]);
  pl.userData.lamp = true;
  room.add(pl);
  lampLights.push(pl);
}

// Small potted plant (procedural)
function makePlant(x, z) {
  const g = new THREE.Group();
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.32, 0.6, 14), mat(0xb5603a));
  pot.position.y = 0.3; pot.castShadow = true;
  g.add(pot);
  const rng = makeRng(Math.floor(x * 100 + z * 10) + 900);
  const leafMat = mat(0x3f7042, { roughness: 0.85, side: THREE.DoubleSide });
  for (let i = 0; i < 9; i++) {
    const leaf = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.9 + rng() * 0.7, 5), leafMat);
    const a = (i / 9) * TAU;
    leaf.position.set(Math.cos(a) * 0.22, 0.9 + rng() * 0.3, Math.sin(a) * 0.22);
    leaf.rotation.z = Math.cos(a) * 0.5;
    leaf.rotation.x = Math.sin(a) * 0.5;
    g.add(leaf);
  }
  g.position.set(x, 0, z);
  return g;
}
room.add(makePlant(-6.5, 2.5), makePlant(6.5, 2.5));

/* -------------------------------------------------------------------------- */
/* Central counter + espresso machine                                         */
/* -------------------------------------------------------------------------- */

const counter = new THREE.Group();
root.add(counter);

const counterTop = new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.32, 3.4), mat(0x3a2417, { roughness: 0.45, metalness: 0.1 }));
counterTop.position.y = 1.55;
counterTop.castShadow = true; counterTop.receiveShadow = true;
counter.add(counterTop);
const counterBody = new THREE.Mesh(new THREE.BoxGeometry(7.0, 1.5, 3.2), mat(0x5a3a24, { roughness: 0.8 }));
counterBody.position.y = 0.75;
counterBody.castShadow = true; counterBody.receiveShadow = true;
counter.add(counterBody);
// Counter front panels
for (let i = -2; i <= 2; i++) {
  const panel = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.15, 0.06), mat(0x4a2f1c, { roughness: 0.85 }));
  panel.position.set(i * 1.35, 0.78, 1.63);
  counter.add(panel);
}

// --- Espresso machine body (built from engine buildBox where practical) ---
const machine = new THREE.Group();
machine.position.set(-1.9, 1.72, 0);
counter.add(machine);

const chromeMat = mat(0xd9dde2, { roughness: 0.22, metalness: 0.85 });
const darkMat = mat(0x24262b, { roughness: 0.4, metalness: 0.6 });
const brassMat = mat(0xc9963f, { roughness: 0.3, metalness: 0.8 });

const machineBody = new THREE.Mesh(engineMeshToGeometry(buildBox(2.0, 1.5, 1.4)), chromeMat);
machineBody.position.y = 0.75;
machineBody.castShadow = true; machineBody.receiveShadow = true;
machine.add(machineBody);

const machineTop = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.16, 1.5), darkMat);
machineTop.position.y = 1.56;
machineTop.castShadow = true;
machine.add(machineTop);

// Front face plate with dials
const face = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.9, 0.05), darkMat);
face.position.set(0, 0.95, 0.72);
machine.add(face);
for (let i = 0; i < 2; i++) {
  const dial = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.06, 20), brassMat);
  dial.rotation.x = Math.PI / 2;
  dial.position.set(-0.45 + i * 0.9, 1.05, 0.77);
  machine.add(dial);
}
// Pressure gauge
const gauge = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 24), mat(0xf0e6d2, { roughness: 0.5 }));
gauge.rotation.x = Math.PI / 2;
gauge.position.set(0, 1.05, 0.78);
machine.add(gauge);
const needle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.14, 0.01), mat(0xb83b2b));
needle.position.set(0, 1.1, 0.81);
machine.add(needle);

// Group head + portafilter
const groupHead = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.28, 0.25, 20), chromeMat);
groupHead.position.set(0, 0.42, 0.62);
groupHead.castShadow = true;
machine.add(groupHead);
const portafilter = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.18, 0.18, 20), darkMat);
portafilter.position.set(0, 0.26, 0.62);
machine.add(portafilter);
const pfHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.7, 12), mat(0x1a1410));
pfHandle.rotation.z = Math.PI / 2;
pfHandle.position.set(0.5, 0.26, 0.62);
machine.add(pfHandle);

// Two espresso drips (small animated cylinders)
const dripMat = mat(0x5a3418, { roughness: 0.4 });
const drips = [];
for (let i = 0; i < 2; i++) {
  const d = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 0.3, 8), dripMat);
  d.position.set(-0.08 + i * 0.16, 0.0, 0.62);
  machine.add(d);
  drips.push(d);
}

// Steam wand + RED CLICKABLE VALVE
const wand = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.9, 12), chromeMat);
wand.position.set(0.95, 0.5, 0.5);
wand.rotation.z = -0.35;
wand.castShadow = true;
machine.add(wand);

const valveGroup = new THREE.Group();
valveGroup.position.set(1.02, 1.12, 0.5);
machine.add(valveGroup);
const valveMat = new THREE.MeshStandardMaterial({
  color: 0xc43b2b, emissive: 0x7a140c, emissiveIntensity: 0.35, roughness: 0.4, metalness: 0.2,
});
const valve = new THREE.Mesh(new THREE.TorusGeometry(0.19, 0.07, 12, 28), valveMat);
valve.rotation.x = Math.PI / 2;
valve.castShadow = true;
valveGroup.add(valve);
const valveHub = new THREE.Mesh(new THREE.SphereGeometry(0.1, 16, 12), valveMat);
valveGroup.add(valveHub);
const valveStem = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.24, 10), chromeMat);
valveGroup.add(valveStem);
// Make the whole valve group clickable.
valveGroup.traverse((o) => { if (o.isMesh) o.userData.clickable = 'valve'; });

// Steam particles (procedural, engine-driven)
const steamCount = 48;
const steamGeo = new THREE.BufferGeometry();
const steamPos = new Float32Array(steamCount * 3);
steamGeo.setAttribute('position', new THREE.BufferAttribute(steamPos, 3));
const steamMat = new THREE.PointsMaterial({
  color: 0xfbf3e6, size: 0.18, transparent: true, opacity: 0.0,
  depthWrite: false, sizeAttenuation: true, blending: THREE.NormalBlending,
});
const steamPoints = new THREE.Points(steamGeo, steamMat);
steamPoints.position.set(0.95, -0.02, 0.5); // relative to machine group
steamPoints.frustumCulled = false;
machine.add(steamPoints);

/* -------------------------------------------------------------------------- */
/* Planetary gear grinder (rotating, engine kinematics)                       */
/* -------------------------------------------------------------------------- */

const grinder = new THREE.Group();
grinder.position.set(2.0, 1.72, 0);
counter.add(grinder);

const grinderBase = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.25, 32), darkMat);
grinderBase.position.y = 0.12;
grinderBase.castShadow = true;
grinder.add(grinderBase);
const hopper = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.95, 1.2, 24, 1, true), new THREE.MeshStandardMaterial({
  color: 0x8aa0b4, transparent: true, opacity: 0.35, roughness: 0.15, metalness: 0.1, side: THREE.DoubleSide,
}));
hopper.position.y = 1.15;
grinder.add(hopper);
const hopperLid = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.58, 0.08, 24), darkMat);
hopperLid.position.y = 1.78;
grinder.add(hopperLid);

// Gear train, built from the procedural gear outline via extruded shape.
const gearMat = mat(0xc07b3a, { roughness: 0.4, metalness: 0.55 });
const PLAN = buildScenePlan(2026);
const grinderCfg = PLAN.grinder;

function makeGearMesh(teeth, rootR, tipR, seed, thickness) {
  const outline = gearOutline(teeth, rootR, tipR, seed);
  const shape = new THREE.Shape();
  shape.moveTo(outline[0][0], outline[0][1]);
  for (let i = 1; i < outline.length; i++) shape.lineTo(outline[i][0], outline[i][1]);
  shape.closePath();
  const hole = new THREE.Path();
  hole.absarc(0, 0, rootR * 0.28, 0, TAU, true);
  shape.holes.push(hole);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, bevelEnabled: true, bevelSize: 0.02, bevelThickness: 0.02, bevelSegments: 1 });
  geo.rotateX(-Math.PI / 2); // extrude along +Y, lie flat in XZ
  geo.translate(0, thickness / 2, 0);
  return new THREE.Mesh(geo, gearMat);
}

const sunGear = makeGearMesh(grinderCfg.sunTeeth, 0.72, 0.9, 11, 0.16);
sunGear.position.y = 0.42;
sunGear.castShadow = true;
grinder.add(sunGear);
const planetGears = [];
for (let i = 0; i < grinderCfg.planets; i++) {
  const pg = makeGearMesh(grinderCfg.planetTeeth, 0.42, 0.56, 21 + i, 0.14);
  pg.position.y = 0.42;
  pg.castShadow = true;
  grinder.add(pg);
  planetGears.push(pg);
}
// Stationary ring (visual)
const ringGear = new THREE.Mesh(new THREE.TorusGeometry(1.32, 0.09, 12, 48), darkMat);
ringGear.rotation.x = Math.PI / 2;
ringGear.position.y = 0.42;
grinder.add(ringGear);
// Coffee beans in hopper (little instanced-ish spheres)
const beanMat = mat(0x4a2a16, { roughness: 0.7 });
const beans = [];
for (let i = 0; i < 14; i++) {
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.09, 8, 6), beanMat);
  b.scale.set(1, 0.7, 0.7);
  const rng = makeRng(300 + i);
  b.position.set((rng() - 0.5) * 0.8, 0.75 + rng() * 0.7, (rng() - 0.5) * 0.8);
  grinder.add(b);
  beans.push(b);
}

/* -------------------------------------------------------------------------- */
/* Latte cup + procedural latte-art fluid surface simulation                  */
/* -------------------------------------------------------------------------- */

const latteStation = new THREE.Group();
latteStation.position.set(0, 1.72, 1.0);
counter.add(latteStation);

// Cup: lathe from a 2D profile (uses engine buildLathe + a Three.Cylinder for glaze)
const cupProfile = CUP_PROFILE;
const cupMesh = new THREE.Mesh(engineMeshToGeometry(buildLathe(cupProfile, 48)), mat(0xf2e7d3, { roughness: 0.35, side: THREE.DoubleSide }));
cupMesh.castShadow = true; cupMesh.receiveShadow = true;
latteStation.add(cupMesh);
const cupHandle = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.075, 12, 24, Math.PI * 1.3), mat(0xf2e7d3, { roughness: 0.35 }));
cupHandle.position.set(0.72, 0.5, 0);
cupHandle.rotation.z = -Math.PI / 2.6;
latteStation.add(cupHandle);
const saucer = new THREE.Mesh(new THREE.CylinderGeometry(0.95, 0.95, 0.06, 40), mat(0xe9dcc4, { roughness: 0.4 }));
saucer.position.y = -0.02;
latteStation.add(saucer);

// Fluid surface: a subdivided disk whose vertices are displaced + color-painted
// by engine.latteField every frame. This is the "latte-art fluid simulation".
// The cup interior tops out at r = 0.64; the fluid sheet must never reach the
// wall. A 0.60 radius keeps the displaced edge fully inside the ceramic.
const FLUID_R = 0.60;
const SURF_SEGS = 64;
const surfGeo = new THREE.PlaneGeometry(FLUID_R * 2, FLUID_R * 2, SURF_SEGS, SURF_SEGS);
surfGeo.rotateX(-Math.PI / 2); // lie in XZ
const surfColors = new Float32Array((SURF_SEGS + 1) * (SURF_SEGS + 1) * 3);
surfGeo.setAttribute('color', new THREE.BufferAttribute(surfColors, 3));
const surfMat = new THREE.MeshStandardMaterial({
  vertexColors: true, roughness: 0.32, metalness: 0.0,
  side: THREE.DoubleSide, emissive: 0x1a0e06, emissiveIntensity: 0.15,
});
const fluidSurface = new THREE.Mesh(surfGeo, surfMat);
fluidSurface.position.y = 0.86;
fluidSurface.receiveShadow = true;
latteStation.add(fluidSurface);

// Precompute which grid vertices are inside the fluid disk for the round cup,
// and drop every triangle that touches the outside of the disk. The leftover
// square corners would otherwise render as a plate crossing the cup wall.
const surfBasePos = surfGeo.attributes.position.array.slice();
const surfMask = new Float32Array((SURF_SEGS + 1) * (SURF_SEGS + 1));
for (let i = 0; i <= SURF_SEGS; i++) {
  for (let j = 0; j <= SURF_SEGS; j++) {
    const idx = i * (SURF_SEGS + 1) + j;
    const x = surfBasePos[idx * 3], z = surfBasePos[idx * 3 + 2];
    surfMask[idx] = (x * x + z * z <= FLUID_R * FLUID_R) ? 1 : 0;
  }
}
{
  const keep = [];
  const src = surfGeo.index.array;
  const inside = (v) => surfMask[v] === 1;
  for (let t = 0; t < src.length; t += 3) {
    if (inside(src[t]) && inside(src[t + 1]) && inside(src[t + 2])) keep.push(src[t], src[t + 1], src[t + 2]);
  }
  surfGeo.setIndex(keep);
}

function updateFluid(t) {
  const pos = surfGeo.attributes.position.array;
  const col = surfGeo.attributes.color.array;
  const tt = latteAnimate ? t : 0;
  for (let i = 0; i <= SURF_SEGS; i++) {
    for (let j = 0; j <= SURF_SEGS; j++) {
      const idx = i * (SURF_SEGS + 1) + j;
      const x = surfBasePos[idx * 3], z = surfBasePos[idx * 3 + 2];
      const f = latteField(x / FLUID_R, z / FLUID_R, tt, lattePattern);
      pos[idx * 3 + 1] = f.height;
      const c = mixColor(CREMA, FOAM, f.mix);
      // Outside the cup: transparent-looking dark crema edge.
      const c2 = surfMask[idx] ? c : CREMA;
      col[idx * 3] = c2[0]; col[idx * 3 + 1] = c2[1]; col[idx * 3 + 2] = c2[2];
    }
  }
  surfGeo.attributes.position.needsUpdate = true;
  surfGeo.attributes.color.needsUpdate = true;
  surfGeo.computeVertexNormals();
}

/* -------------------------------------------------------------------------- */
/* Procedural crystal garden (custom shader material + engine geometry)       */
/* -------------------------------------------------------------------------- */

// A custom ShaderMaterial for crystals with fresnel rim + animated bands.
// This satisfies "custom 3D geometry / lighting / shaders" explicitly.
const crystalVertex = `
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vHeight;
  uniform float uTime;
  void main() {
    vHeight = position.y;
    vec3 p = position;
    // subtle breathing of the crystal body
    p.xz *= 1.0 + 0.012 * sin(uTime * 1.5 + position.y * 3.0);
    vec4 world = modelMatrix * vec4(p, 1.0);
    vPosW = world.xyz;
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * viewMatrix * world;
  }
`;
const crystalFragment = `
  precision highp float;
  varying vec3 vNormalW;
  varying vec3 vPosW;
  varying float vHeight;
  uniform float uTime;
  uniform vec3 uColorA;
  uniform vec3 uColorB;
  uniform vec3 uCamera;
  uniform float uGlow;
  void main() {
    vec3 V = normalize(uCamera - vPosW);
    float fres = pow(1.0 - max(dot(normalize(vNormalW), V), 0.0), 2.2);
    float bands = 0.5 + 0.5 * sin(vHeight * 9.0 - uTime * 0.8);
    vec3 base = mix(uColorA, uColorB, bands * 0.6 + fres * 0.4);
    float rim = fres * (0.5 + 0.5 * sin(uTime * 1.2 + vHeight * 4.0));
    vec3 col = base + rim * uGlow * vec3(0.9, 0.7, 0.5);
    col += 0.06 * sin(uTime * 0.6);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const crystalGroup = new THREE.Group();
crystalGroup.position.set(0, 1.72, -3.4); // behind the counter on a raised ledge
root.add(crystalGroup);
const ledge = new THREE.Mesh(new THREE.BoxGeometry(7.5, 0.3, 1.6), mat(0x3a2417, { roughness: 0.7 }));
ledge.position.set(0, 1.57, -3.4);
ledge.castShadow = true;
root.add(ledge);

let crystalMeshes = [];
const crystalUniformsList = [];

/* Scene diagnostic state. Declared before the first buildCrystals call so the
 * function never reads a binding in its temporal dead zone. */
let valveOpen = false;
let steamEnergy = 0;
let lattePattern = 'rosetta';
let latteAnimate = true;
let grindSpeed = 0.6;
let nightBlend = 0;
let nightTarget = 0;
let crystalSeed = 2026;
let latestTelemetry = null;
let frameCount = 0;
let performanceElapsedMs = 0;
let paused = false;

function buildCrystals(seed) {
  // Dispose old
  for (const m of crystalMeshes) {
    crystalGroup.remove(m);
    m.geometry.dispose();
    m.material.dispose();
  }
  crystalMeshes = [];
  crystalUniformsList.length = 0;
  const plan = buildScenePlan(seed);
  const palette = [
    [0x5a3a8a, 0xb98ad6], [0x2a6a7a, 0x7fd0d8], [0x8a4a3a, 0xe0a06a],
    [0x3a5a8a, 0x8ab0e0], [0x6a3a6a, 0xd08ac0], [0x3a7a5a, 0x90d0a0],
    [0x8a6a2a, 0xe0c878],
  ];
  plan.crystals.forEach((c, i) => {
    const mesh = buildCrystal({
      sides: c.sides, seed: c.seed, height: c.height, radius: c.radius,
      twist: c.twist, uSegs: c.sides * 2, vSegs: 10, cap: true,
    });
    const [a, b] = palette[i % palette.length];
    const uniforms = {
      uTime: { value: 0 },
      uColorA: { value: new THREE.Color(a) },
      uColorB: { value: new THREE.Color(b) },
      uCamera: { value: new THREE.Vector3() },
      uGlow: { value: 0.8 },
    };
    const material = new THREE.ShaderMaterial({
      vertexShader: crystalVertex,
      fragmentShader: crystalFragment,
      uniforms,
    });
    const obj = new THREE.Mesh(engineMeshToGeometry(mesh), material);
    const off = crystalWorldOffset(c);
    obj.position.set(off[0], off[1] - 1.72, off[2] + 3.4);
    obj.userData.baseY = obj.position.y;
    obj.userData.phase = c.phase;
    obj.userData.spin = c.spin;
    obj.castShadow = false; // custom shader; skip shadow to keep it cheap
    crystalGroup.add(obj);
    crystalMeshes.push(obj);
    crystalUniformsList.push(uniforms);
  });
  const meshCountEl = document.getElementById('mesh-count');
  const vertices = crystalMeshes.reduce((n, m) => n + m.geometry.attributes.position.count, 0);
  const triangles = crystalMeshes.reduce((n, m) => n + m.geometry.index.count / 3, 0);
  document.getElementById('facet-count').textContent = String(triangles);
  if (meshCountEl) {
    meshCountEl.textContent = `${vertices} / ${triangles}`;
  }
  latestTelemetry = computeTelemetry({
    seed, valveOpen, pressureBar: steamEnergy * 1.35, pattern: lattePattern,
    grindSpeed, nightBlend, frameCount, elapsedMs: performanceElapsedMs,
  });
  renderTelemetry();
}
function renderTelemetry() {
  const t = latestTelemetry;
  if (!t) return;
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set('fps', t.fps.toFixed(1) + ' fps');
  set('surface-area', t.surfaceArea.toFixed(6));
  set('volume', t.volume.toFixed(6));
  set('gear-ratio', `${t.toothRatio.toFixed(2)} / ${t.ringTeeth}`);
  set('foam-mix', t.meanFoamMix.toFixed(6));
  set('field-signature', String(patternSignature(lattePattern, 0, 12)));
  set('degenerate-facets', String(t.degenerateTriangles));
}
buildCrystals(2026);

/* -------------------------------------------------------------------------- */
/* Steam physics state + interaction                                          */
/* -------------------------------------------------------------------------- */

function setValve(open) {
  valveOpen = open;
  const btn = document.getElementById('btn-steam');
  btn.setAttribute('aria-pressed', String(open));
  btn.textContent = open ? 'Close steam valve' : 'Open steam valve';
  valveMat.emissiveIntensity = open ? 1.6 : 0.35;
  toast(open ? 'Steam valve opened' : 'Steam valve closed');
}

/* -------------------------------------------------------------------------- */
/* Camera: custom orbit + WASD (engine.stepCamera)                            */
/* -------------------------------------------------------------------------- */

let camState = { yaw: 0.62, pitch: 0.34, radius: 10.5, target: [0, 1.7, 0] };
const keys = {};
let dragging = false;
let lastX = 0, lastY = 0;

function applyCamera() {
  const p = orbitToCartesian(camState.yaw, camState.pitch, camState.radius, camState.target);
  camera.position.set(p[0], p[1], p[2]);
  camera.lookAt(camState.target[0], camState.target[1], camState.target[2]);
}
applyCamera();

canvas.addEventListener('pointerdown', (e) => {
  dragging = true; lastX = e.clientX; lastY = e.clientY;
  try { canvas.setPointerCapture(e.pointerId); } catch (_) { /* pointer already released */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (!dragging) return;
  const dx = e.clientX - lastX, dy = e.clientY - lastY;
  lastX = e.clientX; lastY = e.clientY;
  keys.dragYaw = -dx * 0.005;
  keys.dragPitch = -dy * 0.005;
});
const endDrag = () => { dragging = false; keys.dragYaw = 0; keys.dragPitch = 0; };
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', endDrag);
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  // DOM_DELTA_LINE (e.g. mouse wheels on some platforms) reports lines, not
  // pixels; normalize to pixels and accumulate so multiple events in one
  // frame are not collapsed to the last delta.
  const px = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
  keys.dolly = (keys.dolly || 0) + px * 0.012;
}, { passive: false });

// Character-key shortcuts can be switched off from the panel (WCAG 2.1.4).
let keysEnabled = true;
const keyMap = {
  w: 'w', a: 'a', s: 's', d: 'd', q: 'q', e: 'e',
  ArrowUp: 'arrowUp', ArrowDown: 'arrowDown', ArrowLeft: 'arrowLeft', ArrowRight: 'arrowRight',
};
function clearKeys() {
  for (const k of Object.keys(keys)) keys[k] = false;
  keys.dragYaw = 0; keys.dragPitch = 0; keys.dolly = 0;
  dragging = false;
}
// Held keys never receive a keyup if the window loses focus mid-press.
window.addEventListener('blur', clearKeys);
document.addEventListener('visibilitychange', () => { if (document.hidden) clearKeys(); });
window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const card = document.getElementById('help-card');
    if (card && !card.hidden) { card.hidden = true; e.preventDefault(); }
    return;
  }
  const tag = (e.target && e.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
  if (!keysEnabled) return;
  // X always toggles the lab; while it is open nothing else may drive the
  // hidden scene (the lab's Escape handler already ran in the capture phase).
  if (e.key === 'x' || e.key === 'X') {
    if (!e.repeat) { if (crystalLab.isOpen()) crystalLab.close(); else crystalLab.open(); }
    e.preventDefault();
    return;
  }
  if (crystalLab.isOpen()) return;
  const k = keyMap[e.key] || keyMap[e.key.toLowerCase()];
  if (k) { keys[k] = true; e.preventDefault(); return; }
  // Toggle shortcuts (valve, night, help, pause, reset) must not re-fire on
  // key auto-repeat while the key is held down.
  if (e.repeat) return;
  if (e.key === 'l' || e.key === 'L') toggleNight();
  if (e.key === 'h' || e.key === 'H') toggleHelp();
  if (e.key === ' ') { setValve(!valveOpen); e.preventDefault(); }
  if (e.key === 'p' || e.key === 'P') togglePause();
  if (e.key === 'r' || e.key === 'R') resetCamera();
});
window.addEventListener('keyup', (e) => {
  const k = keyMap[e.key] || keyMap[e.key.toLowerCase()];
  if (k) keys[k] = false;
});

// Raycast clicking on the valve
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
let downPos = null;
canvas.addEventListener('pointerdown', (e) => { downPos = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downPos) return;
  const moved = Math.hypot(e.clientX - downPos[0], e.clientY - downPos[1]);
  downPos = null;
  if (moved > 6) return; // it was a drag, not a click
  pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / window.innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObject(valveGroup, true);
  if (hits.length) setValve(!valveOpen);
});

/* -------------------------------------------------------------------------- */
/* UI wiring                                                                  */
/* -------------------------------------------------------------------------- */

const toastEl = document.getElementById('toast');
let toastTimer = null;
function toast(msg) {
  toastEl.textContent = msg;
  toastEl.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1900);
}

function toggleNight() {
  nightTarget = nightTarget > 0.5 ? 0 : 1;
  const btn = document.getElementById('btn-night');
  const on = nightTarget > 0.5;
  btn.setAttribute('aria-pressed', String(on));
  document.getElementById('night-label').textContent = on ? 'Day mode' : 'Night mode';
  toast(on ? 'Cozy night lighting' : 'Bright day lighting');
}

function toggleHelp() {
  const card = document.getElementById('help-card');
  card.hidden = !card.hidden;
}

document.getElementById('btn-night').addEventListener('click', toggleNight);
document.getElementById('btn-sound').addEventListener('click', toggleSound);
document.getElementById('btn-help').addEventListener('click', toggleHelp);
document.getElementById('btn-help-close').addEventListener('click', () => {
  document.getElementById('help-card').hidden = true;
});
document.getElementById('btn-steam').addEventListener('click', () => setValve(!valveOpen));

const grindSlider = document.getElementById('grind-speed');
grindSlider.addEventListener('input', () => {
  grindSpeed = parseFloat(grindSlider.value);
  document.getElementById('grind-speed-val').textContent = grindSpeed.toFixed(2);
});

document.getElementById('latte-pattern').addEventListener('change', (e) => {
  lattePattern = e.target.value;
  toast('Pour style: ' + lattePattern);
});
document.getElementById('latte-swirl').addEventListener('change', (e) => {
  latteAnimate = e.target.checked;
  document.getElementById('latte-swirl-val').textContent = latteAnimate ? 'on' : 'off';
});
document.getElementById('keys-enabled').addEventListener('change', (e) => {
  keysEnabled = e.target.checked;
  clearKeys();
  document.getElementById('keys-enabled-val').textContent = keysEnabled ? 'on' : 'off';
  toast(keysEnabled ? 'Keyboard shortcuts on' : 'Keyboard shortcuts off');
});

function regrowFromSeed(seed) {
  crystalSeed = Math.max(0, Math.min(999999, Math.floor(Number(seed) || 0))) >>> 0;
  const input = document.getElementById('crystal-seed');
  if (input) input.value = String(crystalSeed);
  const label = document.getElementById('crystal-seed-val');
  if (label) label.textContent = String(crystalSeed);
  buildCrystals(crystalSeed);
  toast('Crystal garden rebuilt from seed ' + crystalSeed);
  if (crystalLab) crystalLab.noteSeed();
}

document.getElementById('btn-regrow').addEventListener('click', () => {
  regrowFromSeed((crystalSeed * 1664525 + 1013904223) >>> 0);
});
document.getElementById('crystal-seed').addEventListener('change', (e) => {
  regrowFromSeed(e.target.value);
});

function togglePause() {
  paused = !paused;
  const btn = document.getElementById('btn-pause');
  if (btn) {
    btn.setAttribute('aria-pressed', String(paused));
    btn.textContent = paused ? 'Resume motion' : 'Pause motion';
  }
  toast(paused ? 'Motion paused; diagnostics stay live' : 'Motion resumed');
}

function resetCamera() {
  camState = { yaw: 0.62, pitch: 0.34, radius: 10.5, target: [0, 1.7, 0] };
  applyCamera();
  toast('Camera reset to the default orbit');
}

/* -------------------------------------------------------------------------- */
/* Crystal Lab overlay: the solid-state physics bench. initCrystalLab reads   */
/* location.hash for a bookmarked lab state and may restore a scene seed.     */
/* Declared early because its own boot-restore can call regrowFromSeed.       */
/* -------------------------------------------------------------------------- */

let crystalLab = null;
crystalLab = initCrystalLab({
  toast,
  getSeed: () => crystalSeed,
  onSeed: (seed) => regrowFromSeed(seed),
});
document.getElementById('btn-lab').addEventListener('click', () => crystalLab.open());

document.getElementById('btn-pause').addEventListener('click', togglePause);
document.getElementById('btn-reset-cam').addEventListener('click', resetCamera);
document.getElementById('btn-telemetry').addEventListener('click', async () => {
  if (!latestTelemetry) return;
  const payload = Object.assign({}, latestTelemetry, {
    fieldSignature: patternSignature(lattePattern, 0, 12),
    pattern: lattePattern,
  });
  const text = JSON.stringify(payload, null, 2);
  try {
    await navigator.clipboard.writeText(text);
    toast('Diagnostics JSON copied to clipboard');
  } catch (_) {
    toast('Diagnostics: ' + payload.crystalCount + ' crystals, ' + payload.triangleCount + ' triangles');
  }
});

/* -------------------------------------------------------------------------- */
/* Audio: STRICTLY off until the user clicks the explicit Sound button.       */
/* No AudioContext, no <audio>, no oscillator is created before that click.   */
/* -------------------------------------------------------------------------- */

let audioCtx = null;
let audioNodes = null;
let soundOn = false;

function buildAudioGraph() {
  // WebAudio ambient cafe hum: two soft sines + gentle filtered noise.
  const Ctx = window.AudioContext || window.webkitAudioContext;
  audioCtx = new Ctx();
  const master = audioCtx.createGain();
  master.gain.value = 0.0; // muted until explicit user gesture
  master.connect(audioCtx.destination);
  const o1 = audioCtx.createOscillator();
  const o2 = audioCtx.createOscillator();
  o1.type = 'sine'; o1.frequency.value = 92;
  o2.type = 'sine'; o2.frequency.value = 138;
  const g1 = audioCtx.createGain(); g1.gain.value = 0.14;
  const g2 = audioCtx.createGain(); g2.gain.value = 0.06;
  o1.connect(g1).connect(master);
  o2.connect(g2).connect(master);
  o1.start(); o2.start();
  // gentle noise "steam hiss"
  const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 2, audioCtx.sampleRate);
  const data = buf.getChannelData(0);
  const rng = makeRng(4242);
  for (let i = 0; i < data.length; i++) data[i] = (rng() * 2 - 1) * 0.35;
  const noise = audioCtx.createBufferSource();
  noise.buffer = buf; noise.loop = true;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'lowpass'; filter.frequency.value = 700;
  const ng = audioCtx.createGain(); ng.gain.value = 0.02;
  noise.connect(filter).connect(ng).connect(master);
  noise.start();
  return { master, o1, o2, noise };
}

async function toggleSound() {
  if (!audioCtx) {
    try {
      audioNodes = buildAudioGraph();
    } catch (err) {
      toast('Audio is unavailable in this browser');
      console.warn('[LatteLattice] audio init failed', err);
      return;
    }
  }
  if (audioCtx.state === 'suspended') await audioCtx.resume();
  soundOn = !soundOn;
  const target = soundOn ? 0.35 : 0.0;
  audioNodes.master.gain.setTargetAtTime(target, audioCtx.currentTime, 0.15);
  const btn = document.getElementById('btn-sound');
  btn.setAttribute('aria-pressed', String(soundOn));
  document.getElementById('sound-label').textContent = soundOn ? 'Sound on' : 'Sound off';
  toast(soundOn ? 'Ambient sound on (you unmuted it)' : 'Sound muted');
}

/* -------------------------------------------------------------------------- */
/* Export: OBJ / STL of the whole procedural diorama                          */
/* -------------------------------------------------------------------------- */

function exportScene(format) {
  // Build the merged export mesh through the same engine builder the telemetry
  // panel measures, so the download and the readouts describe one geometry.
  const merged = mergeMeshes(buildExportMeshes(crystalSeed));
  const text = format === 'stl' ? toSTL(merged, { name: 'LatteLattice3D' })
                                : toOBJ(merged, { name: 'LatteLattice3D' });
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `latte-lattice-3d.${format}`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
  toast(`Exported ${merged.vertexCount} vertices as .${format.toUpperCase()}`);
}
document.getElementById('btn-obj').addEventListener('click', () => exportScene('obj'));
document.getElementById('btn-stl').addEventListener('click', () => exportScene('stl'));

/* -------------------------------------------------------------------------- */
/* Resize                                                                     */
/* -------------------------------------------------------------------------- */

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight, false);
});

/* -------------------------------------------------------------------------- */
/* Main loop                                                                  */
/* -------------------------------------------------------------------------- */

applyLighting(0);

let lastTelemetryRefresh = 0;
// Scene time only advances while motion runs; pausing freezes every gear,
// crystal, steam puff, drip and the fluid surface while leaving the camera
// and the diagnostics readouts live.
let sceneTime = 0;

function animate() {
  requestAnimationFrame(animate);
  const rawDt = clock.getDelta();
  const dt = paused ? 0 : Math.min(rawDt, 0.06);
  sceneTime += dt;
  const t = sceneTime;
  frameCount += 1;
  performanceElapsedMs += rawDt * 1000;

  // Refresh the deterministic diagnostics twice per second. The readout is
  // computed from the seed and geometry, so pausing motion does not freeze it.
  if (performanceElapsedMs - lastTelemetryRefresh >= 500) {
    lastTelemetryRefresh = performanceElapsedMs;
    latestTelemetry = computeTelemetry({
      seed: crystalSeed, valveOpen, pressureBar: steamEnergy * 1.35,
      pattern: lattePattern, grindSpeed, nightBlend, frameCount,
      elapsedMs: performanceElapsedMs,
    });
    renderTelemetry();
  }

  // Camera
  camState = stepCamera(camState, keys, dt);
  keys.dragYaw = 0; keys.dragPitch = 0; keys.dolly = 0;
  applyCamera();

  // Lighting easing
  if (Math.abs(nightBlend - nightTarget) > 0.001) {
    nightBlend += (nightTarget - nightBlend) * Math.min(1, dt * 2.5);
    applyLighting(nightBlend);
    for (const pl of lampLights) pl.intensity = nightBlend * 1.6;
  }

  // Valve / steam energy
  const targetEnergy = valveOpen ? 1 : 0;
  steamEnergy += (targetEnergy - steamEnergy) * Math.min(1, dt * 3.0);
  const pressure = steamEnergy * 1.35;
  document.getElementById('pressure').textContent = pressure.toFixed(2) + ' bar';
  document.getElementById('pressure-bar').style.width = (steamEnergy * 100).toFixed(0) + '%';
  needle.rotation.z = -steamEnergy * 1.2;
  valve.rotation.z += (valveOpen ? 1.6 : 0.25) * dt * steamEnergy;
  valveMat.emissiveIntensity = 0.35 + steamEnergy * 1.3;

  // Steam particles (engine-driven, deterministic)
  const ps = steamParticles({
    count: steamCount, t, open: valveOpen, rise: 1.1, spread: 0.32,
    life: 2.4, seed: 99, origin: [0, 0, 0],
  });
  for (let i = 0; i < steamCount; i++) {
    const p = ps[i];
    steamPos[i * 3] = p.position[0];
    steamPos[i * 3 + 1] = p.position[1];
    steamPos[i * 3 + 2] = p.position[2];
  }
  steamGeo.attributes.position.needsUpdate = true;
  steamMat.opacity = steamEnergy * 0.65;
  steamMat.size = 0.12 + steamEnergy * 0.12;
  steamPoints.visible = steamEnergy > 0.01;

  // Espresso drips animate when valve open
  for (let i = 0; i < drips.length; i++) {
    const d = drips[i];
    const k = ((t * 1.4 + i * 0.5) % 1);
    d.scale.y = steamEnergy * (0.3 + k * 0.7);
    d.position.y = 0.12 - k * 0.5 * steamEnergy;
    d.visible = steamEnergy > 0.05;
  }

  // Planetary grinder (engine kinematics)
  const gs = planetaryState({ ...grinderCfg, omega: grindSpeed, t });
  sunGear.rotation.y = gs.sunAngle;
  for (let i = 0; i < planetGears.length; i++) {
    const pl = gs.planets[i];
    planetGears[i].rotation.y = pl.angle;
    planetGears[i].position.x = pl.position[0];
    planetGears[i].position.z = pl.position[2];
  }
  // beans gently jiggle
  for (let i = 0; i < beans.length; i++) {
    beans[i].position.y += Math.sin(t * 2 + i) * 0.0006 * grindSpeed;
    beans[i].rotation.y += 0.004 * grindSpeed;
  }

  // Latte-art fluid surface
  updateFluid(t);

  // Crystals: custom shader uniforms + gentle float/spin
  for (let i = 0; i < crystalMeshes.length; i++) {
    const m = crystalMeshes[i];
    m.rotation.y = t * m.userData.spin + m.userData.phase;
    m.position.y = m.userData.baseY + Math.sin(t * 1.1 + m.userData.phase) * 0.06;
    const u = crystalUniformsList[i];
    u.uTime.value = t;
    u.uCamera.value.copy(camera.position);
    u.uGlow.value = 0.6 + nightBlend * 1.4;
  }

  renderer.render(scene, camera);
}

// Kick off the render loop and dismiss the loading veil once the first frame
// is on screen. No audio is started here: sound stays strictly user-gated.
requestAnimationFrame(() => {
  animate();
  requestAnimationFrame(() => {
    if (loadingEl) loadingEl.classList.add('hidden');
    document.body.dataset.ready = '1';
  });
});
