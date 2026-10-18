const { LibraryService, includesOf, missingHeadersOf } = require('../libraryService');

const INDEX = {
  libraries: [
    { name: 'Adafruit SSD1306', latest_version: '2.5.13', releases: { '2.5.13': { version: '2.5.13', author: 'Adafruit', sentence: 'SSD1306 OLED driver', architectures: ['*'], provides_includes: ['Adafruit_SSD1306.h'] } } },
    { name: 'Adafruit GFX Library', latest_version: '1.11.11', releases: { '1.11.11': { version: '1.11.11', sentence: 'Graphics core', architectures: ['*'], provides_includes: ['Adafruit_GFX.h'] } } },
    { name: 'DHT sensor library', latest_version: '1.4.6', releases: { '1.4.6': { version: '1.4.6', sentence: 'Temperature and humidity', architectures: ['avr', 'esp32'], provides_includes: ['DHT.h', 'DHT_U.h'] } } },
    { name: 'ESP32Servo', latest_version: '3.0.5', releases: { '3.0.5': { version: '3.0.5', sentence: 'Servo for ESP32', architectures: ['esp32'], provides_includes: ['ESP32Servo.h'] } } },
    { name: 'Servo', latest_version: '1.2.2', releases: { '1.2.2': { version: '1.2.2', sentence: 'Servo motors', architectures: ['avr', 'samd'], provides_includes: ['Servo.h'] } } },
  ],
};

function service({ installed = [], installFails = false } = {}) {
  const calls = [];
  const runCli = jest.fn(async (args) => {
    calls.push(args.join(' '));
    if (args[1] === 'search') return { success: true, stdout: JSON.stringify(INDEX), stderr: '' };
    if (args[1] === 'list') return { success: true, stdout: JSON.stringify({ installed_libraries: installed.map((l) => ({ library: l })) }), stderr: '' };
    if (args[1] === 'install') {
      if (installFails) return { success: false, stdout: '', stderr: 'Error: library not found' };
      installed.push({ name: args[2].split('@')[0], version: '1.0.0', provides_includes: [], sentence: '' });
      return { success: true, stdout: `Installed ${args[2]}`, stderr: '' };
    }
    if (args[1] === 'update-index') return { success: true, stdout: '', stderr: '' };
    if (args[1] === 'uninstall') return { success: true, stdout: '', stderr: '' };
    return { success: false, stdout: '', stderr: 'unexpected' };
  });
  return { lib: new LibraryService(runCli), calls, runCli };
}

describe('reading a sketch and a build log', () => {
  it('lists the headers a sketch includes, once each', () => {
    expect(includesOf('#include <Wire.h>\n#include "DHT.h"\n#include <Wire.h>\nvoid setup(){}')).toEqual(['Wire.h', 'DHT.h']);
  });

  it('finds every header the compiler could not find', () => {
    const log = `/s/x.ino:2:10: fatal error: Adafruit_SSD1306.h: No such file or directory
/s/x.ino:3:10: fatal error: utility/DHT.h: No such file or directory
compilation terminated.`;
    expect(missingHeadersOf(log)).toEqual(['Adafruit_SSD1306.h', 'DHT.h']);
    expect(missingHeadersOf('all good')).toEqual([]);
  });
});

describe('search', () => {
  it('puts an exact name first, then the library that provides the header', async () => {
    const { lib } = service();
    expect((await lib.search('servo')).map((l) => l.name)).toEqual(['Servo', 'ESP32Servo']);
    expect((await lib.search('DHT.h'))[0].name).toBe('DHT sensor library');
    expect(await lib.search('zzznotalibrary')).toEqual([]);
  });

  it('says whether a library is installed and whether it names this board\'s architecture', async () => {
    const { lib } = service({ installed: [{ name: 'Servo', version: '1.2.2', provides_includes: ['Servo.h'] }] });
    const [servo] = await lib.search('Servo', { fqbn: 'esp32:esp32:esp32' });
    expect(servo).toMatchObject({ installed: true, installedVersion: '1.2.2', fitsBoard: false });
    const [esp] = await lib.search('ESP32Servo', { fqbn: 'esp32:esp32:esp32' });
    expect(esp).toMatchObject({ installed: false, fitsBoard: true });
  });
});

describe('what provides a header', () => {
  it('finds the library, and prefers one that fits the board', async () => {
    const { lib } = service();
    expect((await lib.providersOf('Adafruit_SSD1306.h'))[0].name).toBe('Adafruit SSD1306');
    expect(await lib.providersOf('Wire.h')).toEqual([]); // the core provides it: nothing to install
  });

  it('reports what a sketch needs and skips what is installed or comes from the core', async () => {
    const { lib } = service({ installed: [{ name: 'Adafruit GFX Library', version: '1.11.11', provides_includes: ['Adafruit_GFX.h'] }] });
    const missing = await lib.missingFor('#include <Wire.h>\n#include <Adafruit_GFX.h>\n#include <Adafruit_SSD1306.h>\n#include "pins.h"', { fqbn: 'arduino:avr:uno' });
    expect(missing).toHaveLength(1);
    expect(missing[0]).toMatchObject({ header: 'Adafruit_SSD1306.h', suggestion: expect.objectContaining({ name: 'Adafruit SSD1306' }) });
  });
});

describe('installing', () => {
  it('installs what the build was missing and reports it', async () => {
    const { lib, calls } = service();
    const log = 'x.ino:2:10: fatal error: Adafruit_SSD1306.h: No such file or directory';
    const result = await lib.installForMissingHeaders(log, { fqbn: 'arduino:avr:uno' });
    expect(result.installed).toEqual([{ header: 'Adafruit_SSD1306.h', name: 'Adafruit SSD1306', version: '2.5.13' }]);
    expect(result.unresolved).toEqual([]);
    expect(calls).toContain('lib install Adafruit SSD1306');
  });

  it('says which headers it could not resolve, and keeps going', async () => {
    const { lib } = service();
    const log = `fatal error: Adafruit_SSD1306.h: No such file or directory
fatal error: SomeoneElsesThing.h: No such file or directory`;
    const result = await lib.installForMissingHeaders(log);
    expect(result.installed.map((i) => i.name)).toEqual(['Adafruit SSD1306']);
    expect(result.unresolved).toEqual(['SomeoneElsesThing.h']);
  });

  it('reports a failed install instead of throwing', async () => {
    const { lib } = service({ installFails: true });
    const result = await lib.installForMissingHeaders('fatal error: DHT.h: No such file or directory');
    expect(result.installed).toEqual([]);
    expect(result.unresolved[0]).toMatch(/^DHT\.h \(Could not install DHT sensor library/);
  });

  it('refuses a name that is not a library name', async () => {
    const { lib } = service();
    await expect(lib.install('; rm -rf /')).rejects.toThrow(/is not a library name/);
    await expect(lib.install('Servo', { version: '1.0; echo' })).rejects.toThrow(/is not a version/);
  });
});
