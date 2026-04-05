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
  ui: {
    performanceMode: 'auto',
    followCamera: false,
    followCameraMode: getDefaultFollowModeForMission(ACTIVE_MISSION_ID),
    attitudeReference: 'velocity',
    eventVoiceEnabled: false,
    eventVoiceVolume: 0.75,
    cameraPreset: 'mission-fit',
    lastNonFollowCamera: 'mission-fit',
    visualPreset: 'bright',
    zoomLevel: 0.5,
    liveMode: false,
  },
};

let refs = null;
let _lastSyncedUrl = '';
let _lastZoomUiValue = -1;
let _ttsVoiceCache = new Map();
let _ttsInFlight = new Set();
let _spokenEvents = new Map();
let _currentTtsAudio = null;

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
    overlayMsg: pick('scene-overlay-msg'),
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
    btnPrevEvent: pick('btn-prev-event'),
    btnNextEvent: pick('btn-next-event'),
    btnMinus1h: pick('btn-minus-1h'),
    btnPlus1h: pick('btn-plus-1h'),
    btnMinus1d: pick('btn-minus-1d'),
    btnPlus1d: pick('btn-plus-1d'),
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
    controlsHint: pick('controls-hint'),
    btnDismissHint: pick('btn-dismiss-hint'),
    btnCapture: pickOptional('btn-export-image'),
    chkEventVoice: pickOptional('chk-event-voice'),
    btnTtsToggle: pickOptional('btn-tts-toggle'),
    voiceVolumeSlider: pickOptional('voice-volume-slider') || pickOptional('tts-volume'),
    voiceVolumeValue: pickOptional('voice-volume-value'),
    ttsStatus: pickOptional('tts-status'),
    annotationList: pick('mission-annotations'),
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

function wireUiEvents() {
  setEventMarkerClickHandler(({ eventId }) => {
    jumpToEventById(eventId);
  });
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
  refs.btnPrevEvent.addEventListener('click', () => jumpToPreviousEvent());
  refs.btnNextEvent.addEventListener('click', () => jumpToNextEvent());
  refs.btnMinus1h.addEventListener('click', () => stepTime(-MS_PER_H));
  refs.btnPlus1h.addEventListener('click', () => stepTime(MS_PER_H));
  refs.btnMinus1d.addEventListener('click', () => stepTime(-MS_PER_D));
  refs.btnPlus1d.addEventListener('click', () => stepTime(MS_PER_D));
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

  setActiveTab(id);
  resetLoadedMissionState();

  refs.sbTitle.textContent = mission.displayName;
  refs.sbSummary.textContent = mission.summary;
  state.playing = false;
  refs.btnPlay.textContent = '▶ Play';

  if (!mission.enabled) {
    showOverlay(`${mission.displayName} — ${mission.summary}`);
    setSidebarStatus('Mission JSON missing');
    return;
  }

  setSidebarStatus('Fallback scene active — waiting for mission data');

  try {
    state.missionData = await loadMissionData(mission.normalizedPath);
    state.diagnostics.missionJsonLoaded = Boolean(state.missionData);
  } catch (error) {
    handleStartupError('Mission JSON load failed', error);
    return;
  }

  let loadedEvents = null;
  try {
    state.moonData = await loadMissionData(mission.moonPath);
    state.diagnostics.moonJsonLoaded = Boolean(state.moonData);
  } catch (error) {
    setErrorMessage(`Moon JSON load failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    loadedEvents = await loadJson(mission.eventsPath);
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
  setMoonTrajectoryBySegment(state.moonData?.segments || []);
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
  applyInitialTimeOverrideFromUrl();
  if (state.ui.liveMode) setLiveModeUi(true, { sync: false, status: false });
  syncUrlState();

  const missionLabel = mission.id === 'artemis-1' ? 'Mission scene active — Artemis I' : 'Mission scene active — Artemis II';
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
  setActiveEventCallout(sceneCalloutEvent);
  maybeSpeakSceneEvent(sceneCalloutEvent);
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
  refreshTimelineEventTicks();
  resetSceneDynamicState();
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
  const candidateMission = MISSIONS.find((m) => m.id === mission && m.enabled)?.id;
  if (candidateMission) state.activeMissionId = candidateMission;
  const speedMatch = SPEED_OPTIONS.find((opt) => String(opt.missionMsPerWallSecond) === String(speed));
  if (speedMatch) refs.speedSelect.value = String(speedMatch.missionMsPerWallSecond);
  if (['auto', 'high', 'balanced', 'low'].includes(perf || '')) {
    state.ui.performanceMode = perf;
    refs.perfModeSelect.value = perf;
  } else {
    refs.perfModeSelect.value = state.ui.performanceMode;
  }
  setPerformanceMode(state.ui.performanceMode);
  if (['earth-centered', 'moon-approach', 'mission-fit', 'follow-orion'].includes(cam || '')) {
    state.ui.cameraPreset = cam;
    if (cam !== 'follow-orion') state.ui.lastNonFollowCamera = cam;
  }
  state.ui.followCamera = follow === '1';
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

function applyInitialTimeOverrideFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const utc = params.get('utc');
  if (!utc) return;
  const parsed = Date.parse(utc);
  if (!Number.isFinite(parsed)) return;
  state.currentMs = clamp(parsed, state.missionStartMs, state.missionStopMs);
  updateScene();
}

function syncUrlState() {
  const params = new URLSearchParams(window.location.search);
  if (state.activeMissionId) params.set('mission', state.activeMissionId);
  if (Number.isFinite(state.currentMs) && state.currentMs > 0) params.set('utc', formatUtc(state.currentMs));
  params.set('speed', refs.speedSelect.value);
  params.set('perf', state.ui.performanceMode);
  params.set('follow', state.ui.followCamera ? '1' : '0');
  params.set('followMode', state.ui.followCameraMode || 'chase');
  params.set('attitude', state.ui.attitudeReference || 'velocity');
  params.set('voice', state.ui.eventVoiceEnabled ? '1' : '0');
  params.set('voiceVol', (Number.isFinite(state.ui.eventVoiceVolume) ? state.ui.eventVoiceVolume : 0.75).toFixed(2));
  params.set('cam', state.ui.cameraPreset);
  params.set('zoom', (Number.isFinite(state.ui.zoomLevel) ? state.ui.zoomLevel : getZoomLevel()).toFixed(3));
  params.set('vpreset', state.ui.visualPreset || getVisualPreset());
  params.set('live', state.ui.liveMode ? '1' : '0');
  const query = params.toString();
  const next = query ? `${window.location.pathname}?${query}` : window.location.pathname;
  if (_lastSyncedUrl !== next) {
    history.replaceState(null, '', next);
    _lastSyncedUrl = next;
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
