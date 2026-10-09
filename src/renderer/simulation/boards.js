// Simulated boards. Pin tables follow the Arduino AVR core's pins_arduino.h
// (variants/standard, eightanaloginputs and mega).
//
// Every board numbers its pins like the Arduino core does: digital pins first,
// then A0.. as digital pins (Uno A0 = 14, Mega A0 = 54). Pins that exist only
// as analog inputs (Nano A6/A7) get numbers after the last digital pin and no
// port.

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

function pin(n, port, bit, extra = {}) {
  return { pin: n, port, bit, ...extra };
}

// ── ATmega328P boards ───────────────────────────────────────────────────────

const PINS_328P = [
  ...range(0, 7).map(n => pin(n, 'D', n)),
  ...range(8, 13).map(n => pin(n, 'B', n - 8)),
  ...range(0, 5).map(i => pin(14 + i, 'C', i, { adc: i, analog: `A${i}` })),
];
const PWM_328P = [3, 5, 6, 9, 10, 11];

// ── ATmega2560 (Mega) ───────────────────────────────────────────────────────

const MEGA_PORTS = [
  'E0', 'E1', 'E4', 'E5', 'G5', 'E3', 'H3', 'H4', 'H5', 'H6', 'B4', 'B5', 'B6', 'B7', // 0-13
  'J1', 'J0', 'H1', 'H0', 'D3', 'D2', 'D1', 'D0', // 14-21
  'A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', // 22-29
  'C7', 'C6', 'C5', 'C4', 'C3', 'C2', 'C1', 'C0', // 30-37
  'D7', 'G2', 'G1', 'G0', // 38-41
  'L7', 'L6', 'L5', 'L4', 'L3', 'L2', 'L1', 'L0', // 42-49
  'B3', 'B2', 'B1', 'B0', // 50-53
  'F0', 'F1', 'F2', 'F3', 'F4', 'F5', 'F6', 'F7', // 54-61 = A0-A7
  'K0', 'K1', 'K2', 'K3', 'K4', 'K5', 'K6', 'K7', // 62-69 = A8-A15
];
const PINS_2560 = MEGA_PORTS.map((pb, n) => pin(n, pb[0], Number(pb[1]),
  n >= 54 ? { adc: n - 54, analog: `A${n - 54}` } : {}));

/**
 * @typedef {object} BoardProfile
 * @property {string} id
 * @property {string} label
 * @property {string} tag           @wokwi/elements tag
 * @property {string} fqbn          used to compile for the simulator
 * @property {string} mcu           key into MCUS
 * @property {object[]} pins        { pin, port, bit, adc?, analog? }
 * @property {number[]} pwm
 * @property {number} ledBuiltin
 */

export const BOARDS = {
  uno: {
    id: 'uno',
    label: 'Arduino Uno',
    short: 'Uno',
    tag: 'wokwi-arduino-uno',
    fqbn: 'arduino:avr:uno',
    mcu: 'atmega328p',
    pins: PINS_328P,
    pwm: PWM_328P,
    ledBuiltin: 13,
    i2c: { sda: 18, scl: 19 },
    spi: { ss: 10, mosi: 11, miso: 12, sck: 13 },
    serial: [{ rx: 0, tx: 1 }],
    interrupts: [2, 3],
    aliases: { 'A4.2': 'A4', 'A5.2': 'A5' },
    description: 'ATmega328P · 14 digital pins · 6 analog inputs',
  },
  nano: {
    id: 'nano',
    label: 'Arduino Nano',
    short: 'Nano',
    tag: 'wokwi-arduino-nano',
    fqbn: 'arduino:avr:nano',
    mcu: 'atmega328p',
    pins: [...PINS_328P, { pin: 20, adc: 6, analog: 'A6' }, { pin: 21, adc: 7, analog: 'A7' }],
    pwm: PWM_328P,
    ledBuiltin: 13,
    i2c: { sda: 18, scl: 19 },
    spi: { ss: 10, mosi: 11, miso: 12, sck: 13 },
    serial: [{ rx: 0, tx: 1 }],
    interrupts: [2, 3],
    aliases: { '11.2': '11', '12.2': '12', '13.2': '13' },
    description: 'ATmega328P · 14 digital pins · 8 analog inputs · breadboard friendly',
  },
  mega: {
    id: 'mega',
    label: 'Arduino Mega 2560',
    short: 'Mega 2560',
    tag: 'wokwi-arduino-mega',
    fqbn: 'arduino:avr:mega:cpu=atmega2560',
    mcu: 'atmega2560',
    pins: PINS_2560,
    pwm: [...range(2, 13), 44, 45, 46],
    ledBuiltin: 13,
    i2c: { sda: 20, scl: 21 },
    spi: { ss: 53, mosi: 51, miso: 50, sck: 52 },
    serial: [{ rx: 0, tx: 1 }, { rx: 19, tx: 18 }, { rx: 17, tx: 16 }, { rx: 15, tx: 14 }],
    interrupts: [2, 3, 18, 19, 20, 21],
    aliases: { SDA: '20', SCL: '21' },
    description: 'ATmega2560 · 54 digital pins · 16 analog inputs · 4 serial ports',
  },
};

export const BOARD_ORDER = ['uno', 'nano', 'mega'];
export const DEFAULT_BOARD = 'uno';

for (const board of Object.values(BOARDS)) {
  board.byPin = new Map(board.pins.map(p => [p.pin, p]));
  board.byAnalog = new Map(board.pins.filter(p => p.analog).map(p => [p.analog, p]));
  board.pinCount = Math.max(...board.pins.map(p => p.pin)) + 1;
  board.digitalCount = board.pins.filter(p => p.port && !p.analog).length;
  board.pwmSet = new Set(board.pwm);
}

export function boardById(id) {
  return BOARDS[id] || BOARDS[DEFAULT_BOARD];
}

export function boardByTag(tag) {
  return Object.values(BOARDS).find(b => b.tag === tag) || null;
}

export function isBoardTag(tag) {
  return !!boardByTag(tag);
}

/** The simulated board an FQBN compiles for, or null when it can't be simulated. */
export function boardForFqbn(fqbn) {
  if (!fqbn) return null;
  if (/^arduino:avr:mega(:|$)/.test(fqbn)) return /cpu=atmega1280/.test(fqbn) ? null : BOARDS.mega;
  if (/^arduino:avr:(nano|pro|mini|fio|bt|lilypad)(:|$)/.test(fqbn)) {
    return /cpu=atmega168|cpu=atmega8\b/.test(fqbn) ? null : BOARDS.nano;
  }
  if (/^arduino:avr:(uno|unomini|ethernet|duemilanove|diecimila)(:|$)/.test(fqbn)) return BOARDS.uno;
  return null;
}

/**
 * Board header pin name → Arduino pin number. Returns null for power, ground,
 * reset and unknown names.
 */
export function boardPinNumber(board, name) {
  if (!board || name == null) return null;
  let key = String(name);
  if (board.aliases && key in board.aliases) key = board.aliases[key];
  if (/^\d+$/.test(key)) {
    const n = Number(key);
    const entry = board.byPin.get(n);
    return entry && entry.port && !entry.analog ? n : null;
  }
  const analog = board.byAnalog.get(key);
  return analog ? analog.pin : null;
}

/** Electrical role of a board header pin that isn't an I/O pin. */
const POWER_PINS = {
  GND: { kind: 'gnd', volts: 0 },
  '5V': { kind: 'vcc', volts: 5 },
  IOREF: { kind: 'vcc', volts: 5 },
  VIN: { kind: 'vcc', volts: 5 },
  '3.3V': { kind: 'vcc', volts: 3.3 },
  RESET: { kind: 'reset' },
};

/** Header pin name without its duplicate suffix: "GND.2" → "GND". */
export const basePinName = (name) => String(name).replace(/\.\d+$/, '');

export function boardPowerPin(name) {
  const role = POWER_PINS[basePinName(name)];
  return role ? { ...role } : null;
}

/** "D13" / "A0" for an Arduino pin number. */
export function pinLabel(board, n) {
  const entry = board?.byPin.get(n);
  if (entry?.analog) return entry.analog;
  return `D${n}`;
}

/**
 * Parse a pin reference written in a sketch or a test: 13, D13, A0, LED_BUILTIN.
 * @returns {number|null}
 */
export function parseBoardPin(board, ref) {
  const s = String(ref).trim().toUpperCase();
  if (s === 'LED_BUILTIN') return board.ledBuiltin;
  if (s === 'SDA') return board.i2c.sda;
  if (s === 'SCL') return board.i2c.scl;
  if (s === 'MOSI') return board.spi.mosi;
  if (s === 'MISO') return board.spi.miso;
  if (s === 'SCK') return board.spi.sck;
  if (s === 'SS') return board.spi.ss;
  let m = /^D?(\d{1,2})$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return board.byPin.has(n) ? n : null;
  }
  m = /^A(\d{1,2})$/.exec(s);
  if (m) return board.byAnalog.get(`A${Number(m[1])}`)?.pin ?? null;
  return null;
}
