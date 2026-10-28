// -----------------------------------------------------------------------------
// Integration configuration.
//
// The configuration is filled in by the user in Gladys, from the
// `config_schema` declared in `gladys-assistant-integration.json`. The SDK
// fetches it (`gladys.getConfig()`) and notifies every change through
// `gladys.onConfigUpdated()`.
//
// Two ways to authenticate:
//   - OAuth2 (recommended): the user creates a SmartThings "API Access" app,
//     fills in its client id / secret, then clicks "Connect". The tokens are
//     stored by the integration under keys outside the config_schema (never
//     shown in the UI) and refreshed automatically;
//   - Personal Access Token: simpler, but SmartThings PATs created since late
//     2024 expire after 24 hours.
// -----------------------------------------------------------------------------

// Config keys written by the integration itself (outside the config_schema).
export const OAUTH_TOKEN_KEYS = {
  ACCESS_TOKEN: 'oauth_access_token',
  REFRESH_TOKEN: 'oauth_refresh_token',
  EXPIRES_AT: 'oauth_expires_at',
  // The app the tokens were issued for: tokens of a previous app are ignored.
  CLIENT_ID: 'oauth_client_id',
};

export const DEFAULT_CONFIG = {
  token: null,
  clientId: null,
  clientSecret: null,
  oauthTokens: null,
};

const clean = (value) => (value ? String(value).trim() : null);

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const clientId = clean(raw.client_id);
  const refreshToken = clean(raw[OAUTH_TOKEN_KEYS.REFRESH_TOKEN]);
  const tokensClientId = clean(raw[OAUTH_TOKEN_KEYS.CLIENT_ID]);
  return {
    ...DEFAULT_CONFIG,
    token: clean(raw.token),
    clientId,
    clientSecret: clean(raw.client_secret),
    oauthTokens:
      refreshToken && clientId && tokensClientId === clientId
        ? {
            accessToken: clean(raw[OAUTH_TOKEN_KEYS.ACCESS_TOKEN]),
            refreshToken,
            expiresAt: Number(raw[OAUTH_TOKEN_KEYS.EXPIRES_AT]) || 0,
          }
        : null,
  };
}

/**
 * Which authentication applies: OAuth2 once connected, else the Personal
 * Access Token, else none.
 * @param {ReturnType<typeof normalizeConfig>} config
 * @returns {'oauth' | 'pat' | null}
 */
export function authMode(config) {
  if (config.clientId && config.clientSecret && config.oauthTokens) {
    return 'oauth';
  }
  return config.token ? 'pat' : null;
}

/**
 * The config keys to store for a set of OAuth2 tokens.
 * @param {string} clientId the app the tokens were issued for
 * @param {{ accessToken: string, refreshToken: string, expiresAt: number }} tokens
 */
export function oauthTokensToConfig(clientId, tokens) {
  return {
    [OAUTH_TOKEN_KEYS.ACCESS_TOKEN]: tokens.accessToken,
    [OAUTH_TOKEN_KEYS.REFRESH_TOKEN]: tokens.refreshToken,
    [OAUTH_TOKEN_KEYS.EXPIRES_AT]: tokens.expiresAt,
    [OAUTH_TOKEN_KEYS.CLIENT_ID]: clientId,
  };
}
