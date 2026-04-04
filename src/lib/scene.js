/**
 * scene.js – Three.js 3D scene for the Artemis orbit viewer.
 *
 * Imports Three.js and OrbitControls from a CDN ESM build so no
 * bundler is needed.  The scene uses km-scaled scene units via units.js.
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js';

import { kmToScene } from './units.js';

// ── Earth radius in scene units ──────────────────────────────────
const EARTH_RADIUS_KM  = 6_371;
const MOON_RADIUS_KM   = 1_737;
const ORION_MARKER_KM  = 300;   // marker size, not a real size

let _scene, _camera, _renderer, _controls;
let _earthMesh, _moonMesh, _orionMarker, _trailLine, _trailPositions;
const MAX_TRAIL_POINTS = 2000;

/**
 * Initialise the Three.js scene and attach the renderer to `canvas`.
 * @param {HTMLCanvasElement} canvas
 */
export function createScene(canvas) {
  // Renderer
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  _renderer.setClearColor(0x000005);

  // Scene
  _scene = new THREE.Scene();

  // Camera
  const aspect = canvas.clientWidth / canvas.clientHeight;
  _camera = new THREE.PerspectiveCamera(45, aspect, 0.001, 500);
  _camera.position.set(0, 0, 8);  // ~80 000 km out

  // Lighting
  _scene.add(new THREE.AmbientLight(0x334466, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(50, 30, 80);
  _scene.add(sun);

  // Earth
  const earthGeo = new THREE.SphereGeometry(kmToScene(EARTH_RADIUS_KM), 48, 32);
  const earthMat = new THREE.MeshPhongMaterial({ color: 0x2255aa, emissive: 0x051530, shininess: 30 });
  _earthMesh = new THREE.Mesh(earthGeo, earthMat);
  _scene.add(_earthMesh);

  // Moon (position updated each frame)
  const moonGeo = new THREE.SphereGeometry(kmToScene(MOON_RADIUS_KM), 32, 24);
  const moonMat = new THREE.MeshPhongMaterial({ color: 0x888888, emissive: 0x111111 });
  _moonMesh = new THREE.Mesh(moonGeo, moonMat);
  _moonMesh.position.set(kmToScene(384_400), 0, 0);  // default: ~1 LD along X
  _scene.add(_moonMesh);

  // Orion marker (small glowing sphere)
  const orionGeo = new THREE.SphereGeometry(kmToScene(ORION_MARKER_KM), 16, 12);
  const orionMat = new THREE.MeshBasicMaterial({ color: 0xffdd44 });
  _orionMarker = new THREE.Mesh(orionGeo, orionMat);
  _scene.add(_orionMarker);

  // Orbit trail
  _trailPositions = new Float32Array(MAX_TRAIL_POINTS * 3);
  const trailGeo  = new THREE.BufferGeometry();
  trailGeo.setAttribute('position', new THREE.BufferAttribute(_trailPositions, 3));
  trailGeo.setDrawRange(0, 0);
  const trailMat = new THREE.LineBasicMaterial({ color: 0x4a90e2, opacity: 0.6, transparent: true });
  _trailLine = new THREE.Line(trailGeo, trailMat);
  _scene.add(_trailLine);

  // Star field (random points on a large sphere)
  _scene.add(_makeStarField(3000));

  // Orbit controls
  _controls = new OrbitControls(_camera, _renderer.domElement);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.minDistance   = 0.1;
  _controls.maxDistance   = 400;
}

/**
 * Update Orion and Moon world positions from km vectors.
 * @param {[number,number,number]} orionKm
 * @param {[number,number,number]|null} moonKm
 */
export function updateBodies(orionKm, moonKm) {
  if (orionKm) {
    _orionMarker.position.set(
      kmToScene(orionKm[0]),
      kmToScene(orionKm[1]),
      kmToScene(orionKm[2]),
    );
  }
  if (moonKm) {
    _moonMesh.position.set(
      kmToScene(moonKm[0]),
      kmToScene(moonKm[1]),
      kmToScene(moonKm[2]),
    );
  }
}

/**
 * Replace the trail with the given array of km samples.
 * Silently truncates to MAX_TRAIL_POINTS.
 * @param {Array<{positionKm:[number,number,number]}>} samples
 */
export function setTrail(samples) {
  const count = Math.min(samples.length, MAX_TRAIL_POINTS);
  for (let i = 0; i < count; i++) {
    const p = samples[i].positionKm;
    _trailPositions[i * 3]     = kmToScene(p[0]);
    _trailPositions[i * 3 + 1] = kmToScene(p[1]);
    _trailPositions[i * 3 + 2] = kmToScene(p[2]);
  }
  _trailLine.geometry.attributes.position.needsUpdate = true;
  _trailLine.geometry.setDrawRange(0, count);
}

/**
 * Handle canvas resize.
 * @param {number} width
 * @param {number} height
 */
export function resizeScene(width, height) {
  if (!_renderer) return;
  _camera.aspect = width / height;
  _camera.updateProjectionMatrix();
  _renderer.setSize(width, height, false);
}

/** Render one frame. Call from requestAnimationFrame. */
export function renderScene() {
  if (!_renderer) return;
  _controls.update();
  _renderer.render(_scene, _camera);
}

// ── Helpers ──────────────────────────────────────────────────────

function _makeStarField(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const phi   = Math.acos(2 * Math.random() - 1);
    const theta = 2 * Math.PI * Math.random();
    const r     = 250 + Math.random() * 50;
    positions[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, sizeAttenuation: true });
  return new THREE.Points(geo, mat);
}
