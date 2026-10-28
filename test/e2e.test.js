// End-to-end test: boots the REAL integration process (index.js) against a
// fake Gladys host (WebSocket + REST, same contract as the SDK) and a fake
// SmartThings API, then exercises the full flows: initial discovery, scan
// request, poll and set-value commands, and the OAuth2 "Connect" flow.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { DEVICES_RESPONSE, BULB_STATUS, SENSOR_STATUS, PLUG_STATUS } from './fixtures.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SELECTOR = 'smartthings-test';
const TOKEN = 'test-token';

async function waitUntil(predicate, what, timeoutMs = 10000) {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timed out waiting for ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

// --- Fake SmartThings API ----------------------------------------------------
function startFakeSmartThings() {
  const requests = [];
  const statuses = {
    '/devices/bulb-1/status': BULB_STATUS,
    '/devices/sensor-1/status': SENSOR_STATUS,
    '/devices/plug-1/status': PLUG_STATUS,
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const url = new URL(req.url, 'http://localhost');
      const form = req.headers['content-type'] === 'application/x-www-form-urlencoded';
      requests.push({
        method: req.method,
        path: url.pathname,
        auth: req.headers.authorization,
        body: !body
          ? null
          : form
            ? Object.fromEntries(new URLSearchParams(body))
            : JSON.parse(body),
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (url.pathname === '/oauth/token') {
        res.end(
          JSON.stringify({
            access_token: 'oauth-access',
            refresh_token: 'oauth-refresh',
            token_type: 'bearer',
            expires_in: 86399,
          }),
        );
      } else if (url.pathname === '/devices') {
        res.end(JSON.stringify(DEVICES_RESPONSE));
      } else if (statuses[url.pathname]) {
        res.end(JSON.stringify(statuses[url.pathname]));
      } else if (req.method === 'POST' && url.pathname.endsWith('/commands')) {
        res.end(JSON.stringify({ results: [{ status: 'ACCEPTED' }] }));
      } else {
        res.end(JSON.stringify({}));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, requests, port: server.address().port }));
  });
}

// --- Fake Gladys host (REST + WebSocket) -------------------------------------
function startFakeGladys(initialConfig = { token: 'pat-123' }) {
  const state = {
    config: { ...initialConfig },
    discoveredDevicePosts: [],
    statePosts: [],
    commandResults: [],
    connectionStatuses: [],
    ws: null,
  };
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const respond = (json) => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(json));
      };
      if (req.method === 'GET' && req.url === '/api/integration/v1/device') {
        respond([]);
      } else if (req.method === 'GET' && req.url === '/api/integration/v1/config') {
        respond({ config: state.config });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/config') {
        Object.assign(state.config, JSON.parse(body).config);
        respond({ success: true });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/discovered_device') {
        const parsed = JSON.parse(body);
        state.discoveredDevicePosts.push(parsed.devices);
        respond({ success: true, count: parsed.devices.length });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/state') {
        state.statePosts.push(JSON.parse(body).states);
        respond({ success: true });
      } else if (req.method === 'POST' && req.url === '/api/integration/v1/connection_status') {
        state.connectionStatuses.push(JSON.parse(body));
        respond({ success: true });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
  });
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    state.ws = ws;
    ws.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type === 'authenticate.integration-request' && message.payload.token === TOKEN) {
        ws.send(JSON.stringify({ type: 'authentication.connected', payload: {} }));
      }
      if (message.type === 'external-integration.command-result') {
        state.commandResults.push(message.payload);
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, state, port: server.address().port }));
  });
}

test('the integration discovers, polls and controls SmartThings devices', async (t) => {
  const smartthings = await startFakeSmartThings();
  const gladys = await startFakeGladys();
  t.after(() => {
    smartthings.server.close();
    gladys.server.close();
  });

  let output = '';
  const child = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      GLADYS_HOST_API_URL: `http://127.0.0.1:${gladys.port}`,
      GLADYS_INTEGRATION_TOKEN: TOKEN,
      GLADYS_INTEGRATION_SELECTOR: SELECTOR,
      SMARTTHINGS_ENDPOINT: `http://127.0.0.1:${smartthings.port}`,
      LOG_LEVEL: 'debug',
    },
  });
  child.stdout.on('data', (d) => {
    output += d;
  });
  child.stderr.on('data', (d) => {
    output += d;
  });
  t.after(() => child.kill('SIGKILL'));
  t.afterEach(() => {
    if (output && process.env.E2E_VERBOSE) {
      console.log(output);
    }
  });

  const send = (type, payload) => gladys.state.ws.send(JSON.stringify({ type, payload }));

  await t.test('on connection: publishes the supported discovered devices', async () => {
    await waitUntil(
      () => gladys.state.discoveredDevicePosts.length >= 1,
      `initial discovery\n${output}`,
    );

    const devices = gladys.state.discoveredDevicePosts.at(-1);
    // Bulb + sensor + plug (the hub, unsupported, is filtered out).
    assert.equal(devices.length, 3);

    const bulb = devices.find((d) => d.external_id === `ext:${SELECTOR}:device:bulb-1`);
    assert.ok(bulb, 'the bulb was published');
    assert.equal(bulb.name, 'Living room lamp');
    assert.equal(bulb.poll_frequency, 10000);
    assert.equal(bulb.should_poll, true);
    assert.deepEqual(
      bulb.features.map((f) => f.external_id.split(':').pop()),
      ['switch', 'brightness', 'hue', 'saturation', 'color-temperature'],
    );
    assert.equal(bulb.features[0].category, 'light');

    assert.ok(devices.find((d) => d.external_id === `ext:${SELECTOR}:device:sensor-1`));
    assert.ok(devices.find((d) => d.external_id === `ext:${SELECTOR}:device:plug-1`));
    assert.equal(
      devices.find((d) => d.external_id === `ext:${SELECTOR}:device:hub-1`),
      undefined,
    );
  });

  await t.test('a scan request republishes the devices', async () => {
    const before = gladys.state.discoveredDevicePosts.length;
    send('external-integration.scan-request', {});
    await waitUntil(
      () => gladys.state.discoveredDevicePosts.length > before,
      `scan republish\n${output}`,
    );
    assert.equal(gladys.state.discoveredDevicePosts.at(-1).length, 3);
  });

  const pollDevice = (deviceId) => ({
    external_id: `ext:${SELECTOR}:device:${deviceId}`,
    selector: `ext-${SELECTOR}-device-${deviceId}`,
    params: [],
  });

  await t.test('a poll command publishes the bulb states', async () => {
    send('external-integration.device.poll', {
      message_id: 'poll-bulb',
      device: pollDevice('bulb-1'),
    });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'poll-bulb'),
      `poll ack\n${output}`,
    );
    const ack = gladys.state.commandResults.find((r) => r.message_id === 'poll-bulb');
    assert.equal(ack.success, true, ack.error);

    assert.deepEqual(gladys.state.statePosts.at(-1), [
      { device_feature_external_id: `ext:${SELECTOR}:device:bulb-1:switch`, state: 1 },
      { device_feature_external_id: `ext:${SELECTOR}:device:bulb-1:brightness`, state: 80 },
      { device_feature_external_id: `ext:${SELECTOR}:device:bulb-1:hue`, state: 30 },
      { device_feature_external_id: `ext:${SELECTOR}:device:bulb-1:saturation`, state: 60 },
      {
        device_feature_external_id: `ext:${SELECTOR}:device:bulb-1:color-temperature`,
        state: 2700,
      },
    ]);
  });

  await t.test('a poll converts the sensor temperature to Celsius', async () => {
    send('external-integration.device.poll', {
      message_id: 'poll-sensor',
      device: pollDevice('sensor-1'),
    });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'poll-sensor'),
      `sensor poll ack\n${output}`,
    );
    const states = gladys.state.statePosts.at(-1);
    const temperature = states.find((s) => s.device_feature_external_id.endsWith(':temperature'));
    assert.equal(temperature.state, 21.1); // 70°F
    const contact = states.find((s) => s.device_feature_external_id.endsWith(':contact'));
    assert.equal(contact.state, 1);
  });

  await t.test('a set-value command sends a SmartThings command', async () => {
    send('external-integration.device.set-value', {
      message_id: 'set-off',
      device: pollDevice('bulb-1'),
      device_feature: {
        external_id: `ext:${SELECTOR}:device:bulb-1:switch`,
        category: 'light',
        type: 'binary',
      },
      value: 0,
    });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'set-off'),
      `set ack\n${output}`,
    );
    const ack = gladys.state.commandResults.find((r) => r.message_id === 'set-off');
    assert.equal(ack.success, true, ack.error);

    const command = smartthings.requests.findLast(
      (r) => r.method === 'POST' && r.path === '/devices/bulb-1/commands',
    );
    assert.ok(command, 'the integration called POST /devices/bulb-1/commands');
    assert.deepEqual(command.body, {
      commands: [{ component: 'main', capability: 'switch', command: 'off', arguments: [] }],
    });
  });

  await t.test('a set-value on a read-only feature is acked as failed', async () => {
    send('external-integration.device.set-value', {
      message_id: 'set-ro',
      device: pollDevice('sensor-1'),
      device_feature: {
        external_id: `ext:${SELECTOR}:device:sensor-1:temperature`,
        category: 'temperature-sensor',
        type: 'decimal',
      },
      value: 20,
    });
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === 'set-ro'),
      `fail ack\n${output}`,
    );
    const ack = gladys.state.commandResults.find((r) => r.message_id === 'set-ro');
    assert.equal(ack.success, false);
    assert.match(ack.error, /not controllable/);
  });
});

test('the OAuth2 "Connect" flow stores the tokens and loads the devices', async (t) => {
  const smartthings = await startFakeSmartThings();
  const gladys = await startFakeGladys({ client_id: 'my-client', client_secret: 'my-secret' });
  t.after(() => {
    smartthings.server.close();
    gladys.server.close();
  });

  let output = '';
  const child = spawn(process.execPath, ['index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      GLADYS_HOST_API_URL: `http://127.0.0.1:${gladys.port}`,
      GLADYS_INTEGRATION_TOKEN: TOKEN,
      GLADYS_INTEGRATION_SELECTOR: SELECTOR,
      SMARTTHINGS_ENDPOINT: `http://127.0.0.1:${smartthings.port}`,
      LOG_LEVEL: 'debug',
    },
  });
  child.stdout.on('data', (d) => {
    output += d;
  });
  child.stderr.on('data', (d) => {
    output += d;
  });
  t.after(() => child.kill('SIGKILL'));

  const send = (type, payload) => gladys.state.ws.send(JSON.stringify({ type, payload }));
  const ackOf = async (messageId) => {
    await waitUntil(
      () => gladys.state.commandResults.some((r) => r.message_id === messageId),
      `ack ${messageId}\n${output}`,
    );
    return gladys.state.commandResults.find((r) => r.message_id === messageId);
  };
  const redirectUri = 'https://my.gladysassistant.com/redirect/oauth';

  await waitUntil(() => output.includes('not configured yet'), `startup\n${output}`);
  assert.equal(gladys.state.discoveredDevicePosts.length, 0, 'nothing published before connecting');

  send('external-integration.oauth.get-authorize-url', {
    message_id: 'authorize',
    key: 'account',
    redirect_uri: redirectUri,
  });
  const authorize = await ackOf('authorize');
  assert.equal(authorize.success, true, authorize.error);
  const url = new URL(authorize.data.authorize_url);
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'my-client');
  assert.equal(url.searchParams.get('redirect_uri'), redirectUri);
  const state = url.searchParams.get('state');

  await t.test('a callback with an unknown state is refused', async () => {
    send('external-integration.oauth.callback', {
      message_id: 'forged',
      key: 'account',
      code: 'code',
      state: 'forged-state',
      redirect_uri: redirectUri,
    });
    const ack = await ackOf('forged');
    assert.equal(ack.success, false);
    assert.match(ack.error, /click "Connect" again/);
    assert.equal(
      smartthings.requests.filter((r) => r.path === '/oauth/token').length,
      0,
      'no code exchange for a forged state',
    );
  });

  await t.test('the callback exchanges the code, stores the tokens and publishes', async () => {
    send('external-integration.oauth.callback', {
      message_id: 'callback',
      key: 'account',
      code: 'the-code',
      state,
      redirect_uri: redirectUri,
    });
    const ack = await ackOf('callback');
    assert.equal(ack.success, true, ack.error);

    const exchange = smartthings.requests.find((r) => r.path === '/oauth/token');
    assert.equal(exchange.auth, `Basic ${Buffer.from('my-client:my-secret').toString('base64')}`);
    assert.deepEqual(exchange.body, {
      grant_type: 'authorization_code',
      code: 'the-code',
      redirect_uri: redirectUri,
      client_id: 'my-client',
    });

    assert.equal(gladys.state.config.oauth_access_token, 'oauth-access');
    assert.equal(gladys.state.config.oauth_refresh_token, 'oauth-refresh');
    assert.equal(gladys.state.config.oauth_client_id, 'my-client');
    assert.ok(gladys.state.config.oauth_expires_at > Date.now());

    assert.equal(gladys.state.discoveredDevicePosts.at(-1).length, 3);
    assert.equal(
      smartthings.requests.findLast((r) => r.path === '/devices').auth,
      'Bearer oauth-access',
    );
    assert.equal(gladys.state.connectionStatuses.at(-1).connected, true);
  });

  await t.test('the same state cannot be used twice', async () => {
    send('external-integration.oauth.callback', {
      message_id: 'replay',
      key: 'account',
      code: 'the-code',
      state,
      redirect_uri: redirectUri,
    });
    assert.equal((await ackOf('replay')).success, false);
  });
});
