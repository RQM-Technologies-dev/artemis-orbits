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
import { geodeticToCartesianKm } from './geodesy.js';

const EARTH_RADIUS_KM = 6_371;
const MOON_RADIUS_KM = 1_737;
const SUN_RADIUS_KM = 696_340;
const SUN_EARTH_DISTANCE_KM = 149_597_870; // 1 AU
const EARTH_CLOUD_LAYER_SCALE = 1.012;
const ORION_MARKER_KM = 760;
const ORION_SCALE_DEFAULT = 1;
const ORION_SCALE_EARTH_APPROACH_MIN = 0.58;
const ORION_SCALE_SPLASHDOWN = 0.5;
const ORION_HALO_KM = 520;
const ORION_MODEL_SCALE = 0.78;
const ORION_USA_DECAL_WIDTH_SCALE = 0.96;
const ORION_USA_DECAL_HEIGHT_SCALE = 0.3;
const ORION_USA_DECAL_OFFSET_SCALE = 1.03;
const ORION_USA_DECAL_Y_OFFSET_SCALE = 0.14;
const ORION_USA_DECAL_BODY_RADIUS_SCALE = 0.8;
const ORION_USA_DECAL_BODY_HEIGHT_SCALE = 1.0;
const SUN_GLOW_CORE_SCALE = 3.4;
const SUN_GLOW_MID_SCALE = 5.8;
const SUN_GLOW_OUTER_SCALE = 8.2;
const SUN_GLOW_FLARE_WIDTH_SCALE = 14.5;
const SUN_GLOW_FLARE_HEIGHT_SCALE = 1.7;
const SUN_BRIGHTNESS_MULTIPLIER = 3;
const SUN_LIGHT_BASE_INTENSITY = 3.2;
const SUN_DYNAMIC_LIGHT_BASE = 2.6;
const SUN_DYNAMIC_LIGHT_VARIATION = 0.92;
const SUN_SCREEN_FLARE_BASE_SIZE_PX = 260;
const SUN_SCREEN_FLARE_OPACITY_MAX = 0.75;
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
const SCENE_DYNAMIC_UPDATE_INTERVAL_MS = 33;
const SCENE_DYNAMIC_UPDATE_INTERVAL_SMOOTH_MS = 75;
const FOLLOW_DISTANCE_MIN = 0.35;
const FOLLOW_DISTANCE_MAX = 4.5;
const FOLLOW_DISTANCE_MAX_CINEMATIC = 9.5;
const FOLLOW_DISTANCE_MAX_PHONE_CINEMATIC = 8.5;
const ORION_FORWARD_AXIS = new THREE.Vector3(0, 1, 0);
const ORION_WORLD_UP = new THREE.Vector3(0, 1, 0);
const ORION_LOD_HIGH_DISTANCE = 34;
const ORION_LOD_BALANCED_DISTANCE = 24;
const ORION_LOD_LOW_DISTANCE = 16;
const EVENT_CALLOUT_LIFT_KM = 1_000;
const TERMINAL_SPLASH_RING_RADIUS_KM = 220;
const TERMINAL_SPLASH_RING_THICKNESS_KM = 42;
const TERMINAL_SPLASH_PULSE_RADIUS_KM = 120;
const TERMINAL_SPLASH_BOB_KM = 4.5;
const PARACHUTE_DROGUE_COUNT = 2;
const PARACHUTE_MAIN_COUNT = 3;
const PHONE_FRIENDLY_MEDIA_QUERY = '(max-width: 820px) and (pointer: coarse)';
const EARTH_FRAME_CAMERA_OFFSET = new THREE.Vector3(0.95, 0.55, 1.05);
const OUTBOUND_ROUTE_STYLE = { color: 0x8dcbff, opacity: 0.72 };
const RETURN_ROUTE_STYLE = { color: 0xffbf98, opacity: 0.72 };
const MODELED_RETURN_STYLE = { color: 0x7be0ff, opacity: 0.5 };
const OUTBOUND_TRAVERSED_STYLE = { color: 0xdaf3ff, opacity: 1 };
const RETURN_TRAVERSED_STYLE = { color: 0xffe4d1, opacity: 1 };
const MODELED_TRAVERSED_STYLE = { color: 0xc7f5ff, opacity: 0.9 };
const LIGHTING_UPDATE_INTERVAL_MS = 80;
const AUTO_EXPOSURE_UPDATE_INTERVAL_MS = 50;
const ORION_LOD_UPDATE_INTERVAL_MS = 120;
const LOW_MODE_PIXEL_RATIO = 0.9;
const BLOOM_DISABLED = { enabled: false, strength: 0, radius: 0, threshold: 1 };
const BLOOM_STANDARD = { enabled: true, strength: 0.2, radius: 0.58, threshold: 0.82 };
const BLOOM_BRIGHT = { enabled: true, strength: 0.24, radius: 0.6, threshold: 0.78 };
const BLOOM_CONTRAST = { enabled: true, strength: 0.18, radius: 0.54, threshold: 0.84 };

const PLANET_TEXTURE_URLS = {
  earthColor: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_atmos_2048.jpg',
  earthNormal: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_normal_2048.jpg',
  earthSpecular: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_specular_2048.jpg',
  earthClouds: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/earth_clouds_1024.png',
  moonColor: 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r165/examples/textures/planets/moon_1024.jpg',
};

let _scene, _camera, _renderer, _controls;
let _earthMesh, _earthCloudMesh, _moonMesh, _orionMarker, _orionHalo, _earthAtmosphere, _sunMesh;
let _fullTrailGroup, _traversedTrailGroup, _eventMarkerGroup, _moonTrajectoryGroup;
let _traversedTrailCache = null;
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
let _controlsUserInteracting = false;
let _sceneVisualPreset = 'standard';
let _visualPresetConfig = null;
let _eventMarkerClickHandler = null;
let _zoomChangeListener = null;
let _sunGlowGroup = null;
let _sunGlowTexture = null;
let _sunGlowCoreMaterial = null;
let _sunGlowMidMaterial = null;
let _sunGlowOuterMaterial = null;
let _sunGlowFlareMaterial = null;
let _orionUsaDecalTexture = null;
let _pointerDown = null;
let _sunScreenFlareEl = null;
let _terminalVisualState = 'none';
let _terminalSplashTargetKm = null;
let _terminalSplashTargetGroup = null;
let _terminalParachuteGroup = null;
let _terminalEntryGlowMesh = null;
let _terminalBobbingPhase = 0;
let _sceneLoadSmoothing = false;
let _lastSceneDynamicUpdateMs = 0;
let _lastLightingUpdateNow = 0;
let _lastAutoExposureUpdateNow = 0;
let _lastOrionLodUpdateNow = 0;
const _raycaster = new THREE.Raycaster();
const _pointer = new THREE.Vector2();
const _tmpForward = new THREE.Vector3();
const _tmpSide = new THREE.Vector3();
const _tmpUp = new THREE.Vector3();
const _tmpMoonOffset = new THREE.Vector3();
const _tmpVelocityDir = new THREE.Vector3();
const _tmpTarget = new THREE.Vector3();
const _tmpDesired = new THREE.Vector3();
const _tmpDesiredTarget = new THREE.Vector3();
const _tmpTowardMoon = new THREE.Vector3();
const _tmpOrientation = new THREE.Quaternion();
const _tmpSunWorld = new THREE.Vector3();
const _tmpSunNdc = new THREE.Vector3();
const _tmpCameraForward = new THREE.Vector3();
const _tmpCameraToSun = new THREE.Vector3();
const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _tmpVecC = new THREE.Vector3();

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
  _camera = new THREE.PerspectiveCamera(45, aspect, 0.01, 30_000);
  _camera.position.set(0, 0, 8);

  _ambientLight = new THREE.AmbientLight(0xc2cada, 1.04);
  _scene.add(_ambientLight);
  _sunLight = new THREE.DirectionalLight(0xfff3d4, SUN_LIGHT_BASE_INTENSITY * SUN_BRIGHTNESS_MULTIPLIER);
  _scene.add(_sunLight);
  _rimLight = new THREE.DirectionalLight(0x9bb3df, 0.94);
  _rimLight.position.set(-30, -10, -50);
  _scene.add(_rimLight);

  const earthGeo = new THREE.SphereGeometry(kmToScene(EARTH_RADIUS_KM), 48, 32);
  const earthMat = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    emissive: 0x090d12,
    shininess: 34,
    specular: 0x697583,
  });
  _earthMesh = new THREE.Mesh(earthGeo, earthMat);
  _earthMesh.position.set(0, 0, 0);
  _scene.add(_earthMesh);

  const earthCloudGeo = new THREE.SphereGeometry(kmToScene(EARTH_RADIUS_KM * EARTH_CLOUD_LAYER_SCALE), 48, 32);
  const earthCloudMat = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.56,
    depthWrite: false,
    blending: THREE.NormalBlending,
  });
  _earthCloudMesh = new THREE.Mesh(earthCloudGeo, earthCloudMat);
  _earthCloudMesh.position.copy(_earthMesh.position);
  _scene.add(_earthCloudMesh);

  const atmosphereGeo = new THREE.SphereGeometry(kmToScene(EARTH_RADIUS_KM * 1.05), 48, 32);
  const atmosphereMat = new THREE.MeshLambertMaterial({
    color: 0xbad8ff,
    transparent: true,
    opacity: 0.16,
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
  _addOrionUsaDecalsToRoot(_orionMarker, kmToScene(ORION_MARKER_KM));
  _orionMarker.visible = true;
  _scene.add(_orionMarker);
  _tryLoadOrionModel();

  const haloGeo = new THREE.SphereGeometry(kmToScene(ORION_HALO_KM), 16, 12);
  _orionHalo = new THREE.Mesh(haloGeo, new THREE.MeshBasicMaterial({ color: 0xb0d9ff, transparent: true, opacity: 0.24 }));
  _orionHalo.visible = false;
  _scene.add(_orionHalo);

  _fullTrailGroup = new THREE.Group();
  _traversedTrailGroup = new THREE.Group();
  _eventMarkerGroup = new THREE.Group();
  _moonTrajectoryGroup = new THREE.Group();
  _scene.add(_fullTrailGroup);
  _scene.add(_traversedTrailGroup);
  _scene.add(_eventMarkerGroup);
  _scene.add(_moonTrajectoryGroup);

  _starField = _makeStarField(1800);
  _scene.add(_starField);

  const sunDirection = new THREE.Vector3(50, 30, 80).normalize();
  const sunPosition = sunDirection.multiplyScalar(kmToScene(SUN_EARTH_DISTANCE_KM));
  const sunRadiusScene = kmToScene(SUN_RADIUS_KM);
  _sunMesh = new THREE.Mesh(
    new THREE.SphereGeometry(sunRadiusScene, 32, 24),
    new THREE.MeshBasicMaterial({ color: 0xfff1bd }),
  );
  _sunGlowGroup = _makeSunGlow(sunRadiusScene);
  if (_sunGlowGroup) _sunMesh.add(_sunGlowGroup);
  _sunMesh.position.copy(sunPosition);
  _scene.add(_sunMesh);
  _sunLight.position.copy(sunPosition);
  _sunLight.target.position.set(0, 0, 0);
  _scene.add(_sunLight.target);

  _controls = new OrbitControls(_camera, _renderer.domElement);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.enableZoom = true;
  _controls.zoomSpeed = 1.15;
  _controls.minDistance = 0.08;
  _controls.maxDistance = 1_200;
  _controls.addEventListener('start', () => {
    _controlsUserInteracting = true;
  });
  _controls.addEventListener('end', () => {
    _controlsUserInteracting = false;
    _syncFollowScaleFromCamera();
    _notifyZoomChange();
  });

  _renderer.domElement.addEventListener('pointerdown', _onPointerDown);
  _renderer.domElement.addEventListener('pointerup', _onPointerUp);
  _renderer.domElement.addEventListener('wheel', _onWheel, { passive: true });
  _ensureSunScreenFlareOverlay(_renderer.domElement);

  _composer = new EffectComposer(_renderer);
  _composer.addPass(new RenderPass(_scene, _camera));
  _bloomPass = new UnrealBloomPass(new THREE.Vector2(width, height), 0, 0, 1);
  _composer.addPass(_bloomPass);

  _loadPlanetTextures(earthMat, moonMat, earthCloudMat);
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
    _orionHalo.visible = false;
  }

  const moonPosKm = moonKm || DEFAULT_MOON_POSITION_KM;
  _moonMesh.position.set(kmToScene(moonPosKm[0]), kmToScene(moonPosKm[1]), kmToScene(moonPosKm[2]));
  _updateOrionVisualAttachments();
}

export function setMissionTrailsBySegment(segments) {
  clearGroup(_fullTrailGroup);
  _trajectorySplitMs = _computeTrajectorySplitMs(segments);
  _rebuildTraversedTrailCache(segments);
  for (const seg of segments || []) {
    const phase = _getTrajectoryPhaseForSegment(seg);
    const style = seg?.metadata?.modeled === true
      ? MODELED_RETURN_STYLE
      : (phase === 'return' ? RETURN_ROUTE_STYLE : OUTBOUND_ROUTE_STYLE);
    const line = makeLineFromSamples(seg.samples || [], {
      color: style.color,
      opacity: style.opacity,
      linewidth: 2.4,
      dashed: seg?.metadata?.modeled === true,
      dashSize: 0.06,
      gapSize: 0.04,
    });
    if (line) _fullTrailGroup.add(line);
  }
}

export function setTraversedTrailBySegment(segments, currentMs) {
  if (!_traversedTrailCache || _traversedTrailCache.sourceSegments !== segments) {
    _rebuildTraversedTrailCache(segments);
  }
  const entries = _traversedTrailCache?.entries || [];
  for (const entry of entries) {
    const traversedCount = _getTraversedCount(entry.sampleEpochMs, currentMs);
    if (traversedCount < 2) {
      entry.line.visible = false;
      entry.lastDrawCount = 0;
      continue;
    }
    entry.line.visible = true;
    if (entry.lastDrawCount !== traversedCount) {
      entry.line.geometry.setDrawRange(0, traversedCount);
      entry.lastDrawCount = traversedCount;
    }
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
      new THREE.MeshBasicMaterial({
        color: marker.kind === 'surface-target' ? 0x63e0ff : 0xffb2d8,
        transparent: true,
        opacity: marker.kind === 'surface-target' ? 0.95 : 1,
      }),
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
  _traversedTrailCache = null;
  clearGroup(_eventMarkerGroup);
  clearGroup(_moonTrajectoryGroup);
  _trajectorySplitMs = null;
  setSplashdownSurfaceTarget(null);
  setOrionVisualState('none');
  setOrionManeuverLevel(0);
  setActiveEventCallout(null);
}

export function showFallbackBodies() {
  if (!_earthMesh || !_moonMesh || !_orionMarker || !_orionHalo) return;
  _earthMesh.visible = true;
  if (_earthCloudMesh) _earthCloudMesh.visible = true;
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
  const now = performance.now();
  const maintenanceScale = _performanceEffectiveMode === 'low'
    ? 1.8
    : (_performanceEffectiveMode === 'balanced' ? 1.25 : 1);
  _tickCameraTransition();
  _tickFollowCamera();
  _tickEarthCloudRotation();
  if ((now - _lastOrionLodUpdateNow) >= ORION_LOD_UPDATE_INTERVAL_MS * maintenanceScale) {
    _updateOrionLod();
    _lastOrionLodUpdateNow = now;
  }
  if ((now - _lastLightingUpdateNow) >= LIGHTING_UPDATE_INTERVAL_MS * maintenanceScale) {
    _updateLightingForBodies();
    _lastLightingUpdateNow = now;
  }
  if ((now - _lastAutoExposureUpdateNow) >= AUTO_EXPOSURE_UPDATE_INTERVAL_MS * maintenanceScale) {
    _tickAutoExposure();
    _lastAutoExposureUpdateNow = now;
  }
  const dynamicInterval = _sceneLoadSmoothing ? SCENE_DYNAMIC_UPDATE_INTERVAL_SMOOTH_MS : SCENE_DYNAMIC_UPDATE_INTERVAL_MS;
  if ((now - _lastSceneDynamicUpdateMs) >= dynamicInterval) {
    _lastSceneDynamicUpdateMs = now;
  }
  _tickTerminalSplashTarget(now);
  _updateOrionTerminalVisualState();
  _updateEventCalloutPosition();
  _controls.update();
  _updateSunScreenFlareOverlay();
  if (_followCameraEnabled && _controlsUserInteracting) {
    // Preserve user pinch/wheel zoom while follow camera is active.
    _syncFollowScaleFromCamera();
  }
  if (_composer && _bloomPass?.enabled) _composer.render();
  else _renderer.render(_scene, _camera);
}

export function setSceneLoadSmoothingMode(enabled) {
  _sceneLoadSmoothing = Boolean(enabled);
  _lastSceneDynamicUpdateMs = 0;
  _refreshBloomEnabled();
}

export function warmSceneForPlayback() {
  if (!_renderer || !_scene || !_camera) return;
  try {
    _renderer.compile(_scene, _camera);
    if (_composer && _bloomPass?.enabled) _composer.render();
    else _renderer.render(_scene, _camera);
  } catch {
    // Warmup is opportunistic; rendering loop will continue normally.
  }
}

export function setPerformanceMode(mode) {
  if (!_renderer) return;
  const normalized = ['auto', 'high', 'balanced', 'low'].includes(mode) ? mode : 'auto';
  let effective = normalized;
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  const isPhoneFriendly = typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && Boolean(window.matchMedia(PHONE_FRIENDLY_MEDIA_QUERY).matches);
  if (normalized === 'auto') {
    if (isPhoneFriendly) {
      effective = 'low';
    } else {
      const cores = Number.isFinite(nav.hardwareConcurrency) ? nav.hardwareConcurrency : 8;
      const deviceMemory = Number.isFinite(nav.deviceMemory) ? nav.deviceMemory : 8;
      effective = (cores <= 4 || deviceMemory <= 4) ? 'low' : 'balanced';
    }
  }
  const dpr = window.devicePixelRatio || 1;
  if (effective === 'high') _renderer.setPixelRatio(Math.min(dpr, 2));
  else if (effective === 'balanced') _renderer.setPixelRatio(Math.min(dpr, 1.5));
  else _renderer.setPixelRatio(Math.min(dpr, LOW_MODE_PIXEL_RATIO));
  if (_starField) _starField.visible = effective !== 'low';
  _refreshBloomEnabled();
  _performanceEffectiveMode = effective;
  _updateOrionLod();
  _renderer.setSize(_renderer.domElement.clientWidth || FALLBACK_CANVAS_WIDTH, _renderer.domElement.clientHeight || FALLBACK_CANVAS_HEIGHT, false);
  _composer?.setSize(_renderer.domElement.clientWidth || FALLBACK_CANVAS_WIDTH, _renderer.domElement.clientHeight || FALLBACK_CANVAS_HEIGHT);
}

export function getEffectivePerformanceMode() {
  return _performanceEffectiveMode;
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
    const { min: minFollowDistance, max: maxFollowDistance } = _getFollowDistanceLimits();
    const targetScale = minFollowDistance + (1 - f) * (maxFollowDistance - minFollowDistance);
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
    const { min: minFollowDistance, max: maxFollowDistance } = _getFollowDistanceLimits();
    const pct = 1 - ((_followCameraDistanceScale - minFollowDistance) / (maxFollowDistance - minFollowDistance));
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
  if (_earthCloudMesh?.material) {
    _earthCloudMesh.material.color.setHex(settings.cloudColor);
    _earthCloudMesh.material.opacity = settings.cloudOpacity;
  }
  if (_sunMesh?.material) {
    _sunMesh.material.color.setHex(settings.sunColor);
  }
  _applySunGlowVisual(settings.sunColor);
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

export function setSplashdownSurfaceTarget(surfaceTarget) {
  _ensureTerminalVisualNodes();
  if (!surfaceTarget || typeof surfaceTarget !== 'object') {
    _terminalSplashTargetKm = null;
    _updateSplashTargetVisual();
    return;
  }
  const latDeg = Number(surfaceTarget.latDeg);
  const lonDeg = Number(surfaceTarget.lonDeg);
  const altitudeKm = Number.isFinite(Number(surfaceTarget.altitudeKm)) ? Number(surfaceTarget.altitudeKm) : 0;
  if (!Number.isFinite(latDeg) || !Number.isFinite(lonDeg)) {
    _terminalSplashTargetKm = null;
    _updateSplashTargetVisual();
    return;
  }
  _terminalSplashTargetKm = geodeticToCartesianKm({ latDeg, lonDeg, altitudeKm });
  _updateSplashTargetVisual();
}

export function setOrionVisualState(state = 'none') {
  _ensureTerminalVisualNodes();
  _terminalVisualState = String(state || 'none');
  _updateOrionTerminalVisualState();
}

function _makeSplashTargetGroup() {
  const group = new THREE.Group();
  group.visible = false;
  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(kmToScene(TERMINAL_SPLASH_RING_RADIUS_KM), kmToScene(TERMINAL_SPLASH_RING_THICKNESS_KM), 18, 72),
    new THREE.MeshBasicMaterial({
      color: 0x58d8ff,
      transparent: true,
      opacity: 0.62,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  const pulse = new THREE.Mesh(
    new THREE.CircleGeometry(kmToScene(TERMINAL_SPLASH_PULSE_RADIUS_KM), 32),
    new THREE.MeshBasicMaterial({
      color: 0x8feaff,
      transparent: true,
      opacity: 0.34,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    }),
  );
  const core = new THREE.Mesh(
    new THREE.SphereGeometry(kmToScene(36), 12, 10),
    new THREE.MeshBasicMaterial({
      color: 0xb6f2ff,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  group.add(ring, pulse, core);
  group.userData = { ring, pulse, core };
  _scene?.add(group);
  return group;
}

function _makeParachuteGroup() {
  const group = new THREE.Group();
  group.visible = false;
  const nodes = { drogues: [], mains: [], lines: [] };
  const lineMat = new THREE.LineBasicMaterial({ color: 0xbecde6, transparent: true, opacity: 0.85 });
  for (let i = 0; i < PARACHUTE_DROGUE_COUNT; i++) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(kmToScene(150), 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
      new THREE.MeshBasicMaterial({ color: 0xd7ecff, transparent: true, opacity: 0.8 }),
    );
    dome.scale.set(0.72, 0.55, 0.72);
    const side = i === 0 ? -1 : 1;
    dome.position.set(kmToScene(side * 230), kmToScene(520), kmToScene(-80));
    dome.rotation.x = Math.PI;
    group.add(dome);
    nodes.drogues.push(dome);
  }
  for (let i = 0; i < PARACHUTE_MAIN_COUNT; i++) {
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(kmToScene(240), 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.52),
      new THREE.MeshBasicMaterial({ color: 0xf2f6ff, transparent: true, opacity: 0.9 }),
    );
    dome.scale.set(0.88, 0.6, 0.88);
    const side = i - 1;
    dome.position.set(kmToScene(side * 300), kmToScene(690), kmToScene(-120));
    dome.rotation.x = Math.PI;
    group.add(dome);
    nodes.mains.push(dome);
    for (let lineIdx = 0; lineIdx < 3; lineIdx++) {
      const line = new THREE.Line(new THREE.BufferGeometry(), lineMat.clone());
      line.userData = { parentCanopy: dome, lineIdx };
      group.add(line);
      nodes.lines.push(line);
    }
  }
  group.userData = { nodes };
  _orionMarker?.add(group);
  return group;
}

function _makeEntryGlowMesh() {
  const glow = new THREE.Mesh(
    new THREE.SphereGeometry(kmToScene(ORION_MARKER_KM * 1.18), 14, 12),
    new THREE.MeshBasicMaterial({
      color: 0xff9f69,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  glow.visible = false;
  _orionMarker?.add(glow);
  return glow;
}

function _updateSplashTargetVisual(now = performance.now()) {
  if (!_terminalSplashTargetGroup) _terminalSplashTargetGroup = _makeSplashTargetGroup();
  if (!_terminalSplashTargetGroup) return;
  if (!_terminalSplashTargetKm) {
    _terminalSplashTargetGroup.visible = false;
    return;
  }
  _terminalSplashTargetGroup.visible = true;
  _tmpVecA.set(kmToScene(_terminalSplashTargetKm[0]), kmToScene(_terminalSplashTargetKm[1]), kmToScene(_terminalSplashTargetKm[2]));
  const normal = _tmpVecB.copy(_tmpVecA).normalize();
  _terminalSplashTargetGroup.position.copy(_tmpVecA);
  _tmpVecC.set(0, 1, 0);
  if (Math.abs(_tmpVecC.dot(normal)) > 0.94) _tmpVecC.set(1, 0, 0);
  _tmpVecB.crossVectors(_tmpVecC, normal).normalize();
  _tmpVecC.crossVectors(normal, _tmpVecB).normalize();
  _terminalSplashTargetGroup.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(_tmpVecB, _tmpVecC, normal));
  const ring = _terminalSplashTargetGroup.userData?.ring;
  const pulse = _terminalSplashTargetGroup.userData?.pulse;
  const core = _terminalSplashTargetGroup.userData?.core;
  if (ring?.material) {
    ring.rotation.z += 0.004;
    ring.scale.setScalar(1 + Math.sin(now * 0.0018) * 0.06);
    ring.material.opacity = 0.42 + (Math.sin(now * 0.0024) * 0.16);
  }
  if (pulse?.material) {
    pulse.scale.setScalar(1 + Math.sin(now * 0.0032) * 0.16);
    pulse.material.opacity = 0.2 + (Math.sin(now * 0.0027) * 0.08);
  }
  if (core?.material) core.material.opacity = 0.8 + (Math.sin(now * 0.0032) * 0.12);
}

function _updateOrionTerminalVisualState() {
  if (!_terminalParachuteGroup) _terminalParachuteGroup = _makeParachuteGroup();
  if (!_terminalEntryGlowMesh) _terminalEntryGlowMesh = _makeEntryGlowMesh();
  const inEntry = _terminalVisualState === 'entry-interface' || _terminalVisualState === 'terminal-descent';
  const inDrogue = _terminalVisualState === 'drogue';
  const inMain = _terminalVisualState === 'main';
  const inSplash = _terminalVisualState === 'splashdown';
  if (_terminalEntryGlowMesh?.material) {
    _terminalEntryGlowMesh.visible = inEntry || inDrogue;
    _terminalEntryGlowMesh.material.opacity = inEntry ? 0.35 : (inDrogue ? 0.16 : 0);
  }
  if (_terminalParachuteGroup) {
    _terminalParachuteGroup.visible = inDrogue || inMain || inSplash;
    _setParachuteVisibility({
      showDrogue: inDrogue,
      showMain: inMain || inSplash,
      splashHold: inSplash,
    });
  }
}

function _tickTerminalSplashTarget(now = performance.now()) {
  _updateSplashTargetVisual(now);
  if (_terminalVisualState !== 'splashdown') return;
  _terminalBobbingPhase += 0.034;
}

function _setParachuteVisibility({ showDrogue, showMain, splashHold }) {
  const nodes = _terminalParachuteGroup?.userData?.nodes;
  if (!nodes) return;
  for (const chute of nodes.drogues || []) chute.visible = Boolean(showDrogue);
  for (const chute of nodes.mains || []) chute.visible = Boolean(showMain);
  for (const line of nodes.lines || []) {
    const canopy = line.userData?.parentCanopy || null;
    line.visible = Boolean(canopy?.visible);
  }
  _updateParachuteSuspensionLines(Boolean(splashHold));
}

function _updateParachuteSuspensionLines(splashHold = false) {
  const lines = _terminalParachuteGroup?.userData?.nodes?.lines || [];
  const verticalOffset = splashHold ? kmToScene(70) : kmToScene(84);
  const aftOffset = splashHold ? kmToScene(-20) : kmToScene(-28);
  for (const line of lines) {
    if (!line.visible) continue;
    const canopy = line.userData?.parentCanopy || null;
    if (!canopy) continue;
    const top = canopy.position.clone();
    const idx = Number(line.userData?.lineIdx || 0);
    const lateral = (idx - 1) * kmToScene(34) * (splashHold ? 0.55 : 1);
    const bottom = new THREE.Vector3(lateral, verticalOffset, aftOffset);
    line.geometry.dispose();
    line.geometry = new THREE.BufferGeometry().setFromPoints([top, bottom]);
  }
}

function makeLineFromSamples(samples, { color, opacity, linewidth = 1, dashed = false, dashSize = 0.06, gapSize = 0.04 }) {
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
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, transparent: true, opacity, linewidth, dashSize, gapSize })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity, linewidth });
  const line = new THREE.Line(geo, material);
  if (dashed) line.computeLineDistances();
  return line;
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

function _rebuildTraversedTrailCache(segments) {
  clearGroup(_traversedTrailGroup);
  const entries = [];
  for (const seg of segments || []) {
    const samples = seg?.samples || [];
    if (samples.length < 2) continue;
    const phase = _getTrajectoryPhaseForSegment(seg);
    const style = seg?.metadata?.modeled === true
      ? MODELED_TRAVERSED_STYLE
      : (phase === 'return' ? RETURN_TRAVERSED_STYLE : OUTBOUND_TRAVERSED_STYLE);
    const line = makeLineFromSamples(samples, {
      color: style.color,
      opacity: style.opacity,
      linewidth: 3.6,
      dashed: seg?.metadata?.modeled === true,
      dashSize: 0.045,
      gapSize: 0.04,
    });
    if (!line) continue;
    line.visible = false;
    line.geometry.setDrawRange(0, 0);
    _traversedTrailGroup.add(line);
    entries.push({
      line,
      sampleEpochMs: samples.map((sample) => sample.epochMs),
      lastDrawCount: 0,
    });
  }
  _traversedTrailCache = {
    sourceSegments: segments || null,
    entries,
  };
}

function _getTraversedCount(sampleEpochMs, currentMs) {
  if (!sampleEpochMs.length) return 0;
  const lastIdx = sampleEpochMs.length - 1;
  if (currentMs < sampleEpochMs[0]) return 0;
  if (currentMs >= sampleEpochMs[lastIdx]) return sampleEpochMs.length;
  let low = 0;
  let high = sampleEpochMs.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (sampleEpochMs[mid] <= currentMs) low = mid + 1;
    else high = mid;
  }
  return low;
}

function clearGroup(group) {
  while (group.children.length) {
    const child = group.children.pop();
    child.geometry?.dispose?.();
    child.material?.dispose?.();
  }
}

function _updateOrionVisualAttachments() {
  if (!_orionMarker) return;
  const pos = _orionMarker.position;
  const radiusKm = Math.hypot(pos.x, pos.y, pos.z) * 10_000;
  const altitudeKm = Math.max(0, radiusKm - EARTH_RADIUS_KM);
  const approachFactor = THREE.MathUtils.clamp(altitudeKm / 20_000, 0, 1);
  let scale = THREE.MathUtils.lerp(ORION_SCALE_EARTH_APPROACH_MIN, ORION_SCALE_DEFAULT, approachFactor);

  if (_terminalVisualState === 'drogue' || _terminalVisualState === 'main') {
    scale = Math.min(scale, 0.64);
  } else if (_terminalVisualState === 'splashdown') {
    scale = ORION_SCALE_SPLASHDOWN;
  }
  _orionMarker.scale.setScalar(scale);

  if (_terminalVisualState !== 'splashdown' || !Array.isArray(_terminalSplashTargetKm) || _terminalSplashTargetKm.length !== 3) return;
  const splashTarget = _terminalSplashTargetKm;
  const bobKm = Math.sin(_terminalBobbingPhase) * TERMINAL_SPLASH_BOB_KM;
  const len = Math.hypot(splashTarget[0], splashTarget[1], splashTarget[2]) || 1;
  _orionMarker.position.set(
    kmToScene(splashTarget[0] + ((splashTarget[0] / len) * bobKm)),
    kmToScene(splashTarget[1] + ((splashTarget[1] / len) * bobKm)),
    kmToScene(splashTarget[2] + ((splashTarget[2] / len) * bobKm)),
  );
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
      size: 0.56,
      sizeAttenuation: false,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      toneMapped: false,
    }),
  );
}

function _makeSunGlow(radiusScene) {
  _sunGlowTexture = _makeSunGlowTexture();
  if (!_sunGlowTexture) return null;
  const group = new THREE.Group();

  _sunGlowCoreMaterial = new THREE.SpriteMaterial({
    map: _sunGlowTexture,
    color: 0xfff7df,
    transparent: true,
    opacity: Math.min(1, 0.74 * SUN_BRIGHTNESS_MULTIPLIER),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const core = new THREE.Sprite(_sunGlowCoreMaterial);
  core.scale.set(radiusScene * SUN_GLOW_CORE_SCALE, radiusScene * SUN_GLOW_CORE_SCALE, 1);
  core.renderOrder = 4;
  group.add(core);

  _sunGlowMidMaterial = new THREE.SpriteMaterial({
    map: _sunGlowTexture,
    color: 0xffbe8f,
    transparent: true,
    opacity: Math.min(1, 0.46 * SUN_BRIGHTNESS_MULTIPLIER),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const mid = new THREE.Sprite(_sunGlowMidMaterial);
  mid.scale.set(radiusScene * SUN_GLOW_MID_SCALE, radiusScene * SUN_GLOW_MID_SCALE, 1);
  mid.renderOrder = 3;
  group.add(mid);

  _sunGlowOuterMaterial = new THREE.SpriteMaterial({
    map: _sunGlowTexture,
    color: 0xff8a57,
    transparent: true,
    opacity: Math.min(1, 0.24 * SUN_BRIGHTNESS_MULTIPLIER),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const outer = new THREE.Sprite(_sunGlowOuterMaterial);
  outer.scale.set(radiusScene * SUN_GLOW_OUTER_SCALE, radiusScene * SUN_GLOW_OUTER_SCALE, 1);
  outer.renderOrder = 2;
  group.add(outer);

  _sunGlowFlareMaterial = new THREE.SpriteMaterial({
    map: _sunGlowTexture,
    color: 0xff7a47,
    transparent: true,
    opacity: Math.min(1, 0.22 * SUN_BRIGHTNESS_MULTIPLIER),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    toneMapped: false,
  });
  const flare = new THREE.Sprite(_sunGlowFlareMaterial);
  flare.scale.set(radiusScene * SUN_GLOW_FLARE_WIDTH_SCALE, radiusScene * SUN_GLOW_FLARE_HEIGHT_SCALE, 1);
  flare.renderOrder = 1;
  group.add(flare);
  return group;
}

function _makeSunGlowTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const center = canvas.width * 0.5;
  const gradient = ctx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.1, 'rgba(255, 245, 212, 0.98)');
  gradient.addColorStop(0.24, 'rgba(255, 202, 141, 0.74)');
  gradient.addColorStop(0.48, 'rgba(255, 141, 88, 0.36)');
  gradient.addColorStop(1, 'rgba(255, 84, 35, 0)');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function _applySunGlowVisual(sunColorHex) {
  const sunColor = new THREE.Color(sunColorHex || 0xfff1bd);
  const warmCore = sunColor.clone().lerp(new THREE.Color(0xffffff), 0.35);
  const warmMid = sunColor.clone().lerp(new THREE.Color(0xff985f), 0.35);
  const warmOuter = sunColor.clone().lerp(new THREE.Color(0xff6b35), 0.58);
  if (_sunGlowCoreMaterial) _sunGlowCoreMaterial.color.copy(warmCore);
  if (_sunGlowMidMaterial) _sunGlowMidMaterial.color.copy(warmMid);
  if (_sunGlowOuterMaterial) _sunGlowOuterMaterial.color.copy(warmOuter);
  if (_sunGlowFlareMaterial) _sunGlowFlareMaterial.color.copy(warmOuter).lerp(new THREE.Color(0xffc08f), 0.2);
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
    color: 0xeaf1fb,
    emissive: 0x2a3649,
    shininess: 52,
    specular: 0xc3d2e6,
  });
  _orionNoseMaterial = new THREE.MeshPhongMaterial({
    color: 0xf6f9ff,
    emissive: 0x2d394b,
    shininess: 56,
    specular: 0xd1dded,
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
    color: 0xb6c2d6,
    emissive: 0x232d40,
    shininess: 28,
    specular: 0x7b88a3,
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
    color: 0xf0f4fb,
    emissive: 0x273246,
    shininess: 42,
    specular: 0xb2c2da,
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
  const bodyBase = new THREE.Color(0xeaf1fb);
  const noseBase = new THREE.Color(0xf6f9ff);
  const serviceBase = new THREE.Color(0xb6c2d6);
  const panelBase = new THREE.Color(0x4f6da6);
  const trussBase = new THREE.Color(0x8894a9);
  if (_orionBodyMaterial) {
    _orionBodyMaterial.color.copy(bodyBase).lerp(accent, 0.14);
    _orionBodyMaterial.emissive.copy(accent).multiplyScalar(0.12);
  }
  if (_orionNoseMaterial) {
    _orionNoseMaterial.color.copy(noseBase).lerp(accent, 0.08);
    _orionNoseMaterial.emissive.copy(accent).multiplyScalar(0.085);
  }
  if (_orionServiceMaterial) {
    _orionServiceMaterial.color.copy(serviceBase).lerp(accent, 0.12);
    _orionServiceMaterial.emissive.copy(accent).multiplyScalar(0.08);
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
    _orionSimpleMaterial.color.copy(bodyBase).lerp(accent, 0.14);
    _orionSimpleMaterial.emissive.copy(accent).multiplyScalar(0.1);
  }
  if (_orionPlumeMaterial) _orionPlumeMaterial.color.copy(accent).lerp(new THREE.Color(0x8fd4ff), 0.55);
}

function _makeOrionUsaDecal(radius, bodyRadius, bodyHeight) {
  if (!_orionUsaDecalTexture) _orionUsaDecalTexture = _makeOrionUsaDecalTexture();
  if (!_orionUsaDecalTexture) return null;
  const decal = new THREE.Mesh(
    new THREE.PlaneGeometry(radius * ORION_USA_DECAL_WIDTH_SCALE, radius * ORION_USA_DECAL_HEIGHT_SCALE),
    new THREE.MeshBasicMaterial({
      map: _orionUsaDecalTexture,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
      side: THREE.FrontSide,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    }),
  );
  decal.position.y = bodyHeight * ORION_USA_DECAL_Y_OFFSET_SCALE;
  decal.position.x = bodyRadius * ORION_USA_DECAL_OFFSET_SCALE;
  decal.rotation.y = Math.PI / 2;
  return decal;
}

function _makeOrionUsaDecalTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 320;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = '900 220px "Arial Black", "Segoe UI", sans-serif';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  ctx.strokeStyle = 'rgba(8, 14, 28, 0.9)';
  ctx.lineWidth = 22;
  ctx.strokeText('USA', canvas.width * 0.5, canvas.height * 0.54);
  ctx.fillStyle = '#f6fbff';
  ctx.fillText('USA', canvas.width * 0.5, canvas.height * 0.54);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = Math.min(8, _renderer?.capabilities?.getMaxAnisotropy?.() || 1);
  tex.needsUpdate = true;
  return tex;
}

function _addOrionUsaDecalsToRoot(orionRoot, radius) {
  if (!orionRoot) return;
  const bodyRadius = radius * ORION_USA_DECAL_BODY_RADIUS_SCALE;
  const bodyHeight = radius * ORION_USA_DECAL_BODY_HEIGHT_SCALE;
  const starboard = _makeOrionUsaDecal(radius, bodyRadius, bodyHeight);
  if (!starboard) return;
  const port = starboard.clone();
  port.material = starboard.material.clone();
  port.position.x = -bodyRadius * ORION_USA_DECAL_OFFSET_SCALE;
  port.rotation.y = -Math.PI / 2;
  orionRoot.add(starboard);
  orionRoot.add(port);
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

function _loadPlanetTextures(earthMat, moonMat, earthCloudMat) {
  const loader = new THREE.TextureLoader();
  _loadTexture(loader, PLANET_TEXTURE_URLS.earthColor, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    earthMat.map = tex;
    earthMat.needsUpdate = true;
  });
  _loadTexture(loader, PLANET_TEXTURE_URLS.earthNormal, (tex) => {
    earthMat.normalMap = tex;
    earthMat.normalScale = new THREE.Vector2(0.9, 0.9);
    earthMat.needsUpdate = true;
  });
  _loadTexture(loader, PLANET_TEXTURE_URLS.earthSpecular, (tex) => {
    earthMat.specularMap = tex;
    earthMat.needsUpdate = true;
  });
  _loadTexture(loader, PLANET_TEXTURE_URLS.earthClouds, (tex) => {
    tex.colorSpace = THREE.SRGBColorSpace;
    const cloudMaterial = earthCloudMat || _earthCloudMesh?.material;
    if (!cloudMaterial) return;
    cloudMaterial.map = tex;
    cloudMaterial.alphaMap = tex;
    cloudMaterial.needsUpdate = true;
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
  _tmpTarget.copy(_orionMarker.position);
  _followCameraDistanceScale = clampDistanceScale(_followCameraDistanceScale);
  const velocityDir = _tmpVelocityDir;
  if (_orionVelocityScene.lengthSq() > 1e-12) velocityDir.copy(_orionVelocityScene).normalize();
  else velocityDir.set(1, 0, 0);
  const isCinematic = _followCameraMode === 'cinematic';
  const isSide = _followCameraMode === 'side';
  const isEarthFrame = _followCameraMode === 'earth-frame';
  const isMoonFrame = _followCameraMode === 'moon-frame';
  const forwardLead = isCinematic ? 0.52 : (isSide ? 0.2 : 0.38);
  const upLift = isCinematic ? 0.74 : (isSide ? 0.48 : 0.55);
  const trailingDistance = isCinematic ? 1.7 : (isSide ? 1.15 : 1.35);
  _tmpSide.crossVectors(velocityDir, ORION_WORLD_UP).normalize();
  _tmpDesired
    .copy(_tmpTarget)
    .addScaledVector(velocityDir, -trailingDistance * _followCameraDistanceScale)
    .addScaledVector(ORION_WORLD_UP, upLift * _followCameraDistanceScale);
  if (isSide && _tmpSide.lengthSq() > 1e-8) {
    _tmpDesired.addScaledVector(_tmpSide, 1.35 * _followCameraDistanceScale);
  } else if (isEarthFrame) {
    _tmpDesired.copy(_tmpTarget).addScaledVector(EARTH_FRAME_CAMERA_OFFSET, _followCameraDistanceScale);
  } else if (isMoonFrame && _moonMesh) {
    _tmpTowardMoon.copy(_moonMesh.position).sub(_tmpTarget);
    if (_tmpTowardMoon.lengthSq() > 1e-8) _tmpTowardMoon.normalize();
    else _tmpTowardMoon.set(1, 0, 0);
    _tmpDesired
      .copy(_tmpTarget)
      .addScaledVector(_tmpTowardMoon, -1.45 * _followCameraDistanceScale)
      .addScaledVector(ORION_WORLD_UP, upLift * _followCameraDistanceScale);
  }
  _tmpDesiredTarget.copy(_tmpTarget).addScaledVector(velocityDir, forwardLead * _followCameraDistanceScale);
  const camLerp = isCinematic ? 0.05 : 0.075;
  const tgtLerp = isCinematic ? 0.09 : 0.12;
  _camera.position.lerp(_tmpDesired, camLerp);
  _controls.target.lerp(_tmpDesiredTarget, tgtLerp);
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
      _orionModelRoot.scale.setScalar(ORION_MODEL_SCALE);
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
  const { max: maxFollowDistance } = _getFollowDistanceLimits();
  const targetDistance = _followCameraEnabled
    ? THREE.MathUtils.lerp(_controls.minDistance, _controls.maxDistance, 0.2 + (_followCameraDistanceScale / maxFollowDistance) * 0.45)
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

function _tickEarthCloudRotation() {
  if (_earthCloudMesh) _earthCloudMesh.rotation.y += 0.00008;
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
  _sunLight.intensity = (SUN_DYNAMIC_LIGHT_BASE + (1 - norm) * SUN_DYNAMIC_LIGHT_VARIATION) * SUN_BRIGHTNESS_MULTIPLIER;
  _rimLight.intensity = 0.82 + norm * 0.52;
}

function _ensureSunScreenFlareOverlay(canvas) {
  if (typeof document === 'undefined' || !canvas?.parentElement) return;
  const host = canvas.parentElement;
  if (_sunScreenFlareEl?.parentElement !== host) {
    _sunScreenFlareEl?.remove?.();
    _sunScreenFlareEl = document.createElement('div');
    _sunScreenFlareEl.setAttribute('aria-hidden', 'true');
    _sunScreenFlareEl.style.position = 'absolute';
    _sunScreenFlareEl.style.left = '50%';
    _sunScreenFlareEl.style.top = '50%';
    _sunScreenFlareEl.style.width = `${SUN_SCREEN_FLARE_BASE_SIZE_PX}px`;
    _sunScreenFlareEl.style.height = `${SUN_SCREEN_FLARE_BASE_SIZE_PX}px`;
    _sunScreenFlareEl.style.borderRadius = '50%';
    _sunScreenFlareEl.style.pointerEvents = 'none';
    _sunScreenFlareEl.style.zIndex = '6';
    _sunScreenFlareEl.style.opacity = '0';
    _sunScreenFlareEl.style.transform = 'translate(-50%, -50%)';
    _sunScreenFlareEl.style.mixBlendMode = 'screen';
    _sunScreenFlareEl.style.transition = 'opacity 80ms linear';
    _sunScreenFlareEl.style.background = [
      'radial-gradient(circle at center, rgba(255, 252, 238, 0.72) 0%, rgba(255, 229, 170, 0.42) 16%, rgba(255, 173, 94, 0.24) 38%, rgba(255, 126, 64, 0.08) 60%, rgba(255, 126, 64, 0) 76%)',
      'radial-gradient(circle at center, rgba(255, 248, 214, 0.44) 0%, rgba(255, 248, 214, 0) 52%)',
      'linear-gradient(90deg, rgba(255, 220, 170, 0), rgba(255, 220, 170, 0.2), rgba(255, 220, 170, 0))',
    ].join(', ');
    _sunScreenFlareEl.style.boxShadow = '0 0 40px rgba(255, 204, 138, 0.4), 0 0 95px rgba(255, 145, 76, 0.26)';
    host.appendChild(_sunScreenFlareEl);
  }
}

function _updateSunScreenFlareOverlay() {
  if (!_sunScreenFlareEl || !_camera || !_sunMesh || !_renderer) return;
  const width = _renderer.domElement.clientWidth || _renderer.domElement.width || 0;
  const height = _renderer.domElement.clientHeight || _renderer.domElement.height || 0;
  if (!width || !height) {
    _sunScreenFlareEl.style.opacity = '0';
    return;
  }
  _sunMesh.getWorldPosition(_tmpSunWorld);
  _tmpSunNdc.copy(_tmpSunWorld).project(_camera);
  const inFrustum = _tmpSunNdc.z > -1 && _tmpSunNdc.z < 1 && Math.abs(_tmpSunNdc.x) <= 1 && Math.abs(_tmpSunNdc.y) <= 1;
  if (!inFrustum) {
    _sunScreenFlareEl.style.opacity = '0';
    return;
  }
  _camera.getWorldDirection(_tmpCameraForward);
  _tmpCameraToSun.copy(_tmpSunWorld).sub(_camera.position).normalize();
  const facing = THREE.MathUtils.clamp(_tmpCameraForward.dot(_tmpCameraToSun), 0, 1);
  const edge = THREE.MathUtils.clamp(1 - Math.max(Math.abs(_tmpSunNdc.x), Math.abs(_tmpSunNdc.y)), 0, 1);
  const opacity = Math.pow(edge, 1.35) * Math.pow(facing, 2.1) * SUN_SCREEN_FLARE_OPACITY_MAX;
  const xPx = (_tmpSunNdc.x * 0.5 + 0.5) * width;
  const yPx = (-_tmpSunNdc.y * 0.5 + 0.5) * height;
  const size = SUN_SCREEN_FLARE_BASE_SIZE_PX * (0.74 + (facing * 0.55) + (edge * 0.35));
  _sunScreenFlareEl.style.opacity = opacity.toFixed(3);
  _sunScreenFlareEl.style.left = `${xPx.toFixed(1)}px`;
  _sunScreenFlareEl.style.top = `${yPx.toFixed(1)}px`;
  _sunScreenFlareEl.style.width = `${size.toFixed(1)}px`;
  _sunScreenFlareEl.style.height = `${size.toFixed(1)}px`;
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
  if (_followCameraEnabled) {
    // Wheel/pinch deltas are applied by OrbitControls; capture result on next frame.
    requestAnimationFrame(() => {
      _syncFollowScaleFromCamera();
      _notifyZoomChange();
    });
    return;
  }
  _notifyZoomChange();
}

function clampDistanceScale(value) {
  const { min: minFollowDistance, max: maxFollowDistance } = _getFollowDistanceLimits();
  return THREE.MathUtils.clamp(value, minFollowDistance, maxFollowDistance);
}

function _getFollowDistanceLimits() {
  const isCinematic = _followCameraMode === 'cinematic';
  const phoneFriendlyCinematic = isCinematic
    && typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia(PHONE_FRIENDLY_MEDIA_QUERY).matches;
  const maxFollowDistance = isCinematic
    ? (phoneFriendlyCinematic ? FOLLOW_DISTANCE_MAX_PHONE_CINEMATIC : FOLLOW_DISTANCE_MAX_CINEMATIC)
    : FOLLOW_DISTANCE_MAX;
  return {
    min: FOLLOW_DISTANCE_MIN,
    max: maxFollowDistance,
  };
}

function _syncFollowScaleFromCamera() {
  if (!_followCameraEnabled || !_camera || !_orionMarker) return;
  const baseDistance = _getFollowCameraBaseDistance(_followCameraMode);
  if (!Number.isFinite(baseDistance) || baseDistance <= 1e-6) return;
  const cameraToOrion = _camera.position.distanceTo(_orionMarker.position);
  if (!Number.isFinite(cameraToOrion) || cameraToOrion <= 0) return;
  _followCameraDistanceScale = clampDistanceScale(cameraToOrion / baseDistance);
}

function _getFollowCameraBaseDistance(mode) {
  if (mode === 'cinematic') return Math.hypot(1.7, 0.74);
  if (mode === 'side') return Math.hypot(1.15, 0.48, 1.35);
  if (mode === 'earth-frame') return Math.hypot(0.95, 0.55, 1.05);
  if (mode === 'moon-frame') return Math.hypot(1.45, 0.55);
  return Math.hypot(1.35, 0.55);
}

function getVisualPresetSettings(preset) {
  if (preset === 'standard') {
    return {
      id: 'standard',
      baseExposure: 1.16,
      autoExposureSpread: 0.18,
      earthColor: 0xffffff,
      earthEmissive: 0x080b10,
      earthSpecular: 0x6f7d8b,
      earthShininess: 36,
      moonColor: 0xe0e6f3,
      moonEmissive: 0x414141,
      moonShininess: 9,
      orionColor: 0xffef84,
      orionHaloColor: 0xffefb9,
      orionHaloOpacity: 0.44,
      atmosphereColor: 0xb8d6ff,
      atmosphereOpacity: 0.18,
      cloudColor: 0xffffff,
      cloudOpacity: 0.58,
      sunColor: 0xfff1bd,
      starColor: 0xdeefff,
      starOpacity: 0.95,
      starSize: 0.56,
      bloom: BLOOM_STANDARD,
    };
  }
  if (preset === 'high-contrast') {
    return {
      id: 'high-contrast',
      baseExposure: 1.22,
      autoExposureSpread: 0.2,
      earthColor: 0xffffff,
      earthEmissive: 0x090d13,
      earthSpecular: 0x8a99a9,
      earthShininess: 42,
      moonColor: 0xf5f6ff,
      moonEmissive: 0x3b3b3b,
      moonShininess: 12,
      orionColor: 0xfff59a,
      orionHaloColor: 0xfff4cf,
      orionHaloOpacity: 0.53,
      atmosphereColor: 0xc8e1ff,
      atmosphereOpacity: 0.2,
      cloudColor: 0xffffff,
      cloudOpacity: 0.64,
      sunColor: 0xfff3c8,
      starColor: 0xf1f7ff,
      starOpacity: 1,
      starSize: 0.6,
      bloom: BLOOM_CONTRAST,
    };
  }
  return {
    id: 'bright',
    baseExposure: 1.28,
    autoExposureSpread: 0.22,
    earthColor: 0xffffff,
    earthEmissive: 0x090d12,
    earthSpecular: 0x7a8796,
    earthShininess: 38,
    moonColor: 0xf0f2ff,
    moonEmissive: 0x4d4d4d,
    moonShininess: 10,
    orionColor: 0xfff18f,
    orionHaloColor: 0xfff3c0,
    orionHaloOpacity: 0.5,
    atmosphereColor: 0xc1dcff,
    atmosphereOpacity: 0.19,
    cloudColor: 0xffffff,
    cloudOpacity: 0.61,
    sunColor: 0xfff1bb,
    starColor: 0xe7f3ff,
    starOpacity: 1,
    starSize: 0.6,
    bloom: BLOOM_BRIGHT,
  };
}

function _applyBloomSettings(bloom) {
  if (!_bloomPass) return;
  const config = bloom || BLOOM_DISABLED;
  _bloomPass.strength = Number.isFinite(config.strength) ? config.strength : 0;
  _bloomPass.radius = Number.isFinite(config.radius) ? config.radius : 0;
  _bloomPass.threshold = Number.isFinite(config.threshold) ? config.threshold : 1;
  _refreshBloomEnabled();
}

function _refreshBloomEnabled() {
  if (!_bloomPass) return;
  const bloomAllowed = !_sceneLoadSmoothing
    && _performanceEffectiveMode !== 'low'
    && _visualPresetConfig?.bloom?.enabled !== false;
  _bloomPass.enabled = bloomAllowed;
}

function _notifyZoomChange() {
  if (!_zoomChangeListener) return;
  _zoomChangeListener();
}
