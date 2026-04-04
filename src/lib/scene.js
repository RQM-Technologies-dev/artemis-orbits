/**
 * scene.js – Three.js scene helpers for the Artemis orbit viewer.
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js';

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
const DEFAULT_TONE_EXPOSURE = 1.18;
const AUTO_EXPOSURE_MIN = 1.04;
const AUTO_EXPOSURE_MAX = 1.45;
const AUTO_EXPOSURE_SMOOTHING = 0.08;
const FOLLOW_DISTANCE_MIN = 0.35;
const FOLLOW_DISTANCE_MAX = 4.5;
const BLOOM_DISABLED = { enabled: false, strength: 0, radius: 0, threshold: 1 };
const BLOOM_STANDARD = { enabled: true, strength: 0.13, radius: 0.55, threshold: 0.88 };
const BLOOM_BRIGHT = { enabled: true, strength: 0.17, radius: 0.57, threshold: 0.84 };
const BLOOM_CONTRAST = { enabled: true, strength: 0.12, radius: 0.5, threshold: 0.9 };

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
let _composer = null;
let _bloomPass = null;
let _cameraTransition = null;
let _followCameraEnabled = false;
let _followCameraDistanceScale = 1;
let _sceneVisualPreset = 'standard';
let _visualPresetConfig = null;
let _eventMarkerClickHandler = null;
let _zoomChangeListener = null;
let _pointerDown = null;
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();

export function createScene(canvas) {
  if (!canvas) throw new Error('createScene(canvas) requires a valid canvas element');
  const { width, height } = getSafeCanvasSize(canvas);

  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  _renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  _renderer.setSize(width, height, false);
  _renderer.setClearColor(0x000000);
  _renderer.outputColorSpace = THREE.SRGBColorSpace;
  _renderer.toneMapping = THREE.ACESFilmicToneMapping;
  _renderer.toneMappingExposure = DEFAULT_TONE_EXPOSURE;

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
  _controls.minDistance = 0.08;
  _controls.maxDistance = 820;

  _renderer.domElement.addEventListener('pointerdown', _onPointerDown);
  _renderer.domElement.addEventListener('pointerup', _onPointerUp);
  _renderer.domElement.addEventListener('wheel', _onWheel, { passive: true });

  _composer = new EffectComposer(_renderer);
  _composer.addPass(new RenderPass(_scene, _camera));
  _bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0, 0, 1);
  _composer.addPass(_bloomPass);

  _loadPlanetTextures(earthMat, moonMat);
  setVisualPreset('standard');
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
  _composer?.setSize(safeWidth, safeHeight);
  if (_bloomPass) _bloomPass.resolution.set(safeWidth, safeHeight);
}

export function renderScene() {
  if (!_renderer) return;
  _tickCameraTransition();
  _tickFollowCamera();
  _tickAutoExposure();
  _controls.update();
  if (_composer && _bloomPass?.enabled) _composer.render();
  else _renderer.render(_scene, _camera);
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
  if (_bloomPass) {
    const bloomAllowed = effective !== 'low' && _visualPresetConfig?.bloom?.enabled !== false;
    _bloomPass.enabled = bloomAllowed;
  }
  _renderer.setSize(_renderer.domElement.clientWidth || FALLBACK_CANVAS_WIDTH, _renderer.domElement.clientHeight || FALLBACK_CANVAS_HEIGHT, false);
  _composer?.setSize(_renderer.domElement.clientWidth || FALLBACK_CANVAS_WIDTH, _renderer.domElement.clientHeight || FALLBACK_CANVAS_HEIGHT);
}

export function setFollowCameraEnabled(enabled) {
  _followCameraEnabled = Boolean(enabled);
  if (!_followCameraEnabled) return;
  _cameraTransition = null;
  _followCameraDistanceScale = clampDistanceScale(_followCameraDistanceScale);
  _notifyZoomChange();
}

export function zoomCamera(step = 1) {
  if (!_camera || !_controls) return;
  const safeStep = Number.isFinite(step) ? step : 1;
  if (!safeStep) return;
  const factor = safeStep > 0
    ? 1 / (ZOOM_FACTOR_PER_STEP ** safeStep)
    : ZOOM_FACTOR_PER_STEP ** (-safeStep);

  if (_followCameraEnabled) {
    _followCameraDistanceScale = clampDistanceScale(_followCameraDistanceScale * factor);
    _notifyZoomChange();
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
  _notifyZoomChange();
}

export function setZoomLevel(normalized) {
  if (!_camera || !_controls) return;
  const f = THREE.MathUtils.clamp(Number(normalized), 0, 1);
  if (_followCameraEnabled) {
    const targetScale = FOLLOW_DISTANCE_MIN + (1 - f) * (FOLLOW_DISTANCE_MAX - FOLLOW_DISTANCE_MIN);
    _followCameraDistanceScale = clampDistanceScale(targetScale);
    _notifyZoomChange();
    return;
  }
  const minDistance = Number.isFinite(_controls.minDistance) ? _controls.minDistance : 0.1;
  const maxDistance = Number.isFinite(_controls.maxDistance) ? _controls.maxDistance : 600;
  const targetDistance = minDistance + (1 - f) * (maxDistance - minDistance);
  const offset = _camera.position.clone().sub(_controls.target);
  if (offset.lengthSq() <= 0) return;
  offset.setLength(THREE.MathUtils.clamp(targetDistance, minDistance, maxDistance));
  _camera.position.copy(_controls.target.clone().add(offset));
  _cameraTransition = null;
  _controls.update();
  _notifyZoomChange();
}

export function getZoomLevel() {
  if (!_camera || !_controls) return 0.5;
  if (_followCameraEnabled) {
    const pct = 1 - ((_followCameraDistanceScale - FOLLOW_DISTANCE_MIN) / (FOLLOW_DISTANCE_MAX - FOLLOW_DISTANCE_MIN));
    return THREE.MathUtils.clamp(pct, 0, 1);
  }
  const minDistance = Number.isFinite(_controls.minDistance) ? _controls.minDistance : 0.1;
  const maxDistance = Number.isFinite(_controls.maxDistance) ? _controls.maxDistance : 600;
  const distance = _camera.position.distanceTo(_controls.target);
  if (!Number.isFinite(distance) || maxDistance <= minDistance) return 0.5;
  return THREE.MathUtils.clamp(1 - ((distance - minDistance) / (maxDistance - minDistance)), 0, 1);
}

export function resetZoom() {
  setZoomLevel(0.5);
}

export function setZoomChangeListener(listener) {
  _zoomChangeListener = typeof listener === 'function' ? listener : null;
}

export function setVisualPreset(preset) {
  const key = String(preset || 'bright');
  const settings = getVisualPresetSettings(key);
  _sceneVisualPreset = settings.id;
  _visualPresetConfig = settings;
  if (!_renderer) return;
  _renderer.toneMappingExposure = settings.baseExposure;
  if (_earthMesh?.material) {
    _earthMesh.material.color.setHex(settings.earthColor);
    _earthMesh.material.emissive.setHex(settings.earthEmissive);
    _earthMesh.material.shininess = settings.earthShininess;
    _earthMesh.material.specular.setHex(settings.earthSpecular);
  }
  if (_moonMesh?.material) {
    _moonMesh.material.color.setHex(settings.moonColor);
    _moonMesh.material.emissive.setHex(settings.moonEmissive);
    _moonMesh.material.shininess = settings.moonShininess;
  }
  if (_orionMarker?.material) _orionMarker.material.color.setHex(settings.orionColor);
  if (_orionHalo?.material) {
    _orionHalo.material.color.setHex(settings.orionHaloColor);
    _orionHalo.material.opacity = settings.orionHaloOpacity;
  }
  if (_earthAtmosphere?.material) {
    _earthAtmosphere.material.color.setHex(settings.atmosphereColor);
    _earthAtmosphere.material.opacity = settings.atmosphereOpacity;
  }
  if (_starField?.material) {
    _starField.material.color.setHex(settings.starColor);
    _starField.material.opacity = settings.starOpacity;
    _starField.material.size = settings.starSize;
  }
  _applyBloomSettings(settings.bloom);
}

export function getVisualPreset() {
  return _sceneVisualPreset;
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
  _followCameraDistanceScale = clampDistanceScale(_followCameraDistanceScale);
  const desired = target.clone().add(new THREE.Vector3(1.2, 0.55, 1.35).multiplyScalar(_followCameraDistanceScale));
  _camera.position.lerp(desired, 0.075);
  _controls.target.lerp(target, 0.12);
}

function _tickAutoExposure() {
  if (!_renderer || !_camera || !_controls || !_visualPresetConfig) return;
  const targetDistance = _followCameraEnabled
    ? THREE.MathUtils.lerp(_controls.minDistance, _controls.maxDistance, 0.2 + (_followCameraDistanceScale / FOLLOW_DISTANCE_MAX) * 0.45)
    : _camera.position.distanceTo(_controls.target);
  if (!Number.isFinite(targetDistance)) return;
  const minDistance = Number.isFinite(_controls.minDistance) ? _controls.minDistance : 0.1;
  const maxDistance = Number.isFinite(_controls.maxDistance) ? _controls.maxDistance : 600;
  const normalizedDistance = THREE.MathUtils.clamp((targetDistance - minDistance) / Math.max(1e-6, maxDistance - minDistance), 0, 1);
  const spread = _visualPresetConfig.autoExposureSpread;
  const targetExposure = THREE.MathUtils.clamp(
    _visualPresetConfig.baseExposure + (normalizedDistance - 0.5) * spread,
    AUTO_EXPOSURE_MIN,
    AUTO_EXPOSURE_MAX,
  );
  _renderer.toneMappingExposure = THREE.MathUtils.lerp(
    _renderer.toneMappingExposure,
    targetExposure,
    AUTO_EXPOSURE_SMOOTHING,
  );
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

function _onWheel() {
  if (_followCameraEnabled) _followCameraDistanceScale = clampDistanceScale(_followCameraDistanceScale);
  _notifyZoomChange();
}

function clampDistanceScale(value) {
  return THREE.MathUtils.clamp(value, FOLLOW_DISTANCE_MIN, FOLLOW_DISTANCE_MAX);
}

function getVisualPresetSettings(preset) {
  if (preset === 'standard') {
    return {
      id: 'standard',
      baseExposure: 1.08,
      autoExposureSpread: 0.14,
      earthColor: 0x7aa9f1,
      earthEmissive: 0x1f446f,
      earthSpecular: 0x4f596b,
      earthShininess: 22,
      moonColor: 0xe0e6f3,
      moonEmissive: 0x323232,
      moonShininess: 9,
      orionColor: 0xffe766,
      orionHaloColor: 0xffe8a4,
      orionHaloOpacity: 0.36,
      atmosphereColor: 0x86c2ff,
      atmosphereOpacity: 0.24,
      starColor: 0xdeefff,
      starOpacity: 0.82,
      starSize: 0.48,
      bloom: BLOOM_STANDARD,
    };
  }
  if (preset === 'high-contrast') {
    return {
      id: 'high-contrast',
      baseExposure: 1.15,
      autoExposureSpread: 0.16,
      earthColor: 0x9fccff,
      earthEmissive: 0x1b3f70,
      earthSpecular: 0x677285,
      earthShininess: 28,
      moonColor: 0xf5f6ff,
      moonEmissive: 0x2a2a2a,
      moonShininess: 12,
      orionColor: 0xfff07f,
      orionHaloColor: 0xfff2be,
      orionHaloOpacity: 0.45,
      atmosphereColor: 0xaed9ff,
      atmosphereOpacity: 0.3,
      starColor: 0xf1f7ff,
      starOpacity: 0.93,
      starSize: 0.54,
      bloom: BLOOM_CONTRAST,
    };
  }
  return {
    id: 'bright',
    baseExposure: 1.2,
    autoExposureSpread: 0.18,
    earthColor: 0x8cb9ff,
    earthEmissive: 0x265089,
    earthSpecular: 0x5a6272,
    earthShininess: 24,
    moonColor: 0xf0f2ff,
    moonEmissive: 0x3f3f3f,
    moonShininess: 10,
    orionColor: 0xffef78,
    orionHaloColor: 0xffefb0,
    orionHaloOpacity: 0.42,
    atmosphereColor: 0x9fd3ff,
    atmosphereOpacity: 0.28,
    starColor: 0xe7f3ff,
    starOpacity: 0.9,
    starSize: 0.52,
    bloom: BLOOM_BRIGHT,
  };
}

function _applyBloomSettings(bloom) {
  if (!_bloomPass) return;
  const config = bloom || BLOOM_DISABLED;
  _bloomPass.enabled = config.enabled !== false;
  _bloomPass.strength = Number.isFinite(config.strength) ? config.strength : 0;
  _bloomPass.radius = Number.isFinite(config.radius) ? config.radius : 0;
  _bloomPass.threshold = Number.isFinite(config.threshold) ? config.threshold : 1;
}

function _notifyZoomChange() {
  if (!_zoomChangeListener) return;
  _zoomChangeListener();
}
