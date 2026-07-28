// -----------------------------------------------------------------------------
// Entry point of the Gladys SmartThings external integration.
//
//   - authenticates to the SmartThings Cloud API with the Personal Access
//     Token from the integration config;
//   - publishes the account devices as discovered devices (each supported
//     SmartThings capability becomes a Gladys feature);
//   - answers the polls of Gladys with the current device state;
//   - forwards user commands to SmartThings (POST /devices/{id}/commands).
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { normalizeConfig } from './src/config.js';
import { SmartThingsClient } from './src/smartthings/client.js';
import { convertDevice, deviceExternalIds } from './src/devices/convertDevice.js';
import { buildCommand, buildStates } from './src/devices/capabilities.js';

const gladys = new GladysIntegration();
const smartthings = new SmartThingsClient();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();

/**
 * Split a device external id (`ext:<selector>:device:<deviceId>`, built with
 * gladys.externalIds()) into the SmartThings device id.
 * @returns {{ deviceId: string }}
 */
function parseExternalId(externalId) {
  const prefix = gladys.externalId('');
  if (!externalId || !externalId.startsWith(prefix)) {
    throw new Error(
      `SmartThings device external_id is invalid: "${externalId}" should start with "${prefix}"`,
    );
  }
  const parts = externalId.slice(prefix.length).split(':');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new Error(
      `SmartThings device external_id is invalid: "${externalId}" should be "${prefix}device:<deviceId>"`,
    );
  }
  return { deviceId: parts[1] };
}

/**
 * Apply the current config to the client. Returns false (without throwing) when
 * the token is not filled in yet.
 */
function connectToSmartThings() {
  if (!config.token) {
    smartthings.clearToken();
    logger.warn(
      'SmartThings is not configured yet: fill in your Personal Access Token in the integration settings',
    );
    return false;
  }
  smartthings.setToken(config.token);
  return true;
}

/**
 * Load the devices from SmartThings and publish the supported ones as
 * discovered devices.
 */
async function publishDevices() {
  const rawDevices = await smartthings.listDevices();
  const devices = rawDevices.map((device) => convertDevice(gladys, device)).filter(Boolean);
  logger.info(
    `${devices.length} SmartThings devices published (${rawDevices.length} found on the account)`,
  );
  await gladys.publishDiscoveredDevices(devices);
  await gladys.setConnectionStatus(true);
}

// --- Discovery: Gladys asks for the list of devices --------------------------
gladys.onScanRequest(async () => {
  logger.info('onScanRequest -> loading SmartThings devices');
  if (!connectToSmartThings()) {
    throw new Error('SmartThings is not configured');
  }
  await publishDevices();
});

// --- Command: the user acts on a controllable feature ------------------------
gladys.onSetValue(async (device, feature, value) => {
  logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
  const { deviceId } = parseExternalId(device.external_id);
  const featureCode = feature.external_id.split(':').pop();

  const command = buildCommand(featureCode, value);
  if (!command) {
    throw new Error(`SmartThings feature "${feature.external_id}" is not controllable`);
  }

  await smartthings.sendCommands(deviceId, [{ component: 'main', ...command }]);
});

// --- Polling: Gladys asks to refresh a device --------------------------------
gladys.onPoll(async (device) => {
  const { deviceId } = parseExternalId(device.external_id);
  const status = await smartthings.getDeviceStatus(deviceId);
  const states = buildStates(deviceExternalIds(gladys, deviceId), status);
  if (states.length > 0) {
    await gladys.publishStates(states);
  }
});

// --- Configuration updated by the user ---------------------------------------
gladys.onConfigUpdated(async (newConfig) => {
  logger.info('onConfigUpdated -> reconnecting to SmartThings');
  config = normalizeConfig(newConfig);
  try {
    if (connectToSmartThings()) {
      await publishDevices();
    }
  } catch (err) {
    logger.error('Reconnection to SmartThings failed', err);
    await reportConnectionError(err);
  }
});

// --- Connection lifecycle ----------------------------------------------------
gladys.on('connected', async () => {
  logger.info('WebSocket connected to Gladys');
  try {
    // 1) Fetch the config filled in by the user.
    config = normalizeConfig(await gladys.getConfig());

    // 2) Apply the token and publish the devices.
    if (connectToSmartThings()) {
      await publishDevices();
    }
  } catch (err) {
    logger.error('Post-connection initialization failed', err);
    await reportConnectionError(err);
  }
});

gladys.on('disconnected', () => {
  logger.warn('WebSocket disconnected - the SDK will try to reconnect');
});

/**
 * Report an application-level connection error to the Gladys UI. A 401 means
 * the Personal Access Token is invalid or expired (SmartThings PATs created
 * since late 2024 expire after 24h).
 */
async function reportConnectionError(err) {
  const expired = err && err.status === 401;
  try {
    await gladys.setConnectionStatus(false, {
      en: expired
        ? 'SmartThings rejected the token (invalid or expired). Generate a new Personal Access Token and update the configuration.'
        : 'Could not reach SmartThings. Check your Internet connection and your Personal Access Token.',
      fr: expired
        ? 'SmartThings a rejeté le token (invalide ou expiré). Générez un nouveau Personal Access Token et mettez à jour la configuration.'
        : 'Connexion à SmartThings impossible. Vérifiez votre accès Internet et votre Personal Access Token.',
    });
  } catch (statusErr) {
    logger.error('Could not report the connection status', statusErr);
  }
}

// --- Graceful shutdown -------------------------------------------------------
gladys.handleShutdown((signal) => {
  logger.info(`Received ${signal} -> graceful shutdown`);
});

// --- Startup -----------------------------------------------------------------
logger.info('Starting the SmartThings integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
