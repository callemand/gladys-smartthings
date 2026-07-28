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
- A **Personal Access Token** (see below).

## Getting a Personal Access Token

1. Open **https://account.smartthings.com/tokens** and sign in with your
   Samsung / SmartThings account.
2. Click **Generate new token**.
3. Give it a name (for example `Gladys`).
4. Select at least these scopes:
   - **Devices** → _List all devices_, _See all devices_, _Control all devices_;
   - **Locations** → _See all locations_.
5. Click **Generate token**. The token is shown **only once** — copy it.

> ⚠️ Since late 2024, newly created SmartThings Personal Access Tokens **expire
> after 24 hours**. This is fine for testing; for permanent use you will need to
> regenerate the token or use an OAuth2-based setup in a future version of the
> integration.

## Configuration

1. Install the integration from the Gladys store.
2. Open its **Configuration** screen and paste your **Personal Access Token**
   (stored as a secret, never displayed back).
3. Save. The integration connects to SmartThings and loads your devices.
4. Open the **Discovery** screen: your devices are listed there. Add the ones
   you want, then place them in your rooms and dashboards like any Gladys
   device.

To use another SmartThings account or a fresh token later, just update the
token in the Configuration screen: the integration reconnects and refreshes the
device list automatically.

## Troubleshooting

- **"SmartThings is not configured" during discovery** — the token is missing:
  paste it in the Configuration screen and save.
- **The connection status says the token was rejected** — the token is invalid
  or expired (remember the 24-hour expiry): generate a new one and update the
  configuration.
- **A device is missing from Discovery** — make sure it is visible in the
  SmartThings app with the same account, that it is online, and that it exposes
  at least one supported capability, then run the discovery again.
- **A device shows fewer features than expected** — only the supported
  capabilities of the _main_ component are mapped; capabilities on other
  components are not exposed.
- **Commands seem ignored** — SmartThings can take a few seconds to relay a
  command to the device; the state in Gladys reflects the cloud state and
  catches up at the next 10-second poll.
