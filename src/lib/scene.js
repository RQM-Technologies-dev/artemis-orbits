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
const DEFAULT_MOON_POSITION_KM = [384_400, 0, 0];
const DEFAULT_ORION_POSITION_KM = [22_000, 6_000, 10_000];
const FALLBACK_CANVAS_WIDTH = 960;
const FALLBACK_CANVAS_HEIGHT = 540;
const CAMERA_TRANSITION_MS = 700;
const ZOOM_FACTOR_PER_STEP = 1.2;

const PLANET_TEXTURE_URLS = {
  earthColor: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_atmos_2048.jpg',
  earthNormal: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_normal_2048.jpg',
  earthSpecular: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_specular_2048.jpg',
  moonColor: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/moon_1024.jpg',
};

let _scene, _camera, _renderer, _controls;
let _earthMesh, _moonMesh, _orionMarker, _orionHalo, _earthAtmosphere;
let _fullTrailGroup, _traversedTrailGroup, _eventMarkerGroup;
let _starField;
let _cameraTransition = null;
let _followCameraEnabled = false;
let _followCameraDistanceScale = 1;
let _eventMarkerClickHandler = null;
let _pointerDown = null;
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();

export function createScene(canvas) {
  if (!canvas) throw new Error('createScene(canvas) requires a valid canvas element');
  const { width, height } = getSafeCanvasSize(canvas);

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  _renderer.setSize(width, height, false);
  _renderer.setClearColor(0x060d1a);
  _renderer.outputColorSpace = THREE.SRGBColorSpace;
  _renderer.toneMapping = THREE.ACESFilmicToneMapping;
  _renderer.toneMappingExposure = 1.22;

  _scene = new THREE.Scene();

  const aspect = width / height;
  _camera = new THREE.PerspectiveCamera(45, aspect, 0.001, 1200);
  _camera.position.set(0, 0, 8);

  _scene.add(new THREE.AmbientLight(0x88b1ff, 1.95));
  const sun = new THREE.DirectionalLight(0xffffff, 3.05);
  sun.position.set(50, 30, 80);
  _scene.add(sun);

  const earthGeo = new THREE.SphereGeometry(kmToScene(EARTH_RADIUS_KM), 48, 32);
  const earthMat = new THREE.MeshPhongMaterial({
    color: 0x8cb9ff,
    emissive: 0x265089,
    shininess: 24,
    specular: 0x5a6272,
  });
  _earthMesh = new THREE.Mesh(earthGeo, earthMat);
  _earthMesh.position.set(0, 0, 0);
  _scene.add(_earthMesh);

  const atmosphereGeo = new THREE.SphereGeometry(kmToScene(EARTH_RADIUS_KM * 1.05), 48, 32);
  const atmosphereMat = new THREE.MeshLambertMaterial({
    color: 0x9fd3ff,
    transparent: true,
    opacity: 0.28,
    side: THREE.BackSide,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  _earthAtmosphere = new THREE.Mesh(atmosphereGeo, atmosphereMat);
  _scene.add(_earthAtmosphere);

  const moonGeo = new THREE.SphereGeometry(kmToScene(MOON_RADIUS_KM), 32, 24);
  const moonMat = new THREE.MeshPhongMaterial({
    color: 0xf0f2ff,
    emissive: 0x3f3f3f,
    shininess: 10,
  });
  _moonMesh = new THREE.Mesh(moonGeo, moonMat);
  _moonMesh.position.set(kmToScene(DEFAULT_MOON_POSITION_KM[0]), 0, 0);
  _scene.add(_moonMesh);

  const orionGeo = new THREE.SphereGeometry(kmToScene(ORION_MARKER_KM), 16, 12);
  _orionMarker = new THREE.Mesh(orionGeo, new THREE.MeshBasicMaterial({ color: 0xffef78 }));
  _orionMarker.visible = true;
  _scene.add(_orionMarker);

  const haloGeo = new THREE.SphereGeometry(kmToScene(ORION_HALO_KM), 16, 12);
  _orionHalo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xffefb0, transparent: true, opacity: 0.42 }));
  _orionHalo.visible = true;
  _scene.add(_orionHalo);

  _fullTrailGroup = new THREE.Group();
  _traversedTrailGroup = new THREE.Group();
  _eventMarkerGroup = new THREE.Group();
  _scene.add(_fullTrailGroup);
  _scene.add(_traversedTrailGroup);
  _scene.add(_eventMarkerGroup);

  _starField = _makeStarField(3000);
  _scene.add(_starField);

  _controls = new OrbitControls(_camera, _renderer.domElement);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.enableZoom = true;
  _controls.zoomSpeed = 1.15;
  _controls.minDistance = 0.1;
  _controls.maxDistance = 600;

  _renderer.domElement.addEventListener('pointerdown', _onPointerDown);
  _renderer.domElement.addEventListener('pointerup', _onPointerUp);

  _loadPlanetTextures(earthMat, moonMat);
  setPerformanceMode('auto');
  showFallbackBodies();
  focusCameraPreset('fallback-overview', { instant: true });
}

export function updateBodies(orionKm, moonKm) {
  if (!_orionMarker || !_orionHalo || !_moonMesh || !_earthMesh) return;
  const orionPosKm = orionKm || DEFAULT_ORION_POSITION_KM;
  if (orionPosKm) {
    const sx = kmToScene(orionPosKm[0]);
    const sy = kmToScene(orionPosKm[1]);
    const sz = kmToScene(orionPosKm[2]);
    _orionMarker.position.set(sx, sy, sz);
    _orionHalo.position.set(sx, sy, sz);
    _orionMarker.visible = true;
    _orionHalo.visible = true;
  }

  const moonPosKm = moonKm || DEFAULT_MOON_POSITION_KM;
  _moonMesh.position.set(kmToScene(moonPosKm[0]), kmToScene(moonPosKm[1]), kmToScene(moonPosKm[2]));
}

export function setMissionTrailsBySegment(segments) {
  clearGroup(_fullTrailGroup);
  for (const seg of segments || []) {
    const line = makeLineFromSamples(seg.samples || [], { color: 0x79bcff, opacity: 0.42, linewidth: 1 });
    if (line) _fullTrailGroup.add(line);
  }
}

export function setTraversedTrailBySegment(segments, currentMs) {
  clearGroup(_traversedTrailGroup);
  for (const seg of segments || []) {
    const traversed = getTraversedSamples(seg.samples || [], currentMs);
    if (traversed.length < 2) continue;
    const line = makeLineFromSamples(traversed, { color: 0xbdeaff, opacity: 1, linewidth: 2 });
    if (line) _traversedTrailGroup.add(line);
  }
}

export function setEventMarkers(markers) {
  clearGroup(_eventMarkerGroup);
  for (const marker of markers || []) {
    if (!marker?.positionKm) continue;

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(kmToScene(180), 10, 10),
      new THREE.MeshBasicMaterial({ color: 0xff9fcb, transparent: true, opacity: 0.98 }),
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

export function resetSceneDynamicState() {
  showFallbackBodies();
  clearGroup(_fullTrailGroup);
  clearGroup(_traversedTrailGroup);
  clearGroup(_eventMarkerGroup);
}

export function showFallbackBodies() {
  if (!_earthMesh || !_moonMesh || !_orionMarker || !_orionHalo) return;
  _earthMesh.visible = true;
  _moonMesh.visible = true;
  updateBodies(DEFAULT_ORION_POSITION_KM, DEFAULT_MOON_POSITION_KM);
}

export function focusCameraPreset(name, context = {}) {
  if (!_camera || !_controls) return;
  _followCameraEnabled = false;
  let cameraPos = _camera.position.clone();
  let targetPos = _controls.target.clone();

  if (name === 'earth-centered') {
    cameraPos = new THREE.Vector3(0, 0, 8);
    targetPos = new THREE.Vector3(0, 0, 0);
  } else if (name === 'moon-approach') {
    const moonKm = context.moonKm || DEFAULT_MOON_POSITION_KM;
    const mx = kmToScene(moonKm[0]);
    const my = kmToScene(moonKm[1]);
    const mz = kmToScene(moonKm[2]);
    cameraPos = new THREE.Vector3(mx + 1.4, my + 0.8, mz + 1.4);
    targetPos = new THREE.Vector3(mx, my, mz);
  } else if (name === 'mission-fit' && context.boundsKm) {
    const min = context.boundsKm.min || [0, 0, 0];
    const max = context.boundsKm.max || [0, 0, 0];
    const cx = kmToScene((min[0] + max[0]) * 0.5);
    const cy = kmToScene((min[1] + max[1]) * 0.5);
    const cz = kmToScene((min[2] + max[2]) * 0.5);
    const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
    const distance = Math.max(2.5, kmToScene(span) * 1.2);
    cameraPos = new THREE.Vector3(cx + distance, cy + distance * 0.4, cz + distance);
    targetPos = new THREE.Vector3(cx, cy, cz);
  } else if (name === 'fallback-overview') {
    const moonX = kmToScene(DEFAULT_MOON_POSITION_KM[0]);
    const midX = moonX * 0.35;
    cameraPos = new THREE.Vector3(midX, 5.5, 10.5);
    targetPos = new THREE.Vector3(midX, 0, 0);
  }

  if (context.instant === true) {
    _cameraTransition = null;
    _camera.position.copy(cameraPos);
    _controls.target.copy(targetPos);
    _controls.update();
    return;
  }
  _startCameraTransition(cameraPos, targetPos);
}

export function resizeScene(width, height) {
  if (!_renderer || !_camera) return;
  const safeWidth = Number.isFinite(width) && width > 0 ? width : FALLBACK_CANVAS_WIDTH;
  const safeHeight = Number.isFinite(height) && height > 0 ? height : FALLBACK_CANVAS_HEIGHT;
  _camera.aspect = safeWidth / safeHeight;
  _camera.updateProjectionMatrix();
  _renderer.setSize(safeWidth, safeHeight, false);
}

export function renderScene() {
  if (!_renderer) return;
  _tickCameraTransition();
  _tickFollowCamera();
  _controls.update();
  _renderer.render(_scene, _camera);
}

export function setPerformanceMode(mode) {
  if (!_renderer) return;
  const normalized = ['auto', 'high', 'balanced', 'low'].includes(mode) ? mode : 'auto';
  let effective = normalized;
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  if (normalized === 'auto') {
    const cores = Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : 8;
    const deviceMemory = Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : 8;
    effective = (cores <= 4 || deviceMemory <= 4) ? 'low' : 'balanced';
  }
  const dpr = window.devicePixelRatio || 1;
  if (effective === 'high') _renderer.setPixelRatio(Math.min(dpr, 2));
  else if (effective === 'balanced') _renderer.setPixelRatio(Math.min(dpr, 1.5));
  else _renderer.setPixelRatio(1);
  if (_starField) _starField.visible = effective !== 'low';
  _renderer.setSize(_renderer.domElement.clientWidth || FALLBACK_CANVAS_WIDTH, _renderer.domElement.clientHeight || FALLBACK_CANVAS_HEIGHT, false);
}

export function setFollowCameraEnabled(enabled) {
  _followCameraEnabled = Boolean(enabled);
  if (!_followCameraEnabled) return;
  _cameraTransition = null;
}

export function zoomCamera(step = 1) {
  if (!_camera || !_controls) return;
  const safeStep = Number.isFinite(step) ? step : 1;
  if (!safeStep) return;
  const factor = safeStep > 0
    ? 1 / (ZOOM_FACTOR_PER_STEP ** safeStep)
    : ZOOM_FACTOR_PER_STEP ** (-safeStep);

  if (_followCameraEnabled) {
    _followCameraDistanceScale = THREE.MathUtils.clamp(_followCameraDistanceScale * factor, 0.35, 4.5);
    return;
  }

  const offset = _camera.position.clone().sub(_controls.target);
  const currentDistance = offset.length();
  if (!Number.isFinite(currentDistance) || currentDistance <= 0) return;

  const minDistance = Number.isFinite(_controls.minDistance) ? _controls.minDistance : 0.1;
  const maxDistance = Number.isFinite(_controls.maxDistance) ? _controls.maxDistance : 600;
  const nextDistance = THREE.MathUtils.clamp(currentDistance * factor, minDistance, maxDistance);
  if (Math.abs(nextDistance - currentDistance) < 1e-6) return;

  offset.setLength(nextDistance);
  _camera.position.copy(_controls.target.clone().add(offset));
  _cameraTransition = null;
  _controls.update();
}

export function setEventMarkerClickHandler(handler) {
  _eventMarkerClickHandler = typeof handler === 'function' ? handler : null;
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
  return new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      color: 0xe7f3ff,
      size: 0.52,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.9,
    }),
  );
}

function getSafeCanvasSize(canvas) {
  const rect = canvas?.getBoundingClientRect?.();
  const rawWidth = Number.isFinite(canvas?.clientWidth) && canvas.clientWidth > 0
    ? canvas.clientWidth
    : (Number.isFinite(rect?.width) && rect.width > 0 ? rect.width : FALLBACK_CANVAS_WIDTH);
  const rawHeight = Number.isFinite(canvas?.clientHeight) && canvas.clientHeight > 0
    ? canvas.clientHeight
    : (Number.isFinite(rect?.height) && rect.height > 0 ? rect.height : FALLBACK_CANVAS_HEIGHT);
  return {
    width: Math.max(1, Math.round(rawWidth)),
    height: Math.max(1, Math.round(rawHeight)),
  };
}

function _loadPlanetTextures(earthMat, moonMat) {
  const loader = new THREE.TextureLoader();
  _loadTexture(loader, PLANET_TEXTURE_URLS.earthColor, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    earthMat.map = tex;
    earthMat.needsUpdate = true;
  });
  _loadTexture(loader, PLANET_TEXTURE_URLS.earthNormal, (tex) => {
    earthMat.normalMap = tex;
    earthMat.normalScale = new THREE.Vector2(0.65, 0.65);
    earthMat.needsUpdate = true;
  });
  _loadTexture(loader, PLANET_TEXTURE_URLS.earthSpecular, (tex) => {
    earthMat.specularMap = tex;
    earthMat.needsUpdate = true;
  });
  _loadTexture(loader, PLANET_TEXTURE_URLS.moonColor, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    moonMat.map = tex;
    moonMat.needsUpdate = true;
  });
}

function _loadTexture(loader, url, onLoad) {
  loader.load(url, onLoad, undefined, () => {
    // Keep fallback materials when remote textures are unavailable.
  });
}

function _startCameraTransition(targetPos, targetLookAt) {
  _cameraTransition = {
    startedAt: performance.now(),
    durationMs: CAMERA_TRANSITION_MS,
    fromPos: _camera.position.clone(),
    fromTarget: _controls.target.clone(),
    toPos: targetPos.clone(),
    toTarget: targetLookAt.clone(),
  };
}

function _tickCameraTransition() {
  if (!_cameraTransition) return;
  const elapsed = performance.now() - _cameraTransition.startedAt;
  const t = Math.max(0, Math.min(1, elapsed / _cameraTransition.durationMs));
  const eased = t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2;
  _camera.position.lerpVectors(_cameraTransition.fromPos, _cameraTransition.toPos, eased);
  _controls.target.lerpVectors(_cameraTransition.fromTarget, _cameraTransition.toTarget, eased);
  if (t >= 1) _cameraTransition = null;
}

function _tickFollowCamera() {
  if (!_followCameraEnabled || !_orionMarker || !_camera || !_controls) return;
  const target = _orionMarker.position.clone();
  const desired = target.clone().add(new THREE.Vector3(1.2, 0.55, 1.35).multiplyScalar(_followCameraDistanceScale));
  _camera.position.lerp(desired, 0.075);
  _controls.target.lerp(target, 0.12);
}

function _onPointerDown(event) {
  _pointerDown = { x: event.clientX, y: event.clientY, t: performance.now() };
}

function _onPointerUp(event) {
  if (!_eventMarkerClickHandler || !_camera || !_renderer) return;
  if (!_pointerDown) return;
  const dx = event.clientX - _pointerDown.x;
  const dy = event.clientY - _pointerDown.y;
  const dt = performance.now() - _pointerDown.t;
  _pointerDown = null;
  if (Math.hypot(dx, dy) > 5 || dt > 450) return;

  const rect = _renderer.domElement.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  _pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  _pointer.y = -(((event.clientY - rect.top) / rect.height) * 2 - 1);
  _raycaster.setFromCamera(_pointer, _camera);
  const hits = _raycaster.intersectObjects(_eventMarkerGroup.children, false);
  const hit = hits[0];
  const eventId = hit?.object?.userData?.eventId;
  if (!eventId) return;
  _eventMarkerClickHandler({ eventId });
}
