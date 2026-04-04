/**
 * app.js – main entry point for the Artemis orbit viewer.
 */

import { MISSIONS, ACTIVE_MISSION_ID } from './config/missions.js';
import {
  createScene,
  updateBodies,
  setMissionTrailsBySegment,
  setTraversedTrailBySegment,
  setEventMarkers,
  focusCameraPreset,
  resizeScene,
  renderScene,
  resetSceneDynamicState,
  showFallbackBodies,
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

const state = {
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
};

let refs = null;

bootstrapApp();

function bootstrapApp() {
  try {
    refs = getDomRefs();
    try {
      createScene(refs.canvas);
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
    buildTabs();
    wireUiEvents();

    selectMission(ACTIVE_MISSION_ID)
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
    focusCameraPreset('earth-centered');
    setSidebarStatus('Camera preset: Earth-centered');
  });
  refs.btnCamMoon.addEventListener('click', () => {
    const moonState = getInterpolatedState(state.moonData, state.currentMs);
    focusCameraPreset('moon-approach', { moonKm: moonState?.positionKm || null });
    setSidebarStatus('Camera preset: Moon-approach');
  });
  refs.btnCamFit.addEventListener('click', () => {
    focusCameraPreset('mission-fit', { boundsKm: state.missionData?.derived?.boundsKm });
    setSidebarStatus('Camera preset: Mission-fit');
  });

  refs.speedSelect.addEventListener('change', () => {
    const selected = refs.speedSelect.options[refs.speedSelect.selectedIndex];
    if (selected) setSidebarStatus(`Playback speed: ${selected.textContent}`);
  });

  refs.timelineSlider.addEventListener('mousedown', () => { state.scrubbing = true; });
  refs.timelineSlider.addEventListener('touchstart', () => { state.scrubbing = true; }, { passive: true });
  refs.timelineSlider.addEventListener('input', () => {
    if (!state.flatSamples.length || state.missionStopMs <= state.missionStartMs) return;
    const f = Number(refs.timelineSlider.value) / Number(refs.timelineSlider.max);
    state.currentMs = state.missionStartMs + f * (state.missionStopMs - state.missionStartMs);
    updateScene();
  });

  window.addEventListener('mouseup', () => { state.scrubbing = false; });
  window.addEventListener('touchend', () => { state.scrubbing = false; });
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
  try {
    buildEventMarkers();
  } catch (error) {
    handleStartupError('Event marker build failed', error);
    return;
  }
  refreshTimelineEventTicks();
  try {
    focusCameraPreset('mission-fit', { boundsKm: state.missionData?.derived?.boundsKm });
  } catch (error) {
    handleStartupError('Camera setup failed', error);
  }
  updateScene();

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
    } catch (error) {
      handleStartupError('Render loop failure', error);
    }
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
}

function jumpToMissionEnd() {
  if (!hasMissionTimeline()) {
    setSidebarStatus('Mission timeline unavailable');
    return;
  }
  state.currentMs = state.missionStopMs;
  updateScene();
  setSidebarStatus('Jumped to mission end');
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
    return;
  }
  state.currentMs = state.missionStartMs;
  updateScene();
  setSidebarStatus('No previous event — at mission start');
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
    return;
  }
  state.currentMs = state.missionStopMs;
  updateScene();
  setSidebarStatus('No next event — at mission end');
}

function stepTime(deltaMs) {
  if (!hasMissionTimeline()) {
    setSidebarStatus('Mission timeline unavailable');
    return;
  }
  state.currentMs = clamp(state.currentMs + deltaMs, state.missionStartMs, state.missionStopMs);
  updateScene();
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
