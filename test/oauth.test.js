// Unit tests for the OAuth2 flow (against a fake SmartThings token endpoint).

import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

import { OAuthSession, buildAuthorizeUrl, exchangeCode } from '../src/smartthings/oauth.js';
import { SmartThingsClient } from '../src/smartthings/client.js';
import { authMode, normalizeConfig, oauthTokensToConfig } from '../src/config.js';

const HOUR = 60 * 60 * 1000;

// Fake token endpoint: hands out numbered token pairs, accepts only the latest
// refresh token (SmartThings rotates them), records the requests.
async function startFakeTokenServer({ status } = {}) {
  const requests = [];
  let issued = 0;
  let validRefreshToken = 'refresh-0';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
    });
    req.on('end', () => {
      const params = Object.fromEntries(new URLSearchParams(body));
      requests.push({ url: req.url, auth: req.headers.authorization, params });
      const refused =
        status ||
        (params.grant_type === 'refresh_token' && params.refresh_token !== validRefreshToken)
          ? status || 400
          : null;
      if (refused) {
        res.writeHead(refused, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      issued += 1;
      validRefreshToken = `refresh-${issued}`;
      // Answer a bit later, so that concurrent callers overlap.
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            access_token: `access-${issued}`,
            refresh_token: validRefreshToken,
            token_type: 'bearer',
            expires_in: 86399,
          }),
        );
      }, 20);
    });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, tokenUrl: `http://127.0.0.1:${server.address().port}/oauth/token` };
}

function newSession(tokenUrl, overrides = {}) {
  const stored = [];
  const session = new OAuthSession({
    clientId: 'client',
    clientSecret: 'secret',
    tokens: {
      accessToken: 'access-0',
      refreshToken: 'refresh-0',
      expiresAt: Date.now() + 20 * HOUR,
    },
    onTokens: async (tokens) => {
      stored.push(tokens);
    },
    tokenUrl,
    ...overrides,
  });
  return { session, stored };
}

test('buildAuthorizeUrl encodes the scopes with %20 and keeps the state', () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: 'my-client',
      redirectUri: 'https://my.gladysassistant.com/redirect/oauth',
      state: 'abc',
    }),
  );
  // At the root of the API host: /v1/oauth/authorize fails after the sign-in.
  assert.equal(url.origin + url.pathname, 'https://api.smartthings.com/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'my-client');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(
    url.searchParams.get('redirect_uri'),
    'https://my.gladysassistant.com/redirect/oauth',
  );
  assert.equal(url.searchParams.get('scope'), 'r:devices:* x:devices:* r:locations:*');
  assert.equal(url.searchParams.get('state'), 'abc');
  assert.match(url.search, /scope=r%3Adevices%3A\*%20x%3Adevices/);
});

test('exchangeCode posts the code with Basic auth and returns the token pair', async (t) => {
  const api = await startFakeTokenServer();
  t.after(() => api.server.close());

  const tokens = await exchangeCode(
    { clientId: 'client', clientSecret: 'secret', code: 'the-code', redirectUri: 'https://r' },
    { tokenUrl: api.tokenUrl, now: () => 1000 },
  );

  assert.deepEqual(tokens, {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresAt: 1000 + 86399 * 1000,
  });
  const [request] = api.requests;
  assert.equal(request.auth, `Basic ${Buffer.from('client:secret').toString('base64')}`);
  assert.deepEqual(request.params, {
    grant_type: 'authorization_code',
    code: 'the-code',
    redirect_uri: 'https://r',
    client_id: 'client',
  });
});

test('a refused code asks for a new authorization', async (t) => {
  const api = await startFakeTokenServer({ status: 400 });
  t.after(() => api.server.close());

  await assert.rejects(
    () =>
      exchangeCode(
        { clientId: 'client', clientSecret: 'secret', code: 'used', redirectUri: 'https://r' },
        { tokenUrl: api.tokenUrl },
      ),
    (err) => {
      assert.equal(err.status, 400);
      assert.equal(err.reauthorize, true);
      assert.match(err.message, /invalid_grant/);
      return true;
    },
  );
});

test('a valid access token is used as is', async (t) => {
  const api = await startFakeTokenServer();
  t.after(() => api.server.close());
  const { session } = newSession(api.tokenUrl);

  assert.equal(await session.getAccessToken(), 'access-0');
  assert.equal(api.requests.length, 0);
});

test('a token close to its expiry is refreshed, and the rotated pair stored', async (t) => {
  const api = await startFakeTokenServer();
  t.after(() => api.server.close());
  const { session, stored } = newSession(api.tokenUrl, {
    tokens: { accessToken: 'access-0', refreshToken: 'refresh-0', expiresAt: Date.now() + HOUR },
  });

  assert.equal(await session.getAccessToken(), 'access-1');
  assert.equal(api.requests[0].params.grant_type, 'refresh_token');
  assert.equal(api.requests[0].params.refresh_token, 'refresh-0');
  assert.equal(stored.length, 1);
  assert.equal(stored[0].refreshToken, 'refresh-1');

  // The next refresh uses the rotated refresh token.
  await session.refresh();
  assert.equal(api.requests[1].params.refresh_token, 'refresh-1');
  assert.equal(session.tokens.accessToken, 'access-2');
});

test('concurrent callers share a single refresh', async (t) => {
  const api = await startFakeTokenServer();
  t.after(() => api.server.close());
  const { session } = newSession(api.tokenUrl, {
    tokens: { accessToken: null, refreshToken: 'refresh-0', expiresAt: 0 },
  });

  const tokens = await Promise.all([1, 2, 3, 4, 5].map(() => session.getAccessToken()));

  assert.deepEqual(tokens, Array(5).fill('access-1'));
  assert.equal(api.requests.length, 1);
});

test('a token already replaced by another caller is not refreshed again', async (t) => {
  const api = await startFakeTokenServer();
  t.after(() => api.server.close());
  const { session } = newSession(api.tokenUrl);

  await session.refresh('access-0');
  // A slower request, sent with access-0, comes back 401 afterwards.
  assert.equal(await session.refresh('access-0'), 'access-1');
  assert.equal(api.requests.length, 1);
});

test('a refused refresh token fails fast afterwards and is reported once', async (t) => {
  const api = await startFakeTokenServer();
  t.after(() => api.server.close());
  const revoked = [];
  const { session } = newSession(api.tokenUrl, {
    tokens: { accessToken: 'access-0', refreshToken: 'revoked', expiresAt: 0 },
    onRevoked: (err) => revoked.push(err),
  });

  await assert.rejects(() => session.getAccessToken(), /HTTP 400/);
  await assert.rejects(() => session.getAccessToken(), /HTTP 400/);
  assert.equal(api.requests.length, 1);
  assert.equal(revoked.length, 1);
});

test('the client refreshes once and retries when the API answers 401', async (t) => {
  const tokens = await startFakeTokenServer();
  const accepted = 'access-1';
  const calls = [];
  const api = createServer((req, res) => {
    calls.push(req.headers.authorization);
    const ok = req.headers.authorization === `Bearer ${accepted}`;
    res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ok ? { items: [{ deviceId: 'a' }] } : {}));
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    tokens.server.close();
    api.close();
  });

  const { session } = newSession(tokens.tokenUrl);
  const client = new SmartThingsClient(`http://127.0.0.1:${api.address().port}`);
  client.setOAuthSession(session);

  const devices = await client.listDevices();

  assert.equal(devices.length, 1);
  assert.deepEqual(calls, ['Bearer access-0', 'Bearer access-1']);
});

test('a Personal Access Token is not refreshed on 401', async (t) => {
  const calls = [];
  const api = createServer((req, res) => {
    calls.push(req.headers.authorization);
    res.writeHead(401);
    res.end();
  });
  await new Promise((resolve) => api.listen(0, '127.0.0.1', resolve));
  t.after(() => api.close());

  const client = new SmartThingsClient(`http://127.0.0.1:${api.address().port}`);
  client.setToken('pat');
  await assert.rejects(
    () => client.listDevices(),
    (err) => err.status === 401,
  );
  assert.equal(calls.length, 1);
});

test('OAuth2 wins over the Personal Access Token once connected', () => {
  const tokens = { accessToken: 'a', refreshToken: 'r', expiresAt: 42 };
  const connected = normalizeConfig({
    token: 'pat',
    client_id: 'client',
    client_secret: 'secret',
    ...oauthTokensToConfig('client', tokens),
  });
  assert.equal(authMode(connected), 'oauth');
  assert.deepEqual(connected.oauthTokens, tokens);

  // Not connected yet: the PAT applies.
  assert.equal(authMode(normalizeConfig({ token: 'pat', client_id: 'client' })), 'pat');
  assert.equal(authMode(normalizeConfig({})), null);

  // Tokens issued for another app are ignored.
  const otherApp = normalizeConfig({
    token: 'pat',
    client_id: 'new-client',
    client_secret: 'secret',
    ...oauthTokensToConfig('old-client', tokens),
  });
  assert.equal(otherApp.oauthTokens, null);
  assert.equal(authMode(otherApp), 'pat');
});
