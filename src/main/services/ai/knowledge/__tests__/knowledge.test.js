// What the agent knows about boards, chips and parts: pins read from a core's
// variant headers, the family guides, the component guide, and the facts that
// go with every request.
const path = require('path');
const { readDefinitions, pinFacts, resolve } = require('../pinsHeader');
const { FAMILIES, familyOf, familyById, guideText } = require('../mcuGuide');
const { COMPONENTS, findComponents, componentText } = require('../components');
const BoardKnowledge = require('../boardKnowledge');
const ToolExecutor = require('../../tools/toolExecutor');

const CORES = path.join(__dirname, '../../../../../../test/fixtures/cores');
const header = (core, variant) => path.join(CORES, core, 'variants', variant, 'pins_arduino.h');

describe('pins read from a core\'s variant header', () => {
  test('AVR: chains of defines and constants resolve to pin numbers; macros and comments are skipped', () => {
    const defs = readDefinitions(header('avr', 'standard'));
    const { pins, analog } = pinFacts(defs);
    expect(pins).toMatchObject({ LED_BUILTIN: 13, SDA: 18, SCL: 19, MOSI: 11, MISO: 12, SCK: 13, SS: 10, NUM_DIGITAL_PINS: 20 });
    expect(analog).toEqual({ A0: 14, A4: 18 });
    expect(defs.has('digitalPinHasPWM')).toBe(false);
  });

  test('ESP32-S3: an RGB LED_BUILTIN is named for what it is, with the right call for the core version', () => {
    const defs = readDefinitions(header('esp', 'esp32s3'));
    const core2 = pinFacts(defs, { family: 'esp32-s3', coreVersion: '2.0.17' });
    expect(core2.pins).toMatchObject({ LED_BUILTIN: 'RGB LED on GPIO48', BUILTIN_LED: 'RGB LED on GPIO48', RGB_BUILTIN: 'RGB LED on GPIO48', RGB_LED_GPIO: 48, TX: 43, SDA: 8, USB_VID: '0x303a' });
    expect(core2.notes.join(' ')).toMatch(/neopixelWrite\(RGB_BUILTIN/);
    expect(pinFacts(defs, { family: 'esp32-s3', coreVersion: '3.1.0' }).notes.join(' ')).toMatch(/rgbLedWrite\(RGB_BUILTIN/);
    expect(core2.touch).toEqual({ T1: 1 });
  });

  test('a board with no user LED says so', () => {
    const { pins, notes } = pinFacts(readDefinitions(header('esp', 'devkit')), { family: 'esp32' });
    expect(pins.LED_BUILTIN).toBeUndefined();
    expect(notes.join(' ')).toMatch(/LED_BUILTIN is NOT defined/);
  });

  test('Arduino-Pico: follows includes in the core, drops #ifdef-only aliases, marks unpinned 31s, and explains the NeoPixel', () => {
    const { pins, analog, notes } = pinFacts(readDefinitions(header('pico', 'xiao')), { family: 'rp2040' });
    expect(pins).toMatchObject({ LED_BUILTIN: 17, SDA: 6, SCL: 7, PIN_NEOPIXEL: 12, NEOPIXEL_POWER: 11, PIN_SERIAL2_TX: 'not pinned out' });
    expect(analog).toEqual({ A0: 26 });
    expect(notes.join(' ')).toMatch(/NeoPixel\) on pin 12.*pin 11.*HIGH first/);
  });

  test('an active-LOW LED is called out', () => {
    const { notes } = pinFacts(readDefinitions(header('nrf', 'nano33')), { family: 'nrf52840' });
    expect(notes.join(' ')).toMatch(/active-LOW/);
  });

  test('values it can\'t work out stay readable', () => {
    const defs = new Map([['X', { value: 'SOME_MACRO(3)' }], ['Y', { value: 'BASE + 2' }], ['BASE', { value: '(40u)' }]]);
    expect(resolve(defs, 'X')).toEqual({ value: null, expr: 'SOME_MACRO(3)' });
    expect(resolve(defs, 'Y').value).toBe(42);
  });
});

describe('chip family guides', () => {
  test('each family has a logic level, facts and something to match on', () => {
    expect(FAMILIES.length).toBeGreaterThanOrEqual(20);
    for (const f of FAMILIES) {
      expect(f.title).toBeTruthy();
      expect(f.logic).toBeTruthy();
      expect(f.facts.length).toBeGreaterThan(0);
      expect(Object.keys(f.match).length).toBeGreaterThan(0);
    }
    expect(JSON.stringify(FAMILIES)).not.toMatch(/\\\\/); // no stray escapes in the text
  });

  test.each([
    [{ 'build.mcu': 'atmega328p' }, 'arduino:avr:uno', 'avr-atmega328p'],
    [{ 'build.mcu': 'atmega32u4' }, 'arduino:avr:leonardo', 'avr-atmega32u4'],
    [{ 'build.mcu': 'esp32s3' }, 'esp32:esp32:esp32s3', 'esp32-s3'],
    [{ 'build.mcu': 'cortex-m4', 'build.board': 'UNOR4_WIFI' }, 'arduino:renesas_uno:unor4wifi', 'renesas-ra4m1'],
    [{ 'build.mcu': 'cortex-m4', 'build.board': 'ARDUINO_NANO33BLE' }, 'arduino:mbed_nano:nano33ble', 'nrf52840'],
    [{ 'build.mcu': 'cortex-m0plus', 'build.board': 'SAMD_NANO_33_IOT' }, 'arduino:samd:nano_33_iot', 'samd21'],
    [{ 'build.mcu': 'cortex-m4', 'build.board': 'METRO_M4' }, 'adafruit:samd:adafruit_metro_m4', 'samd51'],
    [{ 'build.mcu': 'cortex-m0plus', 'build.board': 'NANO_RP2040_CONNECT' }, 'arduino:mbed_nano:nanorp2040connect', 'rp2040'],
    [{ 'build.mcu': 'cortex-m33', 'build.chip': 'rp2350' }, 'rp2040:rp2040:rpipico2', 'rp2350'],
  ])('%j (%s) is %s', (props, fqbn, id) => {
    expect(familyOf(props, fqbn).id).toBe(id);
  });

  test('found by chip or board name as people type them', () => {
    expect(familyById('ESP32S3').id).toBe('esp32-s3');
    expect(familyById('attiny85').id).toBe('attiny-x5');
    expect(familyById('uno r4').id).toBe('renesas-ra4m1');
    expect(familyById('nonsense-chip')).toBeNull();
  });

  test('ESP32 guides carry the core 2.x → 3.x changes; others the fundamentals', () => {
    const s3 = guideText(familyById('esp32-s3'), { coreVersion: '2.0.17' });
    expect(s3).toMatch(/ledcAttach\(pin, freq, resolution\)/);
    expect(s3).toMatch(/Logic level: 3\.3 V logic, NOT 5 V tolerant/);
    expect(guideText(familyById('atmega328p'))).toMatch(/F\("…"\)/);
    expect(guideText(familyById('atmega328p'))).toMatch(/Embedded fundamentals/);
  });
});

describe('component guide', () => {
  test('every entry says how it connects and at what voltage; addresses are 7-bit hex', () => {
    expect(COMPONENTS.length).toBeGreaterThanOrEqual(50);
    for (const c of COMPONENTS) {
      expect(c.names.length).toBeGreaterThan(0);
      expect(c.interface).toBeTruthy();
      expect(c.voltage).toBeTruthy();
      for (const a of c.i2c || []) expect(a).toMatch(/^0x[0-7][0-9A-F]/i);
    }
  });

  test('found by name, part number or I2C address', () => {
    expect(findComponents('DHT22')[0].id).toBe('dht');
    expect(findComponents('hc-sr04')[0].id).toBe('hc-sr04');
    expect(findComponents('0x27').map((c) => c.id)).toContain('lcd-i2c');
    expect(findComponents('0x68').map((c) => c.id)).toEqual(expect.arrayContaining(['mpu6050', 'rtc']));
    expect(componentText(findComponents('nRF24L01')[0])).toMatch(/3\.6 V ONLY/);
  });
});

describe('board knowledge from arduino-cli', () => {
  const fakeCli = (variantDir, extra = {}) => async (args) => {
    if (args[0] === 'board' && args[1] === 'details') {
      if (args[3].startsWith('missing:')) return { success: false, stdout: '', stderr: 'Error: platform not installed' };
      return {
        success: true,
        stdout: JSON.stringify({
          name: 'ESP32S3 Dev Module', version: '2.0.17', package: { name: 'esp32' }, platform: { architecture: 'esp32', name: 'esp32' },
          config_options: [{ option: 'CDCOnBoot', option_label: 'USB CDC On Boot', values: [{ value: 'default', value_label: 'Disabled', selected: true }] }],
          build_properties: ['build.mcu=esp32s3', 'build.f_cpu=240000000L', 'build.cdc_on_boot=0', 'build.usb_mode=1', 'upload.maximum_size=1310720', 'upload.maximum_data_size=327680', `build.variant.path=${variantDir}`, `runtime.platform.path=${path.join(variantDir, '../..')}`, 'build.variant=esp32s3'],
          ...extra,
        }),
        stderr: '',
      };
    }
    if (args[1] === 'listall') return { success: true, stdout: JSON.stringify({ boards: [{ name: 'Arduino UNO', fqbn: 'arduino:avr:uno' }] }), stderr: '' };
    if (args[1] === 'search') return { success: true, stdout: JSON.stringify({ boards: [{ name: 'Arduino UNO R4 WiFi', platform: { metadata: { id: 'arduino:renesas_uno' } } }, { name: 'Arduino UNO', fqbn: 'arduino:avr:uno', platform: { metadata: { id: 'arduino:avr' } } }] }), stderr: '' };
    return { success: false, stdout: '', stderr: 'unexpected' };
  };
  const s3dir = path.join(CORES, 'esp', 'variants', 'esp32s3');

  test('a board\'s facts: chip, memory, pins, options and the traps', async () => {
    const bk = new BoardKnowledge(fakeCli(s3dir));
    const info = await bk.boardInfo('esp32:esp32:esp32s3');
    expect(info).toMatchObject({ name: 'ESP32S3 Dev Module', core: 'esp32:esp32 2.0.17', mcu: 'esp32s3', family: 'esp32-s3', cpuMHz: 240, sketchFlashBytes: 1310720, ramBytes: 327680 });
    expect(info.pins.LED_BUILTIN).toBe('RGB LED on GPIO48');
    expect(info.boardOptions).toEqual({ 'USB CDC On Boot': 'Disabled' });
    expect(info.notes.join(' ')).toMatch(/Serial is UART0 \(TX 43, RX 44\)/);
  });

  test('the paragraph that goes with every request', async () => {
    const text = await new BoardKnowledge(fakeCli(s3dir)).summary('esp32:esp32:esp32s3');
    expect(text).toMatch(/^\[BOARD FACTS/);
    expect(text).toMatch(/3\.3 V logic, NOT 5 V tolerant/);
    expect(text).toMatch(/LED_BUILTIN = RGB LED on GPIO48/);
    expect(text).toMatch(/I2C SDA 8, SCL 9/);
    expect(text.length).toBeLessThan(1600);
  });

  test('a board whose core isn\'t installed names the core to install', async () => {
    const bk = new BoardKnowledge(fakeCli(s3dir));
    await expect(bk.boardInfo('missing:arch:board')).rejects.toThrow(/core for missing:arch:board isn't installed.*missing:arch/);
    expect(await bk.summary('missing:arch:board')).toBeNull();
  });

  test('board search merges installed and installable boards', async () => {
    const found = await new BoardKnowledge(fakeCli(s3dir)).search('uno');
    expect(found).toEqual([
      { name: 'Arduino UNO', fqbn: 'arduino:avr:uno', core: 'arduino:avr', installed: true },
      { name: 'Arduino UNO R4 WiFi', fqbn: null, core: 'arduino:renesas_uno', installed: false },
    ]);
  });

  test('the agent\'s tools answer through the executor', async () => {
    const exec = new ToolExecutor({ runCommand: fakeCli(s3dir) }, null, null, null);
    exec.setUICallbacks({ getSelectedBoard: async () => 'esp32:esp32:esp32s3' });
    const board = await exec.execute({ name: 'get_board_info', arguments: {} });
    expect(board.success).toBe(true);
    expect(board.result.pins.SDA).toBe(8);
    const guide = await exec.execute({ name: 'get_mcu_guide', arguments: {} });
    expect(guide.result.guide).toMatch(/ESP32-S3/);
    const part = await exec.execute({ name: 'get_component_guide', arguments: { query: 'SSD1306' } });
    expect(part.result.guide).toMatch(/0x3C/);
    const none = await exec.execute({ name: 'get_component_guide', arguments: { query: 'flux capacitor' } });
    expect(none.result.found).toBe(0);
    exec.setUICallbacks({ getSelectedBoard: async () => '' });
    const noBoard = await exec.execute({ name: 'get_board_info', arguments: {} });
    expect(noBoard.success).toBe(false);
    expect(noBoard.error).toMatch(/No board is selected/);
  });
});

// The real thing: arduino-cli and the installed AVR core.
const { spawnSync } = require('child_process');
const hasAvrCore = (() => {
  const r = spawnSync('arduino-cli', ['core', 'list', '--format', 'json'], { encoding: 'utf8' });
  return r.status === 0 && /"arduino:avr"/.test(r.stdout);
})();
(hasAvrCore ? describe : describe.skip)('with arduino-cli and the AVR core installed', () => {
  const runCli = async (args) => {
    const r = spawnSync('arduino-cli', args, { encoding: 'utf8' });
    return { success: r.status === 0, stdout: r.stdout, stderr: r.stderr };
  };

  test('the Uno, Mega and Leonardo, read from the core itself', async () => {
    const bk = new BoardKnowledge(runCli);
    const uno = await bk.boardInfo('arduino:avr:uno');
    expect(uno).toMatchObject({ mcu: 'atmega328p', family: 'avr-atmega328p', cpuMHz: 16 });
    expect(uno.pins).toMatchObject({ LED_BUILTIN: 13, SDA: 18, SCL: 19, SS: 10 });
    expect(await bk.summary('arduino:avr:uno')).toMatch(/SDA 18 \(A4\), SCL 19 \(A5\)/);
    expect((await bk.boardInfo('arduino:avr:mega')).pins).toMatchObject({ SDA: 20, SCL: 21, SS: 53 });
    expect((await bk.boardInfo('arduino:avr:leonardo')).pins).toMatchObject({ SDA: 2, SCL: 3 });
  }, 60000);
});
