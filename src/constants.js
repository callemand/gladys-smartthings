// -----------------------------------------------------------------------------
// SmartThings protocol constants + the few Gladys values the SDK does not
// export.
//
// The standard Gladys feature categories / types / units come straight from
// the SDK (DEVICE_FEATURE_CATEGORIES, DEVICE_FEATURE_TYPES,
// DEVICE_FEATURE_UNITS) — only integration-specific values live here.
// -----------------------------------------------------------------------------

// SmartThings Cloud API base URL. The env var override is only used by the
// test suite.
export const SMARTTHINGS_ENDPOINT = (
  process.env.SMARTTHINGS_ENDPOINT || 'https://api.smartthings.com/v1'
).replace(/\/+$/, '');

// OAuth2 (SmartThings "API Access" app created with the SmartThings CLI).
// The authorization page is served at the root of the API host: the documented
// /v1/oauth/authorize goes through the Samsung sign-in, then fails with
// "Resource representation is only available with these types: text/html"
// (seen on a real account). The token endpoint works under /v1.
export const OAUTH_AUTHORIZE_URL = `${SMARTTHINGS_ENDPOINT.replace(/\/v1$/, '')}/oauth/authorize`;
export const OAUTH_TOKEN_URL = `${SMARTTHINGS_ENDPOINT}/oauth/token`;
// Read and control the devices, read the locations (same rights as the PAT).
export const OAUTH_SCOPES = ['r:devices:*', 'x:devices:*', 'r:locations:*'];
// SmartThings access tokens live ~24 h. Refresh when less than this margin is
// left, and check at this interval even when no device is polled: a refresh
// token unused for 29 days is dead, and the user would have to reconnect.
export const OAUTH_REFRESH_MARGIN_MS = 6 * 60 * 60 * 1000;
export const OAUTH_REFRESH_CHECK_INTERVAL_MS = 60 * 60 * 1000;
// An authorization started with "Connect" must come back within this delay.
export const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

// SmartThings devices are organized in components; almost every capability of
// a consumer device lives on the "main" component. This integration maps the
// main component (see the docs for the multi-component note).
export const MAIN_COMPONENT = 'main';

// Devices are polled every 10 seconds, like the built-in cloud services (must
// be one of the Gladys DEVICE_POLL_FREQUENCIES values, in milliseconds).
export const POLL_FREQUENCY = 10 * 1000;

// Type slug used in the device external ids (`ext:<selector>:device:<deviceId>`).
export const DEVICE_SLUG = 'device';

// Gladys air-conditioning / thermostat modes (server/utils/constants.js: AC_MODE).
export const AC_MODE = {
  AUTO: 0,
  COOLING: 1,
  HEATING: 2,
  DRYING: 3,
  FAN: 4,
};

// SmartThings thermostatMode <-> Gladys AC_MODE. SmartThings "off" has no
// AC_MODE counterpart (Gladys models power separately), so it is not mapped:
// an "off" thermostat simply reports no mode state.
export const THERMOSTAT_MODE_TO_GLADYS = {
  auto: AC_MODE.AUTO,
  cool: AC_MODE.COOLING,
  heat: AC_MODE.HEATING,
  'emergency heat': AC_MODE.HEATING,
  fanonly: AC_MODE.FAN,
};

export const GLADYS_TO_THERMOSTAT_MODE = {
  [AC_MODE.AUTO]: 'auto',
  [AC_MODE.COOLING]: 'cool',
  [AC_MODE.HEATING]: 'heat',
  [AC_MODE.FAN]: 'fanonly',
};

// SmartThings capability ids used to detect the "kind" of a device (so a bulb
// exposing `switch` is mapped to the Gladys LIGHT category, not SWITCH).
export const LIGHT_CAPABILITIES = ['colorControl', 'colorTemperature'];

// Temperature sensor bounds (Celsius).
export const TEMPERATURE_BOUNDS = { MIN: -50, MAX: 100 };
// Thermostat setpoint bounds (Celsius).
export const SETPOINT_BOUNDS = { MIN: 5, MAX: 40 };
export const PERCENT_BOUNDS = { MIN: 0, MAX: 100 };
export const BATTERY_BOUNDS = { MIN: 0, MAX: 100 };
export const POWER_BOUNDS = { MIN: 0, MAX: 100000 }; // watt
export const ENERGY_BOUNDS = { MIN: 0, MAX: 1000000 }; // kWh
export const VOLTAGE_BOUNDS = { MIN: 0, MAX: 500 }; // volt
export const ILLUMINANCE_BOUNDS = { MIN: 0, MAX: 200000 }; // lux
export const CO2_BOUNDS = { MIN: 0, MAX: 5000 }; // ppm
export const AIR_QUALITY_INDEX_BOUNDS = { MIN: 0, MAX: 500 }; // CAQI/AQI
export const PM_BOUNDS = { MIN: 0, MAX: 1000 }; // µg/m³ (dustSensor)
export const PRESSURE_BOUNDS = { MIN: 800, MAX: 1200 }; // hPa (atmosphericPressure)
// SmartThings colorTemperature is expressed in kelvin.
export const COLOR_TEMPERATURE_BOUNDS = { MIN: 1000, MAX: 30000 };

// Feature suffixes used in the feature external ids
// (`ext:<selector>:device:<deviceId>:<code>`).
export const FEATURE_CODES = {
  SWITCH: 'switch',
  BRIGHTNESS: 'brightness',
  HUE: 'hue',
  SATURATION: 'saturation',
  COLOR_TEMPERATURE: 'color-temperature',
  TEMPERATURE: 'temperature',
  HUMIDITY: 'humidity',
  CONTACT: 'contact',
  MOTION: 'motion',
  PRESENCE: 'presence',
  WATER_LEAK: 'water-leak',
  SMOKE: 'smoke',
  BATTERY: 'battery',
  POWER: 'power',
  ENERGY: 'energy',
  VOLTAGE: 'voltage',
  ILLUMINANCE: 'illuminance',
  CO2: 'co2',
  PM25: 'pm25',
  PM10: 'pm10',
  PRESSURE: 'pressure',
  AIR_QUALITY_INDEX: 'air-quality-index',
  LOCK: 'lock',
  CHILD_LOCK: 'child-lock',
  SHADE_POSITION: 'shade-position',
  THERMOSTAT_MODE: 'thermostat-mode',
  COOLING_SETPOINT: 'cooling-setpoint',
  HEATING_SETPOINT: 'heating-setpoint',
};
