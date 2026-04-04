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
} from './lib/scene.js';
import {
  loadMissionData,
  loadJson,
  flattenSamples,
  findSegment,
  findSampleIndex,
  getSortedSegmentBounds,
  getMissionTimeBounds,
  sortEvents,
  getEventContext,
} from './lib/dataLoader.js';
import { interpolateSegment } from './lib/interpolate.js';
import { formatUtc, formatMet, clamp } from './lib/time.js';

const tabBar = document.getElementById('mission-tabs');
const canvas = document.getElementById('three-canvas');
const overlayMsg = document.getElementById('scene-overlay-msg');
const sbTitle = document.getElementById('sb-mission-title');
const sbSummary = document.getElementById('sb-mission-summary');
const sbStatus = document.getElementById('sb-status-msg');
const sbUtc = document.getElementById('sb-utc');
const sbMet = document.getElementById('sb-met');
const sbFrame = document.getElementById('sb-frame');
const sbSampleCount = document.getElementById('sb-sample-count');
const sbEvent = document.getElementById('sb-current-event');
const btnPlay = document.getElementById('btn-play');
const btnReset = document.getElementById('btn-reset');
const btnJumpStart = document.getElementById('btn-jump-start');
const btnJumpEnd = document.getElementById('btn-jump-end');
const btnPrevEvent = document.getElementById('btn-prev-event');
const btnNextEvent = document.getElementById('btn-next-event');
const btnMinus1h = document.getElementById('btn-minus-1h');
const btnPlus1h = document.getElementById('btn-plus-1h');
const btnMinus1d = document.getElementById('btn-minus-1d');
const btnPlus1d = document.getElementById('btn-plus-1d');
const speedSelect = document.getElementById('speed-select');
const timelineSlider = document.getElementById('timeline-slider');
const timelineTicks = document.getElementById('timeline-ticks');
const btnCamEarth = document.getElementById('btn-cam-earth');
const btnCamMoon = document.getElementById('btn-cam-moon');
const btnCamFit = document.getElementById('btn-cam-fit');

let missionData = null;
let moonData = null;
let events = [];
let eventMarkers = [];
let segmentBounds = [];
let flatSamples = [];
let flatMoon = [];
let missionStartMs = 0;
let missionStopMs = 0;
let currentMs = 0;
let playing = false;
let scrubbing = false;

const MS_PER_H = 3_600_000;
const MS_PER_D = 86_400_000;

const SPEED_OPTIONS = [
  { label: '1x real time', missionMsPerWallSecond: 1000 },
  { label: '1 min/sec', missionMsPerWallSecond: 60_000 },
  { label: '10 min/sec', missionMsPerWallSecond: 600_000 },
  { label: '1 hr/sec', missionMsPerWallSecond: 3_600_000 },
  { label: '6 hr/sec', missionMsPerWallSecond: 21_600_000 },
  { label: '12 hr/sec', missionMsPerWallSecond: 43_200_000 },
  { label: '1 day/sec', missionMsPerWallSecond: 86_400_000 },
];

createScene(canvas);
buildSpeedOptions();
buildTabs();
selectMission(ACTIVE_MISSION_ID);
startRafLoop();
window.addEventListener('resize', onResize);
onResize();

function buildSpeedOptions() {
  speedSelect.innerHTML = '';
  for (const opt of SPEED_OPTIONS) {
    const option = document.createElement('option');
    option.value = String(opt.missionMsPerWallSecond);
    option.textContent = opt.label;
    if (opt.label === '1 hr/sec') option.selected = true;
    speedSelect.appendChild(option);
  }
}

function buildTabs() {
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
      selectMission(m.id);
    });
    tabBar.appendChild(btn);
  }
}

function setActiveTab(id) {
  for (const btn of tabBar.querySelectorAll('.tab-btn')) {
    const active = btn.dataset.id === id;
    btn.classList.toggle('tab-active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  }
}

async function selectMission(id) {
  const mission = MISSIONS.find((m) => m.id === id);
  if (!mission) return;

  setActiveTab(id);
  setStatus('Loading mission data…');
  playing = false;
  btnPlay.textContent = '▶ Play';

  sbTitle.textContent = mission.displayName;
  sbSummary.textContent = mission.summary;
  sbFrame.textContent = '—';

  if (!mission.enabled) {
    showOverlay(`${mission.displayName} — ${mission.summary}`);
    setStatus('Data missing: mission placeholder (disabled).');
    sbSampleCount.textContent = '—';
    return;
  }

  missionData = await loadMissionData(mission.normalizedPath);
  moonData = await loadMissionData(mission.moonPath);
  const loadedEvents = await loadJson(mission.eventsPath);
  events = sortEvents(loadedEvents);

  if (!missionData) {
    showOverlay('Normalized mission data missing. Run scripts/normalize_oem.py and scripts/fetch_moon_vectors.py.');
    setStatus('Data missing: normalized mission JSON unavailable.');
    sbSampleCount.textContent = '—';
    flatSamples = [];
    flatMoon = [];
    events = [];
    return;
  }

  hideOverlay();
  flatSamples = flattenSamples(missionData);
  flatMoon = moonData ? flattenSamples(moonData) : [];
  segmentBounds = getSortedSegmentBounds(missionData);
  const bounds = getMissionTimeBounds(missionData);
  missionStartMs = bounds?.startMs ?? 0;
  missionStopMs = bounds?.stopMs ?? 0;
  currentMs = missionStartMs;

  sbSampleCount.textContent = String(missionData?.derived?.sampleCount ?? flatSamples.length);

  const statusBits = ['Data loaded: mission JSON'];
  statusBits.push(moonData ? 'moon loaded' : 'moon file missing');
  statusBits.push(loadedEvents ? 'events loaded' : 'event file missing');
  setStatus(statusBits.join(' | '));

  setMissionTrailsBySegment(missionData.segments || []);
  buildEventMarkers();
  refreshTimelineEventTicks();
  focusCameraPreset('mission-fit', { boundsKm: missionData?.derived?.boundsKm });
  updateScene();
}

btnPlay.addEventListener('click', () => {
  if (!flatSamples.length) return;
  playing = !playing;
  btnPlay.textContent = playing ? '⏸ Pause' : '▶ Play';
  if (playing && currentMs >= missionStopMs) currentMs = missionStartMs;
});

btnReset.addEventListener('click', () => {
  currentMs = missionStartMs;
  playing = false;
  btnPlay.textContent = '▶ Play';
  updateScene();
});

btnJumpStart.addEventListener('click', () => jumpToMissionStart());
btnJumpEnd.addEventListener('click', () => jumpToMissionEnd());
btnPrevEvent.addEventListener('click', () => jumpToPreviousEvent());
btnNextEvent.addEventListener('click', () => jumpToNextEvent());
btnMinus1h.addEventListener('click', () => stepTime(-MS_PER_H));
btnPlus1h.addEventListener('click', () => stepTime(MS_PER_H));
btnMinus1d.addEventListener('click', () => stepTime(-MS_PER_D));
btnPlus1d.addEventListener('click', () => stepTime(MS_PER_D));

btnCamEarth.addEventListener('click', () => focusCameraPreset('earth-centered'));
btnCamMoon.addEventListener('click', () => {
  const moonState = getInterpolatedState(moonData, currentMs);
  focusCameraPreset('moon-approach', { moonKm: moonState?.positionKm || null });
});
btnCamFit.addEventListener('click', () => focusCameraPreset('mission-fit', { boundsKm: missionData?.derived?.boundsKm }));

function jumpToMissionStart() {
  currentMs = missionStartMs;
  updateScene();
}

function jumpToMissionEnd() {
  currentMs = missionStopMs;
  updateScene();
}

function jumpToPreviousEvent() {
  const ctx = getEventContext(events, currentMs);
  if (ctx.previous) {
    currentMs = ctx.previous.epochMs;
    updateScene();
  }
}

function jumpToNextEvent() {
  const ctx = getEventContext(events, currentMs);
  if (ctx.next) {
    currentMs = ctx.next.epochMs;
    updateScene();
  }
}

function stepTime(deltaMs) {
  if (!flatSamples.length) return;
  currentMs = clamp(currentMs + deltaMs, missionStartMs, missionStopMs);
  updateScene();
}

timelineSlider.addEventListener('mousedown', () => { scrubbing = true; });
timelineSlider.addEventListener('touchstart', () => { scrubbing = true; }, { passive: true });
timelineSlider.addEventListener('input', () => {
  if (!flatSamples.length || missionStopMs <= missionStartMs) return;
  const f = Number(timelineSlider.value) / Number(timelineSlider.max);
  currentMs = missionStartMs + f * (missionStopMs - missionStartMs);
  updateScene();
});
window.addEventListener('mouseup', () => { scrubbing = false; });
window.addEventListener('touchend', () => { scrubbing = false; });

function startRafLoop() {
  let prev = performance.now();
  function frame(now) {
    const dtMs = now - prev;
    prev = now;

    if (playing && flatSamples.length) {
      const missionMsPerWallSecond = Number(speedSelect.value);
      currentMs += (dtMs / 1000) * missionMsPerWallSecond;
      if (currentMs >= missionStopMs) {
        currentMs = missionStopMs;
        playing = false;
        btnPlay.textContent = '▶ Play';
      }
      currentMs = clamp(currentMs, missionStartMs, missionStopMs);
      updateScene();
    }

    renderScene();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

function updateScene() {
  if (!flatSamples.length) return;

  if (!scrubbing && missionStopMs > missionStartMs) {
    const f = (currentMs - missionStartMs) / (missionStopMs - missionStartMs);
    timelineSlider.value = String(Math.round(f * Number(timelineSlider.max)));
  }

  sbUtc.textContent = formatUtc(currentMs);
  sbMet.textContent = formatMet(missionStartMs, currentMs);

  const segState = findSegment(missionData, currentMs);
  const moonState = getInterpolatedState(moonData, currentMs);

  let orionPos = null;
  if (segState.state === 'in-segment') {
    const state = interpolateSegment(segState.segment, segState.snappedMs);
    orionPos = state.positionKm;
  } else if (segState.state === 'gap') {
    const snapped = findSegment(missionData, segState.gap.nearestBoundaryMs);
    if (snapped.segment) {
      const state = interpolateSegment(snapped.segment, snapped.snappedMs);
      orionPos = state.positionKm;
    }
  }

  if (orionPos) updateBodies(orionPos, moonState?.positionKm || null);
  setTraversedTrailBySegment(missionData.segments || [], currentMs);

  const idx = findSampleIndex(flatSamples, currentMs);
  sbFrame.textContent = `${idx + 1} / ${flatSamples.length} (${segState.state})`;

  const eventCtx = getEventContext(events, currentMs);
  if (eventCtx.active) {
    sbEvent.textContent = `${eventCtx.active.label} (active)`;
  } else if (eventCtx.nearest) {
    sbEvent.textContent = `${eventCtx.nearest.label} (nearest)`;
  } else {
    sbEvent.textContent = 'No events loaded';
  }
}

function getInterpolatedState(data, tMs) {
  const segState = findSegment(data, tMs);
  if (segState?.segment && segState?.snappedMs != null) {
    return interpolateSegment(segState.segment, segState.snappedMs);
  }
  return null;
}

function buildEventMarkers() {
  eventMarkers = [];
  for (const event of events) {
    const segState = findSegment(missionData, event.epochMs);
    if (!segState?.segment || segState.state === 'gap') continue;
    const state = interpolateSegment(segState.segment, segState.snappedMs);
    eventMarkers.push({ id: event.id, label: event.label, positionKm: state.positionKm });
  }
  setEventMarkers(eventMarkers);
}

function refreshTimelineEventTicks() {
  timelineTicks.innerHTML = '';
  if (!events.length || missionStopMs <= missionStartMs) return;

  for (const event of events) {
    const pct = ((event.epochMs - missionStartMs) / (missionStopMs - missionStartMs)) * 100;
    if (pct < 0 || pct > 100) continue;
    const tick = document.createElement('span');
    tick.className = 'timeline-tick';
    tick.style.left = `${pct}%`;
    tick.title = `${event.label} — ${event.epochUtc}`;
    timelineTicks.appendChild(tick);
  }
}

function onResize() {
  resizeScene(canvas.clientWidth, canvas.clientHeight);
}

function showOverlay(msg) {
  overlayMsg.textContent = msg;
  overlayMsg.classList.remove('hidden');
}

function hideOverlay() {
  overlayMsg.classList.add('hidden');
}

function setStatus(msg) {
  sbStatus.textContent = msg;
}
