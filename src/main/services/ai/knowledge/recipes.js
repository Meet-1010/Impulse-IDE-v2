/**
 * Known-good recipes for the parts in components.js: the libraries to
 * install (Library Manager names), the wiring, and a minimal sketch that
 * Impulse compiles for real boards (scripts/knowledge-recipes.mjs) before it
 * ships. `{{PIN}}` placeholders take the pins table for the board family;
 * `sketch` and `libs` may differ per family when the API does (Servo vs
 * ESP32Servo). Pins are chosen to exist and be free on every board of the
 * family: 2–13 on AVR boards; 4, 5, 13–18, 21 on the ESP32 and ESP32-S3.
 * @module main/services/ai/knowledge/recipes
 */

const I2C_WIRING = {
  default: { SDA: 'A4 on the Uno/Nano, 20 on the Mega', SCL: 'A5 on the Uno/Nano, 21 on the Mega' },
  esp32: { SDA: 'GPIO 21 on the classic ESP32, GPIO 8 on the ESP32-S3 DevKitC (Wire.begin() picks it)', SCL: 'GPIO 22 on the classic ESP32, GPIO 9 on the ESP32-S3 DevKitC' },
  esp8266: { SDA: 'D2 (GPIO 4)', SCL: 'D1 (GPIO 5)' },
  rp2040: { SDA: 'GP4', SCL: 'GP5' },
};
const i2cWiring = (vcc = 'VCC → 3.3 V (5 V also works on modules with a regulator)') => [vcc, 'GND → GND', 'SDA → {{SDA}}', 'SCL → {{SCL}}'];

const RECIPES = {
  'ssd1306': {
    libs: ['Adafruit SSD1306', 'Adafruit GFX Library', 'Adafruit BusIO'],
    pins: I2C_WIRING,
    wiring: i2cWiring(),
    sketch: `
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);  // 128x32 modules: change 64 to 32

void setup() {
  Serial.begin(115200);
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {  // 0x3D on some modules: run an I2C scanner
    Serial.println("SSD1306 not found");
    while (true) delay(10);
  }
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("Hello");
  display.display();  // nothing shows until this
}

void loop() {}
`,
  },
  'lcd-i2c': {
    libs: ['LiquidCrystal I2C'],
    pins: I2C_WIRING,
    wiring: i2cWiring('VCC → 5 V (the backlight and contrast need 5 V; on 3.3 V boards use a level shifter or remove the backpack pull-ups)'),
    sketch: `
#include <Wire.h>
#include <LiquidCrystal_I2C.h>

LiquidCrystal_I2C lcd(0x27, 16, 2);  // 0x3F on PCF8574A backpacks; (0x27, 20, 4) for a 20x4

void setup() {
  lcd.init();
  lcd.backlight();
  lcd.setCursor(0, 0);
  lcd.print("Hello");
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print(millis() / 1000);
  lcd.print(" s   ");
  delay(200);
}
`,
  },
  'lcd-parallel': {
    libs: ['LiquidCrystal'],
    pins: { default: { RS: 12, EN: 11, D4: 5, D5: 4, D6: 3, D7: 2 }, esp32: { RS: 4, EN: 5, D4: 15, D5: 16, D6: 17, D7: 18 }, esp32c3: { RS: 2, EN: 3, D4: 4, D5: 5, D6: 6, D7: 7 } },
    wiring: ['VSS → GND; VDD → 5 V; V0 → wiper of a 10 kΩ pot between 5 V and GND (contrast)', 'RS → pin {{RS}}; RW → GND; E → pin {{EN}}', 'D4 → pin {{D4}}; D5 → pin {{D5}}; D6 → pin {{D6}}; D7 → pin {{D7}} (D0–D3 unconnected)', 'A → 220 Ω → 5 V; K → GND (backlight)'],
    sketch: `
#include <LiquidCrystal.h>

LiquidCrystal lcd({{RS}}, {{EN}}, {{D4}}, {{D5}}, {{D6}}, {{D7}});  // RS, E, D4, D5, D6, D7

void setup() {
  lcd.begin(16, 2);
  lcd.print("Hello");
}

void loop() {
  lcd.setCursor(0, 1);
  lcd.print(millis() / 1000);
}
`,
  },
  'dht': {
    libs: ['DHT sensor library', 'Adafruit Unified Sensor'],
    pins: { default: { DATA: 2 }, esp32: { DATA: 4 } },
    wiring: ['VCC → 3.3 V or 5 V', 'GND → GND', 'DATA → pin {{DATA}}, with 10 kΩ from DATA to VCC (bare sensors; modules have it)'],
    sketch: `
#include <DHT.h>

#define DHTPIN {{DATA}}
#define DHTTYPE DHT22  // DHT11 for the blue sensor

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(115200);
  dht.begin();
}

void loop() {
  delay(2000);  // a DHT22 answers at most every 2 s (DHT11: 1 s)
  float h = dht.readHumidity();
  float t = dht.readTemperature();
  if (isnan(h) || isnan(t)) {
    Serial.println("DHT read failed (wiring, pull-up, or read too soon)");
    return;
  }
  Serial.print(t); Serial.print(" C  ");
  Serial.print(h); Serial.println(" %");
}
`,
  },
  'ds18b20': {
    libs: ['OneWire', 'DallasTemperature'],
    pins: { default: { DATA: 2 }, esp32: { DATA: 4 } },
    wiring: ['VDD (red) → 3.3 V or 5 V', 'GND (black) → GND', 'DQ (yellow) → pin {{DATA}}, with 4.7 kΩ from DQ to VDD'],
    sketch: `
#include <OneWire.h>
#include <DallasTemperature.h>

OneWire oneWire({{DATA}});  // 4.7 kΩ pull-up from DATA to VCC
DallasTemperature sensors(&oneWire);

void setup() {
  Serial.begin(115200);
  sensors.begin();
}

void loop() {
  sensors.requestTemperatures();
  float c = sensors.getTempCByIndex(0);
  if (c == DEVICE_DISCONNECTED_C) Serial.println("DS18B20 not found");
  else { Serial.print(c); Serial.println(" C"); }
  delay(1000);
}
`,
  },
  'hc-sr04': {
    pins: { default: { TRIG: 9, ECHO: 10, ECHO_HOW: 'directly' }, esp32: { TRIG: 5, ECHO: 18, ECHO_HOW: 'through a divider (1 kΩ from ECHO to the pin, 2 kΩ from the pin to GND): ECHO is a 5 V signal' }, esp32c3: { TRIG: 5, ECHO: 6 } },
    wiring: ['VCC → 5 V (it does not work reliably from 3.3 V)', 'GND → GND', 'TRIG → pin {{TRIG}}', 'ECHO → pin {{ECHO}} {{ECHO_HOW}}'],
    sketch: `
const int TRIG_PIN = {{TRIG}};
const int ECHO_PIN = {{ECHO}};

void setup() {
  Serial.begin(115200);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
}

void loop() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long us = pulseIn(ECHO_PIN, HIGH, 30000UL);  // 30 ms timeout, about 5 m
  if (us == 0) Serial.println("no echo");
  else { Serial.print(us * 0.0343 / 2.0, 1); Serial.println(" cm"); }
  delay(100);  // at least 60 ms between pings
}
`,
  },
  'servo': {
    libs: { default: ['Servo'], esp32: ['ESP32Servo'] },
    pins: { default: { SIG: 9 }, esp32: { SIG: 18 } },
    wiring: ['Brown/black → GND, shared with the board', 'Red → 5 V from a supply that gives 1 A per servo (not the board\'s 3V3 pin; an SG90 on the Uno\'s 5 V pin is the limit)', 'Orange/yellow → pin {{SIG}}'],
    sketch: {
      default: `
#include <Servo.h>

Servo servo;

void setup() {
  servo.attach({{SIG}});  // 544–2400 µs pulses by default
}

void loop() {
  servo.write(0);   delay(1000);
  servo.write(90);  delay(1000);
  servo.write(180); delay(1000);
}
`,
      esp32: `
#include <ESP32Servo.h>  // the AVR Servo library does not build on the ESP32

Servo servo;

void setup() {
  servo.setPeriodHertz(50);
  servo.attach({{SIG}}, 500, 2400);  // pulse range in µs; narrow it if the servo buzzes at the ends
}

void loop() {
  servo.write(0);   delay(1000);
  servo.write(90);  delay(1000);
  servo.write(180); delay(1000);
}
`,
    },
  },
  'mpu6050': {
    libs: ['Adafruit MPU6050', 'Adafruit Unified Sensor', 'Adafruit BusIO'],
    pins: I2C_WIRING,
    wiring: i2cWiring('VCC → 3.3 V (GY-521 modules also take 5 V)'),
    sketch: `
#include <Wire.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>

Adafruit_MPU6050 mpu;

void setup() {
  Serial.begin(115200);
  if (!mpu.begin()) {  // mpu.begin(0x69) when AD0 is tied to VCC
    Serial.println("MPU6050 not found");
    while (true) delay(10);
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_4_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BAND_21_HZ);
}

void loop() {
  sensors_event_t a, g, t;
  mpu.getEvent(&a, &g, &t);
  Serial.print("ax "); Serial.print(a.acceleration.x);
  Serial.print(" ay "); Serial.print(a.acceleration.y);
  Serial.print(" az "); Serial.print(a.acceleration.z);
  Serial.print("  gz "); Serial.println(g.gyro.z);
  delay(100);
}
`,
  },
  'neopixel': {
    libs: ['Adafruit NeoPixel'],
    pins: { default: { DATA: 6 }, esp32: { DATA: 4 } },
    wiring: ['5V → 5 V supply (60 mA per LED at full white: more than 8 LEDs needs its own supply, GND shared)', 'GND → GND', 'DIN → pin {{DATA}} (a 330 Ω series resistor and a 1000 µF capacitor across the supply protect the strip)', 'Onboard LED on an ESP32-S3 DevKitC: pin 48 (38 on some clones), count 1'],
    sketch: `
#include <Adafruit_NeoPixel.h>

#define LED_PIN   {{DATA}}
#define LED_COUNT 8

Adafruit_NeoPixel strip(LED_COUNT, LED_PIN, NEO_GRB + NEO_KHZ800);

void setup() {
  strip.begin();
  strip.setBrightness(40);  // 0–255; keep it low on USB power
  strip.show();             // all off
}

void loop() {
  for (int i = 0; i < LED_COUNT; i++) {
    strip.clear();
    strip.setPixelColor(i, strip.Color(0, 120, 0));
    strip.show();
    delay(80);
  }
}
`,
  },
  'bme280': {
    libs: ['Adafruit BME280 Library', 'Adafruit Unified Sensor', 'Adafruit BusIO'],
    pins: I2C_WIRING,
    wiring: i2cWiring(),
    sketch: `
#include <Wire.h>
#include <Adafruit_Sensor.h>
#include <Adafruit_BME280.h>

Adafruit_BME280 bme;

void setup() {
  Serial.begin(115200);
  if (!bme.begin(0x76)) {  // 0x77 when SDO is tied to VCC; a BMP280 (no humidity) uses Adafruit_BMP280
    Serial.println("BME280 not found");
    while (true) delay(10);
  }
}

void loop() {
  Serial.print(bme.readTemperature()); Serial.print(" C  ");
  Serial.print(bme.readHumidity()); Serial.print(" %  ");
  Serial.print(bme.readPressure() / 100.0F); Serial.println(" hPa");
  delay(1000);
}
`,
  },
  'relay': {
    pins: { default: { IN: 7 }, esp32: { IN: 5 } },
    wiring: ['VCC → 5 V (the coil needs 5 V; JD-VCC jumper on for a single supply)', 'GND → GND', 'IN → pin {{IN}} (most modules switch on with LOW; 3.3 V boards usually trigger them, else use a transistor or a 3.3 V relay module)', 'Load: COM to the supply, NO to the load (open until energised)'],
    sketch: `
const int RELAY_PIN = {{IN}};
const bool ACTIVE_LOW = true;  // most blue relay modules switch on with LOW

void relay(bool on) { digitalWrite(RELAY_PIN, (on != ACTIVE_LOW) ? HIGH : LOW); }

void setup() {
  pinMode(RELAY_PIN, OUTPUT);
  relay(false);
}

void loop() {
  relay(true);  delay(2000);
  relay(false); delay(2000);
}
`,
  },
  'buzzer': {
    pins: { default: { BUZ: 8 }, esp32: { BUZ: 15 }, esp32c3: { BUZ: 6 } },
    wiring: ['+ → pin {{BUZ}}', '− → GND', 'Passive buzzers need tone(); active buzzers sound on a plain HIGH'],
    sketch: `
const int BUZZER_PIN = {{BUZ}};

void setup() {
  pinMode(BUZZER_PIN, OUTPUT);
}

void loop() {
  tone(BUZZER_PIN, 440, 200);  // passive buzzer: 440 Hz for 200 ms
  delay(400);
  tone(BUZZER_PIN, 880, 200);
  delay(1000);
  // Active buzzer (one fixed tone): digitalWrite(BUZZER_PIN, HIGH) / LOW instead of tone()
}
`,
  },
  'pir': {
    pins: { default: { OUT: 2 }, esp32: { OUT: 4 } },
    wiring: ['VCC → 5 V (HC-SR501; AM312 takes 3.3 V)', 'GND → GND', 'OUT → pin {{OUT}} (3.3 V logic output, safe on every board)'],
    sketch: `
const int PIR_PIN = {{OUT}};

void setup() {
  Serial.begin(115200);
  pinMode(PIR_PIN, INPUT);
  Serial.println("PIR warming up (30-60 s)...");
  delay(30000);
}

void loop() {
  static bool last = false;
  bool motion = digitalRead(PIR_PIN) == HIGH;
  if (motion != last) {
    Serial.println(motion ? "motion" : "quiet");
    last = motion;
  }
  delay(50);
}
`,
  },
  'ldr': {
    wiring: ['LDR between A0 and the board\'s supply (5 V on AVR, 3.3 V on ESP32)', '10 kΩ between A0 and GND (the divider; bright = higher reading)'],
    sketch: `
const int LDR_PIN = A0;  // LDR from A0 to VCC, 10 kΩ from A0 to GND

void setup() { Serial.begin(115200); }

void loop() {
  int raw = analogRead(LDR_PIN);  // 0–1023 on AVR, 0–4095 on ESP32
  Serial.println(raw);
  delay(200);
}
`,
  },
  'button': {
    pins: { default: { BTN: 2 }, esp32: { BTN: 4 } },
    wiring: ['One leg → pin {{BTN}}', 'Other leg → GND (INPUT_PULLUP: no resistor needed; pressed reads LOW)'],
    sketch: `
const int BUTTON_PIN = {{BTN}};  // button between the pin and GND

void setup() {
  Serial.begin(115200);
  pinMode(BUTTON_PIN, INPUT_PULLUP);  // pressed = LOW
}

void loop() {
  static bool wasPressed = false;
  static unsigned long changedAt = 0;
  bool pressed = digitalRead(BUTTON_PIN) == LOW;
  if (pressed != wasPressed && millis() - changedAt > 30) {  // 30 ms debounce
    wasPressed = pressed;
    changedAt = millis();
    if (pressed) Serial.println("pressed");
  }
}
`,
  },
  'led': {
    pins: { default: { LED: 9 }, esp32: { LED: 4 } },
    wiring: ['Anode (long leg) → 220 Ω → pin {{LED}}', 'Cathode (short leg) → GND'],
    sketch: `
const int LED_PIN = {{LED}};  // anode → 220 Ω → pin; cathode → GND

void setup() { pinMode(LED_PIN, OUTPUT); }

void loop() {
  for (int b = 0; b <= 255; b += 5) { analogWrite(LED_PIN, b); delay(10); }  // PWM fade up
  for (int b = 255; b >= 0; b -= 5) { analogWrite(LED_PIN, b); delay(10); }  // and down
}
`,
  },
  // ── Chunk 2: displays, input, motion, radio, storage, power ─────────────
  'tm1637': {
    libs: ['TM1637'],
    pins: { default: { CLK: 2, DIO: 3 }, esp32: { CLK: 4, DIO: 5 } },
    wiring: ['VCC → 3.3 V or 5 V', 'GND → GND', 'CLK → pin {{CLK}}', 'DIO → pin {{DIO}} (any two digital pins; it is not I2C)'],
    sketch: `
#include <TM1637Display.h>

TM1637Display display({{CLK}}, {{DIO}});  // CLK, DIO

void setup() {
  display.setBrightness(5);  // 0–7
}

void loop() {
  display.showNumberDecEx(1234, 0b01000000, true);  // colon on, leading zeros
  delay(1000);
  display.showNumberDec(millis() / 1000);
  delay(1000);
}
`,
  },
  'max7219': {
    libs: ['MD_MAX72XX'],
    pins: { default: { DIN: 11, CLK: 13, CS: 10 }, esp32: { DIN: 13, CLK: 14, CS: 15 }, esp32c3: { DIN: 4, CLK: 5, CS: 6 } },
    wiring: ['VCC → 5 V', 'GND → GND', 'DIN → pin {{DIN}}; CLK → pin {{CLK}}; CS → pin {{CS}} (bit-banged: any pins)', 'Chain modules DOUT → next DIN'],
    sketch: `
#include <MD_MAX72xx.h>  // works on AVR and ESP32 (LedControl needs avr/pgmspace.h and fails to build on the ESP32)
#include <SPI.h>

#define HARDWARE_TYPE MD_MAX72XX::FC16_HW  // the common blue 4-in-1 modules; GENERIC_HW or PAROLA_HW if the image is mirrored
MD_MAX72XX mx = MD_MAX72XX(HARDWARE_TYPE, {{DIN}}, {{CLK}}, {{CS}}, 1);  // DIN, CLK, CS, number of modules

void setup() {
  mx.begin();
  mx.control(MD_MAX72XX::INTENSITY, 4);  // 0–15
  mx.clear();
}

void loop() {
  for (int row = 0; row < 8; row++) {
    mx.clear();
    mx.setRow(row, 0xFF);  // one full row at a time
    delay(120);
  }
}
`,
  },
  'rotary-encoder': {
    pins: { default: { CLK: 2, DT: 3, SW: 4 }, esp32: { CLK: 4, DT: 5, SW: 15 }, esp32c3: { CLK: 4, DT: 5, SW: 6 } },
    wiring: ['+ → 3.3 V or 5 V (the board\'s logic level)', 'GND → GND', 'CLK → pin {{CLK}} (interrupt-capable: 2 or 3 on the Uno)', 'DT → pin {{DT}}', 'SW → pin {{SW}} (pressed = LOW with INPUT_PULLUP)'],
    sketch: `
#ifndef IRAM_ATTR
#define IRAM_ATTR  // the ESP32 wants interrupt handlers in RAM; other boards do not know the word
#endif

const int CLK_PIN = {{CLK}};
const int DT_PIN = {{DT}};
const int SW_PIN = {{SW}};

volatile long position = 0;

void IRAM_ATTR onTurn() {
  // On a CLK edge, DT tells the direction.
  if (digitalRead(DT_PIN) != digitalRead(CLK_PIN)) position++;
  else position--;
}

void setup() {
  Serial.begin(115200);
  pinMode(CLK_PIN, INPUT_PULLUP);
  pinMode(DT_PIN, INPUT_PULLUP);
  pinMode(SW_PIN, INPUT_PULLUP);
  attachInterrupt(digitalPinToInterrupt(CLK_PIN), onTurn, CHANGE);
}

void loop() {
  static long shown = 0;
  if (position != shown) { shown = position; Serial.println(shown); }
  if (digitalRead(SW_PIN) == LOW) { Serial.println("pressed"); delay(200); }
}
`,
  },
  'joystick': {
    pins: { default: { X: 'A0', Y: 'A1', SW: 2 }, esp32: { X: 34, Y: 35, SW: 4 }, esp32s2: { X: 1, Y: 2, SW: 4 }, esp32s3: { X: 1, Y: 2, SW: 4 }, esp32c3: { X: 0, Y: 1, SW: 4 }, esp32c6: { X: 0, Y: 1, SW: 4 } },
    wiring: ['VCC → the board\'s ADC supply (5 V on AVR, 3.3 V on ESP32: the axes output the supply voltage)', 'GND → GND', 'VRx → pin {{X}}; VRy → pin {{Y}} (analog inputs)', 'SW → pin {{SW}} (pressed = LOW with INPUT_PULLUP)'],
    sketch: `
const int X_PIN = {{X}}, Y_PIN = {{Y}}, SW_PIN = {{SW}};

void setup() {
  Serial.begin(115200);
  pinMode(SW_PIN, INPUT_PULLUP);
}

void loop() {
  Serial.print("x "); Serial.print(analogRead(X_PIN));
  Serial.print(" y "); Serial.print(analogRead(Y_PIN));
  Serial.println(digitalRead(SW_PIN) == LOW ? " pressed" : "");
  delay(100);
}
`,
  },
  'keypad': {
    libs: ['Keypad'],
    pins: { default: { R1: 9, R2: 8, R3: 7, R4: 6, C1: 5, C2: 4, C3: 3, C4: 2 }, esp32: { R1: 13, R2: 14, R3: 15, R4: 16, C1: 17, C2: 18, C3: 4, C4: 5 }, esp32c3: { R1: 2, R2: 3, R3: 4, R4: 5, C1: 6, C2: 7, C3: 10, C4: 21 } },
    wiring: ['Keypad pins 1–4 (rows) → pins {{R1}}, {{R2}}, {{R3}}, {{R4}}', 'Keypad pins 5–8 (columns) → pins {{C1}}, {{C2}}, {{C3}}, {{C4}}', 'No power or resistors: the library scans with internal pull-ups'],
    sketch: `
#include <Keypad.h>

const byte ROWS = 4, COLS = 4;
char keys[ROWS][COLS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte rowPins[ROWS] = {{{R1}}, {{R2}}, {{R3}}, {{R4}}};  // keypad pins 1–4, left to right
byte colPins[COLS] = {{{C1}}, {{C2}}, {{C3}}, {{C4}}};  // keypad pins 5–8

Keypad keypad = Keypad(makeKeymap(keys), rowPins, colPins, ROWS, COLS);

void setup() { Serial.begin(115200); }

void loop() {
  char key = keypad.getKey();
  if (key) Serial.println(key);
}
`,
  },
  'stepper-28byj48': {
    libs: ['Stepper'],
    pins: { default: { IN1: 8, IN2: 9, IN3: 10, IN4: 11 }, esp32: { IN1: 13, IN2: 14, IN3: 15, IN4: 16 }, esp32c3: { IN1: 2, IN2: 3, IN3: 4, IN4: 5 } },
    wiring: ['ULN2003 IN1–IN4 → pins {{IN1}}, {{IN2}}, {{IN3}}, {{IN4}}', 'ULN2003 − → GND (shared); + → 5 V from a supply or the board\'s 5 V pin (240 mA)', 'Motor plug into the ULN2003 header'],
    sketch: `
#include <Stepper.h>

const int STEPS_PER_REV = 2048;  // 28BYJ-48 with its 1:64 gearbox, full-step
// The ULN2003 inputs IN1..IN4 go to the Stepper as IN1, IN3, IN2, IN4 (the coil order).
Stepper stepper(STEPS_PER_REV, {{IN1}}, {{IN3}}, {{IN2}}, {{IN4}});

void setup() {
  stepper.setSpeed(10);  // rpm; above about 15 it stalls
}

void loop() {
  stepper.step(STEPS_PER_REV);   // one turn one way
  delay(500);
  stepper.step(-STEPS_PER_REV);  // and back
  delay(500);
}
`,
  },
  'stepper-driver': {
    libs: ['AccelStepper'],
    pins: { default: { STEP: 3, DIR: 2, EN: 4 }, esp32: { STEP: 4, DIR: 5, EN: 15 }, esp32c3: { STEP: 4, DIR: 5, EN: 6 } },
    wiring: ['STEP → pin {{STEP}}; DIR → pin {{DIR}}; EN → pin {{EN}} (or EN to GND: always enabled)', 'VDD → 3.3/5 V logic; GND → GND (shared)', 'VMOT → 8–35 V motor supply with a 100 µF capacitor right at the driver; never unplug the motor while powered', 'MS1–MS3 set microstepping; set the current limit with the trim pot (Vref) before the first run'],
    sketch: `
#include <AccelStepper.h>

AccelStepper stepper(AccelStepper::DRIVER, {{STEP}}, {{DIR}});  // STEP, DIR
const int EN_PIN = {{EN}};  // the driver's ENABLE is active-LOW

void setup() {
  pinMode(EN_PIN, OUTPUT);
  digitalWrite(EN_PIN, LOW);
  stepper.setMaxSpeed(1000);     // steps per second
  stepper.setAcceleration(500);  // steps per second²
  stepper.moveTo(1600);          // 8 turns at 200 full steps per revolution
}

void loop() {
  if (stepper.distanceToGo() == 0) stepper.moveTo(-stepper.currentPosition());
  stepper.run();  // call it constantly: no delay() in loop
}
`,
  },
  'dc-motor-driver': {
    pins: { default: { IN1: 7, IN2: 8, EN: 9 }, esp32: { IN1: 16, IN2: 17, EN: 4 }, esp32c3: { IN1: 5, IN2: 6, EN: 4 } },
    wiring: ['IN1 → pin {{IN1}}; IN2 → pin {{IN2}}; ENA → pin {{EN}} (PWM; remove the ENA jumper)', '12V (VMS) → motor supply; GND → GND shared with the board; 5V out can power an Uno only when the 5V-EN jumper is on and VMS ≤ 12 V', 'OUT1/OUT2 → the motor'],
    sketch: `
const int IN1 = {{IN1}}, IN2 = {{IN2}}, ENA = {{EN}};  // ENA needs a PWM pin

void drive(int speed) {  // -255..255
  digitalWrite(IN1, speed > 0 ? HIGH : LOW);
  digitalWrite(IN2, speed < 0 ? HIGH : LOW);
  analogWrite(ENA, abs(speed));
}

void setup() {
  pinMode(IN1, OUTPUT); pinMode(IN2, OUTPUT); pinMode(ENA, OUTPUT);
}

void loop() {
  drive(200);  delay(2000);
  drive(0);    delay(500);
  drive(-200); delay(2000);
  drive(0);    delay(500);
}
`,
  },
  'shift-register': {
    pins: { default: { DATA: 11, CLOCK: 12, LATCH: 8 }, esp32: { DATA: 13, CLOCK: 14, LATCH: 15 }, esp32c3: { DATA: 4, CLOCK: 5, LATCH: 6 } },
    wiring: ['DS (14) → pin {{DATA}}; SHCP (11) → pin {{CLOCK}}; STCP (12) → pin {{LATCH}}', 'VCC (16) and MR (10) → VCC; GND (8) and OE (13) → GND', 'Q0–Q7 → LEDs through 220 Ω; Q7\' (9) → DS of the next register'],
    sketch: `
const int DATA_PIN = {{DATA}}, CLOCK_PIN = {{CLOCK}}, LATCH_PIN = {{LATCH}};  // DS, SHCP, STCP

void show(byte value) {
  digitalWrite(LATCH_PIN, LOW);
  shiftOut(DATA_PIN, CLOCK_PIN, MSBFIRST, value);
  digitalWrite(LATCH_PIN, HIGH);
}

void setup() {
  pinMode(DATA_PIN, OUTPUT); pinMode(CLOCK_PIN, OUTPUT); pinMode(LATCH_PIN, OUTPUT);
}

void loop() {
  for (int i = 0; i < 8; i++) { show(1 << i); delay(100); }  // one output at a time, Q0..Q7
}
`,
  },
  'mfrc522': {
    libs: ['MFRC522'],
    pins: { default: { SS: 10, RST: 9, MOSI: 11, MISO: 12, SCK: 13 }, esp32: { SS: 5, RST: 4, MOSI: 23, MISO: 19, SCK: 18 }, esp32s3: { SS: 10, RST: 9, MOSI: 11, MISO: 13, SCK: 12 }, esp32s2: { SS: 34, RST: 9, MOSI: 35, MISO: 37, SCK: 36 }, esp32c3: { SS: 7, RST: 10, MOSI: 6, MISO: 5, SCK: 4 } },
    wiring: ['3.3V → 3.3 V ONLY (5 V kills it); GND → GND', 'SDA/SS → pin {{SS}}; RST → pin {{RST}}', 'MOSI → pin {{MOSI}}; MISO → pin {{MISO}}; SCK → pin {{SCK}} (the board\'s SPI pins)', 'On 5 V boards the SPI lines are 5 V: it usually survives, a level shifter is correct'],
    sketch: `
#include <SPI.h>
#include <MFRC522.h>

MFRC522 rfid({{SS}}, {{RST}});  // SDA/SS, RST

void setup() {
  Serial.begin(115200);
  SPI.begin();
  rfid.PCD_Init();
  Serial.println("Hold a tag near the reader");
}

void loop() {
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  Serial.print("UID:");
  for (byte i = 0; i < rfid.uid.size; i++) {
    Serial.print(rfid.uid.uidByte[i] < 0x10 ? " 0" : " ");
    Serial.print(rfid.uid.uidByte[i], HEX);
  }
  Serial.println();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
}
`,
  },
  'ir-receiver': {
    libs: ['IRremote'],
    pins: { default: { IR: 2 }, esp32: { IR: 4 } },
    wiring: ['OUT → pin {{IR}}', 'GND → GND', 'VCC → 3.3 V or 5 V'],
    sketch: `
#include <IRremote.hpp>  // IRremote 4.x: include the .hpp in exactly one file

const int IR_PIN = {{IR}};

void setup() {
  Serial.begin(115200);
  IrReceiver.begin(IR_PIN, ENABLE_LED_FEEDBACK);
}

void loop() {
  if (IrReceiver.decode()) {
    Serial.print("protocol "); Serial.print((int)IrReceiver.decodedIRData.protocol);
    Serial.print("  command 0x"); Serial.println(IrReceiver.decodedIRData.command, HEX);
    IrReceiver.resume();  // ready for the next code
  }
}
`,
  },
  'hc05': {
    pins: { default: { RX: 10, TX: 11 }, esp32: { RX: 16, TX: 17 }, esp32c3: { RX: 4, TX: 5 } },
    wiring: ['VCC → 5 V (3.6–6 V); GND → GND', 'Module TXD → board pin {{RX}} (board RX)', 'Module RXD → board pin {{TX}} (board TX) through a 1 kΩ/2 kΩ divider on 5 V boards: RXD is 3.3 V logic', 'Pair from the phone with PIN 1234 (HC-05) or 0000 (HC-06); a serial terminal app talks to it'],
    sketch: {
      default: `
#include <SoftwareSerial.h>

SoftwareSerial bt({{RX}}, {{TX}});  // board RX (from module TXD), board TX (to module RXD via a divider)

void setup() {
  Serial.begin(115200);
  bt.begin(9600);  // HC-05 default 9600 (38400 in AT mode)
}

void loop() {
  if (bt.available()) Serial.write(bt.read());
  if (Serial.available()) bt.write(Serial.read());
}
`,
      esp32: `
// A hardware UART: the ESP32 has no SoftwareSerial (and has Bluetooth of its own: see BLE / BluetoothSerial).
const int RX_PIN = {{RX}}, TX_PIN = {{TX}};

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600, SERIAL_8N1, RX_PIN, TX_PIN);
}

void loop() {
  if (Serial1.available()) Serial.write(Serial1.read());
  if (Serial.available()) Serial1.write(Serial.read());
}
`,
    },
  },
  'gps': {
    libs: ['TinyGPSPlus'],
    pins: { default: { RX: 10, TX: 11 }, esp32: { RX: 16, TX: 17 }, esp32c3: { RX: 4, TX: 5 } },
    wiring: ['VCC → 3.3 V or 5 V (module); GND → GND', 'GPS TX → board pin {{RX}} (board RX)', 'GPS RX → board pin {{TX}} (optional, only to configure it; through a divider on 5 V boards)', 'The antenna needs the sky: the first fix takes minutes outdoors and may never come indoors'],
    sketch: {
      default: `
#include <SoftwareSerial.h>
#include <TinyGPS++.h>

SoftwareSerial gpsSerial({{RX}}, {{TX}});  // board RX from the GPS TX
TinyGPSPlus gps;

void setup() {
  Serial.begin(115200);
  gpsSerial.begin(9600);  // NEO-6M default
}

void loop() {
  while (gpsSerial.available()) gps.encode(gpsSerial.read());
  static unsigned long last = 0;
  if (millis() - last > 1000) {
    last = millis();
    if (gps.location.isValid()) {
      Serial.print(gps.location.lat(), 6); Serial.print(", "); Serial.println(gps.location.lng(), 6);
    } else {
      Serial.print("waiting for a fix, satellites: "); Serial.println(gps.satellites.value());
    }
  }
}
`,
      esp32: `
#include <TinyGPS++.h>

const int RX_PIN = {{RX}}, TX_PIN = {{TX}};
TinyGPSPlus gps;

void setup() {
  Serial.begin(115200);
  Serial1.begin(9600, SERIAL_8N1, RX_PIN, TX_PIN);  // NEO-6M default 9600
}

void loop() {
  while (Serial1.available()) gps.encode(Serial1.read());
  static unsigned long last = 0;
  if (millis() - last > 1000) {
    last = millis();
    if (gps.location.isValid()) {
      Serial.print(gps.location.lat(), 6); Serial.print(", "); Serial.println(gps.location.lng(), 6);
    } else {
      Serial.print("waiting for a fix, satellites: "); Serial.println(gps.satellites.value());
    }
  }
}
`,
    },
  },
  'sd-card': {
    libs: { default: ['SD'], esp32: [] },
    pins: { default: { CS: 10, MOSI: 11, MISO: 12, SCK: 13 }, esp32: { CS: 5, MOSI: 23, MISO: 19, SCK: 18 }, esp32s3: { CS: 10, MOSI: 11, MISO: 13, SCK: 12 }, esp32s2: { CS: 34, MOSI: 35, MISO: 37, SCK: 36 }, esp32c3: { CS: 7, MOSI: 6, MISO: 5, SCK: 4 } },
    wiring: ['CS → pin {{CS}}; MOSI → pin {{MOSI}}; MISO → pin {{MISO}}; SCK → pin {{SCK}}', 'VCC → 5 V on modules with a regulator and level shifter, 3.3 V on bare micro-SD adapters; GND → GND', 'Card formatted FAT32 (FAT16 for ≤ 2 GB); 32 GB or smaller'],
    sketch: {
      default: `
#include <SPI.h>
#include <SD.h>

const int CS_PIN = {{CS}};

void setup() {
  Serial.begin(115200);
  if (!SD.begin(CS_PIN)) {
    Serial.println("SD failed: wiring, CS pin, FAT32 formatting, or the card wants 3.3 V");
    while (true) delay(10);
  }
  File f = SD.open("log.txt", FILE_WRITE);  // creates it, writes at the end
  if (f) { f.println("hello from the board"); f.close(); Serial.println("written"); }
  else Serial.println("could not open log.txt");
}

void loop() {}
`,
      esp32: `
#include <SPI.h>
#include <SD.h>

const int CS_PIN = {{CS}};

void setup() {
  Serial.begin(115200);
  if (!SD.begin(CS_PIN)) {
    Serial.println("SD failed: wiring, CS pin, FAT32 formatting, or the card wants 3.3 V");
    while (true) delay(10);
  }
  File f = SD.open("/log.txt", FILE_APPEND);  // ESP32: paths start with '/'; FILE_WRITE would truncate
  if (f) { f.println("hello from the board"); f.close(); Serial.println("written"); }
  else Serial.println("could not open /log.txt");
}

void loop() {}
`,
    },
  },
  'rtc': {
    libs: ['RTClib', 'Adafruit BusIO'],
    pins: I2C_WIRING,
    wiring: i2cWiring('VCC → 3.3 V or 5 V (DS3231); 5 V (DS1307)'),
    sketch: `
#include <Wire.h>
#include <RTClib.h>

RTC_DS3231 rtc;  // RTC_DS1307 rtc; for the DS1307

void setup() {
  Serial.begin(115200);
  if (!rtc.begin()) { Serial.println("RTC not found"); while (true) delay(10); }
  if (rtc.lostPower()) rtc.adjust(DateTime(F(__DATE__), F(__TIME__)));  // set once from the compile time
}

void loop() {
  DateTime now = rtc.now();
  char buf[] = "YYYY-MM-DD hh:mm:ss";
  Serial.println(now.toString(buf));
  delay(1000);
}
`,
  },
  'bh1750': {
    libs: ['BH1750'],
    pins: I2C_WIRING,
    wiring: i2cWiring(),
    sketch: `
#include <Wire.h>
#include <BH1750.h>

BH1750 lightMeter;  // 0x23 with ADDR low; BH1750 lightMeter(0x5C); with ADDR high

void setup() {
  Serial.begin(115200);
  Wire.begin();
  lightMeter.begin();
}

void loop() {
  Serial.print(lightMeter.readLightLevel()); Serial.println(" lx");
  delay(500);
}
`,
  },
  'vl53l0x': {
    libs: ['Adafruit_VL53L0X', 'Adafruit BusIO'],
    pins: I2C_WIRING,
    wiring: i2cWiring(),
    sketch: `
#include <Wire.h>
#include <Adafruit_VL53L0X.h>

Adafruit_VL53L0X lox;

void setup() {
  Serial.begin(115200);
  if (!lox.begin()) { Serial.println("VL53L0X not found"); while (true) delay(10); }
}

void loop() {
  VL53L0X_RangingMeasurementData_t m;
  lox.rangingTest(&m, false);
  if (m.RangeStatus != 4) { Serial.print(m.RangeMilliMeter); Serial.println(" mm"); }
  else Serial.println("out of range");
  delay(100);
}
`,
  },
  'ads1115': {
    libs: ['Adafruit ADS1X15', 'Adafruit BusIO'],
    pins: I2C_WIRING,
    wiring: [...i2cWiring(), 'ADDR → GND for 0x48 (VDD 0x49, SDA 0x4A, SCL 0x4B)', 'A0–A3 → the signals (never above VDD + 0.3 V)'],
    sketch: `
#include <Wire.h>
#include <Adafruit_ADS1X15.h>

Adafruit_ADS1115 ads;  // Adafruit_ADS1015 ads; for the 12-bit part

void setup() {
  Serial.begin(115200);
  ads.setGain(GAIN_ONE);  // ±4.096 V full scale
  if (!ads.begin()) { Serial.println("ADS1115 not found"); while (true) delay(10); }  // ads.begin(0x49) with ADDR to VDD
}

void loop() {
  int16_t raw = ads.readADC_SingleEnded(0);
  Serial.print(raw); Serial.print("  "); Serial.print(ads.computeVolts(raw), 4); Serial.println(" V");
  delay(500);
}
`,
  },
  'ina219': {
    libs: ['Adafruit INA219', 'Adafruit BusIO'],
    pins: I2C_WIRING,
    wiring: [...i2cWiring(), 'VIN+ → supply, VIN− → the load (the shunt sits in the positive lead); GND shared with the load'],
    sketch: `
#include <Wire.h>
#include <Adafruit_INA219.h>

Adafruit_INA219 ina219;  // 0x40

void setup() {
  Serial.begin(115200);
  if (!ina219.begin()) { Serial.println("INA219 not found"); while (true) delay(10); }
}

void loop() {
  Serial.print(ina219.getBusVoltage_V()); Serial.print(" V  ");
  Serial.print(ina219.getCurrent_mA()); Serial.print(" mA  ");
  Serial.print(ina219.getPower_mW()); Serial.println(" mW");
  delay(1000);
}
`,
  },
  'pca9685': {
    libs: ['Adafruit PWM Servo Driver Library', 'Adafruit BusIO'],
    pins: I2C_WIRING,
    wiring: [...i2cWiring('VCC → 3.3 V or 5 V (logic)'), 'V+ → 5–6 V servo supply through the screw terminal (its own supply; GND shared)', 'Servos on channels 0–15 (signal, V+, GND rows)'],
    sketch: `
#include <Wire.h>
#include <Adafruit_PWMServoDriver.h>

Adafruit_PWMServoDriver pwm;  // 0x40

const int SERVO_MIN = 110, SERVO_MAX = 500;  // ticks of 4096 at 50 Hz (about 0.5–2.4 ms); tune per servo

void setup() {
  pwm.begin();
  pwm.setPWMFreq(50);
}

void loop() {
  pwm.setPWM(0, 0, SERVO_MIN); delay(1000);  // channel 0 to one end
  pwm.setPWM(0, 0, SERVO_MAX); delay(1000);  // and the other
}
`,
  },
  'hx711': {
    libs: ['HX711 Arduino Library'],
    pins: { default: { DT: 3, SCK: 2 }, esp32: { DT: 16, SCK: 4 }, esp32c3: { DT: 4, SCK: 5 } },
    wiring: ['VCC → 3.3 V or 5 V; GND → GND', 'DT → pin {{DT}}; SCK → pin {{SCK}}', 'Load cell: red → E+, black → E−, white → A−, green → A+'],
    sketch: `
#include <HX711.h>

HX711 scale;
const int DT_PIN = {{DT}}, SCK_PIN = {{SCK}};

void setup() {
  Serial.begin(115200);
  scale.begin(DT_PIN, SCK_PIN);
  scale.set_scale();  // 1 = raw units; put a known weight on and divide to find your factor
  scale.tare();       // zero with nothing on the cell
}

void loop() {
  if (scale.is_ready()) Serial.println(scale.get_units(5), 1);
  else Serial.println("HX711 not ready");
  delay(500);
}
`,
  },
  'nrf24l01': {
    libs: ['RF24'],
    pins: { default: { CE: 9, CSN: 10, MOSI: 11, MISO: 12, SCK: 13 }, esp32: { CE: 4, CSN: 5, MOSI: 23, MISO: 19, SCK: 18 }, esp32s3: { CE: 4, CSN: 10, MOSI: 11, MISO: 13, SCK: 12 }, esp32s2: { CE: 4, CSN: 34, MOSI: 35, MISO: 37, SCK: 36 }, esp32c3: { CE: 10, CSN: 7, MOSI: 6, MISO: 5, SCK: 4 } },
    wiring: ['VCC → 3.3 V ONLY with a 10 µF capacitor across VCC/GND at the module; GND → GND', 'CE → pin {{CE}}; CSN → pin {{CSN}}', 'MOSI → pin {{MOSI}}; MISO → pin {{MISO}}; SCK → pin {{SCK}}', 'Short wires; the same code on both boards with isSender flipped'],
    sketch: `
#include <SPI.h>
#include <RF24.h>

RF24 radio({{CE}}, {{CSN}});  // CE, CSN
const byte ADDRESS[6] = "node1";
bool isSender = true;  // flash false onto the other board

void setup() {
  Serial.begin(115200);
  if (!radio.begin()) { Serial.println("nRF24 not found (3.3 V supply, 10 uF across it, short wires)"); while (true) delay(10); }
  radio.setPALevel(RF24_PA_LOW);
  radio.setDataRate(RF24_1MBPS);
  if (isSender) { radio.openWritingPipe(ADDRESS); radio.stopListening(); }
  else { radio.openReadingPipe(1, ADDRESS); radio.startListening(); }
}

void loop() {
  if (isSender) {
    unsigned long t = millis();
    Serial.println(radio.write(&t, sizeof(t)) ? "sent" : "no ack");
    delay(1000);
  } else if (radio.available()) {
    unsigned long t;
    radio.read(&t, sizeof(t));
    Serial.print("got "); Serial.println(t);
  }
}
`,
  },
  'soil-moisture': {
    pins: { default: { DRY: 800, WET: 400 }, esp32: { DRY: 3000, WET: 1200 } },
    wiring: ['VCC → 3.3 V or 5 V (or a GPIO, HIGH only while reading, to slow corrosion of resistive probes); GND → GND', 'AOUT → A0 (analog); DOUT is a threshold output set by the pot, usually unused'],
    sketch: `
const int SENSOR_PIN = A0;
const int DRY = {{DRY}}, WET = {{WET}};  // measure yours: the reading in air, then in water

void setup() { Serial.begin(115200); }

void loop() {
  int raw = analogRead(SENSOR_PIN);
  int percent = constrain(map(raw, DRY, WET, 0, 100), 0, 100);
  Serial.print(raw); Serial.print("  "); Serial.print(percent); Serial.println(" %");
  delay(1000);
}
`,
  },
  'mq-gas': {
    wiring: ['VCC → 5 V (the heater draws about 150 mA; not from a 3V3 pin); GND → GND', 'AO → A0 on 5 V boards; on 3.3 V boards through a 1 kΩ/2 kΩ divider (AO goes up to 5 V)', 'DO → optional digital threshold set by the pot'],
    sketch: `
const int MQ_PIN = A0;

void setup() {
  Serial.begin(115200);
  Serial.println("warming up: 2-3 minutes for stable readings, 24 h burn-in for a new sensor");
}

void loop() {
  Serial.println(analogRead(MQ_PIN));  // relative level; ppm needs the datasheet curve and a clean-air baseline (R0)
  delay(1000);
}
`,
  },
  // ── ESP32 features ───────────────────────────────────────────────────────
  'esp32-wifi': {
    sketch: { esp32: `
#include <WiFi.h>
#include <HTTPClient.h>

const char* WIFI_SSID = "your-network";  // 2.4 GHz only
const char* WIFI_PASS = "your-password";

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  Serial.print("connecting");
  while (WiFi.status() != WL_CONNECTED) { delay(500); Serial.print('.'); }
  Serial.println();
  Serial.print("IP "); Serial.println(WiFi.localIP());
}

void loop() {
  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin("http://worldtimeapi.org/api/ip");  // https: WiFiClientSecure client; client.setInsecure(); http.begin(client, url)
    int code = http.GET();
    if (code > 0) { Serial.println(code); Serial.println(http.getString().substring(0, 200)); }
    else Serial.println(http.errorToString(code));
    http.end();
  }
  delay(10000);
}
` },
  },
  'esp32-webserver': {
    pins: { esp32: { LED: 4 } },
    wiring: ['LED anode → 220 Ω → pin {{LED}}; cathode → GND (or drive a relay the same way)'],
    sketch: { esp32: `
#include <WiFi.h>
#include <WebServer.h>

const char* WIFI_SSID = "your-network";
const char* WIFI_PASS = "your-password";
const int LED_PIN = {{LED}};
WebServer server(80);

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  Serial.print("open http://"); Serial.println(WiFi.localIP());
  server.on("/", []() { server.send(200, "text/html", "<h1>Board</h1><a href='/on'>LED on</a> | <a href='/off'>LED off</a>"); });
  server.on("/on", []() { digitalWrite(LED_PIN, HIGH); server.sendHeader("Location", "/"); server.send(303); });
  server.on("/off", []() { digitalWrite(LED_PIN, LOW); server.sendHeader("Location", "/"); server.send(303); });
  server.begin();
}

void loop() { server.handleClient(); }
` },
  },
  'esp32-mqtt': {
    libs: { esp32: ['PubSubClient'] },
    sketch: { esp32: `
#include <WiFi.h>
#include <PubSubClient.h>

const char* WIFI_SSID = "your-network";
const char* WIFI_PASS = "your-password";
const char* MQTT_HOST = "broker.hivemq.com";  // public test broker: port 1883, no login, anyone can read it

WiFiClient net;
PubSubClient mqtt(net);

void onMessage(char* topic, byte* payload, unsigned int length) {
  Serial.print(topic); Serial.print(": ");
  Serial.write(payload, length);
  Serial.println();
}

void connectMqtt() {
  while (!mqtt.connected()) {
    String id = "impulse-" + String((uint32_t)ESP.getEfuseMac(), HEX);
    if (mqtt.connect(id.c_str())) mqtt.subscribe("impulse/demo/cmd");  // mqtt.connect(id, user, pass) for a private broker
    else delay(2000);
  }
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(500);
  mqtt.setServer(MQTT_HOST, 1883);
  mqtt.setCallback(onMessage);
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();  // keeps the connection alive and delivers messages
  static unsigned long last = 0;
  if (millis() - last > 5000) {
    last = millis();
    mqtt.publish("impulse/demo/uptime", String(millis() / 1000).c_str());
  }
}
` },
  },
  'esp-now': {
    sketch: { esp32: `
#include <WiFi.h>
#include <esp_now.h>

// Flash this on both boards. Broadcast reaches every ESP32 nearby; put the other board's MAC
// (it prints "my MAC") in PEER to talk to it alone.
uint8_t PEER[6] = {0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF};

struct Message { uint32_t count; float value; };

void onReceive(const esp_now_recv_info_t* info, const uint8_t* data, int len) {  // core 3.x callback signature
  Message m;
  memcpy(&m, data, sizeof(m));
  Serial.printf("from %02X:%02X:%02X:%02X:%02X:%02X  count %lu  value %.2f\\n",
                info->src_addr[0], info->src_addr[1], info->src_addr[2], info->src_addr[3], info->src_addr[4], info->src_addr[5],
                (unsigned long)m.count, m.value);
}

void setup() {
  Serial.begin(115200);
  WiFi.mode(WIFI_STA);  // required; both boards must also sit on the same Wi-Fi channel
  Serial.print("my MAC "); Serial.println(WiFi.macAddress());
  if (esp_now_init() != ESP_OK) { Serial.println("esp_now_init failed"); while (true) delay(10); }
  esp_now_register_recv_cb(onReceive);
  esp_now_peer_info_t peer = {};
  memcpy(peer.peer_addr, PEER, 6);
  peer.channel = 0;
  peer.encrypt = false;
  esp_now_add_peer(&peer);
}

void loop() {
  static Message m = {0, 0};
  m.count++;
  m.value = millis() / 1000.0f;
  esp_now_send(PEER, (uint8_t*)&m, sizeof(m));
  delay(2000);
}
` },
  },
  'esp32-deep-sleep': {
    sketch: { esp32: `
#include <esp_sleep.h>

RTC_DATA_ATTR int bootCount = 0;  // RTC memory survives deep sleep (not a power cycle)
const uint64_t SLEEP_SECONDS = 10;

void setup() {
  Serial.begin(115200);
  delay(2000);  // native-USB boards (S3, C3, S2): the port re-enumerates and the monitor reconnects 1–2 s after wake
  bootCount++;
  Serial.printf("Boot %d, wake cause %d\\n", bootCount, (int)esp_sleep_get_wakeup_cause());  // 4 = timer, 2 = ext0 pin, 0 = power-on/reset
  Serial.println("Working for 3 s...");
  delay(3000);
  esp_sleep_enable_timer_wakeup(SLEEP_SECONDS * 1000000ULL);
  // Wake on a pin too: classic/S2/S3 esp_sleep_enable_ext0_wakeup(GPIO_NUM_4, 0) on an RTC pin; C3/C6 esp_deep_sleep_enable_gpio_wakeup().
  Serial.println("Sleeping");
  Serial.flush();
  esp_deep_sleep_start();  // never returns: the chip restarts in setup()
}

void loop() {}
` },
  },
  'esp32-preferences': {
    sketch: { esp32: `
#include <Preferences.h>

Preferences prefs;

void setup() {
  Serial.begin(115200);
  prefs.begin("app", false);  // namespace (up to 15 chars), read-write
  uint32_t boots = prefs.getUInt("boots", 0) + 1;
  prefs.putUInt("boots", boots);  // also putString, putFloat, putBool, putBytes
  prefs.end();
  Serial.printf("This board has booted %lu times\\n", (unsigned long)boots);
  // EEPROM.h still works on the ESP32, but Preferences (NVS) wears the flash evenly and survives re-uploads.
}

void loop() {}
` },
  },
  'esp32-ledc': {
    pins: { esp32: { PWM: 4 } },
    wiring: ['LED anode → 220 Ω → pin {{PWM}}; cathode → GND (any output-capable pin works)'],
    sketch: { esp32: `
const int PWM_PIN = {{PWM}};
const int FREQ = 5000, RESOLUTION = 8;  // 8 bits: duty 0–255

void setup() {
  ledcAttach(PWM_PIN, FREQ, RESOLUTION);  // core 3.x: pins, not channels (ledcSetup/ledcAttachPin are gone)
}

void loop() {
  for (int d = 0; d <= 255; d += 5) { ledcWrite(PWM_PIN, d); delay(8); }
  for (int d = 255; d >= 0; d -= 5) { ledcWrite(PWM_PIN, d); delay(8); }
  // analogWrite(pin, 0–255) also works on the ESP32 core; for servos use ESP32Servo.
}
` },
  },
  'esp32-touch': {
    pins: { esp32: { TOUCH: 4, NOTE: 'T0 = GPIO4; values about 70 that DROP when touched' }, esp32s2: { TOUCH: 1, NOTE: 'T1 = GPIO1; values about 20,000–30,000 that RISE when touched' }, esp32s3: { TOUCH: 1, NOTE: 'T1 = GPIO1; values about 20,000–30,000 that RISE when touched' }, esp32c3: null, esp32c6: null, esp32h2: null },
    wiring: ['A wire, foil pad or screw → pin {{TOUCH}} ({{NOTE}}); nothing else'],
    sketch: { esp32: `
// Classic ESP32: T0..T9 (T0 = GPIO4, T3 = GPIO15, T4 = GPIO13, T5 = GPIO12, T6 = GPIO14, T7 = GPIO27, T8 = GPIO33, T9 = GPIO32):
//   readings around 70 that DROP when touched.
// ESP32-S2/S3: T1..T14 = GPIO1..14: readings around 20,000–30,000 that RISE when touched.
// The C3, C6 and H2 have no touch pads.
const int TOUCH_PIN = {{TOUCH}};

void setup() {
  Serial.begin(115200);
  delay(500);
}

void loop() {
  uint32_t v = touchRead(TOUCH_PIN);
  Serial.println(v);
  delay(200);
}
` },
  },
  'esp32-ble': {
    sketch: { esp32: `
#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Open "nRF Connect" on a phone, connect to "Impulse", and watch the value change once a second.
// A BLE sketch is about 1.2 MB: pick Partition Scheme "Huge APP" or "Minimal SPIFFS" in Board Options if it does not fit.
#define SERVICE_UUID        "4fafc201-1fb5-459e-8fcc-c5c9c331914b"
#define CHARACTERISTIC_UUID "beb5483e-36e1-4688-b7f5-ea07361b26a8"

BLECharacteristic* characteristic;

void setup() {
  Serial.begin(115200);
  BLEDevice::init("Impulse");
  BLEServer* server = BLEDevice::createServer();
  BLEService* service = server->createService(SERVICE_UUID);
  characteristic = service->createCharacteristic(CHARACTERISTIC_UUID, BLECharacteristic::PROPERTY_READ | BLECharacteristic::PROPERTY_NOTIFY);
  characteristic->addDescriptor(new BLE2902());
  service->start();
  BLEAdvertising* adv = BLEDevice::getAdvertising();
  adv->addServiceUUID(SERVICE_UUID);
  adv->start();
  Serial.println("advertising as Impulse");
}

void loop() {
  String value = String(millis() / 1000);
  characteristic->setValue(value.c_str());
  characteristic->notify();
  delay(1000);
}
` },
  },
};

module.exports = { RECIPES };
