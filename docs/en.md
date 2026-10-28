# SmartThings

## Overview

This integration connects Gladys Assistant to the **Samsung SmartThings**
cloud, so you can control the SmartThings devices of your account directly from
Gladys.

Once configured, every supported device of your SmartThings account appears in
the Gladys **Discovery** screen. The integration maps each SmartThings
_capability_ to a Gladys feature, so a single device can expose several
features. The supported capabilities are:

- **Switches, plugs & appliances** — on/off (`switch`), and, when metered,
  instantaneous power (W) and voltage (read-only); Samsung appliances report
  their power through `powerConsumptionReport`, and their child lock
  (`samsungce.kidsLock`) is exposed read-only. The cumulative lifetime energy
  counter is intentionally not exposed (a running total is not actionable
  per-device);
- **Lights** — on/off, brightness, hue, saturation and color temperature;
- **Locks** — lock / unlock (`lock`);
- **Motorized shades** — position 0–100 % (`windowShadeLevel`);
- **Thermostats** — mode, heating setpoint and cooling setpoint;
- **Sensors** (read-only, with history) — temperature, humidity, contact
  (opening), motion, presence, water leak, smoke, battery, illuminance, CO2 and
  air-quality index.

Device states are refreshed every 10 seconds, so changes made from the
SmartThings app or a physical switch show up in Gladys shortly after.

The integration reads the **main component** of each device (the standard
component of consumer devices). Devices exposing only unsupported capabilities
(for example a hub) are not published.

## Prerequisites

- A **Samsung SmartThings account** with your devices already added to it in
  the SmartThings mobile app.
- Internet access on your Gladys instance: this integration talks to the
  SmartThings cloud (`api.smartthings.com`).
- Either a **SmartThings OAuth-In app** (recommended, see below), or a
  **Personal Access Token**, which expires after 24 hours.

## Connecting with OAuth2 (recommended)

SmartThings Personal Access Tokens created since late 2024 expire after 24
hours. With OAuth2, the integration renews its access by itself: you connect
once and never paste a token again.

### 1. Create a SmartThings OAuth-In app (once)

This is done with the [SmartThings CLI](https://developer.smartthings.com/docs/sdks/cli/)
(`npm install -g @smartthings/cli`, or Homebrew on macOS):

```sh
smartthings apps:create
```

Answer the questions:

- **What kind of app?** → `OAuth-In App`;
- **Display name** → for example `Gladys`;
- **Scopes** → select `r:devices:*`, `x:devices:*` and `r:locations:*`;
- **Redirect URIs** → `https://my.gladysassistant.com/redirect/oauth`.

The CLI prints an **OAuth Client Id** and an **OAuth Client Secret**. The secret
is shown **only once**: copy both.

The redirect URI is the Gladys relay: SmartThings sends you back there, and it
forwards you to your own Gladys instance, whatever its address (no public HTTPS
address needed on your side).

If you access Gladys over HTTPS (Gladys Plus or your own domain), the
Configuration screen offers **"Use the address of my instance instead"** under
the Connect button. When it is ticked, Gladys sends the address it shows there
(for example
`https://plus.gladysassistant.com/dashboard/integration/device/external/<integration>/oauth-callback`)
instead of the relay: declare that exact address in the app too, otherwise
SmartThings answers `'redirect_uri' could not be validated`. An app can list
several redirect URIs.

### 2. Connect from Gladys

1. Open the integration **Configuration** screen.
2. Paste the **Client id** and the **Client secret**, then **save**.
3. Click **Connect**: the SmartThings authorization page opens. Sign in, pick
   the location to share and confirm.
4. You are sent back to Gladys: the integration stores the tokens (never shown
   in the interface) and loads your devices.

The access token lives 24 hours; the integration refreshes it a few hours before
it expires, and checks every hour even when no device is polled. SmartThings
cancels an authorization left unused for 29 days: as long as the integration
runs, this never happens.

## Alternative: a Personal Access Token

1. Open **https://account.smartthings.com/tokens** and sign in with your
   Samsung / SmartThings account.
2. Click **Generate new token**.
3. Give it a name (for example `Gladys`).
4. Select at least these scopes:
   - **Devices** → _List all devices_, _See all devices_, _Control all devices_;
   - **Locations** → _See all locations_.
5. Click **Generate token**. The token is shown **only once** — copy it.

> ⚠️ Since late 2024, newly created SmartThings Personal Access Tokens **expire
> after 24 hours**: the integration then stops until you paste a new one. Use
> OAuth2 (above) for permanent use. Once an account is connected with OAuth2,
> the token field is ignored.

## Configuration

1. Install the integration from the Gladys store.
2. Open its **Configuration** screen and connect your account with OAuth2 (see
   above), or paste a **Personal Access Token** (stored as a secret, never
   displayed back) and save.
3. The integration connects to SmartThings and loads your devices.
4. Open the **Discovery** screen: your devices are listed there. Add the ones
   you want, then place them in your rooms and dashboards like any Gladys
   device.

To use another SmartThings account later, click **Connect** again (OAuth2) or
update the token: the integration reconnects and refreshes the device list
automatically. Changing the client id makes the integration forget the tokens
of the previous app: click **Connect** again.

## Troubleshooting

- **"SmartThings is not configured" during discovery** — no account is
  connected and no token is filled in: connect with OAuth2, or paste a token,
  in the Configuration screen.
- **"Fill in and save the client id and client secret" when clicking Connect**
  — save the two fields first, then click **Connect**.
- **`'redirect_uri' could not be validated` on the SmartThings page** — the app
  does not list the redirect URI Gladys sent: the relay
  `https://my.gladysassistant.com/redirect/oauth`, or, when "Use the address of
  my instance instead" is ticked, the address shown under the Connect button.
  Check the app with `smartthings apps:oauth <app id>` and add the missing
  address with `smartthings apps:oauth:update <app id>`.
- **The connection status asks to click "Connect" again** — SmartThings no
  longer accepts the authorization (revoked in the SmartThings app, or unused
  for 29 days): click **Connect**.
- **The connection status says the token was rejected** — the Personal Access
  Token is invalid or expired (24-hour expiry): switch to OAuth2, or generate a
  new token.
- **A device is missing from Discovery** — make sure it is visible in the
  SmartThings app with the same account, that it is online, and that it exposes
  at least one supported capability, then run the discovery again.
- **A device shows fewer features than expected** — only the supported
  capabilities of the _main_ component are mapped; capabilities on other
  components are not exposed.
- **Commands seem ignored** — SmartThings can take a few seconds to relay a
  command to the device; the state in Gladys reflects the cloud state and
  catches up at the next 10-second poll.
