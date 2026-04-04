/**
 * app.js – main entry point for the Artemis orbit viewer.
 *
 * Responsibilities
 * ─────────────────
 * • Build mission tabs from config.
 * • Load the active mission's normalized JSON (Orion + Moon).
 * • Connect all UI controls.
 * • Drive the animation loop and update scene / sidebar.
 */

import { MISSIONS, ACTIVE_MISSION_ID } from './config/missions.js';
import { createScene, updateBodies, setTrail, resizeScene, renderScene } from './lib/scene.js';
import { loadMissionData, flattenSamples, findSegment, findSampleIndex } from './lib/dataLoader.js';
import { interpolateSegment } from './lib/interpolate.js';
import { formatUtc, formatMet, clamp } from './lib/time.js';

// ── DOM refs ─────────────────────────────────────────────────────
const tabBar        = document.getElementById('mission-tabs');
const canvas        = document.getElementById('three-canvas');
const overlayMsg    = document.getElementById('scene-overlay-msg');
const sbTitle       = document.getElementById('sb-mission-title');
const sbSummary     = document.getElementById('sb-mission-summary');
const sbStatus      = document.getElementById('sb-status-msg');
const sbUtc         = document.getElementById('sb-utc');
const sbMet         = document.getElementById('sb-met');
const sbFrame       = document.getElementById('sb-frame');
const sbSampleCount = document.getElementById('sb-sample-count');
const btnPlay       = document.getElementById('btn-play');
const btnReset      = document.getElementById('btn-reset');
const btnMinus1h    = document.getElementById('btn-minus-1h');
const btnPlus1h     = document.getElementById('btn-plus-1h');
const btnMinus1d    = document.getElementById('btn-minus-1d');
const btnPlus1d     = document.getElementById('btn-plus-1d');
const speedSelect   = document.getElementById('speed-select');
const timelineSlider = document.getElementById('timeline-slider');

// ── Playback state ────────────────────────────────────────────────
let missionData  = null;   // normalized Orion JSON
let moonData     = null;   // normalized Moon JSON
let flatSamples  = [];     // flattened Orion samples
let flatMoon     = [];     // flattened Moon samples
let missionStartMs = 0;
let missionStopMs  = 0;
let currentMs    = 0;
let playing      = false;
let lastRaf      = null;
let scrubbing    = false;   // true while slider is being dragged

const MS_PER_S   = 1_000;
const MS_PER_H   = 3_600_000;
const MS_PER_D   = 86_400_000;

// ── Boot ──────────────────────────────────────────────────────────

createScene(canvas);
buildTabs();
selectMission(ACTIVE_MISSION_ID);
startRafLoop();

window.addEventListener('resize', onResize);
onResize();

// ── Tab builder ───────────────────────────────────────────────────

function buildTabs() {
  for (const m of MISSIONS) {
    const btn = document.createElement('button');
    btn.textContent = m.displayName;
    btn.className   = 'tab-btn' + (m.enabled ? '' : ' tab-disabled');
    btn.dataset.id  = m.id;
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

// ── Mission selection ─────────────────────────────────────────────

async function selectMission(id) {
  const mission = MISSIONS.find(m => m.id === id);
  if (!mission) return;

  setActiveTab(id);
  setStatus('Loading…');
  playing = false;
  btnPlay.textContent = '▶ Play';

  // Update sidebar info
  sbTitle.textContent   = mission.displayName;
  sbSummary.textContent = mission.summary;
  sbFrame.textContent   = 'EME2000';

  // If the mission is disabled / placeholder
  if (!mission.enabled) {
    showOverlay(`${mission.displayName} — ${mission.summary}`);
    setStatus('No data available.');
    sbSampleCount.textContent = '—';
    return;
  }

  // Fetch data
  missionData = await loadMissionData(mission.normalizedPath);
  moonData    = await loadMissionData(mission.moonPath);

  if (!missionData) {
    const msg =
      `Normalized data not found yet.\n\n` +
      `Run:\n  scripts/normalize_oem.py\n  scripts/fetch_moon_vectors.py\n\n` +
      `See README.md for exact commands.`;
    showOverlay(msg);
    setStatus('⚠ Data missing – see overlay.');
    sbSampleCount.textContent = '—';
    flatSamples = [];
    flatMoon    = [];
    return;
  }

  hideOverlay();
  flatSamples = flattenSamples(missionData);
  flatMoon    = moonData ? flattenSamples(moonData) : [];

  const derived  = missionData.derived || {};
  missionStartMs = flatSamples.length ? flatSamples[0].epochMs             : 0;
  missionStopMs  = flatSamples.length ? flatSamples[flatSamples.length - 1].epochMs : 0;
  currentMs      = missionStartMs;

  sbSampleCount.textContent = derived.sampleCount ?? flatSamples.length;
  setStatus(`Loaded ${derived.sampleCount ?? flatSamples.length} samples.`);

  // Set trail from all samples
  setTrail(flatSamples);
  updateScene();
}

// ── Playback controls ─────────────────────────────────────────────

btnPlay.addEventListener('click', () => {
  if (!flatSamples.length) return;
  playing = !playing;
  btnPlay.textContent = playing ? '⏸ Pause' : '▶ Play';
  if (playing && currentMs >= missionStopMs) {
    currentMs = missionStartMs;  // auto-rewind
  }
});

btnReset.addEventListener('click', () => {
  currentMs = missionStartMs;
  playing   = false;
  btnPlay.textContent = '▶ Play';
  updateScene();
});

btnMinus1h.addEventListener('click', () => stepTime(-MS_PER_H));
btnPlus1h .addEventListener('click', () => stepTime( MS_PER_H));
btnMinus1d.addEventListener('click', () => stepTime(-MS_PER_D));
btnPlus1d .addEventListener('click', () => stepTime( MS_PER_D));

function stepTime(deltaMs) {
  if (!flatSamples.length) return;
  currentMs = clamp(currentMs + deltaMs, missionStartMs, missionStopMs);
  updateScene();
}

// Slider
timelineSlider.addEventListener('mousedown',  () => { scrubbing = true;  });
timelineSlider.addEventListener('touchstart', () => { scrubbing = true;  }, { passive: true });
timelineSlider.addEventListener('input', () => {
  if (!flatSamples.length) return;
  const f   = Number(timelineSlider.value) / Number(timelineSlider.max);
  currentMs = missionStartMs + f * (missionStopMs - missionStartMs);
  updateScene();
});
window.addEventListener('mouseup',  () => { scrubbing = false; });
window.addEventListener('touchend', () => { scrubbing = false; });

// ── Animation loop ────────────────────────────────────────────────

function startRafLoop() {
  let prev = performance.now();

  function frame(now) {
    const dtMs = now - prev;
    prev = now;

    if (playing && flatSamples.length) {
      const speed   = Number(speedSelect.value);
      currentMs    += dtMs * MS_PER_S * speed / MS_PER_S;  // realtime * speed
      if (currentMs >= missionStopMs) {
        currentMs = missionStopMs;
        playing   = false;
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

// ── Scene update ──────────────────────────────────────────────────

function updateScene() {
  if (!flatSamples.length) return;

  // Update slider (only when not being dragged)
  if (!scrubbing && missionStopMs > missionStartMs) {
    const f = (currentMs - missionStartMs) / (missionStopMs - missionStartMs);
    timelineSlider.value = Math.round(f * Number(timelineSlider.max));
  }

  // Sidebar telemetry
  sbUtc.textContent = formatUtc(currentMs);
  sbMet.textContent = formatMet(missionStartMs, currentMs);

  // Find active segment for Orion
  const seg = findSegment(missionData, currentMs);
  if (!seg) return;

  const orionState = interpolateSegment(seg, currentMs);

  // Moon position
  let moonPos = null;
  if (flatMoon.length) {
    const moonSeg = findSegment(moonData, currentMs);
    if (moonSeg) {
      const moonState = interpolateSegment(moonSeg, currentMs);
      moonPos = moonState.positionKm;
    }
  }

  updateBodies(orionState.positionKm, moonPos);

  // Sample index label
  const idx = findSampleIndex(flatSamples, currentMs);
  sbFrame.textContent = `${idx + 1} / ${flatSamples.length}`;
}

// ── Resize ────────────────────────────────────────────────────────

function onResize() {
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  resizeScene(w, h);
}

// ── Helpers ───────────────────────────────────────────────────────

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
