// Shared SmartThings API fixtures (shapes taken from the SmartThings Cloud API:
// GET /devices returns `{ items: [...] }`; each device has components ->
// capabilities; GET /devices/{id}/status returns
// `{ components: { main: { <capability>: { <attribute>: { value, unit } } } } }`.
// Temperatures carry a unit ('C' | 'F')).

// A dimmable color bulb: switch + level + color + color temperature. Its main
// component is categorized as a Light, so it maps to the Gladys LIGHT category.
export const BULB_DEVICE = {
  deviceId: 'bulb-1',
  name: 'c2c-rgbw-color-bulb',
  label: 'Living room lamp',
  deviceManufacturerCode: 'Samsung',
  components: [
    {
      id: 'main',
      capabilities: [
        { id: 'switch', version: 1 },
        { id: 'switchLevel', version: 1 },
        { id: 'colorControl', version: 1 },
        { id: 'colorTemperature', version: 1 },
      ],
      categories: [{ name: 'Light', categoryType: 'manufacturer' }],
    },
  ],
};

// A multipurpose contact sensor: contact + temperature (in Fahrenheit) + battery.
export const SENSOR_DEVICE = {
  deviceId: 'sensor-1',
  name: 'multipurpose-sensor',
  label: 'Front door',
  components: [
    {
      id: 'main',
      capabilities: [
        { id: 'contactSensor', version: 1 },
        { id: 'temperatureMeasurement', version: 1 },
        { id: 'battery', version: 1 },
      ],
      categories: [{ name: 'ContactSensor', categoryType: 'manufacturer' }],
    },
  ],
};

// A metering smart plug: switch + power + energy.
export const PLUG_DEVICE = {
  deviceId: 'plug-1',
  name: 'smart-plug',
  label: 'Washing machine',
  components: [
    {
      id: 'main',
      capabilities: [
        { id: 'switch', version: 1 },
        { id: 'powerMeter', version: 1 },
        { id: 'energyMeter', version: 1 },
      ],
      categories: [{ name: 'SmartPlug', categoryType: 'manufacturer' }],
    },
  ],
};

// A hub: only unsupported capabilities -> not published as a Gladys device.
export const HUB_DEVICE = {
  deviceId: 'hub-1',
  name: 'hub',
  label: 'Home hub',
  components: [{ id: 'main', capabilities: [{ id: 'bridge', version: 1 }] }],
};

// GET /devices
export const DEVICES_RESPONSE = {
  items: [BULB_DEVICE, SENSOR_DEVICE, PLUG_DEVICE, HUB_DEVICE],
};

// GET /devices/bulb-1/status
export const BULB_STATUS = {
  components: {
    main: {
      switch: { switch: { value: 'on' } },
      switchLevel: { level: { value: 80, unit: '%' } },
      colorControl: { hue: { value: 30 }, saturation: { value: 60 } },
      colorTemperature: { colorTemperature: { value: 2700, unit: 'K' } },
    },
  },
};

// GET /devices/sensor-1/status : temperature delivered in Fahrenheit.
export const SENSOR_STATUS = {
  components: {
    main: {
      contactSensor: { contact: { value: 'open' } },
      temperatureMeasurement: { temperature: { value: 70, unit: 'F' } },
      battery: { battery: { value: 95, unit: '%' } },
    },
  },
};

// A Samsung washing machine (real-world shape): exposes `switch` and the
// Samsung `powerConsumptionReport` capability (nested energy object).
export const WASHER_DEVICE = {
  deviceId: 'washer-1',
  name: 'Samsung Washer',
  label: 'Lave-linge',
  components: [
    {
      id: 'main',
      capabilities: [
        { id: 'switch', version: 1 },
        { id: 'powerConsumptionReport', version: 1 },
        { id: 'samsungce.kidsLock', version: 1 },
        { id: 'washerOperatingState', version: 1 },
      ],
      categories: [{ name: 'Washer', categoryType: 'manufacturer' }],
    },
  ],
};

// GET /devices/washer-1/status : powerConsumption is a NESTED object, energy in
// Wh (real payload shape from the SmartThings API).
export const WASHER_STATUS = {
  components: {
    main: {
      switch: { switch: { value: 'off' } },
      powerConsumptionReport: {
        powerConsumption: {
          value: { energy: 482600, deltaEnergy: 0, power: 12, powerEnergy: 0, start: '', end: '' },
        },
      },
      'samsungce.kidsLock': { lockState: { value: 'unlocked' } },
    },
  },
};

// GET /devices/plug-1/status
export const PLUG_STATUS = {
  components: {
    main: {
      switch: { switch: { value: 'off' } },
      powerMeter: { power: { value: 1200, unit: 'W' } },
      energyMeter: { energy: { value: 3.5, unit: 'kWh' } },
    },
  },
};
