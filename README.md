# Gladys SmartThings integration

External [Gladys Assistant](https://gladysassistant.com) integration for
**Samsung SmartThings**: control your SmartThings switches, lights, locks,
motorized shades, thermostats and sensors from Gladys.

It runs as a standalone Docker container and talks to Gladys through the
[`@gladysassistant/integration-sdk`](https://www.npmjs.com/package/@gladysassistant/integration-sdk),
and to Samsung through the [SmartThings Cloud API](https://developer.smartthings.com/docs/api/public)
using a **Personal Access Token**.

## Supported capabilities

| SmartThings capability                                                                | Gladys feature                                     |
| ------------------------------------------------------------------------------------- | -------------------------------------------------- |
| `switch`                                                                              | Switch / light on-off                              |
| `switchLevel`                                                                         | Brightness (light) or dimmer (switch)              |
| `colorControl`                                                                        | Hue + saturation                                   |
| `colorTemperature`                                                                    | Color temperature (K)                              |
| `lock`                                                                                | Lock / unlock                                      |
| `windowShadeLevel`                                                                    | Shade position (%)                                 |
| `thermostatMode` / `thermostatHeatingSetpoint` / `thermostatCoolingSetpoint`          | Thermostat mode + setpoints                        |
| `temperatureMeasurement`                                                              | Temperature sensor (°C, Fahrenheit auto-converted) |
| `relativeHumidityMeasurement`                                                         | Humidity sensor                                    |
| `contactSensor` / `motionSensor` / `presenceSensor` / `waterSensor` / `smokeDetector` | Binary sensors                                     |
| `battery`                                                                             | Battery                                            |
| `powerMeter` / `voltageMeasurement`                                                   | Power (W), voltage (read-only)                     |
| `powerConsumptionReport` (Samsung appliances)                                         | Instantaneous power (W) from the nested report     |
| `samsungce.kidsLock` (Samsung appliances)                                             | Child lock (read-only)                             |
| `illuminanceMeasurement`                                                              | Light sensor (lux)                                 |
| `carbonDioxideMeasurement` / `airQualitySensor`                                       | CO2 / air-quality index                            |
| `dustSensor`                                                                          | PM2.5 + PM10 (µg/m³)                               |
| `atmosphericPressureMeasurement`                                                      | Atmospheric pressure (hPa)                         |

Only the `main` component of each device is mapped.

## References

The capability mapping and API usage were verified against:

- the SmartThings OpenAPI (Swagger) spec: <https://swagger.api.smartthings.com/public/st-api.yml>
- the SmartThings public API reference: <https://developer.smartthings.com/docs/api/public>
- the official Home Assistant SmartThings integration
  ([`homeassistant/components/smartthings`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/smartthings))
  and its [`pysmartthings`](https://github.com/pySmartThings/pysmartthings) library
- a live SmartThings account (real `GET /devices` and `/status` payloads), which
  is what surfaced the Samsung `powerConsumptionReport` nested-object shape.

## Configuration

The integration needs a single secret: a SmartThings **Personal Access Token**
generated at <https://account.smartthings.com/tokens> with the _Devices_ (list,
see, control) and _Locations_ (see) scopes.

> ⚠️ New SmartThings PATs expire after 24 hours (policy change of late 2024).

See [`docs/en.md`](docs/en.md) / [`docs/fr.md`](docs/fr.md) for the full user
documentation.

## Development

```bash
npm install
npm test          # node:test unit tests + e2e (boots index.js against fakes)
npm run lint
npm run format
```

The end-to-end test (`test/e2e.test.js`) boots the real `index.js` against a
fake Gladys host (WebSocket + REST) and a fake SmartThings API, exercising
discovery, poll and set-value.

## License

Apache-2.0
