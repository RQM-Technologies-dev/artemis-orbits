/**
 * missions.js – mission configuration array.
 *
 * All data paths stay relative so the site works from `/`
 * and from prefixed deployments whose host strips the prefix.
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
    eventsPath:        './data/events/artemis-1.json',
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
    eventsPath:        './data/events/artemis-2.json',
    rawFallbackPath:   './data/raw/artemis-ii-oem-2026-04-04-to-ei.zip',
    summary:
      'Crewed lunar flyby mission — four astronauts aboard Orion flew around the Moon and back, the first crewed deep-space mission since Apollo 17.',
  },
  {
    id: 'artemis-3',
    displayName: 'Artemis III',
    status: 'official-current',
    enabled: true,
    officialPageUrl:
      'https://www.nasa.gov/missions/artemis/artemis-iii/',
    officialZipUrl:  null,
    normalizedPath:  './data/normalized/artemis-3-current.json',
    moonPath:        './data/normalized/artemis-3-moon-current.json',
    eventsPath:      './data/events/artemis-3-current.json',
    rawFallbackPath: './data/models/artemis-3-legacy-nrho-proxy-full.json',
    artemis3Profiles: {
      'current-leo': {
        displayName: 'Current mission',
        visualizationMode: 'current-leo',
        normalizedPath: './data/normalized/artemis-3-current.json',
        moonPath: './data/normalized/artemis-3-moon-current.json',
        eventsPath: './data/events/artemis-3-current.json',
      },
      'legacy-cislunar': {
        displayName: 'Archived lunar profile',
        visualizationMode: 'legacy-cislunar',
        normalizedPath: './data/normalized/artemis-3-legacy.json',
        moonPath: './data/normalized/artemis-3-moon-legacy.json',
        eventsPath: './data/events/artemis-3-legacy.json',
      },
      'legacy-nrho-detail': {
        displayName: 'Archived NRHO detail',
        visualizationMode: 'legacy-nrho-detail',
        normalizedPath: './data/normalized/artemis-3-legacy-nrho.json',
        moonPath: './data/normalized/artemis-3-moon-legacy-nrho.json',
        eventsPath: './data/events/artemis-3-legacy-nrho.json',
      },
    },
    summary:
      '2027 low Earth orbit rendezvous and docking demonstration (current official mission) with an archived legacy lunar profile view.',
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
    eventsPath:      null,
    rawFallbackPath: null,
    summary: 'Placeholder for future nominal trajectory data.',
  },
  {
    id: 'artemis-5',
    displayName: 'Artemis V',
    status: 'official-current',
    enabled: true,
    officialPageUrl:
      'https://www.nasa.gov/event/artemis-v/',
    officialZipUrl:  null,
    normalizedPath:  './data/normalized/artemis-5-current.json',
    moonPath:        './data/normalized/artemis-5-moon-current.json',
    eventsPath:      './data/events/artemis-5-current.json',
    rawFallbackPath: './data/models/artemis-5-current-nrho-proxy-full.json',
    artemis5Profiles: {
      'current-mission': {
        displayName: 'Current mission',
        visualizationMode: 'current-mission',
        normalizedPath: './data/normalized/artemis-5-current.json',
        moonPath: './data/normalized/artemis-5-moon-current.json',
        eventsPath: './data/events/artemis-5-current.json',
      },
      'current-nrho-detail': {
        displayName: 'Current NRHO detail',
        visualizationMode: 'current-nrho-detail',
        normalizedPath: './data/normalized/artemis-5-current-nrho.json',
        moonPath: './data/normalized/artemis-5-moon-current-nrho.json',
        eventsPath: './data/events/artemis-5-current-nrho.json',
      },
      'archived-detailed-profile': {
        displayName: 'Archived detailed profile',
        visualizationMode: 'archived-detailed-profile',
        normalizedPath: './data/normalized/artemis-5-legacy.json',
        moonPath: './data/normalized/artemis-5-moon-legacy.json',
        eventsPath: './data/events/artemis-5-legacy.json',
      },
      'archived-nrho-detail': {
        displayName: 'Archived NRHO detail',
        visualizationMode: 'archived-nrho-detail',
        normalizedPath: './data/normalized/artemis-5-legacy-nrho.json',
        moonPath: './data/normalized/artemis-5-moon-legacy-nrho.json',
        eventsPath: './data/events/artemis-5-legacy-nrho.json',
      },
    },
    summary:
      'Late-2028 Gateway assembly and crewed lunar surface mission; includes current official view plus archived/provider-specific reference detail modes.',
  },
];
