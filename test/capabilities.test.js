// Unit tests for the SmartThings capability <-> Gladys feature mapping.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCommand,
  buildFeatures,
  buildStates,
  getCapabilityIds,
  isLightDevice,
} from '../src/devices/capabilities.js';
import { AC_MODE, FEATURE_CODES } from '../src/constants.js';
import {
  BULB_DEVICE,
  BULB_STATUS,
  SENSOR_DEVICE,
  SENSOR_STATUS,
  PLUG_DEVICE,
  WASHER_DEVICE,
  WASHER_STATUS,
} from './fixtures.js';

// Minimal external-ids helper mirroring gladys.externalIds().
const idsFor = (deviceId) => ({
  device: `ext:test:device:${deviceId}`,
  feature: (code) => `ext:test:device:${deviceId}:${code}`,
});

test('getCapabilityIds reads the main component capabilities', () => {
  const capabilities = getCapabilityIds(BULB_DEVICE);
  assert.ok(capabilities.has('switch'));
  assert.ok(capabilities.has('colorControl'));
  assert.equal(capabilities.has('lock'), false);
});

test('isLightDevice detects a bulb via color capabilities', () => {
  assert.equal(isLightDevice(BULB_DEVICE), true);
  assert.equal(isLightDevice(PLUG_DEVICE), false);
  assert.equal(isLightDevice(SENSOR_DEVICE), false);
});

test('buildFeatures maps a bulb to the LIGHT category', () => {
  const features = buildFeatures(idsFor('bulb-1'), BULB_DEVICE);
  assert.deepEqual(
    features.map((f) => f.external_id.split(':').pop()),
    [
      FEATURE_CODES.SWITCH,
      FEATURE_CODES.BRIGHTNESS,
      FEATURE_CODES.HUE,
      FEATURE_CODES.SATURATION,
      FEATURE_CODES.COLOR_TEMPERATURE,
    ],
  );
  const power = features.find((f) => f.external_id.endsWith(`:${FEATURE_CODES.SWITCH}`));
  assert.equal(power.category, 'light');
  assert.equal(power.type, 'binary');
  assert.equal(power.read_only, false);
  assert.equal(power.has_feedback, true);

  const brightness = features.find((f) => f.external_id.endsWith(`:${FEATURE_CODES.BRIGHTNESS}`));
  assert.equal(brightness.category, 'light');
  assert.equal(brightness.type, 'brightness');
});

test('buildFeatures maps a plug switch to the SWITCH category and read-only meters', () => {
  const features = buildFeatures(idsFor('plug-1'), PLUG_DEVICE);
  const power = features.find((f) => f.external_id.endsWith(`:${FEATURE_CODES.SWITCH}`));
  assert.equal(power.category, 'switch');
  assert.equal(power.type, 'binary');

  const powerMeter = features.find((f) => f.external_id.endsWith(`:${FEATURE_CODES.POWER}`));
  assert.equal(powerMeter.category, 'energy-sensor');
  assert.equal(powerMeter.type, 'power');
  assert.equal(powerMeter.read_only, true);
  assert.equal(powerMeter.keep_history, true);
});

test('buildFeatures skips a device with no supported capability', () => {
  const features = buildFeatures(idsFor('hub-1'), {
    deviceId: 'hub-1',
    components: [{ id: 'main', capabilities: [{ id: 'bridge' }] }],
  });
  assert.equal(features.length, 0);
});

test('buildStates reads a bulb status', () => {
  const states = buildStates(idsFor('bulb-1'), BULB_STATUS);
  assert.deepEqual(states, [
    { device_feature_external_id: 'ext:test:device:bulb-1:switch', state: 1 },
    { device_feature_external_id: 'ext:test:device:bulb-1:brightness', state: 80 },
    { device_feature_external_id: 'ext:test:device:bulb-1:hue', state: 30 },
    { device_feature_external_id: 'ext:test:device:bulb-1:saturation', state: 60 },
    { device_feature_external_id: 'ext:test:device:bulb-1:color-temperature', state: 2700 },
  ]);
});

test('buildStates converts a Fahrenheit temperature to Celsius', () => {
  const states = buildStates(idsFor('sensor-1'), SENSOR_STATUS);
  const temperature = states.find((s) => s.device_feature_external_id.endsWith(':temperature'));
  assert.equal(temperature.state, 21.1); // 70°F -> 21.1°C
  const contact = states.find((s) => s.device_feature_external_id.endsWith(':contact'));
  assert.equal(contact.state, 1); // open
});

test('a Samsung washer maps switch + powerConsumptionReport power (nested) + child lock', () => {
  const ids = idsFor('washer-1');
  const features = buildFeatures(ids, WASHER_DEVICE);
  // The cumulative `energy` sub-field is intentionally not exposed: only the
  // instantaneous power is mapped from powerConsumptionReport.
  assert.deepEqual(
    features.map((f) => f.external_id.split(':').pop()),
    [FEATURE_CODES.SWITCH, FEATURE_CODES.POWER, FEATURE_CODES.CHILD_LOCK],
  );
  // A washer is not a light: the switch stays in the SWITCH category.
  assert.equal(features[0].category, 'switch');

  // Each feature carries an explicit selector based on its globally-unique
  // external_id (not the human name), so two features named "Power" cannot
  // collide on the global t_device_feature.selector constraint.
  const selectors = features.map((f) => f.selector);
  assert.deepEqual(
    selectors,
    features.map((f) => f.external_id),
  );
  assert.equal(new Set(selectors).size, selectors.length, 'selectors are unique');

  const states = buildStates(ids, WASHER_STATUS);
  const power = states.find((s) => s.device_feature_external_id.endsWith(':power'));
  assert.equal(power.state, 12); // W, read from the nested powerConsumption object
  // No cumulative energy feature is published.
  assert.equal(
    states.some((s) => s.device_feature_external_id.endsWith(':energy')),
    false,
  );
  const childLock = states.find((s) => s.device_feature_external_id.endsWith(':child-lock'));
  assert.equal(childLock.state, 0); // unlocked
});

test('an air-quality device maps dust (PM2.5/PM10) and atmospheric pressure', () => {
  const ids = idsFor('air-1');
  const device = {
    deviceId: 'air-1',
    label: 'Air monitor',
    components: [
      {
        id: 'main',
        capabilities: [
          { id: 'dustSensor' },
          { id: 'atmosphericPressureMeasurement' },
          { id: 'carbonDioxideMeasurement' },
        ],
      },
    ],
  };
  const status = {
    components: {
      main: {
        dustSensor: { fineDustLevel: { value: 12, unit: 'μg/m^3' }, dustLevel: { value: 20 } },
        atmosphericPressureMeasurement: { atmosphericPressure: { value: 1013, unit: 'hPa' } },
        carbonDioxideMeasurement: { carbonDioxide: { value: 640, unit: 'ppm' } },
      },
    },
  };
  const codes = buildFeatures(ids, device).map((f) => f.external_id.split(':').pop());
  assert.deepEqual(codes, [FEATURE_CODES.CO2, FEATURE_CODES.PM25, FEATURE_CODES.PM10, 'pressure']);

  const states = buildStates(ids, status);
  const byCode = Object.fromEntries(
    states.map((s) => [s.device_feature_external_id.split(':').pop(), s.state]),
  );
  assert.equal(byCode.pm25, 12);
  assert.equal(byCode.pm10, 20);
  assert.equal(byCode.pressure, 1013);
  assert.equal(byCode.co2, 640);
});

test('buildStates skips capabilities absent from the status', () => {
  const states = buildStates(idsFor('bulb-1'), {
    components: { main: { switch: { switch: { value: 'off' } } } },
  });
  assert.deepEqual(states, [
    { device_feature_external_id: 'ext:test:device:bulb-1:switch', state: 0 },
  ]);
});

test('buildCommand maps controllable features to SmartThings commands', () => {
  assert.deepEqual(buildCommand(FEATURE_CODES.SWITCH, 1), {
    capability: 'switch',
    command: 'on',
    arguments: [],
  });
  assert.deepEqual(buildCommand(FEATURE_CODES.SWITCH, 0), {
    capability: 'switch',
    command: 'off',
    arguments: [],
  });
  assert.deepEqual(buildCommand(FEATURE_CODES.BRIGHTNESS, 55), {
    capability: 'switchLevel',
    command: 'setLevel',
    arguments: [55],
  });
  assert.deepEqual(buildCommand(FEATURE_CODES.LOCK, 1), {
    capability: 'lock',
    command: 'lock',
    arguments: [],
  });
  assert.deepEqual(buildCommand(FEATURE_CODES.THERMOSTAT_MODE, AC_MODE.COOLING), {
    capability: 'thermostatMode',
    command: 'setThermostatMode',
    arguments: ['cool'],
  });
});

test('buildCommand clamps a brightness out of range', () => {
  assert.deepEqual(buildCommand(FEATURE_CODES.BRIGHTNESS, 150).arguments, [100]);
  assert.deepEqual(buildCommand(FEATURE_CODES.BRIGHTNESS, -10).arguments, [0]);
});

test('buildCommand returns null for a read-only or unknown feature', () => {
  assert.equal(buildCommand(FEATURE_CODES.TEMPERATURE, 20), null);
  assert.equal(buildCommand('does-not-exist', 1), null);
});
