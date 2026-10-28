// -----------------------------------------------------------------------------
// Entry point of the Gladys SmartThings external integration.
//
//   - authenticates to the SmartThings Cloud API with OAuth2 (the "Connect"
//     button of the integration config, tokens refreshed automatically) or
//     with a Personal Access Token;
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

import { randomUUID } from 'node:crypto';

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { authMode, normalizeConfig, oauthTokensToConfig } from './src/config.js';
import { OAUTH_REFRESH_CHECK_INTERVAL_MS, OAUTH_STATE_TTL_MS } from './src/constants.js';
import { SmartThingsClient } from './src/smartthings/client.js';
import { OAuthSession, buildAuthorizeUrl, exchangeCode } from './src/smartthings/oauth.js';
import { convertDevice, deviceExternalIds } from './src/devices/convertDevice.js';
import { buildCommand, buildStates } from './src/devices/capabilities.js';

const gladys = new GladysIntegration();
const smartthings = new SmartThingsClient();

// Current configuration (hot-reloaded via onConfigUpdated).
let config = normalizeConfig();
// OAuth2 session in use (null with a Personal Access Token).
let session = null;
// "Connect" clicks waiting for the provider callback: state -> expiry date.
const pendingStates = new Map();

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
 * no account is connected and no token is filled in yet.
 */
function connectToSmartThings() {
  const mode = authMode(config);
  if (mode === 'oauth') {
    // Keep the running session while the app is unchanged: it holds the most
    // recent tokens (the stored ones are written after each refresh).
    if (
      !session ||
      session.clientId !== config.clientId ||
      session.clientSecret !== config.clientSecret
    ) {
      const { clientId } = config;
      session = new OAuthSession({
        clientId,
        clientSecret: config.clientSecret,
        tokens: config.oauthTokens,
        onTokens: (tokens) => gladys.setConfig(oauthTokensToConfig(clientId, tokens)),
        onRevoked: (err) => {
          logger.error('SmartThings refused the refresh token: click "Connect" again', err);
          reportConnectionError(err);
        },
      });
    }
    smartthings.setOAuthSession(session);
    return true;
  }
  session = null;
  if (mode === 'pat') {
    smartthings.setToken(config.token);
    return true;
  }
  smartthings.clearToken();
  logger.warn(
    'SmartThings is not configured yet: connect your SmartThings account (or fill in a Personal Access Token) in the integration settings',
  );
  return false;
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

// --- OAuth2: the user clicks "Connect" ----------------------------------------
gladys.onOAuthAuthorizeUrl(async (_key, redirectUri) => {
  if (!config.clientId || !config.clientSecret) {
    throw new Error(
      'Fill in and save the client id and client secret of your SmartThings app before connecting',
    );
  }
  const now = Date.now();
  for (const [state, expiresAt] of pendingStates) {
    if (expiresAt < now) {
      pendingStates.delete(state);
    }
  }
  const state = randomUUID();
  pendingStates.set(state, now + OAUTH_STATE_TTL_MS);
  logger.info('onOAuthAuthorizeUrl -> SmartThings authorization page');
  return buildAuthorizeUrl({ clientId: config.clientId, redirectUri, state });
});

// --- OAuth2: SmartThings redirects back with the authorization code ----------
gladys.onOAuthCallback(async (_key, { code, state, redirectUri }) => {
  const expiresAt = pendingStates.get(state);
  pendingStates.delete(state);
  if (!expiresAt || expiresAt < Date.now()) {
    throw new Error('Unknown or expired authorization request: click "Connect" again');
  }
  const tokens = await exchangeCode({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code,
    redirectUri,
  });
  await gladys.setConfig(oauthTokensToConfig(config.clientId, tokens));
  logger.info('onOAuthCallback -> SmartThings account connected');
  // A brand new token pair: start a new session from the stored config.
  config = normalizeConfig(await gladys.getConfig());
  session = null;
  try {
    connectToSmartThings();
    await publishDevices();
  } catch (err) {
    logger.error('Loading the SmartThings devices after connecting failed', err);
    await reportConnectionError(err);
    throw err;
  }
});

// --- OAuth2: keep the tokens alive even when no device is polled ------------
setInterval(async () => {
  if (!session || !session.needsRefresh()) {
    return;
  }
  try {
    await session.refresh();
  } catch (err) {
    // A refused refresh token is already reported through onRevoked.
    if (!err.reauthorize) {
      logger.error('Scheduled refresh of the SmartThings access token failed', err);
    }
  }
}, OAUTH_REFRESH_CHECK_INTERVAL_MS).unref();

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
 * Report an application-level connection error to the Gladys UI: with OAuth2,
 * a refresh token that is no longer accepted (revoked, or unused for 29 days)
 * needs a new "Connect"; with a Personal Access Token, a 401 means it is
 * invalid or expired (SmartThings PATs created since late 2024 expire after
 * 24h).
 */
async function reportConnectionError(err) {
  const oauth = session !== null;
  const expired = err && (err.reauthorize || err.status === 401);
  let message;
  if (oauth && expired) {
    message = {
      en: 'SmartThings no longer accepts the connection (authorization revoked or expired). Click "Connect" again.',
      fr: 'SmartThings n’accepte plus la connexion (autorisation révoquée ou expirée). Cliquez à nouveau sur « Connecter ».',
    };
  } else if (expired) {
    message = {
      en: 'SmartThings rejected the token (invalid or expired). Connect your account with OAuth2 to stop the daily expiry, or generate a new Personal Access Token.',
      fr: 'SmartThings a rejeté le token (invalide ou expiré). Connectez votre compte en OAuth2 pour ne plus subir l’expiration quotidienne, ou générez un nouveau Personal Access Token.',
    };
  } else {
    message = {
      en: 'Could not reach SmartThings. Check your Internet connection and your SmartThings settings.',
      fr: 'Connexion à SmartThings impossible. Vérifiez votre accès Internet et vos réglages SmartThings.',
    };
  }
  try {
    await gladys.setConnectionStatus(false, message);
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
