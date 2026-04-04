/**
 * scene.js – Three.js scene helpers for the Artemis orbit viewer.
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js';

import { kmToScene } from './units.js';

const EARTH_RADIUS_KM = 6_371;
const MOON_RADIUS_KM = 1_737;
const ORION_MARKER_KM = 260;
const ORION_HALO_KM = 430;

let _scene, _camera, _renderer, _controls;
let _earthMesh, _moonMesh, _orionMarker, _orionHalo;
let _fullTrailGroup, _traversedTrailGroup, _eventMarkerGroup;

export function createScene(canvas) {
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  _renderer.setClearColor(0x000005);

  _scene = new THREE.Scene();

  const aspect = canvas.clientWidth / canvas.clientHeight;
  _camera = new THREE.PerspectiveCamera(45, aspect, 0.001, 1200);
  _camera.position.set(0, 0, 8);

  _scene.add(new THREE.AmbientLight(0x334466, 0.8));
  const sun = new THREE.DirectionalLight(0xffffff, 1.8);
  sun.position.set(50, 30, 80);
  _scene.add(sun);

  const earthGeo = new THREE.SphereGeometry(kmToScene(EARTH_RADIUS_KM), 48, 32);
  const earthMat = new THREE.MeshPhongMaterial({ color: 0x2255aa, emissive: 0x051530, shininess: 30 });
  _earthMesh = new THREE.Mesh(earthGeo, earthMat);
  _earthMesh.position.set(0, 0, 0);
  _scene.add(_earthMesh);

  const moonGeo = new THREE.SphereGeometry(kmToScene(MOON_RADIUS_KM), 32, 24);
  const moonMat = new THREE.MeshPhongMaterial({ color: 0x888888, emissive: 0x111111 });
  _moonMesh = new THREE.Mesh(moonGeo, moonMat);
  _moonMesh.position.set(kmToScene(384_400), 0, 0);
  _scene.add(_moonMesh);

  const orionGeo = new THREE.SphereGeometry(kmToScene(ORION_MARKER_KM), 16, 12);
  _orionMarker = new THREE.Mesh(orionGeo, new THREE.MeshBasicMaterial({ color: 0xffdd44 }));
  _scene.add(_orionMarker);

  const haloGeo = new THREE.SphereGeometry(kmToScene(ORION_HALO_KM), 16, 12);
  _orionHalo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.25 }));
  _scene.add(_orionHalo);

  _fullTrailGroup = new THREE.Group();
  _traversedTrailGroup = new THREE.Group();
  _eventMarkerGroup = new THREE.Group();
  _scene.add(_fullTrailGroup);
  _scene.add(_traversedTrailGroup);
  _scene.add(_eventMarkerGroup);

  _scene.add(_makeStarField(3000));

  _controls = new OrbitControls(_camera, _renderer.domElement);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.minDistance = 0.1;
  _controls.maxDistance = 600;
}

export function updateBodies(orionKm, moonKm) {
  if (orionKm) {
    const sx = kmToScene(orionKm[0]);
    const sy = kmToScene(orionKm[1]);
    const sz = kmToScene(orionKm[2]);
    _orionMarker.position.set(sx, sy, sz);
    _orionHalo.position.set(sx, sy, sz);
  }

  if (moonKm) {
    _moonMesh.position.set(kmToScene(moonKm[0]), kmToScene(moonKm[1]), kmToScene(moonKm[2]));
  }
}

export function setMissionTrailsBySegment(segments) {
  clearGroup(_fullTrailGroup);
  for (const seg of segments || []) {
    const line = makeLineFromSamples(seg.samples || [], { color: 0x4a90e2, opacity: 0.25, linewidth: 1 });
    if (line) _fullTrailGroup.add(line);
  }
}

export function setTraversedTrailBySegment(segments, currentMs) {
  clearGroup(_traversedTrailGroup);
  for (const seg of segments || []) {
    const traversed = getTraversedSamples(seg.samples || [], currentMs);
    if (traversed.length < 2) continue;
    const line = makeLineFromSamples(traversed, { color: 0x8fd3ff, opacity: 0.95, linewidth: 2 });
    if (line) _traversedTrailGroup.add(line);
  }
}

export function setEventMarkers(markers) {
  clearGroup(_eventMarkerGroup);
  for (const marker of markers || []) {
    if (!marker?.positionKm) continue;

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(kmToScene(180), 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff77aa, transparent: true, opacity: 0.9 }),
    );
    sphere.position.set(
      kmToScene(marker.positionKm[0]),
      kmToScene(marker.positionKm[1]),
      kmToScene(marker.positionKm[2]),
    );
    sphere.userData = { eventId: marker.id, label: marker.label };
    _eventMarkerGroup.add(sphere);
  }
}

export function focusCameraPreset(name, context = {}) {
  if (!_camera || !_controls) return;

  if (name === 'earth-centered') {
    _camera.position.set(0, 0, 8);
    _controls.target.set(0, 0, 0);
  } else if (name === 'moon-approach' && context.moonKm) {
    const mx = kmToScene(context.moonKm[0]);
    const my = kmToScene(context.moonKm[1]);
    const mz = kmToScene(context.moonKm[2]);
    _camera.position.set(mx + 1.4, my + 0.8, mz + 1.4);
    _controls.target.set(mx, my, mz);
  } else if (name === 'mission-fit' && context.boundsKm) {
    const min = context.boundsKm.min || [0, 0, 0];
    const max = context.boundsKm.max || [0, 0, 0];
    const cx = kmToScene((min[0] + max[0]) * 0.5);
    const cy = kmToScene((min[1] + max[1]) * 0.5);
    const cz = kmToScene((min[2] + max[2]) * 0.5);
    const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const distance = Math.max(2.5, kmToScene(span) * 1.2);
    _camera.position.set(cx + distance, cy + distance * 0.4, cz + distance);
    _controls.target.set(cx, cy, cz);
  }

  _controls.update();
}

export function resizeScene(width, height) {
  if (!_renderer) return;
  _camera.aspect = width / height;
  _camera.updateProjectionMatrix();
  _renderer.setSize(width, height, false);
}

export function renderScene() {
  if (!_renderer) return;
  _controls.update();
  _renderer.render(_scene, _camera);
}

function makeLineFromSamples(samples, { color, opacity }) {
  if (!samples || samples.length < 2) return null;
  const vertices = new Float32Array(samples.length * 3);
  for (let i = 0; i < samples.length; i++) {
    const p = samples[i].positionKm;
    vertices[i * 3] = kmToScene(p[0]);
    vertices[i * 3 + 1] = kmToScene(p[1]);
    vertices[i * 3 + 2] = kmToScene(p[2]);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(vertices, 3));
  return new THREE.Line(
    geo,
    new THREE.LineBasicMaterial({ color, transparent: true, opacity }),
  );
}

function getTraversedSamples(samples, currentMs) {
  if (!samples.length) return [];
  const startMs = samples[0].epochMs;
  const stopMs = samples[samples.length - 1].epochMs;

  if (currentMs < startMs) return [];
  if (currentMs >= stopMs) return samples;

  const traversed = [];
  for (let i = 0; i < samples.length; i++) {
    if (samples[i].epochMs <= currentMs) traversed.push(samples[i]);
    else break;
  }
  return traversed;
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  }
}

function _makeStarField(count) {
  const positions = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = 2 * Math.PI * Math.random();
    const r = 250 + Math.random() * 50;
    positions[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    positions[i * 3 + 2] = r * Math.cos(phi);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return new THREE.Points(geo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, sizeAttenuation: true }));
}
