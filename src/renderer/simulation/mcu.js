// Microcontroller definitions for the AVR simulator.
//
// avr8js ships ATmega328P configs; the ATmega2560 ones below follow
// avr/iomxx0_1.h from avr-libc. Interrupt vectors are word addresses:
// avr-libc's _VECTOR(n) lives at n * 2.

import {
  INT0, INT1, PCINT0, PCINT1, PCINT2,
  portAConfig, portBConfig, portCConfig, portDConfig, portEConfig, portFConfig,
  portGConfig, portHConfig, portJConfig, portKConfig, portLConfig,
  timer0Config, timer1Config, timer2Config,
  usart0Config, adcConfig, atmega328Channels, twiConfig, spiConfig,
  eepromConfig, watchdogConfig, ADCMuxInputType,
} from 'avr8js';

const vec = (n) => n * 2;

// ── ATmega328P (Uno, Nano, Pro Mini) ───────────────────────────────────────

export const ATMEGA328P = {
  id: 'atmega328p',
  name: 'ATmega328P',
  flashBytes: 32 * 1024,
  sramBytes: 2048,
  eepromBytes: 1024,
  ports: {
    B: portBConfig,
    C: portCConfig,
    D: portDConfig,
  },
  timers: [timer0Config, timer1Config, timer2Config],
  usarts: [usart0Config],
  adc: adcConfig,
  adcChannels: 8,
  twi: twiConfig,
  spi: spiConfig,
  eeprom: eepromConfig,
  watchdog: watchdogConfig,
};

// ── ATmega2560 (Mega 2560) ─────────────────────────────────────────────────

const EICRA = 0x69;
const EICRB = 0x6a;
const EIMSK = 0x3d;
const EIFR = 0x3c;
const extInt = (index, EICR, iscOffset) => ({ EICR, EIMSK, EIFR, index, iscOffset, interrupt: vec(index + 1) });

const PCICR = 0x68;
const PCIFR = 0x3b;
const pcint = (n, PCMSK, mask, offset) => ({ PCIE: n, PCICR, PCIFR, PCMSK, pinChangeInterrupt: vec(9 + n), mask, offset });

const mega = {
  INT: [0, 1, 2, 3].map(i => extInt(i, EICRA, i * 2)).concat([4, 5, 6, 7].map(i => extInt(i, EICRB, (i - 4) * 2))),
  PCINT0: pcint(0, 0x6b, 0xff, 0),
  PCINT1E: pcint(1, 0x6c, 0x01, 0), // PCINT8 = PE0
  PCINT1J: pcint(1, 0x6c, 0x7f, 1), // PCINT9..15 = PJ0..PJ6
  PCINT2: pcint(2, 0x6d, 0xff, 0),
};

const megaTimerBits = {
  TOV: 1, OCFA: 2, OCFB: 4, OCFC: 8,
  TOIE: 1, OCIEA: 2, OCIEB: 4, OCIEC: 8,
};

const timer16 = (base, n, firstVector, TIFR, TIMSK, oc) => ({
  ...megaTimerBits,
  bits: 16,
  dividers: timer1Config.dividers,
  captureInterrupt: vec(firstVector),
  compAInterrupt: vec(firstVector + 1),
  compBInterrupt: vec(firstVector + 2),
  compCInterrupt: vec(firstVector + 3),
  ovfInterrupt: vec(firstVector + 4),
  TIFR,
  TCCRA: base, TCCRB: base + 1, TCCRC: base + 2,
  TCNT: base + 4, ICR: base + 6, OCRA: base + 8, OCRB: base + 10, OCRC: base + 12,
  TIMSK,
  compPortA: oc.A[0], compPinA: oc.A[1],
  compPortB: oc.B[0], compPinB: oc.B[1],
  compPortC: oc.C[0], compPinC: oc.C[1],
  externalClockPort: 0,
  externalClockPin: 0,
  timerNumber: n,
});

const P = (cfg) => cfg.PORT;

export const ATMEGA2560 = {
  id: 'atmega2560',
  name: 'ATmega2560',
  flashBytes: 256 * 1024,
  // Data space is 0x0000-0x21FF: registers + extended I/O up to 0x1FF, then 8 KB SRAM.
  sramBytes: 8192 + 0x100,
  eepromBytes: 4096,
  ports: {
    A: portAConfig,
    B: { ...portBConfig, pinChange: mega.PCINT0, externalInterrupts: [] },
    C: portCConfig,
    D: { ...portDConfig, pinChange: undefined, externalInterrupts: mega.INT.slice(0, 4) },
    E: { ...portEConfig, pinChange: mega.PCINT1E, externalInterrupts: [null, null, null, null, ...mega.INT.slice(4, 8)] },
    F: portFConfig,
    G: portGConfig,
    H: portHConfig,
    J: { ...portJConfig, pinChange: mega.PCINT1J },
    K: { ...portKConfig, pinChange: mega.PCINT2 },
    L: portLConfig,
  },
  timers: [
    {
      ...timer0Config,
      compAInterrupt: vec(21), compBInterrupt: vec(22), ovfInterrupt: vec(23),
      compPortA: P(portBConfig), compPinA: 7, // OC0A = PB7 (pin 13)
      compPortB: P(portGConfig), compPinB: 5, // OC0B = PG5 (pin 4)
      externalClockPort: 0, externalClockPin: 0,
    },
    timer16(0x80, 1, 16, 0x36, 0x6f, { A: [P(portBConfig), 5], B: [P(portBConfig), 6], C: [P(portBConfig), 7] }),
    {
      ...timer2Config,
      compAInterrupt: vec(13), compBInterrupt: vec(14), ovfInterrupt: vec(15),
      compPortA: P(portBConfig), compPinA: 4, // OC2A = PB4 (pin 10)
      compPortB: P(portHConfig), compPinB: 6, // OC2B = PH6 (pin 9)
    },
    timer16(0x90, 3, 31, 0x38, 0x71, { A: [P(portEConfig), 3], B: [P(portEConfig), 4], C: [P(portEConfig), 5] }),
    timer16(0xa0, 4, 41, 0x39, 0x72, { A: [P(portHConfig), 3], B: [P(portHConfig), 4], C: [P(portHConfig), 5] }),
    timer16(0x120, 5, 46, 0x3a, 0x73, { A: [P(portLConfig), 3], B: [P(portLConfig), 4], C: [P(portLConfig), 5] }),
  ],
  usarts: [
    { ...usart0Config, rxCompleteInterrupt: vec(25), dataRegisterEmptyInterrupt: vec(26), txCompleteInterrupt: vec(27) },
    { rxCompleteInterrupt: vec(36), dataRegisterEmptyInterrupt: vec(37), txCompleteInterrupt: vec(38), UCSRA: 0xc8, UCSRB: 0xc9, UCSRC: 0xca, UBRRL: 0xcc, UBRRH: 0xcd, UDR: 0xce },
    { rxCompleteInterrupt: vec(51), dataRegisterEmptyInterrupt: vec(52), txCompleteInterrupt: vec(53), UCSRA: 0xd0, UCSRB: 0xd1, UCSRC: 0xd2, UBRRL: 0xd4, UBRRH: 0xd5, UDR: 0xd6 },
    { rxCompleteInterrupt: vec(54), dataRegisterEmptyInterrupt: vec(55), txCompleteInterrupt: vec(56), UCSRA: 0x130, UCSRB: 0x131, UCSRC: 0x132, UBRRL: 0x134, UBRRH: 0x135, UDR: 0x136 },
  ],
  adc: {
    ...adcConfig,
    adcInterrupt: vec(29),
    numChannels: 16,
    muxInputMask: 0x3f,
    muxChannels: {
      ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, { type: ADCMuxInputType.SingleEnded, channel: i }])),
      ...Object.fromEntries(Array.from({ length: 8 }, (_, i) => [0x20 + i, { type: ADCMuxInputType.SingleEnded, channel: 8 + i }])),
      0x1e: { type: ADCMuxInputType.Constant, voltage: 1.1 },
      0x1f: { type: ADCMuxInputType.Constant, voltage: 0 },
    },
  },
  adcChannels: 16,
  twi: { ...twiConfig, twiInterrupt: vec(39) },
  spi: { ...spiConfig, spiInterrupt: vec(24) },
  eeprom: { ...eepromConfig, eepromReadyInterrupt: vec(30) },
  watchdog: { ...watchdogConfig, watchdogInterrupt: vec(12) },
};

// The 328P keeps avr8js' own ADC channel map (temperature sensor on 8).
ATMEGA328P.adc = { ...adcConfig, muxChannels: atmega328Channels };
ATMEGA328P.ports.B = { ...portBConfig, pinChange: PCINT0, externalInterrupts: [] };
ATMEGA328P.ports.C = { ...portCConfig, pinChange: PCINT1, externalInterrupts: [] };
ATMEGA328P.ports.D = { ...portDConfig, pinChange: PCINT2, externalInterrupts: [null, null, INT0, INT1] };

export const MCUS = {
  [ATMEGA328P.id]: ATMEGA328P,
  [ATMEGA2560.id]: ATMEGA2560,
};
