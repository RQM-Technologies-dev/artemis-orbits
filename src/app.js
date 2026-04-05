/**
 * app.js – main entry point for the Artemis orbit viewer.
 */

import { MISSIONS, ACTIVE_MISSION_ID } from './config/missions.js';
import {
  createScene,
  updateBodies,
  setMissionTrailsBySegment,
  setTraversedTrailBySegment,
  setMoonTrajectoryBySegment,
  setEventMarkers,
  focusCameraPreset,
  resizeScene,
  renderScene,
  resetSceneDynamicState,
  showFallbackBodies,
  setPerformanceMode,
  setFollowCameraEnabled,
  setFollowCameraMode,
  setEventMarkerClickHandler,
  setZoomChangeListener,
  zoomCamera,
  setZoomLevel,
  getZoomLevel,
  resetZoom,
  setVisualPreset,
  getVisualPreset,
  setOrionManeuverLevel,
  setActiveEventCallout,
  setOrionAttitudeReference,
  captureSceneImage,
  recenterFollowCamera,
  snapCameraToEventView,
} from './lib/scene.js';
import {
  loadMissionData,
  loadJson,
  flattenSamples,
  findSegment,
  findSampleIndex,
  getMissionTimeBounds,
  sortEvents,
  getEventContext,
} from './lib/dataLoader.js';
import { interpolateSegment } from './lib/interpolate.js';
import { formatUtc, formatMet, clamp } from './lib/time.js';

const MS_PER_H = 3_600_000;
const MS_PER_D = 86_400_000;
const EVENT_NAV_EPS_MS = 1;
const MANEUVER_WINDOW_MS = 25 * 60_000;
const EVENT_CALLOUT_WINDOW_MS = 8 * 60_000;
const TTS_SERVICE_BASE_URL = 'https://rqm-api.onrender.com';
const TTS_SPEAK_COOLDOWN_MS = 15_000;
const LIVE_SYNC_EPS_MS = 250;

const SPEED_OPTIONS = [
  { label: '1x real time', missionMsPerWallSecond: 1000 },
  { label: '1 min/sec', missionMsPerWallSecond: 60_000 },
  { label: '10 min/sec', missionMsPerWallSecond: 600_000 },
  { label: '1 hr/sec', missionMsPerWallSecond: 3_600_000 },
  { label: '6 hr/sec', missionMsPerWallSecond: 21_600_000 },
  { label: '12 hr/sec', missionMsPerWallSecond: 43_200_000 },
  { label: '1 day/sec', missionMsPerWallSecond: 86_400_000 },
];

const VISUAL_PRESET_OPTIONS = [
  { value: 'standard', label: 'Standard' },
  { value: 'bright', label: 'Bright' },
  { value: 'high-contrast', label: 'High contrast' },
];
const CONTROLS_HINT_STORAGE_KEY = 'artemis-controls-hint-dismissed';
const DEFAULT_FOLLOW_MODE_BY_MISSION = {
  'artemis-2': 'cinematic',
};
const LUNAR_ORBIT_PERIOD_MS = Math.round(27.321661 * 24 * 60 * 60 * 1000);
const ARTEMIS_II_FULL_MOON_ORBIT_POINTS = 540;
const ARTEMIS_3_MODEL_PATH = './data/models/artemis-3-mission-model.json';
const ARTEMIS_3_PROFILE_DEFAULT = 'current-leo';
const ARTEMIS_3_PROFILE_MODES = ['current-leo', 'legacy-cislunar', 'legacy-nrho-detail'];
const ARTEMIS_5_MODEL_PATH = './data/models/artemis-5-mission-model.json';
const ARTEMIS_5_PROFILE_DEFAULT = 'current-mission';
const ARTEMIS_5_PROFILE_MODES = [
  'current-mission',
  'current-nrho-detail',
  'archived-detailed-profile',
  'archived-nrho-detail',
];
const LANDING_DEFAULTS = Object.freeze({
  missionId: ACTIVE_MISSION_ID,
  speedMissionMsPerWallSecond: 3_600_000,
  performanceMode: 'auto',
  followCamera: true,
  attitudeReference: 'velocity',
  eventVoiceEnabled: false,
  eventVoiceVolume: 0,
  cameraPreset: 'follow-orion',
  zoomLevel: 0.843,
  visualPreset: 'standard',
  liveMode: false,
});
const LANDING_DEFAULT_UTC_BY_MISSION = Object.freeze({
  'artemis-2': '2026-04-02T01:57:37Z',
});

function getDefaultFollowModeForMission(missionId) {
  return DEFAULT_FOLLOW_MODE_BY_MISSION[missionId] || 'chase';
}

const state = {
  activeMissionId: ACTIVE_MISSION_ID,
  missionData: null,
  moonData: null,
  events: [],
  missionPhases: [],
  eventMarkers: [],
  missionStartMs: 0,
  missionStopMs: 0,
  currentMs: 0,
  flatSamples: [],
  playing: false,
  scrubbing: false,
  diagnostics: {
    sceneInitialized: false,
    rendererInitialized: false,
    missionJsonLoaded: false,
    moonJsonLoaded: false,
    eventsLoaded: false,
    lastError: '',
  },
  artemis3: {
    model: null,
    profileMode: ARTEMIS_3_PROFILE_DEFAULT,
  },
  artemis5: {
    model: null,
    profileMode: ARTEMIS_5_PROFILE_DEFAULT,
  },
  ui: {
    performanceMode: LANDING_DEFAULTS.performanceMode,
    followCamera: true,
    followCameraMode: getDefaultFollowModeForMission(ACTIVE_MISSION_ID),
    attitudeReference: LANDING_DEFAULTS.attitudeReference,
    eventVoiceEnabled: LANDING_DEFAULTS.eventVoiceEnabled,
    eventVoiceVolume: LANDING_DEFAULTS.eventVoiceVolume,
    cameraPreset: LANDING_DEFAULTS.cameraPreset,
    lastNonFollowCamera: 'mission-fit',
    visualPreset: LANDING_DEFAULTS.visualPreset,
    zoomLevel: LANDING_DEFAULTS.zoomLevel,
    liveMode: LANDING_DEFAULTS.liveMode,
    artemis3Mode: ARTEMIS_3_PROFILE_DEFAULT,
    artemis5Mode: ARTEMIS_5_PROFILE_DEFAULT,
  },
};

let refs = null;
let _lastSyncedUrl = '';
let _lastZoomUiValue = -1;
let _ttsVoiceCache = new Map();
let _ttsInFlight = new Set();
let _spokenEvents = new Map();
let _currentTtsAudio = null;
let _pendingDefaultLandingUtc = null;

bootstrapApp();

function bootstrapApp() {
  try {
    refs = getDomRefs();
    try {
      createScene(refs.canvas);
      setZoomChangeListener(() => syncZoomUiFromScene(true));
      state.diagnostics.sceneInitialized = true;
      state.diagnostics.rendererInitialized = true;
    } catch (error) {
      handleStartupError('Scene creation failed', error);
      return;
    }
    updateDebugOverlay();

    showFallbackBodies();
    focusCameraPreset('fallback-overview');

    buildSpeedOptions();
    buildPerformanceOptions();
    buildVisualPresetOptions();
    buildTabs();
    wireUiEvents();
    parseInitialUiStateFromUrl();
    syncZoomUiFromScene(true);
    showControlsHintIfNeeded();

    selectMission(state.activeMissionId)
      .catch((error) => handleStartupError('Mission loading failed', error));

    startRafLoop();
    window.addEventListener('resize', onResize);
    onResize();
    scheduleStartupResizeRetries();
  } catch (error) {
    handleStartupError('Bootstrap failed', error);
  }
}

function getDomRefs() {
  const pick = (id) => {
    const node = document.getElementById(id);
    if (!node) throw new Error(`Missing required DOM node: #${id}`);
    return node;
  };
  const pickOptional = (id) => document.getElementById(id);

  return {
    tabBar: pick('mission-tabs'),
    canvas: pick('three-canvas'),
    btnSceneStartMission: pickOptional('btn-scene-start-mission'),
    overlayMsg: pick('scene-overlay-msg'),
    sceneDisclaimer: pickOptional('scene-mode-disclaimer'),
    debugOverlay: pickOptional('scene-debug-overlay'),
    sbTitle: pick('sb-mission-title'),
    sbSummary: pick('sb-mission-summary'),
    sbStatus: pick('sb-status-msg'),
    sbUtc: pick('sb-utc'),
    sbMet: pick('sb-met'),
    sbFrame: pick('sb-frame'),
    sbSampleCount: pick('sb-sample-count'),
    sbPhase: pickOptional('sb-phase'),
    sbSpeed: pickOptional('sb-speed'),
    sbEarthDist: pickOptional('sb-earth-dist'),
    sbMoonDist: pickOptional('sb-moon-dist'),
    sbNextEvent: pickOptional('sb-next-event'),
    sbEvent: pick('sb-current-event'),
    btnPlay: pick('btn-play'),
    btnReset: pick('btn-reset'),
    btnJumpStart: pick('btn-jump-start'),
    btnJumpEnd: pick('btn-jump-end'),
    btnPrevEvent: pickOptional('btn-prev-event'),
    btnNextEvent: pickOptional('btn-next-event'),
    btnMinus1h: pickOptional('btn-minus-1h'),
    btnPlus1h: pickOptional('btn-plus-1h'),
    btnMinus1d: pickOptional('btn-minus-1d'),
    btnPlus1d: pickOptional('btn-plus-1d'),
    btnLive: pickOptional('btn-live'),
    speedSelect: pick('speed-select'),
    timelineSlider: pick('timeline-slider'),
    timelineTicks: pick('timeline-ticks'),
    btnCamEarth: pick('btn-cam-earth'),
    btnCamMoon: pick('btn-cam-moon'),
    btnCamFit: pick('btn-cam-fit'),
    btnCamFollow: pick('btn-cam-follow'),
    btnCamRecenter: pickOptional('btn-cam-recenter'),
    btnCamSnapEvent: pickOptional('btn-cam-snap-event'),
    followModeSelect: pickOptional('follow-mode-select'),
    attitudeSelect: pickOptional('attitude-select'),
    btnZoomIn: pick('btn-zoom-in'),
    btnZoomOut: pick('btn-zoom-out'),
    btnZoomReset: pick('btn-zoom-reset'),
    zoomSlider: pick('zoom-slider'),
    zoomValue: pick('zoom-value'),
    visualPresetSelect: pick('visual-preset-select'),
    perfModeSelect: pick('perf-select'),
    btnCopyLink: pick('btn-copy-link'),
    btnShareX: pickOptional('btn-share-x'),
    btnShareReddit: pickOptional('btn-share-reddit'),
    btnShareLinkedin: pickOptional('btn-share-linkedin'),
    btnShareEmail: pickOptional('btn-share-email'),
    embedLinkOutput: pickOptional('embed-link-output'),
    embedIframeOutput: pickOptional('embed-iframe-output'),
    btnCopyEmbedLink: pickOptional('btn-copy-embed-link'),
    btnCopyEmbedIframe: pickOptional('btn-copy-embed-iframe'),
    controlsHint: pick('controls-hint'),
    btnDismissHint: pick('btn-dismiss-hint'),
    btnCapture: pickOptional('btn-export-image'),
    chkEventVoice: pickOptional('chk-event-voice'),
    btnTtsToggle: pickOptional('btn-tts-toggle'),
    voiceVolumeSlider: pickOptional('voice-volume-slider') || pickOptional('tts-volume'),
    voiceVolumeValue: pickOptional('voice-volume-value'),
    ttsStatus: pickOptional('tts-status'),
    annotationList: pick('mission-annotations'),
    artemis3Card: pickOptional('artemis3-card'),
    artemis3Subtitle: pickOptional('artemis3-subtitle'),
    artemis3StatusBadge: pickOptional('artemis3-status-badge'),
    artemis3ProfileNote: pickOptional('artemis3-profile-note'),
    btnA3Current: pickOptional('btn-a3-current'),
    btnA3Legacy: pickOptional('btn-a3-legacy'),
    btnA3Nrho: pickOptional('btn-a3-nrho'),
    artemis3SummaryList: pickOptional('artemis3-summary-list'),
    artemis3PhaseList: pickOptional('artemis3-phase-list'),
    artemis3FactsList: pickOptional('artemis3-facts-list'),
    artemis3LandingSection: pickOptional('artemis3-landing-section'),
    artemis3LandingList: pickOptional('artemis3-landing-list'),
    a3SourcesOfficial: pickOptional('a3-sources-official'),
    a3SourcesArchived: pickOptional('a3-sources-archived'),
    a3SourcesProxy: pickOptional('a3-sources-proxy'),
    artemis5Card: pickOptional('artemis5-card'),
    artemis5Subtitle: pickOptional('artemis5-subtitle'),
    artemis5StatusBadge: pickOptional('artemis5-status-badge'),
    artemis5ProfileNote: pickOptional('artemis5-profile-note'),
    btnA5Current: pickOptional('btn-a5-current'),
    btnA5CurrentNrho: pickOptional('btn-a5-current-nrho'),
    btnA5Archived: pickOptional('btn-a5-archived'),
    btnA5ArchivedNrho: pickOptional('btn-a5-archived-nrho'),
    artemis5SummaryList: pickOptional('artemis5-summary-list'),
    artemis5PhaseList: pickOptional('artemis5-phase-list'),
    artemis5FactsList: pickOptional('artemis5-facts-list'),
    artemis5MoonbaseList: pickOptional('artemis5-moonbase-list'),
    a5SourcesOfficial: pickOptional('a5-sources-official'),
    a5SourcesArchived: pickOptional('a5-sources-archived'),
    a5SourcesProxy: pickOptional('a5-sources-proxy'),
    a5SourcesMoonbase: pickOptional('a5-sources-moonbase'),
    a5SourcesDrift: pickOptional('a5-sources-drift'),
  };
}

function getEventTypeClass(type) {
  const t = String(type || '').toLowerCase();
  if (t.includes('burn') || t.includes('maneuver')) return 'burn';
  if (t.includes('boundary')) return t.includes('system') ? 'system-boundary' : 'data-boundary';
  return 'milestone';
}

function formatDistanceKm(distanceKm) {
  if (!Number.isFinite(distanceKm)) return '—';
  if (distanceKm >= 1_000_000) return `${(distanceKm / 1_000_000).toFixed(3)}M km`;
  return `${Math.round(distanceKm).toLocaleString('en-US')} km`;
}

function formatSpeedKmS(speedKmS) {
  if (!Number.isFinite(speedKmS)) return '—';
  return `${speedKmS.toFixed(3)} km/s`;
}

function formatCountdownToEvent(eventMs, nowMs) {
  const diffMs = eventMs - nowMs;
  const sign = diffMs >= 0 ? 'T-' : 'T+';
  const abs = Math.abs(diffMs);
  const totalSec = Math.floor(abs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return `${sign}${String(h).padStart(2, '0')}h ${String(m).padStart(2, '0')}m ${String(s).padStart(2, '0')}s`;
}

function _isFiniteVec3(vec) {
  return Array.isArray(vec)
    && vec.length === 3
    && Number.isFinite(vec[0])
    && Number.isFinite(vec[1])
    && Number.isFinite(vec[2]);
}

function _vec3Length(vec) {
  return Math.hypot(vec[0], vec[1], vec[2]);
}

function _vec3Dot(a, b) {
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

function _vec3Cross(a, b) {
  return [
    (a[1] * b[2]) - (a[2] * b[1]),
    (a[2] * b[0]) - (a[0] * b[2]),
    (a[0] * b[1]) - (a[1] * b[0]),
  ];
}

function _vec3Normalize(vec) {
  const len = _vec3Length(vec);
  if (!Number.isFinite(len) || len <= 1e-12) return null;
  return [vec[0] / len, vec[1] / len, vec[2] / len];
}

function _vec3Scale(vec, scalar) {
  return [vec[0] * scalar, vec[1] * scalar, vec[2] * scalar];
}

function _vec3Add(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function _vec3Sub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function _projectOntoPlane(vec, normalUnit) {
  return _vec3Sub(vec, _vec3Scale(normalUnit, _vec3Dot(vec, normalUnit)));
}

function buildFullMoonOrbitSegment(moonData) {
  const moonSamples = flattenSamples(moonData).filter((sample) => _isFiniteVec3(sample?.positionKm));
  if (moonSamples.length < 3) return null;

  let angularMomentum = [0, 0, 0];
  for (const sample of moonSamples) {
    if (!_isFiniteVec3(sample.velocityKmS)) continue;
    const h = _vec3Cross(sample.positionKm, sample.velocityKmS);
    angularMomentum = _vec3Add(angularMomentum, h);
  }
  if (_vec3Length(angularMomentum) <= 1e-9) {
    for (let i = 1; i < moonSamples.length; i++) {
      const h = _vec3Cross(moonSamples[i - 1].positionKm, moonSamples[i].positionKm);
      angularMomentum = _vec3Add(angularMomentum, h);
    }
  }

  const orbitNormal = _vec3Normalize(angularMomentum);
  if (!orbitNormal) return null;

  const firstPos = moonSamples[0].positionKm;
  const projectedFirstPos = _projectOntoPlane(firstPos, orbitNormal);
  let basisU = _vec3Normalize(projectedFirstPos);
  if (!basisU) {
    const fallback = Math.abs(orbitNormal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    basisU = _vec3Normalize(_vec3Cross(orbitNormal, fallback));
  }
  if (!basisU) return null;

  let basisV = _vec3Normalize(_vec3Cross(orbitNormal, basisU));
  if (!basisV) return null;
  if (_isFiniteVec3(moonSamples[0].velocityKmS) && _vec3Dot(basisV, moonSamples[0].velocityKmS) < 0) {
    basisV = _vec3Scale(basisV, -1);
  }

  let radiusSum = 0;
  for (const sample of moonSamples) radiusSum += _vec3Length(sample.positionKm);
  const averageRadiusKm = radiusSum / moonSamples.length;
  if (!Number.isFinite(averageRadiusKm) || averageRadiusKm <= 0) return null;

  const startEpochMs = Number.isFinite(moonSamples[0].epochMs) ? moonSamples[0].epochMs : 0;
  const samples = [];
  for (let i = 0; i <= ARTEMIS_II_FULL_MOON_ORBIT_POINTS; i++) {
    const t = i / ARTEMIS_II_FULL_MOON_ORBIT_POINTS;
    const theta = t * Math.PI * 2;
    const pos = _vec3Add(
      _vec3Scale(basisU, averageRadiusKm * Math.cos(theta)),
      _vec3Scale(basisV, averageRadiusKm * Math.sin(theta)),
    );
    samples.push({
      epochMs: Math.round(startEpochMs + (LUNAR_ORBIT_PERIOD_MS * t)),
      positionKm: pos,
    });
  }

  return {
    id: 'artemis-2-full-lunar-orbit',
    metadata: {
      objectName: 'Moon (full orbit approximation)',
      interpolation: 'derived-circular-orbit',
    },
    samples,
  };
}

function getMoonTrajectorySegmentsForRender(missionId, moonData) {
  const segments = moonData?.segments || [];
  if (missionId !== 'artemis-2') return segments;
  const fullOrbitSegment = buildFullMoonOrbitSegment(moonData);
  return fullOrbitSegment ? [fullOrbitSegment] : segments;
}

function buildMissionPhases(events, missionStartMs, missionStopMs) {
  if (!Number.isFinite(missionStartMs) || !Number.isFinite(missionStopMs) || missionStopMs <= missionStartMs) return [];
  const sorted = [...(events || [])].sort((a, b) => a.epochMs - b.epochMs);
  let lunarStartMs = null;
  let returnStartMs = null;
  for (const event of sorted) {
    const label = `${event.label || ''} ${event.type || ''}`.toLowerCase();
    if (lunarStartMs == null && (label.includes('flyby') || label.includes('retrograde') || label.includes('lunar'))) {
      lunarStartMs = event.epochMs;
    }
    if (returnStartMs == null && (label.includes('return') || label.includes('departure') || label.includes('entry') || label.includes('reentry'))) {
      returnStartMs = event.epochMs;
    }
  }
  const span = missionStopMs - missionStartMs;
  if (lunarStartMs == null) lunarStartMs = missionStartMs + (span * 0.33);
  if (returnStartMs == null) returnStartMs = missionStartMs + (span * 0.66);
  lunarStartMs = clamp(lunarStartMs, missionStartMs, missionStopMs);
  returnStartMs = clamp(returnStartMs, lunarStartMs, missionStopMs);
  return [
    { id: 'outbound', label: 'Outbound coast', startMs: missionStartMs, stopMs: lunarStartMs },
    { id: 'lunar', label: 'Lunar flyby operations', startMs: lunarStartMs, stopMs: returnStartMs },
    { id: 'return', label: 'Return and Earth approach', startMs: returnStartMs, stopMs: missionStopMs },
  ];
}

function getMissionPhase(currentMs) {
  if (!state.missionPhases.length) return null;
  for (const phase of state.missionPhases) {
    if (currentMs >= phase.startMs && currentMs <= phase.stopMs) return phase;
  }
  if (currentMs < state.missionPhases[0].startMs) return state.missionPhases[0];
  return state.missionPhases[state.missionPhases.length - 1];
}

function getCurrentTelemetryValues(orionState, moonState, eventCtx) {
  const phase = getMissionPhase(state.currentMs);
  const speedKmS = Array.isArray(orionState?.velocityKmS)
    ? Math.hypot(orionState.velocityKmS[0], orionState.velocityKmS[1], orionState.velocityKmS[2])
    : null;
  const earthDistKm = Array.isArray(orionState?.positionKm)
    ? Math.hypot(orionState.positionKm[0], orionState.positionKm[1], orionState.positionKm[2])
    : null;
  const moonDistKm = (Array.isArray(orionState?.positionKm) && Array.isArray(moonState?.positionKm))
    ? Math.hypot(
      orionState.positionKm[0] - moonState.positionKm[0],
      orionState.positionKm[1] - moonState.positionKm[1],
      orionState.positionKm[2] - moonState.positionKm[2],
    )
    : null;
  const nextEvent = eventCtx?.next || null;
  return {
    phaseLabel: phase?.label || 'Mission timeline',
    speedLabel: formatSpeedKmS(speedKmS),
    earthDistLabel: formatDistanceKm(earthDistKm),
    moonDistLabel: formatDistanceKm(moonDistKm),
    nextEventLabel: nextEvent ? `${nextEvent.label}${eventVerificationTag(nextEvent)} ${formatCountdownToEvent(nextEvent.epochMs, state.currentMs)}` : '—',
  };
}

function refreshTelemetryOverlay(values) {
  if (refs.sbPhase) refs.sbPhase.textContent = `Phase: ${values.phaseLabel}`;
  if (refs.sbSpeed) refs.sbSpeed.textContent = values.speedLabel;
  if (refs.sbEarthDist) refs.sbEarthDist.textContent = values.earthDistLabel;
  if (refs.sbMoonDist) refs.sbMoonDist.textContent = values.moonDistLabel;
  if (refs.sbNextEvent) refs.sbNextEvent.textContent = values.nextEventLabel;
}

function buildSpeedOptions() {
  refs.speedSelect.innerHTML = '';
  for (const opt of SPEED_OPTIONS) {
    const option = document.createElement('option');
    option.value = String(opt.missionMsPerWallSecond);
    option.textContent = opt.label;
    if (opt.label === '1 hr/sec') option.selected = true;
    refs.speedSelect.appendChild(option);
  }
}

function buildPerformanceOptions() {
  refs.perfModeSelect.innerHTML = '';
  const options = [
    { value: 'auto', label: 'Auto' },
    { value: 'balanced', label: 'Balanced' },
    { value: 'high', label: 'High quality' },
    { value: 'low', label: 'Low power' },
  ];
  for (const opt of options) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === state.ui.performanceMode) option.selected = true;
    refs.perfModeSelect.appendChild(option);
  }
}

function buildVisualPresetOptions() {
  refs.visualPresetSelect.innerHTML = '';
  for (const opt of VISUAL_PRESET_OPTIONS) {
    const option = document.createElement('option');
    option.value = opt.value;
    option.textContent = opt.label;
    if (opt.value === getVisualPreset()) option.selected = true;
    refs.visualPresetSelect.appendChild(option);
  }
}

function buildTabs() {
  refs.tabBar.innerHTML = '';
  for (const m of MISSIONS) {
    const btn = document.createElement('button');
    btn.textContent = m.displayName;
    btn.className = 'tab-btn' + (m.enabled ? '' : ' tab-disabled');
    btn.dataset.id = m.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-selected', 'false');
    if (!m.enabled) btn.setAttribute('aria-disabled', 'true');
    btn.addEventListener('click', () => {
      if (!m.enabled) return;
      selectMission(m.id).catch((error) => handleStartupError('Mission switch failed', error));
    });
    refs.tabBar.appendChild(btn);
  }
}

function buildArtemis3ProfileToggle() {
  const isArtemis3 = state.activeMissionId === 'artemis-3';
  if (!refs.artemis3Card) return;
  refs.artemis3Card.classList.toggle('hidden', !isArtemis3);
  const mode = state.ui.artemis3Mode;
  const map = [
    [refs.btnA3Current, 'current-leo'],
    [refs.btnA3Legacy, 'legacy-cislunar'],
    [refs.btnA3Nrho, 'legacy-nrho-detail'],
  ];
  for (const [btn, key] of map) {
    if (!btn) continue;
    const active = key === mode;
    btn.classList.toggle('is-toggled', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}

function setSceneModeDisclaimer(text = '', { tone = 'warn' } = {}) {
  if (!refs.sceneDisclaimer) return;
  const normalized = String(text || '').trim();
  if (!normalized) {
    refs.sceneDisclaimer.textContent = '';
    refs.sceneDisclaimer.classList.add('hidden');
    refs.sceneDisclaimer.classList.remove('disclaimer-official', 'disclaimer-archived');
    return;
  }
  refs.sceneDisclaimer.textContent = normalized;
  refs.sceneDisclaimer.classList.remove('hidden');
  refs.sceneDisclaimer.classList.toggle('disclaimer-official', tone === 'official');
  refs.sceneDisclaimer.classList.toggle('disclaimer-archived', tone === 'archived');
}

async function loadArtemis3Model() {
  if (state.artemis3.model) return state.artemis3.model;
  const loaded = await loadJson(ARTEMIS_3_MODEL_PATH);
  state.artemis3.model = loaded || null;
  return state.artemis3.model;
}

function getArtemis3ProfileConfig(mission, mode) {
  const profiles = mission?.artemis3Profiles || {};
  if (profiles[mode]) return profiles[mode];
  return profiles[ARTEMIS_3_PROFILE_DEFAULT] || null;
}

function getMissionDataPaths(mission) {
  if (mission?.id !== 'artemis-3' && mission?.id !== 'artemis-5') {
    return {
      normalizedPath: mission?.normalizedPath || null,
      moonPath: mission?.moonPath || null,
      eventsPath: mission?.eventsPath || null,
      mode: null,
    };
  }
  if (mission?.id === 'artemis-5') {
    const mode = ARTEMIS_5_PROFILE_MODES.includes(state.ui.artemis5Mode)
      ? state.ui.artemis5Mode
      : ARTEMIS_5_PROFILE_DEFAULT;
    const profile = getArtemis5ProfileConfig(mission, mode);
    if (!profile) {
      return {
        normalizedPath: mission.normalizedPath,
        moonPath: mission.moonPath,
        eventsPath: mission.eventsPath,
        mode: ARTEMIS_5_PROFILE_DEFAULT,
      };
    }
    return {
      normalizedPath: profile.normalizedPath,
      moonPath: profile.moonPath,
      eventsPath: profile.eventsPath,
      mode,
    };
  }
  const mode = ARTEMIS_3_PROFILE_MODES.includes(state.ui.artemis3Mode)
    ? state.ui.artemis3Mode
    : ARTEMIS_3_PROFILE_DEFAULT;
  const profile = getArtemis3ProfileConfig(mission, mode);
  if (!profile) {
    return {
      normalizedPath: mission.normalizedPath,
      moonPath: mission.moonPath,
      eventsPath: mission.eventsPath,
      mode: ARTEMIS_3_PROFILE_DEFAULT,
    };
  }
  return {
    normalizedPath: profile.normalizedPath,
    moonPath: profile.moonPath,
    eventsPath: profile.eventsPath,
    mode,
  };
}

async function switchArtemis3Profile(nextMode) {
  if (state.activeMissionId !== 'artemis-3') return;
  const normalized = ARTEMIS_3_PROFILE_MODES.includes(nextMode) ? nextMode : ARTEMIS_3_PROFILE_DEFAULT;
  if (state.ui.artemis3Mode === normalized) {
    buildArtemis3ProfileToggle();
    renderArtemis3Content();
    return;
  }
  state.ui.artemis3Mode = normalized;
  state.artemis3.profileMode = normalized;
  syncUrlState();
  await selectMission('artemis-3');
}

function renderArtemis3Content() {
  if (!refs.artemis3Card) return;
  const isArtemis3 = state.activeMissionId === 'artemis-3';
  refs.artemis3Card.classList.toggle('hidden', !isArtemis3);
  if (!isArtemis3) {
    setSceneModeDisclaimer('', { tone: 'warn' });
    return;
  }

  const model = state.artemis3.model || {};
  const current = model.current_official || {};
  const legacy = model.legacy_lunar_profile || {};
  const mode = ARTEMIS_3_PROFILE_MODES.includes(state.ui.artemis3Mode)
    ? state.ui.artemis3Mode
    : ARTEMIS_3_PROFILE_DEFAULT;

  const descriptor = {
    'current-leo': {
      subtitle: '2027 low Earth orbit rendezvous and docking demonstration',
      badge: 'Current official mission',
      badgeClass: 'a3-badge-official',
      note: 'Notional visualization — NASA has not yet released the exact Artemis III orbit.',
      disclaimerTone: 'official',
    },
    'legacy-cislunar': {
      subtitle: 'Archived lunar south-pole profile (legacy NASA architecture)',
      badge: 'Archived legacy profile',
      badgeClass: 'a3-badge-archived',
      note: 'Archived/legacy lunar trajectory shown with proxy-derived NRHO staging behavior. Not exact Artemis III ephemeris.',
      disclaimerTone: 'archived',
    },
    'legacy-nrho-detail': {
      subtitle: 'Archived NRHO detail (representative proxy cycle)',
      badge: 'Proxy-derived NRHO view',
      badgeClass: 'a3-badge-proxy',
      note: 'Representative single-revolution southern 9:2 NRHO cycle from public NASA sample data. Not exact Artemis III ephemeris.',
      disclaimerTone: 'archived',
    },
  }[mode];

  if (refs.artemis3Subtitle) refs.artemis3Subtitle.textContent = descriptor.subtitle;
  if (refs.artemis3StatusBadge) {
    refs.artemis3StatusBadge.textContent = descriptor.badge;
    refs.artemis3StatusBadge.classList.remove('a3-badge-official', 'a3-badge-archived', 'a3-badge-proxy');
    refs.artemis3StatusBadge.classList.add(descriptor.badgeClass);
  }
  if (refs.artemis3ProfileNote) refs.artemis3ProfileNote.textContent = descriptor.note;
  setSceneModeDisclaimer(descriptor.note, { tone: descriptor.disclaimerTone });

  buildArtemis3ProfileToggle();
  renderArtemis3Summary(mode, current, legacy);
  renderArtemis3Timeline(mode, current, legacy);
  renderArtemis3Facts(mode, current, legacy);
  renderArtemis3LandingRegions(mode, legacy);
  renderArtemis3Sources(mode);
}

function renderArtemis3Summary(mode, current, legacy) {
  if (!refs.artemis3SummaryList) return;
  const items = [];
  if (mode === 'current-leo') {
    items.push('Launch year: 2027');
    items.push('Mission type: Rendezvous and Docking in Low Earth Orbit');
    items.push('Main spacecraft: SLS, Orion, and one or both commercial landers');
    items.push('Detailed mission design not yet released by NASA');
    if (current?.summary) items.push(current.summary);
  } else {
    items.push('Archived concept: crewed lunar south-pole mission profile');
    items.push('Orion staging orbit: Near-Rectilinear Halo Orbit (NRHO)');
    items.push('Representative NRHO period: about 6.5 days');
    items.push('Crew architecture: 2 crew to surface / 2 remain in Orion');
    items.push('Return sequence: NRHO departure, lunar flyby, Earth reentry');
    if (legacy?.summary) items.push(legacy.summary);
  }
  refs.artemis3SummaryList.innerHTML = '';
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    refs.artemis3SummaryList.appendChild(li);
  }
}

function renderArtemis3Timeline(mode, current, legacy) {
  if (!refs.artemis3PhaseList) return;
  refs.artemis3PhaseList.innerHTML = '';
  const phases = [];
  if (mode === 'current-leo') {
    phases.push({ id: 1, label: 'Launch and ascent', summary: 'SLS launches Orion to mission orbit profile.' });
    phases.push({ id: 2, label: 'LEO rendezvous operations', summary: 'Orion conducts integrated rendezvous and docking demonstrations.' });
    phases.push({ id: 3, label: 'Details forthcoming', summary: 'NASA will publish final mission design details closer to launch.' });
  } else {
    const source = Array.isArray(legacy?.phases) ? legacy.phases : [];
    for (const p of source) phases.push({ id: p.id, label: p.label, summary: p.summary, vehicle: p.vehicle });
  }
  for (const phase of phases) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.className = 'a3-timeline-item';
    const heading = document.createElement('div');
    heading.className = 'a3-timeline-label';
    heading.textContent = `${phase.id}. ${phase.label}`;
    const detail = document.createElement('div');
    detail.className = 'a3-timeline-detail';
    detail.textContent = phase.summary || 'Details forthcoming';
    li.appendChild(heading);
    li.appendChild(detail);
    if (phase.vehicle) {
      const vehicle = document.createElement('div');
      vehicle.className = 'a3-timeline-vehicle';
      vehicle.textContent = `Vehicle: ${phase.vehicle}`;
      li.appendChild(vehicle);
    }
    refs.artemis3PhaseList.appendChild(li);
  }
}

function renderArtemis3Facts(mode, current, legacy) {
  if (!refs.artemis3FactsList) return;
  refs.artemis3FactsList.innerHTML = '';
  const facts = [];
  if (mode === 'current-leo') {
    facts.push('Official current facts: Artemis III is presently defined as a 2027 LEO rendezvous and docking mission.');
    facts.push('NASA has not publicly released exact altitude, inclination, phasing, or ephemeris for the current mission.');
    facts.push('Visualization mode: notional current-leo scene for conceptual understanding.');
  } else {
    const orbit = legacy?.orion_staging_orbit || {};
    facts.push('Archived NASA profile: lunar south-pole architecture used Orion staging in a southern 9:2 NRHO family.');
    facts.push(`Representative proxy period: about ${orbit.period_days_public || 6.5} days.`);
    facts.push('NRHO rationale in public material: robust Earth communications, eclipse management, and south-pole access.');
    if (mode === 'legacy-cislunar') {
      facts.push('Visualization mode: reconstructed legacy-cislunar path based on archived phase sequencing plus proxy NRHO behavior.');
    } else {
      facts.push('Visualization mode: legacy-nrho-detail one-cycle proxy track derived from public NASA sample NRHO data.');
    }
    facts.push('Proxy note: plotted NRHO tracks are derived proxies and are not exact Artemis III ephemeris.');
  }
  for (const fact of facts) {
    const li = document.createElement('li');
    li.textContent = fact;
    refs.artemis3FactsList.appendChild(li);
  }
}

function renderArtemis3LandingRegions(mode, legacy) {
  if (!refs.artemis3LandingSection || !refs.artemis3LandingList) return;
  const show = mode !== 'current-leo';
  refs.artemis3LandingSection.classList.toggle('hidden', !show);
  refs.artemis3LandingList.innerHTML = '';
  if (!show) return;
  const regions = Array.isArray(legacy?.candidate_landing_regions_2024)
    ? legacy.candidate_landing_regions_2024
    : [];
  for (const name of regions) {
    const li = document.createElement('li');
    li.textContent = name;
    refs.artemis3LandingList.appendChild(li);
  }
}

function appendSourceEntries(container, entries = []) {
  if (!container) return;
  container.innerHTML = '';
  for (const entry of entries) {
    const li = document.createElement('li');
    if (entry.href) {
      const a = document.createElement('a');
      a.href = entry.href;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = entry.label;
      li.appendChild(a);
    } else {
      li.textContent = entry.label;
    }
    if (entry.note) {
      const note = document.createElement('div');
      note.className = 'annotation-note';
      note.textContent = entry.note;
      li.appendChild(note);
    }
    container.appendChild(li);
  }
}

function renderArtemis3Sources(mode) {
  const missionModelPath = './data/models/artemis-3-mission-model.json';
  const proxyCyclePath = './data/models/artemis-3-legacy-nrho-proxy-cycle.json';
  const proxyFullPath = './data/models/artemis-3-legacy-nrho-proxy-full.json';
  appendSourceEntries(refs.a3SourcesOfficial, [
    {
      label: 'NASA Artemis III mission page',
      href: 'https://www.nasa.gov/missions/artemis/artemis-iii/',
      note: 'Current official mission framing: 2027 low Earth orbit rendezvous and docking demonstration.',
    },
    {
      label: 'Artemis III mission model (local JSON)',
      href: missionModelPath,
      note: 'Structured current-vs-legacy mission facts used by this tab.',
    },
  ]);
  appendSourceEntries(refs.a3SourcesArchived, [
    {
      label: 'Archived Artemis III lunar concept (NASA page context)',
      href: 'https://www.nasa.gov/missions/artemis/artemis-iii/',
      note: 'Archived sections preserve earlier lunar south-pole mission architecture context.',
    },
    {
      label: 'Legacy phase sequence (mission model JSON)',
      href: missionModelPath,
      note: 'Phase-level mission sequence for archived visualization.',
    },
  ]);
  appendSourceEntries(refs.a3SourcesProxy, [
    {
      label: 'Proxy NRHO representative cycle JSON',
      href: proxyCyclePath,
      note: 'Derived from NASA public sample NRHO data (representative cycle).',
    },
    {
      label: 'Proxy NRHO full decimated sample JSON',
      href: proxyFullPath,
      note: 'Decimated proxy sample for additional orbit-family context.',
    },
    {
      label: mode === 'current-leo'
        ? 'Current mode note: no exact public Artemis III ephemeris released'
        : 'Legacy mode note: proxy data shown here is derived and not exact mission ephemeris',
      note: 'Labeling intentionally separates official current facts, archived material, and proxy-derived trajectory data.',
    },
  ]);
}


function buildArtemis5ProfileToggle() {
  const isArtemis5 = state.activeMissionId === 'artemis-5';
  if (!refs.artemis5Card) return;
  refs.artemis5Card.classList.toggle('hidden', !isArtemis5);
  const mode = state.ui.artemis5Mode;
  const map = [
    [refs.btnA5Current, 'current-mission'],
    [refs.btnA5CurrentNrho, 'current-nrho-detail'],
    [refs.btnA5Archived, 'archived-detailed-profile'],
    [refs.btnA5ArchivedNrho, 'archived-nrho-detail'],
  ];
  for (const [btn, key] of map) {
    if (!btn) continue;
    const active = key === mode;
    btn.classList.toggle('is-toggled', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}

async function loadArtemis5Model() {
  if (state.artemis5.model) return state.artemis5.model;
  const loaded = await loadJson(ARTEMIS_5_MODEL_PATH);
  state.artemis5.model = loaded || null;
  return state.artemis5.model;
}

function getArtemis5ProfileConfig(mission, mode) {
  const profiles = mission?.artemis5Profiles || {};
  if (profiles[mode]) return profiles[mode];
  return profiles[ARTEMIS_5_PROFILE_DEFAULT] || null;
}

async function switchArtemis5Profile(nextMode) {
  if (state.activeMissionId !== 'artemis-5') return;
  const normalized = ARTEMIS_5_PROFILE_MODES.includes(nextMode) ? nextMode : ARTEMIS_5_PROFILE_DEFAULT;
  if (state.ui.artemis5Mode === normalized) {
    buildArtemis5ProfileToggle();
    renderArtemis5Content();
    return;
  }
  state.ui.artemis5Mode = normalized;
  state.artemis5.profileMode = normalized;
  syncUrlState();
  await selectMission('artemis-5');
}

function mapSourcesToEntries(items = [], fallbackNote = '') {
  return (Array.isArray(items) ? items : []).map((s) => ({
    label: s?.title || s?.id || 'Source',
    href: s?.url || '',
    note: [s?.publisher, s?.updated ? `updated ${s.updated}` : '', s?.note || fallbackNote]
      .filter(Boolean)
      .join(' — '),
  }));
}

function renderArtemis5Summary(mode, current, legacy) {
  if (!refs.artemis5SummaryList) return;
  refs.artemis5SummaryList.innerHTML = '';
  const items = [];
  if (mode === 'current-mission' || mode === 'current-nrho-detail') {
    items.push('Launch target: Late 2028');
    items.push('Mission type: Gateway assembly + crewed surface landing');
    items.push('Crew profile: 4 astronauts, including 2 to the surface for about one week.');
    items.push('Main systems: SLS Block 1B, Orion, Lunar View, Gateway/HALO, Human Landing System.');
    items.push('Moon-base context: Artemis V is when NASA says it expects to begin building its Moon base.');
    items.push('Orbit note: NASA has not publicly released exact Artemis V orbital elements or ephemeris.');
  } else {
    items.push('Archived/provider-specific layer from 2023-2026 public details (same Gateway/NRHO family).');
    items.push('Includes low-Earth-orbit checks, transposition/extraction, lunar flyby/gravity-assist, NRHO loiter, and Earth return.');
    items.push('Provider naming and older schedule assumptions are retained only in this archived/reference view.');
  }
  if (current?.summary && (mode === 'current-mission' || mode === 'current-nrho-detail')) items.push(current.summary);
  if (legacy?.summary && (mode === 'archived-detailed-profile' || mode === 'archived-nrho-detail')) items.push(legacy.summary);
  for (const text of items) {
    const li = document.createElement('li');
    li.textContent = text;
    refs.artemis5SummaryList.appendChild(li);
  }
}

function renderArtemis5Timeline(mode, current, legacy) {
  if (!refs.artemis5PhaseList) return;
  refs.artemis5PhaseList.innerHTML = '';
  const phaseSource = (mode === 'current-mission' || mode === 'current-nrho-detail')
    ? current?.phases
    : legacy?.phases;
  const phases = Array.isArray(phaseSource) ? phaseSource : [];
  for (const phase of phases) {
    const li = document.createElement('li');
    li.tabIndex = 0;
    li.className = 'a3-timeline-item';
    const heading = document.createElement('div');
    heading.className = 'a3-timeline-label';
    heading.textContent = `${phase.id}. ${phase.label}`;
    const detail = document.createElement('div');
    detail.className = 'a3-timeline-detail';
    detail.textContent = phase.summary || 'Details forthcoming';
    li.appendChild(heading);
    li.appendChild(detail);
    if (phase.vehicle) {
      const vehicle = document.createElement('div');
      vehicle.className = 'a3-timeline-vehicle';
      vehicle.textContent = `Vehicle: ${phase.vehicle}`;
      li.appendChild(vehicle);
    }
    refs.artemis5PhaseList.appendChild(li);
  }
}

function renderArtemis5Facts(mode, current, legacy, orbitProxies) {
  if (!refs.artemis5FactsList) return;
  refs.artemis5FactsList.innerHTML = '';
  const facts = [];
  facts.push('Current vs archived Artemis V views differ by mission framing freshness and detail level, not by orbit family.');
  facts.push('Shared orbit family in public sources: southern 9:2 Gateway NRHO.');
  facts.push('Representative NRHO period: about 6.5 days; perilune altitude about 1,500 km; farthest altitude about 70,000 km.');
  facts.push('Technical values often cited: perilune radius about 3,500 km and apolune radius about 71,000 km.');
  facts.push('NRHO rationale: communications continuity, eclipse management, and south-pole access.');
  if (mode === 'current-mission') facts.push('Current mission path shown here is conceptual until NASA releases official ephemeris.');
  if (mode === 'current-nrho-detail') facts.push('Current NRHO view uses derived Gateway proxy cycle data.');
  if (mode === 'archived-detailed-profile') facts.push('Archived detailed profile preserves provider-specific public detail as reference context.');
  if (mode === 'archived-nrho-detail') facts.push('Archived NRHO view uses the same underlying NRHO proxy family with archived labeling.');
  if (orbitProxies?.same_underlying_proxy_note) facts.push(orbitProxies.same_underlying_proxy_note);
  if (current?.publicly_released_orbit?.released === false) {
    facts.push('NASA has not publicly released exact Artemis V orbital elements or point-by-point ephemeris.');
  }
  facts.push('All NRHO orbit tracks shown are derived proxies, not official Artemis V ephemeris.');
  for (const fact of facts) {
    const li = document.createElement('li');
    li.textContent = fact;
    refs.artemis5FactsList.appendChild(li);
  }
}

function renderArtemis5MoonbaseNotes(current) {
  if (!refs.artemis5MoonbaseList) return;
  refs.artemis5MoonbaseList.innerHTML = '';
  const notes = [
    current?.moon_base_context || 'NASA says Artemis V is when it expects to begin building its Moon base.',
    'NASA intends to begin using the Lunar Terrain Vehicle (LTV) for crewed operations during Artemis V.',
    'Campaign caveat: final Moon-base hardware layout and manifest details are not yet publicly finalized.',
  ];
  for (const text of notes) {
    const li = document.createElement('li');
    li.textContent = text;
    refs.artemis5MoonbaseList.appendChild(li);
  }
}

function renderArtemis5Sources(mode, model) {
  const missionModelPath = './data/models/artemis-5-mission-model.json';
  const currentCyclePath = './data/models/artemis-5-current-nrho-proxy-cycle.json';
  const currentFullPath = './data/models/artemis-5-current-nrho-proxy-full.json';
  const legacyCyclePath = './data/models/artemis-5-legacy-nrho-proxy-cycle.json';
  const legacyFullPath = './data/models/artemis-5-legacy-nrho-proxy-full.json';
  const sources = model?.sources || {};
  appendSourceEntries(refs.a5SourcesOfficial, [
    ...mapSourcesToEntries(sources.current_official),
    {
      label: 'Artemis V mission model (local JSON)',
      href: missionModelPath,
      note: 'Current-vs-archived distinctions and copy constraints used by this tab.',
    },
  ]);
  appendSourceEntries(refs.a5SourcesArchived, mapSourcesToEntries(sources.archived_provider_specific));
  appendSourceEntries(refs.a5SourcesProxy, [
    ...mapSourcesToEntries(sources.technical_proxy),
    {
      label: mode === 'current-nrho-detail' ? 'Current NRHO proxy cycle JSON' : 'Archived NRHO proxy cycle JSON',
      href: mode === 'current-nrho-detail' ? currentCyclePath : legacyCyclePath,
      note: 'Derived Gateway NRHO proxy cycle; not exact Artemis V ephemeris.',
    },
    {
      label: mode === 'current-nrho-detail' ? 'Current NRHO full proxy JSON' : 'Archived NRHO full proxy JSON',
      href: mode === 'current-nrho-detail' ? currentFullPath : legacyFullPath,
      note: 'Decimated full proxy sample for broader orbit-family context.',
    },
  ]);
  appendSourceEntries(refs.a5SourcesMoonbase, mapSourcesToEntries(sources.moon_base_and_surface_mobility));
  appendSourceEntries(refs.a5SourcesDrift, mapSourcesToEntries(sources.update_note_sources).concat(
    (model?.source_drift_notes || []).map((note, idx) => ({ label: `Source drift note ${idx + 1}`, note })),
  ));
}

function renderArtemis5Content() {
  if (!refs.artemis5Card) return;
  const isArtemis5 = state.activeMissionId === 'artemis-5';
  refs.artemis5Card.classList.toggle('hidden', !isArtemis5);
  if (!isArtemis5) {
    setSceneModeDisclaimer('', { tone: 'warn' });
    return;
  }

  const model = state.artemis5.model || {};
  const current = model.current_official || {};
  const legacy = model.archived_provider_specific_profile || {};
  const mode = ARTEMIS_5_PROFILE_MODES.includes(state.ui.artemis5Mode)
    ? state.ui.artemis5Mode
    : ARTEMIS_5_PROFILE_DEFAULT;

  const descriptor = {
    'current-mission': {
      subtitle: 'Late 2028 crewed lunar surface mission via Gateway',
      badge: 'Current official mission',
      badgeClass: 'a3-badge-official',
      note: 'Mission path based on current public mission descriptions; NASA has not yet released exact Artemis V ephemeris.',
      disclaimerTone: 'official',
    },
    'current-nrho-detail': {
      subtitle: 'Current mission NRHO detail (derived Gateway proxy)',
      badge: 'Derived proxy NRHO view',
      badgeClass: 'a3-badge-proxy',
      note: 'Derived Gateway NRHO reference orbit from public NASA sources. Not exact Artemis V ephemeris.',
      disclaimerTone: 'official',
    },
    'archived-detailed-profile': {
      subtitle: 'Archived provider-specific detailed profile',
      badge: 'Archived reference profile',
      badgeClass: 'a3-badge-archived',
      note: 'Archived/provider-specific detail layer from older public sources; same Gateway/NRHO family, not a different architecture.',
      disclaimerTone: 'archived',
    },
    'archived-nrho-detail': {
      subtitle: 'Archived NRHO detail (derived Gateway proxy)',
      badge: 'Archived proxy NRHO view',
      badgeClass: 'a3-badge-proxy',
      note: 'Representative archived NRHO proxy cycle from public NASA sample data. Not exact Artemis V ephemeris.',
      disclaimerTone: 'archived',
    },
  }[mode];

  if (refs.artemis5Subtitle) refs.artemis5Subtitle.textContent = descriptor.subtitle;
  if (refs.artemis5StatusBadge) {
    refs.artemis5StatusBadge.textContent = descriptor.badge;
    refs.artemis5StatusBadge.classList.remove('a3-badge-official', 'a3-badge-archived', 'a3-badge-proxy');
    refs.artemis5StatusBadge.classList.add(descriptor.badgeClass);
  }
  if (refs.artemis5ProfileNote) refs.artemis5ProfileNote.textContent = descriptor.note;
  setSceneModeDisclaimer(descriptor.note, { tone: descriptor.disclaimerTone });

  buildArtemis5ProfileToggle();
  renderArtemis5Summary(mode, current, legacy);
  renderArtemis5Timeline(mode, current, legacy);
  renderArtemis5Facts(mode, current, legacy, model.orbit_proxies || {});
  renderArtemis5MoonbaseNotes(current);
  renderArtemis5Sources(mode, model);
}


function wireUiEvents() {
  setEventMarkerClickHandler(({ eventId }) => {
    jumpToEventById(eventId);
  });
  if (refs.btnA3Current) {
    refs.btnA3Current.addEventListener('click', () => {
      switchArtemis3Profile('current-leo').catch((error) => handleStartupError('Artemis III profile switch failed', error));
    });
  }
  if (refs.btnA3Legacy) {
    refs.btnA3Legacy.addEventListener('click', () => {
      switchArtemis3Profile('legacy-cislunar').catch((error) => handleStartupError('Artemis III profile switch failed', error));
    });
  }
  if (refs.btnA3Nrho) {
    refs.btnA3Nrho.addEventListener('click', () => {
      switchArtemis3Profile('legacy-nrho-detail').catch((error) => handleStartupError('Artemis III profile switch failed', error));
    });
  }
  if (refs.btnA5Current) {
    refs.btnA5Current.addEventListener('click', () => {
      switchArtemis5Profile('current-mission').catch((error) => handleStartupError('Artemis V profile switch failed', error));
    });
  }
  if (refs.btnA5CurrentNrho) {
    refs.btnA5CurrentNrho.addEventListener('click', () => {
      switchArtemis5Profile('current-nrho-detail').catch((error) => handleStartupError('Artemis V profile switch failed', error));
    });
  }
  if (refs.btnA5Archived) {
    refs.btnA5Archived.addEventListener('click', () => {
      switchArtemis5Profile('archived-detailed-profile').catch((error) => handleStartupError('Artemis V profile switch failed', error));
    });
  }
  if (refs.btnA5ArchivedNrho) {
    refs.btnA5ArchivedNrho.addEventListener('click', () => {
      switchArtemis5Profile('archived-nrho-detail').catch((error) => handleStartupError('Artemis V profile switch failed', error));
    });
  }
  refs.btnPlay.addEventListener('click', () => {
    if (!hasMissionTimeline()) {
      setSidebarStatus('Playback unavailable — mission data not loaded');
      return;
    }
    if (state.ui.liveMode) setLiveModeUi(false);
    state.playing = !state.playing;
    refs.btnPlay.textContent = state.playing ? '⏸ Pause' : '▶ Play';
    if (state.playing && state.currentMs >= state.missionStopMs) state.currentMs = state.missionStartMs;
    setSidebarStatus(state.playing ? 'Playback running' : 'Playback paused');
  });
  if (refs.btnSceneStartMission) {
    refs.btnSceneStartMission.addEventListener('click', () => startMissionFromOverlay());
  }

  refs.btnReset.addEventListener('click', () => {
    if (!hasMissionTimeline()) {
      showFallbackBodies();
      focusCameraPreset('fallback-overview');
      setSidebarStatus('Reset fallback scene');
      return;
    }
    if (state.ui.liveMode) setLiveModeUi(false, { status: false });
    state.currentMs = state.missionStartMs;
    state.playing = false;
    refs.btnPlay.textContent = '▶ Play';
    updateScene();
    setSidebarStatus('Reset to mission start');
  });

  refs.btnJumpStart.addEventListener('click', () => jumpToMissionStart());
  refs.btnJumpEnd.addEventListener('click', () => jumpToMissionEnd());
  if (refs.btnPrevEvent) refs.btnPrevEvent.addEventListener('click', () => jumpToPreviousEvent());
  if (refs.btnNextEvent) refs.btnNextEvent.addEventListener('click', () => jumpToNextEvent());
  if (refs.btnMinus1h) refs.btnMinus1h.addEventListener('click', () => stepTime(-MS_PER_H));
  if (refs.btnPlus1h) refs.btnPlus1h.addEventListener('click', () => stepTime(MS_PER_H));
  if (refs.btnMinus1d) refs.btnMinus1d.addEventListener('click', () => stepTime(-MS_PER_D));
  if (refs.btnPlus1d) refs.btnPlus1d.addEventListener('click', () => stepTime(MS_PER_D));
  if (refs.btnLive) {
    refs.btnLive.addEventListener('click', () => {
      setLiveModeUi(!state.ui.liveMode);
    });
  }

  refs.btnCamEarth.addEventListener('click', () => {
    applyCameraPreset('earth-centered');
    setSidebarStatus('Camera preset: Earth-centered');
  });
  refs.btnCamMoon.addEventListener('click', () => {
    applyCameraPreset('moon-approach');
    setSidebarStatus('Camera preset: Moon-approach');
  });
  refs.btnCamFit.addEventListener('click', () => {
    applyCameraPreset('mission-fit');
    setSidebarStatus('Camera preset: Mission-fit');
  });
  refs.btnCamFollow.addEventListener('click', () => {
    const enablingFollow = !state.ui.followCamera;
    const nextPreset = enablingFollow ? 'follow-orion' : state.ui.lastNonFollowCamera;
    applyCameraPreset(nextPreset);
    setSidebarStatus(enablingFollow ? 'Camera preset: Follow Orion' : 'Follow camera disabled');
  });
  if (refs.btnCamRecenter) {
    refs.btnCamRecenter.addEventListener('click', () => {
      recenterFollowCamera();
      setSidebarStatus('Camera recentered on Orion');
    });
  }
  if (refs.btnCamSnapEvent) {
    refs.btnCamSnapEvent.addEventListener('click', () => {
      const eventCtx = getEventContext(state.events, state.currentMs);
      const anchor = eventCtx.active || eventCtx.nearest;
      const marker = anchor ? state.eventMarkers.find((m) => m.id === anchor.id) : null;
      const moonState = getInterpolatedState(state.moonData, state.currentMs);
      snapCameraToEventView({ eventPositionKm: marker?.positionKm || null, moonKm: moonState?.positionKm || null });
      setSidebarStatus(anchor ? `Snapped to event: ${anchor.label}` : 'Snapped to nearest trajectory point');
    });
  }
  if (refs.followModeSelect) {
    refs.followModeSelect.addEventListener('change', () => {
      const next = refs.followModeSelect.value;
      setFollowCameraModeUi(next);
      setSidebarStatus(`Follow camera: ${next}`);
    });
  }
  if (refs.attitudeSelect) {
    refs.attitudeSelect.addEventListener('change', () => {
      const candidate = refs.attitudeSelect.value;
      const next = ['velocity', 'earth', 'moon'].includes(candidate) ? candidate : 'velocity';
      setAttitudeReferenceUi(next);
      setSidebarStatus(`Capsule attitude: ${next}`);
    });
  }
  if (refs.btnCapture) {
    refs.btnCapture.addEventListener('click', () => {
      exportScenePng();
    });
  }
  if (refs.chkEventVoice) {
    refs.chkEventVoice.addEventListener('change', () => {
      setEventVoiceEnabledUi(refs.chkEventVoice.checked);
      setSidebarStatus(state.ui.eventVoiceEnabled ? 'Event voice: On' : 'Event voice: Off');
    });
  }
  if (refs.btnTtsToggle) {
    refs.btnTtsToggle.addEventListener('click', () => {
      setEventVoiceEnabledUi(!state.ui.eventVoiceEnabled);
      setSidebarStatus(state.ui.eventVoiceEnabled ? 'Event voice: On' : 'Event voice: Off');
    });
  }
  if (refs.voiceVolumeSlider) {
    refs.voiceVolumeSlider.addEventListener('input', () => {
      const max = Number(refs.voiceVolumeSlider.max) || 100;
      const raw = Number(refs.voiceVolumeSlider.value);
      const volume = clamp(raw / max, 0, 1);
      setEventVoiceVolumeUi(volume);
    });
  }
  refs.btnZoomIn.addEventListener('click', () => {
    zoomCamera(1);
    syncZoomUiFromScene(true);
    setSidebarStatus('Zoomed in');
  });
  refs.btnZoomOut.addEventListener('click', () => {
    zoomCamera(-1);
    syncZoomUiFromScene(true);
    setSidebarStatus('Zoomed out');
  });
  refs.btnZoomReset.addEventListener('click', () => {
    resetZoom();
    syncZoomUiFromScene(true);
    setSidebarStatus('Zoom reset');
  });
  refs.zoomSlider.addEventListener('input', () => {
    const max = Number(refs.zoomSlider.max) || 1000;
    const f = Number(refs.zoomSlider.value) / max;
    setZoomLevel(clamp(f, 0, 1));
    syncZoomUiFromScene(true);
  });
  refs.visualPresetSelect.addEventListener('change', () => {
    setVisualPresetUi(refs.visualPresetSelect.value);
    setSidebarStatus(`Visual preset: ${state.ui.visualPreset}`);
  });
  refs.btnDismissHint.addEventListener('click', () => hideControlsHint({ persist: true }));

  refs.speedSelect.addEventListener('change', () => {
    const selected = refs.speedSelect.options[refs.speedSelect.selectedIndex];
    if (selected) {
      if (state.ui.liveMode) setLiveModeUi(false, { status: false });
      setSidebarStatus(`Playback speed: ${selected.textContent}`);
      syncUrlState();
    }
  });

  refs.perfModeSelect.addEventListener('change', () => {
    state.ui.performanceMode = refs.perfModeSelect.value;
    setPerformanceMode(state.ui.performanceMode);
    setSidebarStatus(`Performance mode: ${state.ui.performanceMode}`);
    syncUrlState();
  });
  refs.btnCopyLink.addEventListener('click', async () => {
    const url = window.location.href;
    try {
      await navigator.clipboard.writeText(url);
      setSidebarStatus('Share link copied');
    } catch {
      setSidebarStatus('Unable to copy link in this browser');
    }
  });
  wireSocialShareButtons();
  wireEmbedTools();

  refs.timelineSlider.addEventListener('mousedown', () => { state.scrubbing = true; });
  refs.timelineSlider.addEventListener('touchstart', () => { state.scrubbing = true; }, { passive: true });
  refs.timelineSlider.addEventListener('input', () => {
    if (!state.flatSamples.length || state.missionStopMs <= state.missionStartMs) return;
    if (state.ui.liveMode) setLiveModeUi(false, { status: false });
    const f = Number(refs.timelineSlider.value) / Number(refs.timelineSlider.max);
    state.currentMs = state.missionStartMs + f * (state.missionStopMs - state.missionStartMs);
    updateScene();
    syncUrlState();
  });

  window.addEventListener('mouseup', () => { state.scrubbing = false; });
  window.addEventListener('touchend', () => { state.scrubbing = false; });
  window.addEventListener('keydown', onKeyboardShortcuts);
}

function wireSocialShareButtons() {
  const shareText = 'Explore NASA Artemis mission trajectories in this interactive 3D viewer';
  const shareSubject = 'Explore NASA Artemis Orbits';
  const openShareWindow = (href) => {
    const popup = window.open(href, '_blank', 'noopener,noreferrer,width=760,height=620');
    if (!popup) window.open(href, '_blank', 'noopener,noreferrer');
  };
  const getShareState = () => {
    const currentUrl = window.location.href;
    return {
      currentUrl,
      encodedUrl: encodeURIComponent(currentUrl),
      encodedText: encodeURIComponent(shareText),
      encodedSubject: encodeURIComponent(shareSubject),
    };
  };

  if (refs.btnShareX) {
    refs.btnShareX.addEventListener('click', () => {
      const { encodedUrl, encodedText } = getShareState();
      openShareWindow(`https://x.com/intent/tweet?url=${encodedUrl}&text=${encodedText}`);
      setSidebarStatus('Opened X share composer');
    });
  }
  if (refs.btnShareReddit) {
    refs.btnShareReddit.addEventListener('click', () => {
      const { encodedUrl, encodedText } = getShareState();
      openShareWindow(`https://www.reddit.com/submit?url=${encodedUrl}&title=${encodedText}`);
      setSidebarStatus('Opened Reddit share composer');
    });
  }
  if (refs.btnShareLinkedin) {
    refs.btnShareLinkedin.addEventListener('click', () => {
      const { encodedUrl } = getShareState();
      openShareWindow(`https://www.linkedin.com/sharing/share-offsite/?url=${encodedUrl}`);
      setSidebarStatus('Opened LinkedIn share composer');
    });
  }
  if (refs.btnShareEmail) {
    refs.btnShareEmail.addEventListener('click', () => {
      const { currentUrl, encodedSubject } = getShareState();
      const body = encodeURIComponent(`${shareText}\n\n${currentUrl}`);
      window.location.href = `mailto:?subject=${encodedSubject}&body=${body}`;
      setSidebarStatus('Opened email share draft');
    });
  }
}

function wireEmbedTools() {
  if (!refs.embedIframeOutput || !refs.embedLinkOutput) return;
  updateEmbedSnippets();

  refs.btnCopyEmbedIframe?.addEventListener('click', async () => {
    updateEmbedSnippets();
    try {
      await navigator.clipboard.writeText(refs.embedIframeOutput.value);
      setSidebarStatus('Embed code copied');
    } catch {
      setSidebarStatus('Unable to copy embed code in this browser');
    }
  });

  refs.btnCopyEmbedLink?.addEventListener('click', async () => {
    updateEmbedSnippets();
    try {
      await navigator.clipboard.writeText(refs.embedLinkOutput.value);
      setSidebarStatus('Embed link copied');
    } catch {
      setSidebarStatus('Unable to copy embed link in this browser');
    }
  });
}

function updateEmbedSnippets() {
  if (!refs?.embedIframeOutput || !refs?.embedLinkOutput) return;
  const url = window.location.href;
  refs.embedLinkOutput.value = `<a href="${url}" target="_blank" rel="noopener noreferrer">Explore NASA Artemis Orbits</a>`;
  refs.embedIframeOutput.value = `<iframe src="${url}" width="960" height="540" style="border:1px solid #1e2a40;border-radius:8px;" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen title="NASA Artemis Orbits"></iframe>`;
}

function setActiveTab(id) {
  for (const btn of refs.tabBar.querySelectorAll('.tab-btn')) {
    const active = btn.dataset.id === id;
    btn.classList.toggle('tab-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}

async function selectMission(id) {
  const mission = MISSIONS.find((m) => m.id === id);
  if (!mission) return;
  state.activeMissionId = id;
  if (mission.id === 'artemis-3' && !ARTEMIS_3_PROFILE_MODES.includes(state.ui.artemis3Mode)) {
    state.ui.artemis3Mode = ARTEMIS_3_PROFILE_DEFAULT;
    state.artemis3.profileMode = state.ui.artemis3Mode;
  }
  if (mission.id === 'artemis-5' && !ARTEMIS_5_PROFILE_MODES.includes(state.ui.artemis5Mode)) {
    state.ui.artemis5Mode = ARTEMIS_5_PROFILE_DEFAULT;
    state.artemis5.profileMode = state.ui.artemis5Mode;
  }
  buildArtemis3ProfileToggle();
  buildArtemis5ProfileToggle();

  setActiveTab(id);
  resetLoadedMissionState();

  refs.sbTitle.textContent = mission.displayName;
  refs.sbSummary.textContent = mission.summary;
  state.playing = false;
  refs.btnPlay.textContent = '▶ Play';

  if (!mission.enabled) {
    showOverlay(`${mission.displayName} — ${mission.summary}`);
    setSidebarStatus('Mission JSON missing');
    renderArtemis3Content();
    renderArtemis5Content();
    return;
  }

  setSidebarStatus('Fallback scene active — waiting for mission data');
  if (mission.id === 'artemis-3') {
    try {
      await loadArtemis3Model();
    } catch (error) {
      setErrorMessage(`Artemis III model load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (mission.id === 'artemis-5') {
    try {
      await loadArtemis5Model();
    } catch (error) {
      setErrorMessage(`Artemis V model load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const dataPaths = getMissionDataPaths(mission);

  try {
    state.missionData = await loadMissionData(dataPaths.normalizedPath);
    state.diagnostics.missionJsonLoaded = Boolean(state.missionData);
  } catch (error) {
    handleStartupError('Mission JSON load failed', error);
    return;
  }

  let loadedEvents = null;
  try {
    state.moonData = await loadMissionData(dataPaths.moonPath);
    state.diagnostics.moonJsonLoaded = Boolean(state.moonData);
  } catch (error) {
    setErrorMessage(`Moon JSON load failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    loadedEvents = await loadJson(dataPaths.eventsPath);
    state.events = sortEvents(loadedEvents);
    state.diagnostics.eventsLoaded = Boolean(loadedEvents);
  } catch (error) {
    setErrorMessage(`Event JSON load failed: ${error instanceof Error ? error.message : String(error)}`);
    state.events = [];
    state.diagnostics.eventsLoaded = false;
  } finally {
    updateDebugOverlay();
  }

  if (!state.missionData) {
    showOverlay('Mission JSON missing. Fallback scene remains active while data is unavailable.');
    setSidebarStatus('Mission JSON missing');
    showFallbackBodies();
    focusCameraPreset('fallback-overview');
    return;
  }

  hideOverlay();
  state.flatSamples = flattenSamples(state.missionData);
  const bounds = getMissionTimeBounds(state.missionData);
  state.missionStartMs = bounds?.startMs ?? 0;
  state.missionStopMs = bounds?.stopMs ?? 0;
  state.currentMs = state.missionStartMs;

  refs.sbSampleCount.textContent = String(state.missionData?.derived?.sampleCount ?? state.flatSamples.length);
  state.events = prepareMissionEvents(state.events, state.missionStartMs, state.missionStopMs);
  state.missionPhases = buildMissionPhases(state.events, state.missionStartMs, state.missionStopMs);

  setFollowCameraModeUi(state.ui.followCameraMode, { sync: false });
  setAttitudeReferenceUi(state.ui.attitudeReference, { sync: false });
  setEventVoiceEnabledUi(state.ui.eventVoiceEnabled, { sync: false });
  setEventVoiceVolumeUi(state.ui.eventVoiceVolume, { sync: false });

  setMissionTrailsBySegment(state.missionData.segments || []);
  setMoonTrajectoryBySegment(getMoonTrajectorySegmentsForRender(state.activeMissionId, state.moonData));
  try {
    buildEventMarkers();
  } catch (error) {
    handleStartupError('Event marker build failed', error);
    return;
  }
  refreshTimelineEventTicks();
  try {
    applyCameraPreset(state.ui.cameraPreset, { sync: false });
  } catch (error) {
    handleStartupError('Camera setup failed', error);
  }
  updateScene();
  refreshMissionAnnotations(mission);
  renderArtemis3Content();
  renderArtemis5Content();
  applyInitialTimeOverrideFromUrl();
  if (state.ui.liveMode) setLiveModeUi(true, { sync: false, status: false });
  syncUrlState();

  const artemis3Profile = getArtemis3ProfileConfig(mission, state.ui.artemis3Mode);
  const artemis5Profile = getArtemis5ProfileConfig(mission, state.ui.artemis5Mode);
  const missionLabel = mission.id === 'artemis-3'
    ? `Mission scene active — Artemis III (${artemis3Profile?.displayName || 'Current mission'})`
    : mission.id === 'artemis-5'
      ? `Mission scene active — Artemis V (${artemis5Profile?.displayName || 'Current mission'})`
      : `Mission scene active — ${mission.displayName}`;
  setSidebarStatus(missionLabel);

  if (!state.moonData) setErrorMessage('Moon JSON missing; using default Moon position.');
  if (!loadedEvents) setErrorMessage('Event JSON missing; continuing without event markers.');
}

function startRafLoop() {
  let prev = performance.now();
  function frame(now) {
    const dtMs = now - prev;
    prev = now;

    if (state.ui.liveMode && hasMissionTimeline()) {
      const liveClockMs = clamp(Date.now(), state.missionStartMs, state.missionStopMs);
      if (Math.abs(liveClockMs - state.currentMs) > LIVE_SYNC_EPS_MS) {
        state.currentMs = liveClockMs;
        updateScene();
      }
    }

    if (state.playing && state.flatSamples.length) {
      const missionMsPerWallSecond = Number(refs.speedSelect.value);
      state.currentMs += (dtMs / 1000) * missionMsPerWallSecond;
      if (state.currentMs >= state.missionStopMs) {
        state.currentMs = state.missionStopMs;
        state.playing = false;
        refs.btnPlay.textContent = '▶ Play';
      }
      state.currentMs = clamp(state.currentMs, state.missionStartMs, state.missionStopMs);
      updateScene();
    }

    try {
      renderScene();
      if (!state.scrubbing) syncZoomUiFromScene(false);
    } catch (error) {
      handleStartupError('Render loop failure', error);
    }
    syncZoomUiFromScene();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function updateScene() {
  if (!state.flatSamples.length) {
    showFallbackBodies();
    return;
  }

  if (!state.scrubbing && state.missionStopMs > state.missionStartMs) {
    const f = (state.currentMs - state.missionStartMs) / (state.missionStopMs - state.missionStartMs);
    refs.timelineSlider.value = String(Math.round(f * Number(refs.timelineSlider.max)));
  }

  refs.sbUtc.textContent = formatUtc(state.currentMs);
  refs.sbMet.textContent = formatMet(state.missionStartMs, state.currentMs);

  const segState = findSegment(state.missionData, state.currentMs);
  const moonState = getInterpolatedState(state.moonData, state.currentMs);

  let orionState = null;
  if (segState.state === 'in-segment') {
    orionState = interpolateSegment(segState.segment, segState.snappedMs);
  } else if (segState.state === 'gap') {
    const snapped = findSegment(state.missionData, segState.gap.nearestBoundaryMs);
    if (snapped.segment) {
      orionState = interpolateSegment(snapped.segment, snapped.snappedMs);
    }
  }

  updateBodies(orionState?.positionKm || null, moonState?.positionKm || null, {
    orionVelocityKmS: orionState?.velocityKmS || null,
  });
  setTraversedTrailBySegment(state.missionData.segments || [], state.currentMs);

  const idx = findSampleIndex(state.flatSamples, state.currentMs);
  refs.sbFrame.textContent = `${idx + 1} / ${state.flatSamples.length} (${segState.state})`;

  const eventCtx = getEventContext(state.events, state.currentMs);
  if (eventCtx.active) refs.sbEvent.textContent = `${eventCtx.active.label}${eventVerificationTag(eventCtx.active)} (active)`;
  else if (eventCtx.nearest) refs.sbEvent.textContent = `${eventCtx.nearest.label}${eventVerificationTag(eventCtx.nearest)} (nearest)`;
  else refs.sbEvent.textContent = 'No events loaded';
  refreshTelemetryOverlay(getCurrentTelemetryValues(orionState, moonState, eventCtx));

  const maneuverIntensity = getManeuverIntensity(state.events, state.currentMs);
  setOrionManeuverLevel(maneuverIntensity);
  const sceneCalloutEvent = getSceneEventCallout(state.events, state.currentMs);
  const showSceneStartButton = shouldShowSceneStartMissionButton(sceneCalloutEvent);
  setSceneStartMissionButtonVisible(showSceneStartButton);
  const visualCalloutEvent = sceneCalloutEvent?.id === 'mission-start' ? null : sceneCalloutEvent;
  setActiveEventCallout(visualCalloutEvent);
  maybeSpeakSceneEvent(visualCalloutEvent);
  syncUrlState();
}

function getInterpolatedState(data, tMs) {
  const segState = findSegment(data, tMs);
  if (segState?.segment && segState?.snappedMs != null) {
    return interpolateSegment(segState.segment, segState.snappedMs);
  }
  return null;
}

function buildEventMarkers() {
  state.eventMarkers = [];
  for (const event of state.events) {
    const segState = findSegment(state.missionData, event.epochMs);
    if (!segState?.segment || segState.state === 'gap') continue;
    const segmentState = interpolateSegment(segState.segment, segState.snappedMs);
    state.eventMarkers.push({ id: event.id, label: event.label, positionKm: segmentState.positionKm });
  }
  setEventMarkers(state.eventMarkers);
}

function refreshTimelineEventTicks() {
  refs.timelineTicks.innerHTML = '';
  if (!state.events.length || state.missionStopMs <= state.missionStartMs) return;

  for (const event of state.events) {
    const pct = ((event.epochMs - state.missionStartMs) / (state.missionStopMs - state.missionStartMs)) * 100;
    if (pct < 0 || pct > 100) continue;
    const tick = document.createElement('span');
    tick.className = 'timeline-tick';
    tick.dataset.type = getEventTypeClass(event.type);
    tick.style.left = `${pct}%`;
    tick.title = [
      `${event.label}${eventVerificationTag(event)}`,
      event.epochUtc,
      event.description || event.type || 'event',
    ].filter(Boolean).join('\n');
    tick.addEventListener('click', () => jumpToEventById(event.id));
    refs.timelineTicks.appendChild(tick);
  }
}

function resetLoadedMissionState() {
  state.missionData = null;
  state.moonData = null;
  state.events = [];
  state.missionPhases = [];
  state.eventMarkers = [];
  state.flatSamples = [];
  state.missionStartMs = 0;
  state.missionStopMs = 0;
  state.currentMs = 0;

  state.diagnostics.missionJsonLoaded = false;
  state.diagnostics.moonJsonLoaded = false;
  state.diagnostics.eventsLoaded = false;
  updateDebugOverlay();
  _spokenEvents = new Map();
  _ttsVoiceCache = new Map();
  _ttsInFlight = new Set();
  _stopTtsPlayback();

  refs.timelineSlider.value = refs.timelineSlider.min;
  refs.sbUtc.textContent = '—';
  refs.sbMet.textContent = '—';
  refs.sbFrame.textContent = '—';
  refs.sbSampleCount.textContent = '—';
  refs.sbEvent.textContent = 'No events loaded';
  if (refs.sbPhase) refs.sbPhase.textContent = 'Phase: —';
  if (refs.sbSpeed) refs.sbSpeed.textContent = '—';
  if (refs.sbEarthDist) refs.sbEarthDist.textContent = '—';
  if (refs.sbMoonDist) refs.sbMoonDist.textContent = '—';
  if (refs.sbNextEvent) refs.sbNextEvent.textContent = '—';
  setSceneStartMissionButtonVisible(false);
  refreshTimelineEventTicks();
  resetSceneDynamicState();
}

function setSceneStartMissionButtonVisible(visible) {
  if (!refs?.btnSceneStartMission) return;
  refs.btnSceneStartMission.classList.toggle('hidden', !visible);
}

function shouldShowSceneStartMissionButton(sceneCalloutEvent) {
  if (!sceneCalloutEvent || sceneCalloutEvent.id !== 'mission-start') return false;
  if (!hasMissionTimeline() || state.playing) return false;
  return Math.abs(state.currentMs - state.missionStartMs) <= EVENT_NAV_EPS_MS;
}

function startMissionFromOverlay() {
  if (!hasMissionTimeline()) {
    setSidebarStatus('Playback unavailable — mission data not loaded');
    return;
  }
  if (state.ui.liveMode) setLiveModeUi(false);
  state.currentMs = state.missionStartMs;
  state.playing = true;
  refs.btnPlay.textContent = '⏸ Pause';
  setSceneStartMissionButtonVisible(false);
  updateScene();
  setSidebarStatus('Playback running');
}

function jumpToMissionStart() {
  if (!hasMissionTimeline()) {
    setSidebarStatus('Mission timeline unavailable');
    return;
  }
  if (state.ui.liveMode) setLiveModeUi(false, { status: false });
  state.currentMs = state.missionStartMs;
  updateScene();
  setSidebarStatus('Jumped to mission start');
  syncUrlState();
}

function jumpToMissionEnd() {
  if (!hasMissionTimeline()) {
    setSidebarStatus('Mission timeline unavailable');
    return;
  }
  if (state.ui.liveMode) setLiveModeUi(false, { status: false });
  state.currentMs = state.missionStopMs;
  updateScene();
  setSidebarStatus('Jumped to mission end');
  syncUrlState();
}

function jumpToPreviousEvent() {
  if (!hasMissionTimeline()) {
    setSidebarStatus('Mission timeline unavailable');
    return;
  }
  if (state.ui.liveMode) setLiveModeUi(false, { status: false });
  const previous = findPreviousEvent(state.events, state.currentMs);
  if (previous) {
    state.currentMs = clamp(previous.epochMs, state.missionStartMs, state.missionStopMs);
    updateScene();
    setSidebarStatus(`Jumped to event: ${previous.label}`);
    syncUrlState();
    return;
  }
  state.currentMs = state.missionStartMs;
  updateScene();
  setSidebarStatus('No previous event — at mission start');
  syncUrlState();
}

function jumpToNextEvent() {
  if (!hasMissionTimeline()) {
    setSidebarStatus('Mission timeline unavailable');
    return;
  }
  if (state.ui.liveMode) setLiveModeUi(false, { status: false });
  const next = findNextEvent(state.events, state.currentMs);
  if (next) {
    state.currentMs = clamp(next.epochMs, state.missionStartMs, state.missionStopMs);
    updateScene();
    setSidebarStatus(`Jumped to event: ${next.label}`);
    syncUrlState();
    return;
  }
  state.currentMs = state.missionStopMs;
  updateScene();
  setSidebarStatus('No next event — at mission end');
  syncUrlState();
}

function stepTime(deltaMs) {
  if (!hasMissionTimeline()) {
    setSidebarStatus('Mission timeline unavailable');
    return;
  }
  if (state.ui.liveMode) setLiveModeUi(false, { status: false });
  state.currentMs = clamp(state.currentMs + deltaMs, state.missionStartMs, state.missionStopMs);
  updateScene();
  syncUrlState();
}

function hasMissionTimeline() {
  return state.flatSamples.length > 0 && state.missionStopMs > state.missionStartMs;
}

function prepareMissionEvents(events, missionStartMs, missionStopMs) {
  const inRange = (events || []).filter((event) => event.epochMs >= missionStartMs && event.epochMs <= missionStopMs);
  const withBoundaries = [...inRange];
  if (!withBoundaries.some((event) => event.id === 'mission-start')) {
    withBoundaries.push({
      id: 'mission-start',
      label: 'Mission start',
      epochUtc: formatUtc(missionStartMs),
      epochMs: missionStartMs,
      metSeconds: 0,
      type: 'system-boundary',
      description: 'Derived from normalized mission window start.',
      verified: true,
      sourceNote: 'Derived from normalized mission data.',
    });
  }
  if (!withBoundaries.some((event) => event.id === 'mission-end')) {
    withBoundaries.push({
      id: 'mission-end',
      label: 'Mission end',
      epochUtc: formatUtc(missionStopMs),
      epochMs: missionStopMs,
      metSeconds: Math.max(0, Math.round((missionStopMs - missionStartMs) / 1000)),
      type: 'system-boundary',
      description: 'Derived from normalized mission window end.',
      verified: true,
      sourceNote: 'Derived from normalized mission data.',
    });
  }
  withBoundaries.sort((a, b) => a.epochMs - b.epochMs || a.id.localeCompare(b.id));
  return withBoundaries;
}

function findPreviousEvent(events, currentMs) {
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i].epochMs < currentMs - EVENT_NAV_EPS_MS) return events[i];
  }
  return null;
}

function findNextEvent(events, currentMs) {
  for (let i = 0; i < events.length; i++) {
    if (events[i].epochMs > currentMs + EVENT_NAV_EPS_MS) return events[i];
  }
  return null;
}

function eventVerificationTag(event) {
  if (!event) return '';
  return event.verified === true ? ' [verified]' : ' [unverified]';
}

function jumpToEventById(eventId) {
  const event = state.events.find((e) => e.id === eventId);
  if (!event || !hasMissionTimeline()) return;
  state.currentMs = clamp(event.epochMs, state.missionStartMs, state.missionStopMs);
  updateScene();
  setSidebarStatus(`Jumped to event: ${event.label}`);
  syncUrlState();
}

function onKeyboardShortcuts(event) {
  const active = document.activeElement;
  const inEditable = active && (
    active.tagName === 'INPUT' ||
    active.tagName === 'TEXTAREA' ||
    active.tagName === 'SELECT' ||
    active.isContentEditable
  );
  if (inEditable) return;
  if (event.code === 'Space') {
    event.preventDefault();
    refs.btnPlay.click();
    return;
  }
  if (event.code === 'ArrowLeft') {
    event.preventDefault();
    stepTime(-MS_PER_H);
    return;
  }
  if (event.code === 'ArrowRight') {
    event.preventDefault();
    stepTime(MS_PER_H);
    return;
  }
  if (event.code.toLowerCase() === 'keyf') {
    event.preventDefault();
    refs.btnCamFollow.click();
    return;
  }
  if (event.key === '+' || event.key === '=') {
    event.preventDefault();
    zoomCamera(1);
    syncZoomUiFromScene(true);
    setSidebarStatus('Zoomed in');
    return;
  }
  if (event.key === '-' || event.key === '_') {
    event.preventDefault();
    zoomCamera(-1);
    syncZoomUiFromScene(true);
    setSidebarStatus('Zoomed out');
    return;
  }
  if (event.code === 'KeyR') {
    event.preventDefault();
    refs.btnZoomReset.click();
  }
}

function refreshMissionAnnotations(mission) {
  refs.annotationList.innerHTML = '';
  const links = [];
  if (mission.officialPageUrl) links.push(`<a class="annotation-link" href="${mission.officialPageUrl}" target="_blank" rel="noopener">Official mission page</a>`);
  if (mission.officialZipUrl) links.push(`<a class="annotation-link" href="${mission.officialZipUrl}" target="_blank" rel="noopener">Official OEM ZIP</a>`);
  const sourceLi = document.createElement('li');
  sourceLi.innerHTML = [
    `<div class="annotation-label">${mission.summary}</div>`,
    `<div class="annotation-note">Normalized official OEM + JPL moon vectors</div>`,
    ...links,
  ].join('');
  refs.annotationList.appendChild(sourceLi);

  const topEvents = state.events.slice(0, 8);
  for (const event of topEvents) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'btn btn-sm annotation-jump-btn';
    btn.textContent = 'Jump';
    btn.addEventListener('click', () => jumpToEventById(event.id));
    const time = `<div class="annotation-time">${event.epochUtc}${eventVerificationTag(event)}</div>`;
    const label = `<div class="annotation-label">${event.label}</div>`;
    const note = event.sourceNote ? `<div class="annotation-note">${event.sourceNote}</div>` : '';
    li.innerHTML = `${time}${label}${note}`;
    li.appendChild(btn);
    refs.annotationList.appendChild(li);
  }
}

function parseInitialUiStateFromUrl() {
  const params = new URLSearchParams(window.location.search);
  _pendingDefaultLandingUtc = params.toString() ? null : (LANDING_DEFAULT_UTC_BY_MISSION[state.activeMissionId] || null);
  const mission = params.get('mission');
  const speed = params.get('speed');
  const perf = params.get('perf');
  const follow = params.get('follow');
  const cam = params.get('cam');
  const zoom = params.get('zoom');
  const vpreset = params.get('vpreset');
  const followMode = params.get('followMode');
  const attitude = params.get('attitude');
  const voice = params.get('voice');
  const voiceVol = params.get('voiceVol');
  const live = params.get('live');
  const a3mode = params.get('a3mode');
  const a5mode = params.get('a5mode');
  const candidateMission = MISSIONS.find((m) => m.id === mission && m.enabled)?.id;
  if (candidateMission) state.activeMissionId = candidateMission;
  if (ARTEMIS_3_PROFILE_MODES.includes(a3mode || '')) {
    state.ui.artemis3Mode = a3mode;
    state.artemis3.profileMode = a3mode;
  }
  if (ARTEMIS_5_PROFILE_MODES.includes(a5mode || '')) {
    state.ui.artemis5Mode = a5mode;
    state.artemis5.profileMode = a5mode;
  }
  const speedMatch = SPEED_OPTIONS.find((opt) => String(opt.missionMsPerWallSecond) === String(speed));
  if (speedMatch) refs.speedSelect.value = String(speedMatch.missionMsPerWallSecond);
  if (['auto', 'high', 'balanced', 'low'].includes(perf || '')) {
    state.ui.performanceMode = perf;
    refs.perfModeSelect.value = perf;
  } else {
    refs.perfModeSelect.value = state.ui.performanceMode;
  }
  setPerformanceMode(state.ui.performanceMode);
  const hasCameraPresetInUrl = ['earth-centered', 'moon-approach', 'mission-fit', 'follow-orion'].includes(cam || '');
  if (hasCameraPresetInUrl) {
    state.ui.cameraPreset = cam;
    if (cam !== 'follow-orion') state.ui.lastNonFollowCamera = cam;
  }
  if (follow === '1' || follow === '0') {
    state.ui.followCamera = follow === '1';
    if (!hasCameraPresetInUrl) {
      state.ui.cameraPreset = state.ui.followCamera ? 'follow-orion' : state.ui.lastNonFollowCamera;
    }
  }
  if (state.ui.cameraPreset === 'follow-orion') state.ui.followCamera = true;
  setFollowButtonUi();
  state.ui.liveMode = live === '1';
  setLiveButtonUi();
  setFollowCameraEnabled(state.ui.followCamera);
  const defaultFollowMode = getDefaultFollowModeForMission(state.activeMissionId);
  setFollowCameraModeUi(followMode || defaultFollowMode, { sync: false });
  setAttitudeReferenceUi(['velocity', 'earth', 'moon'].includes(attitude || '') ? attitude : 'velocity', { sync: false });
  setEventVoiceEnabledUi(voice === '1', { sync: false });
  const parsedVoiceVol = Number(voiceVol);
  if (Number.isFinite(parsedVoiceVol)) setEventVoiceVolumeUi(parsedVoiceVol, { sync: false });
  else setEventVoiceVolumeUi(state.ui.eventVoiceVolume, { sync: false });
  const presetMatch = VISUAL_PRESET_OPTIONS.find((opt) => opt.value === vpreset)?.value || getVisualPreset();
  setVisualPreset(presetMatch);
  state.ui.visualPreset = getVisualPreset();
  setVisualPresetUi(state.ui.visualPreset, { sync: false });
  if (zoom != null) {
    const parsedZoom = Number(zoom);
    if (Number.isFinite(parsedZoom)) {
      setZoomLevel(clamp(parsedZoom, 0, 1));
      state.ui.zoomLevel = getZoomLevel();
    }
  } else {
    state.ui.zoomLevel = getZoomLevel();
  }
}

function getLandingDefaultUtcForMission(missionId) {
  return LANDING_DEFAULT_UTC_BY_MISSION[missionId] || null;
}

function getLandingDefaultFollowModeForMission(missionId) {
  if (missionId === LANDING_DEFAULTS.missionId) {
    return getDefaultFollowModeForMission(missionId);
  }
  return getDefaultFollowModeForMission(missionId);
}

function applyInitialTimeOverrideFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const utc = params.get('utc') || _pendingDefaultLandingUtc;
  _pendingDefaultLandingUtc = null;
  if (!utc) return;
  const parsed = Date.parse(utc);
  if (!Number.isFinite(parsed)) return;
  state.currentMs = clamp(parsed, state.missionStartMs, state.missionStopMs);
  updateScene();
}

function syncUrlState() {
  const params = new URLSearchParams();
  const missionId = state.activeMissionId || LANDING_DEFAULTS.missionId;
  const speedValue = String(refs.speedSelect.value);
  const perfValue = state.ui.performanceMode || LANDING_DEFAULTS.performanceMode;
  const followValue = state.ui.followCamera ? '1' : '0';
  const followModeValue = state.ui.followCameraMode || getLandingDefaultFollowModeForMission(missionId);
  const attitudeValue = state.ui.attitudeReference || LANDING_DEFAULTS.attitudeReference;
  const voiceValue = state.ui.eventVoiceEnabled ? '1' : '0';
  const voiceVolValue = (Number.isFinite(state.ui.eventVoiceVolume) ? state.ui.eventVoiceVolume : LANDING_DEFAULTS.eventVoiceVolume).toFixed(2);
  const cameraValue = state.ui.cameraPreset || LANDING_DEFAULTS.cameraPreset;
  const zoomValue = (Number.isFinite(state.ui.zoomLevel) ? state.ui.zoomLevel : getZoomLevel()).toFixed(3);
  const visualPresetValue = state.ui.visualPreset || getVisualPreset();
  const liveValue = state.ui.liveMode ? '1' : '0';
  const utcValue = Number.isFinite(state.currentMs) && state.currentMs > 0 ? formatUtc(state.currentMs) : '';
  const defaultUtcForMission = getLandingDefaultUtcForMission(missionId);

  if (missionId !== LANDING_DEFAULTS.missionId) params.set('mission', missionId);
  if (speedValue !== String(LANDING_DEFAULTS.speedMissionMsPerWallSecond)) params.set('speed', speedValue);
  if (perfValue !== LANDING_DEFAULTS.performanceMode) params.set('perf', perfValue);
  if (followValue !== (LANDING_DEFAULTS.followCamera ? '1' : '0')) params.set('follow', followValue);
  if (followModeValue !== getLandingDefaultFollowModeForMission(missionId)) params.set('followMode', followModeValue);
  if (attitudeValue !== LANDING_DEFAULTS.attitudeReference) params.set('attitude', attitudeValue);
  if (voiceValue !== (LANDING_DEFAULTS.eventVoiceEnabled ? '1' : '0')) params.set('voice', voiceValue);
  if (voiceVolValue !== LANDING_DEFAULTS.eventVoiceVolume.toFixed(2)) params.set('voiceVol', voiceVolValue);
  if (cameraValue !== LANDING_DEFAULTS.cameraPreset) params.set('cam', cameraValue);
  if (zoomValue !== LANDING_DEFAULTS.zoomLevel.toFixed(3)) params.set('zoom', zoomValue);
  if (visualPresetValue !== LANDING_DEFAULTS.visualPreset) params.set('vpreset', visualPresetValue);
  if (liveValue !== (LANDING_DEFAULTS.liveMode ? '1' : '0')) params.set('live', liveValue);
  if (utcValue && utcValue !== defaultUtcForMission) params.set('utc', utcValue);

  if (state.activeMissionId === 'artemis-3') {
    const a3Mode = state.ui.artemis3Mode || ARTEMIS_3_PROFILE_DEFAULT;
    if (a3Mode !== ARTEMIS_3_PROFILE_DEFAULT) params.set('a3mode', a3Mode);
  }
  if (state.activeMissionId === 'artemis-5') {
    const a5Mode = state.ui.artemis5Mode || ARTEMIS_5_PROFILE_DEFAULT;
    if (a5Mode !== ARTEMIS_5_PROFILE_DEFAULT) params.set('a5mode', a5Mode);
  }
  const query = params.toString();
  const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  if (_lastSyncedUrl !== next) {
    history.replaceState(null, '', next);
    _lastSyncedUrl = next;
    updateEmbedSnippets();
  }
}

function syncZoomUiFromScene(syncUrl = false) {
  const zoomLevel = clamp(getZoomLevel(), 0, 1);
  state.ui.zoomLevel = zoomLevel;
  const max = Number(refs.zoomSlider.max) || 1000;
  const nextSlider = Math.round(zoomLevel * max);
  refs.zoomSlider.value = String(nextSlider);
  const changed = _lastZoomUiValue !== nextSlider;
  if (changed || syncUrl) {
    refs.zoomValue.textContent = `${Math.round(zoomLevel * 100)}%`;
    _lastZoomUiValue = nextSlider;
  }
  if (changed || syncUrl) syncUrlState();
}

function setVisualPresetUi(value, { sync = true } = {}) {
  const nextPreset = VISUAL_PRESET_OPTIONS.find((opt) => opt.value === value)?.value || getVisualPreset();
  setVisualPreset(nextPreset);
  state.ui.visualPreset = getVisualPreset();
  refs.visualPresetSelect.value = state.ui.visualPreset;
  if (sync) syncUrlState();
}


function setAttitudeReferenceUi(value, { sync = true } = {}) {
  const allowed = ['velocity', 'earth', 'moon'];
  const next = allowed.includes(value) ? value : 'velocity';
  state.ui.attitudeReference = next;
  if (refs.attitudeSelect) refs.attitudeSelect.value = next;
  setOrionAttitudeReference(next);
  if (sync) syncUrlState();
}

function setFollowCameraModeUi(value, { sync = true } = {}) {
  const allowed = ['chase', 'cinematic', 'side', 'earth-frame', 'moon-frame'];
  const normalized = value === 'standard' ? 'chase' : value;
  const next = allowed.includes(normalized) ? normalized : 'chase';
  state.ui.followCameraMode = next;
  if (refs.followModeSelect) refs.followModeSelect.value = next;
  setFollowCameraMode(next);
  if (sync) syncUrlState();
}

function setLiveButtonUi() {
  if (!refs.btnLive) return;
  refs.btnLive.classList.toggle('btn-live', state.ui.liveMode);
  refs.btnLive.textContent = `Live: ${state.ui.liveMode ? 'On' : 'Off'}`;
}

function setLiveModeUi(enabled, { sync = true, status = true } = {}) {
  const shouldEnable = Boolean(enabled);
  if (shouldEnable && !hasMissionTimeline()) {
    if (status) setSidebarStatus('Live mode unavailable — mission timeline missing');
    state.ui.liveMode = false;
    setLiveButtonUi();
    if (sync) syncUrlState();
    return;
  }
  state.ui.liveMode = shouldEnable;
  if (state.ui.liveMode) {
    state.playing = false;
    refs.btnPlay.textContent = '▶ Play';
    state.currentMs = clamp(Date.now(), state.missionStartMs, state.missionStopMs);
    updateScene();
  }
  setLiveButtonUi();
  if (sync) syncUrlState();
}

function setEventVoiceEnabledUi(enabled, { sync = true } = {}) {
  state.ui.eventVoiceEnabled = Boolean(enabled);
  if (refs.chkEventVoice) refs.chkEventVoice.checked = state.ui.eventVoiceEnabled;
  if (refs.btnTtsToggle) {
    refs.btnTtsToggle.classList.toggle('is-toggled', state.ui.eventVoiceEnabled);
    refs.btnTtsToggle.textContent = `Event voice: ${state.ui.eventVoiceEnabled ? 'On' : 'Off'}`;
  }
  if (refs.ttsStatus) {
    refs.ttsStatus.textContent = state.ui.eventVoiceEnabled ? 'Voice callouts ready' : 'Voice callouts muted';
  }
  if (!state.ui.eventVoiceEnabled) _stopTtsPlayback();
  if (sync) syncUrlState();
}

function setEventVoiceVolumeUi(volume, { sync = true } = {}) {
  const normalized = clamp(Number(volume), 0, 1);
  state.ui.eventVoiceVolume = normalized;
  if (refs.voiceVolumeSlider) {
    refs.voiceVolumeSlider.value = String(Math.round(normalized * 100));
  }
  if (refs.voiceVolumeValue) {
    refs.voiceVolumeValue.textContent = `${Math.round(normalized * 100)}%`;
  }
  if (_currentTtsAudio) _currentTtsAudio.volume = normalized;
  if (sync) syncUrlState();
}

function isManeuverEvent(event) {
  if (!event) return false;
  const text = `${event.type || ''} ${event.label || ''}`.toLowerCase();
  return text.includes('burn') || text.includes('maneuver') || text.includes('trajectory correction') || text.includes('insertion') || text.includes('departure');
}

function getManeuverIntensity(events, currentMs) {
  let best = 0;
  for (const event of events || []) {
    if (!isManeuverEvent(event)) continue;
    const dt = Math.abs(event.epochMs - currentMs);
    if (dt > MANEUVER_WINDOW_MS) continue;
    const f = 1 - (dt / MANEUVER_WINDOW_MS);
    if (f > best) best = f;
  }
  return clamp(best, 0, 1);
}

function getSceneEventCallout(events, currentMs) {
  for (const event of events || []) {
    if (Math.abs(event.epochMs - currentMs) <= EVENT_CALLOUT_WINDOW_MS) return event;
  }
  return null;
}

function exportScenePng() {
  const dataUrl = captureSceneImage();
  if (!dataUrl) {
    setSidebarStatus('Unable to export scene image');
    return;
  }
  const stamp = formatUtc(state.currentMs).replace(/[:]/g, '-').replace(/\./g, '-');
  const filename = `${state.activeMissionId || 'artemis'}-${stamp}.png`;
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setSidebarStatus(`Exported screenshot: ${filename}`);
}

function maybeSpeakSceneEvent(event) {
  if (!state.ui.eventVoiceEnabled) return;
  if (!event?.id || !event?.label) return;
  const now = Date.now();
  const lastSpokenAt = _spokenEvents.get(event.id) || 0;
  if (now - lastSpokenAt < TTS_SPEAK_COOLDOWN_MS) return;
  if (_ttsInFlight.has(event.id)) return;
  _spokenEvents.set(event.id, now);
  _speakEventLabel(event.id, event.label).catch(() => {
    // Fail quietly; visual callouts still show event context.
  });
}

async function _speakEventLabel(eventId, label) {
  const text = String(label || '').trim();
  if (!text) return;
  const cacheKey = `${eventId}:${text}`;
  if (_ttsVoiceCache.has(cacheKey)) {
    _playAudioDataUrl(_ttsVoiceCache.get(cacheKey));
    return;
  }
  _ttsInFlight.add(eventId);
  try {
    const res = await fetch(`${TTS_SERVICE_BASE_URL}/v1/tts`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        text,
        voice: 'alloy',
        format: 'mp3',
      }),
    });
    if (!res.ok) throw new Error(`TTS HTTP ${res.status}`);
    const payload = await res.json();
    const audioBase64 = payload?.audioBase64;
    if (!audioBase64) throw new Error('Missing audioBase64 in /v1/tts response');
    const dataUrl = `data:audio/mpeg;base64,${audioBase64}`;
    _ttsVoiceCache.set(cacheKey, dataUrl);
    _playAudioDataUrl(dataUrl);
  } finally {
    _ttsInFlight.delete(eventId);
  }
}

function _playAudioDataUrl(dataUrl) {
  _stopTtsPlayback();
  const audio = new Audio(dataUrl);
  audio.volume = clamp(state.ui.eventVoiceVolume, 0, 1);
  _currentTtsAudio = audio;
  audio.addEventListener('ended', () => {
    if (_currentTtsAudio === audio) _currentTtsAudio = null;
  }, { once: true });
  audio.play().catch(() => {
    // Browser autoplay policies can block audio until user interaction.
  });
}

function _stopTtsPlayback() {
  if (!_currentTtsAudio) return;
  _currentTtsAudio.pause();
  _currentTtsAudio.currentTime = 0;
  _currentTtsAudio = null;
}

function showControlsHintIfNeeded() {
  let dismissed = false;
  try {
    dismissed = window.localStorage.getItem(CONTROLS_HINT_STORAGE_KEY) === '1';
  } catch {
    dismissed = false;
  }
  refs.controlsHint.classList.toggle('hidden', dismissed);
}

function hideControlsHint({ persist = false } = {}) {
  refs.controlsHint.classList.add('hidden');
  if (!persist) return;
  try {
    window.localStorage.setItem(CONTROLS_HINT_STORAGE_KEY, '1');
  } catch {
    // localStorage might be unavailable in some browser modes.
  }
}

function applyCameraPreset(preset, { sync = true } = {}) {
  if (preset === 'follow-orion') {
    state.ui.followCamera = true;
    state.ui.cameraPreset = 'follow-orion';
    setFollowCameraEnabled(true);
    setFollowButtonUi();
    if (sync) syncUrlState();
    return;
  }
  state.ui.followCamera = false;
  state.ui.lastNonFollowCamera = preset;
  state.ui.cameraPreset = preset;
  setFollowCameraEnabled(false);
  setFollowButtonUi();
  if (preset === 'moon-approach') {
    const moonState = getInterpolatedState(state.moonData, state.currentMs);
    focusCameraPreset('moon-approach', { moonKm: moonState?.positionKm || null });
  } else if (preset === 'earth-centered') {
    focusCameraPreset('earth-centered');
  } else {
    focusCameraPreset('mission-fit', { boundsKm: state.missionData?.derived?.boundsKm });
  }
  if (sync) syncUrlState();
}

function setFollowButtonUi() {
  refs.btnCamFollow.classList.toggle('is-toggled', state.ui.followCamera);
  refs.btnCamFollow.textContent = `Follow Orion: ${state.ui.followCamera ? 'On' : 'Off'}`;
}

function onResize() {
  const rect = refs?.canvas?.getBoundingClientRect?.();
  const width = refs?.canvas?.clientWidth || rect?.width || Math.max(640, Math.floor(window.innerWidth * 0.66)) || 960;
  const height = refs?.canvas?.clientHeight || rect?.height || Math.max(360, Math.floor(window.innerHeight * 0.6)) || 540;
  resizeScene(width, height);
}

function scheduleStartupResizeRetries() {
  let tries = 0;
  const maxTries = 8;
  function retry() {
    tries += 1;
    onResize();
    if (tries < maxTries && refs?.canvas && (refs.canvas.clientWidth <= 1 || refs.canvas.clientHeight <= 1)) {
      requestAnimationFrame(retry);
    }
  }
  requestAnimationFrame(retry);
}

function showOverlay(msg) {
  refs.overlayMsg.textContent = msg;
  refs.overlayMsg.classList.remove('hidden');
}

function hideOverlay() {
  refs.overlayMsg.classList.add('hidden');
}

function setSidebarStatus(msg) {
  refs.sbStatus.textContent = msg;
  const lowered = String(msg || '').toLowerCase();
  refs.sbStatus.classList.remove('status-ok', 'status-warn', 'status-error');
  if (lowered.includes('runtime error')) refs.sbStatus.classList.add('status-error');
  else if (lowered.includes('fallback') || lowered.includes('missing') || lowered.includes('waiting')) refs.sbStatus.classList.add('status-warn');
  else refs.sbStatus.classList.add('status-ok');
}

function setErrorMessage(message) {
  state.diagnostics.lastError = message;
  updateDebugOverlay();
}

function handleStartupError(context, error) {
  const detail = error instanceof Error ? error.message : String(error || 'Unknown error');
  const full = `${context}: ${detail}`;
  console.error('[artemis-orbits] Runtime error', error);
  state.playing = false;
  if (refs?.btnPlay) refs.btnPlay.textContent = '▶ Play';
  if (refs?.sbStatus) setSidebarStatus('Runtime error — see debug overlay');
  if (refs?.overlayMsg) showOverlay('Runtime error while loading mission scene. Fallback scene remains active.');
  try {
    showFallbackBodies();
    focusCameraPreset('fallback-overview');
  } catch {
    // keep going; diagnostics still records failure.
  }
  setErrorMessage(full);
}

function updateDebugOverlay() {
  if (!refs?.debugOverlay) return;
  const d = state.diagnostics;
  refs.debugOverlay.textContent = [
    `scene initialized: ${d.sceneInitialized ? 'yes' : 'no'}`,
    `renderer initialized: ${d.rendererInitialized ? 'yes' : 'no'}`,
    `mission JSON loaded: ${d.missionJsonLoaded ? 'yes' : 'no'}`,
    `moon JSON loaded: ${d.moonJsonLoaded ? 'yes' : 'no'}`,
    `events loaded: ${d.eventsLoaded ? 'yes' : 'no'}`,
    `last error: ${d.lastError || 'none'}`,
  ].join('\n');
}
