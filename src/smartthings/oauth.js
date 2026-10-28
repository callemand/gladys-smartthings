// -----------------------------------------------------------------------------
// SmartThings OAuth2 (authorization code flow of an "API Access" app).
//
//   1. The user clicks "Connect" in Gladys: we build the authorization URL
//      (buildAuthorizeUrl), Gladys opens it in the browser;
//   2. SmartThings redirects back through Gladys with a one-time `code`, which
//      is exchanged for an access token (~24 h) and a refresh token
//      (exchangeCode);
//   3. OAuthSession hands a valid access token to every API call and refreshes
//      it before it expires. SmartThings rotates the refresh token on every
//      refresh (the previous one is invalidated), so the new pair is persisted
//      before being used, and only one refresh is ever in flight.
//
// Token endpoint: POST, form-encoded body, HTTP Basic auth with the client id /
// secret (https://developer.smartthings.com/docs/service-integrations/token-management).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

import {
  OAUTH_AUTHORIZE_URL,
  OAUTH_REFRESH_MARGIN_MS,
  OAUTH_SCOPES,
  OAUTH_TOKEN_URL,
} from '../constants.js';

const logger = createLogger({ name: 'smartthings-oauth' });

const REQUEST_TIMEOUT_MS = 15000;

/**
 * Build the SmartThings authorization page URL.
 * @param {{ clientId: string, redirectUri: string, state: string }} params
 * @returns {string}
 */
export function buildAuthorizeUrl({ clientId, redirectUri, state }, baseUrl = OAUTH_AUTHORIZE_URL) {
  // Scopes are space-separated, encoded as %20 (not "+", which
  // URLSearchParams would produce).
  const query = [
    ['client_id', clientId],
    ['response_type', 'code'],
    ['redirect_uri', redirectUri],
    ['scope', OAUTH_SCOPES.join(' ')],
    ['state', state],
  ]
    .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
    .join('&');
  return `${baseUrl}?${query}`;
}

/**
 * Call the token endpoint.
 * @returns {Promise<{ accessToken: string, refreshToken: string, expiresAt: number }>}
 */
async function requestTokens({ tokenUrl, clientId, clientSecret, params, now }) {
  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
    },
    body: new URLSearchParams({ ...params, client_id: clientId }).toString(),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const text = await response.text();
  if (!response.ok) {
    let reason = '';
    try {
      const body = JSON.parse(text);
      reason = body.error_description || body.error || '';
    } catch {
      // not JSON: the status alone tells enough
    }
    const error = new Error(
      `SmartThings token request failed: HTTP ${response.status}${reason ? ` (${reason})` : ''}`,
    );
    error.status = response.status;
    // 400 invalid_grant / 401: the code or the refresh token is no longer
    // valid (expired, revoked, already used) — only a new "Connect" can fix it.
    error.reauthorize = response.status === 400 || response.status === 401;
    throw error;
  }
  const body = JSON.parse(text);
  if (!body.access_token || !body.refresh_token) {
    throw new Error('SmartThings token response is missing the access or refresh token');
  }
  return {
    accessToken: body.access_token,
    refreshToken: body.refresh_token,
    expiresAt: now() + Number(body.expires_in || 0) * 1000,
  };
}

/**
 * Exchange the authorization code for the first token pair.
 * @param {{ clientId: string, clientSecret: string, code: string, redirectUri: string }} params
 */
export function exchangeCode(
  { clientId, clientSecret, code, redirectUri },
  { tokenUrl = OAUTH_TOKEN_URL, now = Date.now } = {},
) {
  return requestTokens({
    tokenUrl,
    clientId,
    clientSecret,
    params: { grant_type: 'authorization_code', code, redirect_uri: redirectUri },
    now,
  });
}

export class OAuthSession {
  /**
   * @param {object} options
   * @param {string} options.clientId
   * @param {string} options.clientSecret
   * @param {{ accessToken: string|null, refreshToken: string, expiresAt: number }} options.tokens
   * @param {(tokens: object) => Promise<void>} options.onTokens persists a new
   *   token pair; awaited before the new access token is used
   * @param {(err: Error) => void} [options.onRevoked] called once when
   *   SmartThings refuses the refresh token: the user must "Connect" again
   */
  constructor({
    clientId,
    clientSecret,
    tokens,
    onTokens,
    onRevoked = () => {},
    tokenUrl = OAUTH_TOKEN_URL,
    now = Date.now,
  }) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.tokens = { ...tokens };
    this.onTokens = onTokens;
    this.onRevoked = onRevoked;
    // Set once the refresh token is refused: every later call fails fast
    // instead of hammering the token endpoint at each poll.
    this.revokedError = null;
    this.tokenUrl = tokenUrl;
    this.now = now;
    this.pendingRefresh = null;
  }

  /** True when the access token is missing or about to expire. */
  needsRefresh() {
    return !this.tokens.accessToken || this.tokens.expiresAt - this.now() < OAUTH_REFRESH_MARGIN_MS;
  }

  /** A valid access token, refreshed first when it is about to expire. */
  async getAccessToken() {
    if (this.needsRefresh()) {
      await this.refresh();
    }
    return this.tokens.accessToken;
  }

  /**
   * Refresh the token pair. Concurrent callers share the same request. Passing
   * the access token that was rejected skips the refresh when another caller
   * already replaced it (parallel polls all failing with the old token).
   * @param {string} [rejectedToken]
   */
  async refresh(rejectedToken) {
    if (this.revokedError) {
      throw this.revokedError;
    }
    if (rejectedToken && rejectedToken !== this.tokens.accessToken) {
      return this.tokens.accessToken;
    }
    if (!this.pendingRefresh) {
      this.pendingRefresh = this.#refreshNow().finally(() => {
        this.pendingRefresh = null;
      });
    }
    await this.pendingRefresh;
    return this.tokens.accessToken;
  }

  async #refreshNow() {
    logger.info('Refreshing the SmartThings access token');
    let tokens;
    try {
      tokens = await requestTokens({
        tokenUrl: this.tokenUrl,
        clientId: this.clientId,
        clientSecret: this.clientSecret,
        params: { grant_type: 'refresh_token', refresh_token: this.tokens.refreshToken },
        now: this.now,
      });
    } catch (err) {
      // A network error is retried at the next call; a refused refresh token
      // is final.
      if (err.reauthorize) {
        this.revokedError = err;
        this.onRevoked(err);
      }
      throw err;
    }
    // The previous refresh token is now invalid: keep the new pair in memory
    // even if persisting it fails, so the integration keeps working until the
    // next restart.
    this.tokens = tokens;
    try {
      await this.onTokens(tokens);
    } catch (err) {
      logger.error(
        'Could not store the refreshed SmartThings tokens: after a restart, click "Connect" again',
        err,
      );
    }
  }
}
