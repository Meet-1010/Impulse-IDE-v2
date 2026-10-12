// Simulated boards. Pin tables follow the Arduino AVR core's pins_arduino.h
// (variants/standard, eightanaloginputs and mega), for the Raspberry Pi Pico
// the Arduino-Pico core (variants/rpipico), and for the ATtiny85 ATTinyCore
// (variants/tinyX5).
//
// Every board numbers its pins like the Arduino core does: digital pins first,
// then A0.. as digital pins (Uno A0 = 14, Mega A0 = 54). Pins that exist only
// as analog inputs (Nano A6/A7) get numbers after the last digital pin and no
// port. On the Pico a pin number is its GPIO number (A0 = GP26), and on the
// ATtiny85 its PORTB bit (A1 = PB2).
//
// Electrical levels per board: logicVolts (an output HIGH), threshold (an
// input reads HIGH from here), pull-up/down resistance, ADC reference, and the
// most a pin may see (maxPinVolts).

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

// ── RP2040 (Raspberry Pi Pico) ──────────────────────────────────────────────

// GP0–GP22 and GP26–GP28 reach the header; GP25 is the LED.
const PICO_GPIO = [...range(0, 22), 25, 26, 27, 28];
const PINS_PICO = PICO_GPIO.map(n => pin(n, 'GPIO', n, n >= 26 ? { adc: n - 26, analog: `A${n - 26}` } : {}));
const PICO_ALIASES = Object.fromEntries(PICO_GPIO.map(n => [`GP${n}`, n >= 26 ? `A${n - 26}` : String(n)]));

// ── ATtiny85 ────────────────────────────────────────────────────────────────

// PB0–PB5 are pins 0–5. Analog inputs follow the ADC channels, not the pins:
// A0 = PB5, A1 = PB2, A2 = PB4, A3 = PB3 (ATTinyCore's analogInputToDigitalPin).
const TINY85_ADC = { 5: 0, 2: 1, 4: 2, 3: 3 };
const PINS_TINY85 = range(0, 5).map(n => pin(n, 'B', n, n in TINY85_ADC ? { adc: TINY85_ADC[n], analog: `A${TINY85_ADC[n]}` } : {}));
const TINY85_ALIASES = Object.fromEntries(range(0, 5).map(n => [`PB${n}`, String(n)]));

const AVR_LEVELS = { logicVolts: 5, threshold: 2.5, pullupOhms: 35000, pulldownOhms: null, adcRef: 5, maxPinVolts: 5 };

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
    ...AVR_LEVELS,
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
    ...AVR_LEVELS,
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
    ...AVR_LEVELS,
  },
  pico: {
    id: 'pico',
    label: 'Raspberry Pi Pico',
    short: 'Pico',
    tag: 'impulse-pi-pico',
    fqbn: 'rp2040:rp2040:rpipico',
    mcu: 'rp2040',
    family: 'rp2040',
    pins: PINS_PICO,
    pwm: PICO_GPIO,
    ledBuiltin: 25,
    i2c: { sda: 4, scl: 5 },
    spi: { miso: 16, ss: 17, sck: 18, mosi: 19 },
    // Serial is the USB port; Serial1 and Serial2 are UART0 and UART1.
    serial: [null, { tx: 0, rx: 1 }, { tx: 8, rx: 9 }],
    interrupts: PICO_GPIO,
    aliases: PICO_ALIASES,
    pinPrefix: 'GP',
    description: 'RP2040 · dual Cortex-M0+ at up to 200 MHz · 26 GPIO · 3 analog inputs · 3.3 V logic',
    logicVolts: 3.3,
    threshold: 1.65,
    pullupOhms: 50000,
    pulldownOhms: 50000,
    adcRef: 3.3,
    maxPinVolts: 3.3,
  },
  attiny85: {
    id: 'attiny85',
    label: 'ATtiny85',
    short: 'ATtiny85',
    tag: 'impulse-attiny85',
    // ATTinyCore at 16 MHz from the internal PLL: the simulator's clock.
    fqbn: 'ATTinyCore:avr:attinyx5:chip=85,clock=16pll',
    mcu: 'attiny85',
    core: 'attiny',
    pins: PINS_TINY85,
    pwm: [0, 1, 4],
    ledBuiltin: 1,
    // USI: SDA/DI on PB0, SCL/USCK on PB2, DO on PB1 (pins_arduino.h).
    i2c: { sda: 0, scl: 2 },
    spi: { ss: 3, mosi: 1, miso: 0, sck: 2 },
    // The USI clocks SPI out on the pins, so parts read it bit by bit.
    spiByPins: true,
    // Serial is TinySoftwareSerial: TX on AIN0 (PB0), RX on AIN1 (PB1).
    serial: [{ tx: 0, rx: 1 }],
    softSerial: { tx: 0, rx: 1 },
    interrupts: [2],
    aliases: TINY85_ALIASES,
    pinPrefix: 'PB',
    resetPin: 5,
    description: 'ATtiny85 · 8 KB flash · 6 I/O pins · 4 analog inputs · ATTinyCore',
    ...AVR_LEVELS,
  },
};

export const BOARD_ORDER = ['uno', 'nano', 'mega', 'pico', 'attiny85'];
export const DEFAULT_BOARD = 'uno';

/** Which boards run, for messages: every board built on an emulated chip. */
export function simulatedBoardsText() {
  return 'boards built on the ATmega328P or 168 (Uno, Nano, Pro Mini…), the ATmega2560 or 1280 (Mega), the ATtiny25/45/85 and the RP2040 (Pico, XIAO, Feather…)';
}

for (const board of Object.values(BOARDS)) {
  board.byPin = new Map(board.pins.map(p => [p.pin, p]));
  board.byAnalog = new Map(board.pins.filter(p => p.analog).map(p => [p.analog, p]));
  board.pinCount = Math.max(...board.pins.map(p => p.pin)) + 1;
  board.digitalCount = board.pins.filter(p => p.port && (board.pinPrefix || !p.analog)).length;
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

// Arduino-Pico 6.3 boards built on the RP2350 (Cortex-M33), which isn't
// emulated, whose ids don't all say so. The Pico W is left out too: its LED
// is on the Wi-Fi chip. An unknown RP2350 board is refused at load time
// (its UF2 isn't an RP2040 image), so a new one fails loudly, not silently.
const RP2350_BOARDS = new Set([
  'adafruit_fruitjam', 'cytron_iriv_io_controller', 'datanoisetv_picoadk_v2', 'jumperless_v5',
  'olimex_pico2bb48', 'olimex_pico2xl', 'olimex_pico2xxl', 'pimoroni_explorer', 'pimoroni_pico_plus_2',
  'pimoroni_pico_plus_2w', 'rpipico2', 'rpipico2w', 'sparkfun_xrp_controller', 'wiznet_5100s_evb_pico2',
  'wiznet_5500_evb_pico2', 'wiznet_6300_evb_pico2',
]);

/**
 * How a board from the board menu is simulated: which drawn board it runs on,
 * the FQBN the simulator compiles with, and the chip it emulates. Every board
 * built on an emulated chip runs: the ATmega328P/168 family (Uno, Nano, Pro,
 * Mini, Fio, LilyPad, Ethernet, Duemilanove…), the ATmega2560/1280 (Mega, Mega
 * ADK), ATTinyCore's ATtiny25/45/85, and the RP2040 boards of the Arduino-Pico
 * core (pins are GPIO numbers on all of them, so they're wired on the Pico).
 * @returns {null | { board: object, fqbn: string, mcu: string, note?: string }}
 */
export function simulationTarget(fqbn) {
  if (!fqbn) return null;
  const opt = (name) => new RegExp(`(?:^|[:,])${name}=([^,:]+)`).exec(fqbn)?.[1] || '';
  const as = (board, extra = {}) => ({ board, fqbn: board.fqbn, mcu: board.mcu, ...extra });
  // Clock-for-clock: the simulator runs at 16 MHz, so slower variants compile as their 16 MHz twin.
  const atmega168 = (board, drawn) => as(board, { fqbn: 'arduino:avr:diecimila:cpu=atmega168', mcu: 'atmega168', note: `runs on an emulated ATmega168, drawn as the ${drawn}` });

  if (/^arduino:avr:(mega|megaADK)(:|$)/.test(fqbn)) {
    return opt('cpu') === 'atmega1280'
      ? as(BOARDS.mega, { fqbn: 'arduino:avr:mega:cpu=atmega1280', mcu: 'atmega1280', note: 'runs on an emulated ATmega1280, drawn as the Mega 2560' })
      : as(BOARDS.mega);
  }
  if (/^arduino:avr:(nano|pro|mini|fio|bt|lilypad)(:|$)/.test(fqbn)) {
    const cpu = opt('cpu');
    if (/atmega8\b|^atmega8$/.test(cpu)) return null; // the ATmega8 has its own register map
    return /atmega168/.test(cpu) ? atmega168(BOARDS.nano, 'Nano') : as(BOARDS.nano);
  }
  if (/^arduino:avr:(uno|unomini|ethernet|duemilanove|diecimila)(:|$)/.test(fqbn)) {
    return /atmega168/.test(opt('cpu')) ? atmega168(BOARDS.uno, 'Uno') : as(BOARDS.uno);
  }
  // ATTinyCore's ATtiny25/45/85 share the chip; the smaller ones have less flash and RAM.
  if (/^ATTinyCore:avr:attinyx5(micr)?(:|$)/.test(fqbn)) {
    const chip = opt('chip') || '85';
    if (chip === '85') return as(BOARDS.attiny85);
    if (chip !== '45' && chip !== '25') return null;
    return as(BOARDS.attiny85, { fqbn: `ATTinyCore:avr:attinyx5:chip=${chip},clock=16pll`, mcu: `attiny${chip}`, note: `runs on an emulated ATtiny${chip}, drawn as the ATtiny85` });
  }
  const rp = /^rp2040:rp2040:([^:]+)/.exec(fqbn);
  if (rp) {
    const id = rp[1];
    if (id === 'rpipico') return as(BOARDS.pico);
    if (RP2350_BOARDS.has(id) || /2350/.test(id) || id === 'rpipicow') return null;
    return as(BOARDS.pico, { fqbn: `rp2040:rp2040:${id}`, note: 'runs on the emulated RP2040, drawn as a Raspberry Pi Pico: wire by GPIO number (GP0–GP28)' });
  }
  return null;
}

/** The simulated board an FQBN compiles for, or null when it can't be simulated. */
export function boardForFqbn(fqbn) {
  return simulationTarget(fqbn)?.board ?? null;
}

/**
 * What to compile and emulate for a drawn board: the upload board's own target
 * when it runs on this board (a Pro Mini 168 on the Nano), else the board itself.
 */
export function compileTarget(board, uploadFqbn) {
  const target = simulationTarget(uploadFqbn);
  if (target && target.board.id === board.id) return target;
  return { board, fqbn: board.fqbn, mcu: board.mcu };
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
    return entry && entry.port && (board.pinPrefix || !entry.analog) ? n : null;
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
  // Raspberry Pi Pico
  '3V3': { kind: 'vcc', volts: 3.3 },
  ADC_VREF: { kind: 'vcc', volts: 3.3 },
  VBUS: { kind: 'vcc', volts: 5 },
  VSYS: { kind: 'vcc', volts: 5 },
  AGND: { kind: 'gnd', volts: 0 },
  RUN: { kind: 'reset' },
  // Bare chips (ATtiny85)
  VCC: { kind: 'vcc', volts: 5 },
};

/** Header pin name without its duplicate suffix: "GND.2" → "GND". */
export const basePinName = (name) => String(name).replace(/\.\d+$/, '');

export function boardPowerPin(name) {
  const role = POWER_PINS[basePinName(name)];
  return role ? { ...role } : null;
}

/** "D13" / "A0" for an Arduino pin number. */
export function pinLabel(board, n) {
  if (board?.pinPrefix) return `${board.pinPrefix}${n}`;
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
  let m = board.pinPrefix ? new RegExp(`^${board.pinPrefix}(\\d{1,2})$`).exec(s) : null;
  if (m) {
    const n = Number(m[1]);
    return board.byPin.has(n) ? n : null;
  }
  m = /^D?(\d{1,2})$/.exec(s);
  if (m) {
    const n = Number(m[1]);
    return board.byPin.has(n) ? n : null;
  }
  m = /^A(\d{1,2})$/.exec(s);
  if (m) return board.byAnalog.get(`A${Number(m[1])}`)?.pin ?? null;
  return null;
}
