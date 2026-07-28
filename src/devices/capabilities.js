// -----------------------------------------------------------------------------
// SmartThings capability <-> Gladys feature registry.
//
// A SmartThings device is a set of *components* (usually just "main"), each
// exposing *capabilities* (switch, switchLevel, temperatureMeasurement, lock…)
// whose *attributes* carry the live values. This module is the single source of
// truth mapping each supported capability to one Gladys feature:
//
//   - buildFeatures(ids, device) -> the Gladys features of a device;
//   - buildStates(ids, status)   -> the Gladys states from a device status;
//   - buildCommand(code, value)  -> the SmartThings command for a Gladys write.
//
// The device status shape is:
//   { components: { main: { <capability>: { <attribute>: { value, unit } } } } }
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES,
  DEVICE_FEATURE_TYPES,
  DEVICE_FEATURE_UNITS,
} from '@gladysassistant/integration-sdk';

import {
  AIR_QUALITY_INDEX_BOUNDS,
  BATTERY_BOUNDS,
  CO2_BOUNDS,
  COLOR_TEMPERATURE_BOUNDS,
  FEATURE_CODES,
  GLADYS_TO_THERMOSTAT_MODE,
  ILLUMINANCE_BOUNDS,
  LIGHT_CAPABILITIES,
  MAIN_COMPONENT,
  PERCENT_BOUNDS,
  PM_BOUNDS,
  POWER_BOUNDS,
  PRESSURE_BOUNDS,
  SETPOINT_BOUNDS,
  TEMPERATURE_BOUNDS,
  THERMOSTAT_MODE_TO_GLADYS,
  VOLTAGE_BOUNDS,
} from '../constants.js';

const {
  SENSOR,
  LIGHT,
  SWITCH,
  LOCK,
  CHILD_LOCK,
  AIR_CONDITIONING,
  THERMOSTAT,
  SHUTTER,
  BATTERY,
  ENERGY_SENSOR,
} = DEVICE_FEATURE_TYPES;

const C = DEVICE_FEATURE_CATEGORIES;
const U = DEVICE_FEATURE_UNITS;

/**
 * Parse a value into a number, tolerating numeric strings.
 * @param {*} value the raw value
 * @returns {number|null} the parsed number, or null if not parseable
 */
function toNumber(value) {
  if (value === undefined || value === null || value === '') {
    return null;
  }
  const parsed = Number(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/**
 * Convert a temperature to Celsius. SmartThings delivers a `unit` alongside the
 * value ('C' or 'F'); Fahrenheit readings are converted, rounded to 0.1°C.
 * @param {*} value the raw temperature value
 * @param {string} [unit] the SmartThings unit ('C' | 'F')
 * @returns {number|null} the Celsius value, or null if not parseable
 */
function toCelsius(value, unit) {
  const number = toNumber(value);
  if (number === null) {
    return null;
  }
  if (unit && String(unit).toUpperCase() === 'F') {
    return Math.round((((number - 32) * 5) / 9) * 10) / 10;
  }
  return number;
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(toNumber(value) ?? 0)));
}

// The mapping table. Each entry is ONE Gladys feature. `capability` is the
// SmartThings capability that must be advertised for the feature to exist;
// `attribute` is the status field carrying its value. `category`/`type` may be
// a value or a `(ctx) => value` resolver (ctx = { isLight }). `read` maps a
// SmartThings `{ value, unit }` attribute to a Gladys numeric state; `command`
// (controllable features only) maps a Gladys value to a SmartThings command.
const FEATURES = [
  // --- Switch / light on-off --------------------------------------------------
  {
    capability: 'switch',
    attribute: 'switch',
    code: FEATURE_CODES.SWITCH,
    name: 'On/Off',
    category: (ctx) => (ctx.isLight ? C.LIGHT : C.SWITCH),
    type: (ctx) => (ctx.isLight ? LIGHT.BINARY : SWITCH.BINARY),
    min: 0,
    max: 1,
    read: (attr) => (attr.value === 'on' ? 1 : 0),
    command: (value) => ({ capability: 'switch', command: value ? 'on' : 'off', arguments: [] }),
  },
  // --- Dimmer / brightness ----------------------------------------------------
  {
    capability: 'switchLevel',
    attribute: 'level',
    code: FEATURE_CODES.BRIGHTNESS,
    name: (ctx) => (ctx.isLight ? 'Brightness' : 'Level'),
    category: (ctx) => (ctx.isLight ? C.LIGHT : C.SWITCH),
    type: (ctx) => (ctx.isLight ? LIGHT.BRIGHTNESS : SWITCH.DIMMER),
    unit: U.PERCENT,
    min: 0,
    max: 100,
    read: (attr) => toNumber(attr.value),
    command: (value) => ({
      capability: 'switchLevel',
      command: 'setLevel',
      arguments: [clampPercent(value)],
    }),
  },
  // --- Color (hue / saturation, on the SmartThings 0-100 scale) ---------------
  {
    capability: 'colorControl',
    attribute: 'hue',
    code: FEATURE_CODES.HUE,
    name: 'Hue',
    category: C.LIGHT,
    type: LIGHT.HUE,
    min: 0,
    max: 100,
    read: (attr) => toNumber(attr.value),
    command: (value) => ({
      capability: 'colorControl',
      command: 'setHue',
      arguments: [clampPercent(value)],
    }),
  },
  {
    capability: 'colorControl',
    attribute: 'saturation',
    code: FEATURE_CODES.SATURATION,
    name: 'Saturation',
    category: C.LIGHT,
    type: LIGHT.SATURATION,
    min: 0,
    max: 100,
    read: (attr) => toNumber(attr.value),
    command: (value) => ({
      capability: 'colorControl',
      command: 'setSaturation',
      arguments: [clampPercent(value)],
    }),
  },
  {
    capability: 'colorTemperature',
    attribute: 'colorTemperature',
    code: FEATURE_CODES.COLOR_TEMPERATURE,
    name: 'Color temperature',
    category: C.LIGHT,
    type: LIGHT.TEMPERATURE,
    unit: U.KELVIN,
    min: COLOR_TEMPERATURE_BOUNDS.MIN,
    max: COLOR_TEMPERATURE_BOUNDS.MAX,
    read: (attr) => toNumber(attr.value),
    command: (value) => ({
      capability: 'colorTemperature',
      command: 'setColorTemperature',
      arguments: [Math.round(toNumber(value) ?? 0)],
    }),
  },
  // --- Lock -------------------------------------------------------------------
  {
    capability: 'lock',
    attribute: 'lock',
    code: FEATURE_CODES.LOCK,
    name: 'Lock',
    category: C.LOCK,
    type: LOCK.BINARY,
    min: 0,
    max: 1,
    read: (attr) => (attr.value === 'locked' ? 1 : 0),
    command: (value) => ({ capability: 'lock', command: value ? 'lock' : 'unlock', arguments: [] }),
  },
  // --- Motorized shade (position) ---------------------------------------------
  {
    capability: 'windowShadeLevel',
    attribute: 'shadeLevel',
    code: FEATURE_CODES.SHADE_POSITION,
    name: 'Position',
    category: C.SHUTTER,
    type: SHUTTER.POSITION,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    read: (attr) => toNumber(attr.value),
    command: (value) => ({
      capability: 'windowShadeLevel',
      command: 'setShadeLevel',
      arguments: [clampPercent(value)],
    }),
  },
  // --- Thermostat -------------------------------------------------------------
  {
    capability: 'thermostatMode',
    attribute: 'thermostatMode',
    code: FEATURE_CODES.THERMOSTAT_MODE,
    name: 'Mode',
    category: C.AIR_CONDITIONING,
    type: AIR_CONDITIONING.MODE,
    min: 0,
    max: 1,
    // Unknown / "off" modes have no AC_MODE counterpart: report no state.
    read: (attr) => {
      const mode = THERMOSTAT_MODE_TO_GLADYS[attr.value];
      return mode === undefined ? null : mode;
    },
    command: (value) => {
      const mode = GLADYS_TO_THERMOSTAT_MODE[value];
      return mode === undefined
        ? null
        : { capability: 'thermostatMode', command: 'setThermostatMode', arguments: [mode] };
    },
  },
  {
    capability: 'thermostatCoolingSetpoint',
    attribute: 'coolingSetpoint',
    code: FEATURE_CODES.COOLING_SETPOINT,
    name: 'Cooling setpoint',
    category: C.AIR_CONDITIONING,
    type: AIR_CONDITIONING.TARGET_TEMPERATURE,
    unit: U.CELSIUS,
    min: SETPOINT_BOUNDS.MIN,
    max: SETPOINT_BOUNDS.MAX,
    read: (attr) => toCelsius(attr.value, attr.unit),
    command: (value) => ({
      capability: 'thermostatCoolingSetpoint',
      command: 'setCoolingSetpoint',
      arguments: [toNumber(value)],
    }),
  },
  {
    capability: 'thermostatHeatingSetpoint',
    attribute: 'heatingSetpoint',
    code: FEATURE_CODES.HEATING_SETPOINT,
    name: 'Heating setpoint',
    category: C.THERMOSTAT,
    type: THERMOSTAT.TARGET_TEMPERATURE,
    unit: U.CELSIUS,
    min: SETPOINT_BOUNDS.MIN,
    max: SETPOINT_BOUNDS.MAX,
    read: (attr) => toCelsius(attr.value, attr.unit),
    command: (value) => ({
      capability: 'thermostatHeatingSetpoint',
      command: 'setHeatingSetpoint',
      arguments: [toNumber(value)],
    }),
  },
  // --- Read-only sensors ------------------------------------------------------
  {
    capability: 'temperatureMeasurement',
    attribute: 'temperature',
    code: FEATURE_CODES.TEMPERATURE,
    name: 'Temperature',
    category: C.TEMPERATURE_SENSOR,
    type: SENSOR.DECIMAL,
    unit: U.CELSIUS,
    min: TEMPERATURE_BOUNDS.MIN,
    max: TEMPERATURE_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toCelsius(attr.value, attr.unit),
  },
  {
    capability: 'relativeHumidityMeasurement',
    attribute: 'humidity',
    code: FEATURE_CODES.HUMIDITY,
    name: 'Humidity',
    category: C.HUMIDITY_SENSOR,
    type: SENSOR.DECIMAL,
    unit: U.PERCENT,
    min: PERCENT_BOUNDS.MIN,
    max: PERCENT_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
  {
    capability: 'contactSensor',
    attribute: 'contact',
    code: FEATURE_CODES.CONTACT,
    name: 'Opening',
    category: C.OPENING_SENSOR,
    type: SENSOR.BINARY,
    min: 0,
    max: 1,
    readOnly: true,
    keepHistory: true,
    read: (attr) => (attr.value === 'open' ? 1 : 0),
  },
  {
    capability: 'motionSensor',
    attribute: 'motion',
    code: FEATURE_CODES.MOTION,
    name: 'Motion',
    category: C.MOTION_SENSOR,
    type: SENSOR.BINARY,
    min: 0,
    max: 1,
    readOnly: true,
    keepHistory: true,
    read: (attr) => (attr.value === 'active' ? 1 : 0),
  },
  {
    capability: 'presenceSensor',
    attribute: 'presence',
    code: FEATURE_CODES.PRESENCE,
    name: 'Presence',
    category: C.PRESENCE_SENSOR,
    type: SENSOR.BINARY,
    min: 0,
    max: 1,
    readOnly: true,
    keepHistory: true,
    read: (attr) => (attr.value === 'present' ? 1 : 0),
  },
  {
    capability: 'waterSensor',
    attribute: 'water',
    code: FEATURE_CODES.WATER_LEAK,
    name: 'Water leak',
    category: C.LEAK_SENSOR,
    type: SENSOR.BINARY,
    min: 0,
    max: 1,
    readOnly: true,
    keepHistory: true,
    read: (attr) => (attr.value === 'wet' ? 1 : 0),
  },
  {
    capability: 'smokeDetector',
    attribute: 'smoke',
    code: FEATURE_CODES.SMOKE,
    name: 'Smoke',
    category: C.SMOKE_SENSOR,
    type: SENSOR.BINARY,
    min: 0,
    max: 1,
    readOnly: true,
    keepHistory: true,
    read: (attr) => (attr.value === 'detected' ? 1 : 0),
  },
  {
    capability: 'battery',
    attribute: 'battery',
    code: FEATURE_CODES.BATTERY,
    name: 'Battery',
    category: C.BATTERY,
    type: BATTERY.INTEGER,
    unit: U.PERCENT,
    min: BATTERY_BOUNDS.MIN,
    max: BATTERY_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
  {
    capability: 'powerMeter',
    attribute: 'power',
    code: FEATURE_CODES.POWER,
    name: 'Power',
    category: C.ENERGY_SENSOR,
    type: ENERGY_SENSOR.POWER,
    unit: U.WATT,
    min: POWER_BOUNDS.MIN,
    max: POWER_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
  {
    capability: 'voltageMeasurement',
    attribute: 'voltage',
    code: FEATURE_CODES.VOLTAGE,
    name: 'Voltage',
    category: C.ENERGY_SENSOR,
    type: ENERGY_SENSOR.VOLTAGE,
    unit: U.VOLT,
    min: VOLTAGE_BOUNDS.MIN,
    max: VOLTAGE_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
  // Samsung appliances report energy through `powerConsumptionReport`, whose
  // `powerConsumption` attribute is a NESTED object { energy (Wh), power (W),
  // deltaEnergy, ... } — not a scalar. Only the instantaneous power (W) is
  // exposed; the cumulative `energy` counter is intentionally NOT mapped (a
  // lifetime total is not actionable per-device — Gladys derives per-period
  // consumption from history when needed). Shares the POWER code with
  // powerMeter above; buildFeatures/buildStates de-duplicate by external id.
  {
    capability: 'powerConsumptionReport',
    attribute: 'powerConsumption',
    code: FEATURE_CODES.POWER,
    name: 'Power',
    category: C.ENERGY_SENSOR,
    type: ENERGY_SENSOR.POWER,
    unit: U.WATT,
    min: POWER_BOUNDS.MIN,
    max: POWER_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value && attr.value.power),
  },
  // Samsung child lock (samsungce.kidsLock), read-only.
  {
    capability: 'samsungce.kidsLock',
    attribute: 'lockState',
    code: FEATURE_CODES.CHILD_LOCK,
    name: 'Child lock',
    category: C.CHILD_LOCK,
    type: CHILD_LOCK.BINARY,
    min: 0,
    max: 1,
    readOnly: true,
    keepHistory: true,
    read: (attr) => (attr.value === 'locked' ? 1 : 0),
  },
  {
    capability: 'illuminanceMeasurement',
    attribute: 'illuminance',
    code: FEATURE_CODES.ILLUMINANCE,
    name: 'Illuminance',
    category: C.LIGHT_SENSOR,
    type: SENSOR.DECIMAL,
    unit: U.LUX,
    min: ILLUMINANCE_BOUNDS.MIN,
    max: ILLUMINANCE_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
  {
    capability: 'carbonDioxideMeasurement',
    attribute: 'carbonDioxide',
    code: FEATURE_CODES.CO2,
    name: 'CO2',
    category: C.CO2_SENSOR,
    type: SENSOR.INTEGER,
    unit: U.PPM,
    min: CO2_BOUNDS.MIN,
    max: CO2_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
  {
    capability: 'airQualitySensor',
    attribute: 'airQuality',
    code: FEATURE_CODES.AIR_QUALITY_INDEX,
    name: 'Air quality index',
    category: C.AIRQUALITY_SENSOR,
    type: DEVICE_FEATURE_TYPES.AIRQUALITY_SENSOR.AQI,
    unit: U.AQI,
    min: AIR_QUALITY_INDEX_BOUNDS.MIN,
    max: AIR_QUALITY_INDEX_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
  // dustSensor exposes coarse (dustLevel = PM10) and fine (fineDustLevel =
  // PM2.5) particulate matter, both in µg/m³ (matches Home Assistant).
  {
    capability: 'dustSensor',
    attribute: 'fineDustLevel',
    code: FEATURE_CODES.PM25,
    name: 'PM2.5',
    category: C.PM25_SENSOR,
    type: SENSOR.DECIMAL,
    unit: U.MICROGRAM_PER_CUBIC_METER,
    min: PM_BOUNDS.MIN,
    max: PM_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
  {
    capability: 'dustSensor',
    attribute: 'dustLevel',
    code: FEATURE_CODES.PM10,
    name: 'PM10',
    category: C.PM10_SENSOR,
    type: SENSOR.DECIMAL,
    unit: U.MICROGRAM_PER_CUBIC_METER,
    min: PM_BOUNDS.MIN,
    max: PM_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
  {
    capability: 'atmosphericPressureMeasurement',
    attribute: 'atmosphericPressure',
    code: FEATURE_CODES.PRESSURE,
    name: 'Atmospheric pressure',
    category: C.PRESSURE_SENSOR,
    type: SENSOR.DECIMAL,
    unit: U.HECTO_PASCAL,
    min: PRESSURE_BOUNDS.MIN,
    max: PRESSURE_BOUNDS.MAX,
    readOnly: true,
    keepHistory: true,
    read: (attr) => toNumber(attr.value),
  },
];

const FEATURES_BY_CODE = new Map(FEATURES.map((feature) => [feature.code, feature]));

/**
 * The "main" component of a SmartThings device (the one this integration maps).
 * @param {object} device a raw SmartThings device
 * @returns {object|undefined} the main component
 */
function getMainComponent(device) {
  return (device.components || []).find((component) => component.id === MAIN_COMPONENT);
}

/**
 * The set of capability ids advertised by the device's main component.
 * @param {object} device a raw SmartThings device
 * @returns {Set<string>} the capability ids
 */
export function getCapabilityIds(device) {
  const main = getMainComponent(device);
  return new Set((main ? main.capabilities || [] : []).map((capability) => capability.id));
}

/**
 * Whether a device should be mapped to the Gladys LIGHT category (a color / CT
 * bulb, or a component categorized as a light by SmartThings) rather than the
 * generic SWITCH category.
 * @param {object} device a raw SmartThings device
 * @returns {boolean}
 */
export function isLightDevice(device) {
  const capabilities = getCapabilityIds(device);
  if (LIGHT_CAPABILITIES.some((capability) => capabilities.has(capability))) {
    return true;
  }
  const main = getMainComponent(device);
  const categories = (main && main.categories) || [];
  return categories.some((category) => /light|bulb/i.test(category.name || ''));
}

/**
 * Resolve a descriptor field that may be a value or a `(ctx) => value` resolver.
 */
function resolve(field, ctx) {
  return typeof field === 'function' ? field(ctx) : field;
}

/**
 * Read the `{ value, unit }` attribute of a capability from a device status.
 * @param {object} status device status (`{ components: { main: {...} } }`)
 * @param {string} capability SmartThings capability id
 * @param {string} attribute SmartThings attribute name
 * @returns {object|undefined} the `{ value, unit }` object, or undefined
 */
function readAttribute(status, capability, attribute) {
  const main = (status && status.components && status.components[MAIN_COMPONENT]) || {};
  const cap = main[capability];
  if (!cap) {
    return undefined;
  }
  const attr = cap[attribute];
  return attr === undefined || attr === null ? undefined : attr;
}

/**
 * Build the Gladys features of a SmartThings device: one feature per supported
 * capability advertised by the device.
 * @param {object} ids external ids of the Gladys device (from gladys.externalIds()):
 *   `{ device, feature(featureKey) }`
 * @param {object} device a raw SmartThings device
 * @returns {Array} Gladys device features
 */
export function buildFeatures(ids, device) {
  const capabilities = getCapabilityIds(device);
  const ctx = { isLight: isLightDevice(device) };

  const seen = new Set();
  const features = [];
  FEATURES.filter((feature) => capabilities.has(feature.capability)).forEach((feature) => {
    const externalId = ids.feature(feature.code);
    // Two descriptors may share a code (e.g. powerMeter and
    // powerConsumptionReport both -> `power`): keep the first one only.
    if (seen.has(externalId)) {
      return;
    }
    seen.add(externalId);
    const built = {
      name: resolve(feature.name, ctx),
      external_id: externalId,
      // The feature selector is GLOBALLY unique in Gladys. Without an explicit
      // one, Gladys derives it from the name ("Power" -> "power"), which
      // collides across devices/integrations. Base it on the external_id
      // (already globally unique, built by the SDK ids.feature() helper):
      // Gladys slugifies it into e.g. "ext-<selector>-device-<id>-power".
      selector: externalId,
      read_only: feature.readOnly === true,
      has_feedback: feature.readOnly !== true,
      category: resolve(feature.category, ctx),
      type: resolve(feature.type, ctx),
    };
    if (feature.keepHistory) {
      built.keep_history = true;
    }
    if (feature.unit) {
      built.unit = resolve(feature.unit, ctx);
    }
    if (feature.min !== undefined) {
      built.min = feature.min;
    }
    if (feature.max !== undefined) {
      built.max = feature.max;
    }
    features.push(built);
  });
  return features;
}

/**
 * Build the Gladys states of a device from its status. States without a known
 * value are skipped.
 * @param {object} ids external ids of the Gladys device
 * @param {object} status device status
 * @returns {Array} states for gladys.publishStates()
 */
export function buildStates(ids, status) {
  const seen = new Set();
  const states = [];
  FEATURES.forEach((feature) => {
    const externalId = ids.feature(feature.code);
    // Mirror the buildFeatures de-duplication (shared codes): first wins.
    if (seen.has(externalId)) {
      return;
    }
    const attr = readAttribute(status, feature.capability, feature.attribute);
    if (attr === undefined) {
      return;
    }
    const state = feature.read(attr);
    if (state === null || state === undefined) {
      return;
    }
    seen.add(externalId);
    states.push({ device_feature_external_id: externalId, state });
  });
  return states;
}

/**
 * Build the SmartThings command for a Gladys write. Returns null when the
 * feature is unknown or not controllable.
 * @param {string} code last segment of the feature external id
 * @param {number} value value sent by Gladys
 * @returns {object|null} `{ capability, command, arguments }`
 */
export function buildCommand(code, value) {
  const feature = FEATURES_BY_CODE.get(code);
  if (!feature || typeof feature.command !== 'function') {
    return null;
  }
  return feature.command(value);
}
