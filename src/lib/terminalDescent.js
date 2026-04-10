/**
 * terminalDescent.js - modeled Artemis II terminal descent extension.
 */

import { geodeticToCartesianKm, normalizeSurfaceTarget, EARTH_RADIUS_KM } from './geodesy.js';

export const ARTEMIS_II_SPLASHDOWN_UTC = '2026-04-11T00:07:00Z';
const MIN_TERMINAL_SAMPLES = 26;
const MAX_TERMINAL_SAMPLES = 140;
const SAMPLE_STEP_MS = 15_000;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function vecLength(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function vecDot(a, b) {
  return (a[0] * b[0]) + (a[1] * b[1]) + (a[2] * b[2]);
}

function vecScale(v, scalar) {
  return [v[0] * scalar, v[1] * scalar, v[2] * scalar];
}

function vecAdd(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function vecSub(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

function vecLerp(a, b, t) {
  return [
    a[0] + ((b[0] - a[0]) * t),
    a[1] + ((b[1] - a[1]) * t),
    a[2] + ((b[2] - a[2]) * t),
  ];
}

function vecNormalize(v, fallback = [1, 0, 0]) {
  const len = vecLength(v);
  if (!Number.isFinite(len) || len <= 1e-12) return [...fallback];
  return [v[0] / len, v[1] / len, v[2] / len];
}

function smoothstep(t) {
  const c = clamp(t, 0, 1);
  return c * c * (3 - (2 * c));
}

function slerpUnit(aUnit, bUnit, t) {
  const dot = clamp(vecDot(aUnit, bUnit), -1, 1);
  const theta = Math.acos(dot);
  if (!Number.isFinite(theta) || theta < 1e-5) return vecNormalize(vecLerp(aUnit, bUnit, t), bUnit);
  const sinTheta = Math.sin(theta);
  const w0 = Math.sin((1 - t) * theta) / sinTheta;
  const w1 = Math.sin(t * theta) / sinTheta;
  return vecNormalize(vecAdd(vecScale(aUnit, w0), vecScale(bUnit, w1)), bUnit);
}

function getLastSample(missionData) {
  const segments = missionData?.segments || [];
  if (!segments.length) return null;
  const lastSegment = segments[segments.length - 1];
  const samples = lastSegment?.samples || [];
  if (!samples.length) return null;
  return {
    sample: samples[samples.length - 1],
    segment: lastSegment,
    segmentIdx: segments.length - 1,
  };
}

function getEventById(events, id) {
  return (events || []).find((event) => event?.id === id) || null;
}

function getSplashdownEpochMs(events) {
  const splashEvent = getEventById(events, 'splashdown');
  if (Number.isFinite(splashEvent?.epochMs)) return splashEvent.epochMs;
  const parsed = Date.parse(ARTEMIS_II_SPLASHDOWN_UTC);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function getSplashdownSurfaceTarget(events) {
  const splashEvent = getEventById(events, 'splashdown');
  const normalized = normalizeSurfaceTarget(splashEvent?.surfaceTarget);
  if (!normalized) return null;
  return normalized;
}

function buildModeledTerminalSamples(lastSample, splashdownEpochMs, splashdownTargetKm) {
  const startEpochMs = Number(lastSample?.epochMs);
  if (!Number.isFinite(startEpochMs) || !Number.isFinite(splashdownEpochMs) || splashdownEpochMs <= startEpochMs) return [];
  const startPos = Array.isArray(lastSample.positionKm) ? lastSample.positionKm : null;
  const startVel = Array.isArray(lastSample.velocityKmS) ? lastSample.velocityKmS : null;
  if (!startPos || startPos.length !== 3 || !startVel || startVel.length !== 3) return [];

  const durationMs = splashdownEpochMs - startEpochMs;
  const estimated = Math.round(durationMs / SAMPLE_STEP_MS) + 1;
  const sampleCount = clamp(estimated, MIN_TERMINAL_SAMPLES, MAX_TERMINAL_SAMPLES);
  const n0 = vecNormalize(startPos);
  const n1 = vecNormalize(splashdownTargetKm);
  const startRadius = vecLength(startPos);
  const startAltitudeKm = Math.max(0, startRadius - EARTH_RADIUS_KM);
  const startVelDir = vecNormalize(startVel, vecSub(splashdownTargetKm, startPos));

  const samples = [];
  for (let i = 0; i < sampleCount; i++) {
    const t = sampleCount === 1 ? 1 : (i / (sampleCount - 1));
    const u = smoothstep(t);
    const epochMs = Math.round(startEpochMs + (durationMs * t));
    const direction = slerpUnit(n0, n1, u);
    const altitudeKm = startAltitudeKm * ((1 - u) ** 1.38);
    const radiusKm = EARTH_RADIUS_KM + altitudeKm;
    const positionKm = vecScale(direction, radiusKm);
    samples.push({
      epochMs,
      epochUtc: new Date(epochMs).toISOString(),
      positionKm,
      velocityKmS: [0, 0, 0],
      _startVelDir: startVelDir,
    });
  }

  for (let i = 0; i < samples.length; i++) {
    if (i === 0) {
      samples[i].velocityKmS = [...startVel];
      continue;
    }
    if (i === samples.length - 1) {
      const prev = samples[i - 1];
      const dt = Math.max(1, (samples[i].epochMs - prev.epochMs) / 1000);
      samples[i].velocityKmS = vecScale(vecSub(samples[i].positionKm, prev.positionKm), 1 / dt);
      continue;
    }
    const prev = samples[i - 1];
    const next = samples[i + 1];
    const dt = Math.max(1, (next.epochMs - prev.epochMs) / 1000);
    const raw = vecScale(vecSub(next.positionKm, prev.positionKm), 1 / dt);
    const blend = clamp(i / Math.max(1, samples.length - 1), 0, 1);
    const blended = vecNormalize(vecLerp(samples[i]._startVelDir, vecNormalize(raw, samples[i]._startVelDir), blend), samples[i]._startVelDir);
    const rawSpeed = vecLength(raw);
    samples[i].velocityKmS = vecScale(blended, rawSpeed);
  }

  return samples.map((sample) => {
    const { _startVelDir, ...clean } = sample;
    return clean;
  });
}

function cloneMissionWithTerminalSegment(missionData, terminalSegment) {
  const segments = missionData?.segments || [];
  const cloned = {
    ...missionData,
    segments: [...segments, terminalSegment],
    derived: {
      ...(missionData?.derived || {}),
      sampleCount: (Number(missionData?.derived?.sampleCount) || 0) + terminalSegment.samples.length,
      segmentCount: segments.length + 1,
      missionStopUtc: terminalSegment.samples[terminalSegment.samples.length - 1]?.epochUtc || missionData?.derived?.missionStopUtc,
    },
  };
  return cloned;
}

export function buildTerminalDescentModel({ missionId, missionData, events }) {
  if (missionId !== 'artemis-2') return null;
  const last = getLastSample(missionData);
  if (!last?.sample) return null;

  const splashdownEpochMs = getSplashdownEpochMs(events);
  if (!Number.isFinite(splashdownEpochMs)) return null;
  const officialStopMs = Number(last.sample.epochMs);
  if (!Number.isFinite(officialStopMs) || splashdownEpochMs <= officialStopMs) return null;

  const surfaceTarget = getSplashdownSurfaceTarget(events);
  const splashdownTargetKm = geodeticToCartesianKm(surfaceTarget);
  if (!surfaceTarget || !splashdownTargetKm) return null;

  const modeledSamples = buildModeledTerminalSamples(last.sample, splashdownEpochMs, splashdownTargetKm);
  if (modeledSamples.length < 2) return null;

  const terminalSegment = {
    id: 'segment-modeled-terminal-descent',
    metadata: {
      objectName: 'EM2-terminal-modeled',
      interpolation: 'LINEAR',
      interpolationDegree: 1,
      modeled: true,
      modeledKind: 'terminal-descent-extension',
      sourceNote: 'Modeled extension from last official OEM sample to verified splashdown region/time.',
      officialDataStopUtc: last.sample.epochUtc,
    },
    samples: modeledSamples,
  };
  const renderMissionData = cloneMissionWithTerminalSegment(missionData, terminalSegment);
  return {
    enabled: true,
    missionId,
    officialStopMs,
    officialStopUtc: last.sample.epochUtc,
    modeledStopMs: splashdownEpochMs,
    splashdownEpochMs,
    surfaceTarget,
    surfaceTargetKm: splashdownTargetKm,
    terminalSegment,
    renderMissionData,
    sourceNote: 'Current official OEM in this repo ends before splashdown; final descent and parachute timeline is modeled from verified splashdown time/region.',
  };
}

export function getTerminalVisualState(events, currentMs) {
  let activeVisualState = null;
  let activeCameraCue = null;
  for (const event of events || []) {
    if (!Number.isFinite(event?.epochMs) || event.epochMs > currentMs) break;
    if (event.visualState) activeVisualState = String(event.visualState);
    if (event.cameraCue) activeCameraCue = String(event.cameraCue);
  }
  return {
    visualState: activeVisualState,
    cameraCue: activeCameraCue,
  };
}
