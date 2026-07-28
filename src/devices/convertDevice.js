// -----------------------------------------------------------------------------
// Convert a SmartThings device into a Gladys discovered-device payload.
//
// External id scheme (built with gladys.externalIds(), mandatory prefix
// `ext:<selector>:`):
//   device  -> ext:<selector>:device:<deviceId>
//   feature -> ext:<selector>:device:<deviceId>:<switch|brightness|temperature|…>
//
// The SmartThings deviceId is the unique platform id and is carried inside the
// external id, so no extra device param is needed to poll / command it.
// -----------------------------------------------------------------------------

import { DEVICE_SLUG, POLL_FREQUENCY } from '../constants.js';
import { buildFeatures } from './capabilities.js';

/**
 * Build the external ids (device + feature factory) of a SmartThings device.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {string} deviceId SmartThings device id
 * @returns {object} `{ device, feature(featureKey) }`
 */
export function deviceExternalIds(gladys, deviceId) {
  return gladys.externalIds(DEVICE_SLUG, String(deviceId));
}

/**
 * Convert a SmartThings device to a Gladys discovered device. Returns null when
 * none of the device capabilities map to a Gladys feature (e.g. a hub or a
 * device exposing only unsupported capabilities): such a device is not
 * published.
 * @param {import('@gladysassistant/integration-sdk').GladysIntegration} gladys
 * @param {object} device a raw SmartThings device
 * @returns {object|null} the Gladys discovered device, or null if unsupported
 */
export function convertDevice(gladys, device) {
  const ids = deviceExternalIds(gladys, device.deviceId);
  const features = buildFeatures(ids, device);
  if (features.length === 0) {
    return null;
  }

  return {
    name: device.label || device.name || String(device.deviceId),
    external_id: ids.device,
    model: device.deviceManufacturerCode || device.name || null,
    poll_frequency: POLL_FREQUENCY,
    should_poll: true,
    features,
  };
}
