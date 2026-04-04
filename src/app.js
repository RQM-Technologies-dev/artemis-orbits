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
  setEventMarkerClickHandler,
  setZoomChangeListener,
  zoomCamera,
  setZoomLevel,
  getZoomLevel,
  resetZoom,
  setVisualPreset,
  getVisualPreset,
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

const state = {
  activeMissionId: ACTIVE_MISSION_ID,
  missionData: null,
  moonData: null,
  events: [],
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
    cameraPreset: 'mission-fit',
    lastNonFollowCamera: 'mission-fit',
    visualPreset: 'bright',
    zoomLevel: 0.5,
  },
};

let refs = null;
let _lastSyncedUrl = '';
let _lastZoomUiValue = -1;

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

  return {
    tabBar: pick('mission-tabs'),
    canvas: pick('three-canvas'),
    overlayMsg: pick('scene-overlay-msg'),
    debugOverlay: pick('scene-debug-overlay'),
    sbTitle: pick('sb-mission-title'),
    sbSummary: pick('sb-mission-summary'),
    sbStatus: pick('sb-status-msg'),
    sbUtc: pick('sb-utc'),
    sbMet: pick('sb-met'),
    sbFrame: pick('sb-frame'),
    sbSampleCount: pick('sb-sample-count'),
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
    speedSelect: pick('speed-select'),
    timelineSlider: pick('timeline-slider'),
    timelineTicks: pick('timeline-ticks'),
    btnCamEarth: pick('btn-cam-earth'),
    btnCamMoon: pick('btn-cam-moon'),
    btnCamFit: pick('btn-cam-fit'),
    btnCamFollow: pick('btn-cam-follow'),
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
    annotationList: pick('mission-annotations'),
  };
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

  let orionPos = null;
  if (segState.state === 'in-segment') {
    const segmentState = interpolateSegment(segState.segment, segState.snappedMs);
    orionPos = segmentState.positionKm;
  } else if (segState.state === 'gap') {
    const snapped = findSegment(state.missionData, segState.gap.nearestBoundaryMs);
    if (snapped.segment) {
      const segmentState = interpolateSegment(snapped.segment, snapped.snappedMs);
      orionPos = segmentState.positionKm;
    }
  }

  updateBodies(orionPos, moonState?.positionKm || null);
  setTraversedTrailBySegment(state.missionData.segments || [], state.currentMs);

  const idx = findSampleIndex(state.flatSamples, state.currentMs);
  refs.sbFrame.textContent = `${idx + 1} / ${state.flatSamples.length} (${segState.state})`;

  const eventCtx = getEventContext(state.events, state.currentMs);
  if (eventCtx.active) refs.sbEvent.textContent = `${eventCtx.active.label}${eventVerificationTag(eventCtx.active)} (active)`;
  else if (eventCtx.nearest) refs.sbEvent.textContent = `${eventCtx.nearest.label}${eventVerificationTag(eventCtx.nearest)} (nearest)`;
  else refs.sbEvent.textContent = 'No events loaded';
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
    tick.style.left = `${pct}%`;
    tick.title = `${event.label} — ${event.epochUtc}`;
    tick.addEventListener('click', () => jumpToEventById(event.id));
    refs.timelineTicks.appendChild(tick);
  }
}

function resetLoadedMissionState() {
  state.missionData = null;
  state.moonData = null;
  state.events = [];
  state.eventMarkers = [];
  state.flatSamples = [];
  state.missionStartMs = 0;
  state.missionStopMs = 0;
  state.currentMs = 0;

  state.diagnostics.missionJsonLoaded = false;
  state.diagnostics.moonJsonLoaded = false;
  state.diagnostics.eventsLoaded = false;
  updateDebugOverlay();

  refs.timelineSlider.value = refs.timelineSlider.min;
  refs.sbUtc.textContent = '—';
  refs.sbMet.textContent = '—';
  refs.sbFrame.textContent = '—';
  refs.sbSampleCount.textContent = '—';
  refs.sbEvent.textContent = 'No events loaded';
  refreshTimelineEventTicks();
  resetSceneDynamicState();
}

function jumpToMissionStart() {
  if (!hasMissionTimeline()) {
    setSidebarStatus('Mission timeline unavailable');
    return;
  }
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
  setFollowCameraEnabled(state.ui.followCamera);
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
  params.set('cam', state.ui.cameraPreset);
  params.set('zoom', (Number.isFinite(state.ui.zoomLevel) ? state.ui.zoomLevel : getZoomLevel()).toFixed(3));
  params.set('vpreset', state.ui.visualPreset || getVisualPreset());
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
    focusCameraPreset('earth-centered');
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
