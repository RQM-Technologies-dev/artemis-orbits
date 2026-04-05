/**
 * scene.js – Three.js scene helpers for the Artemis orbit viewer.
 */

import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.165.0/build/three.module.js';
import { OrbitControls } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/controls/OrbitControls.js';
import { EffectComposer } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/postprocessing/UnrealBloomPass.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.165.0/examples/jsm/loaders/GLTFLoader.js';

import { kmToScene } from './units.js';

const EARTH_RADIUS_KM = 6_371;
const MOON_RADIUS_KM = 1_737;
const ORION_MARKER_KM = 420;
const ORION_HALO_KM = 520;
const DEFAULT_MOON_POSITION_KM = [384_400, 0, 0];
const DEFAULT_ORION_POSITION_KM = [22_000, 6_000, 10_000];
const FALLBACK_CANVAS_WIDTH = 960;
const FALLBACK_CANVAS_HEIGHT = 540;
const CAMERA_TRANSITION_MS = 700;
const ZOOM_FACTOR_PER_STEP = 1.2;
const DEFAULT_TONE_EXPOSURE = 1.24;
const AUTO_EXPOSURE_MIN = 1.1;
const AUTO_EXPOSURE_MAX = 1.6;
const AUTO_EXPOSURE_SMOOTHING = 0.08;
const FOLLOW_DISTANCE_MIN = 0.35;
const FOLLOW_DISTANCE_MAX = 4.5;
const ORION_FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const ORION_WORLD_UP = new THREE.Vector3(0, 1, 0);
const ORION_LOD_HIGH_DISTANCE = 34;
const ORION_LOD_BALANCED_DISTANCE = 24;
const ORION_LOD_LOW_DISTANCE = 16;
const EVENT_CALLOUT_LIFT_KM = 1_000;
const OUTBOUND_ROUTE_STYLE = { color: 0x8dcbff, opacity: 0.72 };
const RETURN_ROUTE_STYLE = { color: 0xffbf98, opacity: 0.72 };
const OUTBOUND_TRAVERSED_STYLE = { color: 0xdaf3ff, opacity: 1 };
const RETURN_TRAVERSED_STYLE = { color: 0xffe4d1, opacity: 1 };
const BLOOM_DISABLED = { enabled: false, strength: 0, radius: 0, threshold: 1 };
const BLOOM_STANDARD = { enabled: true, strength: 0.2, radius: 0.58, threshold: 0.82 };
const BLOOM_BRIGHT = { enabled: true, strength: 0.24, radius: 0.6, threshold: 0.78 };
const BLOOM_CONTRAST = { enabled: true, strength: 0.18, radius: 0.54, threshold: 0.84 };

const PLANET_TEXTURE_URLS = {
  earthColor: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_atmos_2048.jpg',
  earthNormal: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_normal_2048.jpg',
  earthSpecular: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_specular_2048.jpg',
  moonColor: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/moon_1024.jpg',
};

let _scene, _camera, _renderer, _controls;
let _earthMesh, _moonMesh, _orionMarker, _orionHalo, _earthAtmosphere;
let _fullTrailGroup, _traversedTrailGroup, _eventMarkerGroup, _moonTrajectoryGroup;
let _starField;
let _ambientLight = null;
let _sunLight = null;
let _rimLight = null;
let _orionBodyMaterial = null;
let _orionNoseMaterial = null;
let _orionShieldMaterial = null;
let _orionAccentMaterial = null;
let _orionServiceMaterial = null;
let _orionPanelMaterial = null;
let _orionEngineMaterial = null;
let _orionTrussMaterial = null;
let _orionSimpleMaterial = null;
let _orionPlumeMaterial = null;
let _orionDetailGroup = null;
let _orionSimpleMesh = null;
let _orionPlumeMesh = null;
let _orionModelRoot = null;
let _orionAttitudeReference = 'velocity';
let _orionVelocityScene = new THREE.Vector3(1, 0, 0);
let _orionManeuverLevel = 0;
let _followCameraMode = 'chase';
let _performanceEffectiveMode = 'balanced';
let _trajectorySplitMs = null;
let _eventCalloutSprite = null;
let _eventCalloutTexture = null;
let _eventCalloutLabel = '';
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
const _tmpForward = new THREE.Vector3();
const _tmpSide = new THREE.Vector3();
const _tmpUp = new THREE.Vector3();
const _tmpMoonOffset = new THREE.Vector3();
const _tmpOrientation = new THREE.Quaternion();

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

  _ambientLight = new THREE.AmbientLight(0x88a9e0, 1.62);
  _scene.add(_ambientLight);
  _sunLight = new THREE.DirectionalLight(0xffffff, 3.25);
  _sunLight.position.set(50, 30, 80);
  _scene.add(_sunLight);
  _rimLight = new THREE.DirectionalLight(0x82a9f4, 1.02);
  _rimLight.position.set(-30, -10, -50);
  _scene.add(_rimLight);

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
    opacity: 0.34,
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

  _orionMarker = _makeOrionCapsule(kmToScene(ORION_MARKER_KM));
  _orionMarker.visible = true;
  _scene.add(_orionMarker);
  _tryLoadOrionModel();

  const haloGeo = new THREE.SphereGeometry(kmToScene(ORION_HALO_KM), 16, 12);
  _orionHalo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xb0d9ff, transparent: true, opacity: 0.24 }));
  _orionHalo.visible = true;
  _scene.add(_orionHalo);

  _fullTrailGroup = new THREE.Group();
  _traversedTrailGroup = new THREE.Group();
  _eventMarkerGroup = new THREE.Group();
  _moonTrajectoryGroup = new THREE.Group();
  _scene.add(_fullTrailGroup);
  _scene.add(_traversedTrailGroup);
  _scene.add(_eventMarkerGroup);
  _scene.add(_moonTrajectoryGroup);

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

export function updateBodies(orionKm, moonKm, options = {}) {
  if (!_orionMarker || !_orionHalo || !_moonMesh || !_earthMesh) return;
  const orionPosKm = orionKm || DEFAULT_ORION_POSITION_KM;
  if (orionPosKm) {
    const sx = kmToScene(orionPosKm[0]);
    const sy = kmToScene(orionPosKm[1]);
    const sz = kmToScene(orionPosKm[2]);
    if (Array.isArray(options.orionVelocityKmS) && options.orionVelocityKmS.length === 3) {
      _orionVelocityScene.set(
        kmToScene(options.orionVelocityKmS[0]),
        kmToScene(options.orionVelocityKmS[1]),
        kmToScene(options.orionVelocityKmS[2]),
      );
    }
    _orionMarker.position.set(sx, sy, sz);
    _orionHalo.position.set(sx, sy, sz);
    _updateOrionOrientation(_orionMarker.position);
    _orionMarker.visible = true;
    _orionHalo.visible = true;
  }

  const moonPosKm = moonKm || DEFAULT_MOON_POSITION_KM;
  _moonMesh.position.set(kmToScene(moonPosKm[0]), kmToScene(moonPosKm[1]), kmToScene(moonPosKm[2]));
}

export function setMissionTrailsBySegment(segments) {
  clearGroup(_fullTrailGroup);
  _trajectorySplitMs = _computeTrajectorySplitMs(segments);
  for (const seg of segments || []) {
    const phase = _getTrajectoryPhaseForSegment(seg);
    const style = phase === 'return' ? RETURN_ROUTE_STYLE : OUTBOUND_ROUTE_STYLE;
    const line = makeLineFromSamples(seg.samples || [], { color: style.color, opacity: style.opacity, linewidth: 2.4 });
    if (line) _fullTrailGroup.add(line);
  }
}

export function setTraversedTrailBySegment(segments, currentMs) {
  clearGroup(_traversedTrailGroup);
  for (const seg of segments || []) {
    const traversed = getTraversedSamples(seg.samples || [], currentMs);
    if (traversed.length < 2) continue;
    const phase = _getTrajectoryPhaseForSegment(seg);
    const style = phase === 'return' ? RETURN_TRAVERSED_STYLE : OUTBOUND_TRAVERSED_STYLE;
    const line = makeLineFromSamples(traversed, { color: style.color, opacity: style.opacity, linewidth: 3.6 });
    if (line) _traversedTrailGroup.add(line);
  }
}

export function setMoonTrajectoryBySegment(segments) {
  clearGroup(_moonTrajectoryGroup);
  for (const seg of segments || []) {
    const line = makeLineFromSamples(seg.samples || [], { color: 0xe2e6ff, opacity: 0.78, linewidth: 2.2 });
    if (line) _moonTrajectoryGroup.add(line);
  }
}

export function setEventMarkers(markers) {
  clearGroup(_eventMarkerGroup);
  for (const marker of markers || []) {
    if (!marker?.positionKm) continue;

    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(kmToScene(240), 12, 12),
      new THREE.MeshBasicMaterial({ color: 0xffb2d8, transparent: true, opacity: 1 }),
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
  clearGroup(_moonTrajectoryGroup);
  _trajectorySplitMs = null;
  setOrionManeuverLevel(0);
  setActiveEventCallout(null);
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
  _updateOrionLod();
  _updateLightingForBodies();
  _tickAutoExposure();
  _updateEventCalloutPosition();
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
  _performanceEffectiveMode = effective;
  _updateOrionLod();
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
  _applyOrionCapsuleVisual(settings.orionColor);
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

export function setFollowCameraMode(mode) {
  const allowed = ['chase', 'cinematic', 'side', 'earth-frame', 'moon-frame'];
  _followCameraMode = allowed.includes(mode) ? mode : 'chase';
}

export function recenterFollowCamera() {
  if (!_camera || !_controls || !_orionMarker) return;
  const target = _orionMarker.position.clone();
  const velocityDir = _orionVelocityScene.lengthSq() > 1e-12
    ? _orionVelocityScene.clone().normalize()
    : new THREE.Vector3(1, 0, 0);
  const trailing = velocityDir.clone().multiplyScalar(-1.35 * clampDistanceScale(_followCameraDistanceScale));
  const up = new THREE.Vector3(0, 1, 0).multiplyScalar(0.55 * clampDistanceScale(_followCameraDistanceScale));
  _camera.position.copy(target.clone().add(trailing).add(up));
  _controls.target.copy(target);
  _controls.update();
}

export function snapCameraToEventView({ eventPositionKm = null, moonKm = null } = {}) {
  if (!_camera || !_controls) return;
  if (Array.isArray(eventPositionKm) && eventPositionKm.length === 3) {
    const ex = kmToScene(eventPositionKm[0]);
    const ey = kmToScene(eventPositionKm[1]);
    const ez = kmToScene(eventPositionKm[2]);
    const target = new THREE.Vector3(ex, ey, ez);
    const dir = _orionVelocityScene.lengthSq() > 1e-12
      ? _orionVelocityScene.clone().normalize()
      : new THREE.Vector3(1, 0, 0);
    const cameraPos = target.clone()
      .add(dir.clone().multiplyScalar(-1.9))
      .add(new THREE.Vector3(0, 0.8, 1.2));
    _startCameraTransition(cameraPos, target);
    return;
  }
  if (Array.isArray(moonKm) && moonKm.length === 3) {
    focusCameraPreset('moon-approach', { moonKm });
    return;
  }
  focusCameraPreset('earth-centered');
}

export function setOrionManeuverLevel(level) {
  _orionManeuverLevel = THREE.MathUtils.clamp(Number(level) || 0, 0, 1);
  if (_orionPlumeMesh?.material) {
    _orionPlumeMesh.visible = _orionManeuverLevel > 0.02;
    _orionPlumeMesh.material.opacity = 0.08 + (_orionManeuverLevel * 0.55);
  }
}

export function setActiveEventCallout(event) {
  const label = event?.label ? String(event.label) : '';
  if (!label) {
    if (_eventCalloutSprite) _eventCalloutSprite.visible = false;
    _eventCalloutLabel = '';
    return;
  }
  if (label === _eventCalloutLabel && _eventCalloutSprite) {
    _eventCalloutSprite.visible = true;
    return;
  }
  _eventCalloutLabel = label;
  const texture = _makeCalloutTexture(label);
  if (_eventCalloutTexture) _eventCalloutTexture.dispose();
  _eventCalloutTexture = texture;
  if (!_eventCalloutSprite) {
    _eventCalloutSprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false }));
    _eventCalloutSprite.renderOrder = 12;
    _eventCalloutSprite.visible = true;
    _scene?.add(_eventCalloutSprite);
  } else {
    _eventCalloutSprite.material.map = texture;
    _eventCalloutSprite.material.needsUpdate = true;
    _eventCalloutSprite.visible = true;
  }
  _eventCalloutSprite.scale.set(0.62, 0.18, 1);
}

export function captureSceneImage() {
  if (!_renderer || !_camera || !_scene) return null;
  try {
    _renderer.render(_scene, _camera);
    return _renderer.domElement.toDataURL('image/png');
  } catch {
    return null;
  }
}

export function setOrionAttitudeReference(reference = 'velocity') {
  const r = String(reference || 'velocity');
  _orionAttitudeReference = (r === 'moon' || r === 'earth') ? r : 'velocity';
}

function makeLineFromSamples(samples, { color, opacity, linewidth = 1 }) {
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
    new THREE.LineBasicMaterial({ color, transparent: true, opacity, linewidth }),
  );
}

function _computeTrajectorySplitMs(segments) {
  let farthest = null;
  let maxDistance = -1;
  for (const seg of segments || []) {
    for (const sample of seg?.samples || []) {
      const p = sample.positionKm;
      if (!p || p.length < 3) continue;
      const d = (p[0] ** 2) + (p[1] ** 2) + (p[2] ** 2);
      if (d > maxDistance) {
        maxDistance = d;
        farthest = sample.epochMs;
      }
    }
  }
  return Number.isFinite(farthest) ? farthest : null;
}

function _getTrajectoryPhaseForSegment(segment) {
  if (!_trajectorySplitMs) return 'outbound';
  const samples = segment?.samples || [];
  if (!samples.length) return 'outbound';
  const midMs = Math.round((samples[0].epochMs + samples[samples.length - 1].epochMs) * 0.5);
  return midMs > _trajectorySplitMs ? 'return' : 'outbound';
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
      size: 0.62,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.95,
    }),
  );
}

function _makeOrionCapsule(radius) {
  const stack = new THREE.Group();
  const radialSegments = 20;
  const crewRadiusTop = radius * 0.55;
  const crewRadiusBottom = radius * 0.8;
  const crewHeight = radius * 1.0;
  const noseHeight = radius * 0.75;
  const shieldHeight = radius * 0.18;
  const serviceRadius = radius * 0.56;
  const serviceHeight = radius * 0.8;
  const engineHeight = radius * 0.42;
  const engineRadius = radius * 0.17;

  _orionBodyMaterial = new THREE.MeshPhongMaterial({
    color: 0xdce3ee,
    emissive: 0x1f2734,
    shininess: 40,
    specular: 0x98a5b8,
  });
  _orionNoseMaterial = new THREE.MeshPhongMaterial({
    color: 0xeaf0f7,
    emissive: 0x1d2330,
    shininess: 48,
    specular: 0xa8b4c5,
  });
  _orionShieldMaterial = new THREE.MeshPhongMaterial({
    color: 0x5a4333,
    emissive: 0x1e1510,
    shininess: 10,
    specular: 0x2f2a24,
  });
  _orionAccentMaterial = new THREE.MeshBasicMaterial({
    color: 0xb6dbff,
    transparent: true,
    opacity: 0.55,
  });
  _orionServiceMaterial = new THREE.MeshPhongMaterial({
    color: 0xa2acbf,
    emissive: 0x1a2130,
    shininess: 22,
    specular: 0x667087,
  });
  _orionPanelMaterial = new THREE.MeshPhongMaterial({
    color: 0x4f6da6,
    emissive: 0x0d1730,
    shininess: 55,
    specular: 0x9cb9f1,
    side: THREE.DoubleSide,
  });
  _orionEngineMaterial = new THREE.MeshPhongMaterial({
    color: 0x7e7263,
    emissive: 0x231d17,
    shininess: 16,
    specular: 0x473f35,
  });
  _orionTrussMaterial = new THREE.MeshPhongMaterial({
    color: 0x8894a9,
    emissive: 0x171e2a,
    shininess: 18,
    specular: 0x596277,
  });

  const crewBody = new THREE.Mesh(
    new THREE.CylinderGeometry(crewRadiusTop, crewRadiusBottom, crewHeight, radialSegments, 1, false),
    _orionBodyMaterial,
  );
  stack.add(crewBody);

  const nose = new THREE.Mesh(
    new THREE.ConeGeometry(crewRadiusTop, noseHeight, radialSegments),
    _orionNoseMaterial,
  );
  nose.position.y = (crewHeight * 0.5) + (noseHeight * 0.5) - (radius * 0.04);
  stack.add(nose);

  const heatShield = new THREE.Mesh(
    new THREE.CylinderGeometry(crewRadiusBottom * 1.07, crewRadiusBottom * 1.12, shieldHeight, radialSegments),
    _orionShieldMaterial,
  );
  heatShield.position.y = -((crewHeight * 0.5) + (shieldHeight * 0.5) - (radius * 0.08));
  stack.add(heatShield);

  const dockingRing = new THREE.Mesh(
    new THREE.TorusGeometry(crewRadiusTop * 0.85, radius * 0.04, 10, 24),
    _orionAccentMaterial,
  );
  dockingRing.rotation.x = Math.PI / 2;
  dockingRing.position.y = (crewHeight * 0.5) + (radius * 0.04);
  stack.add(dockingRing);

  const serviceY = heatShield.position.y - (shieldHeight * 0.5) - (serviceHeight * 0.5) + (radius * 0.04);
  const serviceModule = new THREE.Mesh(
    new THREE.CylinderGeometry(serviceRadius * 0.97, serviceRadius, serviceHeight, radialSegments, 1, false),
    _orionServiceMaterial,
  );
  serviceModule.position.y = serviceY;
  stack.add(serviceModule);

  const truss = new THREE.Mesh(
    new THREE.TorusGeometry(serviceRadius * 1.02, radius * 0.03, 8, 24),
    _orionTrussMaterial,
  );
  truss.rotation.x = Math.PI / 2;
  truss.position.y = serviceY + (serviceHeight * 0.28);
  stack.add(truss);

  const engineBell = new THREE.Mesh(
    new THREE.ConeGeometry(engineRadius, engineHeight, radialSegments),
    _orionEngineMaterial,
  );
  engineBell.rotation.x = Math.PI;
  engineBell.position.y = serviceY - (serviceHeight * 0.5) - (engineHeight * 0.45);
  stack.add(engineBell);

  const panelLength = radius * 0.95;
  const panelWidth = radius * 0.24;
  const panelThickness = radius * 0.03;
  const panelOffset = serviceRadius + (panelLength * 0.5) + (radius * 0.09);
  const panelY = serviceY;
  for (let i = 0; i < 4; i++) {
    const angle = (Math.PI * 2 * i) / 4;
    const panelPivot = new THREE.Group();
    panelPivot.position.y = panelY;
    panelPivot.rotation.y = angle;

    const boom = new THREE.Mesh(
      new THREE.CylinderGeometry(radius * 0.024, radius * 0.024, panelOffset * 0.78, 8),
      _orionTrussMaterial,
    );
    boom.rotation.z = Math.PI / 2;
    boom.position.x = panelOffset * 0.39;
    panelPivot.add(boom);

    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(panelLength, panelWidth, panelThickness),
      _orionPanelMaterial,
    );
    panel.position.x = panelOffset;
    panel.rotation.z = (i % 2 === 0 ? 1 : -1) * 0.05;
    panelPivot.add(panel);

    stack.add(panelPivot);
  }

  _orionDetailGroup = stack;
  _orionSimpleMaterial = new THREE.MeshPhongMaterial({
    color: 0xe3e8f2,
    emissive: 0x1a2230,
    shininess: 30,
    specular: 0x8e9db5,
  });
  _orionSimpleMesh = new THREE.Mesh(
    new THREE.CapsuleGeometry(radius * 0.56, radius * 0.78, 8, 14),
    _orionSimpleMaterial,
  );
  _orionSimpleMesh.visible = false;
  stack.add(_orionSimpleMesh);

  _orionPlumeMaterial = new THREE.MeshBasicMaterial({
    color: 0x8fd4ff,
    transparent: true,
    opacity: 0.22,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  _orionPlumeMesh = new THREE.Mesh(
    new THREE.ConeGeometry(radius * 0.18, radius * 0.85, 18),
    _orionPlumeMaterial,
  );
  _orionPlumeMesh.rotation.x = Math.PI;
  _orionPlumeMesh.position.y = -(crewHeight * 0.5 + serviceHeight * 0.95);
  _orionPlumeMesh.visible = false;
  stack.add(_orionPlumeMesh);

  // Tilt slightly so the capsule silhouette reads in most camera angles.
  stack.rotation.z = Math.PI * 0.08;
  return stack;
}

function _applyOrionCapsuleVisual(orionColorHex) {
  const accent = new THREE.Color(orionColorHex);
  const bodyBase = new THREE.Color(0xdce3ee);
  const noseBase = new THREE.Color(0xeaf0f7);
  const serviceBase = new THREE.Color(0xa2acbf);
  const panelBase = new THREE.Color(0x4f6da6);
  const trussBase = new THREE.Color(0x8894a9);
  if (_orionBodyMaterial) {
    _orionBodyMaterial.color.copy(bodyBase).lerp(accent, 0.18);
    _orionBodyMaterial.emissive.copy(accent).multiplyScalar(0.085);
  }
  if (_orionNoseMaterial) {
    _orionNoseMaterial.color.copy(noseBase).lerp(accent, 0.1);
    _orionNoseMaterial.emissive.copy(accent).multiplyScalar(0.06);
  }
  if (_orionServiceMaterial) {
    _orionServiceMaterial.color.copy(serviceBase).lerp(accent, 0.15);
    _orionServiceMaterial.emissive.copy(accent).multiplyScalar(0.06);
  }
  if (_orionPanelMaterial) {
    _orionPanelMaterial.color.copy(panelBase).lerp(accent, 0.08);
    _orionPanelMaterial.emissive.copy(accent).multiplyScalar(0.035);
  }
  if (_orionTrussMaterial) {
    _orionTrussMaterial.color.copy(trussBase).lerp(accent, 0.1);
    _orionTrussMaterial.emissive.copy(accent).multiplyScalar(0.045);
  }
  if (_orionAccentMaterial) _orionAccentMaterial.color.copy(accent);
  if (_orionSimpleMaterial) {
    _orionSimpleMaterial.color.copy(bodyBase).lerp(accent, 0.16);
    _orionSimpleMaterial.emissive.copy(accent).multiplyScalar(0.075);
  }
  if (_orionPlumeMaterial) _orionPlumeMaterial.color.copy(accent).lerp(new THREE.Color(0x8fd4ff), 0.55);
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
  const velocityDir = _orionVelocityScene.lengthSq() > 1e-12
    ? _orionVelocityScene.clone().normalize()
    : new THREE.Vector3(1, 0, 0);
  const isCinematic = _followCameraMode === 'cinematic';
  const isSide = _followCameraMode === 'side';
  const isEarthFrame = _followCameraMode === 'earth-frame';
  const isMoonFrame = _followCameraMode === 'moon-frame';
  const forwardLead = isCinematic ? 0.52 : (isSide ? 0.2 : 0.38);
  const upLift = isCinematic ? 0.74 : (isSide ? 0.48 : 0.55);
  const trailingDistance = isCinematic ? 1.7 : (isSide ? 1.15 : 1.35);
  const sideAxis = new THREE.Vector3().crossVectors(velocityDir, ORION_WORLD_UP).normalize();
  const trailing = velocityDir.clone().multiplyScalar(-trailingDistance * _followCameraDistanceScale);
  const lead = velocityDir.clone().multiplyScalar(forwardLead * _followCameraDistanceScale);
  const up = new THREE.Vector3(0, 1, 0).multiplyScalar(upLift * _followCameraDistanceScale);
  let desired = target.clone().add(trailing).add(up);
  if (isSide && sideAxis.lengthSq() > 1e-8) {
    desired.add(sideAxis.multiplyScalar(1.35 * _followCameraDistanceScale));
  } else if (isEarthFrame) {
    desired = target.clone().add(new THREE.Vector3(0.95, 0.55, 1.05).multiplyScalar(_followCameraDistanceScale));
  } else if (isMoonFrame && _moonMesh) {
    const towardMoon = _moonMesh.position.clone().sub(target).normalize();
    desired = target.clone().add(towardMoon.multiplyScalar(-1.45 * _followCameraDistanceScale)).add(up);
  }
  const desiredTarget = target.clone().add(lead);
  const camLerp = isCinematic ? 0.05 : 0.075;
  const tgtLerp = isCinematic ? 0.09 : 0.12;
  _camera.position.lerp(desired, camLerp);
  _controls.target.lerp(desiredTarget, tgtLerp);
}

function _tryLoadOrionModel() {
  if (!_orionMarker) return;
  const loader = new GLTFLoader();
  const url = new URL('../../assets/models/orion.glb', import.meta.url).toString();
  loader.load(
    url,
    (gltf) => {
      if (!_orionMarker || !gltf?.scene) return;
      _orionModelRoot = gltf.scene;
      _orionModelRoot.scale.setScalar(0.42);
      _orionModelRoot.rotation.set(0, 0, 0);
      _orionModelRoot.position.set(0, 0, 0);
      _orionMarker.add(_orionModelRoot);
      if (_orionDetailGroup) _orionDetailGroup.visible = false;
      if (_orionSimpleMesh) _orionSimpleMesh.visible = false;
    },
    undefined,
    () => {
      // Keep procedural capsule if GLB is unavailable.
    },
  );
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

function _updateOrionOrientation(orionPositionScene) {
  if (!_orionMarker) return;
  const velocityLenSq = _orionVelocityScene.lengthSq();
  if (velocityLenSq < 1e-12) return;
  _tmpForward.copy(_orionVelocityScene).normalize();
  if (_orionAttitudeReference === 'earth') {
    _tmpForward.copy(orionPositionScene).multiplyScalar(-1).normalize();
  } else if (_orionAttitudeReference === 'moon' && _moonMesh) {
    _tmpForward.copy(_moonMesh.position).sub(orionPositionScene).normalize();
  }
  _tmpSide.crossVectors(_tmpForward, ORION_WORLD_UP);
  if (_tmpSide.lengthSq() < 1e-8) _tmpSide.set(1, 0, 0);
  _tmpSide.normalize();
  _tmpUp.crossVectors(_tmpSide, _tmpForward).normalize();
  const basis = new THREE.Matrix4().makeBasis(_tmpSide, _tmpForward, _tmpUp);
  _tmpOrientation.setFromRotationMatrix(basis);
  _orionMarker.quaternion.slerp(_tmpOrientation, 0.16);
}

function _updateOrionLod() {
  if (!_camera || !_orionMarker || !_orionDetailGroup || !_orionSimpleMesh) return;
  const distance = _camera.position.distanceTo(_orionMarker.position);
  const lodThreshold = _performanceEffectiveMode === 'high'
    ? ORION_LOD_HIGH_DISTANCE
    : (_performanceEffectiveMode === 'low' ? ORION_LOD_LOW_DISTANCE : ORION_LOD_BALANCED_DISTANCE);
  const showDetail = distance <= lodThreshold;
  for (const child of _orionDetailGroup.children) {
    if (child === _orionSimpleMesh) continue;
    if (child === _orionPlumeMesh && _orionManeuverLevel > 0.02) continue;
    child.visible = showDetail;
  }
  _orionSimpleMesh.visible = !showDetail;
}

function _updateLightingForBodies() {
  if (!_sunLight || !_rimLight || !_moonMesh || !_earthMesh) return;
  _tmpMoonOffset.copy(_moonMesh.position).sub(_earthMesh.position);
  const dist = Math.max(0.1, _tmpMoonOffset.length());
  const norm = THREE.MathUtils.clamp(dist / kmToScene(430_000), 0, 1);
  _sunLight.intensity = 2.6 + (1 - norm) * 0.92;
  _rimLight.intensity = 0.82 + norm * 0.52;
}

function _updateEventCalloutPosition() {
  if (!_eventCalloutSprite?.visible || !_orionMarker) return;
  _eventCalloutSprite.position.copy(_orionMarker.position);
  _eventCalloutSprite.position.y += kmToScene(EVENT_CALLOUT_LIFT_KM);
}

function _makeCalloutTexture(text) {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return new THREE.CanvasTexture(canvas);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = 'rgba(8, 14, 26, 0.88)';
  roundRect(ctx, 8, 20, canvas.width - 16, canvas.height - 40, 34);
  ctx.fill();
  ctx.strokeStyle = 'rgba(159, 195, 255, 0.85)';
  ctx.lineWidth = 6;
  roundRect(ctx, 8, 20, canvas.width - 16, canvas.height - 40, 34);
  ctx.stroke();
  ctx.fillStyle = '#e7f2ff';
  ctx.font = '600 74px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text.slice(0, 42), canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

function roundRect(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + width - radius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
  ctx.lineTo(x + width, y + height - radius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
  ctx.lineTo(x + radius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
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
      baseExposure: 1.16,
      autoExposureSpread: 0.18,
      earthColor: 0x7aa9f1,
      earthEmissive: 0x295685,
      earthSpecular: 0x4f596b,
      earthShininess: 22,
      moonColor: 0xe0e6f3,
      moonEmissive: 0x414141,
      moonShininess: 9,
      orionColor: 0xffef84,
      orionHaloColor: 0xffefb9,
      orionHaloOpacity: 0.44,
      atmosphereColor: 0x98ceff,
      atmosphereOpacity: 0.31,
      starColor: 0xdeefff,
      starOpacity: 0.9,
      starSize: 0.56,
      bloom: BLOOM_STANDARD,
    };
  }
  if (preset === 'high-contrast') {
    return {
      id: 'high-contrast',
      baseExposure: 1.22,
      autoExposureSpread: 0.2,
      earthColor: 0x9fccff,
      earthEmissive: 0x275891,
      earthSpecular: 0x677285,
      earthShininess: 28,
      moonColor: 0xf5f6ff,
      moonEmissive: 0x3b3b3b,
      moonShininess: 12,
      orionColor: 0xfff59a,
      orionHaloColor: 0xfff4cf,
      orionHaloOpacity: 0.53,
      atmosphereColor: 0xb9e0ff,
      atmosphereOpacity: 0.36,
      starColor: 0xf1f7ff,
      starOpacity: 0.98,
      starSize: 0.6,
      bloom: BLOOM_CONTRAST,
    };
  }
  return {
    id: 'bright',
    baseExposure: 1.28,
    autoExposureSpread: 0.22,
    earthColor: 0x8cb9ff,
    earthEmissive: 0x2d629d,
    earthSpecular: 0x5a6272,
    earthShininess: 24,
    moonColor: 0xf0f2ff,
    moonEmissive: 0x4d4d4d,
    moonShininess: 10,
    orionColor: 0xfff18f,
    orionHaloColor: 0xfff3c0,
    orionHaloOpacity: 0.5,
    atmosphereColor: 0xaddaff,
    atmosphereOpacity: 0.35,
    starColor: 0xe7f3ff,
    starOpacity: 0.97,
    starSize: 0.6,
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
