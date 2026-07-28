// End-to-end test: boots the REAL integration process (index.js) against a
// fake Gladys host (WebSocket + REST, same contract as the SDK) and a fake
// SmartThings API, then exercises the full flows: initial discovery, scan
// request, poll and set-value commands.

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
      requests.push({
        method: req.method,
        path: url.pathname,
        body: body ? JSON.parse(body) : null,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      if (url.pathname === '/devices') {
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
function startFakeGladys() {
  const state = {
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
        respond({ config: { token: 'pat-123' } });
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
