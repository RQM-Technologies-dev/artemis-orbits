/**
 * units.js – km ↔ scene-unit helpers.
 *
 * One scene unit = SCENE_SCALE_KM kilometres.
 * All positions sent to Three.js must go through these converters.
 */

import { SCENE_SCALE_KM } from '../config/missions.js';

/**
 * Convert a single km value to scene units.
 * @param {number} km
 * @returns {number}
 */
export function kmToScene(km) {
  return km / SCENE_SCALE_KM;
}

/**
 * Convert a [x, y, z] km array to scene units.
 * Returns a plain array – caller can spread into Three.Vector3.set().
 * @param {[number, number, number]} vec
 * @returns {[number, number, number]}
 */
export function vecKmToScene([x, y, z]) {
  return [x / SCENE_SCALE_KM, y / SCENE_SCALE_KM, z / SCENE_SCALE_KM];
}
