// Impulse simulator bridge for ESP32 boards.
//
// Impulse adds this file to a copy of the sketch only when the sketch runs in
// its simulator (Espressif's QEMU); uploads to a real board never contain it.
// QEMU emulates the CPU, memory, flash, timers and UARTs, but not the GPIO
// matrix, LEDC (PWM), ADC, RMT or I2C controllers. So the Arduino functions
// that use them are replaced here: pin activity goes to the simulator over a
// spare UART, and input levels, analog voltages and I2C replies come back.
//
// Messages are ASCII lines; times are microseconds since boot.
//   to Impulse:  B<chip>                       bridge ready
//                H<t>                          heartbeat (time passes)
//                M<pin>,<mode>,<t>             pinMode
//                W<pin>,<level>,<t>            digitalWrite
//                P<pin>,<duty>,<bits>,<hz>,<t> PWM (duty -1 = released)
//                N<pin>,<r>,<g>,<b>,<t>        RGB LED (neopixelWrite)
//                Q<id>,<pin>,<level>,<timeout>,<t>   pulseIn, answered by q
//                T<bus>,<addr>,<hex>,<t>       I2C write to a device that is present
//                R<id>,<bus>,<addr>,<n>,<t>    I2C read, answered by r
//                X<id>,<bus>,<addr>,<hex>,<n>,<t>   I2C write then read, answered by r
//                O<count>                      messages dropped (the sketch outran the bridge)
//   from Impulse: G                 go: the circuit's starting state has been sent
//                I<pin>,<level>   input level (-1 = nothing drives it)
//                A<pin>,<mV>       analog voltage
//                D<addr>,<addr>…   I2C devices present (hex addresses)
//                q<id>,<us>        pulseIn result
//                r<id>,<ok>,<hex>  I2C read result

// Boards that number pins the Arduino way (Nano ESP32) remap them with macros
// in the sketch; this file defines the functions themselves, by GPIO number.
#define ARDUINO_CORE_BUILD
#include <Arduino.h>
#include "driver/uart.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/semphr.h"

#if CONFIG_IDF_TARGET_ESP32
#define SIM_CHIP "esp32"
#elif CONFIG_IDF_TARGET_ESP32S3
#define SIM_CHIP "esp32s3"
#elif CONFIG_IDF_TARGET_ESP32C3
#define SIM_CHIP "esp32c3"
#elif CONFIG_IDF_TARGET_ESP32S2
#define SIM_CHIP "esp32s2"
#else
#define SIM_CHIP "esp32"
#endif

#define SIM_UART UART_NUM_1
#define SIM_PINS 64
#define SIM_RING 16384

extern "C" {

static volatile uint8_t simMode[SIM_PINS];
static volatile uint8_t simOut[SIM_PINS];
static volatile int8_t simIn[SIM_PINS];        // -1: nothing drives the pin
static volatile uint16_t simMv[SIM_PINS];
static volatile uint8_t simIntMode[SIM_PINS];
static void *volatile simIntFn[SIM_PINS];
static void *volatile simIntArg[SIM_PINS];
static volatile bool simIntHasArg[SIM_PINS];
static volatile uint8_t simAdcBits = 12;
static volatile bool simReady = false;

// ── Outgoing messages: a ring the sketch (or an interrupt) writes, a task sends ──

static char simRing[SIM_RING];
static volatile uint32_t simHead = 0, simTail = 0, simDropped = 0;
static portMUX_TYPE simLock = portMUX_INITIALIZER_UNLOCKED;
static TaskHandle_t simTx = NULL;

static void simPut(const char *s, size_t n) {
  if (!simReady) return;
  portENTER_CRITICAL_SAFE(&simLock);
  if (simHead - simTail + n <= SIM_RING) {
    for (size_t i = 0; i < n; i++) simRing[(simHead + i) % SIM_RING] = s[i];
    simHead += n;
  } else {
    simDropped++;
  }
  portEXIT_CRITICAL_SAFE(&simLock);
  if (!simTx) return;
  if (xPortInIsrContext()) {
    vTaskNotifyGiveFromISR(simTx, NULL);
  } else {
    xTaskNotifyGive(simTx);
  }
}

static void simSendf(const char *fmt, ...) {
  char buf[96];
  va_list ap;
  va_start(ap, fmt);
  int n = vsnprintf(buf, sizeof buf, fmt, ap);
  va_end(ap);
  if (n > 0) simPut(buf, n < (int)sizeof buf ? n : sizeof buf - 1);
}

static unsigned long simNow() { return (unsigned long)esp_timer_get_time(); }

static void simTxTask(void *) {
  static char chunk[512];
  for (;;) {
    ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(10));
    bool sent = false;
    for (;;) {
      size_t n = 0;
      portENTER_CRITICAL(&simLock);
      while (simTail != simHead && n < sizeof chunk) chunk[n++] = simRing[simTail++ % SIM_RING];
      uint32_t dropped = simDropped;
      simDropped = 0;
      portEXIT_CRITICAL(&simLock);
      if (dropped) {
        char d[24];
        int m = snprintf(d, sizeof d, "O%lu\n", (unsigned long)dropped);
        uart_write_bytes(SIM_UART, d, m);
      }
      if (!n) break;
      uart_write_bytes(SIM_UART, chunk, n);
      sent = true;
    }
    if (!sent) {
      char h[24];
      int m = snprintf(h, sizeof h, "H%lu\n", simNow());
      uart_write_bytes(SIM_UART, h, m);
    }
  }
}

// ── Replies Impulse sends back to a waiting call ──

static SemaphoreHandle_t simGo = NULL;
static SemaphoreHandle_t simReplyLock = NULL;   // one waiting call at a time
static SemaphoreHandle_t simReplyDone = NULL;
static volatile uint32_t simReplyId = 0;
static volatile long simReplyValue = 0;
static uint8_t simReplyData[256];
static volatile size_t simReplyLen = 0;

static bool simI2cPresent[128];

static int simHex(char c) {
  if (c >= '0' && c <= '9') return c - '0';
  if (c >= 'a' && c <= 'f') return c - 'a' + 10;
  if (c >= 'A' && c <= 'F') return c - 'A' + 10;
  return -1;
}

static void simCallIsr(int pin) {
  void *fn = simIntFn[pin];
  if (!fn) return;
  if (simIntHasArg[pin]) ((void (*)(void *))fn)(simIntArg[pin]);
  else ((void (*)(void))fn)();
}

static void simLevelChanged(int pin, int before, int after) {
  uint8_t m = simIntMode[pin] & 0x07;
  if (!simIntFn[pin] || !m) return;
  bool fire = (m == RISING && !before && after) || (m == FALLING && before && !after) || (m == CHANGE && before != after)
    || (m == ONLOW && !after) || (m == ONHIGH && after);
  if (fire) simCallIsr(pin);
}

static int simLevel(int pin);

static void simHandle(char *line) {
  char kind = line[0];
  char *p = line + 1;
  long a = strtol(p, &p, 10);
  if (kind == 'I' || kind == 'A') {
    if (*p != ',' || a < 0 || a >= SIM_PINS) return;
    long b = strtol(p + 1, NULL, 10);
    if (kind == 'A') { simMv[a] = (uint16_t)(b < 0 ? 0 : b > 3300 ? 3300 : b); return; }
    int before = simLevel(a);
    simIn[a] = (int8_t)(b < 0 ? -1 : b ? 1 : 0);
    int after = simLevel(a);
    if (before != after) simLevelChanged(a, before, after);
  } else if (kind == 'G') {
    if (simGo) xSemaphoreGive(simGo);
  } else if (kind == 'D') {
    for (int i = 0; i < 128; i++) simI2cPresent[i] = false;
    char *s = line + 1;
    while (*s) {
      long addr = strtol(s, &s, 16);
      if (addr > 0 && addr < 128) simI2cPresent[addr] = true;
      if (*s != ',') break;
      s++;
    }
  } else if (kind == 'q' || kind == 'r') {
    if ((uint32_t)a != simReplyId || *p != ',') return;
    long v = strtol(p + 1, &p, 10);
    size_t n = 0;
    if (kind == 'r' && *p == ',') {
      p++;
      while (n < sizeof simReplyData && simHex(p[0]) >= 0 && simHex(p[1]) >= 0) {
        simReplyData[n++] = (uint8_t)(simHex(p[0]) << 4 | simHex(p[1]));
        p += 2;
      }
    }
    simReplyValue = v;
    simReplyLen = n;
    xSemaphoreGive(simReplyDone);
  }
}

static void simRxTask(void *) {
  static char line[600];
  size_t len = 0;
  uint8_t buf[256];
  for (;;) {
    int n = uart_read_bytes(SIM_UART, buf, sizeof buf, pdMS_TO_TICKS(20));
    for (int i = 0; i < n; i++) {
      char c = (char)buf[i];
      if (c == '\n') {
        line[len] = 0;
        if (len) simHandle(line);
        len = 0;
      } else if (len < sizeof line - 1) {
        line[len++] = c;
      }
    }
  }
}

/** Send a request and wait for its reply; false when Impulse doesn't answer in time. */
static uint32_t simNextId = 0;
static bool simAsk(const char *msg, size_t n, uint32_t id, uint32_t waitMs) {
  if (!simReady) return false;
  xSemaphoreTake(simReplyDone, 0);
  simReplyId = id;
  simPut(msg, n);
  bool ok = xSemaphoreTake(simReplyDone, pdMS_TO_TICKS(waitMs)) == pdTRUE;
  simReplyId = 0;
  return ok;
}

static void simStart() {
  if (simReady) return;
  for (int i = 0; i < SIM_PINS; i++) { simIn[i] = -1; simMv[i] = 0; }
  uart_config_t cfg = {};
  cfg.baud_rate = 2000000;
  cfg.data_bits = UART_DATA_8_BITS;
  cfg.parity = UART_PARITY_DISABLE;
  cfg.stop_bits = UART_STOP_BITS_1;
  cfg.flow_ctrl = UART_HW_FLOWCTRL_DISABLE;
  if (uart_driver_install(SIM_UART, 2048, 4096, 0, NULL, 0) != ESP_OK) return;
  uart_param_config(SIM_UART, &cfg);
  simGo = xSemaphoreCreateBinary();
  simReplyLock = xSemaphoreCreateMutex();
  simReplyDone = xSemaphoreCreateBinary();
  simReady = true;
  xTaskCreatePinnedToCore(simTxTask, "impulse-tx", 3072, NULL, 5, &simTx, 0);
  xTaskCreatePinnedToCore(simRxTask, "impulse-rx", 4096, NULL, 6, NULL, 0);
  simSendf("B%s\n", SIM_CHIP);
  // setup() starts once Impulse has sent the circuit's input levels and I2C devices.
  xSemaphoreTake(simGo, pdMS_TO_TICKS(3000));
}

// ── Arduino: start the bridge before setup() ──

void __real_initArduino(void);
void __wrap_initArduino(void) {
  __real_initArduino();
  simStart();
}

// ── Digital pins ──

static int simLevel(int pin) {
  uint8_t mode = simMode[pin];
  if ((mode & OUTPUT) == OUTPUT && !(mode & OPEN_DRAIN)) return simOut[pin];
  int8_t in = simIn[pin];
  if ((mode & OPEN_DRAIN) && !simOut[pin]) return 0;
  if (in >= 0) return in;
  return (mode & PULLUP) ? 1 : 0;
}

// The pins' registers aren't emulated, so nothing reaches them: no GPIO setup here.
void pinMode(uint8_t pin, uint8_t mode) {
  if (pin >= SIM_PINS) return;
  simMode[pin] = mode;
  simSendf("M%u,%u,%lu\n", pin, mode, simNow());
}

void digitalWrite(uint8_t pin, uint8_t val) {
#ifdef RGB_BUILTIN
  if (pin == RGB_BUILTIN) {
    uint8_t v = val ? RGB_BRIGHTNESS : 0;
    simSendf("N%u,%u,%u,%u,%lu\n", (unsigned)(RGB_BUILTIN - SOC_GPIO_PIN_COUNT), v, v, v, simNow());
    return;
  }
#endif
  if (pin >= SIM_PINS) return;
  uint8_t level = val ? 1 : 0;
  simOut[pin] = level;
  simSendf("W%u,%u,%lu\n", pin, level, simNow());
}

int digitalRead(uint8_t pin) {
  return pin < SIM_PINS ? simLevel(pin) : 0;
}

static void simAttach(uint8_t pin, void *fn, void *arg, bool hasArg, int mode) {
  if (pin >= SIM_PINS) return;
  simIntFn[pin] = NULL;
  simIntArg[pin] = arg;
  simIntHasArg[pin] = hasArg;
  simIntMode[pin] = (uint8_t)mode;
  simIntFn[pin] = fn;
}

void attachInterrupt(uint8_t pin, void (*fn)(void), int mode) { simAttach(pin, (void *)fn, NULL, false, mode); }
void attachInterruptArg(uint8_t pin, void (*fn)(void *), void *arg, int mode) { simAttach(pin, (void *)fn, arg, true, mode); }
void detachInterrupt(uint8_t pin) { if (pin < SIM_PINS) { simIntFn[pin] = NULL; simIntMode[pin] = 0; } }

// attachInterrupt(pin, std::function, mode) from FunctionalInterrupt.h ends here.
void __wrap___attachInterruptFunctionalArg(uint8_t pin, void (*fn)(void *), void *arg, int mode, bool functional) {
  (void)functional;
  simAttach(pin, (void *)fn, arg, true, mode);
}

unsigned long __wrap_pulseIn(uint8_t pin, uint8_t state, unsigned long timeout) {
  if (!simReady || !simReplyLock) return 0;
  xSemaphoreTake(simReplyLock, portMAX_DELAY);
  uint32_t id = ++simNextId;
  char msg[64];
  int n = snprintf(msg, sizeof msg, "Q%lu,%u,%u,%lu,%lu\n", (unsigned long)id, pin, state ? 1 : 0, timeout, simNow());
  long us = simAsk(msg, n, id, timeout / 1000 + 2000) ? simReplyValue : 0;
  xSemaphoreGive(simReplyLock);
  return us > 0 ? (unsigned long)us : 0;
}

unsigned long __wrap_pulseInLong(uint8_t pin, uint8_t state, unsigned long timeout) {
  return __wrap_pulseIn(pin, state, timeout);
}

// ── Analog inputs ──

static uint32_t simRaw(uint8_t pin, uint8_t bits) {
  uint32_t mv = pin < SIM_PINS ? simMv[pin] : 0;
  uint32_t max = (1u << bits) - 1;
  uint32_t raw = (mv * max + 1650) / 3300;
  return raw > max ? max : raw;
}

uint16_t analogRead(uint8_t pin) { return (uint16_t)simRaw(pin, simAdcBits); }
uint16_t analogReadRaw(uint8_t pin) { return (uint16_t)simRaw(pin, 12); }
uint32_t analogReadMilliVolts(uint8_t pin) { return pin < SIM_PINS ? simMv[pin] : 0; }
void analogReadResolution(uint8_t bits) { if (bits >= 1 && bits <= 16) simAdcBits = bits; }
void analogSetWidth(uint8_t bits) { if (bits >= 9 && bits <= 12) simAdcBits = bits; }
bool adcAttachPin(uint8_t pin) { return pin < SIM_PINS; }

// ── PWM (LEDC), analogWrite, tone and the RGB LED ──
// Core 2.x drives LEDC by channel (ledcSetup, ledcAttachPin, ledcWrite(channel)),
// core 3.x by pin (ledcAttach, ledcWrite(pin)); both keep this table.

#define SIM_CHANNELS 16
static int8_t simChanPin[SIM_CHANNELS] = {-1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1, -1};
static uint32_t simChanFreq[SIM_CHANNELS];
static uint8_t simChanBits[SIM_CHANNELS];
static uint32_t simChanDuty[SIM_CHANNELS];

static void simPwm(int chan) {
  if (chan < 0 || chan >= SIM_CHANNELS || simChanPin[chan] < 0) return;
  simSendf("P%d,%lu,%u,%lu,%lu\n", simChanPin[chan], (unsigned long)simChanDuty[chan], simChanBits[chan],
    (unsigned long)simChanFreq[chan], simNow());
}

static int simChanOf(uint8_t pin) {
  for (int c = 0; c < SIM_CHANNELS; c++) if (simChanPin[c] == pin) return c;
  return -1;
}

static int simFreeChan() {
  for (int c = SIM_CHANNELS - 1; c >= 0; c--) if (simChanPin[c] < 0) return c;
  return -1;
}

static void simRelease(uint8_t pin) {
  for (int c = 0; c < SIM_CHANNELS; c++) {
    if (simChanPin[c] != pin) continue;
    simChanPin[c] = -1;
    simSendf("P%u,-1,0,0,%lu\n", pin, simNow());
  }
}

static uint32_t simTone(int chan, uint32_t freq) {
  if (chan < 0) return 0;
  simChanFreq[chan] = freq;
  simChanBits[chan] = 10;
  simChanDuty[chan] = freq ? 0x1FF : 0;
  simPwm(chan);
  return freq;
}

static uint32_t simNoteFreq(note_t note, uint8_t octave) {
  static const uint16_t base[] = {4186, 4435, 4699, 4978, 5274, 5588, 5920, 6272, 6645, 7040, 7459, 7902};
  if (octave > 8 || note >= NOTE_MAX) return 0;
  return base[note] / (1 << (8 - octave));
}

static uint32_t simWriteFreq = 1000;
static uint8_t simWriteBits = 8;

void __wrap_analogWrite(uint8_t pin, int value) {
  if (pin >= SIM_PINS) return;
  int chan = simChanOf(pin);
  if (chan < 0) {
    chan = simFreeChan();
    if (chan < 0) return;
    simChanPin[chan] = (int8_t)pin;
    simChanFreq[chan] = simWriteFreq;
    simChanBits[chan] = simWriteBits;
    simMode[pin] = OUTPUT;
  }
  uint32_t max = (1u << simChanBits[chan]) - 1;
  simChanDuty[chan] = value < 0 ? 0 : (uint32_t)value > max ? max : (uint32_t)value;
  simPwm(chan);
}

#if ESP_ARDUINO_VERSION_MAJOR >= 3

static bool simLedcAttach(uint8_t pin, uint32_t freq, uint8_t bits, int chan) {
  if (pin >= SIM_PINS || bits < 1 || bits > 20 || chan < 0 || chan >= SIM_CHANNELS) return false;
  simRelease(pin);
  simChanPin[chan] = (int8_t)pin;
  simChanFreq[chan] = freq;
  simChanBits[chan] = bits;
  simChanDuty[chan] = 0;
  simMode[pin] = OUTPUT;
  simPwm(chan);
  return true;
}

bool __wrap_ledcAttach(uint8_t pin, uint32_t freq, uint8_t bits) { return simLedcAttach(pin, freq, bits, simFreeChan()); }
bool __wrap_ledcAttachChannel(uint8_t pin, uint32_t freq, uint8_t bits, uint8_t chan) { return simLedcAttach(pin, freq, bits, chan); }

bool __wrap_ledcWrite(uint8_t pin, uint32_t duty) {
  int chan = simChanOf(pin);
  if (chan < 0) return false;
  simChanDuty[chan] = duty;
  simPwm(chan);
  return true;
}

bool __wrap_ledcWriteChannel(uint8_t chan, uint32_t duty) {
  if (chan >= SIM_CHANNELS || simChanPin[chan] < 0) return false;
  simChanDuty[chan] = duty;
  simPwm(chan);
  return true;
}

uint32_t __wrap_ledcRead(uint8_t pin) { int c = simChanOf(pin); return c < 0 ? 0 : simChanDuty[c]; }
uint32_t __wrap_ledcReadFreq(uint8_t pin) { int c = simChanOf(pin); return c < 0 || !simChanDuty[c] ? 0 : simChanFreq[c]; }

uint32_t __wrap_ledcWriteTone(uint8_t pin, uint32_t freq) {
  int chan = simChanOf(pin);
  if (chan < 0 && !simLedcAttach(pin, freq ? freq : 1000, 10, simFreeChan())) return 0;
  return simTone(simChanOf(pin), freq);
}

uint32_t __wrap_ledcWriteNote(uint8_t pin, note_t note, uint8_t octave) { return __wrap_ledcWriteTone(pin, simNoteFreq(note, octave)); }

bool __wrap_ledcDetach(uint8_t pin) { simRelease(pin); return true; }

uint32_t __wrap_ledcChangeFrequency(uint8_t pin, uint32_t freq, uint8_t bits) {
  int chan = simChanOf(pin);
  if (chan < 0 || bits < 1 || bits > 20) return 0;
  simChanFreq[chan] = freq;
  simChanBits[chan] = bits;
  simPwm(chan);
  return freq;
}

bool __wrap_ledcOutputInvert(uint8_t pin, bool invert) { (void)invert; return simChanOf(pin) >= 0; }

// Fades jump to their end; the "done" callback comes when the fade would have ended.
struct SimFade { void (*fn)(void *); void *arg; bool hasArg; };
static void simFadeDone(void *p) {
  SimFade *f = (SimFade *)p;
  if (f->hasArg) f->fn(f->arg);
  else ((void (*)(void))f->fn)();
  delete f;
}

static bool simFade(uint8_t pin, uint32_t target, int ms, void (*fn)(void *), void *arg, bool hasArg) {
  if (!__wrap_ledcWrite(pin, target)) return false;
  if (!fn) return true;
  esp_timer_create_args_t args = {};
  args.callback = simFadeDone;
  args.arg = new SimFade{fn, arg, hasArg};
  esp_timer_handle_t timer;
  if (esp_timer_create(&args, &timer) != ESP_OK) return false;
  esp_timer_start_once(timer, (uint64_t)(ms > 0 ? ms : 1) * 1000);
  return true;
}

bool __wrap_ledcFade(uint8_t pin, uint32_t start, uint32_t target, int ms) { (void)start; return simFade(pin, target, ms, NULL, NULL, false); }
bool __wrap_ledcFadeWithInterrupt(uint8_t pin, uint32_t start, uint32_t target, int ms, void (*fn)(void)) {
  (void)start;
  return simFade(pin, target, ms, (void (*)(void *))fn, NULL, false);
}
bool __wrap_ledcFadeWithInterruptArg(uint8_t pin, uint32_t start, uint32_t target, int ms, void (*fn)(void *), void *arg) {
  (void)start;
  return simFade(pin, target, ms, fn, arg, true);
}
bool __wrap_ledcFadeGamma(uint8_t pin, uint32_t start, uint32_t target, int ms) { return __wrap_ledcFade(pin, start, target, ms); }
bool __wrap_ledcFadeGammaWithInterrupt(uint8_t pin, uint32_t start, uint32_t target, int ms, void (*fn)(void)) {
  return __wrap_ledcFadeWithInterrupt(pin, start, target, ms, fn);
}
bool __wrap_ledcFadeGammaWithInterruptArg(uint8_t pin, uint32_t start, uint32_t target, int ms, void (*fn)(void *), void *arg) {
  return __wrap_ledcFadeWithInterruptArg(pin, start, target, ms, fn, arg);
}

void __wrap_analogWriteFrequency(uint8_t pin, uint32_t freq) {
  if (!freq) return;
  int chan = simChanOf(pin);
  if (chan < 0) { simWriteFreq = freq; return; }
  simChanFreq[chan] = freq;
  simPwm(chan);
}

void __wrap_analogWriteResolution(uint8_t pin, uint8_t bits) {
  if (bits < 1 || bits > 16) return;
  int chan = simChanOf(pin);
  if (chan < 0) { simWriteBits = bits; return; }
  simChanBits[chan] = bits;
  simPwm(chan);
}

void __wrap_rgbLedWriteOrdered(uint8_t pin, rgb_led_color_order_t order, uint8_t r, uint8_t g, uint8_t b) {
  (void)order;
#ifdef RGB_BUILTIN
  if (pin == RGB_BUILTIN) pin = RGB_BUILTIN - SOC_GPIO_PIN_COUNT;
#endif
  simSendf("N%u,%u,%u,%u,%lu\n", pin, r, g, b, simNow());
}

void __wrap_rgbLedWrite(uint8_t pin, uint8_t r, uint8_t g, uint8_t b) { __wrap_rgbLedWriteOrdered(pin, LED_COLOR_ORDER_GRB, r, g, b); }

#else  // core 2.x

uint32_t __wrap_ledcSetup(uint8_t chan, uint32_t freq, uint8_t bits) {
  if (chan >= SIM_CHANNELS || bits < 1 || bits > 20) return 0;
  simChanFreq[chan] = freq;
  simChanBits[chan] = bits;
  simPwm(chan);
  return freq;
}

uint32_t __wrap_ledcChangeFrequency(uint8_t chan, uint32_t freq, uint8_t bits) {
  return __wrap_ledcSetup(chan, freq, bits);
}

void __wrap_ledcAttachPin(uint8_t pin, uint8_t chan) {
  if (chan >= SIM_CHANNELS || pin >= SIM_PINS) return;
  simChanPin[chan] = (int8_t)pin;
  simMode[pin] = OUTPUT;
  simPwm(chan);
}

void __wrap_ledcDetachPin(uint8_t pin) { simRelease(pin); }

void __wrap_ledcWrite(uint8_t chan, uint32_t duty) {
  if (chan >= SIM_CHANNELS) return;
  simChanDuty[chan] = duty;
  simPwm(chan);
}

uint32_t __wrap_ledcRead(uint8_t chan) { return chan < SIM_CHANNELS ? simChanDuty[chan] : 0; }
uint32_t __wrap_ledcReadFreq(uint8_t chan) { return chan < SIM_CHANNELS && simChanDuty[chan] ? simChanFreq[chan] : 0; }
uint32_t __wrap_ledcWriteTone(uint8_t chan, uint32_t freq) { return chan < SIM_CHANNELS ? simTone(chan, freq) : 0; }
uint32_t __wrap_ledcWriteNote(uint8_t chan, note_t note, uint8_t octave) { return __wrap_ledcWriteTone(chan, simNoteFreq(note, octave)); }

void __wrap_analogWriteFrequency(uint32_t freq) { if (freq) simWriteFreq = freq; }
void __wrap_analogWriteResolution(uint8_t bits) { if (bits >= 1 && bits <= 16) simWriteBits = bits; }

#endif

void __wrap_neopixelWrite(uint8_t pin, uint8_t r, uint8_t g, uint8_t b) {
#ifdef RGB_BUILTIN
  if (pin == RGB_BUILTIN) pin = RGB_BUILTIN - SOC_GPIO_PIN_COUNT;
#endif
  simSendf("N%u,%u,%u,%u,%lu\n", pin, r, g, b, simNow());
}

// ── I2C (Wire) ──

static bool simI2cOn[2];

esp_err_t __wrap_i2cInit(uint8_t num, int8_t sda, int8_t scl, uint32_t hz) {
  if (num > 1) return ESP_FAIL;
  simI2cOn[num] = true;
  simSendf("C%u,%d,%d,%lu\n", num, sda, scl, (unsigned long)hz);
  return ESP_OK;
}

esp_err_t __wrap_i2cDeinit(uint8_t num) {
  if (num > 1) return ESP_FAIL;
  simI2cOn[num] = false;
  return ESP_OK;
}

bool __wrap_i2cIsInit(uint8_t num) { return num < 2 && simI2cOn[num]; }
esp_err_t __wrap_i2cSetClock(uint8_t num, uint32_t hz) { (void)num; (void)hz; return ESP_OK; }
esp_err_t __wrap_i2cGetClock(uint8_t num, uint32_t *hz) { (void)num; if (hz) *hz = 100000; return ESP_OK; }

static size_t simPutHex(char *out, const uint8_t *data, size_t n) {
  static const char digits[] = "0123456789abcdef";
  for (size_t i = 0; i < n; i++) {
    out[i * 2] = digits[data[i] >> 4];
    out[i * 2 + 1] = digits[data[i] & 15];
  }
  return n * 2;
}

esp_err_t __wrap_i2cWrite(uint8_t num, uint16_t addr, const uint8_t *buf, size_t size, uint32_t timeoutMs) {
  (void)timeoutMs;
  if (addr >= 128 || !simI2cPresent[addr]) return ESP_FAIL;
  // Writes don't wait for Impulse: the device is known to be there.
  size_t done = 0;
  do {
    size_t part = size - done > 120 ? 120 : size - done;
    char msg[300];
    int n = snprintf(msg, sizeof msg, "T%u,%u,", num, addr);
    n += simPutHex(msg + n, buf + done, part);
    n += snprintf(msg + n, sizeof msg - n, ",%lu\n", simNow());
    simPut(msg, n);
    done += part;
  } while (done < size);
  return ESP_OK;
}

static esp_err_t simI2cRead(char *msg, int n, uint32_t id, uint8_t *buf, size_t size, size_t *count) {
  bool answered = simAsk(msg, n, id, 1000);
  esp_err_t err = !answered ? ESP_ERR_TIMEOUT : simReplyValue ? ESP_OK : ESP_FAIL;
  size_t got = 0;
  if (err == ESP_OK) {
    got = simReplyLen < size ? simReplyLen : size;
    memcpy(buf, simReplyData, got);
    for (size_t i = got; i < size; i++) buf[i] = 0xFF;
    got = size;
  }
  if (count) *count = got;
  return err;
}

esp_err_t __wrap_i2cRead(uint8_t num, uint16_t addr, uint8_t *buf, size_t size, uint32_t timeoutMs, size_t *count) {
  (void)timeoutMs;
  if (count) *count = 0;
  if (addr >= 128 || !simI2cPresent[addr]) return ESP_FAIL;
  if (size > sizeof simReplyData) size = sizeof simReplyData;
  xSemaphoreTake(simReplyLock, portMAX_DELAY);
  uint32_t id = ++simNextId;
  char msg[64];
  int n = snprintf(msg, sizeof msg, "R%lu,%u,%u,%u,%lu\n", (unsigned long)id, num, addr, (unsigned)size, simNow());
  esp_err_t err = simI2cRead(msg, n, id, buf, size, count);
  xSemaphoreGive(simReplyLock);
  return err;
}

esp_err_t __wrap_i2cWriteReadNonStop(uint8_t num, uint16_t addr, const uint8_t *wbuf, size_t wsize, uint8_t *rbuf,
    size_t rsize, uint32_t timeoutMs, size_t *count) {
  (void)timeoutMs;
  if (count) *count = 0;
  if (addr >= 128 || !simI2cPresent[addr]) return ESP_FAIL;
  if (rsize > sizeof simReplyData) rsize = sizeof simReplyData;
  if (wsize > 120) wsize = 120;
  xSemaphoreTake(simReplyLock, portMAX_DELAY);
  uint32_t id = ++simNextId;
  char msg[320];
  int n = snprintf(msg, sizeof msg, "X%lu,%u,%u,", (unsigned long)id, num, addr);
  n += simPutHex(msg + n, wbuf, wsize);
  n += snprintf(msg + n, sizeof msg - n, ",%u,%lu\n", (unsigned)rsize, simNow());
  esp_err_t err = simI2cRead(msg, n, id, rbuf, rsize, count);
  xSemaphoreGive(simReplyLock);
  return err;
}

// ── Arduino Nano ESP32: no double-tap detection ──
// Its startup code keeps a marker at the top of PSRAM's address window, which
// the emulator doesn't map. The marker only detects a double press of RESET.

void __wrap_double_tap_init(void) {}
void __wrap_double_tap_mark(void) {}
void __wrap_double_tap_invalidate(void) {}
bool __wrap_double_tap_check_match(void) { return false; }

}  // extern "C"
