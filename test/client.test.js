// Unit tests for the SmartThings API client (against a fake HTTP server).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { SmartThingsClient } from '../src/smartthings/client.js';
import { DEVICES_RESPONSE } from './fixtures.js';

// Spin up a fake SmartThings API recording the requests it receives.
async function startFakeApi(handler) {
  const requests = [];
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      requests.push({
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: body ? JSON.parse(body) : null,
      });
      handler(req, res, requests);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, baseUrl: `http://127.0.0.1:${server.address().port}` };
}

test('listDevices sends the bearer token and returns the items', async (t) => {
  const api = await startFakeApi((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(DEVICES_RESPONSE));
  });
  t.after(() => api.server.close());

  const client = new SmartThingsClient(api.baseUrl);
  client.setToken('my-pat');
  const devices = await client.listDevices();

  assert.equal(devices.length, 4);
  assert.equal(api.requests[0].auth, 'Bearer my-pat');
  assert.equal(api.requests[0].url, '/devices');
});

test('listDevices follows the pagination links', async (t) => {
  let page = 0;
  const api = await startFakeApi((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (page === 0) {
      page += 1;
      res.end(
        JSON.stringify({
          items: [{ deviceId: 'a' }],
          _links: { next: { href: '/v1/devices?page=2' } },
        }),
      );
    } else {
      res.end(JSON.stringify({ items: [{ deviceId: 'b' }] }));
    }
  });
  t.after(() => api.server.close());

  const client = new SmartThingsClient(api.baseUrl);
  client.setToken('my-pat');
  const devices = await client.listDevices();

  assert.deepEqual(
    devices.map((d) => d.deviceId),
    ['a', 'b'],
  );
  assert.equal(api.requests[1].url, '/devices?page=2');
});

test('sendCommands posts the commands payload', async (t) => {
  const api = await startFakeApi((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ results: [{ status: 'ACCEPTED' }] }));
  });
  t.after(() => api.server.close());

  const client = new SmartThingsClient(api.baseUrl);
  client.setToken('my-pat');
  await client.sendCommands('bulb-1', [
    { component: 'main', capability: 'switch', command: 'on', arguments: [] },
  ]);

  const request = api.requests[0];
  assert.equal(request.method, 'POST');
  assert.equal(request.url, '/devices/bulb-1/commands');
  assert.deepEqual(request.body, {
    commands: [{ component: 'main', capability: 'switch', command: 'on', arguments: [] }],
  });
});

test('an unconfigured client refuses to make requests', async () => {
  const client = new SmartThingsClient('http://127.0.0.1:1');
  assert.equal(client.isConfigured(), false);
  await assert.rejects(() => client.listDevices(), /not configured/);
});

test('a non-2xx response throws an error carrying the HTTP status', async (t) => {
  const api = await startFakeApi((req, res) => {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'UnauthorizedError' } }));
  });
  t.after(() => api.server.close());

  const client = new SmartThingsClient(api.baseUrl);
  client.setToken('expired');
  await assert.rejects(
    () => client.listDevices(),
    (err) => {
      assert.equal(err.status, 401);
      return true;
    },
  );
});
