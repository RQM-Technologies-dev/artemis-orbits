/**
 * missions.js – mission configuration array.
 *
 * All data paths are relative so the site works from any subpath
 * (e.g. /NASA/Artemis/ or GitHub Pages root).
 */

export const ACTIVE_MISSION_ID = 'artemis-2';

/** Scale factor: 1 scene unit = SCENE_SCALE_KM kilometres. */
export const SCENE_SCALE_KM = 10_000;

/** @type {MissionConfig[]} */
export const MISSIONS = [
  {
    id: 'artemis-1',
    displayName: 'Artemis I',
    status: 'as-flown',
    enabled: true,
    officialPageUrl:
      'https://www.nasa.gov/missions/artemis/orion/track-nasas-artemis-i-mission-in-real-time/',
    officialZipUrl:
      'https://www.nasa.gov/wp-content/uploads/2022/08/post-tli-orion-asflown-20221213-eph-oem.zip',
    normalizedPath:    './data/normalized/artemis-1.json',
    moonPath:          './data/normalized/artemis-1-moon.json',
    rawFallbackPath:   './data/raw/post-tli-orion-asflown-20221213-eph-oem.zip',
    summary:
      'Uncrewed lunar flight test — Orion flew around the Moon and returned to Earth, validating the SLS/Orion system.',
  },
  {
    id: 'artemis-2',
    displayName: 'Artemis II',
    status: 'as-flown',
    enabled: true,
    officialPageUrl:
      'https://www.nasa.gov/missions/artemis/artemis-2/track-nasas-artemis-ii-mission-in-real-time/',
    officialZipUrl:
      'https://www.nasa.gov/wp-content/uploads/2026/03/artemis-ii-oem-2026-04-04-to-ei.zip',
    normalizedPath:    './data/normalized/artemis-2.json',
    moonPath:          './data/normalized/artemis-2-moon.json',
    rawFallbackPath:   './data/raw/artemis-ii-oem-2026-04-04-to-ei.zip',
    summary:
      'Crewed lunar flyby mission — four astronauts aboard Orion flew around the Moon and back, the first crewed deep-space mission since Apollo 17.',
  },
  {
    id: 'artemis-3',
    displayName: 'Artemis III',
    status: 'planned',
    enabled: false,
    officialPageUrl: null,
    officialZipUrl:  null,
    normalizedPath:  null,
    moonPath:        null,
    rawFallbackPath: null,
    summary: 'Placeholder for future nominal trajectory data.',
  },
  {
    id: 'artemis-4',
    displayName: 'Artemis IV',
    status: 'planned',
    enabled: false,
    officialPageUrl: null,
    officialZipUrl:  null,
    normalizedPath:  null,
    moonPath:        null,
    rawFallbackPath: null,
    summary: 'Placeholder for future nominal trajectory data.',
  },
  {
    id: 'artemis-5',
    displayName: 'Artemis V',
    status: 'planned',
    enabled: false,
    officialPageUrl: null,
    officialZipUrl:  null,
    normalizedPath:  null,
    moonPath:        null,
    rawFallbackPath: null,
    summary: 'Placeholder for future nominal trajectory data.',
  },
];
